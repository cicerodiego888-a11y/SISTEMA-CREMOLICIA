/**
 * CDS Mobile RC2.2 — Hub Cadastros
 */
import { quickActionHtml, sectionTitleHtml, emptyHtml, bindGo, icon } from '../ui.js';
import { canAccessRoute } from '../permissions.js';

export async function renderCadastros(root) {
  const items = [
    { route: 'clientes', label: 'Clientes', ic: 'users', hint: 'CRUD' },
    { route: 'comercial/clientes', label: 'Cliente Consignado', ic: 'store', hint: 'Perfil comercial' },
    { route: 'fornecedores', label: 'Fornecedores', ic: 'store', hint: 'CRUD' },
    { route: 'produtos', label: 'Produtos', ic: 'box', hint: 'CRUD' },
    { route: 'categorias', label: 'Categorias', ic: 'tag', hint: 'CRUD' },
    { route: 'usuarios', label: 'Usuários', ic: 'user', hint: 'Admin' }
  ].filter((i) => {
    if (i.route.startsWith('comercial')) return canAccessRoute('comercial');
    return canAccessRoute(i.route);
  });

  root.innerHTML = `
    <section class="cds-home-hero cds-m-enter" style="padding-bottom:8px">
      <p class="cds-home-hero__greet">Cadastros</p>
      <h1 class="cds-home-hero__name" style="font-size:1.35rem">Base do ERP</h1>
      <p class="cds-home-hero__company">Mesmas APIs e permissões do Desktop</p>
    </section>

    ${sectionTitleHtml('Módulos')}
    <div class="cds-quick-grid" style="grid-template-columns:1fr 1fr">
      ${items.length
        ? items.map((i) => quickActionHtml(i.route, i.label, i.ic)).join('')
        : emptyHtml('Sem permissão para cadastros')}
    </div>

    <article class="cds-card" style="margin-top:16px">
      <div class="cds-row"><span>Fonte</span><strong>/api/*</strong></div>
      <div class="cds-row"><span>Regras</span><strong>Backend</strong></div>
      <p class="cds-muted">${icon('check')} Paridade RC2.2 com ERP Desktop</p>
    </article>
  `;

  bindGo(root);
}

export default { render: renderCadastros, title: 'Cadastros', subtitle: 'ERP' };
