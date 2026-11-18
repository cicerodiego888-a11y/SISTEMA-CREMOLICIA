/**
 * Ordem de produção.
 * Registra o que produzir, quanto, para quando, com qual ficha e de onde veio.
 * Não executa produção, não consome insumo e não movimenta estoque.
 */

const bootstrapOrdensProducao = require('./migrations/005_ordens_producao');
const bootstrapInicioProducao = require('./migrations/009_ordem_producao_inicio');
const bootstrapFichaPadraoSemProduto = require('./migrations/015_fichas_padrao_no_produto');
const { obterNecessidade, limiteNovaOp } = require('./NecessidadeProducaoService');
const {
  listarFichasVinculadasProduto,
  obterSnapshotVinculoProduto
} = require('./FichaPadraoService');
const { ORIGEM_ORDEM, STATUS_ORDEM, PRIORIDADE_ORDEM } = require('./constants');

const ORIGENS = new Set(Object.values(ORIGEM_ORDEM));
const PRIORIDADES = new Set(Object.values(PRIORIDADE_ORDEM));
const LIMITE_ITENS = 50;
const MENSAGEM_MOTOR = 'O motor de produção ainda não está disponível.';
const MENSAGEM_CANCELAR_EXECUCAO = 'Esta ordem possui execução de produção e não pode ser cancelada por este fluxo.';
const MENSAGEM_QUANTIDADE = 'Quantidade da OP superior ao restante da necessidade.';
const MENSAGEM_SELECIONE_PRODUTO = 'Selecione um produto cadastrado para a ordem de produção.';
const MENSAGEM_PRODUTO_NAO_ENCONTRADO = 'Produto não encontrado.';
const MENSAGEM_SOMENTE_PRODUZIDO = 'Somente produtos produzidos podem ser utilizados em uma ordem de produção.';
const MENSAGEM_PRODUTO_INATIVO = 'O produto inativo não pode ser incluído em uma nova ordem de produção.';

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

function numero(valor, mensagem, codigo) {
  const n = Number(String(valor == null ? '' : valor).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw erro(mensagem, codigo);
  return n;
}

function idOpcional(valor, mensagem, codigo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw erro(mensagem, codigo);
  return n;
}

async function garantirSchema(db) {
  await bootstrapOrdensProducao(db);
  await bootstrapInicioProducao(db);
  await bootstrapFichaPadraoSemProduto(db);
}

async function tabelaExiste(db, nome) {
  const row = await get(db, `
    SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?
  `, [nome]);
  return !!row;
}

async function proximoCodigo(db) {
  const ano = new Date().getFullYear();
  const prefixo = `OP-${ano}-`;
  const row = await get(db, `
    SELECT codigo FROM ordens_producao
    WHERE codigo LIKE ?
    ORDER BY codigo DESC
    LIMIT 1
  `, [`${prefixo}%`]);
  const atual = row && String(row.codigo).startsWith(prefixo)
    ? Number(String(row.codigo).slice(prefixo.length))
    : 0;
  const proximo = (Number.isFinite(atual) ? atual : 0) + 1;
  return `${prefixo}${String(proximo).padStart(6, '0')}`;
}

async function colunasProduto(db) {
  if (!(await tabelaExiste(db, 'produtos'))) return new Set();
  const colunas = await all(db, 'PRAGMA table_info(produtos)');
  return new Set(colunas.map((coluna) => coluna.name));
}

async function produtoFisico(db, produtoId) {
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
    throw erro(MENSAGEM_PRODUTO_INATIVO, 'PRODUTO_INATIVO', 400);
  }
  return {
    id: Number(row.id),
    nome: texto(row.nome) || `Produto ${row.id}`,
    unidade: texto(row.unidade)
  };
}

async function fichaExistente(db, fichaId) {
  if (!fichaId) return null;
  if (!(await tabelaExiste(db, 'fichas_tecnicas'))) {
    throw erro('A ficha técnica informada não existe.', 'FICHA_NAO_ENCONTRADA', 404);
  }
  const row = await get(db, `
    SELECT id, codigo, nome, produto_id, ativa
    FROM fichas_tecnicas WHERE id = ?
  `, [fichaId]);
  if (!row) throw erro('A ficha técnica informada não existe.', 'FICHA_NAO_ENCONTRADA', 404);
  return row;
}

async function fichaUnicaDoProduto(db, produtoId) {
  if (!produtoId || !(await tabelaExiste(db, 'fichas_tecnicas'))) return null;
  const rows = await all(db, `
    SELECT id FROM fichas_tecnicas
    WHERE produto_id = ? AND COALESCE(ativa, 1) = 1
  `, [produtoId]);
  if (rows.length !== 1) return null;
  return Number(rows[0].id);
}

