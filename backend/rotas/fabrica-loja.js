const express = require('express');
const {
  obterContexto,
  listarFichas,
  listarFichasTradicionaisDoProduto,
  vincularFichaTradicionalProduto,
  desvincularFichaTradicionalProduto,
  obterFicha,
  salvarFicha,
  atualizarStatusFicha,
  excluirFicha,
  listarFichasPadrao,
  listarFichasPorSabor,
  obterFichaPadrao,
  obterFichaPorSabor,
  criarFichaPorSabor,
  revisarOrigemFichaPorSabor,
  criarFichaPadrao,
  atualizarFichaPadrao,
  atualizarStatusFichaPadrao,
  excluirFichaPadrao,
  criarVersaoPadrao,
  atualizarVersaoPadrao,
  publicarVersaoPadrao,
  criarVinculoFichaPadrao,
  atualizarVinculoFichaPadrao,
  listarVinculosFichaPadrao,
  listarVinculosAtivosProduto,
  listarFichasVinculadasProduto,
  listarAjustesFichaPadrao,
  criarAjusteFichaPadrao,
  atualizarAjusteFichaPadrao,
  removerAjusteFichaPadrao,
  listarAtualizacoesFichaPadrao,
  decidirAtualizacaoFichaPadrao,
  listarInsumos,
  consultarEstoqueInsumo,
  listarGruposInsumos,
  criarGrupoInsumo,
  atualizarGrupoInsumo,
  excluirGrupoInsumo,
  listarLinhasProdutos,
  obterLinhaProdutos,
  criarLinhaProdutos,
  atualizarLinhaProdutos,
  alterarStatusLinhaProdutos,
  excluirLinhaProdutos,
  listarConversaoLinhas,
  obterGradeConversao,
  validarConversao,
  converterEstoqueLinha,
  obterConversao,
  listarProdutosProduzidos,
  listarNecessidades,
  listarDemandaPedidos,
  obterNecessidade,
  salvarNecessidade,
  listarOrdens,
  obterOrdem,
  salvarOrdem,
  planejarOrdem,
  cancelarOrdem,
  coberturaNecessidade,
  criarOrdemDaNecessidade,
  previaProducao,
  iniciarProducao,
  executarProducao,
  listarExecucoes,
  consultarDisponivel,
  sugerirTransferenciaOrdem,
  listarTransferencias,
  obterTransferencia,
  salvarTransferencia,
  previaTransferencia,
  confirmarTransferencia,
  cancelarTransferencia,
  consultarPainelFabrica
} = require('../modules/fabrica-loja');
const { gravarAuditoria, contextoAuditoriaRequisicao } = require('../services/auditoria');

const router = express.Router();

function db() {
  return require('../database');
}

function responderErro(res, err) {
  res.status(err.statusCode || 500).json({
    success: false,
    codigo: err.code || null,
    error: err.message,
    detalhes: err.detalhes || null
  });
}

