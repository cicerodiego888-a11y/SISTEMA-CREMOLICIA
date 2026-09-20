/**
 * EAN-13 — validação no cadastro (a persistência é validada no backend).
 */
(function (root) {
  const PREFIXO = '789';
  const MSG_INVALIDO = 'Código de barras EAN-13 inválido.';
  const MSG_DUPLICADO = 'Este código de barras já está cadastrado em outro produto.';
  const MSG_CONFIRMA_SUBSTITUIR =
    'Este produto já possui um código de barras.\nDeseja gerar um novo código?';

  function stripSpaces(valor) {
    return String(valor == null ? '' : valor).replace(/\s+/g, '');
  }

  function calculateCheckDigit(dozeDigitos) {
    const d = String(dozeDigitos);
    if (!/^\d{12}$/.test(d)) return null;
    let impares = 0;
    let pares = 0;
    for (let i = 0; i < 12; i += 1) {
      const n = Number(d[i]);
      if ((i + 1) % 2 === 1) impares += n;
      else pares += n;
    }
    const soma = impares + pares * 3;
    return (10 - (soma % 10)) % 10;
  }

  function validate(codigo) {
    const limpo = stripSpaces(codigo);
    if (!/^\d{13}$/.test(limpo)) return false;
    const dv = calculateCheckDigit(limpo.slice(0, 12));
    return dv === Number(limpo[12]);
  }

  function somenteDigitos(valor) {
    return stripSpaces(valor).replace(/\D/g, '');
  }

  root.EAN13 = {
    PREFIXO,
    MSG_INVALIDO,
    MSG_DUPLICADO,
    MSG_CONFIRMA_SUBSTITUIR,
    stripSpaces,
    calculateCheckDigit,
    validate,
    somenteDigitos
  };
})(typeof window !== 'undefined' ? window : globalThis);
