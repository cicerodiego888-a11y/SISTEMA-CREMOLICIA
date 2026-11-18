/**
 * Necessidade de produção.
 * Registra o que falta produzir. Não abre ordem de produção e não movimenta estoque.
 */

const bootstrapNecessidadesProducao = require('./migrations/003_necessidades_producao');
const bootstrapNecessidadePedidos = require('./migrations/008_necessidade_producao_pedidos');
const bootstrapFichaPadraoSemProduto = require('./migrations/015_fichas_padrao_no_produto');
const { obterSnapshotVinculoProduto } = require('./FichaPadraoService');
const { ORIGEM_NECESSIDADE, STATUS_NECESSIDADE } = require('./constants');

const MENSAGEM_DEMANDA = 'Quantidade da demanda do pedido já foi totalmente vinculada a necessidades de produção.';
const MENSAGEM_JA_CANCELADA = 'A necessidade já está cancelada.';
const MENSAGEM_NAO_CANCELA_ATENDIDA = 'A necessidade atendida não pode ser cancelada.';

const ORIGENS = new Set(Object.values(ORIGEM_NECESSIDADE));
const LIMITE_ITENS = 300;

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

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, id: this.lastID });
    });
  });
}

function erro(mensagem, codigo, statusCode = 400) {
  const err = new Error(mensagem);
  err.code = codigo;
  err.statusCode = statusCode;
  return err;
}

function texto(valor) {
  return String(valor == null ? '' : valor).trim();
}

function numeroOpcional(valor, mensagem) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(String(valor).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw erro(mensagem, 'QUANTIDADE_INVALIDA');
  return n;
}

function idOpcional(valor, mensagem, codigo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw erro(mensagem, codigo);
  return n;
}

async function garantirSchema(db) {
  await bootstrapNecessidadesProducao(db);
  await bootstrapNecessidadePedidos(db);
  await bootstrapFichaPadraoSemProduto(db);
}

function round3(valor) {
  return Math.round(Number(valor) * 1000) / 1000;
}

function statusAtendimento(gravado, itens) {
  if (gravado === STATUS_NECESSIDADE.CANCELADA) return STATUS_NECESSIDADE.CANCELADA;
  const produzido = itens.reduce((soma, item) => soma + item.produzido, 0);
  if (!(produzido > 0.000001)) return STATUS_NECESSIDADE.ABERTA;
  if (itens.every((item) => item.restante <= 0.000001)) return STATUS_NECESSIDADE.ATENDIDA;
  return STATUS_NECESSIDADE.PARCIALMENTE_ATENDIDA;
}

async function mapaProducao(db, itemIds) {
  const resultado = new Map();
  for (const id of itemIds) resultado.set(id, { planejado: 0, planejadoAberto: 0, produzido: 0 });
  if (!itemIds.length || !(await tabelaExiste(db, 'ordens_producao')) || !(await tabelaExiste(db, 'ordem_producao_itens'))) {
    return resultado;
  }
  const marcas = itemIds.map(() => '?').join(',');
  const linhas = await all(db, `
    SELECT i.ordem_id, i.ordem, i.id, i.necessidade_item_id, i.quantidade_planejada, o.status
    FROM ordem_producao_itens i
    INNER JOIN ordens_producao o ON o.id = i.ordem_id
    WHERE o.status <> 'CANCELADA'
      AND i.ordem_id IN (
        SELECT ordem_id FROM ordem_producao_itens WHERE necessidade_item_id IN (${marcas})
      )
    ORDER BY i.ordem_id, i.ordem, i.id
  `, itemIds);
  if (!linhas.length) return resultado;
  const porOrdem = new Map();
  for (const linha of linhas) {
    const lista = porOrdem.get(linha.ordem_id) || [];
    lista.push(linha);
    porOrdem.set(linha.ordem_id, lista);
  }
  const produzidoIndice = new Map();
  if (await tabelaExiste(db, 'ordem_producao_execucoes')) {
    const ordemIds = [...porOrdem.keys()];
    const execucoes = await all(db, `
      SELECT ordem_id, snapshot_json, quantidade_produzida
      FROM ordem_producao_execucoes
      WHERE ordem_id IN (${ordemIds.map(() => '?').join(',')})
    `, ordemIds);
    for (const execucao of execucoes) {
      let produzidos = [];
      try {
        produzidos = (JSON.parse(execucao.snapshot_json || '{}').produzidos) || [];
      } catch (_) {
        produzidos = [];
      }
      const lista = porOrdem.get(execucao.ordem_id) || [];
      if (!produzidoIndice.has(execucao.ordem_id)) produzidoIndice.set(execucao.ordem_id, lista.map(() => 0));
      const acumulado = produzidoIndice.get(execucao.ordem_id);
      if (produzidos.length) {
        lista.forEach((linha, indice) => {
          const quantidade = produzidos[indice] ? Number(produzidos[indice].quantidade_produzida) || 0 : 0;
          acumulado[indice] = round3(acumulado[indice] + quantidade);
        });
      } else if (lista.length === 1) {
        acumulado[0] = round3(acumulado[0] + (Number(execucao.quantidade_produzida) || 0));
      }
    }
  }
  for (const [ordemId, lista] of porOrdem) {
    const acumulado = produzidoIndice.get(ordemId) || [];
    lista.forEach((linha, indice) => {
      const itemId = linha.necessidade_item_id == null ? null : Number(linha.necessidade_item_id);
      if (!resultado.has(itemId)) return;
      const atual = resultado.get(itemId);
      const planejado = Number(linha.quantidade_planejada) || 0;
      atual.planejado = round3(atual.planejado + planejado);
      if (linha.status !== 'CONCLUIDA') atual.planejadoAberto = round3(atual.planejadoAberto + planejado);
      atual.produzido = round3(atual.produzido + (acumulado[indice] || 0));
    });
  }
  return resultado;
}

function montarAtendimento(gravado, itensNecessidade, mapa) {
  const itens = itensNecessidade.map((item) => {
    const info = mapa.get(item.id) || { planejado: 0, produzido: 0 };
    const solicitado = Number(item.quantidade);
    const produzido = info.produzido || 0;
    const restante = round3(Math.max(0, solicitado - produzido));
    const situacao = restante <= 0.000001
      ? 'ATENDIDO'
      : (produzido > 0.000001 ? 'PARCIAL' : 'ABERTA');
    const situacaoNome = situacao === 'ATENDIDO' ? 'Atendido' : (situacao === 'PARCIAL' ? 'Parcial' : 'Em aberto');
    return {
      necessidade_item_id: item.id,
      produto_id: item.produto_id,
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade_solicitada: solicitado,
      solicitado,
      planejado: info.planejado || 0,
      produzido,
      restante,
      situacao,
      situacao_nome: situacaoNome
    };
  });
  const atendimento = {
    solicitado: round3(itens.reduce((soma, item) => soma + item.solicitado, 0)),
    planejado: round3(itens.reduce((soma, item) => soma + item.planejado, 0)),
    produzido: round3(itens.reduce((soma, item) => soma + item.produzido, 0)),
    restante: round3(itens.reduce((soma, item) => soma + item.restante, 0)),
    status: statusAtendimento(gravado, itens),
    itens
  };
  return atendimento;
}

