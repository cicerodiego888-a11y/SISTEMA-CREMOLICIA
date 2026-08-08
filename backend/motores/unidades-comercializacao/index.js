/**
 * Motor UC-01 / UC-01.1 — Unidades de Comercialização (CORE)
 *
 * Princípio: 1 Produto → 1 Unidade Base (SSOT) → N Unidades Comerciais.
 * UC-01.1: canais, prioridade, unidade padrão, conversão por lote (flag), auditorias.
 */

const constants = require('./constants');
const service = require('./services/ProdutoUnidadeComercialService');
const repository = require('./repositories/ProdutoUnidadeComercialRepository');
const { bootstrapUnidadesComercializacaoSchema } = require('./migrations/001_produto_unidades_comercializacao');
const { bootstrapUc011Schema } = require('./migrations/002_uc01_1_refinamento');
const { validarPayloadUnidadeComercial, auditarConsistenciaProduto } = require('./validators/UnidadeComercializacaoValidator');
const { toUnidadeComercialDTO } = require('./dto/UnidadeComercialDTO');

async function bootstrapUnidadesComercializacaoCompleto(db) {
  await bootstrapUnidadesComercializacaoSchema(db);
  await bootstrapUc011Schema(db);
}

const MotorUnidadesComercializacao = {
  versao: '1.1.0-uc01.1',
  codigo: 'UC-01.1',
  constants,
  repository,
  service,
  bootstrapUnidadesComercializacaoSchema: bootstrapUnidadesComercializacaoCompleto,
  validarPayloadUnidadeComercial,
  auditarConsistenciaProduto,
  toUnidadeComercialDTO,

  listar: service.listar,
  criar: service.criar,
  atualizar: service.atualizar,
  excluir: service.excluir
};

module.exports = MotorUnidadesComercializacao;
