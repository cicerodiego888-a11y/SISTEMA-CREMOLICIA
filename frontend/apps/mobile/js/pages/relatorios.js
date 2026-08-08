/**
 * CDS Mobile RCM-03 — Relatórios (comercial / financeiro / estoque / vendas)
 * Reutiliza projeções e endpoints oficiais do Desktop.
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatNumber,
  formatDate,
  loadingHtml,
  emptyHtml,
  errorHtml,
  listCardHtml,
  sectionTitleHtml,
  backBarHtml,
  bindBack,
  bindGo
} from '../ui.js';
import { fieldHtml, tabsHtml, unwrapList } from '../forms.js';
import { showToast } from '../toast.js';
import { shareTextAsFile } from '../native.js';

function periodoPadrao() {
  const fim = new Date();
  const ini = new Date();
  ini.setDate(ini.getDate() - 30);
  return {
    de: ini.toISOString().slice(0, 10),
    ate: fim.toISOString().slice(0, 10)
  };
}

function filtrosHtml(p) {
  return `
    <div class="cds-card" style="margin-bottom:12px">
      <div class="cds-form__fields">
        ${fieldHtml({ name: 'de', label: 'De', type: 'date', value: p.de })}
        ${fieldHtml({ name: 'ate', label: 'Até', type: 'date', value: p.ate })}
      </div>
      <button type="button" class="cds-mobile-btn" id="rel-aplicar" style="width:100%;margin-top:8px">Atualizar</button>
    </div>
  `;
}

function readPeriodo(root) {
  return {
    de: root.querySelector('[name="de"]')?.value || periodoPadrao().de,
    ate: root.querySelector('[name="ate"]')?.value || periodoPadrao().ate
  };
}

async function renderFinanceiro(root, p) {
  root.querySelector('#rel-body').innerHTML = loadingHtml();
  try {
    const [resumo, fluxo, inad] = await Promise.all([
      window.CDSApi.get('financeiro/relatorios/resumo', { data_inicio: p.de, data_fim: p.ate }).catch(() => null),
      window.CDSApi.get('financeiro/relatorios/fluxo', { data_inicio: p.de, data_fim: p.ate }).catch(() => null),
      window.CDSApi.get('financeiro/relatorios/inadimplencia').catch(() => null)
    ]);
    const fluxoRows = unwrapList(fluxo?.data || fluxo?.itens || fluxo);
    const inadRows = unwrapList(inad?.data || inad?.itens || inad);

    root.querySelector('#rel-body').innerHTML = `
      <article class="cds-card">
        <div class="cds-row"><span>Receber</span><strong>${formatMoney(resumo?.total_receber ?? resumo?.receber ?? 0)}</strong></div>
        <div class="cds-row"><span>Pagar</span><strong>${formatMoney(resumo?.total_pagar ?? resumo?.pagar ?? 0)}</strong></div>
        <div class="cds-row"><span>Saldo</span><strong>${formatMoney(resumo?.saldo ?? resumo?.resultado ?? 0)}</strong></div>
      </article>
      ${sectionTitleHtml('Fluxo')}
      <div>${fluxoRows.length
        ? fluxoRows.slice(0, 40).map((r) => listCardHtml({
            title: asText(r.data || r.periodo || r.descricao),
            value: formatMoney(r.saldo ?? r.valor ?? r.entrada ?? 0),
            meta: [asText(r.tipo, '')]
          })).join('')
        : emptyHtml('Sem fluxo no período')}</div>
      ${sectionTitleHtml('Inadimplência')}
      <div>${inadRows.length
        ? inadRows.slice(0, 30).map((r) => listCardHtml({
            title: asText(r.cliente || r.nome || r.descricao),
            value: formatMoney(r.valor ?? r.saldo ?? 0),
            meta: [formatDate(r.vencimento)]
          })).join('')
        : emptyHtml('Sem inadimplência')}</div>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="rel-export" style="width:100%;margin-top:12px">Exportar resumo</button>
    `;
    root.querySelector('#rel-export')?.addEventListener('click', async () => {
      await shareTextAsFile(`financeiro-${p.de}-${p.ate}.json`, JSON.stringify({ resumo, fluxo: fluxoRows, inad: inadRows }, null, 2));
    });
  } catch (err) {
    root.querySelector('#rel-body').innerHTML = errorHtml(err.message, err.status);
  }
}

async function renderVendas(root, p) {
  root.querySelector('#rel-body').innerHTML = loadingHtml();
  try {
    const [periodo, ranking] = await Promise.all([
      window.CDSApi.get('vendas/relatorio/periodo', { data_inicio: p.de, data_fim: p.ate }).catch(() =>
        window.CDSApi.get('vendas', { data_inicio: p.de, data_fim: p.ate })),
      window.CDSApi.get('vendas/relatorio/produtos-mais-vendidos', { data_inicio: p.de, data_fim: p.ate }).catch(() =>
        window.CDSApi.get('produtos/ranking-vendas', { data_inicio: p.de, data_fim: p.ate }))
    ]);
    const vendas = unwrapList(periodo?.vendas || periodo?.data || periodo);
    const top = unwrapList(ranking?.data || ranking?.itens || ranking);

    root.querySelector('#rel-body').innerHTML = `
      <article class="cds-card">
        <div class="cds-row"><span>Vendas</span><strong>${formatNumber(periodo?.total_vendas ?? vendas.length)}</strong></div>
        <div class="cds-row"><span>Faturamento</span><strong>${formatMoney(periodo?.faturamento ?? periodo?.total ?? 0)}</strong></div>
      </article>
      ${sectionTitleHtml('Top produtos')}
      <div>${top.length
        ? top.slice(0, 30).map((r) => listCardHtml({
            title: asText(r.nome || r.produto_nome || r.descricao),
            value: formatMoney(r.total ?? r.valor ?? 0),
            meta: [`Qtd ${r.quantidade ?? r.qtd ?? '—'}`]
          })).join('')
        : emptyHtml('Sem ranking')}</div>
      ${sectionTitleHtml('Vendas recentes')}
      <div>${vendas.length
        ? vendas.slice(0, 40).map((v) => listCardHtml({
            go: `pdv/venda/${v.id}`,
            title: asText(v.codigo || `Venda #${v.id}`),
            value: formatMoney(v.total ?? v.valor_total ?? 0),
            meta: [formatDate(v.data || v.created_at)]
          })).join('')
        : emptyHtml('Sem vendas')}</div>
    `;
    bindGo(root.querySelector('#rel-body'));
  } catch (err) {
    root.querySelector('#rel-body').innerHTML = errorHtml(err.message, err.status);
  }
}

async function renderComercial(root, p) {
  root.querySelector('#rel-body').innerHTML = loadingHtml();
  try {
    const [dash, indicadores, playbooks] = await Promise.all([
      window.CDSApi.get('comercial/projections/dashboard').catch(() => null),
      window.CDSApi.get('comercial/projections/indicadores', { data_inicio: p.de, data_fim: p.ate }).catch(() => null),
      window.CDSApi.get('comercial/projections/playbooks').catch(() => null)
    ]);
    const books = unwrapList(playbooks?.data || playbooks?.items || playbooks);

    root.querySelector('#rel-body').innerHTML = `
      <article class="cds-card">
        <div class="cds-row"><span>Abertas</span><strong>${formatNumber(dash?.abertas ?? dash?.totais?.abertas ?? 0)}</strong></div>
        <div class="cds-row"><span>Pendências</span><strong>${formatNumber(dash?.pendencias ?? dash?.totais?.pendencias ?? 0)}</strong></div>
        <div class="cds-row"><span>Indicadores</span><strong>${escapeHtml(asText(indicadores?.resumo || indicadores?.status || 'OK'))}</strong></div>
      </article>
      ${sectionTitleHtml('Playbooks')}
      <div>${books.length
        ? books.slice(0, 20).map((b) => listCardHtml({
            title: asText(b.titulo || b.nome || b.codigo),
            subtitle: asText(b.descricao || b.recomendacao, '')
          })).join('')
        : emptyHtml('Sem playbooks')}</div>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="comercial" style="width:100%;margin-top:12px">Abrir Comercial</button>
    `;
    bindGo(root.querySelector('#rel-body'));
  } catch (err) {
    root.querySelector('#rel-body').innerHTML = errorHtml(err.message, err.status);
  }
}

async function renderEstoque(root) {
  root.querySelector('#rel-body').innerHTML = loadingHtml();
  try {
    const [rel, baixo] = await Promise.all([
      window.CDSApi.get('produtos/relatorio-estoque').catch(() => null),
      window.CDSApi.get('produtos/estoque/baixo').catch(() => [])
    ]);
    const baixoRows = unwrapList(baixo?.data || baixo);

    root.querySelector('#rel-body').innerHTML = `
      <article class="cds-card">
        <div class="cds-row"><span>SKUs</span><strong>${formatNumber(rel?.total_produtos ?? rel?.skus ?? 0)}</strong></div>
        <div class="cds-row"><span>Valor estoque</span><strong>${formatMoney(rel?.valor_total ?? rel?.custo_total ?? 0)}</strong></div>
        <div class="cds-row"><span>Baixo</span><strong>${formatNumber(baixoRows.length)}</strong></div>
      </article>
      ${sectionTitleHtml('Estoque baixo')}
      <div>${baixoRows.length
        ? baixoRows.slice(0, 40).map((p) => listCardHtml({
            go: `produtos/${p.id}`,
            title: asText(p.nome),
            value: formatNumber(p.estoque ?? p.quantidade ?? 0, 2)
          })).join('')
        : emptyHtml('Nenhum alerta')}</div>
    `;
    bindGo(root.querySelector('#rel-body'));
  } catch (err) {
    root.querySelector('#rel-body').innerHTML = errorHtml(err.message, err.status);
  }
}

async function renderFiscal(root, p) {
  root.querySelector('#rel-body').innerHTML = loadingHtml();
  try {
    const notas = unwrapList(await window.CDSApi.get('fiscal/notas', { todas: 1 }));
    const filtradas = notas.filter((n) => {
      const d = String(n.created_at || n.data_emissao || '').slice(0, 10);
      return (!p.de || d >= p.de) && (!p.ate || d <= p.ate);
    });
    const total = filtradas.reduce((s, n) => s + Number(n.valor_total ?? n.total ?? 0), 0);
    root.querySelector('#rel-body').innerHTML = `
      <article class="cds-card">
        <div class="cds-row"><span>Notas</span><strong>${formatNumber(filtradas.length)}</strong></div>
        <div class="cds-row"><span>Valor</span><strong>${formatMoney(total)}</strong></div>
      </article>
      <div>${filtradas.slice(0, 40).map((n) => listCardHtml({
        go: `fiscal/${n.id}`,
        title: asText(n.numero || n.nNF || `#${n.id}`),
        value: formatMoney(n.valor_total ?? n.total ?? 0),
        status: n.status || n.situacao
      })).join('') || emptyHtml('Sem notas')}</div>
    `;
    bindGo(root.querySelector('#rel-body'));
  } catch (err) {
    root.querySelector('#rel-body').innerHTML = errorHtml(err.message, err.status);
  }
}

async function loadTab(root, tab) {
  const p = readPeriodo(root);
  if (tab === 'financeiro') return renderFinanceiro(root, p);
  if (tab === 'vendas') return renderVendas(root, p);
  if (tab === 'comercial') return renderComercial(root, p);
  if (tab === 'estoque') return renderEstoque(root);
  if (tab === 'fiscal') return renderFiscal(root, p);
  if (tab === 'compras') {
    root.querySelector('#rel-body').innerHTML = `
      <p class="cds-muted">Use a listagem de Compras e Central de Entradas para análise operacional.</p>
      <button type="button" class="cds-mobile-btn" data-go="compras">Abrir Compras</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="central-entradas" style="margin-top:8px;width:100%">Central Entradas</button>
    `;
    bindGo(root.querySelector('#rel-body'));
  }
}

export async function render(root) {
  const p = periodoPadrao();
  let tab = 'financeiro';
  root.innerHTML = `
    ${backBarHtml('Mais')}
    <h2 class="cds-page-title" style="font-size:1.15rem;margin:8px 0">Relatórios</h2>
    ${filtrosHtml(p)}
    <div id="rel-tabs">${tabsHtml([
      { id: 'financeiro', label: 'Financeiro' },
      { id: 'vendas', label: 'Vendas' },
      { id: 'comercial', label: 'Comercial' },
      { id: 'estoque', label: 'Estoque' },
      { id: 'fiscal', label: 'Fiscal' },
      { id: 'compras', label: 'Compras' }
    ], tab)}</div>
    <div id="rel-body">${loadingHtml()}</div>
  `;
  bindBack(root);

  const refreshTabs = () => {
    root.querySelector('#rel-tabs').innerHTML = tabsHtml([
      { id: 'financeiro', label: 'Financeiro' },
      { id: 'vendas', label: 'Vendas' },
      { id: 'comercial', label: 'Comercial' },
      { id: 'estoque', label: 'Estoque' },
      { id: 'fiscal', label: 'Fiscal' },
      { id: 'compras', label: 'Compras' }
    ], tab);
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.getAttribute('data-tab');
        refreshTabs();
        loadTab(root, tab);
      });
    });
  };
  refreshTabs();
  root.querySelector('#rel-aplicar')?.addEventListener('click', () => loadTab(root, tab));
  await loadTab(root, tab);
}

export default { render, title: 'Relatórios', subtitle: 'Análises' };
