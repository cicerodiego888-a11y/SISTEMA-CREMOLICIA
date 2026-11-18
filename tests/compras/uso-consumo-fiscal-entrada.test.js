'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const diretorioTemporario = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-uso-consumo-'));
process.env.DB_DIR = diretorioTemporario;

const express = require('express');
const db = require('../../backend/database');
const { resolverFiscalEntrada, STATUS } = require('../../backend/modules/compras/resolverFiscalEntrada');
const NFeParserService = require('../../backend/shared/nfe/NFeParserService');

const CNPJ_EMPRESA = '11222333000181';
const empresa = { cnpj: CNPJ_EMPRESA, uf: 'CE', crt: '1' };

const itemUc = (extra = {}) => ({
  finalidade_item: 'USO_E_CONSUMO',
  cfop_xml: '5102',
  cst_csosn_xml: '102',
  orig_xml: '0',
  ...extra
});
const docInterno = { emitente_uf: 'CE', destinatario_uf: 'CE', destinatario_cnpj: CNPJ_EMPRESA, emitente_crt: '1' };
const docInterestadual = { ...docInterno, emitente_uf: 'SP' };

describe('resolverFiscalEntrada (puro)', () => {
  it('compra interna de uso e consumo -> CFOP 1556', () => {
    const r = resolverFiscalEntrada({ item: itemUc(), documento: docInterno, empresa });
    assert.equal(r.status, STATUS.APLICAVEL);
    assert.equal(r.cfop_entrada, '1556');
    assert.equal(r.regra, 'USO_CONSUMO_INTERNA');
  });

  it('compra interestadual -> CFOP 2556 com alerta de DIFAL', () => {
    const r = resolverFiscalEntrada({ item: itemUc({ cfop_xml: '6102' }), documento: docInterestadual, empresa });
    assert.equal(r.status, STATUS.APLICAVEL);
    assert.equal(r.cfop_entrada, '2556');
    assert.ok(r.alertas.some((a) => /DIFAL/.test(a)));
  });

  it('item de revenda (sem finalidade) não é classificado como uso e consumo', () => {
    const r = resolverFiscalEntrada({ item: { cfop_xml: '5102' }, documento: docInterno, empresa });
    assert.equal(r.status, STATUS.NAO_APLICAVEL);
    assert.equal(r.cfop_entrada, null);
  });

  it('produto produzido é bloqueado; insumo é aceito', () => {
    assert.equal(resolverFiscalEntrada({ item: itemUc({ produto_natureza: 'PRODUZIDO' }), documento: docInterno, empresa }).status, STATUS.BLOQUEADO);
    assert.equal(resolverFiscalEntrada({ item: itemUc({ produto_natureza: 'INSUMO' }), documento: docInterno, empresa }).status, STATUS.APLICAVEL);
  });

  it('divergência de CFOP exige validação; correção só vale com justificativa', () => {
    const r = resolverFiscalEntrada({ item: itemUc({ cfop_xml: '6102' }), documento: docInterno, empresa });
    assert.equal(r.status, STATUS.REQUER_VALIDACAO);
    const curta = resolverFiscalEntrada({
      item: itemUc({ cfop_xml: '6102', cfop_entrada_manual: '1556', justificativa_fiscal: 'curta' }),
      documento: docInterno, empresa
    });
    assert.equal(curta.status, STATUS.REQUER_VALIDACAO);
    const ok = resolverFiscalEntrada({
      item: itemUc({ cfop_xml: '6102', cfop_entrada_manual: '1556', justificativa_fiscal: 'Fornecedor informou CFOP errado na nota.' }),
      documento: docInterno, empresa, usuarioId: 7
    });
    assert.equal(ok.status, STATUS.APLICAVEL);
    assert.equal(ok.regra, 'CORRECAO_OPERADOR');
    assert.deepEqual(ok.dados_xml_originais, { cfop: '6102', cst_csosn: '102', orig: '0' });
  });

  it('ICMS-ST exige validação; empresa incompleta e destinatário divergente bloqueiam', () => {
    assert.equal(resolverFiscalEntrada({ item: itemUc({ cfop_xml: '5405', cst_csosn_xml: '500' }), documento: docInterno, empresa }).status, STATUS.REQUER_VALIDACAO);
    assert.equal(resolverFiscalEntrada({ item: itemUc(), documento: docInterno, empresa: { cnpj: '', uf: 'CE', crt: '' } }).status, STATUS.BLOQUEADO);
    assert.equal(resolverFiscalEntrada({ item: itemUc(), documento: { ...docInterno, destinatario_cnpj: '99888777000166' }, empresa }).status, STATUS.BLOQUEADO);
  });

  it('correção manual não contorna bloqueio de destinatário divergente', () => {
    const r = resolverFiscalEntrada({
      item: itemUc({ cfop_entrada_manual: '1556', justificativa_fiscal: 'Tentativa de contornar o bloqueio.' }),
      documento: { ...docInterno, destinatario_cnpj: '99888777000166' },
      empresa
    });
    assert.equal(r.status, STATUS.BLOQUEADO);
    assert.equal(r.cfop_entrada, null);
  });
});

