/**
 * CDS Mobile RC1
 * Copyright (c) 2026 CDS Sistemas
 * Versão congelada — sem novas funcionalidades.
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatNumber,
  formatDate,
  loadingHtml,
  errorHtml,
  emptyHtml,
  offlineHtml,
  backBarHtml,
  bindBack,
  bindGo,
  kpiHtml,
  listCardHtml,
  sectionTitleHtml,
  quickActionHtml,
  greetingForNow,
  currentUserName,
  currentCompanyName,
  icon
} from '../ui.js';
import { showToast } from '../toast.js';
import { badgeStatusConsignacao } from '../comercial-mappers.js';

function pick(obj, keys, fallback = null) {
  for (const key of keys) {
    if (obj && obj[key] != null && obj[key] !== '') return obj[key];
  }
  return fallback;
}

async function loadDashboardData() {
  const errors = [];
  const settled = await Promise.allSettled([
    window.CDSApi.get('dashboard/resumo'),
    window.CDSApi.get('comercial/projections/dashboard'),
    window.CDSApi.get('financeiro/resumo'),
    window.CDSApi.get('comercial/consignacoes').catch(() => null)
  ]);

  const [resumoR, comercialR, financeiroR, listaR] = settled;
  const resumo = resumoR.status === 'fulfilled' ? resumoR.value : null;
  const comercial = comercialR.status === 'fulfilled' ? comercialR.value : null;
  const financeiro = financeiroR.status === 'fulfilled' ? financeiroR.value : null;
  const listaRaw = listaR.status === 'fulfilled' ? listaR.value : null;

  if (resumoR.status === 'rejected') errors.push({ source: 'Dashboard', err: resumoR.reason });
  if (comercialR.status === 'rejected') errors.push({ source: 'Comercial', err: comercialR.reason });
  if (financeiroR.status === 'rejected') errors.push({ source: 'Financeiro', err: financeiroR.reason });

  return { resumo, comercial, financeiro, listaRaw, errors };
}

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.consignacoes)) return payload.consignacoes;
  return [];
}

export async function renderDashboard(root) {
  root.innerHTML = loadingHtml('Preparando seu dia…');

  try {
    const { resumo, comercial, financeiro, listaRaw, errors } = await loadDashboardData();

    if (!resumo && !comercial && !financeiro) {
      const first = errors[0]?.err;
      if (window.CDSApi?.isSessionExpiredError?.(first)) {
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        root.innerHTML = offlineHtml();
        return;
      }
      root.innerHTML = errorHtml(
        first?.message || 'Não foi possível carregar a Home.',
        first?.status
      );
      showToast('Falha ao carregar a Home.', 'error');
      return;
    }

    const dataComercial = comercial?.data || comercial?.payload || comercial || {};
    const totaisComerciais = dataComercial.totais || dataComercial.kpis || {};
    const hasResumo = !!resumo;
    const hasFin = !!financeiro;
    const hasCom = !!comercial;

    const vendasHoje = hasResumo ? pick(resumo, ['faturamento_hoje'], 0) : null;
    const estoqueBaixoLista = Array.isArray(resumo?.estoque_baixo) ? resumo.estoque_baixo : [];
    const produtosBaixo = hasResumo ? estoqueBaixoLista.length : null;
    const aReceber = hasFin
      ? (pick(financeiro, ['total_a_receber', 'total_receber', 'a_receber'], 0)
        ?? pick(resumo?.contas_receber || {}, ['total'], 0))
      : (hasResumo ? pick(resumo?.contas_receber || {}, ['total'], null) : null);

    const consignacoesAbertas = hasCom
      ? (pick(totaisComerciais, ['consignacoes_abertas', 'abertas', 'total_abertas', 'qtd_abertas'], 0)
        ?? pick(dataComercial, ['consignacoes_abertas', 'abertas'], 0))
      : null;

    const atividades = unwrapList(listaRaw).slice(0, 5);

    const nome = currentUserName();
    const empresa = currentCompanyName();
    const greet = greetingForNow();

    const errorBanner = errors.length
      ? `<div class="cds-mobile-banner" role="status">
          ${icon('warning')}
          <div>
            <strong>Alguns painéis falharam</strong>
            <p class="cds-muted" style="margin:4px 0 0">${errors.map((e) => `${escapeHtml(e.source)}`).join(' · ')}</p>
          </div>
        </div>`
      : '';

    root.innerHTML = `
      <section class="cds-home-hero cds-m-enter">
        <p class="cds-home-hero__greet">${escapeHtml(greet)}</p>
        <h1 class="cds-home-hero__name">${escapeHtml(nome)}</h1>
        <p class="cds-home-hero__company">${escapeHtml(empresa)}</p>
      </section>

      ${errorBanner}

      ${sectionTitleHtml('Resumo do dia')}
      <div class="cds-kpi-grid cds-m-rise">
        ${kpiHtml({
          id: 'vendas-hoje',
          iconName: 'coins',
          label: 'Vendas hoje',
          value: hasResumo ? formatMoney(vendasHoje) : '—',
          tone: 'primary',
          ok: hasResumo
        })}
        ${kpiHtml({
          id: 'comercial-resumo',
          iconName: 'store',
          label: 'Consignações abertas',
          value: hasCom ? formatNumber(consignacoesAbertas) : '—',
          tone: 'warning',
          ok: hasCom
        })}
        ${kpiHtml({
          id: 'a-receber',
          iconName: 'tag',
          label: 'A receber',
          value: aReceber != null ? formatMoney(aReceber) : '—',
          tone: 'success',
          ok: aReceber != null
        })}
        ${kpiHtml({
          id: 'estoque-baixo',
          iconName: 'warehouse',
          label: 'Estoque baixo',
          value: hasResumo ? formatNumber(produtosBaixo) : '—',
          tone: produtosBaixo > 0 ? 'danger' : 'neutral',
          ok: hasResumo
        })}
      </div>

      ${sectionTitleHtml('Ações rápidas')}
      <div class="cds-quick-grid">
        ${quickActionHtml('clientes', 'Clientes', 'users')}
        ${quickActionHtml('estoque', 'Estoque', 'warehouse')}
        ${quickActionHtml('comercial', 'Comercial', 'store')}
        ${quickActionHtml('financeiro', 'Financeiro', 'coins')}
      </div>

      ${sectionTitleHtml('Últimas atividades', atividades.length ? 'Ver todas' : '', 'comercial')}
      <div>
        ${atividades.length
          ? atividades.map((c) => listCardHtml({
              go: `comercial/${c.id || c.consignacao_id}`,
              title: asText(c.numero_documento || c.documento || `#${c.id}`, 'Consignação'),
              subtitle: asText(
                c.cliente_nome || c.nome_cliente || (typeof c.cliente === 'object' ? c.cliente?.nome : c.cliente),
                'Cliente'
              ),
              value: c.valor_total != null || c.total != null ? formatMoney(c.valor_total ?? c.total) : '',
              status: badgeStatusConsignacao(c),
              meta: [formatDate(c.criado_em || c.data_criacao || c.created_at || '')].filter((x) => x !== '—')
            })).join('')
          : emptyHtml('Nenhuma atividade recente', 'As consignações aparecerão aqui.')}
      </div>
    `;

    bindGo(root);
    root.querySelectorAll('[data-kpi]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        window.CDSMobile?.navigate?.(`dashboard/${btn.getAttribute('data-kpi')}`);
      });
    });

    errors.forEach((e) => {
      if (e.err?.status === 403) showToast(`${e.source}: sem permissão.`, 'warning');
    });
  } catch (err) {
    root.innerHTML = errorHtml(err.message || 'Não foi possível carregar a Home.', err.status);
    showToast(err.message || 'Erro na Home', 'error');
  }
}

export async function renderDetail(root, kpiId) {
  root.innerHTML = loadingHtml('Carregando detalhe…');
  try {
    const { resumo, comercial, financeiro, errors } = await loadDashboardData();
    root.innerHTML = `
      ${backBarHtml('Início')}
      ${sectionTitleHtml('Detalhe')}
      <div id="dash-detail-body"></div>
    `;
    bindBack(root);
    const body = root.querySelector('#dash-detail-body');

    if (errors.length && !resumo && !financeiro && !comercial) {
      body.innerHTML = errorHtml(errors[0].err?.message || 'Falha ao carregar', errors[0].err?.status);
      return;
    }

    if (kpiId === 'vendas-hoje' || kpiId === 'tickets') {
      if (!resumo) {
        body.innerHTML = errorHtml('Dashboard indisponível.', 403);
        return;
      }
      body.innerHTML = `
        <article class="cds-card">
          <h3 class="cds-card__title">Vendas de hoje</h3>
          <div class="cds-row"><span>Faturamento</span><strong>${escapeHtml(formatMoney(resumo.faturamento_hoje))}</strong></div>
          <div class="cds-row"><span>Tickets</span><strong>${escapeHtml(formatNumber(resumo.vendas_hoje))}</strong></div>
          <div class="cds-row"><span>Ticket médio</span><strong>${escapeHtml(formatMoney(resumo.ticket_medio_hoje))}</strong></div>
          <div class="cds-row"><span>Lucro estimado</span><strong>${escapeHtml(formatMoney(resumo.lucro_estimado_hoje))}</strong></div>
        </article>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="financeiro">${icon('coins')} Ir ao Financeiro</button>
      `;
    } else if (kpiId === 'a-receber') {
      const total = pick(financeiro || {}, ['total_a_receber'], pick(resumo?.contas_receber || {}, ['total'], null));
      if (total == null) {
        body.innerHTML = errorHtml('Dados indisponíveis.', 403);
        return;
      }
      body.innerHTML = `
        <article class="cds-card">
          <h3 class="cds-card__title">Contas a receber</h3>
          <div class="cds-row"><span>Total</span><strong>${escapeHtml(formatMoney(total))}</strong></div>
          <div class="cds-row"><span>Quantidade</span><strong>${escapeHtml(formatNumber(resumo?.contas_receber?.quantidade || 0))}</strong></div>
        </article>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="financeiro">${icon('coins')} Abrir Financeiro</button>
      `;
    } else if (kpiId === 'estoque-baixo') {
      const lista = Array.isArray(resumo?.estoque_baixo) ? resumo.estoque_baixo : [];
      body.innerHTML = `
        <p class="cds-muted">${escapeHtml(formatNumber(lista.length))} produto(s) em alerta</p>
        ${lista.length
          ? lista.slice(0, 40).map((p) => listCardHtml({
              go: `produtos/${p.id}`,
              title: asText(p.nome, 'Produto'),
              value: formatNumber(p.estoque_atual, 2),
              meta: [`Mín. ${formatNumber(p.estoque_minimo, 2)}`],
              status: 'Baixo'
            })).join('')
          : emptyHtml('Nenhum produto em estoque baixo.')}
        <div style="margin-top:12px">
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="estoque">${icon('warehouse')} Consultar estoque</button>
        </div>
      `;
    } else if (kpiId === 'comercial-resumo') {
      const data = comercial?.data || comercial || {};
      const totais = data.totais || data.kpis || {};
      body.innerHTML = `
        <article class="cds-card">
          <h3 class="cds-card__title">Comercial</h3>
          <div class="cds-row"><span>Abertas</span><strong>${escapeHtml(formatNumber(pick(totais, ['consignacoes_abertas', 'abertas'], 0)))}</strong></div>
          <div class="cds-row"><span>Pendências</span><strong>${escapeHtml(formatNumber(pick(totais, ['pendencias', 'total_pendencias'], 0)))}</strong></div>
        </article>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="comercial">${icon('store')} Abrir Comercial</button>
      `;
    } else {
      body.innerHTML = errorHtml('Detalhe desconhecido.', 404);
    }

    bindGo(body);
  } catch (err) {
    root.innerHTML = `${backBarHtml('Início')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export default {
  render: async (root, parsed) => {
    if (parsed?.id) return renderDetail(root, parsed.id);
    return renderDashboard(root);
  },
  renderDetail,
  title: 'Início',
  subtitle: 'Seu dia'
};
