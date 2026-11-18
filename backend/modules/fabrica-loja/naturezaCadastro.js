/**
 * Grava a natureza oficial do produto e as observações já existentes.
 * Não cria tabela, não calcula preço e não mexe em estoque.
 */

const NATUREZAS_CADASTRO = new Set(['INSUMO', 'PRODUZIDO', 'COMERCIAL']);

function classificarNatureza(valor) {
  const natureza = String(valor || '').trim().toUpperCase();
  return NATUREZAS_CADASTRO.has(natureza) ? natureza : null;
}

/**
 * Insumo nunca vira PRODUZIDO pela edição do cadastro: o estoque e as fichas dele
 * são de matéria-prima. Retorna a natureza normalizada (ou undefined se não veio).
 */
function validarTransicaoNatureza(naturezaAtual, naturezaInformada) {
  if (naturezaInformada === undefined || naturezaInformada === null || naturezaInformada === '') return undefined;
  const nova = classificarNatureza(naturezaInformada);
  if (!nova) {
    const falha = new Error('Natureza do cadastro inválida.');
    falha.statusCode = 400;
    falha.code = 'NATUREZA_INVALIDA';
    throw falha;
  }
  if (String(naturezaAtual || '').toUpperCase() === 'INSUMO' && nova === 'PRODUZIDO') {
    const falha = new Error('Insumo não pode ser reclassificado como PRODUZIDO.');
    falha.statusCode = 400;
    falha.code = 'NATUREZA_INSUMO_PARA_PRODUZIDO';
    throw falha;
  }
  return nova;
}

function aplicarNaturezaCadastro(db, produtoId, body) {
  const natureza = classificarNatureza(body && body.natureza_cadastro);
  const temObservacao = !!(
    body
    && Object.prototype.hasOwnProperty.call(body, 'observacoes')
    && body.observacoes != null
  );
  if (!natureza && !temObservacao) {
    return Promise.resolve(false);
  }

  const campos = [];
  const valores = [];
  if (natureza) {
    campos.push('natureza_cadastro = ?');
    valores.push(natureza);
  }
  if (temObservacao) {
    campos.push('observacoes = ?');
    valores.push(String(body.observacoes));
  }
  valores.push(produtoId);

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE produtos SET ${campos.join(', ')} WHERE id = ?`,
      valores,
      (err) => (err ? reject(err) : resolve(true))
    );
  });
}

module.exports = {
  NATUREZAS_CADASTRO,
  classificarNatureza,
  validarTransicaoNatureza,
  aplicarNaturezaCadastro
};
