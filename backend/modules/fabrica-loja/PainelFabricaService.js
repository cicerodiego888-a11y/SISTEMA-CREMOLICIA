/**
 * Painel operacional da fábrica.
 * Só consulta necessidade, ordem, execução, saldo local e transferência.
 * Não cria produção, ordem, transferência nem movimento de estoque.
 */

const { consultarAtendimentoOperacional } = require('./NecessidadeProducaoService');
const { STATUS_ORDEM } = require('./constants');

const LIMITE_LISTA = 8;
const PERIODOS = {
  hoje: '-0 days',
  '7': '-6 days',
  '30': '-29 days'
};
const DESTINOS = {
  necessidade: 'necessidades-producao',
  ordem: 'ordens-producao',
  transferencia: 'transferencias',
  estoque: 'produtos'
};

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function erro(mensagem, codigo) {
  const falha = new Error(mensagem);
  falha.code = codigo;
  falha.statusCode = 400;
  return falha;
}

function round3(valor) {
  return Math.round((Number(valor) || 0) * 1000) / 1000;
}

function texto(valor) {
  return String(valor == null ? '' : valor).trim();
}

async function tabelaExiste(db, nome) {
  const row = await get(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [nome]);
  return Boolean(row);
}

function periodoDe(valor) {
  const periodo = texto(valor) || 'hoje';
  if (!Object.prototype.hasOwnProperty.call(PERIODOS, periodo)) {
    throw erro('O período informado é inválido.', 'PERIODO_INVALIDO');
  }
  return periodo;
}

function lerSnapshot(json) {
  try {
    return JSON.parse(json || '{}');
  } catch (_) {
    return {};
  }
}

function resultadoExecucao(row) {
  const snapshot = lerSnapshot(row.snapshot_json);
  const produzidos = Array.isArray(snapshot.produzidos) ? snapshot.produzidos : [];
  if (produzidos.length) {
    return {
      produzido: round3(produzidos.reduce((soma, item) => soma + (Number(item.quantidade_produzida) || 0), 0)),
      perdido: round3(produzidos.reduce((soma, item) => soma + (Number(item.quantidade_perdida) || 0), 0)),
      produtos: produzidos.map((item) => ({
        produto_id: item.produto_id == null ? null : Number(item.produto_id),
        produto_nome: item.produto_nome || '',
        produzido: Number(item.quantidade_produzida) || 0,
        perdido: Number(item.quantidade_perdida) || 0,
        unidade: item.unidade || ''
      }))
    };
  }
  return {
    produzido: Number(row.quantidade_produzida) || 0,
    perdido: Number(row.quantidade_perdida) || 0,
    produtos: []
  };
}

async function ordensPorStatus(db) {
  const contagem = {
    rascunho: 0,
    planejadas: 0,
    em_producao: 0,
    concluidas: 0,
    canceladas: 0
  };
  if (!(await tabelaExiste(db, 'ordens_producao'))) return contagem;
  const rows = await all(db, `SELECT status, COUNT(*) AS total FROM ordens_producao GROUP BY status`);
  for (const row of rows) {
    const total = Number(row.total) || 0;
    if (row.status === STATUS_ORDEM.RASCUNHO) contagem.rascunho = total;
    else if (row.status === STATUS_ORDEM.PLANEJADA) contagem.planejadas = total;
    else if (row.status === STATUS_ORDEM.EM_PRODUCAO) contagem.em_producao = total;
    else if (row.status === STATUS_ORDEM.CONCLUIDA) contagem.concluidas = total;
    else if (row.status === STATUS_ORDEM.CANCELADA) contagem.canceladas = total;
  }
  return contagem;
}

async function ordensPendentes(db) {
  if (!(await tabelaExiste(db, 'ordens_producao'))) return [];
  const rows = await all(db, `
    SELECT o.id, o.codigo, o.status,
           (SELECT i.produto_nome FROM ordem_producao_itens i WHERE i.ordem_id = o.id ORDER BY i.ordem, i.id LIMIT 1) AS produto_nome,
           (SELECT COALESCE(SUM(i.quantidade_planejada), 0) FROM ordem_producao_itens i WHERE i.ordem_id = o.id) AS planejado
    FROM ordens_producao o
    WHERE o.status IN ('PLANEJADA', 'EM_PRODUCAO')
    ORDER BY o.created_at, o.id
    LIMIT ?
  `, [LIMITE_LISTA]);
  return rows.map((row) => ({
    id: Number(row.id),
    codigo: row.codigo,
    status: row.status,
    produto_nome: row.produto_nome || '',
    planejado: Number(row.planejado) || 0,
    produzido: 0,
    destino: DESTINOS.ordem
  }));
}

