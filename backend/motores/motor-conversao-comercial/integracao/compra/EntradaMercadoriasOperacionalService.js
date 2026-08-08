/**
 * MCC-03 — Integração operacional Entrada de Mercadorias × MCC
 *
 * Única ponte autorizada: rotas de Compra → este serviço → CompraConversaoOrchestrator → MCC.
 * Nenhuma rota deve chamar Converter / CalcularConversaoFisica diretamente.
 *
 * Fluxo:
 *   Compra → Entrada → Orchestrator → (ConversaoFisicaLote) → quantidade base → Estoque
 */

const CompraConversaoOrchestrator = require('./CompraConversaoOrchestrator');
const ModoEntradaConversao = require('./ModoEntradaConversao');
const ConversaoFisicaLote = require('../../domain/ConversaoFisicaLote');
const ConversaoFisicaLoteRepository = require('../../repositories/ConversaoFisicaLoteRepository');
const { MOTOR_NOME } = require('../../domain/enums');
const UcRepository = require('../../../unidades-comercializacao/repositories/ProdutoUnidadeComercialRepository');
const ConversaoRepository = require('../../../muc/repositories/ProdutoConversaoRepository');

function moeda(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

function custoUnitario(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 10000) / 10000;
}

function flagOn(v) {
  return v === true || v === 1 || v === '1';
}

function addYearsIso(dateStr, years) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

class EntradaMercadoriasOperacionalService {
  constructor(deps = {}) {
    this.orchestrator = deps.orchestrator || new CompraConversaoOrchestrator({
      mcc: deps.mcc,
      repository: deps.repository || ConversaoFisicaLoteRepository
    });
    this.repository = deps.repository || ConversaoFisicaLoteRepository;
    this.ucRepo = deps.ucRepo || UcRepository;
    this.conversaoRepo = deps.conversaoRepo || ConversaoRepository;
    this.criarLote = deps.criarLote || null;
    this.gravarAuditoria = deps.gravarAuditoria || null;
  }

