/**
 * Orçamento → Pedido (NF-E-04.0).
 *
 * Orçamento: RASCUNHO → APRESENTADO → APROVADO | REPROVADO | CANCELADO.
 * Aprovar cria um pedido comercial (origem ORCAMENTO, pedidos_comerciais.orcamento_id);
 * a tabela legada `pedidos` não é usada. Pedido direto: origem DIRETO, orcamento_id NULL.
 * Pedido: ABERTO → FATURADO | CANCELADO. FATURADO só na confirmação da emissão NF-e
 * (confirmarEmissaoNfePedido); abrir o formulário de emissão não altera o pedido.
 * Estoque e financeiro só se movem no faturamento confirmado (faturamentoNfeService → criarVenda).
 */

'use strict';

const faturamento = require('../vendas/faturamentoNfeService');

const STATUS_ORCAMENTO = Object.freeze(['RASCUNHO', 'APRESENTADO', 'APROVADO', 'REPROVADO', 'CANCELADO']);
const STATUS_PEDIDO = Object.freeze(['ABERTO', 'FATURADO', 'CANCELADO']);
const ORIGENS_PEDIDO = Object.freeze(['ORCAMENTO', 'DIRETO']);
const ORCAMENTO_EDITAVEL = Object.freeze(['RASCUNHO', 'APRESENTADO']);
const TRANSICOES_ORCAMENTO = Object.freeze({
  RASCUNHO: ['APRESENTADO', 'REPROVADO', 'CANCELADO'],
  APRESENTADO: ['REPROVADO', 'CANCELADO']
});

const { erroFaturamento: erro } = faturamento;

function obterDb(deps) {
  return (deps && deps.db) || require('../../database');
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function garantirSchemaPedidos(db = obterDb()) {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS orcamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      cliente_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'RASCUNHO'
        CHECK (status IN ('RASCUNHO','APRESENTADO','APROVADO','REPROVADO','CANCELADO')),
      total_itens REAL NOT NULL DEFAULT 0,
      desconto REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      forma_pagamento TEXT,
      parcelas INTEGER,
      validade DATE,
      observacoes TEXT,
      pedido_id INTEGER,
      usuario_id INTEGER,
      aprovado_em DATETIME,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )`,
    `CREATE TABLE IF NOT EXISTS orcamento_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orcamento_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      preco_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (orcamento_id) REFERENCES orcamentos(id),
      FOREIGN KEY (produto_id) REFERENCES produtos(id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_orcamento_itens_orcamento ON orcamento_itens(orcamento_id)'
  ];
  for (const sql of ddl) await run(db, sql);
  const migration022 = require('../../modules/comercial/migrations/022_pedidos_comerciais');
  await migration022(db);
  const migration023 = require('../../modules/comercial/migrations/023_nfe_pedidos');
  await migration023(db);
}

async function transacao(db, fn) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const out = await fn();
    await run(db, 'COMMIT');
    return out;
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

function codigoDocumento(prefixo, id) {
  return `${prefixo}-${String(id).padStart(6, '0')}`;
}

