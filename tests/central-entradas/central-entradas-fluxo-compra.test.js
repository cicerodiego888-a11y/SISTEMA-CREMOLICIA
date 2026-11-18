const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..', '..');
const centralSource = fs.readFileSync(
  path.join(raiz, 'frontend', 'erp', 'js', 'central-entradas.js'),
  'utf8'
);
const comprasSource = fs.readFileSync(
  path.join(raiz, 'frontend', 'erp', 'js', 'compras.js'),
  'utf8'
);

function extrair(source, inicio, fim) {
  const inicioFuncao = source.indexOf(inicio);
  const fimFuncao = source.indexOf(fim, inicioFuncao);
  assert.ok(inicioFuncao >= 0 && fimFuncao > inicioFuncao, `Não foi possível localizar ${inicio}`);
  return source.slice(inicioFuncao, fimFuncao);
}

function criarContextoCentral({ centralEntradasFetch, aoCarregarCompras } = {}) {
  const chamadas = [];
  const notificacoes = [];
  const armazenamento = new Map();
  let opcoesRevisao = null;
  const contexto = {
    API_URL: '/api',
    window: {},
    rolarParaTopoConteudoErp: () => chamadas.push({ action: 'scroll', y: 0 }),
    MiipCentralRevisao: {
      iniciar(opcoes) {
        opcoesRevisao = opcoes;
      }
    },
    carregarProdutosParaRevisaoCentral: async () => [],
    obterUsuarioLogadoCentral: () => ({ id: 7 }),
    centralEntradasFetch: async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      if (centralEntradasFetch) return centralEntradasFetch(url, opcoes);
      if (url === '/81/revisar/concluir') {
        return { proximaAcao: 'abrir_compra' };
      }
      if (url === '/81/abrir-compra') {
        return {
          documentoId: 81,
          dadosCompra: { chave_acesso: 'CHAVE-81', itens: [{ produto_id: 63 }] }
        };
      }
      throw new Error(`URL inesperada: ${url}`);
    },
    sessionStorage: {
      setItem(chave, valor) {
        armazenamento.set(chave, valor);
      },
      getItem(chave) {
        return armazenamento.get(chave) || null;
      },
      removeItem(chave) {
        armazenamento.delete(chave);
      }
    },
    showNotification: (mensagem, tipo) => notificacoes.push({ mensagem, tipo }),
    carregarDashboardCentral: async () => chamadas.push({ action: 'dashboard' }),
    carregarDocumentosCentral: async () => chamadas.push({ action: 'documentos' }),
    selecionarDocumentoCentral: async (id) => chamadas.push({ action: 'selecionar', id }),
    abrirRevisaoMiipCentral: async (id) => chamadas.push({ action: 'revisar', id }),
    atualizarCentralEAbrirRevisaoMiip: async (id) => {
      await Promise.all([
        contexto.carregarDashboardCentral(),
        contexto.carregarDocumentosCentral()
      ]);
      await contexto.selecionarDocumentoCentral(id);
      await contexto.abrirRevisaoMiipCentral(id);
    },
    loadPage: (pagina) => {
      chamadas.push({ action: 'navegar', pagina });
      if (pagina === 'compras' && aoCarregarCompras) aoCarregarCompras(contexto);
    },
    bootstrap: { Modal: { getOrCreateInstance: () => ({ show() {}, hide() {} }) } },
    console
  };
  vm.createContext(contexto);
  contexto.obterOpcoesRevisao = () => opcoesRevisao;
  contexto.chamadas = chamadas;
  contexto.notificacoes = notificacoes;
  contexto.armazenamento = armazenamento;
  return contexto;
}

