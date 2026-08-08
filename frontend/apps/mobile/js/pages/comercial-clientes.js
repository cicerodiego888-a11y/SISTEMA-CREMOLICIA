/**
 * CDS Mobile RCM-03 — Clientes Comerciais / Cliente Consignado
 * Paridade Motor Comercial Desktop (ClienteCadastroView + Cliente 360).
 * APIs: /api/clientes + /api/comercial/perfil-comercial*
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatDate,
  loadingHtml,
  emptyHtml,
  errorHtml,
  searchBarHtml,
  listCardHtml,
  backBarHtml,
  bindBack,
  bindGo,
  debounce,
  countLabel,
  sectionTitleHtml,
  statusBadgeHtml
} from '../ui.js';
import {
  fieldHtml,
  collectForm,
  fabHtml,
  confirmDanger,
  cadastroSectionHtml,
  formSubmitActionsHtml,
  bindCadastroCep,
  bindCpfCnpjMask,
  currentUserId,
  unwrapList,
  promptSheet,
  openBottomSheet
} from '../forms.js';
import { showToast } from '../toast.js';
import { canCreateComercial, isOperadorComercial } from '../permissions.js';
import { buildClientePayload } from './clientes.js';

const CAPACIDADES = [
  { key: 'consignacao', label: 'Consignação', perfilTipo: 'CONSIGNADO', prazo: true },
  { key: 'atacado', label: 'Atacado', perfilTipo: 'ATACADISTA', prazo: false },
  { key: 'credito', label: 'Crédito', perfilTipo: 'CONSUMIDOR', prazo: false },
  { key: 'convenio', label: 'Convênio', perfilTipo: 'DISTRIBUIDOR', prazo: false },
  { key: 'revenda', label: 'Revenda', perfilTipo: 'REPRESENTANTE', prazo: false }
];

function withUsuario(body = {}) {
  const uid = currentUserId();
  return {
    ...body,
    usuarioId: uid != null ? Number(uid) : uid
  };
}

function apiErrorMessage(err) {
  return err?.payload?.error
    || err?.payload?.message
    || err?.message
    || 'Erro na API';
}

function unwrapData(raw) {
  if (raw == null) return null;
  if (raw.data !== undefined) return raw.data;
  if (raw.payload !== undefined) return raw.payload;
  return raw;
}

async function listarPerfis(filters = {}) {
  const raw = await window.CDSApi.get('comercial/perfil-comercial', filters);
  return unwrapList(raw);
}

function perfilTipoLabel(tipo) {
  const cap = CAPACIDADES.find((c) => c.perfilTipo === tipo);
  return cap ? cap.label : (tipo || '—');
}

function buildObservacoes(prazoPrestacao, observacoes) {
  const parts = [];
  if (prazoPrestacao) parts.push(`Prazo para prestação: ${prazoPrestacao} dias`);
  if (observacoes) parts.push(String(observacoes).trim());
  return parts.length ? parts.join('\n') : null;
}

function capacidadesFormHtml(perfis = []) {
  const byTipo = new Map(perfis.map((p) => [String(p.perfilTipo || p.tipo || ''), p]));
  return CAPACIDADES.map((cap) => {
    const p = byTipo.get(cap.perfilTipo);
    const on = !!p && p.ativo !== false;
    const lim = p?.limiteComercial ?? p?.limite_comercial ?? 0;
    const obs = p?.observacoes || '';
    const prazoMatch = String(obs).match(/Prazo para prestação:\s*(\d+)/i);
    const prazo = prazoMatch ? prazoMatch[1] : '';
    return `
      <label class="cds-check-card" style="display:block;margin-bottom:10px">
        <div class="cds-row" style="align-items:center;gap:8px">
          <input type="checkbox" name="cap_${cap.key}" value="1" ${on ? 'checked' : ''} data-cap="${escapeHtml(cap.key)}">
          <strong>${escapeHtml(cap.label)}</strong>
          ${p?.bloqueado ? statusBadgeHtml('Bloqueado') : ''}
        </div>
        <div class="cds-cap-fields" data-cap-fields="${escapeHtml(cap.key)}" style="margin-top:8px;${!on ? 'opacity:.55' : ''}">
          ${fieldHtml({
            name: `limite_${cap.key}`,
            label: 'Limite comercial (R$)',
            type: 'number',
            inputmode: 'decimal',
            value: lim
          })}
          ${cap.prazo ? fieldHtml({
            name: `prazo_${cap.key}`,
            label: 'Prazo prestação (dias)',
            type: 'number',
            inputmode: 'numeric',
            value: prazo
          }) : ''}
          ${fieldHtml({
            name: `obs_${cap.key}`,
            label: 'Observações',
            value: obs.replace(/Prazo para prestação:\s*\d+\s*dias\n?/i, '').trim(),
            rows: 2
          })}
          <input type="hidden" name="perfilId_${cap.key}" value="${escapeHtml(p?.id || '')}">
        </div>
      </label>
    `;
  }).join('');
}

function collectCapacidades(formEl) {
  const data = collectForm(formEl);
  const out = [];
  for (const cap of CAPACIDADES) {
    const enabled = formEl.querySelector(`[name="cap_${cap.key}"]`)?.checked;
    if (!enabled) continue;
    const lim = Number(data[`limite_${cap.key}`] || 0);
    const prazo = cap.prazo ? Number(data[`prazo_${cap.key}`] || 0) : 0;
    const obsRaw = data[`obs_${cap.key}`] || '';
    out.push({
      key: cap.key,
      perfilTipo: cap.perfilTipo,
      perfilId: data[`perfilId_${cap.key}`] || null,
      limiteComercial: Number.isFinite(lim) ? lim : 0,
      observacoes: buildObservacoes(prazo > 0 ? prazo : null, obsRaw)
    });
  }
  return out;
}

function bindCapToggles(root) {
  root.querySelectorAll('[data-cap]').forEach((cb) => {
    const key = cb.getAttribute('data-cap');
    const fields = root.querySelector(`[data-cap-fields="${key}"]`);
    const sync = () => {
      if (fields) fields.style.opacity = cb.checked ? '1' : '0.55';
    };
    cb.addEventListener('change', sync);
    sync();
  });
}

async function salvarClienteEPerfis({ clienteId, isEdit, formEl }) {
  const cadastro = buildClientePayload(collectForm(formEl));
  if (!cadastro.nome) {
    throw new Error('Informe o nome do cliente.');
  }
  const caps = collectCapacidades(formEl);
  if (!caps.length) {
    throw new Error('Habilite ao menos uma capacidade comercial (ex.: Consignação).');
  }

  let id = clienteId;
  if (isEdit && id) {
    await window.CDSApi.put(`clientes/${id}`, cadastro);
  } else {
    const criado = await window.CDSApi.post('clientes', cadastro);
    id = criado?.id || criado?.data?.id || criado;
  }
  id = Number(id);

  const existentes = await listarPerfis({ clienteId: id });
  const byTipo = new Map(existentes.map((p) => [String(p.perfilTipo || ''), p]));

  for (const cap of caps) {
    const existente = byTipo.get(cap.perfilTipo);
    const perfilId = cap.perfilId || existente?.id;
    if (perfilId) {
      await window.CDSApi.put(`comercial/perfil-comercial/${perfilId}`, withUsuario({
        ativo: true,
        observacoes: cap.observacoes
      }));
      if (cap.limiteComercial >= 0) {
        await window.CDSApi.patch(`comercial/perfil-comercial/${perfilId}/limite`, withUsuario({
          novoLimite: Number(cap.limiteComercial)
        }));
      }
    } else {
      await window.CDSApi.post('comercial/perfil-comercial', withUsuario({
        clienteId: id,
        perfilTipo: cap.perfilTipo,
        limiteComercial: cap.limiteComercial,
        observacoes: cap.observacoes,
        ativo: true
      }));
    }
  }

  return id;
}

/** Lista clientes com perfil comercial. */
export async function renderLista(root) {
  root.innerHTML = loadingHtml('Carregando clientes comerciais…');
  try {
    const [clientesRaw, perfis] = await Promise.all([
      window.CDSApi.get('clientes'),
      listarPerfis({})
    ]);
    const clientes = unwrapList(clientesRaw);
    const byCliente = new Map();
    for (const p of perfis) {
      const cid = Number(p.clienteId || p.cliente_id);
      if (!cid) continue;
      if (!byCliente.has(cid)) byCliente.set(cid, []);
      byCliente.get(cid).push(p);
    }

    const rows = clientes
      .filter((c) => byCliente.has(Number(c.id)))
      .map((c) => {
        const ps = byCliente.get(Number(c.id)) || [];
        const labels = [...new Set(ps.map((p) => perfilTipoLabel(p.perfilTipo)))].join(', ');
        const bloqueado = ps.some((p) => p.bloqueado);
        return { ...c, _caps: labels, _bloqueado: bloqueado, _perfis: ps };
      });

    root.innerHTML = `
      ${backBarHtml('Comercial')}
      ${sectionTitleHtml('Clientes comerciais')}
      <p class="cds-muted">Perfil Motor Comercial (Consignado, Atacado…)</p>
      ${searchBarHtml('Buscar cliente…', 'cc-busca')}
      <div id="cc-lista" class="cds-list">
        ${rows.length
          ? rows.map((c) => listCardHtml({
            title: c.nome,
            subtitle: c._caps + (c._bloqueado ? ' · Bloqueado' : ''),
            value: formatMoney(
              Math.max(0, ...c._perfis.map((p) => Number(p.limiteComercial || 0)))
            ),
            go: `comercial/clientes/${c.id}`
          })).join('')
          : emptyHtml('Nenhum cliente com perfil comercial', 'Cadastre um Cliente Consignado.')}
      </div>
      ${countLabel(rows.length, 'cliente')}
      ${canCreateComercial() || isOperadorComercial()
        ? fabHtml('Novo consignado', 'comercial/clientes/novo')
        : ''}
    `;

    bindBack(root);
    bindGo(root);

    const listEl = root.querySelector('#cc-lista');
    const allCards = rows;
    root.querySelector('#cc-busca')?.addEventListener('input', debounce((e) => {
      const q = String(e.target.value || '').toLowerCase().trim();
      const filtered = !q
        ? allCards
        : allCards.filter((c) => String(c.nome || '').toLowerCase().includes(q)
          || String(c.cpf_cnpj || '').includes(q));
      listEl.innerHTML = filtered.length
        ? filtered.map((c) => listCardHtml({
          title: c.nome,
          subtitle: c._caps + (c._bloqueado ? ' · Bloqueado' : ''),
          value: formatMoney(Math.max(0, ...c._perfis.map((p) => Number(p.limiteComercial || 0)))),
          go: `comercial/clientes/${c.id}`
        })).join('')
        : emptyHtml('Nenhum resultado');
      bindGo(listEl);
    }, 200));
  } catch (err) {
    root.innerHTML = `${backBarHtml('Comercial')}${errorHtml(apiErrorMessage(err), err.status)}`;
    bindBack(root);
  }
}

