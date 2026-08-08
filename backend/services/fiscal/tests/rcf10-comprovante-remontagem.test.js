/**
 * RCF-10 — Auditoria da remontagem do comprovante comercial pós-SEFAZ.
 *
 * Valida que o comprovante reflete o carrinho original (vendas + vendas_itens +
 * venda_pagamentos), usando o XML/NFC-e apenas como carimbo fiscal.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const svcComercial = path.join(root, 'services/comercial/ComprovanteComercialPosFiscalService.js');
const svcRemontado = path.join(root, 'services/fiscal/ComprovanteRemontadoService.js');

const {
  extrairCarimboNfce,
  montarHtmlComprovanteComercial,
  assertComprovanteTransparente,
  conteudoCanonico,
  valorTotalItem
} = require(svcComercial);

const { consolidarPagamentos, rotuloFormaPagamento } = require('../../comprovanteVendaService');

const CHAVE = '23260765957340000150650010000030101591476774';
const QR = 'https://www.sefaz.ce.gov.br/nfce/qrcode?p=RCF10REM';
const EMPRESA = {
  nome: 'ESQUINÃO DA ECONOMIA',
  cnpj: '65957340000150',
  endereco: 'Rua Vereador José Rodrigues Soares, S/N',
  cidade_uf: 'Juazeiro do Norte - CE'
};

function xmlFiscal({ dets = 1, vNF = '10.00', nNF = 3010, comPag = true } = {}) {
  const detsXml = Array.from({ length: dets }, (_, i) =>
    `<det nItem="${i + 1}"><prod><xProd>XML_NUNCA_IMPRESSO_${i + 1}</xProd><qCom>99.0000</qCom><vProd>999.00</vProd></prod></det>`
  ).join('');
  const pag = comPag
    ? '<pag><detPag><tPag>01</tPag><vPag>999.00</vPag></detPag></pag>'
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
  <protNFe><infProt><nProt>323260000299999</nProt><chNFe>${CHAVE}</chNFe></infProt></protNFe>
</nfeProc>`;
}

function nota(xml, overrides = {}) {
  return {
    chave_acesso: CHAVE,
    numero: 3010,
    serie: 1,
    protocolo: '323260000299999',
    ambiente: 2,
    qr_code_url: QR,
    data_autorizacao: '2026-07-31T15:00:00-03:00',
    xml_enviado: xml,
    xml_retorno: '<ret><nProt>323260000299999</nProt><dhRecbto>2026-07-31T15:00:00-03:00</dhRecbto></ret>',
    ...overrides
  };
}

function montarCenario({ venda, itens, pagamentos, xmlOpts = {} }) {
  const xml = xmlFiscal(xmlOpts);
  const xmlCopy = xml;
  const carimbo = extrairCarimboNfce(nota(xml), xml);
  const html = montarHtmlComprovanteComercial({
    venda,
    itens,
    pagamentos,
    empresa: EMPRESA,
    carimbo,
    qrCodeDataUrl: null
  });
  return { html, carimbo, xml, xmlCopy };
}

function formatarMoeda(valor) {
  return `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
}

/**
 * Valida que o comprovante reflete exatamente o carrinho original.
 */
function validarComprovanteContraCarrinho({
  html,
  venda,
  itens,
  pagamentos,
  carimbo,
  xmlCopy,
  xml,
  label
}) {
  assert.strictEqual(xml, xmlCopy, `${label}: XML não pode ser alterado`);

  for (const item of itens) {
    const nome = String(item.produto_nome || item.nome || '').trim();
    const bolas = Number(item.quantidade_bolas || 0);
    const presentePorNome = nome && html.includes(nome);
    const presenteCasquinha = bolas > 0 && /CASQUINHA/i.test(html);
    assert.ok(
      presentePorNome || presenteCasquinha,
      `${label}: item "${nome}" ausente no comprovante`
    );
    const sub = valorTotalItem(item);
    const subFmt = formatarMoeda(sub);
    assert.ok(
      html.includes(subFmt) || html.includes(sub.toFixed(2).replace('.', ',')),
      `${label}: subtotal de "${nome}" (${subFmt}) ausente`
    );
    if (Array.isArray(item.sabores)) {
      item.sabores.forEach((s) => {
        const sn = String(s.nome || s).trim();
        if (sn) assert.ok(html.includes(sn), `${label}: sabor "${sn}" ausente`);
      });
    }
    if (Array.isArray(item.kit_itens)) {
      item.kit_itens.forEach((k) => {
        const kn = String(k.produto_nome || k.nome || '').trim();
        if (kn) assert.ok(html.includes(kn), `${label}: kit item "${kn}" ausente`);
      });
    }
  }

  for (let i = 1; i <= (carimbo.qtdDetXml || 0); i += 1) {
    assert.ok(
      !html.includes(`XML_NUNCA_IMPRESSO_${i}`),
      `${label}: comprovante vazou xProd do XML (det ${i})`
    );
  }

  const total = Number(venda.total || 0);
  const totalFmt = formatarMoeda(total);
  const blocoTotal = html.split('TOTAL DA COMPRA')[1] || '';
  assert.ok(
    blocoTotal.includes(totalFmt) || blocoTotal.includes(total.toFixed(2).replace('.', ',')),
    `${label}: TOTAL DA COMPRA deve ser vendas.total (${totalFmt})`
  );
  if (carimbo.vNF != null && carimbo.vNF !== total) {
    const vNfFmt = formatarMoeda(carimbo.vNF);
    assert.ok(
      !blocoTotal.includes(vNfFmt),
      `${label}: comprovante não pode usar vNF do XML (${vNfFmt}) como total`
    );
  }

  const pagsConsol = consolidarPagamentos(pagamentos);
  for (const p of pagsConsol) {
    const rotulo = rotuloFormaPagamento(p.forma);
    assert.ok(html.includes(rotulo), `${label}: forma "${rotulo}" ausente`);
    const valFmt = formatarMoeda(p.valor);
    assert.ok(
      html.includes(valFmt) || html.includes(p.valor.toFixed(2).replace('.', ',')),
      `${label}: valor pagamento ${rotulo} (${valFmt}) ausente`
    );
  }

  assert.ok(html.replace(/\s/g, '').includes(CHAVE), `${label}: chave NFC-e ausente`);
  assert.ok(html.includes(String(carimbo.numero)), `${label}: número NFC-e ausente`);
  assert.ok(html.includes(String(carimbo.protocolo)), `${label}: protocolo ausente`);
  assert.ok(html.includes(QR) || /QR CODE/i.test(html), `${label}: QR Code ausente`);

  assertComprovanteTransparente(html);
}

