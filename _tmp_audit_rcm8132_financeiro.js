/**
 * RCM-8.13.2 — Auditoria financeira somente leitura.
 * CONS-2026-000021 / CICERO MAXIMINO DE SOUSA
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados', 'mercadao.db');
const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);

const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r || []))));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r || null))));

function money(n) {
  return Number(n || 0);
}

(async () => {
  console.log('DB', DB);

  const cons = await get(
    `SELECT * FROM consignacoes WHERE documento_numero = 'CONS-2026-000021' OR id = 24 LIMIT 1`
  );
  console.log('\n=== CONSIGNAÇÃO ===');
  console.log({
    id: cons?.id,
    documento: cons?.documento_numero,
    cliente_id: cons?.cliente_id,
    perfil_comercial_id: cons?.perfil_comercial_id,
    status: cons?.status,
    valor_total_entregue: cons?.valor_total_entregue,
    valor_total_acertado: cons?.valor_total_acertado,
    valor_total_pago: cons?.valor_total_pago,
    saldo_aberto: cons?.saldo_aberto,
    prestacao_json: cons?.prestacao_contas_ativa || cons?.prestacao_contas,
    grupo: null
  });

  // tentar colunas de prestacao
  const consCols = await all(`PRAGMA table_info(consignacoes)`);
  console.log('cols consignacoes relevantes:', consCols.filter((c) =>
    /saldo|valor|prest|grupo|status/i.test(c.name)).map((c) => c.name));

  const cliente = await get(`SELECT id, nome FROM clientes WHERE id = ?`, [cons.cliente_id]);
  console.log('\nCLIENTE', cliente);

  const perfil = await get(
    `SELECT * FROM perfil_comercial WHERE id = ? OR cliente_id = ? ORDER BY id DESC LIMIT 5`,
    [cons.perfil_comercial_id, cons.cliente_id]
  );
  const perfis = await all(`SELECT id, cliente_id, perfil_tipo, limite_comercial, saldo_aberto, ativo, bloqueado FROM perfil_comercial WHERE cliente_id = ?`, [cons.cliente_id]);
  console.log('\nPERFIS', perfis);

  // itens
  const itens = await all(
    `SELECT ci.id, ci.produto_id, p.nome, ci.quantidade_entregue, ci.preco_unitario, ci.subtotal_entregue,
            ci.quantidade_vendida, ci.quantidade_devolvida, ci.quantidade_perdida, ci.quantidade_cortesia
     FROM consignacoes_itens ci
     LEFT JOIN produtos p ON p.id = ci.produto_id
     WHERE ci.consignacao_id = ?`,
    [cons.id]
  );
  console.log('\nITENS CONS-021');
  let totalItens = 0;
  itens.forEach((i) => {
    const sub = money(i.subtotal_entregue) || money(i.quantidade_entregue) * money(i.preco_unitario);
    totalItens += sub;
    console.log({
      produto: i.nome,
      qtd: i.quantidade_entregue,
      preco: i.preco_unitario,
      subtotal: sub,
      vendida: i.quantidade_vendida,
      devolvida: i.quantidade_devolvida
    });
  });
  console.log('TOTAL ITENS ATUAL', totalItens);

  // todas consignações do cliente
  const consignacoes = await all(
    `SELECT id, documento_numero, status,
            valor_total_entregue, valor_total_acertado, valor_total_pago, saldo_aberto,
            data_entrega, data_abertura, data_encerramento,
            perfil_comercial_id
     FROM consignacoes WHERE cliente_id = ? ORDER BY id`,
    [cons.cliente_id]
  );
  console.log('\n=== TODAS CONSIGNAÇÕES DO CLIENTE ===');
  let sumSaldoAberto = 0;
  let sumEntregue = 0;
  consignacoes.forEach((c) => {
    sumSaldoAberto += money(c.saldo_aberto);
    sumEntregue += money(c.valor_total_entregue);
    console.log({
      id: c.id,
      doc: c.documento_numero,
      status: c.status,
      entregue: c.valor_total_entregue,
      acertado: c.valor_total_acertado,
      pago: c.valor_total_pago,
      saldo_aberto: c.saldo_aberto
    });
  });
  console.log('SOMA saldo_aberto consignacoes', sumSaldoAberto);
  console.log('SOMA valor_total_entregue', sumEntregue);
  console.log('PERFIL saldo_aberto', perfis.map((p) => ({ id: p.id, saldo: p.saldo_aberto, limite: p.limite_comercial })));

  // movimentações da consignação 021
  const movs021 = await all(
    `SELECT id, tipo_movimentacao, correlation_id, grupo_prestacao_contas_id,
            valor, quantidade, data_movimentacao,
            json_extract(snapshot, '$.contexto.operacao') AS operacao
     FROM movimentacoes_comerciais
     WHERE consignacao_id = ?
     ORDER BY data_movimentacao, id`,
    [cons.id]
  );
  console.log('\n=== LEDGER CONS-021 ===');
  const byTipo = {};
  movs021.forEach((m) => {
    byTipo[m.tipo_movimentacao] = (byTipo[m.tipo_movimentacao] || 0) + money(m.valor);
    console.log({
      id: m.id,
      tipo: m.tipo_movimentacao,
      op: m.operacao,
      valor: m.valor,
      qtd: m.quantidade,
      grupo: m.grupo_prestacao_contas_id,
      corr: String(m.correlation_id || '').slice(0, 8)
    });
  });
  console.log('SOMA POR TIPO CONS-021', byTipo);

  // todas movs do perfil
  const perfilId = cons.perfil_comercial_id;
  const movsPerfil = await all(
    `SELECT m.id, m.consignacao_id, m.tipo_movimentacao, m.valor, m.quantidade,
            m.grupo_prestacao_contas_id, m.data_movimentacao,
            c.documento_numero,
            json_extract(m.snapshot, '$.contexto.operacao') AS operacao
     FROM movimentacoes_comerciais m
     INNER JOIN consignacoes c ON c.id = m.consignacao_id
     WHERE c.perfil_comercial_id = ?
     ORDER BY m.data_movimentacao, m.id`,
    [perfilId]
  );

  console.log('\n=== LEDGER PERFIL (todas consignações) — totais por tipo ===');
  const byTipoP = {};
  const byCons = {};
  movsPerfil.forEach((m) => {
    const v = money(m.valor);
    byTipoP[m.tipo_movimentacao] = (byTipoP[m.tipo_movimentacao] || 0) + v;
    if (!byCons[m.consignacao_id]) {
      byCons[m.consignacao_id] = { doc: m.documento_numero, tipos: {}, totalEntrega: 0 };
    }
    byCons[m.consignacao_id].tipos[m.tipo_movimentacao] =
      (byCons[m.consignacao_id].tipos[m.tipo_movimentacao] || 0) + v;
    if (m.tipo_movimentacao === 'ENTREGA') byCons[m.consignacao_id].totalEntrega += v;
  });
  console.log(byTipoP);
  console.log('\nPor consignação (ENTREGA e outros):');
  Object.entries(byCons).forEach(([id, info]) => {
    console.log(id, info.doc, info.tipos);
  });

  // Reproduzir CreditoComercialService.calcular de forma simplificada
  // Need to read formula - estoqueConsignado + AR
  const entregas = money(byTipoP.ENTREGA);
  const devolucoes = money(byTipoP.DEVOLUCAO);
  const vendas = money(byTipoP.VENDA_PRESTACAO) + money(byTipoP.VENDA);
  const pagamentos = money(byTipoP.PAGAMENTO);
  const perdas = money(byTipoP.PERDA) + money(byTipoP.PERDA_CLIENTE) + money(byTipoP.PERDA_EMPRESA);
  const cortesias = money(byTipoP.CORTESIA);

  // From projectionHelpers calcularSaldosComerciais:
  const saldoEmAbertoAR = vendas - pagamentos; // financeiro conta corrente
  const saldoConsignado = entregas - devolucoes - vendas - perdas - cortesias;

  console.log('\n=== FÓRMULAS RECONSTRUÍDAS (perfil completo) ===');
  console.log({
    entregas,
    devolucoes,
    vendas,
    pagamentos,
    perdas,
    cortesias,
    'Financeiro saldoEmAberto (vendas-pagamentos)': saldoEmAbertoAR,
    'estoqueConsignado (entregas-dev-vendas-perdas-cort)': saldoConsignado,
    'saldoDevedor aproximado (AR + estoque)': saldoEmAbertoAR + Math.max(0, saldoConsignado)
  });

  // grupos prestacao
  const grupos = await all(
    `SELECT DISTINCT grupo_prestacao_contas_id AS g
     FROM movimentacoes_comerciais
     WHERE consignacao_id = ? AND grupo_prestacao_contas_id IS NOT NULL`,
    [cons.id]
  );
  console.log('\nGRUPOS PREST CONS-021', grupos);

  for (const g of grupos) {
    const movsG = await all(
      `SELECT tipo_movimentacao, SUM(valor) AS total, COUNT(*) AS n
       FROM movimentacoes_comerciais
       WHERE grupo_prestacao_contas_id = ?
       GROUP BY tipo_movimentacao`,
      [g.g]
    );
    const consG = await all(
      `SELECT DISTINCT c.id, c.documento_numero, c.status, c.saldo_aberto, c.valor_total_entregue
       FROM movimentacoes_comerciais m
       JOIN consignacoes c ON c.id = m.consignacao_id
       WHERE m.grupo_prestacao_contas_id = ?`,
      [g.g]
    );
    console.log('Grupo', g.g, 'tipos', movsG, 'consignacoes', consG);
  }

  // Contas a receber?
  const car = await all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%receber%'`
  ).catch(() => []);
  console.log('\nTabelas receber', car);

  db.close();
})().catch((e) => {
  console.error(e);
  try { db.close(); } catch (_) {}
  process.exit(1);
});
