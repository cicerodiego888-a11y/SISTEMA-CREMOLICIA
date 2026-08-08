/**
 * RCF-10.1 — Validação end-to-end do comprovante comercial.
 *
 * Cenário obrigatório:
 * - Pitú Fiscal
 * - Bala Não Fiscal
 * - Refrigerante Não Fiscal
 *
 * Espera-se:
 * - Banco = API = HTML = Impressão (3 itens)
 * - Snapshots gerados automaticamente
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testRoot = __dirname;
const backendRoot = path.join(testRoot, '../../..');
const servicePath = path.join(backendRoot, 'services/comercial/ComprovanteComercialPosFiscalService.js');
const routesPath = path.join(backendRoot, 'rotas/fiscal.js');
const frontPath = path.join(backendRoot, '../frontend/shared/js/comprovanteVenda.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcf101-e2e-'));
process.env.FISCAL_DIR = path.join(tempDir, 'fiscal');

function installDbStub() {
  const databasePath = require.resolve('../../../database');
  const pdfBuilderPath = require.resolve(path.join(backendRoot, 'motores/comprovantes/services/PdfComprovanteBuilder.js'));

  const note = {
    id: 1,
    venda_id: 101,
    status: 'autorizada',
    xml_enviado: xmlStub(),
    xml_retorno: '<ret><nProt>323260000199999</nProt><dhRecbto>2026-07-31T15:00:00-03:00</dhRecbto></ret>',
    chave_acesso: '23260765957340000150650010000020081591476774',
    numero: 2010,
    serie: 1,
    protocolo: '323260000199999',
    ambiente: 2,
    qr_code_url: 'https://www.sefaz.ce.gov.br/nfce/qrcode?p=RCF101',
    data_autorizacao: '2026-07-31T15:00:00-03:00'
  };

  const venda = {
    id: 101,
    total: 27.5,
    valor_fiscal: 8.5,
    valor_nao_fiscal: 19,
    forma_pagamento: 'pix',
    data_venda: '2026-07-31T15:00:00-03:00'
  };

  const itens = [
    { id: 1, venda_id: 101, produto_id: 1, quantidade: 1, preco_unitario: 8.5, subtotal: 8.5, unidade_comercial: 'UN', unidade: 'UN', produto_nome: 'Pitú Fiscal' },
    { id: 2, venda_id: 101, produto_id: 2, quantidade: 1, preco_unitario: 6.5, subtotal: 6.5, unidade_comercial: 'UN', unidade: 'UN', produto_nome: 'Bala Não Fiscal' },
    { id: 3, venda_id: 101, produto_id: 3, quantidade: 1, preco_unitario: 12.5, subtotal: 12.5, unidade_comercial: 'UN', unidade: 'UN', produto_nome: 'Refrigerante Não Fiscal' }
  ];

  const recebimentos = [{ id: 1, venda_id: 101, forma_pagamento: 'pix', valor: 27.5, status: 'aprovado' }];
  const configuracoes = [
    { chave: 'nome_empresa', valor: 'ESQUINÃO DA ECONOMIA' },
    { chave: 'cnpj', valor: '65957340000150' },
    { chave: 'endereco', valor: 'Rua Vereador José Rodrigues Soares, S/N' },
    { chave: 'cidade_uf', valor: 'Juazeiro do Norte - CE' }
  ];

  const dbStub = {
    get(sql, params, cb) {
      if (sql.includes('FROM nfce_notas')) return cb(null, note);
      if (sql.includes('FROM vendas WHERE id = ?')) return cb(null, venda);
      return cb(null, null);
    },
    all(sql, params, cb) {
      if (sql.includes('FROM vendas_itens')) return cb(null, itens);
      if (sql.includes('FROM venda_recebimentos')) return cb(null, recebimentos);
      if (sql.includes('FROM venda_pagamentos')) return cb(null, []);
      if (sql.includes('FROM configuracoes')) return cb(null, configuracoes);
      return cb(null, []);
    },
    run() {},
    serialize(fn) { if (typeof fn === 'function') fn(); }
  };

  const pdfBuilderStub = {
    buildPdfBase64FromTexto() {
      return Buffer.from('fake-pdf').toString('base64');
    }
  };

  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: dbStub
  };

  require.cache[pdfBuilderPath] = {
    id: pdfBuilderPath,
    filename: pdfBuilderPath,
    loaded: true,
    exports: pdfBuilderStub
  };

  delete require.cache[require.resolve(servicePath)];
  return { dbStub };
}

function xmlStub() {
  return `<?xml version="1.0"?>
<nfeProc>
  <NFe>
    <infNFe Id="NFe23260765957340000150650010000020081591476774">
      <ide><nNF>2010</nNF><serie>1</serie><dhEmi>2026-07-31T15:00:00-03:00</dhEmi><tpAmb>2</tpAmb></ide>
      <emit><CNPJ>65957340000150</CNPJ><xNome>ESQUINÃO DA ECONOMIA</xNome></emit>
      <det nItem="1"><prod><xProd>Pitú Fiscal</xProd><vProd>8.50</vProd></prod></det>
      <det nItem="2"><prod><xProd>XML_ITEM_2</xProd><vProd>0.00</vProd></prod></det>
      <total><ICMSTot><vICMS>1.00</vICMS><vPIS>0.10</vPIS><vCOFINS>0.20</vCOFINS><vNF>8.50</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><nProt>323260000199999</nProt><chNFe>23260765957340000150650010000020081591476774</chNFe></infProt></protNFe>
</nfeProc>`;
}

async function run() {
  installDbStub();

  const {
    gerarComprovanteComercialPosFiscal,
    contarItensNoHtml
  } = require(servicePath);

  const routes = fs.readFileSync(routesPath, 'utf8');
  const front = fs.readFileSync(frontPath, 'utf8');
  assert.ok(routes.includes('/comprovante-comercial/venda/:vendaId'), 'rota comercial esperada');
  assert.ok(routes.includes('X-CDS-Itens-Banco'), 'header de auditoria do backend');
  assert.ok(front.includes('imprimirComprovanteComercialPosFiscal'), 'frontend chama o fluxo pós-fiscal');
  assert.ok(front.includes('logAuditoriaRcf101Frontend'), 'frontend registra auditoria de itens');

  const resultado = await gerarComprovanteComercialPosFiscal(101, { salvarSnapshot: true });

  assert.strictEqual(resultado.qtdItens, 3, 'Banco deve ter 3 itens');
  assert.strictEqual(resultado.qtdItensHtml, 3, 'HTML deve ter 3 itens');
  assert.ok(resultado.html.includes('Pitú Fiscal'));
  assert.ok(resultado.html.includes('Bala Não Fiscal'));
  assert.ok(resultado.html.includes('Refrigerante Não Fiscal'));
  assert.strictEqual(contarItensNoHtml(resultado.html, resultado.itens), 3, 'Contagem HTML deve bater com banco');

  const snapshotDir = path.join(process.env.FISCAL_DIR, 'comprovantes', `venda-${101}`);
  assert.ok(fs.existsSync(path.join(snapshotDir, 'comprovante.json')), 'snapshot JSON');
  assert.ok(fs.existsSync(path.join(snapshotDir, 'comprovante.html')), 'snapshot HTML');
  assert.ok(fs.existsSync(path.join(snapshotDir, 'comprovante.pdf')), 'snapshot PDF');

  const auditJson = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'comprovante.json'), 'utf8'));
  assert.strictEqual(auditJson.itensBanco, 3);
  assert.strictEqual(auditJson.itensApi, 3);
  assert.strictEqual(auditJson.itensHtml, 3);

  const htmlCount = (resultado.html.match(/Pitú Fiscal|Bala Não Fiscal|Refrigerante Não Fiscal/gi) || []).length;
  assert.strictEqual(htmlCount, 3, 'HTML deve incluir exatamente os 3 itens do cenário');

  console.log('RCF-10.1 end-to-end OK — banco, API, HTML e snapshot alinhados');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
