/**
 * CategoriaLinhaComercialService
 *
 * A-1: espelhamento Categoria → Linha de Precificação DESATIVADO.
 * Métodos legados preservados para compatibilidade de API (leitura / casquinha).
 * Nunca cria Linha de Precificação a partir de Categoria.
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

function flagAtivo(v) {
  return !(v === 0 || v === false || v === '0');
}

/**
 * A-1: não cria/atualiza linha a partir da categoria.
 * Retorna vínculo legado se existir; caso contrário null.
 */
async function lerLinhaLegadaCategoria(categoriaId) {
  const cat = await get(`SELECT * FROM categorias WHERE id = ?`, [categoriaId]);
  if (!cat) return null;

  let linha = null;
  if (cat.linha_comercial_id) {
    linha = await get(`SELECT * FROM linhas_comerciais WHERE id = ?`, [cat.linha_comercial_id]);
  }
  if (!linha) {
    linha = await get(
      `SELECT * FROM linhas_comerciais WHERE categoria_origem_id = ?`,
      [cat.id]
    );
  }
  return { cat, linha };
}

class CategoriaLinhaComercialService {
  /**
   * @deprecated A-1 — não cria Política. Apenas lê vínculo legado.
   */
  async sincronizarCategoria(categoriaId) {
    const found = await lerLinhaLegadaCategoria(categoriaId);
    if (!found) {
      const err = new Error('Categoria não encontrada');
      err.statusCode = 404;
      throw err;
    }
    if (!found.linha) return null;
    return {
      id: found.linha.id,
      codigo: found.linha.codigo,
      descricao: found.linha.descricao,
      ativo: flagAtivo(found.linha.ativo),
      categoria_origem_id: found.linha.categoria_origem_id || found.cat.id
    };
  }

  async desativarPorCategoria(categoriaId) {
    const cat = await get(`SELECT * FROM categorias WHERE id = ?`, [categoriaId]);
    if (!cat) return null;

    await run(
      `UPDATE categorias SET ativo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [categoriaId]
    );
    await run(
      `UPDATE subcategorias SET ativo = 0, updated_at = CURRENT_TIMESTAMP WHERE categoria_id = ?`,
      [categoriaId]
    );
    await run(
      `UPDATE produtos SET ativo = 0 WHERE categoria_id = ?`,
      [categoriaId]
    );
    // A-1: não desativa Política Comercial vinculada historicamente
    return this.sincronizarCategoria(categoriaId);
  }

  async ativarPorCategoria(categoriaId) {
    const cat = await get(`SELECT * FROM categorias WHERE id = ?`, [categoriaId]);
    if (!cat) return null;

    await run(
      `UPDATE categorias SET ativo = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [categoriaId]
    );
    await run(
      `UPDATE subcategorias SET ativo = 1, updated_at = CURRENT_TIMESTAMP WHERE categoria_id = ?`,
      [categoriaId]
    );
    await run(
      `UPDATE produtos SET ativo = 1 WHERE categoria_id = ?`,
      [categoriaId]
    );
    return this.sincronizarCategoria(categoriaId);
  }

  async obterComercialCategoria(categoriaId) {
    const found = await lerLinhaLegadaCategoria(categoriaId);
    if (!found) return null;
    const { cat, linha } = found;

    let valores = [];
    if (linha) {
      const LinhasRepo = require('../linhas-comerciais/LinhasComerciaisRepository');
      valores = await LinhasRepo.montarGradeValores(linha.id);
    }

    const Builder = require('../casquinha/CasquinhaBuilderService');
    const casquinha = {
      bolas_min: Number(cat.casquinha_bolas_min != null ? cat.casquinha_bolas_min : 1),
      bolas_max: Number(cat.casquinha_bolas_max != null ? cat.casquinha_bolas_max : 4),
      permitir_repetir: Builder.flagPermitirRepetir(
        cat.casquinha_permitir_repetir != null ? cat.casquinha_permitir_repetir : 1
      ),
      opcoes_bolas: Builder.opcoesBolas({
        bolas_min: cat.casquinha_bolas_min,
        bolas_max: cat.casquinha_bolas_max
      })
    };

    return {
      categoria: {
        id: cat.id,
        nome: cat.nome,
        codigo: cat.codigo || null,
        tipo: cat.tipo,
        ativo: flagAtivo(cat.ativo),
        linha_comercial_id: linha?.id || cat.linha_comercial_id || null,
        politica_sugerida_id: linha?.id || cat.linha_comercial_id || null,
        casquinha_bolas_min: casquinha.bolas_min,
        casquinha_bolas_max: casquinha.bolas_max,
        casquinha_permitir_repetir: casquinha.permitir_repetir ? 1 : 0
      },
      linha: linha
        ? {
            id: linha.id,
            codigo: linha.codigo,
            descricao: linha.descricao,
            ativo: flagAtivo(linha.ativo),
            categoria_origem_id: linha.categoria_origem_id
          }
        : null,
      valores,
      casquinha,
      a1_espelhamento: false
    };
  }

