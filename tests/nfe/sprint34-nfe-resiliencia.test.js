/**
 * Sprint 3.4 — Resiliência operacional NF-e
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  classificarErro,
  podeReenviar,
  statusParaFila,
  statusOperacionalDeErro,
  respostaAmigavel
} = require('../../backend/services/fiscal/nfeErros');

describe('Sprint 3.4 — mensagens amigáveis', () => {
  it('classifica timeout', () => {
    const e = classificarErro({ erro: 'ETIMEDOUT connecting to SEFAZ' });
    assert.equal(e.codigo, 'TIMEOUT');
    assert.match(e.mensagem, /Timeout/i);
    assert.ok(e.sugestao);
  });

  it('classifica certificado vencido', () => {
    const e = classificarErro({ erro: 'Certificado vencido / expired notAfter' });
    assert.equal(e.codigo, 'CERTIFICADO_VENCIDO');
  });

  it('classifica lote em processamento (cStat 105)', () => {
    const e = classificarErro({ cStat: '105', xMotivo: 'Lote em processamento' });
    assert.equal(e.codigo, 'LOTE_PROCESSAMENTO');
  });

  it('classifica duplicidade', () => {
    const e = classificarErro({ cStat: '204' });
    assert.equal(e.codigo, 'DUPLICIDADE');
  });

  it('classifica CSC não cadastrado (cStat 462)', () => {
    const e = classificarErro({
      cStat: '462',
      xMotivo: 'Rejeicao: Codigo identificador do CSC no QR-Code nao cadastrado na SEFAZ'
    });
    assert.equal(e.codigo, 'CSC_NAO_CADASTRADO');
    assert.match(e.sugestao, /CSC/i);
  });

  it('resposta amigável não inclui stack', () => {
    const r = respostaAmigavel(classificarErro({ erro: 'socket hang up' }));
    assert.equal(r.success, false);
    assert.ok(r.mensagem);
    assert.ok(r.codigo);
    assert.ok(r.sugestao);
    assert.doesNotMatch(JSON.stringify(r), /at Object\.|Error:.*\n\s+at /);
  });
});

describe('Sprint 3.4 — reenvio e fila', () => {
  it('bloqueia reenvio de autorizada/cancelada/denegada', () => {
    assert.equal(podeReenviar({ status: 'autorizada' }), false);
    assert.equal(podeReenviar({ status: 'cancelada' }), false);
    assert.equal(podeReenviar({ status: 'denegada' }), false);
    assert.equal(podeReenviar({ status: 'inutilizada' }), false);
  });

  it('permite reenvio para erros de comunicação/timeout/serviço/lote', () => {
    assert.equal(podeReenviar({ status: 'timeout' }), true);
    assert.equal(podeReenviar({ status: 'servico_indisponivel' }), true);
    assert.equal(podeReenviar({ status: 'erro_comunicacao' }), true);
    assert.equal(podeReenviar({ status: 'aguardando_retorno' }), true);
    assert.equal(podeReenviar({ erroCodigo: 'TIMEOUT' }), true);
  });

  it('mapeia status → fila', () => {
    assert.equal(statusParaFila('autorizada'), 'autorizado');
    assert.equal(statusParaFila('cancelada'), 'cancelado');
    assert.equal(statusParaFila('aguardando_retorno'), 'aguardando');
    assert.equal(statusParaFila('timeout'), 'erro');
  });

  it('status operacional a partir do erro', () => {
    assert.equal(statusOperacionalDeErro({ codigo: 'TIMEOUT' }), 'timeout');
    assert.equal(statusOperacionalDeErro({ codigo: 'LOTE_PROCESSAMENTO' }), 'aguardando_retorno');
  });
});

describe('Sprint 3.4 — artefatos e isolamento', () => {
  it('APIs monitor/diagnostico/fila/logs/reenviar existem e exigem nfe', () => {
    const rotas = fs.readFileSync(path.join(__dirname, '../../backend/rotas/nfe.js'), 'utf8');
    assert.match(rotas, /exigirRecurso\('nfe'\)/);
    assert.match(rotas, /\/monitor/);
    assert.match(rotas, /\/diagnostico/);
    assert.match(rotas, /\/fila/);
    assert.match(rotas, /\/logs/);
    assert.match(rotas, /\/reenviar/);
    assert.match(rotas, /enviarErroAmigavel/);
  });

  it('consulta automática com backoff progressivo', () => {
    const svc = fs.readFileSync(path.join(__dirname, '../../backend/services/fiscal/nfeOperacionalService.js'), 'utf8');
    assert.match(svc, /BACKOFF_MS/);
    assert.match(svc, /agendarConsultaAutomatica/);
    assert.match(svc, /consulta_automatica/);
  });

  it('Núcleo e NFC-e não referenciam operacional 3.4', () => {
    const root = path.join(__dirname, '../..');
    const vendasDir = path.join(root, 'backend/services/vendas');
    const arquivos = [
      path.join(root, 'backend/rotas/vendas.js'),
      path.join(root, 'backend/services/fiscal/emissor.js'),
      path.join(root, 'backend/services/fiscal/cancelarNfce.js'),
      ...fs.readdirSync(vendasDir).filter((f) => f.endsWith('.js')).map((f) => path.join(vendasDir, f))
    ];
    for (const arquivo of arquivos) {
      assert.doesNotMatch(fs.readFileSync(arquivo, 'utf8'), /nfeOperacionalService|nfeErros/, arquivo);
    }
  });
});
