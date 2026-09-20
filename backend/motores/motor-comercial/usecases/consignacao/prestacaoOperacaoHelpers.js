/**
 * Helpers operacionais da Prestação de Contas — Sprint 2.4.3
 *
 * @module motores/motor-comercial/usecases/consignacao/prestacaoOperacaoHelpers
 */

const {
  ConsignacaoNaoEntregueError,
  PrestacaoJaAbertaError,
  PrestacaoNaoAbertaError,
  ProdutoNaoEncontradoNaConsignacaoError,
  ProdutoNaoPertencePrestacaoError,
  PagamentoMaiorQueSaldoError,
  PrestacaoSemMovimentacoesError,
  DocumentoInvalidoError
} = require('../../domain/errors');
const {
  STATUS_ENTREGUE,
  validarDocumentoUnico
} = require('./consignacaoUseCaseHelpers');
const {
  prestacaoEstaAberta,
  calcularSaldoItem,
  criarSnapshotConsignacao,
  liberarLimitePerfil
} = require('./consignacaoOperacaoHelpers');

const STATUS_ACERTADA = 'ACERTADA';
const STATUS_QUITADA = 'QUITADA';
const STATUS_ENCERRADA = 'ENCERRADA';
const STATUS_PRESTACAO_ABERTA = 'ABERTA';
const STATUS_PRESTACAO_FECHADA = 'FECHADA';

const TIPOS_TOTAIS = Object.freeze({
  VENDA: 'VENDA_PRESTACAO',
  PERDA: 'PERDA',
  CORTESIA: 'CORTESIA',
  PAGAMENTO: 'PAGAMENTO',
  DEVOLUCAO: 'DEVOLUCAO'
});

/**
 * @param {number|string} consignacaoId
 * @returns {string}
 */
