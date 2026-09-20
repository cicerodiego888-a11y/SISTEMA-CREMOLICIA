/**
 * STAB-06.6.3 — Consolidação operacional da Prestação
 */

const {
  buildTimelineOficial,
  resolverEstadoPrestacao,
  resolverSituacaoFiscal,
  labelSituacaoFinanceiraOficial,
  buildPainelFechamentoOperacional,
  auditarIntegridadeNoResumo,
  auditarCadeiaFiscal,
  registrarLogEncerramento,
  mensagemNfceResultado,
  ESTADO_PRESTACAO,
  SITUACAO_FISCAL,
  MENSAGENS,
  TIMELINE_ESTADO
} = require('../../pages/PrestacaoContas/prestacaoOperacionalConsolidacao');
const { buildFinanceiroFromResumo } = require('../../pages/PrestacaoContas/prestacaoFinanceiroSnapshot');

describe('STAB-06.6.3 consolidação operacional', () => {
  test('timeline — prestação sem venda', () => {
    const timeline = buildTimelineOficial({
      consignacao: { status: 'ENTREGUE', dataEntrega: '2026-07-01' },
      financeiro: { valorVenda: 0, valorRecebido: 0, saldoEmAberto: 0 },
      faturamento: null,
      currentStep: 1,
      encerrado: false
    });
    expect(timeline.map((t) => t.label)).toEqual([
      'Entrega', 'Prestação', 'Venda Oficial', 'NFC-e', 'Encerramento'
    ]);
    expect(timeline[0].estado).toBe(TIMELINE_ESTADO.CONCLUIDA);
    expect(timeline[1].estado).toBe(TIMELINE_ESTADO.ATUAL);
    expect(timeline[0].marca).toBe('✓');
    expect(timeline[1].marca).toBe('●');
  });

  test('timeline — quitada com NFC-e autorizada e encerrada', () => {
    const timeline = buildTimelineOficial({
      consignacao: { status: 'QUITADA', dataEntrega: '2026-07-01' },
      financeiro: buildFinanceiroFromResumo({ valorVendido: 30, valorRecebido: 30 }),
      faturamento: {
        vendaId: 99,
        situacaoFiscal: 'AUTORIZADA',
        nfce: { numero: '10', chave: '3526...' }
      },
      currentStep: 4,
      encerrado: true
    });
    expect(timeline.every((t) => t.estado === TIMELINE_ESTADO.CONCLUIDA)).toBe(true);
  });

  test('timeline — NFC-e rejeitada por cadastro → atenção', () => {
    const timeline = buildTimelineOficial({
      consignacao: { status: 'EM_PRESTACAO', dataEntrega: '2026-07-01' },
      financeiro: { valorVenda: 50, valorRecebido: 50, saldoEmAberto: 0 },
      faturamento: {
        situacaoFiscal: 'REJEITADA',
        nfce: { motivo: 'NCM inválido no produto' }
      },
      currentStep: 3,
      encerrado: false
    });
    const nfce = timeline.find((t) => t.key === 'nfce');
    expect(nfce.estado).toBe(TIMELINE_ESTADO.ATENCAO);
    expect(nfce.marca).toBe('⚠');
  });

  test('situação financeira padronizada', () => {
    expect(labelSituacaoFinanceiraOficial('QUITADA')).toBe('Quitada');
    expect(labelSituacaoFinanceiraOficial('PARCIALMENTE_RECEBIDA')).toBe('Parcial');
    expect(labelSituacaoFinanceiraOficial('EM_ABERTO')).toBe('Em Aberto');
    expect(labelSituacaoFinanceiraOficial('SEM_VENDA')).toBe('Sem Venda');
  });

  test('situação fiscal — rejeição cadastral', () => {
    const fiscal = resolverSituacaoFiscal({
      situacaoFiscal: 'REJEITADA',
      nfce: { motivo: 'GTIN obrigatório' }
    });
    expect(fiscal.codigo).toBe(SITUACAO_FISCAL.PENDENTE_REGULARIZACAO);
    expect(fiscal.label).toMatch(/Pendente de Regularização Fiscal/);
  });

  test('estado operacional oficial', () => {
    expect(resolverEstadoPrestacao({ encerrado: true })).toBe(ESTADO_PRESTACAO.ENCERRADA);
    expect(resolverEstadoPrestacao({ emitindoNfce: true })).toBe(ESTADO_PRESTACAO.EMITINDO_NFCE);
    expect(resolverEstadoPrestacao({
      faturamento: { situacaoFiscal: 'REJEITADA', nfce: { motivo: 'CFOP inválido' } }
    })).toBe(ESTADO_PRESTACAO.PENDENTE_REGULARIZACAO_FISCAL);
    expect(resolverEstadoPrestacao({ prestacaoAberta: true, currentStep: 2 }))
      .toBe(ESTADO_PRESTACAO.EM_ATENDIMENTO);
  });

  test('resumo fechamento só com campos oficiais', () => {
    const painel = buildPainelFechamentoOperacional({
      consignacao: { id: 1, documento: 'CONS-1', clienteNome: 'Mercado' },
      financeiro: { valorVenda: 80, valorRecebido: 20, saldoEmAberto: 60, situacaoFinanceira: 'PARCIALMENTE_RECEBIDA' },
      faturamento: {
        vendaId: 7,
        situacaoFiscal: 'AUTORIZADA',
        nfce: { numero: '55', chave: 'CHAVE' }
      }
    });
    expect(painel.cliente).toBe('Mercado');
    expect(painel.situacaoFinanceiraLabel).toBe('Parcial');
    expect(painel.situacaoFiscalLabel).toBe('Autorizada');
    expect(painel.vendaId).toBe(7);
    expect(painel.nfceNumero).toBe('55');
    expect(painel.nfceChave).toBe('CHAVE');
    expect(painel.proximoPasso).toBeTruthy();
  });

  test('auditoria integridade no resumo', () => {
    const ok = auditarIntegridadeNoResumo({ valorVenda: 10, valorRecebido: 4, saldoEmAberto: 6 });
    expect(ok).toBeNull();
    const bad = auditarIntegridadeNoResumo(
      { valorVenda: 10, valorRecebido: 1, saldoEmAberto: 2 },
      { documento: 'C-1', cliente: 'X' }
    );
    expect(bad.mensagem).toBe('Prestação inconsistente.');
    expect(bad.diferenca).toBe(7);
  });

  test('auditoria fiscal registra divergência', () => {
    const reg = auditarCadeiaFiscal({
      financeiro: { valorVenda: 10 },
      faturamento: { situacaoFiscal: 'AUTORIZADA', vendaId: null }
    });
    expect(reg).toBeTruthy();
    expect(reg.tipo).toBe('DIVERGENCIA_FISCAL_PRESTACAO');
  });

  test('log operacional de encerramento', () => {
    const log = registrarLogEncerramento({
      consignacao: { id: 3, documento: 'CONS-3' },
      financeiro: { valorVenda: 10, valorRecebido: 10, saldoEmAberto: 0, situacaoFinanceira: 'QUITADA' },
      faturamento: { vendaId: 1, situacaoFiscal: 'AUTORIZADA' }
    });
    expect(log.evento).toBe('Prestação encerrada');
    expect(log.situacaoFinanceira).toBe('Quitada');
    expect(log.tipo).toBe('PRESTACAO_ENCERRADA');
  });

  test('mensagens oficiais NFC-e', () => {
    expect(mensagemNfceResultado({ situacaoFiscal: 'AUTORIZADA' })).toBe(MENSAGENS.NFCE_AUTORIZADA);
    expect(mensagemNfceResultado({
      situacaoFiscal: 'REJEITADA',
      nfce: { motivo: 'NCM inválido' }
    })).toBe(MENSAGENS.NFCE_PENDENTE_REGULARIZACAO);
  });
});
