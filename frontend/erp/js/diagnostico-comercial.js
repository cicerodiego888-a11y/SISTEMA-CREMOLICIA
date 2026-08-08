/**
 * Diagnóstico Comercial — ERP (RCM-8.7)
 */

function formatarPrecoDiag(valor) {
  const n = Number(valor || 0);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function loadConsistenciaCategoriaLinha() {
  const $box = $('#diag-consistencia-box');
  $.ajax({
    url: API_URL + '/diagnostico-comercial/consistencia',
    method: 'GET',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  }).done(function (res) {
    if (!res) {
      $box.removeClass('alert-success alert-warning').addClass('alert-secondary')
        .text('Sem dados de consistência.');
      return;
    }
    if (res.ok) {
      $box.removeClass('alert-secondary alert-warning').addClass('alert-success')
        .html(
          '<strong>Consistência OK.</strong> Grupo Comercial e Linha de Precificação são independentes' +
          (res.a1_nota ? ' — ' + res.a1_nota : '.')
        );
      return;
    }
    const parts = [
      'Relacionamentos quebrados: ' + (res.relacionamentos_quebrados || []).length,
      'Duplicidades: ' + (res.duplicidades || []).length,
      'Produtos sem Grupo Comercial: ' + (res.produtos_sem_categoria || []).length,
      'Produtos sem política explícita: ' + (res.produtos_sem_politica_explicita || []).length
    ];
    $box.removeClass('alert-secondary alert-success').addClass('alert-warning')
      .html(
        '<strong>Inconsistências:</strong> ' + (res.total_inconsistencias || 0) +
        '<br><small>' + parts.join(' · ') + '</small>'
      );
  }).fail(function (err) {
    $box.removeClass('alert-success').addClass('alert-warning')
      .text('Falha ao validar: ' + ((err.responseJSON && err.responseJSON.erro) || err.statusText));
  });
}

function loadCoberturaGeralDominio() {
  const $card = $('#diag-cobertura-geral-box');
  const $body = $('#diag-cobertura-geral-body');
  $card.removeClass('d-none');
  $body.html('<div class="text-muted">Analisando domínio comercial...</div>');
  $.ajax({
    url: API_URL + '/tabelas-preco/cobertura',
    method: 'GET',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  }).done(function (res) {
    const linhasSemProd = (res.linhas_sem_produtos || []).length;
    const linhasSemPreco = (res.linhas_sem_preco || []).length;
    const produtosSemPreco = (res.produtos_sem_preco || []).length;
    const opsSemTabela = (res.operacoes_sem_tabela || []).length;
    $body.html(`
      <div class="row g-3">
        <div class="col-md-4"><div class="border rounded p-2"><div class="text-muted small">Produtos sem Linha</div><div class="fs-4">${Number(res.produtos_sem_linha || 0)}</div></div></div>
        <div class="col-md-4"><div class="border rounded p-2"><div class="text-muted small">Produtos sem Preço (próprios)</div><div class="fs-4">${produtosSemPreco}</div></div></div>
        <div class="col-md-4"><div class="border rounded p-2"><div class="text-muted small">Usando Preço de Segurança</div><div class="fs-4">${Number(res.produtos_usando_preco_seguranca || 0)}</div></div></div>
        <div class="col-md-4"><div class="border rounded p-2"><div class="text-muted small">Linhas sem Produtos</div><div class="fs-4">${linhasSemProd}</div></div></div>
        <div class="col-md-4"><div class="border rounded p-2"><div class="text-muted small">Linhas sem Preço</div><div class="fs-4">${linhasSemPreco}</div></div></div>
        <div class="col-md-4"><div class="border rounded p-2"><div class="text-muted small">Operações sem Tabela</div><div class="fs-4">${opsSemTabela}</div></div></div>
      </div>
      <div class="small text-muted mt-2">Alertas totais: <strong>${Number(res.resumo?.alertas || 0)}</strong></div>
    `);
  }).fail(function (err) {
    $body.html('<div class="text-danger">' + ((err.responseJSON && err.responseJSON.erro) || err.statusText) + '</div>');
  });
}

function loadDiagnosticoComercial() {
  const busca = ($('#diag-comercial-busca').val() || '').trim();
  const canal = $('#diag-comercial-canal').val() || 'VAREJO';

  $('#diag-comercial-tbody').html('<tr><td colspan="6" class="text-muted text-center">Carregando...</td></tr>');
  loadConsistenciaCategoriaLinha();

  $.ajax({
    url: API_URL + '/diagnostico-comercial',
    method: 'GET',
    data: { busca: busca, canal: canal, limit: 100 },
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  }).done(function (res) {
    const itens = (res && res.itens) || [];
    if (!itens.length) {
      $('#diag-comercial-tbody').html('<tr><td colspan="6" class="text-muted text-center">Nenhum produto encontrado.</td></tr>');
      return;
    }

    let html = '';
    itens.forEach(function (row) {
      const origemLabel = row.origem_label || row.origem || '—';
      const origemBadge = row.fallback
        ? '<span class="badge bg-warning text-dark">' + origemLabel + '</span>'
        : '<span class="badge bg-success">' + origemLabel + '</span>';
      const pid = row.produto_id || row.id || '';
      html += `
        <tr>
          <td>
            <strong>${row.produto || '—'}</strong>
            ${row.codigo ? `<br><small class="text-muted">${row.codigo}</small>` : ''}
          </td>
          <td>${row.linha || '<em class="text-muted">Precificação Própria</em>'}</td>
          <td><code>${row.canal || '—'}</code></td>
          <td class="text-end"><strong>${formatarPrecoDiag(row.preco)}</strong></td>
          <td>${origemBadge}</td>
          <td>
            ${pid ? `<button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirAnaliseProdutoRcm87(${Number(pid)}, '${(row.canal || canal)}')">Analisar</button>` : '—'}
          </td>
        </tr>
      `;
    });
    $('#diag-comercial-tbody').html(html);
  }).fail(function (err) {
    $('#diag-comercial-tbody').html(
      '<tr><td colspan="6" class="text-danger text-center">Erro: ' +
      ((err.responseJSON && err.responseJSON.erro) || err.statusText) +
      '</td></tr>'
    );
  });
}

function corrigirConsistenciaCategoriaLinha() {
  if (!confirm('Executar verificação de consistência? (não recria Linhas de Precificação a partir do Grupo Comercial.)')) return;
  $.ajax({
    url: API_URL + '/diagnostico-comercial/corrigir',
    method: 'POST',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  }).done(function (res) {
    const msg = (res && res.a1_nota)
      ? res.a1_nota
      : (res && res.corrigido
        ? 'Verificação concluída sem inconsistências restantes.'
        : 'Verificação executada. Ainda há itens para revisão manual.');
    if (typeof showNotification === 'function') showNotification(msg, res && res.corrigido ? 'success' : 'warning');
    else alert(msg);
    loadDiagnosticoComercial();
  }).fail(function (err) {
    alert('Erro: ' + ((err.responseJSON && err.responseJSON.erro) || err.statusText));
  });
}

$(document).off('click.diagComercial').on('click.diagComercial', '#btn-diag-comercial-buscar, #btn-diag-comercial-atualizar', function () {
  loadDiagnosticoComercial();
});

$(document).off('click.diagCorrigir').on('click.diagCorrigir', '#btn-diag-comercial-corrigir', function () {
  corrigirConsistenciaCategoriaLinha();
});

$(document).off('click.diagCobertura').on('click.diagCobertura', '#btn-diag-cobertura-geral', function () {
  loadCoberturaGeralDominio();
});

$(document).off('keydown.diagComercial').on('keydown.diagComercial', '#diag-comercial-busca', function (e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadDiagnosticoComercial();
  }
});
