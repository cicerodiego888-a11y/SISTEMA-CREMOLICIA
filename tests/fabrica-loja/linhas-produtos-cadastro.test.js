/**
 * Cadastro de Linha de Produtos (FABRICA-MODELO-02): telas/rotas reais de
 * Fábrica e Produtos, vínculo por produto_id, sem estoque, sem preço, sem OP.
 * Banco temporário via tests/pdv/_bancoIsolado.js. Executar: npm run test:linhas-produtos-cadastro
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

const TMP = path.resolve(os.tmpdir()).toLowerCase();
const DB_DIR = path.resolve(String(process.env.DB_DIR || '')).toLowerCase();
if (!process.env.DB_DIR || !DB_DIR.startsWith(TMP)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/fabrica-loja/linhas-produtos-cadastro.test.js');
  process.exit(1);
}
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(process.env.DB_DIR, 'mercadao.db' + sufixo), { force: true });
}

const express = require('express');
const db = require('../../backend/database');
const bootstrapLinhasProdutos = require('../../backend/modules/fabrica-loja/migrations/010_linhas_produtos');
const LinhaProdutos = require('../../backend/modules/fabrica-loja/LinhaProdutosService');
const { salvarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { listarProdutosProduzidos } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r || null))));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
}

const ids = {};
let servidor;
let base;

async function criarProduto(dados) {
  const r = await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, preco_compra, saldo_fiscal, saldo_nao_fiscal,
       estoque_atual, ativo, natureza_cadastro, item_fiscal, linha_comercial_id)
     VALUES (?, ?, 'UN', ?, 1, 0, 50, 50, ?, ?, 0, ?)`,
    [dados.codigo, dados.nome, dados.preco || 2, dados.ativo == null ? 1 : dados.ativo, dados.natureza || null, dados.linhaComercial || null]
  );
  return r.id;
}

async function api(method, rota, body) {
  const resposta = await fetch(base + rota, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: resposta.status, body: await resposta.json().catch(() => null) };
}

async function linhaDoProduto(id) {
  return (await get('SELECT linha_produtos_id FROM produtos WHERE id = ?', [id])).linha_produtos_id;
}

async function saldos() {
  return all('SELECT id, estoque_atual, saldo_fiscal, saldo_nao_fiscal, linha_comercial_id, preco_venda, ativo FROM produtos ORDER BY id');
}

before(async () => {
  assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(TMP), `banco fora do temp: ${db.dbPath}`);
  await new Promise((resolve) => db.whenReady(() => resolve()));
  await bootstrapLinhasProdutos(db);

  const precificacao = await run("INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES ('LP-CREMOSA', 'CREMOSA', 1)");
  ids.linhaPrecificacao = precificacao.id;
  ids.saborInativo = await criarProduto({ codigo: 'SAB-CHOC', nome: 'Picolé Chocolate cremoso', ativo: 0, natureza: 'PRODUZIDO', linhaComercial: ids.linhaPrecificacao });
  ids.saborAtivo = await criarProduto({ codigo: 'SAB-MOR', nome: 'Picolé Morango cremoso', natureza: 'PRODUZIDO', linhaComercial: ids.linhaPrecificacao });
  ids.sorveteKg = await criarProduto({ codigo: 'SORV-KG', nome: 'Sorvete KG', natureza: 'PRODUZIDO', preco: 40 });
  ids.insumo = await criarProduto({ codigo: 'INS-LEITE', nome: 'Leite em pó', natureza: 'INSUMO' });

  const app = express();
  app.use(express.json());
  app.use('/api/produtos', require('../../backend/rotas/produtos'));
  app.use('/api/fabrica-loja', require('../../backend/rotas/fabrica-loja'));
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});

after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('Linha de Produtos — cadastro', () => {
  let movimentosAntes;
  let saldosAntes;
  let precosAntes;
  let precificacaoAntes;

  before(async () => {
    movimentosAntes = (await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q;
    saldosAntes = await saldos();
    precificacaoAntes = await all('SELECT * FROM linhas_comerciais ORDER BY id');
    const Resolver = require('../../backend/modules/comercial/preco/ComercialPrecoResolver');
    if (Resolver.setLogsHabilitados) Resolver.setLogsHabilitados(false);
    precosAntes = {};
    for (const id of [ids.saborAtivo, ids.sorveteKg]) {
      const produto = await get('SELECT * FROM produtos WHERE id = ?', [id]);
      const r = await Resolver.resolver({ produto, canal: 'VAREJO' });
      precosAntes[id] = { preco: r.preco, origem: r.origem };
    }
  });

  it('1. cria linha; nome e código não se repetem; código não vira número', async () => {
    const r = await api('POST', '/fabrica-loja/linhas-produtos', { codigo: 'PIC-CREMOSO', nome: 'Picolé Cremoso' });
    assert.equal(r.status, 201);
    ids.cremoso = r.body.linha.id;
    assert.equal(r.body.linha.ativo, 1);
    assert.deepEqual(r.body.linha.produtos, []);
    assert.equal((await api('POST', '/fabrica-loja/linhas-produtos', { nome: ' picolé cremoso ' })).status, 409);
    assert.equal((await api('POST', '/fabrica-loja/linhas-produtos', { codigo: 'PIC-CREMOSO', nome: 'Outra' })).status, 409);
    assert.equal((await api('POST', '/fabrica-loja/linhas-produtos', { codigo: 'X' })).status, 400);
    const zero = await api('POST', '/fabrica-loja/linhas-produtos', { codigo: '0042', nome: 'Fruta ao Leite' });
    assert.equal(zero.status, 201);
    ids.frutaLeite = zero.body.linha.id;
    assert.equal(zero.body.linha.codigo, '0042');
    assert.equal((await api('POST', '/fabrica-loja/linhas-produtos', { codigo: '42', nome: 'Outra 42' })).status, 201);
  });

  it('2. edita linha', async () => {
    const r = await api('PUT', `/fabrica-loja/linhas-produtos/${ids.frutaLeite}`, { codigo: 'PIC-FRUTA-LEITE', nome: 'Fruta ao Leite', descricao: 'Sabores ao leite' });
    assert.equal(r.status, 200);
    assert.equal(r.body.linha.codigo, 'PIC-FRUTA-LEITE');
    assert.equal(r.body.linha.descricao, 'Sabores ao leite');
  });

  it('3. inativa e reativa linha; linha inativa não recebe novo vínculo', async () => {
    const r = await api('POST', `/fabrica-loja/linhas-produtos/${ids.frutaLeite}/desativar`);
    assert.equal(r.body.linha.ativo, 0);
    const ativas = await api('GET', '/fabrica-loja/linhas-produtos');
    assert.ok(!ativas.body.linhas.some((l) => l.id === ids.frutaLeite));
    const todas = await api('GET', '/fabrica-loja/linhas-produtos?incluir_inativas=1');
    assert.ok(todas.body.linhas.some((l) => l.id === ids.frutaLeite));
    const vinculo = await api('PUT', `/produtos/${ids.sorveteKg}`, { linha_produtos_id: ids.frutaLeite });
    assert.equal(vinculo.status, 400);
    assert.equal(await linhaDoProduto(ids.sorveteKg), null);
    assert.equal((await api('POST', `/fabrica-loja/linhas-produtos/${ids.frutaLeite}/ativar`)).body.linha.ativo, 1);
  });

  it('4. associa produto pelo cadastro do produto (produto_id), sem reativar', async () => {
    const r = await api('PUT', `/produtos/${ids.saborInativo}`, { linha_produtos_id: ids.cremoso });
    assert.equal(r.status, 200);
    assert.equal(Number(r.body.linha_produtos_id), ids.cremoso);
    const produto = await get('SELECT ativo FROM produtos WHERE id = ?', [ids.saborInativo]);
    assert.equal(produto.ativo, 0);
  });

  it('5. remove produto da linha', async () => {
    await api('PUT', `/produtos/${ids.saborAtivo}`, { linha_produtos_id: ids.cremoso });
    assert.equal(await linhaDoProduto(ids.saborAtivo), ids.cremoso);
    const r = await api('PUT', `/produtos/${ids.saborAtivo}`, { linha_produtos_id: null });
    assert.equal(r.status, 200);
    assert.equal(await linhaDoProduto(ids.saborAtivo), null);
  });

  it('6. produto sem linha é válido, inclusive PRODUZIDO; editar outro campo não apaga o vínculo', async () => {
    const criado = await api('POST', '/produtos', { codigo: 'SORV-KG2', nome: 'Sorvete KG 2', unidade: 'kg', preco_venda: 40, natureza_cadastro: 'PRODUZIDO' });
    assert.equal(criado.status, 200);
    assert.equal(criado.body.linha_produtos_id, null);
    assert.equal(criado.body.natureza_cadastro, 'PRODUZIDO');
    await api('PUT', `/produtos/${ids.saborAtivo}`, { linha_produtos_id: ids.cremoso });
    await api('PUT', `/produtos/${ids.saborAtivo}`, { observacoes: 'sem mudança de linha' });
    assert.equal(await linhaDoProduto(ids.saborAtivo), ids.cremoso);
  });

  it('7. vários produtos na mesma linha', async () => {
    const r = await api('GET', `/fabrica-loja/linhas-produtos/${ids.cremoso}`);
    assert.deepEqual(r.body.linha.produtos.map((p) => p.id).sort(), [ids.saborInativo, ids.saborAtivo].sort());
    assert.equal(r.body.linha.quantidade_produtos, 2);
    assert.equal(r.body.linha.quantidade_produtos_ativos, 1);
  });

  it('8. produto pertence a uma só linha: trocar move o vínculo', async () => {
    await api('PUT', `/produtos/${ids.saborAtivo}`, { linha_produtos_id: ids.frutaLeite });
    const cremoso = await api('GET', `/fabrica-loja/linhas-produtos/${ids.cremoso}`);
    const fruta = await api('GET', `/fabrica-loja/linhas-produtos/${ids.frutaLeite}`);
    assert.ok(!cremoso.body.linha.produtos.some((p) => p.id === ids.saborAtivo));
    assert.ok(fruta.body.linha.produtos.some((p) => p.id === ids.saborAtivo));
    await api('PUT', `/produtos/${ids.saborAtivo}`, { linha_produtos_id: ids.cremoso });
  });

  it('9. não exclui linha com produtos; exclui linha vazia', async () => {
    const r = await api('DELETE', `/fabrica-loja/linhas-produtos/${ids.cremoso}`);
    assert.equal(r.status, 409);
    assert.equal(r.body.codigo, 'LINHA_EM_USO');
    const vazia = await api('POST', '/fabrica-loja/linhas-produtos', { nome: 'Linha Vazia' });
    assert.equal((await api('DELETE', `/fabrica-loja/linhas-produtos/${vazia.body.linha.id}`)).status, 200);
  });

  it('10. linha não possui estoque e vínculos não movimentam estoque', async () => {
    const cols = (await all('PRAGMA table_info(linhas_produtos)')).map((c) => c.name);
    assert.ok(!cols.some((c) => /estoque|saldo|preco|produto_id/i.test(c)));
    assert.equal((await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q, movimentosAntes);
    const depois = (await saldos()).filter((p) => saldosAntes.some((a) => a.id === p.id));
    assert.deepEqual(depois, saldosAntes);
  });

  it('11. linha não é aceita como produto de OP', async () => {
    await assert.rejects(
      salvarOrdem(db, { origem: 'MANUAL', itens: [{ linha_produtos_id: ids.cremoso, quantidade_planejada: 10 }] }, null, {}),
      (e) => e.code === 'PRODUTO_OBRIGATORIO'
    );
    const itensOp = (await all('PRAGMA table_info(ordem_producao_itens)')).map((c) => c.name);
    assert.ok(!itensOp.includes('linha_produtos_id'));
  });

  it('12. Linha de Produtos não interfere na Linha de Precificação', async () => {
    assert.deepEqual(await all('SELECT * FROM linhas_comerciais ORDER BY id'), precificacaoAntes);
    const sabor = await get('SELECT linha_comercial_id, linha_produtos_id FROM produtos WHERE id = ?', [ids.saborAtivo]);
    assert.equal(sabor.linha_comercial_id, ids.linhaPrecificacao);
    assert.equal(sabor.linha_produtos_id, ids.cremoso);
  });

  it('13. resolver de preço continua idêntico', async () => {
    const Resolver = require('../../backend/modules/comercial/preco/ComercialPrecoResolver');
    for (const id of [ids.saborAtivo, ids.sorveteKg]) {
      const produto = await get('SELECT * FROM produtos WHERE id = ?', [id]);
      const r = await Resolver.resolver({ produto, canal: 'VAREJO' });
      assert.deepEqual({ preco: r.preco, origem: r.origem }, precosAntes[id]);
    }
    const fonte = fs.readFileSync(path.join(__dirname, '../../backend/modules/comercial/preco/ComercialPrecoResolver.js'), 'utf8');
    assert.ok(!/linha_produtos|linhas_produtos/.test(fonte));
  });

  it('14. PDV continua listando o produto com linha (vende o produto, não a linha)', async () => {
    const lista = await api('GET', '/produtos?modo_fiscal=0&contexto=pdv');
    assert.equal(lista.status, 200);
    const idsPdv = lista.body.map((p) => p.id);
    assert.ok(idsPdv.includes(ids.saborAtivo));
    const inativo = lista.body.find((p) => p.id === ids.saborInativo);
    assert.ok(!inativo || Number(inativo.ativo) === 0);
    const busca = await api('GET', '/produtos/consulta-pdv/buscar?q=SAB-MOR&modo_fiscal=0');
    assert.ok(busca.body.some((p) => p.id === ids.saborAtivo));
  });

  it('15. INSUMO não recebe linha e não aparece como produto comercial', async () => {
    const put = await api('PUT', `/produtos/${ids.insumo}`, { linha_produtos_id: ids.cremoso });
    assert.equal(put.status, 400);
    assert.equal(await linhaDoProduto(ids.insumo), null);
    const post = await api('POST', '/produtos', { codigo: 'INS-ACUCAR', nome: 'Açúcar', unidade: 'kg', preco_venda: 0, natureza_cadastro: 'INSUMO', linha_produtos_id: ids.cremoso });
    assert.equal(post.status, 400);
    assert.equal(await get("SELECT id FROM produtos WHERE codigo = 'INS-ACUCAR'"), null);
    const virar = await api('PUT', `/produtos/${ids.saborAtivo}`, { natureza_cadastro: 'INSUMO' });
    assert.equal(virar.status, 400);
    await run('UPDATE produtos SET linha_produtos_id = ? WHERE id = ?', [ids.cremoso, ids.insumo]);
    const linha = await api('GET', `/fabrica-loja/linhas-produtos/${ids.cremoso}`);
    assert.ok(!linha.body.linha.produtos.some((p) => p.id === ids.insumo));
    await run('UPDATE produtos SET linha_produtos_id = NULL WHERE id = ?', [ids.insumo]);
    const pdv = await api('GET', '/produtos?modo_fiscal=0&contexto=pdv');
    assert.ok(!pdv.body.some((p) => p.id === ids.insumo));
  });

  it('16. produto PRODUZIDO com linha continua disponível para a Fábrica', async () => {
    const produtos = await listarProdutosProduzidos(db, 'Morango');
    assert.ok(produtos.some((p) => p.id === ids.saborAtivo));
    const ordem = await salvarOrdem(db, { origem: 'MANUAL', itens: [{ produto_id: ids.saborAtivo, quantidade_planejada: 10, unidade: 'UN' }] }, null, {});
    assert.equal(ordem.itens[0].produto_id, ids.saborAtivo);
  });
});

describe('Linha de Produtos — banco sem a estrutura', () => {
  let semEstrutura;

  before(async () => {
    semEstrutura = new sqlite3.Database(':memory:');
    await new Promise((resolve, reject) => semEstrutura.run('CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT, natureza_cadastro TEXT)', (e) => (e ? reject(e) : resolve())));
  });

  after(() => semEstrutura.close());

  it('lista vazia, não cria tabela, ignora "Sem Linha" e recusa vínculo', async () => {
    assert.deepEqual(await LinhaProdutos.listarLinhasProdutos(semEstrutura), { instalada: false, linhas: [] });
    assert.equal(await LinhaProdutos.validarLinhaProdutosInformada(semEstrutura, { linha_produtos_id: null }, null), undefined);
    await assert.rejects(LinhaProdutos.validarLinhaProdutosInformada(semEstrutura, { linha_produtos_id: 1 }, null), (e) => e.code === 'ESTRUTURA_NAO_INSTALADA');
    await assert.rejects(LinhaProdutos.criarLinhaProdutos(semEstrutura, { nome: 'X' }), (e) => e.code === 'ESTRUTURA_NAO_INSTALADA');
    assert.equal(await LinhaProdutos.estruturaInstalada(semEstrutura), false);
  });
});
