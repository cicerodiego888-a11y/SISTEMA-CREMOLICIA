const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-sync-em-dia-'));

const { CentralSyncExecucaoService } = require('../../backend/motores/central-entradas/services/CentralSyncExecucaoService');
const SincronizacaoResultadoDTO = require('../../backend/motores/central-entradas/contracts/SincronizacaoResultadoDTO');

function erroGate(motivoCodigo, via = 'code') {
  const e = new Error('Distribuição DF-e em dia (ultNSU = maxNSU). Regra SEFAZ: nova consulta somente após 12:51:41.');
  // distribuicaoDFe.criarErroSefaz troca `code` por `codigo: SEFAZ_GATE`
  if (via === 'codigo') e.codigo = 'SEFAZ_GATE'; else e.code = 'SEFAZ_GATE_BLOQUEADO';
  e.statusCode = 429;
  e.janelaSefaz = { motivoCodigo, desbloqueioEm: '2026-10-28T15:51:41.000Z', bloqueado: true };
  return e;
}

function criar(sincronizar) {
  const eventos = [];
  const notificacoes = [];
  const svc = new CentralSyncExecucaoService({
    sincronizacaoService: { sincronizar },
    configService: {
      verificarHorarioPermitido: async () => ({ permitido: true }),
      obterResumo: async () => ({ syncMaxDocumentos: 50, notificarNovasNotas: true })
    },
    eventosService: { registrar: async (e) => { eventos.push(e); } },
    notificacoesService: { notificarSyncConcluida: async (n) => { notificacoes.push(n); } }
  });
  return { svc, eventos, notificacoes };
}

const testes = [];
const t = (nome, fn) => testes.push([nome, fn]);

t('em dia: sem erro, sem notificação, evento de sucesso', async () => {
  const { svc, eventos, notificacoes } = criar(async () => SincronizacaoResultadoDTO.fromError(erroGate('NSU_ALCANCADO')));
  const r = await svc.executar({ origem: 'abertura' });
  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.aguardandoIntervaloSefaz, true);
  assert.match(r.mensagem, /Documentos atualizados/);
  assert.ok(r.janelaSefaz && r.detalheTecnico, 'diagnóstico preservado');
  assert.strictEqual(notificacoes.length, 0);
  assert.ok(eventos.every((e) => e.tipo !== 'SYNC_ERRO'));
});

t('em dia lançado diretamente (catch): sem notificação de erro', async () => {
  const { svc, eventos, notificacoes } = criar(async () => { throw erroGate('NSU_ALCANCADO'); });
  const r = await svc.executar({ origem: 'abertura' });
  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(notificacoes.length, 0);
  assert.ok(eventos.every((e) => e.tipo !== 'SYNC_ERRO'));
});

t('abertura repetida: nunca gera alerta e segue executando a sincronização', async () => {
  let chamadas = 0;
  const { svc, notificacoes } = criar(async () => { chamadas += 1; return SincronizacaoResultadoDTO.fromError(erroGate('NSU_ALCANCADO')); });
  await svc.executar({ origem: 'abertura' });
  await svc.executar({ origem: 'abertura' });
  assert.strictEqual(chamadas, 2);
  assert.strictEqual(notificacoes.length, 0);
});

t('erro real do pipeline (criarErroSefaz, codigo SEFAZ_GATE): em dia não notifica', async () => {
  const { criarErroSefaz } = require('../../backend/services/fiscal/sefazErroOperacional');
  const { svc, notificacoes } = criar(async () => { throw criarErroSefaz(erroGate('NSU_ALCANCADO')); });
  const r = await svc.executar({ origem: 'abertura' });
  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.aguardandoIntervaloSefaz, true);
  assert.strictEqual(notificacoes.length, 0);
  const via = criar(async () => SincronizacaoResultadoDTO.fromError(criarErroSefaz(erroGate('NSU_ALCANCADO'))));
  const r2 = await via.svc.executar({ origem: 'abertura' });
  assert.strictEqual(r2.aguardandoIntervaloSefaz, true);
  assert.strictEqual(via.notificacoes.length, 0);
});

t('cooldown 656 (consumo indevido) continua como erro', async () => {
  const { svc, notificacoes } = criar(async () => { throw erroGate('CONSUMO_INDEVIDO'); });
  const r = await svc.executar({ origem: 'abertura' });
  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(notificacoes.length, 1);
  assert.strictEqual(notificacoes[0].sucesso, false);
});

for (const [nome, erro] of [
  ['conexão', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
  ['certificado', new Error('Certificado expirado')],
  ['rejeição SEFAZ', Object.assign(new Error('Rejeicao: falha'), { cStat: '215' })]
]) {
  t(`erro real (${nome}) continua informado`, async () => {
    const { svc, notificacoes, eventos } = criar(async () => { throw erro; });
    const r = await svc.executar({ origem: 'abertura' });
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(notificacoes.length, 1);
    assert.ok(eventos.some((e) => e.tipo === 'SYNC_ERRO'));
  });
}

t('novos documentos: fluxo preservado com notificação', async () => {
  const { svc, notificacoes } = criar(async () => SincronizacaoResultadoDTO.create({ sucesso: true, notasNovas: 3 }).toJSON());
  const r = await svc.executar({ origem: 'abertura' });
  assert.strictEqual(r.notasNovas, 3);
  assert.strictEqual(notificacoes.length, 1);
  assert.strictEqual(notificacoes[0].notasNovas, 3);
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('OK  ', nome); } catch (e) { falhas += 1; console.log('FALHA', nome, e.message); }
  }
  console.log(`Resultado: ${testes.length - falhas} passou, ${falhas} falhou`);
  process.exit(falhas ? 1 : 0);
})();
