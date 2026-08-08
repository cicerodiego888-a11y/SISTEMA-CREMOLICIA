/**
 * Kits e Combos — ERP (RCM-05.9)
 */

const kitsAPI = {
  listar: function (q) {
    const qs = q ? ('?q=' + encodeURIComponent(q)) : '';
    return $.ajax({
      url: API_URL + '/kits' + qs,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  buscar: function (id) {
    return $.ajax({
      url: API_URL + '/kits/' + id,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  criar: function (dados) {
    return $.ajax({
      url: API_URL + '/kits',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  atualizar: function (id, dados) {
    return $.ajax({
      url: API_URL + '/kits/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  desativar: function (id) {
    return $.ajax({
      url: API_URL + '/kits/' + id + '/desativar',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  produtos: function (termo) {
    return $.ajax({
      url: API_URL + '/produtos/search',
      method: 'GET',
      data: { q: termo || '', limite: 30 },
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  categorias: function () {
    return $.ajax({
      url: API_URL + '/categorias',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

let _kitItensEditor = [];

function moneyBr(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function ensureModalKit() {
  if (document.getElementById('modal-kit')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal fade" id="modal-kit" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="modal-kit-titulo">Novo Kit</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="kit-id">
          <div class="row g-2">
            <div class="col-md-3">
              <label class="form-label">Código *</label>
              <input type="text" class="form-control" id="kit-codigo" maxlength="40">
            </div>
            <div class="col-md-6">
              <label class="form-label">Descrição *</label>
              <input type="text" class="form-control" id="kit-descricao" maxlength="120">
            </div>
            <div class="col-md-3">
              <label class="form-label">Categoria</label>
              <select class="form-select" id="kit-categoria"></select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Tipo de Formação</label>
              <select class="form-select" id="kit-tipo-formacao">
                <option value="SOMA">Soma dos itens</option>
                <option value="FIXO">Preço Fixo</option>
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Preço</label>
              <input type="number" step="0.01" min="0" class="form-control" id="kit-preco" value="0">
              <small class="text-muted" id="kit-preco-hint"></small>
            </div>
            <div class="col-md-4">
              <label class="form-label">Fiscal</label>
              <select class="form-select" id="kit-modo-fiscal">
                <option value="KIT">Emitir Produto Kit</option>
                <option value="ITENS">Emitir Itens Separados</option>
              </select>
            </div>
            <div class="col-md-6">
              <div class="form-check form-switch mt-4">
                <input class="form-check-input" type="checkbox" id="kit-permite-alterar">
                <label class="form-check-label" for="kit-permite-alterar">Permite alterar itens no PDV</label>
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-check form-switch mt-4">
                <input class="form-check-input" type="checkbox" id="kit-ativo" checked>
                <label class="form-check-label" for="kit-ativo">Ativo</label>
              </div>
            </div>
          </div>
          <hr>
          <h6>Itens do Kit</h6>
          <div class="row g-2 align-items-end mb-2">
            <div class="col-md-6">
              <label class="form-label">Produto</label>
              <input type="text" class="form-control" id="kit-busca-produto" placeholder="Buscar produto...">
              <input type="hidden" id="kit-produto-selecionado-id">
              <div id="kit-busca-resultados" class="list-group position-absolute w-50" style="z-index:20;max-height:180px;overflow:auto;display:none;"></div>
            </div>
            <div class="col-md-2">
              <label class="form-label">Qtd</label>
              <input type="number" step="0.001" min="0.001" class="form-control" id="kit-item-qtd" value="1">
            </div>
            <div class="col-md-2">
              <div class="form-check mt-4">
                <input class="form-check-input" type="checkbox" id="kit-item-obrigatorio" checked>
                <label class="form-check-label" for="kit-item-obrigatorio">Obrigatório</label>
              </div>
            </div>
            <div class="col-md-2">
              <button type="button" class="btn btn-outline-primary w-100" id="btn-add-kit-item">Adicionar</button>
            </div>
          </div>
          <table class="table table-sm table-bordered">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Qtd</th>
                <th>Obrig.</th>
                <th>Preço ind.</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="kit-itens-tbody"></tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button type="button" class="btn btn-success" id="btn-salvar-kit">Salvar</button>
        </div>
      </div>
    </div>
  </div>`);
}

function atualizarHintPrecoKit() {
  const tipo = $('#kit-tipo-formacao').val();
  if (tipo === 'SOMA') {
    const soma = _kitItensEditor.reduce((s, i) => s + (Number(i.quantidade) * Number(i.preco_individual || 0)), 0);
    $('#kit-preco').val(soma.toFixed(2)).prop('readonly', true);
    $('#kit-preco-hint').text('Calculado automaticamente pela soma dos itens');
  } else {
    $('#kit-preco').prop('readonly', false);
    $('#kit-preco-hint').text('Valor informado manualmente');
  }
}

function renderItensEditor() {
  let html = '';
  _kitItensEditor.forEach(function (i, idx) {
    html += `<tr>
      <td>${i.produto_nome || ('#' + i.produto_id)}</td>
      <td>${i.quantidade}</td>
      <td>${i.obrigatorio ? 'Sim' : 'Não'}</td>
      <td>${moneyBr(i.preco_individual)}</td>
      <td><button type="button" class="btn btn-sm btn-outline-danger" data-idx="${idx}" onclick="removerItemKitEditor(${idx})">×</button></td>
    </tr>`;
  });
  $('#kit-itens-tbody').html(html || '<tr><td colspan="5" class="text-muted">Nenhum item.</td></tr>');
  atualizarHintPrecoKit();
}

function removerItemKitEditor(idx) {
  _kitItensEditor.splice(idx, 1);
  renderItensEditor();
}

function carregarCategoriasKit(selectedId) {
  kitsAPI.categorias().done(function (lista) {
    const arr = Array.isArray(lista) ? lista : (lista?.itens || lista?.data || []);
    let html = '<option value="">—</option>';
    arr.forEach(function (c) {
      html += `<option value="${c.id}" ${Number(c.id) === Number(selectedId) ? 'selected' : ''}>${c.nome || c.descricao}</option>`;
    });
    $('#kit-categoria').html(html);
  });
}

function abrirModalKit(kit) {
  ensureModalKit();
  _kitItensEditor = (kit && Array.isArray(kit.itens) ? kit.itens : []).map(function (i) {
    return {
      produto_id: i.produto_id,
      produto_nome: i.produto_nome,
      quantidade: Number(i.quantidade || 1),
      obrigatorio: i.obrigatorio !== false,
      preco_individual: Number(i.preco_individual || 0)
    };
  });
  $('#kit-id').val(kit && kit.id ? kit.id : '');
  $('#kit-codigo').val(kit && kit.codigo ? kit.codigo : '');
  $('#kit-descricao').val(kit && kit.descricao ? kit.descricao : '');
  $('#kit-tipo-formacao').val(kit && kit.tipo_formacao ? kit.tipo_formacao : 'FIXO');
  $('#kit-preco').val(kit && kit.preco != null ? kit.preco : 0);
  $('#kit-modo-fiscal').val(kit && kit.modo_fiscal ? kit.modo_fiscal : 'KIT');
  $('#kit-permite-alterar').prop('checked', !!(kit && kit.permite_alterar_itens));
  $('#kit-ativo').prop('checked', !kit || !!kit.ativo);
  $('#kit-busca-produto').val('');
  $('#kit-produto-selecionado-id').val('');
  $('#modal-kit-titulo').text(kit && kit.id ? 'Editar Kit' : 'Novo Kit');
  carregarCategoriasKit(kit && kit.categoria_id);
  renderItensEditor();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-kit')).show();
}

function loadKitsCombos(filtro) {
  kitsAPI.listar(filtro).done(function (lista) {
    let html = '';
    (lista || []).forEach(function (k) {
      html += `<tr>
        <td><code>${k.codigo || ''}</code></td>
        <td>${k.descricao || ''}</td>
        <td>${k.categoria_nome || '—'}</td>
        <td>${k.tipo_formacao === 'SOMA' ? 'Soma' : 'Fixo'}</td>
        <td>${moneyBr(k.preco)}</td>
        <td>${(k.itens || []).length}</td>
        <td>${k.ativo ? 'Sim' : 'Não'}</td>
        <td>
          <button type="button" class="btn btn-sm btn-primary" onclick="editarKit(${k.id})">Editar</button>
          ${k.ativo ? `<button type="button" class="btn btn-sm btn-outline-warning" onclick="desativarKit(${k.id})">Desativar</button>` : ''}
        </td>
      </tr>`;
    });
    $('#kits-tbody').html(html || '<tr><td colspan="8" class="text-muted">Nenhum kit cadastrado.</td></tr>');
  });
}

function editarKit(id) {
  kitsAPI.buscar(id).done(abrirModalKit);
}

function desativarKit(id) {
  if (!confirm('Desativar este kit?')) return;
  kitsAPI.desativar(id).done(function () {
    loadKitsCombos($('#filtro-kits').val());
  });
}

$(document).on('click', '#btn-novo-kit', function () {
  abrirModalKit(null);
});

$(document).on('change', '#kit-tipo-formacao', atualizarHintPrecoKit);

$(document).on('input', '#filtro-kits', function () {
  loadKitsCombos($(this).val());
});

$(document).on('input', '#kit-busca-produto', function () {
  const termo = ($(this).val() || '').trim();
  if (termo.length < 2) {
    $('#kit-busca-resultados').hide().empty();
    return;
  }
  kitsAPI.produtos(termo).done(function (resp) {
    // /produtos/search retorna { items } (LIP); aceitar aliases legados
    const arr = Array.isArray(resp)
      ? resp
      : (resp?.items || resp?.itens || resp?.produtos || []);
    let html = '';
    arr.slice(0, 15).forEach(function (p) {
      if (Number(p.eh_kit) === 1 || String(p.forma_comercializacao || '').toUpperCase() === 'KIT') return;
      html += `<button type="button" class="list-group-item list-group-item-action kit-pick-produto"
        data-id="${p.id}" data-nome="${(p.nome || '').replace(/"/g, '&quot;')}" data-preco="${p.preco_venda || 0}">
        ${p.codigo || ''} — ${p.nome || ''} (${moneyBr(p.preco_venda)})
      </button>`;
    });
    $('#kit-busca-resultados').html(html || '<div class="list-group-item text-muted">Nenhum</div>').show();
  }).fail(function () {
    $('#kit-busca-resultados').html('<div class="list-group-item text-danger">Falha na busca</div>').show();
  });
});

$(document).on('click', '.kit-pick-produto', function () {
  $('#kit-produto-selecionado-id').val($(this).data('id'));
  $('#kit-busca-produto').val($(this).data('nome'));
  $('#kit-busca-produto').data('preco', $(this).data('preco'));
  $('#kit-busca-resultados').hide().empty();
});

$(document).on('click', '#btn-add-kit-item', function () {
  const pid = Number($('#kit-produto-selecionado-id').val());
  const nome = ($('#kit-busca-produto').val() || '').trim();
  const qtd = Number($('#kit-item-qtd').val());
  if (!pid) {
    alert('Selecione um produto da busca');
    return;
  }
  if (!(qtd > 0)) {
    alert('Quantidade inválida');
    return;
  }
  if (_kitItensEditor.some((i) => Number(i.produto_id) === pid)) {
    alert('Produto já incluído');
    return;
  }
  _kitItensEditor.push({
    produto_id: pid,
    produto_nome: nome,
    quantidade: qtd,
    obrigatorio: $('#kit-item-obrigatorio').is(':checked'),
    preco_individual: Number($('#kit-busca-produto').data('preco') || 0)
  });
  $('#kit-produto-selecionado-id').val('');
  $('#kit-busca-produto').val('');
  $('#kit-item-qtd').val(1);
  renderItensEditor();
});

$(document).on('click', '#btn-salvar-kit', function () {
  const id = $('#kit-id').val();
  const dados = {
    codigo: ($('#kit-codigo').val() || '').trim(),
    descricao: ($('#kit-descricao').val() || '').trim(),
    categoria_id: $('#kit-categoria').val() || null,
    tipo_formacao: $('#kit-tipo-formacao').val(),
    preco: Number($('#kit-preco').val() || 0),
    modo_fiscal: $('#kit-modo-fiscal').val(),
    permite_alterar_itens: $('#kit-permite-alterar').is(':checked'),
    ativo: $('#kit-ativo').is(':checked'),
    itens: _kitItensEditor.map(function (i) {
      return {
        produto_id: i.produto_id,
        quantidade: i.quantidade,
        obrigatorio: i.obrigatorio
      };
    })
  };
  if (!dados.codigo || !dados.descricao) {
    alert('Código e descrição são obrigatórios');
    return;
  }
  if (!dados.itens.length) {
    alert('Inclua ao menos um item no kit');
    return;
  }
  const req = id ? kitsAPI.atualizar(id, dados) : kitsAPI.criar(dados);
  req.done(function () {
    bootstrap.Modal.getInstance(document.getElementById('modal-kit'))?.hide();
    loadKitsCombos($('#filtro-kits').val());
  }).fail(function (err) {
    alert((err.responseJSON && err.responseJSON.erro) || err.statusText);
  });
});

window.loadKitsCombos = loadKitsCombos;
window.editarKit = editarKit;
window.desativarKit = desativarKit;
window.removerItemKitEditor = removerItemKitEditor;
window.abrirModalKit = abrirModalKit;