  /**
   * Carrega produto + UCs + conversões do produto para o orchestrator.
   */
  async carregarProdutoEntrada(db, produtoId) {
    const produto = await new Promise((resolve, reject) => {
      db.get(
        `
          SELECT id, nome, unidade, codigo, codigo_barras,
                 COALESCE(utiliza_conversao_fisica, 0) AS utiliza_conversao_fisica,
                 unidade_conversao_fisica,
                 COALESCE(controlar_validade, 0) AS controlar_validade,
                 COALESCE(produto_fracionado, 0) AS produto_fracionado,
                 COALESCE(vendido_por_peso, 0) AS vendido_por_peso,
                 preco_compra, preco_venda
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
   * Compatibilidade: produto legado fracionado sem UC → UC sintética a partir da embalagem.
   */
  _aplicarCompatibilidadeLegado(produto, item) {
    if (Array.isArray(produto.unidades_comercializacao) && produto.unidades_comercializacao.length) {
      return produto;
    }

    const qtdPorEmb = Number(item.quantidade_por_embalagem || 0);
    const qtdEmb = Number(item.quantidade_embalagens || 0);
    const legadoFracionado = flagOn(item.produto_fracionado)
      || flagOn(item.vendido_por_peso)
      || flagOn(produto.produto_fracionado)
      || flagOn(produto.vendido_por_peso);

    if (legadoFracionado && qtdPorEmb > 0 && qtdEmb > 0) {
      return {
        ...produto,
        unidades_comercializacao: [
          {
            unidade_comercial: 'EMB',
            descricao: item.compra_em || 'Embalagem',
            tipo: 'AGRUPAMENTO',
            quantidade: qtdPorEmb,
            unidade_base: produto.unidade || 'UN',
            permite_compra: 1,
            canais_comercializacao: ['compra']
          }
        ]
      };
    }

    return produto;
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
    const qtdEmb = Number(item.quantidade_embalagens || 0);
    const qtdPorEmb = Number(item.quantidade_por_embalagem || 0);

    if (temUc && unidadeInformada) {
      return {
        quantidade: Number(item.quantidade_comercial ?? item.quantidade ?? qtdEmb ?? 0),
        unidadeOrigem: unidadeInformada
      };
    }

    if (temUc && qtdEmb > 0 && qtdPorEmb > 0 && produto.unidades_comercializacao.some((u) => {
      const c = String(u.unidade_comercial || '').toUpperCase();
      return c === 'EMB';
    })) {
      return { quantidade: qtdEmb, unidadeOrigem: 'EMB' };
    }

    if (!temUc || !unidadeInformada) {
      // Produto comum / base
      if (qtdEmb > 0 && qtdPorEmb > 0 && !flagOn(produto.utiliza_conversao_fisica)) {
        // Legado fracionado sem UC já convertido no frontend? Preferir quantidade base explícita
        const qtdBase = Number(item.peso_total_compra || item.quantidade || 0);
        if (qtdBase > 0 && Math.abs(qtdBase - qtdEmb) > 0.001) {
          return { quantidade: qtdBase, unidadeOrigem: unidadeBase };
        }
      }
      return {
        quantidade: Number(item.quantidade || 0),
        unidadeOrigem: String(item.unidade || unidadeBase).toUpperCase() || unidadeBase
      };
    }

    return {
      quantidade: Number(item.quantidade || 0),
      unidadeOrigem: unidadeInformada || unidadeBase
    };
  }

  _montarEntradaOrchestrator({ produto, item, compra, lote }) {
    const { quantidade, unidadeOrigem } = this._resolverQuantidadeUnidade(item, produto);
    const modoRaw = item.modo_entrada_conversao || item.modo || item.modoEntrada;
    const pesoEmbalagem = item.peso_embalagem ?? item.pesoEmbalagem ?? item.peso;
    const pesoTotal = item.peso_total ?? item.pesoTotal;
    const volumeTotal = item.volume_total ?? item.volumeTotal ?? item.volume;

    return {
      produto,
      quantidade,
      unidadeOrigem,
      modo: modoRaw,
      pesoEmbalagem,
      pesoTotal,
      volumeTotal,
      compra,
      lote,
      operacaoId: compra?.id != null ? `compra-${compra.id}` : null
    };
  }

  _distribuirFiscal(item, quantidadeBase) {
    const fiscalIn = Number(item.quantidade_fiscal);
    const naoFiscalIn = Number(item.quantidade_nao_fiscal);
    const temSplit = Number.isFinite(fiscalIn) || Number.isFinite(naoFiscalIn);
    const fiscal = Number.isFinite(fiscalIn) ? fiscalIn : 0;
    const naoFiscal = Number.isFinite(naoFiscalIn) ? naoFiscalIn : 0;
    const soma = fiscal + naoFiscal;

    if (!temSplit || soma <= 0) {
      if (Number(item.item_fiscal) === 0) {
        return {
          quantidade_fiscal: 0,
          quantidade_nao_fiscal: quantidadeBase,
          quantidade: quantidadeBase,
          quantidade_convertida: quantidadeBase
        };
      }
      return {
        quantidade_fiscal: quantidadeBase,
        quantidade_nao_fiscal: 0,
        quantidade: quantidadeBase,
        quantidade_convertida: quantidadeBase
      };
    }

    if (Math.abs(soma - quantidadeBase) <= 0.001) {
      return {
        quantidade_fiscal: fiscal,
        quantidade_nao_fiscal: naoFiscal,
        quantidade: quantidadeBase,
        quantidade_convertida: quantidadeBase
      };
    }

    // Split informado em unidade comercial / embalagens → rateia proporcionalmente
    const fator = quantidadeBase / soma;
    const qFiscal = Math.round(fiscal * fator * 1000) / 1000;
    const qNao = Math.round((quantidadeBase - qFiscal) * 1000) / 1000;
    return {
      quantidade_fiscal: qFiscal,
      quantidade_nao_fiscal: qNao,
      quantidade: quantidadeBase,
      quantidade_convertida: quantidadeBase
    };
  }

  _resolverPrecos(item, quantidadeBase) {
    const margem = Number(item.margem_lucro ?? 30);
    const atualizarVenda = Number(item.atualizar_preco_venda ?? 1) === 1;
    const valorTotal = Number(
      item.valor_total_embalagem
      ?? item.subtotal
      ?? (Number(item.preco_unitario || 0) * Number(item.quantidade || quantidadeBase || 0))
      ?? 0
    );
    const custoRateado = Number(item.custo_unitario_final || 0);

    let precoCompra;
    if (custoRateado > 0) {
      precoCompra = custoUnitario(custoRateado);
    } else if (valorTotal > 0 && quantidadeBase > 0) {
      precoCompra = custoUnitario(valorTotal / quantidadeBase);
    } else {
      precoCompra = custoUnitario(item.preco_unitario || item.custo_por_kg || 0);
    }

    const precoVenda = atualizarVenda && precoCompra > 0
      ? moeda(precoCompra * (1 + margem / 100))
      : null;

    return {
      precoCompra,
      lucroPercentual: margem,
      precoVenda,
      atualizarVenda,
      subtotal: moeda(valorTotal > 0 ? valorTotal : precoCompra * quantidadeBase)
    };
  }

  _precisaLote(produto, item, conversaoFisicaLote) {
    return flagOn(produto.utiliza_conversao_fisica)
      || flagOn(produto.controlar_validade)
      || !!conversaoFisicaLote;
  }

  async _criarLoteProduto(db, {
    produtoId,
    quantidadeBase,
    item,
    compraId,
    produto,
    loteOrigem
  }) {
    if (typeof this.criarLote !== 'function') {
      const err = new Error('Serviço de lotes não configurado para Entrada operacional MCC.');
      err.status = 500;
      throw err;
    }

    const hoje = new Date().toISOString().slice(0, 10);
    let dataValidade = item.data_validade || null;

    if (flagOn(produto.controlar_validade) && !dataValidade) {
      const err = new Error(
        `Produto "${produto.nome || produtoId}" controla validade. Informe a data de validade.`
      );
      err.status = 400;
      throw err;
    }

    if (!dataValidade && flagOn(produto.utiliza_conversao_fisica)) {
      dataValidade = addYearsIso(hoje, 1);
    }

    if (!dataValidade) {
      dataValidade = addYearsIso(hoje, 1);
    }

    return new Promise((resolve, reject) => {
      this.criarLote({
        produto_id: produtoId,
        quantidade_inicial: quantidadeBase,
        data_validade: dataValidade,
        data_entrada: hoje,
        data_fabricacao: item.data_fabricacao || null,
        lote: item.lote_codigo || item.lote || null,
        origem: loteOrigem || 'COMPRA',
        compra_id: compraId
      }, (err, lote) => (err ? reject(err) : resolve(lote)));
    });
  }

  /**
   * Processa um item de entrada: converte via Orchestrator, cria lote/física, devolve qtd base.
   * O caller (compras) é responsável por gravar compras_itens e movimentar estoque.
   */
  async processarItemOperacional(db, {
    compraId,
    fornecedor = null,
    fornecedorId = null,
    fornecedorNome = null,
    item = {},
    produtoId,
    loteOrigem = 'COMPRA',
    usuarioId = null
  } = {}) {
    if (!produtoId) {
      const err = new Error('produtoId obrigatório na entrada operacional MCC.');
      err.status = 400;
      throw err;
    }

    let produto = await this.carregarProdutoEntrada(db, produtoId);
    produto = this._aplicarCompatibilidadeLegado(produto, item);

    const compra = {
      id: compraId,
      fornecedorId: fornecedorId || null,
      fornecedorNome: fornecedorNome || fornecedor || null
    };

    const entradaOrch = this._montarEntradaOrchestrator({
      produto,
      item,
      compra,
      lote: {
        codigo: item.lote_codigo || item.lote || null,
        dataValidade: item.data_validade || null
      }
    });

    if (!(Number(entradaOrch.quantidade) > 0)) {
      const err = new Error(
        `Quantidade inválida para o produto "${produto.nome || produtoId}".`
      );
      err.status = 400;
      throw err;
    }

    const resultadoOrch = this.orchestrator.processarItem(entradaOrch);
    const quantidadeBase = Number(resultadoOrch.quantidadeConvertida);
    if (!(quantidadeBase > 0)) {
      const err = new Error(
        `Conversão MCC resultou em quantidade base inválida para "${produto.nome || produtoId}".`
      );
      err.status = 400;
      throw err;
    }

    const qtds = this._distribuirFiscal(item, quantidadeBase);
    const precos = this._resolverPrecos(item, quantidadeBase);

    let lotePersistido = null;
    let conversaoPersistida = null;

    const precisaLote = this._precisaLote(
      produto,
      item,
      resultadoOrch.conversaoFisicaLote
    );

    if (precisaLote) {
      lotePersistido = await this._criarLoteProduto(db, {
        produtoId,
        quantidadeBase,
        item,
        compraId,
        produto,
        loteOrigem
      });

      if (resultadoOrch.conversaoFisicaLote) {
        const entidade = ConversaoFisicaLote.fromRow({
          ...resultadoOrch.conversaoFisicaLote,
          lote_id: lotePersistido.id,
          lote_codigo: lotePersistido.lote || resultadoOrch.conversaoFisicaLote.lote_codigo,
          produto_id: produtoId,
          versao: 1,
          ativa: 1
        });
        conversaoPersistida = await this.repository.inserir(db, entidade);
      }
    }

    const auditoria = {
      ...(resultadoOrch.auditoria || {}),
      produtoId,
      produtoNome: produto.nome || null,
      compraId,
      fornecedorId: compra.fornecedorId,
      fornecedorNome: compra.fornecedorNome,
      loteId: lotePersistido?.id ?? resultadoOrch.lote?.id ?? null,
      loteCodigo: lotePersistido?.lote ?? resultadoOrch.lote?.codigo ?? null,
      quantidadeInformada: resultadoOrch.quantidadeInformada,
      unidadeOrigem: resultadoOrch.unidadeOrigem,
      pesoInformado: resultadoOrch.auditoria?.pesoInformado ?? null,
      fatorCalculado: resultadoOrch.auditoria?.fatorCalculado
        ?? conversaoPersistida?.fator
        ?? resultadoOrch.fatorAplicado
        ?? null,
      quantidadeConvertida: quantidadeBase,
      unidadeBase: resultadoOrch.unidadeBase,
      motor: MOTOR_NOME,
      modo: resultadoOrch.modo,
      persistido: !!conversaoPersistida,
      estoqueBasePendente: false,
      timestamp: new Date().toISOString()
    };

    if (typeof this.gravarAuditoria === 'function') {
      try {
        await this.gravarAuditoria({
          usuario_id: usuarioId,
          modulo: 'compras',
          acao: 'MCC_ENTRADA_CONVERSAO',
          referencia_tipo: 'compra',
          referencia_id: compraId,
          detalhes: auditoria
        });
      } catch (_) {
        /* auditoria não bloqueia entrada */
      }
    }

    return {
      ok: true,
      motor: MOTOR_NOME,
      produto,
      modo: resultadoOrch.modo,
      quantidadeInformada: resultadoOrch.quantidadeInformada,
      unidadeOrigem: resultadoOrch.unidadeOrigem,
      quantidadeConvertida: quantidadeBase,
      unidadeBase: resultadoOrch.unidadeBase,
      fatorAplicado: resultadoOrch.fatorAplicado,
      tipoConversao: resultadoOrch.tipoConversao,
      qtdsEstoque: qtds,
      precos,
      lote: lotePersistido
        ? {
          id: lotePersistido.id,
          codigo: lotePersistido.lote,
          draft: false,
          persistido: true
        }
        : null,
      conversaoFisicaLote: conversaoPersistida
        ? (conversaoPersistida.toJSON ? conversaoPersistida.toJSON() : conversaoPersistida)
        : null,
      auditoria,
      estoqueBasePendente: false,
      resultadoMcc: resultadoOrch.resultadoMcc,
      ModoEntradaConversao
    };
  }
}

module.exports = EntradaMercadoriasOperacionalService;
module.exports.EntradaMercadoriasOperacionalService = EntradaMercadoriasOperacionalService;
module.exports.moeda = moeda;
module.exports.custoUnitario = custoUnitario;
