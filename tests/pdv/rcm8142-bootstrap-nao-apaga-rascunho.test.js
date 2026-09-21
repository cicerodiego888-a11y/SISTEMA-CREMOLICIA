/**
 * RCM-8.14.2 — Bootstrap do PDV NÃO pode apagar rascunho antes de restaurar
 *
 * Reproduz o bug comprovado em RCM-8.14.1:
 *   bindEventos → aoAlterarFormaPagamento → persistir(carrinho=[]) → removeItem
 *   ANTES de tentarRestaurar
 *
 * Executar:
 *   node tests/pdv/rcm8142-bootstrap-nao-apaga-rascunho.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../..'));

const api = require('../../frontend/shared/js/pdvRascunhoVenda');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((err) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}\n         ${err.message}`);
    });
}

function criarStorageMemoria() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] || null; }
  };
}

/**
 * Espelha a política de persistirRascunhoVendaPdv do PDV (RCM-8.14.2).
 */
function persistirComoPdv(estado, ctx, flags = {}) {
  if (flags.restaurando) return false;
  const bootstrapPendente = flags.bootstrapPendente === true;
  if (bootstrapPendente) {
    const temItens = Array.isArray(estado.carrinho) && estado.carrinho.length > 0;
    const temCliente = !!(estado.clienteSelecionado && estado.clienteSelecionado.id != null);
    const temAjuste = Number(estado.desconto) > 0 || Number(estado.acrescimo) > 0;
    if (!temItens && !temCliente && !temAjuste) {
      return false;
    }
    return api.salvarRascunhoVendaPdv(estado, ctx, { permitirRemoverSeVazio: false });
  }
  return api.salvarRascunhoVendaPdv(estado, ctx);
}

/** Comportamento ANTIGO (bug) — usado só para documentar a regressão. */
function persistirComoPdvBugAntigo(estado, ctx) {
  return api.salvarRascunhoVendaPdv(estado, ctx);
}