/** Dados comerciais comuns a orçamento e pedido, já validados e totalizados. */
async function normalizarDadosComerciais(db, dados) {
  const clienteId = Number(dados.cliente_id ?? dados.clienteId);
  if (!Number.isInteger(clienteId) || clienteId <= 0) throw erro('Selecione o cliente.', 'CLIENTE_OBRIGATORIO');
  const cliente = await get(db, 'SELECT id FROM clientes WHERE id = ?', [clienteId]);
  if (!cliente) throw erro('Cliente não encontrado.', 'CLIENTE_NAO_ENCONTRADO', 404);
  const itens = faturamento.normalizarItensComerciais(dados.itens);
  const ids = [...new Set(itens.map((i) => i.produto_id))];
  const existentes = await all(db, `SELECT id FROM produtos WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  if (existentes.length !== ids.length) throw erro('Um ou mais produtos não foram encontrados.', 'PRODUTO_NAO_ENCONTRADO', 404);
  const totais = faturamento.totaisComerciais(itens, dados.desconto);
  const forma = dados.forma_pagamento ?? dados.formaPagamento;
  const formaPagamento = forma ? String(forma).trim().toLowerCase() : 'dinheiro';
  if (!faturamento.FORMAS_PAGAMENTO.includes(formaPagamento)) throw erro('Forma de pagamento inválida.', 'FORMA_PAGAMENTO_INVALIDA');
  return {
    clienteId,
    itens,
    totais,
    formaPagamento,
    parcelas: formaPagamento === 'prazo' ? Math.max(1, Number(dados.parcelas) || 1) : null,
    primeiroVencimento: dados.primeiro_vencimento || dados.primeiroVencimento || null,
    validade: dados.validade || null,
    observacoes: dados.observacoes ? String(dados.observacoes).slice(0, 1000) : null
  };
}

async function gravarItens(db, tabela, chave, docId, itens) {
  await run(db, `DELETE FROM ${tabela} WHERE ${chave} = ?`, [docId]);
  for (const i of itens) {
    await run(db, `INSERT INTO ${tabela} (${chave}, produto_id, quantidade, preco_unitario, subtotal) VALUES (?, ?, ?, ?, ?)`,
      [docId, i.produto_id, i.quantidade, i.preco_unitario, i.subtotal]);
  }
}

// ---------------------------------------------------------------------------
// Orçamento
// ---------------------------------------------------------------------------

async function criarOrcamento(dados, contexto = {}, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const d = await normalizarDadosComerciais(db, dados);
  const id = await transacao(db, async () => {
    const r = await run(db, `
      INSERT INTO orcamentos (cliente_id, status, total_itens, desconto, total, forma_pagamento, parcelas, validade, observacoes, usuario_id)
      VALUES (?, 'RASCUNHO', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.clienteId, d.totais.totalItens, d.totais.desconto, d.totais.total, d.formaPagamento, d.parcelas, d.validade, d.observacoes, contexto.usuarioId || null]);
    await run(db, 'UPDATE orcamentos SET codigo = ? WHERE id = ?', [codigoDocumento('ORC', r.lastID), r.lastID]);
    await gravarItens(db, 'orcamento_itens', 'orcamento_id', r.lastID, d.itens);
    return r.lastID;
  });
  return obterOrcamento(id, deps);
}

async function atualizarOrcamento(id, dados, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const atual = await get(db, 'SELECT * FROM orcamentos WHERE id = ?', [Number(id)]);
  if (!atual) throw erro('Orçamento não encontrado.', 'ORCAMENTO_NAO_ENCONTRADO', 404);
  if (!ORCAMENTO_EDITAVEL.includes(atual.status)) {
    throw erro(`Orçamento ${atual.status.toLowerCase()} não pode ser alterado.`, 'ORCAMENTO_NAO_EDITAVEL', 409);
  }
  const d = await normalizarDadosComerciais(db, dados);
  await transacao(db, async () => {
    await run(db, `
      UPDATE orcamentos SET cliente_id = ?, total_itens = ?, desconto = ?, total = ?, forma_pagamento = ?, parcelas = ?,
        validade = ?, observacoes = ?, updated_at = datetime('now','localtime')
      WHERE id = ?`,
    [d.clienteId, d.totais.totalItens, d.totais.desconto, d.totais.total, d.formaPagamento, d.parcelas, d.validade, d.observacoes, atual.id]);
    await gravarItens(db, 'orcamento_itens', 'orcamento_id', atual.id, d.itens);
  });
  return obterOrcamento(atual.id, deps);
}

/** RASCUNHO → APRESENTADO; RASCUNHO/APRESENTADO → REPROVADO | CANCELADO. Aprovação: aprovarOrcamento. */
async function alterarStatusOrcamento(id, novoStatus, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const status = String(novoStatus || '').trim().toUpperCase();
  if (status === 'APROVADO') throw erro('Use a aprovação do orçamento para gerar o pedido.', 'TRANSICAO_INVALIDA', 409);
  const atual = await get(db, 'SELECT id, status FROM orcamentos WHERE id = ?', [Number(id)]);
  if (!atual) throw erro('Orçamento não encontrado.', 'ORCAMENTO_NAO_ENCONTRADO', 404);
  if (!(TRANSICOES_ORCAMENTO[atual.status] || []).includes(status)) {
    throw erro(`Transição inválida: ${atual.status} → ${status || '?'}.`, 'TRANSICAO_INVALIDA', 409);
  }
  const r = await run(db, "UPDATE orcamentos SET status = ?, updated_at = datetime('now','localtime') WHERE id = ? AND status = ?",
    [status, atual.id, atual.status]);
  if (!r.changes) throw erro('O orçamento foi alterado por outra operação. Recarregue.', 'CONCORRENCIA', 409);
  return obterOrcamento(atual.id, deps);
}

