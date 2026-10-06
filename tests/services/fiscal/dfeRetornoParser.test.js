/**
 * Testes — dfeRetornoParser (Sprint 4)
 * Executar: npm run test:dfe-retorno-parser
 */

const assert = require('assert');
const zlib = require('zlib');
const {
  normalizarNsu,
  nsuMenorQue,
  extrairMetadadosRetorno,
  extrairDocumentosZip,
  extrairTodosNsus,
  isDocumentoNotaFiscal,
  retornoDistSucesso
} = require('../../../backend/services/fiscal/dfeRetornoParser');

let passou = 0;
let falhou = 0;

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

function criarXmlNota(chave) {
  return `<?xml version="1.0"?><nfeProc><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}"><ide><nNF>123</nNF><serie>1</serie></ide><emit><CNPJ>99999999000199</CNPJ><xNome>Emitente Teste</xNome></emit></infNFe></NFe></nfeProc>`;
}

function montarRetornoSoap({ cStat = '138', ultNSU = '5', maxNSU = '10', documentos = [] }) {
  const docZips = documentos.map((doc) => {
    const compactado = zlib.gzipSync(Buffer.from(doc.xml, 'utf8')).toString('base64');
    return `<docZip NSU="${doc.nsu}" schema="${doc.schema || 'procNFe_v4.00.xsd'}">${compactado}</docZip>`;
  }).join('');

  return `
<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe">
  <cStat>${cStat}</cStat>
  <xMotivo>Consulta realizada</xMotivo>
  <ultNSU>${ultNSU}</ultNSU>
  <maxNSU>${maxNSU}</maxNSU>
  <loteDistDFeInt>${docZips}</loteDistDFeInt>
</retDistDFeInt>`;
}

async function main() {
  console.log('\n=== Testes dfeRetornoParser — Sprint 4 ===\n');

  await test('normalizarNsu preenche 15 dígitos', async () => {
    assert.strictEqual(normalizarNsu('5'), '000000000000005');
    assert.strictEqual(normalizarNsu(''), '000000000000000');
  });

  await test('nsuMenorQue compara corretamente', async () => {
    assert.strictEqual(nsuMenorQue('5', '10'), true);
    assert.strictEqual(nsuMenorQue('10', '5'), false);
  });

  await test('extrairMetadadosRetorno lê cStat e NSUs', async () => {
    const xml = montarRetornoSoap({ cStat: '138', ultNSU: '7', maxNSU: '12' });
    const meta = extrairMetadadosRetorno(xml);
    assert.strictEqual(meta.cStat, '138');
    assert.strictEqual(meta.ultNSU, '000000000000007');
    assert.strictEqual(meta.maxNSU, '000000000000012');
  });

  await test('retornoDistSucesso aceita cStat válidos', async () => {
    assert.strictEqual(retornoDistSucesso('137'), true);
    assert.strictEqual(retornoDistSucesso('138'), true);
    assert.strictEqual(retornoDistSucesso('999'), false);
  });

  await test('isDocumentoNotaFiscal identifica NF-e', async () => {
    const xml = criarXmlNota('23250699999999000199550010000009991000000099');
    assert.strictEqual(isDocumentoNotaFiscal('procNFe_v4.00.xsd', xml), true);
    assert.strictEqual(isDocumentoNotaFiscal('evento_v1.00.xsd', '<evento/>'), false);
  });

  await test('extrairDocumentosZip descompacta docZip', async () => {
    const chave = '23250699999999000199550010000009991000000099';
    const xmlNota = criarXmlNota(chave);
    const retorno = montarRetornoSoap({
      documentos: [{ nsu: '8', xml: xmlNota }]
    });

    const docs = extrairDocumentosZip(retorno);
    assert.strictEqual(docs.length, 1);
    assert.strictEqual(docs[0].nsu, '000000000000008');
    assert.ok(docs[0].xml.includes('infNFe'));
  });

  await test('extrairTodosNsus inclui NSUs sem unzip', async () => {
    const xml = '<lote><docZip NSU="9" schema="resEvento_v1.01.xsd"></docZip></lote>';
    const nsus = extrairTodosNsus(xml);
    assert.strictEqual(nsus[0], '000000000000009');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
