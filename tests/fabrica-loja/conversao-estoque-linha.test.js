/**
 * Conversão do estoque dos produtos-linha legados (FABRICA-CONVERSAO-02):
 * saída do produto-linha e entradas nos sabores pelo Motor de Estoque, numa transação,
 * com distribuição informada, correlation_id único e histórico intacto.
 * Banco temporário via tests/pdv/_bancoIsolado.js. Executar: npm run test:conversao-linha
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

const TMP = path.resolve(os.tmpdir()).toLowerCase();
const DB_DIR = path.resolve(String(process.env.DB_DIR || '')).toLowerCase();
if (!process.env.DB_DIR || !DB_DIR.startsWith(TMP)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/fabrica-loja/conversao-estoque-linha.test.js');
  process.exit(1);
}
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(process.env.DB_DIR, 'mercadao.db' + sufixo), { force: true });
}

const express = require('express');
const db = require('../../backend/database');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const bootstrapLinhasProdutos = require('../../backend/modules/fabrica-loja/migrations/010_linhas_produtos');
const bootstrapConversoes = require('../../backend/modules/fabrica-loja/migrations/011_conversoes_estoque_linha');
const Conversao = require('../../backend/modules/fabrica-loja/ConversaoEstoqueLinhaService');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r || null))));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
}
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

const ids = {};
let servidor;
let base;

async function criarProduto(d) {
  const r = await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, preco_compra, saldo_fiscal, saldo_nao_fiscal,
       estoque_atual, ativo, natureza_cadastro, linha_produtos_id, item_fiscal)
     VALUES (?, ?, 'UN', 2, 0, ?, ?, ?, ?, ?, ?, 1)`,
    [d.codigo, d.nome, d.fiscal || 0, d.naoFiscal || 0, (d.fiscal || 0) + (d.naoFiscal || 0),
      d.ativo == null ? 1 : d.ativo, d.natureza || null, d.linha || null]
  );
  return r.id;
}

async function api(method, rota, body) {
  const resposta = await fetch(base + rota, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: resposta.status, body: await resposta.json().catch(() => null) };
}

async function estoque(id) {
  return get('SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual, ativo FROM produtos WHERE id = ?', [id]);
}

async function estoqueGlobal() {
  return (await get('SELECT ROUND(SUM(estoque_atual), 3) AS total FROM produtos')).total;
}

async function historico() {
  return {
    vendas: hash(await all('SELECT * FROM vendas ORDER BY id')),
    vendas_itens: hash(await all('SELECT * FROM vendas_itens ORDER BY id')),
    consignacoes: hash(await all('SELECT * FROM consignacoes ORDER BY id')),
    consignacoes_itens: hash(await all('SELECT * FROM consignacoes_itens ORDER BY id'))
  };
}

function distribuicaoExata() {
  return {
    produto_origem_id: ids.legado,
    itens: [
      { produto_id: ids.chocolate, quantidade_fiscal: 60, quantidade_nao_fiscal: 240, reativar: true },
      { produto_id: ids.morango, quantidade_fiscal: 0, quantidade_nao_fiscal: 0 },
      { produto_id: ids.abacaxi, quantidade_fiscal: 40, quantidade_nao_fiscal: 160, reativar: true }
    ]
  };
}

async function semEfeito(resposta, status, codigo) {
  assert.equal(resposta.status, status, JSON.stringify(resposta.body));
  assert.equal(resposta.body.codigo, codigo);
  assert.deepEqual(await estoque(ids.legado), { saldo_fiscal: 100, saldo_nao_fiscal: 400, estoque_atual: 500, ativo: 1 });
  assert.equal((await get('SELECT COUNT(*) AS q FROM conversoes_estoque_linha')).q, 0);
  assert.equal((await get(`SELECT COUNT(*) AS q FROM estoque_movimentacoes WHERE origem = 'CONVERSAO_LEGADO'`)).q, 0);
}

before(async () => {
  assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(TMP), `banco fora do temp: ${db.dbPath}`);
  await new Promise((resolve) => db.whenReady(() => resolve()));
  await bootstrapLinhasProdutos(db);
  await bootstrapConversoes(db);

  ids.cremoso = (await run(`INSERT INTO linhas_produtos (codigo, nome) VALUES ('PIC-CREMOSO', 'Picolé Cremoso')`)).id;
  ids.agua = (await run(`INSERT INTO linhas_produtos (codigo, nome) VALUES ('PIC-FRUTA-AGUA', 'Fruta com Água')`)).id;

  ids.legado = await criarProduto({ codigo: '0047', nome: 'PICOLE LINHA CREMOSA', fiscal: 100, naoFiscal: 400 });
  ids.legadoInativo = await criarProduto({ codigo: '0048', nome: 'PICOLE LINHA FRUTA AO LEITE', fiscal: 10, naoFiscal: 10, ativo: 0 });
  ids.legadoVazio = await criarProduto({ codigo: '0049', nome: 'PICOLE LINHA FRUTA COM AGUA' });
  ids.chocolate = await criarProduto({ codigo: '0002', nome: 'PICOLE CHOCOLATE - cremoso', fiscal: 7, naoFiscal: 3, ativo: 0, natureza: 'PRODUZIDO', linha: ids.cremoso });
  ids.morango = await criarProduto({ codigo: '0003', nome: 'PICOLE MORANGO - cremoso', ativo: 0, natureza: 'PRODUZIDO', linha: ids.cremoso });
  ids.abacaxi = await criarProduto({ codigo: '00014', nome: 'PICOLE ABACAXI - cremoso', ativo: 0, natureza: 'PRODUZIDO', linha: ids.cremoso });
  ids.semNatureza = await criarProduto({ codigo: '0009', nome: 'PICOLE SEM NATUREZA - cremoso', ativo: 0, linha: ids.cremoso });
  ids.caja = await criarProduto({ codigo: '00025', nome: 'PICOLE CAJA - fruta e agua', ativo: 0, natureza: 'PRODUZIDO', linha: ids.agua });
  ids.insumo = await criarProduto({ codigo: 'INS-1', nome: 'Leite em pó', fiscal: 5, natureza: 'INSUMO' });

  await Conversao.registrarProdutoLegado(db, { linha_produtos_id: ids.cremoso, produto_id: ids.legado });
  await Conversao.registrarProdutoLegado(db, { linha_produtos_id: ids.cremoso, produto_id: ids.legadoInativo });
  await Conversao.registrarProdutoLegado(db, { linha_produtos_id: ids.agua, produto_id: ids.legadoVazio });

  const venda = await run(`INSERT INTO vendas (codigo, data_venda, total, status) VALUES ('V-HIST-1', '2026-09-01', 20, 'concluida')`);
  await run(`INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal) VALUES (?, ?, 10, 2, 20)`, [venda.id, ids.legado]);
  const cliente = await run(`INSERT INTO clientes (nome) VALUES ('Cliente consignado')`);
  const perfil = await run(`INSERT INTO perfil_comercial (cliente_id, perfil_tipo) VALUES (?, 'CONSIGNADO')`, [cliente.id]);
  const consignacao = await run(`INSERT INTO consignacoes (cliente_id, perfil_comercial_id, status) VALUES (?, ?, 'ENTREGUE')`, [cliente.id, perfil.id]);
  await run(`INSERT INTO consignacoes_itens (consignacao_id, produto_id, quantidade_entregue, preco_unitario) VALUES (?, ?, 30, 2)`, [consignacao.id, ids.legado]);

  const app = express();
  app.use(express.json());
  app.use('/api/fabrica-loja', require('../../backend/rotas/fabrica-loja'));
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});

after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('Conversão de estoque da Linha', () => {
  let globalAntes;
  let historicoAntes;
  let conversao;

  before(async () => {
    globalAntes = await estoqueGlobal();
    historicoAntes = await historico();
  });

  it('a grade mostra o produto-linha, o estoque e os sabores da Linha', async () => {
    const r = await api('GET', `/fabrica-loja/conversoes-linha/origem/${ids.legado}`);
    assert.equal(r.status, 200);
    const grade = r.body.grade;
    assert.equal(grade.linha.id, ids.cremoso);
    assert.equal(grade.origem.estoque_atual, 500);
    assert.equal(grade.origem.situacao, 'PENDENTE');
    assert.equal(grade.origem.convertivel, true);
    assert.equal(grade.origem.estoque_disponivel, 500);
    assert.equal(grade.origem.consignacao_pendente, 30);
    assert.equal(grade.origem.aviso, 'Conversão pendente de distribuição física.');
    assert.equal(grade.consignacoes_em_aberto.quantidade, 30);
    assert.deepEqual(grade.sabores.map((s) => s.id).sort((a, b) => a - b),
      [ids.chocolate, ids.morango, ids.abacaxi, ids.semNatureza].sort((a, b) => a - b));
    assert.equal(grade.sabores.find((s) => s.id === ids.semNatureza).apto, false);
    assert.match(grade.correlation_id, new RegExp(`^CONVERSAO-LINHA-${ids.legado}-\\d{8}$`));
  });

  it('2. soma menor que a origem é recusada', async () => {
    const dados = distribuicaoExata();
    dados.itens[0].quantidade_nao_fiscal = 239;
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 400, 'SOMA_MENOR');
  });

  it('3. soma maior que a origem é recusada', async () => {
    const dados = distribuicaoExata();
    dados.itens[1].quantidade_fiscal = 1;
    dados.itens[1].reativar = true;
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 400, 'SOMA_MAIOR');
  });

  it('divisão fiscal / não fiscal diferente da origem é recusada', async () => {
    const dados = distribuicaoExata();
    dados.itens[0].quantidade_fiscal = 70;
    dados.itens[0].quantidade_nao_fiscal = 230;
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 400, 'SOMA_FISCAL_DIVERGENTE');
  });

  it('4. destino inexistente é recusado', async () => {
    const dados = distribuicaoExata();
    dados.itens.push({ produto_id: 999999, quantidade_fiscal: 0, quantidade_nao_fiscal: 0 });
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 404, 'DESTINO_INEXISTENTE');
  });

  it('5. destino INSUMO é recusado', async () => {
    const dados = distribuicaoExata();
    dados.itens.push({ produto_id: ids.insumo, quantidade_fiscal: 0, quantidade_nao_fiscal: 0 });
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 400, 'DESTINO_INSUMO');
  });

  it('6. destino de outra Linha é recusado', async () => {
    const dados = distribuicaoExata();
    dados.itens.push({ produto_id: ids.caja, quantidade_fiscal: 0, quantidade_nao_fiscal: 0 });
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 400, 'DESTINO_OUTRA_LINHA');
  });

  it('destino que é outro produto-linha ou sem natureza PRODUZIDO é recusado', async () => {
    const dados = distribuicaoExata();
    dados.itens.push({ produto_id: ids.legadoInativo, quantidade_fiscal: 0, quantidade_nao_fiscal: 0 });
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 400, 'DESTINO_PRODUTO_LINHA');
    const outro = distribuicaoExata();
    outro.itens.push({ produto_id: ids.semNatureza, quantidade_fiscal: 0, quantidade_nao_fiscal: 0 });
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', outro), 400, 'DESTINO_NAO_PRODUZIDO');
  });

  it('7. quantidade negativa no destino é recusada', async () => {
    const dados = distribuicaoExata();
    dados.itens[1].quantidade_nao_fiscal = -1;
    dados.itens[0].quantidade_nao_fiscal = 241;
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 400, 'QUANTIDADE_NEGATIVA');
  });

  it('destino inativo só recebe estoque se for reativado na conversão', async () => {
    const dados = distribuicaoExata();
    dados.itens[0].reativar = false;
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 400, 'DESTINO_INATIVO');
  });

  it('reativar sabor que não recebeu estoque é recusado', async () => {
    const dados = distribuicaoExata();
    dados.itens[1].reativar = true;
    await semEfeito(await api('POST', '/fabrica-loja/conversoes-linha', dados), 400, 'REATIVACAO_SEM_ESTOQUE');
  });

  it('9. produto-linha sem estoque é recusado', async () => {
    const r = await api('POST', '/fabrica-loja/conversoes-linha', {
      produto_origem_id: ids.legadoVazio,
      itens: [{ produto_id: ids.caja, quantidade_fiscal: 0, quantidade_nao_fiscal: 0 }]
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.codigo, 'ORIGEM_SEM_ESTOQUE');
  });

  it('10. produto-linha inativo é recusado', async () => {
    const r = await api('POST', '/fabrica-loja/conversoes-linha', {
      produto_origem_id: ids.legadoInativo,
      itens: [{ produto_id: ids.chocolate, quantidade_fiscal: 10, quantidade_nao_fiscal: 10 }]
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.codigo, 'ORIGEM_INATIVA');
    assert.equal((await estoque(ids.legadoInativo)).estoque_atual, 20);
  });

  it('produto que não é produto-linha não pode ser origem', async () => {
    const r = await api('POST', '/fabrica-loja/conversoes-linha', {
      produto_origem_id: ids.chocolate,
      itens: [{ produto_id: ids.abacaxi, quantidade_fiscal: 7, quantidade_nao_fiscal: 3 }]
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.codigo, 'PRODUTO_NAO_LEGADO');
  });

  it('falha no meio da gravação desfaz tudo (transação)', async () => {
    await run(`CREATE TEMP TRIGGER falha_abacaxi BEFORE INSERT ON estoque_movimentacoes
      WHEN NEW.produto_id = ${ids.abacaxi} BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`);
    try {
      const r = await api('POST', '/fabrica-loja/conversoes-linha', distribuicaoExata());
      assert.equal(r.status, 500);
    } finally {
      await run('DROP TRIGGER IF EXISTS temp.falha_abacaxi');
    }
    assert.deepEqual(await estoque(ids.legado), { saldo_fiscal: 100, saldo_nao_fiscal: 400, estoque_atual: 500, ativo: 1 });
    assert.deepEqual(await estoque(ids.chocolate), { saldo_fiscal: 7, saldo_nao_fiscal: 3, estoque_atual: 10, ativo: 0 });
    assert.equal((await get('SELECT COUNT(*) AS q FROM conversoes_estoque_linha')).q, 0);
    assert.equal((await get(`SELECT COUNT(*) AS q FROM estoque_movimentacoes WHERE origem = 'CONVERSAO_LEGADO'`)).q, 0);
    assert.equal(await estoqueGlobal(), globalAntes);
  });

  it('1. conversão exata: produto-linha vai a 0 e cada sabor recebe o informado', async () => {
    const r = await api('POST', '/fabrica-loja/conversoes-linha', distribuicaoExata());
    assert.equal(r.status, 201, JSON.stringify(r.body));
    conversao = r.body.conversao;
    assert.equal(conversao.status, 'CONCLUIDA');
    assert.equal(conversao.quantidade_total, 500);
    assert.equal(conversao.correlation_id, Conversao.correlationDaConversao(ids.legado));

    assert.deepEqual(await estoque(ids.legado), { saldo_fiscal: 0, saldo_nao_fiscal: 0, estoque_atual: 0, ativo: 1 });
    assert.deepEqual(await estoque(ids.chocolate), { saldo_fiscal: 67, saldo_nao_fiscal: 243, estoque_atual: 310, ativo: 1 });
    assert.deepEqual(await estoque(ids.abacaxi), { saldo_fiscal: 40, saldo_nao_fiscal: 160, estoque_atual: 200, ativo: 1 });
    assert.deepEqual(await estoque(ids.morango), { saldo_fiscal: 0, saldo_nao_fiscal: 0, estoque_atual: 0, ativo: 0 });

    const movs = await all(`SELECT produto_id, operacao, origem, quantidade_fiscal, quantidade_nao_fiscal, motivo, referencia_tipo, referencia_id
      FROM estoque_movimentacoes WHERE origem = 'CONVERSAO_LEGADO' ORDER BY id`);
    assert.equal(movs.length, 3);
    assert.deepEqual(movs.map((m) => [m.produto_id, m.operacao]), [[ids.legado, 'SAIDA'], [ids.chocolate, 'ENTRADA'], [ids.abacaxi, 'ENTRADA']]);
    assert.ok(movs.every((m) => m.motivo === `CONVERSAO_LEGADO:${conversao.correlation_id}`));
    assert.ok(movs.every((m) => m.referencia_tipo === 'conversao_estoque_linha' && m.referencia_id === conversao.id));
    assert.equal(movs[0].quantidade_fiscal, -100);
    assert.equal(movs[0].quantidade_nao_fiscal, -400);

    const comprovante = (await api('GET', `/fabrica-loja/conversoes-linha/${conversao.id}`)).body.conversao;
    assert.equal(comprovante.origem.id, ids.legado);
    assert.equal(comprovante.movimentacoes.length, 3);
    assert.deepEqual(comprovante.itens.map((i) => [i.produto_id, i.quantidade_total, i.reativado]),
      [[ids.chocolate, 300, true], [ids.abacaxi, 200, true], [ids.morango, 0, false]]);
    assert.equal(comprovante.descricao_operacao, 'Operação de conversão de estoque legado.');
    assert.deepEqual(comprovante.totais, {
      fiscal_origem: 100, fiscal_distribuido: 100,
      nao_fiscal_origem: 400, nao_fiscal_distribuido: 400,
      total_origem: 500, total_distribuido: 500
    });

    const loja = await MotorEstoque.consultarSaldoLocal(db, ids.chocolate, MotorEstoque.LOCAL_LOJA);
    assert.equal(loja.estoqueAtual, 310);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, ids.legado, MotorEstoque.LOCAL_LOJA)).estoqueAtual, 0);
  });

  it('11. o estoque global é preservado', async () => {
    assert.equal(await estoqueGlobal(), globalAntes);
  });

  it('12. o histórico (vendas e consignações do produto-linha) fica intacto', async () => {
    assert.deepEqual(await historico(), historicoAntes);
    assert.equal((await get('SELECT produto_id FROM vendas_itens WHERE venda_id = (SELECT id FROM vendas WHERE codigo = ?)', ['V-HIST-1'])).produto_id, ids.legado);
    assert.equal((await get('SELECT COUNT(*) AS q FROM consignacoes_itens WHERE produto_id = ?', [ids.legado])).q, 1);
  });

  it('a natureza dos sabores e do insumo não muda', async () => {
    const naturezas = await all('SELECT id, natureza_cadastro FROM produtos WHERE id IN (?, ?, ?) ORDER BY id', [ids.chocolate, ids.abacaxi, ids.insumo]);
    assert.deepEqual(naturezas.map((n) => n.natureza_cadastro), ['PRODUZIDO', 'PRODUZIDO', 'INSUMO']);
  });

  it('8. a mesma conversão não executa duas vezes, nem com saldo devolvido ao produto-linha', async () => {
    await MotorEstoque.entrar(db, {
      produtoId: ids.legado, quantidadeBase: 5, quantidadeFiscal: 5, quantidadeNaoFiscal: 0,
      origem: 'DEVOLUCAO', referenciaTipo: 'consignacao', motivo: 'COM_DEVOLUCAO:teste'
    });
    const dados = {
      produto_origem_id: ids.legado,
      itens: [{ produto_id: ids.chocolate, quantidade_fiscal: 5, quantidade_nao_fiscal: 0 }]
    };
    const r = await api('POST', '/fabrica-loja/conversoes-linha', dados);
    assert.equal(r.status, 409);
    assert.equal(r.body.codigo, 'PRODUTO_LINHA_JA_CONVERTIDO');
    assert.equal(r.body.error, 'Este produto-linha já foi convertido.');
    assert.equal((await get('SELECT COUNT(*) AS q FROM conversoes_estoque_linha')).q, 1);
    assert.equal((await estoque(ids.legado)).estoque_atual, 5);
    assert.equal((await estoque(ids.chocolate)).estoque_atual, 310);

    const lista = (await api('GET', '/fabrica-loja/conversoes-linha')).body;
    const legado = lista.linhas.find((l) => l.id === ids.cremoso).produtos_legado.find((p) => p.id === ids.legado);
    assert.equal(legado.situacao, 'CONVERTIDO');
    assert.equal(legado.convertivel, false);
    assert.equal(legado.estoque_disponivel, 0);
    assert.equal(legado.saldo_residual, 5);
    assert.equal(legado.consignacao_pendente, 30);
    assert.equal(legado.bloqueio.codigo, 'PRODUTO_LINHA_JA_CONVERTIDO');
  });
});

describe('Banco sem a estrutura de conversão', () => {
  it('lista vazia e conversão recusada', async () => {
    const memoria = new sqlite3.Database(':memory:');
    try {
      const lista = await Conversao.listarConversaoLinhas(memoria);
      assert.deepEqual(lista, { instalada: false, linhas: [], conversoes: [] });
      await assert.rejects(
        Conversao.converterEstoqueLinha(memoria, { produto_origem_id: 1, itens: [] }),
        (err) => err.code === 'ESTRUTURA_NAO_INSTALADA'
      );
    } finally {
      await new Promise((resolve) => memoria.close(() => resolve()));
    }
  });
});
