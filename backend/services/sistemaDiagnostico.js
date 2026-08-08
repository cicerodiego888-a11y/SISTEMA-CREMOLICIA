/**
 * Diagnóstico de instância do servidor (RCM-04.B).
 * Confirma se Desktop e Mobile apontam para o mesmo processo/banco.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const db = require('../database');

const STARTED_AT_MS = Date.now();
const STARTED_AT = new Date(STARTED_AT_MS).toISOString();

function obterOuCriarInstanceId() {
  const dir = db.dbDir || path.dirname(db.dbPath || '.');
  const file = path.join(dir, 'instance.id');
  try {
    if (fs.existsSync(file)) {
      const existing = String(fs.readFileSync(file, 'utf8') || '').trim();
      if (existing) return existing;
    }
  } catch (_e) { /* ignora */ }

  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `cds-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, id, 'utf8');
  } catch (_e) { /* em memória se falhar gravação */ }
  return id;
}

function obterVersaoSistema() {
  try {
    const pkg = require('../../package.json');
    return pkg.version || '0.0.0';
  } catch (_e) {
    return '0.0.0';
  }
}

function obterVersaoBanco() {
  return new Promise((resolve) => {
    try {
      db.get('PRAGMA user_version', [], (err, row) => {
        if (err) return resolve('n/d');
        const v = row && (row.user_version ?? Object.values(row)[0]);
        resolve(v != null ? String(v) : '0');
      });
    } catch (_e) {
      resolve('n/d');
    }
  });
}

/**
 * Hash rápido e estável do arquivo SQLite (caminho + tamanho + mtime + amostra).
 * Permite comparar Desktop × Mobile sem ler o banco inteiro.
 */
function calcularDatabaseHash(dbPath) {
  try {
    if (!dbPath || !fs.existsSync(dbPath)) return null;
    const st = fs.statSync(dbPath);
    const hash = crypto.createHash('sha256');
    hash.update(String(dbPath));
    hash.update('\0');
    hash.update(String(st.size));
    hash.update('\0');
    hash.update(String(Math.floor(st.mtimeMs)));
    const sampleSize = Math.min(65536, st.size);
    if (sampleSize > 0) {
      const fd = fs.openSync(dbPath, 'r');
      try {
        const buf = Buffer.alloc(sampleSize);
        fs.readSync(fd, buf, 0, sampleSize, 0);
        hash.update(buf);
      } finally {
        fs.closeSync(fd);
      }
    }
    return hash.digest('hex');
  } catch (_e) {
    return null;
  }
}

function detectarAmbiente() {
  if (process.env.NODE_ENV === 'production') return 'producao';
  if (process.env.CDS_AMBIENTE) return String(process.env.CDS_AMBIENTE);
  if (process.versions && process.versions.electron) return 'desktop-electron';
  return process.env.NODE_ENV || 'desenvolvimento';
}

/**
 * @param {import('express').Request} [req]
 * @returns {Promise<Object>}
 */
async function montarDiagnostico(req) {
  const port = process.env.PORT || 3002;
  const host = req?.headers?.host || `localhost:${port}`;
  const proto = req?.headers?.['x-forwarded-proto']
    || (req?.secure ? 'https' : 'http');
  const apiUrl = `${proto}://${host}/api`;
  const dbPath = db.dbPath || null;

  return {
    instanceId: obterOuCriarInstanceId(),
    hostname: os.hostname(),
    apiUrl,
    dbPath,
    dbDir: db.dbDir || null,
    databaseHash: calcularDatabaseHash(dbPath),
    ambiente: detectarAmbiente(),
    versaoSistema: obterVersaoSistema(),
    versaoBanco: await obterVersaoBanco(),
    processId: process.pid,
    pid: process.pid,
    uptime: Math.floor((Date.now() - STARTED_AT_MS) / 1000),
    uptimeProcesso: Math.floor(process.uptime()),
    startedAt: STARTED_AT,
    timestampServidor: new Date().toISOString(),
    plataforma: process.platform,
    nodeVersion: process.version
  };
}

module.exports = {
  montarDiagnostico,
  obterOuCriarInstanceId,
  calcularDatabaseHash,
  STARTED_AT,
  STARTED_AT_MS
};
