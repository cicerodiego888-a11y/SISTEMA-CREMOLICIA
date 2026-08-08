const BaseFinancialEventHandler = require('./BaseFinancialEventHandler');
const FinancialEventTypes = require('../FinancialEventTypes');

class VendaRecebidaHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.VENDA_RECEBIDA); }
}
class VendaCanceladaHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.VENDA_CANCELADA); }
}
class TituloReceberCriadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AR_CRIADO); }
}
class TituloReceberAtualizadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AR_ATUALIZADO); }
}
class TituloReceberCanceladoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AR_CANCELADO); }
}
class TituloReceberBaixadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AR_BAIXADO); }
}
class TituloReceberParcialHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AR_PARCIAL); }
}
class TituloReceberVencidoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AR_VENCIDO); }
}
class TituloReceberRenegociadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AR_RENEGOCIADO); }
}
class TituloPagarCriadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AP_CRIADO); }
}
class TituloPagarAtualizadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AP_ATUALIZADO); }
}
class TituloPagarCanceladoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AP_CANCELADO); }
}
class TituloPagarBaixadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AP_BAIXADO); }
}
class TituloPagarParcialHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AP_PARCIAL); }
}
class TituloPagarVencidoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AP_VENCIDO); }
}
class TituloPagarRenegociadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TITULO_AP_RENEGOCIADO); }
}
class CaixaAbertoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.CAIXA_ABERTO); }
}
class CaixaFechadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.CAIXA_FECHADO); }
}
class CaixaSangriaHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.CAIXA_SANGRIA); }
}
class CaixaSuprimentoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.CAIXA_SUPRIMENTO); }
}
class CaixaAjusteHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.CAIXA_AJUSTE); }
}
class CaixaConciliacaoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.CAIXA_CONCILIACAO); }
}
class PixRecebidoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.PIX_RECEBIDO); }
}
class PixEstornadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.PIX_ESTORNADO); }
}
class TefAprovadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TEF_APROVADO); }
}
class TefCanceladoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TEF_CANCELADO); }
}
class TransferenciaBancariaHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TRANSFERENCIA_BANCARIA); }
}
class AjusteFinanceiroHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.AJUSTE_FINANCEIRO); }
}
class ConciliacaoRealizadaHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.CONCILIACAO_REALIZADA); }
}
class EstornoFinanceiroHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.ESTORNO_FINANCEIRO); }
}
class PrestacaoRecebidaHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.PRESTACAO_RECEBIDA); }
}
class LiquidacaoRealizadaHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.LIQUIDACAO_REALIZADA); }
}
class PixLiquidadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.PIX_LIQUIDADO); }
}
class TefLiquidadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TEF_LIQUIDADO); }
}
class DinheiroLiquidadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.DINHEIRO_LIQUIDADO); }
}
class CartaoLiquidadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.CARTAO_LIQUIDADO); }
}
class ChequeLiquidadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.CHEQUE_LIQUIDADO); }
}
class TransferenciaLiquidadaHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.TRANSFERENCIA_LIQUIDADA); }
}
class BoletoLiquidadoHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.BOLETO_LIQUIDADO); }
}
class LiquidacaoEstornadaHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.LIQUIDACAO_ESTORNADA); }
}
class LiquidacaoFalhouHandler extends BaseFinancialEventHandler {
  constructor() { super(FinancialEventTypes.LIQUIDACAO_FALHOU); }
}

/**
 * Registra um handler vazio por tipo do catálogo oficial.
 * @param {import('../FinancialEventDispatcher')} dispatcher
 */
function registrarHandlersOficiais(dispatcher) {
  const handlers = [
    new VendaRecebidaHandler(),
    new VendaCanceladaHandler(),
    new TituloReceberCriadoHandler(),
    new TituloReceberAtualizadoHandler(),
    new TituloReceberCanceladoHandler(),
    new TituloReceberBaixadoHandler(),
    new TituloReceberParcialHandler(),
    new TituloReceberVencidoHandler(),
    new TituloReceberRenegociadoHandler(),
    new TituloPagarCriadoHandler(),
    new TituloPagarAtualizadoHandler(),
    new TituloPagarCanceladoHandler(),
    new TituloPagarBaixadoHandler(),
    new TituloPagarParcialHandler(),
    new TituloPagarVencidoHandler(),
    new TituloPagarRenegociadoHandler(),
    new CaixaAbertoHandler(),
    new CaixaFechadoHandler(),
    new CaixaSangriaHandler(),
    new CaixaSuprimentoHandler(),
    new CaixaAjusteHandler(),
    new CaixaConciliacaoHandler(),
    new PixRecebidoHandler(),
    new PixEstornadoHandler(),
    new TefAprovadoHandler(),
    new TefCanceladoHandler(),
    new TransferenciaBancariaHandler(),
    new AjusteFinanceiroHandler(),
    new ConciliacaoRealizadaHandler(),
    new EstornoFinanceiroHandler(),
    new PrestacaoRecebidaHandler(),
    new LiquidacaoRealizadaHandler(),
    new PixLiquidadoHandler(),
    new TefLiquidadoHandler(),
    new DinheiroLiquidadoHandler(),
    new CartaoLiquidadoHandler(),
    new ChequeLiquidadoHandler(),
    new TransferenciaLiquidadaHandler(),
    new BoletoLiquidadoHandler(),
    new LiquidacaoEstornadaHandler(),
    new LiquidacaoFalhouHandler()
  ];

  for (const h of handlers) {
    dispatcher.registrarHandler(h.eventType, h);
  }

  return handlers;
}

module.exports = {
  BaseFinancialEventHandler,
  FinancialCashHandler: require('./FinancialCashHandler'),
  FinancialReceivableHandler: require('./FinancialReceivableHandler'),
  FinancialPayableHandler: require('./FinancialPayableHandler'),
  FinancialSettlementHandler: require('./FinancialSettlementHandler'),
  VendaRecebidaHandler,
  VendaCanceladaHandler,
  TituloReceberCriadoHandler,
  TituloReceberAtualizadoHandler,
  TituloReceberCanceladoHandler,
  TituloReceberBaixadoHandler,
  TituloReceberParcialHandler,
  TituloReceberVencidoHandler,
  TituloReceberRenegociadoHandler,
  TituloPagarCriadoHandler,
  TituloPagarAtualizadoHandler,
  TituloPagarCanceladoHandler,
  TituloPagarBaixadoHandler,
  TituloPagarParcialHandler,
  TituloPagarVencidoHandler,
  TituloPagarRenegociadoHandler,
  CaixaAbertoHandler,
  CaixaFechadoHandler,
  CaixaSangriaHandler,
  CaixaSuprimentoHandler,
  CaixaAjusteHandler,
  CaixaConciliacaoHandler,
  PixRecebidoHandler,
  PixEstornadoHandler,
  TefAprovadoHandler,
  TefCanceladoHandler,
  TransferenciaBancariaHandler,
  AjusteFinanceiroHandler,
  ConciliacaoRealizadaHandler,
  EstornoFinanceiroHandler,
  PrestacaoRecebidaHandler,
  LiquidacaoRealizadaHandler,
  PixLiquidadoHandler,
  TefLiquidadoHandler,
  DinheiroLiquidadoHandler,
  CartaoLiquidadoHandler,
  ChequeLiquidadoHandler,
  TransferenciaLiquidadaHandler,
  BoletoLiquidadoHandler,
  LiquidacaoEstornadaHandler,
  LiquidacaoFalhouHandler,
  registrarHandlersOficiais
};
