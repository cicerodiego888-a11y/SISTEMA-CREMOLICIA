'use strict';

const crypto = require('crypto');
const bootstrapFichaPadrao = require('./migrations/012_fichas_tecnicas_padrao');
const bootstrapMultiplosVinculosProduto = require('./migrations/014_multiplos_vinculos_produto');
const bootstrapFichaPadraoSemProduto = require('./migrations/015_fichas_padrao_no_produto');
const bootstrapFichasIndependentes = require('./migrations/016_fichas_independentes');
const bootstrapExclusaoFichasPadrao = require('./migrations/017_exclusao_fichas_padrao');
const bootstrapFichasPorSabor = require('./migrations/018_fichas_por_sabor');
const {
  obterFicha,
  listarFichasTradicionaisDoProduto
} = require('./FichaTecnicaService');
const MCC = require('../../motores/motor-conversao-comercial');
const MUC = require('../../motores/muc');
const {
  resolverComposicaoFichaTecnica,
  ErroComposicaoFichaTecnica
} = require('./ComposicaoFichaTecnica');

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

function erro(mensagem, codigo, statusCode = 400, detalhes) {
  const err = new Error(mensagem);
  err.code = codigo;
  err.statusCode = statusCode;
  err.detalhes = detalhes || null;
  return err;
}

function texto(valor, campo, obrigatorio = false) {
  if (valor == null && !obrigatorio) return '';
  if (typeof valor !== 'string') {
    if (obrigatorio) throw erro(`${campo} deve ser informado como texto.`, 'DADO_INVALIDO');
    return '';
  }
  const resultado = valor.trim();
  if (obrigatorio && !resultado) throw erro(`${campo} é obrigatório.`, 'DADO_OBRIGATORIO');
  return resultado;
}

function idPositivo(valor, campo) {
  const id = typeof valor === 'string' && valor.trim() ? Number(valor) : valor;
  if (!Number.isInteger(id) || id <= 0) {
    throw erro(`${campo} deve ser um inteiro positivo.`, 'IDENTIFICADOR_INVALIDO', 400, { campo, valor });
  }
  return id;
}

function numeroPositivo(valor, campo) {
  const bruto = typeof valor === 'string' ? valor.trim().replace(',', '.') : valor;
  const numero = Number(bruto);
  if (bruto === '' || !Number.isFinite(numero) || numero <= 0) {
    throw erro(`${campo} deve ser um número finito maior que zero.`, 'QUANTIDADE_INVALIDA', 400, { campo, valor });
  }
  return numero;
}

function numeroOpcional(valor, campo) {
  if (valor == null || valor === '') return null;
  const bruto = typeof valor === 'string' ? valor.trim().replace(',', '.') : valor;
  const numero = Number(bruto);
  if (!Number.isFinite(numero) || numero < 0) {
    throw erro(`${campo} deve ser um número finito não negativo.`, 'NUMERO_INVALIDO', 400, { campo, valor });
  }
  return numero;
}

function serializarJson(valor, campo) {
  try {
    return JSON.stringify(valor);
  } catch (err) {
    throw erro(`Não foi possível registrar ${campo}.`, 'SNAPSHOT_INVALIDO', 500, { causa: err.message });
  }
}

function lerJsonSnapshot(valor, campo) {
  if (!valor) return null;
  try {
    return JSON.parse(valor);
  } catch (err) {
    throw erro(`O snapshot de ${campo} está inválido.`, 'SNAPSHOT_INVALIDO', 500, { causa: err.message });
  }
}

async function capturarFichaTradicional(db, fichaIdBruto, exigirAtiva = false) {
  const fichaId = idPositivo(fichaIdBruto, 'Id da ficha tradicional');
  const ficha = await obterFicha(db, fichaId);
  if (exigirAtiva && !ficha.ativa) {
    throw erro('A ficha tradicional está inativa e não pode ser usada como origem.', 'FICHA_TRADICIONAL_INATIVA', 409);
  }
  const snapshot = {
    ficha_tradicional_id: ficha.id,
    codigo: ficha.codigo,
    nome: ficha.nome,
    atualizada_em: ficha.updated_at,
    rendimento_quantidade: ficha.rendimento_quantidade,
    rendimento_unidade: ficha.rendimento_unidade,
    observacoes: ficha.observacoes,
    componentes: ficha.componentes.map((item) => ({
      id: item.id,
      ordem: item.ordem,
      produto_id: item.produto_id,
      descricao: item.descricao,
      quantidade: item.quantidade,
      unidade: item.unidade,
      observacao: item.observacao
    })),
    etapas: ficha.etapas.map((item) => ({
      id: item.id,
      ordem: item.ordem,
      titulo: item.titulo,
      descricao: item.descricao,
      tempo_minutos: item.tempo_minutos,
      observacao: item.observacao
    })),
    informacoes: ficha.informacoes.map((item) => ({
      id: item.id,
      ordem: item.ordem,
      titulo: item.titulo,
      valor: item.valor
    }))
  };
  snapshot.revisao = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return snapshot;
}

function mesmoValor(a, b) {
  return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
}

function mesclarCampos(origemAnterior, atual, origemNova, campos) {
  const resultado = {};
  for (const campo of campos) {
    resultado[campo] = mesmoValor(atual[campo], origemAnterior[campo])
      ? origemNova[campo]
      : atual[campo];
  }
  return resultado;
}

function mesclarComponentes(origemAnterior, atual, origemNova) {
  const anteriores = new Map((origemAnterior || []).map((item) => [Number(item.produto_id), item]));
  const novos = new Map((origemNova || []).map((item) => [Number(item.produto_id), item]));
  const atuais = new Map((atual || []).map((item) => [Number(item.produto_id), item]));
  const campos = ['descricao', 'quantidade', 'unidade', 'observacao'];
  const resultado = [];

  for (const item of atual || []) {
    const produtoId = Number(item.produto_id);
    const anterior = anteriores.get(produtoId);
    const novo = novos.get(produtoId);
    if (!anterior) {
      resultado.push(item);
      continue;
    }
    if (!novo) {
      if (!mesmoValor(item.quantidade, anterior.quantidade)
        || !mesmoValor(item.unidade, anterior.unidade)
        || !mesmoValor(item.observacao, anterior.observacao)
        || !mesmoValor(item.descricao, anterior.descricao)) resultado.push(item);
      continue;
    }
    resultado.push({
      produto_id: produtoId,
      ...mesclarCampos(anterior, item, novo, campos)
    });
  }
  for (const item of origemNova || []) {
    const produtoId = Number(item.produto_id);
    if (!anteriores.has(produtoId) && !atuais.has(produtoId)) resultado.push(item);
  }
  return resultado;
}

function mesclarListasOrdenadas(origemAnterior, atual, origemNova, campos) {
  const anteriores = origemAnterior || [];
  const atuais = atual || [];
  const novas = origemNova || [];
  const resultado = [];
  for (let indice = 0; indice < atuais.length; indice += 1) {
    const item = atuais[indice];
    const anterior = anteriores[indice];
    const novo = novas[indice];
    if (!anterior) {
      resultado.push(item);
      continue;
    }
    if (!novo) {
      if (campos.some((campo) => !mesmoValor(item[campo], anterior[campo]))) resultado.push(item);
      continue;
    }
    resultado.push(mesclarCampos(anterior, item, novo, campos));
  }
  for (let indice = anteriores.length; indice < novas.length; indice += 1) {
    resultado.push(novas[indice]);
  }
  return resultado;
}

function mesclarVersaoComOrigem(versao, snapshotAnterior, snapshotNovo) {
  const baseAnterior = snapshotAnterior || { componentes: [], etapas: [], informacoes: [] };
  return {
    rendimento_quantidade: mesmoValor(
      versao.rendimento_quantidade,
      baseAnterior.rendimento_quantidade
    ) ? snapshotNovo.rendimento_quantidade : versao.rendimento_quantidade,
    rendimento_unidade: mesmoValor(
      versao.rendimento_unidade,
      baseAnterior.rendimento_unidade
    ) ? snapshotNovo.rendimento_unidade : versao.rendimento_unidade,
    observacoes: mesmoValor(versao.observacoes, baseAnterior.observacoes)
      ? snapshotNovo.observacoes
      : versao.observacoes,
    componentes: mesclarComponentes(baseAnterior.componentes, versao.componentes, snapshotNovo.componentes),
    etapas: mesclarListasOrdenadas(
      baseAnterior.etapas,
      versao.etapas,
      snapshotNovo.etapas,
      ['titulo', 'descricao', 'tempo_minutos', 'observacao']
    ),
    informacoes: mesclarListasOrdenadas(
      baseAnterior.informacoes,
      versao.informacoes,
      snapshotNovo.informacoes,
      ['titulo', 'valor']
    )
  };
}

async function garantirSchema(db) {
  await bootstrapFichaPadrao(db);
  await bootstrapMultiplosVinculosProduto(db);
  await bootstrapFichaPadraoSemProduto(db);
  await bootstrapFichasIndependentes(db);
  await bootstrapExclusaoFichasPadrao(db);
  await bootstrapFichasPorSabor(db);
}

async function transacionar(db, executar) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const resultado = await executar();
    await run(db, 'COMMIT');
    return resultado;
  } catch (err) {
    try {
      await run(db, 'ROLLBACK');
    } catch (erroRollback) {
      err.rollbackError = erroRollback;
    }
    throw err;
  }
}

async function auditar(contexto, acao, referenciaId, detalhes) {
  if (!contexto || typeof contexto.auditar !== 'function') return;
  await contexto.auditar({
    acao,
    referencia_id: referenciaId,
    detalhes: detalhes || {}
  });
}

async function obterProduto(db, produtoId) {
  const row = await get(db, `
    SELECT id, nome, unidade, natureza_cadastro, COALESCE(ativo, 1) AS ativo
    FROM produtos WHERE id = ?
  `, [produtoId]);
  if (!row) throw erro('Produto não encontrado.', 'PRODUTO_NAO_ENCONTRADO', 404, { produto_id: produtoId });
  return {
    id: Number(row.id),
    nome: row.nome || `Produto ${row.id}`,
    unidade: texto(row.unidade, 'Unidade do produto'),
    natureza_cadastro: row.natureza_cadastro,
    ativo: Number(row.ativo) !== 0
  };
}

async function validarInsumo(db, produtoId, anteriores = new Set(), exigirAtivo = true) {
  const produto = await obterProduto(db, produtoId);
  if (produto.natureza_cadastro !== 'INSUMO') {
    throw erro('O componente deve ser um produto classificado como INSUMO.', 'PRODUTO_NAO_INSUMO', 400, {
      produto_id: produtoId
    });
  }
  if (exigirAtivo && !produto.ativo && !anteriores.has(produtoId)) {
    throw erro('Insumo inativo não pode ser incluído em uma definição nova.', 'INSUMO_INATIVO', 400, {
      produto_id: produtoId
    });
  }
  return produto;
}