const NOMES_ORIGEM = {
  PEDIDO_LOJA: 'Pedidos da Loja',
  ABASTECIMENTO: 'Abastecimento interno',
  PLANEJAMENTO: 'Planejamento',
  MANUAL: 'Manual'
};

function dataCurta(valor) {
  const textoData = texto(valor);
  const data = textoData.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/);
  if (!data) return textoData;
  return `${data[3]}/${data[2]}/${data[1]}${data[4] ? ' ' + data[4] : ''}`;
}

async function producaoDaOrdem(db, ordemId) {
  if (!(await tabelaExiste(db, 'ordem_producao_execucoes'))) return [];
  const execucoes = await all(db, `
    SELECT id, snapshot_json, quantidade_produzida, quantidade_perdida, concluida_em, created_at
    FROM ordem_producao_execucoes WHERE ordem_id = ? ORDER BY id
  `, [ordemId]);
  return execucoes.map((execucao) => {
    let produzidos = [];
    try {
      produzidos = (JSON.parse(execucao.snapshot_json || '{}').produzidos) || [];
    } catch (_) {
      produzidos = [];
    }
    const produzido = produzidos.length
      ? round3(produzidos.reduce((soma, item) => soma + (Number(item.quantidade_produzida) || 0), 0))
      : Number(execucao.quantidade_produzida) || 0;
    const perdido = produzidos.length
      ? round3(produzidos.reduce((soma, item) => soma + (Number(item.quantidade_perdida) || 0), 0))
      : Number(execucao.quantidade_perdida) || 0;
    return {
      id: Number(execucao.id),
      produzido,
      perdido,
      quando: execucao.concluida_em || execucao.created_at || '',
      produtos: produzidos.map((item) => ({
        produto_id: item.produto_id == null ? null : Number(item.produto_id),
        produto_nome: item.produto_nome || '',
        planejado: Number(item.quantidade_planejada) || 0,
        produzido: Number(item.quantidade_produzida) || 0,
        perdido: Number(item.quantidade_perdida) || 0,
        unidade: item.unidade || ''
      }))
    };
  });
}

async function anexarOperacao(db, necessidade) {
  const atendimento = necessidade.atendimento;
  const ordens = [];
  const historico = [{
    quando: necessidade.created_at || '',
    quando_texto: dataCurta(necessidade.created_at),
    texto: 'Necessidade criada'
  }];
  if (await tabelaExiste(db, 'ordens_producao')) {
    const rows = await all(db, `
      SELECT id, codigo, status, origem, data_prevista, created_at, updated_at
      FROM ordens_producao WHERE necessidade_id = ? ORDER BY id
    `, [necessidade.id]);
    for (const row of rows) {
      const itens = await all(db, `
        SELECT produto_id, produto_nome, quantidade_planejada, unidade
        FROM ordem_producao_itens WHERE ordem_id = ? ORDER BY ordem, id
      `, [row.id]);
      const producoes = row.status === 'CANCELADA' ? [] : await producaoDaOrdem(db, row.id);
      const produzido = round3(producoes.reduce((soma, item) => soma + item.produzido, 0));
      const perdido = round3(producoes.reduce((soma, item) => soma + item.perdido, 0));
      const planejado = round3(itens.reduce((soma, item) => soma + (Number(item.quantidade_planejada) || 0), 0));
      const ordem = {
        id: Number(row.id),
        codigo: row.codigo,
        status: row.status,
        origem: row.origem,
        data: row.data_prevista || '',
        criada_em: row.created_at || '',
        criada_em_texto: dataCurta(row.created_at),
        planejado,
        produzido: row.status === 'CANCELADA' ? 0 : produzido,
        perdido: row.status === 'CANCELADA' ? 0 : perdido,
        conta_atendimento: row.status !== 'CANCELADA',
        produtos: itens.map((item) => ({
          produto_id: item.produto_id == null ? null : Number(item.produto_id),
          produto_nome: item.produto_nome || '',
          planejado: Number(item.quantidade_planejada) || 0,
          unidade: item.unidade || ''
        })),
        producoes
      };
      ordens.push(ordem);
      historico.push({
        quando: row.created_at || '',
        quando_texto: dataCurta(row.created_at),
        texto: `${row.codigo} criada`,
        detalhe: `${planejado} planejados`
      });
      if (row.status === 'CANCELADA') {
        historico.push({
          quando: row.updated_at || row.created_at || '',
          quando_texto: dataCurta(row.updated_at || row.created_at),
          texto: `${row.codigo} cancelada`,
          detalhe: 'Não entra no atendimento'
        });
      }
      for (const producao of producoes) {
        historico.push({
          quando: producao.quando,
          quando_texto: dataCurta(producao.quando),
          texto: `${row.codigo} produzida`,
          detalhe: `${producao.produzido} produzidos${producao.perdido > 0 ? ` · ${producao.perdido} perdidos` : ''}`
        });
      }
    }
  }
  if (atendimento.status === STATUS_NECESSIDADE.ATENDIDA) {
    const ultima = historico.filter((evento) => evento.quando).slice().sort((a, b) => String(a.quando).localeCompare(String(b.quando))).pop();
    historico.push({
      quando: ultima ? ultima.quando : '',
      quando_texto: ultima ? ultima.quando_texto : '',
      texto: 'Necessidade atendida'
    });
  }
  if (atendimento.status === STATUS_NECESSIDADE.CANCELADA) {
    historico.push({
      quando: necessidade.updated_at || '',
      quando_texto: dataCurta(necessidade.updated_at),
      texto: 'Necessidade cancelada'
    });
  }
  historico.forEach((evento, indice) => { evento.ordem = indice; });
  historico.sort((a, b) => String(a.quando).localeCompare(String(b.quando)) || a.ordem - b.ordem);
  historico.forEach((evento) => { delete evento.ordem; });
  let podeCriar = atendimento.status === STATUS_NECESSIDADE.ABERTA || atendimento.status === STATUS_NECESSIDADE.PARCIALMENTE_ATENDIDA;
  if (podeCriar) {
    let limite = 0;
    for (const item of necessidade.itens) {
      limite += await limiteNovaOp(db, item.id, Number(item.quantidade), 0);
    }
    podeCriar = limite > 0.000001;
  }
  necessidade.origem_nome = NOMES_ORIGEM[necessidade.origem] || necessidade.origem;
  necessidade.resumo = {
    solicitado: atendimento.solicitado,
    planejado: atendimento.planejado,
    produzido: atendimento.produzido,
    restante: atendimento.restante
  };
  necessidade.ordens_producao = ordens;
  necessidade.historico = historico;
  necessidade.pode_criar_op = podeCriar;
  necessidade.pode_cancelar = atendimento.status === STATUS_NECESSIDADE.ABERTA || atendimento.status === STATUS_NECESSIDADE.PARCIALMENTE_ATENDIDA;
  if (atendimento.status === STATUS_NECESSIDADE.ABERTA) {
    necessidade.aviso = 'Nenhuma quantidade foi efetivamente produzida.';
  } else if (atendimento.status === STATUS_NECESSIDADE.PARCIALMENTE_ATENDIDA) {
    necessidade.aviso = `Ainda falta produzir: ${atendimento.restante}`;
  } else if (atendimento.status === STATUS_NECESSIDADE.ATENDIDA) {
    necessidade.aviso = 'Necessidade atendida.';
  } else {
    necessidade.aviso = 'Cancelada. O histórico, os pedidos e as ordens permanecem.';
  }
  return necessidade;
}