async function quantidadeJaPlanejada(db, necessidadeItemId, ordemIgnorada) {
  const row = await get(db, `
    SELECT COALESCE(SUM(i.quantidade_planejada), 0) AS quantidade
    FROM ordem_producao_itens i
    INNER JOIN ordens_producao o ON o.id = i.ordem_id
    WHERE i.necessidade_item_id = ?
      AND o.status <> 'CANCELADA'
      AND o.id <> ?
  `, [necessidadeItemId, ordemIgnorada || 0]);
  return Number(row && row.quantidade) || 0;
}

function mapearFicha(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    codigo: row.codigo,
    nome: row.nome,
    status: Number(row.ativa) === 0 ? 'INATIVA' : 'ATIVA'
  };
}

function mapearItem(row) {
  return {
    id: Number(row.id),
    ordem: Number(row.ordem),
    produto_id: row.produto_id == null ? null : Number(row.produto_id),
    produto_codigo: row.produto_codigo || '',
    produto_nome: row.produto_nome_atual || row.produto_nome,
    quantidade_planejada: Number(row.quantidade_planejada),
    unidade: row.unidade || '',
    ficha_tecnica_id: row.ficha_tecnica_id == null ? null : Number(row.ficha_tecnica_id),
    ficha_padrao_vinculo_id: row.ficha_padrao_vinculo_id == null ? null : Number(row.ficha_padrao_vinculo_id),
    ficha_padrao_versao_id: row.ficha_padrao_versao_id == null ? null : Number(row.ficha_padrao_versao_id),
    ficha_padrao_snapshot: row.ficha_padrao_snapshot ? JSON.parse(row.ficha_padrao_snapshot) : null,
    necessidade_item_id: row.necessidade_item_id == null ? null : Number(row.necessidade_item_id),
    observacao: row.observacao || '',
    ficha: mapearFicha(row.ficha_id ? {
      id: row.ficha_id,
      codigo: row.ficha_codigo,
      nome: row.ficha_nome,
      ativa: row.ficha_ativa
    } : null)
  };
}

async function lerItens(db, ordemId) {
  const nomes = await colunasProduto(db);
  const temProduto = nomes.size > 0;
  const temFicha = await tabelaExiste(db, 'fichas_tecnicas');
  const codigo = nomes.has('codigo') ? 'p.codigo AS produto_codigo' : "'' AS produto_codigo";
  const rows = await all(db, `
    SELECT i.id, i.ordem, i.produto_id, ${codigo},
           ${temProduto ? 'COALESCE(p.nome, i.produto_nome)' : 'i.produto_nome'} AS produto_nome_atual,
           i.produto_nome, i.quantidade_planejada, i.unidade, i.ficha_tecnica_id,
           i.ficha_padrao_vinculo_id, i.ficha_padrao_versao_id, i.ficha_padrao_snapshot,
           i.necessidade_item_id, i.observacao,
           ${temFicha ? 'f.id AS ficha_id, f.codigo AS ficha_codigo, f.nome AS ficha_nome, f.ativa AS ficha_ativa' : 'NULL AS ficha_id, NULL AS ficha_codigo, NULL AS ficha_nome, NULL AS ficha_ativa'}
    FROM ordem_producao_itens i
    ${temProduto ? 'LEFT JOIN produtos p ON p.id = i.produto_id' : ''}
    ${temFicha ? 'LEFT JOIN fichas_tecnicas f ON f.id = i.ficha_tecnica_id' : ''}
    WHERE i.ordem_id = ?
    ORDER BY i.ordem, i.id
  `, [ordemId]);
  return rows.map(mapearItem);
}

function mapearResumo(row) {
  return {
    id: Number(row.id),
    codigo: row.codigo,
    status: row.status,
    data_prevista: row.data_prevista || '',
    prioridade: row.prioridade,
    origem: row.origem,
    produto_nome: row.produto_nome || '',
    quantidade_planejada: row.quantidade_planejada == null ? null : Number(row.quantidade_planejada),
    unidade: row.unidade || '',
    itens: Number(row.itens || 0),
    updated_at: row.updated_at
  };
}

