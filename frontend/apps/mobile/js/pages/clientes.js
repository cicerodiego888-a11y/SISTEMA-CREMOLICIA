/**
 * CDS Mobile RC2.4.2 — Cadastro de Clientes (paridade ERP Desktop)
 * Referência: frontend/erp/js/clientes.js → saveCliente
 * Sem foto — inexistente no ERP Desktop.
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
  sectionTitleHtml
} from '../ui.js';
import {
  fieldHtml,
  formCardHtml,
  collectForm,
  fabHtml,
  actionBarHtml,
  confirmDanger,
  cadastroSectionHtml,
  formSubmitActionsHtml,
  bindCadastroCep,
  bindCpfCnpjMask
} from '../forms.js';
import { showToast } from '../toast.js';
import { openWhatsApp, openCall, openMaps, sharePayload } from '../native.js';

/** Payload idêntico ao Desktop saveCliente. */
export function buildClientePayload(raw = {}) {
  const lim = parseFloat(raw.limite_credito);
  return {
    nome: String(raw.nome || '').trim(),
    cpf_cnpj: String(raw.cpf_cnpj || '').trim(),
    inscricao_estadual: String(raw.inscricao_estadual || '').trim(),
    telefone: String(raw.telefone || '').trim(),
    email: String(raw.email || '').trim(),
    cep: String(raw.cep || '').trim(),
    rua: String(raw.rua || '').trim(),
    numero: String(raw.numero || '').trim(),
    bairro: String(raw.bairro || '').trim(),
    cidade: String(raw.cidade || '').trim(),
    uf: String(raw.uf || '').trim().toUpperCase(),
    limite_credito: Number.isFinite(lim) ? lim : 0
  };
}

function fieldsCliente(c = {}) {
  return `
    ${cadastroSectionHtml('Identificação')}
    ${fieldHtml({ name: 'nome', label: 'Nome', value: c.nome, required: true, autocomplete: 'name' })}
    ${fieldHtml({ name: 'cpf_cnpj', label: 'CPF/CNPJ', value: c.cpf_cnpj, inputmode: 'numeric' })}
    ${fieldHtml({ name: 'inscricao_estadual', label: 'Inscrição Estadual', value: c.inscricao_estadual })}
    ${fieldHtml({ name: 'telefone', label: 'Telefone', value: c.telefone, type: 'tel', inputmode: 'tel' })}
    ${fieldHtml({ name: 'email', label: 'E-mail', value: c.email, type: 'email' })}
    ${cadastroSectionHtml('Endereço')}
    ${fieldHtml({ name: 'cep', label: 'CEP', value: c.cep, inputmode: 'numeric' })}
    ${fieldHtml({ name: 'rua', label: 'Rua', value: c.rua })}
    ${fieldHtml({ name: 'numero', label: 'Número', value: c.numero })}
    ${fieldHtml({ name: 'bairro', label: 'Bairro', value: c.bairro })}
    ${fieldHtml({ name: 'cidade', label: 'Cidade', value: c.cidade })}
    ${fieldHtml({ name: 'uf', label: 'UF', value: c.uf })}
    ${cadastroSectionHtml('Crédito')}
    ${fieldHtml({
      name: 'limite_credito',
      label: 'Limite de Crédito (fiado)',
      value: c.limite_credito ?? 0,
      type: 'number',
      inputmode: 'decimal'
    })}
  `;
}

function enderecoTexto(c) {
  return [c.rua, c.numero, c.bairro, c.cidade, c.uf]
    .map((x) => asText(x, ''))
    .filter(Boolean)
    .join(', ');
}

function paintList(list, count, rows) {
  count.textContent = countLabel(rows.length, 'cliente exibido', 'clientes exibidos');
  list.innerHTML = rows.length
    ? rows.map((c) => listCardHtml({
        go: `clientes/${c.id}`,
        title: asText(c.nome, 'Sem nome'),
        subtitle: asText(c.cpf_cnpj, '—'),
        meta: [asText(c.telefone, '')].filter(Boolean)
      })).join('')
    : emptyHtml('Nenhum cliente encontrado');
  bindGo(list);
}