async function anexarAtendimento(db, necessidade) {
  const mapa = await mapaProducao(db, necessidade.itens.map((item) => item.id));
  necessidade.atendimento = montarAtendimento(necessidade.status, necessidade.itens, mapa);
  necessidade.status = necessidade.atendimento.status;
  return anexarOperacao(db, necessidade);
}

async function limiteNovaOp(db, necessidadeItemId, solicitado, ordemIgnorada) {
  const mapa = await mapaProducao(db, [Number(necessidadeItemId)]);
  const info = mapa.get(Number(necessidadeItemId)) || { planejadoAberto: 0, produzido: 0 };
  let aberto = info.planejadoAberto || 0;
  if (ordemIgnorada && await tabelaExiste(db, 'ordens_producao')) {
    const row = await get(db, `
      SELECT COALESCE(SUM(i.quantidade_planejada), 0) AS quantidade
      FROM ordem_producao_itens i
      INNER JOIN ordens_producao o ON o.id = i.ordem_id
      WHERE i.necessidade_item_id = ? AND o.id = ? AND o.status NOT IN ('CANCELADA', 'CONCLUIDA')
    `, [necessidadeItemId, ordemIgnorada]);
    aberto = round3(aberto - (Number(row && row.quantidade) || 0));
  }
  return round3(Math.max(0, Number(solicitado) - (info.produzido || 0) - aberto));
}

async function tabelaExiste(db, nome) {
  const row = await get(db, `
    SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?
  `, [nome]);
  return !!row;
}

const MENSAGEM_SELECIONE_PRODUTO = 'Selecione um produto cadastrado para o item da necessidade.';
const MENSAGEM_PRODUTO_NAO_ENCONTRADO = 'Produto não encontrado.';
const MENSAGEM_SOMENTE_PRODUZIDO = 'Somente produtos produzidos podem ser incluídos em uma necessidade de produção.';

async function colunasProduto(db) {
  if (!(await tabelaExiste(db, 'produtos'))) return new Set();
  const colunas = await all(db, 'PRAGMA table_info(produtos)');
  return new Set(colunas.map((coluna) => coluna.name));
}

async function conferirProduto(db, produtoId) {
  if (!produtoId) throw erro(MENSAGEM_SELECIONE_PRODUTO, 'PRODUTO_OBRIGATORIO', 400);
  const nomes = await colunasProduto(db);
  if (!nomes.size) throw erro(MENSAGEM_PRODUTO_NAO_ENCONTRADO, 'PRODUTO_NAO_ENCONTRADO', 404);
  const natureza = nomes.has('natureza_cadastro') ? 'natureza_cadastro' : 'NULL AS natureza_cadastro';
  const ativo = nomes.has('ativo') ? 'COALESCE(ativo, 1) AS ativo' : '1 AS ativo';
  const nome = nomes.has('nome') ? 'nome' : "'' AS nome";
  const unidade = nomes.has('unidade') ? 'unidade' : "'' AS unidade";
  const row = await get(db, `
    SELECT id, ${nome}, ${unidade}, ${natureza}, ${ativo}
    FROM produtos WHERE id = ?
  `, [produtoId]);
  if (!row) throw erro(MENSAGEM_PRODUTO_NAO_ENCONTRADO, 'PRODUTO_NAO_ENCONTRADO', 404);
  if (nomes.has('natureza_cadastro') && row.natureza_cadastro !== 'PRODUZIDO') {
    throw erro(MENSAGEM_SOMENTE_PRODUZIDO, 'PRODUTO_NAO_PRODUZIDO', 400);
  }
  if (nomes.has('ativo') && Number(row.ativo) !== 1) {
    throw erro('O produto inativo não pode ser incluído em uma nova necessidade.', 'PRODUTO_INATIVO', 400);
  }
  return {
    id: Number(row.id),
    nome: row.nome || '',
    unidade: row.unidade || ''
  };
}

async function listarProdutosProduzidos(db, termo, opcoes = {}) {
  const nomes = await colunasProduto(db);
  if (!nomes.has('natureza_cadastro')) return [];
  const busca = texto(termo);
  if (busca.length < 2) return [];
  const like = `%${busca}%`;
  const params = [like];
  const partes = ['nome LIKE ?'];
  if (nomes.has('codigo')) {
    partes.push("IFNULL(codigo, '') LIKE ?");
    params.push(like);
  }
  if (nomes.has('codigo_barras')) {
    partes.push("IFNULL(codigo_barras, '') LIKE ?");
    params.push(like);
  }
  const ativo = nomes.has('ativo') ? 'AND COALESCE(ativo, 1) = 1' : '';
  const semProdutoLinha = opcoes.excluirProdutoLinha && (await tabelaExiste(db, 'linhas_produtos_legado'))
    ? 'AND NOT EXISTS (SELECT 1 FROM linhas_produtos_legado lpl WHERE lpl.produto_id = produtos.id)'
    : '';
  const rows = await all(db, `
    SELECT id,
           ${nomes.has('codigo') ? 'codigo' : "'' AS codigo"},
           ${nomes.has('codigo_barras') ? 'codigo_barras' : "'' AS codigo_barras"},
           nome,
           ${nomes.has('unidade') ? 'unidade' : "'' AS unidade"},
           natureza_cadastro,
           ${nomes.has('ativo') ? 'COALESCE(ativo, 1) AS ativo' : '1 AS ativo'}
    FROM produtos
    WHERE natureza_cadastro = 'PRODUZIDO'
      ${ativo}
      ${semProdutoLinha}
      AND (${partes.join(' OR ')})
    ORDER BY nome COLLATE NOCASE
    LIMIT 8
  `, params);
  return rows.map((row) => ({
    id: Number(row.id),
    codigo: row.codigo || '',
    codigo_barras: row.codigo_barras || '',
    nome: row.nome,
    unidade: row.unidade || '',
    natureza_cadastro: 'PRODUZIDO',
    ativo: Number(row.ativo) === 1 ? 1 : 0
  }));
}

