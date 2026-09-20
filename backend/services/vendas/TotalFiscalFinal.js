'use strict';

/**
 * RC4.31 — Fonte única do total fiscal líquido usado na validação de pagamento.
 * Deve equivaler ao conceito de ICMSTot.vNF (produtos − desconto + encargos).
 */

const TOLERANCIA_MONETARIA = 0.01;

function arredondar2(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

/**
 * Total fiscal final (líquido) alinhado a ICMSTot.vNF.
 *
 * Fórmula oficial:
 * vProd - vDesc + vFrete + vSeguro + vOutro + vII + vIPI - vIPIDevol
 *
 * @param {object} params
 * @param {number} params.valorProdutosFiscal — vProd
 * @param {number} [params.descontoFiscal] — vDesc
 * @param {number} [params.frete] — vFrete
 * @param {number} [params.seguro] — vSeg
 * @param {number} [params.outrasDespesas] — vOutro
 * @param {number} [params.acrescimos] — alias de vOutro (compatível)
 * @param {number} [params.ii] — vII
 * @param {number} [params.ipi] — vIPI
 * @param {number} [params.ipiDevol] — vIPIDevol
 * @returns {number}
 */
function obterTotalFiscalFinal({
  valorProdutosFiscal = 0,
  descontoFiscal = 0,
  frete = 0,
  seguro = 0,
  outrasDespesas = 0,
  acrescimos = 0,
  ii = 0,
  ipi = 0,
  ipiDevol = 0
} = {}) {
  const produtos = arredondar2(valorProdutosFiscal);
  const desconto = Math.max(0, arredondar2(descontoFiscal));
  const vOutro = arredondar2(Number(outrasDespesas || 0) + Number(acrescimos || 0));
  const extras = arredondar2(
    Number(frete || 0)
    + Number(seguro || 0)
    + vOutro
    + Number(ii || 0)
    + Number(ipi || 0)
    - Number(ipiDevol || 0)
  );
  return arredondar2(Math.max(0, produtos - desconto + extras));
}

/**
 * Valida consistência vNF == fórmula oficial (tolerância R$ 0,01).
 * @returns {{ ok: boolean, esperado: number, informado: number, delta: number }}
 */
function validarTotalFiscalFinalXml({
  vProd = 0,
  vDesc = 0,
  vFrete = 0,
  vSeg = 0,
  vOutro = 0,
  vII = 0,
  vIPI = 0,
  vIPIDevol = 0,
  vNF = 0
} = {}) {
  const esperado = obterTotalFiscalFinal({
    valorProdutosFiscal: vProd,
    descontoFiscal: vDesc,
    frete: vFrete,
    seguro: vSeg,
    outrasDespesas: vOutro,
    ii: vII,
    ipi: vIPI,
    ipiDevol: vIPIDevol
  });
  const informado = arredondar2(vNF);
  const delta = arredondar2(Math.abs(esperado - informado));
  return {
    ok: delta <= TOLERANCIA_MONETARIA,
    esperado,
    informado,
    delta
  };
}

/**
 * Se o PDV mandou o total líquido e o desconto veio 0 (ou formato inválido),
 * reconstitui o desconto por bruto − total.
 */
function inferirDescontoGlobal({
  bruto = 0,
  desconto = 0,
  acrescimo = 0,
  totalInformado = null
} = {}) {
  let d = Math.max(0, arredondar2(desconto));
  const b = arredondar2(bruto);
  const a = arredondar2(acrescimo);
  const t = totalInformado == null || totalInformado === ''
    ? NaN
    : arredondar2(totalInformado);
  if (d <= 0.009 && Number.isFinite(t) && b > 0) {
    const implicito = arredondar2(b + a - t);
    if (implicito > 0.009) d = implicito;
  }
  return d;
}

/**
 * Rateia desconto (e acréscimo) global entre fiscal e não fiscal —
 * paridade com frontend/pdv/js/pdv.js → aplicarDescontoProporcionalDistribuicao.
 *
 * @returns {{ valorFiscal: number, valorNaoFiscal: number, descontoFiscal: number, descontoNaoFiscal: number }}
 */
function aplicarDescontoProporcionalTotais({
  valorFiscal = 0,
  valorNaoFiscal = 0,
  desconto = 0,
  acrescimo = 0
} = {}) {
  const brutoFiscal = arredondar2(valorFiscal);
  const brutoNaoFiscal = arredondar2(valorNaoFiscal);
  const subtotalNum = arredondar2(brutoFiscal + brutoNaoFiscal);
  const descontoNum = Math.max(0, arredondar2(desconto));
  const acrescimoNum = arredondar2(acrescimo);
  const totalLiquido = arredondar2(Math.max(0, subtotalNum - descontoNum + acrescimoNum));

  if (subtotalNum <= 0 || (descontoNum <= 0 && acrescimoNum === 0) || totalLiquido === subtotalNum) {
    return {
      valorFiscal: brutoFiscal,
      valorNaoFiscal: brutoNaoFiscal,
      descontoFiscal: 0,
      descontoNaoFiscal: 0
    };
  }

  const fator = totalLiquido / subtotalNum;
  let liquidoFiscal = arredondar2(brutoFiscal * fator);
  let liquidoNaoFiscal = arredondar2(brutoNaoFiscal * fator);
  const diff = arredondar2(totalLiquido - liquidoFiscal - liquidoNaoFiscal);

  if (diff !== 0) {
    if (liquidoFiscal >= liquidoNaoFiscal) {
      liquidoFiscal = arredondar2(liquidoFiscal + diff);
    } else {
      liquidoNaoFiscal = arredondar2(liquidoNaoFiscal + diff);
    }
  }

  return {
    valorFiscal: liquidoFiscal,
    valorNaoFiscal: liquidoNaoFiscal,
    descontoFiscal: arredondar2(Math.max(0, brutoFiscal - liquidoFiscal)),
    descontoNaoFiscal: arredondar2(Math.max(0, brutoNaoFiscal - liquidoNaoFiscal))
  };
}

/**
 * Snapshot de FiscalOperacional com totais líquidos para MIDP/pagamento.
 * Não altera itens nem o motor fiscal — só o alvo de pagamento.
 */
function montarFiscalOperacionalPagamento(fiscalOperacional, totaisLiquidos) {
  const valorFiscal = arredondar2(totaisLiquidos.valorFiscal);
  const valorNaoFiscal = arredondar2(totaisLiquidos.valorNaoFiscal);
  const base = fiscalOperacional && typeof fiscalOperacional === 'object'
    ? fiscalOperacional
    : {};

  return {
    ...base,
    totalFiscal: valorFiscal,
    totalNaoFiscal: valorNaoFiscal,
    valorFiscal,
    valorNaoFiscal,
    valorFiscalMaximo: valorFiscal,
    valorFiscalMinimo: Math.min(
      Number(base.valorFiscalMinimo != null ? base.valorFiscalMinimo : valorFiscal),
      valorFiscal
    ),
    valorFiscalEfetivo: valorFiscal,
    margemFiscalDisponivel: 0,
    possuiMargemFiscal: false
  };
}

/**
 * Comparação monetária com tolerância de R$ 0,01.
 * ValorPagoFiscal >= TotalFiscalFinal (dentro da tolerância).
 */
function pagamentoFiscalSuficiente(valorPagoFiscal, totalFiscalFinal) {
  const pago = arredondar2(valorPagoFiscal);
  const alvo = arredondar2(totalFiscalFinal);
  if (alvo <= 0) {
    return true;
  }
  return pago + TOLERANCIA_MONETARIA >= alvo;
}

function somarPagamentos(pagamentos = []) {
  return arredondar2(
    (Array.isArray(pagamentos) ? pagamentos : []).reduce(
      (acc, p) => acc + Number(p.valor || 0),
      0
    )
  );
}

/**
 * Log de auditoria RC4.31 (instrumentação da falha bruto vs líquido).
 */
function logAuditoriaPagamentoFiscal(contexto = {}) {
  const stack = new Error().stack;
  console.log('[RC4.31] Validação pagamento fiscal', {
    classe: contexto.classe || null,
    metodo: contexto.metodo || null,
    valorProdutos: contexto.valorProdutos != null ? arredondar2(contexto.valorProdutos) : null,
    valorDesconto: contexto.valorDesconto != null ? arredondar2(contexto.valorDesconto) : null,
    valorLiquido: contexto.valorLiquido != null ? arredondar2(contexto.valorLiquido) : null,
    valorFiscal: contexto.valorFiscal != null ? arredondar2(contexto.valorFiscal) : null,
    valorPago: contexto.valorPago != null ? arredondar2(contexto.valorPago) : null,
    valorComparado: contexto.valorComparado != null ? arredondar2(contexto.valorComparado) : null,
    saldoFiscal: contexto.saldoFiscal != null ? arredondar2(contexto.saldoFiscal) : null,
    suficiente: contexto.suficiente,
    stack: stack ? String(stack).split('\n').slice(0, 8).join('\n') : null
  });
}

module.exports = {
  TOLERANCIA_MONETARIA,
  arredondar2,
  obterTotalFiscalFinal,
  validarTotalFiscalFinalXml,
  inferirDescontoGlobal,
  aplicarDescontoProporcionalTotais,
  montarFiscalOperacionalPagamento,
  pagamentoFiscalSuficiente,
  somarPagamentos,
  logAuditoriaPagamentoFiscal
};
