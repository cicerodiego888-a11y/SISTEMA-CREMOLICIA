/**
 * UX 01 — listas de seleção que fechavam sozinhas.
 *
 * Causa: o watchdog de clique do core.js (ERP e PDV) chamava electronAPI.forcarReflow
 * até 3 s depois de QUALQUER clique. O reflow esconde o body (display: none) e fecha o
 * select nativo aberto. Aqui o Electron é simulado: o relógio é controlado e o watchdog
 * é executado à mão, sem depender de tempo real.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');
const JQUERY = ler('frontend', 'vendor', 'jquery', 'jquery.min.js');
const CORE = ler('frontend', 'shared', 'js', 'core.js');
const FICHAS = ler('frontend', 'erp', 'js', 'fichas-tecnicas.js');
const NECESSIDADES = ler('frontend', 'erp', 'js', 'necessidades-producao.js');
const ORDENS = ler('frontend', 'erp', 'js', 'ordens-producao.js');

const PRODUTOS = [
  [16, '00014', 'Picolé Abacaxi'], [7, '0005', 'Picolé Açaí'], [9, '0007', 'Picolé Biscoito'],
  [21, '00019', 'Picolé Café'], [4, '0002', 'Picolé Chocolate'], [12, '00010', 'Picolé Creme'],
  [17, '00015', 'Picolé Graviola'], [14, '00012', 'Picolé Limão'], [5, '0003', 'Picolé Morango']
].map(([id, codigo, nome]) => ({ id, codigo, nome, unidade: 'UN', natureza_cadastro: 'PRODUZIDO', ativo: 1 }));

const FICHAS_CADASTRADAS = [
  { id: 2, codigo: 'FT-0002', nome: 'Picolé Abacaxi', produto_id: 16, produto_nome: 'Picolé Abacaxi', ativa: true, componentes: 2, etapas: 0, informacoes: 0 },
  { id: 3, codigo: 'FT-0003', nome: 'Picolé Abacaxi especial', produto_id: 16, produto_nome: 'Picolé Abacaxi', ativa: true, componentes: 2, etapas: 0, informacoes: 0 },
  { id: 4, codigo: 'FT-0004', nome: 'Picolé Chocolate', produto_id: 4, produto_nome: 'Picolé Chocolate', ativa: true, componentes: 1, etapas: 0, informacoes: 0 }
];

function respostaApi(metodo, caminho) {
  if (caminho.startsWith('/fabrica-loja/produtos-produzidos')) {
    const q = decodeURIComponent((caminho.match(/[?&]q=([^&]*)/) || [])[1] || '').toLowerCase();
    const produtos = PRODUTOS.filter((p) => p.nome.toLowerCase().includes(q) || p.codigo.includes(q)).slice(0, 8);
    return { success: true, produtos };
  }
  if (caminho.startsWith('/fabrica-loja/fichas')) return { success: true, fichas: FICHAS_CADASTRADAS };
  if (caminho.startsWith('/fabrica-loja/necessidades')) return { success: true, necessidades: [] };
  if (caminho.startsWith('/fabrica-loja/ordens-producao')) return { success: true, ordens: [] };
  return {};
}

const janelas = [];
after(() => janelas.forEach((w) => w.close()));

function abrirErp({ electron = true } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="page-content"></div><p id="fora">fora da lista</p></body>', {
    runScripts: 'outside-only', url: 'http://cds.teste/erp/', pretendToBeVisual: true
  });
  const w = dom.window;
  janelas.push(w);
  const intervalos = [];
  w.setInterval = (fn, ms) => { intervalos.push({ fn, ms }); return intervalos.length; };
  let agora = Date.UTC(2026, 9, 7, 12, 0, 0);
  w.Date.now = () => agora;
  const reflows = [];
  if (electron) {
    w.electronAPI = {
      forcarReflow() {
        reflows.push(w.document.activeElement);
        const corpo = w.document.body;
        corpo.style.display = 'none';
        void corpo.offsetHeight;
        corpo.style.display = '';
      }
    };
  }
  w.API_URL = 'http://cds.teste/api';
  w.localStorage.setItem('token', 'teste');
  w.eval(JQUERY);
  w.eval(CORE);
  w.notificacoes = [];
  w.showNotification = (mensagem, tipo) => w.notificacoes.push({ mensagem, tipo });
  w.eval(FICHAS);
  w.eval(NECESSIDADES);
  w.eval(ORDENS);
  w.jQuery.ajax = (opcoes) => {
    const caminho = String(opcoes.url).replace(w.API_URL, '');
    return w.jQuery.Deferred().resolve(respostaApi(opcoes.method || 'GET', caminho)).promise();
  };
  return {
    w,
    doc: w.document,
    reflows,
    /** Passa o tempo e roda o watchdog de clique do core.js como o Electron faria. */
    cicloElectron(ms = 500) {
      agora += ms;
      intervalos.filter((item) => item.ms === 3000).forEach((item) => item.fn());
    }
  };
}

