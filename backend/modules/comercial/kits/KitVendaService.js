/**
 * KitVendaService — venda, estoque, histórico e fiscal de kits (RCM-05.9)
 */

const db = require('../../../database');
const KitService = require('./KitService');
const KitItemService = require('./KitItemService');

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function erro(msg, status = 400) {
  const e = new Error(msg);
  e.statusCode = status;
  return e;
}

/**
 * Resolve itens efetivos da venda (respeita permite_alterar + opcionais).
 * @param {Object} kit
 * @param {Array|null} itensPayload — opcional: [{produto_id, quantidade?}]
 */
function resolverItensVenda(kit, itensPayload = null) {
  const base = Array.isArray(kit.itens) ? kit.itens : [];
  if (!kit.permite_alterar_itens || !Array.isArray(itensPayload)) {
    return base.map((i) => ({
      produto_id: Number(i.produto_id),
      quantidade: Number(i.quantidade || 0),
      obrigatorio: !!i.obrigatorio,
      preco_unitario: Number(i.preco_individual || 0),
      produto_nome: i.produto_nome || null
    }));
  }

  const selecionados = new Map();
  itensPayload.forEach((raw) => {
    const pid = Number(raw.produto_id);
    if (!Number.isFinite(pid)) return;
    selecionados.set(pid, {
      produto_id: pid,
      quantidade: Number(raw.quantidade) > 0 ? Number(raw.quantidade) : null
    });
  });

  const out = [];
  for (const item of base) {
    const sel = selecionados.get(Number(item.produto_id));
    if (item.obrigatorio) {
      out.push({
        produto_id: Number(item.produto_id),
        quantidade: Number(item.quantidade || 0),
        obrigatorio: true,
        preco_unitario: Number(item.preco_individual || 0),
        produto_nome: item.produto_nome || null
      });
      continue;
    }
    if (sel) {
      out.push({
        produto_id: Number(item.produto_id),
        quantidade: sel.quantidade != null ? sel.quantidade : Number(item.quantidade || 0),
        obrigatorio: false,
        preco_unitario: Number(item.preco_individual || 0),
        produto_nome: item.produto_nome || null
      });
    }
  }
  return out;
}

/**
 * Quantidades a baixar no estoque (componentes × qtd de kits vendidos).
 */
function calcularBaixaEstoque(kit, quantidadeVendida, itensPayload = null) {
  const qtdKit = Number(quantidadeVendida || 0);
  if (!(qtdKit > 0)) return [];
  return resolverItensVenda(kit, itensPayload).map((i) => ({
    produto_id: i.produto_id,
    quantidade: Number((i.quantidade * qtdKit).toFixed(6)),
    preco_unitario: i.preco_unitario,
    obrigatorio: i.obrigatorio,
    produto_nome: i.produto_nome
  }));
}

async function obterKitDaVendaItem(item = {}) {
  if (item.kit_id) {
    return KitService.buscarPorId(item.kit_id);
  }
  const produtoId = Number(item.produto_id);
  if (!Number.isFinite(produtoId)) return null;

  const forma = String(item.forma_comercializacao || '').toUpperCase();
  if (forma === 'KIT' || Number(item.eh_kit) === 1) {
    return KitService.buscarPorProdutoId(produtoId);
  }

  const prod = await dbGet(
    `SELECT id, eh_kit, forma_comercializacao FROM produtos WHERE id = ?`,
    [produtoId]
  );
  if (!prod) return null;
  if (Number(prod.eh_kit) === 1 || String(prod.forma_comercializacao || '').toUpperCase() === 'KIT') {
    return KitService.buscarPorProdutoId(produtoId);
  }
  return null;
}

