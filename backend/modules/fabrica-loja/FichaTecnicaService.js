/**
 * Cadastro da ficha técnica.
 * A ficha descreve componentes, etapas e informações. Não movimenta estoque.
 */

const bootstrapFichasTecnicas = require('./migrations/002_fichas_tecnicas');
const bootstrapFichaPadraoSemProduto = require('./migrations/015_fichas_padrao_no_produto');

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
  const normalizado = String(valor).trim().replace(',', '.');
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0) throw erro(mensagem, 'QUANTIDADE_INVALIDA');
  return n;
}

function idOpcional(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw erro('O produto informado é inválido.', 'PRODUTO_INVALIDO');
  return n;
}

function lista(valor, codigo) {
  if (valor == null) return [];
  if (!Array.isArray(valor)) throw erro('A lista informada é inválida.', codigo);
  if (valor.length > LIMITE_ITENS) {
    throw erro(`A ficha aceita até ${LIMITE_ITENS} itens em cada lista.`, 'LIMITE_EXCEDIDO');
  }
  return valor;
}

async function garantirSchema(db) {
  await bootstrapFichasTecnicas(db);
  await bootstrapFichaPadraoSemProduto(db);
}

async function tabelaExiste(db, nome) {
  const row = await get(db, `
    SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?
  `, [nome]);
  return !!row;
}

async function colunaExiste(db, tabela, coluna) {
  const colunas = await all(db, `PRAGMA table_info(${tabela})`);
  return colunas.some((item) => item.name === coluna);
}

function nomeExato(valor) {
  return texto(valor).toLowerCase();
}

async function resolverInsumo(db, produtoId, idsAnteriores) {
  if (!(await tabelaExiste(db, 'produtos')) || !(await colunaExiste(db, 'produtos', 'natureza_cadastro'))) {
    throw erro('O cadastro de produtos não identifica os insumos.', 'INSUMO_INDISPONIVEL', 500);
  }
  const temAtivo = await colunaExiste(db, 'produtos', 'ativo');
  const row = await get(db, `
    SELECT id, nome, natureza_cadastro${temAtivo ? ', ativo' : ', 1 AS ativo'}
    FROM produtos WHERE id = ?
  `, [produtoId]);
  if (!row || row.natureza_cadastro !== 'INSUMO') {
    throw erro('Componente inválido. Selecione um insumo cadastrado.', row ? 'PRODUTO_NAO_INSUMO' : 'PRODUTO_NAO_ENCONTRADO', row ? 400 : 404);
  }
  const ativo = Number(row.ativo) !== 0;
  if (!ativo && !idsAnteriores.has(Number(row.id))) {
    throw erro('Este insumo está inativo e não pode entrar em um componente novo.', 'INSUMO_INATIVO');
  }
  return { id: Number(row.id), nome: row.nome, ativo };
}

async function sugerirInsumoExato(db, descricao) {
  const nome = nomeExato(descricao);
  if (!nome) return null;
  if (!(await tabelaExiste(db, 'produtos')) || !(await colunaExiste(db, 'produtos', 'natureza_cadastro'))) return null;
  const temAtivo = await colunaExiste(db, 'produtos', 'ativo');
  const temCodigo = await colunaExiste(db, 'produtos', 'codigo');
  const temUnidade = await colunaExiste(db, 'produtos', 'unidade');
  const rows = await all(db, `
    SELECT id, nome,
           ${temCodigo ? 'codigo' : "'' AS codigo"},
           ${temUnidade ? 'unidade' : "'' AS unidade"}
    FROM produtos
    WHERE natureza_cadastro = 'INSUMO'
      AND lower(trim(nome)) = ?
      ${temAtivo ? 'AND COALESCE(ativo, 1) = 1' : ''}
  `, [nome]);
  if (rows.length !== 1) return null;
  return {
    sugestao_produto_id: Number(rows[0].id),
    sugestao_nome: rows[0].nome,
    sugestao_codigo: rows[0].codigo || '',
    sugestao_unidade: rows[0].unidade || ''
  };
}