async function conferirFicha(db, fichaId, produtoId, permitirReferenciaHistorica = false) {
  if (!fichaId || !(await tabelaExiste(db, 'fichas_tecnicas'))) return null;
  const row = await get(db, 'SELECT id, produto_id, ativa FROM fichas_tecnicas WHERE id = ?', [fichaId]);
  if (!row) throw erro('A ficha técnica informada não existe.', 'FICHA_NAO_ENCONTRADA', 404);
  if (produtoId && row.produto_id != null && Number(row.produto_id) !== Number(produtoId)) {
    throw erro('A ficha técnica não está associada ao produto informado.', 'FICHA_PRODUTO_DIVERGENTE', 409);
  }
  if (!permitirReferenciaHistorica &&
      (!produtoId || row.produto_id == null || Number(row.ativa) !== 1)) {
    throw erro('Vincule uma ficha tradicional ativa ao produto antes de utilizá-la.', 'FICHA_NAO_VINCULADA', 409);
  }
  return Number(row.id);
}

async function resolverPedido(db, pedidoId) {
  if (!pedidoId) return null;
  if (!(await tabelaExiste(db, 'pedidos_comerciais'))) {
    throw erro('O pedido da loja informado não existe.', 'PEDIDO_NAO_ENCONTRADO', 404);
  }
  const row = await get(db, 'SELECT id, codigo, status FROM pedidos_comerciais WHERE id = ?', [pedidoId]);
  if (!row) throw erro('O pedido da loja informado não existe.', 'PEDIDO_NAO_ENCONTRADO', 404);
  return row;
}

function mapearItem(row) {
  let fichaPadraoSnapshot = null;
  if (row.ficha_padrao_snapshot) {
    try {
      fichaPadraoSnapshot = JSON.parse(row.ficha_padrao_snapshot);
    } catch (err) {
      throw erro('A composição capturada para a ficha padrão está inválida.', 'FICHA_SNAPSHOT_INVALIDO', 500);
    }
  }
  return {
    id: Number(row.id),
    ordem: Number(row.ordem),
    produto_id: row.produto_id == null ? null : Number(row.produto_id),
    descricao: row.descricao,
    quantidade: Number(row.quantidade),
    unidade: row.unidade || '',
    ficha_tecnica_id: row.ficha_tecnica_id == null ? null : Number(row.ficha_tecnica_id),
    ficha_padrao_vinculo_id: row.ficha_padrao_vinculo_id == null ? null : Number(row.ficha_padrao_vinculo_id),
    ficha_padrao_versao_id: row.ficha_padrao_versao_id == null ? null : Number(row.ficha_padrao_versao_id),
    ficha_padrao_snapshot: fichaPadraoSnapshot,
    observacao: row.observacao || ''
  };
}

function mapearResumo(row) {
  return {
    id: Number(row.id),
    codigo: row.codigo,
    origem: row.origem,
    pedido_id: row.pedido_id == null ? null : Number(row.pedido_id),
    referencia: row.referencia || '',
    descricao: row.descricao,
    data_necessidade: row.data_necessidade || '',
    status: row.status,
    itens: Number(row.itens || 0),
    updated_at: row.updated_at
  };
}

async function obterNecessidade(db, id) {
  await garantirSchema(db);
  const necessidadeId = Number(id);
  if (!Number.isInteger(necessidadeId) || necessidadeId <= 0) {
    throw erro('Necessidade de produção não encontrada.', 'NECESSIDADE_NAO_ENCONTRADA', 404);
  }
  const row = await get(db, `
    SELECT id, codigo, origem, pedido_id, referencia, descricao, data_necessidade,
           status, observacoes, created_at, updated_at
    FROM necessidades_producao WHERE id = ?
  `, [necessidadeId]);
  if (!row) throw erro('Necessidade de produção não encontrada.', 'NECESSIDADE_NAO_ENCONTRADA', 404);
  const itens = await all(db, `
    SELECT id, ordem, produto_id, descricao, quantidade, unidade, ficha_tecnica_id,
           ficha_padrao_vinculo_id, ficha_padrao_versao_id, ficha_padrao_snapshot, observacao
    FROM necessidade_producao_itens WHERE necessidade_id = ? ORDER BY ordem, id
  `, [necessidadeId]);
  const necessidade = {
    id: Number(row.id),
    codigo: row.codigo,
    origem: row.origem,
    pedido_id: row.pedido_id == null ? null : Number(row.pedido_id),
    referencia: row.referencia || '',
    descricao: row.descricao,
    data_necessidade: row.data_necessidade || '',
    status: row.status,
    observacoes: row.observacoes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    itens: itens.map(mapearItem)
  };
  necessidade.pedidos = await lerPedidosVinculados(db, necessidade);
  return anexarAtendimento(db, necessidade);
}

async function nomeProduto(db, produtoId) {
  if (!(await tabelaExiste(db, 'produtos'))) return '';
  const row = await get(db, 'SELECT nome FROM produtos WHERE id = ?', [produtoId]);
  return row ? texto(row.nome) : '';
}

async function complementoPedido(db, pedidoId) {
  if (!(await tabelaExiste(db, 'pedidos_comerciais'))) {
    return { codigo: '', data: '', cliente_nome: '' };
  }
  const colunas = await all(db, 'PRAGMA table_info(pedidos_comerciais)');
  const nomes = new Set(colunas.map((coluna) => coluna.name));
  const pedido = await get(db, `
    SELECT codigo
           ${nomes.has('created_at') ? ', created_at' : ", '' AS created_at"}
           ${nomes.has('cliente_id') ? ', cliente_id' : ', NULL AS cliente_id'}
    FROM pedidos_comerciais WHERE id = ?
  `, [pedidoId]);
  let clienteNome = '';
  if (pedido && pedido.cliente_id && await tabelaExiste(db, 'clientes')) {
    const cliente = await get(db, 'SELECT nome FROM clientes WHERE id = ?', [pedido.cliente_id]);
    clienteNome = cliente ? texto(cliente.nome) : '';
  }
  return {
    codigo: pedido ? texto(pedido.codigo) : '',
    data: pedido ? texto(pedido.created_at) : '',
    cliente_nome: clienteNome
  };
}

async function lerPedidosVinculados(db, necessidade) {
  const rows = await all(db, `
    SELECT id, pedido_id, created_at
    FROM necessidade_producao_pedidos
    WHERE necessidade_id = ?
    ORDER BY id
  `, [necessidade.id]);
  if (!rows.length && necessidade.pedido_id) {
    const extra = await complementoPedido(db, necessidade.pedido_id);
    return [{
      id: null,
      pedido_id: necessidade.pedido_id,
      codigo: extra.codigo || necessidade.referencia || '',
      data: extra.data,
      cliente_nome: extra.cliente_nome,
      legado: true,
      itens: []
    }];
  }
  const pedidos = [];
  for (const row of rows) {
    const extra = await complementoPedido(db, row.pedido_id);
    const codigo = extra.codigo;
    const itens = await all(db, `
      SELECT produto_id, quantidade, unidade
      FROM necessidade_producao_pedido_itens
      WHERE necessidade_pedido_id = ?
      ORDER BY id
    `, [row.id]);
    const detalhados = [];
    for (const item of itens) {
      detalhados.push({
        produto_id: Number(item.produto_id),
        produto_nome: await nomeProduto(db, item.produto_id),
        quantidade: Number(item.quantidade),
        unidade: item.unidade || ''
      });
    }
    pedidos.push({
      id: Number(row.id),
      pedido_id: Number(row.pedido_id),
      codigo,
      data: extra.data,
      cliente_nome: extra.cliente_nome,
      legado: false,
      itens: detalhados
    });
  }
  return pedidos;
}