async function obterOrdem(db, id) {
  await garantirSchema(db);
  const ordemId = Number(id);
  if (!Number.isInteger(ordemId) || ordemId <= 0) {
    throw erro('Ordem de produção não encontrada.', 'ORDEM_NAO_ENCONTRADA', 404);
  }
  const temNecessidade = await tabelaExiste(db, 'necessidades_producao');
  const row = await get(db, `
    SELECT o.id, o.codigo, o.status, o.data_prevista, o.prioridade, o.origem, o.observacao,
           o.usuario_id, o.usuario_nome, o.necessidade_id, o.pedido_id, o.referencia,
           o.producao_iniciada_em, o.producao_usuario_id, o.producao_usuario_nome,
           o.created_at, o.updated_at,
           ${temNecessidade ? 'n.codigo AS necessidade_codigo, n.status AS necessidade_status' : 'NULL AS necessidade_codigo, NULL AS necessidade_status'}
    FROM ordens_producao o
    ${temNecessidade ? 'LEFT JOIN necessidades_producao n ON n.id = o.necessidade_id' : ''}
    WHERE o.id = ?
  `, [ordemId]);
  if (!row) throw erro('Ordem de produção não encontrada.', 'ORDEM_NAO_ENCONTRADA', 404);
  return {
    id: Number(row.id),
    codigo: row.codigo,
    status: row.status,
    data_prevista: row.data_prevista || '',
    prioridade: row.prioridade,
    origem: row.origem,
    observacao: row.observacao || '',
    usuario_id: row.usuario_id == null ? null : Number(row.usuario_id),
    usuario_nome: row.usuario_nome || '',
    necessidade_id: row.necessidade_id == null ? null : Number(row.necessidade_id),
    necessidade_codigo: row.necessidade_codigo || '',
    necessidade_status: row.necessidade_status || '',
    pedido_id: row.pedido_id == null ? null : Number(row.pedido_id),
    referencia: row.referencia || '',
    producao_iniciada_em: row.producao_iniciada_em || '',
    producao_usuario_id: row.producao_usuario_id == null ? null : Number(row.producao_usuario_id),
    producao_usuario_nome: row.producao_usuario_nome || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    itens: await lerItens(db, ordemId)
  };
}

async function listarOrdens(db, filtro = {}) {
  await garantirSchema(db);
  const params = [];
  let where = '1 = 1';
  const status = texto(filtro.status).toUpperCase();
  if (status) {
    if (!Object.values(STATUS_ORDEM).includes(status)) {
      throw erro('O status informado é inválido.', 'STATUS_INVALIDO');
    }
    where += ' AND o.status = ?';
    params.push(status);
  }
  const prioridade = texto(filtro.prioridade).toUpperCase();
  if (prioridade) {
    if (!PRIORIDADES.has(prioridade)) throw erro('A prioridade informada é inválida.', 'PRIORIDADE_INVALIDA');
    where += ' AND o.prioridade = ?';
    params.push(prioridade);
  }
  const produto = texto(filtro.produto);
  if (produto) {
    where += ` AND EXISTS (
      SELECT 1 FROM ordem_producao_itens i
      LEFT JOIN produtos p ON p.id = i.produto_id
      WHERE i.ordem_id = o.id AND (i.produto_nome LIKE ? OR IFNULL(p.nome, '') LIKE ? OR CAST(i.produto_id AS TEXT) = ?)
    )`;
    params.push(`%${produto}%`, `%${produto}%`, produto);
  }
  const inicio = texto(filtro.inicio);
  const fim = texto(filtro.fim);
  if ((inicio && !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) || (fim && !/^\d{4}-\d{2}-\d{2}$/.test(fim))) {
    throw erro('O período informado é inválido.', 'PERIODO_INVALIDO');
  }
  if (inicio) {
    where += ' AND o.data_prevista >= ?';
    params.push(inicio);
  }
  if (fim) {
    where += ' AND o.data_prevista <= ?';
    params.push(fim);
  }
  const necessidadeId = idOpcional(filtro.necessidade_id, 'A necessidade informada é inválida.', 'NECESSIDADE_INVALIDA');
  if (necessidadeId) {
    where += ' AND o.necessidade_id = ?';
    params.push(necessidadeId);
  }
  const rows = await all(db, `
    SELECT o.id, o.codigo, o.status, o.data_prevista, o.prioridade, o.origem, o.updated_at,
           (SELECT COUNT(*) FROM ordem_producao_itens i WHERE i.ordem_id = o.id) AS itens,
           (SELECT i.produto_nome FROM ordem_producao_itens i WHERE i.ordem_id = o.id ORDER BY i.ordem, i.id LIMIT 1) AS produto_nome,
           (SELECT i.quantidade_planejada FROM ordem_producao_itens i WHERE i.ordem_id = o.id ORDER BY i.ordem, i.id LIMIT 1) AS quantidade_planejada,
           (SELECT i.unidade FROM ordem_producao_itens i WHERE i.ordem_id = o.id ORDER BY i.ordem, i.id LIMIT 1) AS unidade
    FROM ordens_producao o
    WHERE ${where}
    ORDER BY o.id DESC
  `, params);
  return rows.map(mapearResumo);
}

function dataPrevista(valor) {
  const data = texto(valor);
  if (!data) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw erro('A data prevista é inválida.', 'DATA_INVALIDA');
  return data;
}

function prioridadeDe(valor) {
  const prioridade = texto(valor).toUpperCase() || PRIORIDADE_ORDEM.NORMAL;
  if (!PRIORIDADES.has(prioridade)) throw erro('A prioridade informada é inválida.', 'PRIORIDADE_INVALIDA');
  return prioridade;
}

