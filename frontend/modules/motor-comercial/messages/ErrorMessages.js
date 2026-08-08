/**
 * Catálogo oficial — mensagens de erro (UX-1)
 * Usar quando a operação NÃO ocorreu / não foi salva.
 *
 * @module frontend/modules/motor-comercial/messages/ErrorMessages
 */

const ErrorMessages = Object.freeze({
  CONSIGNACAO_CRIAR: 'Não foi possível criar a consignação.\nVerifique os dados e tente novamente.',
  CONSIGNACAO_SALVAR_RASCUNHO: 'Não foi possível salvar o rascunho.\nVerifique os dados e tente novamente.',
  CONSIGNACAO_CARREGAR: 'Não foi possível carregar a consignação.\nAtualize a lista e tente novamente.',
  CONSIGNACAO_CANCELAR: 'Não foi possível cancelar a consignação.\nTente novamente em instantes.',
  CONSIGNACAO_DUPLICAR: 'Não foi possível duplicar a consignação.\nTente novamente.',
  CONSIGNACAO_NAO_ENCONTRADA: 'Consignação não encontrada.\nEla pode ter sido removida ou o identificador está incorreto.',
  CONSIGNACAO_ID_AUSENTE: 'A consignação foi processada, mas o identificador não retornou.\nAbra pela Central de Consignações.',
  CONSIGNACAO_ITEM_REMOVER: 'Não foi possível remover o item.\nTente novamente.',
  CONSIGNACAO_SOMENTE_RASCUNHO: 'Somente consignações em rascunho podem ser editadas.',

  ENTREGA_REGISTRAR: 'Não foi possível registrar a entrega.\nVerifique o checklist e tente novamente.',
  ENTREGA_CHECKLIST: 'Não é possível realizar a entrega.\nVerifique o checklist e corrija as pendências.',
  ENTREGA_CARREGAR: 'Não foi possível carregar os dados da entrega.\nVolte à Central e abra novamente.',
  TERMO_IMPRIMIR: 'Não foi possível iniciar a impressão do termo.\nTente novamente.',
  TERMO_PDF: 'Não foi possível gerar o PDF do termo.\nTente novamente.',
  COMPROVANTE_CARREGAR: 'Não foi possível carregar o comprovante.\nAbra pela consignação entregue.',

  PRESTACAO_ABRIR: 'Não foi possível abrir a prestação de contas.\nVerifique o status da consignação.',
  PRESTACAO_CARREGAR: 'Não foi possível carregar a prestação.\nAtualize e tente novamente.',
  PRESTACAO_ENCERRAR: 'Não foi possível encerrar a prestação.\nVerifique as pendências da grade.',
  PRESTACAO_SALVAR_LINHA: 'Não foi possível salvar a linha da grade.\nCorrija e tente novamente.',
  PRESTACAO_RATEIO: 'Não foi possível salvar o rateio da perda.\nTente novamente.',
  PRESTACAO_NAO_ABERTA: 'A prestação não está aberta para esta operação.',
  NFCE_EMITIR: 'Não foi possível emitir a NFC-e.\nVerifique os dados fiscais e tente novamente.',

  PAGAMENTO_REGISTRAR: 'Não foi possível registrar o pagamento.\nConfira o valor e o saldo a pagar.',
  RECEBIMENTO_REGISTRAR: 'Não foi possível registrar o recebimento.\nConfira o valor e tente novamente.',

  CONTA_CORRENTE_CARREGAR: 'Não foi possível carregar a Conta Corrente.\nTente novamente.',
  EXTRATO_EXPORTAR: 'Não foi possível exportar o extrato.\nTente novamente.',
  PDF_EXPORTAR: 'Não foi possível exportar o PDF.\nTente novamente.',

  PERFIL_CARREGAR: 'Não foi possível carregar o perfil comercial.\nTente novamente.',
  PERFIL_ATUALIZAR: 'Não foi possível atualizar o perfil.\nVerifique os dados e tente novamente.',
  CLIENTE_SALVAR: 'Não foi possível salvar o cliente.\nVerifique os dados e tente novamente.',
  CLIENTE_NAO_ENCONTRADO: 'Cliente não encontrado.\nSelecione outro cliente ou cadastre novamente.',
  CLIENTE_BUSCA_VAZIA: 'Nenhum cliente encontrado para esta pesquisa.',
  CEP_BUSCAR: 'Não foi possível buscar o CEP.\nVerifique o número e tente novamente.',
  LIBERACAO_AUTORIZAR: 'Não foi possível autorizar a liberação gerencial.\nSolicite novamente ao supervisor.',

  DASHBOARD_CARREGAR: 'Não foi possível atualizar o Dashboard.\nOs dados serão sincronizados automaticamente.',
  TELA_CARREGAR: 'Não foi possível abrir esta tela.\nVolte e tente novamente.',
  PERMISSAO: 'Você não tem permissão para esta operação.',
  CONEXAO: 'Não foi possível conectar.\nVerifique a internet e tente novamente.',
  GENERICO_OPERACAO: 'Não foi possível concluir a operação.\nTente novamente ou contate o suporte.'
});

module.exports = ErrorMessages;
