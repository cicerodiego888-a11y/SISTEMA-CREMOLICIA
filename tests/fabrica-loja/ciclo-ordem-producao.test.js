/**
 * OP 02 — Ciclo da Ordem de Produção: RASCUNHO → PLANEJADA → EM_PRODUCAO, sem movimentar estoque.
 * Backend: banco temporário. Tela: ordens-producao.js real no jsdom com $.ajax interceptado.
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
  obterOrdem,
  planejarOrdem,
  cancelarOrdem,
  criarOrdemDaNecessidade
} = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { iniciarProducao, executarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');

const RAIZ = path.join(__dirname, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-op-02-'));
const arquivo = path.join(dir, 'ciclo-ordem.db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve({ id: this.lastID }); });
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

function recusa(codigo) {
  return (err) => err.code === codigo;
}

describe('OP 02 — ciclo da Ordem de Produção (backend)', () => {
  let db;
  const contexto = { usuario_id: 7, usuario_nome: 'Ana da Fábrica' };

  async function novaOrdem(quantidade = 50) {
    return salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: quantidade, unidade: 'UN', ficha_tecnica_id: 1 }]
    }, null, contexto);
  }

  before(async () => {
    db = new sqlite3.Database(arquivo);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT, estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, natureza_cadastro TEXT,
        ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT, preco_compra REAL,
        preco_venda REAL DEFAULT 0
      )
    `);
    await bootstrapFichas(db);
    await bootstrapOrdens(db);
    await run(db, `INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro, preco_compra, preco_venda) VALUES
      (1, 'Leite', 'L', 100, 100, 'INSUMO', 2, 0),
      (2, 'Açúcar', 'KG', 50, 50, 'INSUMO', 3, 0),
      (5, 'Picolé de Morango', 'UN', 8, 8, 'PRODUZIDO', 0, 4.5)`);
    await run(db, `INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, rendimento_quantidade, rendimento_unidade, ativa)
      VALUES (1, 'FT-001', 'Picolé de Morango', 5, 100, 'UN', 1)`);
    await run(db, `INSERT INTO ficha_tecnica_componentes (ficha_id, ordem, produto_id, descricao, quantidade, unidade) VALUES
      (1, 1, 1, 'Leite', 20, 'L'), (1, 2, 2, 'Açúcar', 5, 'KG')`);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await run(db, `INSERT INTO estoque_saldos_locais (produto_id, local, saldo_fiscal, saldo_nao_fiscal, estoque_atual) VALUES
      (1, 'FABRICA', 100, 0, 100), (2, 'FABRICA', 50, 0, 50)`);
  });

  after(async () => {
    await new Promise((resolve) => db.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('1, 2, 6 e 8. RASCUNHO → PLANEJADA → EM_PRODUCAO mantém produto, quantidade e ficha e não movimenta estoque', async () => {
    const antes = await fotografiaSemOrdens(db);
    const rascunho = await novaOrdem(50);
    assert.equal(rascunho.status, 'RASCUNHO');

    const planejada = await planejarOrdem(db, rascunho.id, contexto);
    assert.equal(planejada.status, 'PLANEJADA');
    assert.equal(planejada.producao_iniciada_em, '');

    const emProducao = await iniciarProducao(db, rascunho.id, contexto);
    assert.equal(emProducao.status, 'EM_PRODUCAO');
    assert.match(emProducao.producao_iniciada_em, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(emProducao.producao_usuario_id, 7);
    assert.equal(emProducao.producao_usuario_nome, 'Ana da Fábrica');

    for (const ordem of [planejada, emProducao]) {
      assert.equal(ordem.codigo, rascunho.codigo);
      assert.deepEqual(
        ordem.itens.map((i) => [i.produto_id, i.quantidade_planejada, i.unidade, i.ficha_tecnica_id]),
        [[5, 50, 'UN', 1]]
      );
    }
    assert.equal(await fotografiaSemOrdens(db), antes);
  });

  it('3. Transições inválidas a partir de RASCUNHO são recusadas (→ EM_PRODUCAO, → CONCLUÍDA)', async () => {
    const rascunho = await novaOrdem(10);
    await assert.rejects(iniciarProducao(db, rascunho.id, contexto), recusa('OP_NAO_PLANEJADA'));
    await assert.rejects(executarProducao(db, rascunho.id, { correlation_id: 'op02-rascunho' }, contexto), recusa('OP_NAO_PLANEJADA'));
    await assert.rejects(salvarOrdem(db, { status: 'CONCLUIDA', origem: 'MANUAL', itens: [] }, rascunho.id, contexto), recusa('MOTOR_PRODUCAO_INDISPONIVEL'));
    await assert.rejects(salvarOrdem(db, { status: 'EM_PRODUCAO', origem: 'MANUAL', itens: [] }, rascunho.id, contexto), recusa('MOTOR_PRODUCAO_INDISPONIVEL'));
    assert.equal((await obterOrdem(db, rascunho.id)).status, 'RASCUNHO');
  });

  it('3. EM_PRODUCAO não volta para RASCUNHO nem para PLANEJADA, não reinicia e não cancela', async () => {
    const ordem = await novaOrdem(10);
    await planejarOrdem(db, ordem.id, contexto);
    await iniciarProducao(db, ordem.id, contexto);
    const antes = await fotografiaSemOrdens(db);
    await assert.rejects(planejarOrdem(db, ordem.id, contexto), recusa('MOTOR_PRODUCAO_INDISPONIVEL'));
    await assert.rejects(salvarOrdem(db, {
      origem: 'MANUAL', itens: [{ produto_id: 5, quantidade_planejada: 10, unidade: 'UN', ficha_tecnica_id: 1 }]
    }, ordem.id, contexto), recusa('MOTOR_PRODUCAO_INDISPONIVEL'));
    await assert.rejects(iniciarProducao(db, ordem.id, contexto), recusa('OP_JA_INICIADA'));
    await assert.rejects(cancelarOrdem(db, ordem.id, contexto), recusa('OP_COM_EXECUCAO'));
    assert.equal((await obterOrdem(db, ordem.id)).status, 'EM_PRODUCAO');
    assert.equal(await fotografiaSemOrdens(db), antes);
  });

  it('4. OP CANCELADA continua cancelada: não planeja, não inicia, não executa, não edita e não movimenta estoque', async () => {
    const rascunho = await novaOrdem(10);
    const antes = await fotografiaSemOrdens(db);
    assert.equal((await cancelarOrdem(db, rascunho.id, contexto)).status, 'CANCELADA');
    const planejada = await novaOrdem(10);
    await planejarOrdem(db, planejada.id, contexto);
    assert.equal((await cancelarOrdem(db, planejada.id, contexto)).status, 'CANCELADA');
    for (const id of [rascunho.id, planejada.id]) {
      await assert.rejects(planejarOrdem(db, id, contexto), recusa('STATUS_INVALIDO'));
      await assert.rejects(iniciarProducao(db, id, contexto), recusa('OP_NAO_PLANEJADA'));
      await assert.rejects(executarProducao(db, id, { correlation_id: `op02-cancelada-${id}` }, contexto), recusa('OP_CANCELADA'));
      await assert.rejects(salvarOrdem(db, { origem: 'MANUAL', itens: [] }, id, contexto), recusa('ORDEM_CANCELADA'));
      await assert.rejects(cancelarOrdem(db, id, contexto), recusa('ORDEM_CANCELADA'));
      assert.equal((await obterOrdem(db, id)).status, 'CANCELADA');
    }
    assert.equal(await fotografiaSemOrdens(db), antes);
  });

  it('5. OP CONCLUÍDA não pode ser reaberta nem voltar a outro estado', async () => {
    const ordem = await novaOrdem(10);
    await run(db, "UPDATE ordens_producao SET status = 'CONCLUIDA' WHERE id = ?", [ordem.id]);
    const antes = await fotografiaSemOrdens(db);
    await assert.rejects(planejarOrdem(db, ordem.id, contexto), recusa('MOTOR_PRODUCAO_INDISPONIVEL'));
    await assert.rejects(iniciarProducao(db, ordem.id, contexto), recusa('OP_NAO_PLANEJADA'));
    await assert.rejects(executarProducao(db, ordem.id, { correlation_id: 'op02-concluida' }, contexto), recusa('OP_CONCLUIDA'));
    await assert.rejects(salvarOrdem(db, { origem: 'MANUAL', itens: [] }, ordem.id, contexto), recusa('MOTOR_PRODUCAO_INDISPONIVEL'));
    await assert.rejects(cancelarOrdem(db, ordem.id, contexto), recusa('OP_CONCLUIDA'));
    assert.equal((await obterOrdem(db, ordem.id)).status, 'CONCLUIDA');
    assert.equal(await fotografiaSemOrdens(db), antes);
  });

  it('7 e 9. OP criada pela Necessidade mantém vínculo, referência, produto e quantidade até EM_PRODUCAO', async () => {
    const necessidade = await salvarNecessidade(db, {
      origem: 'PEDIDO_LOJA', referencia: 'Loja centro', descricao: 'Reposição',
      itens: [{ produto_id: 5, descricao: 'Picolé de Morango', quantidade: '30', unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    const criada = (await criarOrdemDaNecessidade(db, necessidade.id, contexto)).ordem;
    const antes = await fotografiaSemOrdens(db);
    await planejarOrdem(db, criada.id, contexto);
    const emProducao = await iniciarProducao(db, criada.id, contexto);
    assert.equal(emProducao.status, 'EM_PRODUCAO');
    assert.equal(emProducao.origem, 'NECESSIDADE');
    assert.equal(emProducao.necessidade_id, necessidade.id);
    assert.equal(emProducao.necessidade_codigo, necessidade.codigo);
    assert.equal(emProducao.referencia, 'Loja centro');
    assert.deepEqual(emProducao.itens.map((i) => [i.produto_id, i.quantidade_planejada, i.ficha_tecnica_id]), [[5, 30, 1]]);
    const lida = await obterNecessidade(db, necessidade.id);
    assert.deepEqual(lida.ordens_producao.map((o) => [o.id, o.status]), [[criada.id, 'EM_PRODUCAO']]);
    assert.equal(lida.resumo.produzido, 0);
    assert.equal(await fotografiaSemOrdens(db), antes);
  });

  it('Necessidade com OP cancelada continua podendo gerar nova OP (decisão da OP 01)', async () => {
    const necessidade = await salvarNecessidade(db, {
      origem: 'MANUAL', descricao: 'Reposição',
      itens: [{ produto_id: 5, descricao: 'Picolé de Morango', quantidade: '12', unidade: 'UN' }]
    });
    const primeira = (await criarOrdemDaNecessidade(db, necessidade.id, contexto)).ordem;
    await planejarOrdem(db, primeira.id, contexto);
    await cancelarOrdem(db, primeira.id, contexto);
    const nova = await criarOrdemDaNecessidade(db, necessidade.id, contexto);
    assert.equal(nova.criada, true);
    assert.notEqual(nova.ordem.id, primeira.id);
    assert.equal(nova.ordem.status, 'RASCUNHO');
    assert.equal((await obterOrdem(db, primeira.id)).status, 'CANCELADA');
  });
});

describe('OP 02 — tela da Ordem de Produção mostra o ciclo de forma simples', () => {
  const janelas = [];
  after(() => { janelas.forEach((w) => w.close()); });

  function ordem(status, extra = {}) {
    return {
      id: 41, codigo: 'OP-2026-000041', status, data_prevista: '', prioridade: 'NORMAL', origem: 'NECESSIDADE',
      observacao: '', usuario_nome: 'Ana', necessidade_id: 7, necessidade_codigo: 'NP-0007', referencia: 'Loja centro',
      producao_iniciada_em: status === 'EM_PRODUCAO' ? '2026-10-07 21:50:00' : '', producao_usuario_nome: status === 'EM_PRODUCAO' ? 'Ana' : '',
      itens: [{ id: 1, produto_id: 5, produto_nome: 'Picolé de Morango', quantidade_planejada: 50, unidade: 'UN', ficha_tecnica_id: 1, ficha: { id: 1, codigo: 'FT-001', nome: 'Picolé de Morango', status: 'ATIVA' } }],
      ...extra
    };
  }

  function abrirTela(statusInicial) {
    const dom = new JSDOM('<!doctype html><body><div id="page-content"></div></body>', {
      runScripts: 'outside-only', url: 'http://cds.teste/erp/', pretendToBeVisual: true
    });
    const w = dom.window;
    janelas.push(w);
    w.eval(fs.readFileSync(path.join(RAIZ, 'frontend', 'vendor', 'jquery', 'jquery.min.js'), 'utf8'));
    w.API_URL = 'http://cds.teste/api';
    w.notificacoes = [];
    w.showNotification = (mensagem, tipo) => w.notificacoes.push({ mensagem, tipo });
    const estado = { status: statusInicial };
    const chamadas = [];
    w.jQuery.ajax = (opcoes) => {
      const caminho = opcoes.url.replace(w.API_URL, '');
      chamadas.push({ metodo: opcoes.method, caminho });
      const resposta = w.jQuery.Deferred();
      if (opcoes.method === 'POST' && caminho === '/fabrica-loja/ordens-producao/41/planejar') {
        estado.status = 'PLANEJADA';
        resposta.resolve({ success: true, ordem: ordem(estado.status) });
      } else if (opcoes.method === 'POST' && caminho === '/fabrica-loja/ordens-producao/41/em-producao') {
        estado.status = 'EM_PRODUCAO';
        resposta.resolve({ success: true, ordem: ordem(estado.status) });
      } else if (opcoes.method === 'GET' && caminho === '/fabrica-loja/ordens-producao/41') {
        resposta.resolve({ success: true, ordem: ordem(estado.status) });
      } else if (opcoes.method === 'GET' && caminho === '/fabrica-loja/ordens-producao/41/previa-producao') {
        resposta.resolve({ success: true, previa: { consumos: [] } });
      } else if (opcoes.method === 'GET' && caminho.startsWith('/fabrica-loja/ordens-producao')) {
        resposta.resolve({ success: true, ordens: [] });
      } else if (opcoes.method === 'GET' && caminho.startsWith('/fabrica-loja/fichas')) {
        resposta.resolve({ fichas: [] });
      } else {
        resposta.resolve({});
      }
      return resposta.promise();
    };
    w.eval(fs.readFileSync(path.join(RAIZ, 'frontend', 'erp', 'js', 'ordens-producao.js'), 'utf8'));
    w._opAbrirId = 41;
    w.eval('loadOrdensProducao()');
    const doc = w.document;
    const botoes = () => Array.from(doc.querySelectorAll('#op-editor .card-footer button')).map((b) => b.textContent.trim());
    const statusNaTela = () => {
      const rotulo = Array.from(doc.querySelectorAll('#op-editor .text-muted.small')).find((el) => el.textContent === 'Status');
      return rotulo.nextElementSibling.textContent;
    };
    return { w, doc, chamadas, botoes, statusNaTela, posts: () => chamadas.filter((c) => c.metodo === 'POST').map((c) => c.caminho) };
  }

  it('Rascunho → [Planejar Produção] → Planejada → [Iniciar Produção] → Em produção, sem IDs técnicos', () => {
    const tela = abrirTela('RASCUNHO');
    assert.equal(tela.statusNaTela(), 'Rascunho');
    assert.deepEqual(tela.botoes(), ['Editar', 'Planejar Produção', 'Cancelar']);

    tela.doc.querySelector('[data-op-planejar]').click();
    assert.deepEqual(tela.posts(), ['/fabrica-loja/ordens-producao/41/planejar']);
    assert.equal(tela.doc.getElementById('op-editor').hidden, false);
    assert.equal(tela.statusNaTela(), 'Planejada');
    assert.deepEqual(tela.botoes(), ['Iniciar Produção', 'Cancelar']);

    tela.doc.querySelector('[data-op-iniciar]').click();
    assert.deepEqual(tela.posts(), ['/fabrica-loja/ordens-producao/41/planejar', '/fabrica-loja/ordens-producao/41/em-producao']);
    assert.equal(tela.statusNaTela(), 'Em produção');
    assert.ok(!tela.botoes().includes('Planejar Produção'));
    assert.ok(!tela.botoes().includes('Iniciar Produção'));
    assert.ok(!tela.botoes().includes('Cancelar'));
    assert.deepEqual(tela.w.notificacoes.map((n) => n.mensagem), [
      'Ordem planejada. Nenhuma produção foi executada.',
      'Produção iniciada. O estoque não foi movimentado.'
    ]);
    assert.ok(!tela.posts().some((p) => p.endsWith('/executar')));

    const texto = tela.doc.getElementById('op-editor').textContent;
    assert.match(texto, /Picolé de Morango/);
    assert.match(texto, /50 UN/);
    assert.match(texto, /NP-0007/);
    assert.match(texto, /Loja centro/);
    assert.doesNotMatch(texto, /EM_PRODUCAO|PLANEJADA|RASCUNHO|produto_id|necessidade_id|ficha_tecnica_id/);
  });

  it('OP planejada não oferece concluir/finalizar produção na tela', () => {
    const tela = abrirTela('PLANEJADA');
    assert.equal(tela.statusNaTela(), 'Planejada');
    assert.equal(tela.doc.querySelector('[data-op-finalizar]'), null);
    assert.ok(!tela.botoes().some((t) => /Concluir|Finalizar/.test(t)));
  });

  it('OP cancelada e concluída não oferecem ações do ciclo', () => {
    for (const [status, nome] of [['CANCELADA', 'Cancelada'], ['CONCLUIDA', 'Concluída']]) {
      const tela = abrirTela(status);
      assert.equal(tela.statusNaTela(), nome);
      for (const seletor of ['[data-op-planejar]', '[data-op-iniciar]', '[data-op-finalizar]', '[data-op-cancelar]', '#op-editar']) {
        assert.equal(tela.doc.querySelector(seletor), null, `${status} ${seletor}`);
      }
    }
  });

  it('o filtro de status da lista mostra nomes simples', () => {
    const tela = abrirTela('RASCUNHO');
    const opcoes = Array.from(tela.doc.querySelectorAll('#op-filtro-status option')).map((o) => [o.value, o.textContent]);
    assert.deepEqual(opcoes, [
      ['', 'Todos'], ['RASCUNHO', 'Rascunho'], ['PLANEJADA', 'Planejada'], ['EM_PRODUCAO', 'Em produção'],
      ['CONCLUIDA', 'Concluída'], ['CANCELADA', 'Cancelada']
    ]);
  });
});
