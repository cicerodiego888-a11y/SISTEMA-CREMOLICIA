/**
 * NECESSIDADE 02 — Nova necessidade com origem "Pedidos da Loja" exige pedido OU referência
 * antes do POST. Tela real (necessidades-producao.js) no jsdom com $.ajax interceptado.
 * O backend continua rejeitando o mesmo caso (banco temporário; não usa o banco oficial).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const sqlite3 = require('sqlite3');

const RAIZ = path.join(__dirname, '..', '..');
const lerFront = (rel) => fs.readFileSync(path.join(RAIZ, 'frontend', ...rel.split('/')), 'utf8');
const MENSAGEM = 'Informe o pedido ou a necessidade da loja.';
const ORIENTACAO = 'Informe uma referência da necessidade ou altere a origem para Manual.';

const janelas = [];

function abrirTela({ pedidos = [], necessidade = null } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="page-content"></div></body>', {
    runScripts: 'outside-only', url: 'http://cds.teste/erp/', pretendToBeVisual: true
  });
  const w = dom.window;
  janelas.push(w);
  w.eval(lerFront('vendor/jquery/jquery.min.js'));
  w.API_URL = 'http://cds.teste/api';
  w.notificacoes = [];
  w.showNotification = (mensagem, tipo) => w.notificacoes.push({ mensagem, tipo });
  const chamadas = [];
  w.jQuery.ajax = (opcoes) => {
    const caminho = opcoes.url.replace(w.API_URL, '');
    const chamada = { metodo: opcoes.method, caminho, dados: opcoes.data ? JSON.parse(opcoes.data) : null };
    chamadas.push(chamada);
    const resposta = w.jQuery.Deferred();
    if (chamada.metodo === 'GET' && caminho.startsWith('/fabrica-loja/demanda-pedidos')) resposta.resolve({ pedidos });
    else if (chamada.metodo === 'GET' && caminho.startsWith('/fabrica-loja/fichas')) resposta.resolve({ fichas: [] });
    else if (chamada.metodo === 'GET' && necessidade && caminho === `/fabrica-loja/necessidades/${necessidade.id}`) resposta.resolve({ success: true, necessidade });
    else if (chamada.metodo === 'GET' && caminho.startsWith('/fabrica-loja/necessidades')) resposta.resolve({ necessidades: necessidade ? [necessidade] : [] });
    else if (chamada.metodo === 'POST') resposta.resolve({ success: true, necessidade: { id: 1 } });
    else if (chamada.metodo === 'PUT') resposta.resolve({ success: true, necessidade });
    else resposta.resolve({});
    return resposta.promise();
  };
  w.eval(lerFront('erp/js/necessidades-producao.js'));
  w.eval('loadNecessidadesProducao()');
  const doc = w.document;
  if (necessidade) doc.querySelector(`[data-np-abrir="${necessidade.id}"]`).click();
  else doc.getElementById('np-nova').click();

  const tela = {
    w,
    doc,
    chamadas,
    posts: () => chamadas.filter((c) => c.metodo === 'POST'),
    puts: () => chamadas.filter((c) => c.metodo === 'PUT'),
    origem(valor) {
      const campo = doc.getElementById('np-origem');
      campo.value = valor;
      campo.dispatchEvent(new w.Event('change', { bubbles: true }));
    },
    preencherBasico({ produto = { id: 16, nome: 'PICOLE ABACAXI', unidade: 'un' }, quantidade = '10' } = {}) {
      doc.getElementById('np-descricao').value = 'Produção para a loja';
      const linha = doc.querySelector('#np-itens [data-np-linha]');
      w.npAplicarProduto(linha, produto);
      linha.querySelector('[data-campo="quantidade"]').value = quantidade;
    },
    salvar() {
      doc.getElementById('np-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    },
    erro() {
      const aviso = doc.getElementById('np-erro');
      return aviso && !aviso.classList.contains('d-none') ? aviso.textContent.trim() : '';
    }
  };
  return tela;
}

describe('Necessidade — origem Pedidos da Loja exige pedido ou referência antes do envio', () => {
  after(() => { janelas.forEach((w) => w.close()); });

  it('1. Pedidos da Loja com pedido_id envia o POST normal', () => {
    const tela = abrirTela();
    tela.origem('PEDIDO_LOJA');
    tela.preencherBasico();
    tela.doc.getElementById('np-pedido-id').value = '8';
    tela.salvar();
    const posts = tela.posts();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].caminho, '/fabrica-loja/necessidades');
    assert.equal(posts[0].dados.origem, 'PEDIDO_LOJA');
    assert.equal(posts[0].dados.pedido_id, '8');
    assert.equal(posts[0].dados.referencia, '');
    assert.equal(tela.erro(), '');
  });

  it('2. Pedidos da Loja com referência (sem pedido) envia o POST normal', () => {
    const tela = abrirTela();
    tela.origem('PEDIDO_LOJA');
    tela.preencherBasico();
    tela.doc.getElementById('np-referencia').value = 'Reposição da vitrine';
    tela.salvar();
    const posts = tela.posts();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].dados.pedido_id, '');
    assert.equal(posts[0].dados.referencia, 'Reposição da vitrine');
  });

  it('2b. Pedidos da Loja com pedidos marcados na lista envia o POST normal com pedidos[]', () => {
    const tela = abrirTela({
      pedidos: [
        { id: 8, codigo: 'PED-0008', cliente_nome: 'Loja', itens: [{ produto_id: 16, produto_nome: 'PICOLE ABACAXI', quantidade_elegivel: 4, unidade: 'un' }] },
        { id: 9, codigo: 'PED-0009', cliente_nome: 'Loja', itens: [{ produto_id: 16, produto_nome: 'PICOLE ABACAXI', quantidade_elegivel: 2, unidade: 'un' }] }
      ]
    });
    tela.origem('PEDIDO_LOJA');
    tela.preencherBasico();
    tela.doc.querySelectorAll('.np-marcar-pedido').forEach((marca) => { marca.checked = true; });
    tela.salvar();
    const posts = tela.posts();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].dados.pedido_id, '');
    assert.equal(posts[0].dados.referencia, '');
    assert.deepEqual(posts[0].dados.pedidos.map((p) => p.pedido_id), ['8', '9']);
  });

  it('3, 4 e 6. Pedidos da Loja sem pedido e sem referência não envia o POST e mostra a mensagem exata', () => {
    const tela = abrirTela();
    tela.origem('PEDIDO_LOJA');
    tela.preencherBasico();
    tela.doc.getElementById('np-referencia').value = '   ';
    tela.salvar();
    assert.equal(tela.posts().length, 0);
    assert.equal(tela.erro(), MENSAGEM);
    assert.equal(tela.doc.getElementById('np-salvar').disabled, false);
    assert.equal(tela.doc.getElementById('np-origem').value, 'PEDIDO_LOJA');
    assert.equal(tela.doc.getElementById('np-referencia').value, '   ');
    assert.equal(tela.doc.getElementById('np-pedido-id').value, '');
    assert.equal(tela.doc.getElementById('np-editor').hidden, false);
  });

  it('3b. Depois do aviso, informar a referência libera o envio', () => {
    const tela = abrirTela();
    tela.origem('PEDIDO_LOJA');
    tela.preencherBasico();
    tela.salvar();
    assert.equal(tela.posts().length, 0);
    tela.doc.getElementById('np-referencia').value = 'Pedido do balcão';
    tela.salvar();
    assert.equal(tela.posts().length, 1);
    assert.equal(tela.posts()[0].dados.referencia, 'Pedido do balcão');
  });

  it('5. Manual sem pedido e sem referência continua enviando', () => {
    const tela = abrirTela();
    assert.equal(tela.doc.getElementById('np-origem').value, 'MANUAL');
    tela.preencherBasico();
    tela.salvar();
    const posts = tela.posts();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].dados.origem, 'MANUAL');
    assert.equal(posts[0].dados.pedido_id, '');
    assert.equal(posts[0].dados.referencia, '');
    assert.equal(tela.erro(), '');
  });

  it('5b. Outras origens (Abastecimento e Planejamento) sem pedido/referência continuam enviando', () => {
    for (const origem of ['ABASTECIMENTO', 'PLANEJAMENTO']) {
      const tela = abrirTela();
      tela.origem(origem);
      tela.preencherBasico();
      tela.salvar();
      assert.equal(tela.posts().length, 1, origem);
      assert.equal(tela.posts()[0].dados.origem, origem);
    }
  });

  it('7. Produto e quantidade válidos seguem no payload sem alteração', () => {
    const tela = abrirTela();
    tela.origem('PEDIDO_LOJA');
    tela.preencherBasico({ produto: { id: 56, nome: 'SORVETE KG', unidade: 'kg' }, quantidade: '2,5' });
    tela.doc.getElementById('np-referencia').value = 'Loja centro';
    tela.salvar();
    const posts = tela.posts();
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].dados.itens, [
      { produto_id: '56', descricao: 'SORVETE KG', quantidade: '2,5', unidade: 'kg', ficha_tecnica_id: '' }
    ]);
    assert.deepEqual(Object.keys(posts[0].dados).sort(), [
      'codigo', 'data_necessidade', 'descricao', 'itens', 'observacoes', 'origem', 'pedido_id', 'referencia', 'status'
    ]);
  });

  it('7b. A validação de produto não selecionado continua valendo como antes', () => {
    const tela = abrirTela();
    tela.origem('PEDIDO_LOJA');
    tela.doc.getElementById('np-descricao').value = 'Sem produto';
    tela.doc.querySelector('#np-itens [data-campo="quantidade"]').value = '3';
    tela.salvar();
    assert.equal(tela.posts().length, 0);
    assert.equal(tela.erro(), 'Selecione um produto cadastrado para o item da necessidade.');
  });

  it('Sem pedidos disponíveis mostra a orientação junto da mensagem, sem mudar a origem', () => {
    const tela = abrirTela({ pedidos: [] });
    tela.origem('PEDIDO_LOJA');
    const lista = tela.doc.getElementById('np-lista-pedidos');
    assert.match(lista.textContent, /Nenhum pedido da loja disponível\./);
    assert.equal(tela.doc.getElementById('np-orientacao-sem-pedidos').textContent, ORIENTACAO);
    assert.equal(tela.doc.getElementById('np-origem').value, 'PEDIDO_LOJA');
    assert.equal(tela.doc.getElementById('np-referencia').value, '');
    assert.equal(tela.doc.getElementById('np-pedido-id').value, '');
    assert.equal(tela.posts().length, 0);
  });

  it('8. O backend continua rejeitando Pedidos da Loja sem pedido e sem referência (última proteção)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-necessidade-02-'));
    const db = new sqlite3.Database(path.join(dir, 'necessidade.db'));
    try {
      const { salvarNecessidade } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
      await assert.rejects(
        salvarNecessidade(db, {
          origem: 'PEDIDO_LOJA', pedido_id: '', referencia: '', descricao: 'Teste',
          itens: [{ produto_id: '', descricao: 'Item', quantidade: '1', unidade: 'un' }]
        }),
        (err) => err.code === 'ORIGEM_SEM_REFERENCIA' && err.message === MENSAGEM && err.statusCode === 400
      );
    } finally {
      await new Promise((resolve) => db.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** NECESSIDADE 03 — mesma regra na edição (PUT) de uma necessidade existente, aberta pela lista. */
