/**
 * CDS Mobile RCM-03 — Equipamentos / Lab (quando suportado)
 * APIs: /api/equipamentos (+ lab quando disponível)
 */
import {
  escapeHtml,
  asText,
  formatDateTime,
  loadingHtml,
  emptyHtml,
  errorHtml,
  listCardHtml,
  backBarHtml,
  bindBack,
  bindGo,
  sectionTitleHtml,
  searchBarHtml,
  countLabel,
  debounce,
  statusBadgeHtml
} from '../ui.js';
import {
  fieldHtml,
  formCardHtml,
  collectForm,
  fabHtml,
  confirmSheet,
  unwrapList,
  actionBarHtml
} from '../forms.js';
import { showToast } from '../toast.js';

function cardEq(e) {
  return listCardHtml({
    go: `equipamentos/${e.id}`,
    title: asText(e.nome || e.descricao || `Equipamento #${e.id}`),
    subtitle: asText(e.tipo || e.driver || e.modelo, ''),
    status: e.ativo === false || e.ativo === 0 ? 'Inativo' : (e.status || 'Ativo'),
    meta: [asText(e.porta || e.endereco || e.host, '')].filter(Boolean)
  });
}

export async function renderList(root) {
  root.innerHTML = `
    <p class="cds-muted">Configuração e diagnóstico via /api/equipamentos. Pinpad físico / drivers locais: ◐ limitação de plataforma.</p>
    ${searchBarHtml('Buscar equipamento', 'eq-search')}
    <p class="cds-muted" id="eq-count">Carregando…</p>
    <div id="eq-list">${loadingHtml()}</div>
    ${fabHtml('Novo', 'equipamentos/novo')}
    <div class="cds-stack" style="margin-top:12px">
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="eq-resumo">Resumo / drivers</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="configuracoes">Voltar configurações</button>
    </div>
  `;
  bindGo(root);

  const load = async (q = '') => {
    const list = root.querySelector('#eq-list');
    list.innerHTML = loadingHtml();
    try {
      let rows = unwrapList(await window.CDSApi.get('equipamentos'));
      if (q) {
        const s = q.toLowerCase();
        rows = rows.filter((e) => JSON.stringify(e).toLowerCase().includes(s));
      }
      root.querySelector('#eq-count').textContent = countLabel(rows.length, 'equipamento', 'equipamentos');
      list.innerHTML = rows.length ? rows.map(cardEq).join('') : emptyHtml('Nenhum equipamento');
      bindGo(list);
    } catch (err) {
      list.innerHTML = errorHtml(err.message, err.status);
    }
  };

  root.querySelector('#eq-search')?.addEventListener('input', debounce((e) => load(e.target.value), 250));
  root.querySelector('#eq-resumo')?.addEventListener('click', async () => {
    try {
      const [resumo, drivers] = await Promise.all([
        window.CDSApi.get('equipamentos/resumo').catch(() => null),
        window.CDSApi.get('equipamentos/drivers').catch(() => [])
      ]);
      const drv = unwrapList(drivers);
      showToast(`Drivers: ${drv.length}. ${asText(resumo?.mensagem || JSON.stringify(resumo || {}).slice(0, 80))}`, 'info');
    } catch (err) {
      showToast(err.message || 'Falha no resumo', 'error');
    }
  });
  await load();
}

export async function renderForm(root) {
  root.innerHTML = `
    ${backBarHtml('Equipamentos')}
    ${formCardHtml('Novo equipamento', [
      fieldHtml({ name: 'nome', label: 'Nome', required: true }),
      fieldHtml({ name: 'tipo', label: 'Tipo', placeholder: 'impressora, pinpad, balanca…' }),
      fieldHtml({ name: 'driver', label: 'Driver' }),
      fieldHtml({ name: 'porta', label: 'Porta / endereço' }),
      fieldHtml({ name: 'observacoes', label: 'Observações', type: 'textarea' })
    ].join(''), `<button type="submit" class="cds-mobile-btn">Salvar</button>`)}
    <p class="cds-muted">Integrações que exigem USB/COM do Desktop podem falhar no navegador móvel.</p>
  `;
  bindBack(root);
  root.querySelector('#cds-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = collectForm(e.target);
    try {
      const created = await window.CDSApi.post('equipamentos', d);
      showToast('Equipamento criado.', 'success');
      window.CDSMobile?.navigate?.(`equipamentos/${created.id || created?.data?.id}`, { replace: true });
    } catch (err) {
      showToast(err.message || 'Falha ao salvar', 'error');
    }
  });
}

