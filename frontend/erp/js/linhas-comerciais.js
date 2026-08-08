/**
 * Linhas de Precificação — ERP (RA-2)
 * Cadastro simples: Código + Descrição + Ativo
 * Preços ficam exclusivamente na Tabela de Preços.
 * API interna permanece /linhas-comerciais (compat).
 */

const linhasComerciaisAPI = {
  listar: function (opts) {
    const params = [];
    if (opts === true) params.push('ativos=1');
    else if (opts && typeof opts === 'object') {
      if (opts.ativos) params.push('ativos=1');
      if (opts.q) params.push('q=' + encodeURIComponent(opts.q));
    }
    const q = params.length ? '?' + params.join('&') : '';
    return $.ajax({
      url: API_URL + '/linhas-comerciais' + q,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  buscar: function (id) {
    return $.ajax({
      url: API_URL + '/linhas-comerciais/' + id,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  criar: function (dados) {
    return $.ajax({
      url: API_URL + '/linhas-comerciais',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  atualizar: function (id, dados) {
    return $.ajax({
      url: API_URL + '/linhas-comerciais/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  excluir: function (id) {
    return $.ajax({
      url: API_URL + '/linhas-comerciais/' + id,
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  desativar: function (id) {
    return $.ajax({
      url: API_URL + '/linhas-comerciais/' + id + '/desativar',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

function ensureModalLinhaComercial() {
  if (document.getElementById('modal-linha-comercial')) return;

  const html = `
  <div class="modal fade" id="modal-linha-comercial" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="modal-linha-comercial-titulo">Nova Linha de Precificação</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="linha-comercial-id">
          <div class="row g-2">
            <div class="col-md-4">
              <label for="linha-comercial-codigo" class="form-label">Código *</label>
              <input type="text" id="linha-comercial-codigo" class="form-control" maxlength="40" placeholder="Ex.: PIC_PREMIUM">
            </div>
            <div class="col-md-8">
              <label for="linha-comercial-descricao" class="form-label">Descrição *</label>
              <input type="text" id="linha-comercial-descricao" class="form-control" maxlength="120" placeholder="Ex.: Picolés Premium">
            </div>
            <div class="col-12">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="linha-comercial-ativo" checked>
                <label class="form-check-label" for="linha-comercial-ativo">Ativo</label>
              </div>
              <small class="text-muted d-block mt-2">Os preços ficam exclusivamente na Central de Precificação.</small>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button type="button" class="btn btn-success" id="btn-salvar-linha-comercial">Salvar</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  $('#btn-salvar-linha-comercial').off('click.ra2Linha').on('click.ra2Linha', salvarLinhaComercial);
}

function modalLinhaComercialAberto() {
  const el = document.getElementById('modal-linha-comercial');
  return !!(el && el.classList.contains('show'));
}

function focarCampoCodigoLinhaComercial() {
  const el = document.getElementById('linha-comercial-codigo');
  if (!el || !modalLinhaComercialAberto()) return;
  try {
    el.focus({ preventScroll: true });
    if (typeof el.select === 'function' && el.value) el.select();
  } catch (_e) {
    el.focus();
  }
}

function agendarFocoCodigoLinhaComercial(modalEl) {
  if (!modalEl) return;
  const tentar = function () {
    focarCampoCodigoLinhaComercial();
  };
  // Bootstrap/Electron podem reassumir o foco após shown — reforça em ondas
  modalEl.addEventListener('shown.bs.modal', function onShown() {
    tentar();
    [30, 80, 160, 280].forEach(function (ms) {
      setTimeout(tentar, ms);
    });
  }, { once: true });
}

function limparFormularioLinhaComercial() {
  ensureModalLinhaComercial();
  $('#linha-comercial-id').val('');
  $('#linha-comercial-codigo').val('');
  $('#linha-comercial-descricao').val('');
  $('#linha-comercial-ativo').prop('checked', true);
  $('#modal-linha-comercial-titulo').text('Nova Linha de Precificação');
}

function abrirModalLinhaComercial(opts) {
  opts = opts || {};
  ensureModalLinhaComercial();
  limparFormularioLinhaComercial();
  const modalEl = document.getElementById('modal-linha-comercial');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl, { focus: true });

  if (opts.id) {
    $('#modal-linha-comercial-titulo').text('Editar Linha de Precificação');
    linhasComerciaisAPI.buscar(opts.id).done(function (l) {
      $('#linha-comercial-id').val(l.id);
      $('#linha-comercial-codigo').val(l.codigo || '');
      $('#linha-comercial-descricao').val(l.descricao || l.nome || '');
      $('#linha-comercial-ativo').prop('checked', !!l.ativo);
      agendarFocoCodigoLinhaComercial(modalEl);
      modal.show();
    }).fail(function (err) {
      alert('Erro ao carregar linha: ' + (err.responseJSON?.erro || err.statusText));
    });
    return;
  }

  agendarFocoCodigoLinhaComercial(modalEl);
  modal.show();
}

function salvarLinhaComercial() {
  ensureModalLinhaComercial();
  const id = $('#linha-comercial-id').val();
  const codigo = ($('#linha-comercial-codigo').val() || '').trim();
  const descricao = ($('#linha-comercial-descricao').val() || '').trim();
  const ativo = $('#linha-comercial-ativo').is(':checked');

  if (!codigo) {
    alert('Código é obrigatório.');
    return;
  }
  if (!descricao) {
    alert('Descrição é obrigatória.');
    return;
  }

  // RA-2: sem valores/canais/preços
  const dados = { codigo: codigo, descricao: descricao, ativo: ativo };
  const req = id ? linhasComerciaisAPI.atualizar(id, dados) : linhasComerciaisAPI.criar(dados);

  $('#btn-salvar-linha-comercial').prop('disabled', true);
  req.done(function () {
    const modal = bootstrap.Modal.getInstance(document.getElementById('modal-linha-comercial'));
    if (modal) modal.hide();
    if (typeof loadLinhasComerciais === 'function') loadLinhasComerciais();
    if (typeof showNotification === 'function') {
      showNotification('Linha de Precificação salva com sucesso.', 'success');
    }
  }).fail(function (err) {
    alert('Erro ao salvar: ' + (err.responseJSON?.erro || err.statusText));
  }).always(function () {
    $('#btn-salvar-linha-comercial').prop('disabled', false);
  });
}

function formatarDataLinhaRcm87(valor) {
  if (!valor) return '—';
  try {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor);
    return d.toLocaleString('pt-BR');
  } catch (_e) {
    return String(valor);
  }
}

function mapearOperacoesLinhaRcm87(canaisCsv) {
  const set = new Set(String(canaisCsv || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
  const labels = [
    ['VAREJO', 'Varejo'],
    ['ATACADO', 'Atacado'],
    ['CONSIGNADO', 'Consignação'],
    ['DELIVERY', 'Delivery'],
    ['EVENTO', 'Evento']
  ];
  return labels
    .filter(([c]) => set.has(c))
    .map(([, label]) => label)
    .join(', ') || '<span class="text-muted">Sem preço cadastrado</span>';
}

function loadLinhasComerciais(termo) {
  const opts = {};
  if (termo && String(termo).trim()) opts.q = String(termo).trim();

  const $filtro = $('#filtro-linhas-comerciais');
  const filtroEl = $filtro.length ? $filtro[0] : null;
  const manterFoco = filtroEl
    && document.activeElement === filtroEl
    && !modalLinhaComercialAberto();
  const selStart = manterFoco ? filtroEl.selectionStart : null;
  const selEnd = manterFoco ? filtroEl.selectionEnd : null;
  const reqId = (window._linhasListReqId = (window._linhasListReqId || 0) + 1);

  linhasComerciaisAPI.listar(opts).done(function (linhas) {
    if (reqId !== window._linhasListReqId) return;
    const lista = (linhas || []).slice().sort(function (a, b) {
      return String(a.descricao || a.codigo || '').localeCompare(String(b.descricao || b.codigo || ''), 'pt-BR');
    });
    let html = '';
    lista.forEach(function (l) {
      const nome = l.descricao || l.nome || l.codigo || ('#' + l.id);
      html += `
        <tr>
          <td>
            <strong>${nome}</strong>
            <div class="small text-muted"><code>${l.codigo || ''}</code></div>
          </td>
          <td class="text-center"><strong>${Number(l.produtos_vinculados || 0)}</strong></td>
          <td class="text-center">${Number(l.tabelas_com_preco || 0)}</td>
          <td class="small">${mapearOperacoesLinhaRcm87(l.canais_com_preco)}</td>
          <td class="small">${formatarDataLinhaRcm87(l.ultima_alteracao)}</td>
          <td>${l.ativo ? '<span class="badge bg-success">Ativo</span>' : '<span class="badge bg-secondary">Inativo</span>'}</td>
          <td class="text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-info" onclick="detalharLinhaComercial(${l.id})" title="Ver produtos e tabelas">Detalhes</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="editarLinhaComercial(${l.id})">Editar</button>
            ${l.ativo
              ? `<button type="button" class="btn btn-sm btn-outline-warning" onclick="desativarLinhaComercial(${l.id})">Inativar</button>`
              : `<button type="button" class="btn btn-sm btn-outline-success" onclick="ativarLinhaComercial(${l.id})">Ativar</button>`}
            <button type="button" class="btn btn-sm btn-danger" onclick="excluirLinhaComercial(${l.id})">Excluir</button>
          </td>
        </tr>
      `;
    });
    $('#linhas-comerciais-tbody').html(html || '<tr><td colspan="7" class="text-muted">Nenhuma Linha de Precificação cadastrada.</td></tr>');

    if (modalLinhaComercialAberto()) {
      focarCampoCodigoLinhaComercial();
      return;
    }
    if (manterFoco && filtroEl) {
      filtroEl.focus();
      if (selStart != null) filtroEl.setSelectionRange(selStart, selEnd);
    }
  }).fail(function (err) {
    alert('Erro ao listar Linhas de Precificação: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function detalharLinhaComercial(id) {
  $.ajax({
    url: API_URL + '/tabelas-preco/linhas/' + id + '/diagnostico',
    method: 'GET',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  }).done(function (diag) {
    $('#modalDetalheLinhaRcm87').remove();
    const produtos = (diag.produtos || []).map(function (p) {
      return `<li>${p.nome || p.codigo} <small class="text-muted">${p.codigo || ''}</small></li>`;
    }).join('') || '<li class="text-muted">Nenhum produto vinculado</li>';
    const tabelas = (diag.tabelas || []).map(function (t) {
      return `<li>${t.nome || t.codigo} <code class="small">${t.canal_codigo || ''}</code></li>`;
    }).join('') || '<li class="text-muted">Sem preço na Central de Precificação</li>';
    const deps = diag.dependencias || {};
    const hist = diag.historico || {};
    const opsHtml = (diag.operacoes || []).map(function (op) {
      return `<span class="badge ${op.com_preco ? 'bg-success' : 'bg-secondary'} me-1">${op.com_preco ? '✔' : '✖'} ${op.label}</span>`;
    }).join('');
    const ultima = hist.ultima_alteracao || diag.ultima_alteracao || '—';
    const html = `
      <div class="modal fade" id="modalDetalheLinhaRcm87" tabindex="-1">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Dashboard — ${diag.linha?.descricao || diag.linha?.codigo || ''}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div class="row g-2 mb-3">
                <div class="col-md-3"><div class="border rounded p-2 text-center"><div class="small text-muted">Produtos</div><div class="fs-4">${Number(deps.produtos ?? diag.produtos_vinculados ?? 0)}</div></div></div>
                <div class="col-md-3"><div class="border rounded p-2 text-center"><div class="small text-muted">Tabelas</div><div class="fs-4">${Number(deps.tabelas ?? diag.tabelas_com_preco ?? 0)}</div></div></div>
                <div class="col-md-3"><div class="border rounded p-2 text-center"><div class="small text-muted">Operações</div><div class="fs-4">${Number(deps.operacoes || 0)}</div></div></div>
                <div class="col-md-3"><div class="border rounded p-2 text-center"><div class="small text-muted">Sem preço / Fallback</div><div class="fs-4">${Number(diag.produtos_usando_fallback || diag.produtos_sem_preco || 0)}</div></div></div>
              </div>
              <div class="mb-3">
                <div class="small text-muted">Última alteração</div>
                <div><strong>${ultima}</strong>${hist.usuario ? ' · ' + hist.usuario : ''}</div>
              </div>
              <div class="mb-3">${opsHtml || '<span class="text-muted">Sem operações com preço</span>'}</div>
              <div class="row g-3">
                <div class="col-md-6">
                  <h6>Produtos vinculados</h6>
                  <ul class="mb-0" style="max-height:220px;overflow:auto">${produtos}</ul>
                </div>
                <div class="col-md-6">
                  <h6>Tabelas onde possui preços</h6>
                  <ul class="mb-0">${tabelas}</ul>
                </div>
              </div>
              <div class="mt-3">
                <button type="button" class="btn btn-sm btn-outline-primary" id="btnDashAbrirCentral">Abrir Central de Precificação</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="editarLinhaComercial(${id})">Editar Linha</button>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
            </div>
          </div>
        </div>
      </div>`;
    $('body').append(html);
    const el = document.getElementById('modalDetalheLinhaRcm87');
    bootstrap.Modal.getOrCreateInstance(el).show();
    $('#btnDashAbrirCentral').on('click', function () {
      try { sessionStorage.setItem('cds_central_filtro_linha_id', String(id)); } catch (_e) {}
      bootstrap.Modal.getInstance(el)?.hide();
      if (typeof loadPage === 'function') loadPage('tabelas-preco');
    });
    $(el).on('hidden.bs.modal', function () { $(this).remove(); });
  }).fail(function (err) {
    alert('Erro ao carregar detalhes: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function editarLinhaComercial(id) {
  abrirModalLinhaComercial({ id: id });
}

function desativarLinhaComercial(id) {
  if (!confirm('Inativar esta Linha de Precificação?')) return;
  linhasComerciaisAPI.desativar(id).done(function () {
    loadLinhasComerciais($('#filtro-linhas-comerciais').val());
  }).fail(function (err) {
    alert('Erro ao inativar: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function ativarLinhaComercial(id) {
  if (!confirm('Ativar esta Linha de Precificação?')) return;
  linhasComerciaisAPI.atualizar(id, { ativo: true }).done(function () {
    loadLinhasComerciais($('#filtro-linhas-comerciais').val());
  }).fail(function (err) {
    alert('Erro ao ativar: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function excluirLinhaComercial(id) {
  if (!confirm('Excluir esta Linha de Precificação?\n\nNão é permitido se houver produto vinculado.')) return;
  linhasComerciaisAPI.excluir(id).done(function () {
    loadLinhasComerciais($('#filtro-linhas-comerciais').val());
  }).fail(function (err) {
    const msg = err.responseJSON?.erro || err.statusText;
    if (err.responseJSON?.permite_desativar || err.responseJSON?.code === 'LINHA_EM_USO') {
      if (confirm(msg + '\n\nDeseja inativar em vez de excluir?')) {
        desativarLinhaComercial(id);
      }
      return;
    }
    alert('Erro ao excluir: ' + msg);
  });
}

function inicializarPaginaLinhasComerciais() {
  loadLinhasComerciais();
  try {
    const abrirId = sessionStorage.getItem('cds_abrir_linha_id');
    if (abrirId) {
      sessionStorage.removeItem('cds_abrir_linha_id');
      setTimeout(function () {
        if (typeof detalharLinhaComercial === 'function') detalharLinhaComercial(Number(abrirId));
      }, 400);
    }
  } catch (_e) { /* ignore */ }
  $('#btn-nova-linha-comercial').off('click').on('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    // Evita que o botão retenha o foco no Electron após abrir o modal
    if (typeof this.blur === 'function') this.blur();
    abrirModalLinhaComercial();
  });
  // Delegação: o botão Salvar só existe após abrir o modal
  $(document).off('click.ra2LinhaSalvar', '#btn-salvar-linha-comercial')
    .on('click.ra2LinhaSalvar', '#btn-salvar-linha-comercial', function (e) {
      e.preventDefault();
      salvarLinhaComercial();
    });
  let timer = null;
  $('#filtro-linhas-comerciais').off('input').on('input', function () {
    if (modalLinhaComercialAberto()) return;
    const v = $(this).val();
    clearTimeout(timer);
    timer = setTimeout(function () { loadLinhasComerciais(v); }, 250);
  });
}

window.linhasComerciaisAPI = linhasComerciaisAPI;
window.loadLinhasComerciais = loadLinhasComerciais;
window.abrirModalLinhaComercial = abrirModalLinhaComercial;
window.editarLinhaComercial = editarLinhaComercial;
window.detalharLinhaComercial = detalharLinhaComercial;
window.desativarLinhaComercial = desativarLinhaComercial;
window.ativarLinhaComercial = ativarLinhaComercial;
window.excluirLinhaComercial = excluirLinhaComercial;
window.inicializarPaginaLinhasComerciais = inicializarPaginaLinhasComerciais;

$(document).on('cds:page-loaded', function (_e, page) {
  if (page === 'linhas-comerciais') inicializarPaginaLinhasComerciais();
});
