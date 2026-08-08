/**
 * MCC-04 — Motor de Estoque (CORE)
 *
 * Conhece APENAS: Produto · Unidade Base · Quantidade Base.
 * Nunca: Unidade Comercial · Fator · Conversão.
 */

const OperacaoEstoque = Object.freeze({
  ENTRADA: 'ENTRADA',
  SAIDA: 'SAIDA',
  AJUSTE: 'AJUSTE',
  INVENTARIO: 'INVENTARIO',
  RESERVA: 'RESERVA',
  LIBERACAO_RESERVA: 'LIBERACAO_RESERVA'
});

const OrigemEstoque = Object.freeze({
  COMPRA: 'COMPRA',
  VENDA: 'VENDA',
  PDV: 'PDV',
  AJUSTE_MANUAL: 'AJUSTE_MANUAL',
  INVENTARIO: 'INVENTARIO',
  CONSIGNACAO: 'CONSIGNACAO',
  DEVOLUCAO: 'DEVOLUCAO',
  PRODUCAO_PROPRIA: 'PRODUCAO_PROPRIA',
  RESERVA: 'RESERVA',
  OUTROS: 'OUTROS'
});

const MOTOR_ESTOQUE_NOME = 'MotorEstoque';
const MOTOR_ESTOQUE_VERSAO = '1.0.0-mcc04';

module.exports = {
  OperacaoEstoque,
  OrigemEstoque,
  MOTOR_ESTOQUE_NOME,
  MOTOR_ESTOQUE_VERSAO
};
