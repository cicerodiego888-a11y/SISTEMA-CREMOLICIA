/**
 * MCC-02.1 — Testes Versionamento Conversão Física por Lote
 * Executar: npm run test:mcc021
 */

const assert = require('assert');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const mcc = require(path.join(__dirname, '..'));

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function criarDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', async (err) => {
      if (err) return reject(err);
      try {
        await new Promise((res, rej) => {
          db.serialize(() => {
            db.run(`CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT)`);
            db.run(`
              CREATE TABLE produtos_lotes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                produto_id INTEGER NOT NULL,
                lote TEXT
              )
            `, (e) => (e ? rej(e) : res()));
          });
        });
        await mcc.bootstrapMccSchema(db);
        db.run(`INSERT INTO produtos (id, nome) VALUES (1, 'Sorvete')`);
        db.run(`INSERT INTO produtos_lotes (id, produto_id, lote) VALUES (10, 1, '20260717')`);
        resolve(db);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function fecharDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

async function run() {
  console.log('=== TESTES — MCC-02.1 Versionamento Conversão Física ===\n');
  const db = await criarDb();

  await test('Novo lote — Versão 1 ativa', async () => {
    const v1 = await mcc.criarVersaoInicial(db, {
      produtoId: 1,
      loteId: 10,
      unidadeBase: 'L',
      unidadeDestino: 'KG',
      quantidadeBase: 5,
      quantidadeDestino: 3.375,
      origem: mcc.OrigemConversaoFisica.MANUAL
    });
    assert.strictEqual(v1.versao, 1);
    assert.strictEqual(v1.ativa, 1);
    assert.ok(Math.abs(v1.fator - 0.675) < 1e-9);

    const ativa = await mcc.consultarConversaoAtiva(db, 10);
    assert.strictEqual(ativa.id, v1.id);
    assert.strictEqual(ativa.versao, 1);
  });

  await test('Correção — Versão 2 ativa; Versão 1 inativa', async () => {
    const r = await mcc.criarNovaVersao(db, 10, {
      quantidadeBase: 5,
      quantidadeDestino: 3.362,
      motivo: mcc.MotivoVersaoConversao.CONFERENCIA_BALANCA,
      usuarioId: 99
    });
    assert.strictEqual(r.versao_anterior.versao, 1);
    assert.strictEqual(r.versao_anterior.ativa, 0);
    assert.strictEqual(r.versao_nova.versao, 2);
    assert.strictEqual(r.versao_nova.ativa, 1);
    assert.strictEqual(r.versao_nova.substitui_id, r.versao_anterior.id);
    assert.strictEqual(r.versao_nova.motivo, 'CONFERENCIA_BALANCA');
    assert.strictEqual(r.versao_nova.usuario_id, 99);
    assert.ok(Math.abs(r.versao_nova.fator - 0.6724) < 1e-6);
    assert.ok(r.auditoria.timestamp);
  });

  await test('MCC utiliza apenas a versão ativa', async () => {
    const ativa = await mcc.ConversaoFisicaLoteRepository.buscarAtivaPorLoteId(db, 10);
    assert.strictEqual(ativa.versao, 2);

    const produto = {
      id: 1,
      unidade_base: 'L',
      utiliza_conversao_fisica: 1,
      unidade_conversao_fisica: 'KG'
    };
    const resultado = mcc.Converter({
      produto,
      quantidade: 10,
      unidadeOrigem: 'L',
      contexto: 'VENDA',
      conversaoFisicaLote: ativa
    });
    assert.ok(Math.abs(resultado.quantidadeConvertida - 10 * ativa.fator) < 1e-9);
    assert.strictEqual(resultado.loteUtilizado.versao, 2);

    const historico = await mcc.ConversaoFisicaLoteRepository.listarHistoricoPorLote(db, 10);
    const inativa = historico.find((v) => v.versao === 1);
    assert.ok(inativa);
    assert.strictEqual(inativa.ativa, false);

    let erroInativa = null;
    try {
      mcc.Converter({
        produto,
        quantidade: 10,
        unidadeOrigem: 'L',
        contexto: 'VENDA',
        conversaoFisicaLote: inativa
      });
    } catch (e) {
      erroInativa = e;
    }
    assert.ok(erroInativa);
    assert.strictEqual(erroInativa.codigo, 'MCC_CONVERSAO_INATIVA');
  });

  await test('Histórico preservado (versões, origem, usuário, motivo, fator)', async () => {
    const h = await mcc.consultarHistorico(db, 10);
    assert.strictEqual(h.total_versoes, 2);
    assert.strictEqual(h.versoes[0].versao, 1);
    assert.strictEqual(h.versoes[0].ativa, 0);
    assert.strictEqual(h.versoes[1].versao, 2);
    assert.strictEqual(h.versoes[1].ativa, 1);
    assert.strictEqual(h.versoes[1].motivo, 'CONFERENCIA_BALANCA');
    assert.strictEqual(h.versoes[1].usuario_id, 99);
    assert.ok(h.versoes[0].fator);
    assert.ok(h.versoes[1].fator);
  });

  await test('Tentativa de UPDATE bloqueada', async () => {
    const ativa = await mcc.consultarConversaoAtiva(db, 10);
    let err = null;
    try {
      await mcc.ConversaoFisicaLoteRepository.atualizar(db, ativa.id, {
        quantidade_destino: 9.999
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof mcc.ConversaoFisicaImutavelError);
    assert.strictEqual(err.codigo, 'MCC_CONVERSAO_FISICA_IMUTAVEL');

    const ainda = await mcc.consultarConversaoAtiva(db, 10);
    assert.ok(Math.abs(ainda.fator - ativa.fator) < 1e-12);
  });

  await test('Tentativa de DELETE bloqueada', async () => {
    const ativa = await mcc.consultarConversaoAtiva(db, 10);
    let err = null;
    try {
      await mcc.ConversaoFisicaLoteRepository.excluir(db, ativa.id);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof mcc.ConversaoFisicaImutavelError);
    const h = await mcc.consultarHistorico(db, 10);
    assert.strictEqual(h.total_versoes, 2);
  });

  await test('Resolver via DB usa somente ativa', async () => {
    const fisica = new mcc.ConversaoFisicaService();
    const resolvida = await fisica.resolverConversaoLote(
      { db, loteId: 10 },
      { id: 1, utiliza_conversao_fisica: 1 }
    );
    assert.strictEqual(resolvida.versao, 2);
    assert.strictEqual(resolvida.ativa, true);
  });

  await test('Enums MotivoVersaoConversao oficiais', () => {
    assert.strictEqual(mcc.MotivoVersaoConversao.CONFERENCIA_BALANCA, 'CONFERENCIA_BALANCA');
    assert.strictEqual(mcc.MotivoVersaoConversao.CORRECAO_OPERACIONAL, 'CORRECAO_OPERACIONAL');
    assert.strictEqual(mcc.MotivoVersaoConversao.AJUSTE_FABRICANTE, 'AJUSTE_FABRICANTE');
    assert.strictEqual(mcc.MotivoVersaoConversao.ERRO_DIGITACAO, 'ERRO_DIGITACAO');
    assert.strictEqual(mcc.MotivoVersaoConversao.OUTRO, 'OUTRO');
  });

  await fecharDb(db);
  console.log(`\n=== Resultado: ${passou} OK, ${falhou} FALHOU ===`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