async function run() {
  console.log('\nRCM-8.14.2 — Bootstrap não apaga rascunho\n');

  const mem = criarStorageMemoria();
  global.sessionStorage = mem;

  const ctx = { terminal: 'pc-caixa-1', usuarioId: 7 };
  const chave = api.obterChave(ctx);

  const estadoComercial = {
    carrinho: [
      {
        id: 1,
        nome: 'Produto A',
        quantidade: 10,
        preco_unitario: 2,
        subtotal: 20,
        canal: 'VAREJO',
        preco_origem: 'tabela'
      },
      {
        id: 2,
        nome: 'Produto B',
        quantidade: 5,
        preco_unitario: 4,
        subtotal: 20,
        canal: 'VAREJO',
        preco_origem: 'tabela'
      }
    ],
    clienteSelecionado: { id: 9, nome: 'CLIENTE TESTE', cpf_cnpj: '123' },
    formaPagamentoSelecionada: 'dinheiro',
    canalVendaPdv: 'VAREJO',
    desconto: 1,
    acrescimo: 0.5
  };

  await test('documenta bug antigo: persist vazio ANTES de restaurar apaga storage', () => {
    mem.clear();
    api.salvarRascunhoVendaPdv(estadoComercial, ctx);
    assert.ok(mem.getItem(chave), 'rascunho deve existir antes do bootstrap');

    // simula saída PDV → ERP → retorno com carrinho=[]
    const carrinhoVazio = {
      carrinho: [],
      clienteSelecionado: null,
      desconto: 0,
      acrescimo: 0
    };
    persistirComoPdvBugAntigo(carrinhoVazio, ctx);
    assert.strictEqual(
      mem.getItem(chave),
      null,
      'BUG antigo: removeItem deve ter apagado (documentação)'
    );
  });

  await test('correção: bootstrap + persist vazio NÃO remove storage', () => {
    mem.clear();
    api.salvarRascunhoVendaPdv(estadoComercial, ctx);
    assert.ok(mem.getItem(chave));

    // 3–6. simula reentrada: carrinho=[], bindEventos → aoAlterarFormaPagamento → persistir
    const flagsBootstrap = { bootstrapPendente: true, restaurando: false };
    persistirComoPdv({
      carrinho: [],
      clienteSelecionado: null,
      desconto: 0,
      acrescimo: 0
    }, ctx, flagsBootstrap);

    assert.ok(mem.getItem(chave), 'storage deve permanecer após persist bootstrap vazio');
    const ainda = api.restaurarRascunhoVendaPdv(ctx);
    assert.ok(ainda);
    assert.strictEqual(ainda.carrinho.length, 2);
  });

  await test('salvar com permitirRemoverSeVazio:false não remove', () => {
    mem.clear();
    api.salvarRascunhoVendaPdv(estadoComercial, ctx);
    const ok = api.salvarRascunhoVendaPdv({
      carrinho: [],
      desconto: 0,
      acrescimo: 0
    }, ctx, { permitirRemoverSeVazio: false });
    assert.strictEqual(ok, false);
    assert.ok(mem.getItem(chave));
  });

  await test('após bootstrap: restaurar A×10 + B×5 + cliente + pagamento + desconto', () => {
    mem.clear();
    api.salvarRascunhoVendaPdv(estadoComercial, ctx);

    // sequência bootstrap corrigida
    persistirComoPdv({ carrinho: [] }, ctx, { bootstrapPendente: true });

    const rascunho = api.restaurarRascunhoVendaPdv(ctx);
    assert.ok(rascunho);
    assert.strictEqual(rascunho.carrinho.length, 2);
    assert.strictEqual(rascunho.carrinho[0].nome, 'Produto A');
    assert.strictEqual(rascunho.carrinho[0].quantidade, 10);
    assert.strictEqual(rascunho.carrinho[1].nome, 'Produto B');
    assert.strictEqual(rascunho.carrinho[1].quantidade, 5);
    assert.strictEqual(rascunho.clienteSelecionado.id, 9);
    assert.strictEqual(rascunho.formaPagamentoSelecionada, 'dinheiro');
    assert.strictEqual(rascunho.desconto, 1);
    assert.strictEqual(rascunho.acrescimo, 0.5);
    assert.strictEqual(rascunho.carrinho[0].preco_origem, 'tabela');
  });

  await test('após liberar bootstrap, persistência normal (alterar qtd) funciona', () => {
    const atualizado = {
      ...estadoComercial,
      carrinho: [
        { ...estadoComercial.carrinho[0], quantidade: 12, subtotal: 24 },
        estadoComercial.carrinho[1]
      ]
    };
    persistirComoPdv(atualizado, ctx, { bootstrapPendente: false });
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.strictEqual(r.carrinho[0].quantidade, 12);
  });

  await test('descarte explícito remove rascunho (ação do usuário)', () => {
    api.limparRascunhoVendaPdv(ctx);
    assert.strictEqual(api.possuiRascunhoVendaPdv(ctx), false);
    assert.strictEqual(mem.getItem(chave), null);
  });

  await test('após bootstrap liberado, carrinho vazio (limpar venda) remove rascunho', () => {
    api.salvarRascunhoVendaPdv(estadoComercial, ctx);
    persistirComoPdv({
      carrinho: [],
      clienteSelecionado: null,
      desconto: 0,
      acrescimo: 0
    }, ctx, { bootstrapPendente: false });
    assert.strictEqual(mem.getItem(chave), null);
  });

  await test('PDV→ERP→PDV×2: rascunho sobrevive a múltiplos bootstraps vazios', () => {
    mem.clear();
    api.salvarRascunhoVendaPdv(estadoComercial, ctx);
    for (let i = 0; i < 3; i += 1) {
      persistirComoPdv({ carrinho: [] }, ctx, { bootstrapPendente: true });
    }
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.ok(r);
    assert.strictEqual(r.carrinho.length, 2);
    assert.strictEqual(r.carrinho[0].quantidade, 10);
    assert.strictEqual(r.carrinho[1].quantidade, 5);
  });

  console.log(`\nResultado: ${passou} OK, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run();
