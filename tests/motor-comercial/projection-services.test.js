/**
 * Testes — Projection Services (Sprint 2.4.4)
 * Executar: npm run test:motor-comercial-projection
 */

const assert = require('assert');
const {
  ProjectionContext,
  ProjectionResult,
  ContaCorrenteProjectionService,
  TimelineProjectionService,
  ResumoPrestacaoProjectionService,
  SaldoProjectionService,
  IndicadoresProjectionService,
  DashboardProjectionService,
  HistoricoProjectionService,
  SituacaoClienteProjectionService
} = require('../../backend/motores/motor-comercial/services/projections');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { passou += 1; console.log(`  OK  ${nome}`); })
    .catch((err) => { falhou += 1; console.error(`  FALHOU  ${nome}\n         ${err.message}`); });
}

function criarMovimentacoes() {
  return [
    { id: 1, consignacaoId: 1, tipoMovimentacao: 'ENTREGA', valor: 100, dataMovimentacao: '2026-06-01T10:00:00.000Z', correlationId: 'c1' },
    { id: 2, consignacaoId: 1, tipoMovimentacao: 'ABERTURA_PRESTACAO', valor: null, grupoPrestacaoContasId: 'g1', dataMovimentacao: '2026-06-02T10:00:00.000Z', correlationId: 'c2' },
    { id: 3, consignacaoId: 1, tipoMovimentacao: 'VENDA_PRESTACAO', valor: 50, grupoPrestacaoContasId: 'g1', dataMovimentacao: '2026-06-03T10:00:00.000Z', correlationId: 'c3' },
    { id: 4, consignacaoId: 1, tipoMovimentacao: 'PERDA', valor: 10, grupoPrestacaoContasId: 'g1', dataMovimentacao: '2026-06-04T10:00:00.000Z', correlationId: 'c4' },
    { id: 5, consignacaoId: 1, tipoMovimentacao: 'PAGAMENTO', valor: 30, grupoPrestacaoContasId: 'g1', dataMovimentacao: '2026-06-05T10:00:00.000Z', correlationId: 'c5' },
    { id: 6, consignacaoId: 1, tipoMovimentacao: 'FECHAMENTO_PRESTACAO', valor: 20, grupoPrestacaoContasId: 'g1', dataMovimentacao: '2026-06-06T10:00:00.000Z', correlationId: 'c6' }
  ];
}

function criarMockMovRepo(movimentacoes = criarMovimentacoes()) {
  const store = [...movimentacoes];
  return {
    inserir: async () => { throw new Error('Projection Services não devem escrever'); },
    listar: async (filtros = {}) => store.filter((m) => {
      if (filtros.consignacaoId != null && m.consignacaoId !== filtros.consignacaoId) return false;
      if (filtros.grupoPrestacaoContasId && m.grupoPrestacaoContasId !== filtros.grupoPrestacaoContasId) return false;
      if (filtros.tipoMovimentacao && m.tipoMovimentacao !== filtros.tipoMovimentacao) return false;
      return true;
    }),
    movimentacoes: store
  };
}

function criarMockPerfilMovRepo() {
  return {
    inserir: async () => { throw new Error('Projection Services não devem escrever'); },
    listar: async (filtros = {}) => ([
      { id: 1, perfilComercialId: 5, clienteId: 10, tipoMovimentacao: 'LIMITE_ALTERADO', valor: 10000, dataMovimentacao: '2026-05-01T10:00:00.000Z' }
    ]).filter((m) => {
      if (filtros.clienteId != null && m.clienteId !== filtros.clienteId) return false;
      if (filtros.perfilComercialId != null && m.perfilComercialId !== filtros.perfilComercialId) return false;
      return true;
    })
  };
}

function criarMockConsignacaoRepo() {
  const consignacao = {
    id: 1,
    clienteId: 10,
    perfilComercialId: 5,
    status: 'ACERTADA',
    documento: { numero: 'C001', serie: '1', sequencial: 1 },
    prestacaoContasAtiva: {
      id: 'g1',
      status: 'FECHADA',
      documento: { numero: 'PC-1' }
    }
  };
  return {
    buscarPorId: async (id) => (id === 1 ? { ...consignacao } : null),
    listar: async (filtros = {}) => {
      if (filtros.clienteId != null && consignacao.clienteId !== filtros.clienteId) return [];
      return [{ ...consignacao }];
    },
    inserir: async () => { throw new Error('Projection Services não devem escrever'); },
    atualizar: async () => { throw new Error('Projection Services não devem escrever'); }
  };
}

