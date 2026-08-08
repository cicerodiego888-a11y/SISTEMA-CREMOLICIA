/**
 * Teste arquitetural RCM-04.6
 *
 * Falha se novos acessos diretos a preços legados forem introduzidos
 * fora da allowlist (fallback do resolver, writes, migrations, testes).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../../..');

const ALLOWLIST = [
  /[\\/]modules[\\/]comercial[\\/]preco[\\/]ComercialPrecoResolver\.js$/,
  /[\\/]modules[\\/]comercial[\\/]diagnostico[\\/]/,
  /[\\/]modules[\\/]comercial[\\/]configuracao[\\/]/,
  /[\\/]modules[\\/]comercial[\\/]tests[\\/]/,
  /[\\/]migrations?[\\/]/,
  /[\\/]database\.js$/,
  /[\\/]tests?[\\/]/,
  /\.test\.js$/,
  /\.spec\.js$/,
  /\.bundle\.js$/
];

/** Padrões que indicam uso de preço legado como fonte de venda (não SELECT/UPDATE). */
const FORBIDDEN = [
  {
    id: 'assign-number-preco_venda-sql',
    re: /preco_venda\s*:\s*Number\(\s*(?:row|pr|dados)\.preco_venda/,
    msg: 'Atribuição direta de preco_venda a partir da coluna SQL — use ComercialPrecoResolver'
  },
  {
    id: 'preco-from-dados-preco_venda',
    re: /preco\s*:\s*(?:dados)\.preco_venda\s*\?\?/,
    msg: 'Mapper usando dados.preco_venda — use ComercialPrecoResolver.obterPrecoVenda'
  },
  {
    id: 'sql-sum-preco_venda',
    re: /\*\s*p\.preco_venda/,
    msg: 'Valuation SQL com p.preco_venda — resolva via ComercialPrecoResolver'
  },
  {
    id: 'produto-preco-sem-precoVenda',
    re: /entrada\.precoUnitario\s*\?\?\s*produto\.preco\s*\?\?\s*0/,
    msg: 'Use produto.precoVenda (já resolvido pelo gateway)'
  },
  {
    id: 'simular-preco_venda-direto',
    re: /produto\.preco\s*\?\?\s*produto\.preco_venda/,
    msg: 'Não ler preco_venda legado diretamente — use preço já resolvido (preco / precoVenda)'
  }
];

function isAllowlisted(filePath) {
  const normalized = filePath.replace(/\//g, path.sep);
  return ALLOWLIST.some((re) => re.test(normalized));
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'vendor') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function scanFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  if (isAllowlisted(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const hits = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    // SELECT/INSERT/UPDATE de coluna são persistência — não bloqueiam
    if (/\b(SELECT|INSERT|UPDATE|WHERE)\b/i.test(line) && /preco_venda/.test(line)) return;
    if (/SET\s+.*preco_venda/i.test(line)) return;

    for (const rule of FORBIDDEN) {
      if (rule.re.test(line)) {
        hits.push({
          file: rel,
          line: idx + 1,
          rule: rule.id,
          msg: rule.msg,
          code: trimmed.slice(0, 160)
        });
      }
    }
  });

  return hits;
}

function run() {
  const dirs = [
    path.join(ROOT, 'backend'),
    path.join(ROOT, 'frontend', 'modules', 'motor-comercial'),
    path.join(ROOT, 'frontend', 'pdv', 'js')
  ];

  const files = dirs.flatMap((d) => walk(d));
  const violations = files.flatMap(scanFile);

  if (violations.length) {
    console.error('RCM-04.6 ARCH FAIL — acessos diretos a preços legados:');
    violations.forEach((v) => {
      console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.msg}`);
      console.error(`    ${v.code}`);
    });
    process.exit(1);
  }

  console.log(`RCM-04.6 ARCH OK — ${files.length} arquivos varridos, 0 violações.`);
}

run();