export async function renderDetail(root, id) {
  root.innerHTML = loadingHtml();
  try {
    const e = await window.CDSApi.get(`equipamentos/${id}`);
    root.innerHTML = `
      ${backBarHtml('Equipamentos')}
      <article class="cds-card">
        <h3 class="cds-card__title">${escapeHtml(asText(e.nome, `Equipamento #${id}`))}</h3>
        ${statusBadgeHtml(e.ativo === false || e.ativo === 0 ? 'Inativo' : 'Ativo')}
        <div class="cds-row"><span>Tipo</span><strong>${escapeHtml(asText(e.tipo || e.driver))}</strong></div>
        <div class="cds-row"><span>Porta</span><strong>${escapeHtml(asText(e.porta || e.endereco || e.host))}</strong></div>
        <div class="cds-row"><span>Atualizado</span><strong>${escapeHtml(formatDateTime(e.updated_at || e.atualizado_em))}</strong></div>
      </article>
      ${actionBarHtml([
        { action: 'testar', label: 'Testar / diagnóstico', icon: 'search', variant: 'secondary' },
        { action: 'ativar', label: 'Ativar', icon: 'check', variant: 'secondary' },
        { action: 'desativar', label: 'Desativar', icon: 'warning', variant: 'ghost' },
        { action: 'logs', label: 'Logs', icon: 'id', variant: 'ghost' },
        { action: 'excluir', label: 'Excluir', icon: 'trash', variant: 'ghost' }
      ])}
      <p class="cds-muted">Laboratório hex/captura avançada permanece no Desktop quando depender de hardware local.</p>
    `;
    bindBack(root);

    root.querySelector('[data-action="testar"]')?.addEventListener('click', async () => {
      try {
        const r = await window.CDSApi.post(`equipamentos/${id}/testar`, {});
        showToast(asText(r?.mensagem || r?.message || 'Teste executado.'), 'success');
      } catch (err) {
        showToast(err.message || 'Falha no teste (possível limitação mobile).', 'error');
      }
    });
    root.querySelector('[data-action="ativar"]')?.addEventListener('click', async () => {
      try {
        await window.CDSApi.post(`equipamentos/${id}/ativar`, {});
        showToast('Ativado.', 'success');
        renderDetail(root, id);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    root.querySelector('[data-action="desativar"]')?.addEventListener('click', async () => {
      try {
        await window.CDSApi.post(`equipamentos/${id}/desativar`, {});
        showToast('Desativado.', 'success');
        renderDetail(root, id);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    root.querySelector('[data-action="logs"]')?.addEventListener('click', async () => {
      try {
        const logs = unwrapList(await window.CDSApi.get(`equipamentos/${id}/logs`).catch(() =>
          window.CDSApi.get(`equipamentos/${id}/diagnostico`)));
        showToast(logs.length ? `${logs.length} registro(s)` : 'Sem logs', 'info');
      } catch (err) {
        showToast(err.message || 'Logs indisponíveis', 'error');
      }
    });
    root.querySelector('[data-action="excluir"]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'Excluir equipamento',
        message: 'Remover este equipamento?',
        confirmLabel: 'Excluir',
        danger: true
      });
      if (!ok) return;
      try {
        await window.CDSApi.del(`equipamentos/${id}`);
        showToast('Excluído.', 'success');
        window.CDSMobile?.navigate?.('equipamentos', { replace: true });
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Equipamentos')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function render(root, parsed) {
  const p = parsed?.parts?.[1];
  if (p === 'novo') return renderForm(root);
  if (p) return renderDetail(root, p);
  return renderList(root);
}

export default { render, title: 'Equipamentos', subtitle: 'Sistema' };
