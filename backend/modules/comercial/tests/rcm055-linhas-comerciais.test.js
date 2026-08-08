/**
 * RCM-05.5 — Linhas Comerciais (núcleo de precificação)
 */

const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
const linhasService = require(path.join(__dirname, '../linhas-comerciais/LinhasComerciaisService'));
const { bootstrapComercialV2Schema } = require(path.join(__dirname, '../index'));
const db = require(path.join(__dirname, '../../../database'));

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
      return;
    }
    setTimeout(resolve, 500);
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);
  ComercialPrecoResolver.setLogsHabilitados(false);
  ComercialPrecoResolver.invalidateCache();

  const cols = await dbAll(`PRAGMA table_info(produtos)`);
  assert.ok(cols.some((c) => c.name === 'linha_comercial_id'), 'coluna linha_comercial_id');

  const tabelas = await dbAll(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('linhas_comerciais','linha_comercial_valores')`
  );
  assert.strictEqual(tabelas.length, 2, 'tabelas de linhas comerciais');

  // A-1/RA-1.1: seeds automaticos desativados — garante fixtures do teste
  async function garantirLinhaComValores(codigo, descricao, valoresPorCanal) {
    let row = await dbGet(`SELECT id FROM linhas_comerciais WHERE codigo = ?`, [codigo]);
    if (!row) {
      const criada = await linhasService.criar({
        codigo,
        descricao,
        ativo: true,
        valores: []
      });
      row = { id: criada.id };
    }
    const canais = await dbAll(`SELECT id, codigo FROM canais_venda WHERE ativo = 1`);
    const mapa = Object.fromEntries(canais.map((c) => [String(c.codigo).toUpperCase(), c.id]));
    const valores = Object.entries(valoresPorCanal).map(([canal, cfg]) => ({
      canal_venda_id: mapa[canal],
      preco: cfg.preco,
      forma_comercializacao: cfg.forma,
      unidade_comercial: cfg.unidade
    })).filter((v) => v.canal_venda_id);
    await linhasService.atualizar(row.id, {
      codigo,
      descricao,
      ativo: true,
      valores
    });
    return row;
  }

  const picEsp = await garantirLinhaComValores('PIC_ESP', 'Picolés Linha Especial', {
    VAREJO: { preco: 2.5, forma: 'UNIDADE', unidade: 'UN' },
    ATACADO: { preco: 2.0, forma: 'UNIDADE', unidade: 'UN' },
    EVENTO: { preco: 3.0, forma: 'UNIDADE', unidade: 'UN' }
  });
  const sorvete = await garantirLinhaComValores('SORVETE', 'Sorvetes', {
    VAREJO: { preco: 59.9, forma: 'PESO', unidade: 'KG' },
    ATACADO: { preco: 30.0, forma: 'VOLUME', unidade: 'LITRO' },
    EVENTO: { preco: 28.0, forma: 'VOLUME', unidade: 'LITRO' }
  });
  const casquinha = await garantirLinhaComValores('CASQUINHA', 'Casquinhas', {
    VAREJO: { preco: 8.0, forma: 'CASQUINHA', unidade: 'UN' },
    ATACADO: { preco: 7.0, forma: 'CASQUINHA', unidade: 'UN' },
    EVENTO: { preco: 9.0, forma: 'CASQUINHA', unidade: 'UN' }
  });

  assert.ok(picEsp?.id && sorvete?.id && casquinha?.id, 'fixtures políticas');

  const suffix = Date.now().toString(36);

  // Picole: UNIDADE em todos os canais
  const rPicV = await ComercialPrecoResolver.resolver({
    produto: { id: 1, nome: 'Picolé Esp', preco_venda: 9.99, linha_comercial_id: picEsp.id },
    canal: 'VAREJO'
  });
  // Compat: Política ainda resolve quando não há Tabela×Produto
  assert.ok(
    rPicV.origem === ComercialPrecoResolver.ORIGEM_LINHA ||
      rPicV.origem === ComercialPrecoResolver.ORIGEM_TABELA_PRODUTO
  );
  assert.strictEqual(Number(rPicV.preco), 2.5);
  assert.strictEqual(rPicV.formaComercializacao, 'UNIDADE');
  assert.ok(rPicV.linhaComercial && rPicV.linhaComercial.codigo === 'PIC_ESP');

  const rPicA = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Picolé Esp', preco_venda: 9.99, linha_comercial_id: picEsp.id },
    canal: 'ATACADO'
  });
  assert.strictEqual(Number(rPicA.preco), 2.0);
  assert.strictEqual(rPicA.formaComercializacao, 'UNIDADE');

  const rPicE = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Picolé Esp', preco_venda: 9.99, linha_comercial_id: picEsp.id },
    canal: 'EVENTO'
  });
  assert.strictEqual(Number(rPicE.preco), 3.0);
  assert.strictEqual(rPicE.formaComercializacao, 'UNIDADE');

  // Sorvete: PESO no varejo, VOLUME no atacado/evento
  const rSorV = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Sorvete', preco_venda: 1, linha_comercial_id: sorvete.id },
    canal: 'VAREJO'
  });
  assert.strictEqual(Number(rSorV.preco), 59.9);
  assert.strictEqual(rSorV.formaComercializacao, 'PESO');
  assert.strictEqual(rSorV.unidadeComercial, 'KG');

  const rSorA = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Sorvete', preco_venda: 1, linha_comercial_id: sorvete.id },
    canal: 'ATACADO'
  });
  assert.strictEqual(Number(rSorA.preco), 30);
  assert.strictEqual(rSorA.formaComercializacao, 'VOLUME');
  assert.ok(['LITRO', 'L'].includes(rSorA.unidadeComercial));

  const rSorE = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Sorvete', preco_venda: 1, linha_comercial_id: sorvete.id },
    canal: 'EVENTO'
  });
  assert.strictEqual(Number(rSorE.preco), 28);
  assert.strictEqual(rSorE.formaComercializacao, 'VOLUME');

  // Casquinha
  const rCas = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Casquinha', preco_venda: 1, linha_comercial_id: casquinha.id },
    canal: 'VAREJO'
  });
  assert.strictEqual(Number(rCas.preco), 8);
  assert.strictEqual(rCas.formaComercializacao, 'CASQUINHA');

  // CRUD linha
  const criada = await linhasService.criar({
    codigo: `TST_${suffix}`,
    descricao: `Linha Teste ${suffix}`,
    ativo: true,
    valores: []
  });
  assert.ok(criada.id);
  const detalhe = await linhasService.buscarPorId(criada.id);
  assert.ok(Array.isArray(detalhe.valores));

  // Linha tem prioridade sobre tabela: sem preço de linha → tabela; com linha → linha
  const canais = await dbAll(`SELECT id, codigo FROM canais_venda WHERE ativo = 1`);
  const canalVarejo = canais.find((c) => c.codigo === 'VAREJO');
  assert.ok(canalVarejo);

  await linhasService.atualizar(criada.id, {
    codigo: criada.codigo,
    descricao: criada.descricao,
    ativo: true,
    valores: [
      {
        canal_venda_id: canalVarejo.id,
        preco: 4.44,
        forma_comercializacao: 'UNIDADE',
        unidade_comercial: 'UN'
      }
    ]
  });

  ComercialPrecoResolver.invalidateCacheLinha(criada.id);
  const rPri = await ComercialPrecoResolver.resolver({
    produto: {
      nome: 'Prioridade',
      preco_venda: 1.11,
      linha_comercial_id: criada.id,
      tabela_preco_id: 999999
    },
    canal: 'VAREJO'
  });
  assert.strictEqual(Number(rPri.preco), 4.44);
  assert.strictEqual(rPri.origem, ComercialPrecoResolver.ORIGEM_LINHA);

  // Relatório migração
  const rel = await linhasService.relatorioMigracao();
  assert.ok(rel);
  assert.ok(typeof rel.classificados === 'number');
  assert.ok(typeof rel.nao_classificados === 'number');

  // Cleanup
  await dbRun('DELETE FROM linha_comercial_valores WHERE linha_id = ?', [criada.id]);
  await dbRun('DELETE FROM linhas_comerciais WHERE id = ?', [criada.id]);

  console.log('RCM-05.5 — Linhas Comerciais: OK');
}

run().catch((err) => {
  console.error('RCM-05.5 FALHOU:', err);
  process.exit(1);
});
