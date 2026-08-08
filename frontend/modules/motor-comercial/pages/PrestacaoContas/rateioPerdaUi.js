/**
 * RC4.2 — UI Rateio da Perda (Prestação de Contas)
 * @module frontend/modules/motor-comercial/pages/PrestacaoContas/rateioPerdaUi
 */

const domain = require('./rateioPerdaDomain');
const { formatCurrency } = require('./fecharConsignacaoMappers');

function buildRateioCardHtml(rateio = {}, { totalPerdas = 0, motivos = null } = {}) {
  const tipo = String(rateio.tipoRateio || domain.TIPOS_RATEIO.CLIENTE).toUpperCase();
  const calc = domain.calcularRateio(tipo, totalPerdas, {
    valorCliente: rateio.valorCliente,
    valorEmpresa: rateio.valorEmpresa
  });
  const listaMotivos = motivos || domain.MOTIVOS_PERDA.map((m) => ({
    codigo: m,
    label: domain.MOTIVO_LABEL[m] || m
  }));
  const motivo = String(rateio.motivoPerda || '').toUpperCase();
  const compart = tipo === domain.TIPOS_RATEIO.COMPARTILHADA;

  return `
    <section class="cds-op-card cds-rateio-perda" id="fechar-rateio-perda" data-total-perdas="${Number(totalPerdas) || 0}">
      <h3 class="cds-op-card__titulo">Rateio da Perda</h3>
      <p class="cds-muted cds-rateio-perda__total">Perda total: <strong data-rateio="total">${formatCurrency(totalPerdas)}</strong></p>
      <div class="cds-rateio-perda__tipos" role="radiogroup" aria-label="Responsável pela perda">
        <label class="cds-rateio-perda__tipo">
          <input type="radio" name="rateio-tipo" value="CLIENTE" ${tipo === 'CLIENTE' ? 'checked' : ''}>
          <span>Cliente</span>
        </label>
        <label class="cds-rateio-perda__tipo">
          <input type="radio" name="rateio-tipo" value="EMPRESA" ${tipo === 'EMPRESA' ? 'checked' : ''}>
          <span>Empresa</span>
        </label>
        <label class="cds-rateio-perda__tipo">
          <input type="radio" name="rateio-tipo" value="COMPARTILHADA" ${tipo === 'COMPARTILHADA' ? 'checked' : ''}>
          <span>Compartilhada</span>
        </label>
      </div>
      <div class="cds-rateio-perda__valores" id="rateio-valores" ${compart ? '' : 'hidden'}>
        <label>
          <span>Cliente (R$)</span>
          <input type="number" step="0.01" min="0" data-rateio-campo="cliente"
            value="${Number(calc.valorCliente || 0).toFixed(2)}">
        </label>
        <label>
          <span>Empresa (R$)</span>
          <input type="number" step="0.01" min="0" data-rateio-campo="empresa"
            value="${Number(calc.valorEmpresa || 0).toFixed(2)}">
        </label>
      </div>
      <dl class="cds-rateio-perda__pct">
        <div><dt>Cliente</dt><dd data-rateio="pct-cliente">${Number(calc.percentualCliente || 0).toFixed(2)}%</dd></div>
        <div><dt>Empresa</dt><dd data-rateio="pct-empresa">${Number(calc.percentualEmpresa || 0).toFixed(2)}%</dd></div>
        <div><dt>Cliente assume</dt><dd data-rateio="val-cliente">${formatCurrency(calc.valorCliente)}</dd></div>
        <div><dt>Empresa assume</dt><dd data-rateio="val-empresa">${formatCurrency(calc.valorEmpresa)}</dd></div>
      </dl>
      <label class="cds-rateio-perda__motivo">
        <span>Motivo da perda *</span>
        <select data-rateio="motivo">
          <option value="">Selecione…</option>
          ${listaMotivos.map((m) => `
            <option value="${m.codigo}" ${motivo === m.codigo ? 'selected' : ''}>${m.label}</option>
          `).join('')}
        </select>
      </label>
      <label class="cds-rateio-perda__obs" id="rateio-obs-wrap" ${motivo === 'OUTRO' ? '' : 'hidden'}>
        <span>Observação *</span>
        <textarea data-rateio="observacao" rows="2">${rateio.observacaoPerda || ''}</textarea>
      </label>
      <p class="cds-rateio-perda__erro" data-rateio="erro" hidden></p>
      <button type="button" class="cds-btn cds-btn--primary" data-rateio-action="salvar">
        Salvar rateio
      </button>
    </section>
  `;
}

