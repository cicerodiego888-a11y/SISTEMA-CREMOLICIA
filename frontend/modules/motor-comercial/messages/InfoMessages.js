/**
 * Catálogo oficial — informações ao operador (UX-1)
 *
 * @module frontend/modules/motor-comercial/messages/InfoMessages
 */

const InfoMessages = Object.freeze({
  OPERACAO_RETOMADA: 'Operação retomada automaticamente.',
  CLIENTE_QUITADO_FILA: 'Cliente já quitado. Removendo da fila...',
  FINANCEIRO_RECEBER: 'Abra o módulo Financeiro › Receber para registrar o recebimento.',
  CLIENTE_PRE_SELECIONADO: (nome) => `Cliente ${nome || ''} pré-selecionado no Financeiro.`.trim(),
  SEM_CONSIGNACAO_PRESTACAO: 'Nenhuma consignação disponível para prestação de contas.',
  CLIENTE_NAO_IDENTIFICADO_EXTRATO: 'Cliente não identificado para abrir o extrato.',
  CLIENTE_NAO_IDENTIFICADO_CC: 'Cliente não identificado para abrir a Conta Corrente.',
  CLIENTE_NAO_IDENTIFICADO_RECEBIMENTO: 'Cliente não identificado para registrar recebimento.',
  PENDENCIA_ADIADA: (data) => `Alerta adiado até ${data}.`,
  PLAYBOOK_OBS_SALVA: 'Observação salva.',
  EXPORT_PDF_EM_BREVE: 'Exportação em PDF disponível em breve — use planilha.',
  DISPONIVEL_EM_BREVE: 'Disponível em breve.',
  SEM_FAVORITO: 'Nenhum favorito salvo.',
  AGENDAMENTO: 'Agendamento disponível na próxima versão.'
});

module.exports = InfoMessages;
