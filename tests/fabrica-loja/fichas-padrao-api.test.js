'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const temporario = path.resolve(os.tmpdir()).toLowerCase();
const diretorioBanco = path.resolve(String(process.env.DB_DIR || '')).toLowerCase();
if (!process.env.DB_DIR || !diretorioBanco.startsWith(temporario)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/fabrica-loja/fichas-padrao-api.test.js');
  process.exit(1);
}
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(process.env.DB_DIR, `mercadao.db${sufixo}`), { force: true });
}

const db = require('../../backend/database');
const FabricaLoja = require('../../backend/modules/fabrica-loja');
const bootstrapFichasPadrao = require('../../backend/modules/fabrica-loja/migrations/012_fichas_tecnicas_padrao');
const bootstrapMultiplosVinculos = require('../../backend/modules/fabrica-loja/migrations/014_multiplos_vinculos_produto');
const bootstrapFichaPadraoSemProduto = require('../../backend/modules/fabrica-loja/migrations/015_fichas_padrao_no_produto');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function produto(codigo, nome, unidade, natureza) {
  const resultado = await run(`
    INSERT INTO produtos (
      codigo, nome, unidade, preco_venda, preco_compra, saldo_fiscal,
      saldo_nao_fiscal, estoque_atual, ativo, natureza_cadastro
    ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 1, ?)
  `, [codigo, nome, unidade, natureza]);
  return resultado.id;
}

let servidor;
let apiBase;
let servidorProtegido;
let apiProtegida;
const ids = {};