function buildResumoFinanceiroRateioHtml(resumo = {}) {
  return `
    <section class="cds-op-card cds-rateio-resumo-fin" id="fechar-resumo-rateio" data-card="resumo-rateio">
      <h3 class="cds-op-card__titulo">Resumo Financeiro</h3>
      <dl class="cds-rateio-resumo-fin__lista">
        <div><dt>Venda</dt><dd data-rf="venda">${formatCurrency(resumo.valorVenda)}</dd></div>
        <div><dt>Recebido</dt><dd data-rf="recebido">${formatCurrency(resumo.valorRecebido)}</dd></div>
        <div><dt>Perdas</dt><dd data-rf="perdas">${formatCurrency(resumo.perdas)}</dd></div>
        <div><dt>Cliente assume</dt><dd data-rf="cliente">${formatCurrency(resumo.clienteAssume)}</dd></div>
        <div><dt>Empresa assume</dt><dd data-rf="empresa">${formatCurrency(resumo.empresaAssume)}</dd></div>
        <div class="is-destaque"><dt>Valor líquido do consignado</dt><dd data-rf="liquido">${formatCurrency(resumo.valorLiquidoConsignado)}</dd></div>
      </dl>
    </section>
  `;
}

function patchResumoFinanceiroRateio(host, resumo = {}) {
  if (!host) return;
  const map = {
    venda: formatCurrency(resumo.valorVenda),
    recebido: formatCurrency(resumo.valorRecebido),
    perdas: formatCurrency(resumo.perdas),
    cliente: formatCurrency(resumo.clienteAssume),
    empresa: formatCurrency(resumo.empresaAssume),
    liquido: formatCurrency(resumo.valorLiquidoConsignado)
  };
  Object.entries(map).forEach(([key, value]) => {
    const el = host.querySelector(`[data-rf="${key}"]`);
    if (el) el.textContent = value;
  });
}

function lerRateioDoDom(root) {
  const host = root?.querySelector?.('#fechar-rateio-perda') || root;
  if (!host) return null;
  const tipo = host.querySelector('input[name="rateio-tipo"]:checked')?.value || 'CLIENTE';
  const total = Number(host.getAttribute('data-total-perdas') || 0);
  const valorCliente = host.querySelector('[data-rateio-campo="cliente"]')?.value;
  const valorEmpresa = host.querySelector('[data-rateio-campo="empresa"]')?.value;
  return {
    tipoRateio: tipo,
    valorTotalPerdas: total,
    valorCliente: valorCliente !== undefined && valorCliente !== '' ? Number(valorCliente) : undefined,
    valorEmpresa: valorEmpresa !== undefined && valorEmpresa !== '' ? Number(valorEmpresa) : undefined,
    motivoPerda: host.querySelector('[data-rateio="motivo"]')?.value || null,
    observacaoPerda: host.querySelector('[data-rateio="observacao"]')?.value || null
  };
}

function aplicarCalculoNoDom(host, calc) {
  if (!host || !calc) return;
  const pctC = host.querySelector('[data-rateio="pct-cliente"]');
  const pctE = host.querySelector('[data-rateio="pct-empresa"]');
  const valC = host.querySelector('[data-rateio="val-cliente"]');
  const valE = host.querySelector('[data-rateio="val-empresa"]');
  if (pctC) pctC.textContent = `${Number(calc.percentualCliente || 0).toFixed(2)}%`;
  if (pctE) pctE.textContent = `${Number(calc.percentualEmpresa || 0).toFixed(2)}%`;
  if (valC) valC.textContent = formatCurrency(calc.valorCliente);
  if (valE) valE.textContent = formatCurrency(calc.valorEmpresa);
  const inpC = host.querySelector('[data-rateio-campo="cliente"]');
  const inpE = host.querySelector('[data-rateio-campo="empresa"]');
  if (typeof document !== 'undefined') {
    if (inpC && document.activeElement !== inpC) inpC.value = Number(calc.valorCliente || 0).toFixed(2);
    if (inpE && document.activeElement !== inpE) inpE.value = Number(calc.valorEmpresa || 0).toFixed(2);
  }
}