function mapearResumo(row) {
  return {
    id: Number(row.id),
    codigo: row.codigo,
    nome: row.nome,
    produto_id: row.produto_id == null ? null : Number(row.produto_id),
    produto_nome: row.produto_nome || '',
    rendimento_quantidade: row.rendimento_quantidade == null ? null : Number(row.rendimento_quantidade),
    rendimento_unidade: row.rendimento_unidade || '',
    ativa: Number(row.ativa) === 1,
    componentes: Number(row.componentes || 0),
    etapas: Number(row.etapas || 0),
    informacoes: Number(row.informacoes || 0),
    updated_at: row.updated_at
  };
}

function mapearComponente(row) {
  const produtoId = row.produto_id == null ? null : Number(row.produto_id);
  const oficial = row.nome_oficial || '';
  const insumo = row.natureza_cadastro === 'INSUMO';
  const ativo = row.produto_ativo == null ? null : Number(row.produto_ativo) !== 0;
  return {
    id: Number(row.id),
    ordem: Number(row.ordem),
    produto_id: produtoId,
    descricao: oficial || row.descricao,
    quantidade: row.quantidade == null ? null : Number(row.quantidade),
    unidade: row.unidade || '',
    observacao: row.observacao || '',
    codigo: row.codigo_oficial || '',
    natureza: insumo ? 'INSUMO' : (row.natureza_cadastro || ''),
    produto_ativo: ativo,
    texto_legado: produtoId ? '' : (row.descricao || ''),
    vinculo_pendente: !produtoId || !oficial || !insumo
  };
}

function mapearEtapa(row) {
  return {
    id: Number(row.id),
    ordem: Number(row.ordem),
    titulo: row.titulo,
    descricao: row.descricao || '',
    tempo_minutos: row.tempo_minutos == null ? null : Number(row.tempo_minutos),
    observacao: row.observacao || ''
  };
}

function mapearInformacao(row) {
  return {
    id: Number(row.id),
    ordem: Number(row.ordem),
    titulo: row.titulo,
    valor: row.valor || ''
  };
}

async function obterFicha(db, id) {
  await garantirSchema(db);
  const fichaId = Number(id);
  if (!Number.isInteger(fichaId) || fichaId <= 0) {
    throw erro('Ficha técnica não encontrada.', 'FICHA_NAO_ENCONTRADA', 404);
  }
  const row = await get(db, `
    SELECT id, codigo, nome, produto_id, produto_nome, rendimento_quantidade,
           rendimento_unidade, observacoes, ativa, created_at, updated_at
    FROM fichas_tecnicas WHERE id = ?
  `, [fichaId]);
  if (!row) throw erro('Ficha técnica não encontrada.', 'FICHA_NAO_ENCONTRADA', 404);
  if (row.produto_id != null && (await tabelaExiste(db, 'produtos'))) {
    const fabricado = await get(db, 'SELECT nome FROM produtos WHERE id = ?', [row.produto_id]);
    if (fabricado && fabricado.nome) row.produto_nome = fabricado.nome;
  }
  const joinProduto = (await tabelaExiste(db, 'produtos')) && (await colunaExiste(db, 'produtos', 'natureza_cadastro'));
  const ativoSql = joinProduto && (await colunaExiste(db, 'produtos', 'ativo'))
    ? 'p.ativo'
    : '1';
  const temCodigo = joinProduto && (await colunaExiste(db, 'produtos', 'codigo'));
  const componentes = await all(db, joinProduto ? `
    SELECT c.id, c.ordem, c.produto_id, c.descricao, c.quantidade, c.unidade, c.observacao,
           p.nome AS nome_oficial, p.natureza_cadastro, ${ativoSql} AS produto_ativo,
           ${temCodigo ? 'p.codigo' : "''"} AS codigo_oficial
    FROM ficha_tecnica_componentes c
    LEFT JOIN produtos p ON p.id = c.produto_id
    WHERE c.ficha_id = ?
    ORDER BY c.ordem, c.id
  ` : `
    SELECT id, ordem, produto_id, descricao, quantidade, unidade, observacao,
           NULL AS nome_oficial, NULL AS natureza_cadastro, NULL AS produto_ativo,
           NULL AS codigo_oficial
    FROM ficha_tecnica_componentes WHERE ficha_id = ? ORDER BY ordem, id
  `, [fichaId]);
  const componentesMapeados = [];
  for (const item of componentes.map(mapearComponente)) {
    if (!item.produto_id && item.texto_legado) {
      const sugestao = await sugerirInsumoExato(db, item.texto_legado);
      if (sugestao) Object.assign(item, sugestao);
    }
    componentesMapeados.push(item);
  }
  const etapas = await all(db, `
    SELECT id, ordem, titulo, descricao, tempo_minutos, observacao
    FROM ficha_tecnica_etapas WHERE ficha_id = ? ORDER BY ordem, id
  `, [fichaId]);
  const informacoes = await all(db, `
    SELECT id, ordem, titulo, valor
    FROM ficha_tecnica_informacoes WHERE ficha_id = ? ORDER BY ordem, id
  `, [fichaId]);
  return {
    id: Number(row.id),
    codigo: row.codigo,
    nome: row.nome,
    produto_id: row.produto_id == null ? null : Number(row.produto_id),
    produto_nome: row.produto_nome || '',
    rendimento_quantidade: row.rendimento_quantidade == null ? null : Number(row.rendimento_quantidade),
    rendimento_unidade: row.rendimento_unidade || '',
    observacoes: row.observacoes || '',
    ativa: Number(row.ativa) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    componentes: componentesMapeados,
    etapas: etapas.map(mapearEtapa),
    informacoes: informacoes.map(mapearInformacao)
  };
}

