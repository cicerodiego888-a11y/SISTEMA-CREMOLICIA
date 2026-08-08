/**
 * Migrations do Motor Comercial — Sprint 2.2
 *
 * @module motores/motor-comercial/migrations
 */

const migration001 = require('./001_perfil_comercial');
const migration002 = require('./002_consignacoes');
const migration003 = require('./003_consignacoes_itens');
const migration004 = require('./004_movimentacoes_comerciais');
const migration005 = require('./005_movimentacoes_perfil');
const migration006 = require('./006_indices');
const migration007 = require('./007_constraints');
const migration008 = require('./008_outbox');
const migration009 = require('./009_consignacao_documento_externo');
const migration010 = require('./010_consignacoes_itens_observacao');
const migration011 = require('./011_rateio_perdas');
const migration012 = require('./012_rcm61_congelamento_precificacao');

const MIGRATIONS = [
  { id: '001_perfil_comercial', run: migration001 },
  { id: '002_consignacoes', run: migration002 },
  { id: '003_consignacoes_itens', run: migration003 },
  { id: '004_movimentacoes_comerciais', run: migration004 },
  { id: '005_movimentacoes_perfil', run: migration005 },
  { id: '006_indices', run: migration006 },
  { id: '007_constraints', run: migration007 },
  { id: '008_outbox', run: migration008 },
  { id: '009_consignacao_documento_externo', run: migration009 },
  { id: '010_consignacoes_itens_observacao', run: migration010 },
  { id: '011_rateio_perdas', run: migration011 },
  { id: '012_rcm61_congelamento_precificacao', run: migration012 }
];

/**
 * @param {Object} db
 * @returns {Promise<void>}
 */
async function aplicarMigrationsMotorComercial(db) {
  for (const migration of MIGRATIONS) {
    await migration.run(db);
  }
}

/**
 * @param {Object} db
 * @param {Function} callback
 */
function aplicarMigrationsMotorComercialSync(db, callback) {
  aplicarMigrationsMotorComercial(db)
    .then(() => callback?.(null))
    .catch((err) => callback?.(err));
}

module.exports = {
  MIGRATIONS,
  aplicarMigrationsMotorComercial,
  aplicarMigrationsMotorComercialSync
};
