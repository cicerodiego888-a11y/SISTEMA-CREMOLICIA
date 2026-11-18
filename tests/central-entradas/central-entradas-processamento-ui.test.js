const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const jsPath = path.join(__dirname, '..', '..', 'frontend', 'erp', 'js', 'central-entradas.js');
const cssPath = path.join(__dirname, '..', '..', 'frontend', 'css', 'central-entradas.css');
const source = fs.readFileSync(jsPath, 'utf8');

function extrairFuncao(nome, inicio, fim) {
  const inicioFuncao = source.indexOf(inicio);
  const fimFuncao = source.indexOf(fim, inicioFuncao);
  assert.ok(inicioFuncao >= 0 && fimFuncao > inicioFuncao, `Não foi possível localizar ${nome}`);
  return source.slice(inicioFuncao, fimFuncao);
}

const painel = { innerHTML: '' };
const contexto = {
  centralEntradasState: { abaAtiva: 'itens', processando: false },
  document: { getElementById: () => painel },
  escapeHtmlCentralEntradas: (valor) => String(valor ?? ''),
  renderBadgeStatusCentral: () => '<span class="status">Nova</span>',
  renderConteudoAbaCentral: () => '<div class="detalhe">Conteúdo</div>'
};

vm.createContext(contexto);
vm.runInContext(
  `${extrairFuncao(
    'renderBotaoProcessarCentral',
    'function renderBotaoProcessarCentral(doc) {',
    '\nfunction renderAbaResumoCentral'
  )}\n${extrairFuncao(
    'renderAcoesPipelineCentral',
    'function renderAcoesPipelineCentral(doc) {',
    '\nfunction renderBotaoProcessarCentral'
  )}\n${extrairFuncao(
    'renderPainelLateralCentral',
    'function renderPainelLateralCentral(detalhe) {',
    '\n/* ============================================================'
  )}\nglobalThis.renderPainel = renderPainelLateralCentral;\nglobalThis.renderAcoes = renderAcoesPipelineCentral;`,
  contexto
);

function renderizar(documento) {
  contexto.centralEntradasState.processando = false;
  contexto.renderPainel({ documento });
  return painel.innerHTML;
}

const documentoPendente = {
  id: 156,
  numero: '156',
  status: 'SINCRONIZADA',
  statusLabel: 'Nova',
  xmlDisponivel: true,
  parseDisponivel: false
};
let html = renderizar(documentoPendente);
const botao = '<button type="button" class="btn btn-primary btn-sm central-entradas-processar-topo" id="centralBtnProcessar"';
assert.equal(html.split('id="centralBtnProcessar"').length - 1, 1);
assert.ok(html.indexOf(botao) < html.indexOf('<div class="central-entradas-abas"'));
assert.ok(html.indexOf(botao) < html.indexOf('<div class="card-body central-entradas-painel-body"'));
assert.ok(!html.slice(html.indexOf('<div class="card-body central-entradas-painel-body"')).includes('centralBtnProcessar'));

html = renderizar({ ...documentoPendente, status: 'ERRO' });
assert.equal(html.split('id="centralBtnProcessar"').length - 1, 1);
assert.ok(!renderizar({ ...documentoPendente, parseDisponivel: true }).includes('centralBtnProcessar'));
assert.ok(!renderizar({ ...documentoPendente, xmlDisponivel: false }).includes('centralBtnProcessar'));

