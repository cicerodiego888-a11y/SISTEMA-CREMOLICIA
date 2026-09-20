/**
 * MOBILE-PDV — Finalizar venda (contrato UX + fluxo API)
 * Valida botão, estados, pagamento, APIs, lock e feedback.
 * Sem alterar regras de negócio do backend.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mobileRoot = path.join(__dirname, '../../../../frontend/apps/mobile');
const pdvPath = path.join(mobileRoot, 'js/pages/pdv.js');
const cssPath = path.join(mobileRoot, 'css/mobile.css');
const formsPath = path.join(mobileRoot, 'js/forms.js');

function run() {
  const pdv = fs.readFileSync(pdvPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  const forms = fs.readFileSync(formsPath, 'utf8');

  // 1) Botão Finalizar
  assert.ok(pdv.includes('id="pdv-pay"'), 'botão #pdv-pay');
  assert.ok(pdv.includes('id="pdv-pay-hit"'), 'hit-area #pdv-pay-hit');
  assert.ok(pdv.includes('pdv-pay-hit') && pdv.includes('iniciarPagamento'), 'click → iniciarPagamento');

  // 2) Disabled só em caixa fechado / carrinho vazio / processando
  assert.ok(pdv.includes('pdvFinalizandoVenda'), 'lock finalizando');
  assert.ok(/!cart\.length\s*\|\|\s*!aberto\s*\|\|\s*pdvFinalizandoVenda/.test(pdv), 'disabled gates');
  assert.ok(css.includes('.cds-mobile-btn:disabled') || css.includes('.cds-mobile-btn.is-disabled'), 'visual disabled');
  assert.ok(/opacity:\s*0\.45/.test(css), 'disabled com opacidade');

  // 3) Feedback — nunca return silencioso nesses gates
  assert.ok(pdv.includes('Abra o caixa antes de finalizar a venda.'), 'toast caixa fechado');
  assert.ok(pdv.includes('Adicione pelo menos um produto para finalizar a venda.'), 'toast carrinho vazio');
  const iniciarBody = pdv.slice(pdv.indexOf('async function iniciarPagamento'), pdv.indexOf('async function finalizarVenda'));
  assert.ok(!/if\s*\(\s*!cart\.length\s*\)\s*return\s*;/.test(iniciarBody), 'iniciarPagamento sem return silencioso de carrinho');

  // 4) Finalizar abre pagamento, não grava ainda
  assert.ok(iniciarBody.includes('openBottomSheet'), 'abre bottom sheet');
  assert.ok(iniciarBody.includes('Forma de pagamento'), 'título pagamento');
  assert.ok(!iniciarBody.includes("CDSApi.post('vendas'"), 'iniciarPagamento não POST vendas');

  // 5) Opções de pagamento preservadas
  assert.ok(iniciarBody.includes('data-pay="dinheiro"'), 'Dinheiro');
  assert.ok(iniciarBody.includes('data-pay="pix"'), 'PIX');
  assert.ok(iniciarBody.includes('data-pay="cartao_debito"'), 'Débito');
  assert.ok(iniciarBody.includes('data-pay="cartao_credito"'), 'Crédito');
  assert.ok(iniciarBody.includes('data-pay="tef"'), 'TEF');
  assert.ok(iniciarBody.includes('data-pay-confirm'), 'botão confirmar pagamento');
  assert.ok(iniciarBody.includes('Selecione uma forma de pagamento.'), 'exige escolha da forma');
  assert.ok(iniciarBody.includes('cds-sheet__panel--pay') || pdv.includes('cds-sheet__panel--pay'), 'panel pay safe-area');

  // 6) Dinheiro
  const finBody = pdv.slice(pdv.indexOf('async function finalizarVenda'));
  assert.ok(finBody.includes("formaFinal === 'dinheiro'") || finBody.includes("formaFinal === \"dinheiro\""), 'ramo dinheiro');
  assert.ok(finBody.includes('Valor recebido insuficiente.'), 'valor insuficiente');
  assert.ok(finBody.includes('troco'), 'calcula troco');
  assert.ok(/if\s*\(\s*!data\s*\)\s*return/.test(finBody), 'cancelar dinheiro não grava');

  // 7–9) PIX/Cartão/TEF
  assert.ok(pdv.includes("data-pay=\"pix\""), 'PIX selecionável');
  assert.ok(pdv.includes('TEF indisponível neste terminal'), 'TEF feedback claro');
  assert.ok(pdv.includes('tryTef'), 'TEF existente');

  // 10) APIs
  assert.ok(pdv.includes('origem_pdv') && pdv.includes('PDV_MOBILE'), 'marca venda como PDV Mobile');
  assert.ok(pdv.includes('mostrarCupomAposVenda'), 'abre cupom após finalizar');
  assert.ok(finBody.includes('itens.map((orig, idx)') || finBody.includes('itens.map((orig'), 'merge preview com preço do carrinho');
  assert.ok(finBody.includes('Preço do item não encontrado'), 'bloqueia venda sem preço');
  assert.ok(finBody.includes("CDSApi.post('vendas'"), 'POST vendas');
  assert.ok(finBody.includes('pagamento-nao-fiscal'), 'pagamento não fiscal');
  assert.ok(finBody.includes('fiscal/emitir/venda/'), 'NFC-e opcional');
  assert.ok(/emitir_fiscal:\s*!!emitir/.test(finBody), 'emitir_fiscal segue o modo fiscal, sem zerar pelo preview');
  assert.ok(finBody.includes('timeoutMs: 180000') || finBody.includes('timeoutMs:180000'), 'NFC-e com timeout do desktop');
  assert.ok(finBody.includes("tipo_recebimento: emitir ? 'fiscal' : 'nao_fiscal'"), 'pagamento fiscal no modo fiscal');

  // 11) Lock / duplo clique
  assert.ok(finBody.includes('pdvFinalizandoVenda = true'), 'lock on');
  assert.ok(finBody.includes('pdvFinalizandoVenda = false'), 'lock off');
  assert.ok(finBody.includes('Finalizando venda...'), 'toast finalizando');
  assert.ok(finBody.includes('finally'), 'finally libera lock');

  // 12) Erros com feedback + carrinho preservado
  assert.ok(finBody.includes('O carrinho foi preservado'), 'preserva carrinho no erro');
  assert.ok(finBody.includes('Não foi possível finalizar a venda'), 'mensagem genérica');
  assert.ok(!/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(finBody), 'sem catch vazio');

  // 13) Sucesso
  assert.ok(finBody.includes('Venda finalizada com sucesso.'), 'toast sucesso');
  assert.ok(/saveCart\(\s*\[\s*\]\s*\)/.test(finBody), 'limpa carrinho');
  // limpa só depois do POST vendas
  const postIdx = finBody.indexOf("CDSApi.post('vendas'");
  const clearIdx = finBody.indexOf('saveCart([])', postIdx);
  assert.ok(postIdx >= 0 && clearIdx > postIdx, 'limpa carrinho após POST vendas');
  assert.ok(finBody.includes("navigate?.('pdv'") || finBody.includes('navigate?.("pdv"'), 'volta ao PDV');

  // 14) NFC-e falha não apaga venda
  assert.ok(finBody.includes('emissão fiscal precisa de atenção'), 'aviso NFC-e');

  // 16) Safe-area sticky
  assert.ok(/\.cds-pdv-sticky\s*\{[^}]*m-safe-b/s.test(css) || css.includes('var(--m-bottom-h) + var(--m-safe-b)'), 'sticky com safe-area');
  assert.ok(css.includes('.cds-pdv-sticky__pay-hit'), 'CSS hit-area');
  assert.ok(css.includes('.cds-sheet__panel--pay'), 'CSS painel pagamento');

  const cupom = fs.readFileSync(path.join(mobileRoot, 'js/cupom.js'), 'utf8');
  assert.ok(cupom.includes('nested.danfeHtml || data.danfeHtml'), 'DANFE no retorno plano da NFC-e');

  // Forms sheet ainda existe
  assert.ok(forms.includes('export function openBottomSheet'), 'openBottomSheet');
  assert.ok(forms.includes('immediate: true') || forms.includes('immediate = true'), 'abre sheet sem id duplicado');

  console.log('MOBILE-PDV OK — finalizar venda (botão → pagamento → API → sucesso)');
}

run();
