/**
 * Testes — Central de Entradas Sprint CDS-SORV-CE-01.4
 * Executar: npm run test:central-entradas-ce01.4
 */

const assert = require('assert');
const Carga = require('../../frontend/erp/js/central-entradas-carga');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');

let passou = 0;
let falhou = 0;
const service = new CentralEntradasService();

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function aberturaComContadores(contadores) {
  return {
    sucesso: true,
    centralAberta: true,
    sefazDisponivel: true,
    health: { status: 'ok' },
    dashboard: {
      contadores,
      indicadores: { totalDocumentos: 19, valorTotalDia: 0, documentosHoje: 0 }
    }
  };
}

const CONTADORES = {
  novas: 2,
  aguardandoXml: 1,
  emProcessamento: 3,
  aguardandoRevisao: 1,
  prontasParaCompra: 2,
  gravadas: 10,
  erros: 0
};

async function main() {
  console.log('\n=== Testes Central de Entradas — CDS-SORV-CE-01.4 ===\n');

  await test('/ao-abrir fornece contadores no dashboard', async () => {
    const abertura = await service.abrirCentral();
    assert.strictEqual(abertura.centralAberta, true);
    assert.ok(abertura.dashboard);
    assert.ok(abertura.dashboard.contadores);
    assert.ok('novas' in abertura.dashboard.contadores);
    assert.ok('gravadas' in abertura.dashboard.contadores);
    assert.deepStrictEqual(
      Carga.extrairContadoresAbertura(abertura),
      abertura.dashboard.contadores
    );
  });

  await test('contadores são pintados imediatamente a partir de /ao-abrir', async () => {
    const ordem = [];
    const resultado = await Carga.orquestrarAberturaCentral({
      buscarAoAbrir: async () => {
        ordem.push('ao-abrir');
        return aberturaComContadores(CONTADORES);
      },
      buscarMetadados: async () => {
        ordem.push('metadados');
        return { estados: [] };
      },
      buscarDocumentos: async () => ({ documentos: [] }),
      pintarKpis: (contadores) => {
        ordem.push('kpis');
        assert.strictEqual(contadores.novas, 2);
        assert.strictEqual(contadores.gravadas, 10);
      }
    });
    assert.strictEqual(resultado.kpisPintadosAntesDoSync, true);
    assert.ok(ordem.indexOf('kpis') >= 0);
    assert.ok(ordem.indexOf('kpis') < ordem.indexOf('metadados') || ordem.indexOf('metadados') === -1
      || ordem.indexOf('ao-abrir') < ordem.indexOf('kpis'));
    assert.strictEqual(resultado.chamadas.dashboard, 0);
  });

  await test('health lento não bloqueia cards', async () => {
    const health = deferred();
    let kpis = null;
    const orq = Carga.orquestrarAberturaCentral({
      buscarAoAbrir: async () => {
        const a = aberturaComContadores(CONTADORES);
        delete a.health;
        return a;
      },
      buscarMetadados: async () => ({}),
      buscarHealth: () => health.promise,
      pintarKpis: (c) => { kpis = c; },
      aplicarHealth: () => { kpis.healthAplicado = true; }
    });
    await orq;
    assert.ok(kpis, 'KPIs devem existir antes do health');
    assert.strictEqual(kpis.novas, 2);
    assert.ok(!kpis.healthAplicado);
    health.resolve({ status: 'ok' });
  });

  await test('DistDFe lento não bloqueia cards', async () => {
    const sync = deferred();
    let kpis = null;
    const orq = Carga.orquestrarAberturaCentral({
      buscarAoAbrir: async () => aberturaComContadores(CONTADORES),
      buscarMetadados: async () => ({}),
      sincronizarAoAbrir: () => sync.promise,
      atualizarDashboard: async () => ({ contadores: CONTADORES }),
      pintarKpis: (c) => { kpis = c; }
    });
    const resultado = await orq;
    assert.strictEqual(resultado.kpisPintadosAntesDoSync, true);
    assert.strictEqual(kpis.emProcessamento, 3);
    assert.strictEqual(resultado.chamadas.sincronizarAoAbrir, 1);
    assert.strictEqual(resultado.chamadas.dashboard, 0);
    sync.resolve({ sucesso: true, notasNovas: 0 });
  });

  await test('DistDFe falha sem apagar cards', async () => {
    const pinturas = [];
    const banners = [];
    await Carga.orquestrarAberturaCentral({
      buscarAoAbrir: async () => aberturaComContadores(CONTADORES),
      buscarMetadados: async () => ({}),
      sincronizarAoAbrir: async () => ({
        sucesso: false,
        mensagem: 'SEFAZ timeout',
        erro: { codigo: 'TIMEOUT', mensagem: 'SEFAZ timeout', operacional: true }
      }),
      atualizarDashboard: async () => ({ contadores: CONTADORES }),
      pintarKpis: (c) => pinturas.push({ ...c }),
      tratarSync: (sync) => banners.push(Carga.montarBannerFalhaSync(sync))
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.ok(pinturas[0].novas === 2);
    assert.ok(pinturas.every((p) => p.gravadas === 10));
    assert.ok(banners.some((b) => b && b.visivel));
    assert.ok(banners.some((b) => b && b.titulo.includes('Falha na última sincronização')));
  });

  await test('sincronização concluída atualiza cards sem skeleton destrutivo', async () => {
    const novos = { ...CONTADORES, novas: 5 };
    const eventos = [];
    await Carga.orquestrarAberturaCentral({
      buscarAoAbrir: async () => aberturaComContadores(CONTADORES),
      buscarMetadados: async () => ({}),
      sincronizarAoAbrir: async () => ({ sucesso: true, notasNovas: 3 }),
      atualizarDashboard: async () => {
        eventos.push('dashboard-pos-sync');
        return { contadores: novos };
      },
      pintarKpis: (c) => eventos.push(`kpi:${c.novas}`),
      tratarSync: () => eventos.push('sync-ok')
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.ok(eventos.includes('kpi:2'));
    assert.ok(eventos.includes('sync-ok'));
    assert.ok(eventos.includes('dashboard-pos-sync'));
    assert.ok(eventos.includes('kpi:5'));
    assert.ok(!eventos.includes('skeleton'));
  });

  await test('não ocorre GET /dashboard duplicado na primeira pintura', async () => {
    const resultado = await Carga.orquestrarAberturaCentral({
      buscarAoAbrir: async () => aberturaComContadores(CONTADORES),
      buscarMetadados: async () => ({}),
      buscarDocumentos: async () => ({}),
      buscarInteligencia: async () => ({}),
      pintarKpis: () => {}
    });
    assert.strictEqual(resultado.chamadas.aoAbrir, 1);
    assert.strictEqual(resultado.chamadas.dashboard, 0);
    assert.strictEqual(resultado.chamadas.inteligencia, 1);
    assert.strictEqual(resultado.chamadas.metadados, 1);
    assert.strictEqual(resultado.chamadas.documentos, 1);
  });

  await test('duas chamadas concorrentes de dashboard são evitadas', async () => {
    const guarda = Carga.criarGuardaCarga();
    let execucoes = 0;
    const lenta = deferred();
    const p1 = guarda.executar(async () => {
      execucoes += 1;
      await lenta.promise;
      return 'a';
    });
    const p2 = guarda.executar(async () => {
      execucoes += 1;
      return 'b';
    });
    assert.strictEqual(guarda.ocupado(), true);
    assert.strictEqual(p1, p2);
    lenta.resolve();
    assert.strictEqual(await p1, 'a');
    assert.strictEqual(await p2, 'a');
    assert.strictEqual(execucoes, 1);
  });

  await test('inteligência lenta não bloqueia KPIs', async () => {
    const intel = deferred();
    let kpis = null;
    const orq = Carga.orquestrarAberturaCentral({
      buscarAoAbrir: async () => aberturaComContadores(CONTADORES),
      buscarMetadados: async () => ({}),
      buscarInteligencia: () => intel.promise,
      pintarKpis: (c) => { kpis = c; }
    });
    const resultado = await orq;
    assert.strictEqual(kpis.aguardandoRevisao, 1);
    assert.strictEqual(resultado.chamadas.inteligencia, 1);
    intel.resolve({});
  });

  await test('documentos lentos não bloqueiam KPIs', async () => {
    const docs = deferred();
    let kpis = null;
    const resultado = await Carga.orquestrarAberturaCentral({
      buscarAoAbrir: async () => aberturaComContadores(CONTADORES),
      buscarMetadados: async () => ({}),
      buscarDocumentos: () => docs.promise,
      pintarKpis: (c) => { kpis = c; }
    });
    assert.strictEqual(kpis.prontasParaCompra, 2);
    assert.strictEqual(resultado.chamadas.documentos, 1);
    docs.resolve({ documentos: [] });
  });

  await test('skeleton só na ausência de dados já exibidos', async () => {
    assert.strictEqual(Carga.deveMostrarSkeletonKpis({ jaTemDados: false }), true);
    assert.strictEqual(Carga.deveMostrarSkeletonKpis({ jaTemDados: true, forcarSkeleton: true }), false);
    assert.strictEqual(Carga.deveMostrarSkeletonKpis({ jaTemDados: true }), false);
  });

  await test('sync com dashboard próprio não dispara GET /dashboard extra', async () => {
    const resultado = await Carga.orquestrarAberturaCentral({
      buscarAoAbrir: async () => aberturaComContadores(CONTADORES),
      buscarMetadados: async () => ({}),
      sincronizarAoAbrir: async () => ({
        sucesso: true,
        dashboard: { contadores: { ...CONTADORES, novas: 9 } }
      }),
      atualizarDashboard: async () => {
        throw new Error('não deveria consultar /dashboard');
      },
      pintarKpis: () => {}
    });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(resultado.chamadas.dashboard, 0);
    assert.strictEqual(Carga.deveConsultarDashboardAposSync({
      dashboard: { contadores: CONTADORES }
    }), false);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