function bindRateioCard(host, { onSalvar } = {}) {
  if (!host || host.dataset.boundRateio === '1') return;
  host.dataset.boundRateio = '1';

  const syncTipo = () => {
    const tipo = host.querySelector('input[name="rateio-tipo"]:checked')?.value || 'CLIENTE';
    const valores = host.querySelector('#rateio-valores');
    if (valores) valores.hidden = tipo !== 'COMPARTILHADA';
    const total = Number(host.getAttribute('data-total-perdas') || 0);
    const calc = domain.calcularRateio(tipo, total, {
      valorCliente: host.querySelector('[data-rateio-campo="cliente"]')?.value,
      valorEmpresa: host.querySelector('[data-rateio-campo="empresa"]')?.value
    });
    aplicarCalculoNoDom(host, calc);
  };

  host.querySelectorAll('input[name="rateio-tipo"]').forEach((el) => {
    el.addEventListener('change', syncTipo);
  });

  host.querySelector('[data-rateio-campo="cliente"]')?.addEventListener('input', () => {
    const total = Number(host.getAttribute('data-total-perdas') || 0);
    const calc = domain.calcularRateio('COMPARTILHADA', total, {
      valorCliente: host.querySelector('[data-rateio-campo="cliente"]')?.value,
      campoEditado: 'cliente'
    });
    const inpE = host.querySelector('[data-rateio-campo="empresa"]');
    if (inpE) inpE.value = Number(calc.valorEmpresa || 0).toFixed(2);
    aplicarCalculoNoDom(host, calc);
  });

  host.querySelector('[data-rateio-campo="empresa"]')?.addEventListener('input', () => {
    const total = Number(host.getAttribute('data-total-perdas') || 0);
    const calc = domain.calcularRateio('COMPARTILHADA', total, {
      valorEmpresa: host.querySelector('[data-rateio-campo="empresa"]')?.value,
      campoEditado: 'empresa'
    });
    const inpC = host.querySelector('[data-rateio-campo="cliente"]');
    if (inpC) inpC.value = Number(calc.valorCliente || 0).toFixed(2);
    aplicarCalculoNoDom(host, calc);
  });

  host.querySelector('[data-rateio="motivo"]')?.addEventListener('change', (e) => {
    const wrap = host.querySelector('#rateio-obs-wrap');
    if (wrap) wrap.hidden = String(e.target.value || '').toUpperCase() !== 'OUTRO';
  });

  host.querySelector('[data-rateio-action="salvar"]')?.addEventListener('click', async () => {
    const erroEl = host.querySelector('[data-rateio="erro"]');
    const draft = lerRateioDoDom(host);
    const tipo = draft.tipoRateio;
    const calc = domain.calcularRateio(tipo, draft.valorTotalPerdas, {
      valorCliente: draft.valorCliente,
      valorEmpresa: draft.valorEmpresa,
      campoEditado: tipo === 'COMPARTILHADA' ? 'cliente' : null
    });
    const payload = {
      ...calc,
      motivoPerda: draft.motivoPerda,
      observacaoPerda: draft.observacaoPerda,
      campoEditado: tipo === 'COMPARTILHADA' ? 'cliente' : null
    };
    const valid = domain.validarRateio(payload);
    if (!valid.ok) {
      if (erroEl) {
        erroEl.hidden = false;
        erroEl.textContent = valid.erro;
      }
      return;
    }
    if (erroEl) erroEl.hidden = true;
    if (typeof onSalvar === 'function') await onSalvar(payload);
  });
}

function montarBlocoRateio(state, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'cds-rateio-perda-bloco';
  const payload = state.rateioPerda || {};
  const rateio = payload.rateio || {};
  const total = Number(
    payload.totais?.totalPerdido
    ?? rateio.valorTotalPerdas
    ?? 0
  );
  const resumo = payload.resumoFinanceiro || domain.buildResumoFinanceiroRateio({
    valorVenda: state.snapshot?.financeiro?.valorVenda,
    valorRecebido: state.snapshot?.financeiro?.valorRecebido,
    valorPerdas: total,
    valorCliente: rateio.valorCliente,
    valorEmpresa: rateio.valorEmpresa
  });

  wrap.innerHTML = buildRateioCardHtml(rateio, {
    totalPerdas: total,
    motivos: payload.motivos
  }) + buildResumoFinanceiroRateioHtml(resumo);

  const card = wrap.querySelector('#fechar-rateio-perda');
  bindRateioCard(card, {
    onSalvar: (data) => ctx.onSalvarRateioPerda && ctx.onSalvarRateioPerda(data)
  });
  return wrap;
}

module.exports = {
  buildRateioCardHtml,
  buildResumoFinanceiroRateioHtml,
  patchResumoFinanceiroRateio,
  lerRateioDoDom,
  bindRateioCard,
  aplicarCalculoNoDom,
  montarBlocoRateio,
  domain
};