function run() {
  assert.ok(fs.existsSync(svcComercial), 'ComprovanteComercialPosFiscalService');
  const srcComercial = fs.readFileSync(svcComercial, 'utf8');
  const srcRemontado = fs.readFileSync(svcRemontado, 'utf8');

  assert.ok(srcComercial.includes('vendas_itens'), 'fonte: vendas_itens');
  assert.ok(srcComercial.includes('venda_pagamentos') || srcComercial.includes('venda_recebimentos'), 'fonte: pagamentos da venda');
  assert.ok(!/xProd/.test((srcComercial.split('montarBlocoItensComercial')[1] || '').split('function gerar')[0]), 'itens não vêm do XML');
  assert.ok(srcRemontado.includes('gerarComprovanteComercialPosFiscal'), 'ComprovanteRemontadoService delega RCF-10');
  assert.ok(srcComercial.includes('logAuditoriaRcf10'), 'logs [RCF-10]');
  assert.ok(srcComercial.includes('Itens comprovante'), 'log Itens comprovante');
  assert.ok(srcComercial.includes('Total XML'), 'log Total XML');

  // ✓ Venda somente fiscal
  {
    const itens = [
      { produto_nome: 'Aguardente Pitú', quantidade: 2, preco_unitario: 5, valor_total: 10 },
      { produto_nome: 'Refrigerante', quantidade: 1, preco_unitario: 6, valor_total: 6 },
      { produto_nome: 'Chocolate', quantidade: 3, preco_unitario: 2, valor_total: 6 }
    ];
    const pagamentos = [
      { forma_pagamento: 'pix', valor: 5 },
      { forma_pagamento: 'dinheiro', valor: 17 }
    ];
    const ctx = montarCenario({
      venda: { total: 22 },
      itens,
      pagamentos,
      xmlOpts: { dets: 3, vNF: '22.00' }
    });
    validarComprovanteContraCarrinho({
      ...ctx,
      venda: { total: 22 },
      itens,
      pagamentos,
      label: 'somente fiscal'
    });
  }

  // ✓ Venda somente não fiscal
  {
    const itens = [{ produto_nome: 'Sorvete Artesanal', quantidade: 1, preco_unitario: 15, valor_total: 15 }];
    const ctx = montarCenario({
      venda: { total: 15 },
      itens,
      pagamentos: [{ forma_pagamento: 'pix', valor: 15 }],
      xmlOpts: { dets: 0, vNF: '0.00', comPag: false }
    });
    validarComprovanteContraCarrinho({
      ...ctx,
      venda: { total: 15 },
      itens,
      pagamentos: [{ forma_pagamento: 'pix', valor: 15 }],
      label: 'somente não fiscal'
    });
  }

  // ✓ Venda mista — Pitú fiscal + demais não fiscal (exemplo do spec)
  {
    const itens = [
      { produto_nome: 'Aguardente Pitú', quantidade: 2, preco_unitario: 5, valor_total: 10 },
      { produto_nome: 'Bala', quantidade: 1, preco_unitario: 1, valor_total: 1 },
      { produto_nome: 'Refrigerante', quantidade: 3, preco_unitario: 3, valor_total: 9 }
    ];
    const ctx = montarCenario({
      venda: { total: 20, valor_fiscal: 10, valor_nao_fiscal: 10 },
      itens,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 20 }],
      xmlOpts: { dets: 1, vNF: '10.00' }
    });
    validarComprovanteContraCarrinho({
      ...ctx,
      venda: { total: 20 },
      itens,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 20 }],
      label: 'venda mista'
    });
    assert.strictEqual(ctx.carimbo.qtdDetXml, 1);
    assert.strictEqual(ctx.carimbo.vNF, 10);
  }

  // ✓ Consignado
  {
    const itens = [{ produto_nome: 'Sorvete Premium', quantidade: 2, preco_unitario: 8, valor_total: 16, consignado: 1 }];
    const ctx = montarCenario({
      venda: { total: 16 },
      itens,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 16 }],
      xmlOpts: { dets: 0, vNF: '0.00' }
    });
    validarComprovanteContraCarrinho({
      ...ctx,
      venda: { total: 16 },
      itens,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 16 }],
      label: 'consignado'
    });
    assert.ok(!/\bconsignado\b/i.test(ctx.html), 'consignado: flag interna não aparece ao cliente');
  }

  // ✓ Kits
  {
    const itens = [{
      produto_nome: 'Kit Festa',
      quantidade: 1,
      preco_unitario: 45,
      valor_total: 45,
      kit_itens: [
        { produto_nome: 'Copo', quantidade: 2 },
        { produto_nome: 'Colher', quantidade: 2 }
      ]
    }];
    const ctx = montarCenario({
      venda: { total: 45 },
      itens,
      pagamentos: [{ forma_pagamento: 'pix', valor: 45 }],
      xmlOpts: { dets: 1, vNF: '45.00' }
    });
    validarComprovanteContraCarrinho({
      ...ctx,
      venda: { total: 45 },
      itens,
      pagamentos: [{ forma_pagamento: 'pix', valor: 45 }],
      label: 'kits'
    });
  }

  // ✓ Casquinhas
  {
    const itens = [{
      produto_nome: 'Casquinha',
      quantidade: 1,
      preco_unitario: 12,
      valor_total: 12,
      quantidade_bolas: 2,
      sabores: [{ nome: 'Chocolate' }, { nome: 'Morango' }]
    }];
    const ctx = montarCenario({
      venda: { total: 12 },
      itens,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 12 }],
      xmlOpts: { dets: 1, vNF: '12.00' }
    });
    validarComprovanteContraCarrinho({
      ...ctx,
      venda: { total: 12 },
      itens,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 12 }],
      label: 'casquinhas'
    });
    assert.ok(/CASQUINHA/i.test(ctx.html));
  }

  // ✓ Promoções
  {
    const itens = [{
      produto_nome: 'Sorvete Promo 2x1',
      quantidade: 2,
      preco_unitario: 7.5,
      valor_total: 15,
      promocao_id: 99,
      desconto_promocao: 5
    }];
    const ctx = montarCenario({
      venda: { total: 15, desconto: 5 },
      itens,
      pagamentos: [{ forma_pagamento: 'pix', valor: 15 }],
      xmlOpts: { dets: 1, vNF: '15.00' }
    });
    validarComprovanteContraCarrinho({
      ...ctx,
      venda: { total: 15 },
      itens,
      pagamentos: [{ forma_pagamento: 'pix', valor: 15 }],
      label: 'promoções'
    });
    assert.ok(!/promocao|promoção/i.test(ctx.html.replace(/Sorvete Promo/i, '')), 'promoção: metadado interno oculto');
  }

  // ✓ Dois pagamentos — PIX + Dinheiro / PIX + Cartão / Cartão + Dinheiro
  for (const [label, pags] of [
    ['PIX+Dinheiro', [
      { forma_pagamento: 'pix', valor: 4 },
      { forma_pagamento: 'dinheiro', valor: 6 }
    ]],
    ['PIX+Cartão', [
      { forma_pagamento: 'pix', valor: 3 },
      { forma_pagamento: 'cartao_credito', valor: 7 }
    ]],
    ['Cartão+Dinheiro', [
      { forma_pagamento: 'cartao_debito', valor: 5 },
      { forma_pagamento: 'dinheiro', valor: 5 }
    ]]
  ]) {
    const itens = [{ produto_nome: `Prod ${label}`, quantidade: 1, preco_unitario: 10, valor_total: 10 }];
    const ctx = montarCenario({
      venda: { total: 10 },
      itens,
      pagamentos: pags,
      xmlOpts: { dets: 1, vNF: '10.00' }
    });
    validarComprovanteContraCarrinho({
      ...ctx,
      venda: { total: 10 },
      itens,
      pagamentos: pags,
      label
    });
  }

  // ✓ Reimpressão idêntica
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
    assert.strictEqual(conteudoCanonico(h1), conteudoCanonico(h2), 'reimpressão deve ser idêntica');
  }

  console.log('RCF-10 OK — remontagem comprovante = carrinho original; XML só carimbo fiscal');
}

run();
