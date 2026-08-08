/**
 * Catálogo oficial — recuperação parcial (UX-1)
 *
 * Usar quando parte do fluxo deu certo e outra parte falhou.
 * Sempre informar: o que foi salvo + o que falhou + próximo passo.
 *
 * @module frontend/modules/motor-comercial/messages/RecoveryMessages
 */

const RecoveryMessages = Object.freeze({
  CONSIGNACAO_CRIADA_ENTREGA_FALHOU:
    'A consignação foi criada,\nmas não foi possível abrir a tela de Entrega.\n\nVocê pode continuar pela Central de Consignações.',

  PRESTACAO_OK_DASHBOARD_FALHOU:
    'Prestação registrada.\nNão foi possível atualizar o Dashboard.\n\nOs dados serão sincronizados automaticamente.',

  PAGAMENTO_OK_INDICADORES_FALHOU:
    'Pagamento registrado.\nNão foi possível atualizar os indicadores.\n\nNenhuma informação financeira foi perdida.',

  ENTREGA_OK_COMPROVANTE_FALHOU:
    'Entrega registrada com sucesso.\nNão foi possível abrir o comprovante agora.\n\nAbra a consignação pela Central para visualizar o comprovante.',

  ENTREGA_OK_EVENTOS_FALHOU:
    'A entrega foi registrada.\nHouve falha ao sincronizar eventos auxiliares.\n\nNenhuma informação da entrega foi perdida.',

  RASCUNHO_OK_ITENS_PARCIAIS:
    'A consignação foi salva,\nmas um ou mais itens não puderam ser gravados.\n\nAbra o rascunho e confira a grade de produtos.',

  RETOMADA_INDISPONIVEL:
    'Não foi possível retomar esta operação automaticamente.\n\nAbra pela Central de Consignações e continue de onde parou.',

  OPERACAO_REMOVIDA:
    'Esta operação foi removida ou não está mais disponível.\n\nAtualize a lista na Central de Consignações.',

  OPERACAO_CORROMPIDA:
    'O rascunho local desta operação não pode ser usado.\n\nAbra a consignação pela Central — os dados oficiais estão no servidor.',

  OPERACAO_EXPIRADA:
    'O prazo para retomar esta operação expirou.\n\nInicie novamente ou abra pela Central de Consignações.',

  AUTH_EXPIRADA:
    'A autorização gerencial desta operação expirou.\n\nSolicite nova liberação se ainda precisar continuar.',

  CONEXAO:
    'Verifique sua conexão e tente novamente.\n\nSe a operação já tiver sido salva, continue pela Central.',

  CHECKPOINT_VAZIO_API_OK:
    'Operação carregada pelos dados oficiais do servidor.\nO rascunho local não estava disponível.'
});

module.exports = RecoveryMessages;