function necessidadeExistente(extra = {}) {
  return {
    id: 5,
    codigo: 'NP-0005',
    origem: 'PEDIDO_LOJA',
    origem_nome: 'Pedidos da Loja',
    pedido_id: null,
    referencia: '',
    descricao: 'Reposição da loja',
    data_necessidade: '2026-10-10',
    status: 'ABERTA',
    observacoes: 'Entregar cedo',
    itens: [{ id: 1, ordem: 1, produto_id: 16, descricao: 'PICOLE ABACAXI', quantidade: 10, unidade: 'un', ficha_tecnica_id: null }],
    pedidos: [],
    atendimento: { solicitado: 10, planejado: 0, produzido: 0, restante: 10, status: 'ABERTA', itens: [] },
    resumo: { solicitado: 10, planejado: 0, produzido: 0, restante: 10 },
    ordens_producao: [],
    historico: [],
    pode_criar_op: true,
    pode_cancelar: true,
    ...extra
  };
}

const PEDIDOS_DEMANDA = [
  { id: 8, codigo: 'PED-0008', cliente_nome: 'Loja', itens: [{ produto_id: 16, produto_nome: 'PICOLE ABACAXI', quantidade_elegivel: 4, unidade: 'un' }] },
  { id: 9, codigo: 'PED-0009', cliente_nome: 'Loja', itens: [{ produto_id: 16, produto_nome: 'PICOLE ABACAXI', quantidade_elegivel: 6, unidade: 'un' }] }
];