async function dadosProduto(db, produtoId) {
  await conferirProduto(db, produtoId);
  if (!(await tabelaExiste(db, 'produtos'))) {
    return { nome: `Produto ${produtoId}`, unidade: '' };
  }
  const row = await get(db, 'SELECT nome, unidade FROM produtos WHERE id = ?', [produtoId]);
  return {
    nome: texto(row && row.nome) || `Produto ${produtoId}`,
    unidade: texto(row && row.unidade)
  };
}

async function quantidadeNoPedido(db, pedidoId, produtoId) {
  if (!(await tabelaExiste(db, 'pedido_itens'))) return 0;
  const row = await get(db, `
    SELECT COALESCE(SUM(quantidade), 0) AS quantidade
    FROM pedido_itens WHERE pedido_id = ? AND produto_id = ?
  `, [pedidoId, produtoId]);
  return Number(row && row.quantidade) || 0;
}

async function quantidadeJaVinculada(db, pedidoId, produtoId, necessidadeIgnorada) {
  const row = await get(db, `
    SELECT COALESCE(SUM(i.quantidade), 0) AS quantidade
    FROM necessidade_producao_pedido_itens i
    INNER JOIN necessidade_producao_pedidos v ON v.id = i.necessidade_pedido_id
    INNER JOIN necessidades_producao n ON n.id = v.necessidade_id
    WHERE v.pedido_id = ? AND i.produto_id = ? AND n.status <> 'CANCELADA' AND n.id <> ?
  `, [pedidoId, produtoId, necessidadeIgnorada || 0]);
  return Number(row && row.quantidade) || 0;
}

async function validarDemanda(db, vinculos, necessidadeIgnorada) {
  for (const vinculo of vinculos) {
    for (const item of vinculo.itens) {
      const noPedido = await quantidadeNoPedido(db, vinculo.pedido_id, item.produto_id);
      if (!(noPedido > 0)) throw erro('O produto informado não faz parte do pedido.', 'PRODUTO_FORA_DO_PEDIDO');
      const usada = await quantidadeJaVinculada(db, vinculo.pedido_id, item.produto_id, necessidadeIgnorada);
      if (item.quantidade > round3(noPedido - usada) + 0.000001) {
        throw erro(MENSAGEM_DEMANDA, 'DEMANDA_VINCULADA', 409);
      }
    }
  }
}

async function montarConsolidacao(db, entrada, atual) {
  const brutos = entrada.pedidos;
  const vistos = new Set();
  const vinculos = [];
  const grupos = new Map();
  for (const bruto of brutos) {
    const pedidoId = idOpcional(bruto && bruto.pedido_id, 'O pedido informado é inválido.', 'PEDIDO_INVALIDO');
    if (!pedidoId) throw erro('Informe o pedido da loja.', 'PEDIDO_INVALIDO');
    if (vistos.has(pedidoId)) throw erro('O pedido já está vinculado a esta necessidade.', 'PEDIDO_REPETIDO', 409);
    vistos.add(pedidoId);
    const pedido = await resolverPedido(db, pedidoId);
    const porProduto = new Map();
    for (const linha of (bruto.itens || [])) {
      const produtoId = idOpcional(linha && linha.produto_id, 'O produto informado é inválido.', 'PRODUTO_INVALIDO');
      if (!produtoId) continue;
      const quantidade = numeroOpcional(linha.quantidade, 'A quantidade a produzir é inválida.');
      if (!(quantidade > 0)) continue;
      const produto = await dadosProduto(db, produtoId);
      const unidade = texto(linha.unidade) || produto.unidade;
      const existente = porProduto.get(produtoId);
      if (existente && existente.unidade && unidade && existente.unidade !== unidade) {
        throw erro('Não foi possível consolidar o produto porque as unidades divergem.', 'UNIDADE_DIVERGENTE');
      }
      if (!existente) {
        porProduto.set(produtoId, { produto_id: produtoId, quantidade: 0, unidade, nome: produto.nome });
      }
      const alvo = porProduto.get(produtoId);
      alvo.quantidade = round3(alvo.quantidade + quantidade);
    }
    const itensPedido = [...porProduto.values()];
    if (!itensPedido.length) throw erro('Informe a quantidade a produzir.', 'QUANTIDADE_INVALIDA');
    vinculos.push({ pedido_id: pedidoId, codigo: texto(pedido.codigo), itens: itensPedido });
    for (const item of itensPedido) {
      const grupo = grupos.get(item.produto_id);
      if (grupo && grupo.unidade && item.unidade && grupo.unidade !== item.unidade) {
        throw erro('Não foi possível consolidar o produto porque as unidades divergem.', 'UNIDADE_DIVERGENTE');
      }
      if (!grupo) {
        grupos.set(item.produto_id, {
          produto_id: item.produto_id,
          descricao: item.nome,
          quantidade: item.quantidade,
          unidade: item.unidade
        });
      } else {
        grupo.quantidade = round3(grupo.quantidade + item.quantidade);
      }
    }
  }
  const pedidoUnico = vinculos.length === 1 ? vinculos[0].pedido_id : null;
  const informado = idOpcional(entrada.pedido_id, 'O pedido informado é inválido.', 'PEDIDO_INVALIDO');
  if (informado && pedidoUnico && informado !== pedidoUnico) {
    throw erro('O pedido do cabeçalho não corresponde ao pedido vinculado.', 'PEDIDO_CONFLITANTE');
  }
  let referencia = texto(entrada.referencia);
  if (!referencia) {
    referencia = vinculos.map((vinculo) => vinculo.codigo || `Pedido ${vinculo.pedido_id}`).join(', ');
  }
  const necessidade = await normalizar(db, {
    codigo: entrada.codigo,
    origem: ORIGEM_NECESSIDADE.PEDIDO_LOJA,
    pedido_id: pedidoUnico,
    referencia,
    descricao: entrada.descricao,
    data_necessidade: entrada.data_necessidade,
    status: entrada.status,
    observacoes: entrada.observacoes,
    itens: [...grupos.values()]
  }, atual);
  necessidade.vinculos = vinculos;
  return necessidade;
}

async function gravarVinculos(db, necessidadeId, vinculos) {
  const antigos = await all(db, 'SELECT id FROM necessidade_producao_pedidos WHERE necessidade_id = ?', [necessidadeId]);
  for (const antigo of antigos) {
    await run(db, 'DELETE FROM necessidade_producao_pedido_itens WHERE necessidade_pedido_id = ?', [antigo.id]);
  }
  await run(db, 'DELETE FROM necessidade_producao_pedidos WHERE necessidade_id = ?', [necessidadeId]);
  for (const vinculo of vinculos) {
    const inserido = await run(db, `
      INSERT INTO necessidade_producao_pedidos (necessidade_id, pedido_id) VALUES (?, ?)
    `, [necessidadeId, vinculo.pedido_id]);
    for (const item of vinculo.itens) {
      await run(db, `
        INSERT INTO necessidade_producao_pedido_itens (
          necessidade_pedido_id, produto_id, quantidade, unidade
        ) VALUES (?, ?, ?, ?)
      `, [inserido.id, item.produto_id, item.quantidade, item.unidade || null]);
    }
  }
}

