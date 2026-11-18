'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'erp', 'js', 'produtos.js'),
  'utf8'
);

const versaoAtual = {
  id: 8,
  numero_versao: 1,
  estado: 'PUBLICADA',
  rendimento_quantidade: 100,
  rendimento_unidade: 'UN',
  componentes: [
    { id: 1, componente_base_id: 101, produto_id: 101, descricao: 'Leite em pó', quantidade: 10, unidade: 'KG' },
    { id: 2, componente_base_id: 102, produto_id: 102, descricao: 'Açúcar', quantidade: 5, unidade: 'KG' }
  ]
};

const versaoProposta = {
  ...versaoAtual,
  id: 9,
  numero_versao: 2,
  estado: 'PUBLICADA',
  componentes: versaoAtual.componentes.map((item) => ({ ...item, id: item.id + 10, quantidade: item.quantidade + 1 }))
};

function request(resultado, erro = null) {
  const callbacks = { done: [], fail: [], always: [] };
  let finalizado = false;
  const req = {
    done(callback) {
      callbacks.done.push(callback);
      if (finalizado && !erro) callback(resultado);
      return req;
    },
    fail(callback) {
      callbacks.fail.push(callback);
      if (finalizado && erro) callback(erro);
      return req;
    },
    always(callback) {
      callbacks.always.push(callback);
      if (finalizado) callback();
      return req;
    }
  };
  queueMicrotask(() => {
    finalizado = true;
    (erro ? callbacks.fail : callbacks.done).forEach((callback) => callback(erro || resultado));
    callbacks.always.forEach((callback) => callback());
  });
  return req;
}

