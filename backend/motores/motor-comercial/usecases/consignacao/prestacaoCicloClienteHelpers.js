/**
 * RCM-8.11 — Prestação consolidada por cliente / ciclo.
 *
 * CONSIGNAÇÕES = operações independentes
 * PRESTAÇÃO (grupoPrestacaoContasId) = ciclo financeiro do cliente
 *
 * @module motores/motor-comercial/usecases/consignacao/prestacaoCicloClienteHelpers
 */

const { DomainError } = require('../../domain/errors');
const { prestacaoEstaAberta } = require('./consignacaoOperacaoHelpers');

const STATUS_PRESTACAO_ABERTA = 'ABERTA';
const STATUS_PRESTACAO_FECHADA = 'FECHADA';

const CODIGO_MULTIPLOS_GRUPOS = 'PRESTACAO_MULTIPLOS_GRUPOS_ABERTOS';
const CODIGO_RECONCILIACAO_AMBIGUA = 'PRESTACAO_RECONCILIACAO_AMBIGUA';

/**
 * Localiza o ciclo de prestação ABERTA do cliente (ponteiro nas consignações).
 *
 * @param {Object} repoOrUow — consignacao repository ou uow com .consignacao
 * @param {number|string} clienteId
 * @param {Object} [opcoes]
 * @param {number|string} [opcoes.excluirConsignacaoId]
 * @returns {Promise<{
 *   grupo: Object,
 *   consignacaoAncora: Object,
 *   consignacoes: Object[]
 * }|null>}
 * @throws {DomainError} se houver mais de um grupo ABERTA distinto
 */
async function buscarGrupoPrestacaoAbertaDoCliente(repoOrUow, clienteId, opcoes = {}) {
  if (clienteId == null || clienteId === '') return null;

  const repo = repoOrUow?.consignacao || repoOrUow;
  if (!repo?.listar) return null;

  const lista = await repo.listar({
    clienteId,
    prestacaoStatus: STATUS_PRESTACAO_ABERTA,
    pageSize: 100
  });
  const items = Array.isArray(lista) ? lista : (lista?.items || []);

  const excluir = opcoes.excluirConsignacaoId != null
    ? String(opcoes.excluirConsignacaoId)
    : null;

  const abertas = items.filter((c) => {
    if (excluir && String(c.id) === excluir) return false;
    return prestacaoEstaAberta(c);
  });

  if (!abertas.length) return null;

  const porGrupo = new Map();
  for (const c of abertas) {
    const gid = String(c.prestacaoContasAtiva?.id || '');
    if (!gid) continue;
    if (!porGrupo.has(gid)) porGrupo.set(gid, []);
    porGrupo.get(gid).push(c);
  }

  if (porGrupo.size === 0) return null;

  if (porGrupo.size > 1) {
    throw new DomainError(
      'Cliente possui mais de um ciclo de prestação ABERTA. Corrija a inconsistência antes de continuar.',
      {
        codigo: CODIGO_MULTIPLOS_GRUPOS,
        detalhes: {
          clienteId,
          grupos: [...porGrupo.keys()],
          consignacaoIds: abertas.map((c) => c.id)
        }
      }
    );
  }

  const [grupoId, membros] = [...porGrupo.entries()][0];
  const ancora = membros.slice().sort((a, b) => Number(a.id) - Number(b.id))[0];
  const grupo = {
    ...ancora.prestacaoContasAtiva,
    id: grupoId,
    status: STATUS_PRESTACAO_ABERTA
  };

  return {
    grupo,
    consignacaoAncora: ancora,
    consignacoes: membros
  };
}

/**
 * Lista consignações vinculadas ao grupo (ponteiro prestacao_id / prestacaoContasAtiva).
 *
 * @param {Object} repoOrUow
 * @param {string} grupoPrestacaoContasId
 * @returns {Promise<Object[]>}
 */
async function listarConsignacoesDoGrupoPrestacao(repoOrUow, grupoPrestacaoContasId) {
  if (!grupoPrestacaoContasId) return [];
  const repo = repoOrUow?.consignacao || repoOrUow;
  if (!repo?.listar) return [];

  const lista = await repo.listar({
    prestacaoId: grupoPrestacaoContasId,
    pageSize: 200
  });
  const items = Array.isArray(lista) ? lista : (lista?.items || []);
  return items.filter((c) => {
    const id = c.prestacaoContasAtiva?.id || c.prestacaoId;
    return String(id) === String(grupoPrestacaoContasId);
  });
}

