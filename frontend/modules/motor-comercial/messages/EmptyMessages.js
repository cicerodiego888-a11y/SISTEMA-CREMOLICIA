/**
 * Catálogo oficial — Empty States (UX-1)
 *
 * @module frontend/modules/motor-comercial/messages/EmptyMessages
 */

const EmptyMessages = Object.freeze({
  CONSIGNACOES: {
    title: 'Sem consignações',
    description: 'Clique em "Nova Consignação" para iniciar.'
  },
  PENDENCIAS: {
    title: 'Sem pendências',
    description: 'Tudo está em dia.'
  },
  RECOMENDACOES: {
    title: 'Sem recomendações',
    description: 'Nenhuma ação prioritária neste momento.'
  },
  MOVIMENTACOES: {
    title: 'Sem movimentações',
    description: 'Ainda não existem registros para este período.'
  },
  ENTREGA_ITENS: {
    title: 'Sem itens',
    description: 'Esta consignação ainda não possui produtos.'
  },
  ENTREGA_ERRO: {
    title: 'Não foi possível carregar a entrega',
    description: 'Volte à Central e abra a consignação novamente.'
  },
  CENTRAL_TAREFAS: {
    title: 'Nenhuma tarefa urgente',
    description: 'Não há ações prioritárias no momento.'
  },
  CENTRAL_SALDOS: {
    title: 'Sem saldos pendentes',
    description: 'Nenhuma dívida elegível na fila.'
  },
  CENTRAL_ENTREGAS: {
    title: 'Sem entregas previstas',
    description: 'Não há entregas aguardando confirmação.'
  },
  CENTRAL_RECENTES: {
    title: 'Sem operações recentes',
    description: 'As operações aparecerão aqui conforme forem realizadas.'
  },
  WORKFLOW_FILA: {
    title: 'Fila vazia',
    description: 'Nenhum processo no escopo atual.'
  },
  WORKFLOW_HISTORICO: {
    title: 'Histórico vazio',
    description: 'Ações locais aparecerão aqui.'
  },
  PLAYBOOKS: {
    title: 'Nenhum guia operacional',
    description: 'Ajuste os filtros ou inicie um novo guia.'
  },
  PLAYBOOKS_HISTORICO: {
    title: 'Sem histórico',
    description: 'Guias operacionais iniciados aparecerão aqui.'
  },
  CONTA_CORRENTE_ALERTAS: {
    title: 'Sem alertas',
    description: 'Nenhum alerta financeiro.'
  },
  CONTA_CORRENTE_PENDENCIAS: {
    title: 'Sem pendências',
    description: 'Nenhuma pendência financeira.'
  },
  RELATORIO_DADOS: {
    title: 'Sem dados',
    description: 'Nenhum registro para os filtros aplicados.'
  },
  RELATORIO_FAVORITOS: {
    title: 'Sem favoritos',
    description: 'Salve filtros ou relatórios frequentes.'
  },
  TIMELINE: {
    title: 'Sem eventos',
    description: 'Nenhum evento na timeline.'
  },
  PRESTACAO_NAO_ENCONTRADA: {
    title: 'Consignação não encontrada',
    description: 'Volte e selecione outra consignação.'
  },
  CLIENTE_360_VAZIO: {
    title: 'Sem registros',
    description: 'Ainda não há dados para esta seção.'
  }
});

module.exports = EmptyMessages;
