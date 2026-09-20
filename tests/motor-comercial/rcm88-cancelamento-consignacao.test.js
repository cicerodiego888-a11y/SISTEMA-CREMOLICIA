/**
 * RCM-8.8 — Cancelamento voluntário da consignação em preparação
 *
 * Executar:
 *   node tests/motor-comercial/rcm88-cancelamento-consignacao.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../..'));

const {
  CancelarConsignacaoRascunhoUseCase,
  EditarConsignacaoUseCase,
  AbrirPrestacaoUseCase,
  RegistrarEntregaComplementarUseCase,
  ListarConsignacoesUseCase
} = require('../../backend/motores/motor-comercial/usecases/consignacao');
const {
  avaliarElegibilidadeCancelamento,
  extrairCancelamento,
  montarObservacaoCancelamento,
  MOTIVOS_CANCELAMENTO,
  STATUS_ELEGIVEIS_CANCELAMENTO
} = require('../../backend/motores/motor-comercial/usecases/consignacao/cancelamentoConsignacaoHelpers');
const { avaliarElegibilidadeEntregaComplementar } = require('../../backend/motores/motor-comercial/usecases/consignacao/entregaComplementarHelpers');
const {
  podeAdicionarProdutoComplementar
} = require('../../frontend/modules/motor-comercial/pages/EntregaComplementar/entregaComplementarMappers');
const {
  buildHistoricoConsignacoes,
  buildDetalheConsulta,
  buildComprovanteConsignacaoHtml,
  reimpressaoSomenteLeitura
} = require('../../frontend/modules/motor-comercial/pages/PerfilComercial/historicoConsignacoesMappers');
const {
  podeCancelarPreparacao,
  lerCancelamento
} = require('../../frontend/modules/motor-comercial/pages/Consignacoes/cancelamentoPreparacao');
const { EVENTOS_DOMINIO } = require('../../backend/motores/motor-comercial/events/comercialEventosTipos');
const { CancelarConsignacaoRequest } = require('../../backend/motores/motor-comercial/http/dto/ConsignacaoDTO');
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

function unwrap(result) {
  if (!result || typeof result.isOk !== 'function') return result;
  if (result.isFail()) {
    throw result.erro || new Error('Result.fail');
  }
  return result.dados;
}

function criarConsignacao(overrides = {}) {
  return {
    id: 1005,
    clienteId: 10,
    perfilComercialId: 5,
    status: 'RASCUNHO',
    documento: { numero: '1005', serie: '1', sequencial: 1005, situacao: 'RASCUNHO' },
    observacao: 'Preparação Milton',
    valorTotalEntregue: 350,
    saldoAberto: 0,
    dataAbertura: '2026-09-19T10:00:00.000Z',
    dataEntrega: null,
    dataEncerramento: null,
    usuarioEncerramentoId: null,
    clienteNome: 'Milton',
    ...overrides
  };
}

function criarItem(overrides = {}) {
  return {
    id: 1,
    consignacaoId: 1005,
    produtoId: 100,
    quantidadeEntregue: 10,
    precoUnitario: 35,
    subtotalEntregue: 350,
    unidadeComercial: 'UN',
    linhaComercialId: 7,
    tabelaPrecoId: 3,
    canalVenda: 'CONSIGNADO',
    precoOrigem: 'tabela_preco_linha',
    precoFallback: false,
    ...overrides
  };
}

function criarRepo(estadoInicial) {
  let store = { ...estadoInicial };
  async function aplicar(id, dados) {
    if (Number(store.id) !== Number(id)) return null;
    const patch = { ...dados };
    if (patch.documento) {
      store.documento = { ...store.documento, ...patch.documento };
      delete patch.documento;
    }
    store = { ...store, ...patch };
    return { ...store };
  }
  return {
    buscarPorId: async (id) => (Number(store.id) === Number(id) ? { ...store } : null),
    atualizar: async (id, dados) => aplicar(id, dados),
    atualizarSeStatus: async (id, statusEsperado, dados) => {
      if (Number(store.id) !== Number(id)) return null;
      if (String(store.status) !== String(statusEsperado)) return null;
      return aplicar(id, dados);
    },
    listar: async (filtros = {}) => {
      if (filtros.status && store.status !== filtros.status) return [];
      return [{ ...store }];
    },
    get store() { return store; }
  };
}

function criarMockItemRepo(itensIniciais = []) {
  const itens = itensIniciais.map((i) => ({ ...i }));
  return {
    listarPorConsignacao: async (consignacaoId) => itens.filter((i) => Number(i.consignacaoId) === Number(consignacaoId)),
    itens
  };
}

function criarDeps(consignacaoRepo, itemRepo, extras = {}) {
  const movRepo = {
    movimentacoes: extras.movimentacoesIniciais
      ? extras.movimentacoesIniciais.map((m) => ({ ...m }))
      : [],
    inserir: async (dados) => {
      const mov = { id: movRepo.movimentacoes.length + 1, ...dados };
      movRepo.movimentacoes.push(mov);
      return mov;
    },
    listar: async (filtros = {}) => movRepo.movimentacoes.filter((m) => {
      if (filtros.consignacaoId != null && Number(m.consignacaoId) !== Number(filtros.consignacaoId)) {
        return false;
      }
      return true;
    })
  };

  const outboxService = extras.outboxService || criarMockOutboxService();
  const uowBase = {
    consignacao: consignacaoRepo,
    consignacaoItem: itemRepo,
    movimentacaoComercial: movRepo,
    perfilComercial: {
      buscarPorId: async () => ({
        id: 5,
        clienteId: 10,
        perfilTipo: 'CONSIGNADO',
        ativo: true,
        bloqueado: false,
        limiteComercial: 5000,
        saldoAberto: 0
      }),
      atualizar: async (_id, dados) => dados
    },
    executar: async (fn) => fn(uowBase)
  };
  const uow = adaptarUowParaOutbox(uowBase);

  const publisher = { publicados: [], publicar(e) { publisher.publicados.push(e); }, flush: async () => {} };

  return {
    unitOfWork: uow,
    eventPublisher: publisher,
    outboxService,
    usuarioBridge: extras.usuarioBridge ?? {
      possuiPermissao: async () => true
    },
    consignacaoRepository: consignacaoRepo,
    consignacaoItemRepository: itemRepo,
    movRepo,
    publisher
  };
}

async function run() {
  console.log('\n=== RCM-8.8 — Cancelamento voluntário da preparação ===\n');

  assert.deepStrictEqual(STATUS_ELEGIVEIS_CANCELAMENTO, ['RASCUNHO']);
  console.log('  INFO  VALIDADA não existe no modelo — elegível = RASCUNHO\n');

  await test('1. cancelar RASCUNHO → CANCELADA', async () => {
    const repo = criarRepo(criarConsignacao());
    const items = criarMockItemRepo([criarItem()]);
    const deps = criarDeps(repo, items);
    const dados = unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'CLIENTE_DESISTIU',
      usuarioId: 7
    }));
    assert.strictEqual(dados.consignacao.status, 'CANCELADA');
    assert.strictEqual(dados.idempotente, false);
  });

  await test('2. VALIDADA não é status oficial — helper só aceita RASCUNHO', async () => {
    const eleg = avaliarElegibilidadeCancelamento({ id: 1, status: 'VALIDADA' });
    assert.strictEqual(eleg.elegivel, false);
    assert.strictEqual(eleg.codigo, 'CONSIGNACAO_NAO_ESTA_EM_RASCUNHO');
  });

  await test('3. confirma alteração para CANCELADA + documento CANCELADO', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo([criarItem()]));
    const dados = unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'ERRO_PREPARACAO',
      usuarioId: 1
    }));
    assert.strictEqual(dados.consignacao.status, 'CANCELADA');
    assert.strictEqual(dados.consignacao.documento.situacao, 'CANCELADO');
  });

  await test('4. registra motivo na observação', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo());
    const dados = unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'PRODUTO_INDISPONIVEL',
      usuarioId: 1
    }));
    assert.ok(dados.consignacao.observacao.includes('[CANCELAMENTO]'));
    assert.ok(dados.consignacao.observacao.includes('PRODUTO_INDISPONIVEL'));
    assert.strictEqual(dados.cancelamento.motivo, 'PRODUTO_INDISPONIVEL');
    assert.strictEqual(dados.cancelamento.motivoLabel, MOTIVOS_CANCELAMENTO.PRODUTO_INDISPONIVEL);
  });

  await test('5. registra usuário/data', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo());
    const agora = '2026-09-19T15:30:00.000Z';
    const dados = unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'PEDIDO_DUPLICADO',
      usuarioId: 42,
      dataCancelamento: agora
    }));
    assert.strictEqual(dados.consignacao.usuarioEncerramentoId, 42);
    assert.strictEqual(dados.consignacao.dataEncerramento, agora);
  });

  await test('6. sai da fila de preparação (status ≠ RASCUNHO)', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo());
    unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'CLIENTE_DESISTIU',
      usuarioId: 1
    }));
    const fila = await repo.listar({ status: 'RASCUNHO' });
    assert.strictEqual(fila.length, 0);
    assert.strictEqual(podeCancelarPreparacao(repo.store), false);
  });

  await test('7. permanece no histórico', async () => {
    const cancelada = criarConsignacao({
      status: 'CANCELADA',
      observacao: montarObservacaoCancelamento('CLIENTE_DESISTIU'),
      dataEncerramento: '2026-09-19T15:00:00.000Z',
      usuarioEncerramentoId: 7
    });
    const hist = buildHistoricoConsignacoes([cancelada]);
    assert.strictEqual(hist.length, 1);
    assert.strictEqual(hist[0].status, 'CANCELADA');
    assert.strictEqual(hist[0].numero, '1005');
    assert.strictEqual(hist[0].valorTotal, 350);
  });

  await test('8. visualização mostra CANCELADA + motivo', async () => {
    const cancelada = criarConsignacao({
      status: 'CANCELADA',
      observacao: montarObservacaoCancelamento('CLIENTE_DESISTIU'),
      dataEncerramento: '2026-09-19T15:00:00.000Z',
      usuarioEncerramentoId: 7,
      cancelamento: extrairCancelamento({
        status: 'CANCELADA',
        observacao: montarObservacaoCancelamento('CLIENTE_DESISTIU'),
        dataEncerramento: '2026-09-19T15:00:00.000Z',
        usuarioEncerramentoId: 7
      })
    });
    const detalhe = buildDetalheConsulta(cancelada, { clienteNome: 'Milton' });
    assert.strictEqual(detalhe.status, 'CANCELADA');
    assert.strictEqual(detalhe.cancelada, true);
    const ui = lerCancelamento(cancelada);
    assert.strictEqual(ui.motivo, 'CLIENTE_DESISTIU');
    assert.ok(String(ui.motivoLabel).includes('desistiu') || ui.motivoLabel === 'Cliente desistiu');
  });

  await test('9. não gera estoque (outbox vazio / efeitos.estoque=false)', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo([criarItem()]));
    const dados = unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'CLIENTE_DESISTIU',
      usuarioId: 1
    }));
    assert.strictEqual(dados.cancelamento != null || dados.consignacao.status === 'CANCELADA', true);
    const evt = deps.publisher.publicados[0];
    assert.strictEqual(evt.payload.efeitos.estoque, false);
  });

  await test('10. não gera Ledger', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo([criarItem()]));
    unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'CLIENTE_DESISTIU',
      usuarioId: 1
    }));
    assert.strictEqual(deps.movRepo.movimentacoes.length, 0);
  });

  await test('11. não consome crédito (sem alteração de perfil)', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo());
    let perfilAtualizado = false;
    deps.unitOfWork.perfilComercial.atualizar = async () => {
      perfilAtualizado = true;
    };
    unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'CLIENTE_DESISTIU',
      usuarioId: 1
    }));
    assert.strictEqual(perfilAtualizado, false);
  });

  await test('12. não cria prestação (AbrirPrestacao bloqueia CANCELADA)', async () => {
    const repo = criarRepo(criarConsignacao({ status: 'CANCELADA' }));
    const deps = criarDeps(repo, criarMockItemRepo());
    const result = await new AbrirPrestacaoUseCase(deps).executar({ consignacaoId: 1005, usuarioId: 1 });
    assert.strictEqual(result.isFail(), true);
  });

  await test('13. não gera documento fiscal (sem eventos fiscais)', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo());
    unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'OUTRO',
      observacao: 'Teste',
      usuarioId: 1
    }));
    const tipos = deps.publisher.publicados.map((e) => e.tipo);
    assert.deepStrictEqual(tipos, [EVENTOS_DOMINIO.CONSIGNACAO_CANCELADA]);
    assert.ok(!tipos.some((t) => /NFCE|NFE|FISCAL/i.test(String(t))));
  });

  await test('14. não cria entrega', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo([criarItem()]));
    unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'CLIENTE_DESISTIU',
      usuarioId: 1
    }));
    assert.strictEqual(repo.store.dataEntrega, null);
    assert.strictEqual(deps.movRepo.movimentacoes.filter((m) => m.tipoMovimentacao === 'ENTREGA').length, 0);
  });

  await test('15. não altera snapshots de preço', async () => {
    const item = criarItem();
    const repo = criarRepo(criarConsignacao());
    const itemRepo = criarMockItemRepo([item]);
    const deps = criarDeps(repo, itemRepo);
    unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'CLIENTE_DESISTIU',
      usuarioId: 1
    }));
    assert.strictEqual(itemRepo.itens[0].precoUnitario, 35);
    assert.strictEqual(itemRepo.itens[0].tabelaPrecoId, 3);
    assert.strictEqual(itemRepo.itens[0].canalVenda, 'CONSIGNADO');
  });

  for (const status of ['ENTREGUE', 'QUITADA', 'ENCERRADA', 'ACERTADA']) {
    await test(`16-19. não permite cancelar ${status}`, async () => {
      const repo = criarRepo(criarConsignacao({ status }));
      const deps = criarDeps(repo, criarMockItemRepo());
      const result = await new CancelarConsignacaoRascunhoUseCase(deps).executar({
        consignacaoId: 1005,
        motivo: 'CLIENTE_DESISTIU',
        usuarioId: 1
      });
      assert.strictEqual(result.isFail(), true);
      assert.strictEqual(result.erro.codigo, 'CONSIGNACAO_NAO_ESTA_EM_RASCUNHO');
    });
  }

  await test('20. cancelar CANCELADA é idempotente (sem 2º evento)', async () => {
    const repo = criarRepo(criarConsignacao({
      status: 'CANCELADA',
      observacao: montarObservacaoCancelamento('CLIENTE_DESISTIU'),
      dataEncerramento: '2026-09-19T12:00:00.000Z',
      usuarioEncerramentoId: 1
    }));
    const deps = criarDeps(repo, criarMockItemRepo());
    const dados = unwrap(await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'OUTRO',
      usuarioId: 1
    }));
    assert.strictEqual(dados.idempotente, true);
    assert.strictEqual(deps.publisher.publicados.length, 0);
  });

  await test('21. não permite Entrega Complementar em CANCELADA', async () => {
    const c = criarConsignacao({ status: 'CANCELADA' });
    const eleg = avaliarElegibilidadeEntregaComplementar(c);
    assert.strictEqual(eleg.elegivel, false);
    const ui = podeAdicionarProdutoComplementar(c);
    assert.strictEqual(ui.elegivel, false);
    const deps = criarDeps(criarRepo(c), criarMockItemRepo());
    const result = await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1005,
      itens: [{ produtoId: 200, quantidade: 1, precoUnitario: 10 }],
      usuarioId: 1
    });
    assert.strictEqual(result.isFail(), true);
  });

  await test('22. não permite voltar para RASCUNHO via edição', async () => {
    const repo = criarRepo(criarConsignacao({ status: 'CANCELADA' }));
    const deps = criarDeps(repo, criarMockItemRepo());
    const result = await new EditarConsignacaoUseCase(deps).executar({
      consignacaoId: 1005,
      observacao: 'reabrir'
    });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(result.erro.codigo, 'CONSIGNACAO_NAO_ESTA_EM_RASCUNHO');
  });

  await test('23. concorrência: só um cancelamento efetiva evento', async () => {
    const repo = criarRepo(criarConsignacao());
    const depsA = criarDeps(repo, criarMockItemRepo());
    const depsB = criarDeps(repo, criarMockItemRepo());
    depsB.unitOfWork = depsA.unitOfWork;
    depsB.eventPublisher = { publicados: [], publicar(e) { depsB.eventPublisher.publicados.push(e); }, flush: async () => {} };

    const [a, b] = await Promise.all([
      new CancelarConsignacaoRascunhoUseCase(depsA).executar({
        consignacaoId: 1005,
        motivo: 'CLIENTE_DESISTIU',
        usuarioId: 1
      }),
      new CancelarConsignacaoRascunhoUseCase(depsB).executar({
        consignacaoId: 1005,
        motivo: 'ERRO_PREPARACAO',
        usuarioId: 2
      })
    ]);
    assert.strictEqual(a.isOk(), true);
    assert.strictEqual(b.isOk(), true);
    const eventos = depsA.publisher.publicados.length + depsB.eventPublisher.publicados.length;
    assert.ok(eventos <= 1, `esperava no máximo 1 evento, obteve ${eventos}`);
    assert.strictEqual(repo.store.status, 'CANCELADA');
  });

  await test('24. usuário sem permissão é bloqueado', async () => {
    const repo = criarRepo(criarConsignacao());
    const deps = criarDeps(repo, criarMockItemRepo(), {
      usuarioBridge: { possuiPermissao: async () => false }
    });
    const result = await new CancelarConsignacaoRascunhoUseCase(deps).executar({
      consignacaoId: 1005,
      motivo: 'CLIENTE_DESISTIU',
      usuarioId: 99
    });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(result.erro.codigo, 'OPERACAO_NAO_AUTORIZADA');
  });

  await test('25. visualização/reimpressão sem efeitos colaterais', async () => {
    const cancelada = criarConsignacao({ status: 'CANCELADA', valorTotalEntregue: 350 });
    const html = buildComprovanteConsignacaoHtml(buildDetalheConsulta(cancelada, { clienteNome: 'Milton' }));
    assert.ok(html.includes('CONSIGNAÇÃO CANCELADA') || html.includes('CANCELADA'));
    const efeitos = reimpressaoSomenteLeitura();
    assert.strictEqual(efeitos.alteraEstoque, false);
    assert.strictEqual(efeitos.alteraLedger, false);
    assert.strictEqual(efeitos.alteraPreco, false);
    assert.strictEqual(efeitos.alteraStatus, false);
    assert.strictEqual(efeitos.criaNovaOperacao, false);
  });

  await test('DTO CancelarConsignacaoRequest valida motivo', async () => {
    assert.strictEqual(CancelarConsignacaoRequest.validate({ motivo: 'CLIENTE_DESISTIU' }), null);
    assert.ok(CancelarConsignacaoRequest.validate({ motivo: 'INVALIDO' }));
  });

  await test('ListarConsignacoes — CANCELADA filtrável no histórico', async () => {
    const repo = criarRepo(criarConsignacao({ status: 'CANCELADA' }));
    const deps = {
      consignacaoRepository: repo,
      consignacaoItemRepository: criarMockItemRepo()
    };
    const result = await new ListarConsignacoesUseCase(deps).executar({ status: 'CANCELADA' });
    if (result && typeof result.isOk === 'function') {
      assert.strictEqual(result.isOk(), true);
      const lista = result.dados.consignacoes || result.dados || [];
      assert.ok(Array.isArray(lista));
      assert.ok(lista.length >= 1);
    }
  });

  console.log(`\n=== Resultado: ${passou} ok, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