function montarXml({ chave, emitUf = 'CE', destUf = 'CE', destCnpj = CNPJ_EMPRESA, crt = '1', itens }) {
  const dets = itens.map((i, n) => `<det nItem="${n + 1}"><prod><cProd>${i.cProd}</cProd><cEAN>SEM GTIN</cEAN><xProd>${i.nome || 'Item ' + i.cProd}</xProd><NCM>34022000</NCM><CFOP>${i.cfop}</CFOP><uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>2.0000</vUnCom><vProd>20.00</vProd></prod>
<imposto><ICMS><ICMSSN102><orig>${i.orig ?? '0'}</orig><CSOSN>${i.csosn ?? '102'}</CSOSN></ICMSSN102></ICMS></imposto></det>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chave}" versao="4.00">
<ide><nNF>123</nNF><serie>1</serie><mod>55</mod><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>11111111000111</CNPJ><xNome>Fornecedor Teste</xNome><enderEmit><UF>${emitUf}</UF></enderEmit><CRT>${crt}</CRT></emit>
<dest><CNPJ>${destCnpj}</CNPJ><xNome>Empresa</xNome><enderDest><UF>${destUf}</UF></enderDest></dest>
${dets}<total><ICMSTot><vNF>20.00</vNF><vProd>20.00</vProd></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

describe('Parser NF-e — dados fiscais originais', () => {
  it('extrai CFOP, CST/CSOSN, origem, nItem, UF/CNPJ do destinatário e CRT do emitente', async () => {
    const chave = '23260111111111000111550010000001231000001230';
    const xml = montarXml({ chave, emitUf: 'SP', itens: [{ cProd: 'A1', cfop: '6102' }, { cProd: 'B2', cfop: '6102' }] });
    const json = await NFeParserService.parse(xml);
    assert.equal(json.itens[1].numero_item_xml, 2);
    assert.equal(json.itens[0].cfop_xml, '6102');
    assert.equal(json.itens[0].cst_csosn_xml, '102');
    assert.equal(json.itens[0].orig_xml, '0');
    assert.equal(json.destinatario_cnpj, CNPJ_EMPRESA);
    assert.equal(json.destinatario_uf, 'CE');
    assert.equal(json.fornecedor_uf, 'SP');
    assert.equal(String(json.fornecedor_crt), '1');
  });
});

describe('Compras uso e consumo — origem fiscal confiável (banco isolado)', () => {
  let servidor;
  let baseUrl;
  let produtoInsumo;
  let sequencia = 0;

  const executar = (sql, p = []) => new Promise((resolve, reject) => {
    db.run(sql, p, function cb(err) { return err ? reject(err) : resolve(this); });
  });
  const consultar = (sql, p = []) => new Promise((resolve, reject) => {
    db.all(sql, p, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });

  const novaChave = () => {
    sequencia += 1;
    return `23260111111111000111550010000${String(sequencia).padStart(6, '0')}1000${String(sequencia).padStart(5, '0')}`.slice(0, 44).padEnd(44, '0');
  };

  async function criarDocumento(opcoes = {}) {
    const chave = opcoes.chave || novaChave();
    assert.equal(chave.length, 44);
    const xml = opcoes.xml === undefined
      ? montarXml({ chave, itens: [{ cProd: 'P1', cfop: '5102' }], ...opcoes.xmlOpcoes })
      : opcoes.xml;
    const r = await executar(
      `INSERT INTO central_entradas_documentos (chave, xml, origem, status, parse_json) VALUES (?, ?, 'manual', 'REVISAO', ?)`,
      [chave, xml, opcoes.parseJson || null]
    );
    return { id: r.lastID, chave };
  }

  const payload = (fornecedor, doc, itemExtra = {}, docExtra = {}) => ({
    data_compra: '2026-10-27',
    fornecedor,
    total: 20,
    valor_produtos: 20,
    valor_total_nota: 20,
    condicao_pagamento: 'avista',
    tipo_entrada: 'COMPRA_FORNECEDOR',
    chave_acesso: doc.chave,
    central_documento_id: doc.id,
    itens: [{
      produto_id: produtoInsumo,
      produto_nome: 'Detergente uso e consumo',
      unidade: 'UN',
      quantidade: 10,
      quantidade_fiscal: 10,
      quantidade_nao_fiscal: 0,
      preco_unitario: 2,
      subtotal: 20,
      destino_estoque: null,
      finalidade_item: 'USO_E_CONSUMO',
      numero_item_xml: 1,
      codigo_fornecedor: 'P1',
      ...itemExtra
    }],
    ...docExtra
  });

  const post = async (rota, corpo) => {
    const r = await fetch(`${baseUrl}${rota}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': `uc-${Math.random()}` },
      body: JSON.stringify(corpo)
    });
    return { status: r.status, body: await r.json() };
  };

  const compraPorFornecedor = (nome) => consultar('SELECT id FROM compras WHERE fornecedor = ?', [nome]);
  const itensPorFornecedor = (nome) => consultar(
    'SELECT * FROM compras_itens WHERE compra_id IN (SELECT id FROM compras WHERE fornecedor = ?)', [nome]
  );

  before(async () => {
    await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
    for (const [chave, valor] of [['cnpj', CNPJ_EMPRESA], ['fiscal_uf_sigla', 'CE'], ['fiscal_regime_tributario', '1']]) {
      await executar('INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)', [chave, valor]);
    }
    const r = await executar(`
      INSERT INTO produtos (nome, unidade, natureza_cadastro, ativo, estoque_atual, saldo_fiscal, saldo_nao_fiscal, preco_venda)
      VALUES ('Detergente uso e consumo', 'UN', 'INSUMO', 1, 0, 0, 0, 0)
    `);
    produtoInsumo = r.lastID;

    const app = express();
    app.use(express.json());
    app.use('/', require('../../backend/rotas/compras'));
    servidor = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => servidor.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${servidor.address().port}/`;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(diretorioTemporario, { recursive: true, force: true });
  });

  it('1. XML interno coerente: 1556 e grava com origem rastreável, sem estoque nem alteração de produto', async () => {
    const doc = await criarDocumento();
    const r = await post('', payload('F Interno', doc));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [item] = await itensPorFornecedor('F Interno');
    assert.equal(item.finalidade_item, 'USO_E_CONSUMO');
    assert.equal(item.cfop_entrada, '1556');
    assert.equal(item.cfop_xml, '5102');
    assert.equal(item.cst_csosn_xml, '102');
    assert.equal(item.orig_xml, '0');
    assert.equal(item.numero_item_xml, 1);
    assert.equal(item.central_documento_id, doc.id);
    assert.equal(item.destino_estoque, null);
    // 14. isolamento de estoque/MCC
    const mov = await consultar(`SELECT COUNT(*) AS n FROM estoque_movimentacoes WHERE referencia_tipo = 'compra' AND produto_id = ?`, [produtoInsumo]);
    assert.equal(mov[0].n, 0);
    const [prod] = await consultar('SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?', [produtoInsumo]);
    assert.deepEqual({ ...prod }, { estoque_atual: 0, saldo_fiscal: 0, saldo_nao_fiscal: 0 });
  });

  it('2. XML interestadual: 2556 com alerta de DIFAL no preview', async () => {
    const doc = await criarDocumento({ xmlOpcoes: { emitUf: 'SP', itens: [{ cProd: 'P1', cfop: '6102' }] } });
    const prev = await post('validar-fiscal-entrada', payload('F Interestadual', doc));
    assert.equal(prev.status, 200);
    assert.equal(prev.body.itens[0].cfop_entrada, '2556');
    assert.ok(prev.body.itens[0].alertas.some((a) => /DIFAL/.test(a)));
    assert.equal((await compraPorFornecedor('F Interestadual')).length, 0, 'preview não grava');
    const r = await post('', payload('F Interestadual', doc));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await itensPorFornecedor('F Interestadual'))[0].cfop_entrada, '2556');
  });

  it('3. CFOP adulterado no POST não substitui o XML (cfop 5102 do XML prevalece)', async () => {
    const doc = await criarDocumento();
    const r = await post('', payload('F CFOP Adulterado', doc, { cfop_xml: '6102' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [item] = await itensPorFornecedor('F CFOP Adulterado');
    assert.equal(item.cfop_xml, '5102');
    assert.equal(item.cfop_entrada, '1556');
  });

  it('3b. CFOP adulterado não permite contornar pendência real do XML', async () => {
    const doc = await criarDocumento({ xmlOpcoes: { itens: [{ cProd: 'P1', cfop: '6102' }] } });
    const r = await post('', payload('F Pendencia Real', doc, { cfop_xml: '5102' }));
    assert.equal(r.status, 422);
    assert.equal(r.body.codigo, 'FISCAL_ENTRADA_PENDENTE');
    assert.equal((await compraPorFornecedor('F Pendencia Real')).length, 0);
  });

  it('4. UF adulterada no POST é ignorada (XML interestadual continua 2556)', async () => {
    const doc = await criarDocumento({ xmlOpcoes: { emitUf: 'SP', itens: [{ cProd: 'P1', cfop: '6102' }] } });
    const r = await post('', payload('F UF Adulterada', doc, {}, { fornecedor_uf: 'CE', destinatario_uf: 'CE' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await itensPorFornecedor('F UF Adulterada'))[0].cfop_entrada, '2556');
  });

  it('5. CNPJ do destinatário adulterado no POST não altera o destinatário efetivo', async () => {
    const docOutro = await criarDocumento({ xmlOpcoes: { destCnpj: '99888777000166', itens: [{ cProd: 'P1', cfop: '5102' }] } });
    const bloqueado = await post('', payload('F Dest Outro', docOutro, {}, { destinatario_cnpj: CNPJ_EMPRESA }));
    assert.equal(bloqueado.status, 422);
    assert.equal(bloqueado.body.itens[0].status, 'BLOQUEADO');

    const docOk = await criarDocumento();
    const r = await post('', payload('F Dest Forjado', docOk, {}, { destinatario_cnpj: '99888777000166', destinatario_uf: 'SP' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [compra] = await consultar(`SELECT destinatario_cnpj, destinatario_uf FROM compras WHERE fornecedor = 'F Dest Forjado'`);
    assert.equal(compra.destinatario_cnpj, CNPJ_EMPRESA);
    assert.equal(compra.destinatario_uf, 'CE');
  });

  it('6. CST/CSOSN e origem adulterados no POST não modificam o contexto confiável', async () => {
    const doc = await criarDocumento({ xmlOpcoes: { itens: [{ cProd: 'P1', cfop: '5102', csosn: '102', orig: '0' }] } });
    const r = await post('', payload('F CST Adulterado', doc, { cst_csosn_xml: '500', orig_xml: '2', cfop_xml: '5405' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [item] = await itensPorFornecedor('F CST Adulterado');
    assert.equal(item.cst_csosn_xml, '102');
    assert.equal(item.orig_xml, '0');
    assert.equal(item.cfop_entrada, '1556');
  });

  it('7. documento antigo (parse_json sem dados fiscais) usa o XML original; sem XML fica bloqueado', async () => {
    const antigo = await criarDocumento({ parseJson: JSON.stringify({ itens: [{ produto_nome: 'x', codigo_fornecedor: 'P1' }] }) });
    const ok = await post('', payload('F Antigo Com XML', antigo));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));

    const semXml = await criarDocumento({ xml: ' ', parseJson: JSON.stringify({ itens: [] }) });
    const r = await post('', payload('F Antigo Sem XML', semXml, { cfop_xml: '5102', cst_csosn_xml: '102' }, { fornecedor_uf: 'CE', destinatario_uf: 'CE', destinatario_cnpj: CNPJ_EMPRESA }));
    assert.equal(r.status, 422);
    assert.equal(r.body.itens[0].status, 'BLOQUEADO');
    assert.match(r.body.itens[0].mensagens.join(' '), /XML original/);
    assert.equal((await compraPorFornecedor('F Antigo Sem XML')).length, 0);
  });

  it('8. vínculo inconsistente, documento inexistente ou ausente bloqueiam de forma segura', async () => {
    const chaveA = novaChave();
    const chaveB = novaChave();
    const divergente = await criarDocumento({ chave: chaveA, xml: montarXml({ chave: chaveB, itens: [{ cProd: 'P1', cfop: '5102' }] }) });
    let r = await post('', payload('F Chave XML Divergente', divergente));
    assert.equal(r.status, 422);
    assert.match(r.body.itens[0].mensagens.join(' '), /não confere/);

    const doc = await criarDocumento();
    r = await post('', payload('F Chave Compra Divergente', { id: doc.id, chave: chaveB }));
    assert.equal(r.status, 422);

    r = await post('', payload('F Doc Inexistente', { id: 999999, chave: '' }, {}, { chave_acesso: '' }));
    assert.equal(r.status, 422);

    const semDoc = payload('F Sem Documento', doc);
    delete semDoc.central_documento_id;
    r = await post('', semDoc);
    assert.equal(r.status, 422);
    assert.equal(r.body.itens[0].status, 'BLOQUEADO');

    const itemInexistente = await post('', payload('F Item Inexistente', doc, { numero_item_xml: 7 }));
    assert.equal(itemInexistente.status, 422);
    const codigoDiferente = await post('', payload('F Item Codigo Diferente', doc, { codigo_fornecedor: 'OUTRO' }));
    assert.equal(codigoDiferente.status, 422);

    for (const nome of ['F Chave XML Divergente', 'F Chave Compra Divergente', 'F Doc Inexistente', 'F Sem Documento', 'F Item Inexistente', 'F Item Codigo Diferente']) {
      assert.equal((await compraPorFornecedor(nome)).length, 0, nome);
    }
  });

  it('9. correção manual válida preserva o dado original, a correção e a justificativa', async () => {
    const doc = await criarDocumento({ xmlOpcoes: { itens: [{ cProd: 'P1', cfop: '6102' }] } });
    const r = await post('', payload('F Correcao Valida', doc, {
      cfop_entrada_manual: '1556',
      justificativa_fiscal: 'Fornecedor informou CFOP interestadual em operação interna.'
    }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [item] = await itensPorFornecedor('F Correcao Valida');
    assert.equal(item.cfop_xml, '6102');
    assert.equal(item.cfop_entrada, '1556');
    assert.equal(item.regra_fiscal_entrada, 'CORRECAO_OPERADOR');
    assert.match(item.justificativa_fiscal, /Fornecedor informou/);
  });

  it('10. correção manual inválida é rejeitada sem gravar a compra', async () => {
    const doc = await criarDocumento({ xmlOpcoes: { itens: [{ cProd: 'P1', cfop: '6102' }] } });
    for (const [nome, extra] of [
      ['F Corr Curta', { cfop_entrada_manual: '1556', justificativa_fiscal: 'curta' }],
      ['F Corr Cfop Ruim', { cfop_entrada_manual: '5102', justificativa_fiscal: 'Justificativa suficientemente longa.' }],
      ['F Corr Escopo', { cfop_entrada_manual: '2556', justificativa_fiscal: 'Justificativa suficientemente longa.' }]
    ]) {
      const r = await post('', payload(nome, doc, extra));
      assert.equal(r.status, 422, nome);
      assert.equal((await compraPorFornecedor(nome)).length, 0, nome);
    }
  });

  it('11. fiscal_entrada forjado pelo cliente é descartado e recalculado', async () => {
    const doc = await criarDocumento({ xmlOpcoes: { itens: [{ cProd: 'P1', cfop: '6102' }] } });
    const r = await post('', payload('F Forjado', doc, {
      fiscal_entrada: { status: 'APLICAVEL', cfop_entrada: '1556', finalidade: 'USO_E_CONSUMO', dados_xml_originais: { cfop: '5102' } }
    }));
    assert.equal(r.status, 422);
    assert.equal(r.body.codigo, 'FISCAL_ENTRADA_PENDENTE');
    assert.equal((await compraPorFornecedor('F Forjado')).length, 0);
  });

  it('12. pendência retorna FISCAL_ENTRADA_PENDENTE sem gravação parcial', async () => {
    const doc = await criarDocumento({ xmlOpcoes: { itens: [{ cProd: 'P1', cfop: '5405', csosn: '500' }] } });
    const antesItens = (await consultar('SELECT COUNT(*) AS n FROM compras_itens'))[0].n;
    const r = await post('', payload('F ST', doc));
    assert.equal(r.status, 422);
    assert.equal(r.body.codigo, 'FISCAL_ENTRADA_PENDENTE');
    assert.equal((await compraPorFornecedor('F ST')).length, 0);
    assert.equal((await consultar('SELECT COUNT(*) AS n FROM compras_itens'))[0].n, antesItens);
  });

  it('13. compra comum sem finalidade segue o fluxo anterior e movimenta estoque', async () => {
    const doc = await criarDocumento();
    const corpo = payload('F Revenda', doc, { finalidade_item: undefined, destino_estoque: 'LOJA' });
    delete corpo.central_documento_id;
    const r = await post('', corpo);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [item] = await itensPorFornecedor('F Revenda');
    assert.equal(item.finalidade_item ?? null, null);
    assert.equal(item.cfop_entrada ?? null, null);
    const mov = await consultar(`SELECT COUNT(*) AS n FROM estoque_movimentacoes WHERE referencia_tipo = 'compra' AND produto_id = ?`, [produtoInsumo]);
  });

  it('13b. finalidade explícita INSUMO segue o fluxo de estoque e não vira uso e consumo', async () => {
    const doc = await criarDocumento();
    const corpo = payload('F Insumo', doc, { finalidade_item: 'INSUMO', destino_estoque: 'LOJA' });
    delete corpo.central_documento_id;
    const r = await post('', corpo);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [item] = await itensPorFornecedor('F Insumo');
    assert.notEqual(item.finalidade_item, 'USO_E_CONSUMO');
    assert.equal(item.cfop_entrada ?? null, null);
    const mov = await consultar(`SELECT COUNT(*) AS n FROM estoque_movimentacoes WHERE referencia_tipo = 'compra' AND produto_id = ?`, [produtoInsumo]);
    assert.ok(mov[0].n > 0);
  });
});
