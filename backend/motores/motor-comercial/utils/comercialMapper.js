/**
 * comercialMapper — Mapeamento linha SQLite ↔ estruturas do domínio.
 *
 * Sprint 2.2: apenas persistência — sem regra de negócio.
 *
 * @module motores/motor-comercial/utils/comercialMapper
 */

const { deserializarJson } = require('../repositories/dbHelpers');

function mapDocumentoComercialFromRow(row, prefix = 'documento_') {
  if (!row) return null;
  return {
    numero: row[`${prefix}numero`] ?? null,
    serie: row[`${prefix}serie`] ?? null,
    sequencial: row[`${prefix}sequencial`] ?? null,
    dataEmissao: row[`${prefix}data_emissao`] ?? null,
    situacao: row[`${prefix}situacao`] ?? null
  };
}

function mapDocumentoComercialToColumns(documento = {}, prefix = 'documento_') {
  const doc = documento || {};
  return {
    [`${prefix}numero`]: doc.numero ?? null,
    [`${prefix}serie`]: doc.serie ?? null,
    [`${prefix}sequencial`]: doc.sequencial ?? null,
    [`${prefix}data_emissao`]: doc.dataEmissao ?? null,
    [`${prefix}situacao`]: doc.situacao ?? 'RASCUNHO'
  };
}

/**
 * Expande documento/prestação para UPDATE parcial (PATCH).
 * Ausência do campo ⇒ não inclui colunas (não apaga).
 * `null` explícito ⇒ limpa colunas.
 *
 * @param {Object} dados
 * @returns {{ cols: Object, meta: { recebidos: string[], persistidos: string[], ignorados: string[], prestacaoAlterada: boolean, documentoAlterado: boolean } }}
 */
function expandConsignacaoEmbeddedForPatch(dados = {}) {
  const cols = {};
  const recebidos = Object.keys(dados || {});
  const persistidos = [];
  const ignorados = [];

  const documentoEnviado = Object.prototype.hasOwnProperty.call(dados, 'documento');
  if (documentoEnviado) {
    const docCols = mapDocumentoComercialToColumns(dados.documento);
    Object.assign(cols, docCols);
    persistidos.push(...Object.keys(docCols));
  } else {
    ignorados.push('documento');
  }

  const prestacaoEnviada = Object.prototype.hasOwnProperty.call(dados, 'prestacaoContasAtiva')
    || Object.prototype.hasOwnProperty.call(dados, 'prestacaoContas');
  if (prestacaoEnviada) {
    const grupo = Object.prototype.hasOwnProperty.call(dados, 'prestacaoContasAtiva')
      ? dados.prestacaoContasAtiva
      : dados.prestacaoContas;
    const prestCols = mapGrupoPrestacaoContasToColumns(grupo);
    Object.assign(cols, prestCols);
    persistidos.push(...Object.keys(prestCols));
  } else {
    ignorados.push('prestacaoContasAtiva');
  }

  return {
    cols,
    meta: {
      recebidos,
      persistidos,
      ignorados,
      prestacaoAlterada: prestacaoEnviada,
      documentoAlterado: documentoEnviado
    }
  };
}

function mapGrupoPrestacaoContasFromRow(row, prefix = 'prestacao_') {
  if (!row || !row[`${prefix}id`]) return null;
  return {
    id: row[`${prefix}id`],
    numero: row[`${prefix}numero`] ?? null,
    status: row[`${prefix}status`] ?? null,
    dataAbertura: row[`${prefix}data_abertura`] ?? null,
    dataFechamento: row[`${prefix}data_fechamento`] ?? null,
    documento: row[`${prefix}numero`]
      ? {
          numero: row[`${prefix}numero`],
          serie: null,
          sequencial: null,
          dataEmissao: row[`${prefix}data_abertura`] ?? null,
          situacao: row[`${prefix}status`] === 'FECHADA' ? 'ATIVO' : 'RASCUNHO'
        }
      : null
  };
}

function mapGrupoPrestacaoContasToColumns(grupo = {}, prefix = 'prestacao_') {
  const g = grupo || {};
  return {
    [`${prefix}id`]: g.id ?? null,
    [`${prefix}numero`]: g.numero ?? g.documento?.numero ?? null,
    [`${prefix}status`]: g.status ?? null,
    [`${prefix}data_abertura`]: g.dataAbertura ?? null,
    [`${prefix}data_fechamento`]: g.dataFechamento ?? null
  };
}

