/**
 * RCF-08 — Motor Fiscal × Não Fiscal (validação XML / DANFE / filtro de itens)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const emissorPath = path.join(root, 'services/fiscal/emissor.js');
const xmlBuilderPath = path.join(root, 'services/fiscal/xmlBuilder.js');
const danfePath = path.join(root, 'services/fiscal/danfe.js');
const comprovantePath = path.join(root, 'services/comprovanteVendaService.js');

const {
  validarConsistenciaVendaXml,
  resolverTotalFiscalReferencia,
  itemEntraNaNfce
} = require(emissorPath);

function xmlCom(vNF, nDet) {
  const dets = Array.from({ length: nDet }, (_, i) => `<det nItem="${i + 1}"></det>`).join('');
  return `<infNFe><total><ICMSTot><vNF>${Number(vNF).toFixed(2)}</vNF></ICMSTot></total>${dets}</infNFe>`;
}

function run() {
  const emissorSrc = fs.readFileSync(emissorPath, 'utf8');
  const xmlSrc = fs.readFileSync(xmlBuilderPath, 'utf8');
  const danfeSrc = fs.readFileSync(danfePath, 'utf8');
  const compSrc = fs.readFileSync(comprovantePath, 'utf8');

  assert.ok(emissorSrc.includes('RCF-08'), 'logs RCF-08');
  assert.ok(emissorSrc.includes('resolverTotalFiscalReferencia'), 'usa total fiscal');
  assert.ok(xmlSrc.includes('limitarPagamentosAoTotalFiscal'), 'pagamentos limitados ao fiscal');
  assert.ok(xmlSrc.includes('resolverPagamentosNfce'), 'pagamentos NFC-e');
  assert.ok(danfeSrc.includes('Total Fiscal') || danfeSrc.includes('valor_fiscal'), 'DANFE fiscal');
    assert.ok(!compSrc.includes('mostrarSplitFiscal'), 'comprovante sem split F×NF ao cliente (RCF-09)');

  // --- 100% fiscal ---
  const itens100 = [
    { quantidade_fiscal: 1, valor_fiscal: 10, valor_nao_fiscal: 0 },
    { quantidade_fiscal: 2, valor_fiscal: 20, valor_nao_fiscal: 0 }
  ];
  assert.strictEqual(itens100.filter(itemEntraNaNfce).length, 2);
  const venda100 = { total: 30, valor_fiscal: 30, valor_nao_fiscal: 0 };
  assert.strictEqual(resolverTotalFiscalReferencia(venda100, itens100), 30);
  const ok100 = validarConsistenciaVendaXml(venda100, xmlCom(30, 2), { itensFiscais: itens100 });
  assert.strictEqual(ok100.ok, true, ok100.divergencias.join('; '));

  // --- 100% não fiscal ---
  const itensNf = [
    { quantidade_fiscal: 0, valor_fiscal: 0, valor_nao_fiscal: 15 }
  ];
  assert.strictEqual(itensNf.filter(itemEntraNaNfce).length, 0);
  const vendaNf = { total: 15, valor_fiscal: 0, valor_nao_fiscal: 15 };
  assert.strictEqual(resolverTotalFiscalReferencia(vendaNf, []), 0);

  // --- mista ---
  const itensMista = [
    { produto_id: 1, quantidade_fiscal: 1, valor_fiscal: 5, valor_nao_fiscal: 5 },
    { produto_id: 2, quantidade_fiscal: 0, valor_fiscal: 0, valor_nao_fiscal: 10 }
  ];
  const fiscais = itensMista.filter(itemEntraNaNfce);
  assert.strictEqual(fiscais.length, 1, 'só item com qtd/valor fiscal entra');
  const vendaMista = { total: 20, valor_fiscal: 5, valor_nao_fiscal: 15 };
  assert.strictEqual(resolverTotalFiscalReferencia(vendaMista, fiscais), 5);

  const okMista = validarConsistenciaVendaXml(vendaMista, xmlCom(5, 1), { itensFiscais: fiscais });
  assert.strictEqual(okMista.ok, true, okMista.divergencias.join('; '));

  // Regressão: XML com total geral em venda mista → falha
  const badMista = validarConsistenciaVendaXml(vendaMista, xmlCom(20, 1), { itensFiscais: fiscais });
  assert.strictEqual(badMista.ok, false, 'deve rejeitar XML = total geral');
  assert.ok(badMista.divergencias.some((d) => /fiscal|geral/i.test(d)));

  // Múltiplos itens fiscais + não fiscais
  const multi = [
    { quantidade_fiscal: 1, valor_fiscal: 3, valor_nao_fiscal: 0 },
    { quantidade_fiscal: 1, valor_fiscal: 7, valor_nao_fiscal: 0 },
    { quantidade_fiscal: 0, valor_fiscal: 0, valor_nao_fiscal: 4 },
    { quantidade_fiscal: 2, valor_fiscal: 10, valor_nao_fiscal: 2 }
  ];
  const multiFisc = multi.filter(itemEntraNaNfce);
  assert.strictEqual(multiFisc.length, 3);
  const vendaMulti = { total: 26, valor_fiscal: 20, valor_nao_fiscal: 6 };
  const okMulti = validarConsistenciaVendaXml(vendaMulti, xmlCom(20, 3), { itensFiscais: multiFisc });
  assert.strictEqual(okMulti.ok, true, okMulti.divergencias.join('; '));
  assert.strictEqual(okMulti.nItemsXml, 3);
  assert.strictEqual(okMulti.totalFiscal, 20);

  // Contagem <det> diverge
  const badDet = validarConsistenciaVendaXml(vendaMulti, xmlCom(20, 2), { itensFiscais: multiFisc });
  assert.strictEqual(badDet.ok, false);

  // Pagamentos mistos — contrato no xmlBuilder (filtra tipo fiscal + limita ao total)
  assert.ok(xmlSrc.includes("tipo_recebimento === 'fiscal'") || xmlSrc.includes('tipo_recebimento') && xmlSrc.includes('fiscal'));
  assert.ok(xmlSrc.includes('SEFAZ 866') || xmlSrc.includes('limitarPagamentosAoTotalFiscal'));

  console.log('RCF-08 OK — XML valida valor fiscal; mista/100%/NF cobertos');
}

run();
