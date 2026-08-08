/**
 * MCC-04 — Motor de Estoque (CORE)
 *
 * Responsabilidade: Entrada · Saída · Saldo · Reserva · Inventário · Auditoria
 * NÃO conhece: Caixa, Pacote, Metro, Kg, Litro, conversão, fator, UC.
 *
 * Fluxo oficial: Qualquer módulo → MCC → quantidadeBase → MotorEstoque → Persistência
 */

const MotorEstoqueService = require('./services/MotorEstoqueService');
const MovimentacaoEstoque = require('./domain/MovimentacaoEstoque');
const QuantidadeComercialRejeitadaError = require('./domain/QuantidadeComercialRejeitadaError');
const {
  OperacaoEstoque,
  OrigemEstoque,
  MOTOR_ESTOQUE_NOME,
  MOTOR_ESTOQUE_VERSAO
} = require('./domain/enums');
const ProdutoSaldoRepository = require('./repositories/ProdutoSaldoRepository');
const EstoqueMovimentacaoRepository = require('./repositories/EstoqueMovimentacaoRepository');
const { bootstrapMotorEstoqueSchema } = require('./migrations/001_estoque_movimentacoes');

const motor = new MotorEstoqueService();

module.exports = {
  MotorEstoqueService,
  motor,
  entrar: (db, entrada) => motor.entrar(db, entrada),
  sair: (db, entrada) => motor.sair(db, entrada),
  ajustar: (db, entrada) => motor.ajustar(db, entrada),
  inventariar: (db, entrada) => motor.inventariar(db, entrada),
  reservar: (db, entrada) => motor.reservar(db, entrada),
  liberarReserva: (db, entrada) => motor.liberarReserva(db, entrada),
  consultarSaldo: (db, produtoId) => motor.consultarSaldo(db, produtoId),
  MovimentacaoEstoque,
  QuantidadeComercialRejeitadaError,
  OperacaoEstoque,
  OrigemEstoque,
  MOTOR_ESTOQUE_NOME,
  MOTOR_ESTOQUE_VERSAO,
  ProdutoSaldoRepository,
  EstoqueMovimentacaoRepository,
  bootstrapMotorEstoqueSchema,
  bootstrapEstoqueSchema: bootstrapMotorEstoqueSchema
};