function recusarExecucao(status) {
  if (status === STATUS_ORDEM.EM_PRODUCAO || status === STATUS_ORDEM.CONCLUIDA) {
    throw erro(MENSAGEM_MOTOR, 'MOTOR_PRODUCAO_INDISPONIVEL', 409);
  }
}

async function resolverFicha(db, item, produtoId, fichaDaNecessidade, permitirReferenciaHistorica = false) {
  const explicita = item && Object.prototype.hasOwnProperty.call(item, 'ficha_tecnica_id');
  if (explicita) {
    const fichaId = idOpcional(item.ficha_tecnica_id, 'A ficha técnica informada é inválida.', 'FICHA_INVALIDA');
    if (!fichaId) return null;
    const ficha = await fichaExistente(db, fichaId);
    if (ficha.produto_id != null && Number(ficha.produto_id) !== Number(produtoId)) {
      throw erro('A ficha técnica não está associada ao produto informado.', 'FICHA_PRODUTO_DIVERGENTE', 409);
    }
    if (!permitirReferenciaHistorica &&
        (ficha.produto_id == null || Number(ficha.ativa) !== 1)) {
      throw erro('Vincule uma ficha tradicional ativa ao produto antes de utilizá-la.', 'FICHA_NAO_VINCULADA', 409);
    }
    return Number(ficha.id);
  }
  if (fichaDaNecessidade) {
    const ficha = await fichaExistente(db, fichaDaNecessidade);
    if (ficha.produto_id != null && Number(ficha.produto_id) !== Number(produtoId)) {
      throw erro('A ficha técnica não está associada ao produto informado.', 'FICHA_PRODUTO_DIVERGENTE', 409);
    }
    if (permitirReferenciaHistorica ||
        (ficha.produto_id != null && Number(ficha.ativa) === 1)) {
      return Number(ficha.id);
    }
    throw erro('Vincule uma ficha tradicional ativa ao produto antes de utilizá-la.', 'FICHA_NAO_VINCULADA', 409);
  }
  return fichaUnicaDoProduto(db, produtoId);
}