router.get('/painel', async (req, res) => {
  try {
    const painel = await consultarPainelFabrica(db(), { periodo: req.query.periodo });
    res.json({ success: true, painel });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/contexto', async (req, res) => {
  try {
    const contexto = await obterContexto(db());
    res.json({ success: true, ...contexto });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/produtos-produzidos', async (req, res) => {
  try {
    const produtos = await listarProdutosProduzidos(db(), req.query.q || req.query.busca, {
      excluirProdutoLinha: req.query.excluir_produto_linha === '1'
    });
    res.json({ success: true, produtos });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/insumos', async (req, res) => {
  try {
    const insumos = await listarInsumos(db(), req.query.q || req.query.busca);
    res.json({ success: true, insumos });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/insumos/:id/estoque', async (req, res) => {
  try {
    const estoque = await consultarEstoqueInsumo(db(), req.params.id);
    res.json({ success: true, ...estoque });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/grupos-insumos', async (req, res) => {
  try {
    const grupos = await listarGruposInsumos(db());
    res.json({ success: true, grupos });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/grupos-insumos', async (req, res) => {
  try {
    const grupo = await criarGrupoInsumo(db(), req.body || {});
    res.status(201).json({ success: true, grupo });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/grupos-insumos/:id', async (req, res) => {
  try {
    const grupo = await atualizarGrupoInsumo(db(), req.params.id, req.body || {});
    res.json({ success: true, grupo });
  } catch (err) {
    responderErro(res, err);
  }
});

router.delete('/grupos-insumos/:id', async (req, res) => {
  try {
    const resultado = await excluirGrupoInsumo(db(), req.params.id);
    res.json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/linhas-produtos', async (req, res) => {
  try {
    const resultado = await listarLinhasProdutos(db(), {
      busca: req.query.busca || req.query.q,
      incluirInativas: req.query.incluir_inativas === '1'
    });
    res.json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/linhas-produtos/:id', async (req, res) => {
  try {
    const linha = await obterLinhaProdutos(db(), req.params.id);
    res.json({ success: true, linha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/linhas-produtos', async (req, res) => {
  try {
    const linha = await criarLinhaProdutos(db(), req.body || {});
    res.status(201).json({ success: true, linha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/linhas-produtos/:id', async (req, res) => {
  try {
    const linha = await atualizarLinhaProdutos(db(), req.params.id, req.body || {});
    res.json({ success: true, linha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/linhas-produtos/:id/ativar', async (req, res) => {
  try {
    const linha = await alterarStatusLinhaProdutos(db(), req.params.id, true);
    res.json({ success: true, linha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/linhas-produtos/:id/desativar', async (req, res) => {
  try {
    const linha = await alterarStatusLinhaProdutos(db(), req.params.id, false);
    res.json({ success: true, linha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.delete('/linhas-produtos/:id', async (req, res) => {
  try {
    const resultado = await excluirLinhaProdutos(db(), req.params.id);
    res.json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/conversoes-linha', async (req, res) => {
  try {
    const resultado = await listarConversaoLinhas(db());
    res.json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/conversoes-linha/origem/:produtoId', async (req, res) => {
  try {
    const grade = await obterGradeConversao(db(), req.params.produtoId);
    res.json({ success: true, grade });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/conversoes-linha/validar', async (req, res) => {
  try {
    const { totais } = await validarConversao(db(), req.body || {});
    res.json({ success: true, totais });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/conversoes-linha/:id', async (req, res) => {
  try {
    const conversao = await obterConversao(db(), req.params.id);
    res.json({ success: true, conversao });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/conversoes-linha', async (req, res) => {
  try {
    const conversao = await converterEstoqueLinha(db(), req.body || {}, contextoOrdem(req, 'conversao-linha', 'conversao_estoque_linha'));
    res.status(201).json({ success: true, conversao });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas', async (req, res) => {
  try {
    const fichas = await listarFichas(db(), {
      busca: req.query.busca,
      incluirInativas: req.query.incluir_inativas === '1'
    });
    res.json({ success: true, fichas });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas/:id', async (req, res) => {
  try {
    const ficha = await obterFicha(db(), req.params.id);
    res.json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.patch('/fichas/:id/status', async (req, res) => {
  try {
    const ficha = await atualizarStatusFicha(db(), req.params.id, req.body || {});
    res.json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.delete('/fichas/:id', async (req, res) => {
  try {
    const resultado = await excluirFicha(db(), req.params.id);
    res.json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/fichas/:id/produto', async (req, res) => {
  try {
    const ficha = await vincularFichaTradicionalProduto(
      db(),
      req.params.id,
      req.body && req.body.produto_id
    );
    res.json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.delete('/fichas/:id/produto/:produtoId', async (req, res) => {
  try {
    const resultado = await desvincularFichaTradicionalProduto(
      db(),
      req.params.id,
      req.params.produtoId
    );
    res.json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas/produtos/:produtoId/tradicionais', async (req, res) => {
  try {
    const fichas = await listarFichasTradicionaisDoProduto(db(), req.params.produtoId);
    res.json({ success: true, fichas });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas/produtos/:produtoId/vinculos', async (req, res) => {
  try {
    const fichas = await listarFichasVinculadasProduto(db(), req.params.produtoId);
    res.json({ success: true, fichas });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/fichas', async (req, res) => {
  try {
    const ficha = await salvarFicha(db(), req.body || {});
    res.status(201).json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas-padrao', async (req, res) => {
  try {
    const fichas = await listarFichasPadrao(db(), {
      busca: req.query.busca,
      incluirInativas: req.query.incluir_inativas === '1'
    });
    res.json({ success: true, fichas });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas-sabor', async (req, res) => {
  try {
    const fichas = await listarFichasPorSabor(db(), {
      busca: req.query.busca,
      incluirInativas: req.query.incluir_inativas === '1'
    });
    res.json({ success: true, fichas });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/fichas-sabor', async (req, res) => {
  try {
    const ficha = await criarFichaPorSabor(
      db(),
      req.body || {},
      contextoOrdem(req, 'fichas-sabor', 'ficha_tecnica_sabor')
    );
    res.status(201).json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas-sabor/:id', async (req, res) => {
  try {
    const ficha = await obterFichaPorSabor(db(), req.params.id);
    res.json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/fichas-sabor/:id/revisar-origem', async (req, res) => {
  try {
    const versao = await revisarOrigemFichaPorSabor(
      db(),
      req.params.id,
      contextoOrdem(req, 'fichas-sabor', 'ficha_tecnica_sabor_revisao')
    );
    res.status(201).json({ success: true, versao });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas-padrao/produtos/:produtoId/vinculos', async (req, res) => {
  try {
    const fichas = await listarVinculosAtivosProduto(db(), req.params.produtoId);
    res.json({ success: true, fichas });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/fichas-padrao', async (req, res) => {
  try {
    const ficha = await criarFichaPadrao(db(), req.body || {}, contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao'));
    res.status(201).json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas-padrao/:id', async (req, res) => {
  try {
    const ficha = await obterFichaPadrao(db(), req.params.id);
    res.json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/fichas-padrao/:id', async (req, res) => {
  try {
    const ficha = await atualizarFichaPadrao(
      db(),
      req.params.id,
      req.body || {},
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao')
    );
    res.json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.patch('/fichas-padrao/:id/status', async (req, res) => {
  try {
    const ficha = await atualizarStatusFichaPadrao(
      db(),
      req.params.id,
      req.body || {},
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao')
    );
    res.json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

router.delete('/fichas-padrao/:id', async (req, res) => {
  try {
    const resultado = await excluirFichaPadrao(
      db(),
      req.params.id,
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao')
    );
    res.json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/fichas-padrao/:id/versoes', async (req, res) => {
  try {
    const versao = await criarVersaoPadrao(
      db(),
      req.params.id,
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao_versao')
    );
    res.status(201).json({ success: true, versao });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/fichas-padrao/:id/versoes/:versaoId', async (req, res) => {
  try {
    const versao = await atualizarVersaoPadrao(
      db(),
      req.params.id,
      req.params.versaoId,
      req.body || {},
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao_versao')
    );
    res.json({ success: true, versao });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/fichas-padrao/:id/versoes/:versaoId/publicar', async (req, res) => {
  try {
    const versao = await publicarVersaoPadrao(
      db(),
      req.params.id,
      req.params.versaoId,
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao_versao')
    );
    res.json({ success: true, versao });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas-padrao/:id/vinculos', async (req, res) => {
  try {
    const vinculos = await listarVinculosFichaPadrao(db(), req.params.id);
    res.json({ success: true, vinculos });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/fichas-padrao/:id/vinculos', async (req, res) => {
  try {
    const vinculo = await criarVinculoFichaPadrao(
      db(),
      req.params.id,
      req.body || {},
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao_vinculo')
    );
    res.status(201).json({ success: true, vinculo });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/fichas-padrao/vinculos/:vinculoId', async (req, res) => {
  try {
    const vinculo = await atualizarVinculoFichaPadrao(
      db(),
      req.params.vinculoId,
      req.body || {},
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao_vinculo')
    );
    res.json({ success: true, vinculo });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas-padrao/:id/atualizacoes', async (req, res) => {
  try {
    const atualizacoes = await listarAtualizacoesFichaPadrao(db(), req.params.id);
    res.json({ success: true, atualizacoes });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/fichas-padrao/atualizacoes/:revisaoId', async (req, res) => {
  try {
    const revisao = await decidirAtualizacaoFichaPadrao(
      db(),
      req.params.revisaoId,
      req.body || {},
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao_revisao')
    );
    res.json({ success: true, revisao });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fichas-padrao/vinculos/:vinculoId/ajustes', async (req, res) => {
  try {
    const ajustes = await listarAjustesFichaPadrao(db(), req.params.vinculoId);
    res.json({ success: true, ajustes });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/fichas-padrao/vinculos/:vinculoId/ajustes', async (req, res) => {
  try {
    const ajuste = await criarAjusteFichaPadrao(
      db(),
      req.params.vinculoId,
      req.body || {},
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao_ajuste')
    );
    res.status(201).json({ success: true, ajuste });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/fichas-padrao/vinculos/:vinculoId/ajustes/:ajusteId', async (req, res) => {
  try {
    const ajuste = await atualizarAjusteFichaPadrao(
      db(),
      req.params.vinculoId,
      req.params.ajusteId,
      req.body || {},
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao_ajuste')
    );
    res.json({ success: true, ajuste });
  } catch (err) {
    responderErro(res, err);
  }
});

router.delete('/fichas-padrao/vinculos/:vinculoId/ajustes/:ajusteId', async (req, res) => {
  try {
    const resultado = await removerAjusteFichaPadrao(
      db(),
      req.params.vinculoId,
      req.params.ajusteId,
      contextoOrdem(req, 'fichas-padrao', 'ficha_tecnica_padrao_ajuste')
    );
    res.json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/demanda-pedidos', async (req, res) => {
  try {
    const pedidos = await listarDemandaPedidos(db(), req.query.necessidade_id);
    res.json({ success: true, pedidos });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/necessidades', async (req, res) => {
  try {
    const necessidades = await listarNecessidades(db(), {
      busca: req.query.busca,
      origem: req.query.origem,
      incluirCanceladas: req.query.incluir_canceladas === '1',
      atendimento: req.query.atendimento
    });
    res.json({ success: true, necessidades });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/necessidades/:id', async (req, res) => {
  try {
    const necessidade = await obterNecessidade(db(), req.params.id);
    res.json({ success: true, necessidade });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/necessidades', async (req, res) => {
  try {
    const necessidade = await salvarNecessidade(db(), req.body || {});
    res.status(201).json({ success: true, necessidade });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/necessidades/:id', async (req, res) => {
  try {
    const necessidade = await salvarNecessidade(db(), req.body || {}, req.params.id);
    res.json({ success: true, necessidade });
  } catch (err) {
    responderErro(res, err);
  }
});

function contextoOrdem(req, modulo, referenciaTipo = 'ordem_producao') {
  const usuario = contextoAuditoriaRequisicao(req);
  return {
    usuario_id: usuario.usuario_id,
    usuario_nome: usuario.usuario_nome,
    auditar(info) {
      return gravarAuditoria({
        usuario_id: usuario.usuario_id,
        usuario_nome: usuario.usuario_nome,
        ip_requisicao: usuario.ip_requisicao,
        modulo: modulo || 'ordens-producao',
        acao: info.acao,
        referencia_tipo: referenciaTipo,
        referencia_id: info.referencia_id,
        detalhes: info.detalhes
      }).catch((err) => {
        console.error('Auditoria da ordem de produção:', err.message);
      });
    }
  };
}

router.post('/necessidades/:id/ordem-producao', async (req, res) => {
  try {
    const resultado = await criarOrdemDaNecessidade(db(), req.params.id, contextoOrdem(req));
    res.status(resultado.criada ? 201 : 200).json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/ordens-producao/cobertura/:necessidadeId', async (req, res) => {
  try {
    const cobertura = await coberturaNecessidade(db(), req.params.necessidadeId);
    res.json({ success: true, cobertura });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/ordens-producao', async (req, res) => {
  try {
    const ordens = await listarOrdens(db(), {
      status: req.query.status,
      prioridade: req.query.prioridade,
      produto: req.query.produto,
      inicio: req.query.inicio,
      fim: req.query.fim,
      necessidade_id: req.query.necessidade_id
    });
    res.json({ success: true, ordens });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/ordens-producao/:id', async (req, res) => {
  try {
    const ordem = await obterOrdem(db(), req.params.id);
    res.json({ success: true, ordem });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/ordens-producao', async (req, res) => {
  try {
    const ordem = await salvarOrdem(db(), req.body || {}, null, contextoOrdem(req));
    res.status(201).json({ success: true, ordem });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/ordens-producao/:id', async (req, res) => {
  try {
    const ordem = await salvarOrdem(db(), req.body || {}, req.params.id, contextoOrdem(req));
    res.json({ success: true, ordem });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/ordens-producao/:id/previa-producao', async (req, res) => {
  try {
    const previa = await previaProducao(db(), req.params.id);
    res.json({ success: true, previa });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/ordens-producao/:id/transferencia-sugerida', async (req, res) => {
  try {
    const sugestao = await sugerirTransferenciaOrdem(db(), req.params.id);
    res.json({ success: true, sugestao });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/ordens-producao/:id/execucoes', async (req, res) => {
  try {
    const execucoes = await listarExecucoes(db(), req.params.id);
    res.json({ success: true, execucoes });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/ordens-producao/:id/em-producao', async (req, res) => {
  try {
    const ordem = await iniciarProducao(db(), req.params.id, contextoOrdem(req));
    res.json({ success: true, ordem });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/ordens-producao/:id/executar', async (req, res) => {
  try {
    const resultado = await executarProducao(db(), req.params.id, req.body || {}, contextoOrdem(req));
    res.status(resultado.repetida ? 200 : 201).json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/ordens-producao/:id/planejar', async (req, res) => {
  try {
    const ordem = await planejarOrdem(db(), req.params.id, contextoOrdem(req));
    res.json({ success: true, ordem });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/ordens-producao/:id/cancelar', async (req, res) => {
  try {
    const ordem = await cancelarOrdem(db(), req.params.id, contextoOrdem(req));
    res.json({ success: true, ordem });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/transferencias', async (req, res) => {
  try {
    const transferencias = await listarTransferencias(db(), req.query || {});
    res.json({ success: true, transferencias });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/transferencias/disponivel', async (req, res) => {
  try {
    const saldo = await consultarDisponivel(db(), req.query.produto_id, req.query.local || 'FABRICA');
    res.json({ success: true, saldo });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/transferencias/:id/previa', async (req, res) => {
  try {
    const previa = await previaTransferencia(db(), req.params.id);
    res.json({ success: true, previa });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/transferencias/:id', async (req, res) => {
  try {
    const transferencia = await obterTransferencia(db(), req.params.id);
    res.json({ success: true, transferencia });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/transferencias', async (req, res) => {
  try {
    const transferencia = await salvarTransferencia(db(), req.body || {}, null, contextoOrdem(req, 'transferencias'));
    res.status(201).json({ success: true, transferencia });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/transferencias/:id', async (req, res) => {
  try {
    const transferencia = await salvarTransferencia(db(), req.body || {}, req.params.id, contextoOrdem(req, 'transferencias'));
    res.json({ success: true, transferencia });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/transferencias/:id/confirmar', async (req, res) => {
  try {
    const resultado = await confirmarTransferencia(db(), req.params.id, req.body || {}, contextoOrdem(req, 'transferencias'));
    res.status(resultado.repetida ? 200 : 201).json({ success: true, ...resultado });
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/transferencias/:id/cancelar', async (req, res) => {
  try {
    const transferencia = await cancelarTransferencia(db(), req.params.id, contextoOrdem(req, 'transferencias'));
    res.json({ success: true, transferencia });
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/fichas/:id', async (req, res) => {
  try {
    const ficha = await salvarFicha(db(), req.body || {}, req.params.id);
    res.json({ success: true, ficha });
  } catch (err) {
    responderErro(res, err);
  }
});

module.exports = router;