/**
 * Itens de todas as consignações do grupo (cada item preserva consignacaoId).
 *
 * @param {Object} uow
 * @param {string} grupoPrestacaoContasId
 * @returns {Promise<Object[]>}
 */
async function listarItensDasConsignacoesDoGrupo(uow, grupoPrestacaoContasId) {
  const consignacoes = await listarConsignacoesDoGrupoPrestacao(uow, grupoPrestacaoContasId);
  const itens = [];
  for (const c of consignacoes) {
    const linhas = await uow.consignacaoItem.listarPorConsignacao(c.id);
    for (const item of linhas || []) {
      itens.push({
        ...item,
        consignacaoId: item.consignacaoId ?? c.id,
        documentoConsignacao: c.documento || null,
        consignacaoDocumento: c.documento?.numero || c.documento || `Consignação #${c.id}`
      });
    }
  }
  return itens;
}

/**
 * Vincula consignação ao grupo aberto (somente ponteiro — Ledger append-only).
 *
 * @param {Object} uow
 * @param {Object} consignacao
 * @param {Object} grupo
 * @returns {Promise<Object>} consignação atualizada
 */
async function vincularConsignacaoAoGrupoPrestacao(uow, consignacao, grupo) {
  if (!consignacao?.id || !grupo?.id) return consignacao;
  const atual = consignacao.prestacaoContasAtiva;
  if (atual && String(atual.id) === String(grupo.id) && String(atual.status).toUpperCase() === STATUS_PRESTACAO_ABERTA) {
    return consignacao;
  }
  if (atual && String(atual.status).toUpperCase() === STATUS_PRESTACAO_FECHADA
    && String(atual.id) !== String(grupo.id)) {
    throw new DomainError('Consignação já pertence a ciclo de prestação fechado', {
      codigo: 'PRESTACAO_CICLO_FECHADO',
      detalhes: { consignacaoId: consignacao.id, grupoFechado: atual.id }
    });
  }
  return uow.consignacao.atualizar(consignacao.id, {
    prestacaoContasAtiva: {
      ...grupo,
      status: STATUS_PRESTACAO_ABERTA,
      dataFechamento: null
    }
  });
}

/**
 * Reconciliação controlada de consignação ENTREGUE sem grupo para ciclo aberto do cliente.
 * NÃO atualiza Ledger. NÃO vincula ciclos fechados. Em ambiguidade: não vincula.
 *
 * Regras (RCM-8.11 §24):
 * 1. já vinculada ao grupo → manter
 * 2. prestação fechada → manter
 * 3. ENTREGUE sem grupo + cliente com grupo ABERTO + elegível → vincular
 *
 * @param {Object} uow
 * @param {Object} consignacao
 * @param {Object} [opcoes]
 * @returns {Promise<{ consignacao: Object, reconciliada: boolean, motivo: string|null }>}
 */
async function reconciliarConsignacaoComGrupoAbertoCliente(uow, consignacao, opcoes = {}) {
  if (!consignacao) {
    return { consignacao: null, reconciliada: false, motivo: 'sem_consignacao' };
  }

  if (prestacaoEstaAberta(consignacao)) {
    return { consignacao, reconciliada: false, motivo: 'ja_vinculada' };
  }

  const prest = consignacao.prestacaoContasAtiva;
  if (prest && String(prest.status || '').toUpperCase() === STATUS_PRESTACAO_FECHADA) {
    return { consignacao, reconciliada: false, motivo: 'ciclo_fechado' };
  }

  const status = String(consignacao.status || '').toUpperCase();
  if (status !== 'ENTREGUE') {
    return { consignacao, reconciliada: false, motivo: 'status_nao_elegivel' };
  }

  let ciclo;
  try {
    ciclo = await buscarGrupoPrestacaoAbertaDoCliente(uow, consignacao.clienteId, {
      excluirConsignacaoId: consignacao.id
    });
  } catch (err) {
    if (err?.codigo === CODIGO_MULTIPLOS_GRUPOS) {
      console.warn('[RCM-8.11] reconciliação abortada — múltiplos grupos', err.detalhes);
      return { consignacao, reconciliada: false, motivo: 'multiplos_grupos' };
    }
    throw err;
  }

  if (!ciclo?.grupo) {
    return { consignacao, reconciliada: false, motivo: 'sem_grupo_aberto' };
  }

  const abertura = ciclo.grupo.dataAbertura ? new Date(ciclo.grupo.dataAbertura).getTime() : 0;
  const entrega = consignacao.dataEntrega
    ? new Date(consignacao.dataEntrega).getTime()
    : (consignacao.updatedAt ? new Date(consignacao.updatedAt).getTime() : Date.now());

  // Elegível: entrega após (ou na mesma janela de) abertura do ciclo — evita misturar legado antigo
  if (abertura > 0 && entrega > 0 && entrega < abertura - 60000) {
    console.warn('[RCM-8.11] reconciliação ambígua — consignação anterior à abertura do ciclo', {
      consignacaoId: consignacao.id,
      grupoId: ciclo.grupo.id,
      dataEntrega: consignacao.dataEntrega,
      dataAbertura: ciclo.grupo.dataAbertura
    });
    if (!opcoes.forcar) {
      return { consignacao, reconciliada: false, motivo: CODIGO_RECONCILIACAO_AMBIGUA };
    }
  }

  const atualizada = await vincularConsignacaoAoGrupoPrestacao(uow, consignacao, ciclo.grupo);
  return { consignacao: atualizada, reconciliada: true, motivo: 'vinculada_ao_ciclo', grupo: ciclo.grupo };
}

