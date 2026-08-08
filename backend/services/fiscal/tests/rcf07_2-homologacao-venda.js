/**
 * RCF-07.2 — Validador de homologação pós-venda (NFC-e real)
 *
 * Uso:
 *   node backend/services/fiscal/tests/rcf07_2-homologacao-venda.js <vendaId>
 *
 * Valida no banco oficial:
 *   vendas / vendas_itens / pagamentos / nfce_notas
 *   paridade venda_id, itens > 0, NFC-e autorizada, XML <det>, DANFE
 */

const assert = require('assert');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const vendaIdArg = Number(process.argv[2]);
if (!Number.isFinite(vendaIdArg) || vendaIdArg <= 0) {
  console.error('Uso: node backend/services/fiscal/tests/rcf07_2-homologacao-venda.js <vendaId>');
  process.exit(2);
}

const DB_DIR = process.env.DB_DIR
  || path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
const DB_PATH = path.join(DB_DIR, 'mercadao.db');

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function run() {
  console.log('[RCF-07.2] Homologação venda', { vendaId: vendaIdArg, db: DB_PATH });
  const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

  try {
    const venda = await get(db, 'SELECT * FROM vendas WHERE id = ?', [vendaIdArg]);
    assert.ok(venda, `Venda #${vendaIdArg} não encontrada`);

    const itens = await all(db, 'SELECT * FROM vendas_itens WHERE venda_id = ? ORDER BY id', [vendaIdArg]);
    assert.ok(itens.length > 0, 'vendas_itens vazio — regressão RCF-07');

    let pagamentos = await all(
      db,
      `SELECT forma_pagamento, valor, status FROM venda_recebimentos WHERE venda_id = ? AND status = 'aprovado'`,
      [vendaIdArg]
    );
    if (!pagamentos.length) {
      pagamentos = await all(
        db,
        'SELECT forma_pagamento, valor FROM venda_pagamentos WHERE venda_id = ?',
        [vendaIdArg]
      );
    }
    assert.ok(pagamentos.length > 0, 'pagamento não encontrado para a venda');

    const notas = await all(
      db,
      `SELECT id, venda_id, numero, serie, chave_acesso, status, protocolo, xml_enviado, danfe_html, created_at
       FROM nfce_notas WHERE venda_id = ? ORDER BY id DESC`,
      [vendaIdArg]
    );
    assert.ok(notas.length > 0, 'nfce_notas sem registro para esta venda');

    const autorizadas = notas.filter((n) => String(n.status) === 'autorizada');
    assert.ok(autorizadas.length > 0, `Nenhuma NFC-e autorizada (status: ${notas.map((n) => n.status).join(',')})`);

    const nota = autorizadas[0];
    assert.strictEqual(Number(nota.venda_id), vendaIdArg, 'RCF-02/06: nota.venda_id diverge');

    const xml = String(nota.xml_enviado || '');
    assert.ok(xml.trim(), 'XML enviado vazio');
    const nDet = (xml.match(/<det\s/gi) || []).length;
    const itensFiscais = itens.filter(
      (i) => Number(i.quantidade_fiscal || 0) > 0 && Number(i.valor_fiscal || 0) > 0
    );
    assert.ok(nDet > 0, 'XML sem <det>');
    assert.strictEqual(
      nDet,
      itensFiscais.length,
      `XML <det>=${nDet} ≠ itens fiscais=${itensFiscais.length}`
    );

    const vNF = xml.match(/<vNF>([\d.]+)<\/vNF>/i);
    if (vNF) {
      const totalXml = Number(vNF[1]);
      const totalVenda = Number(venda.valor_fiscal || venda.total || 0);
      assert.ok(
        Math.abs(totalXml - totalVenda) <= 0.05,
        `Total XML ${totalXml} ≠ venda fiscal/total ${totalVenda}`
      );
    }

    assert.ok(String(nota.chave_acesso || '').length >= 44, 'chave de acesso inválida');
    assert.ok(nota.numero, 'número NFC-e ausente');
    assert.ok(String(nota.danfe_html || '').trim(), 'DANFE HTML ausente');

    // Outras vendas não podem ter a mesma chave
    const chaveDup = await get(
      db,
      `SELECT id, venda_id FROM nfce_notas
       WHERE chave_acesso = ? AND venda_id <> ? LIMIT 1`,
      [nota.chave_acesso, vendaIdArg]
    );
    assert.ok(!chaveDup, `Chave reutilizada em outra venda (nota ${chaveDup?.id} venda ${chaveDup?.venda_id})`);

    console.log('[RCF-07.2] RESULTADO OK');
    console.log(JSON.stringify({
      venda_id: vendaIdArg,
      total: venda.total,
      valor_fiscal: venda.valor_fiscal,
      qtd_itens: itens.length,
      qtd_itens_fiscais: itensFiscais.length,
      qtd_pagamentos: pagamentos.length,
      nota_id: nota.id,
      numero: nota.numero,
      serie: nota.serie,
      status: nota.status,
      chave: nota.chave_acesso,
      protocolo: nota.protocolo,
      xml_dets: nDet,
      danfe_len: String(nota.danfe_html || '').length,
      created_at: nota.created_at
    }, null, 2));

    console.log('\nChecklist GO-LIVE (preencher impressão manual):');
    console.log('- [x] NFC-e autorizada SEFAZ');
    console.log('- [x] venda_id == nota.venda_id');
    console.log('- [x] itens_persistidos > 0');
    console.log('- [x] XML <det> == itens fiscais');
    console.log('- [ ] Impressão automática conferida no PDV');
    console.log('- [ ] Reimpressão conferida no PDV');
    console.log('- [ ] Logs [RCF-07.1] mesmaRef:false no console do servidor');
  } finally {
    db.close();
  }
}

run().catch((err) => {
  console.error('[RCF-07.2] FALHA', err.message || err);
  process.exit(1);
});
