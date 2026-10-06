/**
 * Testes — Central de Entradas Sprint CDS-SORV-CE-01
 * Executar: npm run test:central-entradas-ce01
 */

const assert = require('assert');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const CentralDfePersistenciaService = require('../../backend/motores/central-entradas/services/CentralDfePersistenciaService');
const CentralMirxService = require('../../backend/motores/central-entradas/services/CentralMirxService');
const CentralManifestacaoService = require('../../backend/motores/central-entradas/services/CentralManifestacaoService');
const CentralEntradasOrchestrator = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');
const { detectarLacunasNsu } = require('../../backend/motores/central-entradas/services/CentralNsuControleService');
const { classificarXml, CLASSE_XML } = require('../../backend/motores/central-entradas/core/xmlDocumento');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const sefazGate = require('../../backend/motores/central-entradas/services/CentralSefazOperationalGate');
const { extrairTodosNsus } = require('../../backend/services/fiscal/dfeRetornoParser');

let passou = 0;
let falhou = 0;

const CHAVE = '23251088888888000188550010000001011000001011';
const CNPJ = '88888888000188';

const service = new CentralEntradasService();
const documentosRepository = new CentralDocumentosRepository();
const historicoRepository = new CentralHistoricoRepository();
const persistenciaService = new CentralDfePersistenciaService();

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

function xmlCompleto(chave) {
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave}"><ide><nNF>101</nNF><serie>1</serie><dhEmi>2026-10-04T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${CNPJ}</CNPJ><xNome>Fornecedor CE01</xNome></emit><total><ICMSTot><vNF>88.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

function xmlResumo(chave) {
  return `<resNFe><chNFe>${chave}</chNFe><CNPJ>${CNPJ}</CNPJ><xNome>Fornecedor CE01</xNome><dhEmi>2026-10-04T10:00:00-03:00</dhEmi><vNF>88.00</vNF></resNFe>`;
}

async function limpar() {
  const existente = await documentosRepository.buscarPorChave(CHAVE);
  if (!existente) return;
  await historicoRepository._obterSql().run(
    'DELETE FROM central_entradas_historico WHERE documento_id = ?',
    [existente.id]
  );
  await documentosRepository.remover(existente.id);
}

