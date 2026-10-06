/**
 * Testes — Central de Entradas Sprint CDS-SORV-CE-01.2
 * Executar: npm run test:central-entradas-ce01.2
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getFiscalDir, getFiscalSubDir } = require('../../backend/services/fiscal/paths');
const { enviarSoapDFe } = require('../../backend/services/fiscal/soapClient');
const { CODIGOS } = require('../../backend/services/fiscal/sefazErroOperacional');
const sefazGate = require('../../backend/motores/central-entradas/services/CentralSefazOperationalGate');

let passou = 0;
let falhou = 0;
const fiscalDirOriginal = process.env.FISCAL_DIR;

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

function pastaTempFiscal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cds-fiscal-ce012-'));
}

async function main() {
  console.log('\n=== Testes Central de Entradas — CDS-SORV-CE-01.2 ===\n');

  await test('getFiscalSubDir está exportada em services/fiscal/paths', () => {
    assert.strictEqual(typeof getFiscalSubDir, 'function');
    assert.strictEqual(typeof getFiscalDir, 'function');
  });

  await test('soapClient importa getFiscalSubDir do contrato paths', () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/soapClient.js'),
      'utf8'
    );
    assert.ok(
      /const\s*\{\s*getFiscalSubDir\s*\}\s*=\s*require\('\.\/paths'\)/.test(fonte),
      'soapClient.js deve importar getFiscalSubDir de ./paths'
    );
    assert.ok(!/global\.getFiscalSubDir/.test(fonte));
  });

  await test('respeita FISCAL_DIR (contrato Electron) e cria subpasta', () => {
    const raiz = pastaTempFiscal();
    process.env.FISCAL_DIR = raiz;
    const debugDir = getFiscalSubDir('debug');
    assert.strictEqual(debugDir, path.join(raiz, 'debug'));
    assert.ok(fs.existsSync(debugDir));
    const certDir = getFiscalSubDir('certificados');
    assert.strictEqual(certDir, path.join(raiz, 'certificados'));
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  await test('sem FISCAL_DIR usa fallback relativo dados/fiscal', () => {
    delete process.env.FISCAL_DIR;
    const dir = getFiscalDir();
    assert.ok(dir.includes('dados'));
    assert.ok(dir.replace(/\\/g, '/').endsWith('dados/fiscal') || dir.endsWith('dados\\fiscal'));
  });

  await test('certificado encontrado via getFiscalSubDir', () => {
    const raiz = pastaTempFiscal();
    process.env.FISCAL_DIR = raiz;
    const pasta = getFiscalSubDir('certificados');
    const pfx = path.join(pasta, 'certificado.pfx');
    fs.writeFileSync(pfx, Buffer.from('pfx-teste'));
    assert.ok(fs.existsSync(pfx));
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  await test('certificado ausente não é tratado como sucesso', () => {
    const raiz = pastaTempFiscal();
    process.env.FISCAL_DIR = raiz;
    const pfx = path.join(getFiscalSubDir('certificados'), 'certificado.pfx');
    assert.strictEqual(fs.existsSync(pfx), false);
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  await test('enviarSoapDFe não lança getFiscalSubDir is not defined', async () => {
    const raiz = pastaTempFiscal();
    process.env.FISCAL_DIR = raiz;
    try {
      await enviarSoapDFe('<distDFeInt/>', path.join(raiz, 'ausente.pfx'), 'senha', 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
      assert.fail('deveria falhar no certificado');
    } catch (error) {
      assert.ok(
        !/getFiscalSubDir is not defined/.test(error.message || ''),
        error.message
      );
      assert.ok(
        /certificado/i.test(error.message || '') || error.codigo === CODIGOS.CERTIFICADO,
        error.message
      );
      assert.notStrictEqual(error.codigo, undefined);
    } finally {
      fs.rmSync(raiz, { recursive: true, force: true });
    }
  });

  await test('configuração de certificado ausente gera erro controlado', async () => {
    const raiz = pastaTempFiscal();
    process.env.FISCAL_DIR = raiz;
    try {
      await enviarSoapDFe('<distDFeInt/>', '', 'senha', 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
      assert.fail('deveria falhar na configuração');
    } catch (error) {
      assert.ok(!/getFiscalSubDir is not defined/.test(error.message || ''));
      assert.ok(/certificado/i.test(error.message || '') || error.codigo === CODIGOS.CONFIGURACAO || error.codigo === CODIGOS.CERTIFICADO);
    } finally {
      fs.rmSync(raiz, { recursive: true, force: true });
    }
  });

  await test('Gate mantém cooldown e resetar() é o mecanismo previsto', () => {
    sefazGate.resetar();
    const gate = new sefazGate.CentralSefazOperationalGate({
      minIntervaloMs: 0,
      limiteFalhas: 5,
      cooldownErroMs: 15 * 1000
    });
    return gate.executar(async () => {
      throw new Error('falha operacional');
    }).then(
      () => assert.fail('esperava falha'),
      () => {
        assert.strictEqual(gate.podeConsultar(), false);
        assert.ok(gate.obterEstado().cooldownMsRestante > 0);
        gate.resetar();
        assert.strictEqual(gate.podeConsultar(), true);
        sefazGate.resetar();
      }
    );
  });

  if (fiscalDirOriginal === undefined) {
    delete process.env.FISCAL_DIR;
  } else {
    process.env.FISCAL_DIR = fiscalDirOriginal;
  }

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
