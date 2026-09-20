/**
 * Central de Trabalho Comercial — UX-21 Centro de Operações.
 *
 * Experiência do operador sobre Shared UI Workspace.
 * Não altera regras de negócio, APIs ou Recovery/Ledger/Crédito.
 *
 * @module frontend/modules/motor-comercial/pages/Dashboard/CentralTrabalhoView
 */

const Workspace = require('../../../../shared/ui/Workspace');
const EntityCard = require('../../../../shared/ui/EntityCard');
const ActionBar = require('../../../../shared/ui/ActionBar');
const Hero = require('../../../../shared/ui/Hero');
const EmptyState = require('../../components/base/EmptyState');
const Loading = require('../../components/base/Loading');
const { emptyState } = require('../../messages');

class CentralTrabalhoView {
  static render(viewModel = {}, ctx = {}) {
    const body = CentralTrabalhoView._buildBodyContent(viewModel, ctx);

    const root = Workspace.create({
      variant: 'central',
      className: 'cds-central-ops',
      header: CentralTrabalhoView._buildHeader(viewModel, ctx),
      body: {
        children: body,
        scroll: true,
        className: 'cds-central-ops__body'
      },
      footer: CentralTrabalhoView._buildFooter(viewModel, ctx)
    });

    root.id = 'central-trabalho-root';
    root.dataset.uxSprint = 'UX-21';
    root.dataset.sharedUiReference = 'central-trabalho-comercial';

    requestAnimationFrame(() => {
      root.classList.add('cds-central-ops--ready');
    });

    return root;
  }

