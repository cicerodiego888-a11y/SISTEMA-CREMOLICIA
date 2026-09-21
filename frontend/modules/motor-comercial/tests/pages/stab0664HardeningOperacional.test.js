/**
 * STAB-06.6.4 — Hardening operacional RC1
 */

const {
  safeText,
  safeMoney,
  humanizarErroOperacional,
  motivoBotaoDesabilitado,
  auditarFinalRC1,
  registrarLogOperacional,
  MENSAGENS_HARDENING
} = require('../../pages/PrestacaoContas/prestacaoHardening');

describe('STAB-06.6.4 hardening operacional', () => {
  test('safeText — null/undefined/NaN/#placeholder', () => {
    expect(safeText(null)).toBe('—');
    expect(safeText(undefined)).toBe('—');
    expect(safeText(Number.NaN)).toBe('—');
    expect(safeText('undefined')).toBe('—');
    expect(safeText('Produto #1')).toBe('⚠ Informação não localizada');
    expect(safeText('Cliente #99')).toBe('⚠ Informação não localizada');
    expect(safeText('Leite 1L')).toBe('Leite 1L');
  });

  test('safeMoney — NaN vira 0', () => {
    expect(safeMoney(Number.NaN)).toBe(0);
    expect(safeMoney('12.5')).toBe(12.5);
  });

  test('humanizarErro — NCM / SEFAZ / timeout / rede', () => {
    expect(humanizarErroOperacional('NCM inválido').mensagem).toBe(MENSAGENS_HARDENING.ERRO_CADASTRO_FISCAL);
    expect(humanizarErroOperacional('NCM inválido').acaoSugerida).toBe('Corrigir Cadastro');
    expect(humanizarErroOperacional('NCM inválido').retryable).toBe(false);

    const sefaz = humanizarErroOperacional(new Error('SEFAZ indisponível'));
    expect(sefaz.retryable).toBe(true);
    expect(sefaz.mensagem).toBe(MENSAGENS_HARDENING.ERRO_SEFAZ);

    expect(humanizarErroOperacional('ETIMEDOUT').retryable).toBe(true);
    expect(humanizarErroOperacional('Failed to fetch').retryable).toBe(true);
  });

  test('motivoBotaoDesabilitado — NFC-e não bloqueia encerrar; dirty bloqueia', () => {
    expect(motivoBotaoDesabilitado('encerrar', {
      podeEncerrarFiscal: false,
      situacaoFiscal: 'PENDENTE'
    })).toBe('');

    expect(motivoBotaoDesabilitado('continuar', { hidratando: true }))
      .toBe(MENSAGENS_HARDENING.PRESTACAO_AGUARDE_HIDRATACAO);
    expect(motivoBotaoDesabilitado('continuar', { dirty: true })).toBe('Existem alterações pendentes.');
    expect(motivoBotaoDesabilitado('emitir', { emitindo: true })).toBe(MENSAGENS_HARDENING.EMITINDO_NFCE);
  });

  test('mensagens de sucesso padronizadas', () => {
    expect(MENSAGENS_HARDENING.PRESTACAO_SALVA).toMatch(/^✓/);
    expect(MENSAGENS_HARDENING.PAGAMENTO_REGISTRADO).toMatch(/^✓/);
    expect(MENSAGENS_HARDENING.VENDA_OFICIAL_CRIADA).toMatch(/^✓/);
    expect(MENSAGENS_HARDENING.NFCE_AUTORIZADA).toMatch(/^✓/);
    expect(MENSAGENS_HARDENING.PRESTACAO_ENCERRADA).toMatch(/^✓/);
  });

  test('auditarFinalRC1 — estrutura sem side-effect de console', () => {
    const ok = auditarFinalRC1({
      consignacao: { id: 1 },
      financeiro: {
        valorVenda: 100,
        valorRecebido: 100,
        saldoEmAberto: 0,
        situacaoFinanceira: 'QUITADA'
      },
      faturamento: {
        vendaId: 10,
        situacaoFiscal: 'AUTORIZADA',
        nfce: { numero: '1', chave: '35' }
      },
      historico: [],
      itens: []
    });
    expect(ok.todosOk).toBe(true);
    expect(ok.tipo).toBe('AUDITORIA_FINAL_RC1');

    const divergente = auditarFinalRC1({
      consignacao: {},
      financeiro: { valorVenda: 10, valorRecebido: 0, saldoEmAberto: 5 },
      faturamento: null,
      historico: [],
      itens: []
    });
    expect(divergente.todosOk).toBe(false);
  });

  test('registrarLogOperacional — campos de suporte', () => {
    const log = registrarLogOperacional('EMITIR_NFCE', {
      consignacaoId: 7,
      vendaOficial: 99,
      nfce: { numero: '12' },
      resultado: 'AUTORIZADA',
      inicioMs: Date.now() - 50,
      origem: 'prestacao-contas'
    });
    expect(log.tipo).toBe('LOG_OPERACIONAL_RC1');
    expect(log.consignacaoId).toBe(7);
    expect(log.vendaOficial).toBe(99);
    expect(log.tempoMs).toBeGreaterThanOrEqual(0);
    expect(log.origem).toBe('prestacao-contas');
  });
});
