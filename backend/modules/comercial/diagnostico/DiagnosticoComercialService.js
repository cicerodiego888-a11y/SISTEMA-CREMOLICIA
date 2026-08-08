/**
 * DiagnosticoComercialService — Produto × Linha × Tabela × Canal × Preço (RCM-04.6 / RCM-05.6)
 */

const db = require('../../../database');
const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
const CanalVendaResolver = require('../preco/CanalVendaResolver');

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

class DiagnosticoComercialService {
  async listar(opts = {}) {
    const canal = String(opts.canal || 'VAREJO').trim().toUpperCase() || 'VAREJO';
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
    const busca = String(opts.busca || '').trim();

    const params = [];
    let where = 'WHERE COALESCE(p.ativo, 1) = 1';
    if (busca) {
      where += ' AND (p.nome LIKE ? OR p.codigo LIKE ? OR p.codigo_barras LIKE ?)';
      const like = `%${busca}%`;
      params.push(like, like, like);
    }
    params.push(limit);

    const rows = await dbAll(
      `
      SELECT
        p.id,
        p.nome,
        p.codigo,
        p.preco_venda,
        p.tabela_preco_id,
        p.linha_comercial_id,
        p.categoria_id,
        t.nome AS tabela_nome,
        t.codigo AS tabela_codigo,
        lc.codigo AS linha_codigo,
        lc.descricao AS linha_descricao
      FROM produtos p
      LEFT JOIN tabelas_preco t ON t.id = p.tabela_preco_id
      LEFT JOIN linhas_comerciais lc ON lc.id = p.linha_comercial_id
      ${where}
      ORDER BY p.nome ASC
      LIMIT ?
      `,
      params
    );

    const itens = [];
    for (const row of rows) {
      const diag = await ComercialPrecoResolver.diagnosticar({
        produto: row,
        canal
      });
      // RA-6.5.1 — nomenclatura UI; usa label do Resolver (Preço de Segurança no fallback)
      itens.push({
        ...diag,
        codigo: row.codigo || null,
        tabela: diag.tabela || row.tabela_nome || null,
        linha: diag.linha || row.linha_descricao || row.linha_codigo || null,
        origem_label: diag.origem || 'Fallback (Preço de Segurança)'
      });
    }

    return {
      canal,
      total: itens.length,
      itens
    };
  }

  async diagnosticarProduto(produtoId, opts = {}) {
    const canal = opts.canal ? String(opts.canal).toUpperCase() : null;
    const produto = await dbGet(
      `
      SELECT
        p.id,
        p.nome,
        p.codigo,
        p.preco_venda,
        p.tabela_preco_id,
        p.linha_comercial_id,
        p.categoria_id,
        t.nome AS tabela_nome
      FROM produtos p
      LEFT JOIN tabelas_preco t ON t.id = p.tabela_preco_id
      WHERE p.id = ?
      `,
      [produtoId]
    );
    if (!produto) {
      const e = new Error('Produto não encontrado');
      e.statusCode = 404;
      throw e;
    }

    const itensVenda = Array.isArray(opts.itens) ? opts.itens : null;
    let canalResolvido = canal;
    let canalInfo = null;

    if (!canalResolvido && itensVenda) {
      canalInfo = await CanalVendaResolver.resolver({ itens: itensVenda });
      canalResolvido = canalInfo.canal;
    }

    const diag = await ComercialPrecoResolver.diagnosticar({
      produto,
      canal: canalResolvido || 'VAREJO',
      itens: itensVenda || undefined
    });

    return {
      ...diag,
      codigo: produto.codigo || null,
      tabela: diag.tabela || produto.tabela_nome || null,
      canal_info: canalInfo
    };
  }

  async consistenciaCategoriaLinha() {
    const CategoriaLinha = require('../categoria-linha/CategoriaLinhaComercialService');
    return CategoriaLinha.diagnosticarConsistencia();
  }

  async corrigirCategoriaLinha() {
    const CategoriaLinha = require('../categoria-linha/CategoriaLinhaComercialService');
    return CategoriaLinha.corrigirAutomaticamente();
  }
}

module.exports = new DiagnosticoComercialService();
