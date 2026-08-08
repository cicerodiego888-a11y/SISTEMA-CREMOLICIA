/**
 * Tipos Comerciais — ERP (RCM-7.1 / RCM-7.2 / RCM-7.3)
 *
 * RCM-7.3: abas enterprise (Geral · Canais · Crédito · Condições · Descontos · Regras).
 * Persistência permanece apenas: código, descrição, ativo, observações, canal padrão, canais permitidos.
 */

let _canaisVendaCacheTipos = [];

const tiposComerciaisAPI = {
  listar: function (ativos) {
    const q = ativos ? '?ativos=1' : '';
    return $.ajax({
      url: API_URL + '/tipos-comerciais' + q,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  buscar: function (id) {
    return $.ajax({
      url: API_URL + '/tipos-comerciais/' + id,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  criar: function (dados) {
    return $.ajax({
      url: API_URL + '/tipos-comerciais',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  atualizar: function (id, dados) {
    return $.ajax({
      url: API_URL + '/tipos-comerciais/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  excluir: function (id) {
    return $.ajax({
      url: API_URL + '/tipos-comerciais/' + id,
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

function carregarOpcoesCanalTipoComercial() {
  return $.ajax({
    url: API_URL + '/canais-venda?ativos=1',
    method: 'GET',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  }).then(function (canais) {
    _canaisVendaCacheTipos = canais || [];
    const $sel = $('#tipo-comercial-canal');
    $sel.empty();
    _canaisVendaCacheTipos.forEach(function (c) {
      $sel.append(
        $('<option>').val(c.codigo).text((c.nome || c.codigo) + ' (' + c.codigo + ')')
      );
    });
    renderGridCanaisPermitidos();
  });
}

function renderGridCanaisPermitidos(selecionados) {
  const marcados = new Set(
    (selecionados || []).map((c) => String(c.codigo || c).toUpperCase())
  );
  const padrao = String($('#tipo-comercial-canal').val() || '').toUpperCase();
  if (padrao) marcados.add(padrao);

  const $grid = $('#tipo-comercial-canais-grid');
  if (!_canaisVendaCacheTipos.length) {
    $grid.html('<div class="text-muted">Nenhum canal ativo.</div>');
    return;
  }

  let html = '';
  _canaisVendaCacheTipos.forEach(function (c) {
    const codigo = String(c.codigo || '').toUpperCase();
    const checked = marcados.has(codigo) ? 'checked' : '';
    const disabled = codigo === padrao ? 'disabled' : '';
    html += `
      <div class="form-check mb-2">
        <input class="form-check-input tipo-canal-permitido" type="checkbox"
               id="tipo-canal-${codigo}" value="${codigo}" ${checked} ${disabled}
               data-canal-codigo="${codigo}">
        <label class="form-check-label" for="tipo-canal-${codigo}">
          <strong>${c.nome || codigo}</strong>
          <code class="ms-1">${codigo}</code>
          ${codigo === padrao ? '<span class="badge bg-secondary ms-1">Padrão</span>' : ''}
        </label>
      </div>
    `;
  });
  $grid.html(html);
}

function obterCanaisPermitidosMarcados() {
  const padrao = String($('#tipo-comercial-canal').val() || '').toUpperCase();
  const set = new Set();
  if (padrao) set.add(padrao);
  $('.tipo-canal-permitido:checked').each(function () {
    set.add(String($(this).val() || '').toUpperCase());
  });
  return [...set];
}

function resetCamposPreparadosTipoComercial() {
  // RCM-7.3 — layout only; nunca enviados no payload
  $('#tipo-prep-limite-credito').val('');
  $('#tipo-prep-usar-limite').prop('checked', false);
  $('#tipo-prep-ultrapassar-limite').prop('checked', false);
  $('#tipo-prep-condicao-pagamento').val('');
  $('#tipo-prep-tabela-financeira').val('');
  $('#tipo-prep-dias').val('');
  $('#tipo-prep-desconto-maximo').val('');
  $('#tipo-prep-necessita-aprovacao').prop('checked', false);
  $('#tipo-prep-tipo-aprovacao').val('');
  $('#tipo-prep-permitir-consignacao').prop('checked', false);
  $('#tipo-prep-permitir-bonificacao').prop('checked', false);
  $('#tipo-prep-permitir-venda-negativa').prop('checked', false);
  $('#tipo-prep-permitir-pedido-especial').prop('checked', false);
}

function limparFormularioTipoComercial() {
  $('#tipo-comercial-id').val('');
  $('#tipo-comercial-codigo').val('').prop('readonly', false);
  $('#tipo-comercial-descricao').val('');
  $('#tipo-comercial-observacoes').val('');
  $('#tipo-comercial-ativo').prop('checked', true);
  $('#modal-tipo-comercial-titulo').text('Novo Tipo Comercial');
  resetCamposPreparadosTipoComercial();
  const tab = document.getElementById('tab-tipo-geral');
  if (tab && window.bootstrap) {
    bootstrap.Tab.getOrCreateInstance(tab).show();
  }
  carregarOpcoesCanalTipoComercial().then(function () {
    const padrao = String($('#tipo-comercial-canal').val() || 'VAREJO').toUpperCase();
    renderGridCanaisPermitidos([padrao]);
  });
}

function loadTiposComerciais() {
  tiposComerciaisAPI.listar().done(function (tipos) {
    let html = '';
    (tipos || []).forEach(function (t) {
      const ativo = t.ativo ? 'Sim' : 'Não';
      const permitidos = (t.canais_permitidos_codigos || []).join(', ')
        || t.canal_padrao
        || '—';
      html += `
        <tr>
          <td>${t.id}</td>
          <td><code>${t.codigo || ''}</code></td>
          <td>${t.descricao || ''}</td>
          <td><code>${t.canal_padrao || ''}</code></td>
          <td><small>${permitidos}</small></td>
          <td>${ativo}</td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="editarTipoComercial(${t.id})">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="excluirTipoComercial(${t.id})">Excluir</button>
          </td>
        </tr>
      `;
    });
    $('#tipos-comerciais-tbody').html(
      html || '<tr><td colspan="7" class="text-muted">Nenhum tipo comercial cadastrado.</td></tr>'
    );
  }).fail(function (err) {
    $('#tipos-comerciais-tbody').html(
      '<tr><td colspan="7" class="text-danger">Erro ao carregar: ' +
      (err.responseJSON?.erro || err.statusText) +
      '</td></tr>'
    );
  });
}

function editarTipoComercial(id) {
  $.when(carregarOpcoesCanalTipoComercial(), tiposComerciaisAPI.buscar(id)).done(function (_canais, resp) {
    const t = Array.isArray(resp) ? resp[0] : resp;
    $('#tipo-comercial-id').val(t.id);
    $('#tipo-comercial-codigo').val(t.codigo || '');
    $('#tipo-comercial-descricao').val(t.descricao || '');
    $('#tipo-comercial-canal').val(t.canal_padrao || 'VAREJO');
    $('#tipo-comercial-observacoes').val(t.observacoes || '');
    $('#tipo-comercial-ativo').prop('checked', !!t.ativo);
    $('#modal-tipo-comercial-titulo').text('Editar Tipo Comercial');
    const sistema = String(t.codigo || '').toUpperCase() === 'CONSUMIDOR_FINAL';
    $('#tipo-comercial-codigo').prop('readonly', sistema);
    resetCamposPreparadosTipoComercial();
    renderGridCanaisPermitidos(t.canais_permitidos_codigos || [t.canal_padrao]);
    const tab = document.getElementById('tab-tipo-geral');
    if (tab && window.bootstrap) {
      bootstrap.Tab.getOrCreateInstance(tab).show();
    }
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-tipo-comercial'));
    modal.show();
  });
}

/**
 * Monta payload oficial (RCM-7.2). Campos preparados (RCM-7.3) NÃO entram.
 */
function montarPayloadTipoComercial() {
  return {
    codigo: ($('#tipo-comercial-codigo').val() || '').trim(),
    descricao: ($('#tipo-comercial-descricao').val() || '').trim(),
    canal_padrao: ($('#tipo-comercial-canal').val() || '').trim(),
    observacoes: ($('#tipo-comercial-observacoes').val() || '').trim() || null,
    ativo: $('#tipo-comercial-ativo').is(':checked'),
    canais_permitidos: obterCanaisPermitidosMarcados()
  };
}

function salvarTipoComercial() {
  const id = $('#tipo-comercial-id').val();
  const dados = montarPayloadTipoComercial();
  const canaisPermitidos = dados.canais_permitidos || [];

  if (!dados.codigo || !dados.descricao || !dados.canal_padrao) {
    alert('Código, Descrição e Canal Padrão são obrigatórios.');
    return;
  }
  if (!canaisPermitidos.includes(String(dados.canal_padrao).toUpperCase())) {
    alert('O Canal Padrão deve estar entre os Canais Permitidos.');
    return;
  }

  const req = id ? tiposComerciaisAPI.atualizar(id, dados) : tiposComerciaisAPI.criar(dados);
  req.done(function () {
    const modal = bootstrap.Modal.getInstance(document.getElementById('modal-tipo-comercial'));
    if (modal) modal.hide();
    limparFormularioTipoComercial();
    loadTiposComerciais();
  }).fail(function (err) {
    alert('Erro ao salvar: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function excluirTipoComercial(id) {
  if (!confirm('Deseja realmente excluir este tipo comercial?')) return;
  tiposComerciaisAPI.excluir(id).done(function () {
    loadTiposComerciais();
  }).fail(function (err) {
    alert('Erro ao excluir: ' + (err.responseJSON?.erro || err.statusText));
  });
}

$(document).on('click', '#btn-salvar-tipo-comercial', function () {
  salvarTipoComercial();
});

$(document).on('change', '#tipo-comercial-canal', function () {
  renderGridCanaisPermitidos(obterCanaisPermitidosMarcados());
});

window.loadTiposComerciais = loadTiposComerciais;
window.editarTipoComercial = editarTipoComercial;
window.excluirTipoComercial = excluirTipoComercial;
window.limparFormularioTipoComercial = limparFormularioTipoComercial;
window.montarPayloadTipoComercial = montarPayloadTipoComercial;
window.tiposComerciaisAPI = tiposComerciaisAPI;