function gerarGrupoPrestacaoContasId(consignacaoId) {
  return `prest-${consignacaoId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {Object} consignacao
 * @param {Object} [documento]
 * @returns {Object}
 */
function criarGrupoPrestacaoContas(consignacao, documento = null) {
  const agora = new Date().toISOString();
  const numeroDocumento = documento?.numero ?? `PC-${consignacao.id}-${Date.now()}`;

  return {
    id: gerarGrupoPrestacaoContasId(consignacao.id),
    numero: numeroDocumento,
    status: STATUS_PRESTACAO_ABERTA,
    dataAbertura: agora,
    dataFechamento: null,
    documento: documento ?? {
      numero: numeroDocumento,
      serie: consignacao.documento?.serie ?? 'PC',
      sequencial: consignacao.documento?.sequencial ?? null,
      dataEmissao: agora,
      situacao: 'ATIVO'
    }
  };
}

/**
 * @param {Object} grupo
 * @returns {Object}
 */
function fecharGrupoPrestacaoContas(grupo) {
  const agora = new Date().toISOString();
  return {
    ...grupo,
    status: STATUS_PRESTACAO_FECHADA,
    dataFechamento: agora,
    documento: grupo.documento
      ? { ...grupo.documento, situacao: 'ATIVO' }
      : null
  };
}

/**
 * @param {Object} consignacao
 * @returns {Object}
 */
function obterConsignacaoParaAbrirPrestacao(consignacao) {
  if (!consignacao) {
    throw new DocumentoInvalidoError('Consignação não encontrada');
  }
  if (consignacao.status !== STATUS_ENTREGUE) {
    throw new ConsignacaoNaoEntregueError(consignacao.id, consignacao.status);
  }
  if (prestacaoEstaAberta(consignacao)) {
    throw new PrestacaoJaAbertaError(consignacao.prestacaoContasAtiva?.id);
  }
  return consignacao;
}

/**
 * @param {Object} consignacao
 * @returns {Object}
 */
function garantirPrestacaoAberta(consignacao) {
  if (!prestacaoEstaAberta(consignacao)) {
    throw new PrestacaoNaoAbertaError(consignacao?.id);
  }
  return consignacao.prestacaoContasAtiva;
}

/**
 * Pagamento financeiro pode ocorrer com prestação ABERTA (ciclo de atendimento)
 * ou FECHADA em ACERTADA/ENCERRADA (dívida da Conta Corrente).
 * Não cria nem reabre prestação.
 */
function obterGrupoPrestacaoParaPagamento(consignacao) {
  const prestacao = consignacao?.prestacaoContasAtiva;
  if (prestacaoEstaAberta(consignacao)) {
    return prestacao;
  }
  const status = String(consignacao?.status || '').toUpperCase();
  if (prestacao && (status === STATUS_ACERTADA || status === STATUS_ENCERRADA)) {
    return prestacao;
  }
  throw new PrestacaoNaoAbertaError(consignacao?.id);
}

/**
 * @param {Object} consignacao
 * @returns {Object}
 */
function garantirPrestacaoFechada(consignacao) {
  const prestacao = consignacao?.prestacaoContasAtiva;
  if (!prestacao) {
    throw new PrestacaoNaoAbertaError(consignacao?.id);
  }
  if (prestacao.status !== STATUS_PRESTACAO_FECHADA) {
    throw new PrestacaoJaAbertaError(prestacao.id);
  }
  return prestacao;
}

/**
 * @param {import('../../infrastructure/transactions/UnitOfWork')} uow
 * @param {Object} consignacao
 * @param {Object} entrada
 * @returns {Promise<Object>}
 */
async function obterItemPrestacao(uow, consignacao, entrada) {
  let item = null;

  if (entrada.itemId) {
    item = await uow.consignacaoItem.buscarPorId(entrada.itemId);
  } else if (entrada.produtoId != null) {
    const itens = await uow.consignacaoItem.listarPorConsignacao(consignacao.id, {
      produtoId: entrada.produtoId
    });
    item = itens[0] ?? null;
  }

  if (!item || item.consignacaoId !== consignacao.id) {
    const ref = entrada.produtoId ?? entrada.itemId;
    throw new ProdutoNaoEncontradoNaConsignacaoError(consignacao.id, ref);
  }

  if (entrada.produtoId != null && item.produtoId !== entrada.produtoId) {
    throw new ProdutoNaoPertencePrestacaoError(consignacao.id, entrada.produtoId);
  }

  return item;
}

/**
 * @param {Object[]} movimentacoes
 * @param {string} [grupoPrestacaoContasId]
 * @returns {Object}
 */
function calcularTotaisPrestacao(movimentacoes, grupoPrestacaoContasId = null) {
  const filtradas = grupoPrestacaoContasId
    ? movimentacoes.filter((m) => m.grupoPrestacaoContasId === grupoPrestacaoContasId)
    : movimentacoes;

  const somar = (tipo) => filtradas
    .filter((m) => m.tipoMovimentacao === tipo)
    .reduce((sum, m) => sum + Number(m.valor ?? 0), 0);

  const totalVendido = somar(TIPOS_TOTAIS.VENDA);
  const totalPerdido = somar(TIPOS_TOTAIS.PERDA);
  const totalCortesia = somar(TIPOS_TOTAIS.CORTESIA);
  const totalRecebido = somar(TIPOS_TOTAIS.PAGAMENTO);
  const totalDevolvido = somar(TIPOS_TOTAIS.DEVOLUCAO);
  const saldo = totalVendido - totalRecebido;

  return {
    totalVendido,
    totalDevolvido,
    totalPerdido,
    totalCortesia,
    totalRecebido,
    saldo,
    quantidadeMovimentacoes: filtradas.length
  };
}

/**
 * @param {Object} consignacao
 * @param {Object} grupo
 * @param {Object[]} itens
 * @param {Object} totais
 * @param {Object} [contexto]
 * @returns {Object}
 */
function criarSnapshotPrestacao(consignacao, grupo, itens, totais, contexto = {}) {
  return {
    ...criarSnapshotConsignacao(consignacao, contexto),
    grupoPrestacaoContas: grupo,
    documento: grupo.documento ?? consignacao.documento,
    itens: itens.map((item) => ({
      id: item.id,
      produtoId: item.produtoId,
      quantidadeEntregue: item.quantidadeEntregue,
      quantidadeDevolvida: item.quantidadeDevolvida,
      quantidadeVendida: item.quantidadeVendida,
      quantidadePerdida: item.quantidadePerdida,
      quantidadeCortesia: item.quantidadeCortesia,
      saldo: calcularSaldoItem(item),
      precoUnitario: item.precoUnitario
    })),
    totais,
    capturadoEm: new Date().toISOString()
  };
}

/**
 * @param {Object} totais
 * @returns {string}
 */
function determinarStatusAposFechamento(totais) {
  if (totais.saldo <= 0) {
    return STATUS_QUITADA;
  }
  return STATUS_ACERTADA;
}

/**
 * @param {Object} totais
 * @param {string} statusAtual
 * @returns {string|null}
 */
function determinarStatusAposPagamento(totais, statusAtual) {
  const saldo = Number(totais?.saldo ?? 0);
  const st = String(statusAtual || '').toUpperCase();
  if (saldo <= 0 && (st === STATUS_ACERTADA || st === STATUS_ENCERRADA)) {
    return STATUS_QUITADA;
  }
  return null;
}

/**
 * Valida pagamento da prestação.
 * Pagamento parcial e maior que o devido são permitidos (regra oficial CDS).
 * Bloqueia apenas quando não há vendas registradas para quitar.
 *
 * @param {Object} totais
 * @param {number} valorPagamento
 * @param {Object} [meta]
 */
function validarPagamentoContraSaldo(totais, valorPagamento, meta = {}) {
  const totalVendido = Number(totais?.totalVendido ?? 0);
  if (totalVendido <= 0) {
    throw new PagamentoMaiorQueSaldoError({
      saldo: Number(totais?.saldo ?? 0),
      valorPagamento,
      totalVendido,
      totalRecebido: Number(totais?.totalRecebido ?? 0),
      mensagem:
        'Não há saldo em aberto para receber pagamento. Registre vendas na prestação antes de registrar o pagamento.',
      rule: 'PAGAMENTO_EXIGE_VENDA_REGISTRADA',
      arquivo: 'prestacaoOperacaoHelpers.js',
      linha: 'validarPagamentoContraSaldo',
      detail:
        'totalVendido <= 0 no escopo de cálculo usado para validar o pagamento. '
        + 'Regra oficial CDS: bloquear somente ausência de vendas — parcial/maior são permitidos.',
      payload: {
        totais,
        valorPagamento,
        escopo: meta.escopo || null,
        grupoPrestacaoContasId: meta.grupoPrestacaoContasId || null,
        consignacaoId: meta.consignacaoId || null
      }
    });
  }
  // valor < saldo (parcial) e valor > saldo (maior / crédito) são válidos
}

/**
 * Localiza grupo de prestação recuperável (aberto no ledger, sem FECHAMENTO).
 * Prefere o grupo que já possui VENDA_PRESTACAO.
 *
 * @param {Object[]} movimentacoes
 * @returns {string|null}
 */
function encontrarGrupoPrestacaoRecuperavel(movimentacoes = []) {
  const fechados = new Set(
    (movimentacoes || [])
      .filter((m) => m.tipoMovimentacao === 'FECHAMENTO_PRESTACAO' && m.grupoPrestacaoContasId)
      .map((m) => String(m.grupoPrestacaoContasId))
  );

  const aberturas = (movimentacoes || [])
    .filter((m) => m.tipoMovimentacao === 'ABERTURA_PRESTACAO' && m.grupoPrestacaoContasId)
    .filter((m) => !fechados.has(String(m.grupoPrestacaoContasId)));

  if (!aberturas.length) return null;

  const comVenda = aberturas.filter((ab) => (movimentacoes || []).some(
    (m) => String(m.grupoPrestacaoContasId) === String(ab.grupoPrestacaoContasId)
      && m.tipoMovimentacao === 'VENDA_PRESTACAO'
  ));

  const pool = comVenda.length ? comVenda : aberturas;
  const escolhida = pool[pool.length - 1];
  return escolhida?.grupoPrestacaoContasId ?? null;
}

/**
 * Reancoragem via UPDATE no ledger é PROIBIDA (append-only).
 * Mantido apenas como stub de auditoria — nunca deve ser chamado em produção.
 *
 * @deprecated Use apontarPrestacaoAtivaParaGrupoRecuperavel (entidade consignacao).
 */
async function reancorarMovimentacoesOrfasAoGrupo() {
  const err = new Error(
    'VIOLAÇÃO APPEND-ONLY: reancorarMovimentacoesOrfasAoGrupo tentou UPDATE em movimentacoes_comerciais'
  );
  err.codigo = 'LEDGER_APPEND_ONLY_VIOLATION';
  err.rule = 'LEDGER_COMERCIAL_APPEND_ONLY';
  throw err;
}

/**
 * Corrige o ponteiro da prestação ativa na entidade consignação (mutável),
 * sem alterar o ledger. Prefere grupo órfão que já possui VENDA_PRESTACAO.
 *
 * @param {import('../../infrastructure/transactions/UnitOfWork')} uow
 * @param {Object} consignacao
 * @param {Object} grupoAtual
 * @param {Object[]} movimentacoes
 * @returns {Promise<{ grupo: Object, recuperado: boolean }>}
 */
async function apontarPrestacaoAtivaParaGrupoRecuperavel(uow, consignacao, grupoAtual, movimentacoes) {
  const grupoRecuperavelId = encontrarGrupoPrestacaoRecuperavel(movimentacoes);
  if (!grupoRecuperavelId) {
    return { grupo: grupoAtual, recuperado: false };
  }
  if (String(grupoRecuperavelId) === String(grupoAtual?.id)) {
    return { grupo: grupoAtual, recuperado: false };
  }

  const movAbertura = (movimentacoes || []).find(
    (m) => m.tipoMovimentacao === 'ABERTURA_PRESTACAO'
      && String(m.grupoPrestacaoContasId) === String(grupoRecuperavelId)
  );

  const grupoRecuperado = {
    id: grupoRecuperavelId,
    status: 'ABERTA',
    documento: movAbertura?.snapshot?.grupoPrestacaoContas?.documento
      || movAbertura?.snapshot?.documento
      || grupoAtual?.documento
      || consignacao.documento
      || null,
    dataAbertura: movAbertura?.dataMovimentacao || grupoAtual?.dataAbertura || new Date().toISOString()
  };

  await uow.consignacao.atualizar(consignacao.id, {
    prestacaoContasAtiva: grupoRecuperado
  });

  return { grupo: grupoRecuperado, recuperado: true };
}

/**
 * Resolve totais oficiais para pagamento — SEM UPDATE no ledger.
 * 1) Totais do grupo ativo
 * 2) Se grupo sem vendas: aponta prestação ativa para grupo recuperável (só entidade)
 * 3) Fallback: Conta Corrente da consignação (Σ VENDA − Σ PAGAMENTO)
 *
 * @param {import('../../infrastructure/transactions/UnitOfWork')} uow
 * @param {Object} consignacao
 * @param {Object} grupo
 * @returns {Promise<{ totais: Object, escopo: string, movimentacoes: Object[], grupo: Object, reconciliacao: Object|null }>}
 */
async function resolverTotaisParaPagamento(uow, consignacao, grupo) {
  let grupoAtivo = grupo;
  let movimentacoes = await listarMovimentacoesPrestacao(uow, grupoAtivo.id, consignacao.id);
  let totais = calcularTotaisPrestacao(movimentacoes, grupoAtivo.id);
  let escopo = 'GRUPO_PRESTACAO';
  let reconciliacao = null;

  const prestacaoFechada = String(grupoAtivo?.status || '').toUpperCase() === STATUS_PRESTACAO_FECHADA;

  if (totais.totalVendido <= 0) {
    const todas = await uow.movimentacaoComercial.listar({ consignacaoId: consignacao.id });
    const totaisConsignacao = calcularTotaisPrestacao(todas, null);

    if (totaisConsignacao.totalVendido > 0) {
      if (prestacaoFechada) {
        return {
          totais: totaisConsignacao,
          escopo: 'CONSIGNACAO_CONTA_CORRENTE',
          movimentacoes: todas,
          grupo: grupoAtivo,
          reconciliacao: null
        };
      }
      const ponteiro = await apontarPrestacaoAtivaParaGrupoRecuperavel(
        uow,
        consignacao,
        grupoAtivo,
        todas
      );
      grupoAtivo = ponteiro.grupo;

      if (ponteiro.recuperado) {
        movimentacoes = await listarMovimentacoesPrestacao(uow, grupoAtivo.id, consignacao.id);
        totais = calcularTotaisPrestacao(movimentacoes, grupoAtivo.id);
        escopo = 'GRUPO_RECUPERADO_PONTEIRO';
        reconciliacao = {
          tipo: 'PONTEIRO_CONSIGNACAO',
          grupoAnteriorId: grupo.id,
          grupoRecuperadoId: grupoAtivo.id,
          ledgerAlterado: false
        };
      }

      if (totais.totalVendido <= 0) {
        totais = totaisConsignacao;
        movimentacoes = todas;
        escopo = 'CONSIGNACAO_CONTA_CORRENTE';
      }
    }
  }

  return {
    totais,
    escopo,
    movimentacoes,
    grupo: grupoAtivo,
    reconciliacao
  };
}

/**
 * @param {import('../../infrastructure/transactions/UnitOfWork')} uow
 * @param {string} grupoPrestacaoContasId
 * @param {number|string} [consignacaoId] — opcional; com grupo, escopo é o ciclo (RCM-8.11)
 * @returns {Promise<Object[]>}
 */
async function listarMovimentacoesPrestacao(uow, grupoPrestacaoContasId, consignacaoId = null) {
  const filtros = {};
  if (grupoPrestacaoContasId) {
    // RCM-8.11 — ciclo = grupo; não limitar à consignação da URL
    filtros.grupoPrestacaoContasId = grupoPrestacaoContasId;
  } else if (consignacaoId != null) {
    filtros.consignacaoId = consignacaoId;
  }
  return uow.movimentacaoComercial.listar(filtros);
}

/**
 * @param {Object[]} movimentacoes
 * @param {string} grupoPrestacaoContasId
 */
function garantirMovimentacoesPrestacao(movimentacoes, grupoPrestacaoContasId) {
  const doGrupo = movimentacoes.filter((m) => m.grupoPrestacaoContasId === grupoPrestacaoContasId);
  if (!doGrupo.length) {
    throw new PrestacaoSemMovimentacoesError(grupoPrestacaoContasId);
  }
  return doGrupo;
}

/**
 * @param {import('../../infrastructure/transactions/UnitOfWork')} uow
 * @param {Object} consignacao
 * @param {number} valor
 * @returns {Promise<void>}
 */
async function liberarLimitePorValor(uow, consignacao, valor) {
  if (valor > 0) {
    await liberarLimitePerfil(uow, consignacao.perfilComercialId);
  }
}

/**
 * @param {import('../../domain/contracts/repositories/IConsignacaoRepository')} repo
 * @param {Object} documento
 * @param {number|string} consignacaoId
 * @returns {Promise<void>}
 */
async function validarDocumentoPrestacao(repo, documento, consignacaoId) {
  if (!documento?.numero) return;
  await validarDocumentoUnico(repo, documento, consignacaoId);
}

module.exports = {
  STATUS_ACERTADA,
  STATUS_QUITADA,
  STATUS_ENCERRADA,
  STATUS_PRESTACAO_ABERTA,
  STATUS_PRESTACAO_FECHADA,
  TIPOS_TOTAIS,
  gerarGrupoPrestacaoContasId,
  criarGrupoPrestacaoContas,
  fecharGrupoPrestacaoContas,
  obterConsignacaoParaAbrirPrestacao,
  garantirPrestacaoAberta,
  obterGrupoPrestacaoParaPagamento,
  garantirPrestacaoFechada,
  obterItemPrestacao,
  calcularTotaisPrestacao,
  criarSnapshotPrestacao,
  determinarStatusAposFechamento,
  determinarStatusAposPagamento,
  validarPagamentoContraSaldo,
  encontrarGrupoPrestacaoRecuperavel,
  reancorarMovimentacoesOrfasAoGrupo,
  apontarPrestacaoAtivaParaGrupoRecuperavel,
  resolverTotaisParaPagamento,
  listarMovimentacoesPrestacao,
  garantirMovimentacoesPrestacao,
  liberarLimitePorValor,
  validarDocumentoPrestacao
};
