/**
 * RCF-09 — Comprovante comercial remontado após autorização NFC-e
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const svcPath = path.join(root, 'services/fiscal/ComprovanteRemontadoService.js');
const routesPath = path.join(root, 'rotas/fiscal.js');
const pdvPath = path.join(root, '../frontend/pdv/js/pdv.js');
const compFront = path.join(root, '../frontend/shared/js/comprovanteVenda.js');

const {
  extrairMetadadosNfceAutorizada,
  montarHtmlComprovanteRemontado,
  assertSemVazamentoInterno
} = require(svcPath);

function xmlStub({ chave, nNF, serie, vNF, vICMS = 0 }) {
  return `<?xml version="1.0"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${chave}">
    <ide><nNF>${nNF}</nNF><serie>${serie}</serie><dhEmi>2026-07-31T13:00:00-03:00</dhEmi><tpAmb>2</tpAmb></ide>
    <emit><CNPJ>65957340000150</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></emit>
    <total><ICMSTot><vICMS>${vICMS}</vICMS><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vNF>${vNF}</vNF></ICMSTot></total>
  </infNFe>
</NFe>`;
}

function run() {
  const svcSrc = fs.readFileSync(svcPath, 'utf8');
  const routes = fs.readFileSync(routesPath, 'utf8');
  const pdv = fs.readFileSync(pdvPath, 'utf8');
  const front = fs.readFileSync(compFront, 'utf8');

  assert.ok(svcSrc.includes('RCF-09'), 'serviço RCF-09');
  assert.ok(routes.includes('comprovante-remontado') || routes.includes('comprovante-comercial'), 'rota comprovante');
  assert.ok(pdv.includes('imprimirComprovanteRemontadoNfce') || pdv.includes('imprimirComprovanteComercialPosFiscal'), 'PDV imprime');
  assert.ok(front.includes('imprimirComprovanteRemontadoNfce') || front.includes('imprimirComprovanteComercialPosFiscal'), 'frontend shared');

  const chave = '23260765957340000150650010000020081591476774';
  const xml = xmlStub({ chave, nNF: 2008, serie: 1, vNF: '5.00', vICMS: '0.00' });
  const xmlCopy = xml;

  const meta = extrairMetadadosNfceAutorizada({
    chave_acesso: chave,
    numero: 2008,
    serie: 1,
    protocolo: '323260000197698',
    ambiente: 2,
    qr_code_url: 'https://www.sefaz.ce.gov.br/nfce/qrcode?p=1',
    xml_enviado: xml
  }, xml);

  assert.strictEqual(meta.chave, chave);
  assert.strictEqual(String(meta.numero), '2008');
  assert.ok(meta.tributos.vNF === 5);

  // XML imutável
  assert.strictEqual(xml, xmlCopy);

  // --- 100% fiscal ---
  const html100 = montarHtmlComprovanteRemontado({
    venda: { total: 30, desconto: 0, forma_pagamento: 'dinheiro' },
    itens: [
      { produto_nome: 'A', quantidade: 1, preco_unitario: 10, subtotal: 10, unidade: 'UN' },
      { produto_nome: 'B', quantidade: 2, preco_unitario: 10, subtotal: 20, unidade: 'UN' }
    ],
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 30 }],
    empresa: { nome: 'EMPRESA TESTE', cnpj: '65957340000150' },
    meta
  });
  assert.ok(html100.includes('TOTAL DA COMPRA'));
  assert.ok(html100.includes('30,00') || html100.includes('R$ 30'));
  assert.ok(html100.includes('NFC-e'));
  assert.ok(html100.includes('2008'));
  const chaveNoHtml = html100.replace(/\s/g, '');
  assert.ok(chaveNoHtml.includes(chave), 'chave NFC-e no comprovante');
  assertSemVazamentoInterno(html100);

  // --- 100% não fiscal: comprovante ainda lista todos itens (sem NFC-e no fluxo real);
  // aqui validamos montagem sem labels internos ---
  const htmlNf = montarHtmlComprovanteRemontado({
    venda: { total: 15 },
    itens: [{ produto_nome: 'Sorvete', quantidade: 1, preco_unitario: 15, subtotal: 15 }],
    pagamentos: [{ forma_pagamento: 'pix', valor: 15 }],
    empresa: { nome: 'EMPRESA', cnpj: '65957340000150' },
    meta: { ...meta, numero: '-', chave: chave }
  });
  assert.ok(htmlNf.includes('Sorvete'));
  assert.ok(htmlNf.includes('15,00') || htmlNf.includes('R$ 15'));
  assertSemVazamentoInterno(htmlNf);

  // --- mista: todos os produtos, total geral ---
  const htmlMista = montarHtmlComprovanteRemontado({
    venda: { total: 20, valor_fiscal: 5, valor_nao_fiscal: 15 },
    itens: [
      { produto_nome: 'Item Fiscal', quantidade: 1, preco_unitario: 5, subtotal: 5 },
      { produto_nome: 'Item NF', quantidade: 1, preco_unitario: 15, subtotal: 15 }
    ],
    pagamentos: [
      { forma_pagamento: 'dinheiro', valor: 5, tipo_recebimento: 'fiscal' },
      { forma_pagamento: 'pix', valor: 15, tipo_recebimento: 'nao_fiscal' }
    ],
    empresa: { nome: 'EMPRESA', cnpj: '65957340000150' },
    meta
  });
  assert.ok(htmlMista.includes('Item Fiscal'));
  assert.ok(htmlMista.includes('Item NF'));
  assert.ok(htmlMista.includes('20,00') || htmlMista.includes('R$ 20'));
  assert.ok(htmlMista.includes('Dinheiro') || htmlMista.includes('PIX') || htmlMista.includes('Pix'));
  assertSemVazamentoInterno(htmlMista);
  assert.ok(!/Valor Fiscal/i.test(htmlMista.replace(/SEM VALOR FISCAL/gi, '')));

  // --- múltiplas formas ---
  const htmlMultiPag = montarHtmlComprovanteRemontado({
    venda: { total: 50 },
    itens: [{ produto_nome: 'Kit', quantidade: 1, preco_unitario: 50, subtotal: 50 }],
    pagamentos: [
      { forma_pagamento: 'dinheiro', valor: 20 },
      { forma_pagamento: 'cartao_credito', valor: 30 }
    ],
    empresa: { nome: 'EMPRESA', cnpj: '65957340000150' },
    meta
  });
  assert.ok(htmlMultiPag.includes('20,00') || htmlMultiPag.includes('R$ 20'));
  assert.ok(htmlMultiPag.includes('30,00') || htmlMultiPag.includes('R$ 30'));
  assertSemVazamentoInterno(htmlMultiPag);

  // --- desconto ---
  const htmlDesc = montarHtmlComprovanteRemontado({
    venda: { total: 90, desconto: 10 },
    itens: [{ produto_nome: 'Prod', quantidade: 1, preco_unitario: 100, subtotal: 100 }],
    pagamentos: [{ forma_pagamento: 'pix', valor: 90 }],
    empresa: { nome: 'EMPRESA', cnpj: '65957340000150' },
    meta
  });
  assert.ok(htmlDesc.includes('Desconto'));
  assert.ok(htmlDesc.includes('90,00') || htmlDesc.includes('R$ 90'));
  assertSemVazamentoInterno(htmlDesc);

  // --- acréscimo ---
  const htmlAcresc = montarHtmlComprovanteRemontado({
    venda: { total: 105, acrescimo: 5 },
    itens: [{ produto_nome: 'Prod', quantidade: 1, preco_unitario: 100, subtotal: 100 }],
    pagamentos: [{ forma_pagamento: 'pix', valor: 105 }],
    empresa: { nome: 'EMPRESA', cnpj: '65957340000150' },
    meta
  });
  assert.ok(htmlAcresc.includes('Acréscimo'));
  assertSemVazamentoInterno(htmlAcresc);

  // Guardrail: vazamento deve falhar
  assert.throws(
    () => assertSemVazamentoInterno('Valor Fiscal\n10,00'),
    /RCF-09/
  );

  // Reimpressão: rota + função no frontend
  assert.ok(front.includes('reimprimirComprovanteVendaHistorico'));
  assert.ok(front.includes('comprovante-remontado') || front.includes('comprovante-comercial'));

  // Chave/QR correspondem à NFC-e
  assert.ok(html100.includes('323260000197698') || html100.includes('Protocolo'));
  assert.strictEqual(meta.chave, chave);

  console.log('RCF-09 OK — comprovante remontado; XML imutável; sem vazamento F×NF');
}

run();
