/**
 * Catálogo oficial — diálogos de confirmação (UX-1)
 * Nunca usar alert() / confirm() / prompt() nativos.
 *
 * @module frontend/modules/motor-comercial/messages/ConfirmMessages
 */

const ConfirmMessages = Object.freeze({
  CANCELAR_CONSIGNACAO: {
    title: 'Cancelar consignação',
    message: 'Deseja cancelar esta consignação em rascunho?\nEsta ação não pode ser desfeita.'
  },
  DUPLICAR_CONSIGNACAO: {
    title: 'Duplicar consignação',
    message: 'Deseja duplicar esta consignação?'
  },
  CONFIRMAR_ENTREGA: {
    title: 'Confirmar entrega',
    message: 'Deseja confirmar a entrega desta consignação?'
  },
  CANCELAR_ENTREGA: {
    title: 'Cancelar entrega',
    message: 'Deseja cancelar a entrega e voltar?'
  },
  SAIR_WIZARD: {
    title: 'Cancelar',
    message: 'Existem alterações não salvas. Deseja sair?'
  },
  TROCAR_CLIENTE: {
    title: 'Trocar cliente',
    message: 'Trocar o cliente remove os produtos já adicionados. Deseja continuar?'
  },
  ENCERRAR_PRESTACAO: {
    title: 'Encerrar Prestação',
    message: 'Deseja encerrar esta prestação de contas?'
  },
  SAIR_ATENDIMENTO: {
    title: 'Sair do atendimento',
    message: 'Deseja sair do atendimento? Alterações não salvas podem ser perdidas.'
  },
  REABRIR_PRESTACAO: {
    title: 'Reabrir prestação',
    message: 'Deseja reabrir esta prestação de contas?'
  },
  EXCLUIR_CLIENTE: {
    title: 'Excluir cliente',
    message: 'Deseja excluir este cliente?\nEsta ação não pode ser desfeita.'
  },
  DESATIVAR_CLIENTE: {
    title: 'Desativar cliente',
    message: 'Deseja desativar este cliente?'
  },
  DESBLOQUEAR_PERFIL: {
    title: 'Desbloquear perfil',
    message: 'Deseja desbloquear o perfil comercial deste cliente?'
  },
  BLOQUEAR_PERFIL: {
    title: 'Bloquear perfil',
    message: 'Deseja bloquear o perfil comercial deste cliente?'
  },
  RESOLVER_ALERTA: {
    title: 'Resolver alerta',
    message: 'Marcar este alerta como resolvido?'
  },
  IGNORAR_ALERTA: {
    title: 'Ignorar alerta',
    message: 'Ignorar este alerta?'
  },
  INICIAR_PLAYBOOK: {
    title: 'Iniciar guia operacional',
    message: 'Iniciar este guia? Nenhuma ação será executada automaticamente.'
  },
  IGNORAR_PASSO: {
    title: 'Ignorar passo',
    message: 'Ignorar este passo?'
  },
  CONCLUIR_WORKFLOW: {
    title: 'Concluir',
    message: 'Concluir este processo?'
  }
});

module.exports = ConfirmMessages;