async function execucoesDoPeriodo(db, modificador) {
  if (!(await tabelaExiste(db, 'ordem_producao_execucoes')) || !(await tabelaExiste(db, 'ordens_producao'))) return [];
  return all(db, `
    SELECT e.id, e.ordem_id, e.snapshot_json, e.quantidade_produzida, e.quantidade_perdida,
           e.concluida_em, e.created_at, o.codigo, o.status,
           (SELECT COALESCE(SUM(i.quantidade_planejada), 0) FROM ordem_producao_itens i WHERE i.ordem_id = o.id) AS planejado,
           (SELECT i.produto_nome FROM ordem_producao_itens i WHERE i.ordem_id = o.id ORDER BY i.ordem, i.id LIMIT 1) AS produto_nome
    FROM ordem_producao_execucoes e
    INNER JOIN ordens_producao o ON o.id = e.ordem_id
    WHERE o.status <> 'CANCELADA'
      AND date(COALESCE(e.concluida_em, e.created_at)) >= date('now', 'localtime', ?)
      AND date(COALESCE(e.concluida_em, e.created_at)) <= date('now', 'localtime')
    ORDER BY COALESCE(e.concluida_em, e.created_at), e.id
  `, [modificador]);
}

function resumirProducao(rows) {
  const porProduto = new Map();
  const porOrdem = new Map();
  let produzido = 0;
  let perdido = 0;
  const ordensConcluidas = new Set();
  for (const row of rows) {
    const resultado = resultadoExecucao(row);
    produzido = round3(produzido + resultado.produzido);
    perdido = round3(perdido + resultado.perdido);
    if (row.status === STATUS_ORDEM.CONCLUIDA) ordensConcluidas.add(Number(row.ordem_id));
    const ordem = porOrdem.get(Number(row.ordem_id)) || {
      id: Number(row.ordem_id),
      codigo: row.codigo,
      status: row.status,
      produto_nome: row.produto_nome || '',
      planejado: Number(row.planejado) || 0,
      produzido: 0,
      perdido: 0
    };
    ordem.produzido = round3(ordem.produzido + resultado.produzido);
    ordem.perdido = round3(ordem.perdido + resultado.perdido);
    porOrdem.set(ordem.id, ordem);
    const linhas = resultado.produtos.length
      ? resultado.produtos
      : [{
        produto_id: null,
        produto_nome: row.produto_nome || 'Produto',
        produzido: resultado.produzido,
        unidade: ''
      }];
    for (const linha of linhas) {
      const chave = linha.produto_id == null ? linha.produto_nome : String(linha.produto_id);
      const atual = porProduto.get(chave) || {
        produto_id: linha.produto_id,
        produto_nome: linha.produto_nome || 'Produto',
        unidade: linha.unidade || '',
        produzido: 0
      };
      atual.produzido = round3(atual.produzido + (Number(linha.produzido) || 0));
      porProduto.set(chave, atual);
    }
  }
  const abaixo = [...porOrdem.values()]
    .filter((ordem) => ordem.status === STATUS_ORDEM.CONCLUIDA && ordem.planejado > ordem.produzido + 0.000001)
    .map((ordem) => ({ ...ordem, destino: DESTINOS.ordem }));
  return {
    produzido,
    perdido,
    execucoes: rows.length,
    ops_concluidas: ordensConcluidas.size,
    produtos: [...porProduto.values()].filter((item) => item.produzido > 0.000001),
    abaixo_do_planejado: abaixo
  };
}

