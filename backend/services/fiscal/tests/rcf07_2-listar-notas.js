/** Lista últimas NFC-e para apoio à homologação RCF-07.2 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const DB_PATH = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados', 'mercadao.db');
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
const sql = `
  SELECT n.id AS nota_id, n.venda_id, n.numero, n.status, n.chave_acesso,
         (SELECT COUNT(*) FROM vendas_itens vi WHERE vi.venda_id = n.venda_id) AS itens
  FROM nfce_notas n
  ORDER BY n.id DESC
  LIMIT 8
`;
db.all(sql, [], (err, rows) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