describe('Necessidade — edição com origem Pedidos da Loja exige pedido, pedidos[] ou referência antes do PUT', () => {
  after(() => { janelas.forEach((w) => w.close()); });

  it('abre o formulário de edição real da necessidade existente', () => {
    const tela = abrirTela({ necessidade: necessidadeExistente({ referencia: 'Loja centro' }) });
    assert.equal(tela.doc.querySelector('#np-form h2').textContent, 'Editar necessidade');
    assert.equal(tela.doc.getElementById('np-id').value, '5');
    assert.equal(tela.doc.getElementById('np-origem').value, 'PEDIDO_LOJA');
  });

  it('1. Pedidos da Loja com pedido_id envia o PUT com o payload de sempre', () => {
    const tela = abrirTela({ necessidade: necessidadeExistente({ pedido_id: 8 }) });
    tela.salvar();
    const puts = tela.puts();
    assert.equal(puts.length, 1);
    assert.equal(puts[0].caminho, '/fabrica-loja/necessidades/5');
    assert.equal(puts[0].dados.origem, 'PEDIDO_LOJA');
    assert.equal(puts[0].dados.pedido_id, '8');
    assert.equal(puts[0].dados.referencia, '');
    assert.equal(tela.posts().length, 0);
    assert.equal(tela.erro(), '');
  });

  it('2. Pedidos da Loja com vários pedidos selecionados (pedido_id vazio) envia o PUT com pedidos[]', () => {
    const tela = abrirTela({
      pedidos: PEDIDOS_DEMANDA,
      necessidade: necessidadeExistente({
        pedidos: [
          { pedido_id: 8, codigo: 'PED-0008', itens: [{ produto_id: 16, produto_nome: 'PICOLE ABACAXI', quantidade: 4, unidade: 'un' }] },
          { pedido_id: 9, codigo: 'PED-0009', itens: [{ produto_id: 16, produto_nome: 'PICOLE ABACAXI', quantidade: 6, unidade: 'un' }] }
        ]
      })
    });
    assert.equal(tela.doc.querySelectorAll('.np-marcar-pedido:checked').length, 2);
    tela.salvar();
    const puts = tela.puts();
    assert.equal(puts.length, 1);
    assert.equal(puts[0].dados.pedido_id, '');
    assert.equal(puts[0].dados.referencia, '');
    assert.deepEqual(puts[0].dados.pedidos.map((p) => p.pedido_id), ['8', '9']);
  });

  it('3. Pedidos da Loja com referência envia o PUT', () => {
    const tela = abrirTela({ necessidade: necessidadeExistente({ referencia: 'Loja centro' }) });
    tela.salvar();
    const puts = tela.puts();
    assert.equal(puts.length, 1);
    assert.equal(puts[0].dados.pedido_id, '');
    assert.equal(puts[0].dados.referencia, 'Loja centro');
  });

  it('4, 5 e 10. Sem pedido, sem pedidos[] e sem referência: nenhum PUT, mensagem exata e campos preservados', () => {
    const tela = abrirTela({ pedidos: PEDIDOS_DEMANDA, necessidade: necessidadeExistente({ referencia: 'Loja centro' }) });
    tela.doc.getElementById('np-referencia').value = '';
    tela.doc.getElementById('np-descricao').value = 'Descrição alterada';
    tela.doc.querySelector('#np-itens [data-campo="quantidade"]').value = '12';
    tela.salvar();
    assert.equal(tela.puts().length, 0);
    assert.equal(tela.posts().length, 0);
    assert.equal(tela.erro(), MENSAGEM);
    assert.equal(tela.doc.getElementById('np-salvar').disabled, false);
    assert.equal(tela.doc.getElementById('np-editor').hidden, false);
    assert.equal(tela.doc.getElementById('np-id').value, '5');
    assert.equal(tela.doc.getElementById('np-origem').value, 'PEDIDO_LOJA');
    assert.equal(tela.doc.getElementById('np-referencia').value, '');
    assert.equal(tela.doc.getElementById('np-pedido-id').value, '');
    assert.equal(tela.doc.getElementById('np-descricao').value, 'Descrição alterada');
    assert.equal(tela.doc.getElementById('np-data').value, '2026-10-10');
    assert.equal(tela.doc.getElementById('np-observacoes').value, 'Entregar cedo');
    const linha = tela.doc.querySelector('#np-itens [data-np-linha]');
    assert.equal(linha.querySelector('[data-campo="produto_id"]').value, '16');
    assert.equal(linha.querySelector('[data-campo="quantidade"]').value, '12');
    assert.equal(tela.doc.querySelectorAll('[data-np-pedido]').length, 2);
    assert.equal(tela.doc.querySelectorAll('.np-marcar-pedido:checked').length, 0);
  });

  it('4b. Desmarcar o único pedido selecionado e deixar sem referência também bloqueia o PUT, sem apagar a lista', () => {
    const tela = abrirTela({
      pedidos: PEDIDOS_DEMANDA,
      necessidade: necessidadeExistente({
        pedidos: [{ pedido_id: 8, codigo: 'PED-0008', itens: [{ produto_id: 16, produto_nome: 'PICOLE ABACAXI', quantidade: 4, unidade: 'un' }] }]
      })
    });
    tela.doc.querySelectorAll('.np-marcar-pedido').forEach((marca) => { marca.checked = false; });
    tela.salvar();
    assert.equal(tela.puts().length, 0);
    assert.equal(tela.erro(), MENSAGEM);
    assert.equal(tela.doc.querySelectorAll('[data-np-pedido]').length, 2);
  });

  it('6. Referência só com espaços é tratada como vazia na edição', () => {
    const tela = abrirTela({ necessidade: necessidadeExistente({ referencia: 'Loja centro' }) });
    tela.doc.getElementById('np-referencia').value = '    ';
    tela.salvar();
    assert.equal(tela.puts().length, 0);
    assert.equal(tela.erro(), MENSAGEM);
    assert.equal(tela.doc.getElementById('np-referencia').value, '    ');
  });

  it('6b. Depois do aviso, informar a referência libera o PUT', () => {
    const tela = abrirTela({ necessidade: necessidadeExistente() });
    tela.salvar();
    assert.equal(tela.puts().length, 0);
    tela.doc.getElementById('np-referencia').value = 'Pedido do balcão';
    tela.salvar();
    assert.equal(tela.puts().length, 1);
    assert.equal(tela.puts()[0].dados.referencia, 'Pedido do balcão');
  });

  for (const [numero, origem] of [['7', 'MANUAL'], ['8', 'ABASTECIMENTO'], ['9', 'PLANEJAMENTO']]) {
    it(`${numero}. ${origem} continua editando sem pedido e sem referência`, () => {
      const tela = abrirTela({ necessidade: necessidadeExistente({ origem, origem_nome: origem }) });
      assert.equal(tela.doc.getElementById('np-origem').value, origem);
      tela.salvar();
      const puts = tela.puts();
      assert.equal(puts.length, 1);
      assert.equal(puts[0].caminho, '/fabrica-loja/necessidades/5');
      assert.equal(puts[0].dados.origem, origem);
      assert.equal(puts[0].dados.pedido_id, '');
      assert.equal(puts[0].dados.referencia, '');
      assert.equal(tela.erro(), '');
    });
  }

  it('11. O backend continua rejeitando a edição inválida enviada diretamente (última proteção)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-necessidade-03-'));
    const db = new sqlite3.Database(path.join(dir, 'necessidade.db'));
    const executar = (sql) => new Promise((resolve, reject) => db.run(sql, (err) => (err ? reject(err) : resolve())));
    try {
      await executar('CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT, estoque_atual REAL, natureza_cadastro TEXT, ativo INTEGER DEFAULT 1)');
      await executar("INSERT INTO produtos (id, nome, estoque_atual, natureza_cadastro) VALUES (16, 'PICOLE ABACAXI', 0, 'PRODUZIDO')");
      const { salvarNecessidade } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
      const criada = await salvarNecessidade(db, {
        origem: 'MANUAL', descricao: 'Base', itens: [{ produto_id: '16', descricao: 'PICOLE ABACAXI', quantidade: '10', unidade: 'un' }]
      });
      for (const referencia of ['', '   ']) {
        await assert.rejects(
          salvarNecessidade(db, {
            origem: 'PEDIDO_LOJA', pedido_id: '', referencia, descricao: 'Base',
            itens: [{ produto_id: '16', descricao: 'PICOLE ABACAXI', quantidade: '10', unidade: 'un' }]
          }, criada.id),
          (err) => err.code === 'ORIGEM_SEM_REFERENCIA' && err.message === MENSAGEM && err.statusCode === 400
        );
      }
    } finally {
      await new Promise((resolve) => db.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