async function estoqueFabrica(db) {
  const vazio = { local: 'FABRICA', insumos: 0, produzidos: 0, itens_insumo: [], itens_produzido: [] };
  if (!(await tabelaExiste(db, 'estoque_saldos_locais')) || !(await tabelaExiste(db, 'produtos'))) return vazio;
  const rows = await all(db, `
    SELECT p.id, p.nome, p.unidade, p.natureza_cadastro, s.estoque_atual
    FROM estoque_saldos_locais s
    INNER JOIN produtos p ON p.id = s.produto_id
    WHERE s.local = 'FABRICA' AND ABS(COALESCE(s.estoque_atual, 0)) > 0.000001
    ORDER BY p.nome
  `);
  const insumos = [];
  const produzidos = [];
  for (const row of rows) {
    const item = {
      produto_id: Number(row.id),
      produto_nome: row.nome || '',
      unidade: row.unidade || '',
      quantidade: Number(row.estoque_atual) || 0
    };
    if (row.natureza_cadastro === 'INSUMO') insumos.push(item);
    else if (row.natureza_cadastro === 'PRODUZIDO') produzidos.push(item);
  }
  return {
    local: 'FABRICA',
    insumos: insumos.length,
    produzidos: produzidos.length,
    itens_insumo: insumos.slice(0, LIMITE_LISTA),
    itens_produzido: produzidos.slice(0, LIMITE_LISTA)
  };
}

async function transferenciasPainel(db, modificador) {
  const vazio = {
    rascunhos: 0,
    confirmadas: 0,
    canceladas: 0,
    pendentes: [],
    recentes: []
  };
  if (!(await tabelaExiste(db, 'transferencias_estoque'))) return vazio;
  const totais = await all(db, `
    SELECT status, COUNT(*) AS total
    FROM transferencias_estoque
    WHERE status = 'RASCUNHO'
       OR (
         status IN ('CONFIRMADA', 'CANCELADA')
         AND date(COALESCE(confirmada_em, updated_at, created_at)) >= date('now', 'localtime', ?)
         AND date(COALESCE(confirmada_em, updated_at, created_at)) <= date('now', 'localtime')
       )
    GROUP BY status
  `, [modificador]);
  const contagem = { RASCUNHO: 0, CONFIRMADA: 0, CANCELADA: 0 };
  for (const row of totais) contagem[row.status] = Number(row.total) || 0;
  const temItens = await tabelaExiste(db, 'transferencia_estoque_itens');
  const produto = temItens
    ? `(SELECT i.produto_nome FROM transferencia_estoque_itens i WHERE i.transferencia_id = t.id ORDER BY i.id LIMIT 1)`
    : `''`;
  const quantidade = temItens
    ? `(SELECT i.quantidade FROM transferencia_estoque_itens i WHERE i.transferencia_id = t.id ORDER BY i.id LIMIT 1)`
    : `NULL`;
  const unidade = temItens
    ? `(SELECT i.unidade FROM transferencia_estoque_itens i WHERE i.transferencia_id = t.id ORDER BY i.id LIMIT 1)`
    : `''`;
  const itens = temItens
    ? `(SELECT COUNT(*) FROM transferencia_estoque_itens i WHERE i.transferencia_id = t.id)`
    : `0`;
  const pendentes = await all(db, `
    SELECT t.id, t.codigo, t.status, t.origem_local, t.destino_local, t.created_at,
           ${itens} AS itens, ${produto} AS produto_nome
    FROM transferencias_estoque t
    WHERE t.status = 'RASCUNHO'
    ORDER BY t.created_at, t.id
    LIMIT ?
  `, [LIMITE_LISTA]);
  const recentes = await all(db, `
    SELECT t.id, t.codigo, t.status, t.origem_local, t.destino_local, t.confirmada_em, t.created_at,
           ${produto} AS produto_nome, ${quantidade} AS quantidade, ${unidade} AS unidade
    FROM transferencias_estoque t
    WHERE t.status = 'CONFIRMADA'
      AND date(COALESCE(t.confirmada_em, t.created_at)) >= date('now', 'localtime', ?)
      AND date(COALESCE(t.confirmada_em, t.created_at)) <= date('now', 'localtime')
    ORDER BY COALESCE(t.confirmada_em, t.created_at) DESC, t.id DESC
    LIMIT ?
  `, [modificador, LIMITE_LISTA]);
  return {
    rascunhos: contagem.RASCUNHO,
    confirmadas: contagem.CONFIRMADA,
    canceladas: contagem.CANCELADA,
    pendentes: pendentes.map((row) => ({
      id: Number(row.id),
      codigo: row.codigo,
      status: row.status,
      origem_local: row.origem_local || 'FABRICA',
      destino_local: row.destino_local || 'LOJA',
      itens: Number(row.itens) || 0,
      produto_nome: row.produto_nome || '',
      criada_em: row.created_at || '',
      destino: DESTINOS.transferencia,
      continuar: true
    })),
    recentes: recentes.map((row) => ({
      id: Number(row.id),
      codigo: row.codigo,
      status: row.status,
      confirmada_em: row.confirmada_em || row.created_at || '',
      produto_nome: row.produto_nome || '',
      quantidade: row.quantidade == null ? null : Number(row.quantidade),
      unidade: row.unidade || '',
      destino: DESTINOS.transferencia,
      continuar: false
    }))
  };
}