async function sincronizarVinculoLegado(db, necessidadeId, pedidoId, origem) {
  const antigos = await all(db, 'SELECT id FROM necessidade_producao_pedidos WHERE necessidade_id = ?', [necessidadeId]);
  let rastros = 0;
  for (const antigo of antigos) {
    const row = await get(db, `
      SELECT COUNT(*) AS total FROM necessidade_producao_pedido_itens WHERE necessidade_pedido_id = ?
    `, [antigo.id]);
    rastros += Number(row && row.total) || 0;
  }
  if (rastros > 0) return;
  for (const antigo of antigos) {
    await run(db, 'DELETE FROM necessidade_producao_pedido_itens WHERE necessidade_pedido_id = ?', [antigo.id]);
  }
  await run(db, 'DELETE FROM necessidade_producao_pedidos WHERE necessidade_id = ?', [necessidadeId]);
  if (origem === ORIGEM_NECESSIDADE.PEDIDO_LOJA && pedidoId) {
    await run(db, `
      INSERT INTO necessidade_producao_pedidos (necessidade_id, pedido_id) VALUES (?, ?)
    `, [necessidadeId, pedidoId]);
  }
}

async function listarDemandaPedidos(db, necessidadeIgnorada) {
  await garantirSchema(db);
  if (!(await tabelaExiste(db, 'pedidos_comerciais'))) return [];
  const colunas = await all(db, 'PRAGMA table_info(pedidos_comerciais)');
  const nomes = new Set(colunas.map((coluna) => coluna.name));
  const pedidos = await all(db, `
    SELECT id, codigo,
           ${nomes.has('status') ? 'status' : "'' AS status"},
           ${nomes.has('cliente_id') ? 'cliente_id' : 'NULL AS cliente_id'}
    FROM pedidos_comerciais
    ${nomes.has('status') ? "WHERE COALESCE(status, '') <> 'CANCELADO'" : ''}
    ORDER BY id DESC
  `);
  const temCliente = await tabelaExiste(db, 'clientes');
  const resposta = [];
  for (const pedido of pedidos) {
    let clienteNome = '';
    if (temCliente && pedido.cliente_id) {
      const cliente = await get(db, 'SELECT nome FROM clientes WHERE id = ?', [pedido.cliente_id]);
      clienteNome = cliente ? texto(cliente.nome) : '';
    }
    if (!(await tabelaExiste(db, 'pedido_itens'))) {
      resposta.push({
        id: Number(pedido.id),
        codigo: texto(pedido.codigo),
        cliente_nome: clienteNome,
        itens: []
      });
      continue;
    }
    const linhas = await all(db, `
      SELECT produto_id, COALESCE(SUM(quantidade), 0) AS quantidade
      FROM pedido_itens WHERE pedido_id = ? GROUP BY produto_id ORDER BY produto_id
    `, [pedido.id]);
    const itens = [];
    for (const linha of linhas) {
      const produto = await dadosProduto(db, linha.produto_id);
      const noPedido = Number(linha.quantidade) || 0;
      const usada = await quantidadeJaVinculada(db, pedido.id, linha.produto_id, necessidadeIgnorada);
      itens.push({
        produto_id: Number(linha.produto_id),
        produto_nome: produto.nome,
        unidade: produto.unidade,
        quantidade_pedido: noPedido,
        quantidade_vinculada: usada,
        quantidade_elegivel: round3(Math.max(0, noPedido - usada))
      });
    }
    resposta.push({
      id: Number(pedido.id),
      codigo: texto(pedido.codigo),
      cliente_nome: clienteNome,
      itens
    });
  }
  return resposta;
}

async function listarNecessidades(db, filtro = {}) {
  await garantirSchema(db);
  const params = [];
  let where = '1 = 1';
  const atendimento = texto(filtro.atendimento).toUpperCase();
  if (atendimento === STATUS_NECESSIDADE.CANCELADA) where += ` AND n.status = 'CANCELADA'`;
  else if (!filtro.incluirCanceladas) where += ` AND n.status = 'ABERTA'`;
  const origem = texto(filtro.origem).toUpperCase();
  if (origem) {
    if (!ORIGENS.has(origem)) throw erro('A origem informada é inválida.', 'ORIGEM_INVALIDA');
    where += ' AND n.origem = ?';
    params.push(origem);
  }
  const busca = texto(filtro.busca);
  if (busca) {
    where += ` AND (
      n.codigo LIKE ? OR n.descricao LIKE ? OR IFNULL(n.referencia, '') LIKE ?
    )`;
    const termo = `%${busca}%`;
    params.push(termo, termo, termo);
  }
  const rows = await all(db, `
    SELECT n.id, n.codigo, n.origem, n.pedido_id, n.referencia, n.descricao,
           n.data_necessidade, n.status, n.updated_at,
           (SELECT COUNT(*) FROM necessidade_producao_itens i WHERE i.necessidade_id = n.id) AS itens
    FROM necessidades_producao n
    WHERE ${where}
    ORDER BY n.id DESC
  `, params);
  const lista = [];
  for (const row of rows.map(mapearResumo)) {
    const cheia = await obterNecessidade(db, row.id);
    lista.push({
      ...row,
      status: cheia.status,
      solicitado: cheia.atendimento.solicitado,
      planejado: cheia.atendimento.planejado,
      produzido: cheia.atendimento.produzido,
      restante: cheia.atendimento.restante
    });
  }
  if (atendimento && atendimento !== 'TODAS' && atendimento !== STATUS_NECESSIDADE.CANCELADA) {
    return lista.filter((item) => item.status === atendimento);
  }
  return lista;
}