/**
 * Aprova o orçamento e cria o pedido relacionado (origem ORCAMENTO). Não emite NF-e,
 * não movimenta estoque nem financeiro. Repetir a aprovação devolve o mesmo pedido.
 */
async function aprovarOrcamento(id, contexto = {}, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const pedidoId = await transacao(db, async () => {
    const orc = await get(db, 'SELECT * FROM orcamentos WHERE id = ?', [Number(id)]);
    if (!orc) throw erro('Orçamento não encontrado.', 'ORCAMENTO_NAO_ENCONTRADO', 404);
    if (orc.status === 'APROVADO' && orc.pedido_id) return Number(orc.pedido_id);
    if (!ORCAMENTO_EDITAVEL.includes(orc.status)) {
      throw erro(`Orçamento ${orc.status.toLowerCase()} não pode ser aprovado.`, 'TRANSICAO_INVALIDA', 409);
    }
    const itens = await all(db, 'SELECT produto_id, quantidade, preco_unitario, subtotal FROM orcamento_itens WHERE orcamento_id = ? ORDER BY id', [orc.id]);
    if (!itens.length) throw erro('Orçamento sem itens.', 'ITENS_OBRIGATORIOS', 409);
    const r = await run(db, `
      INSERT INTO pedidos_comerciais (origem, orcamento_id, cliente_id, status, total_itens, desconto, total, forma_pagamento, parcelas, observacoes, usuario_id)
      VALUES ('ORCAMENTO', ?, ?, 'ABERTO', ?, ?, ?, ?, ?, ?, ?)`,
    [orc.id, orc.cliente_id, orc.total_itens, orc.desconto, orc.total, orc.forma_pagamento, orc.parcelas, orc.observacoes, contexto.usuarioId || null]);
    await run(db, 'UPDATE pedidos_comerciais SET codigo = ? WHERE id = ?', [codigoDocumento('PED', r.lastID), r.lastID]);
    await gravarItens(db, 'pedido_itens', 'pedido_id', r.lastID, itens);
    await run(db, `
      UPDATE orcamentos SET status = 'APROVADO', pedido_id = ?, aprovado_em = datetime('now','localtime'),
        updated_at = datetime('now','localtime')
      WHERE id = ?`, [r.lastID, orc.id]);
    return r.lastID;
  });
  return obterPedido(pedidoId, deps);
}

async function obterOrcamento(id, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const orc = await get(db, `
    SELECT o.*, c.nome AS cliente_nome, c.cpf_cnpj AS cliente_documento, c.telefone AS cliente_telefone,
           c.rua AS cliente_rua, c.numero AS cliente_numero, c.bairro AS cliente_bairro,
           c.cidade AS cliente_cidade, c.uf AS cliente_uf
    FROM orcamentos o LEFT JOIN clientes c ON c.id = o.cliente_id WHERE o.id = ?`, [Number(id)]);
  if (!orc) throw erro('Orçamento não encontrado.', 'ORCAMENTO_NAO_ENCONTRADO', 404);
  orc.itens = await all(db, `
    SELECT i.*, p.nome AS produto_nome, p.codigo AS produto_codigo, p.unidade AS produto_unidade
    FROM orcamento_itens i LEFT JOIN produtos p ON p.id = i.produto_id
    WHERE i.orcamento_id = ? ORDER BY i.id`, [orc.id]);
  return orc;
}

async function listarOrcamentos(filtros = {}, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const where = ['1=1'];
  const params = [];
  const status = String(filtros.status || '').trim().toUpperCase();
  if (status) { where.push('o.status = ?'); params.push(status); }
  return all(db, `
    SELECT o.id, o.codigo, o.status, o.total, o.cliente_id, o.pedido_id, o.created_at, o.validade,
           c.nome AS cliente_nome
    FROM orcamentos o LEFT JOIN clientes c ON c.id = o.cliente_id
    WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, params);
}

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

async function criarPedidoDireto(dados, contexto = {}, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const d = await normalizarDadosComerciais(db, dados);
  const id = await transacao(db, async () => {
    const r = await run(db, `
      INSERT INTO pedidos_comerciais (origem, orcamento_id, cliente_id, status, total_itens, desconto, total, forma_pagamento, parcelas,
        primeiro_vencimento, observacoes, usuario_id)
      VALUES ('DIRETO', NULL, ?, 'ABERTO', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.clienteId, d.totais.totalItens, d.totais.desconto, d.totais.total, d.formaPagamento, d.parcelas,
      d.primeiroVencimento, d.observacoes, contexto.usuarioId || null]);
    await run(db, 'UPDATE pedidos_comerciais SET codigo = ? WHERE id = ?', [codigoDocumento('PED', r.lastID), r.lastID]);
    await gravarItens(db, 'pedido_itens', 'pedido_id', r.lastID, d.itens);
    return r.lastID;
  });
  return obterPedido(id, deps);
}