async function gravarHistorico(vendaItemId, kit, componentes = []) {
  await dbRun(`DELETE FROM venda_item_kit_itens WHERE venda_item_id = ?`, [vendaItemId]);
  for (const c of componentes) {
    await dbRun(
      `INSERT INTO venda_item_kit_itens (
         venda_item_id, kit_id, produto_id, quantidade, preco_unitario, obrigatorio
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        vendaItemId,
        kit?.id || null,
        c.produto_id,
        Number(c.quantidade || 0),
        Number(c.preco_unitario || 0),
        c.obrigatorio ? 1 : 0
      ]
    );
  }
  return listarHistoricoDoItem(vendaItemId);
}

async function listarHistoricoDoItem(vendaItemId) {
  const rows = await dbAll(
    `SELECT vik.*, p.nome AS produto_nome, p.codigo AS produto_codigo
     FROM venda_item_kit_itens vik
     LEFT JOIN produtos p ON p.id = vik.produto_id
     WHERE vik.venda_item_id = ?
     ORDER BY vik.id ASC`,
    [vendaItemId]
  );
  return (rows || []).map((r) => ({
    id: r.id,
    venda_item_id: r.venda_item_id,
    kit_id: r.kit_id,
    produto_id: r.produto_id,
    produto_nome: r.produto_nome,
    produto_codigo: r.produto_codigo,
    quantidade: Number(r.quantidade || 0),
    preco_unitario: Number(r.preco_unitario || 0),
    obrigatorio: r.obrigatorio === 1
  }));
}

/**
 * Rateia valor fiscal do kit entre componentes (modo ITENS).
 */
function montarLinhasFiscaisComponentes(kit, itemVenda, componentes) {
  const valorFiscal = Number(itemVenda.valor_fiscal || 0);
  const qtdFiscal = Number(itemVenda.quantidade_fiscal || 0);
  if (!(valorFiscal > 0) || !(qtdFiscal > 0) || !componentes.length) {
    return [];
  }

  const pesos = componentes.map((c) => {
    const preco = Number(c.preco_unitario || 0);
    const qtd = Number(c.quantidade || 0);
    return Math.max(preco * qtd, 0.0001);
  });
  const somaPesos = pesos.reduce((s, p) => s + p, 0);
  let acumulado = 0;
  const linhas = [];

  componentes.forEach((c, idx) => {
    const isLast = idx === componentes.length - 1;
    const fatia = isLast
      ? Number((valorFiscal - acumulado).toFixed(2))
      : Number(((valorFiscal * pesos[idx]) / somaPesos).toFixed(2));
    acumulado = Number((acumulado + fatia).toFixed(2));
    const qtdComp = Number(c.quantidade || 0);
    linhas.push({
      ...itemVenda,
      id: `${itemVenda.id}_kit_${c.produto_id}`,
      produto_id: c.produto_id,
      produto_nome: c.produto_nome || `Item kit ${c.produto_id}`,
      quantidade: qtdComp,
      quantidade_fiscal: qtdComp,
      quantidade_nao_fiscal: 0,
      preco_unitario: qtdComp > 0 ? Number((fatia / qtdComp).toFixed(4)) : 0,
      valor_fiscal: fatia,
      valor_nao_fiscal: 0,
      subtotal: fatia,
      item_fiscal: 1,
      forma_comercializacao: 'UNIDADE',
      _origem_kit_id: kit?.id || null,
      _kit_explodido: true
    });
  });

  return linhas;
}

/**
 * Expande itens da venda para NFC-e conforme modo_fiscal do kit.
 * @param {Array} itensVenda
 * @returns {Promise<Array>}
 */
async function expandirItensParaFiscal(itensVenda = []) {
  const out = [];
  for (const item of itensVenda) {
    const kit = await obterKitDaVendaItem(item);
    if (!kit) {
      out.push(item);
      continue;
    }

    const modo = KitService.normalizarModoFiscal(kit.modo_fiscal);
    if (modo !== 'ITENS') {
      out.push(item);
      continue;
    }

    let componentes = await listarHistoricoDoItem(item.id);
    if (!componentes.length) {
      componentes = calcularBaixaEstoque(kit, item.quantidade, item.kit_itens || null);
    }

    const linhas = montarLinhasFiscaisComponentes(kit, item, componentes);
    if (!linhas.length) {
      out.push(item);
      continue;
    }

    for (const linha of linhas) {
      const prod = await dbGet(
        `SELECT nome, ncm, cfop, csosn, origem, cest, codigo_barras, unidade
         FROM produtos WHERE id = ?`,
        [linha.produto_id]
      );
      if (prod) {
        linha.produto_nome = prod.nome || linha.produto_nome;
        linha.produto_ncm = prod.ncm;
        linha.cfop = prod.cfop;
        linha.csosn = prod.csosn;
        linha.origem = prod.origem;
        linha.produto_cest = prod.cest;
        linha.produto_codigo_barras = prod.codigo_barras;
        linha.unidade = prod.unidade || 'UN';
      }
      out.push(linha);
    }
  }
  return out;
}

/**
 * Preview PDV: descrição, itens, preço.
 */
async function previewVenda(produtoId, body = {}) {
  const kit = await KitService.buscarPorProdutoId(produtoId);
  if (!kit) throw erro('Kit não encontrado para este produto', 404);
  const quantidade = Number(body.quantidade || 1);
  const itens = resolverItensVenda(kit, body.itens || null);
  return {
    kit_id: kit.id,
    codigo: kit.codigo,
    descricao: kit.descricao,
    preco: Number(kit.preco || 0),
    tipo_formacao: kit.tipo_formacao,
    permite_alterar_itens: kit.permite_alterar_itens,
    modo_fiscal: kit.modo_fiscal,
    quantidade,
    subtotal: Number((kit.preco * quantidade).toFixed(2)),
    itens
  };
}

module.exports = {
  resolverItensVenda,
  calcularBaixaEstoque,
  obterKitDaVendaItem,
  gravarHistorico,
  listarHistoricoDoItem,
  montarLinhasFiscaisComponentes,
  expandirItensParaFiscal,
  previewVenda,
  KitItemService
};
