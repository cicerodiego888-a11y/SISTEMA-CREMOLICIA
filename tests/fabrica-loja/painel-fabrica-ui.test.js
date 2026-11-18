'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'frontend/erp/js/painel-fabrica.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend/css/fichas-tecnicas.css'), 'utf8');

function painelDados(overrides = {}) {
  return {
    periodo: 'hoje',
    resumo: {
      necessidades_abertas: 11,
      necessidades_parciais: 12,
      necessidades_atendidas: 13,
      ops_rascunho: 23,
      ops_planejadas: 21,
      ops_em_producao: 22,
      ops_concluidas: 24,
      ops_canceladas: 25,
      produzido: 41,
      perdido: 4,
      execucoes: 6,
      ops_concluidas_periodo: 9
    },
    estoque_fabrica: {
      insumos: 2,
      produzidos: 3,
      itens_insumo: [{ produto_nome: 'Leite', quantidade: 8, unidade: 'L' }],
      itens_produzido: [{ produto_nome: 'Picolé', quantidade: 5, unidade: 'UN' }]
    },
    transferencias: { rascunhos: 1, confirmadas: 2, canceladas: 3 },
    necessidades_pendentes: [{
      id: 501, codigo: 'NEC-501', origem_nome: 'Loja Centro', solicitado: 10,
      produzido: 4, restante: 6, status: 'PARCIALMENTE_ATENDIDA'
    }],
    ordens_pendentes: [{
      id: 601, codigo: 'OP-601', produto_nome: 'Picolé', planejado: 10,
      produzido: 4, status: 'EM_PRODUCAO'
    }],
    ordens_abaixo: [{
      id: 602, codigo: 'OP-602', produto_nome: 'Sorvete', planejado: 8,
      produzido: 6, perdido: 2, status: 'CONCLUIDA'
    }],
    producao_produtos: [{ produto_nome: 'Picolé', produzido: 41, unidade: 'UN' }],
    transferencias_pendentes: [{
      id: 701, codigo: 'TRF-701', itens: 2, origem_local: 'FABRICA',
      destino_local: 'LOJA', status: 'RASCUNHO'
    }],
    transferencias_recentes: [{
      id: 702, codigo: 'TRF-702', confirmada_em: '2026-10-27 10:00',
      produto_nome: 'Picolé', quantidade: 5, unidade: 'UN'
    }],
    atencoes: [],
    ...overrides
  };
}

function montar() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="page-content"></div></body></html>', {
    url: 'http://localhost/erp/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.API_URL = '/api';
  const chamadas = [];
  window.$ = (seletor) => ({
    html(conteudo) {
      window.document.querySelector(seletor).innerHTML = conteudo;
      return this;
    }
  });
  window.$.ajax = ({ url }) => {
    chamadas.push(url);
    const periodo = new URL(url, window.location.href).searchParams.get('periodo');
    const requisicao = {
      done(callback) {
        callback({ painel: painelDados({ periodo }) });
        return requisicao;
      },
      fail() {
        return requisicao;
      }
    };
    return requisicao;
  };
  window.eval(script);
  return { window, chamadas, document: window.document, dom };
}

function clicar(window, seletor) {
  const elemento = window.document.querySelector(seletor);
  assert.ok(elemento, `Elemento não encontrado: ${seletor}`);
  elemento.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return elemento;
}