async function cancelarPedido(id, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const r = await run(db, "UPDATE pedidos_comerciais SET status = 'CANCELADO', updated_at = datetime('now','localtime') WHERE id = ? AND status = 'ABERTO'", [Number(id)]);
  if (!r.changes) {
    const p = await get(db, 'SELECT status FROM pedidos_comerciais WHERE id = ?', [Number(id)]);
    if (!p) throw erro('Pedido não encontrado.', 'PEDIDO_NAO_ENCONTRADO', 404);
    throw erro(`Pedido ${p.status.toLowerCase()} não pode ser cancelado.`, 'TRANSICAO_INVALIDA', 409);
  }
  return obterPedido(id, deps);
}

/**
 * Situação NF-e do pedido. ABERTO: valida cliente/itens/estoque fiscal (sem prontidão,
 * que é checada no clique) → acao 'emitir_pedido'. FATURADO: situação NF-e da venda gerada.
 */
async function situacaoNfePedido(db, pedido) {
  if (pedido.status === 'CANCELADO') {
    return { pode_emitir: false, acao: 'nenhuma', motivo_bloqueio: 'Pedido cancelado.', venda_id: null, nota: null };
  }
  if (pedido.status === 'FATURADO' && pedido.venda_id) {
    const { resumoNfeDaVenda } = require('../fiscal/nfeEmissorVenda');
    const venda = await get(db, 'SELECT * FROM vendas WHERE id = ?', [pedido.venda_id]);
    const itens = await all(db, 'SELECT * FROM vendas_itens WHERE venda_id = ?', [pedido.venda_id]);
    const resumo = venda ? await resumoNfeDaVenda(venda, itens) : null;
    return { ...(resumo || { pode_emitir: false, acao: 'nenhuma', motivo_bloqueio: 'Venda do pedido não encontrada.', nota: null }), venda_id: pedido.venda_id };
  }
  try {
    const itens = faturamento.normalizarItensComerciais(pedido.itens || []);
    await faturamento.validarOperacaoNfe(db, { clienteId: pedido.cliente_id, itens });
    return { pode_emitir: true, acao: 'emitir_pedido', motivo_bloqueio: null, venda_id: null, nota: null };
  } catch (err) {
    return { pode_emitir: false, acao: 'nenhuma', motivo_bloqueio: err.message, codigo: err.code || null, venda_id: null, nota: null };
  }
}

async function obterPedido(id, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const pedido = await get(db, `
    SELECT p.*, c.nome AS cliente_nome, c.cpf_cnpj AS cliente_documento, c.telefone AS cliente_telefone,
           c.rua AS cliente_rua, c.numero AS cliente_numero, c.bairro AS cliente_bairro,
           c.cidade AS cliente_cidade, c.uf AS cliente_uf, c.cep AS cliente_cep,
           c.inscricao_estadual AS cliente_inscricao_estadual,
           o.codigo AS orcamento_codigo, v.codigo AS venda_codigo
    FROM pedidos_comerciais p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN orcamentos o ON o.id = p.orcamento_id
    LEFT JOIN vendas v ON v.id = p.venda_id
    WHERE p.id = ?`, [Number(id)]);
  if (!pedido) throw erro('Pedido não encontrado.', 'PEDIDO_NAO_ENCONTRADO', 404);
  pedido.itens = await all(db, `
    SELECT i.*, p.nome AS produto_nome, p.codigo AS produto_codigo, p.unidade AS produto_unidade
    FROM pedido_itens i LEFT JOIN produtos p ON p.id = i.produto_id
    WHERE i.pedido_id = ? ORDER BY i.id`, [pedido.id]);
  pedido.nfe = await situacaoNfePedido(db, pedido);
  pedido.nfe_relacionadas = await listarNfeDoPedido(db, pedido);
  return pedido;
}

