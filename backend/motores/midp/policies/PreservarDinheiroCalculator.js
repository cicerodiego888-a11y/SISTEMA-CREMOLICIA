/**
 * PreservarDinheiroCalculator — Algoritmo oficial PRESERVAR_DINHEIRO (RC3 FINAL).
 *
 * Maximiza emissão fiscal com meios eletrônicos.
 * Usa dinheiro somente como complemento mínimo para a próxima
 * unidade comercial fiscal inteira (produto não fracionável).
 *
 * @module motores/midp/policies/PreservarDinheiroCalculator
 */

'use strict';

const MidpDecisionResult = require('../MidpDecisionResult');

const EPS = 0.009;
const QTY_EPS = 1e-9;

const FORMAS_ELETRONICAS = new Set([
  'pix',
  'pix_tef',
  'cartao',
  'cartao_debito',
  'cartao_credito',
  'credito',
  'debito',
  'tef',
  'voucher',
  'vale_alimentacao',
  'vale_refeicao',
  'vale_presente',
  'vale_combustivel',
  'transferencia',
  'deposito'
]);

function arredondar2(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

function arredondarQtd(valor, casas = 6) {
  const f = 10 ** casas;
  return Math.round((Number(valor) || 0) * f) / f;
}

function normalizarForma(forma) {
  return String(forma || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function ehDinheiro(forma) {
  return normalizarForma(forma) === 'dinheiro';
}

function ehEletronico(forma) {
  const n = normalizarForma(forma);
  if (ehDinheiro(n)) return false;
  return FORMAS_ELETRONICAS.has(n);
}

function somarPagamentos(pagamentos, predicado) {
  return arredondar2(
    (pagamentos || []).reduce((acc, p) => {
      if (!predicado(p.forma_pagamento)) return acc;
      return acc + Number(p.valor || 0);
    }, 0)
  );
}

/**
 * Produto fracionável: permite quantidade decimal na emissão fiscal.
 * tipo_venda/modo_venda UNIDADE força inteiro mesmo se o cadastro for fracionado.
 */
function itemEhFracionavel(item = {}) {
  const tipo = String(item.tipo_venda || item.modo_venda || '')
    .toUpperCase()
    .trim();
  if (tipo === 'UNIDADE') return false;

  const flag = Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0);
  if (flag === 1) return true;

  const un = String(item.unidade || item.unidade_comercial || '')
    .toUpperCase()
    .trim();
  return un === 'KG' || un === 'LT' || un === 'L' || un === 'MT' || un === 'M2' || un === 'M3';
}

function lerPrecoUnitario(item) {
  const preco = Number(item.preco_unitario ?? item.preco ?? 0);
  if (preco > 0) return preco;
  const q = Number(item.quantidade_fiscal ?? item.quantidade ?? 0);
  const vf = Number(item.valor_fiscal ?? 0);
  if (q > QTY_EPS && vf > 0) return vf / q;
  return 0;
}

function normalizarItensEntrada(itens) {
  if (!Array.isArray(itens) || itens.length === 0) return [];

  return itens.map((item, index) => {
    const preco = lerPrecoUnitario(item);
    const qTotal = Number(item.quantidade ?? 0);
    let qFiscalMax = item.quantidade_fiscal != null
      ? Number(item.quantidade_fiscal)
      : null;
    const valorFiscalMax = Number(item.valor_fiscal ?? 0);

    if (qFiscalMax == null || Number.isNaN(qFiscalMax)) {
      qFiscalMax = preco > 0 && valorFiscalMax > 0
        ? valorFiscalMax / preco
        : 0;
    }

    qFiscalMax = Math.max(0, Number(qFiscalMax) || 0);
    const qNaoFiscalBase = item.quantidade_nao_fiscal != null
      ? Math.max(0, Number(item.quantidade_nao_fiscal) || 0)
      : Math.max(0, qTotal - qFiscalMax);

    return {
      index,
      preco,
      qTotal,
      qFiscalMax,
      qNaoFiscalBase,
      valorFiscalMax: preco > 0
        ? arredondar2(qFiscalMax * preco)
        : arredondar2(valorFiscalMax),
      valorNaoFiscalBase: arredondar2(
        item.valor_nao_fiscal != null
          ? item.valor_nao_fiscal
          : Math.max(0, (qNaoFiscalBase) * preco)
      ),
      fracionavel: itemEhFracionavel(item),
      raw: item
    };
  }).filter((it) => it.qFiscalMax > QTY_EPS && it.preco > QTY_EPS);
}

/**
 * Decide quantidade fiscal de um item com orçamento eletrônico/dinheiro.
 */
function decidirQuantidadeItem(item, budgetEletronico, budgetDinheiro) {
  const { preco, qFiscalMax, fracionavel } = item;
  let eletronicoRestante = Math.max(0, budgetEletronico);
  let dinheiroRestante = Math.max(0, budgetDinheiro);

  if (fracionavel) {
    const qPorEletronico = eletronicoRestante / preco;
    const qF = arredondarQtd(Math.min(qFiscalMax, Math.max(0, qPorEletronico)));
    const valorF = arredondar2(qF * preco);
    const eletronicoUsado = Math.min(eletronicoRestante, valorF);
    return {
      quantidadeFiscal: qF,
      valorFiscal: arredondar2(eletronicoUsado),
      valorFiscalPIX: arredondar2(eletronicoUsado),
      valorFiscalDinheiro: 0,
      eletronicoUsado: arredondar2(eletronicoUsado),
      dinheiroUsado: 0
    };
  }

  // Não fracionável — somente quantidade inteira
  const qProporcional = eletronicoRestante / preco;
  const qFloor = Math.min(qFiscalMax, Math.floor(qProporcional + QTY_EPS));
  const qCeilCand = Math.ceil(qProporcional - QTY_EPS);
  const qCeil = Math.min(qFiscalMax, qCeilCand);

  let qF = Math.max(0, qFloor);
  let eletronicoUsado = arredondar2(Math.min(eletronicoRestante, qF * preco));
  let dinheiroUsado = 0;

  const ehExato = Math.abs(qProporcional - Math.round(qProporcional)) < 1e-6
    && Math.round(qProporcional) <= qFiscalMax + QTY_EPS;

  if (ehExato) {
    qF = Math.min(qFiscalMax, Math.round(qProporcional));
    eletronicoUsado = arredondar2(Math.min(eletronicoRestante, qF * preco));
    dinheiroUsado = 0;
  } else if (qCeil > qFloor && qCeil <= qFiscalMax + QTY_EPS) {
    const valorCeil = arredondar2(qCeil * preco);
    const eletronicoParaCeil = Math.min(eletronicoRestante, valorCeil);
    const complemento = arredondar2(valorCeil - eletronicoParaCeil);
    if (complemento <= dinheiroRestante + EPS) {
      qF = qCeil;
      eletronicoUsado = arredondar2(eletronicoParaCeil);
      dinheiroUsado = Math.max(0, complemento);
    }
  }

  const valorFiscal = arredondar2(eletronicoUsado + dinheiroUsado);
  return {
    quantidadeFiscal: qF,
    valorFiscal,
    valorFiscalPIX: arredondar2(eletronicoUsado),
    valorFiscalDinheiro: arredondar2(dinheiroUsado),
    eletronicoUsado: arredondar2(eletronicoUsado),
    dinheiroUsado: arredondar2(dinheiroUsado)
  };
}

function montarAjuste(itemNorm, decisaoItem) {
  const qF = Math.max(0, Number(decisaoItem.quantidadeFiscal) || 0);
  const qFClamped = Math.min(itemNorm.qFiscalMax, qF);
  const deltaQ = Math.max(0, itemNorm.qFiscalMax - qFClamped);
  const qNao = arredondarQtd(itemNorm.qNaoFiscalBase + deltaQ);
  const valorF = arredondar2(qFClamped * itemNorm.preco);
  const valorNao = arredondar2(
    itemNorm.valorNaoFiscalBase + arredondar2(deltaQ * itemNorm.preco)
  );

  return {
    index: itemNorm.index,
    quantidade_fiscal: qFClamped,
    quantidade_nao_fiscal: qNao,
    valor_fiscal: valorF,
    valor_nao_fiscal: valorNao,
    fracionavel: itemNorm.fracionavel,
    valorFiscalPIX: Math.min(decisaoItem.valorFiscalPIX || 0, valorF),
    valorFiscalDinheiro: Math.min(
      decisaoItem.valorFiscalDinheiro || 0,
      Math.max(0, valorF - Math.min(decisaoItem.valorFiscalPIX || 0, valorF))
    )
  };
}

/**
 * Expande emissão fiscal até o mínimo obrigatório (usa dinheiro se preciso).
 */
function expandirAteMinimo(ajustes, itensNorm, minimo, dinheiroDisponivel) {
  let total = arredondar2(ajustes.reduce((s, a) => s + a.valor_fiscal, 0));
  let dinheiroRestante = Math.max(0, dinheiroDisponivel);

  if (total + EPS >= minimo) {
    return { ajustes, dinheiroUsadoExtra: 0 };
  }

  let falta = arredondar2(minimo - total);
  let dinheiroUsadoExtra = 0;

  for (let i = 0; i < ajustes.length && falta > EPS; i += 1) {
    const adj = ajustes[i];
    const item = itensNorm.find((it) => it.index === adj.index);
    if (!item) continue;

    const qAtual = adj.quantidade_fiscal;
    const qMax = item.qFiscalMax;
    const preco = item.preco;
    if (qAtual + QTY_EPS >= qMax) continue;

    if (item.fracionavel) {
      const qExtraMax = qMax - qAtual;
      const qExtraPorValor = falta / preco;
      const qExtraPorDinheiro = dinheiroRestante / preco;
      const qExtra = arredondarQtd(Math.min(qExtraMax, qExtraPorValor, qExtraPorDinheiro));
      if (qExtra <= QTY_EPS) continue;
      const valorExtra = arredondar2(qExtra * preco);
      adj.quantidade_fiscal = arredondarQtd(qAtual + qExtra);
      adj.quantidade_nao_fiscal = arredondarQtd(
        Math.max(0, adj.quantidade_nao_fiscal - qExtra)
      );
      adj.valor_fiscal = arredondar2(adj.quantidade_fiscal * preco);
      adj.valor_nao_fiscal = arredondar2(
        Math.max(0, adj.valor_nao_fiscal - valorExtra)
      );
      adj.valorFiscalDinheiro = arredondar2(
        (adj.valorFiscalDinheiro || 0) + valorExtra
      );
      dinheiroRestante = arredondar2(dinheiroRestante - valorExtra);
      dinheiroUsadoExtra = arredondar2(dinheiroUsadoExtra + valorExtra);
      falta = arredondar2(falta - valorExtra);
      continue;
    }

    // Inteiro: sobe de 1 em 1
    let q = Math.floor(qAtual + QTY_EPS);
    while (q + 1 <= qMax + QTY_EPS && falta > EPS) {
      const valorExtra = arredondar2(preco);
      if (valorExtra > dinheiroRestante + EPS && valorExtra > falta + EPS) {
        // Ainda assim precisamos do mínimo — usa o que houver
        if (dinheiroRestante + EPS < valorExtra) break;
      }
      if (valorExtra > dinheiroRestante + EPS) break;
      q += 1;
      adj.quantidade_fiscal = q;
      adj.quantidade_nao_fiscal = arredondarQtd(
        Math.max(0, adj.quantidade_nao_fiscal - 1)
      );
      adj.valor_fiscal = arredondar2(q * preco);
      adj.valor_nao_fiscal = arredondar2(
        Math.max(0, adj.valor_nao_fiscal - valorExtra)
      );
      adj.valorFiscalDinheiro = arredondar2(
        (adj.valorFiscalDinheiro || 0) + valorExtra
      );
      dinheiroRestante = arredondar2(dinheiroRestante - valorExtra);
      dinheiroUsadoExtra = arredondar2(dinheiroUsadoExtra + valorExtra);
      falta = arredondar2(falta - valorExtra);
    }
  }

  return { ajustes, dinheiroUsadoExtra };
}

/**
 * Reduz emissão fiscal até o máximo (preserva eletrônicos; corta do fim).
 */
function reduzirAteMaximo(ajustes, itensNorm, maximo) {
  let total = arredondar2(ajustes.reduce((s, a) => s + a.valor_fiscal, 0));
  if (total <= maximo + EPS) return ajustes;

  let excesso = arredondar2(total - maximo);

  for (let i = ajustes.length - 1; i >= 0 && excesso > EPS; i -= 1) {
    const adj = ajustes[i];
    const item = itensNorm.find((it) => it.index === adj.index);
    if (!item) continue;
    const preco = item.preco;

    if (item.fracionavel) {
      const qReduzir = Math.min(adj.quantidade_fiscal, excesso / preco);
      const q = arredondarQtd(Math.max(0, adj.quantidade_fiscal - qReduzir));
      const valorNovo = arredondar2(q * preco);
      const deltaV = arredondar2(adj.valor_fiscal - valorNovo);
      adj.quantidade_fiscal = q;
      adj.quantidade_nao_fiscal = arredondarQtd(adj.quantidade_nao_fiscal + qReduzir);
      adj.valor_fiscal = valorNovo;
      adj.valor_nao_fiscal = arredondar2(adj.valor_nao_fiscal + deltaV);
      // Prioriza cortar dinheiro fiscal, depois eletrônico
      const cortaDinheiro = Math.min(adj.valorFiscalDinheiro || 0, deltaV);
      adj.valorFiscalDinheiro = arredondar2((adj.valorFiscalDinheiro || 0) - cortaDinheiro);
      adj.valorFiscalPIX = arredondar2(
        Math.max(0, (adj.valorFiscalPIX || 0) - (deltaV - cortaDinheiro))
      );
      excesso = arredondar2(excesso - deltaV);
      continue;
    }

    while (adj.quantidade_fiscal >= 1 - QTY_EPS && excesso > EPS) {
      const valorExtra = arredondar2(preco);
      adj.quantidade_fiscal = Math.max(0, Math.floor(adj.quantidade_fiscal + QTY_EPS) - 1);
      adj.quantidade_nao_fiscal = arredondarQtd(adj.quantidade_nao_fiscal + 1);
      adj.valor_fiscal = arredondar2(adj.quantidade_fiscal * preco);
      adj.valor_nao_fiscal = arredondar2(adj.valor_nao_fiscal + valorExtra);
      const cortaDinheiro = Math.min(adj.valorFiscalDinheiro || 0, valorExtra);
      adj.valorFiscalDinheiro = arredondar2((adj.valorFiscalDinheiro || 0) - cortaDinheiro);
      adj.valorFiscalPIX = arredondar2(
        Math.max(0, (adj.valorFiscalPIX || 0) - (valorExtra - cortaDinheiro))
      );
      excesso = arredondar2(excesso - valorExtra);
    }
  }

  return ajustes;
}

/**
 * Fallback monetário (sem itens) — RC3 inicial / compatibilidade.
 */
function decidirSomenteValor(intervalo, pagamentos) {
  const {
    valorFiscalMaximo,
    valorFiscalMinimo,
    possuiMargemFiscal,
    valorNaoFiscal
  } = intervalo;

  const valorEletronico = somarPagamentos(pagamentos, ehEletronico);
  const valorDinheiro = somarPagamentos(pagamentos, ehDinheiro);

  let valorFiscalEfetivo;
  if (!possuiMargemFiscal) {
    valorFiscalEfetivo = valorFiscalMaximo;
  } else {
    valorFiscalEfetivo = arredondar2(
      Math.min(valorFiscalMaximo, Math.max(valorFiscalMinimo, valorEletronico))
    );
  }

  valorFiscalEfetivo = arredondar2(
    Math.min(valorFiscalMaximo, Math.max(valorFiscalMinimo, valorFiscalEfetivo))
  );

  const valorFiscalPIX = arredondar2(Math.min(valorEletronico, valorFiscalEfetivo));
  const valorFiscalDinheiro = arredondar2(
    Math.max(0, valorFiscalEfetivo - valorFiscalPIX)
  );
  const economiaDinheiro = arredondar2(valorFiscalMaximo - valorFiscalEfetivo);
  const valorNaoFiscalAjustado = arredondar2(valorNaoFiscal + economiaDinheiro);

  return {
    valorFiscalEfetivo,
    quantidadeFiscal: 0,
    quantidadeNaoFiscal: 0,
    valorFiscalPIX,
    valorFiscalDinheiro,
    valorNaoFiscal: valorNaoFiscalAjustado,
    economiaDinheiro,
    valorEletronico,
    valorDinheiro,
    itensAjuste: null
  };
}

/**
 * Algoritmo oficial com itens (quantidade × fracionável/inteiro).
 */
function decidirComItens(intervalo, pagamentos, itens) {
  const {
    valorFiscalMaximo,
    valorFiscalMinimo,
    possuiMargemFiscal,
    valorNaoFiscal
  } = intervalo;

  const valorEletronico = somarPagamentos(pagamentos, ehEletronico);
  const valorDinheiro = somarPagamentos(pagamentos, ehDinheiro);
  const itensNorm = normalizarItensEntrada(itens);

  if (itensNorm.length === 0) {
    return decidirSomenteValor(intervalo, pagamentos);
  }

  if (!possuiMargemFiscal) {
    const ajustes = itensNorm.map((it) => montarAjuste(it, {
      quantidadeFiscal: it.qFiscalMax,
      valorFiscalPIX: 0,
      valorFiscalDinheiro: 0
    }));
    const valorFiscalEfetivo = arredondar2(
      ajustes.reduce((s, a) => s + a.valor_fiscal, 0)
    );
    // Classifica pagamentos no máximo: eletrônico primeiro
    const pix = arredondar2(Math.min(valorEletronico, valorFiscalEfetivo));
    const din = arredondar2(Math.max(0, valorFiscalEfetivo - pix));
    let pixRest = pix;
    let dinRest = din;
    for (const a of ajustes) {
      const alocaPix = Math.min(pixRest, a.valor_fiscal);
      a.valorFiscalPIX = alocaPix;
      a.valorFiscalDinheiro = arredondar2(a.valor_fiscal - alocaPix);
      pixRest = arredondar2(pixRest - alocaPix);
      dinRest = arredondar2(dinRest - a.valorFiscalDinheiro);
    }
    return {
      valorFiscalEfetivo,
      quantidadeFiscal: arredondarQtd(ajustes.reduce((s, a) => s + a.quantidade_fiscal, 0)),
      quantidadeNaoFiscal: arredondarQtd(ajustes.reduce((s, a) => s + a.quantidade_nao_fiscal, 0)),
      valorFiscalPIX: pix,
      valorFiscalDinheiro: din,
      valorNaoFiscal: arredondar2(valorNaoFiscal),
      economiaDinheiro: 0,
      valorEletronico,
      valorDinheiro,
      itensAjuste: completarAjustesAusentes(itens, ajustes)
    };
  }

  // Fracionáveis primeiro (consomem eletrônico com precisão), depois inteiros
  const ordem = [
    ...itensNorm.filter((it) => it.fracionavel),
    ...itensNorm.filter((it) => !it.fracionavel)
  ];

  let budgetE = valorEletronico;
  let budgetD = valorDinheiro;
  const decisoes = new Map();

  for (const item of ordem) {
    const d = decidirQuantidadeItem(item, budgetE, budgetD);
    decisoes.set(item.index, d);
    budgetE = arredondar2(budgetE - d.eletronicoUsado);
    budgetD = arredondar2(budgetD - d.dinheiroUsado);
  }

  let ajustes = itensNorm.map((it) => montarAjuste(it, decisoes.get(it.index)));

  // Dinheiro ainda disponível (não usado no complemento) para atingir mínimo
  const dinheiroAposComplementos = budgetD;
  const expandido = expandirAteMinimo(
    ajustes,
    itensNorm,
    valorFiscalMinimo,
    dinheiroAposComplementos
  );
  ajustes = expandido.ajustes;

  ajustes = reduzirAteMaximo(ajustes, itensNorm, valorFiscalMaximo);

  let valorFiscalEfetivo = arredondar2(
    ajustes.reduce((s, a) => s + a.valor_fiscal, 0)
  );
  valorFiscalEfetivo = arredondar2(
    Math.min(valorFiscalMaximo, Math.max(valorFiscalMinimo, valorFiscalEfetivo))
  );

  let valorFiscalPIX = arredondar2(
    ajustes.reduce((s, a) => s + Number(a.valorFiscalPIX || 0), 0)
  );
  let valorFiscalDinheiro = arredondar2(
    ajustes.reduce((s, a) => s + Number(a.valorFiscalDinheiro || 0), 0)
  );

  // Reconcilia classificação com o efetivo final
  const somaClass = arredondar2(valorFiscalPIX + valorFiscalDinheiro);
  if (Math.abs(somaClass - valorFiscalEfetivo) > EPS) {
    valorFiscalPIX = arredondar2(Math.min(valorEletronico, valorFiscalEfetivo));
    valorFiscalDinheiro = arredondar2(Math.max(0, valorFiscalEfetivo - valorFiscalPIX));
  }

  const economiaDinheiro = arredondar2(valorFiscalMaximo - valorFiscalEfetivo);
  const valorNaoFiscalAjustado = arredondar2(valorNaoFiscal + economiaDinheiro);

  const quantidadeFiscal = arredondarQtd(
    ajustes.reduce((s, a) => s + a.quantidade_fiscal, 0)
  );
  const quantidadeNaoFiscal = arredondarQtd(
    ajustes.reduce((s, a) => s + a.quantidade_nao_fiscal, 0)
  );

  return {
    valorFiscalEfetivo,
    quantidadeFiscal,
    quantidadeNaoFiscal,
    valorFiscalPIX,
    valorFiscalDinheiro,
    valorNaoFiscal: valorNaoFiscalAjustado,
    economiaDinheiro,
    valorEletronico,
    valorDinheiro,
    itensAjuste: completarAjustesAusentes(itens, ajustes)
  };
}

function completarAjustesAusentes(itensOriginais, ajustes) {
  if (!Array.isArray(itensOriginais)) return ajustes;
  const byIndex = new Map(ajustes.map((a) => [a.index, a]));
  return itensOriginais.map((item, index) => {
    if (byIndex.has(index)) {
      const a = byIndex.get(index);
      return {
        index,
        quantidade_fiscal: a.quantidade_fiscal,
        quantidade_nao_fiscal: a.quantidade_nao_fiscal,
        valor_fiscal: a.valor_fiscal,
        valor_nao_fiscal: a.valor_nao_fiscal
      };
    }
    return {
      index,
      quantidade_fiscal: Number(item.quantidade_fiscal || 0),
      quantidade_nao_fiscal: Number(item.quantidade_nao_fiscal || 0),
      valor_fiscal: Number(item.valor_fiscal || 0),
      valor_nao_fiscal: Number(item.valor_nao_fiscal || 0)
    };
  });
}

/**
 * Entrada principal do calculator.
 *
 * @param {object} intervalo
 * @param {Array} pagamentos
 * @param {Array} [itens]
 * @returns {MidpDecisionResult}
 */
function calcular(intervalo, pagamentos, itens) {
  const inicio = Date.now();
  const raw = Array.isArray(itens) && itens.length > 0
    ? decidirComItens(intervalo, pagamentos, itens)
    : decidirSomenteValor(intervalo, pagamentos);

  return new MidpDecisionResult({
    valorFiscalEfetivo: raw.valorFiscalEfetivo,
    quantidadeFiscal: raw.quantidadeFiscal,
    valorFiscalPIX: raw.valorFiscalPIX,
    valorFiscalDinheiro: raw.valorFiscalDinheiro,
    valorNaoFiscal: raw.valorNaoFiscal,
    quantidadeNaoFiscal: raw.quantidadeNaoFiscal,
    economiaDinheiro: raw.economiaDinheiro,
    politica: 'PRESERVAR_DINHEIRO',
    algoritmo: 'PreservarDinheiroPolicy.RC3.FINAL',
    versao: MidpDecisionResult.VERSAO,
    tempoMs: Date.now() - inicio,
    valorFiscalMaximo: intervalo.valorFiscalMaximo,
    valorFiscalMinimo: intervalo.valorFiscalMinimo,
    margemFiscalDisponivel: intervalo.margemFiscalDisponivel,
    valorEletronico: raw.valorEletronico,
    valorDinheiro: raw.valorDinheiro,
    itensAjuste: raw.itensAjuste
  });
}

module.exports = {
  calcular,
  decidirSomenteValor,
  decidirComItens,
  itemEhFracionavel,
  decidirQuantidadeItem,
  FORMAS_ELETRONICAS,
  ehEletronico,
  ehDinheiro,
  somarPagamentos,
  arredondar2
};
