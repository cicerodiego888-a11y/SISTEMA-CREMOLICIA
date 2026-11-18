/**
 * Apoio dos testes da Venda por Linha no carrinho (sprints 06+).
 * Desktop: pdv.js real inteiro no jsdom (jQuery/AJAX reais contra o servidor de teste).
 * Mobile: funções reais de pages/pdv.js (carrinho, Resolver, Venda por Linha), forms.js, formatters.js e ui.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const RAIZ = path.join(__dirname, '..', '..');
const lerFront = (rel) => fs.readFileSync(path.join(RAIZ, 'frontend', ...rel.split('/')), 'utf8');
const fonteDesktop = lerFront('pdv/js/pdv.js');
const fonteMobile = lerFront('apps/mobile/js/pages/pdv.js');
const fonteForms = lerFront('apps/mobile/js/forms.js');
const fonteFormatters = lerFront('apps/mobile/js/formatters.js');
const fonteUi = lerFront('apps/mobile/js/ui.js');

/** Mesma ordem de scripts do frontend/pdv/index.html até o pdv.js (Bootstrap é simulado). */
const SCRIPTS_DESKTOP = [
  'vendor/jquery/jquery.min.js',
  'shared/js/estacaoHostname.js', 'shared/js/validarMotivo.js', 'shared/js/modalDevolucaoVenda.js',
  'shared/js/access-control.js', 'shared/js/caixaPermissoes.js', 'shared/js/core.js', 'shared/js/configuracaoRede.js',
  'shared/js/modoFiscalHelpers.js', 'shared/js/fiscalImpressao.js', 'shared/js/comprovanteVenda.js',
  'shared/js/vendasHistoricoUi.js', 'shared/js/pdvResolucaoProduto.js', 'shared/js/pdvComercializacao.js',
  'shared/js/pdvVendaPorLinha.js', 'shared/js/pdvBuscaProduto.js', 'shared/js/pdvFormaVendaUc01.js',
  'shared/js/tefFluxoPagamento.js', 'shared/js/ComercialStatusCard.js', 'shared/js/pdvRascunhoVenda.js',
  'pdv/js/pdv.js'
];
/** Só para o teste ler/ajustar o estado léxico do pdv.js (let carrinho / produtosDisponiveis). */
const ACESSO_TESTE_PDV = `
;window.__pdvTeste = {
  carrinho: () => carrinho,
  produto: (id) => produtosDisponiveis.find((p) => Number(p.id) === Number(id)),
  definirProdutos: (lista) => { produtosDisponiveis = normalizarProdutoPdvLista(lista); }
};`;

const json = (valor) => JSON.parse(JSON.stringify(valor));

function extrairFuncao(fonte, nome) {
  let inicio = fonte.indexOf(`function ${nome}(`);
  assert.ok(inicio >= 0, `função ${nome} não encontrada`);
  if (fonte.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  let i = fonte.indexOf(') {', inicio) + 2;
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}' && --nivel === 0) break;
  }
  return fonte.slice(inicio, i + 1);
}

async function esperar(condicao, descricao, limiteMs = 6000) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`tempo esgotado esperando: ${descricao}`);
}

