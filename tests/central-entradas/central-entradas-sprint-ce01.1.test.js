/**
 * Testes — Central de Entradas Sprint CDS-SORV-CE-01.1
 * Executar: npm run test:central-entradas-ce01.1
 */

const assert = require('assert');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const SincronizacaoResultadoDTO = require('../../backend/motores/central-entradas/contracts/SincronizacaoResultadoDTO');
const { getDfeUrl } = require('../../backend/services/fiscal/distribuicaoDFe');
const {
  classificarErroSefaz,
  CODIGOS
} = require('../../backend/services/fiscal/sefazErroOperacional');
const sefazGate = require('../../backend/motores/central-entradas/services/CentralSefazOperationalGate');

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

async function main() {
  console.log('\n=== Testes Central de Entradas — CDS-SORV-CE-01.1 ===\n');

  await test('URL DistDFe de produção usa www1 (Ambiente Nacional)', async () => {
    const url = getDfeUrl(1);
    assert.ok(url.includes('www1.nfe.fazenda.gov.br'));
    assert.ok(!url.includes('://www.nfe.fazenda.gov.br/'));
    assert.ok(getDfeUrl(2).includes('hom1.nfe.fazenda.gov.br'));
  });

  await test('GET ao-abrir equivale a abrirCentral sem derrubar a Central', async () => {
    const abertura = await service.abrirCentral();
    assert.strictEqual(abertura.sucesso, true);
    assert.strictEqual(abertura.centralAberta, true);
    assert.ok(abertura.health);
    assert.ok(abertura.dashboard);
    assert.ok('sefazDisponivel' in abertura);
  });

  await test('abrirCentral permanece ok mesmo com Gate em cooldown', async () => {
    sefazGate.resetar();
    const gateTeste = new sefazGate.CentralSefazOperationalGate({
      minIntervaloMs: 0,
      limiteFalhas: 1,
      cooldownErroMs: 60 * 1000
    });
    try {
      await gateTeste.executar(async () => {
        throw new Error('SEFAZ timeout');
      });
    } catch { /* esperado */ }
    assert.strictEqual(gateTeste.podeConsultar(), false);

    const abertura = await service.abrirCentral();
    assert.strictEqual(abertura.centralAberta, true);
    sefazGate.resetar();
  });

  await test('classifica 404 DistDFe como SEFAZ_ENDPOINT operacional', async () => {
    const classificado = classificarErroSefaz({
      message: 'Request failed with status code 404',
      response: { status: 404, data: '<html>The resource cannot be found.</html>' }
    });
    assert.strictEqual(classificado.codigo, CODIGOS.SEFAZ_ENDPOINT);
    assert.strictEqual(classificado.operacional, true);
    assert.ok(!classificado.mensagem.includes('<html'));
  });

  await test('classifica timeout DistDFe', async () => {
    const classificado = classificarErroSefaz({
      message: 'timeout of 90000ms exceeded',
      code: 'ECONNABORTED'
    });
    assert.strictEqual(classificado.codigo, CODIGOS.TIMEOUT);
    assert.strictEqual(classificado.operacional, true);
  });

  await test('classifica certificado e configuração', async () => {
    assert.strictEqual(
      classificarErroSefaz(new Error('Certificado não configurado')).codigo,
      CODIGOS.CERTIFICADO
    );
    assert.strictEqual(
      classificarErroSefaz(new Error('CNPJ do emitente não configurado')).codigo,
      CODIGOS.CONFIGURACAO
    );
  });

  await test('classifica Gate bloqueado', async () => {
    const erro = new Error('Circuit breaker SEFAZ aberto');
    erro.code = 'SEFAZ_GATE_BLOQUEADO';
    erro.statusCode = 429;
    const classificado = classificarErroSefaz(erro);
    assert.strictEqual(classificado.codigo, CODIGOS.GATE);
    assert.strictEqual(classificado.operacional, true);
  });

  await test('DTO de sync com erro operacional não vira sucesso', async () => {
    const json = SincronizacaoResultadoDTO.fromError({
      message: 'Request failed with status code 404',
      response: { status: 404 }
    });
    assert.strictEqual(json.sucesso, false);
    assert.strictEqual(json.operacional, true);
    assert.strictEqual(json.erro.codigo, CODIGOS.SEFAZ_ENDPOINT);
    assert.ok(Array.isArray(json.erros));
  });

  await test('erro interno não é marcado como operacional', async () => {
    const classificado = classificarErroSefaz(new Error('Cannot read properties of undefined'));
    assert.strictEqual(classificado.codigo, CODIGOS.INTERNO);
    assert.strictEqual(classificado.operacional, false);
  });

  await test('sincronizarAoAbrir desabilitado não consulta SEFAZ', async () => {
    const original = await service.obterConfiguracoes();
    await service.atualizarConfiguracoes({ syncAoAbrir: false });
    const resultado = await service.sincronizarAoAbrir();
    assert.strictEqual(resultado.ignorado, true);
    assert.strictEqual(resultado.sucesso, true);
    await service.atualizarConfiguracoes({ syncAoAbrir: original.syncAoAbrir });
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