async function listarNfeDoPedido(db, pedido) {
  try {
    const linhas = await all(db, `
      SELECT n.id, n.numero, n.serie, n.status, n.chave_acesso, n.venda_id, np.valor_faturado
      FROM nfe_pedidos np
      INNER JOIN nfe_notas n ON n.id = np.nfe_id
      WHERE np.pedido_id = ?
      ORDER BY n.id`, [pedido.id]);
    if (linhas.length) return linhas;
  } catch (err) {
    if (!/no such table/i.test(err.message || '')) throw err;
  }
  const nota = pedido.nfe && pedido.nfe.nota;
  return nota ? [nota] : [];
}

function mensagemPedidoFaturado(pedido, nota) {
  const codigo = pedido.codigo || `PED-${String(pedido.id).padStart(6, '0')}`;
  if (nota && nota.numero) return `Pedido ${codigo} já foi faturado pela NF-e ${nota.numero}.`;
  return `Pedido ${codigo} já foi faturado.`;
}

async function carregarPedidosParaNfe(db, ids) {
  const lista = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!lista.length) throw erro('Selecione ao menos um pedido.', 'PEDIDO_OBRIGATORIO');
  const pedidos = [];
  for (const id of lista) {
    const pedido = await get(db, 'SELECT * FROM pedidos_comerciais WHERE id = ?', [id]);
    if (!pedido) {
      const orcamento = await get(db, 'SELECT id, codigo FROM orcamentos WHERE id = ?', [id]).catch(() => null);
      if (orcamento) {
        throw erro('Orçamento não pode ser importado para NF-e. Aprove o orçamento para gerar um pedido.', 'ORCAMENTO_NAO_IMPORTAVEL', 409);
      }
      throw erro('Pedido não encontrado.', 'PEDIDO_NAO_ENCONTRADO', 404);
    }
    if (pedido.status === 'CANCELADO') {
      throw erro(`Pedido ${pedido.codigo || id} está cancelado e não pode ser importado.`, 'PEDIDO_CANCELADO', 409);
    }
    if (pedido.status === 'FATURADO') {
      const nota = await get(db, `
        SELECT n.numero FROM nfe_pedidos np
        INNER JOIN nfe_notas n ON n.id = np.nfe_id
        WHERE np.pedido_id = ? ORDER BY n.id DESC LIMIT 1`, [pedido.id]).catch(() => null);
      throw erro(mensagemPedidoFaturado(pedido, nota), 'PEDIDO_JA_FATURADO', 409);
    }
    if (pedido.status !== 'ABERTO') {
      throw erro(`Pedido ${pedido.codigo || id} não pode ser faturado.`, 'PEDIDO_NAO_ELEGIVEL', 409);
    }
    pedidos.push(pedido);
  }
  const clienteId = Number(pedidos[0].cliente_id);
  if (pedidos.some((pedido) => Number(pedido.cliente_id) !== clienteId)) {
    throw erro('Este pedido pertence a outro cliente. Uma mesma NF-e não pode consolidar pedidos de clientes diferentes.', 'CLIENTE_DIVERGENTE', 409);
  }
  return pedidos;
}

async function listarPedidosElegiveisNfe(filtros = {}, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const clienteId = Number(filtros.clienteId || filtros.cliente_id) || null;
  return all(db, `
    SELECT p.id, p.codigo, p.cliente_id, p.status, p.total, p.desconto, p.total_itens, p.forma_pagamento,
           c.nome AS cliente_nome,
           (SELECT COUNT(*) FROM pedido_itens i WHERE i.pedido_id = p.id) AS quantidade_itens
    FROM pedidos_comerciais p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.status = 'ABERTO' AND (? IS NULL OR p.cliente_id = ?)
    ORDER BY p.id DESC LIMIT 300`, [clienteId, clienteId]);
}

