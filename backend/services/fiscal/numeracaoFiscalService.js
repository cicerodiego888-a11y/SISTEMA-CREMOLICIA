/**
 * Numeração fiscal NF-e modelo 55: empresa (CNPJ) + ambiente + modelo + série.
 * A NFC-e (65) mantém a numeração própria (configService.incrementaNumeroFiscal /
 * fiscal_numero_atual) e não é lida nem gravada aqui.
 */

'use strict';

const db = require('../../database');
const { onlyDigits } = require('./utils');

const LIMITE_NUMERO = 999999999;
const LIMITE_SERIE = 999;

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function padModelo(modelo) {
  return String(modelo == null ? '' : modelo).replace(/\D/g, '').padStart(2, '0') || '55';
}

function assertModeloNfe(modelo) {
  const mod = padModelo(modelo);
  if (mod !== '55') {
    const err = new Error(`Numeração do modelo ${mod} não é gerenciada por este serviço (somente NF-e 55).`);
    err.code = 'MODELO_NAO_SUPORTADO';
    throw err;
  }
  return mod;
}

const CNPJ_VAZIO = '00000000000000';

function cnpjChave(cnpj) {
  return onlyDigits(cnpj).padStart(14, '0').slice(-14) || CNPJ_VAZIO;
}

async function lerConfig(chave, padrao) {
  const row = await dbGet(`SELECT valor FROM configuracoes WHERE chave = ?`, [chave]).catch(() => null);
  return row && row.valor != null && row.valor !== '' ? row.valor : padrao;
}

/**
 * fiscal_serie_nfe / fiscal_numero_atual_nfe espelham somente a numeração ativa
 * (CNPJ + ambiente + série configurados); reservas em outra combinação não os alteram.
 */
async function ehNumeracaoAtiva({ cnpj, ambiente, serie = null }) {
  const cnpjAtivo = cnpjChave(await lerConfig('cnpj', ''));
  const { resolverAmbienteNfe, CHAVE_AMBIENTE_NFE } = require('./nfeAmbienteGuard');
  const ambienteAtivo = resolverAmbienteNfe({ [CHAVE_AMBIENTE_NFE]: await lerConfig(CHAVE_AMBIENTE_NFE, '') }).ambiente;
  const serieAtiva = Number(await lerConfig('fiscal_serie_nfe', await lerConfig('fiscal_serie', '1'))) || 1;
  return cnpjChave(cnpj) === cnpjAtivo
    && Number(ambiente) === ambienteAtivo
    && (serie == null || Number(serie) === serieAtiva);
}

function chaveLockNumeracao({ cnpj, ambiente, modelo, serie }) {
  return `fiscal-num:${cnpjChave(cnpj)}:${Number(ambiente)}:${padModelo(modelo)}:${Number(serie)}`;
}

function validarNumeracaoFiscal({ serie, proximoNumero } = {}) {
  const s = Number(serie);
  const n = Number(proximoNumero);
  if (!Number.isFinite(s) || s < 1 || s > LIMITE_SERIE || !Number.isInteger(s)) {
    const err = new Error('Série fiscal inválida. Informe um valor entre 1 e 999.');
    err.code = 'SERIE_INVALIDA';
    throw err;
  }
  if (!Number.isFinite(n) || n < 1 || n > LIMITE_NUMERO || !Number.isInteger(n)) {
    const err = new Error('Próximo número fiscal inválido. Informe um valor entre 1 e 999999999.');
    err.code = 'NUMERO_INVALIDO';
    throw err;
  }
  return { serie: s, proximoNumero: n };
}

function proximoLivreDeConjunto(inicio, ocupados) {
  const set = ocupados instanceof Set
    ? ocupados
    : new Set((ocupados || []).map((x) => Number(x)));
  let n = Math.max(1, Number(inicio) || 1);
  while (set.has(n)) n += 1;
  if (n > LIMITE_NUMERO) {
    const err = new Error('Limite de numeração fiscal (999999999) atingido.');
    err.code = 'NUMERO_LIMITE';
    throw err;
  }
  return n;
}

let tabelaOk = false;

