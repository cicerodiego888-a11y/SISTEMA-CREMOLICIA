/**
 * RCM-8.3 — Histórico real de consignações
 *
 * Executar:
 *   node tests/motor-comercial/rcm83-historico-consignacoes.test.js
 */

const assert = require('assert');
const { ConsultarConsignacaoUseCase } = require('../../backend/motores/motor-comercial/usecases/consignacao');
const { ConsignacaoResponse, ItemConsignacaoResponse } = require('../../backend/motores/motor-comercial/http/dto/ConsignacaoDTO');
const {
  consignacaoPertenceAoCliente,
  mapStatusConsultaConsignacao
} = require('../../backend/motores/motor-comercial/services/consultaConsignacaoReadOnly');
const {
  buildHistoricoConsignacoes,
  buildDetalheConsulta,
  buildComprovanteConsignacaoHtml,
  reimpressaoSomenteLeitura
} = require('../../frontend/modules/motor-comercial/pages/PerfilComercial/historicoConsignacoesMappers');
const { buildCentralOperacoesViewModel } = require('../../frontend/modules/motor-comercial/pages/PerfilComercial/centralOperacoesMappers');
const { imprimirComprovanteConsignacao } = require('../../frontend/modules/motor-comercial/services/ComprovanteConsignacaoPrintService');

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

function criarItem(overrides = {}) {
  return {
    id: 1,
    consignacaoId: 1,
    produtoId: 100,
    produtoNome: 'Picolé Premium',
    quantidadeEntregue: 2,
    precoUnitario: 42,
    subtotalEntregue: 84,
    unidadeComercial: 'CX',
    unidade: 'UN',
    linhaComercialId: 7,
    tabelaPrecoId: 3,
    canalVenda: 'CONSIGNADO',
    precoOrigem: 'tabela_preco_linha',
    precoFallback: 0,
    ...overrides
  };
}

function criarConsignacao(overrides = {}) {
  return {
    id: 1,
    clienteId: 10,
    clienteNome: 'Cicero Diego',
    perfilComercialId: 5,
    status: 'ENCERRADA',
    documento: { numero: 'CONS-2026-000001', serie: '1', sequencial: 1 },
    valorTotalEntregue: 84,
    valorTotalAcertado: 84,
    valorTotalPago: 84,
    saldoAberto: 0,
    quantidadeItens: 2,
    dataAbertura: '2026-09-04T10:00:00.000Z',
    dataEntrega: '2026-09-04T14:00:00.000Z',
    updatedAt: '2026-09-04T18:00:00.000Z',
    prestacaoContasAtiva: { status: 'FECHADA' },
    itens: [criarItem()],
    ...overrides
  };
}

function criarMockConsignacaoRepo(store) {
  const todos = Array.isArray(store) ? store.map((c) => ({ ...c })) : [{ ...store }];
  return {
    buscarPorId: async (id) => todos.find((c) => Number(c.id) === Number(id)) ?? null,
    listar: async (filtros = {}) => todos.filter((c) => {
      if (filtros.clienteId != null && Number(c.clienteId) !== Number(filtros.clienteId)) return false;
      if (filtros.status && String(c.status) !== String(filtros.status)) return false;
      return true;
    })
  };
}

