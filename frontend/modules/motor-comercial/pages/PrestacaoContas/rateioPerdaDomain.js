/**
 * Espelho do domínio RateioPerda (RC4.2) para o bundle frontend.
 * @module frontend/modules/motor-comercial/pages/PrestacaoContas/rateioPerdaDomain
 */

const TIPOS_RATEIO = Object.freeze({
  CLIENTE: 'CLIENTE',
  EMPRESA: 'EMPRESA',
  COMPARTILHADA: 'COMPARTILHADA'
});

const MOTIVOS_PERDA = Object.freeze([
  'DERRETIMENTO',
  'VENCIMENTO',
  'QUEBRA',
  'FURTO',
  'DEFEITO_FREEZER',
  'TRANSPORTE',
  'OUTRO'
]);

const MOTIVO_LABEL = Object.freeze({
  DERRETIMENTO: 'Derretimento',
  VENCIMENTO: 'Vencimento',
  QUEBRA: 'Quebra',
  FURTO: 'Furto',
  DEFEITO_FREEZER: 'Defeito no Freezer',
  TRANSPORTE: 'Transporte',
  OUTRO: 'Outro'
});

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function roundPct(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function calcularRateio(tipo, valorTotal, opts = {}) {
  const total = round2(valorTotal);
  const tipoNorm = String(tipo || TIPOS_RATEIO.CLIENTE).toUpperCase();

  if (total <= 0.001) {
    return {
      tipoRateio: tipoNorm,
      valorTotalPerdas: 0,
      valorCliente: 0,
      valorEmpresa: 0,
      percentualCliente: 0,
      percentualEmpresa: 0
    };
  }

  let valorCliente = 0;
  let valorEmpresa = 0;

  if (tipoNorm === TIPOS_RATEIO.CLIENTE) {
    valorCliente = total;
    valorEmpresa = 0;
  } else if (tipoNorm === TIPOS_RATEIO.EMPRESA) {
    valorCliente = 0;
    valorEmpresa = total;
  } else {
    const campo = opts.campoEditado || null;
    const rawCliente = opts.valorCliente;
    const rawEmpresa = opts.valorEmpresa;

    if (campo === 'cliente' && rawCliente != null && rawCliente !== '') {
      valorCliente = round2(Math.max(0, Number(rawCliente)));
      valorEmpresa = round2(Math.max(0, total - valorCliente));
    } else if (campo === 'empresa' && rawEmpresa != null && rawEmpresa !== '') {
      valorEmpresa = round2(Math.max(0, Number(rawEmpresa)));
      valorCliente = round2(Math.max(0, total - valorEmpresa));
    } else if (rawCliente != null && rawCliente !== '' && (rawEmpresa == null || rawEmpresa === '')) {
      valorCliente = round2(Math.max(0, Number(rawCliente)));
      valorEmpresa = round2(Math.max(0, total - valorCliente));
    } else if (rawEmpresa != null && rawEmpresa !== '' && (rawCliente == null || rawCliente === '')) {
      valorEmpresa = round2(Math.max(0, Number(rawEmpresa)));
      valorCliente = round2(Math.max(0, total - valorEmpresa));
    } else {
      valorCliente = round2(Math.max(0, Number(rawCliente || 0)));
      valorEmpresa = round2(Math.max(0, Number(rawEmpresa || 0)));
    }
  }

  const percentualCliente = total > 0 ? roundPct((valorCliente / total) * 100) : 0;
  const percentualEmpresa = total > 0 ? roundPct((valorEmpresa / total) * 100) : 0;

  return {
    tipoRateio: tipoNorm,
    valorTotalPerdas: total,
    valorCliente,
    valorEmpresa,
    percentualCliente,
    percentualEmpresa
  };
}

function validarRateio(rateio = {}) {
  const total = round2(rateio.valorTotalPerdas);
  const cliente = round2(rateio.valorCliente);
  const empresa = round2(rateio.valorEmpresa);
  const soma = round2(cliente + empresa);

  if (cliente < -0.001 || empresa < -0.001) {
    return { ok: false, erro: 'Valores do rateio não podem ser negativos.' };
  }
  if (Math.abs(soma - total) > 0.01) {
    return {
      ok: false,
      erro: `Cliente + Empresa (${soma.toFixed(2)}) deve ser igual ao valor total das perdas (${total.toFixed(2)}).`
    };
  }

  const tipo = String(rateio.tipoRateio || '').toUpperCase();
  if (!Object.values(TIPOS_RATEIO).includes(tipo)) {
    return { ok: false, erro: 'Tipo de rateio inválido.' };
  }

  const motivo = String(rateio.motivoPerda || '').toUpperCase();
  if (total > 0.01) {
    if (!motivo || !MOTIVOS_PERDA.includes(motivo)) {
      return { ok: false, erro: 'Motivo da perda é obrigatório.' };
    }
    if (motivo === 'OUTRO' && !String(rateio.observacaoPerda || '').trim()) {
      return { ok: false, erro: 'Observação é obrigatória quando o motivo é Outro.' };
    }
  }

  return { ok: true };
}

function buildResumoFinanceiroRateio({
  valorVenda = 0,
  valorRecebido = 0,
  valorPerdas = 0,
  valorCliente = 0,
  valorEmpresa = 0
} = {}) {
  const venda = round2(valorVenda);
  const recebido = round2(valorRecebido);
  const perdas = round2(valorPerdas);
  const clienteAssume = round2(valorCliente);
  const empresaAssume = round2(valorEmpresa);
  const valorLiquidoConsignado = round2(venda + clienteAssume - recebido);

  return {
    valorVenda: venda,
    valorRecebido: recebido,
    perdas,
    clienteAssume,
    empresaAssume,
    valorLiquidoConsignado
  };
}

module.exports = {
  TIPOS_RATEIO,
  MOTIVOS_PERDA,
  MOTIVO_LABEL,
  round2,
  calcularRateio,
  validarRateio,
  buildResumoFinanceiroRateio
};