async function listarFichas(db, filtro = {}) {
  await garantirSchema(db);
  const params = [];
  let where = '1 = 1';
  if (!filtro.incluirInativas) {
    where += ' AND f.ativa = 1';
  }
  const busca = texto(filtro.busca);
  if (busca) {
    where += ' AND (f.codigo LIKE ? OR f.nome LIKE ?)';
    const termo = `%${busca}%`;
    params.push(termo, termo);
  }
  const rows = await all(db, `
    SELECT f.id, f.codigo, f.nome, f.produto_id, f.produto_nome,
           f.rendimento_quantidade, f.rendimento_unidade, f.ativa, f.updated_at,
           (SELECT COUNT(*) FROM ficha_tecnica_componentes c WHERE c.ficha_id = f.id) AS componentes,
           (SELECT COUNT(*) FROM ficha_tecnica_etapas e WHERE e.ficha_id = f.id) AS etapas,
           (SELECT COUNT(*) FROM ficha_tecnica_informacoes i WHERE i.ficha_id = f.id) AS informacoes
    FROM fichas_tecnicas f
    WHERE ${where}
    ORDER BY f.nome COLLATE NOCASE, f.id
  `, params);
  return rows.map(mapearResumo);
}

function normalizarSituacaoFicha(valor) {
  if (![true, false, 1, 0, '1', '0'].includes(valor)) {
    throw erro('Informe uma situação válida para a ficha técnica.', 'STATUS_INVALIDO');
  }
  return valor === true || valor === 1 || valor === '1' ? 1 : 0;
}

async function atualizarStatusFicha(db, idBruto, entrada) {
  await garantirSchema(db);
  const fichaId = Number(idBruto);
  if (!Number.isInteger(fichaId) || fichaId <= 0) {
    throw erro('O identificador da ficha técnica é inválido.', 'FICHA_INVALIDA');
  }
  const ativa = normalizarSituacaoFicha(entrada && entrada.ativa);
  const ficha = await get(db, 'SELECT id FROM fichas_tecnicas WHERE id = ?', [fichaId]);
  if (!ficha) throw erro('Ficha técnica não encontrada.', 'FICHA_NAO_ENCONTRADA', 404);
  await run(db, `
    UPDATE fichas_tecnicas
    SET ativa = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `, [ativa, fichaId]);
  return obterFicha(db, fichaId);
}

