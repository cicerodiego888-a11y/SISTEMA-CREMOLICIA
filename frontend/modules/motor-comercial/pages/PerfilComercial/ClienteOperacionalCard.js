/**
 * Card operacional de cliente — Central de Clientes UX-01.
 *
 * @module frontend/modules/motor-comercial/pages/PerfilComercial/ClienteOperacionalCard
 */

const Button = require('../../components/base/Button');
const Badge = require('../../components/base/Badge');
const ActionMenu = require('../../components/special/ActionMenu');

class ClienteOperacionalCard {
  /**
   * @param {Object} cliente
   * @param {Object} handlers
   * @param {Function} handlers.onAbrir
   * @param {Function} handlers.onEditar
   * @param {Function} handlers.onHistorico
   * @param {Function} handlers.onContaCorrente
   * @param {Function} handlers.onDesativar
   * @param {Function} handlers.onExcluir
   * @param {Function} handlers.formatCurrency
   * @returns {HTMLElement}
   */
  static create(cliente, handlers = {}) {
    const card = document.createElement('article');
    card.className = 'cds-cliente-op-card';
    card.dataset.clienteId = String(cliente.clienteId);

    const capacidades = (cliente.capacidades || []).length
      ? cliente.capacidades.map((c) => `<span class="cds-cliente-op-card__cap">✓ ${c}</span>`).join('')
      : '<span class="cds-cliente-op-card__cap cds-cliente-op-card__cap--empty">Sem capacidades</span>';

    card.innerHTML = `
      <div class="cds-cliente-op-card__body">
        <h3 class="cds-cliente-op-card__nome">${cliente.nome}</h3>
        <p class="cds-cliente-op-card__linha">📞 ${cliente.telefone || '—'}</p>
        <p class="cds-cliente-op-card__linha">📍 ${cliente.cidade || '—'}</p>
        <div class="cds-cliente-op-card__secao">
          <span class="cds-cliente-op-card__label">Capacidades</span>
          <div class="cds-cliente-op-card__caps">${capacidades}</div>
        </div>
        <div class="cds-cliente-op-card__metricas">
          <div>
            <span class="cds-cliente-op-card__label">Saldo</span>
            <strong>${handlers.formatCurrency ? handlers.formatCurrency(cliente.saldoAtual) : cliente.saldoAtual}</strong>
          </div>
          <div>
            <span class="cds-cliente-op-card__label">Consignações</span>
            <strong>${cliente.consignacoesAbertas || 0} em aberto</strong>
          </div>
        </div>
        <div class="cds-cliente-op-card__status-row">
          <span class="cds-cliente-op-card__label">Status</span>
          <span class="cds-cliente-op-card__status-host"></span>
        </div>
      </div>
      <div class="cds-cliente-op-card__actions"></div>
    `;

    const statusHost = card.querySelector('.cds-cliente-op-card__status-host');
    statusHost.appendChild(Badge.create({
      text: cliente.status || 'Ativo',
      variant: cliente.statusVariant || 'success'
    }));

    const actions = card.querySelector('.cds-cliente-op-card__actions');
    const abrirBtn = Button.create({
      text: 'Abrir',
      variant: 'primary',
      onClick: (event) => {
        event?.stopPropagation?.();
        const id = Number(card.dataset.clienteId || cliente.clienteId);
        if (handlers.onAbrir) {
          handlers.onAbrir({ ...cliente, clienteId: id });
        }
      }
    });
    abrirBtn.dataset.clienteId = String(cliente.clienteId);
    actions.appendChild(abrirBtn);

    const menuActions = [
      { label: 'Editar', onClick: () => handlers.onEditar && handlers.onEditar(cliente) },
      { label: 'Histórico', onClick: () => handlers.onHistorico && handlers.onHistorico(cliente) },
      { label: 'Conta Corrente', onClick: () => handlers.onContaCorrente && handlers.onContaCorrente(cliente) },
      { label: 'Desativar', onClick: () => handlers.onDesativar && handlers.onDesativar(cliente) }
    ];

    if (handlers.podeExcluir !== false) {
      menuActions.push({
        label: 'Excluir',
        danger: true,
        onClick: () => handlers.onExcluir && handlers.onExcluir(cliente)
      });
    }

    actions.appendChild(ActionMenu.create({
      triggerText: 'Mais opções',
      triggerIcon: '⋯',
      actions: menuActions
    }));

    return card;
  }
}

module.exports = ClienteOperacionalCard;