/** Leitura do snapshot gravado. Não cria venda, não baixa estoque e não emite. */
async function prepararImportacaoPedidos(ids, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const pedidos = await carregarPedidosParaNfe(db, ids);
  const cliente = await get(db, `
    SELECT id, nome, cpf_cnpj, telefone, rua, numero, bairro, cidade, uf, cep, inscricao_estadual
    FROM clientes WHERE id = ?`, [pedidos[0].cliente_id]);
  const documentos = [];
  for (const pedido of pedidos) {
    const itens = await all(db, `
      SELECT i.id, i.produto_id, i.quantidade, i.preco_unitario, i.subtotal,
             p.nome AS produto_nome, p.codigo AS produto_codigo, p.unidade AS produto_unidade
      FROM pedido_itens i LEFT JOIN produtos p ON p.id = i.produto_id
      WHERE i.pedido_id = ? ORDER BY i.id`, [pedido.id]);
    documentos.push({ ...pedido, itens });
  }
  const totalItens = Math.round(documentos.reduce((s, p) => s + Number(p.total_itens || 0), 0) * 100) / 100;
  const desconto = Math.round(documentos.reduce((s, p) => s + Number(p.desconto || 0), 0) * 100) / 100;
  const total = Math.round(documentos.reduce((s, p) => s + Number(p.total || 0), 0) * 100) / 100;
  return {
    cliente,
    pedidos: documentos,
    desconto,
    total_itens: totalItens,
    total,
    forma_pagamento: pedidos[0].forma_pagamento,
    parcelas: pedidos[0].parcelas
  };
}

async function confirmarEmissaoNfePedidos(ids, entrada = {}, contexto = {}, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  faturamento.validarDadosNfeConfirmacao(entrada.dadosNfe);
  const usuario = { id: contexto.usuarioId || null, username: contexto.usuarioNome || null };
  const { withLock } = require('../fiscal/nfeEmissionLockService');
  const pedidos = await carregarPedidosParaNfe(db, ids);
  const chave = `pedidos-nfe-${pedidos.map((p) => p.id).sort((a, b) => a - b).join('-')}`;
  try {
    return await withLock(chave, async () => {
      const atuais = await carregarPedidosParaNfe(db, pedidos.map((p) => p.id));
      const avulsos = Array.isArray(entrada.itensAvulsos) ? entrada.itensAvulsos : [];
      let vendaId;
      if (!avulsos.length) {
        vendaId = await faturarPedidosSemLock(db, atuais, contexto, deps);
      } else {
        const grupos = [];
        for (const pedido of atuais) grupos.push({ pedido, itens: await itensGravadosDoPedido(db, pedido.id) });
        const itensPedido = grupos.flatMap((g) => g.itens.map((item) => ({
          produto_id: item.produto_id, quantidade: item.quantidade, preco_unitario: item.preco_unitario
        })));
        const extras = faturamento.normalizarItensComerciais(avulsos);
        const desconto = Math.round(atuais.reduce((s, p) => s + (Number(p.desconto) || 0), 0) * 100) / 100;
        const forma = String(atuais[0].forma_pagamento || entrada.formaPagamento || 'dinheiro');
        const gerado = await faturamento.faturarOperacaoNfe({
          origem: faturamento.ORIGEM_VENDA.PEDIDO,
          clienteId: atuais[0].cliente_id,
          itens: itensPedido.concat(extras),
          desconto,
          formaPagamento: forma,
          parcelas: forma === 'prazo' ? atuais[0].parcelas : null,
          primeiroVencimento: atuais[0].primeiro_vencimento,
          usuarioId: contexto.usuarioId
        }, { ...deps, db });
        vendaId = gerado.vendaId;
        await registrarVinculosVenda(db, vendaId, grupos);
        await marcarPedidosFaturados(db, vendaId, atuais);
      }
      const out = await faturamento.emitirNfeAposFaturar({
        vendaId,
        dadosNfe: entrada.dadosNfe,
        usuario,
        aoDesfazer: () => desfazerVinculoPedidos(db, vendaId)
      }, { ...deps, db });
      await registrarNfePedidos(db, vendaId);
      return { ...out, pedido_ids: atuais.map((p) => p.id), reutilizado: false };
    });
  } catch (err) {
    if (err && err.code === 'EMISSAO_EM_ANDAMENTO') {
      throw erro('Estes pedidos já estão sendo faturados. Aguarde.', 'FATURAMENTO_EM_ANDAMENTO', 409);
    }
    throw err;
  }
}

async function listarPedidos(filtros = {}, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  const where = ['1=1'];
  const params = [];
  const status = String(filtros.status || '').trim().toUpperCase();
  if (status) { where.push('p.status = ?'); params.push(status); }
  return all(db, `
    SELECT p.id, p.codigo, p.origem, p.orcamento_id, p.status, p.total, p.cliente_id, p.venda_id, p.created_at,
           c.nome AS cliente_nome, o.codigo AS orcamento_codigo
    FROM pedidos_comerciais p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN orcamentos o ON o.id = p.orcamento_id
    WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 300`, params);
}

