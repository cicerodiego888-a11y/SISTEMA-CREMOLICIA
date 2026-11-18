/**
 * Compras — fechamento das pendências de vinculação:
 * produto inativo bloqueado em nova compra e produto_id validado na
 * conclusão da revisão da Central de Entradas.
 * Banco temporário. Não abre o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const {
  resolverProdutoItemCompra,
  validarProdutosVinculadosCompra,
  itemPodeEntrarEstoque,
  produtoPodeSerInsumoCompra,
  CODIGO_PRODUTO_NAO_CADASTRADO,
  MOTIVO_PRODUTO_NAO_IDENTIFICADO,
  MOTIVO_PRODUTO_INATIVO,
  MOTIVO_PRODUTO_INEXISTENTE,
  MOTIVO_PRODUTO_NAO_INSUMO,
  MENSAGEM_PRODUTO_INATIVO,
  CODIGO_VINCULO_INVALIDO,
  MENSAGEM_VINCULO_INVALIDO_REVISAO
} = require('../../backend/modules/compras/resolverProdutoItem');
const { confirmarProdutoItemCompra } = require('../../backend/modules/compras/confirmarProdutoItem');
const CentralComprasBridgeService = require('../../backend/motores/central-entradas/services/CentralComprasBridgeService');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

const raiz = path.join(__dirname, '../..');
const dir = path.join(os.tmpdir(), 'cds-compras-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'fechamento-pendencias-vinculo.db');
const arquivoLegado = path.join(dir, 'fechamento-pendencias-legado.db');
for (const base of [arquivo, arquivoLegado]) {
  for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(base + sufixo, { force: true });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function ler(relativo) {
  return fs.readFileSync(path.join(raiz, relativo), 'utf8');
}

function respostaMiipAuto(produtoId) {
  const melhor = { produtoId, produto: { nome: `Produto ${produtoId}` } };
  return {
    encontrado: true,
    produtoId,
    resultado: { candidatos: [melhor], decisao: { acao: 'auto_vincular', melhorCandidato: melhor } }
  };
}

function documentosFalsos(itens) {
  const documento = {
    id: 50,
    chave: '35260112345678000199550010000000011000000050',
    status: DocumentoFiscalStatus.AGUARDANDO_REVISAO,
    parseJson: { itens }
  };
  const atualizacoes = [];
  return {
    documento,
    atualizacoes,
    buscarPorId: async () => ({ ...documento }),
    atualizar: async (id, dados) => {
      atualizacoes.push(dados);
      if (dados.status) documento.status = dados.status;
      if (dados.parseJson) documento.parseJson = dados.parseJson;
    }
  };
}

describe('Compras — produto inativo e revisão da Central', () => {
  let db;
  let dbLegado;

  before(async () => {
    db = new sqlite3.Database(arquivo);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, codigo TEXT, codigo_barras TEXT, nome TEXT,
        unidade TEXT, natureza_cadastro TEXT, ativo INTEGER DEFAULT 1
      )
    `);
    await run(db, "INSERT INTO produtos VALUES (1, 'LEI', '7891000000001', 'Leite Integral', 'L', 'INSUMO', 1)");
    await run(db, "INSERT INTO produtos VALUES (2, 'ANT', '7891000000002', 'Leite Antigo', 'L', 'INSUMO', 0)");
    await run(db, "INSERT INTO produtos VALUES (3, 'ACU', '7891000000003', 'Açúcar', 'KG', 'INSUMO', NULL)");
    await run(db, "INSERT INTO produtos VALUES (4, 'CHO', '7891000000004', 'Chocolate produzido', 'KG', 'PRODUZIDO', 1)");
    await run(db, "INSERT INTO produtos VALUES (5, 'COM', '7891000000005', 'Produto comercial', 'UN', 'COMERCIAL', 1)");
    await run(db, "INSERT INTO produtos VALUES (6, 'SEM', '7891000000006', 'Sem natureza', 'UN', NULL, 1)");

    dbLegado = new sqlite3.Database(arquivoLegado);
    await run(dbLegado, 'CREATE TABLE produtos (id INTEGER PRIMARY KEY, codigo TEXT, codigo_barras TEXT, nome TEXT, unidade TEXT)');
    await run(dbLegado, "INSERT INTO produtos VALUES (1, 'X', NULL, 'Produto sem coluna ativo', 'UN')");
  });

  after(() => {
    if (db) db.close();
    if (dbLegado) dbLegado.close();
  });

  it('1. produto ativo continua VINCULADO', async () => {
    const resultado = await resolverProdutoItemCompra(db, { produto_id: 1 });
    assert.equal(resultado.situacao, 'VINCULADO');
    assert.equal(itemPodeEntrarEstoque(resultado), true);
  });

  it('2. produto inativo é recusado em nova compra e não entra no estoque', async () => {
    const resultado = await resolverProdutoItemCompra(db, { produto_id: 2, produto_nome: 'LEITE' });
    assert.equal(resultado.situacao, CODIGO_PRODUTO_NAO_CADASTRADO);
    assert.equal(resultado.motivo, MOTIVO_PRODUTO_INATIVO);
    assert.equal(resultado.mensagem, MENSAGEM_PRODUTO_INATIVO);
    assert.equal(resultado.produtoId, null);
    assert.equal(itemPodeEntrarEstoque(resultado), false);
  });

  it('3. ativo NULL conta como ativo; base sem coluna ativo continua funcionando', async () => {
    assert.equal((await resolverProdutoItemCompra(db, { produto_id: 3 })).situacao, 'VINCULADO');
    assert.equal((await resolverProdutoItemCompra(dbLegado, { produto_id: 1 })).situacao, 'VINCULADO');
  });

  it('3a. compra aceita somente INSUMO ativo, rejeitando PRODUZIDO, COMERCIAL e natureza vazia', async () => {
    for (const produtoId of [1, 3]) {
      assert.equal(produtoPodeSerInsumoCompra(await resolverProdutoItemCompra(db, { produto_id: produtoId })), true);
    }
    for (const produtoId of [2, 4, 5, 6]) {
      assert.equal(produtoPodeSerInsumoCompra(await resolverProdutoItemCompra(db, { produto_id: produtoId })), false);
    }
    assert.equal(produtoPodeSerInsumoCompra(await resolverProdutoItemCompra(dbLegado, { produto_id: 1 })), false);
  });

  it('4. vínculo automático do MIIP para produto inativo também é recusado', async () => {
    const miip = { estaHabilitado: () => true, identificar: async () => respostaMiipAuto(2) };
    const resultado = await confirmarProdutoItemCompra(db, { produto_nome: 'LEITE', codigo_barras: '7891000000002' }, { miip });
    assert.equal(resultado.motivo, MOTIVO_PRODUTO_INATIVO);
    assert.equal(itemPodeEntrarEstoque(resultado), false);
  });

  it('5. validação lista inativo e inexistente, e ignora item ainda sem vínculo', async () => {
    const problemas = await validarProdutosVinculadosCompra(db, [
      { produto_id: 1, produto_nome: 'Leite Integral' },
      { produto_id: 2, produto_nome: 'Leite Antigo' },
      { produto_id: 999, produto_nome: 'Fantasma' },
      { produto_id: '', produto_nome: 'Pendente' },
      { produto_nome: 'Ignorado' }
    ]);
    assert.deepEqual(
      problemas.map((p) => [p.indice, p.motivo]),
      [[1, MOTIVO_PRODUTO_INATIVO], [2, MOTIVO_PRODUTO_INEXISTENTE]]
    );
  });

  it('6. revisão da Central com produto inativo é recusada sem gravar nem mudar status', async () => {
    const itens = [{ produto_id: 1, produto_nome: 'Leite Integral' }, { produto_id: 2, produto_nome: 'Leite Antigo' }];
    const documentos = documentosFalsos([]);
    const historico = [];
    const bridge = new CentralComprasBridgeService({
      documentosRepository: documentos,
      historicoService: { registrar: async (dados) => historico.push(dados) },
      db
    });
    await assert.rejects(
      () => bridge.concluirRevisao(50, { itens }),
      (erro) => {
        assert.equal(erro.statusCode, 409);
        assert.equal(erro.codigo, CODIGO_VINCULO_INVALIDO);
        assert.equal(erro.message, MENSAGEM_VINCULO_INVALIDO_REVISAO);
        assert.deepEqual(erro.itens.map((i) => [i.indice, i.motivo]), [[1, MOTIVO_PRODUTO_INATIVO]]);
        return true;
      }
    );
    assert.equal(documentos.atualizacoes.length, 0);
    assert.equal(historico.length, 0);
    assert.equal(documentos.documento.status, DocumentoFiscalStatus.AGUARDANDO_REVISAO);
  });

  it('7. revisão com produto_id inexistente também é recusada', async () => {
    const documentos = documentosFalsos([]);
    const bridge = new CentralComprasBridgeService({
      documentosRepository: documentos,
      historicoService: { registrar: async () => {} },
      db
    });
    await assert.rejects(() => bridge.concluirRevisao(50, { itens: [{ produto_id: 999 }] }), { statusCode: 409 });
    assert.equal(documentos.atualizacoes.length, 0);
  });

  it('8. revisão com item ainda sem vínculo permanece em AGUARDANDO_REVISAO', async () => {
    const itens = [{ produto_id: 1, produto_nome: 'Leite Integral' }, { produto_id: '', produto_nome: 'Ignorado na revisão' }];
    const documentos = documentosFalsos([]);
    const bridge = new CentralComprasBridgeService({
      documentosRepository: documentos,
      historicoService: { registrar: async () => {} },
      db
    });
    await assert.rejects(
      () => bridge.concluirRevisao(50, { itens }),
      (erro) => {
        assert.equal(erro.statusCode, 409);
        assert.equal(erro.codigo, CODIGO_VINCULO_INVALIDO);
        assert.deepEqual(erro.itens.map((item) => [item.indice, item.motivo]), [
          [1, MOTIVO_PRODUTO_NAO_IDENTIFICADO]
        ]);
        return true;
      }
    );
    assert.equal(documentos.atualizacoes.length, 0);
    assert.equal(documentos.documento.status, DocumentoFiscalStatus.AGUARDANDO_REVISAO);
  });

  it('8a. revisão com todos os itens vinculados a produtos ativos libera a compra', async () => {
    const itens = [{ produto_id: 1, produto_nome: 'Leite Integral' }];
    const documentos = documentosFalsos([]);
    const bridge = new CentralComprasBridgeService({
      documentosRepository: documentos,
      historicoService: { registrar: async () => {} },
      db
    });
    const resultado = await bridge.concluirRevisao(50, { itens });
    assert.equal(resultado.sucesso, true);
    assert.equal(documentos.documento.status, DocumentoFiscalStatus.PRONTA_PARA_COMPRA);
    assert.deepEqual(documentos.documento.parseJson.itens, itens);
    const abertura = await bridge.registrarAberturaCompra(50);
    assert.equal(abertura.documento.status, DocumentoFiscalStatus.EM_COMPRA);
    assert.equal(abertura.documento.compraVinculada, false);
  });

  it('8b. revisão recusa produto ativo que não pode entrar em Compras', async () => {
    const documentos = documentosFalsos([]);
    const bridge = new CentralComprasBridgeService({
      documentosRepository: documentos,
      historicoService: { registrar: async () => {} },
      db
    });
    await assert.rejects(
      () => bridge.concluirRevisao(50, { itens: [{ produto_id: 4, produto_nome: 'Chocolate produzido' }] }),
      (erro) => erro.statusCode === 409
        && erro.itens?.[0]?.motivo === MOTIVO_PRODUTO_NAO_INSUMO
    );
    assert.equal(documentos.documento.status, DocumentoFiscalStatus.AGUARDANDO_REVISAO);
  });

  it('9. sem itens no corpo, valida os itens já gravados no parse', async () => {
    const documentos = documentosFalsos([{ produto_id: 2, produto_nome: 'Leite Antigo' }]);
    const bridge = new CentralComprasBridgeService({
      documentosRepository: documentos,
      historicoService: { registrar: async () => {} },
      db
    });
    await assert.rejects(() => bridge.concluirRevisao(50, {}), { codigo: CODIGO_VINCULO_INVALIDO });
  });

  it('10. rotas devolvem o motivo: compra com PRODUTO_INATIVO e revisão com codigo/itens', () => {
    const compras = ler('backend/rotas/compras.js');
    const responder = compras.slice(compras.indexOf('function responderProdutoNaoCadastrado'), compras.indexOf("router.post('/:id/cancelar'"));
    assert.match(responder, /MOTIVO_PRODUTO_INATIVO/);
    assert.match(responder, /MENSAGEM_PRODUTO_INATIVO/);
    const central = ler('backend/rotas/central-entradas.js');
    const concluir = central.slice(central.indexOf("router.post('/:id/revisar/concluir'"), central.indexOf("router.get('/:id/payload-compra'"));
    assert.match(concluir, /codigo: error\.codigo, itens: error\.itens/);
    const servico = ler('backend/motores/central-entradas/CentralEntradasService.js');
    assert.match(servico, /new CentralComprasBridgeService\(\{ documentosRepository, historicoRepository, db: this\._db \}\)/);
  });

  it('11. tela de Compras: inativo fora da lista e vínculo inativo recusado', () => {
    const tela = ler('frontend/erp/js/compras.js');
    const trecho = tela.slice(tela.indexOf('function produtoAtivoCompra'), tela.indexOf('function renderCompras'));
    const ctx = {
      centralDocumentoIdAtual: null,
      produtosInativosCompraIds: new Set(['2']),
      produtosCompraList: [
        { id: 1, ativo: 1, natureza_cadastro: 'INSUMO' },
        { id: 2, ativo: 0, natureza_cadastro: 'INSUMO' },
        { id: 3, ativo: 1, natureza_cadastro: 'PRODUZIDO' },
        { id: 4, ativo: 1, natureza_cadastro: null }
      ]
    };
    vm.createContext(ctx);
    vm.runInContext(trecho, ctx);
    assert.equal(ctx.produtoAtivoCompra({ ativo: 1 }), true);
    assert.equal(ctx.produtoAtivoCompra({ ativo: null }), true);
    assert.equal(ctx.produtoAtivoCompra({ ativo: 0 }), false);
    assert.equal(ctx.produtoAtivoCompra({ ativo: false }), false);
    assert.deepEqual(
      Array.from(ctx.produtosDisponiveisCompraManual(), (produto) => produto.id),
      [1]
    );
    assert.deepEqual(
      Array.from(ctx.filtrarResultadosBuscaCompra([{ id: 1 }, { id: 2 }, { id: 3 }]), (produto) => produto.id),
      [1]
    );
    assert.deepEqual(
      Array.from(ctx.produtosPermitidosSelecaoCompra([
        { id: 1, natureza_cadastro: 'INSUMO' },
        { id: 3, natureza_cadastro: 'PRODUZIDO' }
      ]), (produto) => produto.id),
      [1]
    );
    ctx.centralDocumentoIdAtual = 50;
    assert.deepEqual(
      Array.from(ctx.filtrarResultadosBuscaCompra([{ id: 1 }, { id: 2 }]), (produto) => produto.id),
      [1, 2]
    );
    ctx.centralDocumentoIdAtual = null;
    const item = { produto_id: 2 };
    assert.equal(ctx.recusarVinculoInativoItemCompra(item), true);
    assert.deepEqual({ ...item }, { produto_id: '', produto_inativo_id: 2 });
    const ativo = { produto_id: 1 };
    assert.equal(ctx.recusarVinculoInativoItemCompra(ativo), false);
    assert.equal(ativo.produto_id, 1);

    assert.match(tela, /produtosCompraList = produtos\.filter\(produtoAtivoCompra\)/);
    assert.match(tela, /produtosParaSelecionar\.map\(p => `<option value="\$\{escapeHtml\(rotuloProdutoCompra\(p\)\)\}"><\/option>`\)/);
    assert.match(tela, /Nenhum insumo encontrado\./);
    ctx.produtosCompraList = [
      { id: 1, codigo: 'INS-1', codigo_barras: '7891000000001', nome: 'Insumo ativo', natureza_cadastro: 'INSUMO', ativo: 1 },
      { id: 2, codigo: 'PRO-1', codigo_barras: '7891000000002', nome: 'Produto fabricado', natureza_cadastro: 'PRODUZIDO', ativo: 1 },
      { id: 3, codigo: 'INS-2', codigo_barras: '7891000000003', nome: 'Insumo inativo', natureza_cadastro: 'INSUMO', ativo: 0 }
    ];
    const busca = tela.slice(tela.indexOf('function rotuloProdutoCompra'), tela.indexOf('function showCompraModal'));
    vm.runInContext(busca, ctx);
    assert.equal(ctx.findProdutoByInput('INS-1').id, 1);
    assert.equal(ctx.findProdutoByInput('7891000000001').id, 1);
    assert.equal(ctx.findProdutoByInput('PRO-1'), null);
    assert.equal(ctx.findProdutoByInput('7891000000002'), null);
    assert.equal(ctx.findProdutoByInput('INS-2'), null);
    assert.equal(ctx.findProdutoByInput('7891000000003'), null);

    const alterar = tela.slice(tela.indexOf('function alterarProdutoItemCompra'), tela.indexOf('function adicionarItemCompra'));
    assert.ok(alterar.indexOf('produtoInativoCompra(produtoId)') < alterar.indexOf('.produto_id = produtoId'));
    assert.match(tela, /itensCompraAtual\.forEach\(recusarVinculoInativoItemCompra\)/);
    assert.match(tela, /\['PRODUTO_NAO_CADASTRADO', 'PRODUTO_INATIVO'\]\.includes\(corpo\.codigo\)/);
  });

  it('11a. endpoint de compra valida natureza antes de abrir a transação', () => {
    const compras = ler('backend/rotas/compras.js');
    const ensure = compras.slice(
      compras.indexOf('function ensureProductForItem'),
      compras.indexOf('function resolverItensAntesDeGravar')
    );
    assert.match(ensure, /produtoPodeSerInsumoCompra\(resultado\)/);
    assert.match(ensure, /MOTIVO_PRODUTO_NAO_INSUMO/);
    const resolver = compras.indexOf('resolverItensAntesDeGravar(itensComRateio)');
    const gravar = compras.indexOf("db.run('BEGIN IMMEDIATE')", resolver);
    assert.ok(resolver >= 0);
    assert.ok(gravar > resolver);
    assert.match(compras.slice(resolver, gravar), /status\(status\)\.json/);
    const produtoResolver = ler('backend/modules/compras/resolverProdutoItem.js');
    assert.match(produtoResolver, /Somente produtos ativos classificados como INSUMO podem ser incluídos em uma compra\./);
  });

  it('12. Central: lista da revisão sem inativos e erro mostra os itens recusados', () => {
    const central = ler('frontend/erp/js/central-entradas.js');
    const trecho = central.slice(central.indexOf('function mensagemVinculoInvalidoCentral'), central.indexOf('async function abrirCentralRevisaoMiip'));
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(trecho, ctx);
    const erro = Object.assign(new Error(MENSAGEM_VINCULO_INVALIDO_REVISAO), {
      codigo: CODIGO_VINCULO_INVALIDO,
      itens: [
        { indice: 1, produto_nome: 'Leite Antigo', motivo: MOTIVO_PRODUTO_INATIVO },
        { indice: 2, produto_nome: null, motivo: MOTIVO_PRODUTO_INEXISTENTE }
      ]
    });
    assert.equal(
      ctx.mensagemVinculoInvalidoCentral(erro),
      `${MENSAGEM_VINCULO_INVALIDO_REVISAO} Itens: Leite Antigo (produto inativo); Item 3 (produto não encontrado).`
    );
    assert.equal(ctx.mensagemVinculoInvalidoCentral(new Error('Outro erro')), 'Outro erro');
    const carregar = central.slice(central.indexOf('async function carregarProdutosParaRevisaoCentral'), central.indexOf('function mensagemVinculoInvalidoCentral'));
    assert.match(carregar, /p\.ativo === 0/);
    assert.match(central, /erro\.codigo = data\.codigo;/);
  });

  it('13. o teste não carregou o banco oficial (backend/database.js)', () => {
    const banco = path.join(raiz, 'backend', 'database.js').toLowerCase();
    assert.equal(Object.keys(require.cache).some((k) => k.toLowerCase() === banco), false);
  });
});
