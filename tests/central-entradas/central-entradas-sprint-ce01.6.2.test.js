/**
 * Testes — Central de Entradas Sprint CDS-SORV-CE-01.6.2
 * Cooldown global cStat 656, bloqueio de certificado incompatível antes da SEFAZ.
 * Executar: npm run test:central-entradas-ce01.6.2
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const forge = require('node-forge');
const sqlite3 = require('sqlite3').verbose();

const {
  sincronizarDistribuicaoDFe,
  consultarNotaPorChave
} = require('../../backend/services/fiscal/distribuicaoDFe');
const { CODIGOS } = require('../../backend/services/fiscal/sefazErroOperacional');
const { inspecionarCertificadoPfx } = require('../../backend/services/fiscal/certificateService');
const sefazGate = require('../../backend/motores/central-entradas/services/CentralSefazOperationalGate');
const { CentralSyncExecucaoService } = require('../../backend/motores/central-entradas/services/CentralSyncExecucaoService');
const CentralSincronizacaoService = require('../../backend/motores/central-entradas/services/CentralSincronizacaoService');
const { CentralXmlWaitScheduler } = require('../../backend/motores/central-entradas/services/CentralXmlWaitScheduler');
const { ORIGENS } = require('../../backend/motores/central-entradas/config/centralEventosTipos');

const { CentralSefazOperationalGate, JanelaSefazStore, MOTIVOS_JANELA } = sefazGate;

const CNPJ_CREMOLICIA = '36811652000153';
const CNPJ_OU_TECNICO = '45616309000149';
const CNPJ_OUTRA_EMPRESA = '57824986000131';
const NSU_148 = '000000000000148';
const CHAVE = '23261036811652000153550010000001601000001601';
const UMA_HORA = 60 * 60 * 1000;

let passou = 0;
let falhou = 0;
const arquivosTemp = [];

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function retornoSoap({ cStat, xMotivo, ultNSU, maxNSU }) {
  return `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><dhResp>2026-10-04T19:40:00-03:00</dhResp><ultNSU>${ultNSU}</ultNSU><maxNSU>${maxNSU}</maxNSU></retDistDFeInt>`;
}

const RETORNO_656 = retornoSoap({
  cStat: '656',
  xMotivo: 'Rejeicao: Consumo Indevido (Deve ser utilizado o ultNSU nas solicitacoes subsequentes. Tente apos 1 hora)',
  ultNSU: NSU_148,
  maxNSU: NSU_148
});

const RETORNO_137 = retornoSoap({
  cStat: '137',
  xMotivo: 'Nenhum documento localizado',
  ultNSU: NSU_148,
  maxNSU: NSU_148
});

function criarStoreMemoria(inicial = {}) {
  const mapa = new Map(Object.entries(inicial));
  return {
    mapa,
    salvamentos: 0,
    async obter(cnpj) {
      return { ultimo656Em: null, nsuAlcancadoEm: null, ...(mapa.get(cnpj) || {}) };
    },
    async salvar(cnpj, estado) {
      this.salvamentos += 1;
      mapa.set(cnpj, { ...estado });
    }
  };
}

function criarGate(store = criarStoreMemoria()) {
  return new CentralSefazOperationalGate({ minIntervaloMs: 1, janelaStore: store });
}

function criarSoapContador(resposta) {
  const soap = async (envelope, _path, _senha, url) => {
    soap.chamadas.push({ envelope, url });
    return typeof resposta === 'function' ? resposta() : resposta;
  };
  soap.chamadas = [];
  return soap;
}

function criarNsuMemoria(ultNsu = NSU_148, maxNsu = NSU_148) {
  const estado = { id: 2, cnpj: CNPJ_CREMOLICIA, ambiente: 1, ultNsu, maxNsu, dataSincronizacao: null };
  return {
    estado,
    atualizacoes: 0,
    async obterOuCriar() {
      return { ...estado };
    },
    async atualizarSincronizacao(_id, dados) {
      this.atualizacoes += 1;
      if (dados.ultNsu != null) estado.ultNsu = dados.ultNsu;
      if (dados.maxNsu != null) estado.maxNsu = dados.maxNsu;
      estado.dataSincronizacao = new Date().toISOString();
      return { ...estado };
    }
  };
}

function criarPfxArquivo({ cnpj = CNPJ_CREMOLICIA, ouCnpj = null, senha = 'teste' } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 86400000 * 30);
  const attrs = [
    { shortName: 'C', value: 'BR' },
    { shortName: 'O', value: 'ICP-Brasil' },
    { shortName: 'OU', value: 'Certificado Digital PJ A1' }
  ];
  if (ouCnpj) attrs.push({ shortName: 'OU', value: ouCnpj });
  attrs.push({ shortName: 'CN', value: `EMPRESA LTDA:${cnpj}` });
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  const arquivo = path.join(os.tmpdir(), `ce0162-${Date.now()}-${Math.random().toString(16).slice(2)}.pfx`);
  fs.writeFileSync(arquivo, Buffer.from(der, 'binary'));
  arquivosTemp.push(arquivo);
  return arquivo;
}

function configCremolicia(certificadoPath = 'C:\\fake\\cert.pfx') {
  return {
    certificadoPath,
    certificadoSenha: 'teste',
    cnpj: CNPJ_CREMOLICIA,
    fiscal_ambiente: 1,
    codigoUf: '23'
  };
}

const persistenciaSemDocs = {
  persistirDocumentoDfe: async () => {
    throw new Error('não deveria persistir documento');
  }
};
const nsuControleStub = { registrarConsultaEDetectarLacunas: async () => ({ lacunas: [] }) };

function depsSync({ gate, soap, nsu, config, pularInspecao = true, origem = ORIGENS.MANUAL }) {
  return {
    config: config || configCremolicia(),
    sefazGate: gate,
    enviarSoap: soap,
    nsuRepository: nsu || criarNsuMemoria(),
    persistenciaService: persistenciaSemDocs,
    nsuControleService: nsuControleStub,
    pularInspecaoCertificado: pularInspecao,
    maxIteracoes: 1,
    origem
  };
}

function criarExecucao(dfeDeps) {
  return new CentralSyncExecucaoService({
    sincronizacaoService: new CentralSincronizacaoService({
      documentosRepository: { buscarPorChave: async () => null },
      dfeDeps
    }),
    configService: {
      obterResumo: async () => ({ syncMaxDocumentos: 50, notificarNovasNotas: false }),
      verificarHorarioPermitido: async () => ({ permitido: true })
    },
    eventosService: { registrar: async () => {} },
    notificacoesService: { notificarSyncConcluida: async () => {} }
  });
}

async function gateEmCooldown(ultimo656Em = Date.now() - 5 * 60 * 1000) {
  const store = criarStoreMemoria({ [CNPJ_CREMOLICIA]: { ultimo656Em, nsuAlcancadoEm: null } });
  return { store, gate: criarGate(store) };
}

function abrirDbMemoria() {
  const db = new sqlite3.Database(':memory:');
  const exec = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
  return { db, exec };
}

async function main() {
  console.log('\n=== Testes Central de Entradas — CDS-SORV-CE-01.6.2 ===\n');

  await test('1) cStat 656 real inicia cooldown de 1h e não altera NSU', async () => {
    const store = criarStoreMemoria();
    const gate = criarGate(store);
    const soap = criarSoapContador(RETORNO_656);
    const nsu = criarNsuMemoria();
    const antes = Date.now();

    await assert.rejects(
      () => sincronizarDistribuicaoDFe(depsSync({ gate, soap, nsu })),
      (error) => error.cStat === '656' && error.codigo === CODIGOS.SEFAZ_REJEICAO
    );

    assert.strictEqual(soap.chamadas.length, 1);
    assert.strictEqual(nsu.estado.ultNsu, NSU_148);
    assert.strictEqual(nsu.atualizacoes, 0);
    const janela = await gate.verificarJanelaSefaz(CNPJ_CREMOLICIA);
    assert.strictEqual(janela.bloqueado, true);
    assert.strictEqual(janela.motivoCodigo, MOTIVOS_JANELA.CONSUMO_INDEVIDO);
    const ultimo = Date.parse(janela.ultimo656Em);
    assert.ok(ultimo >= antes - 5);
    assert.strictEqual(Date.parse(janela.desbloqueioEm) - ultimo, UMA_HORA);
    assert.ok(store.mapa.get(CNPJ_CREMOLICIA).ultimo656Em);
  });

  await test('2) background respeita cooldown (sem SOAP/TLS, sem NSU)', async () => {
    const { gate } = await gateEmCooldown();
    const soap = criarSoapContador(RETORNO_137);
    const nsu = criarNsuMemoria();
    const exec = criarExecucao(depsSync({ gate, soap, nsu }));

    const resultado = await exec.executar({ origem: ORIGENS.BACKGROUND });
    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.erro.codigo, CODIGOS.GATE);
    assert.strictEqual(resultado.janelaSefaz.origem, ORIGENS.BACKGROUND);
    assert.match(resultado.mensagem, /cooldown por cStat 656/);
    assert.strictEqual(soap.chamadas.length, 0);
    assert.strictEqual(nsu.atualizacoes, 0);
    assert.notStrictEqual(resultado.cStat, '656');
  });

  await test('3) abertura da Central respeita cooldown', async () => {
    const { gate } = await gateEmCooldown();
    const soap = criarSoapContador(RETORNO_137);
    const exec = criarExecucao(depsSync({ gate, soap }));

    const resultado = await exec.executar({ origem: ORIGENS.ABRIR_CENTRAL, ignorarHorario: true });
    assert.strictEqual(resultado.erro.codigo, CODIGOS.GATE);
    assert.strictEqual(resultado.janelaSefaz.origem, ORIGENS.ABRIR_CENTRAL);
    assert.ok(resultado.janelaSefaz.desbloqueioEm);
    assert.strictEqual(soap.chamadas.length, 0);
  });

  await test('4) botão manual respeita cooldown', async () => {
    const { gate } = await gateEmCooldown();
    const soap = criarSoapContador(RETORNO_137);
    const exec = criarExecucao(depsSync({ gate, soap }));

    const resultado = await exec.executar({ origem: ORIGENS.MANUAL, ignorarHorario: true });
    assert.strictEqual(resultado.erro.codigo, CODIGOS.GATE);
    assert.strictEqual(resultado.janelaSefaz.origem, ORIGENS.MANUAL);
    assert.strictEqual(soap.chamadas.length, 0);
  });

  await test('5) múltiplas origens simultâneas não quebram nem renovam o cooldown', async () => {
    const ultimo656Em = Date.now() - 10 * 60 * 1000;
    const { gate, store } = await gateEmCooldown(ultimo656Em);
    const soap = criarSoapContador(RETORNO_137);
    const salvamentosAntes = store.salvamentos;

    const resultados = await Promise.all([
      criarExecucao(depsSync({ gate, soap })).executar({ origem: ORIGENS.BACKGROUND, ignorarHorario: true }),
      criarExecucao(depsSync({ gate, soap })).executar({ origem: ORIGENS.ABRIR_CENTRAL, ignorarHorario: true }),
      criarExecucao(depsSync({ gate, soap })).executar({ origem: ORIGENS.MANUAL, ignorarHorario: true }),
      consultarNotaPorChave(CHAVE, depsSync({ gate, soap, origem: ORIGENS.API })).catch((e) => ({ erroChave: e }))
    ]);

    assert.strictEqual(soap.chamadas.length, 0);
    resultados.slice(0, 3).forEach((r) => assert.strictEqual(r.erro.codigo, CODIGOS.GATE));
    assert.strictEqual(resultados[3].erroChave.codigo, CODIGOS.GATE);
    assert.strictEqual(store.salvamentos, salvamentosAntes);
    const janela = await gate.verificarJanelaSefaz(CNPJ_CREMOLICIA);
    assert.strictEqual(Date.parse(janela.ultimo656Em), ultimo656Em);
  });

  await test('6) novo 656 real atualiza o timestamp; 656 antigo não regride', async () => {
    const antigo = Date.now() - 2 * UMA_HORA;
    const { gate } = await gateEmCooldown(antigo);
    assert.strictEqual((await gate.verificarJanelaSefaz(CNPJ_CREMOLICIA)).bloqueado, false);

    const soap = criarSoapContador(RETORNO_656);
    await assert.rejects(() => sincronizarDistribuicaoDFe(depsSync({ gate, soap })));
    const janela = await gate.verificarJanelaSefaz(CNPJ_CREMOLICIA);
    assert.strictEqual(janela.bloqueado, true);
    const novo = Date.parse(janela.ultimo656Em);
    assert.ok(novo > antigo + UMA_HORA);

    await gate.registrarConsumoIndevido(CNPJ_CREMOLICIA, antigo);
    assert.strictEqual(Date.parse((await gate.verificarJanelaSefaz(CNPJ_CREMOLICIA)).ultimo656Em), novo);
  });

  await test('7) certificado incompatível bloqueia ANTES da SEFAZ (sem TLS/SOAP/NSU)', async () => {
    const pfx = criarPfxArquivo({ cnpj: CNPJ_OUTRA_EMPRESA });
    const gate = criarGate();
    const soap = criarSoapContador(RETORNO_137);
    const nsu = criarNsuMemoria();

    await assert.rejects(
      () => sincronizarDistribuicaoDFe(depsSync({
        gate, soap, nsu, config: configCremolicia(pfx), pularInspecao: false
      })),
      (error) => error.codigo === CODIGOS.CERTIFICATE_CONFIGURATION_ERROR
        && error.message.includes(CNPJ_OUTRA_EMPRESA)
        && error.message.includes(CNPJ_CREMOLICIA)
    );
    await assert.rejects(
      () => consultarNotaPorChave(CHAVE, depsSync({
        gate, soap, config: configCremolicia(pfx), pularInspecao: false
      })),
      (error) => error.codigo === CODIGOS.CERTIFICATE_CONFIGURATION_ERROR
    );

    assert.strictEqual(soap.chamadas.length, 0);
    assert.strictEqual(gate.obterEstado().telemetria.chamadas, 0);
    assert.strictEqual(nsu.atualizacoes, 0);
    assert.strictEqual(nsu.estado.ultNsu, NSU_148);
  });

  await test('8) CNPJ do certificado é extraído do CN', async () => {
    const pfx = criarPfxArquivo({ cnpj: CNPJ_CREMOLICIA });
    assert.strictEqual(inspecionarCertificadoPfx(pfx, 'teste').cnpj, CNPJ_CREMOLICIA);
  });

  await test('9) OU técnico não é confundido com o CNPJ', async () => {
    const pfx = criarPfxArquivo({ cnpj: CNPJ_CREMOLICIA, ouCnpj: CNPJ_OU_TECNICO });
    const inspecao = inspecionarCertificadoPfx(pfx, 'teste');
    assert.strictEqual(inspecao.cnpj, CNPJ_CREMOLICIA);
    assert.notStrictEqual(inspecao.cnpj, CNPJ_OU_TECNICO);
  });

  await test('10) Cremolícia 36811652000153 é aceita (UF 23, produção, www1, ultNSU 148)', async () => {
    const pfx = criarPfxArquivo({ cnpj: CNPJ_CREMOLICIA, ouCnpj: CNPJ_OU_TECNICO });
    const gate = criarGate();
    const soap = criarSoapContador(RETORNO_137);

    const resultado = await sincronizarDistribuicaoDFe(depsSync({
      gate, soap, config: configCremolicia(pfx), pularInspecao: false
    }));

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.cStat, '137');
    assert.strictEqual(soap.chamadas.length, 1);
    const { envelope, url } = soap.chamadas[0];
    assert.ok(url.startsWith('https://www1.nfe.fazenda.gov.br/'));
    assert.match(envelope, /<tpAmb>1<\/tpAmb>/);
    assert.match(envelope, /<cUFAutor>23<\/cUFAutor>/);
    assert.match(envelope, new RegExp(`<CNPJ>${CNPJ_CREMOLICIA}</CNPJ>`));
    assert.match(envelope, new RegExp(`<ultNSU>${NSU_148}</ultNSU>`));
  });

  await test('11) NSU 148 permanece intacto em 656, em bloqueio e em 137', async () => {
    const nsu = criarNsuMemoria();
    const gate = criarGate();

    await assert.rejects(() => sincronizarDistribuicaoDFe(depsSync({
      gate, soap: criarSoapContador(RETORNO_656), nsu
    })));
    assert.strictEqual(nsu.estado.ultNsu, NSU_148);

    await assert.rejects(() => sincronizarDistribuicaoDFe(depsSync({
      gate, soap: criarSoapContador(RETORNO_137), nsu
    })), (error) => error.codigo === CODIGOS.GATE);
    assert.strictEqual(nsu.estado.ultNsu, NSU_148);

    const livre = criarGate();
    const ok = await sincronizarDistribuicaoDFe(depsSync({
      gate: livre, soap: criarSoapContador(RETORNO_137), nsu
    }));
    assert.strictEqual(ok.ultNsu, NSU_148);
    assert.strictEqual(nsu.estado.ultNsu, NSU_148);
    assert.notStrictEqual(nsu.estado.ultNsu, '000000000000000');
  });

  await test('12) eventos de teste não são tratados como 656 real nem como documento', async () => {
    const { db, exec } = abrirDbMemoria();
    try {
      await exec(`CREATE TABLE central_entradas_config (id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT NOT NULL UNIQUE, valor TEXT, tipo TEXT NOT NULL DEFAULT 'string', descricao TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      await exec(`CREATE TABLE central_entradas_eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, origem TEXT NOT NULL DEFAULT 'sistema', descricao TEXT, resultado TEXT, sucesso INTEGER, documento_id INTEGER, notas_novas INTEGER DEFAULT 0, notas_duplicadas INTEGER DEFAULT 0, duracao_ms INTEGER, detalhe_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      const agoraSql = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await exec(
        `INSERT INTO central_entradas_eventos (tipo, origem, detalhe_json, created_at) VALUES ('SYNC_CONCLUIDA', 'teste', '{"cStat":"656"}', ?)`,
        [agoraSql]
      );
      await exec(
        `INSERT INTO central_entradas_eventos (tipo, origem, detalhe_json, created_at) VALUES ('DESCOBERTA', 'sistema', '{"ultNsu":"000000000000200"}', ?)`,
        [agoraSql]
      );

      const store = new JanelaSefazStore({ db });
      const semReal = await store.obter(CNPJ_CREMOLICIA);
      assert.strictEqual(semReal.ultimo656Em, null);
      assert.strictEqual(await criarGate(store).verificarJanelaSefaz(CNPJ_CREMOLICIA).then((j) => j.bloqueado), false);

      await exec(
        `INSERT INTO central_entradas_eventos (tipo, origem, detalhe_json, created_at) VALUES ('SYNC_CONCLUIDA', 'manual', '{"sucesso":true,"cStat":"656"}', '2026-10-04 21:35:51')`
      );
      const comReal = await store.obter(CNPJ_CREMOLICIA);
      assert.strictEqual(new Date(comReal.ultimo656Em).toISOString(), '2026-10-04T21:35:51.000Z');

      await store.salvar(CNPJ_CREMOLICIA, { ultimo656Em: Date.parse('2026-10-04T21:40:00Z'), nsuAlcancadoEm: null });
      const persistido = await store.obter(CNPJ_CREMOLICIA);
      assert.strictEqual(new Date(persistido.ultimo656Em).toISOString(), '2026-10-04T21:40:00.000Z');
    } finally {
      db.close();
    }
  });

  await test('cooldown persiste entre processos e resetar() não o apaga', async () => {
    const { store, gate } = await gateEmCooldown();
    await gate.verificarJanelaSefaz(CNPJ_CREMOLICIA);
    gate.resetar();
    assert.strictEqual((await gate.verificarJanelaSefaz(CNPJ_CREMOLICIA)).bloqueado, true);
    const outroProcesso = criarGate(store);
    assert.strictEqual((await outroProcesso.verificarJanelaSefaz(CNPJ_CREMOLICIA)).bloqueado, true);
  });

  await test('recuperação de XML por chave e scheduler respeitam cooldown 656', async () => {
    const { gate } = await gateEmCooldown();
    const soap = criarSoapContador(RETORNO_137);
    await assert.rejects(
      () => consultarNotaPorChave(CHAVE, depsSync({ gate, soap, origem: ORIGENS.API })),
      (error) => error.codigo === CODIGOS.GATE
    );
    assert.strictEqual(soap.chamadas.length, 0);
    assert.strictEqual(gate.podeConsultar(), false);

    const scheduler = new CentralXmlWaitScheduler({
      flags: { estaHabilitado: () => true },
      configService: { obterResumo: async () => ({ xmlWaitMaxPorCiclo: 1 }) },
      documentosRepository: { listar: async () => [] },
      sefazGate: gate
    });
    assert.strictEqual((await scheduler.executarCiclo()).ignorado, true);
  });

  await test('cooldown expira após 1h do último 656', async () => {
    const { gate } = await gateEmCooldown(Date.now() - UMA_HORA - 1000);
    const soap = criarSoapContador(RETORNO_137);
    const resultado = await sincronizarDistribuicaoDFe(depsSync({ gate, soap }));
    assert.strictEqual(resultado.cStat, '137');
    assert.strictEqual(soap.chamadas.length, 1);
  });

  await test('ultNSU = maxNSU aguarda 1h para DistDFe, sem bloquear consulta por chave', async () => {
    const gate = criarGate();
    const resultado = await sincronizarDistribuicaoDFe(depsSync({ gate, soap: criarSoapContador(RETORNO_137) }));
    assert.ok(resultado.proximaConsultaApos);

    const soap = criarSoapContador(RETORNO_137);
    await assert.rejects(
      () => sincronizarDistribuicaoDFe(depsSync({ gate, soap })),
      (error) => error.codigo === CODIGOS.GATE && /ultNSU = maxNSU/.test(error.message)
    );
    assert.strictEqual(soap.chamadas.length, 0);
    assert.strictEqual(gate.podeConsultar(), true);

    const soapChave = criarSoapContador(retornoSoap({
      cStat: '137', xMotivo: 'Nenhum documento localizado', ultNSU: '0', maxNSU: '0'
    }));
    const porChave = await consultarNotaPorChave(CHAVE, {
      ...depsSync({ gate, soap: soapChave }),
      persistenciaService: { persistirDocumentoDfe: async () => ({ ignorado: true }) }
    });
    assert.strictEqual(porChave.cStat, '137');
    assert.strictEqual(soapChave.chamadas.length, 1);
  });

  arquivosTemp.forEach((arquivo) => fs.rmSync(arquivo, { force: true }));
  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
