/**
 * RCM-8.17.2 — Pagamento parcial: loading do card, segundo pagamento e idempotência.
 *
 * Executar:
 *   npm run test:motor-comercial-frontend -- --testPathPatterns=rcm8172-pagamento-parcial
 */

jest.mock('../../api/MotorComercialApi', () => jest.fn().mockImplementation(() => ({
  obterConsignacao: jest.fn(async () => null),
  obterRateioPerda: jest.fn(async () => null),
  obterResumoFinalPrestacao: jest.fn(async () => null),
  listarItensConsignacao: jest.fn(async () => []),
  registrarPagamento: jest.fn(async () => ({ ok: true })),
  abrirPrestacao: jest.fn(async () => ({ ok: true }))
})));

jest.mock('../../api/ProjectionApi', () => jest.fn().mockImplementation(() => ({
  obterResumoPrestacao: jest.fn(async () => null),
  listarMovimentacoes: jest.fn(async () => []),
  obterProjecaoContaCorrente: jest.fn(async () => null)
})));

jest.mock('../../utils/operacional', () => {
  const actual = jest.requireActual('../../utils/operacional');
  return {
    ...actual,
    carregarConsignacaoCompleta: jest.fn(),
    buscarClientePorIdErp: jest.fn(async () => null),
    withLoading: jest.fn((_msg, fn) => fn()),
    notify: jest.fn(),
    navigate: jest.fn(async () => null),
    confirmDialog: jest.fn(async () => true),
    obterItensCacheConsignacao: jest.fn(() => []),
    getUsuarioId: jest.fn(() => 'op-1')
  };
});

const PrestacaoContasPage = require('../../pages/PrestacaoContas');
const { LOAD_MODO } = PrestacaoContasPage;
const { STEP_RESUMO } = require('../../pages/PrestacaoContas/fecharConsignacaoMappers');
const { MENSAGENS_HARDENING } = require('../../pages/PrestacaoContas/prestacaoHardening');
const { SITUACAO } = require('../../pages/PrestacaoContas/prestacaoFinanceiroSnapshot');
const { carregarConsignacaoCompleta, notify } = require('../../utils/operacional');

function itemVenda() {
  return {
    id: 1,
    itemId: 1,
    produtoId: 10,
    produtoNome: 'Produto A',
    consignacaoId: 'A',
    quantidadeEntregue: 1,
    enviado: 1,
    quantidadeVendida: 1,
    vendido: 1,
    quantidadeDevolvida: 0,
    devolvido: 0,
    quantidadePerdida: 0,
    perdido: 0,
    quantidadeCortesia: 0,
    cortesia: 0,
    precoUnitario: 158,
    preco: 158
  };
}

function makeConsignacao() {
  return {
    id: 'A',
    clienteId: 42,
    clienteNome: 'CLIENTE PAGAMENTO',
    status: 'EM_PRESTACAO',
    documento: { numero: 'CONS-A' },
    itens: [itemVenda()],
    prestacaoContasAtiva: { id: 'GRUPO-1', status: 'ABERTA' }
  };
}

function movPagamento({ id, valor, forma }) {
  return {
    id,
    tipoMovimentacao: 'PAGAMENTO',
    valor,
    formaPagamento: forma,
    dataMovimentacao: '2026-09-21T18:00:00.000Z',
    snapshot: { formaPagamento: forma, valor, operacaoMeta: { formaPagamento: forma, valor } }
  };
}

function botoesRegistrar(page) {
  return [...(page.root?.querySelectorAll('button') || [])]
    .filter((btn) => /Registrar Pagamento|Registrando/i.test(btn.textContent || ''));
}

function aplicarServidor(page, { recebido, movs }) {
  page.projectionApi.obterResumoPrestacao.mockResolvedValue({
    valorVendido: 158,
    valorVenda: 158,
    valorRecebido: recebido,
    totalPago: recebido,
    saldoAtual: roundSaldo(158 - recebido),
    itens: [itemVenda()]
  });
  page.projectionApi.listarMovimentacoes.mockResolvedValue(movs);
}

function roundSaldo(n) {
  return Math.round(n * 100) / 100;
}

async function abrirResumo() {
  carregarConsignacaoCompleta.mockResolvedValue(makeConsignacao());
  const page = new PrestacaoContasPage('A', { clienteId: '42' });
  document.body.appendChild(page.render());
  if (page._loadTimeout) {
    clearTimeout(page._loadTimeout);
    page._loadTimeout = null;
  }
  aplicarServidor(page, { recebido: 0, movs: [] });
  await page._loadData(false, { modo: LOAD_MODO.INICIAL });
  page.prestacaoPronta = true;
  page.currentStep = STEP_RESUMO;
  page.steps[STEP_RESUMO].state = 'current';
  page._recalcularPainel();
  page._updateUI();
  return page;
}