async function validarProdutoFabricado(db, produtoId) {
  const produto = await obterProduto(db, produtoId);
  if (produto.natureza_cadastro !== 'PRODUZIDO') {
    throw erro('Somente produto classificado como PRODUZIDO pode ser vinculado.', 'PRODUTO_NAO_PRODUZIDO', 400, {
      produto_id: produtoId
    });
  }
  if (!produto.ativo) {
    throw erro('Produto fabricado inativo não pode ser vinculado.', 'PRODUTO_INATIVO', 400, {
      produto_id: produtoId
    });
  }
  const linhaLegada = await get(db, `
    SELECT 1 AS existe FROM sqlite_master WHERE type = 'table' AND name = 'linhas_produtos_legado'
  `);
  if (linhaLegada) {
    const associado = await get(db, 'SELECT 1 AS existe FROM linhas_produtos_legado WHERE produto_id = ?', [produtoId]);
    if (associado) {
      throw erro('Produto de Linha legado não pode ser vinculado como produto fabricado.', 'PRODUTO_LINHA', 400, {
        produto_id: produtoId
      });
    }
  }
  return produto;
}

async function obterDadosConversaoProduto(db, produto, cache) {
  const produtoId = Number(produto.id);
  if (cache.has(produtoId)) return cache.get(produtoId);

  if (!cache.has('tabelas_conversao')) {
    const [unidades, conversoes] = await Promise.all([
      get(db, "SELECT 1 AS existe FROM sqlite_master WHERE type = 'table' AND name = 'produto_unidades'"),
      get(db, "SELECT 1 AS existe FROM sqlite_master WHERE type = 'table' AND name = 'produto_conversoes'")
    ]);
    cache.set('tabelas_conversao', {
      unidades: !!unidades,
      conversoes: !!conversoes
    });
  }

  const tabelas = cache.get('tabelas_conversao');
  const [unidadesCadastradas, conversoesCadastradas] = await Promise.all([
    tabelas.unidades ? MUC.repository.listarAtivasPorProduto(db, produtoId) : [],
    tabelas.conversoes ? MUC.listarConversoesAtivas(db, produtoId) : []
  ]);
  const unidades = unidadesCadastradas.reduce((resultado, unidade) => {
    const fator = Number(unidade.fator_conversao);
    if (!Number.isFinite(fator) || fator <= 0) return resultado;
    resultado.push({
      id: unidade.id,
      unidade_comercial: unidade.unidade,
      descricao: unidade.descricao || unidade.unidade,
      tipo: fator >= 1 ? 'AGRUPAMENTO' : 'FRACIONAMENTO',
      quantidade: fator,
      unidade_base: produto.unidade
    });
    return resultado;
  }, []);
  const dados = { unidades, conversoes: conversoesCadastradas };
  cache.set(produtoId, dados);
  return dados;
}

async function validarUnidadeOficial(db, produto, quantidade, unidadeOrigem, cache) {
  if (!produto.unidade) {
    throw erro(`O insumo "${produto.nome}" (#${produto.id}) não possui unidade-base cadastrada.`, 'UNIDADE_NAO_COMPROVADA', 422, {
      produto_id: produto.id,
      produto_nome: produto.nome,
      unidade: unidadeOrigem
    });
  }
  const dadosConversao = await obterDadosConversaoProduto(db, produto, cache);
  const detalhes = {
    produto_id: produto.id,
    produto_nome: produto.nome,
    unidade: unidadeOrigem,
    unidade_base: produto.unidade
  };
  const mensagem = `Não foi possível converter a unidade "${unidadeOrigem}" do insumo "${produto.nome}" (#${produto.id}) para a unidade-base "${produto.unidade}". Verifique as unidades e conversões cadastradas para este insumo.`;
  let resultado;
  try {
    resultado = MCC.Converter({
      produto: {
        id: produto.id,
        unidade: produto.unidade,
        conversoes: dadosConversao.conversoes,
        unidades_comercializacao: dadosConversao.unidades
      },
      quantidade,
      unidadeOrigem,
      unidadeBase: produto.unidade,
      contexto: 'OUTROS'
    });
  } catch (err) {
    throw erro(mensagem, 'UNIDADE_NAO_COMPROVADA', 422, {
      ...detalhes,
      causa: err.message
    });
  }
  const convertida = Number(resultado.quantidadeConvertida);
  if (!Number.isFinite(convertida) || convertida <= 0) {
    throw erro(`${mensagem} O conversor oficial não comprovou uma quantidade positiva.`, 'UNIDADE_NAO_COMPROVADA', 422, detalhes);
  }
}

async function normalizarConteudo(db, dados, idsAnteriores = new Set()) {
  const entrada = dados || {};
  const rendimento = numeroPositivo(entrada.rendimento_quantidade, 'Rendimento da versão');
  const rendimentoUnidade = texto(entrada.rendimento_unidade, 'Unidade de rendimento', true);
  const observacoes = texto(entrada.observacoes, 'Observações');
  const linhas = entrada.componentes;
  if (!Array.isArray(linhas) || !linhas.length) {
    throw erro('A versão deve possuir ao menos um componente.', 'COMPONENTES_OBRIGATORIOS');
  }
  if (linhas.length > LIMITE_ITENS) {
    throw erro(`A versão aceita até ${LIMITE_ITENS} componentes.`, 'LIMITE_EXCEDIDO');
  }

  const vistos = new Set();
  const componentes = [];
  const cacheConversoes = new Map();
  for (const [indice, item] of linhas.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw erro(`Componente ${indice + 1} inválido.`, 'COMPONENTE_INVALIDO');
    }
    const produtoId = idPositivo(item.produto_id, `produto_id do componente ${indice + 1}`);
    if (vistos.has(produtoId)) {
      throw erro('A versão não pode repetir o mesmo produto_id.', 'PRODUTO_BASE_DUPLICADO', 409, {
        produto_id: produtoId
      });
    }
    vistos.add(produtoId);
    const quantidade = numeroPositivo(item.quantidade, `Quantidade do componente ${indice + 1}`);
    const unidade = texto(item.unidade, `Unidade do componente ${indice + 1}`, true);
    const produto = await validarInsumo(db, produtoId, idsAnteriores);
    await validarUnidadeOficial(db, produto, quantidade, unidade, cacheConversoes);
    componentes.push({
      produto_id: produtoId,
      descricao: produto.nome,
      quantidade,
      unidade,
      observacao: texto(item.observacao, `Observação do componente ${indice + 1}`),
      ordem: indice + 1
    });
  }

  const etapas = normalizarEtapas(entrada.etapas);
  const informacoes = normalizarInformacoes(entrada.informacoes);
  return {
    rendimento_quantidade: rendimento,
    rendimento_unidade: rendimentoUnidade,
    observacoes,
    componentes,
    etapas,
    informacoes
  };
}

function normalizarEtapas(valor) {
  if (valor == null) return [];
  if (!Array.isArray(valor) || valor.length > LIMITE_ITENS) {
    throw erro('A lista de etapas é inválida.', 'ETAPAS_INVALIDAS');
  }
  return valor.reduce((resultado, item, indice) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw erro(`Etapa ${indice + 1} inválida.`, 'ETAPA_INVALIDA');
    }
    const titulo = texto(item.titulo, `Título da etapa ${indice + 1}`, true);
    const tempo = numeroOpcional(item.tempo_minutos, `Tempo da etapa ${indice + 1}`);
    resultado.push({
      ordem: indice + 1,
      titulo,
      descricao: texto(item.descricao, `Descrição da etapa ${indice + 1}`),
      tempo_minutos: tempo,
      observacao: texto(item.observacao, `Observação da etapa ${indice + 1}`)
    });
    return resultado;
  }, []);
}

function normalizarInformacoes(valor) {
  if (valor == null) return [];
  if (!Array.isArray(valor) || valor.length > LIMITE_ITENS) {
    throw erro('A lista de informações é inválida.', 'INFORMACOES_INVALIDAS');
  }
  return valor.reduce((resultado, item, indice) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw erro(`Informação ${indice + 1} inválida.`, 'INFORMACAO_INVALIDA');
    }
    resultado.push({
      ordem: indice + 1,
      titulo: texto(item.titulo, `Título da informação ${indice + 1}`, true),
      valor: texto(item.valor, `Valor da informação ${indice + 1}`)
    });
    return resultado;
  }, []);
}

function validarCodigoNome(entrada, atual) {
  const dados = entrada || {};
  const codigo = texto(dados.codigo, 'Código da ficha padrão', true).toUpperCase();
  const nome = texto(dados.nome, 'Nome da ficha padrão', true);
  if (codigo.length > 40 || nome.length > 160) {
    throw erro('Código ou nome da ficha padrão excede o limite permitido.', 'DADO_INVALIDO');
  }
  const ativa = dados.ativa === false || dados.ativa === 0 || dados.ativa === '0' ? 0 : 1;
  return { codigo, nome, ativa, atual };
}

async function validarCodigoUnico(db, codigo, ignorarId = 0) {
  const duplicado = await get(db, `
    SELECT id FROM fichas_tecnicas_padrao
    WHERE lower(trim(codigo)) = lower(trim(?)) AND id <> ?
  `, [codigo, ignorarId]);
  if (duplicado) {
    throw erro(`Já existe a ficha padrão ${codigo}.`, 'CODIGO_PADRAO_DUPLICADO', 409, {
      ficha_padrao_id: Number(duplicado.id)
    });
  }
}

async function inserirConteudoVersao(db, versaoId, conteudo) {
  for (const componente of conteudo.componentes) {
    await run(db, `
      INSERT INTO fichas_tecnicas_padrao_versao_componentes
        (versao_id, ordem, produto_id, descricao, quantidade, unidade, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      versaoId, componente.ordem, componente.produto_id, componente.descricao,
      componente.quantidade, componente.unidade, componente.observacao
    ]);
  }
  for (const etapa of conteudo.etapas) {
    await run(db, `
      INSERT INTO fichas_tecnicas_padrao_versao_etapas
        (versao_id, ordem, titulo, descricao, tempo_minutos, observacao)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [versaoId, etapa.ordem, etapa.titulo, etapa.descricao, etapa.tempo_minutos, etapa.observacao]);
  }
  for (const informacao of conteudo.informacoes) {
    await run(db, `
      INSERT INTO fichas_tecnicas_padrao_versao_informacoes (versao_id, ordem, titulo, valor)
      VALUES (?, ?, ?, ?)
    `, [versaoId, informacao.ordem, informacao.titulo, informacao.valor]);
  }
}

