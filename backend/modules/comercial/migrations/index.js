/**
 * Migrations — Cadastros Comercial V2
 */

const migration001 = require('./001_canais_tabelas_preco');
const migration002 = require('./002_forma_comercializacao');
const migration003 = require('./003_configuracao_comercial');
const migration004 = require('./004_forma_por_canal');
const migration005 = require('./005_gerenciador_canais');
const migration006 = require('./006_montador_casquinha');
const migration007 = require('./007_linhas_comerciais');
const migration008 = require('./008_categoria_linha_comercial');
const migration009 = require('./009_montador_sorvete');
const migration010 = require('./010_casquinha_builder');
const migration011 = require('./011_kits_combos');
const migration012 = require('./012_tabela_preco_linha');
const migration013 = require('./013_politica_comercial_desacoplamento');
const migration014 = require('./014_tabela_preco_produto_itens');
const migration015 = require('./015_linha_precificacao_ra2');
const migration016 = require('./016_tabela_mono_canal_ra6');
const migration017 = require('./017_ra68_indices_performance');
const migration018 = require('./018_tipos_comerciais');
const migration019 = require('./019_tipos_comerciais_canais');
const migration020 = require('./020_central_precificacao_rcm83');

const MIGRATIONS = [
  { id: '001_canais_tabelas_preco', run: migration001 },
  { id: '002_forma_comercializacao', run: migration002 },
  { id: '003_configuracao_comercial', run: migration003 },
  { id: '004_forma_por_canal', run: migration004 },
  { id: '005_gerenciador_canais', run: migration005 },
  { id: '006_montador_casquinha', run: migration006 },
  { id: '007_linhas_comerciais', run: migration007 },
  { id: '008_categoria_linha_comercial', run: migration008 },
  { id: '009_montador_sorvete', run: migration009 },
  { id: '010_casquinha_builder', run: migration010 },
  { id: '011_kits_combos', run: migration011 },
  { id: '012_tabela_preco_linha', run: migration012 },
  { id: '013_politica_comercial_desacoplamento', run: migration013 },
  { id: '014_tabela_preco_produto_itens', run: migration014 },
  { id: '015_linha_precificacao_ra2', run: migration015 },
  { id: '016_tabela_mono_canal_ra6', run: migration016 },
  { id: '017_ra68_indices_performance', run: migration017 },
  { id: '018_tipos_comerciais', run: migration018 },
  { id: '019_tipos_comerciais_canais', run: migration019 },
  { id: '020_central_precificacao_rcm83', run: migration020 }
];

/**
 * @param {Object} db
 * @returns {Promise<void>}
 */
async function aplicarMigrationsComercialV2(db) {
  for (const migration of MIGRATIONS) {
    await migration.run(db);
  }
}

module.exports = {
  MIGRATIONS,
  aplicarMigrationsComercialV2
};
