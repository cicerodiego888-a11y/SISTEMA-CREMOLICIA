'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function calcularHashHtml(html) {
  return crypto.createHash('sha256').update(String(html || '')).digest('hex');
}

function garantirDiretorio(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function auditarRuntimeImpressao({
  vendaId,
  notaId,
  title,
  loadedUrl,
  html,
  htmlRuntime,
  htmlPrint
}) {
  const baseDir = path.join(
    process.env.FISCAL_DIR || path.join(process.cwd(), 'fiscal-data'),
    'comprovantes',
    `venda-${vendaId || 'unknown'}`
  );

  garantirDiretorio(baseDir);

  const snapshotApi = path.join(baseDir, 'api-generated.html');
  const snapshotRuntimeBefore = path.join(baseDir, 'runtime-before-print.html');
  const snapshotRuntimeAfter = path.join(baseDir, 'runtime-after-print.html');
  const metaPath = path.join(baseDir, 'runtime-audit.json');

  fs.writeFileSync(snapshotApi, String(html || ''), 'utf8');
  fs.writeFileSync(snapshotRuntimeBefore, String(htmlRuntime || ''), 'utf8');
  fs.writeFileSync(snapshotRuntimeAfter, String(htmlPrint || ''), 'utf8');

  const hashApi = calcularHashHtml(html);
  const hashRuntime = calcularHashHtml(htmlRuntime);
  const hashPrint = calcularHashHtml(htmlPrint);
  const iguais = hashApi === hashRuntime && hashRuntime === hashPrint;

  const meta = {
    vendaId,
    notaId,
    title,
    loadedUrl,
    createdAt: new Date().toISOString(),
    hashApi,
    hashRuntime,
    hashPrint,
    iguais,
    snapshots: {
      api: snapshotApi,
      runtimeBeforePrint: snapshotRuntimeBefore,
      runtimeAfterPrint: snapshotRuntimeAfter
    }
  };

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  return meta;
}

module.exports = {
  calcularHashHtml,
  auditarRuntimeImpressao
};