async function excluirFicha(db, idBruto) {
  await garantirSchema(db);
  const fichaId = Number(idBruto);
  if (!Number.isInteger(fichaId) || fichaId <= 0) {
    throw erro('O identificador da ficha técnica é inválido.', 'FICHA_INVALIDA');
  }
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const ficha = await get(db, 'SELECT id, produto_id FROM fichas_tecnicas WHERE id = ?', [fichaId]);
    if (!ficha) throw erro('Ficha técnica não encontrada.', 'FICHA_NAO_ENCONTRADA', 404);
    if (ficha.produto_id != null) {
      throw erro('Não é possível excluir a ficha técnica enquanto ela estiver vinculada a um produto.', 'FICHA_VINCULADA', 409);
    }
    for (const tabela of ['necessidade_producao_itens', 'ordem_producao_itens']) {
      if (!(await tabelaExiste(db, tabela)) || !(await colunaExiste(db, tabela, 'ficha_tecnica_id'))) continue;
      const referencia = await get(db, `
        SELECT id FROM ${tabela} WHERE ficha_tecnica_id = ? LIMIT 1
      `, [fichaId]);
      if (referencia) {
        throw erro('Não é possível excluir a ficha técnica porque ela possui referências no histórico de produção.', 'FICHA_COM_HISTORICO', 409);
      }
    }
    await run(db, 'DELETE FROM ficha_tecnica_componentes WHERE ficha_id = ?', [fichaId]);
    await run(db, 'DELETE FROM ficha_tecnica_etapas WHERE ficha_id = ?', [fichaId]);
    await run(db, 'DELETE FROM ficha_tecnica_informacoes WHERE ficha_id = ?', [fichaId]);
    const resultado = await run(db, 'DELETE FROM fichas_tecnicas WHERE id = ? AND produto_id IS NULL', [fichaId]);
    if (resultado.changes !== 1) {
      throw erro('A ficha técnica não foi excluída. Atualize os dados e tente novamente.', 'FICHA_VINCULADA', 409);
    }
    await run(db, 'COMMIT');
    return { removida: true, id: fichaId };
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (erroRollback) { err.rollbackError = erroRollback; }
    throw err;
  }
}

async function validarProdutoFabricado(db, produtoIdBruto) {
  const produtoId = idOpcional(produtoIdBruto);
  if (!produtoId) throw erro('Selecione um produto fabricado.', 'PRODUTO_OBRIGATORIO');
  if (!(await tabelaExiste(db, 'produtos')) || !(await colunaExiste(db, 'produtos', 'natureza_cadastro'))) {
    throw erro('O cadastro não permite validar produtos fabricados.', 'PRODUTO_INDISPONIVEL', 500);
  }
  const temAtivo = await colunaExiste(db, 'produtos', 'ativo');
  const row = await get(db, `
    SELECT id, natureza_cadastro${temAtivo ? ', ativo' : ', 1 AS ativo'}
    FROM produtos WHERE id = ?
  `, [produtoId]);
  if (!row) throw erro('O produto informado não existe.', 'PRODUTO_NAO_ENCONTRADO', 404);
  if (row.natureza_cadastro !== 'PRODUZIDO') {
    throw erro('Somente produtos classificados como PRODUZIDO podem receber fichas técnicas.', 'PRODUTO_NAO_PRODUZIDO');
  }
  if (Number(row.ativo) === 0) {
    throw erro('O produto inativo não pode receber novas fichas técnicas.', 'PRODUTO_INATIVO');
  }
  return produtoId;
}

async function listarFichasTradicionaisDoProduto(db, produtoIdBruto) {
  await garantirSchema(db);
  const produtoId = await validarProdutoFabricado(db, produtoIdBruto);
  const rows = await all(db, `
    SELECT f.id, f.codigo, f.nome, f.produto_id, f.produto_nome,
           f.rendimento_quantidade, f.rendimento_unidade, f.ativa, f.updated_at,
           (SELECT COUNT(*) FROM ficha_tecnica_componentes c WHERE c.ficha_id = f.id) AS componentes,
           (SELECT COUNT(*) FROM ficha_tecnica_etapas e WHERE e.ficha_id = f.id) AS etapas,
           (SELECT COUNT(*) FROM ficha_tecnica_informacoes i WHERE i.ficha_id = f.id) AS informacoes
    FROM fichas_tecnicas f
    WHERE f.produto_id = ?
    ORDER BY f.nome COLLATE NOCASE, f.id
  `, [produtoId]);
  return rows.map(mapearResumo);
}

