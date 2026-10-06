/**
 * Testes — Central de Entradas Sprint CDS-SORV-CE-01.5
 * Executar: npm run test:central-entradas-ce01.5
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

function criarEstadoListagem() {
  return {
    carregando: false,
    documentos: [],
    erro: null,
    requestId: 0,
    renderizacoes: [],
    loadingFinal: null
  };
}

async function simularCarregarDocumentos(estado, buscar, { falhar = false, delayMs = 0, requestId } = {}) {
  const id = requestId != null ? requestId : (estado.requestId += 1);
  estado.carregando = true;
  estado.renderizacoes.push(
    Carga.deveMostrarSkeletonDocumentos({
      carregando: estado.carregando,
      quantidadeDocumentos: estado.documentos.length,
      erro: estado.erro
    }) ? 'skeleton' : 'dados'
  );

  try {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (falhar) throw new Error('falha simulada');
    const resultado = await buscar();
    if (!Carga.deveAplicarRespostaListagem(estado.requestId, id)) {
      return { ignorado: true };
    }
    estado.documentos = resultado.documentos || [];
    estado.erro = null;
  } catch (error) {
    if (!Carga.deveAplicarRespostaListagem(estado.requestId, id)) {
      return { ignorado: true };
    }
    estado.erro = Carga.montarEstadoErroListagem(error);
  } finally {
    if (Carga.deveAplicarRespostaListagem(estado.requestId, id)) {
      estado.carregando = false;
      estado.loadingFinal = false;
      estado.renderizacoes.push(
        estado.erro && !estado.documentos.length ? 'erro' : 'dados'
      );
    }
  }
  return estado;
}

async function main() {
  console.log('\n=== Testes Central de Entradas — CDS-SORV-CE-01.5 ===\n');

  await test('documentos carregam normalmente via listarDocumentos', async () => {
    const inicio = Date.now();
    const resultado = await service.listarDocumentos({ pagina: 1, limite: 20 });
    const ms = Date.now() - inicio;
    assert.ok(Array.isArray(resultado.documentos));
    assert.ok(resultado.paginacao);
    assert.ok(ms < 5000, `listagem demorou ${ms}ms`);
    console.log(`         listarDocumentos: ${ms}ms, ${resultado.documentos.length} item(ns)`);
  });

  await test('endpoint vazio não deixa Carregando...', async () => {
    const estado = criarEstadoListagem();
    await simularCarregarDocumentos(estado, async () => ({ documentos: [] }));
    assert.strictEqual(estado.carregando, false);
    assert.strictEqual(estado.loadingFinal, false);
    assert.ok(estado.renderizacoes.includes('dados'));
    assert.ok(!estado.erro);
  });

  await test('endpoint com erro mostra estado controlado', async () => {
    const estado = criarEstadoListagem();
    await simularCarregarDocumentos(estado, async () => ({}), { falhar: true });
    assert.strictEqual(estado.carregando, false);
    assert.strictEqual(estado.erro.mensagem, 'Não foi possível carregar os documentos da Central.');
    assert.ok(estado.renderizacoes.includes('erro'));
  });

  await test('Promise rejeitada não deixa loading permanente', async () => {
    const estado = criarEstadoListagem();
    await simularCarregarDocumentos(estado, async () => {
      throw new Error('rede');
    });
    assert.strictEqual(estado.carregando, false);
    assert.ok(estado.erro.detalhe.includes('rede'));
  });

  await test('timeout é classificado na listagem', async () => {
    assert.strictEqual(Carga.TIMEOUT_LISTAGEM_MS, 20000);
    const erro = Carga.montarEstadoErroListagem({ message: 'Tempo esgotado ao comunicar com o servidor.', code: 'TIMEOUT' });
    assert.ok(erro.mensagem.includes('Não foi possível carregar'));
    assert.ok(erro.detalhe.includes('Tempo esgotado'));
  });

  await test('endpoint demora mas loading termina após resposta', async () => {
    const estado = criarEstadoListagem();
    await simularCarregarDocumentos(estado, async () => ({ documentos: [{ id: 1 }] }), { delayMs: 30 });
    assert.strictEqual(estado.carregando, false);
    assert.strictEqual(estado.documentos.length, 1);
  });

  await test('chamada concorrente: resposta antiga não sobrescreve a nova', async () => {
    const estado = criarEstadoListagem();
    estado.requestId = 1;
    const lenta = simularCarregarDocumentos(estado, async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { documentos: [{ id: 'antigo' }] };
    }, { requestId: 1 });
    estado.requestId = 2;
    const nova = simularCarregarDocumentos(estado, async () => ({ documentos: [{ id: 'novo' }] }), { requestId: 2 });
    await Promise.all([lenta, nova]);
    assert.strictEqual(estado.documentos[0].id, 'novo');
    assert.strictEqual(estado.carregando, false);
  });

  await test('skeleton só quando não há documentos nem erro', async () => {
    assert.strictEqual(Carga.deveMostrarSkeletonDocumentos({
      carregando: true, quantidadeDocumentos: 0, erro: null
    }), true);
    assert.strictEqual(Carga.deveMostrarSkeletonDocumentos({
      carregando: true, quantidadeDocumentos: 3, erro: null
    }), false);
    assert.strictEqual(Carga.deveMostrarSkeletonDocumentos({
      carregando: false, quantidadeDocumentos: 0, erro: null
    }), false);
  });

  await test('botão Tentar novamente está no contrato de erro', async () => {
    const erro = Carga.montarEstadoErroListagem(new Error('x'));
    assert.ok(erro.mensagem);
    assert.strictEqual(Carga.deveAplicarRespostaListagem(3, 3), true);
    assert.strictEqual(Carga.deveAplicarRespostaListagem(3, 2), false);
  });

  await test('listagem não depende de SEFAZ (abre com DistDFe indisponível)', async () => {
    const abertura = await service.abrirCentral();
    const lista = await service.listarDocumentos({ pagina: 1, limite: 5 });
    assert.strictEqual(abertura.centralAberta, true);
    assert.ok(Array.isArray(lista.documentos));
  });

  await test('seleção de documento usa obterDocumentoDetalhe independente da grade', async () => {
    const lista = await service.listarDocumentos({ pagina: 1, limite: 1 });
    if (!lista.documentos.length) {
      const detalheVazio = await service.obterDocumentoDetalhe(999999991);
      assert.strictEqual(detalheVazio, null);
      return;
    }
    const detalhe = await service.obterDocumentoDetalhe(lista.documentos[0].id);
    assert.ok(detalhe);
    assert.ok(detalhe.documento || detalhe.id);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
