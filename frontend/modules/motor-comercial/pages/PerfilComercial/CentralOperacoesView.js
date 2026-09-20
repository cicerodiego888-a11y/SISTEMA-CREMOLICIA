/**
 * Central de Operações do Cliente — Sprint UX-02.2
 *
 * Ficha operacional de atendimento (não dashboard).
 * Responde em < 5s: quem é, qual a situação, o que fazer agora.
 *
 * @module frontend/modules/motor-comercial/pages/PerfilComercial/CentralOperacoesView
 */

const Badge = require('../../components/base/Badge');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');

class CentralOperacoesView {
  /**
   * @param {Object} viewModel
   * @param {Object} ctx
   * @returns {HTMLElement}
   */
  static render(viewModel, ctx = {}) {
    const root = document.createElement('div');
    root.className = 'cds-ficha-cliente';
    root.id = 'central-operacoes-root';

    root.appendChild(CentralOperacoesView._renderCabecalho(viewModel.identificacao, ctx));

    if (viewModel.proximaAcao?.urgente) {
      root.appendChild(CentralOperacoesView._renderAlerta(viewModel.proximaAcao, ctx));
    }

    root.appendChild(CentralOperacoesView._renderAcoes(viewModel.acoesPrincipais, ctx));
    root.appendChild(CentralOperacoesView._renderSituacao(viewModel.situacaoCliente, ctx));
    root.appendChild(CentralOperacoesView._renderTimeline(
      viewModel.historico,
      viewModel.consignacoesHistorico,
      { ...ctx, historicoPaginacao: ctx.historicoPaginacao || viewModel.historicoPaginacao }
    ));

    return root;
  }

