/**
 * Saldo do mesmo produto em cada local.
 * O saldo oficial do produto continua no Motor de Estoque.
 * Sem linha de local, o saldo já existente representa a Loja.
 */

const LOCAL_LOJA = 'LOJA';
const LOCAL_FABRICA = 'FABRICA';

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function round3(valor) {
  return Math.round(Number(valor) * 1000) / 1000;
}

async function tabelaPronta(db) {
  try {
    const row = await get(db, `
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'estoque_saldos_locais'
    `);
    return !!(row && row.name);
  } catch (_) {
    return false;
  }
}

function localDoMovimento(entrada, operacao) {
  const explicito = String(entrada.local || entrada.localCodigo || entrada.local_codigo || '').trim().toUpperCase();
  if (explicito === LOCAL_FABRICA || explicito === LOCAL_LOJA) return explicito;
  const origem = String(entrada.origem || '').toUpperCase();
  if (operacao === 'ENTRADA' && origem === 'PRODUCAO') return LOCAL_FABRICA;
  return LOCAL_LOJA;
}

async function garantirLegadoNaLoja(db, produtoId, saldoAntes) {
  const existente = await get(db, `
    SELECT id FROM estoque_saldos_locais WHERE produto_id = ? LIMIT 1
  `, [produtoId]);
  if (existente) return;
  const fiscal = round3(saldoAntes.saldoFiscal || 0);
  const naoFiscal = round3(saldoAntes.saldoNaoFiscal || 0);
  await run(db, `
    INSERT INTO estoque_saldos_locais (produto_id, local, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
    VALUES (?, ?, ?, ?, ?)
  `, [produtoId, LOCAL_LOJA, fiscal, naoFiscal, round3(fiscal + naoFiscal)]);
}

async function somarNoLocal(db, produtoId, local, deltaFiscal, deltaNaoFiscal) {
  const atual = await get(db, `
    SELECT id FROM estoque_saldos_locais WHERE produto_id = ? AND local = ?
  `, [produtoId, local]);
  if (!atual) {
    const fiscal = round3(deltaFiscal);
    const naoFiscal = round3(deltaNaoFiscal);
    await run(db, `
      INSERT INTO estoque_saldos_locais (produto_id, local, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
      VALUES (?, ?, ?, ?, ?)
    `, [produtoId, local, fiscal, naoFiscal, round3(fiscal + naoFiscal)]);
    return;
  }
  await run(db, `
    UPDATE estoque_saldos_locais
    SET saldo_fiscal = COALESCE(saldo_fiscal, 0) + ?,
        saldo_nao_fiscal = COALESCE(saldo_nao_fiscal, 0) + ?,
        estoque_atual = (COALESCE(saldo_fiscal, 0) + ?) + (COALESCE(saldo_nao_fiscal, 0) + ?)
    WHERE produto_id = ? AND local = ?
  `, [deltaFiscal, deltaNaoFiscal, deltaFiscal, deltaNaoFiscal, produtoId, local]);
}

async function refletirMovimento(db, entrada) {
  if (!(await tabelaPronta(db))) return null;
  const local = localDoMovimento(entrada, entrada.operacao);
  await garantirLegadoNaLoja(db, entrada.produtoId, entrada.saldoAntes || {});
  await somarNoLocal(db, entrada.produtoId, local, entrada.deltaFiscal || 0, entrada.deltaNaoFiscal || 0);
  return local;
}

async function consultarSaldoLocal(db, produtoId, local) {
  const codigo = String(local || LOCAL_LOJA).trim().toUpperCase();
  if (!(await tabelaPronta(db))) {
    return { local: codigo, saldoFiscal: 0, saldoNaoFiscal: 0, estoqueAtual: 0, herdado: false };
  }
  const row = await get(db, `
    SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual
    FROM estoque_saldos_locais WHERE produto_id = ? AND local = ?
  `, [Number(produtoId), codigo]);
  if (row) {
    return {
      local: codigo,
      saldoFiscal: Number(row.saldo_fiscal || 0),
      saldoNaoFiscal: Number(row.saldo_nao_fiscal || 0),
      estoqueAtual: Number(row.estoque_atual || 0),
      herdado: false
    };
  }
  const outro = await get(db, `
    SELECT id FROM estoque_saldos_locais WHERE produto_id = ? LIMIT 1
  `, [Number(produtoId)]);
  if (outro || codigo !== LOCAL_LOJA) {
    return { local: codigo, saldoFiscal: 0, saldoNaoFiscal: 0, estoqueAtual: 0, herdado: false };
  }
  const oficial = await get(db, `
    SELECT COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
           COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
           COALESCE(estoque_atual, 0) AS estoque_atual
    FROM produtos WHERE id = ?
  `, [Number(produtoId)]);
  if (!oficial) return { local: codigo, saldoFiscal: 0, saldoNaoFiscal: 0, estoqueAtual: 0, herdado: false };
  return {
    local: LOCAL_LOJA,
    saldoFiscal: Number(oficial.saldo_fiscal || 0),
    saldoNaoFiscal: Number(oficial.saldo_nao_fiscal || 0),
    estoqueAtual: Number(oficial.estoque_atual || 0),
    herdado: true
  };
}

module.exports = {
  LOCAL_LOJA,
  LOCAL_FABRICA,
  tabelaPronta,
  refletirMovimento,
  consultarSaldoLocal
};
