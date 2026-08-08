/**
 * PDV-01 — PdvVendaOperacionalService
 *
 * Ponte autorizada: rotas de Venda/PDV → este serviço → PdvConversaoOrchestrator → MCC
 * → quantidadeBase → MotorEstoque.sair (chamado pelo VendaPagamentoService).
 *
 * O PDV NÃO calcula fator nem quantidade base.
 */

const PdvConversaoOrchestrator = require('./PdvConversaoOrchestrator');
const ConversaoFisicaLoteRepository = require('../../repositories/ConversaoFisicaLoteRepository');
const { MOTOR_NOME } = require('../../domain/enums');
const UcRepository = require('../../../unidades-comercializacao/repositories/ProdutoUnidadeComercialRepository');
const ConversaoRepository = require('../../../muc/repositories/ProdutoConversaoRepository');
const ComercialPrecoResolver = require('../../../../modules/comercial/preco/ComercialPrecoResolver');

function flagOn(v) {
  return v === true || v === 1 || v === '1';
}

class PdvVendaOperacionalService {
  constructor(deps = {}) {
    this.orchestrator = deps.orchestrator || new PdvConversaoOrchestrator({
      mcc: deps.mcc,
      repository: deps.repository || ConversaoFisicaLoteRepository
    });
    this.repository = deps.repository || ConversaoFisicaLoteRepository;
    this.ucRepo = deps.ucRepo || UcRepository;
    this.conversaoRepo = deps.conversaoRepo || ConversaoRepository;
    this.gravarAuditoria = deps.gravarAuditoria || null;
  }

