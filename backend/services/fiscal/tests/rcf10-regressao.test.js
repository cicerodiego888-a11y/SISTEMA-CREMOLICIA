/**
 * RCF-10 — Regressão: XML fiscal × comprovante comercial
 *
 * Garante:
 * - XML continua somente fiscal (itens/pag/vNF)
 * - Comprovante montado pela venda (nunca XML.dets / XML.pag / XML.vNF)
 * - DANFE permanece no caminho fiscal
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const svcComercial = path.join(root, 'services/comercial/ComprovanteComercialPosFiscalService.js');
const svcRemontado = path.join(root, 'services/fiscal/ComprovanteRemontadoService.js');
const routesPath = path.join(root, 'rotas/fiscal.js');
const emissorPath = path.join(root, 'services/fiscal/emissor.js');

const {
  extrairCarimboNfce,
  montarHtmlComprovanteComercial,
  assertComprovanteTransparente
} = require(svcComercial);

const CHAVE = '23260765957340000150650010000020991591476774';

function xmlMistoFiscal() {
  // XML com 1 det e vNF=5; venda terá 2 itens e total 20
  return `<?xml version="1.0"?>
<NFe>
  <infNFe Id="NFe${CHAVE}">
    <ide><nNF>2099</nNF><serie>1</serie><tpAmb>2</tpAmb><dhEmi>2026-07-31T16:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>65957340000150</CNPJ><xNome>EMPRESA</xNome></emit>
    <det nItem="1"><prod><xProd>SOMENTE_FISCAL_XML</xProd><qCom>1.0000</qCom><vProd>5.00</vProd></prod></det>
    <total><ICMSTot><vICMS>0.50</vICMS><vPIS>0.05</vPIS><vCOFINS>0.10</vCOFINS><vNF>5.00</vNF></ICMSTot></total>
    <pag><detPag><tPag>01</tPag><vPag>5.00</vPag></detPag></pag>
  </infNFe>
</NFe>`;
}

function run() {
  const srcComercial = fs.readFileSync(svcComercial, 'utf8');
  const srcRemontado = fs.readFileSync(svcRemontado, 'utf8');
  const routes = fs.readFileSync(routesPath, 'utf8');
  const emissor = fs.existsSync(emissorPath) ? fs.readFileSync(emissorPath, 'utf8') : '';

  // Serviço comercial não monta itens a partir de <det>
  assert.ok(srcComercial.includes('vendas_itens') || srcComercial.includes('RCF-10'), 'RCF-10 presente');
  assert.ok(!/match\(.*<det/.test(srcComercial.split('montarHtml')[1] || ''), 'HTML não parseia dets');
  assert.ok(srcComercial.includes('venda.total') || srcComercial.includes('vendas.total')
    || srcComercial.includes('venda.total'), 'total da venda');
  assert.ok(srcComercial.includes('Nunca') || srcComercial.includes('nunca')
    || srcComercial.includes('APENAS'), 'documenta uso restrito da NFC-e');

  // Alias RCF-09 → RCF-10
  assert.ok(srcRemontado.includes('gerarComprovanteComercialPosFiscal'), 'RCF-09 delega RCF-10');
  assert.ok(routes.includes('comprovante-comercial'), 'rota RCF-10');
  assert.ok(routes.includes('/danfe/'), 'DANFE fiscal permanece');

  // RCF-08/emissao: validação fiscal no emissor (se existir)
  if (emissor) {
    assert.ok(
      /valor_fiscal|RCF-08|fiscal/i.test(emissor),
      'emissor mantém caminho fiscal'
    );
  }

  const xml = xmlMistoFiscal();
  const xmlCopy = xml;
  const carimbo = extrairCarimboNfce({
    chave_acesso: CHAVE,
    numero: 2099,
    serie: 1,
    protocolo: '323260000188888',
    ambiente: 2,
    qr_code_url: 'https://qr.exemplo/rcf10',
    xml_enviado: xml
  }, xml);

  // XML imutável + só carimbo
  assert.strictEqual(xml, xmlCopy);
  assert.strictEqual(carimbo.qtdDetXml, 1);
  assert.strictEqual(carimbo.vNF, 5);
  assert.strictEqual(String(carimbo.numero), '2099');

  const venda = { total: 20, valor_fiscal: 5, valor_nao_fiscal: 15 };
  const itens = [
    { produto_nome: 'Item Fiscal', quantidade: 1, preco_unitario: 5, valor_total: 5 },
    { produto_nome: 'Item NaoFiscal', quantidade: 1, preco_unitario: 15, valor_total: 15 }
  ];
  const pagamentos = [
    { forma_pagamento: 'dinheiro', valor: 8 },
    { forma_pagamento: 'pix', valor: 12 }
  ];

  const html = montarHtmlComprovanteComercial({
    venda,
    itens,
    pagamentos,
    empresa: { nome: 'EMPRESA', cnpj: '65957340000150' },
    carimbo
  });

  // Nunca usar XML para itens
  assert.ok(!html.includes('SOMENTE_FISCAL_XML'), 'não imprime xProd do XML');
  assert.ok(html.includes('Item Fiscal'));
  assert.ok(html.includes('Item NaoFiscal'));

  // Nunca usar XML.vNF como total
  assert.ok(html.includes('20,00'), 'total = vendas.total');
  // vNF=5 não deve ser o TOTAL DA COMPRA
  const afterTotal = html.split('TOTAL DA COMPRA')[1] || '';
  assert.ok(afterTotal.includes('20,00'), 'bloco total geral');

  // Nunca usar <pag> do XML (vPag 5,00 único)
  assert.ok(html.includes('8,00') || html.includes('8.00') || /8,00/.test(html));
  assert.ok(html.includes('12,00') || /12,00/.test(html));

  // Carimbo NFC-e presente
  assert.ok(html.replace(/\s/g, '').includes(CHAVE));
  assert.ok(html.includes('2099'));
  assert.ok(html.includes('323260000188888'));

  // Transparente
  assertComprovanteTransparente(html);
  assert.ok(!/\bICMS\b/.test(html.replace(/SEM\s+VALOR\s+FISCAL/gi, '')));

  console.log('RCF-10 regressão OK — XML fiscal; comprovante comercial; sem uso de dets/pag/vNF');
}

run();
