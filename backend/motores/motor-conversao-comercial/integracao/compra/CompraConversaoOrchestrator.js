/**
 * MCI-01 / MCC-03 — CompraConversaoOrchestrator
 *
 * Única camada autorizada a criar ConversaoFisicaLote a partir da Entrada de Mercadorias.
 * O módulo Compras NÃO chama o MCC diretamente — consome este orchestrator
 * (via EntradaMercadoriasOperacionalService na integração operacional).
 *
 * Fluxo:
 *   Fornecedor → Entrada → Lote → ConversaoFisicaLote → MCC → quantidade base → Estoque
 */

const UnidadeComercial = require('../../domain/UnidadeComercial');
const ConversaoFisicaLote = require('../../domain/ConversaoFisicaLote');
const ConversaoFisicaObrigatoriaError = require('../../domain/ConversaoFisicaObrigatoriaError');
const UnidadeNaoPermitidaError = require('../../domain/UnidadeNaoPermitidaError');
const PesoInvalidoError = require('../../domain/PesoInvalidoError');
const VolumeInvalidoError = require('../../domain/VolumeInvalidoError');
const { OrigemConversaoFisica, ContextoConversao, MOTOR_NOME } = require('../../domain/enums');
const ConversaoComercialService = require('../../services/ConversaoComercialService');
const { CalcularConversaoFisica } = require('../../services/ConversaoFisicaCalculator');
const ConversaoFisicaLoteRepository = require('../../repositories/ConversaoFisicaLoteRepository');
const ModoEntradaConversao = require('./ModoEntradaConversao');
const { resolverUnidadeComercialOficial } = require('../../services/resolverUnidadeComercialOficial');

class CompraConversaoOrchestrator {
  constructor(deps = {}) {
    this.mcc = deps.mcc || new ConversaoComercialService();
    this.repository = deps.repository || ConversaoFisicaLoteRepository;
    this._loteSeq = 0;
  }