async function vincularFichaTradicionalProduto(db, fichaIdBruto, produtoIdBruto) {
  await garantirSchema(db);
  const fichaId = idOpcional(fichaIdBruto);
  if (!fichaId) throw erro('A ficha técnica informada é inválida.', 'FICHA_INVALIDA');
  const produtoId = await validarProdutoFabricado(db, produtoIdBruto);
  const ficha = await get(db, `
    SELECT id, produto_id, ativa FROM fichas_tecnicas WHERE id = ?
  `, [fichaId]);
  if (!ficha) throw erro('Ficha técnica não encontrada.', 'FICHA_NAO_ENCONTRADA', 404);
  if (Number(ficha.ativa) !== 1) throw erro('Ficha tradicional inativa não pode ser vinculada.', 'FICHA_INATIVA');
  if (ficha.produto_id != null && Number(ficha.produto_id) !== produtoId) {
    throw erro('Esta ficha tradicional já está vinculada a outro produto.', 'FICHA_VINCULADA_OUTRO_PRODUTO', 409);
  }
  const atualizada = await run(db, `
    UPDATE fichas_tecnicas
    SET produto_id = ?, produto_nome = NULL, updated_at = datetime('now', 'localtime')
    WHERE id = ? AND COALESCE(ativa, 1) = 1
      AND (produto_id IS NULL OR produto_id = ?)
  `, [produtoId, fichaId, produtoId]);
  if (!atualizada.changes) {
    const atual = await get(db, 'SELECT id, produto_id, ativa FROM fichas_tecnicas WHERE id = ?', [fichaId]);
    if (!atual) throw erro('Ficha técnica não encontrada.', 'FICHA_NAO_ENCONTRADA', 404);
    if (Number(atual.ativa) !== 1) throw erro('Ficha tradicional inativa não pode ser vinculada.', 'FICHA_INATIVA');
    if (atual.produto_id != null && Number(atual.produto_id) !== produtoId) {
      throw erro('Esta ficha tradicional já está vinculada a outro produto.', 'FICHA_VINCULADA_OUTRO_PRODUTO', 409);
    }
    throw erro('Não foi possível confirmar o vínculo tradicional.', 'VINCULO_NAO_CONFIRMADO', 409);
  }
  return obterFicha(db, fichaId);
}

async function desvincularFichaTradicionalProduto(db, fichaIdBruto, produtoIdBruto) {
  await garantirSchema(db);
  const fichaId = idOpcional(fichaIdBruto);
  if (!fichaId) throw erro('A ficha técnica informada é inválida.', 'FICHA_INVALIDA');
  const produtoId = idOpcional(produtoIdBruto);
  if (!produtoId) throw erro('O produto informado é inválido.', 'PRODUTO_INVALIDO');
  const ficha = await get(db, 'SELECT id, produto_id FROM fichas_tecnicas WHERE id = ?', [fichaId]);
  if (!ficha) throw erro('Ficha técnica não encontrada.', 'FICHA_NAO_ENCONTRADA', 404);
  if (Number(ficha.produto_id) !== produtoId) {
    throw erro('A ficha tradicional não está vinculada a este produto.', 'VINCULO_NAO_ENCONTRADO', 404);
  }
  const removido = await run(db, `
    UPDATE fichas_tecnicas
    SET produto_id = NULL, produto_nome = NULL, updated_at = datetime('now', 'localtime')
    WHERE id = ? AND produto_id = ?
  `, [fichaId, produtoId]);
  if (!removido.changes) {
    throw erro('A ficha tradicional não está mais vinculada a este produto.', 'VINCULO_NAO_ENCONTRADO', 404);
  }
  return { ficha_id: fichaId, produto_id: produtoId, removido: true };
}

