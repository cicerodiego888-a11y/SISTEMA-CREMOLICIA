/**
 * Fábrica × Loja.
 * A operação atual do CDS permanece a Loja.
 * A ficha técnica descreve a fabricação. A necessidade registra o que falta produzir.
 * A ordem de produção registra o que a fábrica pretende produzir.
 * A execução transforma insumos em produto produzido pelo Motor de Estoque oficial.
 * A identificação do produto em qualquer operação é o produto_id do cadastro oficial.
 * Texto digitado serve apenas para pesquisar. Não vincula e não cria produto.
 */

const VERSAO = '0.7.0';

const TIPO_UNIDADE = Object.freeze({
  LOJA: 'LOJA',
  FABRICA: 'FABRICA'
});

const FORA_DE_ESCOPO = Object.freeze([
  'COMPRAS',
  'FISCAL'
]);

const ORIGEM_NECESSIDADE = Object.freeze({
  PEDIDO_LOJA: 'PEDIDO_LOJA',
  ABASTECIMENTO: 'ABASTECIMENTO',
  PLANEJAMENTO: 'PLANEJAMENTO',
  MANUAL: 'MANUAL'
});

const STATUS_NECESSIDADE = Object.freeze({
  ABERTA: 'ABERTA',
  PARCIALMENTE_ATENDIDA: 'PARCIALMENTE_ATENDIDA',
  ATENDIDA: 'ATENDIDA',
  CANCELADA: 'CANCELADA'
});

const ORIGEM_ORDEM = Object.freeze({
  NECESSIDADE: 'NECESSIDADE',
  PEDIDO_LOJA: 'PEDIDO_LOJA',
  ABASTECIMENTO: 'ABASTECIMENTO',
  PLANEJAMENTO: 'PLANEJAMENTO',
  MANUAL: 'MANUAL'
});

const STATUS_ORDEM = Object.freeze({
  RASCUNHO: 'RASCUNHO',
  PLANEJADA: 'PLANEJADA',
  EM_PRODUCAO: 'EM_PRODUCAO',
  CONCLUIDA: 'CONCLUIDA',
  CANCELADA: 'CANCELADA'
});

const PRIORIDADE_ORDEM = Object.freeze({
  BAIXA: 'BAIXA',
  NORMAL: 'NORMAL',
  ALTA: 'ALTA',
  URGENTE: 'URGENTE'
});

const CODIGO_LOJA_ATUAL = 'LOJA';

module.exports = {
  VERSAO,
  TIPO_UNIDADE,
  FORA_DE_ESCOPO,
  CODIGO_LOJA_ATUAL,
  ORIGEM_NECESSIDADE,
  STATUS_NECESSIDADE,
  ORIGEM_ORDEM,
  STATUS_ORDEM,
  PRIORIDADE_ORDEM
};
