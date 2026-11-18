'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'frontend/erp/js/fichas-tecnicas.js'), 'utf8');

const versaoBase = {
  id: 8,
  numero_versao: 1,
  estado: 'PUBLICADA',
  rendimento_quantidade: 100,
  rendimento_unidade: 'UN',
  observacoes: '',
  componentes: [{
    id: 1,
    componente_base_id: 101,
    produto_id: 101,
    descricao: 'Leite em pó',
    quantidade: 10,
    unidade: 'KG',
    observacao: '',
    ordem: 1
  }, {
    id: 2,
    componente_base_id: 102,
    produto_id: 102,
    descricao: 'Açúcar',
    quantidade: 5,
    unidade: 'KG',
    observacao: '',
    ordem: 2
  }],
  etapas: [{ id: 1, ordem: 1, titulo: 'Misturar', descricao: 'Mexer', tempo_minutos: 5, observacao: '' }],
  informacoes: [{ id: 1, ordem: 1, titulo: 'Temperatura', valor: '4 C' }]
};

const versaoRascunho = {
  ...versaoBase,
  id: 9,
  numero_versao: 2,
  estado: 'EM_EDICAO',
  componentes: versaoBase.componentes.map((item) => ({ ...item, id: 2, quantidade: 12 }))
};

const vinculo = {
  id: 33,
  produto_id: 201,
  produto_codigo: 'P-201',
  produto_nome: 'Picolé de uva',
  versao_id: 8,
  numero_versao: 1,
  versao_estado: 'PUBLICADA',
  ultima_versao_id: 9,
  ultima_versao: 2,
  politica_atualizacao: 'APROVACAO_INDIVIDUAL',
  estado_atualizacao: 'PENDENTE',
  revisao_id: 55,
  ativo: true
};

const ficha = {
  id: 5,
  codigo: 'PAD-05',
  nome: 'Base cremosa',
  ativa: true,
  tipo: 'SABOR',
  ficha_tradicional_id: 77,
  ficha_tradicional: { id: 77, codigo: 'FT-77', nome: 'Ficha tradicional', revisao_atual: 'rev-77' },
  atualizacao_origem_disponivel: false,
  versoes: [versaoRascunho, { ...versaoBase }],
  vinculos: [vinculo]
};

const fichaTradicionalDetalhe = {
  id: 77,
  codigo: 'FT-77',
  nome: 'Ficha tradicional',
  ativa: true,
  updated_at: '2026-11-18 10:00:00',
  rendimento_quantidade: 100,
  rendimento_unidade: 'UN',
  observacoes: 'Resfriar antes de usar',
  componentes: [
    { id: 1, ordem: 1, produto_id: 101, descricao: 'Leite em pó', quantidade: 10, unidade: 'KG', observacao: '' },
    { id: 2, ordem: 2, produto_id: 102, descricao: 'Açúcar', quantidade: 5, unidade: 'KG', observacao: '' }
  ],
  etapas: [{ id: 1, ordem: 1, titulo: 'Misturar', descricao: 'Mexer', tempo_minutos: 5, observacao: '' }],
  informacoes: [{ id: 1, ordem: 1, titulo: 'Temperatura', valor: '4 C' }]
};

const revisao = {
  id: 55,
  vinculo_id: 33,
  produto_id: 201,
  produto_nome: 'Picolé de uva',
  versao_anterior_id: 8,
  versao_anterior: 1,
  versao_nova_id: 9,
  versao_nova: 2,
  versao_atual_id: 8,
  estado: 'PENDENTE',
  vinculo_ativo: true,
  justificativa: ''
};

const ajustes = [{
  id: 12,
  componente_base_id: 101,
  produto_id: 101,
  operacao: 'SUBSTITUIR',
  quantidade: 8,
  unidade: 'KG',
  justificativa: 'Exceção individual'
}];