/** Ambiente ligado a um servidor de teste (origem = http://127.0.0.1:PORTA). */
function criarAmbiente(origem) {
  const base = `${origem}/api`;
  const janelas = [];

  async function consultar(caminho) {
    const resposta = await fetch(`${base}/${caminho}`);
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok) throw new Error((corpo && corpo.error) || `HTTP ${resposta.status}`);
    return corpo;
  }

  async function enviar(caminho, corpo) {
    const resposta = await fetch(`${base}/${caminho}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
    });
    const dados = await resposta.json().catch(() => null);
    if (!resposta.ok) throw new Error((dados && dados.error) || `HTTP ${resposta.status}`);
    return dados;
  }

  /** Preço que o Resolver oficial devolve para o produto (mesmo endpoint usado pelo PDV). */
  async function precoOficial(produtoId, quantidade = 1) {
    const r = await enviar('configuracao-comercial/resolver-precos', { itens: [{ produto_id: produtoId, quantidade }] });
    return Number(r.itens[0].preco_venda);
  }

  /** PDV Desktop real (pdv.js inteiro) com Bootstrap Modal simulado. */
  async function abrirDesktop() {
    const dom = new JSDOM(`<!doctype html><body>
        <div id="notification-container"></div>
        <button id="btnVenderPorLinhaPdv" class="pdv-btn-vender-linha d-none">Vender por Linha</button>
        <table><tbody id="tabelaItensVendaPdv"></tbody></table>
      </body>`, { runScripts: 'outside-only', url: `${origem}/pdv/`, pretendToBeVisual: true });
    const w = dom.window;
    janelas.push(w);
    w.currentPage = 'pdv-teste';
    w.CONFIG_IMPLANTACAO = null;
    w.fetch = (url, opcoes) => fetch(new URL(String(url), origem), opcoes);
    w.localStorage.setItem('token', 'token-teste');
    class ModalSimulado {
      constructor(el) { this.el = el; }
      show() { this.el.classList.add('show'); w.jQuery(this.el).trigger('shown.bs.modal'); }
      hide() { this.el.classList.remove('show'); w.jQuery(this.el).trigger('hidden.bs.modal'); }
      static getOrCreateInstance(el) { return new ModalSimulado(el); }
      static getInstance(el) { return new ModalSimulado(el); }
    }
    w.bootstrap = { Modal: ModalSimulado };
    for (const script of SCRIPTS_DESKTOP) {
      w.eval(lerFront(script) + (script === 'pdv/js/pdv.js' ? ACESSO_TESTE_PDV : ''));
    }
    w.eval(`
      window.__notificacoes = [];
      showNotification = function (mensagem, tipo) { __notificacoes.push({ mensagem, tipo }); };
    `);
    w.__pdvTeste.definirProdutos(await consultar('produtos?modo_fiscal=0&contexto=pdv'));
    await w.carregarComercializacaoPdv();
    w.atualizarOpcaoVendaPorLinhaPdv();
    return w;
  }

  const visivelDesktop = (w, id) => { const el = w.document.getElementById(id); return !!el && !el.classList.contains('d-none'); };

  /** Desktop: abre a Linha e preenche as quantidades individuais, sem avançar automaticamente. */
  async function desktopConcluido(w, linhaId, total, distribuicao) {
    const $ = w.jQuery;
    const visivel = (id) => visivelDesktop(w, id);
    w.abrirVendaPorLinhaPdv();
    await esperar(() => w.document.querySelector(`[data-linha-id="${linhaId}"]`), 'lista de linhas');
    $(`[data-linha-id="${linhaId}"]`).trigger('click');
    await esperar(() => visivel('etapaProdutosLinhaPdv'), 'etapa da linha');
    for (const [produtoId, valor] of distribuicao) {
      $(`[data-quantidade-produto-id="${produtoId}"]`).val(valor).trigger('input');
    }
    return { $, visivel };
  }

  /** Desktop: clica em "Continuar" e espera o modal fechar ou a validação aparecer. */
  async function desktopAdicionar(w) {
    const $ = w.jQuery;
    $('#erroQuantidadeProdutosLinhaPdv').text('');
    $('#btnContinuarLinhaPdv').trigger('click');
    await esperar(
      () => !w.document.getElementById('modalVendaPorLinhaPdv')
        || $('#erroQuantidadeProdutosLinhaPdv').text()
        || $('#listaProdutosLinhaPdv .is-invalid').length,
      'resultado da inclusão'
    );
    if (!w.document.getElementById('modalVendaPorLinhaPdv')) return null;
    return $('#erroQuantidadeProdutosLinhaPdv').text()
      || $('#listaProdutosLinhaPdv .is-invalid').first().siblings('.invalid-feedback').text();
  }

  const itensDesktop = (w) => json(w.__pdvTeste.carrinho()).map((item) => ({ id: item.id, nome: item.nome, quantidade: item.quantidade }));

  async function abrirMobile() {
    const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { runScripts: 'outside-only', url: `${origem}/mobile/`, pretendToBeVisual: true });
    const w = dom.window;
    janelas.push(w);
    w.eval(lerFront('shared/js/pdvComercializacao.js'));
    w.eval(lerFront('shared/js/pdvVendaPorLinha.js'));
    w.CDSApi = { get: (caminho) => consultar(caminho), post: (caminho, corpo) => enviar(caminho, corpo) };
    w.toasts = [];
    w.pinturas = 0;
    w.eval(`
      var CART_KEY = 'cds-mobile-pdv-cart';
      var META_KEY = 'cds-mobile-pdv-meta';
      function icon() { return ''; }
      function showToast(mensagem, tipo) { toasts.push({ mensagem, tipo }); }
      function paintCart() { pinturas += 1; }
    `);
    const funcoes = [
      [fonteFormatters, ['asText', 'escapeHtml']],
      [fonteUi, ['loadingHtml', 'emptyHtml', 'searchBarHtml', 'debounce']],
      [fonteForms, ['fieldHtml', 'openBottomSheet', 'closeBottomSheet']],
      [fonteMobile, [
        'loadCart', 'saveCart', 'loadMeta', 'saveMeta', 'montarItensResolver', 'resolverPrecosOficial',
        'aplicarResolverNoCarrinho', 'recalcularCarrinhoViaResolver', 'incluirItemNoCarrinhoMobile',
        'adicionarDistribuicaoLinhaNoCarrinhoMobile',
        'carregarComercializacaoMobile', 'atualizarOpcaoVendaPorLinhaMobile', 'bindVendaPorLinhaMobile', 'abrirVendaPorLinhaMobile'
      ]]
    ];
    for (const [fonte, nomes] of funcoes) {
      for (const nome of nomes) w.eval(extrairFuncao(fonte, nome));
    }
    const root = w.document.getElementById('root');
    root.innerHTML = `<button type="button" class="cds-quick" id="pdv-venda-linha" style="display:none">Vender por Linha</button>
      <div id="pdv-cart"></div><div class="cds-pdv-sticky" id="pdv-sticky"></div>`;
    await w.carregarComercializacaoMobile();
    w.bindVendaPorLinhaMobile(root, true);
    await w.PdvComercializacao.pronto();
    return { w, root };
  }

  /** Mobile: abre a Linha pelo botão, informa o total, distribui e conclui (sem adicionar ainda). */
  async function mobileConcluido(w, root, linhaId, total, distribuicao) {
    const doc = w.document;
    root.querySelector('#pdv-venda-linha').click();
    await esperar(() => doc.querySelector(`[data-linha-id="${linhaId}"]`), 'lista de linhas');
    doc.querySelector(`[data-linha-id="${linhaId}"]`).click();
    await esperar(() => doc.getElementById('f-linha_quantidade_total'), 'campo de quantidade');
    doc.getElementById('f-linha_quantidade_total').value = total;
    const continuar = doc.getElementById('pdv-linha-continuar');
    const voltar = doc.getElementById('pdv-linha-voltar');
    continuar.click();
    for (const [produtoId, valor] of distribuicao) {
      const campo = doc.querySelector(`[data-distribuir-produto-id="${produtoId}"]`);
      campo.value = valor;
      campo.dispatchEvent(new w.Event('input', { bubbles: true }));
    }
    continuar.click();
    assert.match(doc.getElementById('pdv-linha-corpo').textContent, /Distribuição concluída\./);
    assert.equal(continuar.textContent, 'Adicionar ao carrinho');
    return { continuar, voltar };
  }

  const carrinhoMobile = (w) => JSON.parse(w.sessionStorage.getItem('cds-mobile-pdv-cart') || '[]');
  const itensMobile = (w) => carrinhoMobile(w).map((item) => ({ id: Number(item.id), nome: item.nome, qtd: item.qtd }));

  function fechar() {
    janelas.forEach((w) => w.close());
    janelas.length = 0;
  }

  return {
    base, consultar, enviar, precoOficial,
    abrirDesktop, visivelDesktop, desktopConcluido, desktopAdicionar, itensDesktop,
    abrirMobile, mobileConcluido, carrinhoMobile, itensMobile,
    fechar
  };
}

module.exports = { json, extrairFuncao, esperar, fonteDesktop, fonteMobile, criarAmbiente };
