/**
 * UC-004 — AdicionarItemConsignacaoUseCase
 *
 * RCM-6.1 — persiste snapshot completo da precificação (imutável após preparação).
 *
 * @class AdicionarItemConsignacaoUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  DocumentoInvalidoError,
  ProdutoInvalidoError,
  ProdutoDuplicadoNaConsignacaoError,
  QuantidadeInvalidaError
} = require('../../domain/errors');
const {
  gerarCorrelationId,
  enfileirarEvento,
  obterConsignacaoEmRascunho
} = require('./consignacaoUseCaseHelpers');

const CANAL_CONSIGNACAO = 'CONSIGNADO';

class AdicionarItemConsignacaoUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
    this._produtoBridge = deps.produtoBridge ?? null;
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
    if (!entrada?.produtoId) {
      throw new ProdutoInvalidoError(null, 'produtoId é obrigatório');
    }
    if (!Number.isFinite(Number(entrada.quantidade)) || Number(entrada.quantidade) <= 0) {
      throw new QuantidadeInvalidaError(entrada?.quantidade);
    }
    if (!this._produtoBridge) {
      throw new ProdutoInvalidoError(null, 'IProdutoBridge não configurado');
    }
  }

  async processar(entrada) {
    // RCM-6.1 — resolução no fluxo de consignação SEMPRE com canal CONSIGNADO
    const produto = await this._produtoBridge.buscarPorId(entrada.produtoId, {
      canal: CANAL_CONSIGNACAO
    });
    if (!produto) {
      throw new ProdutoInvalidoError(entrada.produtoId, 'Produto não encontrado');
    }

    const produtoAtivo = await this._produtoBridge.estaAtivo(entrada.produtoId);
    if (!produtoAtivo) {
      throw new ProdutoInvalidoError(entrada.produtoId, 'Produto inativo');
    }

    const quantidade = Number(entrada.quantidade);

    // RCM-8.5 — SSOT: preço e snapshot vêm do Motor Oficial (bridge CONSIGNADO).
    // Cliente só prevalece quando envia snapshot completo (desktop pós-Resolver).
    const clienteTrouxeSnapshot = !!(
      entrada.precoOrigem
      || entrada.preco_origem
      || entrada.tabelaPrecoId
      || entrada.tabela_preco_id
    );

    const precoBridge = Number(produto.precoVenda ?? produto.preco ?? 0);
    const precoCliente = entrada.precoUnitario != null && entrada.precoUnitario !== ''
      ? Number(entrada.precoUnitario)
      : null;

    const precoUnitario = clienteTrouxeSnapshot && Number.isFinite(precoCliente) && precoCliente >= 0
      ? precoCliente
      : (Number.isFinite(precoBridge) && precoBridge >= 0 ? precoBridge : (precoCliente || 0));

    const unidadeComercial = String(
      entrada.unidadeComercial
      || entrada.unidade_comercial
      || produto.unidadeComercial
      || produto.unidade
      || 'UN'
    ).trim().toUpperCase() || 'UN';

    const linhaComercialId = entrada.linhaComercialId
      ?? entrada.linha_comercial_id
      ?? produto.linhaComercialId
      ?? null;

    const tabelaPrecoId = entrada.tabelaPrecoId
      ?? entrada.tabela_preco_id
      ?? produto.tabelaPrecoId
      ?? null;

    const canalVenda = String(
      entrada.canalVenda
      || entrada.canal_venda
      || entrada.canal
      || produto.canalVenda
      || CANAL_CONSIGNACAO
    ).trim().toUpperCase() || CANAL_CONSIGNACAO;

    const precoOrigem = entrada.precoOrigem
      ?? entrada.preco_origem
      ?? produto.precoOrigem
      ?? null;

    const precoFallbackRaw = entrada.precoFallback ?? entrada.preco_fallback ?? produto.precoFallback;
    const precoFallback = precoFallbackRaw === true
      || precoFallbackRaw === 1
      || String(precoFallbackRaw).toLowerCase() === 'true';

    try {
      console.log('[RCM-8.5][COMERCIAL][Resolver]', JSON.stringify({
        operacao: CANAL_CONSIGNACAO,
        tabela: tabelaPrecoId,
        produto: entrada.produtoId,
        linha: linhaComercialId,
        preco: precoUnitario,
        origem: precoOrigem,
        documento: 'consignacao',
        snapshot_cliente: clienteTrouxeSnapshot
      }));
    } catch (_) { /* ignore */ }

    const correlationId = entrada.correlationId ?? gerarCorrelationId();

    return this.executarEscrita(async (uow, eventos) => {
      const consignacao = await uow.consignacao.buscarPorId(entrada.consignacaoId);
      obterConsignacaoEmRascunho(consignacao);

      const itensExistentes = await uow.consignacaoItem.listarPorConsignacao(consignacao.id, {
        produtoId: entrada.produtoId
      });
      if (itensExistentes.length > 0) {
        throw new ProdutoDuplicadoNaConsignacaoError(consignacao.id, entrada.produtoId);
      }

      const item = await uow.consignacaoItem.inserir({
        consignacaoId: consignacao.id,
        produtoId: entrada.produtoId,
        quantidadeEntregue: quantidade,
        precoUnitario,
        subtotalEntregue: quantidade * precoUnitario,
        linhaComercialId: linhaComercialId != null && Number(linhaComercialId) > 0
          ? Number(linhaComercialId)
          : null,
        tabelaPrecoId: tabelaPrecoId != null && Number(tabelaPrecoId) > 0
          ? Number(tabelaPrecoId)
          : null,
        canalVenda,
        unidadeComercial,
        precoOrigem,
        precoFallback
      });

      enfileirarEvento(eventos, EVENTOS_DOMINIO.ITEM_CONSIGNACAO_ADICIONADO, consignacao.id, {
        consignacaoId: consignacao.id,
        item,
        correlationId
      }, correlationId);

      return { item, consignacaoId: consignacao.id, correlationId };
    });
  }
}

module.exports = AdicionarItemConsignacaoUseCase;