  /**
   * Processa um item de entrada de mercadorias (infraestrutura).
   *
   * @param {object} entrada
   * @param {object} entrada.produto
   * @param {number} entrada.quantidade — qtd na unidade comercial (modo embalagem) ou volume total (modo total se unidade=base)
   * @param {string} entrada.unidadeOrigem — ex.: CX, L
   * @param {string} [entrada.modo] — PESO_POR_EMBALAGEM | PESO_TOTAL
   * @param {number} [entrada.pesoEmbalagem] — modo 1
   * @param {number} [entrada.pesoTotal] — modo 2
   * @param {number} [entrada.volumeTotal] — modo 2 (opcional se derivável)
   * @param {object} [entrada.compra] — { id, fornecedorId, fornecedorNome }
   * @param {object} [entrada.lote] — { id?, codigo?, dataValidade? }
   * @param {boolean} [entrada.persistir] — grava ConversaoFisicaLote se db informado
   * @param {object} [entrada.db]
   * @returns {object} resultado da integração
   */
  processarItem(entrada = {}) {
    const produto = entrada.produto;
    if (!produto || typeof produto !== 'object') {
      const err = new Error('Informe o produto da entrada.');
      err.status = 400;
      throw err;
    }

    const produtoId = produto.id ?? produto.produto_id;
    const unidadeBase = String(
      produto.unidade_base || produto.unidadeBase || produto.unidade || 'UN'
    ).trim().toUpperCase();
    const unidadeDestinoFisica = String(
      produto.unidade_conversao_fisica
      || produto.unidadeConversaoFisica
      || entrada.unidadeDestino
      || 'KG'
    ).trim().toUpperCase();

    const unidadeOrigem = String(
      entrada.unidadeOrigem || entrada.unidade || entrada.unidade_comercial || ''
    ).trim().toUpperCase();
    if (!unidadeOrigem) {
      throw new UnidadeNaoPermitidaError('Informe a unidade comercial da entrada.', {
        produtoId,
        unidade: ''
      });
    }

    const unidadeComercial = this._resolverUnidadeComercial(produto, unidadeOrigem, unidadeBase);
    this._validarUnidadePermitidaCompra(produto, unidadeComercial, produtoId);

    const modo = this._resolverModo(entrada);
    const exigeFisica = this._produtoExigeFisica(produto);

    let medidasFisicas = null;
    let conversaoFisicaLote = null;

    if (exigeFisica) {
      if (!this._temCampoPeso(entrada)
        && entrada.volumeTotal == null && entrada.volume_total == null && entrada.volume == null) {
        throw new ConversaoFisicaObrigatoriaError(
          'Produto exige Conversão Física por Lote. Informe o peso do lote antes de movimentar o estoque.',
          { produtoId, loteId: null }
        );
      }
      medidasFisicas = this._calcularMedidasFisicas({
        modo,
        entrada,
        unidadeComercial,
        unidadeBase,
        unidadeDestinoFisica
      });
    } else if (this._temPesoInformado(entrada)) {
      // Peso informado sem flag: ainda calcula (prep.), mas não obriga
      medidasFisicas = this._calcularMedidasFisicas({
        modo,
        entrada,
        unidadeComercial,
        unidadeBase,
        unidadeDestinoFisica
      });
    }

    const loteDraft = this._criarLoteDraft(entrada, produtoId);

    if (medidasFisicas) {
      conversaoFisicaLote = ConversaoFisicaLote.criar({
        produtoId,
        loteId: loteDraft.id,
        loteCodigo: loteDraft.codigo,
        unidadeBase: medidasFisicas.unidadeBase,
        unidadeDestino: medidasFisicas.unidadeDestino,
        quantidadeBase: medidasFisicas.quantidadeBase,
        quantidadeDestino: medidasFisicas.quantidadeDestino,
        origem: medidasFisicas.origem || OrigemConversaoFisica.CALCULADA
      });
    } else if (exigeFisica) {
      throw new ConversaoFisicaObrigatoriaError(undefined, {
        produtoId,
        loteId: loteDraft.id
      });
    }

    // Estoque base = UC → unidade base. Fator físico fica no lote (não converte estoque p/ Kg).
    const resultadoMcc = this.mcc.Converter({
      produto,
      quantidade: Number(entrada.quantidade),
      unidadeOrigem,
      contexto: ContextoConversao.COMPRA,
      unidadeBase,
      conversaoFisicaLote: conversaoFisicaLote || undefined,
      loteId: loteDraft.id,
      aplicarFisica: false,
      somenteUnidadeBase: true,
      operacaoId: entrada.operacaoId || (
        entrada.compra?.id != null ? `compra-${entrada.compra.id}` : null
      )
    });

    const auditoria = this._montarAuditoria({
      produto,
      produtoId,
      entrada,
      loteDraft,
      medidasFisicas,
      conversaoFisicaLote,
      resultadoMcc
    });

    const resultado = {
      ok: true,
      modo,
      produtoId,
      compraId: entrada.compra?.id ?? entrada.compra_id ?? null,
      fornecedorId: entrada.compra?.fornecedorId
        ?? entrada.compra?.fornecedor_id
        ?? entrada.fornecedorId
        ?? null,
      lote: loteDraft,
      conversaoFisicaLote: conversaoFisicaLote ? conversaoFisicaLote.toJSON() : null,
      quantidadeInformada: Number(entrada.quantidade),
      unidadeOrigem,
      quantidadeConvertida: resultadoMcc.quantidadeConvertida,
      unidadeBase: resultadoMcc.unidadeBase,
      unidadeDestino: resultadoMcc.unidadeDestino,
      fatorAplicado: resultadoMcc.fatorAplicado,
      tipoConversao: resultadoMcc.tipoConversao,
      resultadoMcc: resultadoMcc.toJSON ? resultadoMcc.toJSON() : resultadoMcc,
      auditoria,
      /**
       * true = apenas cálculo (infra).
       * A camada operacional (MCC-03) cria lote/estoque e marca estoqueBasePendente=false.
       */
      estoqueBasePendente: true,
      persistido: false
    };

    return resultado;
  }

