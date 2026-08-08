/**
 * FiscalMarginCalculator — Cálculo oficial da Margem Fiscal Disponível (RC3).
 *
 * Descobre quanto o valor fiscal da venda pode variar (máximo ↔ mínimo)
 * SEM alterar o Valor Fiscal Efetivo (permanece responsabilidade do
 * FiscalOperacionalService = máximo).
 *
 * Proibido: MIDP, pagamento, PIX, TEF, dinheiro, cartão, origens comerciais.
 *
 * Regras:
 * - valorFiscalMaximo = soma atual de valor_fiscal (distribuição existente)
 * - valorFiscalMinimo = piso permitido sem reclassificar itens
 * - margem = máximo − mínimo
 * - possuiMargemFiscal = margem > 0
 */

const { calcularTotaisDistribuidos } = require('../../services/fiscalNaoFiscalService');
const { distribuirQuantidadeVenda } = require('../../services/distribuidorEstoqueVenda');

const EPS = 0.009;

function arredondar2(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

function contarClassificacao(itens = []) {
  let itensFiscais = 0;
  let itensNaoFiscais = 0;

  for (const item of itens) {
    const vf = Number(item.valor_fiscal || 0);
    const vnf = Number(item.valor_nao_fiscal || 0);
    if (vf > EPS) itensFiscais += 1;
    if (vnf > EPS) itensNaoFiscais += 1;
  }

  return { itensFiscais, itensNaoFiscais };
}

/**
 * Indica se o item traz dados suficientes para recalcular o piso via estoque.
 */
function itemComSaldos(item = {}) {
  const qtd = Number(
    item.quantidade_estoque != null && item.quantidade_estoque !== ''
      ? item.quantidade_estoque
      : item.quantidade || 0
  );
  const temSaldoFiscal = item.saldo_fiscal != null;
  const temSaldoNaoFiscal = item.saldo_nao_fiscal != null;
  return qtd > 0 && temSaldoFiscal && temSaldoNaoFiscal;
}

/**
 * Piso fiscal do item via regra oficial de estoque (prioriza não fiscal).
 * Não altera classificação — apenas estima o mínimo possível.
 */
function pisoFiscalViaEstoque(item = {}) {
  const qtdEstoque = Number(
    item.quantidade_estoque != null && item.quantidade_estoque !== ''
      ? item.quantidade_estoque
      : item.quantidade || 0
  );
  const qtdVenda = Number(item.quantidade || qtdEstoque || 0);
  const preco = Number(item.preco_unitario || 0);
  const saldoFiscal = Number(item.saldo_fiscal || 0);
  const saldoNaoFiscal = Number(item.saldo_nao_fiscal || 0);
  const vfAtual = Number(item.valor_fiscal || 0);

  const dist = distribuirQuantidadeVenda(
    qtdEstoque,
    saldoFiscal,
    saldoNaoFiscal,
    false // prioriza não fiscal → mínimo fiscal
  );

  if (!dist.sucesso) {
    return arredondar2(vfAtual);
  }

  let valorMin;
  if (qtdEstoque > 0 && qtdEstoque !== qtdVenda) {
    const subtotal = Number((qtdVenda * preco).toFixed(2));
    const ratio = dist.quantidadeFiscal / qtdEstoque;
    valorMin = Number((subtotal * ratio).toFixed(2));
  } else {
    valorMin = Number((dist.quantidadeFiscal * preco).toFixed(2));
  }

  // Piso não pode ultrapassar o fiscal atual do item
  return arredondar2(Math.min(vfAtual, Math.max(0, valorMin)));
}

/**
 * Piso fiscal do item sem saldos:
 * - puramente fiscal → travado (valor_fiscal)
 * - misto → flexível até 0 (parcela fiscal pode ceder)
 * - puramente não fiscal → 0
 */
function pisoFiscalSemSaldo(item = {}) {
  const vf = Number(item.valor_fiscal || 0);
  const vnf = Number(item.valor_nao_fiscal || 0);

  if (vf > EPS && vnf <= EPS) {
    return arredondar2(vf);
  }
  return 0;
}

/**
 * Calcula máximo, mínimo e margem a partir dos itens já distribuídos.
 */
function calcularApartirDeItens(itens = []) {
  const totais = calcularTotaisDistribuidos(itens);
  const valorFiscalMaximo = totais.totalFiscal;
  const { itensFiscais, itensNaoFiscais } = contarClassificacao(itens);

  let valorFiscalMinimo = 0;

  for (const item of itens) {
    if (itemComSaldos(item)) {
      valorFiscalMinimo += pisoFiscalViaEstoque(item);
    } else {
      valorFiscalMinimo += pisoFiscalSemSaldo(item);
    }
  }

  valorFiscalMinimo = arredondar2(Math.min(valorFiscalMaximo, Math.max(0, valorFiscalMinimo)));
  const margemFiscalDisponivel = arredondar2(valorFiscalMaximo - valorFiscalMinimo);

  return {
    valorFiscalMaximo,
    valorFiscalMinimo,
    margemFiscalDisponivel,
    possuiMargemFiscal: margemFiscalDisponivel > EPS,
    valorNaoFiscal: totais.totalNaoFiscal,
    itensFiscais,
    itensNaoFiscais
  };
}

/**
 * Sem itens: não há como inferir flexibilidade → margem zero.
 */
function calcularApartirDeTotais({ valorFiscal = 0, valorNaoFiscal = 0 } = {}) {
  const valorFiscalMaximo = arredondar2(valorFiscal);
  return {
    valorFiscalMaximo,
    valorFiscalMinimo: valorFiscalMaximo,
    margemFiscalDisponivel: 0,
    possuiMargemFiscal: false,
    valorNaoFiscal: arredondar2(valorNaoFiscal),
    itensFiscais: valorFiscalMaximo > EPS ? 1 : 0,
    itensNaoFiscais: arredondar2(valorNaoFiscal) > EPS ? 1 : 0
  };
}

function registrarLog(resultado, tempoMs) {
  const payload = {
    motor: 'FISCAL_MARGIN_CALCULATOR',
    versao: FiscalMarginCalculator.VERSAO,
    algoritmo: FiscalMarginCalculator.ALGORITMO,
    valorFiscalMaximo: resultado.valorFiscalMaximo,
    valorFiscalMinimo: resultado.valorFiscalMinimo,
    valorFiscalEfetivo: resultado.valorFiscalMaximo,
    margemFiscalDisponivel: resultado.margemFiscalDisponivel,
    possuiMargemFiscal: resultado.possuiMargemFiscal,
    valorNaoFiscal: resultado.valorNaoFiscal,
    itensFiscais: resultado.itensFiscais,
    itensNaoFiscais: resultado.itensNaoFiscais,
    tempoMs
  };
  console.log('[FISCAL-MARGIN]', JSON.stringify(payload));
  return payload;
}

/**
 * @param {object} entrada
 * @param {Array} [entrada.itens]
 * @param {number} [entrada.valorFiscal]
 * @param {number} [entrada.valorNaoFiscal]
 * @param {object} [entrada.distribuicao]
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.log=true]
 */
function calcular(entrada = {}, opcoes = {}) {
  const inicio = Date.now();

  let resultado;

  if (Array.isArray(entrada.itens) && entrada.itens.length > 0) {
    resultado = calcularApartirDeItens(entrada.itens);
  } else if (entrada.distribuicao && Array.isArray(entrada.distribuicao.itens)) {
    resultado = calcularApartirDeItens(entrada.distribuicao.itens);
  } else if (entrada.distribuicao && typeof entrada.distribuicao === 'object') {
    const d = entrada.distribuicao;
    resultado = calcularApartirDeTotais({
      valorFiscal: d.valorFiscalEfetivo ?? d.valorFiscal ?? d.totalFiscal ?? 0,
      valorNaoFiscal: d.valorNaoFiscal ?? d.totalNaoFiscal ?? 0
    });
  } else {
    resultado = calcularApartirDeTotais({
      valorFiscal: entrada.valorFiscal ?? entrada.totalFiscal ?? 0,
      valorNaoFiscal: entrada.valorNaoFiscal ?? entrada.totalNaoFiscal ?? 0
    });
  }

  const tempoMs = Date.now() - inicio;
  resultado.tempoMs = tempoMs;
  resultado.algoritmo = FiscalMarginCalculator.ALGORITMO;
  resultado.versao = FiscalMarginCalculator.VERSAO;

  if (opcoes.log !== false) {
    registrarLog(resultado, tempoMs);
  }

  return resultado;
}

const FiscalMarginCalculator = {
  calcular,
  calcularApartirDeItens,
  calcularApartirDeTotais,
  VERSAO: 'RC3',
  ALGORITMO: 'FiscalMarginCalculator.RC3'
};

module.exports = FiscalMarginCalculator;
