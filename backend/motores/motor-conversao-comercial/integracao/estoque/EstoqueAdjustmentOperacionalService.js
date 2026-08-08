/**
 * EST-MCC-01 — EstoqueAdjustmentOperacionalService
 *
 * Ponte autorizada: rotas de Ajuste → este serviço → EstoqueAdjustmentOrchestrator → MCC
 * → quantidadeBase → aplicarAjusteEstoqueProduto → MotorEstoque.ajustar
 *
 * A UI NÃO calcula fator nem quantidade base.
 */

const EstoqueAdjustmentOrchestrator = require('./EstoqueAdjustmentOrchestrator');
const ConversaoFisicaLoteRepository = require('../../repositories/ConversaoFisicaLoteRepository');
const { MOTOR_NOME, ContextoConversao } = require('../../domain/enums');
const UcRepository = require('../../../unidades-comercializacao/repositories/ProdutoUnidadeComercialRepository');
const ConversaoRepository = require('../../../muc/repositories/ProdutoConversaoRepository');

function flagOn(v) {
  return v === true || v === 1 || v === '1';
}

function round3(n) {
  return Number(Number(n || 0).toFixed(3));
}

class EstoqueAdjustmentOperacionalService {
  constructor(deps = {}) {
    this.orchestrator = deps.orchestrator || new EstoqueAdjustmentOrchestrator({
      mcc: deps.mcc,
      repository: deps.repository || ConversaoFisicaLoteRepository
    });
    this.repository = deps.repository || ConversaoFisicaLoteRepository;
    this.ucRepo = deps.ucRepo || UcRepository;
    this.conversaoRepo = deps.conversaoRepo || ConversaoRepository;
  }