async function normalizarItens(db, brutos, necessidade, ordemIgnorada, itensAnteriores = []) {
  if (!Array.isArray(brutos)) throw erro('A lista de itens é inválida.', 'ITENS_INVALIDOS');
  if (brutos.length > LIMITE_ITENS) throw erro(`A ordem aceita até ${LIMITE_ITENS} itens.`, 'LIMITE_EXCEDIDO');
  const itens = [];
  const vistos = new Set();
  for (const bruto of brutos) {
    if (bruto && (bruto.linha_comercial_id || bruto.tabela_preco_id || bruto.grupo_insumo_id) && !bruto.produto_id) {
      throw erro(MENSAGEM_SELECIONE_PRODUTO, 'PRODUTO_OBRIGATORIO');
    }
    const produtoId = idOpcional(bruto && bruto.produto_id, 'O produto informado é inválido.', 'PRODUTO_INVALIDO');
    if (!produtoId) throw erro(MENSAGEM_SELECIONE_PRODUTO, 'PRODUTO_OBRIGATORIO');
    const produto = await produtoFisico(db, produtoId);
    const necessidadeItemId = idOpcional(
      bruto && bruto.necessidade_item_id,
      'O item da necessidade informado é inválido.',
      'ITEM_NECESSIDADE_INVALIDO'
    );
    let origemItem = null;
    if (necessidade) {
      origemItem = necessidade.itens.find((item) => item.id === necessidadeItemId);
      if (!origemItem) throw erro('O item não pertence à necessidade informada.', 'ITEM_NECESSIDADE_INVALIDO');
      if (origemItem.produto_id && Number(origemItem.produto_id) !== produtoId) {
        throw erro('O produto da OP deve ser o produto da necessidade.', 'PRODUTO_DIFERENTE_DA_NECESSIDADE');
      }
      if (vistos.has(necessidadeItemId)) throw erro('O item da necessidade já está nesta ordem.', 'ITEM_REPETIDO');
      vistos.add(necessidadeItemId);
    }
    const quantidade = numero(
      bruto.quantidade_planejada != null ? bruto.quantidade_planejada : bruto.quantidade,
      'Informe a quantidade planejada.',
      'QUANTIDADE_INVALIDA'
    );
    if (origemItem) {
      const limite = await limiteNovaOp(db, origemItem.id, Number(origemItem.quantidade), ordemIgnorada);
      if (quantidade > limite + 0.000001) {
        throw erro(MENSAGEM_QUANTIDADE, 'QUANTIDADE_ACIMA_DO_RESTANTE', 409);
      }
    }
    const unidade = texto(bruto.unidade) || (origemItem && origemItem.unidade) || produto.unidade;
    const observacao = texto(bruto.observacao);
    const fichaPadraoBruta = bruto && bruto.ficha_padrao_vinculo_id;
    const fichaTradicionalBruta = bruto && bruto.ficha_tecnica_id;
    if (fichaPadraoBruta && fichaTradicionalBruta) {
      throw erro('Selecione uma ficha tradicional histórica ou uma ficha padrão vinculada, não ambas.', 'FICHAS_DIVERGENTES');
    }
    let fichaPadraoVinculoId = idOpcional(
      fichaPadraoBruta,
      'O vínculo da ficha padrão informado é inválido.',
      'VINCULO_INVALIDO'
    );
    let fichaPadraoVersaoId = idOpcional(
      bruto && bruto.ficha_padrao_versao_id,
      'A versão da ficha padrão informada é inválida.',
      'VERSAO_INVALIDA'
    );
    const fichaPadraoOrigem = origemItem && origemItem.ficha_padrao_vinculo_id;
    const itemId = idOpcional(bruto && bruto.id, 'O item da ordem informado é inválido.', 'ITEM_INVALIDO');
    const itemAnterior = itensAnteriores.find((item) => item.id === itemId);
    if (!fichaPadraoVinculoId && fichaPadraoOrigem) {
      fichaPadraoVinculoId = fichaPadraoOrigem;
      fichaPadraoVersaoId = origemItem.ficha_padrao_versao_id;
    }

    let fichaId = null;
    let fichaPadraoSnapshot = null;
    if (fichaPadraoVinculoId) {
      if (itemAnterior &&
          itemAnterior.ficha_padrao_vinculo_id === fichaPadraoVinculoId &&
          itemAnterior.ficha_padrao_versao_id === fichaPadraoVersaoId &&
          itemAnterior.ficha_padrao_snapshot) {
        fichaPadraoSnapshot = itemAnterior.ficha_padrao_snapshot;
      } else if (origemItem &&
          origemItem.ficha_padrao_vinculo_id === fichaPadraoVinculoId &&
          origemItem.ficha_padrao_versao_id === fichaPadraoVersaoId &&
          origemItem.ficha_padrao_snapshot) {
        fichaPadraoSnapshot = origemItem.ficha_padrao_snapshot;
      } else {
        const capturada = await obterSnapshotVinculoProduto(
          db,
          fichaPadraoVinculoId,
          produto.id,
          fichaPadraoVersaoId
        );
        fichaPadraoVersaoId = capturada.ficha_padrao_versao_id;
        fichaPadraoSnapshot = capturada.ficha_padrao_snapshot;
      }
    } else {
      const fichaExplicita = idOpcional(
        bruto && bruto.ficha_tecnica_id,
        'A ficha técnica informada é inválida.',
        'FICHA_INVALIDA'
      );
      if (!fichaExplicita && !(origemItem && origemItem.ficha_tecnica_id)) {
        const vinculadas = await listarFichasVinculadasProduto(db, produto.id);
        if (vinculadas.length > 1) {
          throw erro('Selecione uma ficha técnica para este item da ordem.', 'FICHA_ESCOLHA_OBRIGATORIA');
        }
        if (vinculadas.length === 1) {
          if (vinculadas[0].origem === 'TRADICIONAL') {
            fichaId = vinculadas[0].ficha_tecnica_id;
          } else {
            fichaPadraoVinculoId = vinculadas[0].ficha_padrao_vinculo_id;
            fichaPadraoVersaoId = vinculadas[0].ficha_padrao_versao_id;
            const capturada = await obterSnapshotVinculoProduto(
              db,
              fichaPadraoVinculoId,
              produto.id,
              fichaPadraoVersaoId
            );
            fichaPadraoSnapshot = capturada.ficha_padrao_snapshot;
          }
        } else {
          fichaId = await resolverFicha(
            db,
            bruto,
            produtoId,
            origemItem ? origemItem.ficha_tecnica_id : null
          );
        }
      } else {
        const fichaSelecionada = fichaExplicita || (origemItem && origemItem.ficha_tecnica_id);
        const manterReferenciaHistorica = Boolean(
          (itemAnterior && Number(itemAnterior.ficha_tecnica_id) === Number(fichaSelecionada)) ||
          (origemItem && Number(origemItem.ficha_tecnica_id) === Number(fichaSelecionada))
        );
        fichaId = await resolverFicha(
          db,
          bruto,
          produtoId,
          origemItem ? origemItem.ficha_tecnica_id : null,
          manterReferenciaHistorica
        );
      }
    }
    itens.push({
      produto_id: produto.id,
      produto_nome: produto.nome,
      quantidade_planejada: quantidade,
      unidade,
      ficha_tecnica_id: fichaId,
      ficha_padrao_vinculo_id: fichaPadraoVinculoId,
      ficha_padrao_versao_id: fichaPadraoVersaoId,
      ficha_padrao_snapshot: fichaPadraoSnapshot,
      necessidade_item_id: origemItem ? origemItem.id : null,
      observacao
    });
  }
  if (!itens.length) throw erro('Informe ao menos um produto a produzir.', 'ITENS_OBRIGATORIOS');
  itens.forEach((item, indice) => { item.ordem = indice + 1; });
  return itens;
}

