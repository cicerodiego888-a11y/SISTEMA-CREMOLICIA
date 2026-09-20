/**
 * RCM-8.7 — Entrega Complementar (UI).
 *
 * Fluxo próprio: consignação ENTREGUE → adicionar produtos → confirmar.
 * Não reabre RASCUNHO nem reprocessa a entrega original.
 *
 * @module frontend/modules/motor-comercial/pages/EntregaComplementar
 */

const Workspace = require('../../../../shared/ui/Workspace');
const Button = require('../../components/base/Button');
const Loading = require('../../components/base/Loading');
const Alert = require('../../components/base/Alert');
const EmptyState = require('../../components/base/EmptyState');
const LIP = require('../../../../shared/components/LIP');
const MotorComercialApi = require('../../api/MotorComercialApi');
const {
  notify,
  navigate,
  withLoading,
  confirmDialog,
  getUsuarioId,
  carregarConsignacaoCompleta
} = require('../../utils/operacional');
const ProjectionApi = require('../../api/ProjectionApi');
const {
  parseNavigationContext,
  resolveBackPath,
  routeWithActiveContext,
  getBackButtonLabel
} = require('../../utils/cliente360Context');
const { formatDocumento } = require('../../api/helpers');
const {
  podeAdicionarProdutoComplementar,
  totalItensComplementares,
  snapshotDoResolver,
  MENSAGEM_PRESTACAO_ENCERRADA
} = require('./entregaComplementarMappers');

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

class EntregaComplementarPage {
  constructor(consignacaoId, routeQuery = {}) {
    this.consignacaoId = consignacaoId;
    this.routeQuery = routeQuery;
    this.navigationContext = parseNavigationContext(routeQuery);
    this.api = new MotorComercialApi();
    this.projectionApi = new ProjectionApi();
    this.consignacao = null;
    this.entregas = [];
    this.itensNovos = [];
    this.loading = true;
    this.error = null;
    this.confirmando = false;
    this.lipInstance = null;
    this.root = null;
  }

  static create(consignacaoId, query = {}) {
    const page = new EntregaComplementarPage(consignacaoId, query);
    return page.render();
  }

  render() {
    this.root = Workspace.create({
      variant: 'station',
      className: 'cds-entrega-complementar-workspace',
      header: Workspace.Header.create({
        title: 'ENTREGA COMPLEMENTAR',
        subtitle: 'Adicionar produtos à consignação entregue',
        context: this._headerContext(),
        onBack: () => this._voltar()
      }),
      body: Workspace.Body.create({
        children: this._shell(),
        scroll: true,
        className: 'cds-entrega-complementar__body'
      }),
      footer: Workspace.Footer.create({
        left: [
          Button.create({
            text: getBackButtonLabel(this.navigationContext, 'Voltar'),
            variant: 'ghost',
            onClick: () => this._voltar()
          })
        ],
        right: [
          Button.create({
            text: 'Confirmar Entrega Complementar',
            variant: 'primary',
            disabled: true,
            onClick: () => this._confirmar()
          })
        ]
      })
    });
    this.root.id = 'entrega-complementar-root';
    this.root.dataset.rcm = '8.7';

    setTimeout(() => this._load(), 0);
    return this.root;
  }

