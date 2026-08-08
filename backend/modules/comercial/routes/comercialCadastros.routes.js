/**
 * Rotas — Cadastros Comercial V2 (RCM-04.1)
 * Canais de Venda + Tabelas de Preço + Valores
 */

const express = require('express');
const canaisVendaController = require('../canais/CanaisVendaController');
const tabelasPrecoController = require('../tabelas-preco/TabelasPrecoController');

const canaisRouter = express.Router();
canaisRouter.get('/', canaisVendaController.listar);
canaisRouter.get('/:id', canaisVendaController.buscarPorId);
canaisRouter.post('/', canaisVendaController.criar);
canaisRouter.put('/:id', canaisVendaController.atualizar);
canaisRouter.delete('/:id', canaisVendaController.excluir);

const tabelasRouter = express.Router();
tabelasRouter.get('/', tabelasPrecoController.listar);
tabelasRouter.get('/grade-nova', tabelasPrecoController.gradeNova);
tabelasRouter.post('/grade-por-linhas', tabelasPrecoController.gradePorLinhas);
tabelasRouter.get('/pesquisar-linhas', tabelasPrecoController.pesquisarLinhas);
tabelasRouter.get('/pesquisar-produtos', tabelasPrecoController.pesquisarProdutos);
tabelasRouter.post('/simular', tabelasPrecoController.simular);
tabelasRouter.get('/cobertura', tabelasPrecoController.cobertura);
tabelasRouter.get('/linhas/:linhaId/produtos', tabelasPrecoController.produtosDaLinha);
tabelasRouter.get('/linhas/:linhaId/diagnostico', tabelasPrecoController.diagnosticarLinha);
tabelasRouter.get('/produtos/:produtoId/painel', tabelasPrecoController.painelProduto);
tabelasRouter.get('/:id/resumo', tabelasPrecoController.resumo);
tabelasRouter.get('/:id/cobertura', tabelasPrecoController.cobertura);
tabelasRouter.get('/:id/historico', tabelasPrecoController.historico);
tabelasRouter.post('/:id/duplicar', tabelasPrecoController.duplicar);
tabelasRouter.get('/:id/valores', tabelasPrecoController.listarValores);
tabelasRouter.put('/:id/valores', tabelasPrecoController.salvarValores);
tabelasRouter.post('/:id/valores', tabelasPrecoController.salvarValores);
tabelasRouter.post('/:id/desativar', tabelasPrecoController.desativar);
tabelasRouter.get('/:id', tabelasPrecoController.buscarPorId);
tabelasRouter.post('/', tabelasPrecoController.criar);
tabelasRouter.put('/:id', tabelasPrecoController.atualizar);
tabelasRouter.delete('/:id', tabelasPrecoController.excluir);

const configuracaoComercialController = require('../configuracao/ConfiguracaoComercialController');
const configuracaoRouter = express.Router();
configuracaoRouter.get('/', configuracaoComercialController.obter);
configuracaoRouter.put('/', configuracaoComercialController.salvar);
configuracaoRouter.post('/resolver-canal', configuracaoComercialController.resolverCanal);
configuracaoRouter.post('/resolver-precos', configuracaoComercialController.resolverPrecosVenda);
configuracaoRouter.post('/comparar-tabelas', configuracaoComercialController.compararTabelas);

const diagnosticoComercialController = require('../diagnostico/DiagnosticoComercialController');
const diagnosticoRouter = express.Router();
diagnosticoRouter.get('/', diagnosticoComercialController.listar);
diagnosticoRouter.get('/consistencia', diagnosticoComercialController.consistencia);
diagnosticoRouter.post('/corrigir', diagnosticoComercialController.corrigir);
diagnosticoRouter.get('/:produtoId', diagnosticoComercialController.diagnosticarProduto);
diagnosticoRouter.post('/:produtoId', diagnosticoComercialController.diagnosticarProduto);

const casquinhaSaboresController = require('../casquinha/CasquinhaSaboresController');
const casquinhaSaboresRouter = express.Router();
casquinhaSaboresRouter.get('/', casquinhaSaboresController.listar);
casquinhaSaboresRouter.get('/opcoes-bolas', casquinhaSaboresController.opcoesBolas);
casquinhaSaboresRouter.post('/validar', casquinhaSaboresController.validarMontagem);
casquinhaSaboresRouter.get('/:id', casquinhaSaboresController.buscarPorId);
casquinhaSaboresRouter.post('/', casquinhaSaboresController.criar);
casquinhaSaboresRouter.put('/:id', casquinhaSaboresController.atualizar);
casquinhaSaboresRouter.post('/:id/desativar', casquinhaSaboresController.desativar);

const linhasComerciaisController = require('../linhas-comerciais/LinhasComerciaisController');
const linhasRouter = express.Router();
linhasRouter.get('/', linhasComerciaisController.listar);
linhasRouter.get('/grade-nova', linhasComerciaisController.gradeNova);
linhasRouter.get('/migracao/relatorio', linhasComerciaisController.relatorioMigracao);
linhasRouter.post('/:id/desativar', linhasComerciaisController.desativar);
linhasRouter.get('/:id', linhasComerciaisController.buscarPorId);
linhasRouter.post('/', linhasComerciaisController.criar);
linhasRouter.put('/:id', linhasComerciaisController.atualizar);
linhasRouter.delete('/:id', linhasComerciaisController.excluir);

const kitController = require('../kits/KitController');
const kitsRouter = express.Router();
kitsRouter.get('/', kitController.listar);
kitsRouter.get('/produto/:produtoId', kitController.buscarPorProduto);
kitsRouter.post('/produto/:produtoId/preview', kitController.previewVenda);
kitsRouter.get('/historico/:vendaItemId', kitController.historicoItem);
kitsRouter.get('/:id/itens', kitController.listarItens);
kitsRouter.post('/:id/itens', kitController.adicionarItem);
kitsRouter.put('/itens/:itemId', kitController.atualizarItem);
kitsRouter.delete('/itens/:itemId', kitController.removerItem);
kitsRouter.post('/:id/desativar', kitController.desativar);
kitsRouter.get('/:id', kitController.buscarPorId);
kitsRouter.post('/', kitController.criar);
kitsRouter.put('/:id', kitController.atualizar);

const tiposComerciaisController = require('../tipos-comerciais/TiposComerciaisController');
const tiposComerciaisRouter = express.Router();
tiposComerciaisRouter.get('/', tiposComerciaisController.listar);
tiposComerciaisRouter.post('/resolver-canal', tiposComerciaisController.resolverCanalCliente);
tiposComerciaisRouter.post('/validar-canal', tiposComerciaisController.validarCanal);
tiposComerciaisRouter.get('/:id', tiposComerciaisController.buscarPorId);
tiposComerciaisRouter.post('/', tiposComerciaisController.criar);
tiposComerciaisRouter.put('/:id', tiposComerciaisController.atualizar);
tiposComerciaisRouter.delete('/:id', tiposComerciaisController.excluir);

module.exports = {
  canaisRouter,
  tabelasRouter,
  configuracaoRouter,
  diagnosticoRouter,
  casquinhaSaboresRouter,
  linhasRouter,
  kitsRouter,
  tiposComerciaisRouter
};
