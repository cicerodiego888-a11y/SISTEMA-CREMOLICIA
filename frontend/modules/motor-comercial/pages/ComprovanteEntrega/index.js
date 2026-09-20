/**
 * Resumo Inteligente da Entrega — renderiza Snapshot do Motor de Comprovantes.
 * RCM-04.4 — sem cálculos no frontend.
 *
 * @module frontend/modules/motor-comercial/pages/ComprovanteEntrega
 */

const DashboardLayout = require('../../components/layouts/DashboardLayout');
const Button = require('../../components/base/Button');
const Loading = require('../../components/base/Loading');
const Alert = require('../../components/base/Alert');
const MotorComercialApi = require('../../api/MotorComercialApi');
const {
  notify,
  navigate,
  withLoading
} = require('../../utils/operacional');
const {
  parseCliente360Context,
  routeWithActiveContext,
  buildRouteWithCliente360Context
} = require('../../utils/cliente360Context');

function money(v) {
  const n = Number(v);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

class ComprovanteEntregaPage {
  constructor(consignacaoId, query = {}) {
    this.consignacaoId = consignacaoId;
    this.query = query || {};
    this.navigationContext = parseCliente360Context(query);
    this.api = new MotorComercialApi();
    this.comprovante = null;
    this.error = null;
    this.root = null;
  }

  static create(consignacaoId, query = {}) {
    const page = new ComprovanteEntregaPage(consignacaoId, query);
    return page.render();
  }

  render() {
    this._ensureStyles();
    const layout = DashboardLayout.create({
      header: this._createHeader(),
      content: this._createContentHost()
    });
    this.root = layout;
    setTimeout(() => this._load(), 0);
    return layout;
  }

  _ensureStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('cds-comprovante-entrega-css')) return;
    const style = document.createElement('style');
    style.id = 'cds-comprovante-entrega-css';
    style.textContent = `
      .cds-comprovante-entrega{display:flex;flex-direction:column;gap:16px;padding:8px 0 32px}
      .cds-comp-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px}
      .cds-comp-card--head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
      .cds-comp-kicker{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}
      .cds-comp-status{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700}
      .cds-comp-status--VERDE{background:#dcfce7;color:#166534}
      .cds-comp-status--AMARELO{background:#fef9c3;color:#854d0e}
      .cds-comp-status--VERMELHO{background:#fee2e2;color:#991b1b}
      .cds-comp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;font-size:13px;color:#374151}
      .cds-comp-table{width:100%;border-collapse:collapse;font-size:13px}
      .cds-comp-table th,.cds-comp-table td{border-bottom:1px solid #e5e7eb;padding:8px 6px;text-align:left}
      .cds-comp-foot{display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;font-size:13px}
      .cds-comp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
    `;
    document.head.appendChild(style);
  }

  _createHeader() {
    const header = document.createElement('header');
    header.className = 'cds-page-header';
    header.innerHTML = `
      <div>
        <h1>Resumo Inteligente da Entrega</h1>
        <p class="cds-muted">Comprovante oficial gerado pelo Motor de Comprovantes</p>
      </div>
    `;
    return header;
  }

  _createContentHost() {
    const host = document.createElement('div');
    host.id = 'comprovante-entrega-root';
    host.className = 'cds-comprovante-entrega';
    host.appendChild(Loading.create({ message: 'Carregando comprovante…' }));
    return host;
  }

  async _load() {
    const host = (this.root && this.root.querySelector)
      ? this.root.querySelector('#comprovante-entrega-root')
      : document.getElementById('comprovante-entrega-root');
    if (!host) return;
    try {
      this.comprovante = await withLoading('Montando comprovante…', () =>
        this.api.obterComprovanteEntrega(this.consignacaoId)
      );
      this.error = null;
      this._renderSnapshot(host);
    } catch (err) {
      this.error = err;
      host.innerHTML = '';
      host.appendChild(Alert.create({
        variant: 'error',
        title: 'Falha ao carregar comprovante',
        message: err?.message || 'Erro desconhecido'
      }));
    }
  }

  _renderSnapshot(host) {
    const c = this.comprovante;
    const snap = c.snapshot || c;
    const h = snap.cabecalho || {};
    const prod = snap.cards?.produtos || {};
    const sit = snap.cards?.situacaoComercial || {};
    const hist = snap.cards?.historico || {};
    const obs = snap.cards?.observacoes || {};
    const status = sit.statusComercial || snap.indicadores?.statusCredito || '—';

    host.innerHTML = `
      <section class="cds-comp-card cds-comp-card--head">
        <div>
          <div class="cds-comp-kicker">${this._esc(h.empresaNome || h.empresa || '')}</div>
          <h2>Comprovante ${this._esc(h.numeroComprovante || snap.numeroComprovante || '')}</h2>
          <p>${this._esc(h.data || '')} ${this._esc(h.hora || '')} · Vendedor: ${this._esc(h.vendedor || '—')}</p>
        </div>
        <span class="cds-comp-status cds-comp-status--${this._esc(status)}">${this._esc(status)}</span>
      </section>

      <section class="cds-comp-card">
        <h3>Cliente</h3>
        <p><strong>${this._esc(h.clienteNome || h.cliente || '—')}</strong></p>
        <p>Código ${this._esc(h.clienteCodigo || '—')} · Doc ${this._esc(h.clienteDocumento || '—')}</p>
        <p>Rota ${this._esc(h.rota || '—')} · Veículo ${this._esc(h.veiculo || '—')}</p>
      </section>

      <section class="cds-comp-card">
        <h3>Produtos</h3>
        <div class="cds-comp-table-wrap">
          <table class="cds-comp-table">
            <thead><tr><th>Produto</th><th>Qtd</th><th>Un</th><th>Preço</th><th>Total</th></tr></thead>
            <tbody>
              ${(prod.itens || []).map((i) => `
                <tr>
                  <td>${this._esc(i.produto)}</td>
                  <td>${this._esc(i.quantidade)}</td>
                  <td>${this._esc(i.unidade)}</td>
                  <td>${money(i.preco)}</td>
                  <td>${money(i.total)}</td>
                </tr>`).join('') || '<tr><td colspan="5">Sem itens</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="cds-comp-foot">
          <span>Qtd total: <strong>${this._esc(prod.quantidadeTotal)}</strong></span>
          <span>Volumes: <strong>${this._esc(prod.volumes)}</strong></span>
          <span>Valor: <strong>${money(prod.valorComercial)}</strong></span>
        </div>
      </section>

      <section class="cds-comp-card">
        <h3>Situação Comercial</h3>
        <div class="cds-comp-grid">
          <div>Saldo anterior<br><strong>${money(sit.saldoAnterior)}</strong></div>
          <div>Nova remessa<br><strong>${money(sit.novaRemessa)}</strong></div>
          <div>Saldo atual<br><strong>${money(sit.saldoAtual)}</strong></div>
          <div>Limite<br><strong>${money(sit.limite)}</strong></div>
          <div>Crédito disponível<br><strong>${money(sit.creditoDisponivel)}</strong></div>
          <div>Abertas<br><strong>${this._esc(sit.consignacoesAbertas)}</strong></div>
          <div>Valor em aberto<br><strong>${money(sit.valorEmAberto)}</strong></div>
        </div>
      </section>

      <section class="cds-comp-card">
        <h3>Histórico</h3>
        <div class="cds-comp-grid">
          <div>Última entrega<br><strong>${this._esc(hist.ultimaEntrega || '—')}</strong></div>
          <div>Última prestação<br><strong>${this._esc(hist.ultimaPrestacao || '—')}</strong></div>
          <div>Maior remessa<br><strong>${money(hist.maiorRemessa)}</strong></div>
          <div>Média remessas<br><strong>${money(hist.mediaRemessas)}</strong></div>
          <div>Perdas empresa<br><strong>${money(hist.perdasEmpresa)}</strong></div>
          <div>Perdas cliente<br><strong>${money(hist.perdasCliente)}</strong></div>
          <div>Índice perdas<br><strong>${this._esc(hist.indicePerdas != null ? `${hist.indicePerdas}%` : '—')}</strong></div>
        </div>
      </section>

      <section class="cds-comp-card">
        <h3>Observações</h3>
        <p>${this._esc(obs.entrega || '—')}</p>
      </section>

      <section class="cds-comp-card" id="comp-share-actions"></section>
      <section class="cds-comp-card" id="comp-nav-actions"></section>
    `;

    this._bindShareActions(host.querySelector('#comp-share-actions'));
    this._bindNavActions(host.querySelector('#comp-nav-actions'));
  }

  _bindShareActions(container) {
    if (!container) return;
    container.innerHTML = '<h3>Enviar ao consignatário</h3>';
    const row = document.createElement('div');
    row.className = 'cds-comp-actions';

    const cards = this.comprovante?.cards
      || this.comprovante?.snapshot?.cards
      || {};
    let botoes = cards.compartilhamento?.botoes || [];
    if (!botoes.length) {
      botoes = [
        { id: 'whatsapp', label: 'Enviar ao consignatário (WhatsApp)', icone: '📱', habilitado: true },
        { id: 'copiar', label: 'Copiar Resumo', icone: '📋', habilitado: true },
        { id: 'pdf', label: 'Gerar PDF', icone: '📄', habilitado: true },
        { id: 'imprimir', label: 'Imprimir', icone: '🖨️', habilitado: true }
      ];
    }
    botoes.forEach((btn) => {
      if (btn.estrutura && !btn.habilitado) {
        row.appendChild(Button.create({
          text: `${btn.icone || ''} ${btn.label}`.trim(),
          variant: 'ghost',
          onClick: () => notify('Disponível em breve.', 'info')
        }));
        return;
      }
      row.appendChild(Button.create({
        text: `${btn.icone || ''} ${btn.label}`.trim(),
        variant: btn.id === 'whatsapp' ? 'primary' : 'secondary',
        onClick: () => this._onShare(btn.id)
      }));
    });
    container.appendChild(row);
  }

  _bindNavActions(container) {
    if (!container) return;
    container.innerHTML = '<h3>Próximos passos</h3>';
    const row = document.createElement('div');
    row.className = 'cds-comp-actions';
    row.appendChild(Button.create({
      text: 'Nova Entrega',
      variant: 'primary',
      onClick: () => navigate(buildRouteWithCliente360Context('/consignacoes/nova', this.navigationContext))
    }));
    row.appendChild(Button.create({
      text: 'Voltar',
      variant: 'secondary',
      onClick: () => navigate(routeWithActiveContext('/consignacoes', this.navigationContext))
    }));
    row.appendChild(Button.create({
      text: 'Reimprimir',
      variant: 'ghost',
      onClick: () => this._onShare('imprimir')
    }));
    row.appendChild(Button.create({
      text: 'Compartilhar Novamente',
      variant: 'ghost',
      onClick: () => this._onShare('whatsapp')
    }));
    container.appendChild(row);
  }

  async _audit(acao) {
    try {
      await this.api.registrarAcaoComprovante(this.consignacaoId, {
        acao,
        comprovanteId: this.comprovante?.id,
        numeroComprovante: this.comprovante?.numeroComprovante
      });
    } catch (_e) { /* não bloqueia UX */ }
  }

  async _onShare(acao) {
    const texto = this.comprovante?.textoCompartilhavel || this.comprovante?.snapshot?.textoCompartilhavel || '';
    const pdf = this.comprovante?.pdf || this.comprovante?.snapshot?.pdf;

    if (acao === 'copiar') {
      await navigator.clipboard.writeText(texto);
      await this._audit('resumo_copiado');
      notify('Resumo copiado com sucesso.', 'success');
      return;
    }

    if (acao === 'whatsapp') {
      await this._audit('whatsapp');
      const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
      window.open(url, '_blank');
      if (pdf?.base64) {
        this._downloadPdf(pdf);
      }
      return;
    }

    if (acao === 'pdf') {
      await this._audit('pdf');
      this._downloadPdf(pdf);
      notify('PDF gerado a partir do snapshot oficial.', 'success');
      return;
    }

    if (acao === 'imprimir') {
      await this._audit('impressao');
      const html = pdf?.html || '';
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 300);
      }
      return;
    }

    notify('Ação em estrutura (próximas RCs).', 'info');
  }

  _downloadPdf(pdf) {
    if (!pdf?.base64) {
      notify('PDF indisponível no snapshot.', 'warning');
      return;
    }
    const bin = atob(pdf.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: pdf.contentType || 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = pdf.fileName || 'comprovante-entrega.pdf';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  _esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

module.exports = ComprovanteEntregaPage;
