/**
 * Testes — Central de Entradas Sprint 5 (pipeline de processamento)
 * Executar: npm run test:central-entradas-sprint5
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const CentralHistoricoService = require('../../backend/motores/central-entradas/services/CentralHistoricoService');
const CentralDfePersistenciaService = require('../../backend/motores/central-entradas/services/CentralDfePersistenciaService');
const CentralProcessamentoService = require('../../backend/motores/central-entradas/services/CentralProcessamentoService');
const CentralComprasBridgeService = require('../../backend/motores/central-entradas/services/CentralComprasBridgeService');
const { persistirDocumentosRetorno } = require('../../backend/services/fiscal/distribuicaoDFe');
const CentralEntradasOrchestrator = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');
const { enriquecerParseComMiip } = require('../../backend/shared/nfe/enriquecerParseComMiip');
const NFeParserService = require('../../backend/shared/nfe/NFeParserService');
const {
  DocumentoFiscalStatus,
  STATUS_XML_COMPLETO_LEGADO
} = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

let passou = 0;
let falhou = 0;

const CHAVE_SPRINT5 = '35260112345678000199550010000000011000000001';
const FIXTURE_XML = path.join(__dirname, '../shared/nfe/fixtures/nfe-proc-sample.xml');

const service = new CentralEntradasService();
const documentosRepository = new CentralDocumentosRepository();
const historicoRepository = new CentralHistoricoRepository();
const historicoService = new CentralHistoricoService({ historicoRepository });
const bridgeService = new CentralComprasBridgeService({
  documentosRepository,
  historicoService,
  validarProdutos: async () => []
});
const bridgeServiceEstrito = new CentralComprasBridgeService({
  documentosRepository,
  historicoService
});

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

async function limparDocumentoTeste() {
  const existente = await documentosRepository.buscarPorChave(CHAVE_SPRINT5);
  if (!existente) return;

  await historicoRepository._obterSql().run(
    'DELETE FROM central_entradas_historico WHERE documento_id = ?',
    [existente.id]
  );
  await documentosRepository.remover(existente.id);
}

async function criarDocumentoSincronizado() {
  await limparDocumentoTeste();

  const xml = fs.readFileSync(FIXTURE_XML, 'utf8');

  return documentosRepository.inserir({
    chave: CHAVE_SPRINT5,
    numero: '7777',
    serie: '1',
    fornecedor: 'Fornecedor Sprint 5',
    cnpjFornecedor: '77777777000177',
    dataEmissao: '2026-07-05',
    valorTotal: 100,
    xml,
    origem: 'dfe',
    status: DocumentoFiscalStatus.SINCRONIZADA
  });
}

async function main() {
  console.log('\n=== Testes Central de Entradas — Sprint 5 ===\n');

  await documentosRepository._obterSql().whenReady();

  await test('health retorna sprint CE-01', async () => {
    const health = await service.obterHealth();
    assert.strictEqual(health.sprint, 'CE-01');
  });

  await test('enriquecerParseComMiip não altera contrato parse-xml', async () => {
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    const parsed = await NFeParserService.parse(xml);
    const { parsed: enriquecido } = await enriquecerParseComMiip(parsed);

    assert.ok(Array.isArray(enriquecido.itens));
    assert.ok(enriquecido.chave_acesso);
    assert.strictEqual(typeof enriquecido.valor_total_nota, 'number');
  });

  await test('XML completo recém-persistido disponibiliza itens sem acionamento manual', async () => {
    await limparDocumentoTeste();
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    let chamadasParser = 0;
    const persistencia = new CentralDfePersistenciaService({
      documentosRepository,
      historicoRepository
    });
    const processamento = new CentralProcessamentoService({
      documentosRepository,
      historicoService,
      parser: {
        parse: async (conteudo) => {
          chamadasParser += 1;
          return NFeParserService.parse(conteudo);
        }
      },
      enriquecerParseComMiip: async (parsed) => ({
        parsed,
        miipImportacao: null,
        possuiPendencias: false,
        erroMiip: null
      }),
      validarProdutos: async () => []
    });
    const retorno = `<retDistDFeInt><docZip NSU="000000000000149" schema="procNFe_v4.00">${zlib.gzipSync(Buffer.from(xml)).toString('base64')}</docZip></retDistDFeInt>`;

    try {
      const resultado = await persistirDocumentosRetorno(retorno, persistencia, 'dfe', processamento);
      assert.strictEqual(resultado.notasNovas, 1);
      const atualizado = await documentosRepository.buscarPorChave(CHAVE_SPRINT5);
      assert.strictEqual(atualizado.status, DocumentoFiscalStatus.PRONTA_PARA_COMPRA);
      assert.ok(atualizado.parseJson?.itens?.length > 0);
      assert.strictEqual(chamadasParser, 1);

      const parsePersistido = await service.obterParseDocumento(atualizado.id);
      assert.strictEqual(parsePersistido.parseDisponivel, true);
      assert.ok(parsePersistido.parse.itens.length > 0);

      const duplicado = await persistirDocumentosRetorno(retorno, persistencia, 'dfe', processamento);
      assert.strictEqual(duplicado.notasDuplicadas, 1);
      assert.strictEqual(chamadasParser, 1, 'documento já processado não deve repetir o pipeline');
    } finally {
      await limparDocumentoTeste();
    }
  });

  await test('ingestão completa reprocessa documento legado não parseado pelo caminho DF-e', async () => {
    await limparDocumentoTeste();
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    let chamadasParser = 0;
    await documentosRepository.inserir({
      chave: CHAVE_SPRINT5,
      numero: '7777',
      serie: '1',
      fornecedor: 'Fornecedor Sprint 5',
      cnpjFornecedor: '77777777000177',
      dataEmissao: '2026-07-05',
      valorTotal: 100,
      xml,
      origem: 'dfe',
      status: STATUS_XML_COMPLETO_LEGADO
    });

    const persistencia = new CentralDfePersistenciaService({
      documentosRepository,
      historicoRepository
    });
    const processamento = new CentralProcessamentoService({
      documentosRepository,
      historicoService,
      parser: {
        parse: async (conteudo) => {
          chamadasParser += 1;
          return NFeParserService.parse(conteudo);
        }
      },
      enriquecerParseComMiip: async (parsed) => ({
        parsed,
        miipImportacao: null,
        possuiPendencias: false,
        erroMiip: null
      }),
      validarProdutos: async () => []
    });
    const retorno = `<retDistDFeInt><docZip NSU="000000000000148" schema="procNFe_v4.00">${zlib.gzipSync(Buffer.from(xml)).toString('base64')}</docZip></retDistDFeInt>`;

    try {
      const resultado = await persistirDocumentosRetorno(retorno, persistencia, 'dfe', processamento);
      assert.strictEqual(resultado.notasDuplicadas, 1);
      const atualizado = await documentosRepository.buscarPorChave(CHAVE_SPRINT5);
      assert.strictEqual(atualizado.status, DocumentoFiscalStatus.PRONTA_PARA_COMPRA);
      assert.ok(atualizado.parseJson);
      assert.strictEqual(chamadasParser, 1);

      const parsePersistido = await service.obterParseDocumento(atualizado.id);
      assert.strictEqual(parsePersistido.parseDisponivel, true);
      assert.ok(parsePersistido.parse.itens.length > 0);

      await persistirDocumentosRetorno(retorno, persistencia, 'dfe', processamento);
      assert.strictEqual(chamadasParser, 1, 'retorno duplicado não deve repetir o pipeline concluído');
    } finally {
      await limparDocumentoTeste();
    }
  });

  await test('recuperação reutiliza XML completo pendente sem esperar clique em processar', async () => {
    await limparDocumentoTeste();
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    const criado = await documentosRepository.inserir({
      chave: CHAVE_SPRINT5,
      numero: '7777',
      serie: '1',
      fornecedor: 'Fornecedor Sprint 5',
      cnpjFornecedor: '77777777000177',
      dataEmissao: '2026-07-05',
      valorTotal: 100,
      xml,
      origem: 'dfe',
      status: DocumentoFiscalStatus.SINCRONIZADA
    });
    const processamento = new CentralProcessamentoService({
      documentosRepository,
      historicoService,
      parser: NFeParserService,
      enriquecerParseComMiip: async (parsed) => ({
        parsed,
        miipImportacao: null,
        possuiPendencias: false,
        erroMiip: null
      }),
      validarProdutos: async () => []
    });
    const orchestrator = new CentralEntradasOrchestrator({
      documentosRepository,
      historicoService,
      processamentoService: processamento
    });

    try {
      const resultado = await orchestrator.recuperarXml(criado.id);
      assert.strictEqual(resultado.recuperado, true);
      assert.strictEqual(resultado.processamento.sucesso, true);
      const atualizado = await documentosRepository.buscarPorId(criado.id);
      assert.strictEqual(atualizado.status, DocumentoFiscalStatus.PRONTA_PARA_COMPRA);
      assert.ok(atualizado.parseJson?.itens?.length > 0);
    } finally {
      await limparDocumentoTeste();
    }
  });

  await test('abrir NF persistida inicia o pipeline e exibe itens sem clique manual', async () => {
    await limparDocumentoTeste();
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    const criado = await documentosRepository.inserir({
      chave: CHAVE_SPRINT5,
      numero: '7777',
      serie: '1',
      fornecedor: 'Fornecedor Sprint 5',
      cnpjFornecedor: '77777777000177',
      dataEmissao: '2026-07-05',
      valorTotal: 100,
      xml,
      origem: 'dfe',
      status: DocumentoFiscalStatus.SINCRONIZADA
    });

    let chamadasParser = 0;
    let chamadasProcessamento = 0;
    let aberturasRevisao = 0;
    const renderizados = [];
    const processoReal = new CentralProcessamentoService({
      documentosRepository,
      historicoService,
      parser: {
        parse: async (conteudo) => {
          chamadasParser += 1;
          return NFeParserService.parse(conteudo);
        }
      },
      enriquecerParseComMiip: async (parsed) => ({
        parsed,
        miipImportacao: null,
        possuiPendencias: false,
        erroMiip: null
      }),
      validarProdutos: async () => []
    });
    const frontend = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'erp', 'js', 'central-entradas.js'),
      'utf8'
    );
    const extrair = (inicio, fim) => {
      const indiceInicio = frontend.indexOf(inicio);
      const indiceFim = frontend.indexOf(fim, indiceInicio);
      assert.ok(indiceInicio >= 0 && indiceFim > indiceInicio, `Função não encontrada: ${inicio}`);
      return frontend.slice(indiceInicio, indiceFim);
    };
    const vmContext = {
      centralEntradasState: {
        documentoSelecionadoId: null,
        abaAtiva: 'itens',
        processando: false,
        etapaProcessamento: null,
        detalheAtual: null,
        parseAtual: null
      },
      centralEntradasFetch: async (url, opcoes = {}) => {
        if (url === `/${criado.id}`) return service.obterDocumentoDetalhe(criado.id);
        if (url === `/${criado.id}/parse`) return service.obterParseDocumento(criado.id);
        if (url === `/${criado.id}/processar` && opcoes.method === 'POST') {
          chamadasProcessamento += 1;
          return processoReal.processar(criado.id);
        }
        throw new Error(`Endpoint inesperado no teste: ${url}`);
      },
      document: { getElementById: () => ({ innerHTML: '' }) },
      centralUx: () => ({ renderSkeletonPainelCentral: () => '' }),
      renderGridCentralEntradas: () => {},
      renderPainelLateralCentral: (detalhe) => {
        renderizados.push({
          status: detalhe.documento.status,
          parseDisponivel: Boolean(vmContext.centralEntradasState.parseAtual?.parse)
        });
      },
      renderPainelLateralPlaceholder: () => {},
      carregarStatsFornecedorCentral: async () => {},
      carregarDashboardCentral: async () => {},
      carregarDocumentosCentral: async () => {},
      obterUsuarioLogadoCentral: () => ({ id: 1 }),
      showNotification: () => {},
      abrirCentralRevisaoMiip: async () => { aberturasRevisao += 1; }
    };

    vm.createContext(vmContext);
    vm.runInContext(
      `${extrair(
        'async function processarDocumentoCentral(documentoId, opcoes = {}) {',
        '\nasync function recuperarXmlDocumentoCentral'
      )}\n${extrair(
        'async function selecionarDocumentoCentral(id, opcoes = {}) {',
        '\nfunction alternarOrdenacaoCentral'
      )}\nglobalThis.abrirDocumento = selecionarDocumentoCentral;`,
      vmContext
    );

    try {
      await vmContext.abrirDocumento(criado.id, { preservarAba: true });

      let atualizado = await documentosRepository.buscarPorId(criado.id);
      assert.strictEqual(chamadasProcessamento, 1);
      assert.strictEqual(chamadasParser, 1);
      assert.ok(atualizado.parseJson?.itens?.length > 0);
      assert.strictEqual(atualizado.status, DocumentoFiscalStatus.PRONTA_PARA_COMPRA);
      assert.strictEqual(vmContext.centralEntradasState.abaAtiva, 'itens');
      assert.ok(renderizados.some((item) => item.parseDisponivel));
      assert.strictEqual(aberturasRevisao, 0, 'abertura automática não deve iniciar a revisão MIIP');

      await vmContext.abrirDocumento(criado.id, { preservarAba: true });
      atualizado = await documentosRepository.buscarPorId(criado.id);
      assert.strictEqual(chamadasProcessamento, 1, 'abrir novamente não deve duplicar o pipeline');
      assert.strictEqual(chamadasParser, 1);
      assert.strictEqual(atualizado.status, DocumentoFiscalStatus.PRONTA_PARA_COMPRA);
      assert.strictEqual(vmContext.centralEntradasState.abaAtiva, 'itens');
    } finally {
      await limparDocumentoTeste();
    }
  });

  let documento;

  await test('cria documento sincronizado para processamento', async () => {
    documento = await criarDocumentoSincronizado();
    assert.strictEqual(documento.status, DocumentoFiscalStatus.SINCRONIZADA);
  });

  await test('processa XML_COMPLETO legado e disponibiliza os itens persistidos', async () => {
    let chamadasParser = 0;
    const processamentoSemMiip = new CentralProcessamentoService({
      documentosRepository,
      historicoService,
      parser: {
        parse: async (xml) => {
          chamadasParser += 1;
          if (chamadasParser === 1) throw new Error('Falha simulada no parser');
          await new Promise((resolve) => setTimeout(resolve, 10));
          return NFeParserService.parse(xml);
        }
      },
      enriquecerParseComMiip: async (parsed) => ({
        parsed,
        miipImportacao: null,
        possuiPendencias: false,
        erroMiip: 'MIIP indisponível no teste'
      })
    });
    await documentosRepository.atualizar(documento.id, {
      status: STATUS_XML_COMPLETO_LEGADO,
      statusDetalhe: 'XML completo disponível'
    });
    const detalheAntesDoProcessamento = await service.obterDocumentoDetalhe(documento.id);
    assert.strictEqual(detalheAntesDoProcessamento.documento.statusLabel, 'XML completo');
    const scoreAntesDoProcessamento = await service.obterScoreDocumento(documento.id);
    assert.strictEqual(scoreAntesDoProcessamento.scoreGeral, 60);
    assert.strictEqual(scoreAntesDoProcessamento.detalhes.precisaoMiip, null);
    const falha = await processamentoSemMiip.processar(documento.id);
    assert.strictEqual(falha.sucesso, false);
    assert.match(falha.mensagem, /Falha simulada no parser/);

    const documentoComErro = await documentosRepository.buscarPorId(documento.id);
    assert.strictEqual(documentoComErro.status, DocumentoFiscalStatus.ERRO);
    assert.strictEqual(documentoComErro.statusDetalhe, 'Falha simulada no parser');
    assert.strictEqual(documentoComErro.parseJson, null);

    const concorrentes = await Promise.allSettled([
      processamentoSemMiip.processar(documento.id),
      processamentoSemMiip.processar(documento.id)
    ]);
    const resultadosConcluidos = concorrentes
      .filter((resultado) => resultado.status === 'fulfilled' && resultado.value.sucesso);
    assert.strictEqual(resultadosConcluidos.length, 1, 'somente uma execução concorrente deve concluir');
    assert.strictEqual(chamadasParser, 2, 'a nova tentativa deve executar o parser uma única vez');
    const resultado = resultadosConcluidos[0].value;

    assert.strictEqual(resultado.sucesso, true);
    assert.ok(resultado.parse);
    assert.ok(resultado.documento);
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.AGUARDANDO_REVISAO);
    assert.strictEqual(resultado.proximaAcao, 'revisar_produtos');

    const atualizado = await documentosRepository.buscarPorId(documento.id);
    assert.ok(atualizado.parseJson);
    assert.ok(atualizado.processadoEm);
    const parsePersistido = await service.obterParseDocumento(documento.id);
    assert.strictEqual(parsePersistido.parseDisponivel, true);
    assert.ok(Array.isArray(parsePersistido.parse.itens));
    assert.ok(parsePersistido.parse.itens.length > 0);
    await assert.rejects(
      () => processamentoSemMiip.processar(documento.id),
      (error) => error.statusCode === 409
    );
    assert.strictEqual(chamadasParser, 2, 'documento concluído não deve ser processado novamente');

    const statusValidos = [
      DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA
    ];
    assert.ok(statusValidos.includes(atualizado.status));
  });

  await test('obterPayloadCompra retorna formato parse-xml', async () => {
    const payload = await service.obterPayloadCompra(documento.id);
    assert.strictEqual(payload.sucesso, true);
    assert.ok(payload.dadosCompra);
    assert.ok(Array.isArray(payload.dadosCompra.itens));
    assert.strictEqual(payload.dadosCompra.chave_acesso, CHAVE_SPRINT5);
  });

  await test('revisão não libera item sem produto_id', async () => {
    const atual = await documentosRepository.buscarPorId(documento.id);
    const parseOriginal = atual.parseJson;
    await documentosRepository.atualizar(documento.id, {
      status: DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      parseJson: { ...parseOriginal, itens: [{ produto_nome: 'Produto sem vínculo' }] }
    });

    await assert.rejects(
      () => bridgeServiceEstrito.concluirRevisao(documento.id),
      (error) => error.statusCode === 409
        && error.codigo === 'VINCULO_PRODUTO_INVALIDO'
        && error.itens?.[0]?.motivo === 'PRODUTO_NAO_IDENTIFICADO'
    );
    const atualizado = await documentosRepository.buscarPorId(documento.id);
    assert.strictEqual(atualizado.status, DocumentoFiscalStatus.AGUARDANDO_REVISAO);
    await documentosRepository.atualizar(documento.id, { parseJson: parseOriginal });
  });

  await test('abertura em Compras retorna à revisão se um vínculo estiver ausente', async () => {
    const atual = await documentosRepository.buscarPorId(documento.id);
    const parseOriginal = atual.parseJson;
    await documentosRepository.atualizar(documento.id, {
      status: DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
      parseJson: { ...parseOriginal, itens: [{ produto_nome: 'Produto sem vínculo' }] }
    });

    await assert.rejects(
      () => bridgeServiceEstrito.registrarAberturaCompra(documento.id),
      (error) => error.statusCode === 409 && error.codigo === 'VINCULO_PRODUTO_INVALIDO'
    );
    const atualizado = await documentosRepository.buscarPorId(documento.id);
    assert.strictEqual(atualizado.status, DocumentoFiscalStatus.AGUARDANDO_REVISAO);
    await documentosRepository.atualizar(documento.id, {
      status: atual.status,
      parseJson: parseOriginal
    });
  });

  await test('concluirRevisao transiciona para PRONTA_PARA_COMPRA', async () => {
    const atual = await documentosRepository.buscarPorId(documento.id);

    if (atual.status === DocumentoFiscalStatus.AGUARDANDO_REVISAO) {
      const itens = atual.parseJson?.itens || [];
      const resultado = await bridgeService.concluirRevisao(documento.id, { itens });
      assert.strictEqual(resultado.sucesso, true);
      assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.PRONTA_PARA_COMPRA);
    } else {
      await service.alterarStatus(documento.id, DocumentoFiscalStatus.PRONTA_PARA_COMPRA, {
        detalhe: 'Teste sprint 5 — já pronto'
      });
    }
  });

  await test('vincularCompra marca documento como GRAVADA', async () => {
    const abertura = await bridgeService.registrarAberturaCompra(documento.id);
    assert.strictEqual(abertura.documento.status, DocumentoFiscalStatus.EM_COMPRA);
    assert.strictEqual(abertura.documento.compraId, null);

    const sql = documentosRepository._obterSql();
    let compraId;
    const compraExistente = await sql.get('SELECT id FROM compras ORDER BY id DESC LIMIT 1');
    if (compraExistente?.id) {
      compraId = compraExistente.id;
    } else {
      const insert = await sql.run(
        `INSERT INTO compras (data_compra, fornecedor, total, status, valor_total_nota)
         VALUES ('2026-07-05', 'Teste Sprint 5', 100, 'concluida', 100)`
      );
      compraId = insert.lastID;
    }

    const resultado = await bridgeService.vincularCompra(documento.id, compraId);

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.GRAVADA);
    assert.strictEqual(resultado.compraId, compraId);

    const atualizado = await documentosRepository.buscarPorId(documento.id);
    assert.strictEqual(atualizado.compraId, compraId);
  });

  await limparDocumentoTeste();

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