  _headerContext() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-entrega-complementar__context';
    wrap.innerHTML = `
      <span>Consignação: <strong id="ec-doc">—</strong></span>
      <span>Cliente: <strong id="ec-cliente">—</strong></span>
    `;
    return wrap;
  }

  _shell() {
    const shell = document.createElement('div');
    shell.id = 'entrega-complementar-content';
    shell.className = 'cds-entrega-complementar__conteudo';
    shell.appendChild(Loading.create({ message: 'Carregando consignação...' }));
    return shell;
  }

  async _load() {
    this.loading = true;
    this._patchContent(Loading.create({ message: 'Carregando consignação...' }));
    try {
      const [completa, entregasPayload] = await Promise.all([
        carregarConsignacaoCompleta(this.api, this.projectionApi, this.consignacaoId),
        this.api.consultarEntregasConsignacao(this.consignacaoId).catch(() => null)
      ]);
      this.consignacao = completa;
      this.entregas = entregasPayload?.entregas || [];
      this.error = null;

      const check = podeAdicionarProdutoComplementar(completa);
      if (!check.elegivel) {
        this.error = new Error(check.mensagem || MENSAGEM_PRESTACAO_ENCERRADA);
      }
    } catch (error) {
      this.error = error;
    } finally {
      this.loading = false;
      this._renderContent();
      this._updateHeader();
      this._updateFooter();
    }
  }

  _updateHeader() {
    const doc = this.root?.querySelector('#ec-doc');
    const cliente = this.root?.querySelector('#ec-cliente');
    const c = this.consignacao || {};
    if (doc) {
      doc.textContent = formatDocumento(c.documento, c.id || this.consignacaoId);
    }
    if (cliente) {
      cliente.textContent = c.clienteNome || c.cliente || c.cliente?.nome || '—';
    }
  }

  _patchContent(node) {
    const host = this.root?.querySelector('#entrega-complementar-content');
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(node);
  }

  _renderContent() {
    const host = this.root?.querySelector('#entrega-complementar-content');
    if (!host) return;
    host.innerHTML = '';

    if (this.loading) {
      host.appendChild(Loading.create({ message: 'Carregando consignação...' }));
      return;
    }

    if (this.error) {
      host.appendChild(Alert.create({
        message: this.error.message,
        variant: 'error',
        dismissible: false
      }));
      host.appendChild(Button.create({
        text: 'Voltar à consignação',
        variant: 'secondary',
        onClick: () => this._voltar()
      }));
      return;
    }

    if (!this.consignacao) {
      host.appendChild(EmptyState.create({
        title: 'Consignação não encontrada'
      }));
      return;
    }

    const intro = document.createElement('div');
    intro.className = 'cds-entrega-complementar__intro';
    intro.innerHTML = `
      <h2>ENTREGA COMPLEMENTAR</h2>
      <p>Consignação: <strong>${formatDocumento(this.consignacao.documento, this.consignacaoId)}</strong></p>
      <p>Cliente: <strong>${this.consignacao.clienteNome || this.consignacao.cliente || '—'}</strong></p>
      <p class="cds-caption">A entrega original não será reaberta nem reprocessada. Somente os novos itens serão movimentados.</p>
    `;
    host.appendChild(intro);

    host.appendChild(this._renderHistorico());

    const addSection = document.createElement('section');
    addSection.className = 'cds-entrega-complementar__add';
    addSection.innerHTML = '<h3>+ Adicionar produto</h3><div id="ec-lip-host"></div>';
    host.appendChild(addSection);

    host.appendChild(this._renderItensNovos());

    requestAnimationFrame(() => this._mountLip());
  }

  _renderHistorico() {
    const section = document.createElement('section');
    section.className = 'cds-entrega-complementar__historico';
    section.innerHTML = '<h3>Entregas da consignação</h3>';

    if (!this.entregas.length) {
      const itens = this.consignacao.itens || [];
      section.appendChild(this._blocoEntrega({
        label: 'Entrega Original',
        dataHora: this.consignacao.dataEntrega,
        itens: itens.map((i) => ({
          produtoNome: i.produtoNome || i.produto || i.produtoId,
          quantidade: i.quantidadeEntregue ?? i.quantidade,
          valor: (Number(i.quantidadeEntregue ?? i.quantidade ?? 0) * Number(i.precoUnitario || i.preco || 0))
        })),
        valorTotal: itens.reduce((s, i) => s + (
          Number(i.quantidadeEntregue ?? i.quantidade ?? 0) * Number(i.precoUnitario || i.preco || 0)
        ), 0)
      }));
      return section;
    }

    this.entregas.forEach((ev) => {
      section.appendChild(this._blocoEntrega({
        label: ev.label,
        dataHora: ev.dataHora,
        itens: ev.itens || [],
        valorTotal: ev.valorTotal
      }));
    });

    const total = this.entregas.reduce((s, e) => s + Number(e.valorTotal || 0), 0);
    const tot = document.createElement('p');
    tot.className = 'cds-entrega-complementar__total';
    tot.innerHTML = `<strong>TOTAL CONSIGNAÇÃO</strong> ${formatCurrency(total)}`;
    section.appendChild(tot);
    return section;
  }

  _blocoEntrega({ label, dataHora, itens, valorTotal }) {
    const box = document.createElement('div');
    box.className = 'cds-entrega-complementar__evento';
    const when = dataHora
      ? new Date(dataHora).toLocaleString('pt-BR')
      : '—';
    box.innerHTML = `
      <header>
        <strong>${label}</strong>
        <span>${when}</span>
      </header>
      <ul>
        ${(itens || []).map((i) => `
          <li>
            <span>${i.produtoNome || i.produtoId || 'Produto'}</span>
            <span>${i.quantidade ?? 0}</span>
            <span>${formatCurrency(i.valor ?? ((i.quantidade || 0) * (i.precoUnitario || 0)))}</span>
          </li>
        `).join('') || '<li class="cds-caption">Sem itens</li>'}
      </ul>
      <footer>Subtotal: <strong>${formatCurrency(valorTotal)}</strong></footer>
    `;
    return box;
  }

  _renderItensNovos() {
    const section = document.createElement('section');
    section.className = 'cds-entrega-complementar__novos';
    section.id = 'ec-itens-novos';
    section.innerHTML = '<h3>Itens desta complementação</h3>';

    if (!this.itensNovos.length) {
      section.appendChild(EmptyState.create({
        title: 'Nenhum produto adicionado',
        description: 'Use a busca acima para incluir produtos com canal CONSIGNADO.'
      }));
      return section;
    }

    const list = document.createElement('div');
    list.className = 'cds-entrega-complementar__novos-lista';
    this.itensNovos.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'cds-entrega-complementar__novo-item';
      row.innerHTML = `
        <div>
          <strong>${item.produtoNome || item.produtoId}</strong>
          <span class="cds-caption">${item.unidadeComercial || 'UN'} · ${item.precoOrigem || 'Resolver'}</span>
        </div>
        <div>Qtd: ${item.quantidade}</div>
        <div>${formatCurrency(item.precoUnitario)}</div>
        <div>${formatCurrency(item.quantidade * item.precoUnitario)}</div>
      `;
      const rem = Button.create({
        text: 'Remover',
        variant: 'ghost',
        onClick: () => {
          this.itensNovos.splice(index, 1);
          this._renderContent();
          this._updateFooter();
        }
      });
      row.appendChild(rem);
      list.appendChild(row);
    });
    section.appendChild(list);

    const total = document.createElement('p');
    total.innerHTML = `<strong>Valor incremental:</strong> ${formatCurrency(totalItensComplementares(this.itensNovos))}`;
    section.appendChild(total);
    return section;
  }

  _mountLip() {
    const host = this.root?.querySelector('#ec-lip-host');
    if (!host) return;
    if (this.lipInstance?.destroy) this.lipInstance.destroy();
    this.lipInstance = LIP.create({
      onSelect: (produto, quantidade) => this._onProdutoSelecionado(produto, quantidade)
    });
    this.lipInstance.mount(host);
    this.lipInstance.focus();
  }

  async _onProdutoSelecionado(produto, quantidade) {
    if (!produto?.id) return;
    const qtd = Number(quantidade) > 0 ? Number(quantidade) : 1;
    try {
      await withLoading('Resolvendo preço (CONSIGNADO)…', async () => {
        const res = await this.api.resolverPrecosVenda(
          [{ produtoId: produto.id, quantidade: qtd, linhaComercialId: produto.linhaComercialId }],
          { canal: 'CONSIGNADO', documento: 'consignacao' }
        );
        const row = Array.isArray(res?.itens) ? res.itens[0] : (res?.data?.itens?.[0] || {});
        const snap = snapshotDoResolver(row, produto);
        this.itensNovos.push({
          produtoId: produto.id,
          produtoNome: produto.nome || produto.descricao || produto.codigo || String(produto.id),
          quantidade: qtd,
          ...snap
        });
      });
      this._renderContent();
      this._updateFooter();
    } catch (error) {
      notify(error.message || 'Falha ao resolver preço CONSIGNADO', 'error');
    }
  }

  _updateFooter() {
    if (!this.root) return;
    const pode = this.itensNovos.length > 0 && !this.confirmando && !this.error;
    Workspace.compose(this.root, {
      footer: Workspace.Footer.create({
        left: [
          Button.create({
            text: getBackButtonLabel(this.navigationContext, 'Voltar'),
            variant: 'ghost',
            onClick: () => this._voltar()
          })
        ],
        right: [
          Button.create({
            text: this.confirmando ? 'Confirmando…' : 'Confirmar Entrega Complementar',
            variant: 'primary',
            disabled: !pode,
            onClick: () => this._confirmar()
          })
        ]
      })
    });
  }

  async _confirmar() {
    if (!this.itensNovos.length || this.confirmando) return;
    const ok = await confirmDialog({
      title: 'Confirmar Entrega Complementar',
      message: `Confirma a complementação de ${this.itensNovos.length} produto(s) `
        + `(${formatCurrency(totalItensComplementares(this.itensNovos))})?\n\n`
        + 'Somente os novos itens serão movimentados no estoque e no Ledger.'
    });
    if (!ok) return;

    this.confirmando = true;
    this._updateFooter();
    try {
      const resultado = await withLoading('Registrando entrega complementar…', () =>
        this.api.registrarEntregaComplementar(this.consignacaoId, {
          itens: this.itensNovos.map((item) => ({
            produtoId: item.produtoId,
            quantidade: item.quantidade,
            precoUnitario: item.precoUnitario,
            unidadeComercial: item.unidadeComercial,
            linhaComercialId: item.linhaComercialId,
            tabelaPrecoId: item.tabelaPrecoId,
            canalVenda: 'CONSIGNADO',
            precoOrigem: item.precoOrigem,
            precoFallback: item.precoFallback
          })),
          usuarioId: getUsuarioId()
        })
      );
      notify(
        resultado?.idempotente
          ? 'Entrega complementar já registrada (idempotente).'
          : 'Entrega complementar confirmada.',
        'success'
      );
      this.itensNovos = [];
      const retorno = String(
        this.routeQuery?.retorno || this.routeQuery?.voltarPara || ''
      ).toLowerCase();
      const destino = retorno === 'prestacao'
        ? `/consignacoes/${this.consignacaoId}/prestacao`
        : `/consignacoes/${this.consignacaoId}`;
      await navigate(routeWithActiveContext(
        destino,
        this.navigationContext
      ));
    } catch (error) {
      const msg = error?.message || String(error);
      notify(msg, 'error');
    } finally {
      this.confirmando = false;
      this._updateFooter();
    }
  }

  _voltar() {
    if (this.lipInstance?.destroy) this.lipInstance.destroy();
    const retorno = String(
      this.routeQuery?.retorno || this.routeQuery?.voltarPara || ''
    ).toLowerCase();
    if (retorno === 'prestacao') {
      navigate(routeWithActiveContext(
        `/consignacoes/${this.consignacaoId}/prestacao`,
        this.navigationContext
      ));
      return;
    }
    navigate(resolveBackPath(
      this.navigationContext,
      `/consignacoes/${this.consignacaoId}`
    ));
  }
}

module.exports = EntregaComplementarPage;