contexto.centralEntradasState.etapaProcessamento = null;
html = contexto.renderAcoes({
  id: 156,
  status: 'PRONTA_PARA_COMPRA',
  parseDisponivel: true
});
assert.match(html, /class="central-entradas-pipeline-acoes"/);
assert.match(html, /id="centralBtnReprocessar" data-doc-id="156"/);
assert.match(html, /id="centralBtnAbrirCompra" data-doc-id="156"/);
assert.match(html, /central-entradas-pipeline-acao--principal/);
assert.match(source, /\$\(document\)\.on\('click\.centralEntradas', '#centralBtnAbrirCompra'/);
assert.match(source, /\$\(document\)\.on\('click\.centralEntradas', '#centralBtnReprocessar'/);

const css = fs.readFileSync(cssPath, 'utf8');
assert.doesNotMatch(css, /\.central-entradas-painel-body\s*\{[^}]*(?:overflow-y:\s*auto|max-height)/s);
assert.match(css, /\.central-entradas-exec-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/s);
assert.match(source, /function posicionarPainelNoTopoCentral/);
assert.match(css, /\.central-entradas-tabela\s*\{[^}]*min-width:\s*0/s);
assert.doesNotMatch(css, /\.central-entradas-tabela\s*\{[^}]*min-width:\s*(?:900|860)px/s);
assert.match(css, /\.central-entradas-resumo-topo\s*\{[^}]*display:\s*flex/s);
assert.match(source, /central-entradas-resumo-topo/);
assert.match(css, /\.central-entradas-painel-header\s*\{[^}]*flex-wrap:\s*wrap/s);
assert.match(css, /\.central-entradas-pipeline-progress\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(css, /\.central-entradas-pipeline-acoes\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(css, /@media\s*\(max-width:\s*380px\)\s*\{[^}]*central-entradas-pipeline-progress,[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
assert.match(source, /\.central-entradas-aba'[\s\S]*?posicionarPainelNoTopoCentral\(\)/);
assert.match(source, /\$\(document\)\.on\('click\.centralEntradas', '#centralBtnProcessar'/);
assert.match(source, /if \(id\) processarDocumentoCentral\(id\);/);

const chamadasAtualizacao = [];
const chamadasFetch = [];
const painelAtualizacao = { innerHTML: '' };
const contextoAtualizacao = {
  centralEntradasState: {
    sincronizando: false,
    documentoSelecionadoId: 156,
    abaAtiva: 'itens',
    parseAtual: null
  },
  MENSAGEM_CONSULTA_INDISPONIVEL_CENTRAL: 'Consulta indisponível',
  atualizarIndicadorSyncBotao: () => {},
  renderIndicadoresCentral: () => {},
  centralEntradasFetch: async (url) => {
    chamadasFetch.push(url);
    if (url === '/sincronizar') return { sucesso: true, notasNovas: 1 };
    if (url === '/156') {
      return {
        documento: { id: 156, parseDisponivel: true },
        historico: []
      };
    }
    if (url === '/156/parse') {
      return { parseDisponivel: true, parse: { itens: [{ produto_nome: 'Item automático' }] } };
    }
    throw new Error(`URL inesperada: ${url}`);
  },
  showNotification: () => {},
  carregarDashboardCentral: async () => chamadasAtualizacao.push('dashboard'),
  carregarDocumentosCentral: async () => chamadasAtualizacao.push('lista'),
  carregarStatsFornecedorCentral: async () => {},
  renderGridCentralEntradas: () => {},
  renderPainelLateralCentral: () => {
    chamadasAtualizacao.push(`detalhe:${Boolean(contextoAtualizacao.centralEntradasState.parseAtual)}`);
  },
  renderPainelLateralPlaceholder: () => {},
  centralUx: () => ({ renderSkeletonPainelCentral: () => '' }),
  carregarStatusServicoCentral: () => {},
  document: { getElementById: () => painelAtualizacao }
};

vm.createContext(contextoAtualizacao);
vm.runInContext(
  `${extrairFuncao(
    'sincronizarCentralEntradas',
    'async function sincronizarCentralEntradas() {',
    '\nfunction obterUsuarioLogadoCentral'
  )}\n${extrairFuncao(
    'selecionarDocumentoCentral',
    'async function selecionarDocumentoCentral(id, opcoes = {}) {',
    '\nfunction alternarOrdenacaoCentral'
  )}\nglobalThis.sincronizar = sincronizarCentralEntradas;`,
  contextoAtualizacao
);
contextoAtualizacao.sincronizar().then(() => {
  assert.deepEqual(chamadasFetch, ['/sincronizar', '/156', '/156/parse']);
  assert.ok(chamadasAtualizacao.indexOf('lista') < chamadasAtualizacao.indexOf('detalhe:false'));
  assert.ok(chamadasAtualizacao.includes('detalhe:true'));
  assert.equal(
    contextoAtualizacao.centralEntradasState.parseAtual.parse.itens[0].produto_nome,
    'Item automático'
  );
  assert.equal(contextoAtualizacao.centralEntradasState.abaAtiva, 'itens');
  assert.equal(contextoAtualizacao.centralEntradasState.sincronizando, false);
  console.log('OK: sincronização atualiza a lista, recarrega o detalhe selecionado e carrega seus itens.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

console.log('OK: botão de processamento fica no cabeçalho, sem duplicidade e visível antes do corpo rolável.');
