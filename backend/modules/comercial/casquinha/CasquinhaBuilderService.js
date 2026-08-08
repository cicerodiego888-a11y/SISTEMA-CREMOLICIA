/**
 * CasquinhaBuilderService (RCM-05.8)
 *
 * Responsável apenas pela montagem (bolas × sabores).
 * Preço/canal/forma vêm exclusivamente do ComercialPrecoResolver.
 */

function erro(mensagem, statusCode = 400, code = 'CASQUINHA_INVALIDA') {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function normalizarSabores(sabores = []) {
  return (Array.isArray(sabores) ? sabores : [])
    .map((s, idx) => {
      if (s == null) return null;
      if (typeof s === 'string') {
        const nome = s.trim();
        return nome ? { id: null, nome, sequencia: idx + 1 } : null;
      }
      const nome = String(s.nome || s.descricao || '').trim();
      if (!nome) return null;
      return {
        id: s.id != null && Number(s.id) > 0 ? Number(s.id) : null,
        nome,
        codigo: s.codigo || null,
        cor: s.cor || null,
        sequencia: s.sequencia != null ? Number(s.sequencia) : idx + 1
      };
    })
    .filter(Boolean);
}

function resolverLimites(opts = {}) {
  let min = Number(opts.bolas_min ?? opts.casquinha_bolas_min ?? 1);
  let max = Number(opts.bolas_max ?? opts.casquinha_bolas_max ?? 4);
  if (!Number.isFinite(min) || min < 1) min = 1;
  if (!Number.isFinite(max) || max < min) max = Math.max(min, 4);
  min = Math.min(4, Math.round(min));
  max = Math.min(4, Math.round(max));
  if (max < min) max = min;
  return { bolas_min: min, bolas_max: max };
}

function flagPermitirRepetir(v) {
  if (v === false || v === 0 || v === '0' || v === 'N' || v === 'NAO' || v === 'NÃO') return false;
  return true;
}

/**
 * Valida montagem da casquinha.
 * @param {object} input
 * @param {number} input.quantidade_bolas
 * @param {Array} input.sabores
 * @param {number} [input.bolas_min]
 * @param {number} [input.bolas_max]
 * @param {boolean|number} [input.permitir_repetir]
 * @returns {{ ok: true, quantidade_bolas: number, sabores: Array, resumo: object }}
 */
function validarMontagem(input = {}) {
  const limites = resolverLimites(input);
  const permitirRepetir = flagPermitirRepetir(
    input.permitir_repetir ?? input.casquinha_permitir_repetir ?? true
  );
  const bolas = Math.round(Number(input.quantidade_bolas || input.bolas || 0));
  if (!Number.isFinite(bolas) || bolas < limites.bolas_min || bolas > limites.bolas_max) {
    throw erro(
      `Quantidade de bolas deve ser entre ${limites.bolas_min} e ${limites.bolas_max}`,
      400,
      'CASQUINHA_BOLAS_INVALIDAS'
    );
  }

  const sabores = normalizarSabores(input.sabores);
  if (sabores.length !== bolas) {
    throw erro(
      `Selecione exatamente ${bolas} sabor(es) (recebido: ${sabores.length})`,
      400,
      'CASQUINHA_SABORES_QTD'
    );
  }

  if (!permitirRepetir) {
    const vistos = new Set();
    for (const s of sabores) {
      const key = String(s.nome).toUpperCase();
      if (vistos.has(key)) {
        throw erro(
          'Repetição de sabores não permitida nesta configuração',
          400,
          'CASQUINHA_REPETICAO'
        );
      }
      vistos.add(key);
    }
  }

  const resumo = montarResumo({ quantidade_bolas: bolas, sabores });
  return {
    ok: true,
    quantidade_bolas: bolas,
    sabores,
    permitir_repetir: permitirRepetir,
    ...limites,
    resumo
  };
}

function montarResumo({ quantidade_bolas, sabores = [], preco = null } = {}) {
  const bolas = Math.round(Number(quantidade_bolas || 0));
  const lista = normalizarSabores(sabores);
  return {
    titulo: `Casquinha ${bolas} Bola${bolas === 1 ? '' : 's'}`,
    quantidade_bolas: bolas,
    sabores: lista.map((s) => s.nome),
    sabores_texto: lista.map((s) => s.nome).join(', '),
    preco: preco != null ? Number(preco) : null
  };
}

/**
 * Opções de bolas para UI (1..max dentro do intervalo).
 */
function opcoesBolas(opts = {}) {
  const { bolas_min: min, bolas_max: max } = resolverLimites(opts);
  const out = [];
  for (let n = min; n <= max; n += 1) out.push(n);
  return out;
}

module.exports = {
  validarMontagem,
  montarResumo,
  normalizarSabores,
  resolverLimites,
  opcoesBolas,
  flagPermitirRepetir
};