describe('RCM-8.17.2 pagamento parcial e loading', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    carregarConsignacaoCompleta.mockResolvedValue(makeConsignacao());
  });

  test('A) R$158 → R$130 PIX: recebido 130, saldo 28, loading false, card habilitado', async () => {
    const page = await abrirResumo();
    page.api.registrarPagamento.mockImplementation(async () => {
      aplicarServidor(page, {
        recebido: 130,
        movs: [movPagamento({ id: 11, valor: 130, forma: 'PIX' })]
      });
      return { ok: true };
    });
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();

    const fin = page.snapshot.financeiro;
    expect(fin.valorVenda).toBe(158);
    expect(fin.valorRecebido).toBe(130);
    expect(fin.saldoEmAberto).toBe(28);
    expect(fin.situacaoFinanceira).toBe(SITUACAO.PARCIALMENTE_RECEBIDA);
    expect(page.loading.operation).toBe(false);
    const cardBtn = botoesRegistrar(page).find((b) =>
      b.closest('[data-card="pagamentos"]')
    );
    expect(cardBtn).toBeTruthy();
    expect(cardBtn.disabled).toBe(false);
    expect(cardBtn.textContent).toMatch(/Registrar Pagamento/);
    expect(cardBtn.textContent).not.toMatch(/Registrando/);
    page.destroy();
  });

  test('B/G) R$28 DINHEIRO após parcial: recebido 158, saldo 0, loading false', async () => {
    const page = await abrirResumo();
    page.api.registrarPagamento.mockImplementation(async (_id, data) => {
      const valor = Number(data.valor);
      if (valor === 130) {
        aplicarServidor(page, {
          recebido: 130,
          movs: [movPagamento({ id: 11, valor: 130, forma: 'PIX' })]
        });
      } else {
        aplicarServidor(page, {
          recebido: 158,
          movs: [
            movPagamento({ id: 11, valor: 130, forma: 'PIX' }),
            movPagamento({ id: 12, valor: 28, forma: 'DINHEIRO' })
          ]
        });
      }
      return { ok: true };
    });
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();
    page.pagamentoDraft.valor = '28';
    page.pagamentoDraft.formaPagamento = 'DINHEIRO';
    await page._registrarPagamento();

    const fin = page.snapshot.financeiro;
    expect(fin.valorRecebido).toBe(158);
    expect(fin.saldoEmAberto).toBe(0);
    expect(fin.situacaoFinanceira).toBe(SITUACAO.QUITADA);
    expect(page.loading.operation).toBe(false);
    expect(page.api.registrarPagamento).toHaveBeenCalledTimes(2);
    const hist = page.snapshot.pagamentos;
    expect(hist.map((p) => p.valor).sort((a, b) => b - a)).toEqual([130, 28]);
    expect(hist.some((p) => p.forma === 'PIX')).toBe(true);
    expect(hist.some((p) => p.forma === 'DINHEIRO')).toBe(true);
    page.destroy();
  });

  test('C/D) card não permanece em Registrando; footer e card usam o mesmo estado', async () => {
    const page = await abrirResumo();
    page.api.registrarPagamento.mockImplementation(async () => {
      aplicarServidor(page, {
        recebido: 130,
        movs: [movPagamento({ id: 11, valor: 130, forma: 'PIX' })]
      });
      return { ok: true };
    });
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();
    const botoes = botoesRegistrar(page);
    expect(botoes.length).toBeGreaterThanOrEqual(1);
    botoes.forEach((btn) => {
      expect(btn.textContent).not.toMatch(/Registrando/);
      expect(page.loading.operation).toBe(false);
    });
    page.destroy();
  });

  test('E) duplo clique dispara um único POST', async () => {
    const page = await abrirResumo();
    let release;
    page.api.registrarPagamento.mockImplementation(() => new Promise((resolve) => {
      release = () => {
        aplicarServidor(page, {
          recebido: 130,
          movs: [movPagamento({ id: 11, valor: 130, forma: 'PIX' })]
        });
        resolve({ ok: true });
      };
    }));
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    const p1 = page._registrarPagamento();
    await Promise.resolve();
    await Promise.resolve();
    const p2 = page._registrarPagamento();
    expect(page.loading.operation).toBe(true);
    expect(typeof release).toBe('function');
    release();
    await Promise.all([p1, p2]);
    expect(page.api.registrarPagamento).toHaveBeenCalledTimes(1);
    expect(page.loading.operation).toBe(false);
    page.destroy();
  });

  test('F) após parcial o segundo pagamento permanece disponível', async () => {
    const page = await abrirResumo();
    page.api.registrarPagamento.mockImplementation(async () => {
      aplicarServidor(page, {
        recebido: 130,
        movs: [movPagamento({ id: 11, valor: 130, forma: 'PIX' })]
      });
      return { ok: true };
    });
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();
    const form = page.root.querySelector('.cds-op-pagamento-form');
    expect(form).toBeTruthy();
    expect(form.querySelector('input')).toBeTruthy();
    expect(form.querySelector('select')).toBeTruthy();
    const cardBtn = botoesRegistrar(page).find((b) => b.closest('[data-card="pagamentos"]'));
    expect(cardBtn.disabled).toBe(false);
    page.destroy();
  });

  test('H) erro do backend libera loading', async () => {
    const page = await abrirResumo();
    page.api.registrarPagamento.mockRejectedValue(new Error('Falha ao registrar pagamento'));
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();
    expect(page.loading.operation).toBe(false);
    expect(page.pagamentoErro).toBeTruthy();
    page.destroy();
  });

  test('I/J) timeout após persistência sincroniza UI e não duplica', async () => {
    const page = await abrirResumo();
    page.api.registrarPagamento.mockImplementation(async () => {
      aplicarServidor(page, {
        recebido: 130,
        movs: [movPagamento({ id: 11, valor: 130, forma: 'PIX' })]
      });
      throw new Error('Tempo esgotado ao chamar POST /consignacoes/A/prestacao/pagamento (30000ms)');
    });
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();
    expect(page.loading.operation).toBe(false);
    expect(page.snapshot.financeiro.valorRecebido).toBe(130);
    expect(page.snapshot.financeiro.saldoEmAberto).toBe(28);
    expect(notify).toHaveBeenCalledWith(MENSAGENS_HARDENING.PAGAMENTO_JA_REGISTRADO, 'info');
    expect(page.api.registrarPagamento).toHaveBeenCalledTimes(1);
    page.destroy();
  });

  test('I) timeout sem persistência libera para nova tentativa', async () => {
    const page = await abrirResumo();
    page.api.registrarPagamento.mockRejectedValue(new Error('Tempo esgotado ao chamar POST'));
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();
    expect(page.loading.operation).toBe(false);
    expect(page.snapshot.financeiro.valorRecebido).toBe(0);
    const cardBtn = botoesRegistrar(page).find((b) => b.closest('[data-card="pagamentos"]'));
    expect(cardBtn.disabled).toBe(false);
    page.destroy();
  });

  test('K) reload após R$130 preserva saldo 28 e libera novo pagamento', async () => {
    carregarConsignacaoCompleta.mockResolvedValue(makeConsignacao());
    const page = new PrestacaoContasPage('A', { clienteId: '42' });
    document.body.appendChild(page.render());
    if (page._loadTimeout) {
      clearTimeout(page._loadTimeout);
      page._loadTimeout = null;
    }
    aplicarServidor(page, {
      recebido: 130,
      movs: [movPagamento({ id: 11, valor: 130, forma: 'PIX' })]
    });
    await page._loadData(false, { modo: LOAD_MODO.INICIAL });
    page.currentStep = STEP_RESUMO;
    page._recalcularPainel();
    page._updateUI();
    expect(page.snapshot.financeiro.valorRecebido).toBe(130);
    expect(page.snapshot.financeiro.saldoEmAberto).toBe(28);
    expect(page.loading.operation).toBe(false);
    const cardBtn = botoesRegistrar(page).find((b) => b.closest('[data-card="pagamentos"]'));
    expect(cardBtn && !cardBtn.disabled).toBe(true);
    page.destroy();
  });

  test('L) R$130 já persistido na instância não cria duplicata', async () => {
    const page = await abrirResumo();
    page.api.registrarPagamento.mockImplementation(async () => {
      aplicarServidor(page, {
        recebido: 130,
        movs: [movPagamento({ id: 11, valor: 130, forma: 'PIX' })]
      });
      return { ok: true };
    });
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();
    expect(page.api.registrarPagamento).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(MENSAGENS_HARDENING.PAGAMENTO_JA_REGISTRADO, 'info');
    page.destroy();
  });

  test('POST envia Idempotency-Key existente (sem migration)', async () => {
    const page = await abrirResumo();
    page.api.registrarPagamento.mockImplementation(async () => {
      aplicarServidor(page, {
        recebido: 130,
        movs: [movPagamento({ id: 11, valor: 130, forma: 'PIX' })]
      });
      return { ok: true };
    });
    page.pagamentoDraft.valor = '130';
    page.pagamentoDraft.formaPagamento = 'PIX';
    await page._registrarPagamento();
    const opts = page.api.registrarPagamento.mock.calls[0][2];
    expect(opts.headers['Idempotency-Key']).toMatch(/^pag-A-130-PIX-/);
    page.destroy();
  });
});