function atencoesDe(pendencias, ordens, producao, transferencias) {
  const lista = [];
  if (pendencias > 0) {
    lista.push({
      tipo: 'NECESSIDADE',
      quantidade: pendencias,
      texto: pendencias === 1
        ? '1 necessidade ainda possui produção pendente.'
        : `${pendencias} necessidades ainda possuem produção pendente.`
    });
  }
  if (ordens.planejadas > 0) {
    lista.push({
      tipo: 'ORDEM_PLANEJADA',
      quantidade: ordens.planejadas,
      texto: ordens.planejadas === 1
        ? '1 OP está planejada e ainda não foi executada.'
        : `${ordens.planejadas} OPs estão planejadas e ainda não foram executadas.`
    });
  }
  if (producao.abaixo_do_planejado.length > 0) {
    const total = producao.abaixo_do_planejado.length;
    lista.push({
      tipo: 'ORDEM_ABAIXO',
      quantidade: total,
      texto: total === 1
        ? '1 OP produziu abaixo do planejado.'
        : `${total} OPs produziram abaixo do planejado.`
    });
  }
  if (transferencias.rascunhos > 0) {
    lista.push({
      tipo: 'TRANSFERENCIA',
      quantidade: transferencias.rascunhos,
      texto: transferencias.rascunhos === 1
        ? '1 transferência está em rascunho.'
        : `${transferencias.rascunhos} transferências estão em rascunho.`
    });
  }
  return lista;
}

async function consultarPainelFabrica(db, filtro = {}) {
  const periodo = periodoDe(filtro.periodo);
  const modificador = PERIODOS[periodo];
  const necessidades = await consultarAtendimentoOperacional(db);
  const abertas = necessidades.filter((item) => item.atendimento.status === 'ABERTA');
  const parciais = necessidades.filter((item) => item.atendimento.status === 'PARCIALMENTE_ATENDIDA');
  const atendidas = necessidades.filter((item) => item.atendimento.status === 'ATENDIDA');
  const pendentes = necessidades.filter((item) => item.atendimento.restante > 0.000001);
  const ordens = await ordensPorStatus(db);
  const producao = resumirProducao(await execucoesDoPeriodo(db, modificador));
  const transferencias = await transferenciasPainel(db, modificador);
  const hoje = await get(db, `SELECT date('now', 'localtime') AS dia`);
  return {
    periodo,
    data: hoje ? hoje.dia : '',
    destinos: DESTINOS,
    resumo: {
      necessidades_abertas: abertas.length,
      necessidades_parciais: parciais.length,
      necessidades_atendidas: atendidas.length,
      ops_rascunho: ordens.rascunho,
      ops_planejadas: ordens.planejadas,
      ops_em_producao: ordens.em_producao,
      ops_concluidas: ordens.concluidas,
      ops_canceladas: ordens.canceladas,
      produzido: producao.produzido,
      perdido: producao.perdido,
      execucoes: producao.execucoes,
      ops_concluidas_periodo: producao.ops_concluidas
    },
    necessidades_pendentes: pendentes.slice(0, LIMITE_LISTA).map((item) => ({
      id: item.id,
      codigo: item.codigo,
      origem: item.origem,
      origem_nome: item.origem_nome,
      solicitado: item.atendimento.solicitado,
      produzido: item.atendimento.produzido,
      restante: item.atendimento.restante,
      status: item.atendimento.status,
      created_at: item.created_at,
      destino: DESTINOS.necessidade
    })),
    ordens_pendentes: await ordensPendentes(db),
    ordens_abaixo: producao.abaixo_do_planejado.slice(0, LIMITE_LISTA),
    producao_produtos: producao.produtos,
    estoque_fabrica: await estoqueFabrica(db),
    transferencias_pendentes: transferencias.pendentes,
    transferencias_recentes: transferencias.recentes,
    transferencias: {
      rascunhos: transferencias.rascunhos,
      confirmadas: transferencias.confirmadas,
      canceladas: transferencias.canceladas
    },
    atencoes: atencoesDe(pendentes.length, ordens, producao, transferencias)
  };
}

module.exports = {
  consultarPainelFabrica
};