/**
 * Fecha o ponteiro de prestação em TODAS as consignações do grupo.
 *
 * @param {Object} uow
 * @param {Object} grupoFechado
 * @param {Object} [opcoesStatus] — { statusPorConsignacaoId?: Map, statusPadrao?: string }
 */
async function fecharPonteirosConsignacoesDoGrupo(uow, grupoFechado, opcoesStatus = {}) {
  const membros = await listarConsignacoesDoGrupoPrestacao(uow, grupoFechado.id);
  const atualizadas = [];
  for (const c of membros) {
    const status = opcoesStatus.statusPorConsignacaoId?.get?.(String(c.id))
      ?? opcoesStatus.statusPadrao
      ?? c.status;
    const patch = { prestacaoContasAtiva: grupoFechado };
    if (status && status !== c.status) patch.status = status;
    const upd = await uow.consignacao.atualizar(c.id, patch);
    atualizadas.push(upd);
  }
  return atualizadas;
}

/**
 * RCM-8.12 — Autoridade do ciclo na entrega.
 * Resolve grupo ABERTA do cliente e vincula a consignação ANTES de qualquer ENTREGA no Ledger.
 *
 * @param {Object} uow
 * @param {Object} consignacao
 * @returns {Promise<{
 *   grupo: Object|null,
 *   consignacao: Object,
 *   vinculadaAoCiclo: boolean,
 *   origem: 'ponteiro'|'cliente'|'nenhum'
 * }>}
 */
async function resolverCicloPrestacaoParaEntrega(uow, consignacao) {
  if (!consignacao) {
    return { grupo: null, consignacao: null, vinculadaAoCiclo: false, origem: 'nenhum' };
  }

  if (prestacaoEstaAberta(consignacao)) {
    return {
      grupo: consignacao.prestacaoContasAtiva,
      consignacao,
      vinculadaAoCiclo: false,
      origem: 'ponteiro'
    };
  }

  const ciclo = await buscarGrupoPrestacaoAbertaDoCliente(uow, consignacao.clienteId, {
    excluirConsignacaoId: consignacao.id
  });

  if (!ciclo?.grupo) {
    return {
      grupo: null,
      consignacao,
      vinculadaAoCiclo: false,
      origem: 'nenhum'
    };
  }

  const vinculada = await vincularConsignacaoAoGrupoPrestacao(uow, consignacao, ciclo.grupo);
  return {
    grupo: ciclo.grupo,
    consignacao: vinculada,
    vinculadaAoCiclo: true,
    origem: 'cliente'
  };
}

module.exports = {
  CODIGO_MULTIPLOS_GRUPOS,
  CODIGO_RECONCILIACAO_AMBIGUA,
  buscarGrupoPrestacaoAbertaDoCliente,
  listarConsignacoesDoGrupoPrestacao,
  listarItensDasConsignacoesDoGrupo,
  vincularConsignacaoAoGrupoPrestacao,
  reconciliarConsignacaoComGrupoAbertoCliente,
  fecharPonteirosConsignacoesDoGrupo,
  resolverCicloPrestacaoParaEntrega
};