  async carregarProdutoAjuste(db, produtoId) {
    const produto = await new Promise((resolve, reject) => {
      db.get(
        `
          SELECT id, nome, unidade, codigo,
                 COALESCE(utiliza_conversao_fisica, 0) AS utiliza_conversao_fisica,
                 unidade_conversao_fisica,
                 COALESCE(controlar_validade, 0) AS controlar_validade,
                 COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
                 COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
                 COALESCE(estoque_atual, 0) AS estoque_atual
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
   * Unidades válidas para o combo de ajuste (sem hardcode).
   * Base + UCs ativas + unidade física (se flag).
   */
  listarUnidadesAjuste(produto) {
    const base = String(produto.unidade_base || produto.unidade || 'UN').trim().toUpperCase();
    const fisica = String(produto.unidade_conversao_fisica || 'KG').trim().toUpperCase();
    const exigeFisica = flagOn(produto.utiliza_conversao_fisica);
    const lista = produto.unidades_comercializacao || [];
    const seen = new Set();
    const out = [];

    const push = (item) => {
      const cod = String(item.unidade_comercial || '').trim().toUpperCase();
      if (!cod || seen.has(cod)) return;
      seen.add(cod);
      out.push(item);
    };

    push({
      unidade_comercial: base,
      descricao: `Unidade Base (${base})`,
      tipo: 'PADRAO',
      origem: 'base',
      unidade_base: base
    });

    for (const u of lista) {
      const cod = String(u.unidade_comercial || u.codigo || '').trim().toUpperCase();
      if (!cod) continue;
      push({
        unidade_comercial: cod,
        descricao: u.descricao || cod,
        tipo: u.tipo || 'AGRUPAMENTO',
        origem: 'uc',
        unidade_base: base,
        quantidade: u.quantidade
      });
    }

    if (exigeFisica && fisica && fisica !== base) {
      push({
        unidade_comercial: fisica,
        descricao: `Conversão Física (${fisica})`,
        tipo: 'CONVERSAO_FISICA',
        origem: 'fisica',
        unidade_base: base,
        exige_conversao_fisica_ativa: true
      });
    }

    // RCM-8.9 — unidades das conversões permanentes do produto
    for (const c of (produto.conversoes || [])) {
      if (!c || c.ativo === 0 || c.ativo === false) continue;
      const o = String(c.origem || '').trim().toUpperCase();
      const d = String(c.destino || '').trim().toUpperCase();
      if (o) {
        push({
          unidade_comercial: o,
          descricao: `Conversão (${o})`,
          tipo: 'FIXA',
          origem: 'produto_conversao',
          unidade_base: base
        });
      }
      if (d) {
        push({
          unidade_comercial: d,
          descricao: `Conversão (${d})`,
          tipo: 'FIXA',
          origem: 'produto_conversao',
          unidade_base: base
        });
      }
    }

    // Legado sem UC e sem física: só base
    if (!out.length) {
      push({
        unidade_comercial: base,
        descricao: base,
        tipo: 'PADRAO',
        origem: 'legado',
        unidade_base: base
      });
    }

    return out;
  }

  async obterUnidadesAjuste(db, produtoId) {
    const produto = await this.carregarProdutoAjuste(db, produtoId);
    const unidades = this.listarUnidadesAjuste(produto);
    let temConversaoFisicaAtiva = false;
    if (flagOn(produto.utiliza_conversao_fisica)) {
      try {
        const lista = await this.repository.listarPorProduto(db, produtoId);
        temConversaoFisicaAtiva = (lista || []).some((c) => c.ativa !== false && c.ativa !== 0);
      } catch (_) {
        temConversaoFisicaAtiva = false;
      }
    }

    return {
      produto_id: Number(produtoId),
      unidade_base: String(produto.unidade_base || produto.unidade || 'UN').toUpperCase(),
      utiliza_conversao_fisica: flagOn(produto.utiliza_conversao_fisica) ? 1 : 0,
      unidade_conversao_fisica: produto.unidade_conversao_fisica || null,
      tem_conversao_fisica_ativa: temConversaoFisicaAtiva,
      saldo_fiscal: Number(produto.saldo_fiscal || 0),
      saldo_nao_fiscal: Number(produto.saldo_nao_fiscal || 0),
      estoque_atual: Number(produto.estoque_atual || 0),
      unidades,
      motor: MOTOR_NOME,
      contexto: ContextoConversao.AJUSTE_ESTOQUE,
      sprint: 'EST-MCC-01'
    };
  }

  async preview(db, produtoId, body = {}) {
    const produto = await this.carregarProdutoAjuste(db, produtoId);
    const unidadeOrigem = String(
      body.unidade_origem || body.unidadeOrigem || body.unidade || produto.unidade || 'UN'
    ).trim().toUpperCase();

    const qtdFiscal = Number(body.quantidade_fiscal ?? body.ajuste_fiscal ?? body.quantidade ?? 0);
    const qtdNaoFiscal = Number(body.quantidade_nao_fiscal ?? body.ajuste_nao_fiscal ?? 0);

    const convFiscal = qtdFiscal !== 0
      ? await this.orchestrator.processarItemAsync({
          produto,
          quantidade: qtdFiscal,
          unidadeOrigem,
          loteId: body.lote_id ?? body.loteId ?? null,
          db
        })
      : null;

    const convNaoFiscal = qtdNaoFiscal !== 0
      ? await this.orchestrator.processarItemAsync({
          produto,
          quantidade: qtdNaoFiscal,
          unidadeOrigem,
          loteId: body.lote_id ?? body.loteId ?? null,
          db
        })
      : null;

    const deltaFiscalBase = convFiscal ? Number(convFiscal.quantidadeConvertida) : 0;
    const deltaNaoFiscalBase = convNaoFiscal ? Number(convNaoFiscal.quantidadeConvertida) : 0;
    const saldoFiscal = Number(produto.saldo_fiscal || 0);
    const saldoNaoFiscal = Number(produto.saldo_nao_fiscal || 0);
    const estoqueAtual = Number(produto.estoque_atual || (saldoFiscal + saldoNaoFiscal));
    const unidadeBase = String(produto.unidade_base || produto.unidade || 'UN').toUpperCase();

    const qtdInformadaTotal = round3(qtdFiscal + qtdNaoFiscal);
    const qtdBaseTotal = round3(deltaFiscalBase + deltaNaoFiscalBase);

    return {
      ok: true,
      produto_id: Number(produtoId),
      unidade_origem: unidadeOrigem,
      unidade_base: unidadeBase,
      quantidade_informada: qtdInformadaTotal,
      quantidade_informada_fiscal: qtdFiscal,
      quantidade_informada_nao_fiscal: qtdNaoFiscal,
      quantidade_base: qtdBaseTotal,
      quantidade_base_fiscal: deltaFiscalBase,
      quantidade_base_nao_fiscal: deltaNaoFiscalBase,
      saldo_atual: estoqueAtual,
      saldo_atual_fiscal: saldoFiscal,
      saldo_atual_nao_fiscal: saldoNaoFiscal,
      saldo_final: round3(estoqueAtual + qtdBaseTotal),
      saldo_final_fiscal: round3(saldoFiscal + deltaFiscalBase),
      saldo_final_nao_fiscal: round3(saldoNaoFiscal + deltaNaoFiscalBase),
      conversao_fiscal: convFiscal
        ? {
            tipo: convFiscal.tipoConversao,
            fator_aplicado: convFiscal.fatorAplicado,
            auditoria: convFiscal.auditoria
          }
        : null,
      conversao_nao_fiscal: convNaoFiscal
        ? {
            tipo: convNaoFiscal.tipoConversao,
            fator_aplicado: convNaoFiscal.fatorAplicado,
            auditoria: convNaoFiscal.auditoria
          }
        : null,
      preview_texto: {
        quantidade_informada: `${qtdInformadaTotal} ${unidadeOrigem}`,
        quantidade_base: `${qtdBaseTotal} ${unidadeBase}`,
        saldo_atual: `${estoqueAtual} ${unidadeBase}`,
        saldo_final: `${round3(estoqueAtual + qtdBaseTotal)} ${unidadeBase}`
      },
      sprint: 'EST-MCC-01'
    };
  }

  /**
   * Converte deltas comerciais → base e devolve payload para aplicarAjusteEstoqueProduto.
   */
  async prepararDeltasBase(db, produtoId, body = {}) {
    const produto = await this.carregarProdutoAjuste(db, produtoId);
    const unidadeOrigem = String(
      body.unidade_origem || body.unidadeOrigem || body.unidade || body.unidade_comercial || ''
    ).trim().toUpperCase();

    // Compatibilidade: sem unidade → trata valores como já em base
    const modoLegado = !unidadeOrigem;
    if (modoLegado) {
      return {
        legado: true,
        ajusteFiscal: Number(body.ajuste_fiscal ?? 0),
        ajusteNaoFiscal: Number(body.ajuste_nao_fiscal ?? 0),
        unidadeOrigem: String(produto.unidade || 'UN').toUpperCase(),
        unidadeBase: String(produto.unidade || 'UN').toUpperCase(),
        conversoes: null
      };
    }

    const qtdFiscal = Number(body.ajuste_fiscal ?? body.quantidade_fiscal ?? 0);
    const qtdNaoFiscal = Number(body.ajuste_nao_fiscal ?? body.quantidade_nao_fiscal ?? 0);

    if (qtdFiscal === 0 && qtdNaoFiscal === 0 && body.quantidade != null) {
      const qtd = Number(body.quantidade) || 0;
      const modoFiscalAtivo = body.modo_fiscal === 1 || body.modo_fiscal === true || body.modo_fiscal === '1';
      if (modoFiscalAtivo) {
        return this._converterPar(db, produto, unidadeOrigem, qtd, 0, body);
      }
      return this._converterPar(db, produto, unidadeOrigem, 0, qtd, body);
    }

    return this._converterPar(db, produto, unidadeOrigem, qtdFiscal, qtdNaoFiscal, body);
  }

  async _converterPar(db, produto, unidadeOrigem, qtdFiscal, qtdNaoFiscal, body) {
    let ajusteFiscal = 0;
    let ajusteNaoFiscal = 0;
    const conversoes = {};

    if (qtdFiscal !== 0) {
      const r = await this.orchestrator.processarItemAsync({
        produto,
        quantidade: qtdFiscal,
        unidadeOrigem,
        loteId: body.lote_id ?? body.loteId ?? null,
        db
      });
      ajusteFiscal = Number(r.quantidadeConvertida);
      conversoes.fiscal = r.auditoria;
    }

    if (qtdNaoFiscal !== 0) {
      const r = await this.orchestrator.processarItemAsync({
        produto,
        quantidade: qtdNaoFiscal,
        unidadeOrigem,
        loteId: body.lote_id ?? body.loteId ?? null,
        db
      });
      ajusteNaoFiscal = Number(r.quantidadeConvertida);
      conversoes.nao_fiscal = r.auditoria;
    }

    return {
      legado: false,
      ajusteFiscal,
      ajusteNaoFiscal,
      unidadeOrigem,
      unidadeBase: String(produto.unidade_base || produto.unidade || 'UN').toUpperCase(),
      quantidadeInformadaFiscal: qtdFiscal,
      quantidadeInformadaNaoFiscal: qtdNaoFiscal,
      conversoes
    };
  }
}

module.exports = EstoqueAdjustmentOperacionalService;
