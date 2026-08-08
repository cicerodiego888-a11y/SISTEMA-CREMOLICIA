/**
 * Tabelas de Preços — ERP (RA-6 / RA-6.6 / RA-6.7)
 * Shell de listagem + API. Modal oficial: tabelas-preco-ra6.js
 * Grade: Linha de Precificação × Unidade de Comercialização × Preço
 */

const tabelasPrecoAPI = {
  listar: function (opts) {
    const params = [];
    if (opts === true) params.push('ativos=1');
    else if (opts && typeof opts === 'object') {
      if (opts.ativos) params.push('ativos=1');
      if (opts.q) params.push('q=' + encodeURIComponent(opts.q));
    }
    const q = params.length ? '?' + params.join('&') : '';
    return $.ajax({
      url: API_URL + '/tabelas-preco' + q,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  buscar: function (id) {
    return $.ajax({
      url: API_URL + '/tabelas-preco/' + id,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  gradePorLinhas: function (linhaIds, tabelaId) {
    return $.ajax({
      url: API_URL + '/tabelas-preco/grade-por-linhas',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        linha_ids: linhaIds || [],
        tabela_preco_id: tabelaId || null
      }),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  criar: function (dados) {
    return $.ajax({
      url: API_URL + '/tabelas-preco',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  atualizar: function (id, dados) {
    return $.ajax({
      url: API_URL + '/tabelas-preco/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  excluir: function (id) {
    return $.ajax({
      url: API_URL + '/tabelas-preco/' + id,
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  desativar: function (id) {
    return $.ajax({
      url: API_URL + '/tabelas-preco/' + id + '/desativar',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  duplicar: function (id, dados) {
    return $.ajax({
      url: API_URL + '/tabelas-preco/' + id + '/duplicar',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados || {}),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  cobertura: function (id) {
    const url = id
      ? (API_URL + '/tabelas-preco/' + id + '/cobertura')
      : (API_URL + '/tabelas-preco/cobertura');
    return $.ajax({
      url: url,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  simular: function (dados) {
    return $.ajax({
      url: API_URL + '/tabelas-preco/simular',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados || {}),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

let _callbackTabelaPrecoSalva = null;
/** Cache local de linhas ativas (pesquisa). */
let _linhasComerciaisCache = [];
/** Linhas selecionadas na tabela atual: [{ id, codigo, descricao }] */
let _linhasSelecionadasTabela = [];
let _linhaSugestaoIdx = -1;

function ensureModalTabelaPreco() {
  const existing = document.getElementById('modal-tabela-preco');
  if (existing) {
    // RCM-05.16: seletor por pesquisa + chips (sem checkboxes)
    if (existing.querySelector('#tabela-preco-linha-busca')) return;
    try {
      bootstrap.Modal.getInstance(existing)?.dispose();
    } catch (_) { /* ignore */ }
    existing.remove();
  }

  if (!document.getElementById('tabela-preco-linha-selector-css')) {
    const style = document.createElement('style');
    style.id = 'tabela-preco-linha-selector-css';
    style.textContent = `
      .tp-linha-selector { position: relative; }
      .tp-linha-chips { display: flex; flex-wrap: wrap; gap: 8px; min-height: 8px; margin-bottom: 8px; }
      .tp-linha-chip {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 10px; border-radius: 999px;
        background: #e8f1ff; border: 1px solid #bfd3f5; color: #1e3a5f;
        font-size: 0.875rem; font-weight: 600; max-width: 100%;
      }
      .tp-linha-chip code { font-size: 0.75rem; opacity: .85; }
      .tp-linha-chip__x {
        border: 0; background: transparent; color: #64748b;
        width: 28px; height: 28px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer; font-size: 1.1rem; line-height: 1; padding: 0;
      }
      .tp-linha-chip__x:hover { background: rgba(15,23,42,.08); color: #b91c1c; }
      .tp-linha-sugestoes {
        position: absolute; left: 0; right: 0; top: 100%; z-index: 1080;
        max-height: 240px; overflow: auto; display: none;
        box-shadow: 0 8px 24px rgba(15,23,42,.15);
      }
      .tp-linha-sugestoes.is-open { display: block; }
      .tp-linha-sugestoes .list-group-item.active,
      .tp-linha-sugestoes .list-group-item:hover { background: #eff6ff; }
    `;
    document.head.appendChild(style);
  }

  const html = `
  <div class="modal fade" id="modal-tabela-preco" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-xl modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="modal-tabela-preco-titulo">Nova Tabela de Preços</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="tabela-preco-id">

          <h6 class="text-muted text-uppercase small mb-2">Dados Gerais</h6>
          <div class="row g-2 mb-3">
            <div class="col-md-4">
              <label for="tabela-preco-codigo" class="form-label">Código *</label>
              <input type="text" id="tabela-preco-codigo" class="form-control" maxlength="40" placeholder="Ex.: PADRAO">
            </div>
            <div class="col-md-8">
              <label for="tabela-preco-nome" class="form-label">Nome *</label>
              <input type="text" id="tabela-preco-nome" class="form-control" maxlength="120">
            </div>
            <div class="col-12">
              <label for="tabela-preco-descricao" class="form-label">Descrição</label>
              <textarea id="tabela-preco-descricao" class="form-control" rows="2"></textarea>
            </div>
            <div class="col-12">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="tabela-preco-ativo" checked>
                <label class="form-check-label" for="tabela-preco-ativo">Ativo</label>
              </div>
            </div>
          </div>

          <hr>
          <h6 class="text-muted text-uppercase small mb-2">Adicionar Pol tica Comercial *</h6>
          <p class="text-muted small mb-2">
            Pesquise e adicione somente as linhas necessárias. Forma e Unidade são herdadas; informe o Preço.
          </p>
          <div id="tabela-preco-linhas-box" class="tp-linha-selector mb-3">
            <div id="tabela-preco-linha-chips" class="tp-linha-chips" aria-live="polite"></div>
            <label for="tabela-preco-linha-busca" class="form-label visually-hidden">Pesquisar Pol tica Comercial</label>
            <input type="text" id="tabela-preco-linha-busca" class="form-control"
              placeholder="Pesquisar por código, nome ou descrição..."
              autocomplete="off" role="combobox" aria-autocomplete="list"
              aria-controls="tabela-preco-linha-sugestoes" aria-expanded="false">
            <div id="tabela-preco-linha-sugestoes" class="list-group tp-linha-sugestoes" role="listbox"></div>
          </div>

          <h6 class="text-muted text-uppercase small mb-2">Preços por Linha   Canal</h6>
          <div class="table-responsive">
            <table class="table table-sm table-bordered align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Pol tica Comercial</th>
                  <th>Canal</th>
                  <th style="width: 140px;">Forma</th>
                  <th style="width: 110px;">Unidade</th>
                  <th style="width: 130px;">Preço</th>
                </tr>
              </thead>
              <tbody id="tabela-preco-grade-tbody"></tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button type="button" class="btn btn-success" id="btn-salvar-tabela-preco">Salvar</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function limparFormularioTabelaPreco() {
  ensureModalTabelaPreco();
  $('#tabela-preco-id').val('');
  $('#tabela-preco-codigo').val('');
  $('#tabela-preco-nome').val('');
  $('#tabela-preco-descricao').val('');
  $('#tabela-preco-ativo').prop('checked', true);
  $('#modal-tabela-preco-titulo').text('Nova Tabela de Preços');
  _linhasSelecionadasTabela = [];
  $('#tabela-preco-linha-busca').val('');
  fecharSugestoesLinhaTabelaPreco();
  renderChipsLinhasTabelaPreco();
  $('#tabela-preco-grade-tbody').html(
    '<tr><td colspan="5" class="text-muted">Adicione ao menos uma Pol tica Comercial.</td></tr>'
  );
}

function opcoesFormaComercialGrade(selecionada) {
  const formas = [
    { v: '', l: '(Herdar)' },
    { v: 'UNIDADE', l: 'Unidade' },
    { v: 'PESO', l: 'Peso' },
    { v: 'VOLUME', l: 'Volume' },
    { v: 'CASQUINHA', l: 'Casquinha' },
    { v: 'KIT', l: 'Kit/Combo' },
    { v: 'PERSONALIZADA', l: 'Personalizada' }
  ];
  const sel = String(selecionada || '').toUpperCase();
  return formas.map(function (f) {
    return `<option value="${f.v}" ${sel === f.v ? 'selected' : ''}>${f.l}</option>`;
  }).join('');
}

function opcoesUnidadeComercialGrade(selecionada) {
  const unidades = ['', 'KG', 'LITRO', 'UN', 'BOLO', 'POTE', 'COPO'];
  const sel = String(selecionada || '').toUpperCase();
  let html = unidades.map(function (u) {
    const label = u === '' ? '(Herdar)' : u;
    return `<option value="${u}" ${sel === u ? 'selected' : ''}>${label}</option>`;
  }).join('');
  if (sel && unidades.indexOf(sel) < 0) {
    html += `<option value="${sel}" selected>${sel}</option>`;
  }
  return html;
}

function escapeHtmlLinhaTp(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function carregarCacheLinhasComerciais() {
  return $.ajax({
    url: API_URL + '/linhas-comerciais?ativos=1',
    method: 'GET',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
  }).done(function (linhas) {
    _linhasComerciaisCache = Array.isArray(linhas) ? linhas : [];
  }).fail(function () {
    _linhasComerciaisCache = [];
  });
}

/** @deprecated alias   RCM-05.16 */
function carregarOpcoesLinhasComerciais(selecionadas) {
  return carregarCacheLinhasComerciais().done(function () {
    definirLinhasSelecionadasTabela(selecionadas || []);
  });
}

function definirLinhasSelecionadasTabela(selecionadas) {
  const lista = selecionadas || [];
  _linhasSelecionadasTabela = lista.map(function (item) {
    if (item && typeof item === 'object') {
      const id = Number(item.id);
      return {
        id: id,
        codigo: item.codigo || '',
        descricao: item.descricao || item.nome || ''
      };
    }
    const id = Number(item);
    const hit = _linhasComerciaisCache.find(function (l) { return Number(l.id) === id; });
    if (hit) {
      return {
        id: Number(hit.id),
        codigo: hit.codigo || '',
        descricao: hit.descricao || hit.nome || ''
      };
    }
    return { id: id, codigo: '', descricao: '#' + id };
  }).filter(function (l) { return l.id > 0; });
  renderChipsLinhasTabelaPreco();
}

function obterLinhasSelecionadasTabelaPreco() {
  return _linhasSelecionadasTabela.map(function (l) { return Number(l.id); }).filter(function (n) { return n > 0; });
}

function renderChipsLinhasTabelaPreco() {
  const $chips = $('#tabela-preco-linha-chips');
  if (!$chips.length) return;
  if (!_linhasSelecionadasTabela.length) {
    $chips.html('');
    return;
  }
  let html = '';
  _linhasSelecionadasTabela.forEach(function (l) {
    html += `
      <span class="tp-linha-chip" data-linha-id="${l.id}">
        <span>${escapeHtmlLinhaTp(l.descricao || l.codigo || ('#' + l.id))}</span>
        ${l.codigo ? `<code>${escapeHtmlLinhaTp(l.codigo)}</code>` : ''}
        <button type="button" class="tp-linha-chip__x" data-remover-linha="${l.id}"
          aria-label="Remover ${escapeHtmlLinhaTp(l.descricao || l.codigo || '')}"> </button>
      </span>
    `;
  });
  $chips.html(html);
}

function scoreBuscaLinhaComercial(linha, termo) {
  const q = String(termo || '').trim().toLowerCase();
  if (!q) return 0;
  const codigo = String(linha.codigo || '').toLowerCase();
  const desc = String(linha.descricao || linha.nome || '').toLowerCase();
  if (codigo === q || desc === q) return 300;
  if (codigo.startsWith(q) || desc.startsWith(q)) return 200;
  if (codigo.includes(q) || desc.includes(q)) return 100;
  return 0;
}

function filtrarSugestoesLinhasTabelaPreco(termo) {
  const q = String(termo || '').trim();
  const selecionadas = new Set(obterLinhasSelecionadasTabelaPreco());
  const ranked = (_linhasComerciaisCache || [])
    .filter(function (l) { return !selecionadas.has(Number(l.id)); })
    .map(function (l) {
      return { linha: l, score: q ? scoreBuscaLinhaComercial(l, q) : 1 };
    })
    .filter(function (x) { return x.score > 0; })
    .sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.linha.descricao || '').localeCompare(String(b.linha.descricao || ''), 'pt-BR');
    })
    .slice(0, 12)
    .map(function (x) { return x.linha; });
  return ranked;
}

function fecharSugestoesLinhaTabelaPreco() {
  const $box = $('#tabela-preco-linha-sugestoes');
  $box.removeClass('is-open').hide().html('');
  $('#tabela-preco-linha-busca').attr('aria-expanded', 'false');
  _linhaSugestaoIdx = -1;
}

function renderSugestoesLinhasTabelaPreco(termo) {
  const itens = filtrarSugestoesLinhasTabelaPreco(termo);
  const $box = $('#tabela-preco-linha-sugestoes');
  if (!itens.length) {
    if (String(termo || '').trim()) {
      $box.html('<div class="list-group-item text-muted small">Nenhuma linha encontrada</div>')
        .addClass('is-open').show();
      $('#tabela-preco-linha-busca').attr('aria-expanded', 'true');
    } else {
      fecharSugestoesLinhaTabelaPreco();
    }
    _linhaSugestaoIdx = -1;
    return;
  }
  let html = '';
  itens.forEach(function (l, idx) {
    html += `
      <button type="button" class="list-group-item list-group-item-action tp-linha-sugestao"
        role="option" data-idx="${idx}" data-id="${l.id}"
        data-codigo="${escapeHtmlLinhaTp(l.codigo || '')}"
        data-descricao="${escapeHtmlLinhaTp(l.descricao || l.nome || '')}">
        <strong>${escapeHtmlLinhaTp(l.descricao || l.nome || '')}</strong>
        <code class="ms-2">${escapeHtmlLinhaTp(l.codigo || '')}</code>
      </button>
    `;
  });
  $box.html(html).addClass('is-open').show();
  $('#tabela-preco-linha-busca').attr('aria-expanded', 'true');
  _linhaSugestaoIdx = -1;
}

function destacarSugestaoLinha(idx) {
  const $items = $('#tabela-preco-linha-sugestoes .tp-linha-sugestao');
  if (!$items.length) return;
  $items.removeClass('active');
  if (idx < 0 || idx >= $items.length) {
    _linhaSugestaoIdx = -1;
    return;
  }
  _linhaSugestaoIdx = idx;
  const $el = $items.eq(idx).addClass('active');
  if ($el[0] && $el[0].scrollIntoView) {
    $el[0].scrollIntoView({ block: 'nearest' });
  }
}

function linhaTemPrecoDigitado(linhaId) {
  let tem = false;
  $(`#tabela-preco-grade-tbody tr[data-linha-id="${linhaId}"] .tabela-preco-grade-preco`).each(function () {
    const v = String($(this).val() || '').trim();
    if (v !== '') {
      tem = true;
      return false;
    }
  });
  return tem;
}

function appendGradeLinhaTabelaPreco(valores) {
  const $tbody = $('#tabela-preco-grade-tbody');
  if ($tbody.find('tr[data-canal-id]').length === 0) {
    renderGradeValoresTabelaPreco(valores);
    return;
  }
  let html = '';
  let ultimaLinha = null;
  (valores || []).forEach(function (v) {
    const preco = v.preco != null && v.preco !== '' ? Number(v.preco) : '';
    const forma = v.forma_comercializacao || '';
    const unidade = v.unidade_comercial || '';
    const linhaId = v.linha_comercial_id || '';
    const linhaLabel = v.linha_descricao || v.linha_codigo || ('#' + linhaId);
    const mostrarLinha = String(linhaId) !== String(ultimaLinha);
    ultimaLinha = linhaId;
    html += `
      <tr data-canal-id="${v.canal_venda_id}" data-linha-id="${linhaId}">
        <td>${mostrarLinha
          ? `<strong>${escapeHtmlLinhaTp(linhaLabel)}</strong><small class="text-muted d-block"><code>${escapeHtmlLinhaTp(v.linha_codigo || '')}</code></small>`
          : '<span class="text-muted">   </span>'}</td>
        <td>
          <strong>${escapeHtmlLinhaTp(v.canal_nome || '')}</strong>
          <small class="text-muted d-block"><code>${escapeHtmlLinhaTp(v.canal_codigo || '')}</code></small>
        </td>
        <td>
          <select class="form-select form-select-sm tabela-preco-grade-forma">
            ${opcoesFormaComercialGrade(forma)}
          </select>
        </td>
        <td>
          <select class="form-select form-select-sm tabela-preco-grade-unidade">
            ${opcoesUnidadeComercialGrade(unidade)}
          </select>
        </td>
        <td>
          <input type="number" step="0.01" min="0"
            class="form-control form-control-sm tabela-preco-grade-preco"
            value="${preco === '' ? '' : preco}"
            placeholder="0,00">
        </td>
      </tr>
    `;
  });
  $tbody.find('td[colspan]').closest('tr').remove();
  $tbody.append(html);
}

function adicionarLinhaTabelaPreco(linha) {
  const id = Number(linha?.id || linha);
  if (!id) return;
  if (_linhasSelecionadasTabela.some(function (l) { return Number(l.id) === id; })) {
    refocarBuscaLinhaTabelaPreco();
    return;
  }
  const hit = _linhasComerciaisCache.find(function (l) { return Number(l.id) === id; }) || linha;
  _linhasSelecionadasTabela.push({
    id: id,
    codigo: hit.codigo || linha.codigo || '',
    descricao: hit.descricao || hit.nome || linha.descricao || ''
  });
  renderChipsLinhasTabelaPreco();

  const tabelaId = $('#tabela-preco-id').val() || null;
  tabelasPrecoAPI.gradePorLinhas([id], tabelaId).done(function (resp) {
    appendGradeLinhaTabelaPreco(resp.valores || []);
  }).fail(function () {
    alert('Erro ao gerar grade da Pol tica Comercial.');
  });

  $('#tabela-preco-linha-busca').val('');
  fecharSugestoesLinhaTabelaPreco();
  refocarBuscaLinhaTabelaPreco();
}

function removerLinhaTabelaPreco(linhaId, opts) {
  opts = opts || {};
  const id = Number(linhaId);
  if (!id) return;

  if (!opts.force && linhaTemPrecoDigitado(id)) {
    if (!confirm('Esta linha possui preços digitados. Remover mesmo assim?')) {
      return;
    }
  }

  _linhasSelecionadasTabela = _linhasSelecionadasTabela.filter(function (l) {
    return Number(l.id) !== id;
  });
  renderChipsLinhasTabelaPreco();
  $(`#tabela-preco-grade-tbody tr[data-linha-id="${id}"]`).remove();
  if (!$('#tabela-preco-grade-tbody tr[data-canal-id]').length) {
    $('#tabela-preco-grade-tbody').html(
      '<tr><td colspan="5" class="text-muted">Adicione ao menos uma Pol tica Comercial.</td></tr>'
    );
  }
  refocarBuscaLinhaTabelaPreco();
}

function refocarBuscaLinhaTabelaPreco() {
  const el = document.getElementById('tabela-preco-linha-busca');
  if (!el) return;
  requestAnimationFrame(function () {
    el.focus({ preventScroll: true });
  });
}

function regenerarGradePorLinhasSelecionadas() {
  const ids = obterLinhasSelecionadasTabelaPreco();
  const tabelaId = $('#tabela-preco-id').val() || null;
  if (!ids.length) {
    renderGradeValoresTabelaPreco([]);
    return;
  }
  $('#tabela-preco-grade-tbody').html(
    '<tr><td colspan="5" class="text-muted">Gerando canais...</td></tr>'
  );
  tabelasPrecoAPI.gradePorLinhas(ids, tabelaId).done(function (resp) {
    renderGradeValoresTabelaPreco(resp.valores || []);
  }).fail(function () {
    renderGradeValoresTabelaPreco([]);
    alert('Erro ao gerar grade por Linhas de Precificação.');
  });
}

function renderGradeValoresTabelaPreco(valores) {
  ensureModalTabelaPreco();
  let html = '';
  let ultimaLinha = null;
  (valores || []).forEach(function (v) {
    const preco = v.preco != null && v.preco !== '' ? Number(v.preco) : '';
    const forma = v.forma_comercializacao || '';
    const unidade = v.unidade_comercial || '';
    const linhaId = v.linha_comercial_id || '';
    const linhaLabel = v.linha_descricao || v.linha_codigo || ('#' + linhaId);
    const mostrarLinha = String(linhaId) !== String(ultimaLinha);
    ultimaLinha = linhaId;

    html += `
      <tr data-canal-id="${v.canal_venda_id}" data-linha-id="${linhaId}">
        <td>${mostrarLinha
          ? `<strong>${linhaLabel}</strong><small class="text-muted d-block"><code>${v.linha_codigo || ''}</code></small>`
          : '<span class="text-muted">   </span>'}</td>
        <td>
          <strong>${v.canal_nome || ''}</strong>
          <small class="text-muted d-block"><code>${v.canal_codigo || ''}</code></small>
        </td>
        <td>
          <select class="form-select form-select-sm tabela-preco-grade-forma">
            ${opcoesFormaComercialGrade(forma)}
          </select>
        </td>
        <td>
          <select class="form-select form-select-sm tabela-preco-grade-unidade">
            ${opcoesUnidadeComercialGrade(unidade)}
          </select>
        </td>
        <td>
          <input type="number" step="0.01" min="0"
            class="form-control form-control-sm tabela-preco-grade-preco"
            value="${preco === '' ? '' : preco}"
            placeholder="0,00">
        </td>
      </tr>
    `;
  });
  $('#tabela-preco-grade-tbody').html(
    html || '<tr><td colspan="5" class="text-muted">Adicione ao menos uma Pol tica Comercial.</td></tr>'
  );
}

function coletarValoresGradeTabelaPreco() {
  const valores = [];
  const vistos = new Set();
  let erro = null;

  $('#tabela-preco-grade-tbody tr[data-canal-id]').each(function () {
    const canalId = Number($(this).data('canal-id'));
    const linhaId = Number($(this).data('linha-id')) || null;
    const chave = (linhaId || 0) + ':' + canalId;
    if (vistos.has(chave)) {
      erro = 'Não é permitido Linha   Canal duplicados';
      return false;
    }
    vistos.add(chave);

    const forma = String($(this).find('.tabela-preco-grade-forma').val() || '').trim().toUpperCase() || null;
    const unidade = String($(this).find('.tabela-preco-grade-unidade').val() || '').trim().toUpperCase() || null;
    const raw = $(this).find('.tabela-preco-grade-preco').val();

    if (raw === '' || raw == null) return;

    const preco = parseFloat(raw);
    if (!Number.isFinite(preco)) {
      erro = 'Preço inválido';
      return false;
    }
    if (preco < 0) {
      erro = 'Não é permitido preço negativo';
      return false;
    }
    if ((forma === 'PESO' || forma === 'VOLUME') && !unidade) {
      erro = 'Informe a unidade comercial para forma Peso/Volume';
      return false;
    }
    valores.push({
      linha_comercial_id: linhaId,
      canal_venda_id: canalId,
      preco: preco,
      forma_comercializacao: forma,
      unidade_comercial: unidade
    });
  });

  return { valores: valores, erro: erro };
}

function abrirModalTabelaPreco(opts) {
  opts = opts || {};
  _callbackTabelaPrecoSalva = typeof opts.onSalvo === 'function' ? opts.onSalvo : null;
  ensureModalTabelaPreco();
  limparFormularioTabelaPreco();

  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-tabela-preco'));

  if (opts.id) {
    $('#modal-tabela-preco-titulo').text('Editar Tabela de Preços');
    tabelasPrecoAPI.buscar(opts.id).done(function (t) {
      $('#tabela-preco-id').val(t.id);
      $('#tabela-preco-codigo').val(t.codigo || '');
      $('#tabela-preco-nome').val(t.nome || '');
      $('#tabela-preco-descricao').val(t.descricao || '');
      $('#tabela-preco-ativo').prop('checked', !!t.ativo);
      const linhasIds = (t.linhas || []).map(function (l) { return Number(l.id); });
      carregarOpcoesLinhasComerciais(t.linhas || linhasIds).always(function () {
        if ((t.valores || []).length) {
          renderGradeValoresTabelaPreco(t.valores);
        } else if (linhasIds.length) {
          regenerarGradePorLinhasSelecionadas();
        }
        modal.show();
        setTimeout(refocarBuscaLinhaTabelaPreco, 80);
      });
    }).fail(function (err) {
      carregarOpcoesLinhasComerciais([]);
      alert('Erro ao carregar tabela: ' + (err.responseJSON?.erro || err.statusText));
      modal.show();
    });
    return;
  }

  carregarOpcoesLinhasComerciais([]).always(function () {
    modal.show();
    setTimeout(refocarBuscaLinhaTabelaPreco, 80);
  });
}

function salvarTabelaPreco() {
  ensureModalTabelaPreco();
  const id = $('#tabela-preco-id').val();
  const codigo = ($('#tabela-preco-codigo').val() || '').trim();
  const nome = ($('#tabela-preco-nome').val() || '').trim();
  const descricao = ($('#tabela-preco-descricao').val() || '').trim();
  const ativo = $('#tabela-preco-ativo').is(':checked');
  const linhasIds = obterLinhasSelecionadasTabelaPreco();

  if (!nome) {
    alert('Nome é obrigatório.');
    $('#tabela-preco-nome').focus();
    return;
  }
  if (!codigo) {
    alert('Código é obrigatório.');
    $('#tabela-preco-codigo').focus();
    return;
  }
  if (!linhasIds.length) {
    alert('Adicione ao menos uma Pol tica Comercial.');
    refocarBuscaLinhaTabelaPreco();
    return;
  }

  const coletado = coletarValoresGradeTabelaPreco();
  if (coletado.erro) {
    alert(coletado.erro);
    return;
  }

  const dados = {
    codigo: codigo,
    nome: nome,
    descricao: descricao,
    ativo: ativo,
    linhas_ids: linhasIds,
    valores: coletado.valores
  };
  const req = id ? tabelasPrecoAPI.atualizar(id, dados) : tabelasPrecoAPI.criar(dados);

  $('#btn-salvar-tabela-preco').prop('disabled', true);
  req.done(function (tabela) {
    const modal = bootstrap.Modal.getInstance(document.getElementById('modal-tabela-preco'));
    if (modal) modal.hide();
    if (typeof loadTabelasPreco === 'function' && $('#tabelas-preco-tbody').length) {
      loadTabelasPreco();
    }
    if (_callbackTabelaPrecoSalva) {
      _callbackTabelaPrecoSalva(tabela);
      _callbackTabelaPrecoSalva = null;
    }
    if (typeof showNotification === 'function') {
      showNotification('Tabela de preço salva com sucesso.', 'success');
    }
  }).fail(function (err) {
    alert('Erro ao salvar: ' + (err.responseJSON?.erro || err.statusText));
  }).always(function () {
    $('#btn-salvar-tabela-preco').prop('disabled', false);
  });
}

function loadTabelasPreco(termo) {
  const opts = {};
  if (termo && String(termo).trim()) opts.q = String(termo).trim();

  const $filtro = $('#filtro-tabelas-preco');
  const filtroEl = $filtro.length ? $filtro[0] : null;
  const manterFoco = filtroEl && document.activeElement === filtroEl;
  const selStart = manterFoco ? filtroEl.selectionStart : null;
  const selEnd = manterFoco ? filtroEl.selectionEnd : null;
  const reqId = (window._tabelasListReqId = (window._tabelasListReqId || 0) + 1);

  tabelasPrecoAPI.listar(opts).done(function (tabelas) {
    if (reqId !== window._tabelasListReqId) return;
    let lista = (tabelas || []).slice().sort(function (a, b) {
      return Number(a.id || 0) - Number(b.id || 0);
    });

    let filtroLinhaId = null;
    let filtroCanal = null;
    try {
      filtroLinhaId = sessionStorage.getItem('cds_central_filtro_linha_id');
      filtroCanal = sessionStorage.getItem('cds_central_filtro_canal');
    } catch (_e) { /* ignore */ }
    if (filtroLinhaId) {
      lista = lista.filter(function (t) {
        return (t.linhas || []).some(function (l) { return Number(l.id) === Number(filtroLinhaId); });
      });
    }
    if (filtroCanal) {
      const canalUp = String(filtroCanal).toUpperCase();
      lista = lista.filter(function (t) {
        return String(t.canal_codigo || '').toUpperCase() === canalUp;
      });
    }
    if (!$('#alerta-filtro-central-rcm871').length && $('#filtro-tabelas-preco').length) {
      $('#filtro-tabelas-preco').before(
        '<div id="alerta-filtro-central-rcm871" class="alert alert-info py-2 d-none w-100 mb-2"></div>'
      );
    }
    const $alerta = $('#alerta-filtro-central-rcm871');
    if ($alerta.length) {
      if (filtroLinhaId || filtroCanal) {
        $alerta.removeClass('d-none').html(
          'Filtro da Central: ' +
          (filtroLinhaId ? ('Linha #' + filtroLinhaId + ' ') : '') +
          (filtroCanal ? ('Operação ' + filtroCanal + ' ') : '') +
          '<button type="button" class="btn btn-sm btn-outline-secondary ms-2" id="btn-limpar-filtro-central">Limpar</button>'
        );
        $('#btn-limpar-filtro-central').off('click').on('click', function () {
          try {
            sessionStorage.removeItem('cds_central_filtro_linha_id');
            sessionStorage.removeItem('cds_central_filtro_canal');
          } catch (_e2) {}
          loadTabelasPreco($('#filtro-tabelas-preco').val());
        });
      } else {
        $alerta.addClass('d-none').empty();
      }
    }

    let html = '';
    lista.forEach(function (t, idx) {
      const linhasTxt = (t.linhas || []).map(function (l) {
        return l.descricao || l.codigo || ('#' + l.id);
      }).join(', ') || '<span class="text-muted"> </span>';
      html += `
        <tr>
          <td>${t.id != null ? t.id : (idx + 1)}</td>
          <td><code>${t.codigo || ''}</code></td>
          <td>${t.nome || ''}</td>
          <td>${t.canal_nome || t.canal_codigo || (t.canal_venda_id ? ('#' + t.canal_venda_id) : '—')}</td>
          <td>${linhasTxt}</td>
          <td>${t.ativo ? 'Sim' : 'Não'}</td>
          <td>
            <button type="button" class="btn btn-sm btn-primary" onclick="editarTabelaPreco(${t.id})">Editar</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" onclick="duplicarTabelaPreco(${t.id}, '${String(t.nome || '').replace(/'/g, "\\'")}')">Duplicar</button>
            ${t.ativo
              ? `<button type="button" class="btn btn-sm btn-outline-warning" onclick="desativarTabelaPreco(${t.id})">Desativar</button>`
              : ''}
            <button type="button" class="btn btn-sm btn-danger" onclick="excluirTabelaPreco(${t.id})">Excluir</button>
          </td>
        </tr>
      `;
    });
    $('#tabelas-preco-tbody').html(
      html || '<tr><td colspan="7" class="text-muted">Nenhuma Tabela de Preços cadastrada.</td></tr>'
    );
    if ((filtroLinhaId || filtroCanal) && lista.length === 1 && typeof editarTabelaPreco === 'function') {
      setTimeout(function () { editarTabelaPreco(lista[0].id); }, 350);
    }
    if (manterFoco && filtroEl && document.body.contains(filtroEl)) {
      if (document.querySelector('.modal.show, .modal.showing')) return;
      filtroEl.focus({ preventScroll: true });
      if (selStart != null && selEnd != null && typeof filtroEl.setSelectionRange === 'function') {
        try { filtroEl.setSelectionRange(selStart, selEnd); } catch (_) { /* ignore */ }
      }
    }
  }).fail(function (err) {
    if (reqId !== window._tabelasListReqId) return;
    $('#tabelas-preco-tbody').html(
      '<tr><td colspan="7" class="text-danger">Erro ao carregar: ' +
      (err.responseJSON?.erro || err.statusText) +
      '</td></tr>'
    );
  });
}

function editarTabelaPreco(id) {
  abrirModalTabelaPreco({ id: id });
}

function duplicarTabelaPreco(id, nomeAtual) {
  const sugerido = (nomeAtual || 'Tabela') + ' Promoção';
  const nome = prompt('Nome da nova tabela:', sugerido);
  if (nome == null || !String(nome).trim()) return;
  const codigo = prompt('Código da nova tabela:', String(sugerido).replace(/\s+/g, '_').toUpperCase().slice(0, 40));
  if (codigo == null || !String(codigo).trim()) return;
  tabelasPrecoAPI.duplicar(id, { nome: String(nome).trim(), codigo: String(codigo).trim() }).done(function (t) {
    loadTabelasPreco($('#filtro-tabelas-preco').val());
    if (typeof showNotification === 'function') {
      showNotification('Tabela duplicada: ' + (t.nome || nome), 'success');
    }
    if (t && t.id) editarTabelaPreco(t.id);
  }).fail(function (err) {
    alert('Erro ao duplicar: ' + (err.responseJSON?.erro || err.statusText));
  });
}

window.abrirSimuladorPrecificacao = function (tabelaId) {
  const produtoId = prompt('ID do produto para simular:');
  if (!produtoId) return;
  const canal = prompt('Canal/Operação (ex.: VAREJO, ATACADO):', 'VAREJO') || 'VAREJO';
  const qtd = prompt('Quantidade:', '1') || '1';
  tabelasPrecoAPI.simular({
    produto_id: Number(produtoId),
    canal: canal,
    tabela_preco_id: tabelaId || null,
    quantidade: Number(qtd)
  }).done(function (r) {
    alert(
      'Simulação — Motor Oficial\n\n' +
      'Produto: ' + ((r.produto && r.produto.nome) || produtoId) + '\n' +
      'Tabela: ' + ((r.tabela && (r.tabela.nome || r.tabela.codigo)) || '—') + '\n' +
      'Linha: ' + ((r.linha && (r.linha.descricao || r.linha.codigo)) || '—') + '\n' +
      'Unidade: ' + (r.unidade_comercial || '—') + '\n' +
      'Preço: R$ ' + (r.preco != null ? Number(r.preco).toFixed(2) : '—') + '\n' +
      'Origem: ' + (r.origem || '—') + '\n' +
      'Preço Segurança: R$ ' + (r.preco_seguranca != null ? Number(r.preco_seguranca).toFixed(2) : '—') +
      (r.usou_preco_seguranca ? ' (utilizado)' : '')
    );
  }).fail(function (err) {
    alert('Erro na simulação: ' + (err.responseJSON?.erro || err.statusText));
  });
};

function desativarTabelaPreco(id) {
  if (!confirm('Desativar esta Tabela de Preços?')) return;
  tabelasPrecoAPI.desativar(id).done(function () {
    loadTabelasPreco($('#filtro-tabelas-preco').val());
    if (typeof showNotification === 'function') {
      showNotification('Tabela desativada.', 'success');
    }
  }).fail(function (err) {
    alert('Erro ao desativar: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function excluirTabelaPreco(id) {
  if (!confirm('Deseja realmente excluir esta Tabela de Preços?')) return;
  tabelasPrecoAPI.excluir(id).done(function () {
    loadTabelasPreco($('#filtro-tabelas-preco').val());
  }).fail(function (err) {
    const body = err.responseJSON || {};
    const msg = body.erro || err.statusText;
    if (body.permite_desativar || body.code === 'TABELA_EM_USO') {
      const desativar = confirm(
        msg + '\n\nPermitir apenas desativar.\nDeseja desativar esta tabela agora?'
      );
      if (desativar) desativarTabelaPreco(id);
      return;
    }
    alert('Erro ao excluir: ' + msg);
  });
}

$(document).on('click', '#btn-nova-tabela-preco', function () {
  abrirModalTabelaPreco({});
});

$(document).on('click', '#btn-salvar-tabela-preco', function () {
  if (typeof window.salvarTabelaPreco === 'function') {
    window.salvarTabelaPreco();
  } else {
    salvarTabelaPreco();
  }
});

$(document).on('input', '#tabela-preco-linha-busca', function () {
  renderSugestoesLinhasTabelaPreco($(this).val());
});

$(document).on('focus', '#tabela-preco-linha-busca', function () {
  if (String($(this).val() || '').trim()) {
    renderSugestoesLinhasTabelaPreco($(this).val());
  }
});

$(document).on('keydown', '#tabela-preco-linha-busca', function (e) {
  const $items = $('#tabela-preco-linha-sugestoes .tp-linha-sugestao');
  if (e.key === 'Escape') {
    e.preventDefault();
    fecharSugestoesLinhaTabelaPreco();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!$items.length) {
      renderSugestoesLinhasTabelaPreco($(this).val());
      return;
    }
    destacarSugestaoLinha(_linhaSugestaoIdx < 0 ? 0 : Math.min(_linhaSugestaoIdx + 1, $items.length - 1));
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    destacarSugestaoLinha(Math.max(_linhaSugestaoIdx - 1, 0));
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (_linhaSugestaoIdx >= 0 && $items.eq(_linhaSugestaoIdx).length) {
      $items.eq(_linhaSugestaoIdx).trigger('click');
      return;
    }
    if ($items.length === 1) {
      $items.eq(0).trigger('click');
    }
    return;
  }
  if (e.key === 'Backspace' && !String($(this).val() || '') && _linhasSelecionadasTabela.length) {
    e.preventDefault();
    const last = _linhasSelecionadasTabela[_linhasSelecionadasTabela.length - 1];
    removerLinhaTabelaPreco(last.id);
  }
});

$(document).on('click', '.tp-linha-sugestao', function () {
  adicionarLinhaTabelaPreco({
    id: Number($(this).data('id')),
    codigo: $(this).attr('data-codigo') || '',
    descricao: $(this).attr('data-descricao') || ''
  });
});

$(document).on('click', '[data-remover-linha]', function (e) {
  e.preventDefault();
  e.stopPropagation();
  removerLinhaTabelaPreco($(this).data('remover-linha'));
});

$(document).on('mousedown', function (e) {
  if (!$(e.target).closest('#tabela-preco-linhas-box').length) {
    fecharSugestoesLinhaTabelaPreco();
  }
});

$(document).on('change', '.tabela-preco-grade-forma', function () {
  const forma = String($(this).val() || '').toUpperCase();
  const $unidade = $(this).closest('tr').find('.tabela-preco-grade-unidade');
  if (forma === 'PESO' && !$unidade.val()) $unidade.val('KG');
  if (forma === 'VOLUME' && !$unidade.val()) $unidade.val('LITRO');
  if (forma === 'UNIDADE' && !$unidade.val()) $unidade.val('UN');
});

$(document).off('input.tabelasFiltro', '#filtro-tabelas-preco');
$(document).on('input.tabelasFiltro', '#filtro-tabelas-preco', function () {
  const termo = $(this).val();
  clearTimeout(window._filtroTabelaPrecoTimer);
  window._filtroTabelaPrecoTimer = setTimeout(function () {
    loadTabelasPreco(termo);
  }, 300);
});

window.loadTabelasPreco = loadTabelasPreco;
window.editarTabelaPreco = editarTabelaPreco;
window.duplicarTabelaPreco = duplicarTabelaPreco;
window.excluirTabelaPreco = excluirTabelaPreco;
window.desativarTabelaPreco = desativarTabelaPreco;
window.abrirModalTabelaPreco = abrirModalTabelaPreco;
window.limparFormularioTabelaPreco = limparFormularioTabelaPreco;
window.tabelasPrecoAPI = tabelasPrecoAPI;

$(document).off('click.rcm83Cobertura', '#btn-cobertura-global').on('click.rcm83Cobertura', '#btn-cobertura-global', function () {
  tabelasPrecoAPI.cobertura().done(function (c) {
    alert(
      'Cobertura Geral\n\n' +
      'Produtos sem Linha: ' + (c.produtos_sem_linha || 0) + '\n' +
      'Linhas sem produtos: ' + ((c.linhas_sem_produtos || []).length) + '\n' +
      (c.resumo && c.resumo.ok ? '✔ OK' : ('Alertas: ' + ((c.resumo && c.resumo.alertas) || 0)))
    );
  }).fail(function (err) {
    alert((err.responseJSON && err.responseJSON.erro) || 'Erro na cobertura');
  });
});

$(document).off('click.rcm83Simular', '#btn-simular-preco').on('click.rcm83Simular', '#btn-simular-preco', function () {
  window.abrirSimuladorPrecificacao();
});