function fakeRequest() {
  const callbacks = { done: [], fail: [], always: [] };
  let resultado = null;
  let settled = false;
  let failed = false;
  const request = {
    done(callback) {
      callbacks.done.push(callback);
      if (settled && !failed) callback(resultado);
      return request;
    },
    fail(callback) {
      callbacks.fail.push(callback);
      if (settled && failed) callback(resultado);
      return request;
    },
    always(callback) {
      callbacks.always.push(callback);
      if (settled) callback(resultado);
      return request;
    },
    resolve(value) {
      if (settled) return;
      settled = true;
      resultado = value;
      callbacks.done.forEach((callback) => callback(value));
      callbacks.always.forEach((callback) => callback(value));
    },
    reject(value) {
      if (settled) return;
      settled = true;
      failed = true;
      resultado = value;
      callbacks.fail.forEach((callback) => callback(value));
      callbacks.always.forEach((callback) => callback(value));
    }
  };
  return request;
}

function mount(opcoes = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="page-content"></div></body></html>', {
    url: 'http://localhost/erp/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const chamadas = [];
  const notificacoes = [];
  let fichaAtual = ficha;
  window.API_URL = '/api';
  window.localStorage.setItem('token', 'token-de-teste');
  window.confirm = () => true;
  window.showNotification = (mensagem, tipo) => notificacoes.push({ mensagem, tipo });
  window.$ = (seletor) => ({
    html(conteudo) {
      window.document.querySelector(seletor).innerHTML = conteudo;
      return this;
    }
  });

  function respostaPara(chamada) {
    const url = new URL(chamada.url, window.location.href);
    const caminho = url.pathname;
    if (chamada.method === 'GET' && caminho.endsWith('/fichas-sabor')) {
      return { success: true, fichas: [{ id: 5, codigo: ficha.codigo, nome: ficha.nome, ativa: true, tipo: 'SABOR', ficha_tradicional_id: 77, ficha_tradicional_codigo: 'FT-77', ficha_tradicional_nome: 'Ficha tradicional', atualizacao_origem_disponivel: false, ultima_versao: 2, produtos_vinculados: 1, vinculos_existentes: 1 }] };
    }
    if (chamada.method === 'GET' && caminho.endsWith('/atualizacoes')) {
      return { success: true, atualizacoes: [revisao] };
    }
    if (chamada.method === 'GET' && caminho.endsWith('/ajustes')) {
      return { success: true, ajustes };
    }
    if (chamada.method === 'GET' && /\/fichas-padrao\/\d+$/.test(caminho)) {
      return { success: true, ficha: fichaAtual };
    }
    if (chamada.method === 'GET' && /\/fichas-sabor\/\d+$/.test(caminho)) {
      return { success: true, ficha: fichaAtual };
    }
    if (chamada.method === 'GET' && caminho.endsWith('/produtos-produzidos')) {
      return { success: true, produtos: [{ id: 301, codigo: 'P-301', nome: 'Picolé morango', unidade: 'UN' }] };
    }
    if (chamada.method === 'GET' && caminho.endsWith('/insumos')) {
      return { success: true, insumos: [{ id: 103, codigo: 'I-103', nome: 'Morango', unidade: 'KG' }] };
    }
    if (chamada.method === 'GET' && caminho.endsWith('/fichas')) {
      return { success: true, fichas: [{ id: 77, codigo: 'FT-77', nome: 'Ficha tradicional', ativa: true, componentes: 2, etapas: 1, informacoes: 0 }] };
    }
    if (chamada.method === 'GET' && /\/fichas\/77$/.test(caminho)) {
      return { success: true, ficha: fichaTradicionalDetalhe };
    }
    if (chamada.method === 'POST' && caminho.endsWith('/fichas-padrao')) return { success: true, ficha };
    if (chamada.method === 'POST' && caminho.endsWith('/fichas-sabor')) {
      fichaAtual = {
        ...ficha,
        codigo: chamada.data.codigo,
        nome: chamada.data.nome,
        vinculos: [{
          ...vinculo,
          produto_id: Number(chamada.data.produto_id),
          produto_codigo: 'P-301',
          produto_nome: 'Picolé morango',
          versao_id: versaoRascunho.id,
          versao_estado: 'EM_EDICAO'
        }]
      };
      return { success: true, ficha: fichaAtual };
    }
    if (chamada.method === 'POST' && caminho.endsWith('/versoes')) return { success: true, versao: versaoRascunho };
    if (chamada.method === 'PUT' && /\/versoes\/\d+$/.test(caminho)) return { success: true, versao: versaoRascunho };
    if (chamada.method === 'POST' && caminho.endsWith('/publicar')) return { success: true, versao: { ...versaoRascunho, estado: 'PUBLICADA' } };
    if (chamada.method === 'POST' && caminho.endsWith('/vinculos')) return { success: true, vinculo: { ...vinculo, produto_id: 301, versao_id: 8 } };
    if (chamada.method === 'PUT' && caminho.includes('/ajustes/')) return { success: true, ajuste: { ...ajustes[0], operacao: chamada.data.operacao } };
    if (chamada.method === 'POST' && caminho.endsWith('/ajustes')) return { success: true, ajuste: { id: 15, operacao: chamada.data.operacao } };
    if (chamada.method === 'DELETE' && caminho.includes('/ajustes/')) return { success: true, removido: true };
    if (chamada.method === 'PUT' && caminho.includes('/atualizacoes/')) {
      return {
        success: true,
        revisao: { ...revisao, estado: chamada.data.decisao === 'APROVAR' ? 'APROVADO' : 'MANTER_ANTERIOR' }
      };
    }
    if (chamada.method === 'PUT' && /\/fichas-padrao\/\d+$/.test(caminho)) return { success: true, ficha };
    if (chamada.method === 'PATCH' && /\/fichas-padrao\/\d+\/status$/.test(caminho)) {
      return { success: true, ficha: { ...ficha, ativa: chamada.data.ativa } };
    }
    if (chamada.method === 'DELETE' && /\/fichas-padrao\/\d+$/.test(caminho)) return { success: true, removida: true };
    if (chamada.method === 'PATCH' && /\/fichas\/\d+\/status$/.test(caminho)) {
      return { success: true, ficha: { id: 77, ativa: chamada.data.ativa } };
    }
    if (chamada.method === 'DELETE' && /\/fichas\/\d+$/.test(caminho)) return { success: true, removida: true, id: 77 };
    if (chamada.method === 'PUT' && caminho.includes('/vinculos/')) return { success: true, vinculo: { ...vinculo, ativo: chamada.data.ativo } };
    return { success: true, fichas: [], produtos: [], insumos: [] };
  }

  window.$.ajax = (opcoesAjax) => {
    const chamada = {
      url: opcoesAjax.url,
      method: opcoesAjax.method,
      data: opcoesAjax.data ? JSON.parse(opcoesAjax.data) : undefined
    };
    const request = fakeRequest();
    chamada.request = request;
    chamadas.push(chamada);
    if (opcoes.failRequest && opcoes.failRequest(chamada)) {
      request.reject(opcoes.failRequest(chamada));
    } else if (!opcoes.holdMutations || chamada.method === 'GET') {
      request.resolve(opcoes.respond ? opcoes.respond(chamada, respostaPara) : respostaPara(chamada));
    }
    return request;
  };

  window.eval(script);
  window.loadFichasTecnicas();
  return {
    window,
    document: window.document,
    chamadas,
    notificacoes,
    dom,
    atualizarFicha(novaFicha) {
      fichaAtual = novaFicha;
    }
  };
}