async function proximoCodigo(db) {
  const row = await get(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS proximo FROM necessidades_producao');
  return `NP-${String(Number(row && row.proximo) || 1).padStart(4, '0')}`;
}

async function normalizar(db, entrada, atual) {
  const dados = entrada || {};
  const origem = texto(dados.origem).toUpperCase();
  if (!ORIGENS.has(origem)) throw erro('Informe a origem da necessidade.', 'ORIGEM_INVALIDA');

  const descricao = texto(dados.descricao);
  if (!descricao) throw erro('Informe a descrição da necessidade.', 'DESCRICAO_OBRIGATORIA');
  if (descricao.length > 200) throw erro('A descrição da necessidade é longa demais.', 'DESCRICAO_INVALIDA');

  let codigo = texto(dados.codigo).toUpperCase();
  if (!codigo) codigo = atual ? atual.codigo : await proximoCodigo(db);
  if (codigo.length > 40) throw erro('O código da necessidade é longo demais.', 'CODIGO_INVALIDO');

  const pedidoId = idOpcional(dados.pedido_id, 'O pedido informado é inválido.', 'PEDIDO_INVALIDO');
  if (pedidoId && origem !== ORIGEM_NECESSIDADE.PEDIDO_LOJA) {
    throw erro('O pedido da loja só pode ser indicado quando a origem é a loja.', 'PEDIDO_ORIGEM_INVALIDA');
  }
  const pedido = await resolverPedido(db, pedidoId);
  let referencia = texto(dados.referencia);
  if (!referencia && pedido && pedido.codigo) referencia = texto(pedido.codigo);
  if (origem === ORIGEM_NECESSIDADE.PEDIDO_LOJA && !pedidoId && !referencia) {
    throw erro('Informe o pedido ou a necessidade da loja.', 'ORIGEM_SEM_REFERENCIA');
  }
  if (referencia.length > 160) throw erro('A referência da necessidade é longa demais.', 'REFERENCIA_INVALIDA');

  const data = texto(dados.data_necessidade);
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw erro('A data da necessidade é inválida.', 'DATA_INVALIDA');
  }

  let status = STATUS_NECESSIDADE.ABERTA;
  if (atual) {
    const informado = texto(dados.status).toUpperCase() || STATUS_NECESSIDADE.ABERTA;
    if (informado === STATUS_NECESSIDADE.PARCIALMENTE_ATENDIDA || informado === STATUS_NECESSIDADE.ATENDIDA) {
      status = STATUS_NECESSIDADE.ABERTA;
    } else if (informado === STATUS_NECESSIDADE.CANCELADA) {
      if (atual.status === STATUS_NECESSIDADE.CANCELADA) throw erro(MENSAGEM_JA_CANCELADA, 'NECESSIDADE_CANCELADA', 409);
      if (atual.status === STATUS_NECESSIDADE.ATENDIDA) throw erro(MENSAGEM_NAO_CANCELA_ATENDIDA, 'NECESSIDADE_ATENDIDA', 409);
      status = STATUS_NECESSIDADE.CANCELADA;
    } else if (informado !== STATUS_NECESSIDADE.ABERTA) {
      throw erro('A necessidade não registra produção nem vira ordem de produção.', 'STATUS_INVALIDO');
    }
  }

  const brutos = dados.itens == null ? [] : dados.itens;
  if (!Array.isArray(brutos)) throw erro('A lista de itens é inválida.', 'ITENS_INVALIDOS');
  if (brutos.length > LIMITE_ITENS) {
    throw erro(`A necessidade aceita até ${LIMITE_ITENS} itens.`, 'LIMITE_EXCEDIDO');
  }

  const itens = [];
  for (const item of brutos) {
    const quantidadeBruta = item && item.quantidade;
    const unidade = texto(item && item.unidade);
    const observacao = texto(item && item.observacao);
    const produtoId = idOpcional(item && item.produto_id, 'O produto informado é inválido.', 'PRODUTO_INVALIDO');
    const fichaId = idOpcional(item && item.ficha_tecnica_id, 'A ficha técnica informada é inválida.', 'FICHA_INVALIDA');
    const fichaPadraoVinculoId = idOpcional(item && item.ficha_padrao_vinculo_id, 'O vínculo da ficha padrão é inválido.', 'VINCULO_INVALIDO');
    const fichaPadraoVersaoId = idOpcional(item && item.ficha_padrao_versao_id, 'A versão da ficha padrão é inválida.', 'VERSAO_INVALIDA');
    if (fichaId && fichaPadraoVinculoId) {
      throw erro('Selecione uma ficha tradicional histórica ou uma ficha padrão vinculada, não ambas.', 'FICHAS_DIVERGENTES');
    }
    if (fichaPadraoVersaoId && !fichaPadraoVinculoId) {
      throw erro('A versão só pode ser informada junto com um vínculo de ficha padrão.', 'VERSAO_SEM_VINCULO');
    }
    const itemDescricao = texto(item && item.descricao);
    const vazio = !itemDescricao && (quantidadeBruta === '' || quantidadeBruta == null) && !unidade && !observacao && !produtoId && !fichaId && !fichaPadraoVinculoId;
    if (vazio) continue;
    const cancelando = atual && status === STATUS_NECESSIDADE.CANCELADA;
    const produto = produtoId ? await conferirProduto(db, produtoId) : null;
    if (!produto && !cancelando) throw erro(MENSAGEM_SELECIONE_PRODUTO, 'PRODUTO_OBRIGATORIO', 400);
    const descricaoItem = itemDescricao || (produto ? produto.nome : '');
    if (!descricaoItem) throw erro('Todo item da necessidade precisa de uma descrição.', 'ITEM_SEM_DESCRICAO');
    const quantidade = numeroOpcional(quantidadeBruta, 'A quantidade a produzir é inválida.');
    if (quantidade == null || quantidade <= 0) {
      throw erro('Informe a quantidade a produzir.', 'QUANTIDADE_INVALIDA');
    }
    let fichaMantida = null;
    let versaoPadraoMantida = null;
    let snapshotFichaPadrao = null;
    const itemId = idOpcional(item && item.id, 'O item da necessidade é inválido.', 'ITEM_INVALIDO');
    const itemAnterior = atual && atual.itens.find((anterior) => anterior.id === itemId);
    if (fichaPadraoVinculoId) {
      if (itemAnterior &&
          itemAnterior.ficha_padrao_vinculo_id === fichaPadraoVinculoId &&
          itemAnterior.ficha_padrao_versao_id === fichaPadraoVersaoId &&
          itemAnterior.ficha_padrao_snapshot) {
        versaoPadraoMantida = itemAnterior.ficha_padrao_versao_id;
        snapshotFichaPadrao = itemAnterior.ficha_padrao_snapshot;
      } else {
        if (!produto) throw erro('Selecione um produto antes de vincular a ficha padrão.', 'PRODUTO_OBRIGATORIO');
        const capturada = await obterSnapshotVinculoProduto(
          db,
          fichaPadraoVinculoId,
          produto.id,
          fichaPadraoVersaoId
        );
        versaoPadraoMantida = capturada.ficha_padrao_versao_id;
        snapshotFichaPadrao = capturada.ficha_padrao_snapshot;
      }
    } else {
      const manterReferenciaHistorica = Boolean(
        itemAnterior && Number(itemAnterior.ficha_tecnica_id) === Number(fichaId)
      );
      fichaMantida = await conferirFicha(
        db,
        fichaId,
        produto ? produto.id : null,
        manterReferenciaHistorica
      );
    }
    itens.push({
      produto_id: produto ? produto.id : null,
      descricao: descricaoItem,
      quantidade,
      unidade,
      ficha_tecnica_id: fichaMantida,
      ficha_padrao_vinculo_id: fichaPadraoVinculoId,
      ficha_padrao_versao_id: versaoPadraoMantida,
      ficha_padrao_snapshot: snapshotFichaPadrao,
      observacao
    });
  }
  if (!itens.length) throw erro('Informe ao menos um item a produzir.', 'ITENS_OBRIGATORIOS');
  itens.forEach((item, indice) => { item.ordem = indice + 1; });

  const duplicada = await get(db, `
    SELECT id FROM necessidades_producao WHERE codigo = ? AND id <> ?
  `, [codigo, atual ? atual.id : 0]);
  if (duplicada) throw erro(`Já existe a necessidade ${codigo}.`, 'CODIGO_JA_EXISTE', 409);

  return {
    codigo,
    origem,
    pedido_id: pedidoId,
    referencia,
    descricao,
    data_necessidade: data || null,
    status,
    observacoes: texto(dados.observacoes),
    itens
  };
}

