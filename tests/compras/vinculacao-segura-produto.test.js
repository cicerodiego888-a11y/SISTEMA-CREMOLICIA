/**
 * Compras — vinculação obrigatória e segura do produto.
 * DIGITAÇÃO É PESQUISA. SELEÇÃO É VÍNCULO.
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
  sugerirProdutosItemCompra,
  itemPodeEntrarEstoque,
  CODIGO_PRODUTO_NAO_CADASTRADO,
  MOTIVO_PRODUTO_INEXISTENTE
} = require('../../backend/modules/compras/resolverProdutoItem');
const {
  confirmarProdutoItemCompra,
  produtoIdConfiavelMiip
} = require('../../backend/modules/compras/confirmarProdutoItem');

const raiz = path.join(__dirname, '../..');
const dir = path.join(os.tmpdir(), 'cds-compras-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'vinculacao-segura-produto.db');
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(arquivo + sufixo, { force: true });
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

function miipFalso({ habilitado = true, resposta = null, erro = null } = {}) {
  const chamadas = [];
  return {
    chamadas,
    estaHabilitado: () => habilitado,
    registrarIntegracao: () => {},
    identificar: async (item) => {
      chamadas.push(item);
      if (erro) throw erro;
      return resposta;
    }
  };
}

function respostaMiip(acao, produtoId) {
  const melhor = { produtoId, produto: { nome: `Produto ${produtoId}` } };
  return {
    encontrado: true,
    produtoId,
    resultado: { candidatos: [melhor], decisao: { acao, melhorCandidato: melhor } }
  };
}

describe('Compras — vinculação segura do produto', () => {
  let db;

  before(async () => {
    db = new sqlite3.Database(arquivo);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        codigo_barras TEXT,
        nome TEXT,
        unidade TEXT,
        natureza_cadastro TEXT,
        ativo INTEGER DEFAULT 1
      )
    `);
    const produtos = [
      [1, 'LEI', '7891000000001', 'Leite Integral', 'L', 'INSUMO', 1],
      [2, 'LEI-D', '7891000000009', 'Leite Desnatado', 'L', 'INSUMO', 1],
      [3, 'ACU', '7891000000003', 'Açúcar Cristal', 'KG', 'INSUMO', 1],
      [4, 'COPO-A', '7890000000010', 'Copo 300ml', 'UN', 'COMERCIAL', 1],
      [5, 'COPO-B', '7890000000027', 'Copo 300ml', 'UN', 'COMERCIAL', 1],
      [6, 'ANT', '7891000000006', 'Leite Antigo', 'L', 'INSUMO', 0]
    ];
    for (const p of produtos) {
      await run(db, 'INSERT INTO produtos (id, codigo, codigo_barras, nome, unidade, natureza_cadastro, ativo) VALUES (?, ?, ?, ?, ?, ?, ?)', p);
    }
  });

  after(() => {
    if (db) db.close();
  });

  it('1. produto escolhido pelo usuário (produto_id existente) fica VINCULADO', async () => {
    const resultado = await resolverProdutoItemCompra(db, { produto_id: 3, produto_nome: 'ACUCAR CRISTAL 5KG' });
    assert.equal(resultado.situacao, 'VINCULADO');
    assert.equal(resultado.produtoId, 3);
    assert.equal(itemPodeEntrarEstoque(resultado), true);
  });

  it('2. nome exato não cria vínculo: item fica pendente com sugestão', async () => {
    const resultado = await resolverProdutoItemCompra(db, { produto_nome: 'Leite Integral', quantidade: 10 });
    assert.equal(resultado.situacao, CODIGO_PRODUTO_NAO_CADASTRADO);
    assert.equal(resultado.produtoId, null);
    assert.equal(itemPodeEntrarEstoque(resultado), false);
    assert.equal(resultado.sugestoes[0].id, 1);
    assert.equal(resultado.sugestoes[0].motivo, 'NOME');
  });

  it('3. nome parecido sugere os candidatos, sem escolher o primeiro', async () => {
    const resultado = await resolverProdutoItemCompra(db, { produto_nome: 'LEITE UHT INTEGRAL 1L' });
    assert.equal(resultado.produtoId, null);
    const ids = resultado.sugestoes.map((s) => s.id);
    assert.equal(ids[0], 1);
    assert.ok(ids.includes(2));
  });

  it('4. nomes duplicados: as duas opções aparecem e nenhuma é vinculada', async () => {
    const resultado = await resolverProdutoItemCompra(db, { produto_nome: 'Copo 300ml' });
    assert.equal(resultado.produtoId, null);
    assert.deepEqual(resultado.sugestoes.map((s) => s.id).sort(), [4, 5]);
  });

  it('5. código de barras e código ficam no topo das sugestões, mas sem vínculo', async () => {
    const porBarras = await resolverProdutoItemCompra(db, { produto_nome: 'Item qualquer', codigo_barras: '7890000000027' });
    assert.equal(porBarras.produtoId, null);
    assert.deepEqual([porBarras.sugestoes[0].id, porBarras.sugestoes[0].motivo], [5, 'CODIGO_BARRAS']);
    const porCodigo = await resolverProdutoItemCompra(db, { produto_nome: 'Item qualquer', codigo: 'ACU' });
    assert.deepEqual([porCodigo.sugestoes[0].id, porCodigo.sugestoes[0].motivo], [3, 'CODIGO']);
  });

  it('6. "SEM GTIN" não é tratado como código de barras', async () => {
    const sugestoes = await sugerirProdutosItemCompra(db, { produto_nome: 'Produto X', codigo_barras: 'SEM GTIN' });
    assert.equal(sugestoes.some((s) => s.motivo === 'CODIGO_BARRAS'), false);
  });

  it('7. produto inativo não aparece nas sugestões', async () => {
    const sugestoes = await sugerirProdutosItemCompra(db, { produto_nome: 'Leite Antigo', codigo_barras: '7891000000006' });
    assert.equal(sugestoes.some((s) => s.id === 6), false);
  });

  it('8. produto_id inexistente não entra no estoque', async () => {
    const resultado = await resolverProdutoItemCompra(db, { produto_id: 999, produto_nome: 'Leite Integral' });
    assert.equal(resultado.situacao, CODIGO_PRODUTO_NAO_CADASTRADO);
    assert.equal(resultado.motivo, MOTIVO_PRODUTO_INEXISTENTE);
    assert.equal(itemPodeEntrarEstoque(resultado), false);
  });

  it('9. MIIP com vínculo automático confiável (GTIN/associação) vincula', async () => {
    const miip = miipFalso({ resposta: respostaMiip('auto_vincular', 1) });
    const resultado = await confirmarProdutoItemCompra(db, { produto_nome: 'LEITE', codigo_barras: '7891000000001' }, { miip });
    assert.equal(resultado.situacao, 'VINCULADO');
    assert.equal(resultado.produtoId, 1);
    assert.equal(produtoIdConfiavelMiip(respostaMiip('auto_vincular', 1)), 1);
  });

  it('10. sugestão do MIIP (não automática) não vincula', async () => {
    for (const acao of ['sugerir', 'revisar_manual', 'criar_novo']) {
      const miip = miipFalso({ resposta: respostaMiip(acao, 2) });
      const resultado = await confirmarProdutoItemCompra(db, { produto_nome: 'LEITE DESNATADO' }, { miip });
      assert.equal(resultado.produtoId, null, acao);
      assert.equal(itemPodeEntrarEstoque(resultado), false, acao);
    }
  });

  it('11. erro ou MIIP desligado deixa o item pendente (sem fallback por nome)', async () => {
    const comErro = await confirmarProdutoItemCompra(db, { produto_nome: 'Leite Integral' }, {
      miip: miipFalso({ erro: new Error('falha') })
    });
    assert.equal(comErro.produtoId, null);
    const desligado = await confirmarProdutoItemCompra(db, { produto_nome: 'Leite Integral' }, {
      miip: miipFalso({ habilitado: false })
    });
    assert.equal(desligado.produtoId, null);
    const semMiip = await confirmarProdutoItemCompra(db, { produto_nome: 'Leite Integral' });
    assert.equal(semMiip.produtoId, null);
  });

  it('12. MIIP automático para produto inexistente não vincula', async () => {
    const miip = miipFalso({ resposta: respostaMiip('auto_vincular', 777) });
    const resultado = await confirmarProdutoItemCompra(db, { produto_nome: 'X' }, { miip });
    assert.equal(itemPodeEntrarEstoque(resultado), false);
  });

  it('13. produto_id informado é respeitado e o MIIP não troca a escolha', async () => {
    const miip = miipFalso({ resposta: respostaMiip('auto_vincular', 1) });
    const resultado = await confirmarProdutoItemCompra(db, { produto_id: 2, produto_nome: 'Leite' }, { miip });
    assert.equal(resultado.produtoId, 2);
    assert.equal(miip.chamadas.length, 0);
  });

  it('14. o resolvedor não grava nada no cadastro', () => {
    const fonte = ler('backend/modules/compras/resolverProdutoItem.js');
    assert.equal(/INSERT|UPDATE|DELETE/.test(fonte), false);
    assert.equal(/nome\s*=\s*\?/.test(fonte), false);
    assert.equal(fonte.includes('slugCodigoProduto'), false);
  });

  it('15. a rota de compra não tem mais fallback legado por nome', () => {
    const rota = ler('backend/rotas/compras.js');
    assert.equal(rota.includes('ensureProductForItemLegado'), false);
    assert.match(rota, /confirmarProdutoItemCompra\(db, item/);
    const processar = rota.slice(rota.indexOf('function processarItensCompra'), rota.indexOf('function garantirTabelaDevolucoesCompra'));
    assert.ok(processar.indexOf('if (prodErr) return done(prodErr);') < processar.indexOf('MotorEstoque.entrar(db,'));
    assert.match(processar, /CASE WHEN COALESCE\(TRIM\(codigo_barras\), ''\) = '' THEN/);
  });

  it('16. tela: busca rápida não seleciona pelo nome digitado', () => {
    const tela = ler('frontend/erp/js/compras.js');
    const trecho = tela.slice(tela.indexOf('function rotuloProdutoCompra'), tela.indexOf('function showCompraModal'));
    const produtosCompraList = [
      { id: 1, codigo: 'LEI', codigo_barras: '7891000000001', nome: 'Leite Integral', natureza_cadastro: 'INSUMO', ativo: 1 },
      { id: 4, codigo: '', codigo_barras: '', nome: 'Copo 300ml', natureza_cadastro: 'INSUMO', ativo: 1 },
      { id: 5, codigo: '', codigo_barras: '', nome: 'Copo 300ml', natureza_cadastro: 'INSUMO', ativo: 1 },
      { id: 7, codigo: '', codigo_barras: '', nome: 'Palito', natureza_cadastro: 'INSUMO', ativo: 1 }
    ];
    const ctx = {
      produtosCompraList,
      centralDocumentoIdAtual: null,
      produtosDisponiveisCompraManual: () => produtosCompraList.filter((produto) => (
        !(produto.ativo === 0 || produto.ativo === '0' || produto.ativo === false)
        && String(produto.natureza_cadastro || '').trim().toUpperCase() === 'INSUMO'
      )),
      produtosPermitidosSelecaoCompra: (produtos) => produtos.filter((produto) => (
        !(produto.ativo === 0 || produto.ativo === '0' || produto.ativo === false)
        && String(produto.natureza_cadastro || '').trim().toUpperCase() === 'INSUMO'
      ))
    };
    vm.createContext(ctx);
    vm.runInContext(trecho, ctx);
    assert.equal(ctx.findProdutoByInput('Leite Integral'), null);
    assert.equal(ctx.findProdutoByInput('leite integral'), null);
    assert.equal(ctx.findProdutoByInput('7891000000001').id, 1);
    assert.equal(ctx.findProdutoByInput('LEI').id, 1);
    assert.equal(ctx.findProdutoByInput('7891000000001 - Leite Integral').id, 1);
    assert.equal(ctx.findProdutoByInput('- Palito').id, 7);
    assert.equal(ctx.findProdutoByInput('- Copo 300ml'), null);
    assert.equal(ctx.findProdutoByInput(''), null);
  });

  it('17. tela: sugestões exigem clique e nunca gravam produto_id sozinhas', () => {
    const tela = ler('frontend/erp/js/compras.js');
    const busca = tela.slice(
      tela.indexOf('function buscarSugestoesProdutosItensCompra'),
      tela.indexOf('function alterarCampoItemCompra')
    );
    assert.ok(busca.length > 0);
    assert.equal(busca.includes('produto_id ='), false);
    assert.match(busca, /sugestoes_produto = sugestoes/);
    assert.match(tela, /Vincular este produto/);
    assert.match(tela, /function confirmarSugestaoProdutoItemCompra/);
    assert.equal(tela.includes('resolverProdutosItensCompra'), false);
    assert.equal(tela.includes('produtosCompraList[produtosCompraList.length - 1]'), false);
    assert.match(tela, /itensCompraAtual\.some\(\(item\) => !item\.produto_id\)/);
  });

  it('18. Central de Entradas: "Cadastrar Novo" abre Insumos e mantém pendente o vínculo MIIP', () => {
    const central = ler('frontend/erp/js/central-entradas.js');
    const trecho = central.slice(central.indexOf('abrirCadastroProduto: function'), central.indexOf('onConcluir:'));
    const atualizar = central.slice(central.indexOf('atualizarCandidato: function'), central.indexOf('abrirCadastroProduto: function'));
    assert.match(trecho, /loadPage\('insumos'\)/);
    assert.match(trecho, /window\.abrirCadastroInsumoMiip\(item, function \(produto\)/);
    assert.match(trecho, /loadPage\('central-entradas'\)/);
    assert.match(trecho, /bootstrap\.Modal\.getOrCreateInstance\(modalEl\)\.show\(\)/);
    assert.match(atualizar, /url: `\$\{API_URL\}\/miip\/identificar-lote`/);
    assert.match(atualizar, /itens: \[itemIdentificavel\]/);

    const insumos = ler('frontend/erp/js/insumos.js');
    assert.match(insumos, /nome: item && item\.produto_nome \|\| ''/);
    assert.match(insumos, /unidade: item && item\.unidade \|\| ''/);
    assert.match(insumos, /natureza_cadastro: 'INSUMO'/);

    const revisao = ler('frontend/erp/js/miip-central-revisao.js');
    const cadastro = revisao.slice(revisao.indexOf('function cadastrarNovo'), revisao.indexOf('function concluirRevisao'));
    assert.match(revisao, /if \(event\.key === 'F3'\)[\s\S]*?cadastrarNovo\(\)/);
    assert.match(revisao, /#miipCentralBtnCadastrar'\)\.on\('click', cadastrarNovo\)/);
    assert.match(cadastro, /produtos\.push\(produto\)/);
    assert.match(cadastro, /aplicarConfirmacao\(pendencia, produto\.id, pendencia\.produtoEncontrado\)/);
    assert.match(cadastro, /if \(!pendenciaAberta\(sessao, pendencia\)\) return/);

    const busca = revisao.slice(revisao.indexOf('function abrirBuscaProduto'), revisao.indexOf('function cadastrarNovo'));
    assert.match(busca, /const produtos = estado\.opcoes\.produtos \|\| \[\]/);
    assert.match(busca, /String\(p\.codigo \|\| ''\)/);

    const insumoMiip = insumos.slice(insumos.indexOf('window.abrirCadastroInsumoMiip'), insumos.indexOf('function insSalvar(aoSalvar)'));
    assert.match(insumoMiip, /insAbrirEditor\(/);
    assert.doesNotMatch(insumoMiip, /insSalvar/);
    assert.match(insumos, /modalEl\.addEventListener\('hidden\.bs\.modal', \(\) => aoFechar\(produtoSalvo\)\)/);
  });
});