function mapClienteMestreFromJoinRow(row) {
  if (!row || row.cliente_nome == null) return null;
  return {
    id: row.cliente_id,
    nome: row.cliente_nome,
    documento: row.cliente_documento ?? null,
    telefone: row.cliente_telefone ?? null,
    email: row.cliente_email ?? null,
    endereco: {
      cep: row.cliente_cep ?? '',
      rua: row.cliente_rua ?? '',
      numero: row.cliente_numero ?? '',
      bairro: row.cliente_bairro ?? '',
      cidade: row.cliente_cidade ?? '',
      uf: row.cliente_uf ?? ''
    },
    limiteCreditoErp: Number(row.cliente_limite_credito ?? 0),
    creditoAtualErp: Number(row.cliente_credito_atual ?? 0),
    createdAt: row.cliente_created_at ?? null
  };
}

function mapPerfilComercialFromRow(row) {
  if (!row) return null;
  const perfil = {
    id: row.id,
    clienteId: row.cliente_id,
    perfilTipo: row.perfil_tipo,
    ativo: row.ativo === 1,
    limiteComercial: Number(row.limite_comercial ?? 0),
    saldoAberto: Number(row.saldo_aberto ?? 0),
    bloqueado: row.bloqueado === 1,
    motivoBloqueio: row.motivo_bloqueio,
    scoreConfiabilidade: row.score_confiabilidade != null ? Number(row.score_confiabilidade) : null,
    scoreCalculadoEm: row.score_calculado_em,
    dataAtivacao: row.data_ativacao,
    dataInativacao: row.data_inativacao,
    dataBloqueio: row.data_bloqueio ?? null,
    dataDesbloqueio: row.data_desbloqueio ?? null,
    observacoes: row.observacoes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  const cliente = mapClienteMestreFromJoinRow(row);
  if (cliente) {
    perfil.cliente = cliente;
  }
  return perfil;
}

function mapConsignacaoFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    clienteId: row.cliente_id,
    clienteNome: row.cliente_nome != null && String(row.cliente_nome).trim() !== ''
      ? String(row.cliente_nome).trim()
      : null,
    clienteDocumento: row.cliente_documento != null && String(row.cliente_documento).trim() !== ''
      ? String(row.cliente_documento).trim()
      : null,
    clienteFantasia: row.cliente_fantasia != null && String(row.cliente_fantasia).trim() !== ''
      ? String(row.cliente_fantasia).trim()
      : (row.nome_fantasia != null && String(row.nome_fantasia).trim() !== ''
        ? String(row.nome_fantasia).trim()
        : null),
    clienteTelefone: row.cliente_telefone != null && String(row.cliente_telefone).trim() !== ''
      ? String(row.cliente_telefone).trim()
      : (row.telefone != null && String(row.telefone).trim() !== ''
        ? String(row.telefone).trim()
        : null),
    perfilComercialId: row.perfil_comercial_id,
    status: row.status,
    documento: mapDocumentoComercialFromRow(row),
    prestacaoContasAtiva: mapGrupoPrestacaoContasFromRow(row),
    valorTotalEntregue: Number(row.valor_total_entregue ?? 0),
    quantidadeItens: row.quantidade_itens != null ? Number(row.quantidade_itens) : undefined,
    valorTotalAcertado: Number(row.valor_total_acertado ?? 0),
    valorTotalPago: Number(row.valor_total_pago ?? 0),
    saldoAberto: Number(row.saldo_aberto ?? 0),
    observacao: row.observacao,
    documentoExterno: row.documento_externo ?? null,
    usuarioAberturaId: row.usuario_abertura_id,
    usuarioEncerramentoId: row.usuario_encerramento_id,
    dataAbertura: row.data_abertura,
    dataEntrega: row.data_entrega,
    dataEncerramento: row.data_encerramento,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapConsignacaoItemFromRow(row) {
  if (!row) return null;
  const { resolverUnidadeComercialCongelada } = require('../services/unidadeComercialCongelada');
  const quantidadeEntregue = Number(row.quantidade_entregue ?? 0);
  // Antes da confirmação de entrega, a quantidade operacional vive em quantidade_entregue
  const quantidade = row.quantidade != null
    ? Number(row.quantidade)
    : quantidadeEntregue;
  const quantidadeDevolvida = Number(row.quantidade_devolvida ?? 0);
  const quantidadeVendida = Number(row.quantidade_vendida ?? 0);
  const quantidadePerdida = Number(row.quantidade_perdida ?? 0);
  const quantidadeCortesia = Number(row.quantidade_cortesia ?? 0);
  const saldo = Math.max(
    0,
    quantidadeEntregue - quantidadeDevolvida - quantidadeVendida - quantidadePerdida - quantidadeCortesia
  );
  const produtoNome = row.produto_nome ?? row.produtoNome ?? null;
  const unidadeBaseProduto = String(row.produto_unidade ?? row.unidade ?? 'UN').trim().toUpperCase() || 'UN';
  const unidadeComercialRaw = row.unidade_comercial != null && String(row.unidade_comercial).trim() !== ''
    ? String(row.unidade_comercial).trim().toUpperCase()
    : null;
  const uc = resolverUnidadeComercialCongelada({
    id: row.id,
    unidadeComercial: unidadeComercialRaw,
    unidade: unidadeBaseProduto
  }, { silencioso: true });
  return {
    id: row.id,
    consignacaoId: row.consignacao_id,
    produtoId: row.produto_id,
    produtoNome: produtoNome != null && String(produtoNome).trim() !== ''
      ? String(produtoNome).trim()
      : null,
    codigo: row.produto_codigo ?? row.codigo ?? null,
    // RCM-6.1: unidade operacional = UC congelada (ou base do produto em itens antigos)
    unidade: uc.unidadeComercial,
    unidadeComercial: uc.unidadeComercial,
    unidadeBaseProduto,
    unidadeComercialHerdada: uc.herdadaDaBase,
    linhaComercialId: row.linha_comercial_id != null ? Number(row.linha_comercial_id) : null,
    tabelaPrecoId: row.tabela_preco_id != null ? Number(row.tabela_preco_id) : null,
    canalVenda: row.canal_venda != null ? String(row.canal_venda).toUpperCase() : null,
    precoOrigem: row.preco_origem ?? null,
    precoFallback: Number(row.preco_fallback ?? 0) === 1,
    quantidade,
    quantidadeEntregue,
    quantidadeDevolvida,
    quantidadeVendida,
    quantidadePerdida,
    quantidadeCortesia,
    saldo,
    observacao: row.observacao ?? null,
    precoUnitario: Number(row.preco_unitario ?? 0),
    valorUnitario: Number(row.preco_unitario ?? 0),
    precoTotal: Number(row.preco_unitario ?? 0) * quantidade,
    subtotalEntregue: Number(row.subtotal_entregue ?? 0),
    subtotalAcertado: Number(row.subtotal_acertado ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMovimentacaoComercialFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    consignacaoId: row.consignacao_id,
    consignacaoItemId: row.consignacao_item_id,
    tipoMovimentacao: row.tipo_movimentacao,
    origem: row.origem,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    grupoPrestacaoContasId: row.grupo_prestacao_contas_id,
    snapshot: deserializarJson(row.snapshot),
    usuarioId: row.usuario_id,
    dataMovimentacao: row.data_movimentacao,
    valor: row.valor != null ? Number(row.valor) : null,
    quantidade: row.quantidade != null ? Number(row.quantidade) : null,
    motivo: row.motivo,
    referenciaExterna: row.referencia_externa_tipo
      ? { tipo: row.referencia_externa_tipo, id: row.referencia_externa_id }
      : null,
    detalhes: deserializarJson(row.detalhes),
    createdAt: row.created_at
  };
}

function mapMovimentacaoPerfilFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    perfilComercialId: row.perfil_comercial_id,
    clienteId: row.cliente_id,
    tipoMovimentacao: row.tipo_movimentacao,
    origem: row.origem,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    snapshot: deserializarJson(row.snapshot),
    usuarioId: row.usuario_id,
    dataMovimentacao: row.data_movimentacao,
    valor: row.valor != null ? Number(row.valor) : null,
    motivo: row.motivo,
    referenciaExterna: row.referencia_externa_tipo
      ? { tipo: row.referencia_externa_tipo, id: row.referencia_externa_id }
      : null,
    detalhes: deserializarJson(row.detalhes),
    createdAt: row.created_at
  };
}

module.exports = {
  mapDocumentoComercialFromRow,
  mapDocumentoComercialToColumns,
  expandConsignacaoEmbeddedForPatch,
  mapGrupoPrestacaoContasFromRow,
  mapGrupoPrestacaoContasToColumns,
  mapPerfilComercialFromRow,
  mapClienteMestreFromJoinRow,
  mapConsignacaoFromRow,
  mapConsignacaoItemFromRow,
  mapMovimentacaoComercialFromRow,
  mapMovimentacaoPerfilFromRow
};