describe('Painel da Fábrica — apresentação e interações', () => {
  it('mostra três indicadores sem reinterpretar contagens ou o período da produção', () => {
    const { window, document, dom } = montar();
    const html = window.pfHtml(painelDados());
    document.body.innerHTML = html;

    assert.equal(document.querySelectorAll('.pf-indicadores .pf-card').length, 3);
    const indicadores = [...document.querySelectorAll('.pf-indicadores .pf-card')];
    assert.deepEqual(indicadores.map((item) => item.textContent.replace(/\s+/g, ' ').trim()), [
      'Necessidades abertas 11', 'Em andamento 22', 'Produzido hoje 41'
    ]);

    document.body.innerHTML = window.pfHtml(painelDados({ periodo: '7' }));
    assert.match(document.querySelector('.pf-indicadores').textContent, /Produzido em 7 dias/);
    document.body.innerHTML = window.pfHtml(painelDados({ periodo: '30' }));
    assert.match(document.querySelector('.pf-indicadores').textContent, /Produzido em 30 dias/);

    const contagens = document.querySelectorAll('.pf-contagem');
    const texto = [...contagens].map((item) => item.textContent.replace(/\s+/g, ' ').trim());
    [
      'Abertas11', 'Parciais12', 'Atendidas13', 'Rascunho23', 'Planejada21',
      'Em produção22', 'Concluída24', 'Cancelada25',
      'Perdido em 30 dias4', 'Execuções6', 'OPs concluídas9',
      'Com saldo na Fábrica2 itens', 'Com saldo na Fábrica3 itens',
      'Rascunhos1', 'Confirmadas2', 'Canceladas3'
    ].forEach((valor) => assert.equal(texto.includes(valor), true, `Contagem ausente: ${valor}`));
    assert.deepEqual(
      [...document.querySelectorAll('.pf-resumo-grupos > .pf-resumo-grupo > h4')].map((titulo) => titulo.textContent),
      ['Necessidades', 'Ordens de produção', 'Produção', 'Estoque e transferências']
    );
    assert.equal(document.querySelectorAll('.pf-resumo-transferencias .pf-contagem').length, 3);
    assert.match(document.body.textContent, /Picolé/);
    assert.match(document.body.textContent, /Leite/);
    assert.match(document.body.textContent, /Produção do período/);
    assert.equal(document.querySelectorAll('.pf-indicadores button').length, 0);
    assert.equal(document.querySelectorAll('[data-pf-atendimento="ABERTA"]').length, 1);
    assert.equal(document.querySelectorAll('[data-pf-op-status="EM_PRODUCAO"]').length, 1);

    dom.window.close();
  });

  it('mantém contagens zeradas e mensagens de estoque vazio sem quantidades físicas inventadas', () => {
    const { window, document, dom } = montar();
    const resumoZerado = Object.fromEntries(
      Object.keys(painelDados().resumo).map((chave) => [chave, 0])
    );
    document.body.innerHTML = window.pfHtml(painelDados({
      resumo: resumoZerado,
      estoque_fabrica: { insumos: 0, produzidos: 0, itens_insumo: [], itens_produzido: [] },
      transferencias: { rascunhos: 0, confirmadas: 0, canceladas: 0 },
      producao_produtos: [],
      transferencias_recentes: []
    }));

    const grupos = [...document.querySelectorAll('.pf-resumo-grupos > .pf-resumo-grupo')];
    assert.equal(grupos.length, 4);
    grupos.slice(0, 3).forEach((grupo) => {
      assert.ok([...grupo.querySelectorAll('.pf-contagem strong')].every((valor) => valor.textContent === '0'));
    });
    const contagensEstoque = document.querySelectorAll('.pf-resumo-estoque .pf-contagem strong');
    assert.deepEqual([...contagensEstoque].map((valor) => valor.textContent), ['0 itens', '0 itens']);
    assert.match(document.querySelector('.pf-resumo-estoque:first-child').textContent, /Nenhum insumo com saldo na fábrica\./);
    assert.match(document.querySelector('.pf-resumo-estoque:nth-child(2)').textContent, /Nenhum produto produzido com saldo na fábrica\./);
    assert.deepEqual(
      [...document.querySelectorAll('.pf-resumo-transferencias .pf-contagem strong')].map((valor) => valor.textContent),
      ['0', '0', '0']
    );
    assert.equal(document.querySelectorAll('.pf-lista-dados').length, 0);

    dom.window.close();
  });

  it('concentra pendências numa seção e identifica OP planejada como produção ainda não iniciada', () => {
    const { window, document, dom } = montar();
    const vazio = painelDados({
      necessidades_pendentes: [],
      ordens_pendentes: [],
      ordens_abaixo: [],
      transferencias_pendentes: [],
      transferencias_recentes: [],
      atencoes: []
    });
    document.body.innerHTML = window.pfHtml(vazio);
    assert.equal(document.querySelectorAll('.pf-ocorrencia').length, 0);
    assert.equal(document.querySelectorAll('.pf-secao--atencao-ativa').length, 0);
    assert.equal(document.querySelectorAll('#pf-atencao-titulo').length, 1);
    assert.match(document.body.textContent, /Nenhuma pendência operacional/);

    const umaOrdem = painelDados({
      necessidades_pendentes: [],
      ordens_pendentes: [{
        id: 604, codigo: 'OP-604', produto_nome: 'Picolé', planejado: 10,
        produzido: 0, status: 'PLANEJADA'
      }],
      ordens_abaixo: [],
      transferencias_pendentes: [],
      transferencias_recentes: []
    });
    document.body.innerHTML = window.pfHtml(umaOrdem);
    assert.equal(document.querySelectorAll('.pf-ocorrencia').length, 1);
    assert.equal(document.querySelector('[data-pf-op]').getAttribute('data-pf-op'), '604');
    assert.match(document.querySelector('.pf-ocorrencia').textContent, /Picolé/);
    assert.match(document.querySelector('.pf-ocorrencia').textContent, /Planejado: 10/);
    assert.match(document.querySelector('.pf-ocorrencia').textContent, /Falta iniciar a produção/);
    assert.match(document.querySelector('.pf-ocorrencia').textContent, /Planejada/);
    assert.equal(document.querySelectorAll('.pf-ocorrencia [data-pf-op="604"]').length, 1);

    const dados = painelDados({
      atencoes: [{ texto: '2 necessidades ainda possuem produção pendente.' }],
      necessidades_pendentes: [
        painelDados().necessidades_pendentes[0],
        { ...painelDados().necessidades_pendentes[0], id: 502, codigo: 'NEC-502' }
      ],
      ordens_pendentes: [
        painelDados().ordens_pendentes[0],
        { id: 603, codigo: 'OP-603', produto_nome: 'Sorvete', planejado: 8, produzido: 0, status: 'PLANEJADA' },
      ]
    });
    document.body.innerHTML = window.pfHtml(dados);
    assert.equal(document.querySelectorAll('.pf-ocorrencia').length, 6);
    assert.equal(document.querySelectorAll('.pf-secao--atencao').length, 1);
    assert.equal(document.querySelectorAll('[data-pf-necessidade="501"]').length, 1);
    assert.equal(document.querySelectorAll('[data-pf-op="601"]').length, 1);
    assert.equal(document.querySelectorAll('[data-pf-op="602"]').length, 1);
    assert.match(document.body.textContent, /2 necessidades ainda possuem produção pendente/);
    assert.match(document.body.textContent, /NEC-501/);
    assert.match(document.body.textContent, /NEC-502/);
    assert.match(document.body.textContent, /OP-601/);
    assert.match(document.body.textContent, /OP-603/);
    assert.match(document.body.textContent, /Solicitado: 10/);
    assert.match(document.body.textContent, /Restante: 6/);
    assert.match(document.body.textContent, /Produto não informado pelo painel/);
    assert.match(document.body.textContent, /Ver necessidade/);
    assert.match(document.body.textContent, /Continuar/);
    assert.match(document.body.textContent, /Ver transferência/);

    dom.window.close();
  });

  it('mantém filtros, atualização e navegação de cada ação com os destinos atuais', () => {
    const { window, chamadas, document, dom } = montar();
    const navegacoes = [];
    window.loadPage = (pagina) => navegacoes.push(pagina);
    window.loadPainelFabrica();

    clicar(window, '[data-pf-periodo="7"]');
    assert.match(chamadas[chamadas.length - 1], /periodo=7$/);
    assert.equal(document.querySelector('[data-pf-periodo="7"]').getAttribute('aria-pressed'), 'true');
    clicar(window, '[data-pf-periodo="30"]');
    assert.match(chamadas[chamadas.length - 1], /periodo=30$/);
    assert.equal(document.querySelector('[data-pf-periodo="30"]').getAttribute('aria-pressed'), 'true');
    clicar(window, '[data-pf-periodo="hoje"]');
    assert.match(chamadas[chamadas.length - 1], /periodo=hoje$/);
    clicar(window, '#pf-atualizar');
    assert.match(chamadas[chamadas.length - 1], /periodo=hoje$/);

    clicar(window, '[data-pf-atendimento="ABERTA"]');
    assert.equal(window._npFiltroAtendimento, 'ABERTA');
    clicar(window, '[data-pf-atendimento="PARCIALMENTE_ATENDIDA"]');
    clicar(window, '[data-pf-atendimento="ATENDIDA"]');
    clicar(window, '[data-pf-necessidade="501"]');
    assert.equal(window._npAbrirId, '501');

    ['PLANEJADA', 'EM_PRODUCAO', 'RASCUNHO', 'CONCLUIDA', 'CANCELADA'].forEach((status) => {
      clicar(window, `[data-pf-op-status="${status}"]`);
      assert.equal(window._opFiltroStatus, status);
    });
    clicar(window, '[data-pf-op="601"]');
    assert.equal(window._opAbrirId, '601');
    clicar(window, '[data-pf-op="602"]');

    clicar(window, '[data-pf-transferencia="701"]');
    assert.equal(window._trfAbrirId, '701');
    assert.equal(window._trfEditar, true);
    clicar(window, '[data-pf-transferencia="702"]');
    assert.equal(window._trfAbrirId, '702');
    assert.equal(window._trfEditar, false);

    const acoes = [...document.querySelectorAll('.pf-acoes [data-pf-acao]')];
    assert.deepEqual(acoes.map((botao) => botao.getAttribute('data-pf-acao')), [
      'necessidade', 'ordem', 'transferencia', 'estoque'
    ]);
    assert.deepEqual(acoes.map((botao) => botao.textContent.trim()), [
      'Nova necessidade',
      'Nova ordem de produção',
      'Transferir para Loja',
      'Consultar estoque'
    ]);
    const rotas = [
      ['necessidade', 'necessidades-producao'],
      ['ordem', 'ordens-producao'],
      ['transferencia', 'transferencias'],
      ['estoque', 'produtos'],
      ['produzir', 'necessidades-producao'],
      ['necessidades', 'necessidades-producao'],
      ['ordens', 'ordens-producao']
    ];
    rotas.forEach(([acao, rota]) => {
      clicar(window, `[data-pf-acao="${acao}"]`);
      assert.equal(navegacoes[navegacoes.length - 1], rota);
    });
    assert.equal(window._npNova, true);
    assert.equal(window._opNova, true);
    assert.equal(window._trfNova, true);
    const produtos = fs.readFileSync(path.join(root, 'frontend/erp/js/produtos.js'), 'utf8');
    assert.match(produtos, /function gerarRelatorioEstoque\(\)/);
    assert.match(produtos, /Relatório de estoque/);

    dom.window.close();
  });

  it('mantém contraste e compõe o layout em telas estreitas sem coleção de cards', () => {
    const { window, document, dom } = montar();
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
    document.body.innerHTML = `<div class="ft-pagina">${window.pfHtml(painelDados())}</div>`;

    const indicador = document.querySelector('.pf-indicadores .pf-card');
    const indicadorStyle = window.getComputedStyle(indicador);
    assert.equal(indicadorStyle.backgroundColor, 'rgb(248, 250, 252)');
    assert.equal(indicadorStyle.borderLeftColor, 'rgb(203, 213, 225)');
    const lista = document.querySelector('.pf-linha');
    assert.ok(lista);
    assert.match(styles, /\.ft-pagina \.pf-linha\s*\{[^}]*border-bottom: 1px solid #e2e8f0/s);
    assert.match(styles, /\.ft-pagina \.pf-indicadores\s*\{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(styles, /\.ft-pagina \.pf-resumo-grupos\s*\{\s*display: grid/);
    assert.match(styles, /\.ft-pagina \.pf-resumo-grupo\s*\{[^}]*background: #f8fafc/s);
    assert.match(styles, /\.ft-pagina \.pf-resumo-fabrica \.pf-contagem\s*\{[^}]*flex-direction: column/s);
    assert.match(styles, /\.ft-pagina \.pf-resumo-transferencias \.pf-contagens\s*\{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(styles, /@media \(max-width: 520px\)/);
    assert.match(styles, /\.ft-pagina \.pf-indicadores\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(styles, /\.ft-pagina \.pf-acoes\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(styles, /\.ft-pagina \.pf-resumo-grupos\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(styles, /\.ft-pagina \.pf-estoques\s*\{\s*grid-template-columns: 1fr/);
    assert.match(styles, /\.ft-pagina \.pf-ocorrencia\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);

    dom.window.close();
  });
});