  /**
   * Versão async: opcionalmente persiste ConversaoFisicaLote (não grava estoque).
   */
  async processarItemAsync(entrada = {}) {
    const resultado = this.processarItem(entrada);
    if (entrada.persistir && entrada.db && resultado.conversaoFisicaLote) {
      const entidade = ConversaoFisicaLote.fromRow(resultado.conversaoFisicaLote);
      const salva = await this.repository.inserir(entrada.db, entidade);
      resultado.conversaoFisicaLote = salva.toJSON();
      resultado.persistido = true;
      resultado.auditoria.persistido = true;
    }
    return resultado;
  }

  _resolverModo(entrada) {
    const raw = String(entrada.modo || entrada.modoEntrada || '').toUpperCase();
    if (raw === ModoEntradaConversao.PESO_TOTAL || raw === 'TOTAL') {
      return ModoEntradaConversao.PESO_TOTAL;
    }
    if (raw === ModoEntradaConversao.PESO_POR_EMBALAGEM || raw === 'EMBALAGEM') {
      return ModoEntradaConversao.PESO_POR_EMBALAGEM;
    }
    // Inferência: volumeTotal/pesoTotal → modo 2; pesoEmbalagem → modo 1
    if (entrada.pesoTotal != null || entrada.peso_total != null
      || entrada.volumeTotal != null || entrada.volume_total != null) {
      return ModoEntradaConversao.PESO_TOTAL;
    }
    if (entrada.pesoEmbalagem != null || entrada.peso_embalagem != null
      || entrada.peso != null) {
      return ModoEntradaConversao.PESO_POR_EMBALAGEM;
    }
    return ModoEntradaConversao.PESO_POR_EMBALAGEM;
  }

  _produtoExigeFisica(produto) {
    const flag = produto.utiliza_conversao_fisica ?? produto.utilizaConversaoFisica;
    return flag === true || flag === 1 || flag === '1';
  }

  _temPesoInformado(entrada) {
    const vals = [
      entrada.pesoEmbalagem, entrada.peso_embalagem, entrada.peso,
      entrada.pesoTotal, entrada.peso_total
    ];
    return vals.some((v) => v != null && v !== '' && Number(v) > 0);
  }

  /** Campo de peso presente (inclusive 0 — para validar PesoInvalidoError) */
  _temCampoPeso(entrada) {
    const vals = [
      entrada.pesoEmbalagem, entrada.peso_embalagem, entrada.peso,
      entrada.pesoTotal, entrada.peso_total
    ];
    return vals.some((v) => v != null && v !== '');
  }

  _resolverUnidadeComercial(produto, codigo, unidadeBase) {
    return resolverUnidadeComercialOficial({ produto, codigo, unidadeBase });
  }

  _validarUnidadePermitidaCompra(produto, unidade, produtoId) {
    const lista = produto.unidades_comercializacao || produto.unidades || [];
    if (!lista.length) return;

    const row = lista.find((u) => {
      const c = String(u.unidade_comercial || u.codigo || '').toUpperCase();
      return c === unidade.codigo;
    });
    // RCM-8.8: sem cadastro no produto → não bloqueia (conversão MUC já validada)
    if (!row) return;

    if (row.permite_compra === 0 || row.permite_compra === false) {
      throw new UnidadeNaoPermitidaError(
        `Unidade "${unidade.codigo}" não permitida para compra.`,
        { unidade: unidade.codigo, produtoId }
      );
    }
    if (row.canais_comercializacao) {
      let canais = row.canais_comercializacao;
      if (typeof canais === 'string') {
        try { canais = JSON.parse(canais); } catch (_) { canais = []; }
      }
      if (Array.isArray(canais) && canais.length
        && !canais.map((c) => String(c).toLowerCase()).includes('compra')) {
        throw new UnidadeNaoPermitidaError(
          `Unidade "${unidade.codigo}" sem canal compra.`,
          { unidade: unidade.codigo, produtoId }
        );
      }
    }
  }

