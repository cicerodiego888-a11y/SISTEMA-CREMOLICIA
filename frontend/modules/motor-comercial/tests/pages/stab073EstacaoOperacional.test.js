/**
 * STAB-07.3 — Estação Operacional (polimento UX)
 * Mantido como regressão visual/parcial após STAB-07.4.
 */

const FecharConsignacaoView = require('../../pages/PrestacaoContas/FecharConsignacaoView');
const {
  buildPagamentosHistorico,
  buildPrestacaoSnapshot,
  buildFinanceiroFromResumo
} = require('../../pages/PrestacaoContas/prestacaoFinanceiroSnapshot');
const {
  buildTimelineOficial,
  TIMELINE_MARCA
} = require('../../pages/PrestacaoContas/prestacaoOperacionalConsolidacao');

describe('STAB-07.3 estação operacional', () => {
  test('marcas da timeline: concluído / atual / pendente / atenção', () => {
    expect(TIMELINE_MARCA.concluida).toBe('✓');
    expect(TIMELINE_MARCA.atual).toBe('●');
    expect(TIMELINE_MARCA.pendente).toBe('○');
    expect(TIMELINE_MARCA.atencao).toBe('⚠');
  });

  test('histórico de pagamentos formata linhas (modal)', () => {
    const html = FecharConsignacaoView._htmlListaPagamentos([
      {
        forma: 'PIX',
        valor: 20,
        data: new Date().toISOString(),
        operador: 'João'
      }
    ]);
    expect(html).toMatch(/cds-op-hist-modal-table/);
    expect(html).toMatch(/PIX/);
    expect(html).toMatch(/João/);
    expect(html).toMatch(/R\$/);
  });

  test('formulário diferencia débito e crédito e apresenta os rótulos no histórico', () => {
    const section = FecharConsignacaoView._buildBlocoPagamentos(
      { pagamentoDraft: { valor: '25', formaPagamento: 'CARTAO_CREDITO' } },
      { onPagamentoChange: () => {}, onRegistrarPagamento: () => {} },
      { valorVenda: 100, saldoEmAberto: 25, situacaoFinanceira: 'PARCIAL' }
    );
    const select = section.querySelector('select');
    const opcoes = Array.from(select.options).map((option) => ({
      value: option.value,
      label: option.textContent.trim()
    }));

    expect(opcoes).toContainEqual({ value: 'CARTAO_DEBITO', label: 'Débito' });
    expect(opcoes).toContainEqual({ value: 'CARTAO_CREDITO', label: 'Crédito' });
    expect(opcoes.some((option) => option.value === 'CARTAO')).toBe(false);
    expect(select.value).toBe('CARTAO_CREDITO');

    const historico = FecharConsignacaoView._htmlListaPagamentos([
      { forma: 'CARTAO_DEBITO', valor: 10 },
      { forma: 'CARTAO_CREDITO', valor: 15 },
      { forma: 'CARTAO', valor: 5 }
    ]);
    expect(historico).toMatch(/Débito/);
    expect(historico).toMatch(/Crédito/);
    expect(historico).toMatch(/Cartão/);
  });

  test('card financeiro destaca KPIs venda / recebido / saldo', () => {
    const html = FecharConsignacaoView._htmlCardFinanceiro(
      { valorVenda: 30, valorRecebido: 20, saldoEmAberto: 10 },
      'Parcialmente recebida'
    );
    expect(html).toMatch(/cds-op-kpi--venda/);
    expect(html).toMatch(/cds-op-kpi--recebido/);
    expect(html).toMatch(/cds-op-kpi--saldo/);
    expect(html).toMatch(/Valor da Venda/);
    expect(html).toMatch(/Recebido/);
    expect(html).toMatch(/Saldo/);
  });

  test('patchCentralOperacional atualiza só o card financeiro', () => {
    const financeiro = buildFinanceiroFromResumo({ valorVendido: 30, totalPago: 10 });
    const timeline = buildTimelineOficial({
      consignacao: { status: 'EM_PRESTACAO' },
      financeiro,
      faturamento: null,
      currentStep: 3,
      encerrado: false
    });
    const snapAntes = buildPrestacaoSnapshot(
      { valorVendido: 30, totalPago: 10 },
      {
        pagamentos: buildPagamentosHistorico([]),
        timeline,
        logOperacional: [],
        fiscal: { codigo: 'PENDENTE', label: 'Pendente' }
      }
    );

    const root = FecharConsignacaoView.renderConferenciaFinal(
      {
        consignacao: { id: 1, status: 'EM_PRESTACAO' },
        clienteDetalhe: { nome: 'Cliente' },
        faturamento: null,
        historico: [],
        pagamentoDraft: { valor: '', formaPagamento: 'DINHEIRO' },
        snapshot: snapAntes
      },
      {
        onPagamentoChange: () => {},
        onRegistrarPagamento: () => {},
        onAbrirHistoricoPagamentos: () => {}
      }
    );

    const finAntes = root.querySelector('[data-kpi="recebido"]').textContent;

    const snapDepois = buildPrestacaoSnapshot(
      { valorVendido: 30, totalPago: 20 },
      {
        pagamentos: [{ forma: 'PIX', valor: 20, data: new Date().toISOString(), operador: 'Ana' }],
        timeline,
        logOperacional: [{ acao: 'Pagamento registrado', em: new Date().toISOString() }],
        fiscal: { codigo: 'PENDENTE', label: 'Pendente' }
      }
    );

    const ok = FecharConsignacaoView.patchCentralOperacional(
      root,
      {
        consignacao: { id: 1, status: 'EM_PRESTACAO' },
        clienteDetalhe: { nome: 'Cliente' },
        faturamento: null,
        historico: [],
        pagamentoDraft: { valor: '', formaPagamento: 'DINHEIRO' },
        snapshot: snapDepois
      },
      {
        onPagamentoChange: () => {},
        onRegistrarPagamento: () => {},
        onAbrirHistoricoPagamentos: () => {}
      },
      ['financeiro', 'pagamentos']
    );

    expect(ok).toBe(true);
    const finDepois = root.querySelector('[data-kpi="recebido"]').textContent;
    expect(finDepois).not.toBe(finAntes);
    expect(root.querySelector('[data-card="fiscal"]')).toBeTruthy();
  });

  test('card fiscal é status compacto (venda + NFC-e + próximo passo)', () => {
    const section = FecharConsignacaoView._buildCardFiscal(
      {
        snapshot: { vendaOficial: { vendaId: 99 } },
        faturamento: { vendaId: 99, situacaoFiscal: 'PENDENTE_REGULARIZACAO' }
      },
      {
        vendaId: 99,
        situacaoFiscal: 'PENDENTE_REGULARIZACAO',
        situacaoFiscalLabel: 'Pendente de regularização',
        proximoPasso: 'Regularizar cadastro fiscal'
      }
    );
    expect(section.dataset.card).toBe('fiscal');
    expect(section.textContent).toMatch(/Venda Oficial/);
    expect(section.textContent).toMatch(/Criada/);
    expect(section.textContent).toMatch(/NFC-e/);
    expect(section.textContent).toMatch(/Pendente/);
    expect(section.textContent).toMatch(/Regularizar cadastro fiscal/);
  });
});