async function lerConteudoVersao(db, versaoId) {
  const versao = await get(db, `
    SELECT id, ficha_padrao_id, numero_versao, estado, rendimento_quantidade,
           rendimento_unidade, observacoes, publicada_em, created_at, updated_at,
           ficha_tradicional_revisao, ficha_tradicional_snapshot,
           ficha_tradicional_snapshot_anterior
    FROM fichas_tecnicas_padrao_versoes WHERE id = ?
  `, [versaoId]);
  if (!versao) throw erro('Versão da ficha padrão não encontrada.', 'VERSAO_NAO_ENCONTRADA', 404);
  const [componentes, etapas, informacoes] = await Promise.all([
    all(db, `
      SELECT id, ordem, produto_id, descricao, quantidade, unidade, observacao
      FROM fichas_tecnicas_padrao_versao_componentes
      WHERE versao_id = ? ORDER BY ordem, id
    `, [versaoId]),
    all(db, `
      SELECT id, ordem, titulo, descricao, tempo_minutos, observacao
      FROM fichas_tecnicas_padrao_versao_etapas
      WHERE versao_id = ? ORDER BY ordem, id
    `, [versaoId]),
    all(db, `
      SELECT id, ordem, titulo, valor
      FROM fichas_tecnicas_padrao_versao_informacoes
      WHERE versao_id = ? ORDER BY ordem, id
    `, [versaoId])
  ]);
  return {
    id: Number(versao.id),
    ficha_padrao_id: Number(versao.ficha_padrao_id),
    numero_versao: Number(versao.numero_versao),
    estado: versao.estado,
    rendimento_quantidade: Number(versao.rendimento_quantidade),
    rendimento_unidade: versao.rendimento_unidade,
    observacoes: versao.observacoes || '',
    publicada_em: versao.publicada_em,
    created_at: versao.created_at,
    updated_at: versao.updated_at,
    ficha_tradicional_revisao: versao.ficha_tradicional_revisao || null,
    ficha_tradicional_snapshot: lerJsonSnapshot(versao.ficha_tradicional_snapshot, 'ficha tradicional'),
    ficha_tradicional_snapshot_anterior: lerJsonSnapshot(
      versao.ficha_tradicional_snapshot_anterior,
      'ficha tradicional anterior'
    ),
    componentes: componentes.map((item) => ({
      id: Number(item.id),
      componente_base_id: Number(item.produto_id),
      produto_id: Number(item.produto_id),
      descricao: item.descricao,
      quantidade: Number(item.quantidade),
      unidade: item.unidade,
      observacao: item.observacao || '',
      ordem: Number(item.ordem)
    })),
    etapas: etapas.map((item) => ({
      id: Number(item.id),
      ordem: Number(item.ordem),
      titulo: item.titulo,
      descricao: item.descricao || '',
      tempo_minutos: item.tempo_minutos == null ? null : Number(item.tempo_minutos),
      observacao: item.observacao || ''
    })),
    informacoes: informacoes.map((item) => ({
      id: Number(item.id),
      ordem: Number(item.ordem),
      titulo: item.titulo,
      valor: item.valor || ''
    }))
  };
}

function entradaMotor(versao) {
  return {
    id: versao.id,
    versao: versao.numero_versao,
    rendimento_quantidade: versao.rendimento_quantidade,
    rendimento_unidade: versao.rendimento_unidade,
    componentes: versao.componentes.map((item) => ({
      id: item.produto_id,
      produto_id: item.produto_id,
      quantidade: item.quantidade,
      unidade: item.unidade
    }))
  };
}

async function validarUnidadesComposicao(db, composicao) {
  const cacheConversoes = new Map();
  for (const componente of composicao.componentes) {
    const produto = await validarInsumo(db, componente.produto_id, new Set(), false);
    await validarUnidadeOficial(db, produto, componente.quantidade, componente.unidade, cacheConversoes);
  }
}

async function resolverComposicao(db, versao, ajustes = []) {
  let composicao;
  try {
    composicao = resolverComposicaoFichaTecnica(entradaMotor(versao), ajustes);
  } catch (err) {
    if (err instanceof ErroComposicaoFichaTecnica) {
      throw erro(err.message, err.code, 422, err.details);
    }
    throw err;
  }
  await validarUnidadesComposicao(db, composicao);
  return composicao;
}