export async function renderClientes(root) {
  root.innerHTML = `
    ${searchBarHtml('Buscar nome, CPF/CNPJ ou telefone', 'clientes-search')}
    <p class="cds-muted" id="clientes-count">Carregando…</p>
    <div id="clientes-list">${loadingHtml('Listando clientes…')}</div>
    ${fabHtml('Novo cliente', 'clientes/novo')}
  `;

  const list = root.querySelector('#clientes-list');
  const count = root.querySelector('#clientes-count');
  const input = root.querySelector('#clientes-search');

  const loadInitial = async () => {
    try {
      let rows = await window.CDSApi.get('clientes');
      if (!Array.isArray(rows)) rows = [];
      paintList(list, count, rows.slice(0, 40));
    } catch (err) {
      count.textContent = 'Digite para buscar';
      list.innerHTML = emptyHtml('Busque um cliente', err.status === 403
        ? 'Sem permissão para listar. Use a busca se disponível.'
        : 'Informe nome, documento ou telefone.');
    }
  };

  const runSearch = async (term) => {
    const q = String(term || '').trim();
    if (q.length < 2) {
      await loadInitial();
      return;
    }
    list.innerHTML = loadingHtml('Buscando…');
    try {
      let rows = await window.CDSApi.get('clientes', { busca: q });
      if (!Array.isArray(rows)) rows = [];
      paintList(list, count, rows.slice(0, 50));
    } catch (err) {
      list.innerHTML = errorHtml(err.message, err.status);
    }
  };

  bindGo(root);
  input?.addEventListener('input', debounce((e) => runSearch(e.target.value), 280));
  await loadInitial();
}

