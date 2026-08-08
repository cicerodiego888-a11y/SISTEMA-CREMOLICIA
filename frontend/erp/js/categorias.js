const categoriasAPI = {
  listar: function(tipo = '') {
    const query = tipo ? `?tipo=${encodeURIComponent(tipo)}` : '';
    return $.ajax({
      url: API_URL + '/categorias' + query,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },

  buscar: function(id) {
    return $.ajax({
      url: API_URL + '/categorias/' + id,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },

  comercial: function(id) {
    return $.ajax({
      url: API_URL + '/categorias/' + id + '/comercial',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },

  criar: function(dados) {
    return $.ajax({
      url: API_URL + '/categorias',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },

  atualizar: function(id, dados) {
    return $.ajax({
      url: API_URL + '/categorias/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },

  excluir: function(id) {
    return $.ajax({
      url: API_URL + '/categorias/' + id,
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

function textoTipoCategoria(tipo) {
  return tipo === 'despesa' ? 'Despesa' : 'Produto';
}

function opcoesFormaCategoria(selecionada) {
  const formas = [
    { v: '', l: '(Não definida)' },
    { v: 'UNIDADE', l: 'Unidade' },
    { v: 'PESO', l: 'Peso' },
    { v: 'VOLUME', l: 'Volume' },
    { v: 'CASQUINHA', l: 'Casquinha' },
    { v: 'PERSONALIZADA', l: 'Personalizada' }
  ];
  const sel = String(selecionada || '').toUpperCase();
  return formas.map(function (f) {
    return `<option value="${f.v}" ${sel === f.v ? 'selected' : ''}>${f.l}</option>`;
  }).join('');
}

function opcoesUnidadeCategoria(selecionada) {
  const unidades = ['', 'KG', 'LITRO', 'UN', 'BOLO', 'POTE', 'COPO'];
  const sel = String(selecionada || '').toUpperCase();
  let html = unidades.map(function (u) {
    return `<option value="${u}" ${sel === u ? 'selected' : ''}>${u || '(Padrão)'}</option>`;
  }).join('');
  if (sel && unidades.indexOf(sel) < 0) {
    html += `<option value="${sel}" selected>${sel}</option>`;
  }
  return html;
}

function renderGradeComercialCategoria(valores) {
  let html = '';
  let temCasquinha = false;
  (valores || []).forEach(function (v) {
    const preco = v.preco != null && v.preco !== '' ? Number(v.preco) : '';
    const forma = String(v.forma_comercializacao || '').toUpperCase();
    if (forma === 'CASQUINHA') temCasquinha = true;
    html += `
      <tr data-canal-id="${v.canal_venda_id}">
        <td>
          <strong>${v.canal_nome || ''}</strong>
          <small class="text-muted d-block"><code>${v.canal_codigo || ''}</code></small>
        </td>
        <td>
          <select class="form-select form-select-sm cat-comercial-forma">
            ${opcoesFormaCategoria(v.forma_comercializacao || '')}
          </select>
        </td>
        <td>
          <select class="form-select form-select-sm cat-comercial-unidade">
            ${opcoesUnidadeCategoria(v.unidade_comercial || '')}
          </select>
        </td>
        <td>
          <input type="number" step="0.01" min="0"
            class="form-control form-control-sm cat-comercial-preco"
            value="${preco === '' ? '' : preco}" placeholder="0,00">
        </td>
      </tr>`;
  });
  $('#categoria-comercial-grade').html(
    html || '<tr><td colspan="4" class="text-muted">Nenhum canal ativo.</td></tr>'
  );
  atualizarPainelCasquinhaCategoria(temCasquinha);
}

function atualizarPainelCasquinhaCategoria(forcarVisivel) {
  const temCasquinha = forcarVisivel === true || $('#categoria-comercial-grade .cat-comercial-forma').toArray()
    .some((el) => String($(el).val() || '').toUpperCase() === 'CASQUINHA');
  $('#painel-casquinha-categoria').toggleClass('d-none', !temCasquinha);
}

function aplicarConfigCasquinhaCategoria(cfg) {
  const c = cfg || {};
  $('#cat-casquinha-bolas-min').val(c.bolas_min || c.casquinha_bolas_min || 1);
  $('#cat-casquinha-bolas-max').val(c.bolas_max || c.casquinha_bolas_max || 4);
  const permitir = c.permitir_repetir !== false
    && c.casquinha_permitir_repetir !== 0
    && c.casquinha_permitir_repetir !== false;
  $('#cat_casquinha_repetir_sim').prop('checked', !!permitir);
  $('#cat_casquinha_repetir_nao').prop('checked', !permitir);
}

function coletarConfigCasquinhaCategoria() {
  if ($('#painel-casquinha-categoria').hasClass('d-none')) return null;
  return {
    casquinha_bolas_min: Number($('#cat-casquinha-bolas-min').val()) || 1,
    casquinha_bolas_max: Number($('#cat-casquinha-bolas-max').val()) || 4,
    casquinha_permitir_repetir: $('input[name="cat_casquinha_repetir"]:checked').val() === '1' ? 1 : 0
  };
}

function coletarValoresComerciaisCategoria() {
  const valores = [];
  let erro = null;
  $('#categoria-comercial-grade tr[data-canal-id]').each(function () {
    const canalId = Number($(this).data('canal-id'));
    const forma = String($(this).find('.cat-comercial-forma').val() || '').trim().toUpperCase() || null;
    const unidade = String($(this).find('.cat-comercial-unidade').val() || '').trim().toUpperCase() || null;
    const raw = $(this).find('.cat-comercial-preco').val();
    if (raw === '' || raw == null) return;
    const preco = parseFloat(raw);
    if (!Number.isFinite(preco) || preco < 0) {
      erro = 'Preço inválido na aba Comercial';
      return false;
    }
    if ((forma === 'PESO' || forma === 'VOLUME') && !unidade) {
      erro = 'Informe a unidade para Peso/Volume';
      return false;
    }
    valores.push({
      canal_venda_id: canalId,
      preco: preco,
      forma_comercializacao: forma,
      unidade_comercial: unidade
    });
  });
  return { valores: valores, erro: erro };
}

function toggleAbaComercialCategoria() {
  const tipo = $('#categoria-tipo').val();
  if (tipo === 'despesa') {
    $('#tab-categoria-comercial-btn').addClass('disabled').attr('aria-disabled', 'true');
    $('#pane-categoria-dados-btn').tab('show');
  } else {
    $('#tab-categoria-comercial-btn').removeClass('disabled').attr('aria-disabled', 'false');
  }
}

function carregarGradeComercialNovaCategoria() {
  if (typeof linhasComerciaisAPI !== 'undefined' && linhasComerciaisAPI.gradeNova) {
    linhasComerciaisAPI.gradeNova().done(function (resp) {
      renderGradeComercialCategoria(resp.valores || []);
    }).fail(function () {
      renderGradeComercialCategoria([]);
    });
    return;
  }
  $.ajax({
    url: API_URL + '/linhas-comerciais/grade-nova',
    method: 'GET',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  }).done(function (resp) {
    renderGradeComercialCategoria(resp.valores || []);
  }).fail(function () {
    renderGradeComercialCategoria([]);
  });
}

function loadCategorias(termoBusca) {
  const tipoFiltro = $('#filtro-tipo-categoria').val();
  const termo = (termoBusca != null ? termoBusca : ($('#filtro-busca-categoria').val() || '')).trim().toLowerCase();

  const $filtro = $('#filtro-busca-categoria');
  const filtroEl = $filtro.length ? $filtro[0] : null;
  const manterFoco = filtroEl && document.activeElement === filtroEl;
  const selStart = manterFoco ? filtroEl.selectionStart : null;
  const selEnd = manterFoco ? filtroEl.selectionEnd : null;
  const reqId = (window._categoriasListReqId = (window._categoriasListReqId || 0) + 1);

  categoriasAPI.listar(tipoFiltro).done(function (categorias) {
    if (reqId !== window._categoriasListReqId) return;
    let html = '';
    let seq = 0;

    const lista = (categorias || [])
      .filter(function (cat) {
        if (cat.ativo === 0 || cat.ativo === false || cat.ativo === '0') return false;
        if (!termo) return true;
        const nome = String(cat.nome || '').toLowerCase();
        const desc = String(cat.descricao || '').toLowerCase();
        return nome.indexOf(termo) >= 0 || desc.indexOf(termo) >= 0;
      })
      .sort(function (a, b) {
        return Number(a.id || 0) - Number(b.id || 0);
      });

    lista.forEach(function (cat) {
      seq += 1;
      html += `
        <tr>
          <td>${seq}</td>
          <td>${cat.nome}</td>
          <td>${textoTipoCategoria(cat.tipo)}</td>
          <td>${cat.descricao || ''}</td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="editarCategoria(${cat.id})">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="excluirCategoria(${cat.id})">Desativar</button>
          </td>
        </tr>
      `;
    });

    $('#categorias-tbody').html(html || '<tr><td colspan="5" class="text-muted">Nenhuma categoria ativa.</td></tr>');

    if (manterFoco && filtroEl && document.body.contains(filtroEl)) {
      if (document.querySelector('.modal.show, .modal.showing')) return;
      filtroEl.focus({ preventScroll: true });
      if (selStart != null && selEnd != null && typeof filtroEl.setSelectionRange === 'function') {
        try { filtroEl.setSelectionRange(selStart, selEnd); } catch (_) { /* ignore */ }
      }
    }
  });
}

$(document).off('input.categoriasFiltro', '#filtro-busca-categoria');
$(document).on('input.categoriasFiltro', '#filtro-busca-categoria', function () {
  const termo = $(this).val();
  clearTimeout(window._filtroCategoriaTimer);
  window._filtroCategoriaTimer = setTimeout(function () {
    loadCategorias(termo);
  }, 300);
});

function montarPayloadCategoria() {
  const nome = $('#categoria-nome').val().trim();
  const descricao = $('#categoria-descricao').val().trim();
  const tipo = $('#categoria-tipo').val();
  const coletado = coletarValoresComerciaisCategoria();
  const casquinha = coletarConfigCasquinhaCategoria();
  return {
    nome: nome,
    descricao: descricao,
    tipo: tipo,
    valores: tipo === 'produto' ? coletado.valores : [],
    erroComercial: coletado.erro,
    casquinha: casquinha,
    casquinha_bolas_min: casquinha ? casquinha.casquinha_bolas_min : undefined,
    casquinha_bolas_max: casquinha ? casquinha.casquinha_bolas_max : undefined,
    casquinha_permitir_repetir: casquinha ? casquinha.casquinha_permitir_repetir : undefined
  };
}

function criarCategoria() {
  const payload = montarPayloadCategoria();
  if (!payload.nome) {
    alert('Nome é obrigatório!');
    return;
  }
  if (payload.erroComercial) {
    alert(payload.erroComercial);
    return;
  }

  categoriasAPI.criar({
    nome: payload.nome,
    descricao: payload.descricao,
    tipo: payload.tipo,
    valores: payload.valores,
    casquinha: payload.casquinha,
    casquinha_bolas_min: payload.casquinha_bolas_min,
    casquinha_bolas_max: payload.casquinha_bolas_max,
    casquinha_permitir_repetir: payload.casquinha_permitir_repetir
  }).done(() => {
    limparFormularioCategoria();
    loadCategorias();
    $('#modal-categoria').modal('hide');
    if (typeof atualizarSelectCategoriasSubcategoria === 'function') {
      atualizarSelectCategoriasSubcategoria();
    }
  }).fail(err => {
    alert('Erro ao criar categoria: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function editarCategoria(id) {
  categoriasAPI.buscar(id).done(cat => {
    $('#categoria-id').val(cat.id);
    $('#categoria-nome').val(cat.nome);
    $('#categoria-descricao').val(cat.descricao || '');
    $('#categoria-tipo').val(cat.tipo || 'produto');
    $('#modalCategoriaLabel').text('Editar Categoria');
    toggleAbaComercialCategoria();
    if ((cat.tipo || 'produto') === 'produto') {
      if (cat.valores && cat.valores.length) {
        renderGradeComercialCategoria(cat.valores);
      } else {
        categoriasAPI.comercial(cat.id).done(function (data) {
          renderGradeComercialCategoria((data && data.valores) || []);
          if (data && data.casquinha) aplicarConfigCasquinhaCategoria(data.casquinha);
        }).fail(function () {
          carregarGradeComercialNovaCategoria();
        });
      }
      if (cat.casquinha) aplicarConfigCasquinhaCategoria(cat.casquinha);
      else if (cat.casquinha_bolas_max != null) {
        aplicarConfigCasquinhaCategoria({
          bolas_min: cat.casquinha_bolas_min,
          bolas_max: cat.casquinha_bolas_max,
          permitir_repetir: cat.casquinha_permitir_repetir
        });
      }
    } else {
      renderGradeComercialCategoria([]);
    }
    $('#pane-categoria-dados-btn').tab('show');
    $('#modal-categoria').modal('show');
  });
}

function salvarCategoria() {
  const id = $('#categoria-id').val();
  const payload = montarPayloadCategoria();
  if (!payload.nome) {
    alert('Nome é obrigatório!');
    return;
  }
  if (payload.erroComercial) {
    alert(payload.erroComercial);
    return;
  }

  categoriasAPI.atualizar(id, {
    nome: payload.nome,
    descricao: payload.descricao,
    tipo: payload.tipo,
    valores: payload.valores,
    casquinha: payload.casquinha,
    casquinha_bolas_min: payload.casquinha_bolas_min,
    casquinha_bolas_max: payload.casquinha_bolas_max,
    casquinha_permitir_repetir: payload.casquinha_permitir_repetir
  }).done(() => {
    limparFormularioCategoria();
    $('#modal-categoria').modal('hide');
    loadCategorias();
    if (typeof atualizarSelectCategoriasSubcategoria === 'function') {
      atualizarSelectCategoriasSubcategoria();
    }
  }).fail(err => {
    alert('Erro ao atualizar categoria: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function excluirCategoria(id) {
  if (!confirm('Desativar esta categoria? Linhas de Precificação existentes não serão alteradas.')) return;

  categoriasAPI.excluir(id).done(() => {
    loadCategorias();
  }).fail(err => {
    alert('Erro ao desativar categoria: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function limparFormularioCategoria() {
  $('#categoria-id').val('');
  $('#categoria-nome').val('');
  $('#categoria-descricao').val('');
  $('#categoria-tipo').val('produto');
  $('#modalCategoriaLabel').text('Nova Categoria');
  renderGradeComercialCategoria([]);
  toggleAbaComercialCategoria();
  $('#pane-categoria-dados-btn').tab('show');
}

$(document).on('change', '#categoria-tipo', toggleAbaComercialCategoria);

$(document).on('show.bs.modal', '#modal-categoria', function () {
  if (!$('#categoria-id').val()) {
    limparFormularioCategoria();
    carregarGradeComercialNovaCategoria();
  }
});

$(document).on('change', '.cat-comercial-forma', function () {
  const forma = String($(this).val() || '').toUpperCase();
  const $unidade = $(this).closest('tr').find('.cat-comercial-unidade');
  if (forma === 'PESO' && !$unidade.val()) $unidade.val('KG');
  if (forma === 'VOLUME' && !$unidade.val()) $unidade.val('LITRO');
  if (forma === 'UNIDADE' && !$unidade.val()) $unidade.val('UN');
  if (forma === 'CASQUINHA' && !$unidade.val()) $unidade.val('UN');
  atualizarPainelCasquinhaCategoria();
});

window.loadCategorias = loadCategorias;
window.criarCategoria = criarCategoria;
window.editarCategoria = editarCategoria;
window.salvarCategoria = salvarCategoria;
window.excluirCategoria = excluirCategoria;
window.categoriasAPI = categoriasAPI;
