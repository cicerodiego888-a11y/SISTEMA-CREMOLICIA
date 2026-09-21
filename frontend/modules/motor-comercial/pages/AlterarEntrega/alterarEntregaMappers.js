/**
 * RCM-8.13 — mappers da tela Alterar Entrega.
 *
 * @module frontend/modules/motor-comercial/pages/AlterarEntrega/alterarEntregaMappers
 */

const {
  podeAdicionarProdutoComplementar,
  MENSAGEM_PRESTACAO_ENCERRADA
} = require('../EntregaComplementar/entregaComplementarMappers');

const MOTIVOS_ALTERACAO_POS_ENTREGA = Object.freeze([
  'CLIENTE_DESISTIU',
  'ERRO_DIGITACAO',
  'AJUSTE_OPERACIONAL',
  'OUTRO'
]);

const MENSAGEM_CONFIRMACAO_ALTERACAO =
  'Esta alteração será registrada como uma nova atualização da entrega. '
  + 'O comprovante anterior será preservado e um novo comprovante será emitido.';

function podeAlterarEntrega(consignacao) {
  // Mesma elegibilidade da complementação (ENTREGUE, prestação não fechada)
  return podeAdicionarProdutoComplementar(consignacao);
}

function montarLinhasEdicao(itens = []) {
  return (itens || []).map((item) => ({
    itemId: item.id,
    produtoId: item.produtoId,
    produtoNome: item.produtoNome || item.produto || `Produto #${item.produtoId}`,
    quantidadeAnterior: Number(item.quantidadeEntregue ?? item.quantidade ?? 0),
    quantidadeNova: Number(item.quantidadeEntregue ?? item.quantidade ?? 0),
    precoUnitario: Number(item.precoUnitario || 0),
    unidadeComercial: item.unidadeComercial || 'UN'
  }));
}

function calcularDeltas(linhas = []) {
  return (linhas || [])
    .map((l) => {
      const anterior = Number(l.quantidadeAnterior) || 0;
      const nova = Number(l.quantidadeNova);
      const delta = nova - anterior;
      return {
        ...l,
        delta,
        alterado: Number.isFinite(nova) && delta !== 0
      };
    })
    .filter((l) => l.alterado);
}

function opcoesMotivo() {
  return MOTIVOS_ALTERACAO_POS_ENTREGA.map((m) => ({
    value: m,
    label: m.replace(/_/g, ' ')
  }));
}

module.exports = {
  MOTIVOS_ALTERACAO_POS_ENTREGA,
  MENSAGEM_CONFIRMACAO_ALTERACAO,
  MENSAGEM_PRESTACAO_ENCERRADA,
  podeAlterarEntrega,
  podeAdicionarProdutoComplementar,
  montarLinhasEdicao,
  calcularDeltas,
  opcoesMotivo
};