function montar({
  vinculado = false,
  revisoes = [],
  erroInicial = null,
  erroPesquisa = null,
  erroPesquisaTradicional = null,
  erroVinculoTradicional = null,
  produtoId = 201,
  vinculoId = 33,
  ajustesIniciais = [],
  naturezaCadastro = 'PRODUZIDO',
  padraoComOrigemTradicional = false,
  fichaTradicionalAtiva = true,
  multiplosVinculos = false
} = {}) {
  const dom = new JSDOM('<!doctype html><html><body><form id="produtoForm"><div id="produtoFormDominios" class="row"><div id="resumoInteligenteProduto"></div></div></form></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/'
  });
  const { window } = dom;
  const chamadas = [];
  const ajustes = ajustesIniciais.map((item) => ({ ...item }));
  let link = vinculado ? {
    id: vinculoId,
    ficha_padrao_id: 5,
    ficha_id: 5,
    produto_id: produtoId,
    produto_nome: 'Picolé de uva',
    versao_id: 8,
    numero_versao: 1,
    versao_estado: 'PUBLICADA',
    ultima_versao_id: revisoes.length ? 9 : 8,
    ultima_versao: revisoes.length ? 2 : 1,
    estado_atualizacao: revisoes.length ? 'PENDENTE' : 'ATUALIZADO',
    revisao_id: revisoes[0]?.id || null,
    politica_atualizacao: 'APROVACAO_INDIVIDUAL',
    ativo: true
  } : null;
  const fichaResumo = {
    id: 5,
    codigo: padraoComOrigemTradicional ? 'FT-0001' : 'PAD-05',
    nome: padraoComOrigemTradicional ? 'LINHA CREMOSA' : 'Base cremosa',
    ativa: true,
    ultima_versao_id: 9,
    ultima_versao: 2,
    produtos_vinculados: vinculado ? 1 : 0
  };
  const fichaTradicionalResumo = {
    id: 44,
    codigo: 'FT-0001',
    nome: 'LINHA CREMOSA',
    ativa: fichaTradicionalAtiva,
    produto_id: null,
    componentes: 2,
    etapas: 1,
    informacoes: 1
  };
  const fichaTradicionalDetalhe = {
    ...fichaTradicionalResumo,
    produto_id: null,
    produto_nome: '',
    rendimento_quantidade: 100,
    rendimento_unidade: 'UN',
    observacoes: 'Preservar textura cremosa',
    componentes: [
      { id: 1, produto_id: 101, natureza: 'INSUMO', descricao: 'Leite em pó', quantidade: 10, unidade: 'KG' },
      { id: 2, produto_id: 102, natureza: 'INSUMO', descricao: 'Açúcar', quantidade: 5, unidade: 'KG' }
    ],
    etapas: [{ id: 1, titulo: 'Misturar', descricao: 'Homogeneizar', tempo_minutos: 5 }],
    informacoes: [{ id: 1, titulo: 'Rendimento', valor: '100 unidades' }]
  };
  const fichasMultiplas = [
    fichaResumo,
    {
      id: 6,
      codigo: 'PAD-06',
      nome: 'Base frutada',
      ativa: true,
      ultima_versao_id: 18,
      ultima_versao: 1,
      produtos_vinculados: 0
    },
    {
      id: 7,
      codigo: 'PAD-07',
      nome: 'Base chocolate',
      ativa: true,
      ultima_versao_id: 28,
      ultima_versao: 1,
      produtos_vinculados: 0
    }
  ];
  const versoesMultiplas = new Map([
    [5, [versaoProposta, versaoAtual]],
    [6, [{ ...versaoAtual, id: 18, numero_versao: 1, componentes: versaoAtual.componentes.map((item) => ({ ...item, quantidade: item.quantidade + 2 })) }]],
    [7, [{ ...versaoAtual, id: 28, numero_versao: 1, componentes: versaoAtual.componentes.map((item) => ({ ...item, quantidade: item.quantidade + 4 })) }]]
  ]);
  const vinculosMultiplos = [];
  const ajustesMultiplos = new Map();
  let proximoVinculoId = 100;
  let fichaTradicionalVinculada = false;

  function detalheFichaMultipla(ficha) {
    return {
      ...ficha,
      versoes: versoesMultiplas.get(Number(ficha.id)) || [],
      vinculos: vinculosMultiplos
        .filter((item) => Number(item.ficha_padrao_id) === Number(ficha.id))
        .map((item) => ({ ...item, ficha_id: undefined }))
    };
  }

  function fichaDetalhe() {
    return {
      ...fichaResumo,
      versoes: [versaoProposta, versaoAtual],
      vinculos: link ? [{
        ...link,
        ficha_id: undefined,
        estado_atualizacao: link.estado_atualizacao
      }] : []
    };
  }

  function aplicarAjuste(method, dados, ajusteId) {
    if (method === 'DELETE') {
      const index = ajustes.findIndex((item) => Number(item.id) === Number(ajusteId));
      if (index >= 0) ajustes.splice(index, 1);
      return { success: true, id: Number(ajusteId), removido: true };
    }
    const ajuste = { id: Number(ajusteId) || (ajustes.length + 20), ...dados };
    const index = ajustes.findIndex((item) => Number(item.id) === Number(ajusteId));
    if (index >= 0) ajustes[index] = ajuste;
    else ajustes.push(ajuste);
    return { success: true, ajuste };
  }

  function api(method, endpoint, dados) {
    chamadas.push({ method, endpoint, data: dados });
    if (method === 'GET' && endpoint === `/fabrica-loja/fichas/produtos/${produtoId}/tradicionais`) {
      return request({
        success: true,
        fichas: fichaTradicionalVinculada
          ? [{ ...fichaTradicionalResumo, produto_id: produtoId }]
          : []
      });
    }
    if (method === 'POST' && endpoint === '/fabrica-loja/fichas/44/produto') {
      if (erroVinculoTradicional) return request(null, erroVinculoTradicional);
      fichaTradicionalVinculada = true;
      fichaTradicionalDetalhe.produto_id = Number(dados.produto_id);
      return request({ success: true, ficha: { ...fichaTradicionalDetalhe } });
    }
    if (method === 'DELETE' && endpoint === `/fabrica-loja/fichas/44/produto/${produtoId}`) {
      fichaTradicionalVinculada = false;
      fichaTradicionalDetalhe.produto_id = null;
      return request({ success: true, ficha_id: 44, produto_id: produtoId, removido: true });
    }
    if (multiplosVinculos) {
      if (method === 'GET' && endpoint === '/fabrica-loja/fichas-padrao?incluir_inativas=1') {
        return request({ success: true, fichas: fichasMultiplas });
      }
      if (method === 'GET' && endpoint.startsWith('/fabrica-loja/fichas-padrao?busca=')) {
        const termo = new URLSearchParams(endpoint.split('?')[1]).get('busca').toLowerCase();
        return request({
          success: true,
          fichas: fichasMultiplas.filter((item) => `${item.codigo} ${item.nome}`.toLowerCase().includes(termo))
        });
      }
      const vinculosDaFicha = endpoint.match(/^\/fabrica-loja\/fichas-padrao\/(\d+)\/vinculos$/);
      if (method === 'GET' && vinculosDaFicha) {
        return request({
          success: true,
          vinculos: vinculosMultiplos.filter((item) => Number(item.ficha_padrao_id) === Number(vinculosDaFicha[1]))
        });
      }
      const detalhe = endpoint.match(/^\/fabrica-loja\/fichas-padrao\/(\d+)$/);
      if (method === 'GET' && detalhe) {
        const ficha = fichasMultiplas.find((item) => Number(item.id) === Number(detalhe[1]));
        return ficha
          ? request({ success: true, ficha: detalheFichaMultipla(ficha) })
          : request(null, { status: 404, responseJSON: { error: 'Ficha não encontrada.' } });
      }
      const ajustesDoVinculo = endpoint.match(/^\/fabrica-loja\/fichas-padrao\/vinculos\/(\d+)\/ajustes$/);
      if (method === 'GET' && ajustesDoVinculo) {
        return request({ success: true, ajustes: ajustesMultiplos.get(Number(ajustesDoVinculo[1])) || [] });
      }
      const atualizacoesDaFicha = endpoint.match(/^\/fabrica-loja\/fichas-padrao\/(\d+)\/atualizacoes$/);
      if (method === 'GET' && atualizacoesDaFicha) return request({ success: true, atualizacoes: [] });
      const novoVinculo = endpoint.match(/^\/fabrica-loja\/fichas-padrao\/(\d+)\/vinculos$/);
      if (method === 'POST' && novoVinculo) {
        const fichaId = Number(novoVinculo[1]);
        if (vinculosMultiplos.some((item) =>
          Number(item.ficha_padrao_id) === fichaId
          && Number(item.produto_id) === Number(dados.produto_id)
          && item.ativo)) {
          return request(null, { status: 409, responseJSON: { error: 'Vínculo já existente.' } });
        }
        const vinculo = {
          id: proximoVinculoId++,
          ficha_padrao_id: fichaId,
          ficha_id: fichaId,
          produto_id: Number(dados.produto_id),
          produto_nome: `Produto ${produtoId}`,
          versao_id: Number(dados.versao_id),
          numero_versao: Number(versoesMultiplas.get(fichaId).find((item) => Number(item.id) === Number(dados.versao_id)).numero_versao),
          versao_estado: 'PUBLICADA',
          estado_atualizacao: 'ATUALIZADO',
          politica_atualizacao: 'APROVACAO_INDIVIDUAL',
          ativo: true
        };
        vinculosMultiplos.push(vinculo);
        ajustesMultiplos.set(vinculo.id, []);
        return request({ success: true, vinculo: { ...vinculo } });
      }
      const atualizarVinculo = endpoint.match(/^\/fabrica-loja\/fichas-padrao\/vinculos\/(\d+)$/);
      if (method === 'PUT' && atualizarVinculo) {
        const vinculo = vinculosMultiplos.find((item) => Number(item.id) === Number(atualizarVinculo[1]));
        if (!vinculo) return request(null, { status: 404, responseJSON: { error: 'Vínculo não encontrado.' } });
        vinculo.ativo = dados.ativo !== false;
        return request({ success: true, vinculo: { ...vinculo } });
      }
      const ajusteDeVinculo = endpoint.match(/^\/fabrica-loja\/fichas-padrao\/vinculos\/(\d+)\/ajustes(?:\/(\d+))?$/);
      if ((method === 'POST' || method === 'PUT') && ajusteDeVinculo) {
        const lista = ajustesMultiplos.get(Number(ajusteDeVinculo[1])) || [];
        const ajusteId = Number(ajusteDeVinculo[2]) || lista.length + 1;
        const ajuste = { id: ajusteId, ...dados };
        const index = lista.findIndex((item) => Number(item.id) === ajusteId);
        if (index >= 0) lista[index] = ajuste;
        else lista.push(ajuste);
        ajustesMultiplos.set(Number(ajusteDeVinculo[1]), lista);
        return request({ success: true, ajuste });
      }
    }
    if (erroInicial && method === 'GET' && endpoint.startsWith('/fabrica-loja/fichas-padrao?')) {
      return request(null, erroInicial);
    }
    if (method === 'GET' && endpoint === '/fabrica-loja/fichas-padrao?incluir_inativas=1') {
      return request({ success: true, fichas: [fichaResumo] });
    }
    if (method === 'GET' && endpoint.startsWith('/fabrica-loja/fichas-padrao?busca=')) {
      if (erroPesquisa) return request(null, erroPesquisa);
      const termo = new URLSearchParams(endpoint.split('?')[1]).get('busca').toLowerCase();
      const corresponde = `${fichaResumo.codigo} ${fichaResumo.nome}`.toLowerCase().includes(termo);
      return request({ success: true, fichas: corresponde ? [fichaResumo] : [] });
    }
    if (method === 'GET' && endpoint.startsWith('/fabrica-loja/fichas?busca=')) {
      if (erroPesquisaTradicional) return request(null, erroPesquisaTradicional);
      const termo = new URLSearchParams(endpoint.split('?')[1]).get('busca').toLowerCase();
      const corresponde = `${fichaTradicionalResumo.codigo} ${fichaTradicionalResumo.nome}`.toLowerCase().includes(termo);
      return request({ success: true, fichas: corresponde ? [fichaTradicionalResumo] : [] });
    }
    if (method === 'GET' && endpoint === '/fabrica-loja/fichas/44') {
      return request({ success: true, ficha: fichaTradicionalDetalhe });
    }
    if (method === 'GET' && endpoint === '/fabrica-loja/fichas-padrao/5/vinculos') {
      return request({ success: true, vinculos: link ? [{ ...link }] : [] });
    }
    if (method === 'GET' && endpoint === '/fabrica-loja/fichas-padrao/5') {
      return request({ success: true, ficha: fichaDetalhe() });
    }
    if (method === 'GET' && endpoint === `/fabrica-loja/fichas-padrao/vinculos/${vinculoId}/ajustes`) {
      return request({ success: true, ajustes: ajustes.map((item) => ({ ...item })) });
    }
    if (method === 'GET' && endpoint === '/fabrica-loja/fichas-padrao/5/atualizacoes') {
      return request({ success: true, atualizacoes: revisoes.map((item) => ({ ...item })) });
    }
    if (method === 'GET' && endpoint === '/fabrica-loja/insumos?q=Leite') {
      return request({ success: true, insumos: [
        { id: 101, codigo: 'INS-101', nome: 'Leite em pó', unidade: 'KG' },
        { id: 103, codigo: 'INS-103', nome: 'Morango', unidade: 'KG' }
      ] });
    }
    if (method === 'POST' && endpoint === '/fabrica-loja/fichas-padrao/5/vinculos') {
      if (erroVinculoTradicional) return request(null, erroVinculoTradicional);
      link = {
        id: vinculoId,
        ficha_padrao_id: 5,
        ficha_id: 5,
        produto_id: Number(dados.produto_id),
        produto_nome: `Produto ${produtoId}`,
        versao_id: Number(dados.versao_id),
        numero_versao: Number(dados.versao_id) === 9 ? 2 : 1,
        versao_estado: 'PUBLICADA',
        estado_atualizacao: 'ATUALIZADO',
        politica_atualizacao: 'APROVACAO_INDIVIDUAL',
        ativo: true
      };
      return request({ success: true, vinculo: { ...link } });
    }
    if ((method === 'POST' || method === 'PUT') && endpoint.includes('/ajustes')) {
      const ajusteId = endpoint.match(/\/ajustes\/(\d+)$/)?.[1];
      return request(aplicarAjuste(method, dados, ajusteId));
    }
    if (method === 'DELETE' && endpoint.includes('/ajustes/')) {
      const ajusteId = endpoint.match(/\/ajustes\/(\d+)$/)?.[1];
      return request(aplicarAjuste(method, dados, ajusteId));
    }
    if (method === 'PUT' && endpoint === '/fabrica-loja/fichas-padrao/atualizacoes/80') {
      const resultado = {
        revisao_id: 80,
        estado: dados.decisao === 'APROVAR' ? 'APROVADO' : 'MANTER_ANTERIOR',
        versao_atual_id: dados.decisao === 'APROVAR' ? 9 : 8
      };
      if (link && dados.decisao === 'APROVAR') {
        link.versao_id = 9;
        link.numero_versao = 2;
        link.estado_atualizacao = 'ATUALIZADO';
      }
      const revisao = revisoes.find((item) => Number(item.id) === 80);
      if (revisao) revisao.estado = resultado.estado;
      return request({ success: true, revisao: resultado });
    }
    return request(null, { status: 404, responseJSON: { error: `Rota de teste não simulada: ${method} ${endpoint}` } });
  }

  function jquery() {
    return { on() { return this; } };
  }
  jquery.ajax = (options) => {
    if (typeof options.success === 'function') options.success({ success: true, fichas: [] });
    return {};
  };

  window.$ = jquery;
  window.API_URL = '/api';
  window.ftApi = api;
  window.ftPadraoMensagemErro = (xhr, reserva) =>
    xhr?.responseJSON?.error || (xhr?.status === 401 ? 'Sua sessão expirou.' : reserva);
  window.confirm = () => true;
  window.formatCurrency = (value) => String(value);
  window.eval(script);

  const root = window.document.getElementById('produtoFormDominios');
  root.insertAdjacentHTML('beforeend', `
    <div><h6>1 · Identificação</h6></div><div><input id="nome" value="Produto original"></div>
    <div><h6>2 · Comercial</h6></div><div><input id="preco_venda" value="10"></div>
    <div><h6>3 · Estoque</h6></div><div><input id="estoque_minimo" value="0"></div>
    <div><h6>5 · Custos</h6></div><div><input id="preco_compra" value="2"></div>
    <div><h6>6 · Fiscal</h6></div><div><input id="ncm" value="00000000"></div>
    <div><h6>7 · Histórico</h6></div><div><span>Somente leitura</span></div>
  `);
  window.organizarFichaOperacionalProduto({
    id: produtoId,
    nome: 'Picolé de uva',
    natureza_cadastro: naturezaCadastro,
    unidade: 'UN',
    estoque_atual: 0,
    saldo_fiscal: 0,
    saldo_nao_fiscal: 0
  }, true);

  return { dom, window, root, chamadas };
}