function criarMockPerfilRepo() {
  return {
    listar: async (filtros = {}) => ([{
      id: 5,
      clienteId: 10,
      perfilTipo: 'CONSIGNADO',
      limiteComercial: 10000,
      saldoAberto: 50,
      bloqueado: false,
      ativo: true
    }]).filter((p) => filtros.clienteId == null || p.clienteId === filtros.clienteId)
  };
}

function criarDeps(movRepo = criarMockMovRepo()) {
  return {
    movimentacaoComercialRepository: movRepo,
    movimentacaoPerfilRepository: criarMockPerfilMovRepo(),
    consignacaoRepository: criarMockConsignacaoRepo(),
    perfilComercialRepository: criarMockPerfilRepo()
  };
}

async function run() {
  console.log('\n=== Testes Projection Services — Sprint 2.4.4 ===\n');

  await test('ProjectionResult — estrutura padrão', async () => {
    const result = ProjectionResult.create({
      dados: { ok: true },
      totais: { x: 1 },
      indicadores: { y: 2 },
      paginacao: { total: 1 },
      metadata: { derivadoDoLedger: true }
    });
    assert.strictEqual(result.dados.ok, true);
    assert.strictEqual(result.totais.x, 1);
    assert.ok(result.toJSON().metadata.derivadoDoLedger);
  });

  await test('ProjectionContext — filtros comercial', async () => {
    const ctx = ProjectionContext.create({
      consignacaoId: 1,
      grupoPrestacaoContasId: 'g1',
      limite: 10,
      offset: 0
    });
    const filtros = ctx.toFiltrosComercial();
    assert.strictEqual(filtros.consignacaoId, 1);
    assert.strictEqual(filtros.grupoPrestacaoContasId, 'g1');
  });

  await test('ContaCorrenteProjectionService — saldos corretos', async () => {
    const deps = criarDeps();
    const result = await new ContaCorrenteProjectionService(deps).executar({ consignacaoId: 1 });
    assert.ok(result instanceof ProjectionResult);
    assert.strictEqual(result.metadata.derivadoDoLedger, true);
    assert.strictEqual(result.totais.vendas, 50);
    assert.strictEqual(result.totais.pagamentos, 30);
    // SSOT CreditoComercial: AR (50-30=20) + estoque consignado (100-50-10=40) = 60
    assert.strictEqual(result.totais.saldoAtual, 60);
    assert.strictEqual(result.dados.saldoDevedor, 60);
    assert.strictEqual(result.dados.lancamentos.length, 5);
    assert.ok(result.dados.lancamentos.every((l) => l.descricao && l.saldoProjetado != null));
  });

  await test('TimelineProjectionService — ordem cronológica', async () => {
    const deps = criarDeps();
    const result = await new TimelineProjectionService(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.dados.eventos.length, 6);
    assert.strictEqual(result.dados.eventos[0].tipo, 'ENTREGA');
    assert.strictEqual(result.dados.eventos[5].tipo, 'FECHAMENTO_PRESTACAO');
  });

  await test('TimelineProjectionService — clienteId sem consignacaoId', async () => {
    const deps = criarDeps();
    const result = await new TimelineProjectionService(deps).executar({ clienteId: 10, limite: 30 });
    assert.strictEqual(result.dados.eventos.length, 6);
    assert.strictEqual(result.dados.eventos[0].tipo, 'ENTREGA');
  });

  await test('TimelineProjectionService — sem escopo retorna vazio (HTTP 200)', async () => {
    const deps = criarDeps();
    const result = await new TimelineProjectionService(deps).executar({
      dataInicio: '2026-01-01T00:00:00.000Z',
      dataFim: '2026-12-31T23:59:59.999Z',
      limite: 12
    });
    assert.strictEqual(result.dados.eventos.length, 0);
    assert.strictEqual(result.totais.totalEventos, 0);
  });

  await test('ResumoPrestacaoProjectionService — totais da prestação', async () => {
    const deps = criarDeps();
    const result = await new ResumoPrestacaoProjectionService(deps).executar({
      consignacaoId: 1,
      grupoPrestacaoContasId: 'g1'
    });
    assert.strictEqual(result.dados.totalVendido, 50);
    assert.strictEqual(result.dados.totalPerdido, 10);
    assert.strictEqual(result.dados.totalPago, 30);
    assert.strictEqual(result.dados.saldo, 20);
    assert.ok(result.dados.documento);
  });

  await test('SaldoProjectionService — saldos derivados', async () => {
    const deps = criarDeps();
    const result = await new SaldoProjectionService(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.totais.saldoVendido, 50);
    assert.strictEqual(result.totais.saldoRecebido, 30);
    assert.strictEqual(result.totais.saldoEmAberto, 20);
  });

  await test('IndicadoresProjectionService — KPIs', async () => {
    const deps = criarDeps();
    const result = await new IndicadoresProjectionService(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.indicadores.valorConsignado, 100);
    assert.strictEqual(result.indicadores.valorVendido, 50);
    assert.strictEqual(result.indicadores.quantidadePrestacoes, 1);
  });

  await test('DashboardProjectionService — cards e alertas', async () => {
    const deps = criarDeps();
    const result = await new DashboardProjectionService(deps).executar({ consignacaoId: 1 });
    assert.ok(result.dados.cards.length >= 4);
    assert.ok(result.dados.kpis.valorVendido === 50);
    assert.ok(Array.isArray(result.dados.alertas));
  });

  await test('HistoricoProjectionService — filtros e paginação', async () => {
    const deps = criarDeps();
    const result = await new HistoricoProjectionService(deps).executar({
      clienteId: 10,
      limite: 3,
      offset: 0
    });
    assert.strictEqual(result.dados.movimentacoes.length, 3);
    assert.strictEqual(result.totais.total, 7);
    assert.strictEqual(result.paginacao.possuiMais, true);
  });

  await test('SituacaoClienteProjectionService — consolidação', async () => {
    const deps = criarDeps();
    const result = await new SituacaoClienteProjectionService(deps).executar({ clienteId: 10 });
    assert.strictEqual(result.dados.clienteId, 10);
    assert.ok(result.dados.perfil);
    assert.strictEqual(result.dados.limite, 10000);
    // SSOT CreditoComercial: AR 20 + estoque consignado 40 = 60
    assert.strictEqual(result.dados.saldo, 60);
    assert.ok(result.dados.ultimoPagamento);
    assert.strictEqual(result.dados.statusGeral, 'EM_ABERTO');
  });

  await test('Projection Services — nenhuma escrita no repositório', async () => {
    const movRepo = criarMockMovRepo();
    let escritaTentada = false;
    movRepo.inserir = async () => { escritaTentada = true; return {}; };
    const deps = criarDeps(movRepo);

    await new ContaCorrenteProjectionService(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(escritaTentada, false);
  });

  await test('ContaCorrenteProjectionService — clienteId agrega consignações', async () => {
    const deps = criarDeps();
    const result = await new ContaCorrenteProjectionService(deps).executar({ clienteId: 10 });
    assert.strictEqual(result.dados.escopo, 'CLIENTE');
    assert.strictEqual(result.dados.clienteId, 10);
    assert.strictEqual(result.totais.saldoAtual, 60);
    assert.strictEqual(result.dados.lancamentos.length, 5);
  });

  await test('ContaCorrente — agrupa ENTREGA por correlationId', async () => {
    const movRepo = criarMockMovRepo([
      { id: 1, consignacaoId: 1, tipoMovimentacao: 'ENTREGA', valor: 40, dataMovimentacao: '2026-06-01T10:00:00.000Z', correlationId: 'e1', motivo: 'Entrega de consignação' },
      { id: 2, consignacaoId: 1, tipoMovimentacao: 'ENTREGA', valor: 30, dataMovimentacao: '2026-06-01T10:00:01.000Z', correlationId: 'e1', motivo: 'Entrega de consignação' },
      { id: 3, consignacaoId: 1, tipoMovimentacao: 'VENDA_PRESTACAO', valor: 40, dataMovimentacao: '2026-06-02T10:00:00.000Z', correlationId: 'v1', motivo: 'Venda' }
    ]);
    const result = await new ContaCorrenteProjectionService(criarDeps(movRepo)).executar({ consignacaoId: 1 });
    assert.strictEqual(result.dados.lancamentos.length, 2);
    assert.strictEqual(result.dados.lancamentos[0].valor, 70);
    assert.strictEqual(result.dados.lancamentos[0].descricao, 'Entrega de consignação (2 itens)');
    assert.strictEqual(result.dados.lancamentos[0].saldoProjetado, 70);
    assert.strictEqual(result.totais.saldoAtual, 70);
  });

  await test('ContaCorrente — validação consignacaoId ou clienteId', async () => {
    const deps = criarDeps();
    await assert.rejects(
      () => new ContaCorrenteProjectionService(deps).executar({}),
      (err) => err.codigo === 'DOCUMENTO_INVALIDO'
    );
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