function evento(w, el, tipo) {
  const Construtor = /^key/.test(tipo) ? w.KeyboardEvent : w.MouseEvent;
  el.dispatchEvent(new Construtor(tipo, { bubbles: true, cancelable: true }));
}

function clicar(w, el) {
  ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((tipo) => evento(w, el, tipo));
}

function digitar(w, campo, valor) {
  campo.focus();
  campo.value = valor;
  campo.dispatchEvent(new w.Event('input', { bubbles: true }));
}

function esc(w, el) {
  el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

async function esperar(condicao, descricao, limite = 3000) {
  const inicio = Date.now();
  for (;;) {
    const valor = condicao();
    if (valor) return valor;
    if (Date.now() - inicio > limite) throw new Error('Tempo esgotado esperando: ' + descricao);
    await new Promise((ok) => setTimeout(ok, 15));
  }
}

const nomeOpcao = (botao) => (botao.querySelector('span') || botao).textContent;

/** Telas que usam a lista de sugestões (.ft-sugestoes). */
const TELAS = {
  'Ficha Técnica → Produto fabricado': {
    abrir(erp) {
      erp.w.eval('loadFichasTecnicas()');
      erp.doc.getElementById('ft-nova').click();
    },
    campo: (erp) => erp.doc.getElementById('ft-produto-nome'),
    produtoId: (erp) => erp.doc.getElementById('ft-produto-id').value,
    nomeExibido: (erp) => erp.doc.getElementById('ft-produto-nome').value,
    reabrirBusca() {}
  },
  'Necessidade → Produto': {
    abrir(erp) {
      erp.w.eval('loadNecessidadesProducao()');
      erp.doc.getElementById('np-nova').click();
    },
    campo: (erp) => erp.doc.querySelector('[data-np-linha] [data-campo="busca"]'),
    produtoId: (erp) => erp.doc.querySelector('[data-np-linha] [data-campo="produto_id"]').value,
    nomeExibido: (erp) => (erp.doc.querySelector('[data-np-linha] .ft-selecionado strong') || {}).textContent,
    reabrirBusca(erp) {
      const alterar = erp.doc.querySelector('[data-np-alterar]');
      if (alterar) alterar.click();
    }
  },
  'OP → Produto': {
    abrir(erp) {
      erp.w.eval('loadOrdensProducao()');
      erp.doc.getElementById('op-nova').click();
    },
    campo: (erp) => erp.doc.querySelector('[data-op-linha] [data-campo="busca"]'),
    produtoId: (erp) => erp.doc.querySelector('[data-op-linha] [data-campo="produto_id"]').value,
    nomeExibido: (erp) => (erp.doc.querySelector('[data-op-linha] .ft-selecionado strong') || {}).textContent,
    reabrirBusca(erp) {
      const alterar = erp.doc.querySelector('[data-op-alterar]');
      if (alterar) alterar.click();
    }
  }
};

async function abrirLista(erp, tela, termo) {
  const campo = tela.campo(erp);
  assert.ok(campo, 'campo de busca');
  clicar(erp.w, campo);
  digitar(erp.w, campo, termo);
  const ancora = campo.parentElement;
  const lista = await esperar(() => ancora.querySelector('.ft-sugestoes'), 'lista de ' + termo);
  return { campo, lista, botoes: Array.from(lista.querySelectorAll('button')) };
}

for (const [nomeTela, tela] of Object.entries(TELAS)) {
  describe(`UX 01 — ${nomeTela}`, () => {
    function novaTela() {
      const erp = abrirErp();
      tela.abrir(erp);
      return erp;
    }

    it('1. abrir a lista mantém a lista aberta (clique no campo + ciclo do Electron)', async () => {
      const erp = novaTela();
      const { campo, lista } = await abrirLista(erp, tela, 'pico');
      for (let i = 0; i < 4; i += 1) erp.cicloElectron(500);
      assert.equal(erp.reflows.length, 0, 'nenhum reflow depois de clique comum');
      assert.equal(lista.isConnected, true);
      assert.equal(erp.doc.activeElement, campo);
      clicar(erp.w, campo);
      erp.cicloElectron(500);
      assert.equal(lista.isConnected, true, 'clicar no próprio campo não fecha');
    });

    it('2. clicar na primeira opção seleciona', async () => {
      const erp = novaTela();
      const { botoes } = await abrirLista(erp, tela, 'pico');
      assert.equal(nomeOpcao(botoes[0]), 'Picolé Abacaxi');
      clicar(erp.w, botoes[0]);
      assert.equal(tela.produtoId(erp), '16');
      assert.equal(tela.nomeExibido(erp), 'Picolé Abacaxi');
    });

    it('3. clicar em uma opção mais abaixo seleciona', async () => {
      const erp = novaTela();
      const { botoes } = await abrirLista(erp, tela, 'pico');
      assert.equal(botoes.length, 8);
      const ultima = botoes[7];
      assert.equal(nomeOpcao(ultima), 'Picolé Limão');
      evento(erp.w, ultima, 'mouseover');
      evento(erp.w, ultima, 'mousemove');
      erp.cicloElectron(500);
      clicar(erp.w, ultima);
      assert.equal(tela.produtoId(erp), '14');
      assert.equal(tela.nomeExibido(erp), 'Picolé Limão');
    });

    it('4. clique fora fecha', async () => {
      const erp = novaTela();
      const { lista } = await abrirLista(erp, tela, 'pico');
      clicar(erp.w, erp.doc.getElementById('fora'));
      assert.equal(lista.isConnected, false);
      assert.equal(tela.produtoId(erp), '');
    });

    it('5. ESC fecha', async () => {
      const erp = novaTela();
      const { campo, lista } = await abrirLista(erp, tela, 'pico');
      esc(erp.w, campo);
      assert.equal(lista.isConnected, false);
      assert.equal(tela.produtoId(erp), '');
    });

    it('6. pressionar a opção não fecha a lista antes do click', async () => {
      const erp = novaTela();
      const { lista, botoes } = await abrirLista(erp, tela, 'pico');
      const alvo = botoes[4];
      evento(erp.w, alvo, 'pointerdown');
      evento(erp.w, alvo, 'mousedown');
      erp.cicloElectron(500);
      assert.equal(lista.isConnected, true, 'lista continua aberta entre mousedown e click');
      assert.equal(alvo.isConnected, true);
      evento(erp.w, alvo, 'mouseup');
      evento(erp.w, alvo, 'click');
      assert.equal(tela.produtoId(erp), '4');
      assert.equal(erp.reflows.length, 0);
    });

    it('7. reabrir funciona normalmente', async () => {
      const erp = novaTela();
      const primeira = await abrirLista(erp, tela, 'pico');
      esc(erp.w, primeira.campo);
      assert.equal(primeira.lista.isConnected, false);
      const segunda = await abrirLista(erp, tela, 'pic');
      assert.equal(segunda.lista.isConnected, true);
      clicar(erp.w, segunda.botoes[1]);
      assert.equal(tela.produtoId(erp), '7');
      tela.reabrirBusca(erp);
      const terceira = await abrirLista(erp, tela, 'mor');
      clicar(erp.w, terceira.botoes[0]);
      assert.equal(tela.produtoId(erp), '5');
    });

    it('8. pesquisar por código e selecionar', async () => {
      const erp = novaTela();
      const { botoes } = await abrirLista(erp, tela, '00019');
      assert.deepEqual(botoes.map(nomeOpcao), ['Picolé Café']);
      clicar(erp.w, botoes[0]);
      assert.equal(tela.produtoId(erp), '21');
    });

    it('9. o produto escolhido permanece depois da escolha', async () => {
      const erp = novaTela();
      const { botoes } = await abrirLista(erp, tela, 'pico');
      clicar(erp.w, botoes[0]);
      clicar(erp.w, erp.doc.getElementById('fora'));
      esc(erp.w, erp.doc.body);
      for (let i = 0; i < 3; i += 1) erp.cicloElectron(700);
      assert.equal(tela.produtoId(erp), '16');
      assert.equal(tela.nomeExibido(erp), 'Picolé Abacaxi');
      assert.equal(erp.reflows.length, 0);
    });
  });
}

/** Select nativo de Ficha Técnica (OP e Necessidade): só é compatível com o produto escolhido. */
const SELECTS_FICHA = {
  'OP → Ficha Técnica': { tela: TELAS['OP → Produto'], seletor: '[data-op-linha] [data-campo="ficha_tecnica_id"]' },
  'Necessidade → Ficha': { tela: TELAS['Necessidade → Produto'], seletor: '[data-np-linha] [data-campo="ficha_tecnica_id"]' }
};

for (const [nomeTela, { tela, seletor }] of Object.entries(SELECTS_FICHA)) {
  describe(`UX 01 — ${nomeTela}`, () => {
    it('abrir o select e esperar não fecha (sem reflow), escolher a ficha de baixo mantém a escolha e o produto', async () => {
      const erp = abrirErp();
      tela.abrir(erp);
      const { botoes } = await abrirLista(erp, tela, 'abacaxi');
      clicar(erp.w, botoes[0]);
      const select = erp.doc.querySelector(seletor);
      assert.deepEqual(Array.from(select.options).map((o) => o.textContent), [
        'Sem ficha', 'FT-0002 — Picolé Abacaxi', 'FT-0003 — Picolé Abacaxi especial'
      ]);

      select.focus();
      clicar(erp.w, select);
      for (let i = 0; i < 4; i += 1) erp.cicloElectron(500);
      assert.equal(erp.reflows.length, 0, 'o body não é escondido com o select aberto');
      assert.equal(erp.doc.activeElement, select);
      assert.equal(select.isConnected, true);
      assert.equal(erp.doc.querySelector(seletor), select, 'o select não foi recriado');

      select.value = '3';
      select.dispatchEvent(new erp.w.Event('change', { bubbles: true }));
      clicar(erp.w, erp.doc.getElementById('fora'));
      for (let i = 0; i < 3; i += 1) erp.cicloElectron(700);
      assert.equal(erp.doc.querySelector(seletor).value, '3');
      assert.equal(tela.produtoId(erp), '16');
    });
  });
}

describe('UX 01 — watchdog de clique do core.js (ERP e PDV)', () => {
  it('clique comum no Electron não força reflow', () => {
    const erp = abrirErp();
    erp.doc.body.insertAdjacentHTML('beforeend', '<select id="s"><option>1</option><option>2</option></select>');
    const select = erp.doc.getElementById('s');
    select.focus();
    clicar(erp.w, select);
    erp.cicloElectron(500);
    erp.cicloElectron(1500);
    assert.equal(erp.reflows.length, 0);
    assert.equal(erp.doc.activeElement, select);
  });

  it('clique dentro de um modal aberto (ex.: Vender por Linha no PDV) não força reflow', () => {
    const erp = abrirErp();
    erp.doc.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade show" style="display:block"><div class="modal-body">
        <div class="list-group"><button type="button" class="list-group-item" id="linha1">Picolé Cremoso</button></div>
      </div></div>
      <div class="modal-backdrop fade show"></div>`);
    erp.doc.body.classList.add('modal-open');
    clicar(erp.w, erp.doc.getElementById('linha1'));
    erp.cicloElectron(500);
    assert.equal(erp.reflows.length, 0);
  });

  it('tela travada por modal (backdrop sem modal aberto) continua recebendo o reflow de proteção', () => {
    const erp = abrirErp();
    erp.doc.body.insertAdjacentHTML('beforeend', '<div class="modal-backdrop fade show"></div>');
    erp.doc.body.classList.add('modal-open');
    clicar(erp.w, erp.doc.body);
    erp.cicloElectron(500);
    assert.equal(erp.reflows.length, 1);
  });

  it('fora do Electron (navegador) nada muda', () => {
    const erp = abrirErp({ electron: false });
    erp.doc.body.insertAdjacentHTML('beforeend', '<div class="modal-backdrop"></div>');
    clicar(erp.w, erp.doc.body);
    assert.doesNotThrow(() => erp.cicloElectron(500));
    assert.equal(erp.reflows.length, 0);
  });
});
