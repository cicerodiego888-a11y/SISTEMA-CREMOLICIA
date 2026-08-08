/**
 * TabelasPrecoController — Camada HTTP de tabelas de preço (RCM-04.2 / RCM-8.3)
 */

const tabelasPrecoService = require('./TabelasPrecoService');
const centralPrecificacao = require('./CentralPrecificacaoService');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  const payload = {
    success: false,
    erro: error.message || mensagemPadrao
  };
  if (error.code) payload.code = error.code;
  if (error.permite_desativar) payload.permite_desativar = true;
  return res.status(status).json(payload);
}

async function listar(req, res) {
  try {
    const tabelas = await tabelasPrecoService.listar(req.query || {});
    res.json(tabelas);
  } catch (error) {
    responderErro(res, error, 'Erro ao listar tabelas de preço');
  }
}

async function gradeNova(req, res) {
  try {
    const grade = await tabelasPrecoService.gradeNova();
    res.json(grade);
  } catch (error) {
    responderErro(res, error, 'Erro ao montar grade de valores');
  }
}

async function gradePorLinhas(req, res) {
  try {
    const linhaIds = req.body?.linha_ids || req.body?.linhas_ids || req.query?.linha_ids || [];
    const ids = Array.isArray(linhaIds)
      ? linhaIds
      : String(linhaIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    const tabelaId = req.body?.tabela_preco_id || req.query?.tabela_preco_id || null;
    const grade = await tabelasPrecoService.gradePorLinhas(
      ids,
      tabelaId,
      req.body?.canal_venda_id || null
    );
    res.json(grade);
  } catch (error) {
    responderErro(res, error, 'Erro ao montar grade por linhas comerciais');
  }
}

async function buscarPorId(req, res) {
  try {
    const tabela = await tabelasPrecoService.buscarPorId(req.params.id);
    if (!tabela) {
      return res.status(404).json({ success: false, erro: 'Tabela de preço não encontrada' });
    }
    const resumo = await centralPrecificacao.resumo(req.params.id).catch(() => null);
    res.json({ ...tabela, resumo });
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar tabela de preço');
  }
}

async function criar(req, res) {
  try {
    const tabela = await tabelasPrecoService.criar(req.body || {});
    res.status(201).json(tabela);
  } catch (error) {
    responderErro(res, error, 'Erro ao criar tabela de preço', 400);
  }
}

async function atualizar(req, res) {
  try {
    const id = req.params.id;
    const usuario = req.user?.nome || req.user?.login || req.headers['x-user'] || null;
    const antes = await centralPrecificacao.capturarSnapshotPrecos(id).catch(() => new Map());
    const tabela = await tabelasPrecoService.atualizar(id, req.body || {});
    await centralPrecificacao.gravarDiffHistorico(id, antes, usuario).catch(() => 0);
    res.json(tabela);
  } catch (error) {
    responderErro(res, error, 'Erro ao atualizar tabela de preço', error.statusCode || 400);
  }
}

async function excluir(req, res) {
  try {
    await tabelasPrecoService.excluir(req.params.id);
    res.json({ message: 'Tabela de preço excluída com sucesso' });
  } catch (error) {
    responderErro(res, error, 'Erro ao excluir tabela de preço', error.statusCode || 500);
  }
}

async function desativar(req, res) {
  try {
    const tabela = await tabelasPrecoService.desativar(req.params.id);
    res.json({
      message: 'Tabela de preço desativada com sucesso',
      ...tabela
    });
  } catch (error) {
    responderErro(res, error, 'Erro ao desativar tabela de preço', error.statusCode || 400);
  }
}

async function listarValores(req, res) {
  try {
    const valores = await tabelasPrecoService.listarValores(req.params.id);
    res.json(valores);
  } catch (error) {
    responderErro(res, error, 'Erro ao listar valores da tabela de preço', error.statusCode || 500);
  }
}

async function salvarValores(req, res) {
  try {
    const valores = await tabelasPrecoService.salvarValores(req.params.id, req.body || {});
    res.json(valores);
  } catch (error) {
    responderErro(res, error, 'Erro ao salvar valores da tabela de preço', error.statusCode || 400);
  }
}

/* ——— RCM-8.3 Central ——— */

async function resumo(req, res) {
  try {
    res.json(await centralPrecificacao.resumo(req.params.id));
  } catch (error) {
    responderErro(res, error, 'Erro ao montar resumo', error.statusCode || 500);
  }
}

async function produtosDaLinha(req, res) {
  try {
    res.json(await centralPrecificacao.produtosDaLinha(req.params.linhaId));
  } catch (error) {
    responderErro(res, error, 'Erro ao listar produtos da linha', error.statusCode || 500);
  }
}

async function painelProduto(req, res) {
  try {
    res.json(await centralPrecificacao.painelProduto(req.params.produtoId));
  } catch (error) {
    responderErro(res, error, 'Erro ao montar painel do produto', error.statusCode || 500);
  }
}

async function pesquisarLinhas(req, res) {
  try {
    res.json(await centralPrecificacao.pesquisarLinhas(req.query.q || req.query.busca, req.query.limit));
  } catch (error) {
    responderErro(res, error, 'Erro na pesquisa de linhas');
  }
}

async function pesquisarProdutos(req, res) {
  try {
    res.json(await centralPrecificacao.pesquisarProdutos(req.query.q || req.query.busca, req.query.limit));
  } catch (error) {
    responderErro(res, error, 'Erro na pesquisa de produtos');
  }
}

async function diagnosticarLinha(req, res) {
  try {
    res.json(await centralPrecificacao.diagnosticarLinha(req.params.linhaId));
  } catch (error) {
    responderErro(res, error, 'Erro no diagnóstico', error.statusCode || 500);
  }
}

async function cobertura(req, res) {
  try {
    const tabelaId = req.params.id || req.query.tabela_id || null;
    res.json(await centralPrecificacao.verificarCobertura(tabelaId));
  } catch (error) {
    responderErro(res, error, 'Erro na verificação de cobertura', error.statusCode || 500);
  }
}

async function simular(req, res) {
  try {
    res.json(await centralPrecificacao.simular(req.body || {}));
  } catch (error) {
    responderErro(res, error, 'Erro na simulação', error.statusCode || 400);
  }
}

async function historico(req, res) {
  try {
    res.json(await centralPrecificacao.listarHistorico(req.params.id, req.query.limit));
  } catch (error) {
    responderErro(res, error, 'Erro ao listar histórico');
  }
}

async function duplicar(req, res) {
  try {
    const nova = await centralPrecificacao.duplicarTabela(req.params.id, req.body || {});
    res.status(201).json(nova);
  } catch (error) {
    responderErro(res, error, 'Erro ao duplicar tabela', error.statusCode || 400);
  }
}

module.exports = {
  listar,
  gradeNova,
  gradePorLinhas,
  buscarPorId,
  criar,
  atualizar,
  excluir,
  desativar,
  listarValores,
  salvarValores,
  resumo,
  produtosDaLinha,
  painelProduto,
  pesquisarLinhas,
  pesquisarProdutos,
  diagnosticarLinha,
  cobertura,
  simular,
  historico,
  duplicar
};
