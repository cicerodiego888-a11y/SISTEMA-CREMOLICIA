/**
 * Canais de Venda — ERP (RCM-04.1)
 */

const canaisVendaAPI = {
  listar: function () {
    return $.ajax({
      url: API_URL + '/canais-venda',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  buscar: function (id) {
    return $.ajax({
      url: API_URL + '/canais-venda/' + id,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  criar: function (dados) {
    return $.ajax({
      url: API_URL + '/canais-venda',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  atualizar: function (id, dados) {
    return $.ajax({
      url: API_URL + '/canais-venda/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  excluir: function (id) {
    return $.ajax({
      url: API_URL + '/canais-venda/' + id,
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

function limparFormularioCanalVenda() {
  $('#canal-venda-id').val('');
  $('#canal-venda-codigo').val('').prop('readonly', false);
  $('#canal-venda-nome').val('');
  $('#canal-venda-ativo').prop('checked', true);
  $('#modal-canal-venda-titulo').text('Novo Canal de Venda');
}

function loadCanaisVenda() {
  canaisVendaAPI.listar().done(function (canais) {
    let html = '';
    (canais || []).forEach(function (c) {
      const ativo = c.ativo ? 'Sim' : 'Não';
      html += `
        <tr>
          <td>${c.id}</td>
          <td><code>${c.codigo || ''}</code></td>
          <td>${c.nome || ''}</td>
          <td>${ativo}</td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="editarCanalVenda(${c.id})">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="excluirCanalVenda(${c.id})">Excluir</button>
          </td>
        </tr>
      `;
    });
    $('#canais-venda-tbody').html(html || '<tr><td colspan="5" class="text-muted">Nenhum canal cadastrado.</td></tr>');
  }).fail(function (err) {
    $('#canais-venda-tbody').html(
      '<tr><td colspan="5" class="text-danger">Erro ao carregar: ' +
      (err.responseJSON?.erro || err.statusText) +
      '</td></tr>'
    );
  });
}

function editarCanalVenda(id) {
  canaisVendaAPI.buscar(id).done(function (c) {
    $('#canal-venda-id').val(c.id);
    $('#canal-venda-codigo').val(c.codigo || '');
    $('#canal-venda-nome').val(c.nome || '');
    $('#canal-venda-ativo').prop('checked', !!c.ativo);
    $('#modal-canal-venda-titulo').text('Editar Canal de Venda');
    const sistema = ['VAREJO', 'ATACADO', 'EVENTO'].includes(String(c.codigo || '').toUpperCase());
    $('#canal-venda-codigo').prop('readonly', sistema);
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-canal-venda'));
    modal.show();
  });
}

function salvarCanalVenda() {
  const id = $('#canal-venda-id').val();
  const dados = {
    codigo: ($('#canal-venda-codigo').val() || '').trim(),
    nome: ($('#canal-venda-nome').val() || '').trim(),
    ativo: $('#canal-venda-ativo').is(':checked')
  };

  if (!dados.codigo || !dados.nome) {
    alert('Código e nome são obrigatórios.');
    return;
  }

  const req = id ? canaisVendaAPI.atualizar(id, dados) : canaisVendaAPI.criar(dados);
  req.done(function () {
    const modal = bootstrap.Modal.getInstance(document.getElementById('modal-canal-venda'));
    if (modal) modal.hide();
    limparFormularioCanalVenda();
    loadCanaisVenda();
  }).fail(function (err) {
    alert('Erro ao salvar: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function excluirCanalVenda(id) {
  if (!confirm('Deseja realmente excluir este canal de venda?')) return;
  canaisVendaAPI.excluir(id).done(function () {
    loadCanaisVenda();
  }).fail(function (err) {
    alert('Erro ao excluir: ' + (err.responseJSON?.erro || err.statusText));
  });
}

$(document).on('click', '#btn-salvar-canal-venda', function () {
  salvarCanalVenda();
});

window.loadCanaisVenda = loadCanaisVenda;
window.editarCanalVenda = editarCanalVenda;
window.excluirCanalVenda = excluirCanalVenda;
window.limparFormularioCanalVenda = limparFormularioCanalVenda;
window.canaisVendaAPI = canaisVendaAPI;
