/**
 * RA-6.4 — Resolver oficial: Produto → Linha → Tabela do Canal → Preço
 * Não usa produto.tabela_preco_id.
 */
const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));

const db = require('../../../database');
const tabelasService = require('../tabelas-preco/TabelasPrecoService');
const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function waitDb() {
  for (let i = 0; i < 50; i++) {
    try {
      await get('SELECT 1 AS ok');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('DB não pronto');
}

async function main() {
  await waitDb();
  ComercialPrecoResolver.setLogsHabilitados(false);

  const migration016 = require('../migrations/016_tabela_mono_canal_ra6');
  await migration016(db);

  const varejo = await get(`SELECT id FROM canais_venda WHERE UPPER(codigo)='VAREJO' LIMIT 1`);
  const atacado = await get(`SELECT id FROM canais_venda WHERE UPPER(codigo)='ATACADO' LIMIT 1`);
  const consignado = await get(`SELECT id FROM canais_venda WHERE UPPER(codigo)='CONSIGNADO' LIMIT 1`);
  assert.ok(varejo?.id && atacado?.id, 'canais VAREJO/ATACADO');

  const suffix = Date.now();
  const linha = await run(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 1)`,
    ['RA64_L_' + suffix, 'Linha RA64']
  );

  const tabV = await tabelasService.criar({
    codigo: 'RA64_V_' + suffix,
    nome: 'Tab Varejo RA64 ' + suffix,
    canal_venda_id: varejo.id,
    ativo: true,
    linhas_ids: [linha.lastID],
    valores: [{
      linha_comercial_id: linha.lastID,
      canal_venda_id: varejo.id,
      preco: 11,
      forma_comercializacao: 'UNIDADE',
      unidade_comercial: 'UN'
    }]
  });

  const tabA = await tabelasService.criar({
    codigo: 'RA64_A_' + suffix,
    nome: 'Tab Atacado RA64 ' + suffix,
    canal_venda_id: atacado.id,
    ativo: true,
    atacado_habilitado: true,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    linhas_ids: [linha.lastID],
    valores: [{
      linha_comercial_id: linha.lastID,
      canal_venda_id: atacado.id,
      preco: 6.5,
      forma_comercializacao: 'UNIDADE',
      unidade_comercial: 'UN'
    }]
  });

  let tabC = null;
  if (consignado?.id) {
    tabC = await tabelasService.criar({
      codigo: 'RA64_C_' + suffix,
      nome: 'Tab Consignado RA64 ' + suffix,
      canal_venda_id: consignado.id,
      ativo: true,
      linhas_ids: [linha.lastID],
      valores: [{
        linha_comercial_id: linha.lastID,
        canal_venda_id: consignado.id,
        preco: 9,
        forma_comercializacao: 'UNIDADE',
        unidade_comercial: 'UN'
      }]
    });
  }

  // Produto "antigo" com tabela_preco_id apontando para tabela ERRADA (não deve influenciar)
  const produto = {
    id: 0,
    nome: 'Produto RA64',
    preco_venda: 99,
    linha_comercial_id: linha.lastID,
    tabela_preco_id: tabA.id // isca: se o resolver usar isso no VAREJO, falha
  };

  const idTabelaCanal = await ComercialPrecoResolver.resolverTabelaId(
    { canal: 'VAREJO' },
    produto
  );
  assert.notStrictEqual(
    Number(idTabelaCanal),
    Number(tabA.id),
    'resolverTabelaId NÃO deve usar produto.tabela_preco_id'
  );

  const precoV = await ComercialPrecoResolver.resolver({
    produto,
    canal: 'VAREJO',
    tabela_preco_id: tabV.id
  });
  assert.strictEqual(Number(precoV.preco_venda), 11);
  assert.strictEqual(precoV.origem, ComercialPrecoResolver.ORIGEM_TABELA_LINHA);
  assert.strictEqual(!!precoV.fallback, false);

  const precoA = await ComercialPrecoResolver.resolver({
    produto,
    canal: 'ATACADO',
    tabela_preco_id: tabA.id
  });
  assert.strictEqual(Number(precoA.preco_venda), 6.5);

  if (tabC) {
    const precoC = await ComercialPrecoResolver.resolver({
      produto,
      canal: 'CONSIGNADO',
      tabela_preco_id: tabC.id
    });
    assert.strictEqual(Number(precoC.preco_venda), 9);
  }

  // Sem preço na tabela → Preço Base + aviso
  const produtoSemCelula = {
    nome: 'Sem celula',
    preco_venda: 4.2,
    linha_comercial_id: linha.lastID,
    tabela_preco_id: tabV.id
  };
  // linha fantasma inexistente na tabela
  const linhaGhost = await run(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 1)`,
    ['RA64_G_' + suffix, 'Ghost']
  );
  const soBase = await ComercialPrecoResolver.resolver({
    produto: {
      ...produtoSemCelula,
      linha_comercial_id: linhaGhost.lastID,
      tabela_preco_id: 999999
    },
    canal: 'VAREJO',
    tabela_preco_id: tabV.id
  });
  assert.strictEqual(Number(soBase.preco_venda), 4.2);
  assert.strictEqual(soBase.origem, ComercialPrecoResolver.ORIGEM_LEGADO);
  assert.ok(soBase.fallback);
  assert.ok(String(soBase.aviso || '').includes('Nenhum preço encontrado'));

  // Sem base e sem celula → erro controlado
  const semNada = await ComercialPrecoResolver.resolver({
    produto: {
      nome: 'Zerado',
      preco_venda: 0,
      linha_comercial_id: linhaGhost.lastID
    },
    canal: 'VAREJO',
    tabela_preco_id: tabV.id
  });
  assert.ok(semNada.erro);
  assert.ok(String(semNada.erro).includes('Nenhum preço encontrado'));

  // Sync também ignora produto.tabela_preco_id
  const sync = ComercialPrecoResolver.resolverSync({
    produto,
    canal: 'VAREJO',
    tabela_preco_id: tabV.id
  });
  // sem cache aquecido pode cair em base; aquecer via async já feito — força cache
  await ComercialPrecoResolver.resolver({ produto, canal: 'VAREJO', tabela_preco_id: tabV.id });
  const sync2 = ComercialPrecoResolver.resolverSync({
    produto: { ...produto, tabela_preco_id: tabA.id },
    canal: 'VAREJO',
    tabela_preco_id: tabV.id
  });
  assert.strictEqual(Number(sync2.preco_venda), 11);

  // cleanup
  const ids = [tabV.id, tabA.id].concat(tabC ? [tabC.id] : []);
  for (const id of ids) {
    await run('DELETE FROM tabela_preco_valores WHERE tabela_preco_id = ?', [id]);
    await run('DELETE FROM tabela_preco_linhas WHERE tabela_preco_id = ?', [id]);
    await run('DELETE FROM tabelas_preco WHERE id = ?', [id]);
  }
  await run('DELETE FROM linhas_comerciais WHERE id IN (?, ?)', [linha.lastID, linhaGhost.lastID]);

  console.log('RA-6.4 OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('RA-6.4 FALHOU:', err);
  process.exit(1);
});