async function obterFichaPadrao(db, id) {
  await garantirSchema(db);
  const fichaId = idPositivo(id, 'Id da ficha padrão');
  const ficha = await get(db, `
    SELECT id, codigo, nome, ativa, created_at, updated_at, ficha_tradicional_id
    FROM fichas_tecnicas_padrao WHERE id = ?
  `, [fichaId]);
  if (!ficha) throw erro('Ficha padrão não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
  const versoes = await all(db, `
    SELECT id FROM fichas_tecnicas_padrao_versoes
    WHERE ficha_padrao_id = ? ORDER BY numero_versao DESC
  `, [fichaId]);
  const vinculos = await listarVinculosInterno(db, fichaId);
  return {
    id: Number(ficha.id),
    codigo: ficha.codigo,
    nome: ficha.nome,
    ativa: Number(ficha.ativa) === 1,
    ...(ficha.ficha_tradicional_id == null ? {} : {
      ficha_tradicional_id: Number(ficha.ficha_tradicional_id),
      tipo: 'SABOR'
    }),
    created_at: ficha.created_at,
    updated_at: ficha.updated_at,
    versoes: await Promise.all(versoes.map((versao) => lerConteudoVersao(db, Number(versao.id)))),
    vinculos
  };
}

async function listarFichasPadrao(db, opcoes = {}) {
  await garantirSchema(db);
  const incluirInativas = opcoes.incluirInativas === true;
  const params = [];
  let where = '1 = 1';
  if (!incluirInativas) where += ' AND f.ativa = 1';
  const busca = texto(opcoes.busca, 'Busca');
  if (busca) {
    where += ' AND (f.codigo LIKE ? OR f.nome LIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`);
  }
  const rows = await all(db, `
    SELECT f.id, f.codigo, f.nome, f.ativa, f.created_at, f.updated_at, f.ficha_tradicional_id,
      (SELECT v.id FROM fichas_tecnicas_padrao_versoes v
       WHERE v.ficha_padrao_id = f.id AND v.estado = 'PUBLICADA'
       ORDER BY v.numero_versao DESC LIMIT 1) AS ultima_versao_id,
      (SELECT v.numero_versao FROM fichas_tecnicas_padrao_versoes v
       WHERE v.ficha_padrao_id = f.id AND v.estado = 'PUBLICADA'
       ORDER BY v.numero_versao DESC LIMIT 1) AS ultima_versao,
      (SELECT COUNT(*) FROM fichas_tecnicas_padrao_vinculos l
       WHERE l.ficha_padrao_id = f.id AND l.ativo = 1) AS produtos_vinculados,
      (SELECT COUNT(*) FROM fichas_tecnicas_padrao_vinculos l
       WHERE l.ficha_padrao_id = f.id) AS vinculos_existentes
    FROM fichas_tecnicas_padrao f
    WHERE ${where}
    ORDER BY f.nome COLLATE NOCASE, f.id
  `, params);
  return rows.map((row) => ({
    id: Number(row.id),
    codigo: row.codigo,
    nome: row.nome,
    ativa: Number(row.ativa) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tipo: row.ficha_tradicional_id == null ? 'LEGADA' : 'SABOR',
    ultima_versao_id: row.ultima_versao_id == null ? null : Number(row.ultima_versao_id),
    ultima_versao: row.ultima_versao == null ? null : Number(row.ultima_versao),
    produtos_vinculados: Number(row.produtos_vinculados),
    vinculos_existentes: Number(row.vinculos_existentes)
  }));
}

async function listarFichasPorSabor(db, opcoes = {}) {
  await garantirSchema(db);
  const incluirInativas = opcoes.incluirInativas === true;
  const busca = texto(opcoes.busca, 'Busca');
  const params = [];
  let where = '1 = 1';
  if (!incluirInativas) where += ' AND f.ativa = 1';
  if (busca) {
    where += ' AND (f.codigo LIKE ? OR f.nome LIKE ? OR t.nome LIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  const rows = await all(db, `
    SELECT f.id, f.codigo, f.nome, f.ativa, f.created_at, f.updated_at,
           f.ficha_tradicional_id, t.codigo AS tradicional_codigo, t.nome AS tradicional_nome,
           (SELECT v.id FROM fichas_tecnicas_padrao_versoes v
            WHERE v.ficha_padrao_id = f.id AND v.estado = 'PUBLICADA'
            ORDER BY v.numero_versao DESC LIMIT 1) AS ultima_versao_id,
           (SELECT v.numero_versao FROM fichas_tecnicas_padrao_versoes v
            WHERE v.ficha_padrao_id = f.id AND v.estado = 'PUBLICADA'
            ORDER BY v.numero_versao DESC LIMIT 1) AS ultima_versao,
           (SELECT v.ficha_tradicional_revisao FROM fichas_tecnicas_padrao_versoes v
            WHERE v.ficha_padrao_id = f.id AND v.estado = 'PUBLICADA'
            ORDER BY v.numero_versao DESC LIMIT 1) AS origem_publicada_revisao,
           (SELECT COUNT(*) FROM fichas_tecnicas_padrao_vinculos l
            WHERE l.ficha_padrao_id = f.id AND l.ativo = 1) AS produtos_vinculados,
           (SELECT COUNT(*) FROM fichas_tecnicas_padrao_vinculos l
            WHERE l.ficha_padrao_id = f.id) AS vinculos_existentes
    FROM fichas_tecnicas_padrao f
    LEFT JOIN fichas_tecnicas t ON t.id = f.ficha_tradicional_id
    WHERE ${where}
    ORDER BY f.nome COLLATE NOCASE, f.id
  `, params);

  return Promise.all(rows.map(async (row) => {
    let revisaoAtual = null;
    if (row.ficha_tradicional_id != null) {
      revisaoAtual = (await capturarFichaTradicional(db, Number(row.ficha_tradicional_id))).revisao;
    }
    return {
      id: Number(row.id),
      codigo: row.codigo,
      nome: row.nome,
      ativa: Number(row.ativa) === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      tipo: row.ficha_tradicional_id == null ? 'LEGADA' : 'SABOR',
      ficha_tradicional_id: row.ficha_tradicional_id == null ? null : Number(row.ficha_tradicional_id),
      ficha_tradicional_codigo: row.tradicional_codigo || null,
      ficha_tradicional_nome: row.tradicional_nome || null,
      atualizacao_origem_disponivel: row.ficha_tradicional_id != null
        && row.origem_publicada_revisao != null
        && row.origem_publicada_revisao !== revisaoAtual,
      ultima_versao_id: row.ultima_versao_id == null ? null : Number(row.ultima_versao_id),
      ultima_versao: row.ultima_versao == null ? null : Number(row.ultima_versao),
      produtos_vinculados: Number(row.produtos_vinculados),
      vinculos_existentes: Number(row.vinculos_existentes)
    };
  }));
}

async function obterFichaPorSabor(db, id) {
  const ficha = await obterFichaPadrao(db, id);
  if (ficha.ficha_tradicional_id == null) {
    return { ...ficha, tipo: 'LEGADA', atualizacao_origem_disponivel: false };
  }
  const origemAtual = await capturarFichaTradicional(db, ficha.ficha_tradicional_id);
  const versaoPublicada = ficha.versoes.find((versao) => versao.estado === 'PUBLICADA');
  return {
    ...ficha,
    tipo: 'SABOR',
    ficha_tradicional: {
      id: origemAtual.ficha_tradicional_id,
      codigo: origemAtual.codigo,
      nome: origemAtual.nome,
      atualizada_em: origemAtual.atualizada_em,
      revisao_atual: origemAtual.revisao
    },
    atualizacao_origem_disponivel: !!versaoPublicada
      && !!versaoPublicada.ficha_tradicional_revisao
      && versaoPublicada.ficha_tradicional_revisao !== origemAtual.revisao
  };
}

async function criarFichaPorSabor(db, entrada, contexto) {
  await garantirSchema(db);
  const dados = entrada || {};
  const origemId = idPositivo(dados.ficha_tradicional_id, 'Ficha tradicional de origem');
  const produtoId = idPositivo(dados.produto_id, 'Produto produzido associado');
  const nome = texto(dados.nome, 'Nome do sabor', true);
  const row = await get(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS proximo FROM fichas_tecnicas_padrao');
  const codigo = texto(dados.codigo, 'Código da ficha por sabor') || `SAB-${String(Number(row.proximo) || 1).padStart(4, '0')}`;
  const metadata = validarCodigoNome({ ...dados, codigo, nome });
  let resultado;
  await transacionar(db, async () => {
    await validarCodigoUnico(db, metadata.codigo);
    await validarProdutoFabricado(db, produtoId);
    const snapshot = await capturarFichaTradicional(db, origemId, true);
    const conteudo = await normalizarConteudo(db, { ...snapshot, ...dados });
    const ficha = await run(db, `
      INSERT INTO fichas_tecnicas_padrao
        (codigo, nome, ativa, ficha_tradicional_id)
      VALUES (?, ?, 1, ?)
    `, [metadata.codigo, metadata.nome, origemId]);
    const versao = await run(db, `
      INSERT INTO fichas_tecnicas_padrao_versoes (
        ficha_padrao_id, numero_versao, estado, rendimento_quantidade, rendimento_unidade,
        observacoes, ficha_tradicional_revisao, ficha_tradicional_snapshot
      ) VALUES (?, 1, 'EM_EDICAO', ?, ?, ?, ?, ?)
    `, [
      ficha.id,
      conteudo.rendimento_quantidade,
      conteudo.rendimento_unidade,
      conteudo.observacoes,
      snapshot.revisao,
      serializarJson(snapshot, 'snapshot da ficha tradicional')
    ]);
    await inserirConteudoVersao(db, versao.id, conteudo);
    const vinculoId = await inserirVinculoInterno(db, ficha.id, produtoId, versao.id);
    resultado = { ficha_padrao_id: ficha.id, versao_id: versao.id, vinculo_id: vinculoId };
  });
  await auditar(contexto, 'FICHA_POR_SABOR_CRIADA', resultado.ficha_padrao_id, {
    versao_id: resultado.versao_id,
    vinculo_id: resultado.vinculo_id,
    produto_id: produtoId,
    ficha_tradicional_id: origemId,
    ficha_tradicional_revisao: (await lerConteudoVersao(db, resultado.versao_id)).ficha_tradicional_revisao
  });
  return obterFichaPorSabor(db, resultado.ficha_padrao_id);
}

async function revisarOrigemFichaPorSabor(db, idBruto, contexto) {
  await garantirSchema(db);
  const fichaId = idPositivo(idBruto, 'Id da ficha por sabor');
  const ficha = await get(db, `
    SELECT id, ficha_tradicional_id, ativa FROM fichas_tecnicas_padrao WHERE id = ?
  `, [fichaId]);
  if (!ficha) throw erro('Ficha por sabor não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
  if (ficha.ficha_tradicional_id == null) {
    throw erro('Este cadastro legado não possui ficha tradicional de origem.', 'FICHA_ORIGEM_AUSENTE', 409);
  }
  if (Number(ficha.ativa) !== 1) throw erro('Ficha por sabor inativa não aceita revisões.', 'FICHA_PADRAO_INATIVA', 409);

  let resultado;
  await transacionar(db, async () => {
    const rascunho = await get(db, `
      SELECT id FROM fichas_tecnicas_padrao_versoes
      WHERE ficha_padrao_id = ? AND estado = 'EM_EDICAO' LIMIT 1
    `, [fichaId]);
    if (rascunho) throw erro('Conclua ou publique o rascunho existente antes de revisar a origem.', 'VERSAO_EM_EDICAO_EXISTENTE', 409);
    const publicadaRow = await get(db, `
      SELECT id FROM fichas_tecnicas_padrao_versoes
      WHERE ficha_padrao_id = ? AND estado = 'PUBLICADA'
      ORDER BY numero_versao DESC LIMIT 1
    `, [fichaId]);
    if (!publicadaRow) throw erro('Publique a versão atual antes de revisar a ficha tradicional.', 'VERSAO_PUBLICADA_AUSENTE', 409);

    const publicada = await lerConteudoVersao(db, Number(publicadaRow.id));
    if (!publicada.ficha_tradicional_snapshot) {
      throw erro('A versão publicada não possui snapshot da origem e não pode ser mesclada automaticamente.', 'SNAPSHOT_ORIGEM_AUSENTE', 409);
    }
    const origemNova = await capturarFichaTradicional(db, Number(ficha.ficha_tradicional_id), true);
    if (origemNova.revisao === publicada.ficha_tradicional_revisao) {
      throw erro('Não há uma nova revisão da ficha tradicional disponível.', 'ORIGEM_SEM_ATUALIZACAO', 409);
    }
    const conteudoMesclado = mesclarVersaoComOrigem(
      publicada,
      publicada.ficha_tradicional_snapshot,
      origemNova
    );
    const conteudo = await normalizarConteudo(db, conteudoMesclado);
    const versao = await run(db, `
      INSERT INTO fichas_tecnicas_padrao_versoes (
        ficha_padrao_id, numero_versao, estado, rendimento_quantidade, rendimento_unidade,
        observacoes, ficha_tradicional_revisao, ficha_tradicional_snapshot,
        ficha_tradicional_snapshot_anterior
      ) VALUES (?, ?, 'EM_EDICAO', ?, ?, ?, ?, ?, ?)
    `, [
      fichaId,
      publicada.numero_versao + 1,
      conteudo.rendimento_quantidade,
      conteudo.rendimento_unidade,
      conteudo.observacoes,
      origemNova.revisao,
      serializarJson(origemNova, 'novo snapshot da ficha tradicional'),
      serializarJson(publicada.ficha_tradicional_snapshot, 'snapshot anterior da ficha tradicional')
    ]);
    await inserirConteudoVersao(db, versao.id, conteudo);
    resultado = { versao_id: versao.id, numero_versao: publicada.numero_versao + 1 };
  });
  await auditar(contexto, 'FICHA_POR_SABOR_ORIGEM_REVISADA', resultado.versao_id, {
    ficha_padrao_id: fichaId,
    numero_versao: resultado.numero_versao
  });
  return lerConteudoVersao(db, resultado.versao_id);
}

async function criarFichaPadrao(db, entrada, contexto) {
  await garantirSchema(db);
  const metadata = validarCodigoNome(entrada);
  const conteudo = await normalizarConteudo(db, entrada);
  const resultado = await transacionar(db, async () => {
    await validarCodigoUnico(db, metadata.codigo);
    const ficha = await run(db, `
      INSERT INTO fichas_tecnicas_padrao (codigo, nome, ativa)
      VALUES (?, ?, 1)
    `, [metadata.codigo, metadata.nome]);
    const versao = await run(db, `
      INSERT INTO fichas_tecnicas_padrao_versoes
        (ficha_padrao_id, numero_versao, estado, rendimento_quantidade, rendimento_unidade, observacoes)
      VALUES (?, 1, 'EM_EDICAO', ?, ?, ?)
    `, [ficha.id, conteudo.rendimento_quantidade, conteudo.rendimento_unidade, conteudo.observacoes]);
    await inserirConteudoVersao(db, versao.id, conteudo);
    return { ficha_padrao_id: ficha.id, versao_id: versao.id };
  });
  await auditar(contexto, 'FICHA_PADRAO_CRIADA', resultado.ficha_padrao_id, {
    versao_id: resultado.versao_id,
    numero_versao: 1
  });
  return obterFichaPadrao(db, resultado.ficha_padrao_id);
}

async function atualizarFichaPadrao(db, id, entrada, contexto) {
  await garantirSchema(db);
  const fichaId = idPositivo(id, 'Id da ficha padrão');
  const metadata = validarCodigoNome(entrada);
  const ficha = await get(db, 'SELECT id FROM fichas_tecnicas_padrao WHERE id = ?', [fichaId]);
  if (!ficha) throw erro('Ficha padrão não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
  await transacionar(db, async () => {
    await validarCodigoUnico(db, metadata.codigo, fichaId);
    await run(db, `
      UPDATE fichas_tecnicas_padrao
      SET codigo = ?, nome = ?, ativa = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [metadata.codigo, metadata.nome, metadata.ativa, fichaId]);
  });
  await auditar(contexto, 'FICHA_PADRAO_ATUALIZADA', fichaId, { ativa: metadata.ativa === 1 });
  return obterFichaPadrao(db, fichaId);
}

