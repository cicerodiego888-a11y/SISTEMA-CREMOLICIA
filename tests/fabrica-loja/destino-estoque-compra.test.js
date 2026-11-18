/**
 * Destino do estoque por item da compra. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const ConversaoComercialService = require('../../backend/motores/motor-conversao-comercial/services/ConversaoComercialService');
const {
  sugerirDestinoEstoque,
  resolverDestinoItemCompra,
  vincularUnidadeDestino,
  interpretarLocalHistorico,
  MENSAGEM_SEM_DESTINO
} = require('../../backend/modules/compras/destinoEstoqueItem');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'destino-estoque-compra.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() { return new sqlite3.Database(arquivo); }
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

const unidades = [
  { id: 1, codigo: 'LOJA', tipo: 'LOJA' },
  { id: 2, codigo: 'FABRICA', tipo: 'FABRICA' }
];

async function entrar(db, produtoId, quantidade, destino) {
  const destinoResolvido = vincularUnidadeDestino(resolverDestinoItemCompra({ destino_estoque: destino }), unidades);
  await MotorEstoque.entrar(db, {
    produtoId,
    quantidadeBase: quantidade,
    quantidadeFiscal: quantidade,
    origem: 'COMPRA',
    local: destinoResolvido.local,
    referenciaTipo: 'compra',
    referenciaId: 1
  });
  return destinoResolvido;
}

describe('Destino do estoque na compra', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT,
        estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT
      )
    `);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (1, 'Leite', 'L', 'INSUMO')`);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (2, 'Chocolate', 'KG', 'INSUMO')`);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (3, 'Copo', 'UN', 'COMERCIAL')`);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (4, 'Picolé', 'UN', 'PRODUZIDO')`);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (5, 'Leite ML', 'ML', 'INSUMO')`);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (6, 'Leite Fiscal/Não Fiscal', 'L', 'INSUMO')`);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (7, 'Chocolate Fiscal/Não Fiscal', 'L', 'COMERCIAL')`);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (8, 'Entrada sem local', 'UN', 'COMERCIAL')`);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  });

  after(() => db.close());

  it('1 a 4: insumo e produto podem ir para fábrica ou loja', async () => {
    assert.equal(sugerirDestinoEstoque('INSUMO'), 'FABRICA');
    assert.equal(sugerirDestinoEstoque('PRODUZIDO'), 'LOJA');
    assert.equal(sugerirDestinoEstoque('COMERCIAL'), 'LOJA');

    const leiteFabrica = await entrar(db, 1, 100, 'FABRICA');
    assert.equal(leiteFabrica.local, 'FABRICA');
    assert.equal(leiteFabrica.local_id, 2);
    const copoLoja = await entrar(db, 3, 500, 'LOJA');
    assert.equal(copoLoja.local_id, 1);
    await entrar(db, 4, 10, 'FABRICA');
    await entrar(db, 2, 5, 'LOJA');

    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA')).estoqueAtual, 100);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA')).estoqueAtual, 0);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 3, 'LOJA')).estoqueAtual, 500);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 3, 'FABRICA')).estoqueAtual, 0);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 4, 'FABRICA')).estoqueAtual, 10);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 2, 'LOJA')).estoqueAtual, 5);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 2, 'FABRICA')).estoqueAtual, 0);
  });

  it('5 e 6: uma mesma compra aceita destinos diferentes, no manual e na nota', async () => {
    const nota = [
      resolverDestinoItemCompra({ destino_estoque: 'FABRICA', produto_id: 1 }),
      resolverDestinoItemCompra({ destino_estoque: 'LOJA', produto_id: 3 })
    ];
    const manual = [
      resolverDestinoItemCompra({ destino_estoque: 'LOJA', produto_id: 2 }),
      resolverDestinoItemCompra({ destino_estoque: 'FABRICA', produto_id: 4 })
    ];
    assert.deepEqual(nota.map((item) => item.local), ['FABRICA', 'LOJA']);
    assert.deepEqual(manual.map((item) => item.local), ['LOJA', 'FABRICA']);
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM produtos');
    await entrar(db, 1, 20, 'LOJA');
    await entrar(db, 3, 7, 'FABRICA');
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM produtos');
    assert.equal(depois.total, antes.total);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA')).estoqueAtual, 20);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA')).estoqueAtual, 100);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 3, 'FABRICA')).estoqueAtual, 7);
  });

  it('grava o local da movimentação e mantém o split fiscal por local', async () => {
    const fabrica = await MotorEstoque.entrar(db, {
      produtoId: 6,
      quantidadeBase: 15,
      quantidadeFiscal: 10,
      quantidadeNaoFiscal: 5,
      origem: 'COMPRA',
      local: 'FABRICA',
      referenciaTipo: 'compra',
      referenciaId: 602
    });
    const loja = await MotorEstoque.entrar(db, {
      produtoId: 7,
      quantidadeBase: 9,
      quantidadeFiscal: 4,
      quantidadeNaoFiscal: 5,
      origem: 'COMPRA',
      local: 'LOJA',
      referenciaTipo: 'compra',
      referenciaId: 607
    });

    assert.equal(fabrica.movimentacao.local, 'FABRICA');
    assert.equal(loja.movimentacao.local, 'LOJA');
    assert.deepEqual(
      await all(db, `
        SELECT local, origem, referencia_tipo, referencia_id,
               quantidade_base, quantidade_fiscal, quantidade_nao_fiscal
        FROM estoque_movimentacoes
        WHERE referencia_tipo = 'compra' AND referencia_id IN (602, 607)
        ORDER BY referencia_id
      `),
      [
        {
          local: 'FABRICA', origem: 'COMPRA', referencia_tipo: 'compra', referencia_id: 602,
          quantidade_base: 15, quantidade_fiscal: 10, quantidade_nao_fiscal: 5
        },
        {
          local: 'LOJA', origem: 'COMPRA', referencia_tipo: 'compra', referencia_id: 607,
          quantidade_base: 9, quantidade_fiscal: 4, quantidade_nao_fiscal: 5
        }
      ]
    );

    assert.deepEqual(await MotorEstoque.consultarSaldoLocal(db, 6, 'FABRICA'), {
      local: 'FABRICA', saldoFiscal: 10, saldoNaoFiscal: 5, estoqueAtual: 15, herdado: false
    });
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 6, 'LOJA')).estoqueAtual, 0);
    assert.deepEqual(await MotorEstoque.consultarSaldoLocal(db, 7, 'LOJA'), {
      local: 'LOJA', saldoFiscal: 4, saldoNaoFiscal: 5, estoqueAtual: 9, herdado: false
    });
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 7, 'FABRICA')).estoqueAtual, 0);
  });

  it('entrada sem local continua sem atribuir local à movimentação', async () => {
    const resultado = await MotorEstoque.entrar(db, {
      produtoId: 8,
      quantidadeBase: 3,
      origem: 'COMPRA',
      referenciaTipo: 'compra',
      referenciaId: 608
    });
    assert.equal(resultado.movimentacao.local, null);
    const movimento = await get(db, `
      SELECT local FROM estoque_movimentacoes
      WHERE referencia_tipo = 'compra' AND referencia_id = 608
    `);
    assert.equal(movimento.local, null);
  });

  it('7, 10 e 12: item novo sem destino não entra e compra antiga sem local continua Loja', () => {
    assert.throws(() => resolverDestinoItemCompra({ produto_id: 1 }), (err) => err.message === MENSAGEM_SEM_DESTINO);
    assert.equal(interpretarLocalHistorico({ local_id: null, destino_estoque: null }), 'LOJA');
    assert.equal(interpretarLocalHistorico({}), 'LOJA');
    const legado = resolverDestinoItemCompra({ produto_id: 3 }, { legadoSemLocal: true });
    assert.equal(legado.local, 'LOJA');
    assert.equal(legado.herdado, true);
  });

  it('8 e 11: a compra continua sem criar produto e o destino fica no item', () => {
    const compras = fs.readFileSync(path.join(__dirname, '../../backend/rotas/compras.js'), 'utf8');
    const resolver = fs.readFileSync(path.join(__dirname, '../../backend/modules/compras/resolverProdutoItem.js'), 'utf8');
    assert.match(compras, /MotorEstoque\.entrar\(db,/);
    assert.match(compras, /local: destino\.local/);
    assert.match(compras, /destino_estoque, local_id/);
    assert.match(compras, /resolverDestinoItemCompra/);
    assert.equal(resolver.includes('INSERT'), false);
    assert.equal(resolver.includes('UPDATE'), false);
    assert.match(compras, /PRODUTO_NAO_CADASTRADO/);
  });

  it('reenvio de NF-e já lançada é bloqueado antes de processar itens', () => {
    const compras = fs.readFileSync(path.join(__dirname, '../../backend/rotas/compras.js'), 'utf8');
    const inicio = compras.indexOf('if (existente) {', compras.lastIndexOf('if (chaveLimpa) {'));
    const fim = compras.indexOf('\n        if (isProducaoPropria)', inicio);
    const guarda = compras.slice(inicio, fim);
    const chamadas = { consulta: 0, gravacao: 0, codigo: null };
    const contexto = {
      chaveLimpa: '35261000000000000000000000000000000000000000',
      db: {
        get(sql, params, callback) {
          chamadas.consulta += 1;
          assert.match(sql, /FROM compras WHERE chave_acesso = \? LIMIT 1/);
          assert.equal(params[0], contexto.chaveLimpa);
          callback(null, { id: 90, status: 'concluida' });
        }
      },
      res: {
        status(codigo) {
          chamadas.codigo = codigo;
          return this;
        },
        json() {
          return this;
        }
      },
      continuarGravacao() {
        chamadas.gravacao += 1;
      }
    };
    vm.createContext(contexto);
    vm.runInContext(`(() => { db.get('SELECT id, status FROM compras WHERE chave_acesso = ? LIMIT 1', [chaveLimpa], (dupErr, existente) => { ${guarda} }); })()`, contexto);

    assert.equal(chamadas.codigo, 400);
    assert.equal(chamadas.gravacao, 0);
  });

  it('preserva destino manual ao editar por produto e mantém sugestões para itens novos', () => {
    const compras = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/compras.js'), 'utf8');
    const inicio = compras.indexOf('function sugerirDestinoItemCompra');
    const fim = compras.indexOf('function renderItensCompraTabela', inicio);
    const editarItem = compras.slice(
      compras.indexOf('function editarItemCompra'),
      compras.indexOf('function onFornecedorInput')
    );
    const adicionarItem = compras.slice(
      compras.indexOf('function adicionarItemCompra'),
      compras.indexOf('function limparFormularioItemCompra')
    );
    const contexto = {
      produtosCompraList: [
        { id: 1, natureza_cadastro: 'INSUMO' },
        { id: 2, natureza_cadastro: 'COMERCIAL' }
      ],
      itensCompraAtual: [],
      itemCompraEmEdicao: null,
      produtoInativoCompra: () => false,
      recalcularLinhaCompra: () => {},
      renderItensCompraTabela: () => {}
    };
    vm.createContext(contexto);
    vm.runInContext(compras.slice(inicio, fim), contexto);
    const alterarProdutoInicio = compras.indexOf('function alterarProdutoItemCompra');
    const alterarProdutoFim = compras.indexOf('function adicionarItemCompra', alterarProdutoInicio);
    vm.runInContext(compras.slice(alterarProdutoInicio, alterarProdutoFim), contexto);
    assert.match(editarItem, /iniciarEdicaoDestinoItemCompra\(item\)/);
    assert.match(adicionarItem, /aplicarDestinoEdicaoItemCompra\(item\)/);

    contexto.iniciarEdicaoDestinoItemCompra({
      produto_id: 1,
      destino_estoque: 'LOJA',
      destino_manual: true
    });
    const reeditado = { produto_id: 1 };
    contexto.aplicarDestinoEdicaoItemCompra(reeditado);
    assert.equal(reeditado.destino_estoque, 'LOJA');
    assert.equal(reeditado.destino_manual, true);

    contexto.itensCompraAtual.push(reeditado);
    contexto.alterarDestinoItemCompra(0, 'FABRICA');
    assert.equal(reeditado.destino_estoque, 'FABRICA');
    assert.equal(reeditado.destino_manual, true);
    contexto.alterarProdutoItemCompra(0, 1);
    assert.equal(reeditado.destino_estoque, 'FABRICA');
    contexto.alterarProdutoItemCompra(0, 2);
    assert.equal(reeditado.destino_estoque, 'LOJA');
    assert.equal(reeditado.destino_manual, false);

    contexto.iniciarEdicaoDestinoItemCompra(reeditado);
    const produtoAlterado = { produto_id: 2 };
    contexto.aplicarDestinoEdicaoItemCompra(produtoAlterado);
    assert.equal(produtoAlterado.destino_estoque, 'LOJA');
    assert.equal(produtoAlterado.destino_manual, false);

    const insumoNovo = { produto_id: 1 };
    contexto.aplicarDestinoEdicaoItemCompra(insumoNovo);
    assert.equal(insumoNovo.destino_estoque, 'FABRICA');
    assert.equal(insumoNovo.destino_manual, false);
  });

  it('9: conversão de unidade continua antes da entrada no local', async () => {
    const conversor = new ConversaoComercialService();
    const convertido = conversor.Converter({
      produto: { id: 5, unidade: 'ML', conversoes: [], unidades_comercializacao: [] },
      quantidade: 2,
      unidadeOrigem: 'L',
      unidadeBase: 'ML',
      contexto: 'OUTROS'
    });
    assert.equal(Number(convertido.quantidadeConvertida), 2000);
    await entrar(db, 5, Number(convertido.quantidadeConvertida), 'FABRICA');
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 5, 'FABRICA')).estoqueAtual, 2000);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 5, 'LOJA')).estoqueAtual, 0);
  });
});
