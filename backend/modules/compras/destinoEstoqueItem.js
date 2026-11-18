/**
 * Destino de estoque de um item de compra.
 * Natureza do produto não define o local. Compra antiga sem destino permanece Loja.
 */

const LOCAIS = ['FABRICA', 'LOJA'];
const MENSAGEM_SEM_DESTINO = 'Informe o destino do estoque de cada item da compra.';
const MENSAGEM_DESTINO_INVALIDO = 'O destino do estoque deve ser Fábrica ou Loja.';

function codigoInformado(item) {
  return String(item?.destino_estoque || item?.local_codigo || item?.local || '').trim().toUpperCase();
}

function sugerirDestinoEstoque(natureza) {
  return String(natureza || '').trim().toUpperCase() === 'INSUMO' ? 'FABRICA' : 'LOJA';
}

function resolverDestinoItemCompra(item, opcoes = {}) {
  const codigo = codigoInformado(item);
  if (!codigo) {
    if (opcoes.legadoSemLocal) {
      return { local: 'LOJA', local_id: null, herdado: true };
    }
    const err = new Error(MENSAGEM_SEM_DESTINO);
    err.status = 400;
    err.codigo = 'DESTINO_ESTOQUE_OBRIGATORIO';
    throw err;
  }
  if (!LOCAIS.includes(codigo)) {
    const err = new Error(MENSAGEM_DESTINO_INVALIDO);
    err.status = 400;
    err.codigo = 'DESTINO_ESTOQUE_INVALIDO';
    throw err;
  }
  return { local: codigo, local_id: null, herdado: false };
}

function vincularUnidadeDestino(destino, unidades) {
  const lista = Array.isArray(unidades) ? unidades : [];
  const achada = lista.find((unidade) => {
    const tipo = String(unidade.tipo || '').toUpperCase();
    const codigo = String(unidade.codigo || '').toUpperCase();
    return tipo === destino.local || codigo === destino.local;
  });
  return { ...destino, local_id: achada ? Number(achada.id) : null };
}

function interpretarLocalHistorico(item) {
  const codigo = codigoInformado(item);
  if (LOCAIS.includes(codigo)) return codigo;
  if (item && item.local_id != null && item.local_id !== '' && item.local_codigo_unidade) {
    const unidade = String(item.local_codigo_unidade).trim().toUpperCase();
    if (LOCAIS.includes(unidade)) return unidade;
  }
  return 'LOJA';
}

module.exports = {
  MENSAGEM_SEM_DESTINO,
  MENSAGEM_DESTINO_INVALIDO,
  sugerirDestinoEstoque,
  resolverDestinoItemCompra,
  vincularUnidadeDestino,
  interpretarLocalHistorico
};
