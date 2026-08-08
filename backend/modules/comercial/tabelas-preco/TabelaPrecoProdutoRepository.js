/**
 * RA-1.1 — Persistência Tabela × Produto × Canal
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

class TabelaPrecoProdutoRepository {
  async listarItens(tabelaPrecoId) {
    return all(
      `
      SELECT
        i.id,
        i.tabela_preco_id,
        i.produto_id,
        i.canal_venda_id,
        i.preco,
        i.forma_comercializacao,
        i.unidade_comercial,
        COALESCE(i.ativo, 1) AS ativo,
        p.codigo AS produto_codigo,
        p.nome AS produto_nome,
        p.forma_comercializacao AS produto_forma,
        p.unidade AS produto_unidade,
        c.codigo AS canal_codigo,
        c.nome AS canal_nome
      FROM tabela_preco_produto_itens i
      INNER JOIN produtos p ON p.id = i.produto_id
      INNER JOIN canais_venda c ON c.id = i.canal_venda_id
      WHERE i.tabela_preco_id = ?
      ORDER BY p.nome COLLATE NOCASE, c.codigo
      `,
      [tabelaPrecoId]
    ).catch(() => []);
  }

  async buscarPrecoProdutoCanal(tabelaPrecoId, produtoId, canalCodigo) {
    return get(
      `
      SELECT
        i.preco,
        i.canal_venda_id,
        i.forma_comercializacao,
        i.unidade_comercial,
        t.nome AS tabela_nome,
        t.ativo AS tabela_ativa,
        c.codigo AS canal_codigo
      FROM tabela_preco_produto_itens i
      INNER JOIN tabelas_preco t ON t.id = i.tabela_preco_id
      INNER JOIN canais_venda c ON c.id = i.canal_venda_id
      WHERE i.tabela_preco_id = ?
        AND i.produto_id = ?
        AND UPPER(c.codigo) = UPPER(?)
        AND COALESCE(i.ativo, 1) = 1
      LIMIT 1
      `,
      [tabelaPrecoId, produtoId, canalCodigo]
    ).catch(() => null);
  }

  async substituirItens(tabelaPrecoId, itens = []) {
    await run(`DELETE FROM tabela_preco_produto_itens WHERE tabela_preco_id = ?`, [
      tabelaPrecoId
    ]);

    const produtoIds = new Set();

    for (const item of itens) {
      const produtoId = Number(item.produto_id);
      const canalId = Number(item.canal_venda_id);
      const preco = Number(item.preco);
      if (!Number.isFinite(produtoId) || produtoId <= 0) continue;
      if (!Number.isFinite(canalId) || canalId <= 0) continue;
      if (!Number.isFinite(preco) || preco < 0) continue;

      const prod = await get(`SELECT id FROM produtos WHERE id = ?`, [produtoId]);
      if (!prod) {
        const err = new Error(`Produto ${produtoId} não encontrado`);
        err.statusCode = 400;
        throw err;
      }
      const canal = await get(`SELECT id FROM canais_venda WHERE id = ?`, [canalId]);
      if (!canal) {
        const err = new Error(`Canal ${canalId} não encontrado`);
        err.statusCode = 400;
        throw err;
      }

      const forma = item.forma_comercializacao
        ? String(item.forma_comercializacao).trim().toUpperCase()
        : null;
      const unidade = item.unidade_comercial
        ? String(item.unidade_comercial).trim().toUpperCase()
        : null;

      await run(
        `
        INSERT INTO tabela_preco_produto_itens (
          tabela_preco_id, produto_id, canal_venda_id, preco,
          forma_comercializacao, unidade_comercial, ativo, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
        [
          tabelaPrecoId,
          produtoId,
          canalId,
          preco,
          forma,
          unidade,
          item.ativo === false || item.ativo === 0 ? 0 : 1
        ]
      );
      produtoIds.add(produtoId);
    }

    return [...produtoIds];
  }

  /**
   * Compat RA-1.1: espelha preços por canal em tabela_preco_valores (sem linha).
   * Mantém módulos antigos que leem só canal×tabela.
   */
  async sincronizarCompatValoresCanal(tabelaPrecoId) {
    const rows = await all(
      `
      SELECT canal_venda_id,
             MIN(preco) AS preco,
             MAX(forma_comercializacao) AS forma_comercializacao,
             MAX(unidade_comercial) AS unidade_comercial
      FROM tabela_preco_produto_itens
      WHERE tabela_preco_id = ?
      GROUP BY canal_venda_id
      `,
      [tabelaPrecoId]
    ).catch(() => []);

    // Remove apenas valores sem política (legado canal-only) para não apagar sync de linhas
    await run(
      `DELETE FROM tabela_preco_valores
       WHERE tabela_preco_id = ?
         AND (linha_comercial_id IS NULL OR linha_comercial_id = 0)`,
      [tabelaPrecoId]
    ).catch(() => {});

    for (const row of rows || []) {
      await run(
        `
        INSERT INTO tabela_preco_valores (
          tabela_preco_id, linha_comercial_id, canal_venda_id, preco,
          forma_comercializacao, unidade_comercial
        ) VALUES (?, NULL, ?, ?, ?, ?)
        `,
        [
          tabelaPrecoId,
          row.canal_venda_id,
          Number(row.preco),
          row.forma_comercializacao || null,
          row.unidade_comercial || null
        ]
      ).catch(async () => {
        // unique antigo (tabela, canal) — tenta update
        await run(
          `
          UPDATE tabela_preco_valores
          SET preco = ?, forma_comercializacao = ?, unidade_comercial = ?
          WHERE tabela_preco_id = ?
            AND canal_venda_id = ?
            AND (linha_comercial_id IS NULL OR linha_comercial_id = 0)
          `,
          [
            Number(row.preco),
            row.forma_comercializacao || null,
            row.unidade_comercial || null,
            tabelaPrecoId,
            row.canal_venda_id
          ]
        );
      });
    }
  }

  async vincularProdutosNaTabela(tabelaPrecoId, produtoIds = []) {
    for (const produtoId of produtoIds) {
      await run(`UPDATE produtos SET tabela_preco_id = ? WHERE id = ?`, [
        tabelaPrecoId,
        produtoId
      ]).catch(() => {});
    }
  }
}

module.exports = new TabelaPrecoProdutoRepository();