async function main() {
  console.log('\n=== Testes Central de Entradas — CDS-SORV-CE-01 ===\n');

  await documentosRepository._obterSql().whenReady();
  await limpar();

  await test('classifica XML resumo, completo e ausente', async () => {
    assert.strictEqual(classificarXml(''), CLASSE_XML.AUSENTE);
    assert.strictEqual(classificarXml(xmlResumo(CHAVE)), CLASSE_XML.RESUMO);
    assert.strictEqual(classificarXml(xmlCompleto(CHAVE)), CLASSE_XML.COMPLETO);
  });

  await test('detecta lacunas de NSU no intervalo consultado', async () => {
    const resultado = detectarLacunasNsu({
      nsuAnterior: '000000000000010',
      nsuAtual: '000000000000014',
      nsusVistos: ['000000000000011', '000000000000013', '000000000000014']
    });
    assert.deepStrictEqual(resultado.lacunas, ['000000000000012']);
    assert.strictEqual(resultado.esperado, 4);
  });

  await test('extrairTodosNsus lê NSUs do lote DistDFe', async () => {
    const xml = '<loteDistDFeInt><docZip NSU="3" schema="resNFe_v1.01.xsd"></docZip><docZip NSU="5" schema="procNFe_v4.00.xsd"></docZip></loteDistDFeInt>';
    const nsus = extrairTodosNsus(xml);
    assert.ok(nsus.includes('000000000000003'));
    assert.ok(nsus.includes('000000000000005'));
  });

  await test('persistência de resNFe entra em AGUARDANDO_XML sem criar compra', async () => {
    const resultado = await persistenciaService.persistirDocumentoDfe({
      xml: xmlResumo(CHAVE),
      nsu: '000000000000101',
      origem: 'dfe'
    });
    assert.strictEqual(resultado.novo, true);
    assert.strictEqual(resultado.aguardandoXml, true);
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML);
    const compra = await documentosRepository._obterSql().get(
      'SELECT id FROM compras WHERE chave_acesso = ?',
      [CHAVE]
    );
    assert.ok(!compra);
  });

  await test('XML completo recupera o mesmo documento sem duplicar', async () => {
    const resultado = await persistenciaService.persistirDocumentoDfe({
      xml: xmlCompleto(CHAVE),
      nsu: '000000000000101',
      origem: 'consulta_chave'
    });
    assert.strictEqual(resultado.recuperado, true);
    assert.strictEqual(resultado.duplicado, false);
    assert.strictEqual(resultado.documento.chave, CHAVE);
    assert.ok(resultado.documento.xml.includes('infNFe'));
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.SINCRONIZADA);

    const lista = await documentosRepository._obterSql().all(
      'SELECT id FROM central_entradas_documentos WHERE chave = ?',
      [CHAVE]
    );
    assert.strictEqual(lista.length, 1);
  });

  await test('segunda persistência do mesmo XML é idempotente', async () => {
    const resultado = await persistenciaService.persistirDocumentoDfe({
      xml: xmlCompleto(CHAVE),
      origem: 'dfe'
    });
    assert.strictEqual(resultado.duplicado, true);
    assert.strictEqual(resultado.novo, false);
  });

  await test('orchestrator não processa documento sem XML completo', async () => {
    await limpar();
    const criado = await persistenciaService.persistirDocumentoDfe({
      xml: xmlResumo(CHAVE),
      origem: 'dfe'
    });
    const resultado = await service.processarDocumento(criado.documento.id);
    assert.strictEqual(resultado.aguardandoXml, true);
    assert.strictEqual(resultado.sucesso, false);
    const atual = await documentosRepository.buscarPorId(criado.documento.id);
    assert.strictEqual(atual.status, DocumentoFiscalStatus.AGUARDANDO_XML);
  });

  await test('recuperação controlada atualiza XML e preserva o id', async () => {
    const doc = await documentosRepository.buscarPorChave(CHAVE);
    const orchestrator = new CentralEntradasOrchestrator({
      documentosRepository,
      historicoService: {
        registrar: async () => ({})
      },
      processamentoService: { processar: async () => ({ sucesso: true }) },
      sincronizacaoService: {
        buscarPorChave: async () => {
          await persistenciaService.persistirDocumentoDfe({
            xml: xmlCompleto(CHAVE),
            origem: 'consulta_chave'
          });
          return { sucesso: true, notasNovas: 0 };
        }
      },
      comprasBridgeService: { montarPayloadAbrirCompra: async () => ({}) }
    });

    const resultado = await orchestrator.recuperarXml(doc.id);
    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.recuperado, true);
    const atual = await documentosRepository.buscarPorChave(CHAVE);
    assert.strictEqual(atual.id, doc.id);
    assert.ok(atual.xml.includes('infNFe'));
  });

  await test('Gate SEFAZ bloqueia consulta concorrente', async () => {
    sefazGate.resetar();
    const gateTeste = new sefazGate.CentralSefazOperationalGate({ minIntervaloMs: 0 });
    let liberar;
    const pendente = new Promise((resolve) => { liberar = resolve; });
    const emCurso = gateTeste.executar(() => pendente);
    const avaliacao = gateTeste.avaliar();
    assert.strictEqual(avaliacao.permitido, false);
    liberar('ok');
    await emCurso;
  });

  await test('MIRX não duplica documento já integrado a Compras', async () => {
    const doc = await documentosRepository.buscarPorChave(CHAVE);
    await documentosRepository.atualizar(doc.id, {
      status: DocumentoFiscalStatus.GRAVADA
    });
    const mirx = new CentralMirxService({ documentosRepository });
    const resultado = await mirx.reprocessar(doc.id);
    assert.strictEqual(resultado.idempotente, true);
    assert.strictEqual(resultado.reprocessado, false);
    const lista = await documentosRepository._obterSql().all(
      'SELECT id FROM central_entradas_documentos WHERE chave = ?',
      [CHAVE]
    );
    assert.strictEqual(lista.length, 1);
  });

  await test('manifestação é preparada e não enviada automaticamente', async () => {
    const doc = await documentosRepository.buscarPorChave(CHAVE);
    const manifestacao = new CentralManifestacaoService();
    const resultado = await manifestacao.enviar(doc.id, '210210');
    assert.strictEqual(resultado.preparado, true);
    assert.strictEqual(resultado.enviado, false);
  });

  await test('health expõe SEFAZ, NSU, filas e última sincronização', async () => {
    const health = await service.obterHealth();
    assert.strictEqual(health.sprint, 'CE-01');
    assert.ok('sefazDisponivel' in health);
    assert.ok('ultimoNsu' in health);
    assert.ok(health.filas);
    assert.ok('aguardandoXml' in health.filas);
    assert.ok('erros' in health.filas);
    assert.ok('pendentes' in health.filas);
  });

  await test('dashboard inclui fila de aguardando XML', async () => {
    const dashboard = await service.obterDashboard();
    assert.ok('aguardandoXml' in dashboard.contadores);
  });

  await limpar();

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