  async salvarConfigCasquinha(categoriaId, cfg = {}) {
    const Builder = require('../casquinha/CasquinhaBuilderService');
    const limites = Builder.resolverLimites({
      bolas_min: cfg.casquinha_bolas_min ?? cfg.bolas_min,
      bolas_max: cfg.casquinha_bolas_max ?? cfg.bolas_max
    });
    const permitir = Builder.flagPermitirRepetir(
      cfg.casquinha_permitir_repetir ?? cfg.permitir_repetir ?? 1
    );
    await run(
      `UPDATE categorias
       SET casquinha_bolas_min = ?,
           casquinha_bolas_max = ?,
           casquinha_permitir_repetir = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [limites.bolas_min, limites.bolas_max, permitir ? 1 : 0, categoriaId]
    );
    return this.obterComercialCategoria(categoriaId);
  }

  /**
   * @deprecated A-1 — valores comerciais ficam em Tabelas de Preços / Linhas.
   * Mantém escrita apenas se já existir vínculo legado (não cria).
   */
  async salvarValoresComerciais(categoriaId, valores = []) {
    const found = await lerLinhaLegadaCategoria(categoriaId);
    if (!found?.linha) {
      const err = new Error(
        'Categoria não possui Linha de Precificação legada. Cadastre em Linhas de Precificação / Tabelas de Preços.'
      );
      err.statusCode = 400;
      throw err;
    }
    const LinhasRepo = require('../linhas-comerciais/LinhasComerciaisRepository');
    await LinhasRepo.salvarCompleto({
      id: found.linha.id,
      codigo: found.linha.codigo,
      descricao: found.linha.descricao,
      ativo: found.linha.ativo,
      valores: valores || []
    });
    try {
      const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
      ComercialPrecoResolver.invalidateCacheLinha(found.linha.id);
    } catch (_) { /* noop */ }
    return this.obterComercialCategoria(categoriaId);
  }

  /**
   * A-1: resolve apenas FK legado do produto / categoria. Nunca cria Política.
   */
  async resolverLinhaDoProduto(produto = {}) {
    let linhaId = Number(produto.linha_comercial_id || 0);
    if (linhaId > 0) return linhaId;

    try {
      const ProdutoPoliticas = require('../politicas/ProdutoPoliticasComerciaisService');
      const resolvida = await ProdutoPoliticas.resolverPoliticaParaPreco(produto, {});
      if (resolvida) return resolvida;
    } catch (_) { /* noop */ }

    const categoriaId = Number(produto.categoria_id || 0);
    if (!categoriaId) return null;

    const cat = await get(
      `SELECT id, linha_comercial_id FROM categorias WHERE id = ?`,
      [categoriaId]
    );
    if (!cat?.linha_comercial_id) return null;
    return Number(cat.linha_comercial_id);
  }

  /**
   * Diagnóstico A-1: categoria sem política NÃO é inconsistência.
   * Foco em vínculos legados quebrados e duplicidades históricas.
   */
  async diagnosticarConsistencia() {
    const quebrados = await all(`
      SELECT c.id AS categoria_id, c.nome, c.linha_comercial_id,
             l.categoria_origem_id
      FROM categorias c
      INNER JOIN linhas_comerciais l ON l.id = c.linha_comercial_id
      WHERE l.categoria_origem_id IS NOT NULL
        AND l.categoria_origem_id != c.id
    `);

    const duplicidades = await all(`
      SELECT categoria_origem_id, COUNT(*) AS total
      FROM linhas_comerciais
      WHERE categoria_origem_id IS NOT NULL
      GROUP BY categoria_origem_id
      HAVING COUNT(*) > 1
    `);

    const produtosSemCategoria = await all(`
      SELECT id, nome, codigo FROM produtos
      WHERE categoria_id IS NULL OR categoria_id = 0
      LIMIT 200
    `);

    // Informativo (não conta como erro): produtos sem política explícita (= todas)
    const produtosSemPoliticaExplicita = await all(`
      SELECT p.id, p.nome, p.codigo, p.categoria_id
      FROM produtos p
      LEFT JOIN produto_politicas_comerciais ppc ON ppc.produto_id = p.id
      WHERE ppc.id IS NULL
        AND (p.linha_comercial_id IS NULL OR p.linha_comercial_id = 0)
      LIMIT 200
    `).catch(() => []);

    const total = quebrados.length + duplicidades.length;

    return {
      ok: total === 0,
      total_inconsistencias: total,
      categorias_sem_linha: [],
      linhas_sem_categoria: [],
      relacionamentos_quebrados: quebrados,
      duplicidades,
      produtos_sem_categoria: produtosSemCategoria,
      produtos_sem_linha: [],
      produtos_sem_politica_explicita: produtosSemPoliticaExplicita,
      a1_nota:
        'Categoria sem Política não é erro. Produto sem política explícita = todas habilitadas.'
    };
  }

  /**
   * A-1: não recria políticas a partir de categorias.
   */
  async corrigirAutomaticamente() {
    const antes = await this.diagnosticarConsistencia();
    const depois = await this.diagnosticarConsistencia();
    return {
      sincronizados: 0,
      antes,
      depois,
      corrigido: !!depois.ok,
      a1_nota: 'Espelhamento Categoria→Política desativado. Correção automática não cria políticas.'
    };
  }

  async ultimoRelatorioMigracao() {
    return get(
      `SELECT * FROM categoria_linha_migracao_log ORDER BY id DESC LIMIT 1`
    );
  }

  /**
   * Sugestão opcional de política no cadastro (nunca obriga).
   */
  async sugerirPoliticaPorCategoria(categoriaId) {
    const found = await lerLinhaLegadaCategoria(categoriaId);
    if (!found?.linha) return null;
    return {
      id: found.linha.id,
      codigo: found.linha.codigo,
      descricao: found.linha.descricao,
      origem: 'legado_categoria'
    };
  }
}

module.exports = new CategoriaLinhaComercialService();
