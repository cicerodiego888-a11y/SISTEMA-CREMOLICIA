/**
 * RCF-10 — Comprovante comercial pós-autorização (arquitetura transparente)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const svcPath = path.join(root, 'services/comercial/ComprovanteComercialPosFiscalService.js');
const routesPath = path.join(root, 'rotas/fiscal.js');
const pdvPath = path.join(root, '../frontend/pdv/js/pdv.js');
const frontPath = path.join(root, '../frontend/shared/js/comprovanteVenda.js');

const {
  extrairCarimboNfce,
  montarHtmlComprovanteComercial,
  assertComprovanteTransparente,
  conteudoCanonico,
  valorTotalItem
} = require(svcPath);

const CHAVE = '23260765957340000150650010000020081591476774';
const QR = 'https://www.sefaz.ce.gov.br/nfce/qrcode?p=RCF10';
const EMPRESA = {
  nome: 'ESQUINÃO DA ECONOMIA',
  cnpj: '65957340000150',
  endereco: 'Rua Vereador José Rodrigues Soares, S/N',
  cidade_uf: 'Juazeiro do Norte - CE'
};

function xmlFiscal({ dets = 1, vNF = '10.00', nNF = 3010, comPag = true } = {}) {
  const detsXml = Array.from({ length: dets }, (_, i) =>
    `<det nItem="${i + 1}"><prod><xProd>XML_ONLY_${i + 1}</xProd><qCom>1.0000</qCom><vProd>5.00</vProd></prod></det>`
  ).join('');
  const pag = comPag
    ? '<pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag></pag>'
    : '';
  return `<?xml version="1.0"?>
<nfeProc>
  <NFe>
    <infNFe Id="NFe${CHAVE}">
      <ide><nNF>${nNF}</nNF><serie>1</serie><dhEmi>2026-07-31T15:00:00-03:00</dhEmi><tpAmb>2</tpAmb></ide>
      <emit><CNPJ>65957340000150</CNPJ><xNome>ESQUINÃO DA ECONOMIA</xNome></emit>
      ${detsXml}
      <total><ICMSTot><vICMS>1.00</vICMS><vPIS>0.10</vPIS><vCOFINS>0.20</vCOFINS><vNF>${vNF}</vNF></ICMSTot></total>
      ${pag}
    </infNFe>
  </NFe>
  <protNFe><infProt><nProt>323260000199999</nProt><chNFe>${CHAVE}</chNFe></infProt></protNFe>
</nfeProc>`;
}

function nota(xml) {
  return {
    chave_acesso: CHAVE,
    numero: 3010,
    serie: 1,
    protocolo: '323260000199999',
    ambiente: 2,
    qr_code_url: QR,
    data_autorizacao: '2026-07-31T15:00:00-03:00',
    xml_enviado: xml,
    xml_retorno: '<ret><nProt>323260000199999</nProt><dhRecbto>2026-07-31T15:00:00-03:00</dhRecbto></ret>'
  };
}

function montar(venda, itens, pagamentos, xmlOpts = {}) {
  const xml = xmlFiscal(xmlOpts);
  const carimbo = extrairCarimboNfce(nota(xml), xml);
  const html = montarHtmlComprovanteComercial({
    venda,
    itens,
    pagamentos,
    empresa: EMPRESA,
    carimbo,
    qrCodeDataUrl: null
  });
  return { html, carimbo, xml };
}

function run() {
  assert.ok(fs.existsSync(svcPath), 'serviço RCF-10');
  const routes = fs.readFileSync(routesPath, 'utf8');
  const pdv = fs.readFileSync(pdvPath, 'utf8');
  const front = fs.readFileSync(frontPath, 'utf8');

  assert.ok(routes.includes('comprovante-comercial'), 'rota comercial');
  assert.ok(routes.includes('ComprovanteComercialPosFiscalService'), 'rota usa serviço');
  assert.ok(front.includes('imprimirComprovanteComercialPosFiscal'), 'frontend');
  assert.ok(pdv.includes('imprimirComprovanteComercialPosFiscal'), 'PDV');
  assert.ok(front.includes('reimprimirComprovanteVendaHistorico'), 'reimpressão');
  assert.ok(front.includes('comprovante-comercial'), 'URL comercial');

  // ✔ somente fiscal
  {
    const { html, carimbo } = montar(
      { total: 22 },
      [
        { produto_nome: 'Aguardente Pitú', quantidade: 2, preco_unitario: 5, valor_total: 10 },
        { produto_nome: 'Refrigerante', quantidade: 1, preco_unitario: 6, valor_total: 6 },
        { produto_nome: 'Chocolate', quantidade: 3, preco_unitario: 2, valor_total: 6 }
      ],
      [
        { forma_pagamento: 'pix', valor: 5 },
        { forma_pagamento: 'dinheiro', valor: 17 }
      ],
      { dets: 3, vNF: '22.00' }
    );
    assert.ok(html.includes('Aguardente Pitú'));
    assert.ok(html.includes('Refrigerante'));
    assert.ok(html.includes('Chocolate'));
    assert.ok(html.includes('TOTAL DA COMPRA'));
    assert.ok(html.includes('22,00'));
    assert.ok(html.includes('3010'));
    assert.ok(html.replace(/\s/g, '').includes(CHAVE));
    assert.ok(html.includes('323260000199999'));
    assert.ok(html.includes(QR) || /QR CODE/i.test(html));
    assert.strictEqual(carimbo.vNF, 22);
    assertComprovanteTransparente(html);
  }

  // ✔ somente não fiscal (itens venda; XML stub mínimo)
  {
    const { html } = montar(
      { total: 15 },
      [{ produto_nome: 'Sorvete NF', quantidade: 1, preco_unitario: 15, valor_total: 15 }],
      [{ forma_pagamento: 'pix', valor: 15 }],
      { dets: 0, vNF: '0.00' }
    );
    assert.ok(html.includes('Sorvete NF'));
    assert.ok(html.includes('15,00'));
    assertComprovanteTransparente(html);
  }

  // ✔ mista — todos itens; total = vendas.total ≠ vNF
  {
    const { html, carimbo } = montar(
      { total: 20, valor_fiscal: 5, valor_nao_fiscal: 15 },
      [
        { produto_nome: 'Item Fiscal', quantidade: 1, preco_unitario: 5, valor_total: 5 },
        { produto_nome: 'Item NaoFiscal', quantidade: 1, preco_unitario: 15, valor_total: 15 }
      ],
      [
        { forma_pagamento: 'dinheiro', valor: 5 },
        { forma_pagamento: 'pix', valor: 15 }
      ],
      { dets: 1, vNF: '5.00' }
    );
    assert.ok(html.includes('Item Fiscal'));
    assert.ok(html.includes('Item NaoFiscal'));
    assert.ok(html.includes('20,00'));
    assert.ok(!html.includes('5,00') || html.includes('20,00')); // total geral
    assert.strictEqual(carimbo.qtdDetXml, 1);
    assert.ok(!/\bICMS\b/.test(html));
    assert.ok(!/\bPIS\b/.test(html));
    assert.ok(!/\bCOFINS\b/.test(html));
    assertComprovanteTransparente(html);
  }

  // ✔ PIX / Dinheiro / Cartão / PIX+Dinheiro
  for (const [label, pags] of [
    ['PIX', [{ forma_pagamento: 'pix', valor: 10 }]],
    ['Dinheiro', [{ forma_pagamento: 'dinheiro', valor: 10 }]],
    ['Cartão', [{ forma_pagamento: 'cartao_credito', valor: 10 }]],
    ['PIX+Dinheiro', [
      { forma_pagamento: 'pix', valor: 4 },
      { forma_pagamento: 'dinheiro', valor: 6 }
    ]]
  ]) {
    const { html } = montar(
      { total: 10 },
      [{ produto_nome: `Prod ${label}`, quantidade: 1, preco_unitario: 10, valor_total: 10 }],
      pags,
      { dets: 1, vNF: '10.00' }
    );
    assert.ok(html.includes(`Prod ${label}`), label);
    assertComprovanteTransparente(html);
  }

  // ✔ Kits
  {
    const { html } = montar(
      { total: 45 },
      [{
        produto_nome: 'Kit Festa',
        quantidade: 1,
        preco_unitario: 45,
        valor_total: 45,
        kit_itens: [
          { produto_nome: 'Copo', quantidade: 2 },
          { produto_nome: 'Colher', quantidade: 2 }
        ]
      }],
      [{ forma_pagamento: 'pix', valor: 45 }],
      { dets: 1, vNF: '45.00' }
    );
    assert.ok(html.includes('Kit Festa'));
    assert.ok(html.includes('Copo'));
  }

  // ✔ Casquinha
  {
    const { html } = montar(
      { total: 12 },
      [{
        produto_nome: 'Casquinha',
        quantidade: 1,
        preco_unitario: 12,
        valor_total: 12,
        quantidade_bolas: 2,
        sabores: [{ nome: 'Chocolate' }, { nome: 'Morango' }]
      }],
      [{ forma_pagamento: 'dinheiro', valor: 12 }],
      { dets: 1, vNF: '12.00' }
    );
    assert.ok(/CASQUINHA|Casquinha/i.test(html));
    assert.ok(html.includes('Chocolate'));
  }

  // ✔ Pesáveis
  {
    const { html } = montar(
      { total: 37.5 },
      [{
        produto_nome: 'Sorvete kg',
        quantidade: 1.5,
        preco_unitario: 25,
        valor_total: 37.5,
        unidade: 'KG',
        forma_comercializacao: 'PESO'
      }],
      [{ forma_pagamento: 'pix', valor: 37.5 }],
      { dets: 1, vNF: '37.50' }
    );
    assert.ok(html.includes('Sorvete kg'));
    assert.ok(html.includes('KG') || html.includes('1,5') || html.includes('1.5'));
  }

  // ✔ Compostos
  {
    const { html } = montar(
      { total: 30 },
      [{
        produto_nome: 'Produto Composto',
        quantidade: 1,
        preco_unitario: 30,
        valor_total: 30,
        compostos: [
          { produto_nome: 'Base', quantidade: 1 },
          { produto_nome: 'Cobertura', quantidade: 1 }
        ]
      }],
      [{ forma_pagamento: 'cartao_debito', valor: 30 }],
      { dets: 1, vNF: '30.00' }
    );
    assert.ok(html.includes('Produto Composto'));
    assert.ok(html.includes('Base'));
    assert.ok(html.includes('Cobertura'));
  }

  // ✔ Reimpressão idêntica
  {
    const xml = xmlFiscal({ dets: 1, vNF: '10.00' });
    const carimbo = extrairCarimboNfce(nota(xml), xml);
    const payload = {
      venda: { total: 10 },
      itens: [{ produto_nome: 'Reimp', quantidade: 1, preco_unitario: 10, valor_total: 10 }],
      pagamentos: [{ forma_pagamento: 'pix', valor: 10 }],
      empresa: EMPRESA,
      carimbo,
      qrCodeDataUrl: null
    };
    const h1 = montarHtmlComprovanteComercial(payload);
    const h2 = montarHtmlComprovanteComercial(payload);
    assert.strictEqual(conteudoCanonico(h1), conteudoCanonico(h2));
  }

  // valor_total preferido
  assert.strictEqual(valorTotalItem({ valor_total: 9, subtotal: 1, quantidade: 1, preco_unitario: 2 }), 9);

  // Guardrail
  assert.throws(() => assertComprovanteTransparente('Valor Fiscal 10'), /RCF-10/);
  assert.throws(() => assertComprovanteTransparente('ICMS: 1,00'), /RCF-10/);

  console.log('RCF-10 OK — comprovante comercial transparente pós-autorização');
}

run();
