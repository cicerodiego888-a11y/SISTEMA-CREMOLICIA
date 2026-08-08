/**
 * ContaCorrenteProjectionService — Reconstrói Conta Corrente Comercial.
 *
 * Sprint 2.4.4: leitura exclusiva do Ledger.
 * Extrato operacional: lançamentos com descrição, saldo projetado (saldoDevedor)
 * e agrupamento por correlationId (ex.: entrega multi-item).
 *
 * @class ContaCorrenteProjectionService
 */

const BaseProjectionService = require('./BaseProjectionService');
const ProjectionContext = require('./ProjectionContext');
const ContaCorrenteDTO = require('../../dto/ContaCorrenteDTO');
const CreditoComercialService = require('../CreditoComercialService');
const { DocumentoInvalidoError } = require('../../domain/errors');
const {
  filtrarPorFlag,
  ordenarCronologicamente,
  somarPorTipo,
  listarMovimentacoesComerciais,
  TIPOS_FINANCEIROS,
  TIMELINE_LABELS
} = require('./projectionHelpers');

const TIPOS_AGRUPAVEIS = new Set([
  'ENTREGA',
  'DEVOLUCAO',
  'VENDA_PRESTACAO',
  'PERDA',
  'CORTESIA',
  'PAGAMENTO'
]);

/**
 * Remove período/paginação do contexto de leitura — o extrato precisa do ledger
 * completo para saldo inicial e saldo projetado; o recorte é só na projeção.
 * @param {ProjectionContext} contexto
 * @param {Object} [extra]
 * @returns {ProjectionContext}
 */
function contextoLeituraCompleta(contexto, extra = {}) {
  return ProjectionContext.create({
    ...contexto.toJSON(),
    ...extra,
    dataInicio: null,
    dataFim: null,
    limite: null,
    offset: 0
  });
}

/**
 * Agrupa movimentos do mesmo tipo + correlationId (ex.: N itens de uma entrega).
 * @param {Object[]} movimentacoes
 * @returns {Object[]}
 */
function agruparPorCorrelation(movimentacoes) {
  const resultado = [];
  const indicePorChave = new Map();

  for (const m of movimentacoes) {
    const tipo = m.tipoMovimentacao;
    const corr = m.correlationId;
    if (!corr || !TIPOS_AGRUPAVEIS.has(tipo)) {
      resultado.push({ ...m, _itensAgrupados: 1, _ids: [m.id] });
      continue;
    }

    const chave = `${tipo}::${corr}`;
    const idx = indicePorChave.get(chave);
    if (idx == null) {
      indicePorChave.set(chave, resultado.length);
      resultado.push({
        ...m,
        valor: Number(m.valor ?? 0),
        quantidade: Number(m.quantidade ?? 0) || null,
        _itensAgrupados: 1,
        _ids: [m.id]
      });
      continue;
    }

    const alvo = resultado[idx];
    alvo.valor = Number(alvo.valor ?? 0) + Number(m.valor ?? 0);
    if (m.quantidade != null || alvo.quantidade != null) {
      alvo.quantidade = Number(alvo.quantidade ?? 0) + Number(m.quantidade ?? 0);
    }
    alvo._itensAgrupados += 1;
    alvo._ids.push(m.id);
  }

  return resultado;
}

/**
 * @param {Object} m
 * @returns {string}
 */
function montarDescricao(m) {
  const base = (m.motivo && String(m.motivo).trim())
    || TIMELINE_LABELS[m.tipoMovimentacao]
    || m.tipoMovimentacao
    || 'Lançamento';
  const n = Number(m._itensAgrupados || 1);
  if (n > 1) return `${base} (${n} itens)`;
  return base;
}

/**
 * @param {Object[]} prefixoMovimentacoes — movimentos individuais (não agrupados) até o ponto
 * @returns {number}
 */
function saldoDevedorAte(prefixoMovimentacoes) {
  return CreditoComercialService.calcular({
    limiteComercial: 0,
    movimentacoes: prefixoMovimentacoes
  }).saldoDevedor;
}

class ContaCorrenteProjectionService extends BaseProjectionService {
  async validar(contexto) {
    if (contexto.consignacaoId == null && contexto.clienteId == null) {
      throw new DocumentoInvalidoError('consignacaoId ou clienteId é obrigatório para Conta Corrente');
    }
    if (!this._movimentacaoComercialRepository) {
      throw new DocumentoInvalidoError('IMovimentacaoComercialRepository não configurado');
    }
  }

