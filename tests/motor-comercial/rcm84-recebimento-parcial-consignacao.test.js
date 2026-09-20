/**
 * RCM-8.4 — Recebimento parcial de consignação acertada
 *
 * Executar:
 *   node tests/motor-comercial/rcm84-recebimento-parcial-consignacao.test.js
 */

const assert = require('assert');
const { RegistrarPagamentoPrestacaoUseCase } = require('../../backend/motores/motor-comercial/usecases/consignacao');
const {
  obterGrupoPrestacaoParaPagamento,
  determinarStatusAposPagamento
} = require('../../backend/motores/motor-comercial/usecases/consignacao/prestacaoOperacaoHelpers');
const { derivarCamposCacheConsignacao } = require('../../backend/motores/motor-comercial/services/projections/ledgerCacheDerivation');
const {
  buildFilaOperacional,
  resolveEstadoOperacionalCliente,
  ESTADOS
} = require('../../frontend/modules/motor-comercial/pages/Dashboard/centralTrabalhoMappers');
const { criarMockOutboxService, adaptarUowParaOutbox } = require('./outbox-test-helpers');

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

const GRUPO_ID = 'prest-1-fechada';

function criarConsignacaoAcertada(overrides = {}) {
  return {
    id: 1,
    clienteId: 10,
    clienteNome: 'Cicero Diego',
    perfilComercialId: 5,
    status: 'ACERTADA',
    documento: { numero: 'CONS-2026-000001' },
    prestacaoContasAtiva: {
      id: GRUPO_ID,
      status: 'FECHADA',
      documento: { numero: 'PC-1' }
    },
    valorTotalEntregue: 25,
    valorTotalAcertado: 25,
    valorTotalPago: 0,
    saldoAberto: 25,
    ...overrides
  };
}

function criarMovimentosIniciais() {
  return [
    { id: 1, consignacaoId: 1, tipoMovimentacao: 'ENTREGA', valor: 25, grupoPrestacaoContasId: GRUPO_ID },
    { id: 2, consignacaoId: 1, tipoMovimentacao: 'ABERTURA_PRESTACAO', valor: 0, grupoPrestacaoContasId: GRUPO_ID },
    { id: 3, consignacaoId: 1, tipoMovimentacao: 'VENDA_PRESTACAO', valor: 25, grupoPrestacaoContasId: GRUPO_ID },
    { id: 4, consignacaoId: 1, tipoMovimentacao: 'FECHAMENTO_PRESTACAO', valor: 0, grupoPrestacaoContasId: GRUPO_ID }
  ];
}

function criarMockConsignacaoRepo(estadoInicial) {
  let store = { ...estadoInicial, prestacaoContasAtiva: { ...estadoInicial.prestacaoContasAtiva } };
  return {
    buscarPorId: async (id) => (Number(store.id) === Number(id)
      ? { ...store, prestacaoContasAtiva: store.prestacaoContasAtiva ? { ...store.prestacaoContasAtiva } : null }
      : null),
    atualizar: async (id, dados) => {
      if (Number(store.id) !== Number(id)) return null;
      const patch = { ...dados };
      if (patch.prestacaoContasAtiva) {
        store.prestacaoContasAtiva = { ...patch.prestacaoContasAtiva };
        delete patch.prestacaoContasAtiva;
      }
      store = { ...store, ...patch };
      return { ...store, prestacaoContasAtiva: store.prestacaoContasAtiva ? { ...store.prestacaoContasAtiva } : null };
    },
    listar: async (filtros = {}) => {
      if (filtros.perfilComercialId != null && Number(store.perfilComercialId) !== Number(filtros.perfilComercialId)) {
        return [];
      }
      return [{ ...store }];
    },
    get store() { return store; }
  };
}

function criarMockMovRepo(iniciais = []) {
  const movimentacoes = iniciais.map((m) => ({ ...m }));
  return {
    inserir: async (dados) => {
      const mov = { id: movimentacoes.length + 1, ...dados };
      movimentacoes.push(mov);
      return mov;
    },
    listar: async (filtros = {}) => movimentacoes.filter((m) => {
      if (filtros.consignacaoId != null && Number(m.consignacaoId) !== Number(filtros.consignacaoId)) return false;
      if (filtros.grupoPrestacaoContasId && String(m.grupoPrestacaoContasId) !== String(filtros.grupoPrestacaoContasId)) return false;
      return true;
    }),
    movimentacoes
  };
}

function criarDeps(consignacaoRepo, movRepo) {
  const itemRepo = {
    listarPorConsignacao: async () => [{
      id: 1,
      consignacaoId: 1,
      produtoId: 100,
      quantidadeEntregue: 1,
      precoUnitario: 25
    }]
  };
  const perfilRepo = {
    buscarPorId: async () => ({
      id: 5,
      clienteId: 10,
      limiteComercial: 1000,
      saldoAberto: 25
    }),
    atualizar: async (_id, dados) => ({ id: 5, ...dados })
  };
  const uow = {
    consignacao: consignacaoRepo,
    consignacaoItem: itemRepo,
    perfilComercial: perfilRepo,
    movimentacaoComercial: movRepo,
    executar: async (fn) => fn(uow)
  };
  const outboxService = criarMockOutboxService({
    financeiroBridge: {
      registrarReceitaConsignacao: async () => ({ ok: true }),
      registrarRecebimento: async () => ({ ok: true })
    }
  });
  adaptarUowParaOutbox(uow, outboxService);
  return {
    unitOfWork: uow,
    eventPublisher: { publicados: [], publicar() {}, flush: async () => {} },
    consignacaoRepository: consignacaoRepo,
    consignacaoItemRepository: itemRepo,
    perfilComercialRepository: perfilRepo,
    movimentacaoComercialRepository: movRepo,
    outboxService
  };
}