async function proximoCodigo(db) {
  const row = await get(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS proximo FROM fichas_tecnicas');
  const n = Number(row && row.proximo) || 1;
  return `FT-${String(n).padStart(4, '0')}`;
}

async function normalizar(db, entrada, atual) {
  const dados = entrada || {};
  const nome = texto(dados.nome);
  if (!nome) throw erro('Informe o nome da ficha técnica.', 'NOME_OBRIGATORIO');
  if (nome.length > 160) throw erro('O nome da ficha é longo demais.', 'NOME_INVALIDO');

  let codigo = texto(dados.codigo).toUpperCase();
  if (!codigo) codigo = atual ? atual.codigo : await proximoCodigo(db);
  if (codigo.length > 40) throw erro('O código da ficha é longo demais.', 'CODIGO_INVALIDO');

  if (idOpcional(dados.produto_id) || texto(dados.produto_nome)) {
    throw erro('Ficha tradicional não pode ser associada a um produto. Faça o vínculo no cadastro do produto.', 'FICHA_PRODUTO_REMOVIDO');
  }

  const idsAnteriores = new Set(
    ((atual && atual.componentes) || []).map((item) => item.produto_id).filter(Boolean)
  );
  const componentes = [];
  for (const item of lista(dados.componentes, 'COMPONENTES_INVALIDOS')) {
    const descricao = texto(item && item.descricao);
    const quantidade = numeroOpcional(item && item.quantidade, 'A quantidade do componente é inválida.');
    const unidade = texto(item && item.unidade);
    const observacao = texto(item && item.observacao);
    const itemProdutoId = idOpcional(item && item.produto_id);
    if (!descricao && quantidade == null && !unidade && !observacao && !itemProdutoId) continue;
    if (!itemProdutoId) throw erro('Selecione um insumo cadastrado para este componente.', 'COMPONENTE_SEM_PRODUTO');
    if (quantidade == null || quantidade <= 0) {
      throw erro('Informe a quantidade do insumo.', 'QUANTIDADE_INVALIDA');
    }
    const insumo = await resolverInsumo(db, itemProdutoId, idsAnteriores);
    componentes.push({
      produto_id: insumo.id,
      descricao: insumo.nome,
      quantidade,
      unidade,
      observacao
    });
  }

  const etapas = [];
  lista(dados.etapas, 'ETAPAS_INVALIDAS').forEach((item, indice) => {
    const titulo = texto(item && item.titulo);
    const descricao = texto(item && item.descricao);
    const tempo = numeroOpcional(item && item.tempo_minutos, 'O tempo da etapa é inválido.');
    const observacao = texto(item && item.observacao);
    if (!titulo && !descricao && tempo == null && !observacao) return;
    if (!titulo) throw erro('Toda etapa precisa de um título.', 'ETAPA_SEM_TITULO');
    etapas.push({ ordem: indice + 1, titulo, descricao, tempo_minutos: tempo, observacao });
  });

  const informacoes = [];
  lista(dados.informacoes, 'INFORMACOES_INVALIDAS').forEach((item, indice) => {
    const titulo = texto(item && item.titulo);
    const valor = texto(item && item.valor);
    if (!titulo && !valor) return;
    if (!titulo) throw erro('Toda informação precisa de um título.', 'INFORMACAO_SEM_TITULO');
    informacoes.push({ ordem: indice + 1, titulo, valor });
  });

  componentes.forEach((item, indice) => { item.ordem = indice + 1; });
  etapas.forEach((item, indice) => { item.ordem = indice + 1; });
  informacoes.forEach((item, indice) => { item.ordem = indice + 1; });

  const duplicada = await get(db, `
    SELECT id FROM fichas_tecnicas WHERE codigo = ? AND id <> ?
  `, [codigo, atual ? atual.id : 0]);
  if (duplicada) throw erro(`Já existe a ficha ${codigo}.`, 'CODIGO_JA_EXISTE', 409);

  return {
    codigo,
    nome,
    produto_id: atual ? atual.produto_id : null,
    produto_nome: atual ? atual.produto_nome : '',
    rendimento_quantidade: numeroOpcional(dados.rendimento_quantidade, 'O rendimento da ficha é inválido.'),
    rendimento_unidade: texto(dados.rendimento_unidade),
    observacoes: texto(dados.observacoes),
    ativa: dados.ativa === false || dados.ativa === 0 || dados.ativa === '0' ? 0 : 1,
    componentes,
    etapas,
    informacoes
  };
}

async function gravarFilhos(db, fichaId, ficha) {
  for (const item of ficha.componentes) {
    await run(db, `
      INSERT INTO ficha_tecnica_componentes
        (ficha_id, ordem, produto_id, descricao, quantidade, unidade, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [fichaId, item.ordem, item.produto_id, item.descricao, item.quantidade, item.unidade, item.observacao]);
  }
  for (const item of ficha.etapas) {
    await run(db, `
      INSERT INTO ficha_tecnica_etapas
        (ficha_id, ordem, titulo, descricao, tempo_minutos, observacao)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [fichaId, item.ordem, item.titulo, item.descricao, item.tempo_minutos, item.observacao]);
  }
  for (const item of ficha.informacoes) {
    await run(db, `
      INSERT INTO ficha_tecnica_informacoes (ficha_id, ordem, titulo, valor)
      VALUES (?, ?, ?, ?)
    `, [fichaId, item.ordem, item.titulo, item.valor]);
  }
}

async function salvarFicha(db, entrada, id) {
  await garantirSchema(db);
  const atual = id ? await obterFicha(db, id) : null;
  const ficha = await normalizar(db, entrada, atual);
  await run(db, 'BEGIN');
  try {
    let fichaId = atual ? atual.id : null;
    if (!fichaId) {
      const inserida = await run(db, `
        INSERT INTO fichas_tecnicas (
          codigo, nome, produto_id, produto_nome, rendimento_quantidade,
          rendimento_unidade, observacoes, ativa
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        ficha.codigo, ficha.nome, ficha.produto_id, ficha.produto_nome,
        ficha.rendimento_quantidade, ficha.rendimento_unidade, ficha.observacoes, ficha.ativa
      ]);
      fichaId = inserida.id;
    } else {
      await run(db, 'DELETE FROM ficha_tecnica_componentes WHERE ficha_id = ?', [fichaId]);
      await run(db, 'DELETE FROM ficha_tecnica_etapas WHERE ficha_id = ?', [fichaId]);
      await run(db, 'DELETE FROM ficha_tecnica_informacoes WHERE ficha_id = ?', [fichaId]);
      await run(db, `
        UPDATE fichas_tecnicas
        SET codigo = ?, nome = ?, produto_id = ?, produto_nome = ?,
            rendimento_quantidade = ?, rendimento_unidade = ?, observacoes = ?,
            ativa = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `, [
        ficha.codigo, ficha.nome, ficha.produto_id, ficha.produto_nome,
        ficha.rendimento_quantidade, ficha.rendimento_unidade, ficha.observacoes,
        ficha.ativa, fichaId
      ]);
    }
    await gravarFilhos(db, fichaId, ficha);
    await run(db, 'COMMIT');
    return obterFicha(db, fichaId);
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* a transação já pode ter sido encerrada */ }
    throw err;
  }
}

async function listarInsumos(db, termo) {
  await bootstrapFichasTecnicas(db);
  if (!(await tabelaExiste(db, 'produtos')) || !(await colunaExiste(db, 'produtos', 'natureza_cadastro'))) {
    return [];
  }
  const temAtivo = await colunaExiste(db, 'produtos', 'ativo');
  const temCodigo = await colunaExiste(db, 'produtos', 'codigo');
  const temUnidade = await colunaExiste(db, 'produtos', 'unidade');
  const params = [];
  let where = `natureza_cadastro = 'INSUMO'`;
  if (temAtivo) where += ' AND COALESCE(ativo, 1) = 1';
  const busca = texto(termo);
  if (busca) {
    const like = `%${busca}%`;
    const partes = ['nome LIKE ?'];
    params.push(like);
    if (temCodigo) {
      partes.push("IFNULL(codigo, '') LIKE ?");
      params.push(like);
    }
    where += ` AND (${partes.join(' OR ')})`;
  }
  const rows = await all(db, `
    SELECT id,
           ${temCodigo ? 'codigo' : "'' AS codigo"},
           nome,
           ${temUnidade ? 'unidade' : "'' AS unidade"}
    FROM produtos
    WHERE ${where}
    ORDER BY nome COLLATE NOCASE
    LIMIT 20
  `, params);
  return rows.map((row) => ({
    id: Number(row.id),
    codigo: row.codigo || '',
    nome: row.nome,
    unidade: row.unidade || ''
  }));
}

module.exports = {
  listarFichas,
  listarFichasTradicionaisDoProduto,
  vincularFichaTradicionalProduto,
  desvincularFichaTradicionalProduto,
  obterFicha,
  salvarFicha,
  atualizarStatusFicha,
  excluirFicha,
  listarInsumos
};
