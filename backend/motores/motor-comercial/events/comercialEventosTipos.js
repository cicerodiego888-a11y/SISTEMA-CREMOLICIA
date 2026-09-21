/**
 * Tipos de eventos de domínio do Motor Comercial (Sprint 1.1).
 *
 * @module motores/motor-comercial/events/comercialEventosTipos
 */

const EVENTOS_DOMINIO = Object.freeze({
  CONSIGNACAO_CRIADA: 'ConsignacaoCriada',
  CONSIGNACAO_ENTREGUE: 'ConsignacaoEntregue',
  CONSIGNACAO_ENTREGA_COMPLEMENTAR: 'ConsignacaoEntregaComplementar',
  CONSIGNACAO_ALTERACAO_POS_ENTREGA: 'ConsignacaoAlteracaoPosEntrega',
  CONSIGNACAO_DEVOLVIDA: 'ConsignacaoDevolvida',
  ITENS_TRANSFERIDOS_ENTRE_CONSIGNACOES: 'ItensTransferidosEntreConsignacoes',
  RECEBIMENTO_CONSIGNACAO_CONFIRMADO: 'RecebimentoConsignacaoConfirmado',
  ACERTO_REALIZADO: 'AcertoRealizado',
  PAGAMENTO_REGISTRADO: 'PagamentoRegistrado',
  LIMITE_CREDITO_ALTERADO: 'LimiteCreditoAlterado',
  CLIENTE_BLOQUEADO: 'ClienteBloqueado',
  CLIENTE_DESBLOQUEADO: 'ClienteDesbloqueado',
  CONSIGNACAO_ENCERRADA: 'ConsignacaoEncerrada',
  PERFIL_COMERCIAL_CRIADO: 'PerfilComercialCriado',
  PERFIL_COMERCIAL_ATIVADO: 'PerfilComercialAtivado',
  PERFIL_COMERCIAL_INATIVADO: 'PerfilComercialInativado',
  LIMITE_COMERCIAL_ALTERADO: 'LimiteComercialAlterado',
  PERFIL_BLOQUEADO: 'PerfilBloqueado',
  PERFIL_DESBLOQUEADO: 'PerfilDesbloqueado',
  LIBERACAO_GERENCIAL_REGISTRADA: 'LiberacaoGerencialRegistrada',
  CONSIGNACAO_ATUALIZADA: 'ConsignacaoAtualizada',
  CONSIGNACAO_CANCELADA: 'ConsignacaoCancelada',
  ITEM_CONSIGNACAO_ADICIONADO: 'ItemConsignacaoAdicionado',
  ITEM_CONSIGNACAO_REMOVIDO: 'ItemConsignacaoRemovido',
  QUANTIDADE_ITEM_ALTERADA: 'QuantidadeItemAlterada',
  PRESTACAO_ABERTA: 'PrestacaoAberta',
  VENDA_PRESTACAO_REGISTRADA: 'VendaPrestacaoRegistrada',
  PERDA_REGISTRADA: 'PerdaRegistrada',
  CORTESIA_REGISTRADA: 'CortesiaRegistrada',
  PAGAMENTO_PRESTACAO_REGISTRADO: 'PagamentoPrestacaoRegistrado',
  CREDITO_COMERCIAL_RECALCULADO: 'CreditoComercialRecalculado',
  PRESTACAO_FECHADA: 'PrestacaoFechada',
  PRESTACAO_REABERTA: 'PrestacaoReaberta'
});

const ORIGENS = Object.freeze({
  API: 'api',
  MANUAL: 'manual',
  SISTEMA: 'sistema',
  BACKGROUND: 'background'
});

module.exports = {
  EVENTOS_DOMINIO,
  ORIGENS
};
