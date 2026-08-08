/**
 * RCF-09.1 — Certificação do ComprovanteRemontadoService (pré GO-LIVE)
 *
 * Valida: XML imutável · venda completa · cabeçalho NFC-e · QR/chave ·
 * totais · reimpressão idêntica · casuística comercial.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '../../..');
const svcPath = path.join(root, 'services/fiscal/ComprovanteRemontadoService.js');

const {
  extrairMetadadosNfceAutorizada,
  montarHtmlComprovanteRemontado,
  certificarComprovanteRemontado,
  hashXmlSha256,
  conteudoCanonicoComprovante,
  assertSemVazamentoInterno
} = require(svcPath);

const CHAVE = '23260765957340000150650010000020081591476774';
const QR = 'https://www.sefaz.ce.gov.br/nfce/qrcode?p=CERT-RCF091';
const EMPRESA = { nome: 'EMPRESA TESTE LTDA', cnpj: '65957340000150' };

function xmlAutorizado({
  chave = CHAVE,
  nNF = 2008,
  serie = 1,
  vNF = '5.00',
  dets = 1,
  comAssinatura = true
} = {}) {
  const detsXml = Array.from({ length: dets }, (_, i) =>
    `<det nItem="${i + 1}"><prod><cProd>${i + 1}</cProd><xProd>ITEM_XML_${i + 1}</xProd><qCom>1.0000</qCom><vProd>5.00</vProd></prod></det>`
  ).join('');
  const sig = comAssinatura
    ? '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/><SignatureValue>ABC123</SignatureValue></Signature>'
    : '';
  return `<?xml version="1.0"?>
<nfeProc>
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${chave}">
      <ide><nNF>${nNF}</nNF><serie>${serie}</serie><dhEmi>2026-07-31T14:00:00-03:00</dhEmi><tpAmb>2</tpAmb></ide>
      <emit><CNPJ>65957340000150</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></emit>
      ${detsXml}
      <total><ICMSTot><vICMS>0.00</vICMS><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vNF>${vNF}</vNF></ICMSTot></total>
    </infNFe>
    ${sig}
  </NFe>
  <protNFe><infProt><nProt>323260000197698</nProt><chNFe>${chave}</chNFe></infProt></protNFe>
</nfeProc>`;
}

function notaBase(xml) {
  return {
    chave_acesso: CHAVE,
    numero: 2008,
    serie: 1,
    protocolo: '323260000197698',
    ambiente: 2,
    qr_code_url: QR,
    xml_enviado: xml,
    xml_retorno: '<ret><nProt>323260000197698</nProt></ret>',
    status: 'autorizada'
  };
}

function assertCabecalho(html, meta) {
  assert.ok(html.includes(String(meta.numero)), 'número NFC-e');
  assert.ok(html.includes(String(meta.serie)), 'série');
  assert.ok(html.replace(/\s/g, '').includes(meta.chave), 'chave');
  assert.ok(html.includes(String(meta.protocolo)), 'protocolo');
  assert.ok(/HOMOLOGA/i.test(html) || /PRODUÇÃO/i.test(html), 'ambiente');
  assert.ok(html.includes(QR) || /QR Code/i.test(html) || /Consulte via QR/i.test(html) || html.includes('QR:'), 'QR');
}

function runCaso(label, { venda, itens, pagamentos, xmlOpts = {} }) {
  const xml = xmlAutorizado(xmlOpts);
  const xmlCopy = xml;
  const hash0 = hashXmlSha256(xml);
  const nota = notaBase(xml);

  const cert = certificarComprovanteRemontado({
    venda,
    itens,
    pagamentos,
    empresa: EMPRESA,
    nota,
    xmlAutorizado: xml
  });

  assert.strictEqual(xml, xmlCopy, `${label}: XML string imutável`);
  assert.strictEqual(hashXmlSha256(xml), hash0, `${label}: hash XML estável`);
  assert.ok(cert.xmlImutavel, `${label}: xmlImutavel`);
  assert.ok(cert.reimpressaoIdentica, `${label}: reimpressão`);
  assert.ok(cert.ok, `${label}: divergências=${JSON.stringify(cert.divergencias)}`);
  assert.strictEqual(cert.qtdItensVenda, itens.length, `${label}: qtd itens = venda`);
  assert.strictEqual(cert.totalVenda, Number(venda.total), `${label}: total`);
  assert.strictEqual(cert.chave, CHAVE, `${label}: chave`);
  assertCabecalho(cert.html, cert.meta);
  assertSemVazamentoInterno(cert.html);

  // Σ produtos ≈ total (quando sem desconto/acréscimo/troco extras)
  const somaItens = Number(itens.reduce((s, i) => s + Number(i.subtotal != null ? i.subtotal : 0), 0).toFixed(2));
  const desc = Number(venda.desconto || 0);
  const acr = Number(venda.acrescimo || 0);
  const esperado = Number((somaItens - desc + acr).toFixed(2));
  if (desc === 0 && acr === 0 && somaItens > 0) {
    assert.ok(
      Math.abs(somaItens - Number(venda.total)) < 0.011 || Math.abs(esperado - Number(venda.total)) < 0.011,
      `${label}: Σ itens ≈ vendas.total (${somaItens} vs ${venda.total})`
    );
  }

  return cert;
}

function run() {
  assert.ok(fs.existsSync(svcPath), 'serviço existe');
  const src = fs.readFileSync(svcPath, 'utf8');
  assert.ok(src.includes('certificarComprovanteRemontado'), 'export certificar');
  assert.ok(src.includes('hashXmlSha256'), 'hash XML');
  assert.ok(src.includes('RCF-09'), 'RCF-09');

  // --- 1. Integridade XML (hash + assinatura + chave/núm/série) ---
  {
    const xml = xmlAutorizado({ dets: 1 });
    const hashA = crypto.createHash('sha256').update(xml, 'utf8').digest('hex');
    const meta = extrairMetadadosNfceAutorizada(notaBase(xml), xml);
    assert.strictEqual(meta.xmlHash, hashA);
    assert.strictEqual(meta.assinaturaPresente, true);
    assert.strictEqual(meta.chave, CHAVE);
    assert.strictEqual(String(meta.numero), '2008');
    assert.strictEqual(String(meta.serie), '1');
    assert.strictEqual(meta.qrCodeUrl, QR);
    assert.strictEqual(meta.qtdDetXml, 1);
    // serviço não muta
    extrairMetadadosNfceAutorizada(notaBase(xml), xml);
    assert.strictEqual(hashXmlSha256(xml), hashA);
  }

  // --- 2/3/4. Casos de teste ---

  // ✔ 100% Fiscal — itens venda = dets XML
  runCaso('100% fiscal', {
    venda: { total: 30, desconto: 0 },
    itens: [
      { produto_nome: 'Produto A', quantidade: 1, preco_unitario: 10, subtotal: 10, unidade: 'UN' },
      { produto_nome: 'Produto B', quantidade: 2, preco_unitario: 10, subtotal: 20, unidade: 'UN' }
    ],
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 30 }],
    xmlOpts: { dets: 2, vNF: '30.00' }
  });

  // ✔ 100% Não Fiscal (comprovante lista venda; NFC-e stub mínima)
  runCaso('100% não fiscal', {
    venda: { total: 15 },
    itens: [
      { produto_nome: 'Sorvete NF', quantidade: 1, preco_unitario: 15, subtotal: 15 }
    ],
    pagamentos: [{ forma_pagamento: 'pix', valor: 15 }],
    xmlOpts: { dets: 0, vNF: '0.00' }
  });

  // ✔ Mista — itens comprovante > dets XML
  {
    const cert = runCaso('mista', {
      venda: { total: 20, valor_fiscal: 5, valor_nao_fiscal: 15 },
      itens: [
        { produto_nome: 'Item Fiscal', quantidade: 1, preco_unitario: 5, subtotal: 5 },
        { produto_nome: 'Item NaoFiscal', quantidade: 1, preco_unitario: 15, subtotal: 15 }
      ],
      pagamentos: [
        { forma_pagamento: 'dinheiro', valor: 5 },
        { forma_pagamento: 'pix', valor: 15 }
      ],
      xmlOpts: { dets: 1, vNF: '5.00' }
    });
    assert.strictEqual(cert.qtdItensVenda, 2);
    assert.strictEqual(cert.qtdDetXml, 1);
    assert.ok(cert.qtdItensVenda !== cert.qtdDetXml, 'itens ≠ dets XML');
  }

  // ✔ Desconto
  {
    const cert = runCaso('desconto', {
      venda: { total: 90, desconto: 10 },
      itens: [{ produto_nome: 'Prod Desc', quantidade: 1, preco_unitario: 100, subtotal: 100 }],
      pagamentos: [{ forma_pagamento: 'pix', valor: 90 }],
      xmlOpts: { dets: 1, vNF: '90.00' }
    });
    assert.ok(cert.html.includes('Desconto'));
  }

  // ✔ Acréscimo
  {
    const cert = runCaso('acréscimo', {
      venda: { total: 105, acrescimo: 5 },
      itens: [{ produto_nome: 'Prod Acr', quantidade: 1, preco_unitario: 100, subtotal: 100 }],
      pagamentos: [{ forma_pagamento: 'pix', valor: 105 }],
      xmlOpts: { dets: 1, vNF: '105.00' }
    });
    assert.ok(cert.html.includes('Acréscimo'));
  }

  // ✔ Troco
  {
    const cert = runCaso('troco', {
      venda: { total: 50, troco: 10 },
      itens: [{ produto_nome: 'Prod Troco', quantidade: 1, preco_unitario: 50, subtotal: 50 }],
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 60 }],
      xmlOpts: { dets: 1, vNF: '50.00' }
    });
    assert.ok(cert.html.includes('Troco'));
    assert.ok(cert.html.includes('10,00') || cert.html.includes('R$ 10'));
  }

  // ✔ PIX + Dinheiro
  runCaso('PIX + Dinheiro', {
    venda: { total: 40 },
    itens: [{ produto_nome: 'Combo PIX', quantidade: 1, preco_unitario: 40, subtotal: 40 }],
    pagamentos: [
      { forma_pagamento: 'pix', valor: 25 },
      { forma_pagamento: 'dinheiro', valor: 15 }
    ],
    xmlOpts: { dets: 1, vNF: '40.00' }
  });

  // ✔ Cartão + Dinheiro
  runCaso('Cartão + Dinheiro', {
    venda: { total: 80 },
    itens: [{ produto_nome: 'Combo Cartao', quantidade: 1, preco_unitario: 80, subtotal: 80 }],
    pagamentos: [
      { forma_pagamento: 'cartao_credito', valor: 50 },
      { forma_pagamento: 'dinheiro', valor: 30 }
    ],
    xmlOpts: { dets: 1, vNF: '80.00' }
  });

  // ✔ Cancelamento — remontagem usa XML autorizado + venda persistida
  {
    const cert = runCaso('cancelamento (histórico)', {
      venda: { total: 25, status: 'cancelada' },
      itens: [{ produto_nome: 'Venda Cancelada', quantidade: 1, preco_unitario: 25, subtotal: 25 }],
      pagamentos: [{ forma_pagamento: 'pix', valor: 25 }],
      xmlOpts: { dets: 1, vNF: '25.00' }
    });
    assert.ok(cert.html.includes('Venda Cancelada'));
    assert.strictEqual(cert.chave, CHAVE);
  }

  // ✔ Reimpressão
  {
    const xml = xmlAutorizado({ dets: 1 });
    const nota = notaBase(xml);
    const payload = {
      venda: { total: 12 },
      itens: [{ produto_nome: 'Reimp', quantidade: 1, preco_unitario: 12, subtotal: 12 }],
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 12 }],
      empresa: EMPRESA,
      meta: extrairMetadadosNfceAutorizada(nota, xml),
      qrCodeDataUrl: null
    };
    const h1 = montarHtmlComprovanteRemontado(payload);
    const h2 = montarHtmlComprovanteRemontado(payload);
    assert.strictEqual(conteudoCanonicoComprovante(h1), conteudoCanonicoComprovante(h2));
    assert.ok(h1.replace(/\s/g, '').includes(CHAVE));
    assert.ok(h1.includes('2008'));
  }

  // ✔ Kits
  {
    const cert = runCaso('kits', {
      venda: { total: 45 },
      itens: [{
        produto_nome: 'Kit Festa',
        quantidade: 1,
        preco_unitario: 45,
        subtotal: 45,
        kit_itens: [
          { produto_nome: 'Copo', quantidade: 2 },
          { produto_nome: 'Colher', quantidade: 2 }
        ]
      }],
      pagamentos: [{ forma_pagamento: 'pix', valor: 45 }],
      xmlOpts: { dets: 1, vNF: '45.00' }
    });
    assert.ok(cert.html.includes('Kit Festa'));
    assert.ok(cert.html.includes('Copo'));
    assert.ok(cert.html.includes('Colher'));
  }

  // ✔ Casquinha
  {
    const cert = runCaso('casquinha', {
      venda: { total: 12 },
      itens: [{
        produto_nome: 'Casquinha',
        quantidade: 1,
        preco_unitario: 12,
        subtotal: 12,
        quantidade_bolas: 2,
        sabores: [{ nome: 'Chocolate' }, { nome: 'Morango' }]
      }],
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 12 }],
      xmlOpts: { dets: 1, vNF: '12.00' }
    });
    assert.ok(/CASQUINHA|Casquinha/i.test(cert.html));
    assert.ok(cert.html.includes('Chocolate'));
    assert.ok(cert.html.includes('Morango'));
  }

  // ✔ Peso
  {
    const cert = runCaso('peso', {
      venda: { total: 37.5 },
      itens: [{
        produto_nome: 'Sorvete kg',
        quantidade: 1.5,
        preco_unitario: 25,
        subtotal: 37.5,
        unidade: 'KG',
        unidade_comercial: 'KG',
        forma_comercializacao: 'PESO'
      }],
      pagamentos: [{ forma_pagamento: 'pix', valor: 37.5 }],
      xmlOpts: { dets: 1, vNF: '37.50' }
    });
    assert.ok(cert.html.includes('Sorvete kg'));
    assert.ok(cert.html.includes('KG') || cert.html.includes('1.5') || cert.html.includes('1,5'));
  }

  // ✔ Múltiplas unidades comerciais
  runCaso('múltiplas UCs', {
    venda: { total: 55 },
    itens: [
      { produto_nome: 'Unidade UN', quantidade: 2, preco_unitario: 10, subtotal: 20, unidade: 'UN' },
      {
        produto_nome: 'Peso KG',
        quantidade: 0.5,
        preco_unitario: 40,
        subtotal: 20,
        unidade: 'KG',
        unidade_comercial: 'KG',
        forma_comercializacao: 'PESO'
      },
      {
        produto_nome: 'Litro L',
        quantidade: 1,
        preco_unitario: 15,
        subtotal: 15,
        unidade: 'L',
        unidade_comercial: 'L',
        forma_comercializacao: 'VOLUME'
      }
    ],
    pagamentos: [{ forma_pagamento: 'cartao_debito', valor: 55 }],
    xmlOpts: { dets: 2, vNF: '40.00' }
  });

  console.log('RCF-09.1 OK — certificação ComprovanteRemontadoService aprovada');
}

run();