  _calcularMedidasFisicas({
    modo,
    entrada,
    unidadeComercial,
    unidadeBase,
    unidadeDestinoFisica
  }) {
    const origem = String(
      entrada.origemConversao || entrada.origem || OrigemConversaoFisica.CALCULADA
    ).toUpperCase();

    if (modo === ModoEntradaConversao.PESO_TOTAL) {
      const volumeTotal = Number(
        entrada.volumeTotal ?? entrada.volume_total ?? entrada.volume
      );
      const pesoTotal = Number(entrada.pesoTotal ?? entrada.peso_total ?? entrada.peso);

      // Se volume não veio, deriva: qtd comercial × fator UC (ou qtd se já for base)
      let volume = volumeTotal;
      if (!Number.isFinite(volume) || volume <= 0) {
        const qtd = Number(entrada.quantidade);
        if (unidadeComercial.isPadrao || unidadeComercial.codigo === unidadeBase) {
          volume = qtd;
        } else {
          volume = qtd * Number(unidadeComercial.quantidade || 1);
        }
      }

      return CalcularConversaoFisica({
        volume,
        peso: pesoTotal,
        unidadeBase,
        unidadeDestino: unidadeDestinoFisica,
        origem
      });
    }

    // Modo PESO_POR_EMBALAGEM
    const pesoEmbalagem = Number(
      entrada.pesoEmbalagem ?? entrada.peso_embalagem ?? entrada.peso
    );
    const volumeEmbalagem = unidadeComercial.isPadrao || unidadeComercial.codigo === unidadeBase
      ? 1
      : Number(unidadeComercial.quantidade || 0);

    if (!Number.isFinite(volumeEmbalagem) || volumeEmbalagem <= 0) {
      throw new VolumeInvalidoError(
        'Volume da embalagem inválido. Verifique a quantidade da unidade comercial.',
        { volume: volumeEmbalagem }
      );
    }
    if (!Number.isFinite(pesoEmbalagem) || pesoEmbalagem <= 0) {
      throw new PesoInvalidoError(undefined, { peso: pesoEmbalagem });
    }

    return CalcularConversaoFisica({
      volume: volumeEmbalagem,
      peso: pesoEmbalagem,
      unidadeBase,
      unidadeDestino: unidadeDestinoFisica,
      origem
    });
  }

  _criarLoteDraft(entrada, produtoId) {
    const loteIn = entrada.lote || {};
    this._loteSeq += 1;
    const id = loteIn.id != null
      ? Number(loteIn.id)
      : (entrada.loteId != null ? Number(entrada.loteId) : -(Date.now() % 1e9) - this._loteSeq);
    const codigo = String(
      loteIn.codigo || loteIn.lote || entrada.loteCodigo || `LOTE-TMP-${Math.abs(id)}`
    );
    return {
      id,
      codigo,
      produtoId,
      compraId: entrada.compra?.id ?? entrada.compra_id ?? null,
      dataValidade: loteIn.dataValidade || loteIn.data_validade || null,
      origem: 'COMPRA',
      /** Draft — produtos_lotes ainda não gravado nesta sprint */
      draft: true,
      persistido: false
    };
  }

  _montarAuditoria({
    produto,
    produtoId,
    entrada,
    loteDraft,
    medidasFisicas,
    conversaoFisicaLote,
    resultadoMcc
  }) {
    return {
      produtoId,
      produtoNome: produto.nome || null,
      fornecedorId: entrada.compra?.fornecedorId
        ?? entrada.compra?.fornecedor_id
        ?? entrada.fornecedorId
        ?? null,
      fornecedorNome: entrada.compra?.fornecedorNome
        ?? entrada.compra?.fornecedor_nome
        ?? entrada.fornecedorNome
        ?? null,
      compraId: entrada.compra?.id ?? entrada.compra_id ?? null,
      loteId: loteDraft.id,
      loteCodigo: loteDraft.codigo,
      pesoInformado: medidasFisicas?.quantidadeDestino ?? null,
      volumeInformado: medidasFisicas?.quantidadeBase ?? null,
      fatorCalculado: medidasFisicas?.fator
        ?? conversaoFisicaLote?.fator
        ?? resultadoMcc.fatorAplicado
        ?? null,
      origem: medidasFisicas?.origem || conversaoFisicaLote?.origem || null,
      quantidadeConvertida: resultadoMcc.quantidadeConvertida,
      unidadeBase: resultadoMcc.unidadeBase,
      motor: MOTOR_NOME,
      timestamp: new Date().toISOString(),
      persistido: false
    };
  }
}

module.exports = CompraConversaoOrchestrator;