async function fluxoRevisaoParaCompra() {
  const contexto = criarContextoCentral({
    aoCarregarCompras: (ctx) => ctx.consumirPendencia()
  });
  const funcsCentral = [
    extrair(
      centralSource,
      'async function abrirCentralRevisaoMiip(documentoId, dadosImportacao) {',
      '\nasync function processarDocumentoCentral'
    ),
    extrair(
      centralSource,
      'async function abrirCompraDesdeCentral(documentoId) {',
      '\nasync function buscarChaveCentralEntradas'
    )
  ].join('\n');
  const funcsCompra = [
    extrair(
      comprasSource,
      'function abrirCompraDesdeCentralEntradas(payload) {',
      '\nfunction abrirCentralInteligenteEntradas'
    ),
    extrair(
      comprasSource,
      'function consumirPendenciaCompraCentral() {',
      '\nfunction preencherFormularioCompra'
    )
  ].join('\n');
  const efeitosCompra = [];
  contexto.showCompraModal = () => efeitosCompra.push('mostrar-formulario');
  contexto.finalizarImportacaoXmlCompra = (dados) => efeitosCompra.push(dados);
  vm.runInContext(
    `${funcsCentral}\n${funcsCompra}\nglobalThis.abrirRevisao = abrirCentralRevisaoMiip;\nglobalThis.consumirPendencia = consumirPendenciaCompraCentral;`,
    contexto
  );

  await contexto.abrirRevisao(81, { itens: [] });
  const opcoes = contexto.obterOpcoesRevisao();
  assert.ok(opcoes);
  await opcoes.onConcluir({
    itens: [{ produto_id: 63, miip_revisao_status: 'confirmado' }]
  });

  assert.deepEqual(
    contexto.chamadas.filter((chamada) => chamada.url).map((chamada) => chamada.url),
    ['/81/revisar/concluir', '/81/abrir-compra']
  );
  assert.deepEqual(
    JSON.parse(contexto.chamadas.find((chamada) => chamada.url === '/81/revisar/concluir').opcoes.body).itens,
    [{ produto_id: 63, miip_revisao_status: 'confirmado' }]
  );
  assert.deepEqual(
    contexto.chamadas.filter((chamada) => chamada.action === 'navegar'),
    [{ action: 'navegar', pagina: 'compras' }]
  );
  assert.deepEqual(efeitosCompra[0], 'mostrar-formulario');
  assert.ok(contexto.chamadas.some((chamada) => chamada.action === 'scroll' && chamada.y === 0));
  assert.equal(efeitosCompra[1].chave_acesso, 'CHAVE-81');
  assert.equal(efeitosCompra[1].itens[0].produto_id, 63);
  assert.equal(contexto.armazenamento.has('central_abrir_compra'), false);
  assert.equal(contexto.chamadas.some((chamada) => /\/compras(?:\/|$)/.test(chamada.url || '')), false);
}

async function pendenciaDeValidacaoRetornaParaRevisao() {
  const erro = new Error('Produto pendente');
  erro.codigo = 'VINCULO_PRODUTO_INVALIDO';
  const contexto = criarContextoCentral({
    centralEntradasFetch: async () => {
      throw erro;
    }
  });
  vm.runInContext(
    extrair(
      centralSource,
      'async function abrirCompraDesdeCentral(documentoId) {',
      '\nasync function buscarChaveCentralEntradas'
    ) + '\nglobalThis.abrirCompra = abrirCompraDesdeCentral;',
    contexto
  );

  await contexto.abrirCompra(81);
  assert.deepEqual(
    contexto.chamadas.filter((chamada) => chamada.action === 'selecionar' || chamada.action === 'revisar'),
    [
      { action: 'selecionar', id: 81 },
      { action: 'revisar', id: 81 }
    ]
  );
  assert.equal(contexto.chamadas.some((chamada) => chamada.action === 'navegar'), false);
  assert.ok(contexto.notificacoes.some(({ mensagem }) => mensagem.includes('pendentes ou inválidos')));
}

Promise.all([
  fluxoRevisaoParaCompra(),
  pendenciaDeValidacaoRetornaParaRevisao()
]).then(() => {
  console.log('OK: Central → revisão MIIP → abertura oficial de Compras preserva o documento e não salva a compra.');
  console.log('OK: produtos recusados pela validação retornam à revisão MIIP do mesmo documento.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