  static renderLoading() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-ficha-cliente cds-ficha-cliente--loading';
    wrap.appendChild(Loading.create({ message: 'Abrindo ficha do cliente...' }));
    return wrap;
  }

  /** 1) Quem é este cliente? */
  static _renderCabecalho(info = {}, ctx) {
    const header = document.createElement('header');
    header.className = 'cds-ficha-cliente__cabecalho';

    const statusVariant = info.status === 'Bloqueado' ? 'error'
      : (info.status === 'Inativo' ? 'warning' : 'success');

    const caps = (info.capacidades || []).length
      ? info.capacidades.map((c) => `<span class="cds-ficha-cliente__cap">${c}</span>`).join('')
      : '';

    header.innerHTML = `
      <div class="cds-ficha-cliente__cabecalho-topo">
        <button type="button" class="cds-ficha-cliente__voltar" data-action="voltar">← Clientes</button>
        <button type="button" class="cds-ficha-cliente__atualizar" data-action="atualizar" title="Atualizar">↻</button>
      </div>
      <div class="cds-ficha-cliente__identidade">
        <div class="cds-ficha-cliente__nome-row">
          <h1 class="cds-ficha-cliente__nome">${info.nome || '—'}</h1>
          <span class="cds-ficha-cliente__status-host"></span>
        </div>
        <div class="cds-ficha-cliente__meta">
          <span>${info.documento || '—'}</span>
          <span class="cds-ficha-cliente__meta-sep">·</span>
          <span>${info.cidade || '—'}</span>
          <span class="cds-ficha-cliente__meta-sep">·</span>
          <span>${info.telefone || '—'}</span>
          ${info.whatsapp && info.whatsapp !== '—' && info.whatsapp !== info.telefone
            ? `<span class="cds-ficha-cliente__meta-sep">·</span><span>WhatsApp ${info.whatsapp}</span>`
            : ''}
        </div>
        ${caps ? `<div class="cds-ficha-cliente__caps">${caps}</div>` : ''}
      </div>
    `;

    const statusHost = header.querySelector('.cds-ficha-cliente__status-host');
    statusHost.appendChild(Badge.create({ text: info.status || 'Ativo', variant: statusVariant }));

    header.querySelector('[data-action="voltar"]').addEventListener('click', () => {
      if (ctx.onVoltar) ctx.onVoltar();
    });
    header.querySelector('[data-action="atualizar"]').addEventListener('click', () => {
      if (ctx.onAtualizar) ctx.onAtualizar();
    });

    return header;
  }

  /** Alerta compacto — só quando urgente */
  static _renderAlerta(acao = {}, ctx) {
    const alert = document.createElement('div');
    alert.className = `cds-ficha-cliente__alerta cds-ficha-cliente__alerta--${acao.nivel || 'warning'}`;
    alert.id = 'sec-proxima-acao';
    alert.setAttribute('role', 'status');

    alert.innerHTML = `
      <span class="cds-ficha-cliente__alerta-icone" aria-hidden="true">${acao.icone || '⚠'}</span>
      <div class="cds-ficha-cliente__alerta-texto">
        <strong>${acao.titulo || 'Atenção'}</strong>
        <span>${acao.descricao || ''}</span>
      </div>
      <button type="button" class="cds-ficha-cliente__alerta-cta">${acao.acaoLabel || 'Resolver'}</button>
    `;

    alert.querySelector('.cds-ficha-cliente__alerta-cta').addEventListener('click', () => {
      if (ctx.onProximaAcao) ctx.onProximaAcao(acao);
    });

    return alert;
  }

  /** 3) O que desejo fazer agora? */
  static _renderAcoes(acoes = [], ctx) {
    const section = document.createElement('section');
    section.className = 'cds-ficha-cliente__acoes';
    section.id = 'sec-acoes-principais';

    section.innerHTML = `<h2 class="cds-ficha-cliente__secao-titulo">O que deseja fazer?</h2>`;

    const grid = document.createElement('div');
    grid.className = 'cds-ficha-cliente__acoes-grid';

    acoes.forEach((acao) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cds-ficha-cliente__acao${acao.destaque ? ' cds-ficha-cliente__acao--destaque' : ''}`;
      btn.innerHTML = `
        <span class="cds-ficha-cliente__acao-icon" aria-hidden="true">${acao.icon}</span>
        <span class="cds-ficha-cliente__acao-label">${acao.label}</span>
      `;
      btn.addEventListener('click', () => {
        if (ctx.onAcaoPrincipal) ctx.onAcaoPrincipal(acao);
      });
      grid.appendChild(btn);
    });

    section.appendChild(grid);
    return section;
  }

  /** 2) Qual a situação comercial? */
  static _renderSituacao(situacao = {}, ctx) {
    const section = document.createElement('section');
    section.className = 'cds-ficha-cliente__situacao';
    section.id = 'sec-situacao';

    const fmt = (v) => (ctx.formatCurrency ? ctx.formatCurrency(v) : String(v ?? '—'));
    const fmtDate = (v) => (v && ctx.formatDate ? ctx.formatDate(v) : '—');

    const proximo = situacao.proximoAcerto;
    const proximoLabel = proximo
      ? (proximo.data
        ? fmtDate(proximo.data)
        : (proximo.documento ? `Consignação ${proximo.documento}` : 'Pendente'))
      : '—';

    const itens = [
      { label: 'Limite Comercial', value: fmt(situacao.limiteComercial), key: 'limite' },
      { label: 'Crédito Utilizado', value: fmt(situacao.creditoUtilizado), key: 'utilizado' },
      { label: 'Crédito Disponível', value: fmt(situacao.creditoDisponivel), key: 'disponivel', destaque: true },
      { label: 'Consignações em Aberto', value: String(situacao.consignacoesAbertas ?? 0), key: 'consignacoes' },
      {
        label: 'Pendências',
        value: String(situacao.pendencias ?? 0),
        key: 'pendencias',
        alerta: Number(situacao.pendencias) > 0
      },
      { label: 'Próximo Acerto', value: proximoLabel, key: 'proximo' },
      { label: 'Última Entrega', value: fmtDate(situacao.ultimaEntrega), key: 'entrega' },
      { label: 'Último Acerto', value: fmtDate(situacao.ultimoAcerto), key: 'acerto' }
    ];

    section.innerHTML = `<h2 class="cds-ficha-cliente__secao-titulo">Situação do Cliente</h2>`;

    const grid = document.createElement('div');
    grid.className = 'cds-ficha-cliente__situacao-grid';

    itens.forEach((item) => {
      const cell = document.createElement('div');
      cell.className = 'cds-ficha-cliente__metric';
      if (item.destaque) cell.classList.add('cds-ficha-cliente__metric--destaque');
      if (item.alerta) cell.classList.add('cds-ficha-cliente__metric--alerta');
      cell.innerHTML = `
        <span class="cds-ficha-cliente__metric-label">${item.label}</span>
        <span class="cds-ficha-cliente__metric-value">${item.value}</span>
      `;
      grid.appendChild(cell);
    });

    section.appendChild(grid);
    return section;
  }

  /** Histórico: consignações + linha do tempo */
  static _renderTimeline(itens = [], consignacoes = [], ctx = {}) {
    const section = document.createElement('section');
    section.className = 'cds-ficha-cliente__timeline-wrap';
    section.id = 'sec-historico';

    section.appendChild(CentralOperacoesView._renderConsignacoes(
      consignacoes,
      ctx,
      ctx.historicoPaginacao || {}
    ));

    const movTitle = document.createElement('h2');
    movTitle.className = 'cds-ficha-cliente__secao-titulo';
    movTitle.textContent = 'Últimas movimentações';
    section.appendChild(movTitle);

    if (!itens.length) {
      section.appendChild(EmptyState.create({
        title: 'Sem movimentações',
        description: 'Nenhum evento recente para este cliente'
      }));
      return section;
    }

    const list = document.createElement('ul');
    list.className = 'cds-ficha-cliente__timeline';

    itens.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'cds-ficha-cliente__timeline-item';
      li.innerHTML = `
        <time class="cds-ficha-cliente__timeline-quando">${item.periodo}</time>
        <span class="cds-ficha-cliente__timeline-o-que">${item.descricao}</span>
      `;
      list.appendChild(li);
    });

    section.appendChild(list);
    return section;
  }

  static _renderConsignacoes(consignacoes = [], ctx = {}, paginacao = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-ficha-cliente__consignacoes';
    wrap.id = 'sec-historico-consignacoes';

    const title = document.createElement('h2');
    title.className = 'cds-ficha-cliente__secao-titulo';
    title.textContent = 'CONSIGNAÇÕES';
    wrap.appendChild(title);

    const total = Number(paginacao.total);
    const carregadas = consignacoes.length;
    if (Number.isFinite(total) && total > 0) {
      const meta = document.createElement('p');
      meta.className = 'cds-ficha-cliente__consignacoes-pagina';
      meta.textContent = `Mostrando ${carregadas} de ${total}`;
      wrap.appendChild(meta);
    }

    if (!consignacoes.length) {
      wrap.appendChild(EmptyState.create({
        title: 'Nenhuma consignação',
        description: 'Quando houver operações, elas aparecerão aqui em qualquer status'
      }));
      return wrap;
    }

    const fmt = (v) => (ctx.formatCurrency ? ctx.formatCurrency(v) : String(v ?? '—'));
    const fmtDate = (v) => (v && ctx.formatDate ? ctx.formatDate(v) : '—');

    const list = document.createElement('div');
    list.className = 'cds-ficha-cliente__consignacoes-lista';

    consignacoes.forEach((row) => {
      const card = document.createElement('article');
      card.className = 'cds-ficha-cliente__consignacao-card';
      card.dataset.consignacaoId = String(row.id);
      card.innerHTML = `
        <div class="cds-ficha-cliente__consignacao-numero">${row.numero}</div>
        <div class="cds-ficha-cliente__consignacao-meta">${fmtDate(row.data)} · ${row.statusLabel}</div>
        <div class="cds-ficha-cliente__consignacao-resumo">${row.quantidadeItens} itens · ${fmt(row.valorTotal)}</div>
        <div class="cds-ficha-cliente__consignacao-atualizacao">Última atualização: ${fmtDate(row.atualizadoEm)}</div>
        <div class="cds-ficha-cliente__consignacoes-acoes"></div>
      `;
      const acoes = card.querySelector('.cds-ficha-cliente__consignacoes-acoes');
      const ver = document.createElement('button');
      ver.type = 'button';
      ver.className = 'cds-ficha-cliente__mini-btn';
      ver.textContent = 'Visualizar';
      ver.addEventListener('click', () => ctx.onVisualizarConsignacao && ctx.onVisualizarConsignacao(row));
      const reprint = document.createElement('button');
      reprint.type = 'button';
      reprint.className = 'cds-ficha-cliente__mini-btn cds-ficha-cliente__mini-btn--primary';
      reprint.textContent = 'Reimprimir';
      reprint.addEventListener('click', () => ctx.onReimprimirConsignacao && ctx.onReimprimirConsignacao(row));
      acoes.appendChild(ver);
      acoes.appendChild(reprint);
      list.appendChild(card);
    });

    wrap.appendChild(list);

    if (paginacao.hasMore) {
      const mais = document.createElement('button');
      mais.type = 'button';
      mais.className = 'cds-ficha-cliente__carregar-mais';
      mais.disabled = !!paginacao.loading;
      mais.textContent = paginacao.loading ? 'Carregando...' : 'Carregar mais';
      mais.addEventListener('click', () => {
        if (ctx.onCarregarMaisConsignacoes) ctx.onCarregarMaisConsignacoes();
      });
      wrap.appendChild(mais);
    }

    return wrap;
  }
}

module.exports = CentralOperacoesView;
