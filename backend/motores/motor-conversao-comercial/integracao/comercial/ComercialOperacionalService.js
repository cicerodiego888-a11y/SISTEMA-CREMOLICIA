/**
 * COM-01 — ComercialOperacionalService
 *
 * Ponte: Motor Comercial → Orchestrator → MCC → quantidadeBase → MotorEstoque
 */

const ComercialConversaoOrchestrator = require('./ComercialConversaoOrchestrator');
const ConversaoFisicaLoteRepository = require('../../repositories/ConversaoFisicaLoteRepository');
const { MOTOR_NOME } = require('../../domain/enums');
const UcRepository = require('../../../unidades-comercializacao/repositories/ProdutoUnidadeComercialRepository');
const ConversaoRepository = require('../../../muc/repositories/ProdutoConversaoRepository');
const MotorEstoque = require('../../../motor-estoque');
const lotesService = require('../../../../services/lotesService');
const { promisify } = require('util');

const produtoControlaValidadeAsync = promisify(lotesService.produtoControlaValidade.bind(lotesService));
const consumirLotesFEFOAsync = promisify(lotesService.consumirLotesFEFO.bind(lotesService));

class ComercialOperacionalService {
  constructor(deps = {}) {
    this.orchestrator = deps.orchestrator || new ComercialConversaoOrchestrator({
      mcc: deps.mcc,
      repository: deps.repository || ConversaoFisicaLoteRepository
    });
    this.repository = deps.repository || ConversaoFisicaLoteRepository;
    this.ucRepo = deps.ucRepo || UcRepository;
    this.conversaoRepo = deps.conversaoRepo || ConversaoRepository;
    this.motorEstoque = deps.motorEstoque || MotorEstoque;
  }

