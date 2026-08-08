/**
 * Catálogo oficial — avisos ao operador (UX-1)
 *
 * @module frontend/modules/motor-comercial/messages/WarningMessages
 */

const WarningMessages = Object.freeze({
  SELECIONE_CLIENTE: 'Selecione um cliente antes de continuar.',
  SELECIONE_CLIENTE_SALVAR: 'Selecione um cliente antes de salvar.',
  ADICIONE_PRODUTO: 'Adicione pelo menos um produto.',
  LIMITE_EXCEDIDO: 'Valor acima do limite comercial. Solicite liberação gerencial para continuar.',
  LIMITE_PROXIMO: 'Valor próximo ao limite comercial disponível.',
  CLIENTE_BLOQUEADO: 'Cliente com situação bloqueada — verifique antes de concluir.',
  SOMENTE_RASCUNHO: 'Somente rascunhos podem ser editados.',
  TROCAR_CLIENTE: 'Trocar o cliente limpa os produtos já adicionados.',

  PRESTACAO_ALTERACOES_PENDENTES: 'Existem alterações pendentes na grade. Corrija antes de continuar.',
  PRESTACAO_AGUARDE_GRAVACAO: 'Ainda existem alterações pendentes na grade. Aguarde a gravação.',
  PRESTACAO_SEM_PERMISSAO_EMITIR: 'Você não tem permissão para emitir nesta prestação.',
  PRESTACAO_SEM_PERMISSAO_ENCERRAR: 'Você não tem permissão para encerrar este atendimento.',
  NFCE_SEM_PERMISSAO_ENCERRAR: 'NFC-e ok, mas sem permissão para encerrar automaticamente.',

  ENTREGA_CHECKLIST: 'Não é possível realizar a entrega. Verifique o checklist.',
  SEM_DIVIDA_ELEGIVEL: 'Não há dívida elegível na Conta Corrente deste cliente.',
  CEP_NAO_ENCONTRADO: 'CEP não encontrado.',
  INFORME_NOME_CLIENTE: 'Informe o nome do cliente.',
  HABILITE_CAPACIDADE: 'Habilite ao menos uma capacidade comercial.',
  NADA_PARA_EXPORTAR: 'Nada para exportar neste momento.',
  PDF_INDISPONIVEL: 'PDF indisponível no snapshot.',
  CLIENTE_INVALIDO: 'Cliente inválido: ID não encontrado.'
});

module.exports = WarningMessages;
