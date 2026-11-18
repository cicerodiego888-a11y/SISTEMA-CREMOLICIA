'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const fonte = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/compras.js'), 'utf8');

function recorte(inicio, fim) {
  const i = fonte.indexOf(inicio);
  const f = fonte.indexOf(fim, i);
  assert.ok(i >= 0 && f > i, `recorte ${inicio}`);
  return fonte.slice(i, f);
}

function criarContexto(itens, extras = {}) {
  const html = { tbody: '' };
  const notificacoes = [];
  const ajax = [];
  const contexto = {
    itensCompraAtual: itens,
    produtosCompraList: [{ id: 1, nome: 'Farinha', natureza_cadastro: 'INSUMO' }],
    itemCompraEmEdicao: null,
    $: Object.assign((seletor) => ({
      html: (v) => { if (seletor === '#itensCompraBody') html.tbody = v; },
      is: () => false,
      val: () => ''
    }), { ajax: (o) => { ajax.push(o); return { done() { return this; }, fail() { return this; } }; } }),
    produtosPermitidosSelecaoCompra: (l) => l,
    renderAvisoProdutoNaoCadastrado: () => '',
    renderMiipSugestaoCard: () => '',
    renderFiscalEntradaItemCompra: () => '<div data-fiscal-uso-consumo></div>',
    formatarQuantidadeItemCompra: () => '1',
    formatarPrecoCompraItem: () => '1',
    itemCompraEhFracionado: () => false,
    formatCurrency: (v) => String(v),
    formatNumberInput: (v) => String(v),
    formatarCustoUnitarioVenda: (v) => String(v),
    recalcularTotaisCompraNota: () => {},
    calcularParcelasCompra: () => {},
    validarFiscalEntradaItemCompra: () => {},
    showNotification: (msg, tipo) => notificacoes.push({ msg, tipo }),
    isEntradaProducaoPropriaCompra: () => false,
    obterTipoEntradaCompra: () => 'NORMAL',
    requisicaoCompraEmAndamento: false,
    API_URL: '/api',
    ...extras
  };
  vm.createContext(contexto);
  vm.runInContext(recorte('function sugerirDestinoItemCompra', 'function escapeHtml'), contexto);
  contexto.renderFiscalEntradaItemCompra = () => '<div data-fiscal-uso-consumo></div>';
  contexto.validarFiscalEntradaItemCompra = () => {};
  vm.runInContext(recorte('function escapeHtml', '\nfunction ', ) + '', contexto);
  return { contexto, html, notificacoes, ajax };
}

describe('Compras — finalidade explícita do item (UI)', () => {
  it('exibe coluna Finalidade e as opções INSUMO e USO_E_CONSUMO', () => {
    assert.match(fonte, /<th>Finalidade<\/th>/);
    const { contexto, html } = criarContexto([{ produto_id: 1, produto_nome: 'Farinha', finalidade_item: '' }]);
    contexto.renderItensCompraTabela();
    assert.match(html.tbody, /data-finalidade-item="0"/);
    assert.match(html.tbody, /<option value="INSUMO"/);
    assert.match(html.tbody, /<option value="USO_E_CONSUMO"/);
  });

  it('não seleciona finalidade automaticamente e identifica o item pendente', () => {
    const { contexto, html } = criarContexto([{ produto_id: 1, produto_nome: 'Farinha', finalidade_item: '' }]);
    contexto.renderItensCompraTabela();
    assert.doesNotMatch(html.tbody, /<option value="INSUMO"\s+selected/);
    assert.doesNotMatch(html.tbody, /<option value="USO_E_CONSUMO"\s+selected/);
    assert.match(html.tbody, /<option value="" disabled\s+selected>Selecione/);
    assert.match(html.tbody, /Escolha a finalidade/);
    assert.match(fonte, /finalidade_item: finalidadeValidaItemCompra\(item\.finalidade_item\)/);
    assert.equal(contexto.finalidadeValidaItemCompra(undefined), '');
    assert.equal(contexto.finalidadeValidaItemCompra('qualquer'), '');
  });

  it('INSUMO mantém o destino de estoque; USO_E_CONSUMO mostra o tratamento fiscal', () => {
    const { contexto, html } = criarContexto([
      { produto_id: 1, finalidade_item: 'INSUMO' },
      { produto_id: 1, finalidade_item: 'USO_E_CONSUMO' }
    ]);
    contexto.renderItensCompraTabela();
    const [linhaInsumo, linhaUso] = html.tbody.split('<tr>').slice(1);
    assert.match(linhaInsumo, /<option value="INSUMO"\s+selected/);
    assert.match(linhaInsumo, /data-destino-estoque="0"/);
    assert.doesNotMatch(linhaInsumo, /data-fiscal-uso-consumo/);
    assert.match(linhaUso, /<option value="USO_E_CONSUMO"\s+selected/);
    assert.match(linhaUso, /data-fiscal-uso-consumo/);
    assert.doesNotMatch(linhaUso, /data-destino-estoque/);
  });

  it('alterar a finalidade aceita só valores válidos', () => {
    const item = { produto_id: 1, finalidade_item: '' };
    const { contexto } = criarContexto([item]);
    contexto.alterarFinalidadeItemCompra(0, 'INSUMO');
    assert.equal(item.finalidade_item, 'INSUMO');
    contexto.alterarFinalidadeItemCompra(0, 'USO_E_CONSUMO');
    assert.equal(item.finalidade_item, 'USO_E_CONSUMO');
    contexto.alterarFinalidadeItemCompra(0, 'xyz');
    assert.equal(item.finalidade_item, '');
  });

  it('a gravação é bloqueada com item sem finalidade, listando os pendentes', () => {
    const itens = [
      { produto_id: 1, produto_nome: 'Farinha', finalidade_item: 'INSUMO', destino_estoque: 'FABRICA' },
      { produto_id: 1, produto_nome: 'Detergente', finalidade_item: '' }
    ];
    const { contexto, notificacoes, ajax } = criarContexto(itens);
    vm.runInContext(recorte('function saveCompra', '\nfunction toggleNotaFiscalAvulsa'), contexto);
    contexto.saveCompra();
    assert.equal(ajax.length, 0, 'nenhum POST');
    assert.equal(notificacoes.length, 1);
    assert.match(notificacoes[0].msg, /finalidade/);
    assert.match(notificacoes[0].msg, /2 \(Detergente\)/);
    assert.doesNotMatch(notificacoes[0].msg, /1 \(Farinha\)/);
  });

  it('a finalidade escolhida é enviada no payload', () => {
    assert.match(fonte, /finalidade_item: sincronizado\.finalidade_item \|\| null/);
    const normaliza = recorte('function dadosItemFiscalEntradaCompra', '// Pré-visualização');
    assert.match(normaliza, /finalidade_item: item\.finalidade_item/);
  });
});
