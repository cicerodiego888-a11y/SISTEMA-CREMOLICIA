/**
 * RCM-8.14 — Persistência do rascunho de venda do PDV
 *
 * Executar:
 *   node tests/pdv/rcm814-pdv-rascunho.test.js
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

/** sessionStorage em memória para Node */
function criarStorageMemoria() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] || null; },
    _map: map
  };
}

async function run() {
  console.log('\nRCM-8.14 — PDV rascunho de venda\n');

  const mem = criarStorageMemoria();
  global.sessionStorage = mem;

  const ctx = { terminal: 'pc-teste', usuarioId: 7 };
  const chave = api.obterChave(ctx);

  await test('chave versionada escopada por terminal/usuário', () => {
    assert.strictEqual(chave, 'cds_pdv_rascunho_v1:pc-teste:7');
    assert.ok(chave.startsWith(api.PREFIX));
  });

  await test('1. Adicionar produto → rascunho salvo', () => {
    mem.clear();
    const ok = api.salvarRascunhoVendaPdv({
      carrinho: [{
        id: 1,
        nome: 'Picolé',
        quantidade: 10,
        preco_unitario: 2,
        subtotal: 20,
        canal: 'VAREJO',
        linha_comercial_id: 2,
        tabela_preco_id: 1,
        preco_origem: 'tabela'
      }],
      clienteSelecionado: null,
      desconto: 0,
      acrescimo: 0,
      canalVendaPdv: 'VAREJO'
    }, ctx);
    assert.strictEqual(ok, true);
    assert.ok(mem.getItem(chave));
    const restored = api.restaurarRascunhoVendaPdv(ctx);
    assert.strictEqual(restored.carrinho.length, 1);
    assert.strictEqual(restored.carrinho[0].quantidade, 10);
  });

  await test('2. Alterar quantidade → rascunho atualizado', () => {
    api.salvarRascunhoVendaPdv({
      carrinho: [{ id: 1, nome: 'Picolé', quantidade: 12, preco_unitario: 2, subtotal: 24 }],
      canalVendaPdv: 'VAREJO'
    }, ctx);
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.strictEqual(r.carrinho[0].quantidade, 12);
  });

  await test('3. Remover produto → rascunho atualizado', () => {
    api.salvarRascunhoVendaPdv({
      carrinho: [
        { id: 1, nome: 'A', quantidade: 1, preco_unitario: 1, subtotal: 1 },
        { id: 2, nome: 'B', quantidade: 5, preco_unitario: 3, subtotal: 15 }
      ]
    }, ctx);
    api.salvarRascunhoVendaPdv({
      carrinho: [{ id: 2, nome: 'B', quantidade: 5, preco_unitario: 3, subtotal: 15 }]
    }, ctx);
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.strictEqual(r.carrinho.length, 1);
    assert.strictEqual(r.carrinho[0].id, 2);
  });

  await test('4. Selecionar cliente → rascunho atualizado', () => {
    api.salvarRascunhoVendaPdv({
      carrinho: [{ id: 1, nome: 'A', quantidade: 1, preco_unitario: 10, subtotal: 10 }],
      clienteSelecionado: { id: 9, nome: 'CICERO', cpf_cnpj: '123', senha: 'SEGREDO', token: 'X' }
    }, ctx);
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.strictEqual(r.clienteSelecionado.id, 9);
    assert.strictEqual(r.clienteSelecionado.nome, 'CICERO');
    assert.strictEqual(r.clienteSelecionado.senha, undefined);
    assert.strictEqual(r.clienteSelecionado.token, undefined);
  });

  await test('5. Alterar desconto → rascunho atualizado', () => {
    api.salvarRascunhoVendaPdv({
      carrinho: [{ id: 1, nome: 'A', quantidade: 1, preco_unitario: 100, subtotal: 100 }],
      desconto: 15,
      acrescimo: 2
    }, ctx);
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.strictEqual(r.desconto, 15);
    assert.strictEqual(r.acrescimo, 2);
  });

  await test('6. Restaurar PDV → carrinho restaurado com snapshot', () => {
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.ok(r);
    assert.strictEqual(r.version, 1);
    assert.ok(Array.isArray(r.carrinho));
  });

  await test('7/8. Navegar ERP/Consignação → rascunho permanece no storage', () => {
    const antes = mem.getItem(chave);
    assert.ok(antes);
    // simula saída do PDV sem limpar sessionStorage
    const depois = api.restaurarRascunhoVendaPdv(ctx);
    assert.ok(depois);
    assert.strictEqual(depois.carrinho[0].subtotal, 100);
  });

  await test('9. Finalizar venda → limpar rascunho', () => {
    assert.strictEqual(api.possuiRascunhoVendaPdv(ctx), true);
    api.limparRascunhoVendaPdv(ctx);
    assert.strictEqual(api.possuiRascunhoVendaPdv(ctx), false);
    assert.strictEqual(mem.getItem(chave), null);
  });

  await test('10. Cancelar venda → limpar rascunho', () => {
    api.salvarRascunhoVendaPdv({
      carrinho: [{ id: 1, nome: 'X', quantidade: 1, preco_unitario: 1, subtotal: 1 }]
    }, ctx);
    api.limparRascunhoVendaPdv(ctx);
    assert.strictEqual(api.possuiRascunhoVendaPdv(ctx), false);
  });

  await test('11. Erro na venda → rascunho preservado', () => {
    api.salvarRascunhoVendaPdv({
      carrinho: [{ id: 1, nome: 'X', quantidade: 2, preco_unitario: 5, subtotal: 10 }]
    }, ctx);
    // erro: NÃO chama limpar
    assert.strictEqual(api.possuiRascunhoVendaPdv(ctx), true);
    assert.strictEqual(api.restaurarRascunhoVendaPdv(ctx).carrinho[0].quantidade, 2);
  });

  await test('12. JSON inválido → não quebra', () => {
    mem.setItem(chave, '{quebrado');
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.strictEqual(r, null);
  });

  await test('13. Versão incompatível → ignorado', () => {
    mem.setItem(chave, JSON.stringify({
      version: 99,
      carrinho: [{ id: 1, quantidade: 1, subtotal: 1 }]
    }));
    assert.strictEqual(api.restaurarRascunhoVendaPdv(ctx), null);
  });

  await test('14. Nenhum dado sensível de pagamento persistido', () => {
    api.salvarRascunhoVendaPdv({
      carrinho: [{
        id: 1,
        nome: 'A',
        quantidade: 1,
        preco_unitario: 1,
        subtotal: 1,
        tef: { nsu: '999' },
        tef_transacao_id: 'TX1',
        cvv: '123',
        nsu: '999',
        autorizacao: 'AUT'
      }],
      clienteSelecionado: { id: 1, nome: 'X', token: 'abc', senha: '1' }
    }, ctx);
    const r = api.restaurarRascunhoVendaPdv(ctx);
    const item = r.carrinho[0];
    assert.strictEqual(item.tef, undefined);
    assert.strictEqual(item.tef_transacao_id, undefined);
    assert.strictEqual(item.cvv, undefined);
    assert.strictEqual(item.nsu, undefined);
    assert.strictEqual(item.autorizacao, undefined);
    assert.strictEqual(r.clienteSelecionado.token, undefined);
    assert.strictEqual(r.clienteSelecionado.senha, undefined);
  });

  await test('15. Preço/snapshot do item é preservado', () => {
    api.salvarRascunhoVendaPdv({
      carrinho: [{
        id: 50,
        nome: 'Sorvete',
        quantidade: 5,
        preco_unitario: 3.5,
        subtotal: 17.5,
        canal: 'ATACADO',
        linha_comercial_id: 2,
        tabela_preco_id: 9,
        preco_origem: 'tabela_preco_linha',
        muc: 'UN'
      }]
    }, ctx);
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.strictEqual(r.carrinho[0].preco_unitario, 3.5);
    assert.strictEqual(r.carrinho[0].linha_comercial_id, 2);
    assert.strictEqual(r.carrinho[0].tabela_preco_id, 9);
    assert.strictEqual(r.carrinho[0].preco_origem, 'tabela_preco_linha');
    assert.strictEqual(r.carrinho[0].canal, 'ATACADO');
  });

  await test('cenário principal: Picolé 10 + Sorvete 5 sobrevivem à “navegação”', () => {
    api.salvarRascunhoVendaPdv({
      carrinho: [
        { id: 1, nome: 'Picolé', quantidade: 10, preco_unitario: 2, subtotal: 20 },
        { id: 2, nome: 'Sorvete', quantidade: 5, preco_unitario: 4, subtotal: 20 }
      ],
      canalVendaPdv: 'VAREJO',
      desconto: 0,
      acrescimo: 0
    }, ctx);
    // simula consignação no ERP (outro módulo) — storage intacto
    const r = api.restaurarRascunhoVendaPdv(ctx);
    assert.strictEqual(r.carrinho.length, 2);
    assert.strictEqual(r.carrinho[0].quantidade, 10);
    assert.strictEqual(r.carrinho[1].quantidade, 5);
    assert.strictEqual(api.calcularTotalRascunho(r), 40);
  });

  await test('usuário/terminal diferente não lê o rascunho alheio', () => {
    const outro = api.restaurarRascunhoVendaPdv({ terminal: 'outro-pc', usuarioId: 99 });
    assert.strictEqual(outro, null);
  });

  console.log(`\nResultado: ${passou} OK, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run();
