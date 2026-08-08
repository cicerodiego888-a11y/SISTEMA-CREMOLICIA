/**
 * RCM-8.0 — Células Tabela × Produto (quando o produto NÃO possui Linha).
 * Oficial no Resolver: sem Linha → Tabela → Produto → Unidade → Preço.
 */

const repo = require('./TabelaPrecoProdutoRepository');

function erro(mensagem, statusCode = 400) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  return err;
}

const FORMAS = new Set(['UNIDADE', 'PESO', 'VOLUME', 'CASQUINHA', 'KIT', 'PERSONALIZADA']);

/**
 * @returns {Array<{produto_id:number, canal_venda_id:number, preco:number, forma_comercializacao:string|null, unidade_comercial:string|null}>}
 */
function normalizarItens(itens) {
  if (itens == null) return null;
  if (!Array.isArray(itens)) throw erro('Informe itens [{ produto_id, canal_venda_id, preco }]');

  const vistos = new Set();
  const out = [];

  for (const item of itens) {
    const produtoId = Number(item?.produto_id);
    const canalId = Number(item?.canal_venda_id);
    if (!Number.isFinite(produtoId) || produtoId <= 0) {
      throw erro('Produto inválido nos itens da tabela');
    }
    if (!Number.isFinite(canalId) || canalId <= 0) {
      throw erro('Canal inválido nos itens da tabela');
    }

    const chave = `${produtoId}:${canalId}`;
    if (vistos.has(chave)) {
      throw erro('Não é permitido Produto × Canal duplicados');
    }
    vistos.add(chave);

    if (item.preco === '' || item.preco == null) continue;
    const preco = Number(item.preco);
    if (!Number.isFinite(preco)) throw erro('Preço inválido');
    if (preco < 0) throw erro('Não é permitido preço negativo');

    let forma = item.forma_comercializacao
      ? String(item.forma_comercializacao).trim().toUpperCase()
      : null;
    if (forma && !FORMAS.has(forma)) {
      throw erro(`Forma de comercialização inválida: ${forma}`);
    }
    let unidade = item.unidade_comercial
      ? String(item.unidade_comercial).trim().toUpperCase()
      : null;
    if (forma && (forma === 'PESO' || forma === 'VOLUME') && !unidade) {
      throw erro(`Unidade comercial é obrigatória para forma ${forma}`);
    }

    out.push({
      produto_id: produtoId,
      canal_venda_id: canalId,
      preco,
      forma_comercializacao: forma,
      unidade_comercial: unidade,
      ativo: item.ativo === false || item.ativo === 0 ? false : true
    });
  }

  return out;
}

class TabelaPrecoProdutoService {
  normalizarItens(itens) {
    return normalizarItens(itens);
  }

  async listarItens(tabelaId) {
    return repo.listarItens(tabelaId);
  }

  async salvarItens(tabelaId, itensBrutos) {
    const itens = normalizarItens(itensBrutos);
    if (!itens) return [];
    // RCM-8.0: não espelha em tabela_preco_valores nem grava tabela no produto
    await repo.substituirItens(tabelaId, itens);

    try {
      const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
      ComercialPrecoResolver.invalidateCache(tabelaId);
    } catch (_) { /* noop */ }

    return repo.listarItens(tabelaId);
  }

  async resolverPreco({ tabelaId, produtoId, canal }) {
    if (!tabelaId || !produtoId) return null;
    const row = await repo.buscarPrecoProdutoCanal(
      tabelaId,
      produtoId,
      String(canal || 'VAREJO').trim().toUpperCase()
    );
    if (!row || Number(row.tabela_ativa) === 0) return null;
    const preco = Number(row.preco);
    if (!Number.isFinite(preco) || preco < 0) return null;
    return {
      preco,
      tabela_nome: row.tabela_nome,
      canal_id: Number(row.canal_venda_id),
      forma_comercializacao: row.forma_comercializacao
        ? String(row.forma_comercializacao).toUpperCase()
        : null,
      unidade_comercial: row.unidade_comercial
        ? String(row.unidade_comercial).toUpperCase()
        : null,
      origem: 'tabela_produto'
    };
  }
}

module.exports = new TabelaPrecoProdutoService();