async function garantirTabelaNumeracaoFiscal() {
  if (tabelaOk) return;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS fiscal_numeracao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_cnpj TEXT NOT NULL,
      ambiente INTEGER NOT NULL,
      modelo TEXT NOT NULL,
      serie INTEGER NOT NULL,
      proximo_numero INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (empresa_cnpj, ambiente, modelo, serie)
    )
  `);
  tabelaOk = true;
}

async function obterLinhaNumeracao({ cnpj, ambiente, modelo, serie }) {
  await garantirTabelaNumeracaoFiscal();
  return dbGet(
    `SELECT * FROM fiscal_numeracao
     WHERE empresa_cnpj = ? AND CAST(ambiente AS INTEGER) = ?
       AND modelo = ? AND CAST(serie AS INTEGER) = ?`,
    [cnpjChave(cnpj), Number(ambiente), padModelo(modelo), Number(serie)]
  );
}

async function upsertNumeracao({ cnpj, ambiente, modelo, serie, proximoNumero }) {
  const v = validarNumeracaoFiscal({ serie, proximoNumero });
  await garantirTabelaNumeracaoFiscal();
  const emp = cnpjChave(cnpj);
  const amb = Number(ambiente);
  const mod = padModelo(modelo);
  await dbRun(
    `INSERT INTO fiscal_numeracao (empresa_cnpj, ambiente, modelo, serie, proximo_numero, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(empresa_cnpj, ambiente, modelo, serie) DO UPDATE SET
       proximo_numero = excluded.proximo_numero,
       updated_at = CURRENT_TIMESTAMP`,
    [emp, amb, mod, v.serie, v.proximoNumero]
  );
  return {
    numero: v.proximoNumero,
    serie: v.serie,
    modelo: mod,
    ambiente: amb,
    empresaCnpj: emp
  };
}

async function maxLocalModelo({ modelo, serie, ambiente, cnpj }) {
  const s = Number(serie);
  const amb = Number(ambiente);
  assertModeloNfe(modelo);
  const emp = cnpjChave(cnpj);
  const q = async (sql, params) => {
    const row = await dbGet(sql, params).catch(() => null);
    return Number(row && row.m) || 0;
  };
  const likeCnpj = `%${emp}%`;
  // Chave de acesso: posições 7–20 = CNPJ do emitente. Linhas sem chave contam (conservador).
  const filtroCnpj = emp !== CNPJ_VAZIO
    ? ` AND (COALESCE(chave_acesso, '') = '' OR substr(chave_acesso, 7, 14) = ?)`
    : '';
  const pCnpj = filtroCnpj ? [emp] : [];
  const [compra, venda, nfe, ocup] = await Promise.all([
    q(
      `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_devolucoes_compra
       WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?${filtroCnpj}`,
      [s, amb, ...pCnpj]
    ),
    q(
      `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_devolucoes_venda
       WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?${filtroCnpj}`,
      [s, amb, ...pCnpj]
    ),
    q(
      `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_notas
       WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?${filtroCnpj}`,
      [s, amb, ...pCnpj]
    ),
    q(
      `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_numeros_ocupados_sefaz
       WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?
         AND (cnpj IS NULL OR cnpj = ? OR chave LIKE ?)`,
      [s, amb, emp, likeCnpj]
    )
  ]);
  return Math.max(compra, venda, nfe, ocup);
}

async function migrarNumeracaoSeNecessario({ cnpj, ambiente }) {
  await garantirTabelaNumeracaoFiscal();
  const emp = cnpjChave(cnpj);
  const amb = Number(ambiente || 2);

  const serie55 = Number(await lerConfig('fiscal_serie_nfe', await lerConfig('fiscal_serie', '1'))) || 1;
  if (!(await obterLinhaNumeracao({ cnpj: emp, ambiente: amb, modelo: '55', serie: serie55 }))) {
    const ativa = await ehNumeracaoAtiva({ cnpj: emp, ambiente: amb });
    const atual55 = ativa ? (Number(await lerConfig('fiscal_numero_atual_nfe', '')) || 0) : 0;
    const max55 = await maxLocalModelo({ modelo: '55', serie: serie55, ambiente: amb, cnpj: emp });
    const proximo55 = atual55 > 0 ? Math.max(atual55, max55 + 1) : Math.max(1, max55 + 1);
    await upsertNumeracao({
      cnpj: emp, ambiente: amb, modelo: '55', serie: serie55, proximoNumero: proximo55
    });
    if (ativa) {
      const { setConfiguracao } = require('./configService');
      await setConfiguracao('fiscal_numero_atual_nfe', String(proximo55), 'number', 'Próximo número da NF-e modelo 55');
    }
  }
}

async function obterProximaNumeracaoFiscal({
  empresaId,
  cnpj,
  ambiente,
  modelo,
  serie
} = {}) {
  const emp = cnpjChave(cnpj || empresaId);
  const amb = Number(ambiente);
  const mod = assertModeloNfe(modelo);
  const ser = Number(serie || 1);
  await migrarNumeracaoSeNecessario({ cnpj: emp, ambiente: amb });
  const linha = await obterLinhaNumeracao({ cnpj: emp, ambiente: amb, modelo: mod, serie: ser });
  const maxLocal = await maxLocalModelo({ modelo: mod, serie: ser, ambiente: amb, cnpj: emp });
  let proximo = Number(linha && linha.proximo_numero) || 1;
  if (!linha) {
    proximo = Math.max(1, maxLocal + 1);
  }
  return {
    numero: proximo,
    serie: ser,
    modelo: mod,
    ambiente: amb,
    empresaCnpj: emp,
    maiorLocal: maxLocal
  };
}

async function salvarProximaNumeracaoFiscal(params) {
  assertModeloNfe(params.modelo);
  const v = validarNumeracaoFiscal({
    serie: params.serie,
    proximoNumero: params.proximoNumero
  });
  const out = await upsertNumeracao({
    cnpj: params.cnpj || params.empresaId,
    ambiente: params.ambiente,
    modelo: params.modelo,
    serie: v.serie,
    proximoNumero: v.proximoNumero
  });
  if (await ehNumeracaoAtiva({ cnpj: params.cnpj || params.empresaId, ambiente: params.ambiente, serie: v.serie })) {
    const { setConfiguracao } = require('./configService');
    await setConfiguracao('fiscal_numero_atual_nfe', String(v.proximoNumero), 'number', 'Próximo número da NF-e modelo 55');
  }
  return out;
}

async function reservarProximaNumeracaoFiscal({
  empresaId,
  cnpj,
  ambiente,
  modelo,
  serie,
  ocupadosExtras
} = {}) {
  const { withLockQueued } = require('./nfeEmissionLockService');
  const emp = cnpjChave(cnpj || empresaId);
  const amb = Number(ambiente);
  const mod = assertModeloNfe(modelo);
  const ser = Number(serie || 1);
  const lock = chaveLockNumeracao({ cnpj: emp, ambiente: amb, modelo: mod, serie: ser });

  return withLockQueued(lock, async () => {
    await migrarNumeracaoSeNecessario({ cnpj: emp, ambiente: amb });
    const peek = await obterProximaNumeracaoFiscal({
      cnpj: emp, ambiente: amb, modelo: mod, serie: ser
    });
    const ocupados = new Set([...(ocupadosExtras || [])].map((n) => Number(n)));
    try {
      const { hidratarOcupadosDoHistorico, numeroOcupadoSefazEmMemoria } = require('./nfeNumeracaoNfeService');
      await hidratarOcupadosDoHistorico();
      let cand = peek.numero;
      while (numeroOcupadoSefazEmMemoria({ cnpj: emp, ambiente: amb, serie: ser, numero: cand })) {
        ocupados.add(cand);
        cand += 1;
      }
    } catch (_) { /* ocupados opcionais */ }
    const usado = proximoLivreDeConjunto(Math.max(peek.numero, (peek.maiorLocal || 0) + 1), ocupados);
    await upsertNumeracao({
      cnpj: emp, ambiente: amb, modelo: mod, serie: ser, proximoNumero: usado + 1
    });
    if (await ehNumeracaoAtiva({ cnpj: emp, ambiente: amb, serie: ser })) {
      const { setConfiguracao } = require('./configService');
      await setConfiguracao('fiscal_numero_atual_nfe', String(usado + 1), 'number', 'Próximo número da NF-e modelo 55');
    }
    return {
      numero: usado,
      serie: ser,
      modelo: mod,
      ambiente: amb,
      empresaCnpj: emp
    };
  });
}

async function alinharProximoMinimoNfe({ cnpj, ambiente, serie, minimo }) {
  const peek = await obterProximaNumeracaoFiscal({
    cnpj, ambiente, modelo: '55', serie: serie || 1
  });
  const alvo = Math.max(peek.numero, Number(minimo) || 1);
  if (alvo > peek.numero) {
    await salvarProximaNumeracaoFiscal({
      cnpj, ambiente, modelo: '55', serie: peek.serie, proximoNumero: alvo
    });
  }
  return alvo;
}

module.exports = {
  LIMITE_NUMERO,
  LIMITE_SERIE,
  validarNumeracaoFiscal,
  chaveLockNumeracao,
  proximoLivreDeConjunto,
  garantirTabelaNumeracaoFiscal,
  migrarNumeracaoSeNecessario,
  obterProximaNumeracaoFiscal,
  salvarProximaNumeracaoFiscal,
  reservarProximaNumeracaoFiscal,
  alinharProximoMinimoNfe,
  cnpjChave,
  padModelo,
  assertModeloNfe,
  upsertNumeracao
};