async function salvarNecessidade(db, entrada, id) {
  await garantirSchema(db);
  const atual = id ? await obterNecessidade(db, id) : null;
  const dados = entrada || {};
  const origemInformada = texto(dados.origem).toUpperCase();
  if (Array.isArray(dados.pedidos) && dados.pedidos.length && origemInformada !== ORIGEM_NECESSIDADE.PEDIDO_LOJA) {
    throw erro('O pedido da loja só pode ser indicado quando a origem é a loja.', 'PEDIDO_ORIGEM_INVALIDA');
  }
  const consolidar = Array.isArray(dados.pedidos) && dados.pedidos.length > 0;
  const necessidade = consolidar
    ? await montarConsolidacao(db, dados, atual)
    : await normalizar(db, dados, atual);
  await run(db, 'BEGIN');
  try {
    if (necessidade.vinculos) {
      await validarDemanda(db, necessidade.vinculos, atual ? atual.id : 0);
    }
    let necessidadeId = atual ? atual.id : null;
    const cancelando = atual && necessidade.status === STATUS_NECESSIDADE.CANCELADA;
    if (cancelando) {
      await run(db, `
        UPDATE necessidades_producao
        SET status = 'CANCELADA', updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `, [atual.id]);
      await run(db, 'COMMIT');
      return obterNecessidade(db, atual.id);
    }
    if (necessidadeId && await tabelaExiste(db, 'ordens_producao')) {
      const ligada = await get(db, 'SELECT id FROM ordens_producao WHERE necessidade_id = ? LIMIT 1', [necessidadeId]);
      if (ligada) {
        await run(db, `
          UPDATE necessidades_producao
          SET descricao = ?, data_necessidade = ?, observacoes = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `, [necessidade.descricao, necessidade.data_necessidade, necessidade.observacoes, necessidadeId]);
        await run(db, 'COMMIT');
        return obterNecessidade(db, necessidadeId);
      }
    }
    if (!necessidadeId) {
      const inserida = await run(db, `
        INSERT INTO necessidades_producao (
          codigo, origem, pedido_id, referencia, descricao, data_necessidade, status, observacoes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        necessidade.codigo, necessidade.origem, necessidade.pedido_id, necessidade.referencia,
        necessidade.descricao, necessidade.data_necessidade, necessidade.status, necessidade.observacoes
      ]);
      necessidadeId = inserida.id;
    } else {
      await run(db, 'DELETE FROM necessidade_producao_itens WHERE necessidade_id = ?', [necessidadeId]);
      await run(db, `
        UPDATE necessidades_producao
        SET codigo = ?, origem = ?, pedido_id = ?, referencia = ?, descricao = ?,
            data_necessidade = ?, status = ?, observacoes = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `, [
        necessidade.codigo, necessidade.origem, necessidade.pedido_id, necessidade.referencia,
        necessidade.descricao, necessidade.data_necessidade, necessidade.status,
        necessidade.observacoes, necessidadeId
      ]);
    }
    for (const item of necessidade.itens) {
      await run(db, `
        INSERT INTO necessidade_producao_itens (
          necessidade_id, ordem, produto_id, descricao, quantidade, unidade, ficha_tecnica_id,
          ficha_padrao_vinculo_id, ficha_padrao_versao_id, ficha_padrao_snapshot, observacao
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        necessidadeId, item.ordem, item.produto_id, item.descricao, item.quantidade,
        item.unidade, item.ficha_tecnica_id, item.ficha_padrao_vinculo_id,
        item.ficha_padrao_versao_id,
        item.ficha_padrao_snapshot == null ? null : JSON.stringify(item.ficha_padrao_snapshot),
        item.observacao
      ]);
    }
    if (necessidade.vinculos) await gravarVinculos(db, necessidadeId, necessidade.vinculos);
    else await sincronizarVinculoLegado(db, necessidadeId, necessidade.pedido_id, necessidade.origem);
    await run(db, 'COMMIT');
    return obterNecessidade(db, necessidadeId);
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* a transação já pode ter sido encerrada */ }
    throw err;
  }
}

async function consultarAtendimentoOperacional(db) {
  await garantirSchema(db);
  const necessidades = await all(db, `
    SELECT id, codigo, origem, descricao, status, created_at
    FROM necessidades_producao
    WHERE status <> 'CANCELADA'
    ORDER BY created_at, id
  `);
  if (!necessidades.length) return [];
  const ids = necessidades.map((item) => Number(item.id));
  const itens = await all(db, `
    SELECT id, necessidade_id, produto_id, descricao, quantidade, unidade
    FROM necessidade_producao_itens
    WHERE necessidade_id IN (${ids.map(() => '?').join(',')})
    ORDER BY necessidade_id, ordem, id
  `, ids);
  const mapa = await mapaProducao(db, itens.map((item) => Number(item.id)));
  const porNecessidade = new Map();
  for (const item of itens) {
    const necessidadeId = Number(item.necessidade_id);
    const lista = porNecessidade.get(necessidadeId) || [];
    lista.push({
      id: Number(item.id),
      produto_id: item.produto_id == null ? null : Number(item.produto_id),
      descricao: item.descricao,
      quantidade: Number(item.quantidade) || 0,
      unidade: item.unidade || ''
    });
    porNecessidade.set(necessidadeId, lista);
  }
  return necessidades.map((necessidade) => {
    const atendimento = montarAtendimento(
      necessidade.status,
      porNecessidade.get(Number(necessidade.id)) || [],
      mapa
    );
    return {
      id: Number(necessidade.id),
      codigo: necessidade.codigo,
      origem: necessidade.origem,
      origem_nome: NOMES_ORIGEM[necessidade.origem] || necessidade.origem,
      descricao: necessidade.descricao || '',
      created_at: necessidade.created_at || '',
      atendimento
    };
  });
}

async function calcularAtendimentoNecessidade(db, necessidadeId) {
  const necessidade = await obterNecessidade(db, necessidadeId);
  return necessidade.atendimento;
}

module.exports = {
  MENSAGEM_DEMANDA,
  MENSAGEM_JA_CANCELADA,
  MENSAGEM_NAO_CANCELA_ATENDIDA,
  MENSAGEM_SELECIONE_PRODUTO,
  MENSAGEM_PRODUTO_NAO_ENCONTRADO,
  MENSAGEM_SOMENTE_PRODUZIDO,
  listarProdutosProduzidos,
  listarNecessidades,
  listarDemandaPedidos,
  obterNecessidade,
  salvarNecessidade,
  calcularAtendimentoNecessidade,
  consultarAtendimentoOperacional,
  limiteNovaOp
};
