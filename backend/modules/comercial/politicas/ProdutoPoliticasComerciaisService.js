/**
 * A-1 — Associação N:N Produto ↔ Linha de Precificação
 *
 * Entidade interna: `linhas_comerciais` / `produto_politicas_comerciais` (nome histórico).
 * UI oficial: Linha de Precificação. Mantido para compatibilidade de produtos antigos (A-1).
 * Compatibilidade: produto sem políticas = TODAS as políticas ativas (pode vender).
 */

const db = require('../../../database');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function normalizarIds(ids = []) {
  const out = [];
  const seen = new Set();
  for (const raw of ids || []) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

class ProdutoPoliticasComerciaisService {
  /**
   * Políticas explícitas do produto (junction + legado).
   * @returns {Promise<number[]>}
   */
  async listarIdsPoliticasProduto(produtoId) {
    const id = Number(produtoId);
    if (!Number.isFinite(id) || id <= 0) return [];

    const rows = await all(
      `SELECT linha_comercial_id AS id
       FROM produto_politicas_comerciais
       WHERE produto_id = ?
       ORDER BY linha_comercial_id`,
      [id]
    ).catch(() => []);

    const ids = normalizarIds((rows || []).map((r) => r.id));
    if (ids.length) return ids;

    // Compat legado: produtos.linha_comercial_id
    const prod = await get(
      `SELECT linha_comercial_id FROM produtos WHERE id = ?`,
      [id]
    ).catch(() => null);
    const legado = Number(prod?.linha_comercial_id || 0);
    return legado > 0 ? [legado] : [];
  }

  async listarPoliticasProduto(produtoId) {
    const ids = await this.listarIdsPoliticasProduto(produtoId);
    if (!ids.length) return [];
    const ph = ids.map(() => '?').join(',');
    return all(
      `SELECT id, codigo, descricao, ativo
       FROM linhas_comerciais
       WHERE id IN (${ph})
       ORDER BY descricao COLLATE NOCASE`,
      ids
    );
  }

  /**
   * true = sem vínculo explícito → elegível a todas as políticas ativas.
   */
  async produtoSemPoliticaExplicita(produtoId) {
    const ids = await this.listarIdsPoliticasProduto(produtoId);
    return ids.length === 0;
  }

  /**
   * Substitui o conjunto de políticas do produto.
   * Array vazio = "todas as políticas" (remove vínculos).
   */
  async salvarPoliticasProduto(produtoId, politicaIds = []) {
    const id = Number(produtoId);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error('produto_id inválido');
      err.statusCode = 400;
      throw err;
    }

    const ids = normalizarIds(politicaIds);
    await run(`DELETE FROM produto_politicas_comerciais WHERE produto_id = ?`, [id]);

    for (const politicaId of ids) {
      const existe = await get(
        `SELECT id FROM linhas_comerciais WHERE id = ?`,
        [politicaId]
      );
      if (!existe) continue;
      await run(
        `INSERT OR IGNORE INTO produto_politicas_comerciais (produto_id, linha_comercial_id)
         VALUES (?, ?)`,
        [id, politicaId]
      );
    }

    // Compat legado: mantém primeiro id (ou null) em produtos.linha_comercial_id
    await run(
      `UPDATE produtos SET linha_comercial_id = ? WHERE id = ?`,
      [ids[0] || null, id]
    );

    return this.listarPoliticasProduto(id);
  }

  /**
   * Resolve qual política usar para precificação no canal.
   * Ordem:
   * 1) politica/linha explícita no opts
   * 2) políticas do produto que tenham valor no canal
   * 3) legado linha_comercial_id
   * 4) null (= todas / fallback tabela/legado no resolver)
   */
  async resolverPoliticaParaPreco(produto = {}, opts = {}) {
    const explicita = Number(
      opts.politica_comercial_id
      ?? opts.linha_comercial_id
      ?? produto.linha_comercial_id
      ?? 0
    );
    if (explicita > 0) return explicita;

    const produtoId = Number(produto.id || opts.produto_id || 0);
    if (!produtoId) {
      const legado = Number(produto.linha_comercial_id || 0);
      return legado > 0 ? legado : null;
    }

    const ids = await this.listarIdsPoliticasProduto(produtoId);
    if (!ids.length) return null; // todas habilitadas → resolver usa fallbacks

    const canal = String(opts.canal || opts.canal_codigo || 'VAREJO').trim().toUpperCase();
    const ph = ids.map(() => '?').join(',');
    const row = await get(
      `
      SELECT v.linha_id AS id
      FROM linha_comercial_valores v
      INNER JOIN linhas_comerciais l ON l.id = v.linha_id AND l.ativo = 1
      INNER JOIN canais_venda c ON c.id = v.canal_venda_id
      WHERE v.linha_id IN (${ph})
        AND UPPER(c.codigo) = UPPER(?)
      ORDER BY v.linha_id
      LIMIT 1
      `,
      [...ids, canal]
    ).catch(() => null);

    if (row?.id) return Number(row.id);
    return ids[0] || null;
  }
}

module.exports = new ProdutoPoliticasComerciaisService();
