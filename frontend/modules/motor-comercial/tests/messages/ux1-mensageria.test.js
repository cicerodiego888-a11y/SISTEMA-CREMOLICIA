/**
 * UX-1 — Catálogo de mensageria operacional
 */

const {
  SuccessMessages,
  ErrorMessages,
  WarningMessages,
  InfoMessages,
  RecoveryMessages,
  EmptyMessages,
  LoadingMessages,
  ConfirmMessages,
  resolveOperationalError,
  operationalMessage,
  emptyState,
  loadingText,
  confirmCopy
} = require('../../messages');

describe('UX-1 Mensageria Operacional', () => {
  test('catálogos exportam chaves oficiais dos fluxos principais', () => {
    expect(SuccessMessages.CONSIGNACAO_CRIADA).toMatch(/criada com sucesso/i);
    expect(SuccessMessages.ENTREGA_REGISTRADA).toMatch(/entrega registrada/i);
    expect(SuccessMessages.PRESTACAO_CONCLUIDA).toMatch(/prestação concluída/i);
    expect(SuccessMessages.PAGAMENTO_REGISTRADO).toMatch(/pagamento registrado/i);
    expect(SuccessMessages.PERFIL_ATUALIZADO).toMatch(/perfil atualizado/i);

    expect(ErrorMessages.CONSIGNACAO_CRIAR).toMatch(/não foi possível criar/i);
    expect(ErrorMessages.ENTREGA_REGISTRAR).toMatch(/não foi possível registrar a entrega/i);
    expect(ErrorMessages.PAGAMENTO_REGISTRAR).toMatch(/pagamento/i);

    expect(RecoveryMessages.CONSIGNACAO_CRIADA_ENTREGA_FALHOU).toMatch(/foi criada/i);
    expect(RecoveryMessages.CONSIGNACAO_CRIADA_ENTREGA_FALHOU).toMatch(/Central de Consignações/i);
    expect(RecoveryMessages.PAGAMENTO_OK_INDICADORES_FALHOU).toMatch(/Nenhuma informação financeira foi perdida/i);
  });

  test('elimina mensagem genérica opaca de recovery', () => {
    const textos = Object.values(RecoveryMessages).join(' ');
    expect(textos).not.toMatch(/Não foi possível recuperar esta operação agora/i);

    const resolved = resolveOperationalError(new Error('TypeError: x is null'));
    expect(resolved).not.toMatch(/Não foi possível recuperar esta operação agora/i);
    expect(resolved).toMatch(/Central de Consignações|conexão|retomar/i);
  });

  test('operationalMessage classifica rede, 404 e contexto', () => {
    expect(operationalMessage(new Error('Network Error'))).toBe(RecoveryMessages.CONEXAO);
    expect(operationalMessage(new Error('Consignação não encontrada'))).toBe(RecoveryMessages.OPERACAO_REMOVIDA);
    expect(operationalMessage(new Error('falhou'), { context: 'criar' })).toBe(ErrorMessages.CONSIGNACAO_CRIAR);
    expect(operationalMessage(new Error('falhou'), { context: 'entrega' })).toBe(ErrorMessages.ENTREGA_REGISTRAR);
  });

  test('empty states padronizados com próximo passo', () => {
    expect(emptyState('CONSIGNACOES')).toEqual(EmptyMessages.CONSIGNACOES);
    expect(EmptyMessages.CONSIGNACOES.description).toMatch(/Nova Consignação/i);
    expect(EmptyMessages.PENDENCIAS.description).toMatch(/em dia/i);
    expect(EmptyMessages.RECOMENDACOES.description).toMatch(/ação prioritária/i);
    expect(EmptyMessages.MOVIMENTACOES.description).toMatch(/período/i);
  });

  test('loading nunca usa Aguarde...', () => {
    const all = Object.values(LoadingMessages).join(' ');
    expect(all).not.toMatch(/Aguarde/i);
    expect(loadingText('CRIANDO_CONSIGNACAO')).toBe('Criando consignação...');
    expect(loadingText('REGISTRANDO_PAGAMENTO')).toBe('Registrando pagamento...');
  });

  test('confirmações oficiais existem para ações críticas', () => {
    expect(ConfirmMessages.CANCELAR_CONSIGNACAO.title).toBeTruthy();
    expect(ConfirmMessages.CONFIRMAR_ENTREGA.message).toMatch(/entrega/i);
    expect(ConfirmMessages.ENCERRAR_PRESTACAO.title).toMatch(/Prestação/i);
    expect(ConfirmMessages.DESBLOQUEAR_PERFIL.title).toMatch(/Desbloquear/i);
    expect(ConfirmMessages.EXCLUIR_CLIENTE.message).toMatch(/não pode ser desfeita/i);

    const copy = confirmCopy('CONFIRMAR_ENTREGA');
    expect(copy.title).toBe(ConfirmMessages.CONFIRMAR_ENTREGA.title);
  });

  test('warnings e infos cobrem validações do wizard', () => {
    expect(WarningMessages.SELECIONE_CLIENTE_SALVAR).toMatch(/cliente/i);
    expect(WarningMessages.ENTREGA_CHECKLIST).toMatch(/checklist/i);
    expect(InfoMessages.OPERACAO_RETOMADA).toMatch(/retomada/i);
  });
});