export async function renderForm(root, clienteId) {
  const isEdit = !!clienteId;
  root.innerHTML = loadingHtml(isEdit ? 'Carregando…' : 'Novo cliente comercial…');

  try {
    let cliente = {};
    let perfis = [];
    if (isEdit) {
      cliente = await window.CDSApi.get(`clientes/${clienteId}`);
      perfis = await listarPerfis({ clienteId });
    }

    root.innerHTML = `
      ${backBarHtml(isEdit ? 'Cliente 360' : 'Clientes comerciais')}
      <h2 class="cds-page-title" style="font-size:1.2rem;margin:8px 0 12px">
        ${isEdit ? 'Editar cliente comercial' : 'Cliente Consignado'}
      </h2>
      <p class="cds-muted">Mesmo fluxo do Desktop — ERP + perfil Motor Comercial.</p>
      <form id="cc-form" class="cds-form">
        <div class="cds-card cds-form cds-m-enter">
          ${cadastroSectionHtml('Identificação')}
          ${fieldHtml({ name: 'nome', label: 'Nome', value: cliente.nome, required: true, autocomplete: 'name' })}
          ${fieldHtml({ name: 'cpf_cnpj', label: 'CPF/CNPJ', value: cliente.cpf_cnpj, inputmode: 'numeric' })}
          ${fieldHtml({ name: 'telefone', label: 'Telefone', value: cliente.telefone, type: 'tel' })}
          ${fieldHtml({ name: 'email', label: 'E-mail', value: cliente.email, type: 'email' })}
          ${cadastroSectionHtml('Endereço')}
          ${fieldHtml({ name: 'cep', label: 'CEP', value: cliente.cep, inputmode: 'numeric' })}
          ${fieldHtml({ name: 'rua', label: 'Rua', value: cliente.rua })}
          ${fieldHtml({ name: 'numero', label: 'Número', value: cliente.numero })}
          ${fieldHtml({ name: 'bairro', label: 'Bairro', value: cliente.bairro })}
          ${fieldHtml({ name: 'cidade', label: 'Cidade', value: cliente.cidade })}
          ${fieldHtml({ name: 'uf', label: 'UF', value: cliente.uf })}
          ${cadastroSectionHtml('Capacidades comerciais')}
          ${capacidadesFormHtml(perfis)}
        </div>
        ${formSubmitActionsHtml(isEdit ? 'Salvar' : 'Cadastrar')}
      </form>
    `;

    bindBack(root);
    const form = root.querySelector('#cc-form');
    bindCadastroCep(form);
    bindCpfCnpjMask(form);
    bindCapToggles(form);

    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      if (btn) btn.setAttribute('aria-busy', 'true');
      try {
        const id = await salvarClienteEPerfis({
          clienteId,
          isEdit,
          formEl: form
        });
        showToast('Cliente comercial salvo.', 'success');
        window.CDSMobile?.navigate?.(`comercial/clientes/${id}`, { replace: true });
      } catch (err) {
        showToast(apiErrorMessage(err) || err.message, 'error');
      } finally {
        if (btn) btn.removeAttribute('aria-busy');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Clientes')}${errorHtml(apiErrorMessage(err), err.status)}`;
    bindBack(root);
  }
}

/** Cliente 360 — Central de Operações Mobile */
export async function renderDetalhe(root, clienteId) {
  root.innerHTML = loadingHtml('Cliente 360…');
  const id = Number(clienteId);

  try {
    const settled = await Promise.allSettled([
      window.CDSApi.get(`clientes/${id}`),
      listarPerfis({ clienteId: id }),
      window.CDSApi.get('comercial/projections/situacao-cliente', { clienteId: id }),
      window.CDSApi.get('comercial/projections/conta-corrente', { clienteId: id }),
      window.CDSApi.get('comercial/projections/pendencias', { clienteId: id })
    ]);

    const cliente = settled[0].status === 'fulfilled' ? settled[0].value : null;
    if (!cliente) {
      throw settled[0].reason || new Error('Cliente não encontrado');
    }
    const perfis = settled[1].status === 'fulfilled' ? settled[1].value : [];
    const situacao = unwrapData(settled[2].status === 'fulfilled' ? settled[2].value : null) || {};
    const conta = unwrapData(settled[3].status === 'fulfilled' ? settled[3].value : null) || {};
    const pendencias = unwrapData(settled[4].status === 'fulfilled' ? settled[4].value : null);

    const pendList = Array.isArray(pendencias)
      ? pendencias
      : (pendencias?.items || pendencias?.data || []);

    const consignado = perfis.find((p) => String(p.perfilTipo) === 'CONSIGNADO') || perfis[0];

    root.innerHTML = `
      ${backBarHtml('Clientes comerciais')}
      <article class="cds-card cds-m-enter">
        <h3 class="cds-card__title" style="margin:0 0 8px">${escapeHtml(cliente.nome)}</h3>
        <div class="cds-row"><span>Documento</span><strong>${escapeHtml(cliente.cpf_cnpj || '—')}</strong></div>
        <div class="cds-row"><span>Telefone</span><strong>${escapeHtml(cliente.telefone || '—')}</strong></div>
        <div class="cds-row"><span>Cidade</span><strong>${escapeHtml([cliente.cidade, cliente.uf].filter(Boolean).join('/') || '—')}</strong></div>
      </article>

      ${sectionTitleHtml('Perfis comerciais')}
      <div class="cds-list">
        ${perfis.length
          ? perfis.map((p) => `
            <article class="cds-card">
              <div class="cds-row">
                <strong>${escapeHtml(perfilTipoLabel(p.perfilTipo))}</strong>
                ${p.bloqueado ? statusBadgeHtml('Bloqueado') : statusBadgeHtml(p.ativo === false ? 'Inativo' : 'Ativo')}
              </div>
              <div class="cds-row"><span>Limite</span><strong>${formatMoney(p.limiteComercial || 0)}</strong></div>
              <div class="cds-row"><span>ID perfil</span><strong>${escapeHtml(String(p.id))}</strong></div>
              <div class="cds-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary cds-btn-sm" data-act="limite" data-perfil="${escapeHtml(p.id)}">Limite</button>
                ${p.bloqueado
                  ? `<button type="button" class="cds-mobile-btn cds-mobile-btn--secondary cds-btn-sm" data-act="desbloquear" data-perfil="${escapeHtml(p.id)}">Desbloquear</button>`
                  : `<button type="button" class="cds-mobile-btn cds-mobile-btn--secondary cds-btn-sm" data-act="bloquear" data-perfil="${escapeHtml(p.id)}">Bloquear</button>`}
                <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary cds-btn-sm" data-act="historico" data-perfil="${escapeHtml(p.id)}">Histórico</button>
              </div>
            </article>
          `).join('')
          : emptyHtml('Sem perfil comercial', 'Edite e habilite Consignação.')}
      </div>

      ${sectionTitleHtml('Situação')}
      <article class="cds-card">
        <div class="cds-row"><span>Situação</span><strong>${escapeHtml(asText(situacao.situacao || situacao.status || situacao.situacaoFinanceira || '—'))}</strong></div>
        <div class="cds-row"><span>Crédito usado</span><strong>${formatMoney(situacao.creditoUtilizado ?? situacao.utilizado ?? 0)}</strong></div>
        <div class="cds-row"><span>Disponível</span><strong>${formatMoney(situacao.creditoDisponivel ?? situacao.disponivel ?? 0)}</strong></div>
      </article>

      ${sectionTitleHtml('Conta corrente')}
      <article class="cds-card">
        <div class="cds-row"><span>Saldo</span><strong>${formatMoney(conta.saldo ?? conta.saldoAtual ?? 0)}</strong></div>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" style="margin-top:8px;width:100%" data-go="financeiro/cliente/${id}">
          Abrir conta corrente
        </button>
      </article>

      ${sectionTitleHtml('Pendências')}
      <div class="cds-list">
        ${pendList.length
          ? pendList.slice(0, 15).map((p) => listCardHtml({
            title: p.titulo || p.tipo || p.mensagem || 'Pendência',
            subtitle: p.descricao || p.status || '',
            meta: p.prioridade || ''
          })).join('')
          : emptyHtml('Sem pendências')}
      </div>

      ${sectionTitleHtml('Central de operações')}
      <div class="cds-quick-grid" style="grid-template-columns:1fr 1fr">
        <button type="button" class="cds-quick" data-go="comercial/nova">Nova consignação</button>
        <button type="button" class="cds-quick" data-go="comercial">Consignações</button>
        <button type="button" class="cds-quick" data-go="comercial/clientes/${id}/editar">Editar</button>
        <button type="button" class="cds-quick" data-go="clientes/${id}">Ficha ERP</button>
      </div>

      <div class="cds-action-bar" style="margin-top:12px">
        <button type="button" class="cds-mobile-btn" data-go="comercial/clientes/${id}/editar">Editar</button>
        ${consignado ? `<button type="button" class="cds-mobile-btn cds-mobile-btn--danger" id="btn-excluir-perfil">Desativar consignado</button>` : ''}
      </div>
    `;

    bindBack(root);
    bindGo(root);

    root.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.getAttribute('data-act');
        const perfilId = btn.getAttribute('data-perfil');
        try {
          if (act === 'bloquear') {
            const ok = await confirmDanger('Bloquear este perfil comercial?');
            if (!ok) return;
            const motivoData = await promptSheet({
              title: 'Motivo do bloqueio',
              fieldsHtml: fieldHtml({ name: 'motivo', label: 'Motivo', required: true }),
              collect: (form) => collectForm(form)?.motivo
            });
            if (motivoData == null || motivoData === '') return;
            await window.CDSApi.patch(`comercial/perfil-comercial/${perfilId}/bloquear`, withUsuario({ motivo: motivoData }));
            showToast('Perfil bloqueado.', 'success');
            return renderDetalhe(root, id);
          }
          if (act === 'desbloquear') {
            const ok = await confirmDanger('Desbloquear perfil?');
            if (!ok) return;
            await window.CDSApi.patch(`comercial/perfil-comercial/${perfilId}/desbloquear`, withUsuario({}));
            showToast('Perfil desbloqueado.', 'success');
            return renderDetalhe(root, id);
          }
          if (act === 'limite') {
            const limData = await promptSheet({
              title: 'Novo limite comercial',
              fieldsHtml: `
                ${fieldHtml({ name: 'novoLimite', label: 'Valor (R$)', inputmode: 'decimal', required: true })}
                ${fieldHtml({ name: 'motivo', label: 'Motivo (opcional)' })}
              `,
              collect: (form) => collectForm(form)
            });
            if (limData == null) return;
            const novoLimite = Number(String(limData.novoLimite || '').replace(',', '.'));
            if (!Number.isFinite(novoLimite) || novoLimite < 0) {
              showToast('Limite inválido.', 'warning');
              return;
            }
            await window.CDSApi.patch(`comercial/perfil-comercial/${perfilId}/limite`, withUsuario({
              novoLimite,
              motivo: limData.motivo || undefined
            }));
            showToast('Limite atualizado.', 'success');
            return renderDetalhe(root, id);
          }
          if (act === 'historico') {
            const hist = unwrapData(await window.CDSApi.get(`comercial/perfil-comercial/${perfilId}/historico`));
            const items = Array.isArray(hist) ? hist : (hist?.items || hist?.eventos || []);
            openBottomSheet({
              title: 'Histórico do perfil',
              bodyHtml: items.length
                ? `<div class="cds-list">${items.slice(0, 40).map((h) => `
                    <article class="cds-card">
                      <div class="cds-row"><strong>${escapeHtml(h.acao || h.tipo || h.evento || 'Evento')}</strong></div>
                      <div class="cds-muted">${escapeHtml(formatDate(h.created_at || h.data || h.timestamp))}</div>
                      <p>${escapeHtml(h.motivo || h.observacoes || h.descricao || '')}</p>
                    </article>
                  `).join('')}</div>`
                : emptyHtml('Sem histórico')
            });
          }
        } catch (err) {
          showToast(apiErrorMessage(err), 'error');
        }
      });
    });

    root.querySelector('#btn-excluir-perfil')?.addEventListener('click', async () => {
      if (!consignado?.id) return;
      const ok = await confirmDanger('Desativar perfil Consignado? (ativo=false)');
      if (!ok) return;
      try {
        await window.CDSApi.put(`comercial/perfil-comercial/${consignado.id}`, withUsuario({ ativo: false }));
        showToast('Perfil desativado.', 'success');
        renderDetalhe(root, id);
      } catch (err) {
        showToast(apiErrorMessage(err), 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Clientes')}${errorHtml(apiErrorMessage(err), err.status)}`;
    bindBack(root);
  }
}

export async function render(root, parsed) {
  const parts = parsed?.parts || [];
  // comercial / clientes / [novo|id] / [editar]
  if (parts[1] !== 'clientes') {
    return renderLista(root);
  }

  const seg = parts[2];
  const action = parts[3];

  if (seg === 'novo' || seg === 'nova') return renderForm(root, null);
  if (seg && action === 'editar') return renderForm(root, seg);
  if (seg) return renderDetalhe(root, seg);
  return renderLista(root);
}

export default {
  render,
  renderLista,
  renderForm,
  renderDetalhe,
  title: 'Cliente Consignado',
  subtitle: 'Comercial'
};
