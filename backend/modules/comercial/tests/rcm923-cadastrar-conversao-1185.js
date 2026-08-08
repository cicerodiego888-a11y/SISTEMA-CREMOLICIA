/**
 * RCM-9.2.3 — Cadastra conversão oficial Sorvete LT→KG 0,58 no produto #1185.
 * Fonte: docs/RCM89_CONVERSOES_PRODUTO.md (não inventa fator).
 * Não altera Resolver / Atacado / MUC core — só cadastro produto_conversoes.
 */
const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));
const db = require('../../../database');
const muc = require('../../../motores/muc');
const mcc = require('../../../motores/motor-conversao-comercial');

const PRODUTO_ID = 1185;
/** RCM-8.9 — exemplo oficial Cremolicia: Sorvete LT → KG = 0,58 */
const FATOR_OFICIAL_LT_KG = 0.58;

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function waitDb() {
  for (let i = 0; i < 60; i++) {
    try {
      await get('SELECT 1');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('DB não pronto');
}

async function main() {
  await waitDb();
  console.log('\nRCM-9.2.3 — Cadastro conversão #1185 (Sorvete LT→KG 0,58)\n');

  const prod = await get(
    `SELECT id, nome, unidade, unidade_venda, forma_comercializacao, estoque_atual
     FROM produtos WHERE id = ?`,
    [PRODUTO_ID]
  );
  assert.ok(prod, 'produto 1185 existe');
  console.log('Produto:', {
    id: prod.id,
    nome: prod.nome,
    unidade_base: prod.unidade,
    unidade_venda: prod.unidade_venda,
    forma: prod.forma_comercializacao,
    estoque: prod.estoque_atual
  });

  assert.ok(/^l(t|itro)?$/i.test(String(prod.unidade || '').trim()), 'unidade base estoque é L/LT');
  assert.strictEqual(String(prod.unidade_venda || '').toUpperCase(), 'KG', 'unidade_venda cadastro = KG');

  let lista = await muc.listarConversoesAtivas(db, PRODUTO_ID);
  const jaTem = (lista || []).some((c) => {
    const o = String(c.origem || '').toUpperCase();
    const d = String(c.destino || '').toUpperCase();
    return (o === 'LT' || o === 'L') && d === 'KG' && Number(c.fator) > 0;
  });

  if (jaTem) {
    console.log('OK — conversão LT→KG já cadastrada:', lista);
  } else {
    const criada = await muc.criarConversao(db, PRODUTO_ID, {
      origem: 'LT',
      destino: 'KG',
      fator: FATOR_OFICIAL_LT_KG,
      tipo: 'FIXA',
      ativo: 1
    });
    console.log('OK — conversão criada:', criada);
    lista = await muc.listarConversoesAtivas(db, PRODUTO_ID);
  }

  const produtoMuc = {
    id: PRODUTO_ID,
    unidade: prod.unidade,
    conversoes: lista
  };

  // 0,250 KG varejo → estoque em L
  const r = mcc.Converter({
    produto: produtoMuc,
    quantidade: 0.25,
    unidadeOrigem: 'KG',
    unidadeBase: 'L',
    contexto: 'PDV'
  });
  const esperadoL = 0.25 / FATOR_OFICIAL_LT_KG;
  assert.ok(Math.abs(r.quantidadeConvertida - esperadoL) < 1e-6, `0,25 KG → ${esperadoL} L`);
  console.log('OK — simulação MUC 0,25 KG →', r.quantidadeConvertida, 'L');

  // 0,25 LT atacado → 0,25 L (mesma dimensão via L↔LT canônica ou identidade)
  const rLt = mcc.Converter({
    produto: produtoMuc,
    quantidade: 0.25,
    unidadeOrigem: 'LT',
    unidadeBase: 'L',
    contexto: 'PDV'
  });
  assert.ok(Math.abs(rLt.quantidadeConvertida - 0.25) < 1e-6, '0,25 LT → 0,25 L');
  console.log('OK — simulação MUC 0,25 LT →', rLt.quantidadeConvertida, 'L');

  console.log('\nRCM-9.2.3 CADASTRO MUC PASSOU\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFALHA:', err && err.message ? err.message : err);
    process.exit(1);
  });
