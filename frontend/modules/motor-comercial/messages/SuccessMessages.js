/**
 * Catálogo oficial — mensagens de sucesso (UX-1)
 *
 * @module frontend/modules/motor-comercial/messages/SuccessMessages
 */

const SuccessMessages = Object.freeze({
  CONSIGNACAO_CRIADA: 'Consignação criada com sucesso.',
  CONSIGNACAO_RASCUNHO_SALVO: 'Rascunho salvo com sucesso.',
  CONSIGNACAO_CANCELADA: 'Consignação cancelada com sucesso.',
  CONSIGNACAO_DUPLICADA: 'Consignação duplicada com sucesso.',

  ENTREGA_REGISTRADA: 'Entrega registrada com sucesso.',
  TERMO_IMPRESSO: 'Termo de entrega enviado para impressão.',
  TERMO_PDF_GERADO: 'PDF do termo gerado com sucesso.',
  COMPROVANTE_COPIADO: 'Resumo copiado com sucesso.',
  COMPROVANTE_PDF: 'PDF gerado a partir do snapshot oficial.',

  PRESTACAO_ABERTA: 'Prestação de contas aberta.',
  PRESTACAO_CONCLUIDA: 'Prestação concluída.',
  PRESTACAO_REABERTA: 'Prestação reaberta com sucesso.',
  RATEIO_PERDA_SALVO: 'Rateio da perda salvo.',
  NFCE_EMITIDA: 'NFC-e emitida com sucesso.',

  PAGAMENTO_REGISTRADO: 'Pagamento registrado.',
  RECEBIMENTO_REGISTRADO: 'Recebimento registrado na Conta Corrente.',
  RECEBIMENTO_QUITADO: 'Recebimento registrado. Dívida quitada — cliente removido da fila.',
  RECEBIMENTO_PARCIAL: 'Recebimento parcial registrado na Conta Corrente Comercial.',

  MOVIMENTO_REGISTRADO: 'Movimento registrado.',
  EXTRATO_EXPORTADO: 'Extrato exportado com sucesso.',
  PDF_EXPORTADO: 'PDF exportado.',
  EXCEL_EXPORTADO: 'Excel exportado.',
  PLANILHA_EXPORTADA: 'Planilha exportada.',

  PERFIL_ATUALIZADO: 'Perfil atualizado.',
  CLIENTE_SALVO: 'Cliente salvo com sucesso.',
  CLIENTE_DESATIVADO: 'Cliente desativado.',
  CLIENTE_EXCLUIDO: 'Cliente excluído.',
  LIMITE_ALTERADO: 'Limite comercial atualizado.',
  PERFIL_BLOQUEADO: 'Perfil bloqueado.',
  PERFIL_DESBLOQUEADO: 'Perfil desbloqueado.',

  PENDENCIA_RESOLVIDA: 'Alerta resolvido.',
  PENDENCIA_IGNORADA: 'Alerta ignorado.',
  PENDENCIA_DELEGADA: 'Alerta delegado.',
  OBSERVACAO_REGISTRADA: 'Observação registrada.',

  PLAYBOOK_INICIADO: 'Guia operacional iniciado.',
  PLAYBOOK_PASSO_CONCLUIDO: 'Passo concluído.',
  WORKFLOW_CONCLUIDO: 'Processo concluído.',
  WORKFLOW_STATUS: 'Status atualizado.',
  WORKFLOW_RESPONSAVEL: 'Responsável atualizado.',

  FAVORITO_SALVO: 'Favorito salvo.',
  FAVORITO_APLICADO: 'Favorito aplicado.',
  EXPORTACAO_CONCLUIDA: 'Exportação concluída.',
  LINK_COPIADO: 'Link copiado para a área de transferência.',

  LIBERACAO_AUTORIZADA: 'Liberação gerencial autorizada para esta operação.',
  OPERACAO_RETOMADA: 'Operação retomada automaticamente.'
});

module.exports = SuccessMessages;