  async carregarProduto(db, produtoId) {
    const produto = await new Promise((resolve, reject) => {
      db.get(
        `
          SELECT id, nome, unidade,
                 COALESCE(utiliza_conversao_fisica, 0) AS utiliza_conversao_fisica,
                 unidade_conversao_fisica,
                 COALESCE(item_fiscal, 1) AS item_fiscal,
                 COALESCE(controlar_validade, 0) AS controlar_validade
          FROM produtos WHERE id = ?
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
   * Converte quantidade comercial → base (sem movimentar estoque).
   */
  async converterQuantidade(db, {
    produtoId,
    quantidade,
    unidadeOrigem = null,
    loteId = null,
    consignacaoId = null,
    operacao = null,
    usuarioId = null
  } = {}) {
    const produto = await this.carregarProduto(db, produtoId);
    const resultado = await this.orchestrator.processarItemAsync({
      produto,
      quantidade: Number(quantidade),
      unidadeOrigem: unidadeOrigem || produto.unidade_base || produto.unidade,
      loteId,
      consignacaoId,
      operacao,
      db,
      operacaoId: consignacaoId != null ? `consignacao-${consignacaoId}-${operacao || 'op'}` : null
    });

    return {
      ...resultado,
      produto,
      auditoria: {
        ...resultado.auditoria,
        usuarioId,
        sprint: 'COM-01',
        motor: MOTOR_NOME
      }
    };
  }

  /**
   * Entrega: MCC → base → MotorEstoque.sair (+ FEFO se validade).
   */
  async baixarEstoqueEntrega(db, dados = {}) {
    const convertido = await this.converterQuantidade(db, {
      ...dados,
      operacao: 'ENTREGA'
    });
    const qtdBase = Number(convertido.quantidadeConvertida);
    const produto = convertido.produto;
    const fiscal = Number(produto.item_fiscal) !== 0;

    let loteId = dados.loteId ?? convertido.loteId ?? null;
    const controla = await produtoControlaValidadeAsync(dados.produtoId);
    if (controla) {
      const consumo = await consumirLotesFEFOAsync(dados.produtoId, qtdBase);
      const primeiro = Array.isArray(consumo) ? consumo[0] : null;
      loteId = primeiro?.lote_id ?? primeiro?.loteId ?? primeiro?.id ?? loteId;
    }

    const mov = await this.motorEstoque.sair(db, {
      produtoId: dados.produtoId,
      quantidadeBase: qtdBase,
      quantidadeFiscal: fiscal ? qtdBase : 0,
      quantidadeNaoFiscal: fiscal ? 0 : qtdBase,
      origem: this.motorEstoque.OrigemEstoque.CONSIGNACAO,
      loteId,
      referenciaTipo: 'consignacao',
      referenciaId: dados.consignacaoId ?? null,
      usuarioId: dados.usuarioId ?? null,
      motivo: `COM_ENTREGA:${dados.consignacaoId || ''}`
    });

    return {
      ...mov,
      mcc: convertido.auditoria,
      quantidadeBase: qtdBase,
      quantidadeComercial: Number(dados.quantidade),
      unidadeOrigem: convertido.unidadeOrigem
    };
  }

  /**
   * Devolução: MCC → base → MotorEstoque.entrar
   */
  async entrarEstoqueDevolucao(db, dados = {}) {
    const convertido = await this.converterQuantidade(db, {
      ...dados,
      operacao: 'DEVOLUCAO'
    });
    const qtdBase = Number(convertido.quantidadeConvertida);
    const produto = convertido.produto;
    const fiscal = Number(produto.item_fiscal) !== 0;

    const mov = await this.motorEstoque.entrar(db, {
      produtoId: dados.produtoId,
      quantidadeBase: qtdBase,
      quantidadeFiscal: fiscal ? qtdBase : 0,
      quantidadeNaoFiscal: fiscal ? 0 : qtdBase,
      origem: this.motorEstoque.OrigemEstoque.DEVOLUCAO,
      loteId: dados.loteId ?? convertido.loteId ?? null,
      referenciaTipo: 'consignacao',
      referenciaId: dados.consignacaoId ?? null,
      usuarioId: dados.usuarioId ?? null,
      motivo: `COM_DEVOLUCAO:${dados.consignacaoId || ''}`
    });

    return {
      ...mov,
      mcc: convertido.auditoria,
      quantidadeBase: qtdBase,
      quantidadeComercial: Number(dados.quantidade),
      unidadeOrigem: convertido.unidadeOrigem
    };
  }

  /**
   * Perda: MCC → base → MotorEstoque.ajustar (write-off documental).
   * Estoque físico já saiu na ENTREGA; o ajuste registra a natureza PERDA
   * com deltas zero no saldo (auditoria via motivo) — na prática usamos
   * ajustar com delta negativo apenas se `forcarAjusteFisico` (não padrão).
   *
   * Política oficial COM-01: estoque já baixado na entrega; MCC alimenta
   * quantidade base no ledger. Quando `forcarAjusteFisico`, aplica ajustar.
   */
  async registrarPerda(db, dados = {}) {
    const convertido = await this.converterQuantidade(db, {
      ...dados,
      operacao: 'PERDA'
    });
    const qtdBase = Number(convertido.quantidadeConvertida);

    let estoque = null;
    if (dados.forcarAjusteFisico) {
      const produto = convertido.produto;
      const fiscal = Number(produto.item_fiscal) !== 0;
      estoque = await this.motorEstoque.ajustar(db, {
        produtoId: dados.produtoId,
        deltaFiscal: fiscal ? -qtdBase : 0,
        deltaNaoFiscal: fiscal ? 0 : -qtdBase,
        origem: this.motorEstoque.OrigemEstoque.CONSIGNACAO,
        usuarioId: dados.usuarioId ?? null,
        motivo: `COM_PERDA:${dados.consignacaoId || ''}`
      });
    }

    return {
      ok: true,
      quantidadeBase: qtdBase,
      quantidadeComercial: Number(dados.quantidade),
      unidadeOrigem: convertido.unidadeOrigem,
      mcc: convertido.auditoria,
      estoque,
      politicaEstoque: dados.forcarAjusteFisico ? 'AJUSTE_FISICO' : 'JA_BAIXADO_ENTREGA'
    };
  }
}

module.exports = ComercialOperacionalService;
