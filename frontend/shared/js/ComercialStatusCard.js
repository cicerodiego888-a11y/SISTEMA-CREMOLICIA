/**
 * ComercialStatusCard — Status do Canal de Venda (RCM-04.7 / RCM-05.12 / RCM-9.0.2)
 *
 * Componente reutilizável: PDV · Comercial · Mobile.
 * Apenas reflete o estado retornado pelo CanalVendaResolver.
 *
 * variants:
 *  - default: card com borda (ex.: consignação)
 *  - compact: indicador discreto sem moldura (PDV RCM-05.12)
 *
 * @module frontend/shared/js/ComercialStatusCard
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.ComercialStatusCard = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STYLE_ID = 'cds-comercial-status-card-styles';

  const DEFAULT_CSS = `
.cds-comercial-status-card {
  font-family: inherit;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.92);
  color: #e2e8f0;
  padding: 10px 12px;
  min-width: 180px;
  max-width: 280px;
  box-shadow: 0 4px 14px rgba(0,0,0,.18);
}
.cds-comercial-status-card--light {
  background: #fff;
  color: #0f172a;
  border-color: #e2e8f0;
  box-shadow: 0 2px 8px rgba(15,23,42,.06);
}
.cds-comercial-status-card--compact {
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
  min-width: 0;
  max-width: none;
  color: #e2e8f0;
}
.cds-comercial-status-card--compact.cds-comercial-status-card--light {
  color: #0f172a;
}
.cds-comercial-status-card__title {
  font-size: 11px;
  letter-spacing: .04em;
  text-transform: uppercase;
  opacity: .75;
  margin-bottom: 4px;
}
.cds-comercial-status-card--compact .cds-comercial-status-card__title {
  font-size: 10px;
  opacity: .55;
  margin-bottom: 2px;
  letter-spacing: .06em;
}
.cds-comercial-status-card__canal {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: .03em;
}
.cds-comercial-status-card--compact .cds-comercial-status-card__canal {
  font-size: 13px;
  font-weight: 600;
  gap: 6px;
}
.cds-comercial-status-card__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cds-comercial-status-card--compact .cds-comercial-status-card__dot {
  width: 8px;
  height: 8px;
}
.cds-comercial-status-card__dot--varejo { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.2); }
.cds-comercial-status-card__dot--atacado { background: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,.25); }
.cds-comercial-status-card__dot--evento { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.25); }
.cds-comercial-status-card__dot--consignado { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.2); }
.cds-comercial-status-card__dot--outro { background: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,.25); }
.cds-comercial-status-card--compact .cds-comercial-status-card__dot--varejo,
.cds-comercial-status-card--compact .cds-comercial-status-card__dot--atacado,
.cds-comercial-status-card--compact .cds-comercial-status-card__dot--evento,
.cds-comercial-status-card--compact .cds-comercial-status-card__dot--consignado,
.cds-comercial-status-card--compact .cds-comercial-status-card__dot--outro {
  box-shadow: none;
}
.cds-comercial-status-card__progress {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed rgba(148,163,184,.35);
}
.cds-comercial-status-card--compact .cds-comercial-status-card__progress {
  margin-top: 4px;
  padding-top: 0;
  border-top: none;
}
.cds-comercial-status-card__progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 6px;
}
.cds-comercial-status-card--compact .cds-comercial-status-card__progress-label {
  font-size: 11px;
  opacity: .7;
  margin-bottom: 3px;
  gap: 8px;
  justify-content: flex-start;
}
.cds-comercial-status-card__bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(148,163,184,.25);
  overflow: hidden;
}
.cds-comercial-status-card--compact .cds-comercial-status-card__bar {
  height: 3px;
  border-radius: 2px;
  background: rgba(148,163,184,.22);
}
.cds-comercial-status-card__bar-fill {
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: #22c55e;
  transition: width .25s ease, background .2s ease;
}
.cds-comercial-status-card__bar-fill.is-complete {
  background: #16a34a;
}
.cds-comercial-status-card--compact .cds-comercial-status-card__bar-fill {
  background: #22c55e;
}
.cds-comercial-status-card--compact .cds-comercial-status-card__bar-fill.is-complete {
  background: #16a34a;
}
.cds-comercial-status-card:not(.cds-comercial-status-card--compact) .cds-comercial-status-card__bar-fill {
  background: linear-gradient(90deg, #22c55e, #16a34a);
}
.cds-comercial-status-card__toast {
  margin-top: 8px;
  font-size: 12px;
  color: #86efac;
  opacity: 0;
  transition: opacity .2s ease;
}
.cds-comercial-status-card--compact .cds-comercial-status-card__toast {
  margin-top: 2px;
  font-size: 10px;
}
.cds-comercial-status-card__toast.is-visible { opacity: 1; }
.cds-comercial-status-card--light .cds-comercial-status-card__toast { color: #15803d; }
.cds-comercial-status-card.is-hidden { display: none !important; }
`;

  function ensureStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) {
      // Atualiza CSS se sprint refinou estilos (hot reload)
      const el = document.getElementById(STYLE_ID);
      if (el && el.textContent !== DEFAULT_CSS) el.textContent = DEFAULT_CSS;
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = DEFAULT_CSS;
    document.head.appendChild(style);
  }

  /** Contagem comercial (RCM-9.0.2): exibe inteiros — nunca quantidade física fracionada. */
  function formatQtdComercial(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return '0';
    return String(Math.round(v));
  }

  function formatLabelProgresso(atual, necessaria, compact) {
    const a = formatQtdComercial(atual);
    const n = formatQtdComercial(necessaria);
    if (compact) {
      return `${a} / ${n} Itens Comerciais`;
    }
    return `${a} de ${n} Itens para Atacado`;
  }

  function normalizeState(input = {}) {
    const canal = String(input.canal || 'VAREJO').toUpperCase();
    const nome = String(input.nome || canal);
    const quantidadeAtual = Math.round(Number(input.quantidadeAtual ?? input.quantidade_atual ?? 0));
    const quantidadeNecessaria = Math.round(Number(
      input.quantidadeNecessaria ?? input.quantidade_necessaria ?? 0
    ));
    let progresso = Number(input.progresso);
    if (!Number.isFinite(progresso)) {
      progresso = quantidadeNecessaria > 0
        ? Math.min(100, Math.round((quantidadeAtual / quantidadeNecessaria) * 100))
        : 0;
    }
    const atacadoHabilitado = input.atacado_habilitado != null
      ? !!input.atacado_habilitado
      : (input.atacadoHabilitado != null ? !!input.atacadoHabilitado : false);
    const mostrarProgresso = input.mostrar_progresso != null
      ? !!input.mostrar_progresso
      : (atacadoHabilitado && canal === 'VAREJO');

    return {
      canal,
      nome,
      quantidadeAtual,
      quantidadeNecessaria,
      progresso: Math.max(0, Math.min(100, progresso)),
      mostrar_progresso: mostrarProgresso,
      atacado_habilitado: atacadoHabilitado,
      visible: input.visible !== false
    };
  }

  function create(options = {}) {
    ensureStyles();
    const compact = options.compact === true || options.variant === 'compact';
    const root = document.createElement('div');
    root.className = 'cds-comercial-status-card'
      + (options.theme === 'light' ? ' cds-comercial-status-card--light' : '')
      + (compact ? ' cds-comercial-status-card--compact' : '');
    if (options.className) root.className += ` ${options.className}`;

    root.innerHTML = `
      <div class="cds-comercial-status-card__title" data-csc-title>${compact ? 'Canal' : (options.title || 'Canal da Venda')}</div>
      <div class="cds-comercial-status-card__canal">
        <span class="cds-comercial-status-card__dot cds-comercial-status-card__dot--varejo" data-csc-dot></span>
        <span data-csc-canal>${String(options.canal || 'VAREJO').toUpperCase()}</span>
      </div>
      <div class="cds-comercial-status-card__progress" data-csc-progress hidden>
        <div class="cds-comercial-status-card__progress-label">
          <span>Atacado</span>
          <span data-csc-qtd>0 / 0</span>
        </div>
        <div class="cds-comercial-status-card__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-csc-bar>
          <div class="cds-comercial-status-card__bar-fill" data-csc-fill></div>
        </div>
      </div>
      <div class="cds-comercial-status-card__toast" data-csc-toast aria-live="polite"></div>
    `;

    let lastCanal = 'VAREJO';
    let toastTimer = null;

    function showToast(msg) {
      const el = root.querySelector('[data-csc-toast]');
      if (!el || !msg) return;
      el.textContent = msg;
      el.classList.add('is-visible');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        el.classList.remove('is-visible');
      }, 2800);
    }

    function update(rawState = {}) {
      const state = normalizeState(rawState);
      root.classList.toggle('is-hidden', !state.visible);

      const canalEl = root.querySelector('[data-csc-canal]');
      const dotEl = root.querySelector('[data-csc-dot]');
      if (canalEl) canalEl.textContent = state.canal;
      if (dotEl) {
        const canal = state.canal;
        dotEl.classList.remove(
          'cds-comercial-status-card__dot--varejo',
          'cds-comercial-status-card__dot--atacado',
          'cds-comercial-status-card__dot--evento',
          'cds-comercial-status-card__dot--consignado',
          'cds-comercial-status-card__dot--outro'
        );
        if (canal === 'VAREJO') {
          dotEl.classList.add('cds-comercial-status-card__dot--varejo');
        } else if (canal === 'ATACADO') {
          dotEl.classList.add('cds-comercial-status-card__dot--atacado');
        } else if (canal === 'EVENTO') {
          dotEl.classList.add('cds-comercial-status-card__dot--evento');
        } else if (canal === 'CONSIGNADO') {
          dotEl.classList.add('cds-comercial-status-card__dot--consignado');
        } else {
          dotEl.classList.add('cds-comercial-status-card__dot--outro');
        }
      }

      const progressBox = root.querySelector('[data-csc-progress]');
      if (progressBox) {
        const show = !!state.mostrar_progresso;
        progressBox.hidden = !show;
        if (show) {
          const qtdEl = root.querySelector('[data-csc-qtd]');
          const fillEl = root.querySelector('[data-csc-fill]');
          const barEl = root.querySelector('[data-csc-bar]');
          if (qtdEl) {
            qtdEl.textContent = formatLabelProgresso(
              state.quantidadeAtual,
              state.quantidadeNecessaria,
              compact
            );
          }
          if (fillEl) {
            fillEl.style.width = `${state.progresso}%`;
            fillEl.classList.toggle('is-complete', state.progresso >= 100);
          }
          if (barEl) barEl.setAttribute('aria-valuenow', String(state.progresso));
        }
      }

      if (state.canal !== lastCanal) {
        if (state.canal === 'EVENTO') {
          showToast('✓ Canal EVENTO selecionado.');
        } else if (state.canal === 'ATACADO' && lastCanal !== 'ATACADO') {
          showToast('✓ Venda alterada para ATACADO.');
        } else if (state.canal === 'VAREJO' && lastCanal !== 'VAREJO') {
          showToast('✓ Venda voltou para VAREJO.');
        } else if (state.canal !== 'VAREJO' && lastCanal === 'VAREJO') {
          showToast(`✓ Canal alterado para ${state.canal}.`);
        }
        lastCanal = state.canal;
      }

      return state;
    }

    update({
      canal: options.canal || 'VAREJO',
      nome: options.nome,
      quantidadeAtual: options.quantidadeAtual || 0,
      quantidadeNecessaria: options.quantidadeNecessaria || 0,
      progresso: options.progresso || 0,
      mostrar_progresso: false,
      atacado_habilitado: false,
      visible: options.visible !== false
    });

    return {
      el: root,
      compact,
      update,
      showToast,
      destroy() {
        if (toastTimer) clearTimeout(toastTimer);
        root.remove();
      }
    };
  }

  function mount(container, options = {}) {
    if (!container) return null;
    const card = create(options);
    container.innerHTML = '';
    container.appendChild(card.el);
    return card;
  }

  return {
    create,
    mount,
    normalizeState,
    formatQtdComercial,
    formatLabelProgresso,
    ensureStyles,
    DEFAULT_CSS
  };
});