/** Gera a venda do pedido pelo fluxo oficial e marca o pedido FATURADO. Chamar sob lock. */
async function faturarPedidoSemLock(db, pedido, contexto, deps) {
  const vendaId = await faturarPedidosSemLock(db, [pedido], contexto, deps);
  return vendaId;
}

async function itensGravadosDoPedido(db, pedidoId) {
  return all(db, `
    SELECT id, produto_id, quantidade, preco_unitario, subtotal
    FROM pedido_itens WHERE pedido_id = ? ORDER BY id`, [pedidoId]);
}

async function registrarVinculosVenda(db, vendaId, grupos) {
  let vendaItens = [];
  try {
    vendaItens = await all(db, 'SELECT id FROM vendas_itens WHERE venda_id = ? ORDER BY id', [vendaId]);
  } catch (err) {
    if (!/no such table/i.test(err.message || '')) throw err;
  }
  let cursor = 0;
  for (const grupo of grupos) {
    await run(db, `
      INSERT OR IGNORE INTO venda_pedidos (venda_id, pedido_id, valor_vinculado)
      VALUES (?, ?, ?)`, [vendaId, grupo.pedido.id, Number(grupo.pedido.total) || 0]);
    for (const item of grupo.itens) {
      const vendaItem = vendaItens[cursor] || null;
      cursor += 1;
      await run(db, `
        INSERT OR IGNORE INTO venda_pedido_itens (
          venda_id, pedido_id, pedido_item_id, venda_item_id, produto_id, quantidade, preco_unitario, subtotal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        vendaId, grupo.pedido.id, item.id, vendaItem ? vendaItem.id : null, item.produto_id,
        item.quantidade, item.preco_unitario, item.subtotal
      ]);
    }
  }
}

async function marcarPedidosFaturados(db, vendaId, pedidos) {
  for (const pedido of pedidos) {
    const r = await run(db, `
      UPDATE pedidos_comerciais SET status = 'FATURADO', venda_id = ?, faturado_em = datetime('now','localtime'),
        updated_at = datetime('now','localtime')
      WHERE id = ? AND status = 'ABERTO'`, [vendaId, pedido.id]);
    if (!r.changes) {
      throw erro(`Venda ${vendaId} gerada, mas o pedido ${pedido.codigo || pedido.id} mudou de estado. Verifique antes de emitir.`, 'PEDIDO_INCONSISTENTE', 409);
    }
  }
}

async function desfazerVinculoPedidos(db, vendaId) {
  await run(db, `
    UPDATE pedidos_comerciais SET status = 'ABERTO', venda_id = NULL, faturado_em = NULL,
      updated_at = datetime('now','localtime')
    WHERE venda_id = ?`, [vendaId]);
  await run(db, 'DELETE FROM venda_pedido_itens WHERE venda_id = ?', [vendaId]).catch(() => {});
  await run(db, 'DELETE FROM venda_pedidos WHERE venda_id = ?', [vendaId]).catch(() => {});
}

async function registrarNfePedidos(db, vendaId) {
  let nota = null;
  try {
    nota = await get(db, 'SELECT id FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1', [vendaId]);
  } catch (err) {
    if (/no such table/i.test(err.message || '')) return;
    throw err;
  }
  if (!nota) return;
  const vinculos = await all(db, 'SELECT pedido_id, valor_vinculado FROM venda_pedidos WHERE venda_id = ?', [vendaId]);
  for (const vinculo of vinculos) {
    await run(db, `
      INSERT OR IGNORE INTO nfe_pedidos (nfe_id, pedido_id, venda_id, valor_faturado)
      VALUES (?, ?, ?, ?)`, [nota.id, vinculo.pedido_id, vendaId, vinculo.valor_vinculado]);
  }
}

/**
 * Uma venda para um ou mais pedidos abertos do mesmo cliente.
 * Preços e descontos saem das linhas gravadas. Estoque e financeiro ocorrem
 * uma única vez, dentro de faturarOperacaoNfe.
 */
async function faturarPedidosSemLock(db, pedidos, contexto, deps) {
  const grupos = [];
  for (const pedido of pedidos) {
    const itens = await itensGravadosDoPedido(db, pedido.id);
    grupos.push({ pedido, itens });
  }
  const itens = grupos.flatMap((grupo) => grupo.itens.map((item) => ({
    produto_id: item.produto_id,
    quantidade: item.quantidade,
    preco_unitario: item.preco_unitario
  })));
  const desconto = Math.round(grupos.reduce((soma, grupo) => soma + (Number(grupo.pedido.desconto) || 0), 0) * 100) / 100;
  const forma = String(pedidos[0].forma_pagamento || 'dinheiro');
  const { vendaId } = await faturamento.faturarOperacaoNfe({
    origem: faturamento.ORIGEM_VENDA.PEDIDO,
    clienteId: pedidos[0].cliente_id,
    itens,
    desconto,
    formaPagamento: forma,
    parcelas: forma === 'prazo' ? pedidos[0].parcelas : null,
    primeiroVencimento: pedidos[0].primeiro_vencimento,
    usuarioId: contexto.usuarioId
  }, { ...deps, db });
  await registrarVinculosVenda(db, vendaId, grupos);
  await marcarPedidosFaturados(db, vendaId, pedidos);
  return vendaId;
}

/**
 * "Confirmar emissão" da NF-e do pedido. Abrir o formulário não chama esta função.
 * ABERTO: fatura (venda pelo fluxo oficial, pedido FATURADO) e emite pelo emissor existente;
 * se a emissão falhar sem registrar NF-e, a venda é cancelada e o pedido volta a ABERTO.
 * FATURADO: emite novamente pela venda já existente (ex.: NF-e rejeitada), sem novo faturamento.
 */
async function confirmarEmissaoNfePedido(id, entrada = {}, contexto = {}, deps = {}) {
  const db = obterDb(deps);
  await garantirSchemaPedidos(db);
  faturamento.validarDadosNfeConfirmacao(entrada.dadosNfe);
  const usuario = { id: contexto.usuarioId || null, username: contexto.usuarioNome || null };
  const { withLock } = require('../fiscal/nfeEmissionLockService');
  try {
    return await withLock(`pedido-faturar-${Number(id)}`, async () => {
      const pedido = await get(db, 'SELECT * FROM pedidos_comerciais WHERE id = ?', [Number(id)]);
      if (!pedido) throw erro('Pedido não encontrado.', 'PEDIDO_NAO_ENCONTRADO', 404);
      if (pedido.status === 'FATURADO' && pedido.venda_id) {
        const out = await faturamento.emitirNfeAposFaturar(
          { vendaId: pedido.venda_id, dadosNfe: entrada.dadosNfe, usuario, podeDesfazer: false },
          { ...deps, db }
        );
        await registrarNfePedidos(db, pedido.venda_id);
        return { ...out, pedido_id: pedido.id, reutilizado: true };
      }
      if (pedido.status !== 'ABERTO') {
        throw erro(`Pedido ${pedido.status.toLowerCase()} não pode emitir NF-e.`, 'PEDIDO_NAO_ELEGIVEL', 409);
      }
      const vendaId = await faturarPedidoSemLock(db, pedido, contexto, deps);
      const out = await faturamento.emitirNfeAposFaturar({
        vendaId,
        dadosNfe: entrada.dadosNfe,
        usuario,
        aoDesfazer: () => desfazerVinculoPedidos(db, vendaId)
      }, { ...deps, db });
      await registrarNfePedidos(db, vendaId);
      return { ...out, pedido_id: pedido.id, reutilizado: false };
    });
  } catch (err) {
    if (err && err.code === 'EMISSAO_EM_ANDAMENTO') {
      throw erro('Este pedido já está sendo faturado. Aguarde.', 'FATURAMENTO_EM_ANDAMENTO', 409);
    }
    throw err;
  }
}

module.exports = {
  STATUS_ORCAMENTO,
  STATUS_PEDIDO,
  ORIGENS_PEDIDO,
  garantirSchemaPedidos,
  criarOrcamento,
  atualizarOrcamento,
  alterarStatusOrcamento,
  aprovarOrcamento,
  obterOrcamento,
  listarOrcamentos,
  criarPedidoDireto,
  cancelarPedido,
  obterPedido,
  listarPedidos,
  listarPedidosElegiveisNfe,
  prepararImportacaoPedidos,
  confirmarEmissaoNfePedido,
  confirmarEmissaoNfePedidos
};