function classificar(consignacao) {
  return buildFilaOperacional({
    consignacoes: [consignacao],
    perfis: [{ clienteId: 10, clienteNome: 'Cicero Diego' }]
  });
}

async function main() {
  console.log('\nRCM-8.4 — Recebimento parcial de consignação\n');

  const repo = criarMockConsignacaoRepo(criarConsignacaoAcertada());
  const movRepo = criarMockMovRepo(criarMovimentosIniciais());
  const deps = criarDeps(repo, movRepo);
  const uc = new RegistrarPagamentoPrestacaoUseCase(deps);

  await test('1. Consignação ACERTADA com saldo R$ 25', async () => {
    const c = await repo.buscarPorId(1);
    assert.strictEqual(c.status, 'ACERTADA');
    assert.strictEqual(Number(c.saldoAberto), 25);
    assert.strictEqual(c.prestacaoContasAtiva.status, 'FECHADA');
  });

  let parcial = null;
  await test('2-3. Receber R$ 15 e saldo passa para R$ 10', async () => {
    parcial = await uc.executar({ consignacaoId: 1, valor: 15, origem: 'CONTA_CORRENTE_COMERCIAL' });
    assert.strictEqual(parcial.isOk(), true);
    assert.strictEqual(Number(parcial.dados.totais.saldo), 10);
    assert.strictEqual(Number(repo.store.saldoAberto), 10);
    assert.strictEqual(Number(repo.store.valorTotalPago), 15);
  });

  await test('4-6. Não criar/abrir prestação e não mudar para ENTREGUE', async () => {
    const aberturas = movRepo.movimentacoes.filter((m) => m.tipoMovimentacao === 'ABERTURA_PRESTACAO');
    const reaberturas = movRepo.movimentacoes.filter((m) => m.tipoMovimentacao === 'REABERTURA_PRESTACAO');
    assert.strictEqual(aberturas.length, 1);
    assert.strictEqual(reaberturas.length, 0);
    assert.strictEqual(repo.store.status, 'ACERTADA');
    assert.strictEqual(repo.store.prestacaoContasAtiva.status, 'FECHADA');
    assert.strictEqual(repo.store.prestacaoContasAtiva.id, GRUPO_ID);
    assert.notStrictEqual(repo.store.status, 'ENTREGUE');
  });

  await test('7-9. Permanece E5 em Consignados Pendentes, fora da Fila', async () => {
    const atual = {
      ...repo.store,
      saldo: repo.store.saldoAberto,
      saldoAberto: repo.store.saldoAberto
    };
    const resolved = resolveEstadoOperacionalCliente({ consignacoes: [atual] });
    assert.strictEqual(resolved.estado, ESTADOS.E5);
    const fila = classificar(atual);
    assert.strictEqual(fila.consignadosPendentes.length, 1);
    assert.strictEqual(fila.consignadosPendentes[0].valorEmAberto, 10);
    assert.strictEqual(fila.trabalhoPrioritario.length, 0);
  });

  await test('10-11. Recebimento no financeiro/Ledger', async () => {
    const pagamentos = movRepo.movimentacoes.filter((m) => m.tipoMovimentacao === 'PAGAMENTO');
    assert.strictEqual(pagamentos.length, 1);
    assert.strictEqual(Number(pagamentos[0].valor), 15);
    const cache = derivarCamposCacheConsignacao(movRepo.movimentacoes);
    assert.strictEqual(cache.valorTotalPago, 15);
    assert.strictEqual(cache.saldoAberto, 10);
  });

  await test('12-14. Receber R$ 10 restantes, saldo 0 e QUITADA', async () => {
    const quitacao = await uc.executar({ consignacaoId: 1, valor: 10, origem: 'CONTA_CORRENTE_COMERCIAL' });
    assert.strictEqual(quitacao.isOk(), true);
    assert.ok(Number(quitacao.dados.totais.saldo) <= 0);
    assert.strictEqual(repo.store.status, 'QUITADA');
    assert.strictEqual(Number(repo.store.saldoAberto), 0);
    assert.strictEqual(repo.store.prestacaoContasAtiva.status, 'FECHADA');
    assert.strictEqual(repo.store.prestacaoContasAtiva.id, GRUPO_ID);
  });

  await test('15-16. Sai de Consignados Pendentes e da Fila', async () => {
    const atual = {
      ...repo.store,
      saldo: 0,
      saldoAberto: 0
    };
    const fila = classificar(atual);
    assert.strictEqual(fila.consignadosPendentes.length, 0);
    assert.strictEqual(fila.trabalhoPrioritario.length, 0);
    assert.strictEqual(resolveEstadoOperacionalCliente({ consignacoes: [atual] }).estado, ESTADOS.E6);
  });

  await test('helpers: pagamento em prestação fechada e quitação de ENCERRADA', () => {
    const grupo = obterGrupoPrestacaoParaPagamento(criarConsignacaoAcertada());
    assert.strictEqual(grupo.status, 'FECHADA');
    assert.strictEqual(determinarStatusAposPagamento({ saldo: 10 }, 'ACERTADA'), null);
    assert.strictEqual(determinarStatusAposPagamento({ saldo: 0 }, 'ACERTADA'), 'QUITADA');
    assert.strictEqual(determinarStatusAposPagamento({ saldo: 0 }, 'ENCERRADA'), 'QUITADA');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main();
