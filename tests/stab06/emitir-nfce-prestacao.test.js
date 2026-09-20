/**
 * STAB-06.3 — EmitirNfcePrestacaoUseCase + UI Resumo Fiscal
 */

const assert = require('assert');
const EmitirNfcePrestacaoUseCase = require('../../backend/motores/motor-comercial/usecases/consignacao/EmitirNfcePrestacaoUseCase');
const { SITUACAO, toDto } = require('../../backend/motores/motor-comercial/services/prestacaoFaturamentoStore');
const {
  buildResumoFinalOficial
} = require('../../frontend/modules/motor-comercial/pages/PrestacaoContas/fecharConsignacaoMappers');

let passou = 0;
let falhou = 0;

async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    falhou += 1;
    console.error(`  ✗ ${nome}`);
    console.error(`    ${err.stack || err.message}`);
  }
}

function criarStoreMemoria(seed = null) {
  const byId = new Map();
  if (seed) byId.set(Number(seed.consignacao_id), { ...seed });

  return {
    SITUACAO,
    toDto,
    async obterPorConsignacao(consignacaoId) {
      return byId.get(Number(consignacaoId)) || null;
    },
    async salvar(dados = {}) {
      const id = Number(dados.consignacaoId);
      const atual = byId.get(id) || {};
      const row = {
        consignacao_id: id,
        grupo_prestacao_id: dados.grupoPrestacaoId != null
          ? Number(dados.grupoPrestacaoId)
          : (atual.grupo_prestacao_id ?? null),
        venda_id: dados.vendaId != null ? Number(dados.vendaId) : (atual.venda_id ?? null),
        situacao_fiscal: dados.situacaoFiscal || atual.situacao_fiscal || SITUACAO.PENDENTE,
        faturada: dados.faturada != null ? (dados.faturada ? 1 : 0) : (atual.faturada ?? 0),
        nfce_chave: dados.nfceChave !== undefined ? dados.nfceChave : (atual.nfce_chave ?? null),
        nfce_numero: dados.nfceNumero !== undefined ? dados.nfceNumero : (atual.nfce_numero ?? null),
        nfce_protocolo: dados.nfceProtocolo !== undefined ? dados.nfceProtocolo : (atual.nfce_protocolo ?? null),
        nfce_status: dados.nfceStatus !== undefined ? dados.nfceStatus : (atual.nfce_status ?? null),
        nfce_motivo: dados.nfceMotivo !== undefined ? dados.nfceMotivo : (atual.nfce_motivo ?? null)
      };
      byId.set(id, row);
      return row;
    }
  };
}

function montarUow({ totalVendido, totalRecebido, itens, consignacaoId = 10, grupoId = 55 }) {
  const consignacao = {
    id: consignacaoId,
    clienteId: 77,
    status: 'EM_PRESTACAO',
    prestacaoContasAtiva: {
      id: grupoId,
      status: 'ABERTA',
      consignacaoId
    }
  };

  const movs = [];
  if (totalVendido > 0) {
    movs.push({
      tipoMovimentacao: 'VENDA_PRESTACAO',
      valor: totalVendido,
      grupoPrestacaoContasId: grupoId,
      consignacaoId
    });
  }
  if (totalRecebido > 0) {
    movs.push({
      tipoMovimentacao: 'PAGAMENTO',
      valor: totalRecebido,
      grupoPrestacaoContasId: grupoId,
      consignacaoId
    });
  }

  return {
    async executar(fn) {
      return fn({
        consignacao: { buscarPorId: async () => consignacao },
        consignacaoItem: { listarPorConsignacao: async () => itens },
        movimentacaoComercial: {
          listar: async () => movs
        }
      });
    }
  };
}

function criarUseCase(opts = {}) {
  const store = opts.store || criarStoreMemoria();
  const criarCalls = [];
  const emitirCalls = [];
  const uc = new EmitirNfcePrestacaoUseCase({
    unitOfWork: opts.unitOfWork,
    faturamentoStore: store,
    vincularOrigem: async () => {},
    criarVendaFn: async (payload) => {
      criarCalls.push(payload);
      return { id: opts.vendaId || 9001 };
    },
    emitirPorVendaId: async (vendaId) => {
      emitirCalls.push(vendaId);
      if (typeof opts.emitir === 'function') return opts.emitir(vendaId);
      return opts.emitir || {
        success: true,
        status: 'autorizada',
        numero: 1234,
        chaveAcesso: 'CHAVE123',
        protocolo: 'PROT-1'
      };
    }
  });
  return { uc, store, criarCalls, emitirCalls };
}

