/**
 * Carregado via `node -r` pelos testes NF-e: aponta DB_DIR e FISCAL_DIR para uma
 * pasta temporária, para que os testes nunca gravem no banco fiscal ativo
 * (C:\ProgramData\MercantilFiscal\dados).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(os.tmpdir(), 'cds-nfe-testes');
fs.mkdirSync(path.join(dir, 'fiscal'), { recursive: true });

process.env.DB_DIR = dir;
process.env.FISCAL_DIR = path.join(dir, 'fiscal');