  async carregarProdutoPdv(db, produtoId) {
    const produto = await new Promise((resolve, reject) => {
      db.get(
        `
          SELECT id, nome, unidade, codigo, codigo_barras,
                 COALESCE(utiliza_conversao_fisica, 0) AS utiliza_conversao_fisica,
                 unidade_conversao_fisica,
                 COALESCE(controlar_validade, 0) AS controlar_validade,
                 COALESCE(produto_fracionado, 0) AS produto_fracionado,
                 COALESCE(vendido_por_peso, 0) AS vendido_por_peso,
                 COALESCE(peso_medio_unidade, 0) AS peso_medio_unidade,
                 forma_comercializacao, unidade_venda,
                 quantidade_bolas, peso_medio_bola,
                 forma_personalizada_nome, forma_personalizada_unidade,
                 tabela_preco_id,
                 preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal
          FROM produtos
          WHERE id = ?
        `,
        [produtoId],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });

    if (!produto) {
      const err = new Error(`Produto ${produtoId} não encontrado.`);
      err.status = 404;
      throw err;
    }

    const preco = await ComercialPrecoResolver.resolver({ produto });
    produto.preco_venda = preco.preco_venda;
    produto.preco_origem = preco.origem;

    let unidades = [];
    try {
      unidades = await this.ucRepo.listarAtivasPorProduto(db, produtoId);
    } catch (_) {
      unidades = [];
    }

    let conversoes = [];
    try {
      conversoes = await this.conversaoRepo.listarAtivasPorProduto(db, produtoId);
    } catch (_) {
      conversoes = [];
    }

    return {
      ...produto,
      unidade_base: produto.unidade,
      unidades_comercializacao: unidades,
      conversoes
    };
  }

  /**
   * Filtra UCs válidas para o canal PDV (UI).
   */
  filtrarUnidadesPdv(produto) {
    const lista = produto.unidades_comercializacao || [];
    if (!lista.length) {
      const base = String(produto.unidade_base || produto.unidade || 'UN').toUpperCase();
      return [{
        unidade_comercial: base,
        descricao: base,
        tipo: 'PADRAO',
        quantidade: 1,
        unidade_base: base,
        permite_pdv: 1,
        canais_comercializacao: ['pdv']
      }];
    }
    return lista.filter((u) => {
      if (u.permite_pdv === 0 || u.permite_pdv === false) return false;
      let canais = u.canais_comercializacao;
      if (typeof canais === 'string') {
        try { canais = JSON.parse(canais); } catch (_) { canais = []; }
      }
      if (Array.isArray(canais) && canais.length
        && !canais.map((c) => String(c).toLowerCase()).includes('pdv')) {
        return false;
      }
      return true;
    });
  }

  _resolverQuantidadeUnidade(item, produto) {
    const unidadeBase = String(produto.unidade_base || produto.unidade || 'UN').toUpperCase();
    const unidadeInformada = String(
      item.unidade_comercial
      || item.unidade_origem
      || item.unidadeOrigem
      || ''
    ).trim().toUpperCase();

    const temUc = Array.isArray(produto.unidades_comercializacao)
      && produto.unidades_comercializacao.length > 0;

    // Quantidade comercial informada pelo operador (nunca fator)
    const qtdComercial = Number(
      item.quantidade_comercial != null
        ? item.quantidade_comercial
        : item.quantidade
    );

    if (temUc && unidadeInformada) {
      return { quantidade: qtdComercial, unidadeOrigem: unidadeInformada };
    }

    // Legado: venda por unidade com peso médio → trata como base se não há UC
    if (!temUc && flagOn(produto.produto_fracionado) && Number(produto.peso_medio_unidade) > 0
      && String(item.tipo_venda || '').toUpperCase() === 'UNIDADE') {
      // Compatibilidade: quantidade em UNIDADES físicas, estoque em KG/L via peso médio
      // Sem UC oficial — conversão identidade na base com quantidade já em base se veio quantidade_estoque
      if (item.quantidade_estoque != null && Number(item.quantidade_estoque) > 0) {
        return { quantidade: Number(item.quantidade_estoque), unidadeOrigem: unidadeBase };
      }
    }

    return {
      quantidade: qtdComercial,
      unidadeOrigem: unidadeInformada || unidadeBase
    };
  }

  /**
   * Converte item de venda: comercial → base via MCC.
   * @returns {Promise<object>} item enriquecido + auditoria
   */
  async processarItemVenda(db, { item, vendaId = null, usuarioId = null } = {}) {
    const produtoId = item.produto_id ?? item.produtoId;
    let produto = await this.carregarProdutoPdv(db, produtoId);
    produto = {
      ...produto,
      unidades_comercializacao: this.filtrarUnidadesPdv(produto)
    };

    const { quantidade, unidadeOrigem } = this._resolverQuantidadeUnidade(item, produto);

    const resultado = await this.orchestrator.processarItemAsync({
      produto,
      quantidade,
      unidadeOrigem,
      loteId: item.lote_id ?? item.loteId ?? null,
      db,
      operacaoId: vendaId != null ? `venda-${vendaId}` : `pdv-${produtoId}`
    });

    const quantidadeBase = Number(resultado.quantidadeConvertida);

    const auditoria = {
      ...resultado.auditoria,
      vendaId,
      usuarioId,
      unidadeComercialId: item.unidade_comercial_id || null,
      motor: MOTOR_NOME,
      sprint: 'PDV-01'
    };

    if (typeof this.gravarAuditoria === 'function') {
      try {
        await this.gravarAuditoria({
          usuario_id: usuarioId,
          modulo: 'pdv',
          acao: 'PDV_MCC_CONVERSAO',
          referencia_tipo: 'venda',
          referencia_id: vendaId,
          detalhes: auditoria
        });
      } catch (_) { /* auditoria não interrompe venda */ }
    }

    return {
      ...item,
      produto_id: produtoId,
      quantidade: Number(item.quantidade),
      quantidade_comercial: quantidade,
      unidade_comercial: unidadeOrigem,
      quantidade_estoque: quantidadeBase,
      quantidade_base: quantidadeBase,
      fator_conversao: Number(resultado.fatorAplicado || 1),
      mcc: {
        quantidadeConvertida: quantidadeBase,
        unidadeBase: resultado.unidadeBase,
        fatorAplicado: resultado.fatorAplicado,
        tipoConversao: resultado.tipoConversao,
        loteId: resultado.loteId,
        auditoria
      },
      auditoria
    };
  }
}

module.exports = PdvVendaOperacionalService;