  async consultar(contexto) {
    if (contexto.consignacaoId != null) {
      const movimentacoes = await listarMovimentacoesComerciais(
        this._movimentacaoComercialRepository,
        contextoLeituraCompleta(contexto)
      );
      return filtrarPorFlag(movimentacoes, 'geraContaCorrente');
    }

    const consignacoes = await this._consignacaoRepository?.listar({
      clienteId: contexto.clienteId
    }) ?? [];

    const movimentacoesPorConsignacao = await Promise.all(
      consignacoes.map((c) => listarMovimentacoesComerciais(
        this._movimentacaoComercialRepository,
        contextoLeituraCompleta(contexto, { consignacaoId: c.id })
      ))
    );

    return filtrarPorFlag(movimentacoesPorConsignacao.flat(), 'geraContaCorrente');
  }

  async projetar(movimentacoes, contexto) {
    const ordenadas = ordenarCronologicamente(movimentacoes, 'ASC');

    const antesDoPeriodo = contexto.dataInicio
      ? ordenadas.filter((m) => new Date(m.dataMovimentacao) < new Date(contexto.dataInicio))
      : [];

    const noPeriodo = contexto.dataInicio && contexto.dataFim
      ? ordenadas.filter((m) => {
        const data = new Date(m.dataMovimentacao);
        return data >= new Date(contexto.dataInicio) && data <= new Date(contexto.dataFim);
      })
      : ordenadas;

    const saldoInicial = saldoDevedorAte(antesDoPeriodo);
    const creditoFinal = CreditoComercialService.calcular({
      limiteComercial: 0,
      movimentacoes: ordenadas
    });
    const saldoAtual = creditoFinal.saldoDevedor;

    const vendas = somarPorTipo(noPeriodo, TIPOS_FINANCEIROS.VENDA);
    const perdas = somarPorTipo(noPeriodo, TIPOS_FINANCEIROS.PERDA);
    const cortesias = somarPorTipo(noPeriodo, TIPOS_FINANCEIROS.CORTESIA);
    const pagamentos = somarPorTipo(noPeriodo, TIPOS_FINANCEIROS.PAGAMENTO);
    const entregas = somarPorTipo(noPeriodo, TIPOS_FINANCEIROS.ENTREGA);

    const agrupadas = agruparPorCorrelation(noPeriodo);
    const ordenacao = contexto.ordenacao === 'DESC' ? 'DESC' : 'ASC';

    let prefixo = [...antesDoPeriodo];
    const lancamentosAsc = agrupadas.map((m) => {
      const ids = m._ids || [m.id];
      const membros = noPeriodo.filter((x) => ids.includes(x.id));
      prefixo = prefixo.concat(membros.length ? membros : [m]);
      const saldoProjetado = saldoDevedorAte(prefixo);
      return {
        id: m.id,
        ids,
        tipo: m.tipoMovimentacao,
        tipoMovimentacao: m.tipoMovimentacao,
        valor: Number(m.valor ?? 0),
        quantidade: m.quantidade,
        data: m.dataMovimentacao,
        dataMovimentacao: m.dataMovimentacao,
        correlationId: m.correlationId,
        consignacaoId: m.consignacaoId,
        documento: m.consignacaoId != null ? `Consignação #${m.consignacaoId}` : null,
        motivo: m.motivo,
        descricao: montarDescricao(m),
        itensAgrupados: m._itensAgrupados || 1,
        saldoProjetado,
        saldoApos: saldoProjetado,
        usuarioId: m.usuarioId,
        origem: m.origem
      };
    });

    const lancamentos = ordenacao === 'DESC'
      ? [...lancamentosAsc].reverse()
      : lancamentosAsc;

    const dto = ContaCorrenteDTO.create({
      escopo: contexto.consignacaoId != null ? 'CONSIGNACAO' : 'CLIENTE',
      consignacaoId: contexto.consignacaoId ?? null,
      clienteId: contexto.clienteId ?? null,
      saldoInicial,
      vendas,
      perdas,
      cortesias,
      pagamentos,
      saldoAtual,
      lancamentos
    });

    return {
      dados: {
        ...dto.toJSON(),
        saldoDevedor: saldoAtual,
        entregas,
        estoqueConsignado: creditoFinal.estoqueConsignado,
        saldoEmAberto: creditoFinal.saldoEmAbertoContaCorrente
      },
      totais: {
        saldoInicial,
        vendas,
        perdas,
        cortesias,
        pagamentos,
        entregas,
        saldoAtual,
        saldoDevedor: saldoAtual
      }
    };
  }
}

module.exports = ContaCorrenteProjectionService;
