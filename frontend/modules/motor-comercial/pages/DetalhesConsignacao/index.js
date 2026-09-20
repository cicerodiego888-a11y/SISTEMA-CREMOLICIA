/**
 * Detalhes da Consignação — reutiliza CockpitDrawer da Central.
 *
 * Sprint H-2: rota /consignacoes/:id
 *
 * @module frontend/modules/motor-comercial/pages/DetalhesConsignacao
 */

const DashboardLayout = require('../../components/layouts/DashboardLayout');
const Button = require('../../components/base/Button');
const Loading = require('../../components/base/Loading');
const Alert = require('../../components/base/Alert');
const MotorComercialApi = require('../../api/MotorComercialApi');
const ProjectionApi = require('../../api/ProjectionApi');
const { mapConsignacaoView } = require('../../api/helpers');
const CockpitDrawer = require('../Consignacoes/CockpitDrawer');
const {
  imprimirTermo,
  visualizarTermo,
  exportarTermoPdf
} = require('../../services/TermoEntregaConsignacaoService');
const {
  notify,
  navigate,
  withLoading,
  choiceDialog,
  confirmDialog,
  promptDialog
} = require('../../utils/operacional');
const {
  parseCliente360Context,
  resolveBackPath,
  routeWithActiveContext
} = require('../../utils/cliente360Context');
const {
  podeAdicionarProdutoComplementar,
  MENSAGEM_PRESTACAO_ENCERRADA
} = require('../EntregaComplementar/entregaComplementarMappers');
const {
  MOTIVOS_CANCELAMENTO,
  podeCancelarPreparacao,
  lerCancelamento,
  MENSAGEM_CANCELADA_NOVA
} = require('../Consignacoes/cancelamentoPreparacao');
const { ConfirmMessages, notifySuccess, notifyError, loadingText } = require('../../messages');

class DetalhesConsignacaoPage {
  constructor(params = {}, routeQuery = {}) {
    this.consignacaoId = params.id;
    this.routeQuery = routeQuery;
    this.navigationContext = parseCliente360Context(routeQuery);
    this.api = new MotorComercialApi();
    this.projectionApi = new ProjectionApi();
    this.consignacao = null;
    this.error = null;
  }

  static create(params = {}, query = {}) {
    const page = new DetalhesConsignacaoPage(params, query);
    return page._render();
  }

  _render() {
    const shell = document.createElement('div');
    shell.className = 'cds-detalhes-consignacao';
    shell.id = 'detalhes-consignacao-root';
    shell.appendChild(Loading.create({ message: 'Carregando consignação...' }));

    const layout = DashboardLayout.create({
      header: this._createHeader(),
      content: shell
    });

    setTimeout(() => this._load(), 0);
    return layout;
  }

  _createHeader() {
    const container = document.createElement('div');
    container.className = 'cds-detalhes-consignacao__header-wrap';
    const title = document.createElement('h1');
    title.textContent = 'Detalhes da Consignação';
    container.appendChild(title);
    container.appendChild(this._createToolbar());
    return container;
  }

  _createToolbar() {
    const bar = document.createElement('div');
    bar.className = 'cds-detalhes-consignacao__toolbar';
    bar.id = 'detalhes-consignacao-toolbar';
    bar.appendChild(Button.create({
      text: 'Voltar',
      variant: 'secondary',
      onClick: () => navigate(resolveBackPath(this.navigationContext, '/consignacoes'))
    }));
    bar.appendChild(Button.create({ text: 'Atualizar', variant: 'primary', onClick: () => this._load() }));
    return bar;
  }

  _atualizarToolbar() {
    const bar = document.getElementById('detalhes-consignacao-toolbar');
    if (!bar) return;
    bar.innerHTML = '';
    bar.appendChild(Button.create({
      text: 'Voltar',
      variant: 'secondary',
      onClick: () => navigate(resolveBackPath(this.navigationContext, '/consignacoes'))
    }));

    const status = String(this.consignacao?.status || '').toUpperCase();

    if (status === 'CANCELADA') {
      const cancel = lerCancelamento(this.consignacao);
      bar.appendChild(Button.create({
        text: 'Imprimir Termo de Entrega',
        variant: 'ghost',
        onClick: () => this._imprimirTermoEntrega()
      }));
      bar.appendChild(Button.create({ text: 'Atualizar', variant: 'primary', onClick: () => this._load() }));
      if (cancel?.mensagem) {
        const hint = document.createElement('span');
        hint.className = 'cds-detalhes-consignacao__hint';
        hint.textContent = cancel.mensagem;
        bar.appendChild(hint);
      }
      return;
    }

    if (status === 'RASCUNHO') {
      bar.appendChild(Button.create({
        text: 'Entrega',
        variant: 'ghost',
        onClick: () => navigate(routeWithActiveContext(
          `/consignacoes/${this.consignacaoId}/entrega`,
          this.navigationContext
        ))
      }));
      bar.appendChild(Button.create({
        text: 'Cancelar preparação',
        variant: 'danger',
        onClick: () => this._cancelarPreparacao()
      }));
    }

    const check = podeAdicionarProdutoComplementar(this.consignacao);
    if (check.elegivel) {
      bar.appendChild(Button.create({
        text: '+ Adicionar produto',
        variant: 'primary',
        onClick: () => this._abrirEntregaComplementar()
      }));
    }

    if (status === 'ENTREGUE') {
      bar.appendChild(Button.create({
        text: 'Fechar Atendimento',
        variant: 'ghost',
        onClick: () => this._openPrestacao(this.consignacao || { id: this.consignacaoId })
      }));
    }

    bar.appendChild(Button.create({
      text: 'Imprimir Termo de Entrega',
      variant: 'ghost',
      onClick: () => this._imprimirTermoEntrega()
    }));
    bar.appendChild(Button.create({ text: 'Atualizar', variant: 'primary', onClick: () => this._load() }));
  }

