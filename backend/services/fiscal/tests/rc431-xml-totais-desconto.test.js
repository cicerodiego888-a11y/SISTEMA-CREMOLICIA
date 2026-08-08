'use strict';

/**
 * RC4.31 — Totais NFC-e: vNF / vPag alinhados a obterTotalFiscalFinal.
 */

const assert = require('assert');
const {
  buildNfceXml,
  ratearDescontoNosItens,
  resolverPagamentosNfce
} = require('../xmlBuilder');
const {
  obterTotalFiscalFinal,
  validarTotalFiscalFinalXml
} = require('../../vendas/TotalFiscalFinal');

function extrairTag(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}>([\\d.]+)</${tag}>`, 'i'));
  return m ? Number(m[1]) : null;
}

function somarVPag(xml) {
  const matches = String(xml || '').match(/<vPag>([\d.]+)<\/vPag>/gi) || [];
  return Number(
    matches
      .reduce((acc, trecho) => {
        const m = trecho.match(/([\d.]+)/);
        return acc + (m ? Number(m[1]) : 0);
      }, 0)
      .toFixed(2)
  );
}

const configBase = {
  codigoUf: '23',
  cnpj: '12345678000199',
  serie: 1,
  ambiente: 2,
  crt: 1,
  ie: '123456789',
  nomeEmpresa: 'EMPRESA TESTE LTDA',
  municipioCodigo: '2307304',
  codigo_municipio: '2307304',
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  logradouro: 'RUA TESTE',
  numero: '100',
  bairro: 'CENTRO',
  tpImp: 4,
  csosn_padrao: '102'
};

function itemFiscal({ id = 1, nome = 'PRODUTO', valor = 100, qtd = 1 } = {}) {
  return {
    produto_id: id,
    produto_nome: nome,
    nome,
    quantidade: qtd,
    quantidade_fiscal: qtd,
    quantidade_nao_fiscal: 0,
    preco_unitario: Number((valor / qtd).toFixed(4)),
    valor_fiscal: valor,
    valor_nao_fiscal: 0,
    subtotal: valor,
    ncm: '21050010',
    cfop: '5102',
    csosn: '102',
    origem: 0
  };
}

function gerarXml({ itens, desconto = 0, pagamentos = null, forma = 'dinheiro' }) {
  const totalItens = itens.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0);
  const liquido = obterTotalFiscalFinal({
    valorProdutosFiscal: totalItens,
    descontoFiscal: desconto
  });
  const venda = {
    id: 9001,
    codigo: 'VND-RC431',
    desconto,
    forma_pagamento: forma,
    pagamentos: pagamentos || [{ forma_pagamento: forma, valor: liquido, tipo_recebimento: 'fiscal' }]
  };
  return buildNfceXml({
    config: configBase,
    venda,
    itens,
    numero: 43101
  });
}

function test(name, fn) {
  fn();
  console.log(`OK ${name}`);
}

test('unidade — obterTotalFiscalFinal 363 - 2 = 361', () => {
  assert.strictEqual(
    obterTotalFiscalFinal({ valorProdutosFiscal: 363, descontoFiscal: 2 }),
    361
  );
});

test('unidade — validarTotalFiscalFinalXml detecta vNF bruto', () => {
  const ruim = validarTotalFiscalFinalXml({ vProd: 363, vDesc: 2, vNF: 363 });
  assert.strictEqual(ruim.ok, false);
  assert.strictEqual(ruim.esperado, 361);

  const bom = validarTotalFiscalFinalXml({ vProd: 363, vDesc: 2, vNF: 361 });
  assert.strictEqual(bom.ok, true);
});

test('Caso 1 — desconto global: vNF=361 e vPag=361', () => {
  const { xmlSemAssinatura, valores } = gerarXml({
    itens: [itemFiscal({ valor: 363 })],
    desconto: 2
  });

  assert.strictEqual(valores.vProd, 363);
  assert.strictEqual(valores.vDesc, 2);
  assert.strictEqual(valores.vNF, 361);
  assert.strictEqual(extrairTag(xmlSemAssinatura, 'vProd'), 363);
  assert.strictEqual(extrairTag(xmlSemAssinatura, 'vDesc'), 2);
  assert.strictEqual(extrairTag(xmlSemAssinatura, 'vNF'), 361);
  assert.strictEqual(somarVPag(xmlSemAssinatura), 361);
  assert.strictEqual(valores.vPag, 361);
});

test('Caso 2 — sem desconto: vNF = vProd', () => {
  const { xmlSemAssinatura, valores } = gerarXml({
    itens: [itemFiscal({ valor: 100 })],
    desconto: 0
  });
  assert.strictEqual(valores.vDesc, 0);
  assert.strictEqual(valores.vNF, valores.vProd);
  assert.strictEqual(extrairTag(xmlSemAssinatura, 'vNF'), 100);
  assert.strictEqual(somarVPag(xmlSemAssinatura), 100);
});

test('Caso 3 — desconto por item (já no valor) + desconto rateado zero global', () => {
  // Preço já líquido no item (desconto de item refletido no valor_fiscal)
  const itens = [
    itemFiscal({ id: 1, valor: 50 }),
    itemFiscal({ id: 2, valor: 45 })
  ];
  const { xmlSemAssinatura, valores } = gerarXml({
    itens,
    desconto: 0
  });
  assert.strictEqual(valores.vProd, 95);
  assert.strictEqual(valores.vNF, 95);
  assert.strictEqual(extrairTag(xmlSemAssinatura, 'vNF'), 95);

  // Desconto global rateado entre itens
  const rateados = ratearDescontoNosItens(
    [itemFiscal({ id: 1, valor: 60 }), itemFiscal({ id: 2, valor: 40 })],
    5
  );
  const somaDesc = Number(
    rateados.reduce((s, i) => s + Number(i.desconto_rateado || 0), 0).toFixed(2)
  );
  assert.strictEqual(somaDesc, 5);
  const esperado = obterTotalFiscalFinal({ valorProdutosFiscal: 100, descontoFiscal: somaDesc });
  assert.strictEqual(esperado, 95);

  const xmlRateio = gerarXml({
    itens: [itemFiscal({ id: 1, valor: 60 }), itemFiscal({ id: 2, valor: 40 })],
    desconto: 5
  });
  assert.strictEqual(xmlRateio.valores.vNF, 95);
  assert.strictEqual(extrairTag(xmlRateio.xmlSemAssinatura, 'vNF'), 95);
  assert.strictEqual(somarVPag(xmlRateio.xmlSemAssinatura), 95);
});

test('Caso 4 — pagamento misto: soma(vPag) = vNF', () => {
  const { xmlSemAssinatura, valores } = gerarXml({
    itens: [itemFiscal({ valor: 363 })],
    desconto: 2,
    forma: 'misto',
    pagamentos: [
      { forma_pagamento: 'dinheiro', valor: 161, tipo_recebimento: 'fiscal' },
      { forma_pagamento: 'pix', valor: 200, tipo_recebimento: 'fiscal' }
    ]
  });
  assert.strictEqual(valores.vNF, 361);
  assert.strictEqual(somarVPag(xmlSemAssinatura), 361);
  assert.strictEqual(valores.vPag, 361);
});

test('resolverPagamentosNfce limita ao vNF líquido (não ao bruto)', () => {
  const pagos = resolverPagamentosNfce(
    {
      forma_pagamento: 'dinheiro',
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 363, tipo_recebimento: 'fiscal' }]
    },
    361
  );
  const soma = Number(pagos.reduce((s, p) => s + Number(p.valor || 0), 0).toFixed(2));
  assert.strictEqual(soma, 361);
});

console.log('\n=== RC4.31 XML NFC-e — todos os testes OK ===');
