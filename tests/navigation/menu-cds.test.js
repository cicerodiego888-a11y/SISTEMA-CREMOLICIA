'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const menuHtml = fs.readFileSync(path.join(root, 'frontend/erp/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'frontend/erp/js/app.js'), 'utf8');
const accessControlJs = fs.readFileSync(path.join(root, 'frontend/shared/js/access-control.js'), 'utf8');
const coreJs = fs.readFileSync(path.join(root, 'frontend/shared/js/core.js'), 'utf8');
const navigationJs = fs.readFileSync(path.join(root, 'frontend/erp/js/navegacao-config-comercial.js'), 'utf8');

function menuDom() {
  return new JSDOM(menuHtml).window.document;
}

function idsPorGrupo(documento) {
  const grupos = {};
  documento.querySelectorAll('#sidebar-nav > .sidebar-nav-group').forEach((grupo) => {
    const nome = grupo.textContent.trim();
    grupos[nome] = [];
    let irmao = grupo.nextElementSibling;
    while (irmao && !irmao.classList.contains('sidebar-nav-group') &&
      !irmao.classList.contains('sidebar-nav-separator')) {
      if (irmao.matches('.nav-item') && irmao.querySelector('[data-page]')) {
        grupos[nome].push(irmao.querySelector('[data-page]').getAttribute('data-page'));
      } else if (irmao.matches('.nav-item') && irmao.id === 'nav-abrir-pdv') {
        grupos[nome].push('Abrir PDV');
      }
      irmao = irmao.nextElementSibling;
    }
  });
  return grupos;
}

