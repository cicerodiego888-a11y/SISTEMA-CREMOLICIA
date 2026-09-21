/**
 * RCM-8.13 — Alterar Entrega (UI).
 *
 * Altera quantidades já entregues; preserva comprovante anterior;
 * emite novo comprovante completo atualizado.
 *
 * @module frontend/modules/motor-comercial/pages/AlterarEntrega
 */

const Workspace = require('../../../../shared/ui/Workspace');
const Button = require('../../components/base/Button');
const Loading = require('../../components/base/Loading');
const Alert = require('../../components/base/Alert');
const EmptyState = require('../../components/base/EmptyState');
const MotorComercialApi = require('../../api/MotorComercialApi');
const {
  notify,
  navigate,
  withLoading,
  confirmDialog,
  getUsuarioId,
  carregarConsignacaoCompleta
} = require('../../utils/operacional');
const {
  parseNavigationContext,
  resolveBackPath,
  routeWithActiveContext,
  getBackButtonLabel
} = require('../../utils/cliente360Context');
const { formatDocumento } = require('../../api/helpers');
const {
  podeAlterarEntrega,
  montarLinhasEdicao,
  calcularDeltas,
  opcoesMotivo,
  MENSAGEM_CONFIRMACAO_ALTERACAO,
  MENSAGEM_PRESTACAO_ENCERRADA
} = require('./alterarEntregaMappers');
const {
  emitirComprovanteAposOperacaoEntrega
} = require('../../services/comprovanteAtualizadoEntrega');

class AlterarEntregaPage {
  constructor(consignacaoId, routeQuery = {}) {
    this.consignacaoId = consignacaoId;
    this.routeQuery = routeQuery;
    this.navigationContext = parseNavigationContext(routeQuery);
    this.api = new MotorComercialApi();
    this.consignacao = null;
    this.linhas = [];
    this.motivo = 'CLIENTE_DESISTIU';
    this.observacao = '';
    this.loading = true;
    this.error = null;
    this.root = null;
  }

  static create(consignacaoId, query = {}) {
    const page = new AlterarEntregaPage(consignacaoId, query);
    return page.render();
  }

