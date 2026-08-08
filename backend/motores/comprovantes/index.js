/**
 * Motor de Comprovantes — CDS (RCM-04.4 / RC2.1)
 *
 * Gera snapshots oficiais de documentos comerciais.
 * Frontend apenas renderiza — nenhuma regra de negócio no client.
 */

const { TIPOS_COMPROVANTE, ACOES_AUDITORIA, MOTOR_COMPROVANTES_VERSAO } = require('./domain/enums');
const ComprovanteEntregaBuilder = require('./services/ComprovanteEntregaBuilder');
const ComprovantePrestacaoBuilder = require('./services/ComprovantePrestacaoBuilder');
const { registrarAcaoComprovante } = require('./services/ComprovanteAuditoria');

async function gerarComprovanteEntrega(consignacaoId, opcoes = {}) {
  const builder = new ComprovanteEntregaBuilder();
  return builder.gerar(consignacaoId, opcoes);
}

async function gerarComprovantePrestacao(consignacaoId, opcoes = {}) {
  const builder = new ComprovantePrestacaoBuilder();
  return builder.gerar(consignacaoId, opcoes);
}

module.exports = {
  TIPOS_COMPROVANTE,
  ACOES_AUDITORIA,
  MOTOR_COMPROVANTES_VERSAO,
  gerarComprovanteEntrega,
  gerarComprovantePrestacao,
  registrarAcaoComprovante,
  ComprovanteEntregaBuilder,
  ComprovantePrestacaoBuilder
};