function itensDaNecessidade(necessidade, entrada) {
  if (Array.isArray(entrada.itens) && entrada.itens.length) return entrada.itens;
  return necessidade.itens.map((item) => ({
    necessidade_item_id: item.id,
    produto_id: item.produto_id,
    quantidade_planejada: item.quantidade,
    unidade: item.unidade,
    observacao: item.observacao
  }));
}

async function pedidoUnicoDaNecessidade(db, necessidade) {
  const links = await all(db, `
    SELECT pedido_id FROM necessidade_producao_pedidos WHERE necessidade_id = ? ORDER BY id
  `, [necessidade.id]);
  if (links.length > 1) return null;
  if (links.length === 1) return Number(links[0].pedido_id);
  return necessidade.pedido_id;
}

async function montarCabecalho(db, entrada, atual) {
  const dados = entrada || {};
  recusarExecucao(texto(dados.status).toUpperCase());
  const necessidadeId = atual
    ? atual.necessidade_id
    : idOpcional(dados.necessidade_id, 'A necessidade informada é inválida.', 'NECESSIDADE_INVALIDA');
  let necessidade = null;
  let origem = texto(dados.origem).toUpperCase();
  let pedidoId = null;
  let referencia = texto(dados.referencia);
  if (necessidadeId) {
    necessidade = await obterNecessidade(db, necessidadeId);
    if (necessidade.status === 'CANCELADA' || necessidade.status === 'ATENDIDA') {
      const mensagem = necessidade.status === 'ATENDIDA'
        ? 'A necessidade de produção já foi atendida.'
        : 'A necessidade cancelada não gera ordem de produção.';
      throw erro(mensagem, 'NECESSIDADE_INDISPONIVEL', 409);
    }
    origem = ORIGEM_ORDEM.NECESSIDADE;
    pedidoId = await pedidoUnicoDaNecessidade(db, necessidade);
    if (!referencia) referencia = necessidade.referencia || necessidade.codigo;
  } else if (!origem) {
    origem = ORIGEM_ORDEM.MANUAL;
  }
  if (!ORIGENS.has(origem) || origem === ORIGEM_ORDEM.NECESSIDADE && !necessidadeId) {
    throw erro('Informe a origem da ordem.', 'ORIGEM_INVALIDA');
  }
  if (atual && atual.necessidade_id && origem !== ORIGEM_ORDEM.NECESSIDADE) {
    throw erro('A origem desta ordem permanece a necessidade de produção.', 'ORIGEM_INVALIDA');
  }
  const observacao = texto(dados.observacao != null ? dados.observacao : dados.observacoes);
  if (observacao.length > 2000) throw erro('A observação da ordem é longa demais.', 'OBSERVACAO_INVALIDA');
  if (referencia.length > 160) throw erro('A referência da ordem é longa demais.', 'REFERENCIA_INVALIDA');
  return {
    necessidade,
    cabecalho: {
      data_prevista: dataPrevista(dados.data_prevista),
      prioridade: prioridadeDe(dados.prioridade),
      origem,
      observacao,
      necessidade_id: necessidadeId,
      pedido_id: pedidoId,
      referencia: referencia || null
    },
    itens: await normalizarItens(
      db,
      necessidade ? itensDaNecessidade(necessidade, dados) : (dados.itens || []),
      necessidade,
      atual ? atual.id : 0,
      atual ? atual.itens : []
    )
  };
}