  render() {
    this.root = Workspace.create({
      variant: 'station',
      className: 'cds-alterar-entrega-workspace',
      header: Workspace.Header.create({
        title: 'ALTERAR ENTREGA',
        subtitle: 'Alterar produtos de uma entrega já realizada',
        context: this._headerContext(),
        onBack: () => this._voltar()
      }),
      body: Workspace.Body.create({
        children: this._shell(),
        scroll: true
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
            text: 'Confirmar alteração',
            variant: 'primary',
            onClick: () => this._confirmar()
          })
        ]
      })
    });
    this.root.id = 'alterar-entrega-root';
    this.root.dataset.rcm = '8.13';
    this._load();
    return this.root;
  }

  _headerContext() {
    const doc = formatDocumento(this.consignacao?.documento);
    return doc ? `Consignação ${doc}` : `Consignação #${this.consignacaoId}`;
  }

  _shell() {
    const host = document.createElement('div');
    host.id = 'alterar-entrega-body';
    host.appendChild(Loading.create({ message: 'Carregando consignação…' }));
    return host;
  }

  _host() {
    return this.root?.querySelector?.('#alterar-entrega-body')
      || document.getElementById('alterar-entrega-body');
  }

  async _load() {
    this.loading = true;
    this.error = null;
    try {
      this.consignacao = await withLoading(
        'Carregando…',
        () => carregarConsignacaoCompleta(this.api, this.consignacaoId)
      );
      const check = podeAlterarEntrega(this.consignacao);
      if (!check.elegivel) {
        this.error = check.mensagem || MENSAGEM_PRESTACAO_ENCERRADA;
      }
      this.linhas = montarLinhasEdicao(this.consignacao?.itens || []);
    } catch (err) {
      this.error = err.message || 'Falha ao carregar consignação';
    } finally {
      this.loading = false;
      this._renderBody();
    }
  }

  _renderBody() {
    const host = this._host();
    if (!host) return;
    host.innerHTML = '';

    if (this.loading) {
      host.appendChild(Loading.create({ message: 'Carregando…' }));
      return;
    }
    if (this.error) {
      host.appendChild(Alert.create({ variant: 'error', message: this.error }));
      return;
    }
    if (!this.linhas.length) {
      host.appendChild(EmptyState.create({
        title: 'Sem itens',
        description: 'Não há produtos entregues para alterar.'
      }));
      return;
    }

    const intro = document.createElement('p');
    intro.className = 'cds-alterar-entrega__intro';
    intro.textContent = 'Informe a nova quantidade de cada produto. O comprovante anterior será preservado.';
    host.appendChild(intro);

    const table = document.createElement('table');
    table.className = 'cds-alterar-entrega__table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Produto</th>
          <th>Anterior</th>
          <th>Nova qtd</th>
          <th>Delta</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    this.linhas.forEach((linha, idx) => {
      const tr = document.createElement('tr');
      const delta = Number(linha.quantidadeNova) - Number(linha.quantidadeAnterior);
      tr.innerHTML = `
        <td>${linha.produtoNome}</td>
        <td>${linha.quantidadeAnterior}</td>
        <td></td>
        <td class="cds-alterar-entrega__delta">${delta >= 0 ? `+${delta}` : delta}</td>
      `;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = String(linha.quantidadeNova);
      input.addEventListener('input', () => {
        linha.quantidadeNova = Number(input.value);
        const d = Number(linha.quantidadeNova) - Number(linha.quantidadeAnterior);
        tr.querySelector('.cds-alterar-entrega__delta').textContent = d >= 0 ? `+${d}` : String(d);
      });
      tr.children[2].appendChild(input);
      tbody.appendChild(tr);
      void idx;
    });
    host.appendChild(table);

    const motivoWrap = document.createElement('div');
    motivoWrap.className = 'cds-alterar-entrega__motivo';
    const label = document.createElement('label');
    label.textContent = 'Motivo';
    const select = document.createElement('select');
    opcoesMotivo().forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === this.motivo) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', () => { this.motivo = select.value; });
    motivoWrap.appendChild(label);
    motivoWrap.appendChild(select);
    host.appendChild(motivoWrap);

    const obsWrap = document.createElement('div');
    obsWrap.className = 'cds-alterar-entrega__obs';
    const obsLabel = document.createElement('label');
    obsLabel.textContent = 'Observação (opcional)';
    const textarea = document.createElement('textarea');
    textarea.rows = 2;
    textarea.value = this.observacao;
    textarea.addEventListener('input', () => { this.observacao = textarea.value; });
    obsWrap.appendChild(obsLabel);
    obsWrap.appendChild(textarea);
    host.appendChild(obsWrap);
  }

  async _confirmar() {
    const deltas = calcularDeltas(this.linhas);
    if (!deltas.length) {
      notify('Altere ao menos uma quantidade.', 'warning');
      return;
    }
    if (!this.motivo) {
      notify('Informe o motivo da alteração.', 'warning');
      return;
    }

    const confirmed = await confirmDialog({
      title: 'Confirmar alteração',
      message: MENSAGEM_CONFIRMACAO_ALTERACAO,
      confirmLabel: 'Confirmar alteração',
      cancelLabel: 'Voltar'
    });
    if (!confirmed) return;

    try {
      const result = await withLoading(
        'Registrando alteração…',
        () => this.api.registrarAlteracaoPosEntrega(this.consignacaoId, {
          motivo: this.motivo,
          observacao: this.observacao || null,
          usuarioId: getUsuarioId(),
          itens: deltas.map((d) => ({
            itemId: d.itemId,
            produtoId: d.produtoId,
            quantidadeNova: d.quantidadeNova
          }))
        })
      );

      notify('Alteração registrada. Novo comprovante emitido.', 'success');
      await emitirComprovanteAposOperacaoEntrega({
        api: this.api,
        consignacaoId: this.consignacaoId,
        consignacao: this.consignacao,
        resultado: result
      });
      navigate(routeWithActiveContext(
        `/consignacoes/${this.consignacaoId}`,
        this.navigationContext
      ));
    } catch (err) {
      notify(err.message || 'Falha ao registrar alteração', 'error');
    }
  }

  _voltar() {
    navigate(resolveBackPath(
      this.navigationContext,
      `/consignacoes/${this.consignacaoId}`
    ));
  }
}

module.exports = AlterarEntregaPage;
