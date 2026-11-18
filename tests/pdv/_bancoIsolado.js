/**
 * Carregado via `node -r` pelos testes do PDV que usam backend/database.js:
 * aponta DB_DIR e FISCAL_DIR para uma pasta temporária, para que os testes
 * nunca gravem no banco ativo (C:\ProgramData\MercantilFiscal\dados).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(os.tmpdir(), 'cds-pdv-testes', 'banco');
fs.mkdirSync(path.join(dir, 'fiscal'), { recursive: true });

process.env.DB_DIR = dir;
process.env.FISCAL_DIR = path.join(dir, 'fiscal');