function esperarAtualizacoes() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function esperarBusca() {
  return new Promise((resolve) => setTimeout(resolve, 270));
}

describe('Ficha Técnica no cadastro do produto', () => {
  it('adiciona a aba após Histórico, pesquisa, exibe prévia e importa a versão publicada selecionada', async () => {
    const { dom, window, root, chamadas } = montar();
    const abas = [...root.querySelectorAll('.produto-ficha-abas__btn')].map((item) => item.dataset.aba);
    assert.deepEqual(abas, ['geral', 'comercial', 'estoque', 'custos', 'fiscal', 'observacoes', 'producao', 'historico', 'ficha_tecnica']);
    assert.match(root.querySelector('.produto-ficha-aba[data-aba="producao"]').textContent, /Nenhuma ficha técnica vinculada/);

    window.document.getElementById('nome').value = 'Alteração local não salva';
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    assert.ok(chamadas.some((item) => item.endpoint === '/fabrica-loja/fichas-padrao?incluir_inativas=1'));
    assert.ok(root.querySelector('[data-ft-produto-associacao]'));
    assert.equal(root.querySelector('label[for="ft-produto-ficha-busca"]').textContent, 'Buscar ficha técnica');
    assert.equal(window.document.querySelectorAll('#produtoForm form').length, 0);

    const busca = root.querySelector('[data-ft-produto-ficha-busca]');
    busca.value = 'PAD-05';
    busca.dispatchEvent(new window.Event('input', { bubbles: true }));
    await esperarBusca();
    await esperarAtualizacoes();
    assert.ok(chamadas.some((item) => item.endpoint.startsWith('/fabrica-loja/fichas-padrao?busca=PAD-05&')));
    assert.match(root.querySelector('[data-ft-produto-ficha-resultados]').textContent, /Base cremosa[\s\S]*PAD-05[\s\S]*v2[\s\S]*Padrão legado · Ativa/);

    const buscaNome = root.querySelector('[data-ft-produto-ficha-busca]');
    buscaNome.value = 'Base cremosa';
    buscaNome.dispatchEvent(new window.Event('input', { bubbles: true }));
    await esperarBusca();
    await esperarAtualizacoes();
    assert.ok(chamadas.some((item) => item.endpoint.startsWith('/fabrica-loja/fichas-padrao?busca=Base%20cremosa&')));
    root.querySelector('[data-ft-produto-acao="selecionar-ficha"][data-ficha-id="5"]').click();
    await esperarAtualizacoes();
    assert.match(root.querySelector('[data-ft-produto-ficha-selecao]').textContent, /Prévia da ficha selecionada/);
    assert.match(root.querySelector('[data-ft-produto-ficha-selecao]').textContent, /Leite em pó/);
    assert.match(root.querySelector('[data-ft-produto-ficha-selecao]').textContent, /11/);

    let versao = root.querySelector('[data-ft-produto-ficha-versao]');
    versao.value = '8';
    versao.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.match(root.querySelector('[data-ft-produto-ficha-selecao]').textContent, /v1/);
    assert.match(root.querySelector('[data-ft-produto-ficha-selecao]').textContent, /10/);
    versao = root.querySelector('[data-ft-produto-ficha-versao]');
    versao.value = '9';
    versao.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.match(root.querySelector('[data-ft-produto-ficha-selecao]').textContent, /v2/);

    const form = root.querySelector('[data-ft-produto-associacao]');
    let textoConfirmacao = '';
    window.confirm = (texto) => { textoConfirmacao = texto; return true; };
    form.querySelector('[data-ft-produto-acao="associar"]').click();
    assert.match(textoConfirmacao, /Importar a ficha técnica "Base cremosa", versão 2/);
    assert.notEqual(root.querySelector('[data-ft-produto-feedback]').textContent, 'Ficha técnica importada e vinculada ao produto.');
    await esperarAtualizacoes();
    const chamadaVinculo = chamadas.find((item) => item.method === 'POST' && item.endpoint.endsWith('/vinculos'));
    assert.deepEqual(JSON.parse(JSON.stringify(chamadaVinculo.data)), { produto_id: 201, versao_id: 9 });
    assert.match(root.querySelector('[data-ft-produto-feedback]').textContent, /importada e vinculada/);
    assert.match(root.textContent, /Versão associada: v2/);
    assert.equal(window.document.getElementById('nome').value, 'Alteração local não salva');
    dom.window.close();
  });

  it('adiciona várias fichas ao produto, mantém cada vínculo e remove somente o selecionado', async () => {
    const { dom, window, root, chamadas } = montar({ multiplosVinculos: true });
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();

    async function adicionarFicha(codigo) {
      const busca = root.querySelector('[data-ft-produto-ficha-busca]');
      busca.value = codigo;
      busca.dispatchEvent(new window.Event('input', { bubbles: true }));
      await esperarBusca();
      const resultado = [...root.querySelectorAll('[data-ft-produto-acao="selecionar-ficha"]')]
        .find((item) => item.textContent.includes(codigo));
      assert.ok(resultado, `Ficha ${codigo} deve aparecer na busca.`);
      resultado.click();
      await esperarAtualizacoes();
      root.querySelector('[data-ft-produto-acao="associar"]').click();
      await esperarAtualizacoes();
    }

    await adicionarFicha('PAD-05');
    assert.equal(root.querySelectorAll('[data-ft-produto-vinculo-card]').length, 1);
    await adicionarFicha('PAD-06');
    assert.equal(root.querySelectorAll('[data-ft-produto-vinculo-card]').length, 2);
    await adicionarFicha('PAD-07');
    assert.equal(root.querySelectorAll('[data-ft-produto-vinculo-card]').length, 3);
    assert.match(root.textContent, /Base cremosa/);
    assert.match(root.textContent, /Base frutada/);
    assert.match(root.textContent, /Base chocolate/);
    assert.ok(root.querySelector('[data-ft-produto-vinculo-card][data-vinculo-id="100"]'));
    assert.ok(root.querySelector('[data-ft-produto-vinculo-card][data-vinculo-id="101"]'));
    assert.ok(root.querySelector('[data-ft-produto-vinculo-card][data-vinculo-id="102"]'));

    const buscaDuplicada = root.querySelector('[data-ft-produto-ficha-busca]');
    buscaDuplicada.value = 'PAD-05';
    buscaDuplicada.dispatchEvent(new window.Event('input', { bubbles: true }));
    await esperarBusca();
    root.querySelector('[data-ft-produto-acao="selecionar-ficha"][data-ficha-id="5"]').click();
    await esperarAtualizacoes();
    root.querySelector('[data-ft-produto-acao="associar"]').click();
    await esperarAtualizacoes();
    assert.equal(chamadas.filter((item) =>
      item.method === 'POST' && item.endpoint === '/fabrica-loja/fichas-padrao/5/vinculos').length, 1);
    assert.match(root.querySelector('[data-ft-produto-feedback]').textContent, /já possui um vínculo ativo/);

    assert.equal(root.querySelectorAll('[data-ft-produto-ajuste-form]').length, 0);

    let confirmouRemocao = false;
    window.confirm = (texto) => {
      confirmouRemocao = /Base frutada/.test(texto) && /ficha técnica será preservada/.test(texto);
      return true;
    };
    root.querySelector('[data-ft-produto-acao="remover-vinculo"][data-vinculo-id="101"]').click();
    await esperarAtualizacoes();
    assert.equal(confirmouRemocao, true);
    assert.equal(root.querySelectorAll('[data-ft-produto-vinculo-card]').length, 2);
    assert.match(root.textContent, /PAD-06 Base frutada[\s\S]*v1/);
    assert.match(root.querySelector('[data-ft-produto-vinculo-card][data-vinculo-id="100"]').textContent, /Base cremosa/);
    assert.match(root.querySelector('[data-ft-produto-vinculo-card][data-vinculo-id="102"]').textContent, /Base chocolate/);
    dom.window.close();
  });

  it('seleciona e vincula uma ficha tradicional diretamente após confirmação', async () => {
    const { dom, window, root, chamadas } = montar();
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    const busca = root.querySelector('[data-ft-produto-ficha-busca]');
    busca.value = 'FT-0001';
    busca.dispatchEvent(new window.Event('input', { bubbles: true }));
    await esperarBusca();
    assert.ok(chamadas.some((item) => item.endpoint.startsWith('/fabrica-loja/fichas?busca=FT-0001&')));
    assert.match(root.querySelector('[data-ft-produto-ficha-resultados]').textContent, /LINHA CREMOSA[\s\S]*FT-0001[\s\S]*Tradicional · 2 componentes · 1 etapas/);

    root.querySelector('[data-ft-produto-acao="selecionar-ficha-tradicional"][data-ficha-id="44"]').click();
    await esperarAtualizacoes();
    assert.ok(chamadas.some((item) => item.endpoint === '/fabrica-loja/fichas/44'));
    const previa = root.querySelector('[data-ft-produto-ficha-selecao]').textContent;
    assert.match(previa, /LINHA CREMOSA/);
    assert.match(previa, /Tradicional/);
    assert.match(previa, /100\s*UN/);
    assert.match(previa, /Leite em pó/);
    assert.match(previa, /Misturar/);

    let confirmouImportacao = false;
    window.confirm = (texto) => {
      confirmouImportacao = /não serão convertidos/i.test(texto);
      return true;
    };
    root.querySelector('[data-ft-produto-acao="associar"]').click();
    await esperarAtualizacoes();
    assert.equal(confirmouImportacao, true);
    assert.ok(chamadas.some((item) => item.method === 'POST'
      && item.endpoint === '/fabrica-loja/fichas/44/produto'));
    const chamadaVinculo = chamadas.find((item) => item.method === 'POST'
      && item.endpoint === '/fabrica-loja/fichas/44/produto');
    assert.deepEqual(JSON.parse(JSON.stringify(chamadaVinculo.data)), { produto_id: 201 });
    await esperarAtualizacoes();
    assert.match(root.querySelector('[data-ft-produto-feedback]').textContent, /vinculada ao produto sem conversão/);
    assert.match(root.textContent, /Fichas tradicionais vinculadas/);
    assert.match(root.textContent, /LINHA CREMOSA/);
    dom.window.close();
  });

  it('mantém fichas tradicionais e padrão como origens distintas mesmo com código e nome iguais', async () => {
    const { dom, window, root, chamadas } = montar({ padraoComOrigemTradicional: true });
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    const busca = root.querySelector('[data-ft-produto-ficha-busca]');
    busca.value = 'FT-0001';
    busca.dispatchEvent(new window.Event('input', { bubbles: true }));
    await esperarBusca();

    const resultados = root.querySelectorAll('[data-ft-produto-ficha-resultados] [data-ft-produto-acao]');
    assert.equal(resultados.length, 2);
    assert.deepEqual([...resultados].map((item) => item.dataset.ftProdutoAcao).sort(), [
      'selecionar-ficha',
      'selecionar-ficha-tradicional'
    ]);
    assert.match(resultados[0].textContent + resultados[1].textContent, /Padrão/);
    assert.match(resultados[0].textContent + resultados[1].textContent, /Tradicional/);
    root.querySelector('[data-ft-produto-acao="selecionar-ficha"]').click();
    await esperarAtualizacoes();
    assert.ok(chamadas.some((item) => item.endpoint === '/fabrica-loja/fichas-padrao/5'));
    assert.equal(chamadas.some((item) => item.endpoint === '/fabrica-loja/fichas/44'), false);
    dom.window.close();
  });

  it('permite pré-visualizar uma ficha tradicional inativa, mas bloqueia sua utilização', async () => {
    const { dom, window, root, chamadas } = montar({ fichaTradicionalAtiva: false });
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    const busca = root.querySelector('[data-ft-produto-ficha-busca]');
    busca.value = 'FT-0001';
    busca.dispatchEvent(new window.Event('input', { bubbles: true }));
    await esperarBusca();
    root.querySelector('[data-ft-produto-acao="selecionar-ficha-tradicional"][data-ficha-id="44"]').click();
    await esperarAtualizacoes();

    assert.match(root.querySelector('[data-ft-produto-ficha-selecao]').textContent, /Tradicional · Inativa/);
    assert.equal(root.querySelector('[data-ft-produto-acao="associar"]').disabled, true);
    assert.equal(chamadas.some((item) => item.method === 'POST'
      && item.endpoint === '/fabrica-loja/fichas/44/produto'), false);
    dom.window.close();
  });

  it('não informa sucesso quando o vínculo tradicional é recusado pela API', async () => {
    const { dom, window, root, chamadas } = montar({
      erroVinculoTradicional: { status: 409, responseJSON: { error: 'Produto já possui vínculo ativo.' } }
    });
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    const busca = root.querySelector('[data-ft-produto-ficha-busca]');
    busca.value = 'FT-0001';
    busca.dispatchEvent(new window.Event('input', { bubbles: true }));
    await esperarBusca();
    root.querySelector('[data-ft-produto-acao="selecionar-ficha-tradicional"][data-ficha-id="44"]').click();
    await esperarAtualizacoes();
    root.querySelector('[data-ft-produto-acao="associar"]').click();
    await esperarAtualizacoes();

    assert.equal(root.querySelector('[data-ft-produto-feedback]').textContent, 'Produto já possui vínculo ativo.');
    assert.equal(chamadas.some((item) => item.method === 'POST'
      && item.endpoint === '/fabrica-loja/fichas/44/produto'), true);
    assert.equal(chamadas.some((item) => item.method === 'POST'
      && item.endpoint === '/fabrica-loja/fichas-padrao/5/vinculos'), false);
    assert.doesNotMatch(root.querySelector('[data-ft-produto-feedback]').textContent, /convertida/);
    dom.window.close();
  });

  it('permite reutilizar a mesma ficha em produtos distintos sem oferecer ajustes por vínculo', async () => {
    const primeiro = montar({
      vinculado: true,
      produtoId: 201,
      vinculoId: 33
    });
    const segundo = montar({ vinculado: true, produtoId: 202, vinculoId: 34 });
    primeiro.root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    segundo.root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();

    assert.match(primeiro.root.textContent, /Base cremosa/);
    assert.match(segundo.root.textContent, /Base cremosa/);
    assert.match(primeiro.root.textContent, /Composição da versão-base/);
    assert.match(segundo.root.textContent, /Composição da versão-base/);
    assert.equal(primeiro.root.querySelector('[data-ft-produto-ajuste-form]'), null);
    assert.equal(segundo.root.querySelector('[data-ft-produto-ajuste-form]'), null);
    assert.equal(primeiro.chamadas.some((item) => item.endpoint.includes('/ajustes')), false);
    assert.equal(segundo.chamadas.some((item) => item.endpoint.includes('/ajustes')), false);
    primeiro.dom.window.close();
    segundo.dom.window.close();
  });

  it('impede pesquisa para produto incompatível e apresenta erro de pesquisa da API', async () => {
    const incompatível = montar({ naturezaCadastro: 'INSUMO' });
    incompatível.root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    assert.match(incompatível.root.textContent, /somente para produtos classificados como PRODUZIDO/i);
    assert.equal(incompatível.root.querySelector('[data-ft-produto-ficha-busca]'), null);
    incompatível.dom.window.close();

    const falhaPesquisa = montar({
      erroPesquisa: { status: 401, responseJSON: { error: 'Sua sessão expirou.' } }
    });
    falhaPesquisa.root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    const busca = falhaPesquisa.root.querySelector('[data-ft-produto-ficha-busca]');
    busca.value = 'Base';
    busca.dispatchEvent(new falhaPesquisa.window.Event('input', { bubbles: true }));
    await esperarBusca();
    assert.match(falhaPesquisa.root.querySelector('[data-ft-produto-ficha-resultados]').textContent, /sessão expirou/i);
    assert.equal(falhaPesquisa.root.querySelector('[data-ft-produto-acao="associar"]'), null);
    falhaPesquisa.dom.window.close();

    const parcial = montar({
      erroPesquisa: { status: 503, responseJSON: { error: 'Catálogo padrão indisponível.' } }
    });
    parcial.root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    const buscaParcial = parcial.root.querySelector('[data-ft-produto-ficha-busca]');
    buscaParcial.value = 'FT-0001';
    buscaParcial.dispatchEvent(new parcial.window.Event('input', { bubbles: true }));
    await esperarBusca();
    assert.match(parcial.root.querySelector('[data-ft-produto-ficha-resultados]').textContent, /Catálogo padrão indisponível/);
    assert.match(parcial.root.querySelector('[data-ft-produto-ficha-resultados]').textContent, /LINHA CREMOSA/);
    parcial.dom.window.close();

    const tradicionalIndisponivel = montar({
      erroPesquisaTradicional: { status: 503, responseJSON: { error: 'Catálogo tradicional indisponível.' } }
    });
    tradicionalIndisponivel.root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    const buscaPadrao = tradicionalIndisponivel.root.querySelector('[data-ft-produto-ficha-busca]');
    buscaPadrao.value = 'PAD-05';
    buscaPadrao.dispatchEvent(new tradicionalIndisponivel.window.Event('input', { bubbles: true }));
    await esperarBusca();
    assert.match(tradicionalIndisponivel.root.querySelector('[data-ft-produto-ficha-resultados]').textContent, /Catálogo tradicional indisponível/);
    assert.match(tradicionalIndisponivel.root.querySelector('[data-ft-produto-ficha-resultados]').textContent, /Base cremosa/);
    tradicionalIndisponivel.dom.window.close();
  });

  it('exibe a composição-base sem controles de ajuste por vínculo', async () => {
    const { dom, root, chamadas } = montar({ vinculado: true });
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    assert.match(root.textContent, /Composição da versão-base/);
    assert.match(root.textContent, /Leite em pó/);
    assert.equal(root.querySelector('[data-ft-produto-ajuste-form]'), null);
    assert.equal(root.querySelector('[data-ft-produto-acao="editar-ajuste"]'), null);
    assert.equal(root.querySelector('[data-ft-produto-acao="remover-ajuste"]'), null);
    assert.equal(chamadas.some((item) => item.endpoint.includes('/ajustes')), false);
    dom.window.close();
  });

  it('aprova ou mantém a versão anterior somente para o produto atual após confirmação', async () => {
    const revisoes = [{
      id: 80,
      vinculo_id: 33,
      produto_id: 201,
      versao_anterior: 1,
      versao_anterior_id: 8,
      versao_nova: 2,
      versao_nova_id: 9,
      versao_atual_id: 8,
      estado: 'PENDENTE'
    }, {
      id: 81,
      vinculo_id: 34,
      produto_id: 202,
      versao_anterior: 1,
      versao_nova: 2,
      estado: 'PENDENTE'
    }];
    const { dom, window, root, chamadas } = montar({ vinculado: true, revisoes });
    let confirmou = false;
    window.confirm = () => { confirmou = true; return true; };
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    assert.match(root.textContent, /Versão atual v1 → proposta v2/);
    assert.equal(root.querySelectorAll('[data-ft-produto-acao="decidir"]').length, 2);

    const aprovar = root.querySelector('[data-ft-produto-acao="decidir"][data-decisao="APROVAR"]');
    aprovar.click();
    await esperarAtualizacoes();
    assert.equal(confirmou, true);
    const decisao = chamadas.find((item) => item.method === 'PUT' && item.endpoint.endsWith('/atualizacoes/80'));
    assert.deepEqual(JSON.parse(JSON.stringify(decisao.data)), { decisao: 'APROVAR', justificativa: '' });
    assert.match(root.textContent, /Versão associada: v2/);
    assert.equal(chamadas.some((item) => item.endpoint.endsWith('/atualizacoes/81')), false);
    dom.window.close();
  });

  it('mantém a versão atual ao rejeitar uma proposta após confirmação', async () => {
    const revisoes = [{
      id: 80,
      vinculo_id: 33,
      produto_id: 201,
      versao_anterior: 1,
      versao_anterior_id: 8,
      versao_nova: 2,
      versao_nova_id: 9,
      versao_atual_id: 8,
      estado: 'PENDENTE'
    }];
    const { dom, window, root, chamadas } = montar({ vinculado: true, revisoes });
    let confirmou = false;
    window.confirm = () => { confirmou = true; return true; };
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    root.querySelector('[data-ft-produto-acao="decidir"][data-decisao="MANTER_ANTERIOR"]').click();
    await esperarAtualizacoes();
    const decisao = chamadas.find((item) => item.method === 'PUT' && item.endpoint.endsWith('/atualizacoes/80'));
    assert.equal(confirmou, true);
    assert.deepEqual(JSON.parse(JSON.stringify(decisao.data)), { decisao: 'MANTER_ANTERIOR', justificativa: '' });
    assert.match(root.textContent, /Versão associada: v1/);
    assert.match(root.textContent, /Versão anterior mantida somente para este produto/);
    dom.window.close();
  });

  it('exibe erros de autenticação sem sucesso aparente', async () => {
    const { dom, root } = montar({
      erroInicial: { status: 401, responseJSON: { error: 'Sua sessão expirou.' } }
    });
    root.querySelector('.produto-ficha-abas__btn[data-aba="ficha_tecnica"]').click();
    await esperarAtualizacoes();
    assert.match(root.querySelector('[data-ft-produto-feedback]').textContent, /sessão expirou/i);
    assert.ok(root.querySelector('[data-ft-produto-acao="tentar-novamente"]'));
    dom.window.close();
  });
});