export async function renderForm(root, id) {
  const isNew = !id || id === 'novo';
  root.innerHTML = loadingHtml(isNew ? 'Preparando formulário…' : 'Carregando cliente…');

  try {
    let c = {};
    if (!isNew) {
      c = await window.CDSApi.get(`clientes/${id}`);
      if (!c) {
        root.innerHTML = `${backBarHtml('Clientes')}${errorHtml('Cliente não encontrado.', 404)}`;
        bindBack(root);
        return;
      }
    }

    root.innerHTML = `
      ${backBarHtml('Clientes')}
      ${formCardHtml(
        isNew ? 'Novo cliente' : 'Editar cliente',
        fieldsCliente(c),
        formSubmitActionsHtml(isNew ? 'Salvar' : 'Atualizar')
      )}
    `;
    bindBack(root);
    bindCpfCnpjMask(root);
    bindCadastroCep(root);

    root.querySelector('#cds-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = buildClientePayload(collectForm(e.target));
      if (!body.nome) {
        showToast('Nome é obrigatório.', 'warning');
        return;
      }
      try {
        if (isNew) {
          const created = await window.CDSApi.post('clientes', body);
          showToast('Cliente criado.', 'success');
          window.CDSMobile?.navigate?.(`clientes/${created.id || created?.data?.id}`, { replace: true });
        } else {
          await window.CDSApi.put(`clientes/${id}`, body);
          showToast('Cliente atualizado.', 'success');
          window.CDSMobile?.navigate?.(`clientes/${id}`, { replace: true });
        }
      } catch (err) {
        showToast(err.message || 'Falha ao salvar cliente', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Clientes')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function renderDetail(root, id) {
  if (!id || id === 'novo') return renderForm(root, id);

  root.innerHTML = loadingHtml('Abrindo cliente…');
  try {
    const c = await window.CDSApi.get(`clientes/${id}`);
    if (!c) {
      root.innerHTML = `${backBarHtml('Clientes')}${errorHtml('Cliente não encontrado.', 404)}`;
      bindBack(root);
      return;
    }

    const endereco = enderecoTexto(c);
    let vendas = [];
    let financeiro = null;

    try {
      const vRaw = await window.CDSApi.get(`clientes/${id}/vendas`);
      vendas = Array.isArray(vRaw) ? vRaw : vRaw?.items || vRaw?.data || vRaw?.vendas || [];
      vendas = vendas.slice(0, 15);
    } catch (e) {
      try {
        const vRaw = await window.CDSApi.get('vendas', { busca: asText(c.nome, ''), limite: 20 });
        vendas = Array.isArray(vRaw) ? vRaw : vRaw?.items || vRaw?.data || [];
        vendas = vendas.filter((v) => Number(v.cliente_id) === Number(id)).slice(0, 15);
      } catch (e2) {
        vendas = [];
      }
    }

    try {
      financeiro = await window.CDSApi.get(`financeiro/receber/agrupado/${id}`);
    } catch (e) {
      financeiro = null;
    }

    const finRows = Array.isArray(financeiro?.titulos)
      ? financeiro.titulos
      : Array.isArray(financeiro?.contas)
        ? financeiro.contas
        : Array.isArray(financeiro)
          ? financeiro
          : [];

    root.innerHTML = `
      ${backBarHtml('Clientes')}
      <article class="cds-card cds-m-enter">
        <h3 class="cds-card__title" style="margin:0 0 10px">${escapeHtml(asText(c.nome, 'Cliente'))}</h3>
        <div class="cds-row"><span>Documento</span><strong>${escapeHtml(asText(c.cpf_cnpj))}</strong></div>
        <div class="cds-row"><span>Inscrição Estadual</span><strong>${escapeHtml(asText(c.inscricao_estadual))}</strong></div>
        <div class="cds-row"><span>Telefone</span><strong>${escapeHtml(asText(c.telefone))}</strong></div>
        <div class="cds-row"><span>E-mail</span><strong>${escapeHtml(asText(c.email))}</strong></div>
        <div class="cds-row"><span>Limite de crédito</span><strong>${escapeHtml(formatMoney(c.limite_credito || 0))}</strong></div>
        <div class="cds-row"><span>Crédito atual</span><strong>${escapeHtml(formatMoney(c.credito_atual || 0))}</strong></div>
      </article>
      <article class="cds-card">
        <h3 class="cds-card__title">Endereço</h3>
        <p class="cds-mobile-break">${escapeHtml(endereco || 'Não informado')}</p>
        <p class="cds-muted">CEP ${escapeHtml(asText(c.cep))}</p>
      </article>

      ${sectionTitleHtml('Histórico comercial')}
      <div>
        ${vendas.length
          ? vendas.map((v) => listCardHtml({
              go: `pdv/venda/${v.id}`,
              title: `Venda #${v.id}`,
              value: formatMoney(v.total ?? v.valor_total ?? 0),
              meta: [formatDate(v.data || v.created_at), asText(v.status, '')]
            })).join('')
          : emptyHtml('Sem vendas recentes neste cliente')}
      </div>

      ${sectionTitleHtml('Histórico financeiro')}
      <div>
        ${finRows.length
          ? finRows.slice(0, 20).map((t) => listCardHtml({
              title: asText(t.descricao || t.historico || 'Título'),
              value: formatMoney(t.valor ?? t.saldo ?? t.valor_aberto ?? 0),
              meta: [formatDate(t.vencimento || t.data_vencimento), asText(t.status, '')]
            })).join('')
          : emptyHtml(financeiro
            ? `Em aberto: ${formatMoney(financeiro.total_aberto ?? financeiro.saldo ?? 0)}`
            : 'Sem títulos financeiros')}
      </div>

      ${actionBarHtml([
        { action: 'conta', label: 'Conta corrente', icon: 'money', variant: 'secondary' },
        { action: 'whatsapp', label: 'WhatsApp', icon: 'phone', variant: 'secondary' },
        { action: 'ligar', label: 'Ligar', icon: 'phone', variant: 'ghost' },
        { action: 'maps', label: 'Maps', icon: 'map', variant: 'secondary' },
        { action: 'share', label: 'Compartilhar', icon: 'share', variant: 'ghost' },
        { action: 'edit', label: 'Editar', icon: 'edit', variant: 'secondary' },
        { action: 'delete', label: 'Excluir', icon: 'trash', variant: 'ghost' }
      ])}
    `;
    bindBack(root);
    bindGo(root);

    root.querySelector('[data-action="conta"]')?.addEventListener('click', () => {
      window.CDSMobile?.navigate?.(`financeiro/cliente/${id}`);
    });
    root.querySelector('[data-action="whatsapp"]')?.addEventListener('click', () => {
      openWhatsApp(c.telefone, `Olá ${asText(c.nome)}!`);
    });
    root.querySelector('[data-action="ligar"]')?.addEventListener('click', () => {
      openCall(c.telefone);
    });
    root.querySelector('[data-action="maps"]')?.addEventListener('click', () => {
      openMaps(endereco || [c.cidade, c.uf].filter(Boolean).join(', '));
    });
    root.querySelector('[data-action="share"]')?.addEventListener('click', async () => {
      await sharePayload({
        title: asText(c.nome, 'Cliente'),
        text: `${asText(c.nome)}\n${asText(c.cpf_cnpj)}\n${asText(c.telefone)}\n${endereco}`
      });
    });
    root.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
      window.CDSMobile?.navigate?.(`clientes/${id}/editar`);
    });
    root.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      const ok = await confirmDanger(`Excluir cliente "${c.nome}"?`, { title: 'Excluir cliente', confirmLabel: 'Excluir' });
      if (!ok) return;
      try {
        await window.CDSApi.del(`clientes/${id}`);
        showToast('Cliente excluído.', 'success');
        window.CDSMobile?.navigate?.('clientes', { replace: true });
      } catch (err) {
        showToast(err.message || 'Não foi possível excluir', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Clientes')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
    showToast(err.message || 'Erro ao abrir cliente', 'error');
  }
}

export async function render(root, parsed) {
  const parts = parsed?.parts || [];
  if (parts[1] === 'novo') return renderForm(root, null);
  if (parts[1] && parts[2] === 'editar') return renderForm(root, parts[1]);
  if (parts[1]) return renderDetail(root, parts[1]);
  return renderClientes(root);
}

export default {
  render,
  renderDetail,
  buildClientePayload,
  title: 'Clientes',
  subtitle: 'Cadastros'
};