function clicar(window, seletor) {
  const botao = window.document.querySelector(seletor);
  assert.ok(botao, `Elemento não encontrado: ${seletor}`);
  botao.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return botao;
}

function enviar(window, seletor) {
  const form = window.document.querySelector(seletor);
  assert.ok(form, `Formulário não encontrado: ${seletor}`);
  const evento = new window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(evento);
  return { form, evento };
}

function abrirFichaPadrao(window) {
  clicar(window, '[data-ft-tab="padrao"]');
  clicar(window, '[data-ft-padrao-acao="abrir-ficha"]');
}

describe('Fichas por sabor — interface e contratos da API', () => {
  it('mantém o fluxo tradicional e carrega fichas por sabor, versões e composição da base', () => {
    const { window, document, chamadas, dom } = mount();
    assert.ok(document.querySelector('#ft-form') === null);
    assert.equal(document.querySelector('#ft-area-legada').hidden, false);
    assert.equal(document.querySelector('#ft-area-padrao').hidden, true);
    assert.ok(chamadas.some((chamada) => chamada.method === 'GET' && chamada.url.endsWith('/fabrica-loja/fichas')));

    clicar(window, '[data-ft-tab="padrao"]');
    assert.equal(document.querySelector('#ft-area-padrao').hidden, false);
    assert.match(document.querySelector('#ft-padrao-tbody').textContent, /PAD-05/);
    assert.match(document.querySelector('#ft-padrao-tbody').textContent, /Ficha tradicional/);
    abrirFichaPadrao(window);
    assert.match(document.querySelector('#ft-padrao-detalhe').textContent, /Versão atual: v1/);
    assert.match(document.querySelector('#ft-padrao-detalhe').textContent, /Versão proposta: v2/);
    assert.ok(document.querySelector('[data-ft-padrao-acao="editar-versao"][data-versao-id="9"]'));
    assert.equal(document.querySelector('[data-ft-padrao-acao="editar-versao"][data-versao-id="8"]'), null);
    assert.match(document.querySelector('#ft-padrao-detalhe').textContent, /utilizam o snapshot integral da versão publicada aprovada individualmente/i);

    clicar(window, '[data-ft-padrao-acao="ver-versao"][data-versao-id="8"]');
    assert.match(document.querySelector('#ft-padrao-versao-conteudo').textContent, /Leite em pó/);
    assert.match(document.querySelector('#ft-padrao-versao-conteudo').textContent, /Misturar/);
    assert.match(document.querySelector('#ft-padrao-versao-conteudo').textContent, /Temperatura/);
    clicar(window, '[data-ft-tab="legada"]');
    assert.equal(document.querySelector('#ft-area-legada').hidden, false);
    clicar(window, '#ft-nova');
    assert.ok(document.querySelector('#ft-form'));
    dom.window.close();
  });

  it('oferece ativar/inativar e permite excluir ficha por sabor com vínculos', () => {
    const padrao = mount();
    clicar(padrao.window, '[data-ft-tab="padrao"]');
    const desativarPadrao = padrao.document.querySelector('[data-ft-padrao-acao="alternar-status"]');
    assert.ok(desativarPadrao);
    assert.equal(desativarPadrao.textContent, 'Inativar');
    const excluirSabor = padrao.document.querySelector('[data-ft-padrao-acao="excluir-ficha"]');
    assert.equal(excluirSabor.disabled, false);
    clicar(padrao.window, '[data-ft-padrao-acao="alternar-status"]');
    assert.ok(padrao.chamadas.some((chamada) =>
      chamada.method === 'PATCH' && chamada.url.endsWith('/fichas-padrao/5/status') && chamada.data.ativa === false
    ));
    clicar(padrao.window, '[data-ft-padrao-acao="excluir-ficha"]');
    assert.ok(padrao.chamadas.some((chamada) =>
      chamada.method === 'DELETE' && chamada.url.endsWith('/fichas-padrao/5')
    ));
    padrao.dom.window.close();

    const semVinculo = mount({
      respond(chamada, respostaPara) {
        const resposta = respostaPara(chamada);
        if (chamada.method === 'GET' && chamada.url.endsWith('/fichas-sabor')) {
          resposta.fichas[0].vinculos_existentes = 0;
          resposta.fichas[0].produtos_vinculados = 0;
        }
        return resposta;
      }
    });
    clicar(semVinculo.window, '[data-ft-tab="padrao"]');
    assert.equal(semVinculo.document.querySelector('[data-ft-padrao-acao="excluir-ficha"]').disabled, false);
    semVinculo.dom.window.close();

    const tradicional = mount();
    assert.ok(tradicional.document.querySelector('[data-ft-status="77"]'));
    assert.ok(tradicional.document.querySelector('[data-ft-excluir="77"]'));
    clicar(tradicional.window, '[data-ft-status="77"]');
    clicar(tradicional.window, '[data-ft-excluir="77"]');
    assert.ok(tradicional.chamadas.some((chamada) =>
      chamada.method === 'PATCH' && chamada.url.endsWith('/fichas/77/status') && chamada.data.ativa === false
    ));
    assert.ok(tradicional.chamadas.some((chamada) =>
      chamada.method === 'DELETE' && chamada.url.endsWith('/fichas/77')
    ));
    tradicional.dom.window.close();
  });

  it('envia a edição de rascunho ao endpoint real e impede duplo envio', () => {
    const { window, document, chamadas, dom } = mount({ holdMutations: true });
    abrirFichaPadrao(window);
    clicar(window, '[data-ft-padrao-acao="editar-versao"][data-versao-id="9"]');
    const componente = document.querySelector('#ft-padrao-componentes [data-ft-linha]');
    componente.querySelector('[data-campo="quantidade"]').value = '14';
    const { form, evento } = enviar(window, '#ft-padrao-form');
    assert.equal(evento.defaultPrevented, true);
    const atualizacoes = chamadas.filter((chamada) =>
      chamada.method === 'PUT' && chamada.url.endsWith('/fichas-padrao/5/versoes/9')
    );
    assert.equal(atualizacoes.length, 1);
    assert.equal(atualizacoes[0].data.componentes[0].produto_id, '101');
    assert.equal(atualizacoes[0].data.componentes[0].quantidade, '14');
    assert.equal(form.querySelector('[data-ft-padrao-salvar]').disabled, true);
    enviar(window, '#ft-padrao-form');
    assert.equal(chamadas.filter((chamada) =>
      chamada.method === 'PUT' && chamada.url.endsWith('/fichas-padrao/5/versoes/9')
    ).length, 1);
    atualizacoes[0].request.resolve({ success: true, versao: { ...versaoRascunho, estado: 'EM_EDICAO' } });
    dom.window.close();
  });

  it('exige produto produzido, salva o vínculo e o recupera ao editar a ficha', () => {
    const { window, document, chamadas, dom, atualizarFicha } = mount({ holdMutations: true });
    clicar(window, '[data-ft-tab="padrao"]');
    clicar(window, '[data-ft-padrao-acao="nova-ficha"]');
    const editorForm = document.getElementById('ft-padrao-form');
    assert.match(editorForm.textContent, /pode ser personalizada sem alterar a ficha tradicional/);
    assert.ok(editorForm.querySelector('#ft-padrao-produto-id'));
    assert.ok(editorForm.querySelector('#ft-padrao-produto-nome'));
    assert.ok(editorForm.textContent.indexOf('Produto produzido associado') < editorForm.textContent.indexOf('Ficha tradicional de origem'));
    document.getElementById('ft-padrao-codigo').value = 'PAD-NEW';
    document.getElementById('ft-padrao-nome').value = 'Base nova';
    document.getElementById('ft-sabor-origem').value = '77';
    document.getElementById('ft-sabor-origem').dispatchEvent(new window.Event('change', { bubbles: true }));
    document.getElementById('ft-padrao-rendimento').value = '100';
    document.getElementById('ft-padrao-rendimento-unidade').value = 'UN';
    const componente = document.querySelector('#ft-padrao-componentes [data-ft-linha]');
    componente.querySelector('[data-campo="produto_id"]').value = '101';
    componente.querySelector('[data-campo="quantidade"]').value = '12';
    componente.querySelector('[data-campo="unidade"]').value = 'KG';
    enviar(window, '#ft-padrao-form');
    assert.equal(chamadas.some((chamada) =>
      chamada.method === 'POST' && chamada.url.endsWith('/fabrica-loja/fichas-sabor')
    ), false);
    const buscaProduto = document.getElementById('ft-padrao-produto-nome');
    buscaProduto.value = 'Picolé';
    buscaProduto.dispatchEvent(new window.Event('input', { bubbles: true }));
    const sugestaoProduto = document.querySelector('#ft-padrao-editor .ft-sugestoes button');
    assert.ok(sugestaoProduto);
    sugestaoProduto.click();
    assert.equal(document.getElementById('ft-padrao-produto-id').value, '301');
    assert.equal(buscaProduto.value, 'P-301 — Picolé morango');
    const { form } = enviar(window, '#ft-padrao-form');
    const criacao = chamadas.find((chamada) => chamada.method === 'POST' && chamada.url.endsWith('/fabrica-loja/fichas-sabor'));
    assert.ok(criacao);
    assert.equal(criacao.data.codigo, 'PAD-NEW');
    assert.equal(criacao.data.ficha_tradicional_id, '77');
    assert.equal(criacao.data.produto_id, '301');
    assert.ok(chamadas.some((chamada) =>
      chamada.method === 'GET' && chamada.url.includes('/produtos-produzidos?excluir_produto_linha=1&q=Picol%C3%A9')
    ));
    assert.equal(criacao.data.componentes.length, 2);
    assert.equal(criacao.data.etapas.length, 1);
    assert.deepEqual(criacao.data.informacoes, [{ titulo: 'Temperatura', valor: '4 C' }]);
    const fichaCriada = {
      ...ficha,
      codigo: 'PAD-NEW',
      nome: 'Base nova',
      vinculos: [{
        ...vinculo,
        produto_id: 301,
        produto_codigo: 'P-301',
        produto_nome: 'Picolé morango',
        versao_estado: 'EM_EDICAO'
      }]
    };
    atualizarFicha(fichaCriada);
    criacao.request.resolve({ success: true, ficha: fichaCriada });
    assert.equal(form.closest('#ft-padrao-editor').hidden, true);
    clicar(window, '[data-ft-padrao-acao="editar-ficha"]');
    assert.equal(document.getElementById('ft-padrao-produtos-associados').value, 'P-301 — Picolé morango (#301)');
    dom.window.close();
  });

  it('associa produto a versão publicada sem disponibilizar ajustes individuais', () => {
    const { window, document, chamadas, dom } = mount();
    abrirFichaPadrao(window);
    clicar(window, '[data-ft-padrao-acao="novo-vinculo"]');
    const busca = document.getElementById('ft-padrao-produto-nome');
    busca.value = 'Picolé';
    busca.dispatchEvent(new window.Event('input', { bubbles: true }));
    const sugestao = document.querySelector('#ft-padrao-editor .ft-sugestoes button');
    assert.ok(sugestao);
    sugestao.click();
    assert.equal(document.getElementById('ft-padrao-produto-id').value, '301');
    document.getElementById('ft-padrao-vinculo-versao').value = '8';
    enviar(window, '#ft-padrao-form');
    const associacao = chamadas.find((chamada) => chamada.method === 'POST' && chamada.url.endsWith('/fichas-padrao/5/vinculos'));
    assert.deepEqual(associacao.data, { produto_id: '301', versao_id: '8' });

    abrirFichaPadrao(window);
    assert.equal(document.querySelector('[data-ft-padrao-acao="ajustes"]'), null);
    assert.equal(document.querySelector('[data-ft-padrao-acao="editar-ajuste"]'), null);
    assert.equal(document.querySelector('[data-ft-padrao-acao="remover-ajuste"]'), null);
    assert.equal(document.getElementById('ft-padrao-ajuste-form'), null);
    assert.equal(chamadas.some((chamada) => chamada.url.includes('/ajustes')), false);
    dom.window.close();
  });

  it('confirma cada decisão e só atualiza a tela após resposta válida do servidor', () => {
    const { window, document, chamadas, dom } = mount({ holdMutations: true });
    abrirFichaPadrao(window);
    const aprovar = document.querySelector('[data-ft-padrao-acao="decidir"][data-decisao="APROVAR"]');
    const confirmacoes = [];
    window.confirm = (mensagem) => {
      confirmacoes.push(mensagem);
      return confirmacoes.length > 1;
    };
    aprovar.click();
    assert.equal(chamadas.some((chamada) => chamada.url.endsWith('/atualizacoes/55')), false);
    window.confirm = (mensagem) => {
      confirmacoes.push(mensagem);
      return true;
    };
    const justificativa = document.querySelector('[data-ft-padrao-justificativa="55"]');
    justificativa.value = 'Aprovado para este produto';
    document.querySelector('[data-ft-padrao-acao="decidir"][data-decisao="APROVAR"]').click();
    const decisao = chamadas.find((chamada) => chamada.method === 'PUT' && chamada.url.endsWith('/fichas-padrao/atualizacoes/55'));
    assert.deepEqual(decisao.data, { decisao: 'APROVAR', justificativa: 'Aprovado para este produto' });
    assert.match(document.querySelector('#ft-padrao-detalhe').textContent, /Pendente de decisão/);
    decisao.request.resolve({ success: true, revisao: { ...revisao, estado: 'APROVADO' } });
    assert.ok(confirmacoes.some((mensagem) => /não afetará outros produtos/.test(mensagem)));
    assert.ok(chamadas.some((chamada) => chamada.method === 'GET' && chamada.url.endsWith('/fichas-sabor/5')));
    dom.window.close();
  });

  it('registra a rejeição como manutenção individual da versão anterior', () => {
    const { window, document, chamadas, dom } = mount();
    abrirFichaPadrao(window);
    clicar(window, '[data-ft-padrao-acao="decidir"][data-decisao="MANTER_ANTERIOR"]');
    const decisao = chamadas.find((chamada) => chamada.method === 'PUT' && chamada.url.endsWith('/fichas-padrao/atualizacoes/55'));
    assert.deepEqual(decisao.data, { decisao: 'MANTER_ANTERIOR', justificativa: '' });
    assert.match(document.querySelector('#ft-padrao-detalhe').textContent, /Pendente de decisão/);
    dom.window.close();
  });

  it('exibe erros de unidade e autenticação sem sucesso aparente', () => {
    const semAutenticacao = mount({
      failRequest: (chamada) => {
        if (chamada.method === 'GET' && chamada.url.endsWith('/fichas-sabor')) {
          return { status: 401, responseJSON: { error: 'Sessão não autorizada.' } };
        }
        return null;
      }
    });
    clicar(semAutenticacao.window, '[data-ft-tab="padrao"]');
    assert.match(semAutenticacao.document.getElementById('ft-padrao-erro').textContent, /Sessão não autorizada/);
    semAutenticacao.dom.window.close();

    const unidade = mount({
      failRequest: (chamada) => chamada.method === 'POST' && chamada.url.endsWith('/versoes/9/publicar')
        ? { status: 422, responseJSON: { codigo: 'UNIDADE_NAO_COMPROVADA', error: 'Unidade incompatível: conversão não comprovada.' } }
        : null
    });
    abrirFichaPadrao(unidade.window);
    clicar(unidade.window, '[data-ft-padrao-acao="publicar"][data-versao-id="9"]');
    assert.match(unidade.document.getElementById('ft-padrao-erro').textContent, /Unidade incompatível/);
    unidade.dom.window.close();
  });
});
