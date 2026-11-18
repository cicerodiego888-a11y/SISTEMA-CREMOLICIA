const { VERSAO, TIPO_UNIDADE, FORA_DE_ESCOPO } = require('./constants');
const bootstrapUnidadesNegocio = require('./migrations/001_unidades_negocio');

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

function mapear(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    codigo: row.codigo,
    nome: row.nome,
    tipo: row.tipo,
    ativa: Number(row.ativa) === 1,
    padrao: Number(row.padrao) === 1
  };
}

async function garantirSchema(db) {
  await bootstrapUnidadesNegocio(db);
}

async function listarUnidades(db) {
  await garantirSchema(db);
  const rows = await all(db, `
    SELECT id, codigo, nome, tipo, ativa, padrao
    FROM unidades_negocio
    ORDER BY padrao DESC, id
  `);
  return rows.map(mapear);
}

async function obterUnidadeAtual(db) {
  await garantirSchema(db);
  const row = await get(db, `
    SELECT id, codigo, nome, tipo, ativa, padrao
    FROM unidades_negocio
    WHERE padrao = 1
    LIMIT 1
  `);
  if (!row) throw erro('A Loja atual não está identificada.', 'LOJA_ATUAL_AUSENTE', 500);
  return mapear(row);
}

async function obterContexto(db) {
  const unidadeAtual = await obterUnidadeAtual(db);
  const unidades = await listarUnidades(db);
  return {
    versao: VERSAO,
    preserva_loja: unidadeAtual.tipo === TIPO_UNIDADE.LOJA && unidadeAtual.padrao === true,
    unidade_atual: unidadeAtual,
    unidades,
    fora_de_escopo: FORA_DE_ESCOPO.slice()
  };
}

/**
 * Registra uma unidade futura sem torná-la a operação atual.
 * A Loja padrão permanece a unidade em uso.
 */
async function registrarUnidade(db, entrada = {}) {
  await garantirSchema(db);
  const tipo = String(entrada.tipo || '').trim().toUpperCase();
  const codigo = String(entrada.codigo || '').trim().toUpperCase();
  const nome = String(entrada.nome || '').trim();
  if (!TIPO_UNIDADE[tipo]) {
    throw erro('Tipo de unidade inválido. Use LOJA ou FABRICA.', 'TIPO_UNIDADE_INVALIDO');
  }
  if (!codigo || !nome) {
    throw erro('Informe código e nome da unidade.', 'UNIDADE_INCOMPLETA');
  }
  if (Number(entrada.padrao) === 1 || entrada.padrao === true) {
    throw erro('A operação atual permanece a Loja. A troca de contexto não faz parte desta base.', 'TROCA_DE_CONTEXTO_BLOQUEADA', 409);
  }
  const duplicada = await get(db, 'SELECT id FROM unidades_negocio WHERE codigo = ?', [codigo]);
  if (duplicada) throw erro(`Já existe a unidade ${codigo}.`, 'CODIGO_JA_EXISTE', 409);
  const antes = await obterUnidadeAtual(db);
  await run(db, `
    INSERT INTO unidades_negocio (codigo, nome, tipo, ativa, padrao)
    VALUES (?, ?, ?, 1, 0)
  `, [codigo, nome, tipo]);
  const criada = await get(db, `
    SELECT id, codigo, nome, tipo, ativa, padrao
    FROM unidades_negocio WHERE codigo = ?
  `, [codigo]);
  const atual = await obterUnidadeAtual(db);
  if (atual.id !== antes.id || atual.tipo !== TIPO_UNIDADE.LOJA || atual.padrao !== true) {
    throw erro('A Loja atual foi alterada.', 'LOJA_ALTERADA', 500);
  }
  return mapear(criada);
}

module.exports = {
  garantirSchema,
  listarUnidades,
  obterUnidadeAtual,
  obterContexto,
  registrarUnidade
};