describe('Menu principal CDS', () => {
  it('mantém os itens nos grupos definidos e remove os atalhos duplicados/legados', () => {
    const document = menuDom();
    const grupos = idsPorGrupo(document);

    assert.deepEqual(Object.keys(grupos), [
      'Início',
      'Loja',
      'Fábrica',
      'Compras e Entradas',
      'Financeiro',
      'Fiscal',
      'Cadastros',
      'Relatórios',
      'Administração e Configurações'
    ]);
    assert.deepEqual(grupos['Início'], ['dashboard']);
    assert.deepEqual(grupos['Loja'], [
      'comercial-dashboard', 'Abrir PDV', 'vendas', 'pedidos', 'comercial-consignacao-nova',
      'comercial-consignacao-lista', 'comercial-acertos', 'comercial-perdas',
      'comercial-cortesias', 'comercial-recomendacoes', 'comercial-playbooks', 'caixa'
    ]);
    assert.deepEqual(grupos['Fábrica'], [
      'painel-fabrica', 'insumos', 'linhas-produtos', 'fichas-tecnicas',
      'necessidades-producao', 'ordens-producao', 'transferencias'
    ]);
    assert.deepEqual(grupos['Compras e Entradas'], ['central-entradas', 'compras']);
    assert.deepEqual(grupos['Financeiro'], [
      'financeiro', 'comercial-conta-corrente', 'comercial-pendencias'
    ]);
    assert.deepEqual(grupos['Fiscal'], [
      'fiscal', 'fiscal-nfe-nova', 'fiscal-nfe', 'fiscal-nfe-monitor',
      'fiscal-nfe-fila', 'fiscal-nfe-diagnostico', 'fiscal-contabil'
    ]);
    assert.deepEqual(grupos['Cadastros'], [
      'clientes', 'comercial-clientes', 'fornecedores', 'produtos', 'categorias'
    ]);
    assert.deepEqual(grupos['Relatórios'], ['comercial-relatorios']);
    assert.deepEqual(grupos['Administração e Configurações'], [
      'caixas', 'usuarios', 'laboratorio-equipamentos', 'configuracoes',
      'venda-no-atacado', 'canais-venda', 'tipos-comerciais', 'kits-combos',
      'casquinha-sabores', 'linhas-comerciais', 'tabelas-preco',
      'diagnostico-comercial', 'licenca', 'auditoria',
      'configuracoes-avancadas', 'diagnostico-instancia'
    ]);

    const ids = [...document.querySelectorAll('#sidebar-nav [data-page]')]
      .map((link) => link.getAttribute('data-page'));
    assert.equal(ids.filter((id) => id === 'produtos').length, 1);
    assert.equal(ids.filter((id) => id === 'comercial-dashboard').length, 1);
    const painelComercial = document.querySelector('#sidebar-nav [data-page="comercial-dashboard"]');
    const abrirPdv = document.getElementById('nav-abrir-pdv');
    assert.equal(grupos['Loja'][0], 'comercial-dashboard');
    assert.equal(painelComercial.parentElement.nextElementSibling, abrirPdv);
    assert.equal(ids.includes('terminais'), false);
    assert.equal(ids.includes('conversao-linha'), false);
    assert.equal(ids.includes('estoque'), false);
    assert.equal(document.querySelector('#nav-abrir-pdv a').getAttribute('href'), '/pdv');
  });

  it('mantém a mesma rota e o destaque ativo genérico do item do menu', () => {
    const destinos = new Set([...appJs.matchAll(/case\s+'([^']+)'/g)].map((match) => match[1]));
    assert.equal(destinos.has('comercial-dashboard'), true);
    assert.match(coreJs, /\$\('\.nav-link'\)\.removeClass\('active'\);/);
    assert.match(coreJs, /\$\(this\)\.addClass\('active'\);/);
  });

  it('preserva destinos roteados e não duplica identificadores de tela', () => {
    const document = menuDom();
    const ids = [...document.querySelectorAll('#sidebar-nav [data-page]')]
      .map((link) => link.getAttribute('data-page'));
    const idsUnicos = new Set(ids);
    const destinos = new Set([...appJs.matchAll(/case\s+'([^']+)'/g)].map((match) => match[1]));

    assert.equal(ids.length, idsUnicos.size);
    ids.forEach((id) => assert.equal(destinos.has(id), true, `Rota sem case: ${id}`));
  });

  it('atualiza os caminhos da busca comercial para a navegação plana', () => {
    const sandbox = {
      window: { ERP_NAV_CATALOG: {} },
      paginaPermitidaPorImplantacao: () => true
    };
    vm.runInNewContext(navigationJs, sandbox);

    const resultados = sandbox.window.pesquisarNavErp('Configuração Comercial');
    assert.equal(resultados[0].page, 'venda-no-atacado');
    assert.deepEqual(Array.from(resultados[0].caminho), [
      'Administração e Configurações', 'Configuração Comercial'
    ]);
    assert.equal(
      sandbox.window.resolverPaginaErpNav('configuracao-comercial'),
      'venda-no-atacado'
    );
  });

  it('oculta o cabeçalho e o separador de grupo quando todos os itens foram filtrados', () => {
    const document = new JSDOM(`
      <ul id="sidebar-nav">
        <li class="sidebar-nav-separator"></li>
        <li class="sidebar-nav-group"><span>Vazio</span></li>
        <li class="nav-item" style="display: none"><a></a></li>
        <li class="sidebar-nav-separator"></li>
        <li class="sidebar-nav-group"><span>Visível</span></li>
        <li class="nav-item"><a></a></li>
      </ul>
    `).window.document;
    const helper = coreJs.match(/function atualizarVisibilidadeGruposSidebar\(\) \{[\s\S]*?\n\}/);

    assert.ok(helper, 'O filtro de menu deve atualizar a visibilidade dos grupos.');
    vm.runInNewContext(`${helper[0]}; atualizarVisibilidadeGruposSidebar();`, { document });

    const grupos = document.querySelectorAll('.sidebar-nav-group');
    const separadores = document.querySelectorAll('.sidebar-nav-separator');
    assert.equal(grupos[0].hidden, true);
    assert.equal(separadores[0].hidden, true);
    assert.equal(separadores[1].hidden, false);
    assert.equal(grupos[1].hidden, false);
  });

  it('não amplia as permissões pendentes nem o acesso a Configurações Avançadas', () => {
    let usuario = { role: 'operador', perfil: 'USUARIO', permissoes: ['produtos', 'vendas'] };
    const sandbox = {
      window: {},
      localStorage: { getItem: () => JSON.stringify(usuario) }
    };
    vm.runInNewContext(accessControlJs, sandbox);

    [
      'comercial-pendencias',
      'comercial-recomendacoes',
      'comercial-playbooks',
      'kits-combos',
      'casquinha-sabores',
      'linhas-comerciais'
    ].forEach((id) => {
      assert.equal(sandbox.usuarioTemPermissao(id), false, `${id} não deve ganhar permissão implícita`);
    });

    usuario = { role: 'admin', perfil: 'ADMIN', permissoes: [] };
    assert.equal(sandbox.usuarioTemPermissao('configuracoes-avancadas'), false);
    usuario = { role: 'operador', perfil: 'SUPER_ADMIN', permissoes: [] };
    assert.equal(sandbox.usuarioTemPermissao('configuracoes-avancadas'), true);
  });
});
