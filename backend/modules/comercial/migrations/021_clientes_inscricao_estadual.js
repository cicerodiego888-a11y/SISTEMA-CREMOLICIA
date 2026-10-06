/**
 * CLIENTES-02 — Inscrição Estadual do cliente (destinatário da NF-e).
 * ADD only: clientes.inscricao_estadual VARCHAR(20). Bancos que já têm a coluna não mudam.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration021ClientesInscricaoEstadual(db) {
  const all = (sql) => new Promise((resolve, reject) => {
    db.all(sql, [], (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  const run = (sql) => new Promise((resolve, reject) => {
    db.run(sql, [], (err) => (err ? reject(err) : resolve()));
  });

  return (async () => {
    const colunas = await all('PRAGMA table_info(clientes)');
    if (colunas.some((c) => String(c.name).toLowerCase() === 'inscricao_estadual')) return;
    try {
      await run('ALTER TABLE clientes ADD COLUMN inscricao_estadual VARCHAR(20)');
    } catch (err) {
      if (!/duplicate column/i.test(err.message || '')) throw err;
    }
    console.log('[CLIENTES-02] migration 021_clientes_inscricao_estadual aplicada');
  })();
}

module.exports = migration021ClientesInscricaoEstadual;