async function requisitar(metodo, rota, body) {
  const resposta = await fetch(`${apiBase}${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: resposta.status, body: await resposta.json() };
}

describe('Persistência e API de fichas padrão', () => {
  before(async () => {
    assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(temporario), `banco fora do temporário: ${db.dbPath}`);
    await new Promise((resolve) => db.whenReady(resolve));
    await FabricaLoja.bootstrapFabricaLojaSchema(db);
    await bootstrapFichasPadrao(db);

    ids.leite = await produto('FT-PAD-INS-1', 'Leite em pó', 'UN', 'INSUMO');
    ids.acucar = await produto('FT-PAD-INS-2', 'Açúcar', 'UN', 'INSUMO');
    ids.baunilha = await produto('FT-PAD-INS-3', 'Baunilha', 'UN', 'INSUMO');
    ids.morango = await produto('FT-PAD-INS-4', 'Morango', 'UN', 'INSUMO');
    ids.produtoA = await produto('FT-PAD-PROD-1', 'Picolé A', 'UN', 'PRODUZIDO');
    ids.produtoB = await produto('FT-PAD-PROD-2', 'Picolé B', 'UN', 'PRODUZIDO');

    ids.fichaLegada = (await FabricaLoja.salvarFicha(db, {
      codigo: 'FT-LEG-PAD-01',
      nome: 'Ficha legada preservada',
      rendimento_quantidade: 1,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: ids.leite, quantidade: 1, unidade: 'UN' }]
    })).id;

    const app = express();
    app.use(express.json());
    app.use('/api/fabrica-loja', require('../../backend/rotas/fabrica-loja'));
    servidor = http.createServer(app);
    await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    apiBase = `http://127.0.0.1:${servidor.address().port}/api`;

    const appProtegido = express();
    appProtegido.use(
      '/api/fabrica-loja',
      require('../../backend/middleware/auth').verificarToken,
      require('../../backend/rotas/fabrica-loja')
    );
    servidorProtegido = http.createServer(appProtegido);
    await new Promise((resolve) => servidorProtegido.listen(0, '127.0.0.1', resolve));
    apiProtegida = `http://127.0.0.1:${servidorProtegido.address().port}/api`;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (servidorProtegido) await new Promise((resolve) => servidorProtegido.close(resolve));
    await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
  });

  it('mantém a API inacessível sem token pelo middleware padrão', async () => {
    const resposta = await fetch(`${apiProtegida}/fabrica-loja/fichas-padrao`);
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).error, 'Acesso negado');
    const vinculoTradicional = await fetch(
      `${apiProtegida}/fabrica-loja/fichas/${ids.fichaLegada}/produto`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: ids.produtoA })
      }
    );
    assert.equal(vinculoTradicional.status, 401);
  });

  it('aplica a migração repetidamente e mantém fichas antigas intactas', async () => {
    const antes = await get('SELECT COUNT(*) AS total FROM fichas_tecnicas');
    await bootstrapFichasPadrao(db);
    await run('DROP INDEX IF EXISTS idx_fichas_tecnicas_padrao_vinculos_produto_ficha_ativo');
    await run(`
      CREATE UNIQUE INDEX idx_fichas_tecnicas_padrao_vinculos_produto_ativo
      ON fichas_tecnicas_padrao_vinculos(produto_id) WHERE ativo = 1
    `);
    const indiceAnterior = await get(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_fichas_tecnicas_padrao_vinculos_produto_ativo'
    `);
    assert.ok(indiceAnterior, 'o schema legado deve começar com unicidade por produto');
    await bootstrapMultiplosVinculos(db);
    await bootstrapMultiplosVinculos(db);
    await FabricaLoja.listarFichasPadrao(db);
    const depois = await get('SELECT COUNT(*) AS total FROM fichas_tecnicas');
    assert.equal(depois.total, antes.total);
    const indiceComposto = await get(`
      SELECT sql FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_fichas_tecnicas_padrao_vinculos_produto_ficha_ativo'
    `);
    assert.match(indiceComposto.sql, /produto_id,\s*ficha_padrao_id/);
    assert.equal((await get(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_fichas_tecnicas_padrao_vinculos_produto_ativo'
    `)), null);
    assert.equal((await FabricaLoja.obterFicha(db, ids.fichaLegada)).id, ids.fichaLegada);
    const tabelas = await get(`
      SELECT COUNT(*) AS total FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'fichas_tecnicas_padrao_%'
    `);
    assert.ok(tabelas.total >= 7);
  });

  it('vincula ficha tradicional diretamente ao produto, sem convertê-la em ficha padrão', async () => {
    ids.produtoC = await produto('FT-PAD-PROD-3', 'Picolé C', 'UN', 'PRODUZIDO');
    ids.produtoD = await produto('FT-PAD-PROD-4', 'Picolé D', 'UN', 'PRODUZIDO');
    ids.fichaTradicional = (await FabricaLoja.salvarFicha(db, {
      codigo: 'FT-0001',
      nome: 'LINHA CREMOSA',
      rendimento_quantidade: 12,
      rendimento_unidade: 'UN',
      observacoes: 'Receita tradicional preservada',
      componentes: [
        { produto_id: ids.leite, quantidade: 1.5, unidade: 'UN', observacao: 'Leite integral' },
        { produto_id: ids.acucar, quantidade: 0.75, unidade: 'UN' }
      ],
      etapas: [{
        titulo: 'Homogeneizar',
        descricao: 'Misturar até ficar uniforme',
        tempo_minutos: 7,
        observacao: 'Não aquecer'
      }],
      informacoes: [{ titulo: 'Temperatura', valor: '4 C' }]
    })).id;
    const origemAntes = await FabricaLoja.obterFicha(db, ids.fichaTradicional);
    const vinculada = await requisitar('POST', `/fabrica-loja/fichas/${ids.fichaTradicional}/produto`, {
      produto_id: ids.produtoC
    });
    const repetida = await requisitar('POST', `/fabrica-loja/fichas/${ids.fichaTradicional}/produto`, {
      produto_id: ids.produtoC
    });
    assert.equal(vinculada.status, 200, JSON.stringify(vinculada.body));
    assert.equal(repetida.status, 200, JSON.stringify(repetida.body));
    assert.equal(repetida.body.ficha.id, ids.fichaTradicional);
    assert.equal(repetida.body.ficha.produto_id, ids.produtoC);
    await bootstrapFichaPadraoSemProduto(db);
    await bootstrapFichaPadraoSemProduto(db);
    assert.equal((await FabricaLoja.obterFicha(db, ids.fichaTradicional)).produto_id, ids.produtoC);
    const outroProduto = await requisitar('POST', `/fabrica-loja/fichas/${ids.fichaTradicional}/produto`, {
      produto_id: ids.produtoD
    });
    assert.equal(outroProduto.status, 409);
    assert.equal(outroProduto.body.codigo, 'FICHA_VINCULADA_OUTRO_PRODUTO');

    const tradicionaisProdutoC = await requisitar('GET', `/fabrica-loja/fichas/produtos/${ids.produtoC}/tradicionais`);
    assert.equal(tradicionaisProdutoC.status, 200);
    assert.deepEqual(tradicionaisProdutoC.body.fichas.map((item) => item.id), [ids.fichaTradicional]);
    const buscaTradicional = await requisitar('GET', '/fabrica-loja/fichas?busca=FT-0001');
    assert.ok(buscaTradicional.body.fichas.some((item) => item.id === ids.fichaTradicional));
    const naoConvertida = await requisitar('GET', '/fabrica-loja/fichas-padrao?busca=FT-0001');
    assert.equal(naoConvertida.body.fichas.some((item) => item.codigo === 'FT-0001'), false);

    const fichaPadrao = (await requisitar('POST', '/fabrica-loja/fichas-padrao', {
      codigo: 'FT-PAD-LINHA-CREMOSA',
      nome: 'Base independente da linha cremosa',
      rendimento_quantidade: 12,
      rendimento_unidade: 'UN',
      componentes: [
        { produto_id: ids.leite, quantidade: 1.5, unidade: 'UN' },
        { produto_id: ids.acucar, quantidade: 0.75, unidade: 'UN' }
      ],
      etapas: [{ titulo: 'Homogeneizar', tempo_minutos: 7 }]
    })).body.ficha;
    assert.equal(fichaPadrao.codigo, 'FT-PAD-LINHA-CREMOSA');
    assert.equal(Object.prototype.hasOwnProperty.call(fichaPadrao, 'ficha_tradicional_id'), false);
    ids.versaoImportada = fichaPadrao.versoes[0].id;
    const publicacao = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${fichaPadrao.id}/versoes/${ids.versaoImportada}/publicar`
    );
    assert.equal(publicacao.status, 200, JSON.stringify(publicacao.body));

    const vinculoC = await requisitar('POST', `/fabrica-loja/fichas-padrao/${fichaPadrao.id}/vinculos`, {
      produto_id: ids.produtoC,
      versao_id: ids.versaoImportada
    });
    const vinculoD = await requisitar('POST', `/fabrica-loja/fichas-padrao/${fichaPadrao.id}/vinculos`, {
      produto_id: ids.produtoD,
      versao_id: ids.versaoImportada
    });
    assert.equal(vinculoC.status, 201, JSON.stringify(vinculoC.body));
    assert.equal(vinculoD.status, 201, JSON.stringify(vinculoD.body));
    const fichasVinculadas = await requisitar('GET', `/fabrica-loja/fichas/produtos/${ids.produtoC}/vinculos`);
    assert.equal(fichasVinculadas.status, 200);
    assert.deepEqual(fichasVinculadas.body.fichas.map((item) => item.origem).sort(), ['PADRAO', 'TRADICIONAL']);
    assert.equal(fichasVinculadas.body.fichas.find((item) => item.origem === 'TRADICIONAL').ficha_tecnica_id, ids.fichaTradicional);
    assert.equal(fichasVinculadas.body.fichas.find((item) => item.origem === 'PADRAO').ficha_padrao_vinculo_id, vinculoC.body.vinculo.id);
    const ajusteC = await requisitar('POST', `/fabrica-loja/fichas-padrao/vinculos/${vinculoC.body.vinculo.id}/ajustes`, {
      componente_base_id: ids.acucar,
      operacao: 'HERDAR'
    });
    const ajusteD = await requisitar('POST', `/fabrica-loja/fichas-padrao/vinculos/${vinculoD.body.vinculo.id}/ajustes`, {
      componente_base_id: ids.leite,
      operacao: 'SUBSTITUIR',
      quantidade: 8,
      unidade: 'UN'
    });
    assert.equal(ajusteC.status, 201, JSON.stringify(ajusteC.body));
    assert.equal(ajusteD.status, 201, JSON.stringify(ajusteD.body));
    assert.deepEqual(
      (await requisitar('GET', `/fabrica-loja/fichas-padrao/vinculos/${vinculoC.body.vinculo.id}/ajustes`))
        .body.ajustes.map((item) => item.operacao),
      ['HERDAR']
    );
    assert.deepEqual(
      (await requisitar('GET', `/fabrica-loja/fichas-padrao/vinculos/${vinculoD.body.vinculo.id}/ajustes`))
        .body.ajustes.map((item) => item.operacao),
      ['SUBSTITUIR']
    );
    assert.equal((await FabricaLoja.obterFicha(db, ids.fichaTradicional)).componentes.length, origemAntes.componentes.length);
    assert.equal((await requisitar('DELETE', `/fabrica-loja/fichas/${ids.fichaTradicional}/produto/${ids.produtoC}`)).body.removido, true);
    const origemDepois = await FabricaLoja.obterFicha(db, ids.fichaTradicional);
    assert.deepEqual({ ...origemDepois, updated_at: origemAntes.updated_at }, origemAntes);

    const buscaProduzido = await requisitar('GET', '/fabrica-loja/produtos-produzidos?q=Leite');
    assert.deepEqual(buscaProduzido.body.produtos, []);
    const unidadeInvalidaSabor = await requisitar('POST', '/fabrica-loja/fichas-sabor', {
      codigo: 'SAB-API-UNIDADE-INVALIDA',
      nome: 'Morango com unidade inválida',
      produto_id: ids.produtoA,
      ficha_tradicional_id: ids.fichaTradicional,
      componentes: [{ produto_id: ids.leite, quantidade: 1, unidade: 'UNIDADE-SEM-CONVERSAO' }]
    });
    assert.equal(unidadeInvalidaSabor.status, 422);
    assert.match(unidadeInvalidaSabor.body.error, /UNIDADE-SEM-CONVERSAO/);
    assert.match(unidadeInvalidaSabor.body.error, /Leite em pó/);
    assert.equal(unidadeInvalidaSabor.body.detalhes.produto_id, ids.leite);
    assert.equal((await get(
      "SELECT COUNT(*) AS total FROM fichas_tecnicas_padrao WHERE codigo = 'SAB-API-UNIDADE-INVALIDA'"
    )).total, 0);
    const semProdutoAssociado = await requisitar('POST', '/fabrica-loja/fichas-sabor', {
      codigo: 'SAB-API-SEM-PRODUTO',
      nome: 'Morango sem produto',
      ficha_tradicional_id: ids.fichaTradicional
    });
    assert.equal(semProdutoAssociado.status, 400);
    const produtoInsumo = await requisitar('POST', '/fabrica-loja/fichas-sabor', {
      codigo: 'SAB-API-INSUMO',
      nome: 'Morango com insumo',
      produto_id: ids.leite,
      ficha_tradicional_id: ids.fichaTradicional
    });
    assert.equal(produtoInsumo.status, 400);

    const criadaPorSabor = await requisitar('POST', '/fabrica-loja/fichas-sabor', {
      codigo: 'SAB-API-MORANGO',
      nome: 'Morango API',
      produto_id: ids.produtoA,
      ficha_tradicional_id: ids.fichaTradicional
    });
    assert.equal(criadaPorSabor.status, 201, JSON.stringify(criadaPorSabor.body));
    const fichaSabor = criadaPorSabor.body.ficha;
    assert.equal(fichaSabor.tipo, 'SABOR');
    assert.equal(fichaSabor.ficha_tradicional_id, ids.fichaTradicional);
    assert.equal(fichaSabor.versoes[0].componentes.length, origemDepois.componentes.length);
    assert.equal(fichaSabor.versoes[0].etapas.length, origemDepois.etapas.length);
    assert.equal(fichaSabor.versoes[0].informacoes.length, origemDepois.informacoes.length);
    assert.equal(fichaSabor.vinculos.length, 1);
    assert.equal(fichaSabor.vinculos[0].produto_id, ids.produtoA);
    assert.equal(fichaSabor.vinculos[0].produto_codigo, 'FT-PAD-PROD-1');
    assert.equal(fichaSabor.vinculos[0].versao_id, fichaSabor.versoes[0].id);
    await assert.rejects(
      () => FabricaLoja.obterSnapshotVinculoProduto(
        db,
        fichaSabor.vinculos[0].id,
        ids.produtoA,
        fichaSabor.versoes[0].id
      ),
      (err) => err.code === 'VERSAO_NAO_PUBLICADA'
    );
    const fichasPadraoLista = await requisitar('GET', '/fabrica-loja/fichas-padrao?busca=Morango%20API');
    assert.equal(fichasPadraoLista.body.fichas.find((item) => item.id === fichaSabor.id).tipo, 'SABOR');
    const fichaSaborLista = await requisitar('GET', '/fabrica-loja/fichas-sabor?busca=Morango%20API');
    assert.equal(fichaSaborLista.status, 200);
    assert.ok(fichaSaborLista.body.fichas.some((item) => item.id === fichaSabor.id && item.tipo === 'SABOR'));
    const fichaSaborDetalhe = await requisitar('GET', `/fabrica-loja/fichas-sabor/${fichaSabor.id}`);
    assert.equal(fichaSaborDetalhe.body.ficha.ficha_tradicional.nome, 'LINHA CREMOSA');
    assert.equal(fichaSaborDetalhe.body.ficha.vinculos[0].produto_id, ids.produtoA);
    assert.equal(fichaSaborDetalhe.body.ficha.vinculos[0].produto_codigo, 'FT-PAD-PROD-1');

    const versaoSaborId = fichaSabor.versoes[0].id;
    const publicadaSabor = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${fichaSabor.id}/versoes/${versaoSaborId}/publicar`
    );
    assert.equal(publicadaSabor.status, 200, JSON.stringify(publicadaSabor.body));
    const fichasProdutoSabor = await requisitar('GET', `/fabrica-loja/fichas/produtos/${ids.produtoA}/vinculos`);
    const vinculoProdutoSabor = fichasProdutoSabor.body.fichas.find((item) => item.origem === 'PADRAO');
    assert.equal(vinculoProdutoSabor.ficha_padrao_vinculo_id, fichaSabor.vinculos[0].id);
    const snapshotProdutoSabor = await FabricaLoja.obterSnapshotVinculoProduto(
      db,
      fichaSabor.vinculos[0].id,
      ids.produtoA,
      versaoSaborId
    );
    assert.equal(snapshotProdutoSabor.ficha_padrao_snapshot.ficha_padrao_versao_id, versaoSaborId);
    const vinculoSabor = await requisitar('POST', `/fabrica-loja/fichas-padrao/${fichaSabor.id}/vinculos`, {
      produto_id: ids.produtoD,
      versao_id: versaoSaborId
    });
    assert.equal(vinculoSabor.status, 201, JSON.stringify(vinculoSabor.body));
    const snapshotSabor = await FabricaLoja.obterSnapshotVinculoProduto(
      db,
      vinculoSabor.body.vinculo.id,
      ids.produtoD,
      versaoSaborId
    );
    assert.equal(snapshotSabor.ficha_padrao_snapshot.ficha_por_sabor.ficha_tradicional_id, ids.fichaTradicional);
    assert.equal(snapshotSabor.ficha_padrao_snapshot.etapas.length, origemDepois.etapas.length);

    await FabricaLoja.salvarFicha(db, {
      ...origemDepois,
      componentes: origemDepois.componentes.map((item, indice) => ({
        produto_id: item.produto_id,
        quantidade: indice === 0 ? item.quantidade + 1 : item.quantidade,
        unidade: item.unidade,
        observacao: item.observacao
      }))
    }, ids.fichaTradicional);
    const revisoesDisponiveis = await requisitar('GET', '/fabrica-loja/fichas-sabor');
    assert.equal(revisoesDisponiveis.body.fichas.find((item) => item.id === fichaSabor.id).atualizacao_origem_disponivel, true);
    const revisaoOrigem = await requisitar('POST', `/fabrica-loja/fichas-sabor/${fichaSabor.id}/revisar-origem`, {});
    assert.equal(revisaoOrigem.status, 201, JSON.stringify(revisaoOrigem.body));
    assert.equal(revisaoOrigem.body.versao.estado, 'EM_EDICAO');
    assert.ok(revisaoOrigem.body.versao.ficha_tradicional_snapshot_anterior);
  });

  it('rejeita vínculo tradicional com produto incompatível sem alterar a ficha', async () => {
    const ficha = await FabricaLoja.salvarFicha(db, {
      codigo: 'FT-SEM-COMPONENTE',
      nome: 'Ficha sem componentes',
      componentes: []
    });
    const resposta = await requisitar('POST', `/fabrica-loja/fichas/${ficha.id}/produto`, {
      produto_id: ids.leite
    });
    assert.equal(resposta.status, 400, JSON.stringify(resposta.body));
    assert.equal(resposta.body.codigo, 'PRODUTO_NAO_PRODUZIDO');
    assert.equal((await FabricaLoja.obterFicha(db, ficha.id)).produto_id, null);
  });

  it('cria, consulta e publica uma versão, protegendo seu conteúdo contra alterações', async () => {
    const criada = await requisitar('POST', '/fabrica-loja/fichas-padrao', {
      codigo: 'FT-PAD-BASE-01',
      nome: 'Base cremosa',
      rendimento_quantidade: 100,
      rendimento_unidade: 'UN',
      componentes: [
        { produto_id: ids.leite, quantidade: 10, unidade: 'UN' },
        { produto_id: ids.acucar, quantidade: 4, unidade: 'UN' },
        { produto_id: ids.baunilha, quantidade: 1, unidade: 'UN' }
      ],
      etapas: [{ titulo: 'Misturar', tempo_minutos: 5 }],
      informacoes: [{ titulo: 'Temperatura', valor: '4 C' }]
    });
    assert.equal(criada.status, 201, JSON.stringify(criada.body));
    assert.deepEqual(criada.body.ficha.vinculos, [], 'criar ficha padrão não associa produto implicitamente');
    ids.ficha = criada.body.ficha.id;
    ids.versao1 = criada.body.ficha.versoes[0].id;

    const consulta = await requisitar('GET', `/fabrica-loja/fichas-padrao/${ids.ficha}`);
    assert.equal(consulta.status, 200);
    assert.deepEqual(consulta.body.ficha.vinculos, [], 'ficha independente permanece sem vínculos ao ser recuperada');
    assert.equal(consulta.body.ficha.versoes[0].componentes.length, 3);
    assert.equal(consulta.body.ficha.versoes[0].etapas[0].titulo, 'Misturar');

    const publicada = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${ids.ficha}/versoes/${ids.versao1}/publicar`
    );
    assert.equal(publicada.status, 200, JSON.stringify(publicada.body));
    assert.equal(publicada.body.versao.estado, 'PUBLICADA');
    assert.equal((await get(`
      SELECT COUNT(*) AS total FROM fichas_tecnicas_padrao_vinculos
      WHERE ficha_padrao_id = ?
    `, [ids.ficha])).total, 0, 'publicar ficha não cria vínculo de produto');

    const edicaoPublicada = await requisitar(
      'PUT',
      `/fabrica-loja/fichas-padrao/${ids.ficha}/versoes/${ids.versao1}`,
      { rendimento_quantidade: 200, rendimento_unidade: 'UN', componentes: [] }
    );
    assert.equal(edicaoPublicada.status, 409);
    assert.equal(edicaoPublicada.body.codigo, 'VERSAO_IMUTAVEL');

    await assert.rejects(
      () => run(`UPDATE fichas_tecnicas_padrao_versoes SET observacoes = 'alterada' WHERE id = ?`, [ids.versao1]),
      /Versão publicada é imutável/
    );
    const ficha = await FabricaLoja.obterFichaPadrao(db, ids.ficha);
    assert.equal(ficha.versoes[0].componentes.length, 3);
  });

  it('persiste operações, rejeita duplicidade e atualiza produtos individualmente', async () => {
    const vinculoA = await requisitar('POST', `/fabrica-loja/fichas-padrao/${ids.ficha}/vinculos`, {
      produto_id: ids.produtoA,
      versao_id: ids.versao1
    });
    const vinculoB = await requisitar('POST', `/fabrica-loja/fichas-padrao/${ids.ficha}/vinculos`, {
      produto_id: ids.produtoB,
      versao_id: ids.versao1
    });
    assert.equal(vinculoA.status, 201, JSON.stringify(vinculoA.body));
    assert.equal(vinculoB.status, 201, JSON.stringify(vinculoB.body));
    assert.equal(await get(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_fichas_tecnicas_padrao_vinculos_produto_ativo'
    `), null, 'a garantia de schema não deve recriar a restrição legada');
    ids.vinculoA = vinculoA.body.vinculo.id;
    ids.vinculoB = vinculoB.body.vinculo.id;
    const vinculoDuplicado = await requisitar('POST', `/fabrica-loja/fichas-padrao/${ids.ficha}/vinculos`, {
      produto_id: ids.produtoA,
      versao_id: ids.versao1
    });
    assert.equal(vinculoDuplicado.status, 409);
    assert.equal(vinculoDuplicado.body.codigo, 'VINCULO_ATIVO_EXISTENTE');

    const fichaSecundaria = await requisitar('POST', '/fabrica-loja/fichas-padrao', {
      codigo: 'FT-PAD-SEC-01',
      nome: 'Base frutada',
      rendimento_quantidade: 100,
      rendimento_unidade: 'UN',
      componentes: [
        { produto_id: ids.leite, quantidade: 6, unidade: 'UN' },
        { produto_id: ids.morango, quantidade: 3, unidade: 'UN' }
      ]
    });
    assert.equal(fichaSecundaria.status, 201, JSON.stringify(fichaSecundaria.body));
    const fichaSecundariaId = fichaSecundaria.body.ficha.id;
    const versaoSecundariaId = fichaSecundaria.body.ficha.versoes[0].id;
    const publicarSecundaria = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${fichaSecundariaId}/versoes/${versaoSecundariaId}/publicar`
    );
    assert.equal(publicarSecundaria.status, 200, JSON.stringify(publicarSecundaria.body));
    const segundoVinculoMesmoProduto = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${fichaSecundariaId}/vinculos`,
      { produto_id: ids.produtoA, versao_id: versaoSecundariaId }
    );
    assert.equal(segundoVinculoMesmoProduto.status, 201, JSON.stringify(segundoVinculoMesmoProduto.body));
    const vinculadosSegundaFicha = await requisitar('GET', `/fabrica-loja/fichas-padrao/${fichaSecundariaId}/vinculos`);
    assert.ok(vinculadosSegundaFicha.body.vinculos.some((item) =>
      item.id === segundoVinculoMesmoProduto.body.vinculo.id && item.produto_id === ids.produtoA && item.ativo));
    const totalVinculosAntesReaplicar = await get(`
      SELECT COUNT(*) AS total FROM fichas_tecnicas_padrao_vinculos
      WHERE produto_id = ? AND ativo = 1
    `, [ids.produtoA]);
    await bootstrapMultiplosVinculos(db);
    const totalVinculosDepoisReaplicar = await get(`
      SELECT COUNT(*) AS total FROM fichas_tecnicas_padrao_vinculos
      WHERE produto_id = ? AND ativo = 1
    `, [ids.produtoA]);
    assert.equal(totalVinculosDepoisReaplicar.total, totalVinculosAntesReaplicar.total);
    const duplicadoDaSegundaFicha = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${fichaSecundariaId}/vinculos`,
      { produto_id: ids.produtoA, versao_id: versaoSecundariaId }
    );
    assert.equal(duplicadoDaSegundaFicha.status, 409, JSON.stringify(duplicadoDaSegundaFicha.body));
    assert.equal(duplicadoDaSegundaFicha.body.codigo, 'VINCULO_ATIVO_EXISTENTE');
    const ajusteSegundoVinculo = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/vinculos/${segundoVinculoMesmoProduto.body.vinculo.id}/ajustes`,
      { componente_base_id: ids.morango, operacao: 'HERDAR' }
    );
    assert.equal(ajusteSegundoVinculo.status, 201, JSON.stringify(ajusteSegundoVinculo.body));
    assert.equal((await FabricaLoja.listarAjustesFichaPadrao(db, ids.vinculoA)).length, 0);
    assert.equal((await FabricaLoja.listarAjustesFichaPadrao(db, segundoVinculoMesmoProduto.body.vinculo.id)).length, 1);
    const desativarSegundoVinculo = await requisitar(
      'PUT',
      `/fabrica-loja/fichas-padrao/vinculos/${segundoVinculoMesmoProduto.body.vinculo.id}`,
      { ativo: false }
    );
    assert.equal(desativarSegundoVinculo.status, 200);
    assert.equal(desativarSegundoVinculo.body.vinculo.ativo, false);
    assert.equal((await FabricaLoja.listarAjustesFichaPadrao(db, segundoVinculoMesmoProduto.body.vinculo.id)).length, 1);
    assert.ok((await FabricaLoja.obterFichaPadrao(db, fichaSecundariaId)).id === fichaSecundariaId);
    const vinculosFichaOriginal = await requisitar('GET', `/fabrica-loja/fichas-padrao/${ids.ficha}/vinculos`);
    assert.equal(vinculosFichaOriginal.body.vinculos.find((item) => item.id === ids.vinculoA).ativo, true);

    const regrasA = [
      { componente_base_id: ids.leite, operacao: 'SUBSTITUIR', quantidade: 12, unidade: 'UN' },
      { componente_base_id: ids.acucar, operacao: 'HERDAR' },
      { componente_base_id: ids.baunilha, operacao: 'REMOVER' },
      { produto_id: ids.morango, operacao: 'ADICIONAR', quantidade: 3, unidade: 'UN' }
    ];
    for (const regra of regrasA) {
      const resposta = await requisitar('POST', `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoA}/ajustes`, regra);
      assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
    }

    const regrasB = await requisitar('POST', `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoB}/ajustes`, {
      componente_base_id: ids.leite,
      operacao: 'SUBSTITUIR',
      quantidade: 8,
      unidade: 'UN'
    });
    assert.equal(regrasB.status, 201, JSON.stringify(regrasB.body));
    const duplicada = await requisitar('POST', `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoA}/ajustes`, {
      componente_base_id: ids.leite,
      operacao: 'HERDAR'
    });
    assert.equal(duplicada.status, 422);
    assert.equal(duplicada.body.codigo, 'REGRA_COMPONENTE_DUPLICADA');

    const ajustesA = await requisitar('GET', `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoA}/ajustes`);
    assert.deepEqual(
      ajustesA.body.ajustes.map((ajuste) => ajuste.operacao).sort(),
      ['ADICIONAR', 'HERDAR', 'REMOVER', 'SUBSTITUIR']
    );
    const regraMorango = ajustesA.body.ajustes.find((ajuste) => ajuste.operacao === 'ADICIONAR');
    const ajusteAtualizado = await requisitar(
      'PUT',
      `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoA}/ajustes/${regraMorango.id}`,
      { produto_id: ids.morango, operacao: 'ADICIONAR', quantidade: 4, unidade: 'UN' }
    );
    assert.equal(ajusteAtualizado.status, 200, JSON.stringify(ajusteAtualizado.body));
    assert.equal(ajusteAtualizado.body.ajuste.quantidade, 4);
    const ajusteRemovido = await requisitar(
      'DELETE',
      `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoA}/ajustes/${regraMorango.id}`
    );
    assert.equal(ajusteRemovido.status, 200, JSON.stringify(ajusteRemovido.body));
    assert.equal(
      (await FabricaLoja.listarAjustesFichaPadrao(db, ids.vinculoA)).some((item) => item.id === regraMorango.id),
      false
    );
    const snapshotComAjustesLegados = await FabricaLoja.obterSnapshotVinculoProduto(
      db,
      ids.vinculoA,
      ids.produtoA,
      ids.versao1
    );
    assert.deepEqual(
      snapshotComAjustesLegados.ficha_padrao_snapshot.componentes.map(({ produto_id, quantidade, unidade }) => ({
        produto_id,
        quantidade,
        unidade
      })),
      [
        { produto_id: ids.leite, quantidade: 10, unidade: 'UN' },
        { produto_id: ids.acucar, quantidade: 4, unidade: 'UN' },
        { produto_id: ids.baunilha, quantidade: 1, unidade: 'UN' }
      ],
      'novos snapshots usam a composição-base e ignoram os ajustes persistidos'
    );
    assert.equal((await FabricaLoja.listarAjustesFichaPadrao(db, ids.vinculoA)).length, 3);

    const v2Criada = await requisitar('POST', `/fabrica-loja/fichas-padrao/${ids.ficha}/versoes`);
    assert.equal(v2Criada.status, 201);
    ids.versao2 = v2Criada.body.versao.id;
    assert.equal(v2Criada.body.versao.numero_versao, 2);
    const v2Atualizada = await requisitar('PUT', `/fabrica-loja/fichas-padrao/${ids.ficha}/versoes/${ids.versao2}`, {
      rendimento_quantidade: 100,
      rendimento_unidade: 'UN',
      componentes: [
        { produto_id: ids.leite, quantidade: 15, unidade: 'UN' },
        { produto_id: ids.acucar, quantidade: 4, unidade: 'UN' }
      ]
    });
    assert.equal(v2Atualizada.status, 200, JSON.stringify(v2Atualizada.body));
    const v2Publicada = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${ids.ficha}/versoes/${ids.versao2}/publicar`
    );
    assert.equal(v2Publicada.status, 200, JSON.stringify(v2Publicada.body));
    const ajusteParaComponenteRemovido = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoB}/ajustes`,
      { componente_base_id: ids.baunilha, operacao: 'REMOVER' }
    );
    assert.equal(ajusteParaComponenteRemovido.status, 201, JSON.stringify(ajusteParaComponenteRemovido.body));

    const revisoes = await requisitar('GET', `/fabrica-loja/fichas-padrao/${ids.ficha}/atualizacoes`);
    assert.equal(revisoes.status, 200);
    const revisaoA = revisoes.body.atualizacoes.find((item) => item.vinculo_id === ids.vinculoA);
    const revisaoB = revisoes.body.atualizacoes.find((item) => item.vinculo_id === ids.vinculoB);
    assert.equal(revisaoA.estado, 'PENDENTE');
    assert.equal(revisaoB.estado, 'PENDENTE');

    const manteve = await requisitar('PUT', `/fabrica-loja/fichas-padrao/atualizacoes/${revisaoA.id}`, {
      decisao: 'MANTER_ANTERIOR',
      justificativa: 'Exceção individual aprovada'
    });
    const aprovou = await requisitar('PUT', `/fabrica-loja/fichas-padrao/atualizacoes/${revisaoB.id}`, {
      decisao: 'APROVAR',
      justificativa: 'Atualização validada'
    });
    assert.equal(manteve.status, 200, JSON.stringify(manteve.body));
    assert.equal(aprovou.status, 200, JSON.stringify(aprovou.body));
    assert.equal(manteve.body.revisao.estado, 'MANTER_ANTERIOR');
    assert.equal(aprovou.body.revisao.estado, 'APROVADO');

    const vinculos = await requisitar('GET', `/fabrica-loja/fichas-padrao/${ids.ficha}/vinculos`);
    const atualA = vinculos.body.vinculos.find((item) => item.id === ids.vinculoA);
    const atualB = vinculos.body.vinculos.find((item) => item.id === ids.vinculoB);
    assert.equal(atualA.versao_id, ids.versao1);
    assert.equal(atualB.versao_id, ids.versao2);
    const ajustesPersistidosB = await FabricaLoja.listarAjustesFichaPadrao(db, ids.vinculoB);
    assert.equal(ajustesPersistidosB.find((item) => item.operacao === 'SUBSTITUIR').quantidade, 8);
    assert.ok(ajustesPersistidosB.some((item) => item.operacao === 'REMOVER'));
    const snapshotAprovadoB = await FabricaLoja.obterSnapshotVinculoProduto(
      db,
      ids.vinculoB,
      ids.produtoB,
      ids.versao2
    );
    assert.deepEqual(
      snapshotAprovadoB.ficha_padrao_snapshot.componentes.map(({ produto_id, quantidade, unidade }) => ({
        produto_id,
        quantidade,
        unidade
      })),
      [
        { produto_id: ids.leite, quantidade: 15, unidade: 'UN' },
        { produto_id: ids.acucar, quantidade: 4, unidade: 'UN' }
      ]
    );

    const inativado = await requisitar('PUT', `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoA}`, { ativo: false });
    assert.equal(inativado.status, 200);
    const ajusteVinculoInativo = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoA}/ajustes`,
      { componente_base_id: ids.baunilha, operacao: 'HERDAR' }
    );
    assert.equal(ajusteVinculoInativo.status, 409);
    assert.equal(ajusteVinculoInativo.body.codigo, 'VINCULO_INATIVO');
    const reativado = await requisitar('PUT', `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoA}`, { ativo: true });
    assert.equal(reativado.status, 200);
    assert.equal((await FabricaLoja.obterFicha(db, ids.fichaLegada)).id, ids.fichaLegada);
  });

  it('permite inativar e excluir ficha padrão não associada a sabor somente quando não há vínculos', async () => {
    const inativada = await requisitar('PATCH', `/fabrica-loja/fichas-padrao/${ids.ficha}/status`, { ativa: false });
    assert.equal(inativada.status, 200);
    assert.equal(inativada.body.ficha.ativa, false);
    const reativada = await requisitar('PATCH', `/fabrica-loja/fichas-padrao/${ids.ficha}/status`, { ativa: true });
    assert.equal(reativada.status, 200);
    assert.equal(reativada.body.ficha.ativa, true);

    const vinculada = await requisitar('DELETE', `/fabrica-loja/fichas-padrao/${ids.ficha}`);
    assert.equal(vinculada.status, 409);
    assert.equal(vinculada.body.codigo, 'FICHA_PADRAO_VINCULADA');
    assert.equal((await FabricaLoja.obterFichaPadrao(db, ids.ficha)).id, ids.ficha);

    const criada = await requisitar('POST', '/fabrica-loja/fichas-padrao', {
      codigo: 'FT-PAD-EXCLUIR-01',
      nome: 'Ficha padrão sem vínculos',
      rendimento_quantidade: 1,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: ids.leite, quantidade: 1, unidade: 'UN' }]
    });
    assert.equal(criada.status, 201);
    const fichaSemVinculos = criada.body.ficha;
    const publicada = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${fichaSemVinculos.id}/versoes/${fichaSemVinculos.versoes[0].id}/publicar`
    );
    assert.equal(publicada.status, 200);

    const excluida = await requisitar('DELETE', `/fabrica-loja/fichas-padrao/${fichaSemVinculos.id}`);
    assert.equal(excluida.status, 200, JSON.stringify(excluida.body));
    assert.equal(excluida.body.removida, true);
    assert.equal((await requisitar('GET', `/fabrica-loja/fichas-padrao/${fichaSemVinculos.id}`)).status, 404);
  });

  it('exclui ficha por sabor com vínculos e histórico sem apagar os produtos', async () => {
    const produtoSabor = await produto('FT-PAD-PROD-EXCLUIR', 'Picolé para exclusão', 'UN', 'PRODUZIDO');
    const criada = await requisitar('POST', '/fabrica-loja/fichas-sabor', {
      codigo: 'SAB-API-EXCLUIR',
      nome: 'Sabor para exclusão',
      produto_id: produtoSabor,
      ficha_tradicional_id: ids.fichaTradicional
    });
    assert.equal(criada.status, 201, JSON.stringify(criada.body));

    const fichaSabor = criada.body.ficha;
    const vinculoOriginal = fichaSabor.vinculos[0];
    const publicadaV1 = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${fichaSabor.id}/versoes/${vinculoOriginal.versao_id}/publicar`
    );
    assert.equal(publicadaV1.status, 200, JSON.stringify(publicadaV1.body));
    const ajusteOriginal = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/vinculos/${vinculoOriginal.id}/ajustes`,
      { componente_base_id: ids.leite, operacao: 'HERDAR' }
    );
    assert.equal(ajusteOriginal.status, 201, JSON.stringify(ajusteOriginal.body));

    const novaVersao = await requisitar('POST', `/fabrica-loja/fichas-padrao/${fichaSabor.id}/versoes`);
    assert.equal(novaVersao.status, 201, JSON.stringify(novaVersao.body));
    const versao2 = novaVersao.body.versao;
    const atualizada = await requisitar(
      'PUT',
      `/fabrica-loja/fichas-padrao/${fichaSabor.id}/versoes/${versao2.id}`,
      {
        rendimento_quantidade: versao2.rendimento_quantidade,
        rendimento_unidade: versao2.rendimento_unidade,
        observacoes: versao2.observacoes,
        componentes: versao2.componentes,
        etapas: versao2.etapas,
        informacoes: versao2.informacoes
      }
    );
    assert.equal(atualizada.status, 200, JSON.stringify(atualizada.body));
    const publicadaV2 = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${fichaSabor.id}/versoes/${versao2.id}/publicar`
    );
    assert.equal(publicadaV2.status, 200, JSON.stringify(publicadaV2.body));

    const inativado = await requisitar(
      'PUT',
      `/fabrica-loja/fichas-padrao/vinculos/${vinculoOriginal.id}`,
      { ativo: false }
    );
    assert.equal(inativado.status, 200, JSON.stringify(inativado.body));
    const segundoVinculo = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/${fichaSabor.id}/vinculos`,
      { produto_id: produtoSabor, versao_id: versao2.id }
    );
    assert.equal(segundoVinculo.status, 201, JSON.stringify(segundoVinculo.body));
    const ajusteSegundoVinculo = await requisitar(
      'POST',
      `/fabrica-loja/fichas-padrao/vinculos/${segundoVinculo.body.vinculo.id}/ajustes`,
      { componente_base_id: ids.leite, operacao: 'HERDAR' }
    );
    assert.equal(ajusteSegundoVinculo.status, 201, JSON.stringify(ajusteSegundoVinculo.body));

    const revisoes = await get(
      'SELECT COUNT(*) AS total FROM fichas_tecnicas_padrao_revisoes WHERE ficha_padrao_id = ?',
      [fichaSabor.id]
    );
    assert.equal(revisoes.total, 1);
    const snapshotProducao = {
      ficha_padrao_id: fichaSabor.id,
      ficha_padrao_vinculo_id: vinculoOriginal.id,
      ficha_padrao_versao_id: vinculoOriginal.versao_id,
      componentes: [{ produto_id: ids.leite, quantidade: 1, unidade: 'UN' }]
    };
    const ordem = await run(`
      INSERT INTO ordens_producao (codigo, origem)
      VALUES ('OP-EXCLUSAO-FICHA-SABOR', 'MANUAL')
    `);
    await run(`
      INSERT INTO ordem_producao_itens (
        ordem_id, ordem, produto_id, produto_nome, quantidade_planejada, unidade,
        ficha_padrao_vinculo_id, ficha_padrao_versao_id, ficha_padrao_snapshot
      ) VALUES (?, 1, ?, 'Picolé para exclusão', 1, 'UN', ?, ?, ?)
    `, [
      ordem.id,
      produtoSabor,
      vinculoOriginal.id,
      vinculoOriginal.versao_id,
      JSON.stringify(snapshotProducao)
    ]);

    const excluida = await requisitar('DELETE', `/fabrica-loja/fichas-padrao/${fichaSabor.id}`);
    assert.equal(excluida.status, 200, JSON.stringify(excluida.body));
    assert.deepEqual(excluida.body.ficha.produtos_desvinculados, [produtoSabor]);
    assert.equal((await requisitar('GET', `/fabrica-loja/fichas-sabor/${fichaSabor.id}`)).status, 404);
    assert.equal((await get('SELECT id FROM produtos WHERE id = ?', [produtoSabor])).id, produtoSabor);
    const snapshotPersistido = await get(`
      SELECT ficha_padrao_snapshot
      FROM ordem_producao_itens
      WHERE ordem_id = ?
    `, [ordem.id]);
    assert.deepEqual(JSON.parse(snapshotPersistido.ficha_padrao_snapshot), snapshotProducao);
    for (const tabela of [
      'fichas_tecnicas_padrao_vinculos',
      'fichas_tecnicas_padrao_ajustes',
      'fichas_tecnicas_padrao_revisoes',
      'fichas_tecnicas_padrao_versoes'
    ]) {
      assert.equal(
        (await get(`SELECT COUNT(*) AS total FROM ${tabela} WHERE ficha_padrao_id = ?`, [fichaSabor.id])).total,
        0,
        `${tabela} deve ser limpa pela exclusão`
      );
    }
  });

  it('rejeita componentes, produtos e unidades inválidos sem publicação parcial', async () => {
    const semInsumo = await requisitar('POST', '/fabrica-loja/fichas-padrao', {
      codigo: 'FT-PAD-INVALIDA-1',
      nome: 'Componente inválido',
      rendimento_quantidade: 1,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: ids.produtoA, quantidade: 1, unidade: 'UN' }]
    });
    assert.equal(semInsumo.status, 400);
    assert.equal(semInsumo.body.codigo, 'PRODUTO_NAO_INSUMO');

    const unidadeDesconhecida = await requisitar('POST', '/fabrica-loja/fichas-padrao', {
      codigo: 'FT-PAD-INVALIDA-2',
      nome: 'Unidade não comprovada',
      rendimento_quantidade: 1,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: ids.leite, quantidade: 1, unidade: 'UNIDADE-SEM-CONVERSAO' }]
    });
    assert.equal(unidadeDesconhecida.status, 422);
    assert.equal(unidadeDesconhecida.body.codigo, 'UNIDADE_NAO_COMPROVADA');
    assert.match(unidadeDesconhecida.body.error, /UNIDADE-SEM-CONVERSAO/);
    assert.match(unidadeDesconhecida.body.error, /Leite em pó/);
    assert.equal(unidadeDesconhecida.body.detalhes.produto_id, ids.leite);
    assert.equal((await FabricaLoja.listarFichasPadrao(db)).some((item) => item.codigo === 'FT-PAD-INVALIDA-2'), false);

    const duplicadoBase = await requisitar('POST', '/fabrica-loja/fichas-padrao', {
      codigo: 'FT-PAD-INVALIDA-3',
      nome: 'Componente repetido',
      rendimento_quantidade: 1,
      rendimento_unidade: 'UN',
      componentes: [
        { produto_id: ids.leite, quantidade: 1, unidade: 'UN' },
        { produto_id: ids.leite, quantidade: 2, unidade: 'UN' }
      ]
    });
    assert.equal(duplicadoBase.status, 409);
    assert.equal(duplicadoBase.body.codigo, 'PRODUTO_BASE_DUPLICADO');

    const alteracaoInexistente = await requisitar('POST', `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoB}/ajustes`, {
      componente_base_id: 999999,
      operacao: 'REMOVER'
    });
    assert.equal(alteracaoInexistente.status, 422);
    assert.equal(alteracaoInexistente.body.codigo, 'COMPONENTE_BASE_INEXISTENTE');
    const quantidadeInvalida = await requisitar('POST', `/fabrica-loja/fichas-padrao/vinculos/${ids.vinculoB}/ajustes`, {
      produto_id: ids.morango,
      operacao: 'ADICIONAR',
      quantidade: 0,
      unidade: 'UN'
    });
    assert.equal(quantidadeInvalida.status, 400);
    assert.equal(quantidadeInvalida.body.codigo, 'QUANTIDADE_INVALIDA');
  });
});
