/**
 * KitController (RCM-05.9)
 */

const KitService = require('./KitService');
const KitItemService = require('./KitItemService');
const KitVendaService = require('./KitVendaService');

function responderErro(res, error, padrao, statusPadrao = 500) {
  return res.status(error.statusCode || statusPadrao).json({
    success: false,
    erro: error.message || padrao
  });
}

async function listar(req, res) {
  try {
    res.json(await KitService.listar(req.query || {}));
  } catch (error) {
    responderErro(res, error, 'Erro ao listar kits');
  }
}

async function buscarPorId(req, res) {
  try {
    const kit = await KitService.buscarPorId(req.params.id);
    if (!kit) return res.status(404).json({ success: false, erro: 'Kit não encontrado' });
    res.json(kit);
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar kit');
  }
}

async function buscarPorProduto(req, res) {
  try {
    const kit = await KitService.buscarPorProdutoId(req.params.produtoId);
    if (!kit) return res.status(404).json({ success: false, erro: 'Kit não encontrado' });
    res.json(kit);
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar kit por produto');
  }
}

async function criar(req, res) {
  try {
    res.status(201).json(await KitService.criar(req.body || {}));
  } catch (error) {
    responderErro(res, error, 'Erro ao criar kit', 400);
  }
}

async function atualizar(req, res) {
  try {
    res.json(await KitService.atualizar(req.params.id, req.body || {}));
  } catch (error) {
    responderErro(res, error, 'Erro ao atualizar kit', error.statusCode || 400);
  }
}

async function desativar(req, res) {
  try {
    const kit = await KitService.desativar(req.params.id);
    res.json({ message: 'Kit desativado', ...kit });
  } catch (error) {
    responderErro(res, error, 'Erro ao desativar kit', error.statusCode || 400);
  }
}

async function listarItens(req, res) {
  try {
    res.json(await KitItemService.listarPorKit(req.params.id));
  } catch (error) {
    responderErro(res, error, 'Erro ao listar itens do kit');
  }
}

async function adicionarItem(req, res) {
  try {
    const item = await KitItemService.adicionar(req.params.id, req.body || {});
    await KitService.recalcularPrecoSeSoma(req.params.id);
    const kit = await KitService.buscarPorId(req.params.id);
    await KitService.sincronizarProdutoKit(kit);
    res.status(201).json(item);
  } catch (error) {
    responderErro(res, error, 'Erro ao adicionar item', error.statusCode || 400);
  }
}

async function atualizarItem(req, res) {
  try {
    const item = await KitItemService.atualizar(req.params.itemId, req.body || {});
    await KitService.recalcularPrecoSeSoma(item.kit_id);
    const kit = await KitService.buscarPorId(item.kit_id);
    await KitService.sincronizarProdutoKit(kit);
    res.json(item);
  } catch (error) {
    responderErro(res, error, 'Erro ao atualizar item', error.statusCode || 400);
  }
}

async function removerItem(req, res) {
  try {
    const item = await KitItemService.buscarPorId(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, erro: 'Item não encontrado' });
    await KitItemService.remover(req.params.itemId);
    await KitService.recalcularPrecoSeSoma(item.kit_id);
    const kit = await KitService.buscarPorId(item.kit_id);
    await KitService.sincronizarProdutoKit(kit);
    res.json({ message: 'Item removido' });
  } catch (error) {
    responderErro(res, error, 'Erro ao remover item', error.statusCode || 400);
  }
}

async function previewVenda(req, res) {
  try {
    res.json(await KitVendaService.previewVenda(req.params.produtoId, req.body || {}));
  } catch (error) {
    responderErro(res, error, 'Erro no preview do kit', error.statusCode || 400);
  }
}

async function historicoItem(req, res) {
  try {
    res.json(await KitVendaService.listarHistoricoDoItem(req.params.vendaItemId));
  } catch (error) {
    responderErro(res, error, 'Erro ao listar histórico do kit');
  }
}

module.exports = {
  listar,
  buscarPorId,
  buscarPorProduto,
  criar,
  atualizar,
  desativar,
  listarItens,
  adicionarItem,
  atualizarItem,
  removerItem,
  previewVenda,
  historicoItem
};
