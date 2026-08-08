/**
 * Sabores de Casquinha — ERP (RCM-05.8)
 */

const casquinhaSaboresAPI = {
  listar: function () {
    return $.ajax({
      url: API_URL + '/casquinha-sabores',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  criar: function (dados) {
    return $.ajax({
      url: API_URL + '/casquinha-sabores',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  atualizar: function (id, dados) {
    return $.ajax({
      url: API_URL + '/casquinha-sabores/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  desativar: function (id) {
    return $.ajax({
      url: API_URL + '/casquinha-sabores/' + id + '/desativar',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

function ensureModalSaborCasquinha() {
  if (document.getElementById('modal-sabor-casquinha')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal fade" id="modal-sabor-casquinha" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="modal-sabor-casquinha-titulo">Novo Sabor</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="sabor-casquinha-id">
          <div class="mb-2">
            <label class="form-label">Código</label>
            <input type="text" class="form-control" id="sabor-casquinha-codigo" maxlength="40">
          </div>
          <div class="mb-2">
            <label class="form-label">Descrição *</label>
            <input type="text" class="form-control" id="sabor-casquinha-descricao" maxlength="120">
          </div>
          <div class="mb-2">
            <label class="form-label">Cor</label>
            <input type="color" class="form-control form-control-color" id="sabor-casquinha-cor" value="#E91E63">
          </div>
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" id="sabor-casquinha-ativo" checked>
            <label class="form-check-label" for="sabor-casquinha-ativo">Ativo</label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button type="button" class="btn btn-success" id="btn-salvar-sabor-casquinha">Salvar</button>
        </div>
      </div>
    </div>
  </div>`);
}

function loadCasquinhaSabores() {
  casquinhaSaboresAPI.listar().done(function (lista) {
    let html = '';
    (lista || []).forEach(function (s) {
      html += `<tr>
        <td><code>${s.codigo || ''}</code></td>
        <td>${s.descricao || s.nome || ''}</td>
        <td>${s.cor ? `<span style="display:inline-block;width:18px;height:18px;border-radius:3px;background:${s.cor};border:1px solid #ccc;"></span> ${s.cor}` : '—'}</td>
        <td>${s.ativo ? 'Sim' : 'Não'}</td>
        <td>
          <button type="button" class="btn btn-sm btn-primary" onclick="editarSaborCasquinha(${s.id})">Editar</button>
          ${s.ativo ? `<button type="button" class="btn btn-sm btn-outline-warning" onclick="desativarSaborCasquinha(${s.id})">Desativar</button>` : ''}
        </td>
      </tr>`;
    });
    $('#sabores-casquinha-tbody').html(html || '<tr><td colspan="5" class="text-muted">Nenhum sabor.</td></tr>');
  });
}

function abrirModalSaborCasquinha(sabor) {
  ensureModalSaborCasquinha();
  $('#sabor-casquinha-id').val(sabor && sabor.id ? sabor.id : '');
  $('#sabor-casquinha-codigo').val(sabor && sabor.codigo ? sabor.codigo : '');
  $('#sabor-casquinha-descricao').val(sabor && (sabor.descricao || sabor.nome) ? (sabor.descricao || sabor.nome) : '');
  $('#sabor-casquinha-cor').val(sabor && sabor.cor ? sabor.cor : '#E91E63');
  $('#sabor-casquinha-ativo').prop('checked', !sabor || !!sabor.ativo);
  $('#modal-sabor-casquinha-titulo').text(sabor && sabor.id ? 'Editar Sabor' : 'Novo Sabor');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-sabor-casquinha')).show();
}

function editarSaborCasquinha(id) {
  casquinhaSaboresAPI.listar().done(function (lista) {
    const s = (lista || []).find((x) => Number(x.id) === Number(id));
    if (s) abrirModalSaborCasquinha(s);
  });
}

function desativarSaborCasquinha(id) {
  if (!confirm('Desativar este sabor?')) return;
  casquinhaSaboresAPI.desativar(id).done(loadCasquinhaSabores);
}

$(document).on('click', '#btn-novo-sabor-casquinha', function () {
  abrirModalSaborCasquinha(null);
});

$(document).on('click', '#btn-salvar-sabor-casquinha', function () {
  const id = $('#sabor-casquinha-id').val();
  const dados = {
    codigo: ($('#sabor-casquinha-codigo').val() || '').trim(),
    nome: ($('#sabor-casquinha-descricao').val() || '').trim(),
    descricao: ($('#sabor-casquinha-descricao').val() || '').trim(),
    cor: $('#sabor-casquinha-cor').val(),
    ativo: $('#sabor-casquinha-ativo').is(':checked')
  };
  if (!dados.descricao) {
    alert('Descrição é obrigatória');
    return;
  }
  const req = id ? casquinhaSaboresAPI.atualizar(id, dados) : casquinhaSaboresAPI.criar(dados);
  req.done(function () {
    bootstrap.Modal.getInstance(document.getElementById('modal-sabor-casquinha'))?.hide();
    loadCasquinhaSabores();
  }).fail(function (err) {
    alert((err.responseJSON && err.responseJSON.erro) || err.statusText);
  });
});

window.loadCasquinhaSabores = loadCasquinhaSabores;
window.editarSaborCasquinha = editarSaborCasquinha;
window.desativarSaborCasquinha = desativarSaborCasquinha;