async function atualizarStatusFichaPadrao(db, idBruto, entrada, contexto) {
  await garantirSchema(db);
  const fichaId = idPositivo(idBruto, 'Id da ficha padrão');
  const valorAtivo = entrada && entrada.ativa;
  if (![true, false, 1, 0, '1', '0'].includes(valorAtivo)) {
    throw erro('Informe uma situação válida para a ficha padrão.', 'STATUS_INVALIDO');
  }
  const ativa = valorAtivo === true || valorAtivo === 1 || valorAtivo === '1' ? 1 : 0;
  const atual = await get(db, 'SELECT id FROM fichas_tecnicas_padrao WHERE id = ?', [fichaId]);
  if (!atual) throw erro('Ficha padrão não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
  await run(db, `
    UPDATE fichas_tecnicas_padrao
    SET ativa = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `, [ativa, fichaId]);
  await auditar(contexto, ativa ? 'FICHA_PADRAO_ATIVADA' : 'FICHA_PADRAO_INATIVADA', fichaId, {
    ativa: ativa === 1
  });
  return obterFichaPadrao(db, fichaId);
}

async function excluirFichaPadrao(db, idBruto, contexto) {
  await garantirSchema(db);
  const fichaId = idPositivo(idBruto, 'Id da ficha padrão');
  const removida = await transacionar(db, async () => {
    const ficha = await get(db, `
      SELECT id, codigo, nome, ficha_tradicional_id
      FROM fichas_tecnicas_padrao WHERE id = ?
    `, [fichaId]);
    if (!ficha) throw erro('Ficha padrão não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
    const ehFichaSabor = ficha.ficha_tradicional_id != null;
    let produtosDesvinculados = [];
    if (ehFichaSabor) {
      const vinculos = await all(db, `
        SELECT id, produto_id
        FROM fichas_tecnicas_padrao_vinculos
        WHERE ficha_padrao_id = ?
        ORDER BY produto_id, id
      `, [fichaId]);
      produtosDesvinculados = [...new Set(vinculos.map((vinculo) => Number(vinculo.produto_id)))];

      await run(db, 'DELETE FROM fichas_tecnicas_padrao_revisoes WHERE ficha_padrao_id = ?', [fichaId]);
      for (const vinculo of vinculos) {
        const ajuste = await get(db, `
          SELECT id FROM fichas_tecnicas_padrao_ajustes
          WHERE vinculo_id = ? LIMIT 1
        `, [vinculo.id]);
        if (!ajuste) continue;

        await run(db, `
          UPDATE fichas_tecnicas_padrao_vinculos
          SET ativo = 0
          WHERE ficha_padrao_id = ? AND produto_id = ? AND ativo = 1
        `, [fichaId, vinculo.produto_id]);
        await run(db, `
          UPDATE fichas_tecnicas_padrao_vinculos
          SET ativo = 1
          WHERE id = ? AND ficha_padrao_id = ?
        `, [vinculo.id, fichaId]);
        await run(db, 'DELETE FROM fichas_tecnicas_padrao_ajustes WHERE vinculo_id = ?', [vinculo.id]);
      }
      await run(db, 'DELETE FROM fichas_tecnicas_padrao_vinculos WHERE ficha_padrao_id = ?', [fichaId]);
    } else {
      const vinculo = await get(db, `
        SELECT id FROM fichas_tecnicas_padrao_vinculos
        WHERE ficha_padrao_id = ? LIMIT 1
      `, [fichaId]);
      if (vinculo) {
        throw erro(
          'Não é possível excluir a ficha padrão enquanto houver vínculos com produtos.',
          'FICHA_PADRAO_VINCULADA',
          409
        );
      }

      const historico = await get(db, `
        SELECT id FROM fichas_tecnicas_padrao_revisoes
        WHERE ficha_padrao_id = ? LIMIT 1
      `, [fichaId]);
      if (historico) {
        throw erro('Não é possível excluir a ficha padrão porque ela possui histórico de produtos.', 'FICHA_PADRAO_COM_HISTORICO', 409);
      }

      const ajuste = await get(db, `
        SELECT id FROM fichas_tecnicas_padrao_ajustes
        WHERE ficha_padrao_id = ? LIMIT 1
      `, [fichaId]);
      if (ajuste) {
        throw erro('Não é possível excluir a ficha padrão porque ela possui ajustes vinculados.', 'FICHA_PADRAO_COM_HISTORICO', 409);
      }
    }

    await run(db, `
      INSERT OR REPLACE INTO fichas_tecnicas_padrao_exclusao_autorizada (ficha_padrao_id)
      VALUES (?)
    `, [fichaId]);
    for (const tabela of [
      'fichas_tecnicas_padrao_versao_componentes',
      'fichas_tecnicas_padrao_versao_etapas',
      'fichas_tecnicas_padrao_versao_informacoes'
    ]) {
      await run(db, `
        DELETE FROM ${tabela}
        WHERE versao_id IN (
          SELECT id FROM fichas_tecnicas_padrao_versoes WHERE ficha_padrao_id = ?
        )
      `, [fichaId]);
    }
    await run(db, 'DELETE FROM fichas_tecnicas_padrao_versoes WHERE ficha_padrao_id = ?', [fichaId]);
    await run(db, 'DELETE FROM fichas_tecnicas_padrao_exclusao_autorizada WHERE ficha_padrao_id = ?', [fichaId]);
    const resultado = await run(db, 'DELETE FROM fichas_tecnicas_padrao WHERE id = ?', [fichaId]);
    if (resultado.changes !== 1) {
      throw erro('A ficha padrão não foi excluída. Atualize os dados e tente novamente.', 'FICHA_PADRAO_NAO_EXCLUIDA', 409);
    }
    return { id: fichaId, codigo: ficha.codigo, nome: ficha.nome, produtos_desvinculados: produtosDesvinculados };
  });
  await auditar(contexto, 'FICHA_PADRAO_EXCLUIDA', fichaId, removida);
  return { removida: true, ficha: removida };
}

async function criarVersaoPadrao(db, id, contexto) {
  await garantirSchema(db);
  const fichaId = idPositivo(id, 'Id da ficha padrão');
  const ficha = await get(db, 'SELECT id, ativa FROM fichas_tecnicas_padrao WHERE id = ?', [fichaId]);
  if (!ficha) throw erro('Ficha padrão não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
  if (Number(ficha.ativa) !== 1) throw erro('Ficha padrão inativa não aceita novas versões.', 'FICHA_PADRAO_INATIVA', 409);

  const resultado = await transacionar(db, async () => {
    const rascunho = await get(db, `
      SELECT id FROM fichas_tecnicas_padrao_versoes
      WHERE ficha_padrao_id = ? AND estado = 'EM_EDICAO' LIMIT 1
    `, [fichaId]);
    if (rascunho) throw erro('A ficha padrão já possui uma versão em edição.', 'VERSAO_EM_EDICAO_EXISTENTE', 409);
    const anterior = await get(db, `
      SELECT id, numero_versao FROM fichas_tecnicas_padrao_versoes
      WHERE ficha_padrao_id = ? AND estado = 'PUBLICADA'
      ORDER BY numero_versao DESC LIMIT 1
    `, [fichaId]);
    if (!anterior) throw erro('Publique a versão inicial antes de criar outra versão.', 'VERSAO_PUBLICADA_AUSENTE', 409);
    const conteudo = await lerConteudoVersao(db, Number(anterior.id));
    const versao = await run(db, `
      INSERT INTO fichas_tecnicas_padrao_versoes
        (ficha_padrao_id, numero_versao, estado, rendimento_quantidade, rendimento_unidade,
         observacoes, ficha_tradicional_revisao, ficha_tradicional_snapshot,
         ficha_tradicional_snapshot_anterior)
      VALUES (?, ?, 'EM_EDICAO', ?, ?, ?, ?, ?, ?)
    `, [
      fichaId,
      Number(anterior.numero_versao) + 1,
      conteudo.rendimento_quantidade,
      conteudo.rendimento_unidade,
      conteudo.observacoes,
      conteudo.ficha_tradicional_revisao,
      conteudo.ficha_tradicional_snapshot
        ? serializarJson(conteudo.ficha_tradicional_snapshot, 'snapshot da ficha tradicional')
        : null,
      conteudo.ficha_tradicional_snapshot_anterior
        ? serializarJson(conteudo.ficha_tradicional_snapshot_anterior, 'snapshot anterior da ficha tradicional')
        : null
    ]);
    await inserirConteudoVersao(db, versao.id, {
      ...conteudo,
      componentes: conteudo.componentes.map((item) => ({
        produto_id: item.produto_id,
        descricao: item.descricao,
        quantidade: item.quantidade,
        unidade: item.unidade,
        observacao: item.observacao,
        ordem: item.ordem
      }))
    });
    return { versao_id: versao.id, numero_versao: Number(anterior.numero_versao) + 1 };
  });
  await auditar(contexto, 'VERSAO_FICHA_PADRAO_CRIADA', resultado.versao_id, {
    ficha_padrao_id: fichaId,
    numero_versao: resultado.numero_versao
  });
  return lerConteudoVersao(db, resultado.versao_id);
}

async function atualizarVersaoPadrao(db, fichaIdBruto, versaoIdBruto, entrada, contexto) {
  await garantirSchema(db);
  const fichaId = idPositivo(fichaIdBruto, 'Id da ficha padrão');
  const versaoId = idPositivo(versaoIdBruto, 'Id da versão');
  const anterior = await lerConteudoVersao(db, versaoId);
  if (anterior.ficha_padrao_id !== fichaId) {
    throw erro('A versão não pertence à ficha padrão informada.', 'VERSAO_FICHA_DIVERGENTE', 400);
  }
  if (anterior.estado !== 'EM_EDICAO') {
    throw erro('Versão publicada é imutável.', 'VERSAO_IMUTAVEL', 409);
  }
  const idsAnteriores = new Set(anterior.componentes.map((item) => item.produto_id));
  const conteudo = await normalizarConteudo(db, entrada, idsAnteriores);
  await transacionar(db, async () => {
    const estadoAtual = await get(db, `
      SELECT estado FROM fichas_tecnicas_padrao_versoes
      WHERE id = ? AND ficha_padrao_id = ?
    `, [versaoId, fichaId]);
    if (!estadoAtual || estadoAtual.estado !== 'EM_EDICAO') {
      throw erro('Versão publicada é imutável.', 'VERSAO_IMUTAVEL', 409);
    }
    await run(db, 'DELETE FROM fichas_tecnicas_padrao_versao_componentes WHERE versao_id = ?', [versaoId]);
    await run(db, 'DELETE FROM fichas_tecnicas_padrao_versao_etapas WHERE versao_id = ?', [versaoId]);
    await run(db, 'DELETE FROM fichas_tecnicas_padrao_versao_informacoes WHERE versao_id = ?', [versaoId]);
    await run(db, `
      UPDATE fichas_tecnicas_padrao_versoes
      SET rendimento_quantidade = ?, rendimento_unidade = ?, observacoes = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [conteudo.rendimento_quantidade, conteudo.rendimento_unidade, conteudo.observacoes, versaoId]);
    await inserirConteudoVersao(db, versaoId, conteudo);
  });
  await auditar(contexto, 'VERSAO_FICHA_PADRAO_ATUALIZADA', versaoId, { ficha_padrao_id: fichaId });
  return lerConteudoVersao(db, versaoId);
}

async function publicarVersaoPadrao(db, fichaIdBruto, versaoIdBruto, contexto) {
  await garantirSchema(db);
  const fichaId = idPositivo(fichaIdBruto, 'Id da ficha padrão');
  const versaoId = idPositivo(versaoIdBruto, 'Id da versão');
  await transacionar(db, async () => {
    const ficha = await get(db, 'SELECT ativa FROM fichas_tecnicas_padrao WHERE id = ?', [fichaId]);
    if (!ficha) throw erro('Ficha padrão não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
    if (Number(ficha.ativa) !== 1) throw erro('Ficha padrão inativa não pode ser publicada.', 'FICHA_PADRAO_INATIVA', 409);
    const versao = await lerConteudoVersao(db, versaoId);
    if (versao.ficha_padrao_id !== fichaId) {
      throw erro('A versão não pertence à ficha padrão informada.', 'VERSAO_FICHA_DIVERGENTE', 400);
    }
    if (versao.estado !== 'EM_EDICAO') {
      throw erro('Somente uma versão em edição pode ser publicada.', 'VERSAO_IMUTAVEL', 409);
    }
    await resolverComposicao(db, versao, []);
    await run(db, `
      UPDATE fichas_tecnicas_padrao_versoes
      SET estado = 'PUBLICADA', publicada_em = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
      WHERE id = ? AND estado = 'EM_EDICAO'
    `, [versaoId]);
    const vinculos = await all(db, `
      SELECT id, versao_id FROM fichas_tecnicas_padrao_vinculos
      WHERE ficha_padrao_id = ? AND ativo = 1 AND versao_id <> ?
    `, [fichaId, versaoId]);
    for (const vinculo of vinculos) {
      await run(db, `
        INSERT INTO fichas_tecnicas_padrao_revisoes (
          ficha_padrao_id, vinculo_id, versao_anterior_id, versao_nova_id, estado
        ) VALUES (?, ?, ?, ?, 'PENDENTE')
      `, [fichaId, vinculo.id, vinculo.versao_id, versaoId]);
    }
  });
  await auditar(contexto, 'VERSAO_FICHA_PADRAO_PUBLICADA', versaoId, { ficha_padrao_id: fichaId });
  return lerConteudoVersao(db, versaoId);
}

async function carregarAjustes(db, vinculoId) {
  const rows = await all(db, `
    SELECT id, produto_base_id, produto_id, operacao, quantidade, unidade, justificativa,
           created_at, updated_at
    FROM fichas_tecnicas_padrao_ajustes
    WHERE vinculo_id = ? ORDER BY id
  `, [vinculoId]);
  return rows.map((row) => ({
    id: Number(row.id),
    componente_base_id: row.produto_base_id == null ? null : Number(row.produto_base_id),
    produto_id: Number(row.produto_id),
    operacao: row.operacao,
    quantidade: row.quantidade == null ? null : Number(row.quantidade),
    unidade: row.unidade || '',
    justificativa: row.justificativa || '',
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

async function obterVinculo(db, vinculoId) {
  const row = await get(db, `
    SELECT l.id, l.ficha_padrao_id, l.produto_id, l.versao_id,
           l.politica_atualizacao, l.ativo, l.created_at, l.updated_at,
           p.codigo AS produto_codigo, p.nome AS produto_nome,
           v.numero_versao, v.estado AS versao_estado
    FROM fichas_tecnicas_padrao_vinculos l
    JOIN produtos p ON p.id = l.produto_id
    JOIN fichas_tecnicas_padrao_versoes v ON v.id = l.versao_id
    WHERE l.id = ?
  `, [vinculoId]);
  if (!row) throw erro('Vínculo de produto não encontrado.', 'VINCULO_NAO_ENCONTRADO', 404);
  return {
    id: Number(row.id),
    ficha_padrao_id: Number(row.ficha_padrao_id),
    produto_id: Number(row.produto_id),
    produto_codigo: row.produto_codigo || '',
    produto_nome: row.produto_nome,
    versao_id: Number(row.versao_id),
    numero_versao: Number(row.numero_versao),
    versao_estado: row.versao_estado,
    politica_atualizacao: row.politica_atualizacao,
    ativo: Number(row.ativo) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function inserirVinculoInterno(db, fichaId, produtoId, versaoId) {
  const existente = await get(db, `
    SELECT id FROM fichas_tecnicas_padrao_vinculos
    WHERE produto_id = ? AND ficha_padrao_id = ? AND ativo = 1
  `, [produtoId, fichaId]);
  if (existente) {
    throw erro('Produto já possui vínculo ativo com esta ficha padrão.', 'VINCULO_ATIVO_EXISTENTE', 409, {
      vinculo_id: Number(existente.id)
    });
  }
  const inserido = await run(db, `
    INSERT INTO fichas_tecnicas_padrao_vinculos
      (ficha_padrao_id, produto_id, versao_id, politica_atualizacao)
    VALUES (?, ?, ?, 'APROVACAO_INDIVIDUAL')
  `, [fichaId, produtoId, versaoId]);
  return Number(inserido.id);
}

async function validarProdutoVinculado(db, produtoId, fichaId, versaoId) {
  const produto = await validarProdutoFabricado(db, produtoId);
  const versao = await get(db, `
    SELECT id, ficha_padrao_id, estado FROM fichas_tecnicas_padrao_versoes
    WHERE id = ? AND ficha_padrao_id = ?
  `, [versaoId, fichaId]);
  if (!versao) throw erro('Versão não encontrada nesta ficha padrão.', 'VERSAO_NAO_ENCONTRADA', 404);
  if (versao.estado !== 'PUBLICADA') {
    throw erro('Produto só pode ser vinculado a uma versão publicada.', 'VERSAO_NAO_PUBLICADA', 409);
  }
  return produto;
}

async function criarVinculoFichaPadrao(db, fichaIdBruto, entrada, contexto) {
  await garantirSchema(db);
  const fichaId = idPositivo(fichaIdBruto, 'Id da ficha padrão');
  const produtoId = idPositivo(entrada && entrada.produto_id, 'produto_id');
  const versaoId = idPositivo(entrada && entrada.versao_id, 'versao_id');
  const resultado = await transacionar(db, async () => {
    const ficha = await get(db, 'SELECT ativa FROM fichas_tecnicas_padrao WHERE id = ?', [fichaId]);
    if (!ficha) throw erro('Ficha padrão não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
    if (Number(ficha.ativa) !== 1) throw erro('Ficha padrão inativa não aceita novos vínculos.', 'FICHA_PADRAO_INATIVA', 409);
    await validarProdutoVinculado(db, produtoId, fichaId, versaoId);
    const versao = await lerConteudoVersao(db, versaoId);
    await resolverComposicao(db, versao, []);
    return inserirVinculoInterno(db, fichaId, produtoId, versaoId);
  });
  await auditar(contexto, 'PRODUTO_VINCULADO_FICHA_PADRAO', resultado, {
    ficha_padrao_id: fichaId,
    produto_id: produtoId,
    versao_id: versaoId
  });
  return obterVinculo(db, resultado);
}

async function atualizarVinculoFichaPadrao(db, vinculoIdBruto, entrada, contexto) {
  await garantirSchema(db);
  const vinculoId = idPositivo(vinculoIdBruto, 'Id do vínculo');
  const ativo = entrada && (entrada.ativo === false || entrada.ativo === 0 || entrada.ativo === '0') ? 0 : 1;
  const atual = await obterVinculo(db, vinculoId);
  await transacionar(db, async () => {
    if (ativo === 1 && !atual.ativo) {
      const existente = await get(db, `
        SELECT id FROM fichas_tecnicas_padrao_vinculos
        WHERE produto_id = ? AND ficha_padrao_id = ? AND ativo = 1 AND id <> ?
      `, [atual.produto_id, atual.ficha_padrao_id, vinculoId]);
      if (existente) throw erro('Produto já possui outro vínculo ativo com esta ficha.', 'VINCULO_ATIVO_EXISTENTE', 409);
      const versao = await lerConteudoVersao(db, atual.versao_id);
      await resolverComposicao(db, versao, []);
    }
    await run(db, `
      UPDATE fichas_tecnicas_padrao_vinculos
      SET ativo = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [ativo, vinculoId]);
  });
  await auditar(contexto, ativo ? 'VINCULO_FICHA_PADRAO_REATIVADO' : 'VINCULO_FICHA_PADRAO_INATIVADO', vinculoId, {
    produto_id: atual.produto_id
  });
  return obterVinculo(db, vinculoId);
}

async function listarVinculosInterno(db, fichaId) {
  const rows = await all(db, `
    SELECT l.id, l.produto_id, p.codigo AS produto_codigo, p.nome AS produto_nome, l.versao_id,
           v.numero_versao, v.estado AS versao_estado,
           l.politica_atualizacao, l.ativo, l.created_at, l.updated_at,
           (SELECT vn.id FROM fichas_tecnicas_padrao_versoes vn
            WHERE vn.ficha_padrao_id = l.ficha_padrao_id AND vn.estado = 'PUBLICADA'
            ORDER BY vn.numero_versao DESC LIMIT 1) AS ultima_versao_id,
           (SELECT vn.numero_versao FROM fichas_tecnicas_padrao_versoes vn
            WHERE vn.ficha_padrao_id = l.ficha_padrao_id AND vn.estado = 'PUBLICADA'
            ORDER BY vn.numero_versao DESC LIMIT 1) AS ultima_versao
    FROM fichas_tecnicas_padrao_vinculos l
    JOIN produtos p ON p.id = l.produto_id
    JOIN fichas_tecnicas_padrao_versoes v ON v.id = l.versao_id
    WHERE l.ficha_padrao_id = ?
    ORDER BY p.nome COLLATE NOCASE, l.id
  `, [fichaId]);
  return Promise.all(rows.map(async (row) => {
    const revisao = row.ultima_versao_id == null ? null : await get(db, `
      SELECT id, estado FROM fichas_tecnicas_padrao_revisoes
      WHERE vinculo_id = ? AND versao_nova_id = ?
    `, [row.id, row.ultima_versao_id]);
    const stale = row.ultima_versao_id != null && Number(row.ultima_versao_id) !== Number(row.versao_id);
    return {
      id: Number(row.id),
      produto_id: Number(row.produto_id),
      produto_codigo: row.produto_codigo || '',
      produto_nome: row.produto_nome,
      versao_id: Number(row.versao_id),
      numero_versao: Number(row.numero_versao),
      versao_estado: row.versao_estado,
      ultima_versao_id: row.ultima_versao_id == null ? null : Number(row.ultima_versao_id),
      ultima_versao: row.ultima_versao == null ? null : Number(row.ultima_versao),
      politica_atualizacao: row.politica_atualizacao,
      estado_atualizacao: stale ? (revisao ? revisao.estado : 'PENDENTE') : 'ATUALIZADO',
      revisao_id: revisao ? Number(revisao.id) : null,
      ativo: Number(row.ativo) === 1,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }));
}

async function listarVinculosFichaPadrao(db, fichaIdBruto) {
  await garantirSchema(db);
  const fichaId = idPositivo(fichaIdBruto, 'Id da ficha padrão');
  const ficha = await get(db, 'SELECT id FROM fichas_tecnicas_padrao WHERE id = ?', [fichaId]);
  if (!ficha) throw erro('Ficha padrão não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
  return listarVinculosInterno(db, fichaId);
}

async function listarVinculosAtivosProduto(db, produtoIdBruto) {
  await garantirSchema(db);
  const produtoId = idPositivo(produtoIdBruto, 'Id do produto');
  await validarProdutoFabricado(db, produtoId);
  const rows = await all(db, `
    SELECT l.id AS vinculo_id, l.ficha_padrao_id, l.versao_id,
           f.codigo, f.nome, f.ficha_tradicional_id, v.numero_versao
    FROM fichas_tecnicas_padrao_vinculos l
    JOIN fichas_tecnicas_padrao f ON f.id = l.ficha_padrao_id
    JOIN fichas_tecnicas_padrao_versoes v
      ON v.id = l.versao_id AND v.ficha_padrao_id = l.ficha_padrao_id
    WHERE l.produto_id = ? AND l.ativo = 1
      AND f.ativa = 1 AND v.estado = 'PUBLICADA'
    ORDER BY f.nome COLLATE NOCASE, l.id
  `, [produtoId]);
  return rows.map((row) => ({
    origem: 'PADRAO',
    ficha_padrao_vinculo_id: Number(row.vinculo_id),
    ficha_padrao_id: Number(row.ficha_padrao_id),
    ficha_padrao_versao_id: Number(row.versao_id),
    tipo: row.ficha_tradicional_id == null ? 'LEGADA' : 'SABOR',
    ficha_tradicional_id: row.ficha_tradicional_id == null ? null : Number(row.ficha_tradicional_id),
    codigo: row.codigo,
    nome: row.nome,
    numero_versao: Number(row.numero_versao)
  }));
}

async function listarFichasVinculadasProduto(db, produtoIdBruto) {
  const produtoId = idPositivo(produtoIdBruto, 'Id do produto');
  await garantirSchema(db);
  const tradicionais = await listarFichasTradicionaisDoProduto(db, produtoId);
  const padrao = await listarVinculosAtivosProduto(db, produtoId);
  return [
    ...tradicionais.filter((ficha) => ficha.ativa).map((ficha) => ({
      origem: 'TRADICIONAL',
      ficha_tecnica_id: ficha.id,
      codigo: ficha.codigo,
      nome: ficha.nome,
      rendimento_quantidade: ficha.rendimento_quantidade,
      rendimento_unidade: ficha.rendimento_unidade,
      ativa: ficha.ativa
    })),
    ...padrao
  ];
}

async function obterSnapshotVinculoProduto(db, vinculoIdBruto, produtoIdBruto, versaoIdBruta) {
  await garantirSchema(db);
  const vinculoId = idPositivo(vinculoIdBruto, 'Id do vínculo da ficha padrão');
  const produtoId = idPositivo(produtoIdBruto, 'Id do produto');
  await validarProdutoFabricado(db, produtoId);
  const row = await get(db, `
    SELECT l.id AS vinculo_id, l.ficha_padrao_id, l.produto_id, l.versao_id, l.ativo,
           f.codigo, f.nome, f.ativa AS ficha_ativa, f.ficha_tradicional_id,
           v.numero_versao, v.estado, v.rendimento_quantidade, v.rendimento_unidade, v.observacoes,
           v.ficha_tradicional_revisao, v.ficha_tradicional_snapshot
    FROM fichas_tecnicas_padrao_vinculos l
    JOIN fichas_tecnicas_padrao f ON f.id = l.ficha_padrao_id
    JOIN fichas_tecnicas_padrao_versoes v
      ON v.id = l.versao_id AND v.ficha_padrao_id = l.ficha_padrao_id
    WHERE l.id = ? AND l.produto_id = ?
  `, [vinculoId, produtoId]);
  if (!row || Number(row.ativo) !== 1) {
    throw erro('A ficha padrão não está vinculada ativamente a este produto.', 'VINCULO_NAO_ENCONTRADO', 404);
  }
  if (Number(row.ficha_ativa) !== 1) {
    throw erro('A ficha padrão vinculada está inativa.', 'FICHA_PADRAO_INATIVA', 409);
  }
  const versaoId = Number(row.versao_id);
  if (versaoIdBruta != null && idPositivo(versaoIdBruta, 'Id da versão da ficha padrão') !== versaoId) {
    throw erro('A versão vinculada mudou. Atualize as fichas disponíveis antes de continuar.', 'VERSAO_VINCULO_ALTERADA', 409);
  }
  if (row.estado !== 'PUBLICADA') {
    throw erro('A ficha vinculada não possui uma versão publicada válida.', 'VERSAO_NAO_PUBLICADA', 409);
  }

  const versao = await lerConteudoVersao(db, versaoId);
  const composicao = await resolverComposicao(db, versao, []);
  const produtoIds = composicao.componentes.map((item) => item.produto_id);
  const produtos = produtoIds.length
    ? await all(db, `SELECT id, nome FROM produtos WHERE id IN (${produtoIds.map(() => '?').join(',')})`, produtoIds)
    : [];
  const nomes = new Map(produtos.map((produto) => [Number(produto.id), produto.nome]));
  const componentes = composicao.componentes.map((item, indice) => {
    const base = versao.componentes.find((componente) => componente.produto_id === item.produto_id);
    return {
      produto_id: item.produto_id,
      descricao: base ? base.descricao : nomes.get(item.produto_id) || `Insumo #${item.produto_id}`,
      quantidade: item.quantidade,
      unidade: item.unidade,
      observacao: base ? base.observacao : '',
      ordem: indice + 1
    };
  });
  return {
    ficha_padrao_vinculo_id: vinculoId,
    ficha_padrao_versao_id: versaoId,
    ficha_padrao_snapshot: {
      ficha_padrao_id: Number(row.ficha_padrao_id),
      ficha_por_sabor: row.ficha_tradicional_id == null ? null : {
        ficha_tradicional_id: Number(row.ficha_tradicional_id),
        revisao_origem: row.ficha_tradicional_revisao || null,
        snapshot_origem: lerJsonSnapshot(row.ficha_tradicional_snapshot, 'ficha tradicional')
      },
      ficha_padrao_vinculo_id: vinculoId,
      ficha_padrao_versao_id: versaoId,
      numero_versao: Number(row.numero_versao),
      codigo: row.codigo,
      nome: row.nome,
      rendimento_quantidade: Number(row.rendimento_quantidade),
      rendimento_unidade: row.rendimento_unidade,
      observacoes: row.observacoes || '',
      componentes,
      etapas: versao.etapas,
      informacoes: versao.informacoes
    }
  };
}

function normalizarAjuste(entrada, id = null) {
  const dados = entrada || {};
  const operacao = texto(dados.operacao, 'Operação', true).toUpperCase();
  if (!['HERDAR', 'SUBSTITUIR', 'ADICIONAR', 'REMOVER'].includes(operacao)) {
    throw erro('Operação de ajuste inválida.', 'OPERACAO_INVALIDA');
  }
  const justificativa = texto(dados.justificativa, 'Justificativa');
  if (justificativa.length > 500) throw erro('Justificativa excede 500 caracteres.', 'JUSTIFICATIVA_INVALIDA');

  if (operacao === 'ADICIONAR') {
    if (dados.componente_base_id != null && dados.componente_base_id !== '') {
      throw erro('ADICIONAR não pode apontar para componente-base.', 'ADICIONAL_COM_COMPONENTE_BASE');
    }
    return {
      id,
      componente_base_id: null,
      produto_base_id: null,
      produto_id: idPositivo(dados.produto_id, 'produto_id do ajuste'),
      operacao,
      quantidade: numeroPositivo(dados.quantidade, 'Quantidade do ajuste'),
      unidade: texto(dados.unidade, 'Unidade do ajuste', true),
      justificativa
    };
  }

  const componenteBaseId = idPositivo(dados.componente_base_id, 'componente_base_id');
  if (dados.produto_id != null && idPositivo(dados.produto_id, 'produto_id do ajuste') !== componenteBaseId) {
    throw erro('produto_id deve corresponder ao componente-base informado.', 'PRODUTO_DIVERGENTE', 400, {
      componente_base_id: componenteBaseId,
      produto_id: dados.produto_id
    });
  }
  let quantidade = null;
  let unidade = '';
  if (operacao === 'SUBSTITUIR') {
    quantidade = numeroPositivo(dados.quantidade, 'Quantidade substituída');
    unidade = texto(dados.unidade, 'Unidade substituída', true);
  } else if ((dados.quantidade != null && dados.quantidade !== '') || (dados.unidade != null && dados.unidade !== '')) {
    throw erro(`${operacao} não aceita quantidade nem unidade.`, 'DADOS_OPERACAO_INVALIDOS');
  }
  return {
    id,
    componente_base_id: componenteBaseId,
    produto_base_id: componenteBaseId,
    produto_id: componenteBaseId,
    operacao,
    quantidade,
    unidade,
    justificativa
  };
}

function ajusteParaMotor(ajuste) {
  return {
    id: ajuste.id,
    componente_base_id: ajuste.componente_base_id,
    produto_id: ajuste.produto_id,
    operacao: ajuste.operacao,
    quantidade: ajuste.quantidade,
    unidade: ajuste.unidade
  };
}

async function obterVinculoEditavel(db, vinculoId) {
  const vinculo = await obterVinculo(db, vinculoId);
  if (!vinculo.ativo) throw erro('Vínculo inativo não permite editar ajustes.', 'VINCULO_INATIVO', 409);
  if (vinculo.versao_estado !== 'PUBLICADA') {
    throw erro('Ajustes exigem vínculo com versão publicada.', 'VERSAO_NAO_PUBLICADA', 409);
  }
  return vinculo;
}

async function validarAjustesCandidatos(db, vinculoId, ajustes) {
  const vinculo = await obterVinculoEditavel(db, vinculoId);
  for (const ajuste of ajustes) {
    if (ajuste.operacao === 'ADICIONAR') {
      await validarInsumo(db, ajuste.produto_id, new Set(), true);
    }
  }
  const versao = await lerConteudoVersao(db, vinculo.versao_id);
  return resolverComposicao(db, versao, ajustes.map(ajusteParaMotor));
}

async function listarAjustesFichaPadrao(db, vinculoIdBruto) {
  await garantirSchema(db);
  const vinculoId = idPositivo(vinculoIdBruto, 'Id do vínculo');
  await obterVinculo(db, vinculoId);
  return carregarAjustes(db, vinculoId);
}

function erroRestricao(err) {
  if (err && /UNIQUE constraint failed/.test(err.message || '')) {
    return erro('Já existe uma regra para esse produto ou componente-base.', 'REGRA_DUPLICADA', 409);
  }
  if (err && /FOREIGN KEY constraint failed/.test(err.message || '')) {
    return erro('A operação referencia um registro inexistente ou ainda utilizado.', 'REFERENCIA_EM_USO', 409);
  }
  if (err && /CHECK constraint failed/.test(err.message || '')) {
    return erro('Os dados não atendem às regras de integridade do ajuste.', 'AJUSTE_INVALIDO', 400);
  }
  return err;
}

async function criarAjusteFichaPadrao(db, vinculoIdBruto, entrada, contexto) {
  await garantirSchema(db);
  const vinculoId = idPositivo(vinculoIdBruto, 'Id do vínculo');
  try {
    const ajusteId = await transacionar(db, async () => {
      const vinculo = await obterVinculoEditavel(db, vinculoId);
      const atuais = await carregarAjustes(db, vinculoId);
      const novo = normalizarAjuste(entrada);
      const candidatos = [...atuais, novo];
      await validarAjustesCandidatos(db, vinculoId, candidatos);
      const inserido = await run(db, `
        INSERT INTO fichas_tecnicas_padrao_ajustes (
          vinculo_id, ficha_padrao_id, produto_base_id, produto_id,
          operacao, quantidade, unidade, justificativa
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        vinculoId, vinculo.ficha_padrao_id, novo.produto_base_id, novo.produto_id,
        novo.operacao, novo.quantidade, novo.unidade || null, novo.justificativa || null
      ]);
      return inserido.id;
    });
    await auditar(contexto, 'AJUSTE_FICHA_PADRAO_CRIADO', ajusteId, { vinculo_id: vinculoId });
    return (await carregarAjustes(db, vinculoId)).find((item) => item.id === ajusteId);
  } catch (err) {
    throw erroRestricao(err);
  }
}

async function atualizarAjusteFichaPadrao(db, vinculoIdBruto, ajusteIdBruto, entrada, contexto) {
  await garantirSchema(db);
  const vinculoId = idPositivo(vinculoIdBruto, 'Id do vínculo');
  const ajusteId = idPositivo(ajusteIdBruto, 'Id do ajuste');
  try {
    await transacionar(db, async () => {
      const vinculo = await obterVinculoEditavel(db, vinculoId);
      const atuais = await carregarAjustes(db, vinculoId);
      const atual = atuais.find((item) => item.id === ajusteId);
      if (!atual) throw erro('Ajuste não encontrado neste vínculo.', 'AJUSTE_NAO_ENCONTRADO', 404);
      const atualizado = normalizarAjuste(entrada, ajusteId);
      const candidatos = atuais.map((item) => item.id === ajusteId ? atualizado : item);
      await validarAjustesCandidatos(db, vinculoId, candidatos);
      await run(db, `
        UPDATE fichas_tecnicas_padrao_ajustes
        SET produto_base_id = ?, produto_id = ?, operacao = ?, quantidade = ?,
            unidade = ?, justificativa = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ? AND vinculo_id = ?
      `, [
        atualizado.produto_base_id, atualizado.produto_id, atualizado.operacao,
        atualizado.quantidade, atualizado.unidade || null, atualizado.justificativa || null,
        ajusteId, vinculoId
      ]);
      void vinculo;
    });
    await auditar(contexto, 'AJUSTE_FICHA_PADRAO_ATUALIZADO', ajusteId, { vinculo_id: vinculoId });
    return (await carregarAjustes(db, vinculoId)).find((item) => item.id === ajusteId);
  } catch (err) {
    throw erroRestricao(err);
  }
}

async function removerAjusteFichaPadrao(db, vinculoIdBruto, ajusteIdBruto, contexto) {
  await garantirSchema(db);
  const vinculoId = idPositivo(vinculoIdBruto, 'Id do vínculo');
  const ajusteId = idPositivo(ajusteIdBruto, 'Id do ajuste');
  try {
    await transacionar(db, async () => {
      await obterVinculoEditavel(db, vinculoId);
      const atuais = await carregarAjustes(db, vinculoId);
      if (!atuais.some((item) => item.id === ajusteId)) {
        throw erro('Ajuste não encontrado neste vínculo.', 'AJUSTE_NAO_ENCONTRADO', 404);
      }
      await validarAjustesCandidatos(db, vinculoId, atuais.filter((item) => item.id !== ajusteId));
      await run(db, 'DELETE FROM fichas_tecnicas_padrao_ajustes WHERE id = ? AND vinculo_id = ?', [ajusteId, vinculoId]);
    });
    await auditar(contexto, 'AJUSTE_FICHA_PADRAO_REMOVIDO', ajusteId, { vinculo_id: vinculoId });
    return { id: ajusteId, removido: true };
  } catch (err) {
    throw erroRestricao(err);
  }
}

async function listarAtualizacoesFichaPadrao(db, fichaIdBruto) {
  await garantirSchema(db);
  const fichaId = idPositivo(fichaIdBruto, 'Id da ficha padrão');
  const ficha = await get(db, 'SELECT id FROM fichas_tecnicas_padrao WHERE id = ?', [fichaId]);
  if (!ficha) throw erro('Ficha padrão não encontrada.', 'FICHA_PADRAO_NAO_ENCONTRADA', 404);
  const rows = await all(db, `
    SELECT r.id, r.vinculo_id, r.versao_anterior_id, r.versao_nova_id, r.estado,
           r.justificativa, r.decidido_em, r.usuario_id, r.usuario_nome, r.created_at,
           p.id AS produto_id, p.nome AS produto_nome,
           va.numero_versao AS versao_anterior, vn.numero_versao AS versao_nova,
           l.versao_id AS versao_atual_id, l.ativo AS vinculo_ativo
    FROM fichas_tecnicas_padrao_revisoes r
    JOIN fichas_tecnicas_padrao_vinculos l ON l.id = r.vinculo_id
    JOIN produtos p ON p.id = l.produto_id
    JOIN fichas_tecnicas_padrao_versoes va ON va.id = r.versao_anterior_id
    JOIN fichas_tecnicas_padrao_versoes vn ON vn.id = r.versao_nova_id
    WHERE r.ficha_padrao_id = ?
    ORDER BY vn.numero_versao DESC, p.nome COLLATE NOCASE, r.id
  `, [fichaId]);
  return rows.map((row) => ({
    id: Number(row.id),
    vinculo_id: Number(row.vinculo_id),
    produto_id: Number(row.produto_id),
    produto_nome: row.produto_nome,
    versao_anterior_id: Number(row.versao_anterior_id),
    versao_anterior: Number(row.versao_anterior),
    versao_nova_id: Number(row.versao_nova_id),
    versao_nova: Number(row.versao_nova),
    versao_atual_id: Number(row.versao_atual_id),
    estado: row.estado,
    vinculo_ativo: Number(row.vinculo_ativo) === 1,
    justificativa: row.justificativa || '',
    decidido_em: row.decidido_em,
    usuario_id: row.usuario_id == null ? null : Number(row.usuario_id),
    usuario_nome: row.usuario_nome || '',
    created_at: row.created_at
  }));
}

async function decidirAtualizacaoFichaPadrao(db, revisaoIdBruto, entrada, contexto) {
  await garantirSchema(db);
  const revisaoId = idPositivo(revisaoIdBruto, 'Id da revisão');
  const dados = entrada || {};
  const decisao = texto(dados.decisao, 'Decisão', true).toUpperCase();
  if (!['APROVAR', 'MANTER_ANTERIOR'].includes(decisao)) {
    throw erro('Decisão inválida. Use APROVAR ou MANTER_ANTERIOR.', 'DECISAO_INVALIDA');
  }
  const justificativa = texto(dados.justificativa, 'Justificativa');
  if (justificativa.length > 500) throw erro('Justificativa excede 500 caracteres.', 'JUSTIFICATIVA_INVALIDA');
  const usuarioId = contexto && Number.isInteger(Number(contexto.usuario_id)) && Number(contexto.usuario_id) > 0
    ? Number(contexto.usuario_id)
    : null;
  const usuarioNome = contexto ? texto(contexto.usuario_nome, 'Nome do usuário') || null : null;

  const resultado = await transacionar(db, async () => {
    const revisao = await get(db, `
      SELECT id, ficha_padrao_id, vinculo_id, versao_anterior_id, versao_nova_id, estado
      FROM fichas_tecnicas_padrao_revisoes WHERE id = ?
    `, [revisaoId]);
    if (!revisao) throw erro('Revisão de atualização não encontrada.', 'REVISAO_NAO_ENCONTRADA', 404);
    if (revisao.estado !== 'PENDENTE') throw erro('A revisão já foi decidida ou superada.', 'REVISAO_ENCERRADA', 409);
    const vinculo = await obterVinculo(db, revisao.vinculo_id);
    if (!vinculo.ativo) throw erro('Vínculo inativo não pode aprovar uma atualização.', 'VINCULO_INATIVO', 409);
    if (vinculo.versao_id !== Number(revisao.versao_anterior_id)) {
      throw erro('A revisão não corresponde mais à versão atual do produto.', 'REVISAO_SUPERADA', 409);
    }

    if (decisao === 'APROVAR') {
      const versao = await lerConteudoVersao(db, revisao.versao_nova_id);
      await resolverComposicao(db, versao, []);
      await run(db, `
        UPDATE fichas_tecnicas_padrao_vinculos
        SET versao_id = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ? AND versao_id = ?
      `, [revisao.versao_nova_id, vinculo.id, revisao.versao_anterior_id]);
    }

    const estado = decisao === 'APROVAR' ? 'APROVADO' : 'MANTER_ANTERIOR';
    await run(db, `
      UPDATE fichas_tecnicas_padrao_revisoes
      SET estado = ?, justificativa = ?, decidido_em = datetime('now', 'localtime'),
          usuario_id = ?, usuario_nome = ?
      WHERE id = ? AND estado = 'PENDENTE'
    `, [estado, justificativa || null, usuarioId, usuarioNome, revisaoId]);
    await run(db, `
      UPDATE fichas_tecnicas_padrao_revisoes
      SET estado = 'SUPERADA'
      WHERE vinculo_id = ? AND estado = 'PENDENTE' AND versao_anterior_id = ? AND id <> ?
    `, [vinculo.id, revisao.versao_anterior_id, revisaoId]);
    return {
      revisao_id: revisaoId,
      vinculo_id: vinculo.id,
      estado,
      versao_atual_id: decisao === 'APROVAR' ? Number(revisao.versao_nova_id) : vinculo.versao_id
    };
  });
  await auditar(contexto, 'REVISAO_FICHA_PADRAO_DECIDIDA', revisaoId, {
    decisao,
    estado: resultado.estado,
    vinculo_id: resultado.vinculo_id
  });
  return resultado;
}

module.exports = {
  listarFichasPadrao,
  listarFichasPorSabor,
  obterFichaPadrao,
  obterFichaPorSabor,
  criarFichaPorSabor,
  revisarOrigemFichaPorSabor,
  criarFichaPadrao,
  atualizarFichaPadrao,
  atualizarStatusFichaPadrao,
  excluirFichaPadrao,
  criarVersaoPadrao,
  atualizarVersaoPadrao,
  publicarVersaoPadrao,
  criarVinculoFichaPadrao,
  atualizarVinculoFichaPadrao,
  listarVinculosFichaPadrao,
  listarVinculosAtivosProduto,
  listarFichasVinculadasProduto,
  obterSnapshotVinculoProduto,
  listarAjustesFichaPadrao,
  criarAjusteFichaPadrao,
  atualizarAjusteFichaPadrao,
  removerAjusteFichaPadrao,
  listarAtualizacoesFichaPadrao,
  decidirAtualizacaoFichaPadrao
};
