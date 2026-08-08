/**
 * RCM-6.1 — Congelamento completo da precificação na consignação
 *
 * Executar:
 *   node backend/motores/motor-comercial/tests/rcm61-congelamento-precificacao.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));

const { resolverUnidadeComercialCongelada } = require('../services/unidadeComercialCongelada');
const { mapConsignacaoItemFromRow } = require('../utils/comercialMapper');
const AdicionarItemRequest = require('../http/dto/ConsignacaoDTO').AdicionarItemRequest;

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}\n         ${err.message}`);
  }
}

async function testAsync(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}\n         ${err.message}`);
  }
}

console.log('\nRCM-6.1 — Congelamento Precificação Consignação\n');

test('UC congelada — usa snapshot do item', () => {
  const r = resolverUnidadeComercialCongelada({
    id: 1,
    unidadeComercial: 'LITRO',
    unidade: 'KG'
  });
  assert.strictEqual(r.unidadeComercial, 'LITRO');
  assert.strictEqual(r.herdadaDaBase, false);
});

test('UC ausente — fallback Unidade Base (compat)', () => {
  const r = resolverUnidadeComercialCongelada(
    { id: 99, unidade: 'KG' },
    { silencioso: true }
  );
  assert.strictEqual(r.unidadeComercial, 'KG');
  assert.strictEqual(r.herdadaDaBase, true);
});

test('Mapper — item novo com snapshot completo', () => {
  const item = mapConsignacaoItemFromRow({
    id: 10,
    consignacao_id: 1,
    produto_id: 50,
    produto_nome: 'Sorvete',
    produto_codigo: 'SRV',
    produto_unidade: 'KG',
    quantidade_entregue: 2,
    quantidade_devolvida: 0,
    quantidade_vendida: 0,
    quantidade_perdida: 0,
    quantidade_cortesia: 0,
    preco_unitario: 18.5,
    subtotal_entregue: 37,
    subtotal_acertado: 0,
    linha_comercial_id: 7,
    tabela_preco_id: 3,
    canal_venda: 'CONSIGNADO',
    unidade_comercial: 'LITRO',
    preco_origem: 'tabela_preco_linha',
    preco_fallback: 0,
    observacao: null,
    created_at: null,
    updated_at: null
  });

  assert.strictEqual(item.unidadeComercial, 'LITRO');
  assert.strictEqual(item.unidade, 'LITRO');
  assert.strictEqual(item.unidadeBaseProduto, 'KG');
  assert.strictEqual(item.linhaComercialId, 7);
  assert.strictEqual(item.tabelaPrecoId, 3);
  assert.strictEqual(item.canalVenda, 'CONSIGNADO');
  assert.strictEqual(item.precoOrigem, 'tabela_preco_linha');
  assert.strictEqual(item.precoFallback, false);
  assert.strictEqual(item.precoUnitario, 18.5);
  assert.strictEqual(item.unidadeComercialHerdada, false);
});

test('Mapper — item antigo sem UC (compat KG)', () => {
  const item = mapConsignacaoItemFromRow({
    id: 11,
    consignacao_id: 1,
    produto_id: 51,
    produto_nome: 'Sorvete Antigo',
    produto_unidade: 'KG',
    quantidade_entregue: 1,
    quantidade_devolvida: 0,
    quantidade_vendida: 0,
    quantidade_perdida: 0,
    quantidade_cortesia: 0,
    preco_unitario: 20,
    subtotal_entregue: 20,
    subtotal_acertado: 0
  });

  assert.strictEqual(item.unidadeComercial, 'KG');
  assert.strictEqual(item.unidade, 'KG');
  assert.strictEqual(item.unidadeComercialHerdada, true);
  assert.strictEqual(item.canalVenda, null);
  assert.strictEqual(item.linhaComercialId, null);
});

test('Mapper — Preço de Segurança (fallback=1)', () => {
  const item = mapConsignacaoItemFromRow({
    id: 12,
    consignacao_id: 1,
    produto_id: 52,
    produto_unidade: 'UN',
    quantidade_entregue: 1,
    quantidade_devolvida: 0,
    quantidade_vendida: 0,
    quantidade_perdida: 0,
    quantidade_cortesia: 0,
    preco_unitario: 9.9,
    subtotal_entregue: 9.9,
    subtotal_acertado: 0,
    canal_venda: 'CONSIGNADO',
    unidade_comercial: 'UN',
    preco_origem: 'produto.preco_venda',
    preco_fallback: 1
  });
  assert.strictEqual(item.precoFallback, true);
  assert.strictEqual(item.precoOrigem, 'produto.preco_venda');
});

test('AdicionarItemRequest — aceita snapshot completo', () => {
  const data = AdicionarItemRequest.fromJSON({
    produtoId: 1,
    quantidade: 3,
    precoUnitario: 15,
    unidadeComercial: 'LITRO',
    linhaComercialId: 2,
    tabelaPrecoId: 4,
    canalVenda: 'CONSIGNADO',
    precoOrigem: 'tabela_preco',
    precoFallback: false
  });
  assert.strictEqual(data.unidadeComercial, 'LITRO');
  assert.strictEqual(data.linhaComercialId, 2);
  assert.strictEqual(data.tabelaPrecoId, 4);
  assert.strictEqual(data.canalVenda, 'CONSIGNADO');
  assert.strictEqual(data.precoOrigem, 'tabela_preco');
  assert.strictEqual(AdicionarItemRequest.validate(data), null);
});

test('AdicionarItemRequest — snake_case aliases', () => {
  const data = AdicionarItemRequest.fromJSON({
    produtoId: 1,
    quantidade: 1,
    precoUnitario: 10,
    unidade_comercial: 'KG',
    linha_comercial_id: 9,
    tabela_preco_id: 8,
    canal_venda: 'CONSIGNADO',
    preco_origem: 'tabela_preco_linha',
    preco_fallback: true
  });
  assert.strictEqual(data.unidadeComercial, 'KG');
  assert.strictEqual(data.linhaComercialId, 9);
  assert.strictEqual(data.precoFallback, true);
});

(async () => {
  await testAsync('UseCase — persiste snapshot e força canal CONSIGNADO no bridge', async () => {
    const AdicionarItemConsignacaoUseCase = require('../usecases/consignacao/AdicionarItemConsignacaoUseCase');

    const calls = [];
    const produtoBridge = {
      async buscarPorId(id, opts) {
        calls.push({ id, opts });
        return {
          id,
          ativo: true,
          precoVenda: 12,
          unidade: 'KG',
          unidadeComercial: 'LITRO',
          linhaComercialId: 5,
          tabelaPrecoId: 6,
          canalVenda: 'CONSIGNADO',
          precoOrigem: 'tabela_preco_linha',
          precoFallback: false
        };
      },
      async estaAtivo() {
        return true;
      }
    };

    let inserido = null;
    const useCase = new AdicionarItemConsignacaoUseCase({
      produtoBridge,
      unitOfWork: {
        async executar(fn) {
          const uow = {
            consignacao: {
              async buscarPorId() {
                return { id: 100, status: 'RASCUNHO' };
              }
            },
            consignacaoItem: {
              async listarPorConsignacao() {
                return [];
              },
              async inserir(dados) {
                inserido = dados;
                return { id: 1, ...dados };
              }
            }
          };
          const eventos = [];
          return fn(uow, eventos);
        }
      },
      eventPublisher: { publicar: async () => {} }
    });

    // stub helpers: obterConsignacaoEmRascunho throws if status wrong — RASCUNHO ok
    // ConsignacaoWriteUseCase may need executarEscrita — check base class
    if (typeof useCase.executarEscrita !== 'function' && typeof useCase.executar === 'function') {
      // will use processar via executar
    }

    // Mock executarEscrita if inherited differently
    useCase.executarEscrita = async (fn) => {
      const uow = {
        consignacao: {
          async buscarPorId() {
            return { id: 100, status: 'RASCUNHO' };
          }
        },
        consignacaoItem: {
          async listarPorConsignacao() {
            return [];
          },
          async inserir(dados) {
            inserido = dados;
            return { id: 1, ...dados };
          }
        }
      };
      return fn(uow, []);
    };

    const result = await useCase.processar({
      consignacaoId: 100,
      produtoId: 50,
      quantidade: 2,
      precoUnitario: 18.5,
      unidadeComercial: 'LITRO',
      linhaComercialId: 5,
      tabelaPrecoId: 6,
      canalVenda: 'CONSIGNADO',
      precoOrigem: 'tabela_preco_linha',
      precoFallback: false
    });

    assert.ok(calls[0], 'bridge chamado');
    assert.strictEqual(calls[0].opts.canal, 'CONSIGNADO');
    assert.strictEqual(inserido.unidadeComercial, 'LITRO');
    assert.strictEqual(inserido.canalVenda, 'CONSIGNADO');
    assert.strictEqual(inserido.linhaComercialId, 5);
    assert.strictEqual(inserido.tabelaPrecoId, 6);
    assert.strictEqual(inserido.precoUnitario, 18.5);
    assert.strictEqual(inserido.precoOrigem, 'tabela_preco_linha');
    assert.strictEqual(inserido.precoFallback, false);
    assert.ok(result.item);
  });

  await testAsync('Gateway — buscarPorId com canal CONSIGNADO (mock resolver)', async () => {
    // Smoke: module loads and signature accepts opts
    const ProdutoPlatformGateway = require('../bridges/platform/ProdutoPlatformGateway');
    const gw = new ProdutoPlatformGateway({ db: {} });
    assert.strictEqual(typeof gw.buscarPorId, 'function');
    assert.strictEqual(gw.buscarPorId.length, 1); // segundo arg é opts (default)
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
