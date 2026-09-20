/**
 * RCM-8.5 — Histórico de consignações paginado por cliente
 *
 * Executar:
 *   node tests/motor-comercial/rcm85-historico-paginado-consignacao.test.js
 */

const assert = require('assert');
const {
  PAGE_SIZE_PADRAO,
  PAGE_SIZE_MAX,
  resolverPaginacaoHistorico,
  montarMetaPaginacao
} = require('../../backend/motores/motor-comercial/services/historicoConsignacaoPaginacao');
const ListarConsignacoesUseCase = require('../../backend/motores/motor-comercial/usecases/consignacao/ListarConsignacoesUseCase');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((err) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}\n         ${err.message}`);
    });
}

function criarConsignacao(id, overrides = {}) {
  return {
    id,
    clienteId: 10,
    status: overrides.status || 'QUITADA',
    documento: { numero: `CONS-2026-${String(id).padStart(6, '0')}` },
    dataAbertura: `2026-01-${String((id % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
    ...overrides
  };
}

function criarRepo(todos) {
  return {
    listar: async (filtros = {}) => {
      let lista = todos.filter((c) => {
        if (filtros.clienteId != null && Number(c.clienteId) !== Number(filtros.clienteId)) return false;
        if (filtros.statusIn && !filtros.statusIn.includes(c.status)) return false;
        if (filtros.status && c.status !== filtros.status) return false;
        return true;
      });
      if (Number.isFinite(Number(filtros.limite))) {
        const offset = Number(filtros.offset) || 0;
        lista = lista.slice(offset, offset + Number(filtros.limite));
      }
      return lista;
    },
    contar: async (filtros = {}) => {
      return todos.filter((c) => {
        if (filtros.clienteId != null && Number(c.clienteId) !== Number(filtros.clienteId)) return false;
        if (filtros.statusIn && !filtros.statusIn.includes(c.status)) return false;
        if (filtros.status && c.status !== filtros.status) return false;
        return true;
      }).length;
    }
  };
}

async function run() {
  console.log('\nRCM-8.5 — Histórico paginado de consignações\n');

  await test('sem page/limite não pagina', () => {
    const r = resolverPaginacaoHistorico({});
    assert.strictEqual(r.paginado, false);
  });

  await test('página padrão 20 e teto 50', () => {
    const r = resolverPaginacaoHistorico({ page: 1 });
    assert.strictEqual(r.paginado, true);
    assert.strictEqual(r.pageSize, PAGE_SIZE_PADRAO);
    const teto = resolverPaginacaoHistorico({ page: 1, pageSize: 200 });
    assert.strictEqual(teto.pageSize, PAGE_SIZE_MAX);
  });

  await test('hasMore quando ainda há páginas', () => {
    const meta = montarMetaPaginacao({ total: 45, page: 1, pageSize: 20 });
    assert.strictEqual(meta.hasMore, true);
    const ultima = montarMetaPaginacao({ total: 45, page: 3, pageSize: 20 });
    assert.strictEqual(ultima.hasMore, false);
  });

  await test('UC lista só a primeira página e informa total', async () => {
    const todos = Array.from({ length: 45 }, (_, i) => criarConsignacao(45 - i));
    const uc = new ListarConsignacoesUseCase({
      consignacaoRepository: criarRepo(todos)
    });
    const result = await uc.executar({ clienteId: 10, page: 1, pageSize: 20 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacoes.length, 20);
    assert.strictEqual(result.dados.total, 45);
    assert.strictEqual(result.dados.hasMore, true);
    assert.strictEqual(result.dados.consignacoes[0].id, 45);
  });

  await test('segunda página continua de onde parou', async () => {
    const todos = Array.from({ length: 45 }, (_, i) => criarConsignacao(45 - i));
    const uc = new ListarConsignacoesUseCase({
      consignacaoRepository: criarRepo(todos)
    });
    const result = await uc.executar({ clienteId: 10, page: 2, pageSize: 20 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacoes.length, 20);
    assert.strictEqual(result.dados.consignacoes[0].id, 25);
    assert.strictEqual(result.dados.hasMore, true);
  });

  await test('consulta operacional não mistura com paginação do histórico', async () => {
    const todos = [
      criarConsignacao(1, { status: 'ENTREGUE' }),
      criarConsignacao(2, { status: 'QUITADA' }),
      criarConsignacao(3, { status: 'ACERTADA' })
    ];
    const uc = new ListarConsignacoesUseCase({
      consignacaoRepository: criarRepo(todos)
    });
    const result = await uc.executar({
      clienteId: 10,
      statusIn: ['ENTREGUE', 'ACERTADA']
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacoes.length, 2);
    assert.strictEqual(result.dados.hasMore, false);
  });

  await test('listagem sem paginação continua devolvendo o conjunto filtrado', async () => {
    const todos = Array.from({ length: 8 }, (_, i) => criarConsignacao(i + 1));
    const uc = new ListarConsignacoesUseCase({
      consignacaoRepository: criarRepo(todos)
    });
    const result = await uc.executar({ clienteId: 10 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacoes.length, 8);
    assert.strictEqual(result.dados.total, 8);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