async function run() {
  console.log('\n=== STAB-06.3 Emitir NFC-e Prestação ===\n');

  await test('UI — Encerrar bloqueado até AUTORIZADA', () => {
    const oficial = buildResumoFinalOficial(
      {},
      [],
      { valorTotal: 50, valorRecebido: 50 },
      { situacaoFiscal: 'PENDENTE', faturada: false, podeEncerrarFiscal: false, podeEmitir: true }
    );
    assert.strictEqual(oficial.podeEmitir, true);
    assert.strictEqual(oficial.podeEncerrar, false);
  });

  await test('UI — Após autorização libera Encerrar e oculta Emitir', () => {
    const oficial = buildResumoFinalOficial(
      {},
      [],
      { valorTotal: 50, valorRecebido: 40 },
      {
        situacaoFiscal: 'AUTORIZADA',
        faturada: true,
        podeEncerrarFiscal: true,
        podeEmitir: false,
        vendaId: 9001,
        nfce: { numero: '1234', chave: 'C', protocolo: 'P' }
      }
    );
    assert.strictEqual(oficial.podeEmitir, false);
    assert.strictEqual(oficial.podeEncerrar, true);
    assert.match(oficial.situacaoFiscalLabel, /1234/);
  });

  await test('UI — Rejeição permite nova emissão e bloqueia Encerrar', () => {
    const oficial = buildResumoFinalOficial(
      {},
      [],
      { valorTotal: 50, valorRecebido: 50 },
      {
        situacaoFiscal: 'REJEITADA',
        faturada: false,
        podeEncerrarFiscal: false,
        podeEmitir: true,
        vendaId: 9001,
        nfce: { motivo: 'Rejeicao 866' }
      }
    );
    assert.strictEqual(oficial.podeEmitir, true);
    assert.strictEqual(oficial.podeEncerrar, false);
    assert.match(oficial.situacaoFiscalLabel, /866/);
  });

  await test('UI — Somente não fiscal (NAO_APLICAVEL) libera Encerrar', () => {
    const oficial = buildResumoFinalOficial(
      {},
      [],
      { valorTotal: 30, valorRecebido: 30 },
      {
        situacaoFiscal: 'NAO_APLICAVEL',
        faturada: true,
        podeEncerrarFiscal: true,
        podeEmitir: false
      }
    );
    assert.strictEqual(oficial.exigeNfce, false);
    assert.strictEqual(oficial.podeEncerrar, true);
    assert.strictEqual(oficial.podeEmitir, false);
  });

  await test('UI — Sem venda consignada permite Encerrar sem Emitir', () => {
    const oficial = buildResumoFinalOficial(
      {},
      [],
      { valorTotal: 0, valorRecebido: 0 },
      null
    );
    assert.strictEqual(oficial.podeEmitir, false);
    assert.strictEqual(oficial.podeEncerrar, true);
  });

  await test('UI — parcial paga (50/40) mantém saldos no resumo', () => {
    const oficial = buildResumoFinalOficial(
      {},
      [],
      { valorTotal: 50, valorRecebido: 40 },
      { situacaoFiscal: 'PENDENTE', faturada: false }
    );
    assert.strictEqual(oficial.valorVenda, 50);
    assert.strictEqual(oficial.valorRecebido, 40);
    assert.strictEqual(oficial.saldoEmAberto, 10);
    assert.strictEqual(oficial.situacaoFinanceira, 'PARCIALMENTE_RECEBIDA');
  });

  await test('toDto — motivo de rejeição sem chave', () => {
    const dto = toDto({
      consignacao_id: 1,
      venda_id: 9,
      situacao_fiscal: 'REJEITADA',
      faturada: 0,
      nfce_motivo: 'Rejeicao SEFAZ 999'
    });
    assert.strictEqual(dto.nfce.motivo, 'Rejeicao SEFAZ 999');
    assert.strictEqual(dto.podeEncerrarFiscal, false);
    assert.strictEqual(dto.podeEmitir, true);
  });

  await test('UC — quitada cria venda 1x e autoriza via Motor Fiscal', async () => {
    const { uc, criarCalls, emitirCalls } = criarUseCase({
      unitOfWork: montarUow({
        totalVendido: 50,
        totalRecebido: 50,
        itens: [{ id: 1, produtoId: 1, quantidadeVendida: 1, precoUnitario: 50 }]
      })
    });
    const result = await uc.executar({ consignacaoId: 10 });
    assert.strictEqual(result.sucesso, true);
    assert.strictEqual(criarCalls.length, 1);
    assert.strictEqual(criarCalls[0].emitir_fiscal, true);
    assert.ok(criarCalls[0].itens[0].quantidade_fiscal > 0, 'itens fiscais na venda oficial');
    assert.strictEqual(emitirCalls.length, 1);
    assert.strictEqual(result.dados.faturamento.situacaoFiscal, 'AUTORIZADA');
    assert.strictEqual(result.dados.faturamento.vendaId, 9001);
    assert.strictEqual(result.dados.faturamento.nfce.numero, '1234');
  });

  await test('UC — parcial paga também emite', async () => {
    const { uc } = criarUseCase({
      unitOfWork: montarUow({
        totalVendido: 50,
        totalRecebido: 40,
        itens: [{ id: 1, produtoId: 1, quantidadeVendida: 1, precoUnitario: 50 }]
      })
    });
    const result = await uc.executar({ consignacaoId: 10 });
    assert.strictEqual(result.sucesso, true);
    assert.strictEqual(result.dados.integridade.saldoEmAberto, 10);
    assert.strictEqual(result.dados.faturamento.situacaoFiscal, 'AUTORIZADA');
  });

  await test('UC — rejeição SEFAZ mantém venda e permite retry', async () => {
    const store = criarStoreMemoria();
    const uow = montarUow({
      totalVendido: 50,
      totalRecebido: 50,
      itens: [{ id: 1, produtoId: 1, quantidadeVendida: 1, precoUnitario: 50 }]
    });
    let emits = 0;
    const { uc, criarCalls } = criarUseCase({
      unitOfWork: uow,
      store,
      emitir: async () => {
        emits += 1;
        if (emits === 1) {
          return {
            success: false,
            status: 'rejeitada',
            soap: { raw: '<xMotivo>Rejeicao 866</xMotivo>' }
          };
        }
        return {
          success: true,
          status: 'autorizada',
          numero: 99,
          chaveAcesso: 'K99',
          protocolo: 'P99'
        };
      }
    });

    const r1 = await uc.executar({ consignacaoId: 10 });
    assert.strictEqual(r1.sucesso, true);
    assert.strictEqual(r1.dados.faturamento.situacaoFiscal, 'REJEITADA');
    assert.match(r1.dados.faturamento.nfce.motivo, /866/);
    assert.strictEqual(r1.dados.vendaId, 9001);
    assert.strictEqual(criarCalls.length, 1);

    const r2 = await uc.executar({ consignacaoId: 10 });
    assert.strictEqual(r2.sucesso, true);
    assert.strictEqual(criarCalls.length, 1, 'não cria nova venda no retry');
    assert.strictEqual(r2.dados.vendaCriada, false);
    assert.strictEqual(r2.dados.faturamento.situacaoFiscal, 'AUTORIZADA');
  });

  await test('UC — já autorizada não reemit (reimpressão)', async () => {
    const store = criarStoreMemoria({
      consignacao_id: 10,
      grupo_prestacao_id: 55,
      venda_id: 777,
      situacao_fiscal: 'AUTORIZADA',
      faturada: 1,
      nfce_numero: '1234',
      nfce_chave: 'CHAVE',
      nfce_protocolo: 'P'
    });
    const { uc, criarCalls, emitirCalls } = criarUseCase({
      unitOfWork: montarUow({
        totalVendido: 50,
        totalRecebido: 50,
        itens: [{ id: 1, produtoId: 1, quantidadeVendida: 1, precoUnitario: 50 }]
      }),
      store
    });
    const r = await uc.executar({ consignacaoId: 10 });
    assert.strictEqual(r.dados.fiscal.reused, true);
    assert.strictEqual(criarCalls.length, 0);
    assert.strictEqual(emitirCalls.length, 0);
  });

  await test('UC — somente não fiscal (sem_itens_fiscais)', async () => {
    const { uc } = criarUseCase({
      unitOfWork: montarUow({
        totalVendido: 20,
        totalRecebido: 20,
        itens: [{ id: 1, produtoId: 2, quantidadeVendida: 1, precoUnitario: 20 }]
      }),
      emitir: { success: true, status: 'sem_itens_fiscais', message: 'sem fiscais' }
    });
    const r = await uc.executar({ consignacaoId: 10 });
    assert.strictEqual(r.dados.faturamento.situacaoFiscal, 'NAO_APLICAVEL');
    assert.strictEqual(r.dados.faturamento.faturada, true);
  });

  await test('UC — sem itens vendidos → NAO_APLICAVEL sem criar venda', async () => {
    const { uc, criarCalls, emitirCalls } = criarUseCase({
      unitOfWork: montarUow({
        totalVendido: 0,
        totalRecebido: 0,
        itens: [{ id: 1, produtoId: 1, quantidadeVendida: 0, precoUnitario: 10 }]
      })
    });
    const r = await uc.executar({ consignacaoId: 10 });
    assert.strictEqual(r.dados.faturamento.situacaoFiscal, 'NAO_APLICAVEL');
    assert.strictEqual(criarCalls.length, 0);
    assert.strictEqual(emitirCalls.length, 0);
  });

  await test('UC — duplo clique: 2ª chamada após AUTORIZADA não reemit', async () => {
    const store = criarStoreMemoria();
    const uow = montarUow({
      totalVendido: 50,
      totalRecebido: 50,
      itens: [{ id: 1, produtoId: 1, quantidadeVendida: 1, precoUnitario: 50 }]
    });
    const { uc, emitirCalls } = criarUseCase({ unitOfWork: uow, store });
    await uc.executar({ consignacaoId: 10 });
    await uc.executar({ consignacaoId: 10 });
    assert.strictEqual(emitirCalls.length, 1);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
