/**
 * RCF-10.2 — Certificação runtime da impressão comercial.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcf102-runtime-'));
process.env.FISCAL_DIR = path.join(tempDir, 'fiscal');

const {
  calcularHashHtml,
  auditarRuntimeImpressao
} = require('../ComprovanteRuntimeAuditoria');

async function run() {
  const html = '<div><b>Comprovante</b><div>Item 1</div></div>';
  const runtimeHtml = '<div><b>Comprovante</b><div>Item 1</div></div>';
  const printHtml = '<div><b>Comprovante</b><div>Item 1</div></div>';

  const audit = await auditarRuntimeImpressao({
    vendaId: 77,
    notaId: 88,
    title: 'Comprovante Comercial',
    loadedUrl: 'data:text/html;charset=utf-8,',
    html,
    htmlRuntime: runtimeHtml,
    htmlPrint: printHtml
  });

  assert.strictEqual(audit.hashApi, calcularHashHtml(html));
  assert.strictEqual(audit.hashRuntime, calcularHashHtml(runtimeHtml));
  assert.strictEqual(audit.hashPrint, calcularHashHtml(printHtml));
  assert.strictEqual(audit.iguais, true);

  const auditDir = path.join(process.env.FISCAL_DIR, 'comprovantes', 'venda-77');
  assert.ok(fs.existsSync(path.join(auditDir, 'runtime-before-print.html')));
  assert.ok(fs.existsSync(path.join(auditDir, 'runtime-after-print.html')));

  const before = fs.readFileSync(path.join(auditDir, 'runtime-before-print.html'), 'utf8');
  const after = fs.readFileSync(path.join(auditDir, 'runtime-after-print.html'), 'utf8');
  assert.strictEqual(before, runtimeHtml);
  assert.strictEqual(after, printHtml);

  console.log('RCF-10.2 OK — runtime certifica HTML da API e salva snapshots de impressão');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