async function gravarItens(db, ordemId, itens) {
  await run(db, 'DELETE FROM ordem_producao_itens WHERE ordem_id = ?', [ordemId]);
  for (const item of itens) {
    await run(db, `
      INSERT INTO ordem_producao_itens (
        ordem_id, ordem, produto_id, produto_nome, quantidade_planejada, unidade,
        ficha_tecnica_id, ficha_padrao_vinculo_id, ficha_padrao_versao_id,
        ficha_padrao_snapshot, necessidade_item_id, observacao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      ordemId, item.ordem, item.produto_id, item.produto_nome, item.quantidade_planejada,
      item.unidade, item.ficha_tecnica_id, item.ficha_padrao_vinculo_id,
      item.ficha_padrao_versao_id,
      item.ficha_padrao_snapshot == null ? null : JSON.stringify(item.ficha_padrao_snapshot),
      item.necessidade_item_id, item.observacao
    ]);
  }
}

async function auditar(contexto, acao, ordem) {
  if (!contexto || typeof contexto.auditar !== 'function') return;
  await contexto.auditar({
    acao,
    referencia_id: ordem.id,
    detalhes: { codigo: ordem.codigo, status: ordem.status }
  });
}

async function salvarOrdem(db, entrada, id, contexto) {
  await garantirSchema(db);
  recusarExecucao(texto(entrada && entrada.status).toUpperCase());
  const atual = id ? await obterOrdem(db, id) : null;
  if (atual && atual.status !== STATUS_ORDEM.RASCUNHO) {
    recusarExecucao(atual.status);
    if (atual.status === STATUS_ORDEM.CANCELADA) {
      throw erro('A ordem cancelada não pode ser editada.', 'ORDEM_CANCELADA', 409);
    }
    throw erro('Esta ordem não pode ser editada neste status.', 'ORDEM_NAO_EDITAVEL', 409);
  }
  const montada = await montarCabecalho(db, entrada, atual);
  const usuarioId = !atual && contexto && contexto.usuario_id ? Number(contexto.usuario_id) : null;
  const usuarioNome = !atual && contexto ? texto(contexto.usuario_nome) : '';
  await run(db, 'BEGIN');
  try {
    let ordemId = atual ? atual.id : null;
    if (!ordemId) {
      const codigo = await proximoCodigo(db);
      const inserida = await run(db, `
        INSERT INTO ordens_producao (
          codigo, status, data_prevista, prioridade, origem, observacao,
          usuario_id, usuario_nome, necessidade_id, pedido_id, referencia
        ) VALUES (?, 'RASCUNHO', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        codigo, montada.cabecalho.data_prevista, montada.cabecalho.prioridade,
        montada.cabecalho.origem, montada.cabecalho.observacao,
        Number.isInteger(usuarioId) && usuarioId > 0 ? usuarioId : null,
        usuarioNome || null, montada.cabecalho.necessidade_id,
        montada.cabecalho.pedido_id, montada.cabecalho.referencia
      ]);
      ordemId = inserida.id;
    } else {
      await run(db, `
        UPDATE ordens_producao
        SET data_prevista = ?, prioridade = ?, origem = ?, observacao = ?,
            referencia = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ? AND status = 'RASCUNHO'
      `, [
        montada.cabecalho.data_prevista, montada.cabecalho.prioridade,
        montada.cabecalho.origem, montada.cabecalho.observacao,
        montada.cabecalho.referencia, ordemId
      ]);
    }
    await gravarItens(db, ordemId, montada.itens);
    await run(db, 'COMMIT');
    const ordem = await obterOrdem(db, ordemId);
    await auditar(contexto, atual ? 'OP_EDITADA' : 'OP_CRIADA', ordem);
    return ordem;
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* a transação já pode ter sido encerrada */ }
    throw err;
  }
}

async function planejarOrdem(db, id, contexto) {
  await garantirSchema(db);
  const atual = await obterOrdem(db, id);
  recusarExecucao(atual.status);
  if (atual.status !== STATUS_ORDEM.RASCUNHO) {
    throw erro('Somente uma ordem em rascunho pode ser planejada.', 'STATUS_INVALIDO', 409);
  }
  if (!atual.itens.length) throw erro('Informe ao menos um produto a produzir.', 'ITENS_OBRIGATORIOS');
  await run(db, `
    UPDATE ordens_producao
    SET status = 'PLANEJADA', updated_at = datetime('now', 'localtime')
    WHERE id = ? AND status = 'RASCUNHO'
  `, [atual.id]);
  const ordem = await obterOrdem(db, atual.id);
  await auditar(contexto, 'OP_PLANEJADA', ordem);
  return ordem;
}

async function cancelarOrdem(db, id, contexto) {
  await garantirSchema(db);
  const atual = await obterOrdem(db, id);
  if (atual.status === STATUS_ORDEM.CONCLUIDA) {
    throw erro('A Ordem de Produção já foi concluída e não pode ser cancelada.', 'OP_CONCLUIDA', 409);
  }
  if (atual.status === STATUS_ORDEM.EM_PRODUCAO) {
    throw erro(MENSAGEM_CANCELAR_EXECUCAO, 'OP_COM_EXECUCAO', 409);
  }
  if (atual.status === STATUS_ORDEM.CANCELADA) {
    throw erro('A ordem cancelada não pode ser editada.', 'ORDEM_CANCELADA', 409);
  }
  if (atual.status !== STATUS_ORDEM.RASCUNHO && atual.status !== STATUS_ORDEM.PLANEJADA) {
    throw erro(MENSAGEM_CANCELAR_EXECUCAO, 'OP_COM_EXECUCAO', 409);
  }
  await run(db, `
    UPDATE ordens_producao
    SET status = 'CANCELADA', updated_at = datetime('now', 'localtime')
    WHERE id = ? AND status IN ('RASCUNHO', 'PLANEJADA')
  `, [atual.id]);
  const ordem = await obterOrdem(db, atual.id);
  await auditar(contexto, 'OP_CANCELADA', ordem);
  return ordem;
}

