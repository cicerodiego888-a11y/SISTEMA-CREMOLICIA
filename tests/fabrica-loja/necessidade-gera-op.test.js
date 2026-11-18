/**
 * OP 01 — Necessidade de Produção gera sua Ordem de Produção (RASCUNHO), sem duplicar.
 * Backend: banco temporário. Tela: necessidades-producao.js real no jsdom com $.ajax interceptado.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { JSDOM } = require('jsdom');
const { salvarNecessidade, obterNecessidade } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const {
  salvarOrdem,
  cancelarOrdem,
  listarOrdens,
  criarOrdemDaNecessidade,
  MENSAGEM_OP_EXISTENTE
} = require('../../backend/modules/fabrica-loja/OrdemProducaoService');

const RAIZ = path.join(__dirname, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-op-01-'));
const arquivo = path.join(dir, 'necessidade-gera-op.db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); });
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function fotografiaSemOrdens(db) {
  const tabelas = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const foto = {};
  for (const { name } of tabelas) {
    if (name === 'ordens_producao' || name === 'ordem_producao_itens') continue;
    foto[name] = await all(db, `SELECT * FROM "${name}" ORDER BY rowid`);
  }
  return JSON.stringify(foto);
}

describe('OP 01 — Necessidade gera Ordem de Produção (backend)', () => {
  let db;
  const contexto = { usuario_id: 1, usuario_nome: 'Fábrica' };

  async function novaNecessidade(itens, extra = {}) {
    return salvarNecessidade(db, { origem: 'MANUAL', descricao: 'Produção da semana', itens, ...extra });
  }

  before(async () => {
    db = new sqlite3.Database(arquivo);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, codigo TEXT, nome TEXT, unidade TEXT, natureza_cadastro TEXT,
        ativo INTEGER DEFAULT 1, estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0, preco_venda REAL DEFAULT 0
      )
    `);
    await run(db, `INSERT INTO produtos (id, codigo, nome, unidade, natureza_cadastro, estoque_atual, saldo_nao_fiscal, preco_venda) VALUES
      (16, '00014', 'PICOLE ABACAXI', 'un', 'PRODUZIDO', 30, 30, 4.5),
      (56, '0053', 'SORVETE KG', 'kg', 'PRODUZIDO', 12.5, 12.5, 39.9)`);
    await run(db, 'CREATE TABLE estoque_movimentacoes (id INTEGER PRIMARY KEY, produto_id INTEGER, quantidade REAL)');
  });

  after(async () => {
    await new Promise((resolve) => db.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('1 a 4. Necessidade válida cria OP RASCUNHO com o mesmo produto, a quantidade restante e o vínculo', async () => {
    const necessidade = await novaNecessidade(
      [{ produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: '10', unidade: 'un' }],
      { origem: 'PEDIDO_LOJA', referencia: 'Loja centro' }
    );
    const antes = await obterNecessidade(db, necessidade.id);
    assert.equal(antes.resumo.restante, 10);
    assert.equal(antes.pode_criar_op, true);

    const resultado = await criarOrdemDaNecessidade(db, necessidade.id, contexto);
    assert.equal(resultado.criada, true);
    const ordem = resultado.ordem;
    assert.equal(ordem.status, 'RASCUNHO');
    assert.equal(ordem.origem, 'NECESSIDADE');
    assert.equal(ordem.necessidade_id, necessidade.id);
    assert.equal(ordem.necessidade_codigo, necessidade.codigo);
    assert.equal(ordem.referencia, 'Loja centro');
    assert.equal(ordem.itens.length, 1);
    assert.equal(ordem.itens[0].produto_id, 16);
    assert.equal(ordem.itens[0].quantidade_planejada, 10);
    assert.equal(ordem.itens[0].unidade, 'un');
    assert.equal(ordem.itens[0].necessidade_item_id, antes.itens[0].id);

    const depois = await obterNecessidade(db, necessidade.id);
    assert.deepEqual(depois.ordens_producao.map((o) => o.id), [ordem.id]);
    assert.equal(depois.resumo.planejado, 10);
    assert.equal(depois.resumo.produzido, 0);
    assert.equal(depois.pode_criar_op, false);
  });

  it('3. Quantidade restante por item, com fracionado, e OP cancelada anterior não conta nem bloqueia', async () => {
    const necessidade = await novaNecessidade([
      { produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: '24', unidade: 'un' },
      { produto_id: 56, descricao: 'SORVETE KG', quantidade: '2,5', unidade: 'kg' }
    ]);
    const lida = await obterNecessidade(db, necessidade.id);
    const cancelada = await salvarOrdem(db, {
      necessidade_id: necessidade.id,
      itens: [{ necessidade_item_id: lida.itens[0].id, produto_id: 16, quantidade_planejada: 4 }]
    }, null, contexto);
    await cancelarOrdem(db, cancelada.id, contexto);

    const resultado = await criarOrdemDaNecessidade(db, necessidade.id, contexto);
    assert.equal(resultado.criada, true);
    assert.notEqual(resultado.ordem.id, cancelada.id);
    assert.deepEqual(
      resultado.ordem.itens.map((item) => [item.produto_id, item.quantidade_planejada, item.unidade]),
      [[16, 24, 'un'], [56, 2.5, 'kg']]
    );
  });

  it('5. Segunda tentativa não cria OP duplicada e devolve a OP existente com a mensagem', async () => {
    const necessidade = await novaNecessidade([{ produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: '6', unidade: 'un' }]);
    const primeira = await criarOrdemDaNecessidade(db, necessidade.id, contexto);
    const segunda = await criarOrdemDaNecessidade(db, necessidade.id, contexto);
    assert.equal(segunda.criada, false);
    assert.equal(segunda.mensagem, 'Esta necessidade já possui uma Ordem de Produção.');
    assert.equal(segunda.mensagem, MENSAGEM_OP_EXISTENTE);
    assert.equal(segunda.ordem.id, primeira.ordem.id);
    const ordens = await listarOrdens(db, { necessidade_id: necessidade.id });
    assert.equal(ordens.length, 1);
  });

  it('5b. Cliques simultâneos também não duplicam a OP', async () => {
    const necessidade = await novaNecessidade([{ produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: '8', unidade: 'un' }]);
    const resultados = await Promise.all([1, 2, 3].map(() => criarOrdemDaNecessidade(db, necessidade.id, contexto)));
    assert.equal(resultados.filter((r) => r.criada).length, 1);
    assert.equal(new Set(resultados.map((r) => r.ordem.id)).size, 1);
    assert.equal((await listarOrdens(db, { necessidade_id: necessidade.id })).length, 1);
  });

  it('5c. OP já criada manualmente para a necessidade (mesmo parcial) impede uma nova', async () => {
    const necessidade = await novaNecessidade([{ produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: '20', unidade: 'un' }]);
    const lida = await obterNecessidade(db, necessidade.id);
    const manual = await salvarOrdem(db, {
      necessidade_id: necessidade.id,
      itens: [{ necessidade_item_id: lida.itens[0].id, produto_id: 16, quantidade_planejada: 5 }]
    }, null, contexto);
    const resultado = await criarOrdemDaNecessidade(db, necessidade.id, contexto);
    assert.equal(resultado.criada, false);
    assert.equal(resultado.ordem.id, manual.id);
    assert.equal((await listarOrdens(db, { necessidade_id: necessidade.id })).length, 1);
  });

  it('6. Necessidade com item sem produto_id não cria OP', async () => {
    const necessidade = await novaNecessidade([{ produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: '3', unidade: 'un' }]);
    await run(db, 'UPDATE necessidade_producao_itens SET produto_id = NULL WHERE necessidade_id = ?', [necessidade.id]);
    await assert.rejects(
      criarOrdemDaNecessidade(db, necessidade.id, contexto),
      (err) => err.code === 'PRODUTO_OBRIGATORIO' && err.statusCode === 400
        && err.message === 'A necessidade possui item sem produto cadastrado. Selecione o produto antes de criar a Ordem de Produção.'
    );
    assert.equal((await listarOrdens(db, { necessidade_id: necessidade.id })).length, 0);
  });

  it('Necessidade cancelada ou inexistente não gera OP', async () => {
    const necessidade = await novaNecessidade([{ produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: '3', unidade: 'un' }]);
    await salvarNecessidade(db, {
      origem: 'MANUAL', descricao: 'Produção da semana', status: 'CANCELADA',
      itens: [{ produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: '3', unidade: 'un' }]
    }, necessidade.id);
    await assert.rejects(criarOrdemDaNecessidade(db, necessidade.id, contexto), (err) => err.code === 'NECESSIDADE_INDISPONIVEL');
    await assert.rejects(criarOrdemDaNecessidade(db, 99999, contexto), (err) => err.statusCode === 404);
    assert.equal((await listarOrdens(db, { necessidade_id: necessidade.id })).length, 0);
  });

  it('Criar a OP não altera estoque, saldo, preço, movimentações nem a necessidade', async () => {
    const necessidade = await novaNecessidade([{ produto_id: 56, descricao: 'SORVETE KG', quantidade: '1,5', unidade: 'kg' }]);
    const antes = await fotografiaSemOrdens(db);
    const resultado = await criarOrdemDaNecessidade(db, necessidade.id, contexto);
    assert.equal(resultado.criada, true);
    assert.equal(await fotografiaSemOrdens(db), antes);
    const produtos = await all(db, 'SELECT id, estoque_atual, saldo_nao_fiscal, preco_venda FROM produtos ORDER BY id');
    assert.deepEqual(produtos.map((p) => ({ ...p })), [
      { id: 16, estoque_atual: 30, saldo_nao_fiscal: 30, preco_venda: 4.5 },
      { id: 56, estoque_atual: 12.5, saldo_nao_fiscal: 12.5, preco_venda: 39.9 }
    ]);
    assert.equal((await all(db, 'SELECT * FROM estoque_movimentacoes')).length, 0);
  });
});

describe('OP 01 — ação "Criar Ordem de Produção" na tela da Necessidade', () => {
  const janelas = [];
  after(() => { janelas.forEach((w) => w.close()); });

  function necessidadeAberta(extra = {}) {
    return {
      id: 7, codigo: 'NP-0007', origem: 'MANUAL', origem_nome: 'Manual', pedido_id: null, referencia: '',
      descricao: 'Produção da semana', data_necessidade: '', status: 'ABERTA', observacoes: '',
      itens: [{ id: 3, ordem: 1, produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: 10, unidade: 'un', ficha_tecnica_id: null }],
      pedidos: [], atendimento: { solicitado: 10, planejado: 0, produzido: 0, restante: 10, status: 'ABERTA', itens: [] },
      resumo: { solicitado: 10, planejado: 0, produzido: 0, restante: 10 },
      ordens_producao: [], historico: [], pode_criar_op: true, pode_cancelar: true,
      ...extra
    };
  }

  const ordemCriada = {
    id: 41, codigo: 'OP-2026-000041', status: 'RASCUNHO', origem: 'NECESSIDADE', necessidade_id: 7,
    itens: [{ produto_id: 16, produto_nome: 'PICOLE ABACAXI', quantidade_planejada: 10, unidade: 'un' }]
  };
  const comOrdem = necessidadeAberta({
    resumo: { solicitado: 10, planejado: 10, produzido: 0, restante: 10 },
    pode_criar_op: false,
    ordens_producao: [{
      id: 41, codigo: 'OP-2026-000041', status: 'RASCUNHO', origem: 'NECESSIDADE', planejado: 10, produzido: 0, perdido: 0,
      produtos: [{ produto_id: 16, produto_nome: 'PICOLE ABACAXI', planejado: 10, unidade: 'un' }], producoes: []
    }]
  });

  async function abrirTela({ respostaCriacao, detalhes }) {
    const dom = new JSDOM('<!doctype html><body><div id="page-content"></div></body>', {
      runScripts: 'outside-only', url: 'http://cds.teste/erp/', pretendToBeVisual: true
    });
    const w = dom.window;
    janelas.push(w);
    w.eval(fs.readFileSync(path.join(RAIZ, 'frontend', 'vendor', 'jquery', 'jquery.min.js'), 'utf8'));
    w.API_URL = 'http://cds.teste/api';
    w.notificacoes = [];
    w.showNotification = (mensagem, tipo) => w.notificacoes.push({ mensagem, tipo });
    const chamadas = [];
    const fila = detalhes.slice();
    w.jQuery.ajax = (opcoes) => {
      const caminho = opcoes.url.replace(w.API_URL, '');
      chamadas.push({ metodo: opcoes.method, caminho });
      const resposta = w.jQuery.Deferred();
      if (opcoes.method === 'POST' && caminho === '/fabrica-loja/necessidades/7/ordem-producao') resposta.resolve(respostaCriacao);
      else if (opcoes.method === 'GET' && caminho === '/fabrica-loja/necessidades/7') resposta.resolve({ success: true, necessidade: fila.length > 1 ? fila.shift() : fila[0] });
      else if (opcoes.method === 'GET' && caminho.startsWith('/fabrica-loja/necessidades')) resposta.resolve({ necessidades: [detalhes[0]] });
      else if (opcoes.method === 'GET' && caminho.startsWith('/fabrica-loja/fichas')) resposta.resolve({ fichas: [] });
      else resposta.resolve({});
      return resposta.promise();
    };
    w.eval(fs.readFileSync(path.join(RAIZ, 'frontend', 'erp', 'js', 'necessidades-producao.js'), 'utf8'));
    w.eval('loadNecessidadesProducao()');
    w.document.querySelector('[data-np-abrir="7"]').click();
    await new Promise((resolve, reject) => {
      const inicio = Date.now();
      const verificar = () => {
        if (w.document.getElementById('np-criar-op')) return resolve();
        if (Date.now() - inicio > 3000) return reject(new Error('Tempo esgotado: editor da necessidade'));
        setTimeout(verificar, 10);
      };
      verificar();
    });
    return { w, doc: w.document, chamadas };
  }

  it('mostra a ação "Criar Ordem de Produção" e, ao clicar, cria a OP e avisa "Ordem de Produção criada."', async () => {
    const tela = await abrirTela({
      respostaCriacao: { success: true, criada: true, ordem: ordemCriada },
      detalhes: [necessidadeAberta(), comOrdem]
    });
    const botao = tela.doc.getElementById('np-criar-op');
    assert.equal(botao.textContent, 'Criar Ordem de Produção');
    botao.click();
    assert.deepEqual(tela.chamadas.filter((c) => c.metodo === 'POST').map((c) => c.caminho), ['/fabrica-loja/necessidades/7/ordem-producao']);
    assert.deepEqual(tela.w.notificacoes.map((n) => n.mensagem), ['Ordem de Produção criada.']);
    assert.equal(tela.doc.getElementById('np-criar-op'), null);
    assert.ok(tela.doc.querySelector('[data-np-ver-op="41"]'));
    const texto = tela.doc.getElementById('np-editor').textContent;
    assert.match(texto, /OP-2026-000041/);
    assert.doesNotMatch(texto, /produto_id|necessidade_id|Resolver|ordens_producao|Service/);
  });

  it('quando já existe OP, informa a mensagem, oferece a OP existente e não mostra IDs técnicos', async () => {
    const tela = await abrirTela({
      respostaCriacao: { success: true, criada: false, mensagem: 'Esta necessidade já possui uma Ordem de Produção.', ordem: ordemCriada },
      detalhes: [necessidadeAberta(), comOrdem]
    });
    tela.doc.getElementById('np-criar-op').click();
    const aviso = tela.doc.getElementById('np-aviso-op');
    assert.ok(aviso);
    assert.match(aviso.textContent, /^Esta necessidade já possui uma Ordem de Produção\./);
    assert.equal(aviso.querySelector('[data-np-ver-op]').getAttribute('data-np-ver-op'), '41');
    assert.match(aviso.textContent, /Ver OP-2026-000041/);
    assert.doesNotMatch(aviso.textContent, /\b41\b|produto_id|necessidade_id/);
    assert.deepEqual(tela.w.notificacoes, []);
  });

  it('erro do servidor aparece no formulário e o botão volta a ficar disponível', async () => {
    const tela = await abrirTela({ respostaCriacao: null, detalhes: [necessidadeAberta()] });
    const ajaxOriginal = tela.w.jQuery.ajax;
    tela.w.jQuery.ajax = (opcoes) => {
      if (opcoes.method === 'POST') {
        return tela.w.jQuery.Deferred().reject({
          responseJSON: { success: false, error: 'A necessidade possui item sem produto cadastrado. Selecione o produto antes de criar a Ordem de Produção.' }
        }).promise();
      }
      return ajaxOriginal(opcoes);
    };
    const botao = tela.doc.getElementById('np-criar-op');
    botao.click();
    assert.equal(tela.doc.getElementById('np-erro').textContent, 'A necessidade possui item sem produto cadastrado. Selecione o produto antes de criar a Ordem de Produção.');
    assert.equal(botao.disabled, false);
    assert.deepEqual(tela.w.notificacoes, []);
  });
});