async function main() {
  console.log('\nRCM-8.3 — Histórico real de consignações\n');

  await test('1. Cliente possui consignação', async () => {
    const repo = criarMockConsignacaoRepo([
      criarConsignacao(),
      criarConsignacao({ id: 2, clienteId: 99, documento: { numero: 'CONS-2026-000099' } })
    ]);
    const lista = await repo.listar({ clienteId: 10 });
    assert.strictEqual(lista.length, 1);
    assert.strictEqual(lista[0].documento.numero, 'CONS-2026-000001');
  });

  await test('2. Consignação aparece no Histórico', async () => {
    const vm = buildCentralOperacoesViewModel({
      perfil: { clienteId: 10, clienteNome: 'Cicero Diego' },
      consignacoes: [criarConsignacao()],
      historico: [{ descricao: 'Atendimento encerrado', periodo: '04/09/2026' }]
    });
    assert.strictEqual(vm.consignacoesHistorico.length, 1);
    assert.strictEqual(vm.consignacoesHistorico[0].numero, 'CONS-2026-000001');
    assert.strictEqual(vm.consignacoesHistorico[0].statusLabel, 'Encerrada');
    assert.strictEqual(vm.consignacoesHistorico[0].quantidadeItens, 2);
    assert.strictEqual(vm.consignacoesHistorico[0].valorTotal, 84);
    assert.ok(Array.isArray(vm.historico));
    assert.notStrictEqual(vm.consignacoesHistorico[0].numero, 'Atendimento encerrado');
  });

  await test('3. Consignação ENCERRADA aparece', async () => {
    const rows = buildHistoricoConsignacoes([criarConsignacao({ status: 'ENCERRADA' })], 10);
    assert.strictEqual(rows[0].statusLabel, 'Encerrada');
    assert.strictEqual(ConsignacaoResponse.toJSON(criarConsignacao({ status: 'ENCERRADA' })).statusLabel, 'Encerrada');
  });

  await test('4. Consignação QUITADA aparece', async () => {
    const rows = buildHistoricoConsignacoes([criarConsignacao({ status: 'QUITADA' })], 10);
    assert.strictEqual(rows[0].statusLabel, 'Quitada');
  });

  await test('5. Consignação CANCELADA aparece', async () => {
    const rows = buildHistoricoConsignacoes([criarConsignacao({ status: 'CANCELADA' })], 10);
    assert.strictEqual(rows[0].statusLabel, 'Cancelada');
  });

  await test('6. Consignação ENTREGUE aparece', async () => {
    const rows = buildHistoricoConsignacoes([criarConsignacao({
      status: 'ENTREGUE',
      prestacaoContasAtiva: null,
      valorTotalPago: 0,
      valorTotalAcertado: 0,
      saldoAberto: 84
    })], 10);
    assert.strictEqual(rows[0].statusLabel, 'Entregue');
  });

  await test('7. Visualizar abre a consignação correta', async () => {
    const detalhe = buildDetalheConsulta(criarConsignacao(), { tipoComercial: 'CONSIGNADO' });
    assert.strictEqual(detalhe.id, 1);
    assert.strictEqual(detalhe.numero, 'CONS-2026-000001');
    assert.strictEqual(detalhe.somenteLeitura, true);
    assert.strictEqual(detalhe.situacao, 'Encerrada');
    assert.strictEqual(detalhe.canalOperacao, 'CONSIGNADO');
  });

  await test('8. Produtos aparecem', async () => {
    const detalhe = buildDetalheConsulta(criarConsignacao());
    assert.strictEqual(detalhe.produtos.length, 1);
    assert.strictEqual(detalhe.produtos[0].produto, 'Picolé Premium');
  });

  await test('9. Preços aparecem', async () => {
    const detalhe = buildDetalheConsulta(criarConsignacao());
    assert.strictEqual(detalhe.produtos[0].precoUnitario, 42);
    assert.strictEqual(detalhe.produtos[0].total, 84);
    assert.strictEqual(detalhe.valorTotal, 84);
  });

  await test('10. Unidade Comercial aparece', async () => {
    const detalhe = buildDetalheConsulta(criarConsignacao());
    assert.strictEqual(detalhe.produtos[0].unidadeComercial, 'CX');
    assert.strictEqual(detalhe.produtos[0].unidade, 'UN');
  });

  await test('11. Snapshot RCM-6.1 aparece', async () => {
    const item = ItemConsignacaoResponse.toJSON(criarItem());
    const detalhe = buildDetalheConsulta(criarConsignacao({ itens: [item] }));
    assert.strictEqual(detalhe.produtos[0].linhaComercialId, 7);
    assert.strictEqual(detalhe.produtos[0].tabelaPrecoId, 3);
    assert.strictEqual(detalhe.produtos[0].canalVenda, 'CONSIGNADO');
    assert.strictEqual(detalhe.produtos[0].precoOrigem, 'tabela_preco_linha');
    assert.strictEqual(detalhe.tabelaPrecoId, 3);
  });

  await test('12. Preço de Segurança aparece quando fallback = 1', async () => {
    const item = ItemConsignacaoResponse.toJSON(criarItem({ precoFallback: 1, precoUnitario: 1.99 }));
    const detalhe = buildDetalheConsulta(criarConsignacao({ itens: [item] }));
    assert.strictEqual(detalhe.produtos[0].precoFallback, true);
    assert.strictEqual(detalhe.produtos[0].precoUnitario, 1.99);
  });

  await test('13. Reimprimir funciona', async () => {
    const detalhe = buildDetalheConsulta(criarConsignacao());
    const html = buildComprovanteConsignacaoHtml(detalhe);
    assert.ok(html.includes('COMPROVANTE DE CONSIGNAÇÃO'));
    assert.ok(html.includes('CONS-2026-000001'));
    assert.ok(html.includes('Picolé Premium'));
    assert.ok(html.includes('Consignação encerrada.'));
    const impresso = imprimirComprovanteConsignacao(detalhe);
    assert.ok(impresso.html.includes('COMPROVANTE DE CONSIGNAÇÃO'));
  });

  await test('14. Reimprimir não cria operação', async () => {
    assert.strictEqual(reimpressaoSomenteLeitura().criaNovaOperacao, false);
    assert.strictEqual(imprimirComprovanteConsignacao(buildDetalheConsulta(criarConsignacao())).efeitos.criaNovaOperacao, false);
  });

  await test('15. Reimprimir não altera estoque', async () => {
    assert.strictEqual(reimpressaoSomenteLeitura().alteraEstoque, false);
  });

  await test('16. Reimprimir não altera Ledger', async () => {
    assert.strictEqual(reimpressaoSomenteLeitura().alteraLedger, false);
  });

  await test('17. Reimprimir não chama Resolver', async () => {
    assert.strictEqual(reimpressaoSomenteLeitura().consultaResolver, false);
    assert.strictEqual(reimpressaoSomenteLeitura().consultaTabela, false);
  });

  await test('18. Consignação de outro cliente retorna 404', async () => {
    assert.strictEqual(consignacaoPertenceAoCliente({ clienteId: 10 }, 99), false);
    const repo = criarMockConsignacaoRepo(criarConsignacao({ clienteId: 10 }));
    const result = await new ConsultarConsignacaoUseCase({
      consignacaoRepository: repo
    }).executar({ consignacaoId: 1, clienteId: 99 });
    assert.strictEqual(result.isFail(), true);
  });

  await test('seção CONSIGNAÇÕES permanece no view-model sem registros', async () => {
    const vm = buildCentralOperacoesViewModel({
      perfil: { clienteId: 10, clienteNome: 'Cicero Diego' },
      consignacoes: []
    });
    assert.ok(Array.isArray(vm.consignacoesHistorico));
    assert.strictEqual(vm.consignacoesHistorico.length, 0);
  });

  await test('listagem por cliente não filtra só abertas', async () => {
    const repo = criarMockConsignacaoRepo([
      criarConsignacao({ id: 1, status: 'RASCUNHO' }),
      criarConsignacao({ id: 2, status: 'ENTREGUE', prestacaoContasAtiva: null }),
      criarConsignacao({ id: 3, status: 'ENCERRADA' }),
      criarConsignacao({ id: 4, status: 'QUITADA' }),
      criarConsignacao({ id: 5, status: 'CANCELADA' })
    ]);
    const lista = await repo.listar({ clienteId: 10 });
    assert.strictEqual(lista.length, 5);
    const dtoLabels = lista.map((c) => ConsignacaoResponse.toJSON(c).statusLabel);
    assert.ok(dtoLabels.includes('Em preparação'));
    assert.ok(dtoLabels.includes('Encerrada'));
    assert.ok(dtoLabels.includes('Quitada'));
    assert.ok(dtoLabels.includes('Cancelada'));
    assert.strictEqual(mapStatusConsultaConsignacao({ status: 'FECHADA' }).label, 'Encerrada');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main();
