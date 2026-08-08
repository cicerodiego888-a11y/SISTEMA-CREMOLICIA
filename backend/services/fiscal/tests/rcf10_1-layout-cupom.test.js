/**
 * RCF-10.1 — Layout oficial do cupom comercial (supermercado, não DANFE)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const svcPath = path.join(root, 'services/comercial/ComprovanteComercialPosFiscalService.js');

const {
  extrairCarimboNfce,
  montarHtmlComprovanteComercial,
  assertComprovanteTransparente,
  conteudoCanonico,
  formatarDataAutorizacao,
  SEP_DUPLO
} = require(svcPath);

const CHAVE = '23260765957340000150650010000020131357986042';
const QR = 'https://www.sefaz.ce.gov.br/nfce/qrcode?p=RCF101';

function xmlStub() {
  return `<?xml version="1.0"?>
<nfeProc>
  <NFe>
    <infNFe Id="NFe${CHAVE}">
      <ide><nNF>2013</nNF><serie>1</serie><dhEmi>2026-07-31T10:00:00-03:00</dhEmi><tpAmb>2</tpAmb></ide>
      <emit><CNPJ>65957340000150</CNPJ><xNome>IGNORE XML EMIT</xNome></emit>
      <det nItem="1"><prod><xProd>XML_ITEM</xProd><vProd>5.00</vProd></prod></det>
      <total><ICMSTot><vICMS>1</vICMS><vPIS>0.1</vPIS><vCOFINS>0.2</vCOFINS><vNF>5.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt>
    <nProt>323260000198223</nProt>
    <dhRecbto>2026-07-31T13:45:13-03:00</dhRecbto>
    <chNFe>${CHAVE}</chNFe>
  </infProt></protNFe>
</nfeProc>`;
}

function run() {
  assert.ok(fs.readFileSync(svcPath, 'utf8').includes('RCF-10.1') || fs.readFileSync(svcPath, 'utf8').includes('CUPOM DE VENDA'));

  const xml = xmlStub();
  const carimbo = extrairCarimboNfce({
    chave_acesso: CHAVE,
    numero: 2013,
    serie: 1,
    protocolo: '323260000198223',
    ambiente: 2,
    qr_code_url: QR,
    data_autorizacao: '2026-07-31T13:45:13-03:00',
    xml_enviado: xml,
    xml_retorno: '<ret><dhRecbto>2026-07-31T13:45:13-03:00</dhRecbto><nProt>323260000198223</nProt></ret>'
  }, xml);

  assert.strictEqual(String(carimbo.numero), '2013');
  assert.ok(formatarDataAutorizacao(carimbo.dataAutorizacao).startsWith('31/07/2026'));

  const empresa = {
    nome: 'ESQUINÃO DA ECONOMIA',
    cnpj: '65957340000150',
    endereco: 'Rua Vereador José Rodrigues Soares, S/N',
    cidade_uf: 'Juazeiro do Norte - CE'
  };

  const html = montarHtmlComprovanteComercial({
    venda: { total: 25.5 },
    itens: [
      { produto_nome: 'Aguardente Pitú Tradicional 350ml', quantidade: 2, valor_unitario: 5, valor_total: 10 },
      { produto_nome: 'Refrigerante Coca-Cola 2L', quantidade: 1, preco_unitario: 8, valor_total: 8 },
      { produto_nome: 'Chocolate Bis', quantidade: 3, valor_unitario: 2.5, valor_total: 7.5 }
    ],
    pagamentos: [
      { forma_pagamento: 'pix', valor: 20.5 },
      { forma_pagamento: 'cartao_credito', valor: 5 }
    ],
    empresa,
    carimbo,
    qrCodeDataUrl: null
  });

  // Layout cupom
  assert.ok(html.includes('CUPOM DE VENDA'));
  assert.ok(html.includes(SEP_DUPLO) || html.includes('===='));
  assert.ok(html.includes('Consolas') || html.includes('Courier New'));
  assert.ok(html.includes('ESQUINÃO DA ECONOMIA') || html.includes('ESQUIN&'));
  assert.ok(html.includes('65.957.340/0001-50'));
  assert.ok(html.includes('Rua Vereador José Rodrigues Soares'));
  assert.ok(html.includes('Juazeiro do Norte'));

  // Hierarquia / negrito
  assert.ok(html.includes('<b>CUPOM DE VENDA</b>') || html.includes('<b>CUPOM'));
  assert.ok(html.includes('<b>TOTAL DA COMPRA</b>') || /TOTAL DA COMPRA/.test(html));
  assert.ok(html.includes('<b>FORMA DE PAGAMENTO</b>'));
  assert.ok(html.includes('<b>CHAVE DE ACESSO</b>'));
  assert.ok(html.includes('<b>PROTOCOLO</b>'));

  // Itens venda (não XML)
  assert.ok(html.includes('Aguardente Pitú'));
  assert.ok(html.includes('Refrigerante Coca-Cola'));
  assert.ok(html.includes('Chocolate Bis'));
  assert.ok(!html.includes('XML_ITEM'));
  assert.ok(!html.includes('IGNORE XML EMIT'));

  // Colunas / pontilhado
  assert.ok(/\.\.+/.test(html), 'alinhamento pontilhado');
  assert.ok(html.includes('25,50') || html.includes('R$ 25,50'));
  assert.ok(html.includes('20,50') || html.includes('R$ 20,50'));

  // NFC-e carimbo
  assert.ok(html.includes('2013'));
  assert.ok(html.includes('Série 1') || html.includes('Série'));
  assert.ok(html.includes('31/07/2026'));
  assert.ok(html.replace(/\s/g, '').includes(CHAVE));
  assert.ok(html.includes('323260000198223'));
  assert.ok(html.includes('Consulte sua NFC-e') || html.includes(QR));

  // Rodapé comercial
  assert.ok(html.includes('Obrigado pela preferência'));
  assert.ok(html.includes('Volte Sempre'));

  // Não DANFE / não técnico
  assert.ok(!/DANFE/i.test(html));
  assert.ok(!/Documento Auxiliar/i.test(html));
  assert.ok(!/\bICMS\b/.test(html));
  assert.ok(!/Tributos Lei/i.test(html));
  assertComprovanteTransparente(html);

  // Reimpressão idêntica
  const html2 = montarHtmlComprovanteComercial({
    venda: { total: 25.5 },
    itens: [
      { produto_nome: 'Aguardente Pitú Tradicional 350ml', quantidade: 2, valor_unitario: 5, valor_total: 10 },
      { produto_nome: 'Refrigerante Coca-Cola 2L', quantidade: 1, preco_unitario: 8, valor_total: 8 },
      { produto_nome: 'Chocolate Bis', quantidade: 3, valor_unitario: 2.5, valor_total: 7.5 }
    ],
    pagamentos: [
      { forma_pagamento: 'pix', valor: 20.5 },
      { forma_pagamento: 'cartao_credito', valor: 5 }
    ],
    empresa,
    carimbo,
    qrCodeDataUrl: null
  });
  assert.strictEqual(conteudoCanonico(html), conteudoCanonico(html2));

  // Data autorização ≠ data venda (usa data_autorizacao)
  const carimboDh = extrairCarimboNfce({
    numero: 1,
    serie: 1,
    chave_acesso: CHAVE,
    data_autorizacao: '2026-07-31T13:45:13-03:00',
    xml_enviado: xml
  }, xml);
  assert.ok(formatarDataAutorizacao(carimboDh.dataAutorizacao).includes('13:45'));

  console.log('RCF-10.1 OK — layout oficial cupom comercial (não DANFE)');
}

run();
