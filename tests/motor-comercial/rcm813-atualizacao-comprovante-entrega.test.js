/**
 * RCM-8.13 — Atualização pós-entrega e comprovante completo
 *
 * Executar:
 *   node tests/motor-comercial/rcm813-atualizacao-comprovante-entrega.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../..'));

const {
  montarHistoricoEntregasAtualizado,
  montarComprovanteEntregaAtualizado,
  renderComprovanteTexto,
  formatarNumeroComprovante,
  obterComprovanteDoHistorico,
  OPERACAO_ALTERACAO_POS_ENTREGA,
  TIPOS_EVENTO_ENTREGA,
  avaliarElegibilidadeAlteracaoPosEntrega
} = require('../../backend/motores/motor-comercial/usecases/consignacao/atualizacaoEntregaHelpers');
const {
  OPERACAO_ENTREGA_COMPLEMENTAR,
  montarHistoricoEntregas
} = require('../../backend/motores/motor-comercial/usecases/consignacao/entregaComplementarHelpers');
const {
  RegistrarAlteracaoPosEntregaUseCase
} = require('../../backend/motores/motor-comercial/usecases/consignacao');
const { criarMockOutboxService, adaptarUowParaOutbox } = require('./outbox-test-helpers');
const { OUTBOX_EVENT_TYPES } = require('../../backend/motores/motor-comercial/integrations/outbox/OutboxEventTypes');

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

function unwrap(result) {
  if (!result || typeof result.isOk !== 'function') return result;
  if (result.isFail()) throw result.erro || new Error('Result.fail');
  return result.dados;
}

function criarConsignacao(overrides = {}) {
  return {
    id: 14,
    clienteId: 10,
    perfilComercialId: 5,
    status: 'ENTREGUE',
    documento: { numero: 'CONS-2026-000014', serie: '1', sequencial: 14, situacao: 'ATIVO' },
    valorTotalEntregue: 348,
    saldoAberto: 348,
    dataEntrega: '2026-09-20T10:00:00.000Z',
    prestacaoContasAtiva: { id: 'PREST-001', status: 'ABERTA', grupoPrestacaoContasId: 'PREST-001' },
    ...overrides
  };
}

function criarItensOriginais() {
  return [
    {
      id: 1, consignacaoId: 14, produtoId: 50, produtoNome: 'PICOLE LINHA CREMOSA',
      quantidadeEntregue: 150, precoUnitario: 2, subtotalEntregue: 300,
      unidadeComercial: 'UN', linhaComercialId: 2, tabelaPrecoId: 1,
      canalVenda: 'CONSIGNADO', precoOrigem: 'tabela_preco_linha', precoFallback: false
    },
    {
      id: 2, consignacaoId: 14, produtoId: 60, produtoNome: 'SORVETE IOGURT 90G',
      quantidadeEntregue: 20, precoUnitario: 2, subtotalEntregue: 40,
      unidadeComercial: 'UN', linhaComercialId: 2, tabelaPrecoId: 1,
      canalVenda: 'CONSIGNADO', precoOrigem: 'tabela_preco_linha', precoFallback: false
    },
    {
      id: 3, consignacaoId: 14, produtoId: 70, produtoNome: 'SORVETE-200 ML',
      quantidadeEntregue: 4, precoUnitario: 2, subtotalEntregue: 8,
      unidadeComercial: 'UN', linhaComercialId: 2, tabelaPrecoId: 1,
      canalVenda: 'CONSIGNADO', precoOrigem: 'tabela_preco_linha', precoFallback: false
    }
  ];
}

function movEntrega({ correlationId, operacao, item, quantidade, quantidadeAnterior, delta, quantidadeAtual, ts, valor, createdAtNaive }) {
  const qtd = Number(quantidade);
  const ant = quantidadeAnterior != null ? Number(quantidadeAnterior) : 0;
  const d = delta != null ? Number(delta) : qtd;
  const atual = quantidadeAtual != null ? Number(quantidadeAtual) : ant + d;
  const iso = ts || '2026-09-20T13:51:06.090Z';
  return {
    id: `${correlationId}-${item.id}`,
    consignacaoId: 14,
    consignacaoItemId: item.id,
    tipoMovimentacao: 'ENTREGA',
    correlationId,
    quantidade: d,
    valor: valor != null ? valor : d * Number(item.precoUnitario),
    usuarioId: 1,
    dataMovimentacao: iso,
    createdAt: createdAtNaive != null
      ? createdAtNaive
      : iso,
    motivo: operacao === OPERACAO_ALTERACAO_POS_ENTREGA ? 'CLIENTE_DESISTIU' : null,
    snapshot: {
      capturadoEm: iso,
      contexto: { operacao },
      documento: { numero: 'CONS-2026-000014' },
      item: {
        id: item.id,
        produtoId: item.produtoId,
        produtoNome: item.produtoNome,
        quantidade: d,
        quantidadeAnterior: ant,
        delta: d,
        quantidadeAtual: atual,
        precoUnitario: item.precoUnitario
      }
    }
  };
}

function criarCenarioCompleto() {
  const itens = criarItensOriginais();
  const t0 = '2026-09-20T10:00:00.000Z';
  const t1 = '2026-09-20T11:00:00.000Z';
  const t2 = '2026-09-20T12:00:00.000Z';

  const movsOriginal = itens.map((item) => movEntrega({
    correlationId: 'corr-001',
    operacao: 'ENTREGA',
    item,
    quantidade: item.quantidadeEntregue,
    quantidadeAnterior: 0,
    delta: item.quantidadeEntregue,
    quantidadeAtual: item.quantidadeEntregue,
    ts: t0
  }));

  const picole = itens[0];
  const movsComp = [
    movEntrega({
      correlationId: 'corr-002',
      operacao: OPERACAO_ENTREGA_COMPLEMENTAR,
      item: picole,
      quantidade: 30,
      quantidadeAnterior: 150,
      delta: 30,
      quantidadeAtual: 180,
      ts: t1
    })
  ];

  const iogurt = { ...itens[1], quantidadeEntregue: 0 };
  const movsAlt = [
    movEntrega({
      correlationId: 'corr-003',
      operacao: OPERACAO_ALTERACAO_POS_ENTREGA,
      item: iogurt,
      quantidade: -20,
      quantidadeAnterior: 20,
      delta: -20,
      quantidadeAtual: 0,
      ts: t2
    })
  ];

  const itensAposComp = itens.map((i) => (
    i.produtoId === 50
      ? { ...i, quantidadeEntregue: 180, subtotalEntregue: 360 }
      : { ...i }
  ));
  const itensFinais = itensAposComp.map((i) => (
    i.produtoId === 60
      ? { ...i, quantidadeEntregue: 0, subtotalEntregue: 0 }
      : { ...i }
  ));

  return {
    itensOriginais: itens,
    itensAposComp,
    itensFinais,
    movs: [...movsOriginal, ...movsComp, ...movsAlt]
  };
}

function criarMockItemRepo(itensIniciais = []) {
  const itens = itensIniciais.map((i) => ({ ...i }));
  return {
    listarPorConsignacao: async () => itens.map((i) => ({ ...i })),
    buscarPorId: async (id) => {
      const found = itens.find((i) => Number(i.id) === Number(id));
      return found ? { ...found } : null;
    },
    atualizar: async (id, dados) => {
      const idx = itens.findIndex((i) => Number(i.id) === Number(id));
      if (idx < 0) return null;
      itens[idx] = { ...itens[idx], ...dados };
      return { ...itens[idx] };
    },
    get store() { return itens; }
  };
}

function criarMockMovRepo(movsIniciais = []) {
  const store = [...movsIniciais];
  return {
    listar: async (filtros = {}) => {
      let rows = [...store];
      if (filtros.consignacaoId != null) {
        rows = rows.filter((m) => Number(m.consignacaoId) === Number(filtros.consignacaoId));
      }
      if (filtros.correlationId != null) {
        rows = rows.filter((m) => String(m.correlationId) === String(filtros.correlationId));
      }
      return rows;
    },
    inserir: async (dados) => {
      const row = { id: `mov-${store.length + 1}`, createdAt: new Date().toISOString(), ...dados };
      store.push(row);
      return row;
    },
    get store() { return store; }
  };
}

function criarMockConsignacaoRepo(estado) {
  let store = { ...estado };
  return {
    buscarPorId: async (id) => (Number(store.id) === Number(id) ? { ...store } : null),
    atualizar: async (id, dados) => {
      if (Number(store.id) !== Number(id)) return null;
      store = { ...store, ...dados };
      return { ...store };
    },
    listar: async () => [store],
    get store() { return store; }
  };
}

function criarDeps(consignacao, itemRepo, movRepo, extras = {}) {
  const consignacaoRepo = criarMockConsignacaoRepo(consignacao);
  const perfilRepo = {
    buscarPorId: async () => ({
      id: 5, clienteId: 10, limiteComercial: 50000, saldoAberto: 348, bloqueado: false, ativo: true
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
  adaptarUowParaOutbox(uow);

  const outboxService = criarMockOutboxService({
    estoqueBridge: {
      registrarSaidaConsignacao: async () => ({ ok: true }),
      registrarEntradaConsignacao: async () => ({ ok: true })
    }
  });

  return {
    unitOfWork: uow,
    eventPublisher: {
      publicados: [],
      publicar(e) { this.publicados.push(e); },
      flush: async () => {}
    },
    consignacaoRepository: consignacaoRepo,
    consignacaoItemRepository: itemRepo,
    movimentacaoComercialRepository: movRepo,
    perfilComercialRepository: perfilRepo,
    outboxService,
    ...extras
  };
}

async function main() {
  console.log('\n=== RCM-8.13 — Atualização / Comprovante ===\n');

  await test('1. numeração 001/002/003', async () => {
    assert.strictEqual(formatarNumeroComprovante(1), '001');
    assert.strictEqual(formatarNumeroComprovante(2), '002');
    assert.strictEqual(formatarNumeroComprovante(3), '003');
  });

  await test('2. comprovante original preservado (lista 150/20/4)', async () => {
    const { movs, itensOriginais } = criarCenarioCompleto();
    const hist = montarHistoricoEntregasAtualizado(movs.slice(0, 3), itensOriginais);
    assert.strictEqual(hist[0].numeroComprovante, '001');
    assert.strictEqual(hist[0].tipo, TIPOS_EVENTO_ENTREGA.ORIGINAL);
    const cmp = hist[0].comprovante;
    assert.ok(cmp.listaCompleta.some((i) => i.produtoNome.includes('PICOLE') && i.quantidade === 150));
    assert.ok(cmp.listaCompleta.some((i) => i.produtoNome.includes('IOGURT') && i.quantidade === 20));
    assert.strictEqual(cmp.quantidadeTotalAtual, 174);
    assert.strictEqual(cmp.atualizacao, null);
  });

  await test('3. complementação + comprovante COMPLETO 002', async () => {
    const { movs, itensAposComp } = criarCenarioCompleto();
    const hist = montarHistoricoEntregasAtualizado(movs.slice(0, 4), itensAposComp);
    assert.strictEqual(hist.length, 2);
    assert.strictEqual(hist[1].numeroComprovante, '002');
    assert.strictEqual(hist[1].tipo, TIPOS_EVENTO_ENTREGA.COMPLEMENTAR);
    const cmp = hist[1].comprovante;
    const picole = cmp.listaCompleta.find((i) => Number(i.produtoId) === 50);
    const iogurt = cmp.listaCompleta.find((i) => Number(i.produtoId) === 60);
    const ml = cmp.listaCompleta.find((i) => Number(i.produtoId) === 70);
    assert.strictEqual(picole.quantidade, 180);
    assert.strictEqual(iogurt.quantidade, 20);
    assert.strictEqual(ml.quantidade, 4);
    assert.strictEqual(cmp.quantidadeTotalAtual, 204);
    assert.strictEqual(cmp.atualizacao.tipo, 'ENTREGA COMPLEMENTAR');
    const det = cmp.atualizacao.itens.find((i) => Number(i.produtoId) === 50);
    assert.strictEqual(det.quantidadeAnterior, 150);
    assert.strictEqual(det.complemento, '+30');
    assert.strictEqual(det.quantidadeAtual, 180);
    const texto = renderComprovanteTexto({
      ...cmp,
      numeroConsignacao: 'CONS-2026-000014'
    });
    assert.ok(texto.includes('COMPROVANTE DE ENTREGA Nº 002'));
    assert.ok(texto.includes('180'));
    assert.ok(texto.includes('Complemento: +30'));
    assert.ok(!texto.includes('COMPROVANTE DE ENTREGA COMPLEMENTAR\n\nPicolé +30'));
  });

  await test('4. alteração pós-entrega + comprovante 003', async () => {
    const { movs, itensFinais } = criarCenarioCompleto();
    const hist = montarHistoricoEntregasAtualizado(movs, itensFinais);
    assert.strictEqual(hist.length, 3);
    assert.strictEqual(hist[2].numeroComprovante, '003');
    assert.strictEqual(hist[2].tipo, TIPOS_EVENTO_ENTREGA.ALTERACAO_POS_ENTREGA);
    const cmp = hist[2].comprovante;
    assert.strictEqual(cmp.listaCompleta.find((i) => Number(i.produtoId) === 50).quantidade, 180);
    assert.strictEqual(cmp.listaCompleta.find((i) => Number(i.produtoId) === 60).quantidade, 0);
    assert.strictEqual(cmp.listaCompleta.find((i) => Number(i.produtoId) === 70).quantidade, 4);
    assert.strictEqual(cmp.quantidadeTotalAtual, 184);
    const det = cmp.atualizacao.itens.find((i) => Number(i.produtoId) === 60);
    assert.strictEqual(det.quantidadeAnterior, 20);
    assert.strictEqual(det.alteracao, '-20');
    assert.strictEqual(det.quantidadeAtual, 0);
  });

  await test('5. comprovante 002 permanece intacto após alteração', async () => {
    const { movs, itensFinais, itensAposComp } = criarCenarioCompleto();
    const histAntes = montarHistoricoEntregasAtualizado(movs.slice(0, 4), itensAposComp);
    const cmp002Antes = JSON.stringify(histAntes[1].comprovante.listaCompleta);
    const histDepois = montarHistoricoEntregasAtualizado(movs, itensFinais);
    const cmp002Depois = JSON.stringify(histDepois[1].comprovante.listaCompleta);
    assert.strictEqual(cmp002Antes, cmp002Depois);
    assert.strictEqual(histDepois[1].comprovante.quantidadeTotalAtual, 204);
  });

  await test('6-9. anterior / delta / atual / total', async () => {
    const cmp = montarComprovanteEntregaAtualizado({
      numeroConsignacao: 'CONS-2026-000014',
      numeroComprovante: '002',
      sequencia: 2,
      tipo: TIPOS_EVENTO_ENTREGA.COMPLEMENTAR,
      itensSituacaoAtual: [
        { produtoId: 50, produtoNome: 'PICOLE LINHA CREMOSA', quantidade: 180, precoUnitario: 2 },
        { produtoId: 60, produtoNome: 'SORVETE IOGURT 90G', quantidade: 20, precoUnitario: 2 },
        { produtoId: 70, produtoNome: 'SORVETE-200 ML', quantidade: 4, precoUnitario: 2 }
      ],
      itensEvento: [
        {
          produtoId: 50, produtoNome: 'PICOLE LINHA CREMOSA',
          quantidadeAnterior: 150, delta: 30, quantidadeAtual: 180, afetado: true
        }
      ]
    });
    assert.strictEqual(cmp.quantidadeTotalAtual, 204);
    assert.strictEqual(cmp.atualizacao.itens.find((i) => i.produtoId === 50).quantidadeAnterior, 150);
    assert.strictEqual(cmp.atualizacao.itens.find((i) => i.produtoId === 50).delta, 30);
    assert.strictEqual(cmp.atualizacao.itens.find((i) => i.produtoId === 60).afetado, false);
  });

  await test('10. histórico cronológico Original→Complementar→Alteração', async () => {
    const { movs, itensFinais } = criarCenarioCompleto();
    const hist = montarHistoricoEntregas(movs, itensFinais);
    assert.deepStrictEqual(hist.map((h) => h.tipo), [
      'ORIGINAL', 'COMPLEMENTAR', 'ALTERACAO_POS_ENTREGA'
    ]);
    assert.deepStrictEqual(hist.map((h) => h.numeroComprovante), ['001', '002', '003']);
  });

  await test('11. numeração sequencial sem reutilizar', async () => {
    const { movs, itensFinais } = criarCenarioCompleto();
    const nums = montarHistoricoEntregasAtualizado(movs, itensFinais).map((h) => h.numeroComprovante);
    assert.strictEqual(new Set(nums).size, nums.length);
  });

  await test('12. reimpressão somente leitura', async () => {
    const { movs, itensFinais } = criarCenarioCompleto();
    const hist = montarHistoricoEntregasAtualizado(movs, itensFinais);
    const cmp = obterComprovanteDoHistorico(hist, 'corr-001');
    assert.ok(cmp);
    assert.strictEqual(cmp.somenteLeitura, true);
    assert.strictEqual(cmp.preservado, true);
    assert.strictEqual(cmp.numeroComprovante, '001');
  });

  await test('13-14. alteração UC — estoque delta + ledger append-only', async () => {
    const consignacao = criarConsignacao();
    const itens = criarItensOriginais().map((i) => (
      i.produtoId === 50 ? { ...i, quantidadeEntregue: 180, subtotalEntregue: 360 } : { ...i }
    ));
    const itemRepo = criarMockItemRepo(itens);
    const movRepo = criarMockMovRepo([]);
    for (const m of criarCenarioCompleto().movs.slice(0, 4)) {
      await movRepo.inserir(m);
    }
    const deps = criarDeps(consignacao, itemRepo, movRepo);

    const uc = new RegistrarAlteracaoPosEntregaUseCase(deps);
    const result = unwrap(await uc.executar({
      consignacaoId: 14,
      motivo: 'CLIENTE_DESISTIU',
      correlationId: 'corr-alt-test',
      usuarioId: 1,
      itens: [{ itemId: 2, produtoId: 60, quantidadeNova: 0 }]
    }));

    assert.strictEqual(result.idempotente, false);
    assert.ok(result.comprovante);
    assert.strictEqual(result.comprovante.atualizacao.tipo, 'ALTERAÇÃO PÓS-ENTREGA');
    const iogurt = itemRepo.store.find((i) => i.produtoId === 60);
    assert.strictEqual(Number(iogurt.quantidadeEntregue), 0);
    assert.strictEqual(Number(iogurt.precoUnitario), 2);
    assert.ok(result.movimentacoes.length >= 1);
    assert.strictEqual(
      result.movimentacoes[0].snapshot.contexto.operacao,
      OPERACAO_ALTERACAO_POS_ENTREGA
    );
  });

  await test('15-17. mesma consignação / mesma prestação / situação atual', async () => {
    const { movs, itensFinais } = criarCenarioCompleto();
    const hist = montarHistoricoEntregasAtualizado(movs, itensFinais);
    assert.ok(hist.every((h) => h.comprovante));
    const atual = hist[hist.length - 1];
    assert.strictEqual(atual.quantidadeTotalAtual, 184);
    // PREST-001 permanece no cenário (sem nova prestação)
    const consignacao = criarConsignacao();
    assert.strictEqual(consignacao.prestacaoContasAtiva.id, 'PREST-001');
    assert.strictEqual(avaliarElegibilidadeAlteracaoPosEntrega(consignacao).elegivel, true);
  });

  await test('18. idempotência alteração', async () => {
    const consignacao = criarConsignacao();
    const itens = criarItensOriginais();
    const itemRepo = criarMockItemRepo(itens);
    const movRepo = criarMockMovRepo([]);
    const deps = criarDeps(consignacao, itemRepo, movRepo);
    const uc = new RegistrarAlteracaoPosEntregaUseCase(deps);

    const r1 = unwrap(await uc.executar({
      consignacaoId: 14,
      motivo: 'CLIENTE_DESISTIU',
      correlationId: 'corr-idem',
      itens: [{ itemId: 2, quantidadeNova: 15 }]
    }));
    const r2 = unwrap(await uc.executar({
      consignacaoId: 14,
      motivo: 'CLIENTE_DESISTIU',
      correlationId: 'corr-idem',
      itens: [{ itemId: 2, quantidadeNova: 15 }]
    }));
    assert.strictEqual(r1.idempotente, false);
    assert.strictEqual(r2.idempotente, true);
    assert.strictEqual(Number(itemRepo.store.find((i) => i.id === 2).quantidadeEntregue), 15);
  });

  await test('19. concorrência — elegibilidade bloqueada se prestação fechada', async () => {
    const check = avaliarElegibilidadeAlteracaoPosEntrega(criarConsignacao({
      prestacaoContasAtiva: { id: 'PREST-001', status: 'FECHADA' }
    }));
    assert.strictEqual(check.elegivel, false);
  });

  await test('20. preço/snapshot preservado na alteração', async () => {
    const consignacao = criarConsignacao();
    const itens = criarItensOriginais();
    const itemRepo = criarMockItemRepo(itens);
    const movRepo = criarMockMovRepo([]);
    const deps = criarDeps(consignacao, itemRepo, movRepo);
    const uc = new RegistrarAlteracaoPosEntregaUseCase(deps);
    unwrap(await uc.executar({
      consignacaoId: 14,
      motivo: 'AJUSTE_OPERACIONAL',
      correlationId: 'corr-preco',
      itens: [{ itemId: 1, quantidadeNova: 140 }]
    }));
    const picole = itemRepo.store.find((i) => i.id === 1);
    assert.strictEqual(picole.precoUnitario, 2);
    assert.strictEqual(picole.precoOrigem, 'tabela_preco_linha');
    assert.strictEqual(picole.tabelaPrecoId, 1);
    assert.strictEqual(picole.linhaComercialId, 2);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