async function coberturaNecessidade(db, necessidadeId) {
  await garantirSchema(db);
  const necessidade = await obterNecessidade(db, necessidadeId);
  const itens = [];
  for (const item of necessidade.itens) {
    const atendido = await quantidadeJaPlanejada(db, item.id, 0);
    const info = (necessidade.atendimento.itens || []).find((linha) => linha.necessidade_item_id === item.id);
    const limite = await limiteNovaOp(db, item.id, Number(item.quantidade), 0);
    itens.push({
      necessidade_item_id: item.id,
      produto_id: item.produto_id,
      descricao: item.descricao,
      unidade: item.unidade,
      ficha_tecnica_id: item.ficha_tecnica_id,
      ficha_padrao_vinculo_id: item.ficha_padrao_vinculo_id,
      ficha_padrao_versao_id: item.ficha_padrao_versao_id,
      ficha_padrao_snapshot: item.ficha_padrao_snapshot,
      solicitado: Number(item.quantidade),
      produzido: info ? info.produzido : 0,
      situacao: info ? info.situacao : '',
      situacao_nome: info ? info.situacao_nome : '',
      atendido,
      restante: limite
    });
  }
  return {
    necessidade_id: necessidade.id,
    codigo: necessidade.codigo,
    status: necessidade.status,
    descricao: necessidade.descricao,
    pedido_id: necessidade.pedido_id,
    referencia: necessidade.referencia,
    itens
  };
}

const MENSAGEM_OP_EXISTENTE = 'Esta necessidade já possui uma Ordem de Produção.';
const MENSAGEM_ITEM_SEM_PRODUTO = 'A necessidade possui item sem produto cadastrado. Selecione o produto antes de criar a Ordem de Produção.';
const criacoesPorNecessidade = new Map();

async function ordemAtivaDaNecessidade(db, necessidadeId) {
  const row = await get(db, `
    SELECT id FROM ordens_producao
    WHERE necessidade_id = ? AND status <> 'CANCELADA'
    ORDER BY id LIMIT 1
  `, [necessidadeId]);
  return row ? obterOrdem(db, row.id) : null;
}

async function criarOrdemSemDuplicar(db, necessidadeId, contexto) {
  await garantirSchema(db);
  const necessidade = await obterNecessidade(db, necessidadeId);
  const existente = await ordemAtivaDaNecessidade(db, necessidade.id);
  if (existente) return { criada: false, mensagem: MENSAGEM_OP_EXISTENTE, ordem: existente };
  if (necessidade.itens.some((item) => !item.produto_id)) {
    throw erro(MENSAGEM_ITEM_SEM_PRODUTO, 'PRODUTO_OBRIGATORIO');
  }
  const itens = [];
  for (const item of necessidade.itens) {
    const restante = await limiteNovaOp(db, item.id, Number(item.quantidade), 0);
    if (restante <= 0.000001) continue;
    itens.push({
      necessidade_item_id: item.id,
      produto_id: item.produto_id,
      quantidade_planejada: restante,
      unidade: item.unidade,
      observacao: item.observacao
    });
  }
  if (!itens.length) {
    throw erro('A necessidade não tem quantidade restante para produzir.', 'SEM_QUANTIDADE_RESTANTE', 409);
  }
  const ordem = await salvarOrdem(db, { necessidade_id: necessidade.id, itens }, null, contexto);
  return { criada: true, ordem };
}

/** Cria a OP em rascunho com o restante da necessidade; se já houver OP não cancelada, devolve a existente. */
async function criarOrdemDaNecessidade(db, necessidadeId, contexto) {
  const chave = String(necessidadeId);
  const anterior = criacoesPorNecessidade.get(chave) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(() => criarOrdemSemDuplicar(db, necessidadeId, contexto));
  criacoesPorNecessidade.set(chave, atual);
  try {
    return await atual;
  } finally {
    if (criacoesPorNecessidade.get(chave) === atual) criacoesPorNecessidade.delete(chave);
  }
}

module.exports = {
  MENSAGEM_MOTOR,
  MENSAGEM_OP_EXISTENTE,
  MENSAGEM_CANCELAR_EXECUCAO,
  MENSAGEM_QUANTIDADE,
  MENSAGEM_SELECIONE_PRODUTO,
  MENSAGEM_PRODUTO_NAO_ENCONTRADO,
  MENSAGEM_SOMENTE_PRODUZIDO,
  MENSAGEM_PRODUTO_INATIVO,
  listarOrdens,
  obterOrdem,
  salvarOrdem,
  planejarOrdem,
  cancelarOrdem,
  coberturaNecessidade,
  criarOrdemDaNecessidade
};
