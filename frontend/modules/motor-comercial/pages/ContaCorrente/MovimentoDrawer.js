/**
 * MovimentoDrawer — Detalhe de movimentação do extrato.
 *
 * Sprint O-6 / fix UX: sem JSON cru; eventos filtrados por correlationId.
 *
 * @module frontend/modules/motor-comercial/pages/ContaCorrente/MovimentoDrawer
 */

const Button = require('../../components/base/Button');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Timeline = require('../../components/special/Timeline');
const { navigate } = require('../../utils/operacional');

function txt(value, fallback = '-') {
  if (value == null || value === '' || value === '-') return fallback;
  return String(value);
}

function dedupeEventos(events = []) {
  const seen = new Set();
  return events.filter((ev) => {
    const key = [
      ev.id ?? '',
      ev.tipo ?? '',
      ev.data ?? '',
      ev.correlationId ?? '',
      ev.valor ?? ''
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

class MovimentoDrawer {
  constructor(page, movimento) {
    this.page = page;
    this.movimento = movimento;
  }

  async mount(container) {
    container.className = 'cds-extrato-drawer';
    container.appendChild(Loading.create({ message: 'Carregando movimentação...' }));

    try {
      const content = await this._render();
      container.innerHTML = '';
      container.appendChild(content);
    } catch (error) {
      container.innerHTML = '';
      container.appendChild(EmptyState.create({ title: 'Erro', description: error.message }));
    }
  }

  _campo(label, value) {
    const div = document.createElement('div');
    const lab = document.createElement('label');
    lab.textContent = label;
    const val = document.createElement('div');
    val.textContent = value;
    div.appendChild(lab);
    div.appendChild(val);
    return div;
  }

  async _render() {
    const row = this.movimento;
    const mov = row.raw || row;
    const correlationId = row.correlationId && row.correlationId !== '-'
      ? row.correlationId
      : (mov.correlationId || null);
    const consignacaoId = mov.consignacaoId ?? row.documento?.match?.(/#(\d+)/)?.[1] ?? null;
    const ids = Array.isArray(mov.ids) && mov.ids.length
      ? mov.ids
      : (mov.id != null ? [mov.id] : []);
    const itens = Number(mov.itensAgrupados || ids.length || 1);
    const saldoApos = mov.saldoProjetado ?? mov.saldoApos ?? row.saldoProjetado;

    const params = {
      consignacaoId: consignacaoId || undefined,
      clienteId: this.page.clienteId || undefined,
      limite: 30
    };

    const timelineRaw = await this.page.projectionApi.listarTimeline(params).catch(() => []);
    let relacionados = Array.isArray(timelineRaw) ? timelineRaw : [];
    if (correlationId) {
      relacionados = relacionados.filter((ev) => String(ev.correlationId || '') === String(correlationId));
    } else if (ids.length) {
      const idSet = new Set(ids.map(String));
      relacionados = relacionados.filter((ev) => idSet.has(String(ev.id)));
    }
    relacionados = dedupeEventos(relacionados).slice(0, 12);

    const wrap = document.createElement('div');
    wrap.className = 'cds-extrato-drawer__content';

    const section = document.createElement('section');
    section.className = 'cds-extrato-drawer__section';
    const h4 = document.createElement('h4');
    h4.textContent = 'Movimentação';
    section.appendChild(h4);

    const grid = document.createElement('div');
    grid.className = 'cds-extrato-drawer__grid';
    [
      ['Tipo', txt(row.tipoLabel || mov.tipo || mov.tipoMovimentacao)],
      ['Descrição', txt(row.descricao || mov.descricao || mov.motivo)],
      ['Documento', txt(row.documento || (consignacaoId ? `Consignação #${consignacaoId}` : null))],
      ['Data', this.page._formatDateTime(row.data || mov.data || mov.dataMovimentacao)],
      ['Valor', this.page._formatCurrency(mov.valor ?? row.valor)],
      ['Saldo após', saldoApos != null ? this.page._formatCurrency(saldoApos) : '-'],
      ['Itens', String(itens)],
      ['Operador', txt(row.operador || mov.usuarioId)],
      ['Origem', txt(row.origem || mov.origem)],
      ['Código de rastreio', txt(correlationId)],
      ['Lançamento(s)', ids.length ? ids.join(', ') : '-']
    ].forEach(([label, value]) => grid.appendChild(this._campo(label, value)));
    section.appendChild(grid);
    wrap.appendChild(section);

    const timelineSection = document.createElement('section');
    timelineSection.className = 'cds-extrato-drawer__section';
    timelineSection.innerHTML = '<h4>Eventos relacionados</h4>';
    timelineSection.appendChild(Timeline.create({
      events: relacionados,
      emptyTitle: 'Sem eventos',
      emptyDescription: correlationId
        ? 'Nenhum evento com este código de rastreio'
        : 'Nenhum evento relacionado a este lançamento'
    }));
    wrap.appendChild(timelineSection);

    const actions = document.createElement('div');
    actions.className = 'cds-extrato-drawer__actions';
    if (consignacaoId) {
      actions.appendChild(Button.create({
        text: 'Abrir Consignação',
        variant: 'primary',
        onClick: () => navigate(`/consignacoes/${consignacaoId}/prestacao`)
      }));
      actions.appendChild(Button.create({
        text: 'Conta Corrente',
        variant: 'secondary',
        onClick: () => navigate(`/consignacoes/${consignacaoId}/prestacao/conta-corrente`)
      }));
    }
    if (this.page.clienteId) {
      actions.appendChild(Button.create({
        text: 'Central do Cliente',
        variant: 'ghost',
        onClick: () => navigate(`/clientes/${this.page.clienteId}`)
      }));
    }
    wrap.appendChild(actions);

    return wrap;
  }
}

module.exports = MovimentoDrawer;