  async _cancelarPreparacao() {
    if (!podeCancelarPreparacao(this.consignacao)) {
      notify(MENSAGEM_CANCELADA_NOVA, 'warning');
      return;
    }

    const confirmed = await confirmDialog({ ...ConfirmMessages.CANCELAR_CONSIGNACAO });
    if (!confirmed) return;

    const motivo = await choiceDialog({
      title: 'Motivo do cancelamento',
      message: 'Selecione o motivo:',
      choices: MOTIVOS_CANCELAMENTO.map((m) => ({
        label: m.label,
        value: m.value,
        variant: m.value === 'OUTRO' ? 'secondary' : 'primary'
      }))
    });
    if (!motivo) return;

    let observacao = null;
    if (motivo === 'OUTRO') {
      observacao = await promptDialog({
        title: 'Descreva o motivo',
        label: 'Observação',
        placeholder: 'Informe o motivo do cancelamento'
      });
      if (observacao == null) return;
      observacao = String(observacao).trim() || null;
    }

    try {
      const atualizada = await withLoading(
        loadingText('CANCELANDO_CONSIGNACAO'),
        () => this.api.cancelarConsignacao(this.consignacaoId, { motivo, observacao })
      );
      notifySuccess('CONSIGNACAO_CANCELADA');
      if (atualizada) {
        this.consignacao = mapConsignacaoView(atualizada.consignacao || atualizada);
      }
      await this._load();
    } catch (error) {
      notifyError('CONSIGNACAO_CANCELAR', error);
    }
  }

  async _abrirEntregaComplementar() {
    const check = podeAdicionarProdutoComplementar(this.consignacao);
    if (!check.elegivel) {
      notify(check.mensagem || MENSAGEM_PRESTACAO_ENCERRADA, 'warning');
      return;
    }
    await navigate(routeWithActiveContext(
      `/consignacoes/${this.consignacaoId}/entrega-complementar`,
      this.navigationContext
    ));
  }

  async _imprimirTermoEntrega() {
    const escolha = await choiceDialog({
      title: 'Termo de Entrega',
      message: 'Como deseja emitir o documento?',
      choices: [
        { label: 'Imprimir', value: 'imprimir', variant: 'primary' },
        { label: 'Visualizar', value: 'visualizar', variant: 'secondary' },
        { label: 'Exportar PDF', value: 'pdf', variant: 'secondary' }
      ]
    });
    if (!escolha) return;

    try {
      await withLoading('Gerando termo...', async () => {
        if (escolha === 'visualizar') {
          await visualizarTermo(this.api, this.projectionApi, this.consignacaoId);
        } else if (escolha === 'pdf') {
          await exportarTermoPdf(this.api, this.projectionApi, this.consignacaoId);
        } else {
          await imprimirTermo(this.api, this.projectionApi, this.consignacaoId);
        }
      });
    } catch (error) {
      notify('Erro ao gerar Termo de Entrega: ' + error.message, 'error');
    }
  }

  async _openPrestacao(consignacao) {
    try {
      if (consignacao?.status === 'ENTREGUE') {
        await withLoading('Abrindo prestação...', () => this.api.abrirPrestacao(consignacao.id));
      }
      await navigate(routeWithActiveContext(
        `/consignacoes/${consignacao.id}/prestacao`,
        this.navigationContext
      ));
    } catch (error) {
      notify('Erro ao abrir prestação: ' + error.message, 'error');
    }
  }

  async _load() {
    const host = document.getElementById('detalhes-consignacao-root');
    if (!host) return;

    host.innerHTML = '';
    host.appendChild(Loading.create({ message: 'Carregando consignação...' }));

    try {
      const raw = await withLoading('Carregando...', () => this.api.obterConsignacao(this.consignacaoId));
      this.consignacao = mapConsignacaoView(raw);
      this._atualizarToolbar();
      host.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'cds-detalhes-consignacao__header';
      const cancel = lerCancelamento(this.consignacao);
      const cancelHtml = cancel
        ? `<p><strong>Status:</strong> CANCELADA</p>
           <p><strong>Motivo:</strong> ${cancel.motivoLabel || cancel.motivo || '—'}</p>
           <p><strong>Cancelada em:</strong> ${this._formatDate(cancel.canceladoEm)}</p>
           <p><strong>Cancelada por:</strong> ${cancel.canceladoPorUsuarioId || '—'}</p>
           <p>${MENSAGEM_CANCELADA_NOVA}</p>`
        : `<p>${this.consignacao.clienteNome || ''} · ${this.consignacao.status || ''}</p>`;

      header.innerHTML = `
        <h2>${this.consignacao.documento || `Consignação #${this.consignacaoId}`}</h2>
        ${cancelHtml}
      `;
      host.appendChild(header);

      const drawerHost = document.createElement('div');
      host.appendChild(drawerHost);
      const drawer = new CockpitDrawer(this, this.consignacao);
      await drawer.mount(drawerHost);
    } catch (error) {
      host.innerHTML = '';
      host.appendChild(Alert.create({ message: error.message, variant: 'error', dismissible: true }));
    }
  }

  _formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  _formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR');
  }

  _formatDateTime(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('pt-BR');
  }
}

module.exports = DetalhesConsignacaoPage;
