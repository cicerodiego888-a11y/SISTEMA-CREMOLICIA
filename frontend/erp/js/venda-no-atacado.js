/**
 * Configurações → Comercial → Venda no Atacado (RCM-04.5)
 */

const vendaAtacadoAPI = {
  obterConfig: function () {
    return $.ajax({
      url: API_URL + '/configuracao-comercial',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  salvarConfig: function (dados) {
    return $.ajax({
      url: API_URL + '/configuracao-comercial',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  listarCanais: function () {
    return $.ajax({
      url: API_URL + '/canais-venda',
      method: 'GET',
      data: { ativos: '1' },
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

function preencherSelectCanaisAtacado(canais, selecionadoId) {
  const $sel = $('#cfg-canal-atacado');
  let html = '';
  (canais || []).forEach(function (c) {
    const selected = Number(c.id) === Number(selecionadoId) ? ' selected' : '';
    html += `<option value="${c.id}"${selected}>${c.nome || c.codigo}</option>`;
  });
  if (!html) {
    html = '<option value="">Nenhum canal ativo</option>';
  }
  $sel.html(html);

  if (!selecionadoId) {
    const atacado = (canais || []).find(function (c) {
      return String(c.codigo || '').toUpperCase() === 'ATACADO';
    });
    if (atacado) $sel.val(String(atacado.id));
  }
}

function aplicarFormularioVendaAtacado(cfg) {
  $('#cfg-atacado-habilitado').prop('checked', !!(cfg && cfg.atacado_habilitado));
  $('#cfg-quantidade-minima').val(cfg && cfg.quantidade_minima != null ? cfg.quantidade_minima : 30);
  const tipo = String((cfg && cfg.tipo_contagem) || 'TOTAL_VENDA').toUpperCase();
  $(`input[name="cfg-tipo-contagem"][value="${tipo}"]`).prop('checked', true);
  $('#cfg-permitir-produtos').prop('checked', !cfg || cfg.permitir_produtos_diferentes !== false);
  $('#cfg-permitir-categorias').prop('checked', !cfg || cfg.permitir_categorias_diferentes !== false);
}

function coletarFormularioVendaAtacado() {
  return {
    atacado_habilitado: $('#cfg-atacado-habilitado').is(':checked'),
    canal_atacado_id: Number($('#cfg-canal-atacado').val()) || null,
    tipo_contagem: $('input[name="cfg-tipo-contagem"]:checked').val() || 'TOTAL_VENDA',
    quantidade_minima: Number($('#cfg-quantidade-minima').val()),
    permitir_produtos_diferentes: $('#cfg-permitir-produtos').is(':checked'),
    permitir_categorias_diferentes: $('#cfg-permitir-categorias').is(':checked')
  };
}

function loadVendaNoAtacado() {
  $.when(vendaAtacadoAPI.obterConfig(), vendaAtacadoAPI.listarCanais())
    .done(function (cfgRes, canaisRes) {
      const cfg = cfgRes[0];
      const canais = canaisRes[0];
      aplicarFormularioVendaAtacado(cfg);
      preencherSelectCanaisAtacado(canais, cfg && cfg.canal_atacado_id);
    })
    .fail(function (err) {
      const msg = (err && err.responseJSON && err.responseJSON.erro) || err.statusText || 'erro';
      if (typeof showNotification === 'function') {
        showNotification('Erro ao carregar configuração: ' + msg, 'danger');
      } else {
        alert('Erro ao carregar configuração: ' + msg);
      }
    });

  $('#btn-salvar-venda-atacado').off('click').on('click', salvarVendaNoAtacado);
}

function salvarVendaNoAtacado() {
  const dados = coletarFormularioVendaAtacado();
  if (!Number.isFinite(dados.quantidade_minima) || dados.quantidade_minima <= 0) {
    alert('Informe uma quantidade mínima maior que zero.');
    return;
  }

  vendaAtacadoAPI.salvarConfig(dados)
    .done(function () {
      if (typeof showNotification === 'function') {
        showNotification('Configuração de Venda no Atacado salva.', 'success');
      } else {
        alert('Configuração salva.');
      }
      loadVendaNoAtacado();
    })
    .fail(function (err) {
      alert('Erro ao salvar: ' + ((err.responseJSON && err.responseJSON.erro) || err.statusText));
    });
}