  static renderLoading() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-central-ops cds-central-ops--loading';
    wrap.id = 'central-trabalho-root';
    wrap.appendChild(Loading.create({ message: 'Preparando o centro de operações...' }));
    return wrap;
  }

  static _buildHeader(viewModel = {}, ctx = {}) {
    const actions = CentralTrabalhoView._buildTopActions(viewModel, ctx);
    const operador = viewModel.saudacao?.operadorNome || 'Operador';

    return Workspace.Header.create({
      title: 'Central de Trabalho Comercial',
      subtitle: 'Centro de Operações',
      operator: `👤 ${operador}`,
      secondaryActions: actions,
      className: 'cds-central-ops__header'
    });
  }

  static _buildTopActions(viewModel = {}, ctx = {}) {
    const mk = (label, onClick, className = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = ['cds-central-ops__top-btn', className].filter(Boolean).join(' ');
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      return btn;
    };

    const atalhos = viewModel.acoesRapidas?.atalhos || [];
    const wrapAtalhos = document.createElement('div');
    wrapAtalhos.className = 'cds-central-ops__atalhos-pop';

    const toggle = mk('⚡ Atalhos', () => {
      menu.hidden = !menu.hidden;
      toggle.setAttribute('aria-expanded', String(!menu.hidden));
    });
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'cds-central-ops__atalhos-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    atalhos.forEach((acao) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'cds-central-ops__atalhos-item';
      item.setAttribute('role', 'menuitem');
      item.textContent = `${acao.icon || '•'} ${acao.label}`;
      item.addEventListener('click', () => {
        menu.hidden = true;
        if (ctx.onAtalho) ctx.onAtalho(acao);
        else if (ctx.onAcao) ctx.onAcao(acao);
      });
      menu.appendChild(item);
    });

    const onDocClick = (e) => {
      if (!wrapAtalhos.isConnected) {
        document.removeEventListener('click', onDocClick);
        return;
      }
      if (!wrapAtalhos.contains(e.target)) {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }
    };
    document.addEventListener('click', onDocClick);

    wrapAtalhos.appendChild(toggle);
    wrapAtalhos.appendChild(menu);

    return [
      mk('🔄 Atualizar', () => ctx.onAtualizar && ctx.onAtualizar()),
      mk('🔔 Notificações', () => {
        const root = document.getElementById('central-trabalho-root');
        const target = root?.querySelector('#sec-atividades-recentes');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
      wrapAtalhos
    ];
  }

  static _buildFooter(viewModel = {}, ctx = {}) {
    const principal = viewModel.acaoPrincipal || {};
    const secondary = [
      {
        label: 'Clientes',
        icon: '👥',
        onClick: () => ctx.onAtalho && ctx.onAtalho({ acaoTipo: 'central-clientes' })
      },
      {
        label: 'Prestação',
        icon: '📋',
        onClick: () => ctx.onAtalho && ctx.onAtalho({ acaoTipo: 'prestacao-locator' })
      }
    ];

    const actionBar = ActionBar.create({
      primary: {
        label: principal.label || 'Nova Entrega',
        icon: principal.icon || '📦',
        onClick: () => {
          if (principal.acaoTipo && principal.acaoTipo !== 'nova-consignacao' && ctx.onAcao) {
            ctx.onAcao(principal);
          } else if (ctx.onAtalho) {
            ctx.onAtalho({ acaoTipo: 'nova-consignacao', label: 'Nova Entrega' });
          }
        }
      },
      secondary,
      more: [
        {
          label: 'Novo Cliente',
          icon: '👤',
          onClick: () => ctx.onAtalho && ctx.onAtalho({ acaoTipo: 'novo-cliente' })
        },
        {
          label: 'Relatórios',
          icon: '📊',
          onClick: () => ctx.onAtalho && ctx.onAtalho({ acaoTipo: 'relatorios' })
        }
      ]
    });

    return Workspace.Footer.create({
      children: actionBar,
      className: 'cds-central-ops__footer'
    });
  }

  static _buildBodyContent(viewModel = {}, ctx = {}) {
    const content = document.createElement('div');
    content.className = 'cds-central-ops__content';

    content.appendChild(CentralTrabalhoView._renderHero(viewModel, ctx));
    content.appendChild(CentralTrabalhoView._renderIndicadores(viewModel.resumoDia || []));

    const opsRow = document.createElement('div');
    opsRow.className = 'cds-central-ops__split cds-central-ops__fade';
    opsRow.style.setProperty('--fade-delay', '90ms');
    opsRow.appendChild(CentralTrabalhoView._renderFila(viewModel.trabalhoPrioritario || [], ctx));
    opsRow.appendChild(CentralTrabalhoView._renderConsignados(viewModel.consignadosPendentes || [], ctx));
    content.appendChild(opsRow);

    const feedRow = document.createElement('div');
    feedRow.className = 'cds-central-ops__split cds-central-ops__fade';
    feedRow.style.setProperty('--fade-delay', '150ms');
    feedRow.appendChild(CentralTrabalhoView._renderTimelineEntregas(viewModel.proximasEntregas || [], ctx));
    feedRow.appendChild(CentralTrabalhoView._renderAtividades(viewModel.ultimasOperacoes || []));
    content.appendChild(feedRow);

    return content;
  }

  static _renderHero(viewModel = {}, ctx = {}) {
    const saudacao = viewModel.saudacao || {};
    const destaques = Array.isArray(saudacao.destaques) ? saudacao.destaques : [];
    const statusItems = destaques.length
      ? destaques.map((item) => ({
        tone: item.tom || 'info',
        text: /[.!?]$/.test(item.texto || '') ? item.texto : `${item.texto || ''}.`
      }))
      : [{ tone: 'ready', text: 'Fila em dia.' }];

    const wrap = document.createElement('div');
    wrap.className = 'cds-central-ops__fade';
    wrap.style.setProperty('--fade-delay', '0ms');

    const hero = Hero.create({
      operatorName: saudacao.operadorNome || 'Operador',
      statusItems,
      message: saudacao.mensagem || 'Tudo pronto para começar.',
      actions: [
        {
          label: 'Nova Entrega',
          variant: 'primary',
          onClick: () => {
            if (ctx.onAtalho) ctx.onAtalho({ acaoTipo: 'nova-consignacao', label: 'Nova Entrega' });
          }
        },
        {
          label: 'Clientes',
          variant: 'secondary',
          onClick: () => {
            if (ctx.onAtalho) ctx.onAtalho({ acaoTipo: 'central-clientes', label: 'Clientes' });
          }
        }
      ]
    });

    wrap.appendChild(hero);
    return wrap;
  }

  static _renderIndicadores(itens = []) {
    const section = document.createElement('section');
    section.className = 'cds-central-ops__section cds-central-ops__fade';
    section.style.setProperty('--fade-delay', '60ms');
    section.setAttribute('aria-label', 'Indicadores do dia');

    const grid = document.createElement('div');
    grid.className = 'cds-central-ops__indicadores';

    itens
      .filter((item) => !item.oculto)
      .slice(0, 4)
      .forEach((item) => {
        const card = document.createElement('article');
        card.className = `cds-central-ops__kpi cds-central-ops__kpi--${item.tom || 'sky'}`;
        card.innerHTML = `
          <div class="cds-central-ops__kpi-icon">${item.icone || '•'}</div>
          <div class="cds-central-ops__kpi-body">
            <span class="cds-central-ops__kpi-label">${item.label}</span>
            <strong class="cds-central-ops__kpi-value">${item.valor ?? 0}</strong>
            <p class="cds-central-ops__kpi-desc">${item.descricao || ''}</p>
          </div>
        `;
        grid.appendChild(card);
      });

    section.appendChild(grid);
    return section;
  }

  static _renderSectionShell(title, id, delay = '120ms') {
    const section = document.createElement('section');
    section.className = 'cds-central-ops__section cds-central-ops__fade';
    section.style.setProperty('--fade-delay', delay);
    if (id) section.id = id;

    const heading = document.createElement('div');
    heading.className = 'cds-central-ops__section-head';
    const h = document.createElement('h2');
    h.textContent = title;
    heading.appendChild(h);
    section.appendChild(heading);
    return section;
  }

  static _renderFila(itens = [], ctx = {}) {
    const section = CentralTrabalhoView._renderSectionShell('Minha Fila de Trabalho', 'sec-minha-fila', '0ms');
    section.classList.add('cds-central-ops__panel');

    if (!itens.length) {
      section.appendChild(EmptyState.create(emptyState('CENTRAL_TAREFAS')));
      return section;
    }

    const lista = document.createElement('div');
    lista.className = 'cds-central-ops__fila';

    itens.forEach((item) => {
      const ops = Array.isArray(item.consignacoes) ? item.consignacoes : null;
      if (item.agrupado && ops && ops.length) {
        lista.appendChild(CentralTrabalhoView._renderCardClienteAgrupado(item, ops, ctx));
        return;
      }
      lista.appendChild(CentralTrabalhoView._renderCardOperacaoSimples(item, ctx));
    });

    section.appendChild(lista);
    return section;
  }

  /**
   * RCM-8.10 — 1 cliente = 1 card; N consignações com ações por consignacaoId.
   */
  static _renderCardClienteAgrupado(item, operacoes, ctx = {}) {
    const formatCurrency = ctx.formatCurrency || ((v) => String(v));
    const valor = formatCurrency(item.valor ?? item.saldoDevedor ?? 0);
    const qtdConsig = item.quantidadeConsignacoes ?? operacoes.length;
    const itensTotal = item.itens ?? 0;
    const consigLabel = qtdConsig === 1 ? '1 consignação' : `${qtdConsig} consignações`;
    const itensLabel = itensTotal === 1 ? '1 item' : `${itensTotal} itens`;

    const card = EntityCard.create({
      variant: 'compact',
      title: `👤 ${item.clienteNome || 'Cliente'}`,
      subtitle: item.documento && item.documento !== '—' ? `📄 ${item.documento}` : '',
      status: `● ${item.statusLabel || item.situacao || 'Operações'}`,
      description: `💰 ${valor} · 📦 ${itensLabel} · ${consigLabel}`,
      badges: (item.estados || (item.estado ? [item.estado] : [])).map((e) => ({
        text: e,
        variant: item.nivel || 'info'
      })),
      kind: 'fila-trabalho-cliente',
      className: `cds-central-ops__entity cds-central-ops__entity--cliente cds-central-ops__entity--${item.nivel || 'info'}`
    });

    const opsList = document.createElement('div');
    opsList.className = 'cds-central-ops__ops';
    opsList.setAttribute('role', 'list');

    operacoes.forEach((op) => {
      opsList.appendChild(CentralTrabalhoView._renderOperacaoNoCard(op, ctx, formatCurrency));
    });

    card.appendChild(opsList);
    return card;
  }

  static _renderOperacaoNoCard(op, ctx, formatCurrency) {
    const row = document.createElement('div');
    row.className = 'cds-central-ops__op';
    row.setAttribute('role', 'listitem');
    row.dataset.consignacaoId = String(op.consignacaoId ?? '');
    row.dataset.estado = op.estado || '';

    const head = document.createElement('div');
    head.className = 'cds-central-ops__op-head';

    const title = document.createElement('strong');
    title.className = 'cds-central-ops__op-doc';
    title.textContent = op.entregaLabel || op.documentoConsignacao || `Consignação #${op.consignacaoId}`;

    const badge = document.createElement('span');
    badge.className = 'cds-central-ops__op-badge';
    badge.textContent = op.estado || '';
    if (op.nivel) badge.dataset.variant = op.nivel;

    head.appendChild(title);
    if (op.estado) head.appendChild(badge);

    const meta = document.createElement('p');
    meta.className = 'cds-central-ops__op-meta';
    const valorOp = formatCurrency(op.valor ?? op.saldoDevedor ?? 0);
    const itensOp = Number(op.itens || 0);
    meta.textContent = `💰 ${valorOp} · 📦 ${itensOp === 1 ? '1 item' : `${itensOp} itens`} · ${op.statusLabel || op.situacao || ''}`;

    const actions = document.createElement('div');
    actions.className = 'cds-central-ops__op-actions';

    if (op.podeEntregaComplementar && op.consignacaoId != null) {
      const btnComp = document.createElement('button');
      btnComp.type = 'button';
      btnComp.className = 'cds-central-ops__op-btn cds-central-ops__op-btn--ghost';
      btnComp.textContent = 'Ent. Complementar';
      btnComp.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ctx.onAcao) {
          ctx.onAcao({
            ...op,
            acaoTipo: 'entrega-complementar',
            acaoLabel: 'Ent. Complementar'
          });
        }
      });
      actions.appendChild(btnComp);
    }

    const btnPrimary = document.createElement('button');
    btnPrimary.type = 'button';
    btnPrimary.className = 'cds-central-ops__op-btn cds-central-ops__op-btn--primary';
    btnPrimary.textContent = op.acaoLabel || 'Abrir';
    btnPrimary.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ctx.onAcao) ctx.onAcao(op);
    });
    actions.appendChild(btnPrimary);

    row.appendChild(head);
    row.appendChild(meta);
    row.appendChild(actions);
    return row;
  }

  /** Card legado / risco sem lista aninhada (1 operação = ações no card). */
  static _renderCardOperacaoSimples(item, ctx = {}) {
    const formatCurrency = ctx.formatCurrency || ((v) => String(v));
    const valor = formatCurrency(item.valor ?? item.saldoDevedor ?? 0);
    const itensLabel = `${item.itens ?? 0} itens`;
    const tempo = item.tempoAguardando || '—';
    const cardOpts = {
      variant: 'compact',
      title: `👤 ${item.clienteNome || 'Cliente'}`,
      subtitle: `📄 ${item.entregaLabel || item.documento || '—'}`,
      status: `● ${item.statusLabel || item.situacao || 'Atendimento'}`,
      description: `💰 ${valor} • 📦 ${itensLabel} • ⏱ ${tempo}`,
      badges: item.estado ? [{ text: item.estado, variant: item.nivel || 'info' }] : [],
      kind: 'fila-trabalho',
      className: `cds-central-ops__entity cds-central-ops__entity--${item.nivel || 'info'}`,
      primaryAction: {
        label: item.acaoLabel || 'Continuar Atendimento',
        onClick: () => ctx.onAcao && ctx.onAcao(item)
      }
    };

    if (item.podeEntregaComplementar && item.consignacaoId != null) {
      cardOpts.secondaryAction = {
        label: 'Ent. Complementar',
        variant: 'ghost',
        onClick: () => ctx.onAcao && ctx.onAcao({
          ...item,
          acaoTipo: 'entrega-complementar',
          acaoLabel: 'Ent. Complementar'
        })
      };
    }

    return EntityCard.create(cardOpts);
  }

  static _renderConsignados(itens = [], ctx = {}) {
    const section = CentralTrabalhoView._renderSectionShell('Consignados Pendentes', 'sec-consignados-pendentes', '0ms');
    section.classList.add('cds-central-ops__panel');

    if (!itens.length) {
      section.appendChild(EmptyState.create(emptyState('CENTRAL_SALDOS')));
      return section;
    }

    const lista = document.createElement('div');
    lista.className = 'cds-central-ops__fila';
    const formatCurrency = ctx.formatCurrency || ((v) => String(v));

    itens.forEach((item) => {
      const valor = formatCurrency(item.valorEmAberto);
      const card = EntityCard.create({
        variant: 'compact',
        title: `👤 ${item.clienteNome || 'Cliente'}`,
        subtitle: `📄 ${item.documento || '—'}`,
        status: '● Saldo a receber',
        description: `💰 ${valor}`,
        badges: [{ text: 'E5', variant: 'info' }],
        kind: 'consignado-pendente',
        className: 'cds-central-ops__entity cds-central-ops__entity--receive',
        primaryAction: {
          label: 'Receber Agora',
          onClick: () => ctx.onReceber && ctx.onReceber(item)
        }
      });
      lista.appendChild(card);
    });

    section.appendChild(lista);
    return section;
  }

  static _renderTimelineEntregas(itens = [], ctx = {}) {
    const section = CentralTrabalhoView._renderSectionShell('Próximas Entregas', 'sec-proximas-entregas', '0ms');
    section.classList.add('cds-central-ops__panel');

    if (!itens.length) {
      section.appendChild(EmptyState.create(emptyState('CENTRAL_ENTREGAS')));
      return section;
    }

    const timeline = document.createElement('div');
    timeline.className = 'cds-central-ops__timeline';
    timeline.setAttribute('role', 'list');

    itens.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cds-central-ops__timeline-row';
      row.setAttribute('role', 'listitem');
      row.innerHTML = `
        <span class="cds-central-ops__timeline-time">${item.hora || '—'}</span>
        <span class="cds-central-ops__timeline-rail" aria-hidden="true"></span>
        <span class="cds-central-ops__timeline-main">
          <strong>${item.cliente || 'Cliente'}</strong>
          <em>${item.acaoTimeline || item.situacao || 'Acompanhar'}</em>
        </span>
      `;
      row.addEventListener('click', () => {
        if (ctx.onAcao) {
          ctx.onAcao({
            ...item,
            acaoTipo: 'entrega',
            consignacaoId: item.consignacaoId
          });
        }
      });
      timeline.appendChild(row);
    });

    section.appendChild(timeline);
    return section;
  }

  static _renderAtividades(itens = []) {
    const section = CentralTrabalhoView._renderSectionShell('Atividades Recentes', 'sec-atividades-recentes', '0ms');
    section.classList.add('cds-central-ops__panel');

    if (!itens.length) {
      section.appendChild(EmptyState.create(emptyState('CENTRAL_RECENTES')));
      return section;
    }

    const list = document.createElement('ul');
    list.className = 'cds-central-ops__atividades';

    itens.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'cds-central-ops__atividade';
      li.innerHTML = `
        <span class="cds-central-ops__atividade-icon">${item.icone || '✔'}</span>
        <span class="cds-central-ops__atividade-text">${item.descricao}</span>
        <span class="cds-central-ops__atividade-time">${item.periodo || ''}</span>
      `;
      list.appendChild(li);
    });

    section.appendChild(list);
    return section;
  }
}

module.exports = CentralTrabalhoView;
