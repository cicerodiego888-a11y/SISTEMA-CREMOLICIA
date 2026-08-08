/**
 * RA-6 / RA-6.6 — Tabela de Preços (UX definitiva)
 * Uma Tabela = Um Canal.
 * Grade oficial: Linha de Precificação | Unidade de Comercialização | Preço.
 *
 * Forma NÃO aparece na grade (não é redundante com Unidade para CASQUINHA/KIT,
 * mas a Unidade Comercial é o SSOT da cotação). Ao salvar, Forma é inferida da Unidade
 * e permanece no schema para o PDV.
 */
(function () {
  'use strict';

  var ROW_H = 44;
  var VIEWPORT_H = 420;
  var OVERSCAN = 8;

  var _canais = [];
  var _linhasCache = [];
  var _produtosCache = [];
  var _linhasGrade = []; // [{id, codigo, descricao, forma, unidade, preco, tipo, ativo}]
  var _filtro = '';
  var _filtroTipo = 'todos'; // todos | linha | produto
  var _filtroStatus = 'todos'; // todos | ativo | inativo
  var _ordenacao = 'nome'; // nome | preco | tipo | unidade
  var _selecionadoIdx = -1;
  var _scrollTop = 0;
  var _modoEdicao = false;
  var _canalId = null;
  var _unidadesPadrao = ['UN', 'KG', 'LT', 'CX', 'FD', 'PC', 'G', 'ML', 'MT'];

  function esc(s) {
    return $('<div>').text(s == null ? '' : String(s)).html();
  }

  function parsePrecoBr(txt) {
    if (txt == null || txt === '') return null;
    var s = String(txt).trim().replace(/\./g, '').replace(',', '.');
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatPrecoBr(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '';
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** RA-6.6 — Forma persistida é derivada da Unidade Comercial quando omitida */
  function inferirFormaDaUnidade(unidade) {
    var u = String(unidade || '').trim().toUpperCase();
    if (['KG', 'G', 'KILO', 'KILOS', 'GRAMA', 'GRAMAS'].indexOf(u) >= 0) return 'PESO';
    if (['L', 'LT', 'LITRO', 'LITROS', 'ML'].indexOf(u) >= 0) return 'VOLUME';
    return 'UNIDADE';
  }

  function carregarCanais() {
    return $.ajax({
      url: API_URL + '/canais-venda?ativos=1',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
    }).then(function (rows) {
      _canais = Array.isArray(rows) ? rows : (rows && rows.items) || [];
      return _canais;
    }).catch(function () {
      _canais = [];
      return _canais;
    });
  }

  function carregarLinhas() {
    return $.ajax({
      url: API_URL + '/linhas-comerciais?ativos=1',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
    }).then(function (rows) {
      _linhasCache = Array.isArray(rows) ? rows : (rows && rows.items) || [];
      return _linhasCache;
    }).catch(function () {
      _linhasCache = [];
      return _linhasCache;
    });
  }

  function carregarProdutos() {
    return $.ajax({
      url: API_URL + '/produtos',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
    }).then(function (rows) {
      var list = Array.isArray(rows) ? rows : (rows && rows.items) || [];
      // RCM-8.0: só produtos SEM linha entram na grade por produto
      _produtosCache = list.filter(function (p) {
        return !p.linha_comercial_id;
      });
      return _produtosCache;
    }).catch(function () {
      _produtosCache = [];
      return _produtosCache;
    });
  }

  function ensureStyles() {
    if (document.getElementById('ra6-tabela-preco-style')) return;
    var css = [
      '#ra6-grade-wrap{max-height:' + VIEWPORT_H + 'px;overflow:auto;border:1px solid #dee2e6;border-radius:6px;position:relative;}',
      '#ra6-grade-table{width:100%;margin:0;border-collapse:separate;border-spacing:0;}',
      '#ra6-grade-table thead th{position:sticky;top:0;z-index:2;background:#f8f9fa;box-shadow:inset 0 -1px 0 #dee2e6;}',
      '#ra6-grade-table .ra6-sticky{position:sticky;left:0;z-index:1;background:#fff;min-width:220px;box-shadow:2px 0 4px rgba(0,0,0,.05);}',
      '#ra6-grade-table thead th.ra6-sticky{z-index:3;background:#f8f9fa;}',
      '#ra6-spacer-top,#ra6-spacer-bottom{padding:0!important;border:0!important;}',
      '.ra6-linha-sugestoes{max-height:220px;overflow:auto;}'
    ].join('');
    $('<style id="ra6-tabela-preco-style">').text(css).appendTo(document.head);
  }

  function rebuildModalRa6() {
    ensureStyles();
    var $body = $('#modal-tabela-preco .modal-body');
    if (!$body.length) return;

    var optsCanal = _canais.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.nome || c.codigo) + ' (' + esc(c.codigo) + ')</option>';
    }).join('');

    var optsUnidade = _unidadesPadrao.map(function (u) {
      return '<option value="' + u + '">' + u + '</option>';
    }).join('');

    $body.html(
      '<ul class="nav nav-tabs mb-3" role="tablist">' +
        '<li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#ra6-tab-dados" type="button">Dados</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#ra6-tab-precos" type="button">Central de Preços</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#ra6-tab-regras" type="button">Regras Comerciais</button></li>' +
      '</ul>' +
      '<div class="tab-content">' +
        '<div class="tab-pane fade show active" id="ra6-tab-dados">' +
          '<div id="rcm83-resumo" class="border rounded p-3 mb-3 bg-light d-none"></div>' +
          '<div class="row g-2">' +
            '<div class="col-md-3"><label class="form-label">Código *</label>' +
              '<input type="text" class="form-control" id="tabela-preco-codigo" maxlength="40"></div>' +
            '<div class="col-md-5"><label class="form-label">Nome *</label>' +
              '<input type="text" class="form-control" id="tabela-preco-nome" maxlength="120"></div>' +
            '<div class="col-md-4"><label class="form-label">Canal / Operação *</label>' +
              '<select class="form-select" id="tabela-preco-canal">' + optsCanal + '</select></div>' +
            '<div class="col-md-9"><label class="form-label">Descrição</label>' +
              '<input type="text" class="form-control" id="tabela-preco-descricao" maxlength="255"></div>' +
            '<div class="col-md-3 d-flex align-items-end">' +
              '<div class="form-check form-switch mb-2">' +
                '<input class="form-check-input" type="checkbox" id="tabela-preco-ativo" checked>' +
                '<label class="form-check-label" for="tabela-preco-ativo">Ativa</label>' +
              '</div></div>' +
          '</div>' +
          '<p class="text-muted small mt-3 mb-0">Central Oficial: cada tabela alimenta o Motor de Precificação para uma operação (canal).</p>' +
        '</div>' +
        '<div class="tab-pane fade" id="ra6-tab-precos">' +
          '<div class="d-flex flex-wrap gap-2 align-items-center mb-2" id="rcm83-kpis">' +
            '<span class="badge bg-primary" id="kpi-linhas">0 linhas</span>' +
            '<span class="badge bg-secondary" id="kpi-produtos">0 produtos</span>' +
            '<span class="badge bg-dark" id="kpi-total">0 registros</span>' +
            '<span class="badge bg-info text-dark" id="kpi-medio">Preço médio —</span>' +
          '</div>' +
          '<div class="d-flex flex-wrap gap-2 align-items-center mb-2">' +
            '<button type="button" class="btn btn-primary btn-sm" id="ra6-btn-add-registro"><i class="fas fa-plus"></i> Adicionar Registro</button>' +
            '<button type="button" class="btn btn-outline-success btn-sm" id="ra6-btn-add-todas"><i class="fas fa-layer-group"></i> Inserir todas as linhas</button>' +
            '<button type="button" class="btn btn-outline-info btn-sm" id="rcm83-btn-diagnostico"><i class="fas fa-stethoscope"></i> Diagnosticar</button>' +
            '<button type="button" class="btn btn-outline-warning btn-sm" id="rcm83-btn-cobertura"><i class="fas fa-shield-alt"></i> Cobertura</button>' +
            '<button type="button" class="btn btn-outline-secondary btn-sm" id="rcm83-btn-simular"><i class="fas fa-flask"></i> Simular</button>' +
            '<button type="button" class="btn btn-outline-dark btn-sm" id="rcm83-btn-historico"><i class="fas fa-history"></i> Histórico</button>' +
          '</div>' +
          '<div class="d-flex flex-wrap gap-2 align-items-center mb-2">' +
            '<input type="text" class="form-control form-control-sm" id="ra6-filtro-linha" placeholder="Pesquisar referência, preço, unidade..." style="max-width:240px;">' +
            '<select class="form-select form-select-sm" id="rcm83-filtro-tipo" style="max-width:130px;">' +
              '<option value="todos">Todos</option><option value="linha">Linhas</option><option value="produto">Produtos</option>' +
            '</select>' +
            '<select class="form-select form-select-sm" id="rcm83-filtro-status" style="max-width:130px;">' +
              '<option value="todos">Status</option><option value="ativo">Ativos</option><option value="inativo">Inativos</option>' +
            '</select>' +
            '<select class="form-select form-select-sm" id="rcm83-ordenacao" style="max-width:160px;">' +
              '<option value="nome">Ordenar: Nome</option><option value="preco">Preço</option>' +
              '<option value="tipo">Tipo</option><option value="unidade">Unidade</option>' +
            '</select>' +
            '<datalist id="rcm83-unidades-list">' + optsUnidade + '</datalist>' +
          '</div>' +
          '<div id="ra6-add-tipo-panel" class="card card-body py-2 mb-2 d-none">' +
            '<strong class="small">Como deseja formar o preço?</strong>' +
            '<div class="mt-2 d-flex gap-3">' +
              '<label class="form-check"><input class="form-check-input" type="radio" name="rcm83-tipo-add" value="linha"> Linha de Precificação</label>' +
              '<label class="form-check"><input class="form-check-input" type="radio" name="rcm83-tipo-add" value="produto"> Produto</label>' +
            '</div>' +
          '</div>' +
          '<div id="ra6-add-panel" class="card card-body py-2 mb-2 d-none">' +
            '<label class="form-label small mb-1">Pesquisar Linha (código, nome, grupo, categoria)</label>' +
            '<input type="text" class="form-control" id="ra6-busca-add-linha" placeholder="Digite para pesquisar..." autocomplete="off">' +
            '<div id="ra6-sugestoes-linha" class="list-group ra6-linha-sugestoes mt-1"></div>' +
          '</div>' +
          '<div id="ra6-add-panel-produto" class="card card-body py-2 mb-2 d-none">' +
            '<label class="form-label small mb-1">Pesquisar Produto (código, nome, barras, categoria, linha)</label>' +
            '<input type="text" class="form-control" id="ra6-busca-add-produto" placeholder="Digite para pesquisar..." autocomplete="off">' +
            '<div id="ra6-sugestoes-produto" class="list-group ra6-linha-sugestoes mt-1"></div>' +
          '</div>' +
          '<div class="row g-2">' +
            '<div class="col-lg-8">' +
              '<div id="ra6-grade-wrap">' +
                '<table class="table table-sm table-bordered mb-0" id="ra6-grade-table">' +
                  '<thead><tr>' +
                    '<th class="ra6-sticky">Referência</th>' +
                    '<th style="width:90px;">Tipo</th>' +
                    '<th style="width:110px;">Unidade</th>' +
                    '<th style="width:110px;">Preço</th>' +
                    '<th style="width:90px;">Status</th>' +
                    '<th style="width:88px;">Ações</th>' +
                  '</tr></thead>' +
                  '<tbody id="ra6-grade-tbody"></tbody>' +
                '</table>' +
              '</div>' +
            '</div>' +
            '<div class="col-lg-4">' +
              '<div id="rcm83-painel" class="border rounded p-3 bg-white h-100">' +
                '<div class="text-muted small">Selecione uma referência na grade para ver o painel inteligente.</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<p class="text-muted small mt-2 mb-0">Cada registro é <strong>Linha</strong> ou <strong>Produto</strong> (nunca ambos). Unidade Comercial pertence à Tabela.</p>' +
        '</div>' +
        '<div class="tab-pane fade" id="ra6-tab-regras">' +
          '<div class="row g-3">' +
            '<div class="col-md-4">' +
              '<div class="form-check form-switch">' +
                '<input class="form-check-input" type="checkbox" id="ra6-atacado-hab">' +
                '<label class="form-check-label" for="ra6-atacado-hab">Atacado habilitado nesta tabela</label>' +
              '</div>' +
              '<small class="text-muted">Use na Tabela Atacado.</small>' +
            '</div>' +
            '<div class="col-md-4"><label class="form-label">Quantidade mínima</label>' +
              '<input type="number" min="0" class="form-control" id="ra6-qtd-min" value="0"></div>' +
            '<div class="col-md-4"><label class="form-label">Tipo da contagem</label>' +
              '<select class="form-select" id="ra6-tipo-contagem">' +
                '<option value="TOTAL_VENDA">Quantidade total da venda</option>' +
                '<option value="POR_LINHA">Quantidade por Linha</option>' +
                '<option value="POR_PRODUTO">Quantidade por Produto</option>' +
                '<option value="POR_CATEGORIA">Quantidade por Categoria</option>' +
              '</select></div>' +
            '<div class="col-md-6">' +
              '<div class="form-check">' +
                '<input class="form-check-input" type="checkbox" id="ra6-perm-prod" checked>' +
                '<label class="form-check-label" for="ra6-perm-prod">Permitir produtos diferentes</label>' +
              '</div></div>' +
            '<div class="col-md-6">' +
              '<div class="form-check">' +
                '<input class="form-check-input" type="checkbox" id="ra6-perm-cat" checked>' +
                '<label class="form-check-label" for="ra6-perm-cat">Permitir categorias diferentes</label>' +
              '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<input type="hidden" id="tabela-preco-id" value="">'
    );

    bindEditorEvents();
  }

  function linhasFiltradas() {
    var termo = String(_filtro || '').trim().toLowerCase();
    var lista = _linhasGrade.filter(function (l) {
      if (_filtroTipo === 'linha' && l.tipo !== 'linha') return false;
      if (_filtroTipo === 'produto' && l.tipo !== 'produto') return false;
      var ativo = l.ativo !== false;
      if (_filtroStatus === 'ativo' && !ativo) return false;
      if (_filtroStatus === 'inativo' && ativo) return false;
      if (!termo) return true;
      return String(l.codigo || '').toLowerCase().indexOf(termo) >= 0
        || String(l.descricao || '').toLowerCase().indexOf(termo) >= 0
        || String(l.unidade || '').toLowerCase().indexOf(termo) >= 0
        || String(l.preco != null ? l.preco : '').indexOf(termo) >= 0
        || String(l.tipo || '').toLowerCase().indexOf(termo) >= 0
        || (ativo ? 'ativo' : 'inativo').indexOf(termo) >= 0;
    });
    lista.sort(function (a, b) {
      if (_ordenacao === 'preco') return Number(a.preco || 0) - Number(b.preco || 0);
      if (_ordenacao === 'tipo') return String(a.tipo).localeCompare(String(b.tipo));
      if (_ordenacao === 'unidade') return String(a.unidade || '').localeCompare(String(b.unidade || ''));
      return String(a.descricao || a.codigo || '').localeCompare(String(b.descricao || b.codigo || ''), 'pt-BR');
    });
    return lista;
  }

  function atualizarKpis() {
    var nL = _linhasGrade.filter(function (x) { return x.tipo === 'linha'; }).length;
    var nP = _linhasGrade.filter(function (x) { return x.tipo === 'produto'; }).length;
    var ativos = _linhasGrade.filter(function (x) { return x.ativo !== false; });
    var media = null;
    if (ativos.length) {
      media = ativos.reduce(function (s, x) { return s + Number(x.preco || 0); }, 0) / ativos.length;
    }
    $('#kpi-linhas').text(nL + ' linha' + (nL === 1 ? '' : 's'));
    $('#kpi-produtos').text(nP + ' produto' + (nP === 1 ? '' : 's'));
    $('#kpi-total').text((nL + nP) + ' registro' + (nL + nP === 1 ? '' : 's'));
    $('#kpi-medio').text(media != null
      ? ('Preço médio R$ ' + media.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      : 'Preço médio —');
  }

  function renderResumo(resumo) {
    var $box = $('#rcm83-resumo');
    if (!$box.length || !resumo) {
      $box.addClass('d-none');
      return;
    }
    var usa = (resumo.operacoes_utilizam || []).map(function (o) {
      return '<div>✔ ' + esc(o) + '</div>';
    }).join('') || '<div class="text-muted">—</div>';
    var nao = (resumo.operacoes_nao_utilizam || []).map(function (o) {
      return '<li>' + esc(o) + '</li>';
    }).join('');
    var dt = resumo.ultima_alteracao
      ? new Date(resumo.ultima_alteracao).toLocaleString('pt-BR')
      : '—';
    $box.removeClass('d-none').html(
      '<div class="row g-2 small">' +
        '<div class="col-md-4"><strong>Tabela</strong><div class="fs-6">' + esc(resumo.nome) + '</div>' +
          '<div class="text-muted">' + esc(resumo.descricao || '') + '</div></div>' +
        '<div class="col-md-4"><strong>Operações que utilizam</strong>' + usa +
          (nao ? '<div class="mt-2"><strong>Não utilizada por</strong><ul class="mb-0 ps-3">' + nao + '</ul></div>' : '') +
        '</div>' +
        '<div class="col-md-4"><strong>Indicadores</strong>' +
          '<div>Total de registros: <strong>' + (resumo.quantidade_total || 0) + '</strong></div>' +
          '<div>Linhas: ' + (resumo.quantidade_linhas || 0) + ' · Produtos: ' + (resumo.quantidade_produtos || 0) + '</div>' +
          '<div>Preço médio: ' + (resumo.preco_medio != null ? ('R$ ' + Number(resumo.preco_medio).toFixed(2)) : '—') + '</div>' +
          '<div>Última alteração: ' + esc(dt) + '</div></div>' +
      '</div>'
    );
  }

  function carregarPainelInteligente(item) {
    var $p = $('#rcm83-painel');
    if (!$p.length || !item) {
      $p.html('<div class="text-muted small">Selecione uma referência na grade.</div>');
      return;
    }
    $p.html('<div class="text-muted small">Carregando...</div>');
    if (item.tipo === 'linha') {
      $.ajax({
        url: API_URL + '/tabelas-preco/linhas/' + item.id + '/produtos',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
      }).done(function (r) {
        var lista = (r.produtos || []).slice(0, 30).map(function (p) {
          return '<div>✔ ' + esc(p.nome || p.codigo) + '</div>';
        }).join('');
        $p.html(
          '<strong>Produtos pertencentes à Linha</strong>' +
          '<div class="fw-semibold mb-2">' + esc(r.linha && (r.linha.descricao || r.linha.codigo)) + '</div>' +
          lista +
          ((r.total || 0) > 30 ? '<div class="text-muted">…</div>' : '') +
          '<div class="mt-2">Total: <strong>' + (r.total || 0) + ' produtos</strong></div>' +
          '<div class="alert alert-info py-2 mt-2 mb-0 small">' + esc(r.mensagem || '') + '</div>' +
          '<button type="button" class="btn btn-sm btn-link px-0 mt-2 rcm83-abrir-linha" data-id="' + item.id + '">Abrir cadastro da Linha</button>'
        );
      }).fail(function () {
        $p.html('<div class="text-danger small">Não foi possível carregar o painel.</div>');
      });
      return;
    }
    $.ajax({
      url: API_URL + '/tabelas-preco/produtos/' + item.id + '/painel',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
    }).done(function (r) {
      var p = r.produto || {};
      $p.html(
        '<strong>Produto</strong><div class="fw-semibold">' + esc(p.nome) + '</div>' +
        '<div class="mt-2"><span class="text-muted">Categoria</span><div>' + esc(p.categoria || '—') + '</div></div>' +
        '<div class="mt-2"><span class="text-muted">Linha</span><div>' +
          (p.linha ? esc(p.linha.descricao || p.linha.codigo) : 'Sem Linha') + '</div></div>' +
        '<div class="alert alert-light border py-2 mt-2 mb-0 small">' + esc(r.mensagem || '') + '</div>' +
        '<button type="button" class="btn btn-sm btn-link px-0 mt-2 rcm83-abrir-produto" data-id="' + item.id + '">Abrir cadastro do Produto</button>'
      );
    }).fail(function () {
      $p.html('<div class="text-danger small">Não foi possível carregar o painel.</div>');
    });
  }

  /** Snapshot do input ativo na grade (Electron perde foco no re-render / confirm). */
  function capturarFocoGrade() {
    var ae = document.activeElement;
    if (!ae || !ae.classList) return null;
    var isUnidade = ae.classList.contains('ra6-unidade');
    var isPreco = ae.classList.contains('ra6-preco');
    if (!isUnidade && !isPreco) return null;
    var idx = Number(ae.getAttribute('data-idx'));
    if (!Number.isFinite(idx)) return null;
    return {
      idx: idx,
      campo: isPreco ? 'preco' : 'unidade',
      value: ae.value,
      selStart: typeof ae.selectionStart === 'number' ? ae.selectionStart : null,
      selEnd: typeof ae.selectionEnd === 'number' ? ae.selectionEnd : null
    };
  }

  function sincronizarInputAtivoGrade(snap) {
    if (!snap || !_linhasGrade[snap.idx]) return;
    if (snap.campo === 'unidade') {
      var u = String(snap.value || '').trim().toUpperCase();
      _linhasGrade[snap.idx].unidade = u || null;
      _linhasGrade[snap.idx].forma = u ? inferirFormaDaUnidade(u) : null;
      return;
    }
    var n = parsePrecoBr(snap.value);
    if (Number.isFinite(n)) _linhasGrade[snap.idx].preco = n;
  }

  function restaurarFocoGrade(snap) {
    if (!snap) return;
    var sel = snap.campo === 'preco' ? '.ra6-preco' : '.ra6-unidade';
    var el = document.querySelector('#ra6-grade-tbody ' + sel + '[data-idx="' + snap.idx + '"]');
    if (!el) return;
    if (snap.value != null && snap.campo === 'preco' && !Number.isFinite(parsePrecoBr(snap.value))) {
      el.value = snap.value;
    }
    try {
      el.focus({ preventScroll: true });
      if (snap.selStart != null && typeof el.setSelectionRange === 'function') {
        el.setSelectionRange(snap.selStart, snap.selEnd != null ? snap.selEnd : snap.selStart);
      }
    } catch (_e) {
      el.focus();
    }
  }

  function focarPrimeiroPrecoGrade() {
    var tentar = function () {
      var el = document.querySelector('#ra6-grade-tbody .ra6-preco');
      if (!el) return;
      try {
        el.focus({ preventScroll: true });
        if (typeof el.select === 'function') el.select();
      } catch (_e) {
        el.focus();
      }
    };
    tentar();
    [30, 80, 160, 280].forEach(function (ms) {
      setTimeout(tentar, ms);
    });
  }

  function renderGradeVirtual() {
    var foco = capturarFocoGrade();
    sincronizarInputAtivoGrade(foco);
    atualizarKpis();

    var lista = linhasFiltradas();

    var $tb = $('#ra6-grade-tbody');
    if (!lista.length) {
      $tb.html('<tr><td colspan="6" class="text-center text-muted py-4">Nenhum item. Adicione Linha ou Produto.</td></tr>');
      return;
    }

    var totalH = lista.length * ROW_H;
    var start = Math.max(0, Math.floor(_scrollTop / ROW_H) - OVERSCAN);
    var visible = Math.ceil(VIEWPORT_H / ROW_H) + OVERSCAN * 2;
    var end = Math.min(lista.length, start + visible);
    var topPad = start * ROW_H;
    var bottomPad = Math.max(0, totalH - end * ROW_H);

    var html = '<tr id="ra6-spacer-top"><td colspan="6" style="height:' + topPad + 'px"></td></tr>';
    for (var i = start; i < end; i++) {
      var l = lista[i];
      var idx = _linhasGrade.indexOf(l);
      var unidadeVal = (foco && foco.idx === idx && foco.campo === 'unidade')
        ? foco.value
        : (l.unidade || '');
      var precoVal = (foco && foco.idx === idx && foco.campo === 'preco' && !Number.isFinite(parsePrecoBr(foco.value)))
        ? foco.value
        : formatPrecoBr(l.preco);
      var ativo = l.ativo !== false;
      var sel = idx === _selecionadoIdx ? ' table-active' : '';
      html += '<tr data-idx="' + idx + '" class="rcm83-row' + sel + '" style="height:' + ROW_H + 'px">' +
        '<td class="ra6-sticky"><a href="#" class="rcm83-ref-link text-decoration-none" data-idx="' + idx + '">' +
          '<strong>' + esc(l.descricao || l.codigo) + '</strong></a>' +
          '<div class="text-muted small">' + esc(l.codigo || '') + '</div></td>' +
        '<td><span class="badge ' + (l.tipo === 'produto' ? 'bg-secondary' : 'bg-primary') + '">' +
          (l.tipo === 'produto' ? 'Produto' : 'Linha') + '</span></td>' +
        '<td><input type="text" list="rcm83-unidades-list" class="form-control form-control-sm ra6-unidade" data-idx="' + idx +
          '" value="' + esc(unidadeVal) + '" maxlength="10" placeholder="UN/KG/LT" title="Unidade Comercial da Tabela"></td>' +
        '<td><input type="text" class="form-control form-control-sm ra6-preco" data-idx="' + idx +
          '" value="' + esc(precoVal) + '" inputmode="decimal"></td>' +
        '<td><select class="form-select form-select-sm ra6-status" data-idx="' + idx + '">' +
          '<option value="1"' + (ativo ? ' selected' : '') + '>Ativo</option>' +
          '<option value="0"' + (!ativo ? ' selected' : '') + '>Inativo</option></select></td>' +
        '<td class="text-nowrap">' +
          '<button type="button" class="btn btn-sm btn-outline-secondary ra6-dup-linha" data-idx="' + idx + '" title="Duplicar"><i class="fas fa-copy"></i></button> ' +
          '<button type="button" class="btn btn-sm btn-outline-danger ra6-rm-linha" data-idx="' + idx + '" title="Remover"><i class="fas fa-trash"></i></button>' +
        '</td>' +
      '</tr>';
    }
    html += '<tr id="ra6-spacer-bottom"><td colspan="6" style="height:' + bottomPad + 'px"></td></tr>';
    $tb.html(html);
    restaurarFocoGrade(foco);
  }

  function bindEditorEvents() {
    $('#ra6-grade-wrap').off('scroll.ra6').on('scroll.ra6', function () {
      _scrollTop = this.scrollTop || 0;
      renderGradeVirtual();
    });

    $('#ra6-filtro-linha').off('input.ra6').on('input.ra6', function () {
      _filtro = $(this).val() || '';
      _scrollTop = 0;
      $('#ra6-grade-wrap').scrollTop(0);
      renderGradeVirtual();
    });

    $('#rcm83-filtro-tipo,#rcm83-filtro-status,#rcm83-ordenacao').off('change.rcm83').on('change.rcm83', function () {
      _filtroTipo = $('#rcm83-filtro-tipo').val() || 'todos';
      _filtroStatus = $('#rcm83-filtro-status').val() || 'todos';
      _ordenacao = $('#rcm83-ordenacao').val() || 'nome';
      _scrollTop = 0;
      renderGradeVirtual();
    });

    $('#ra6-btn-add-registro').off('click.ra6').on('click.ra6', function () {
      $('#ra6-add-panel,#ra6-add-panel-produto').addClass('d-none');
      $('#ra6-add-tipo-panel').removeClass('d-none');
      $('input[name="rcm83-tipo-add"]').prop('checked', false);
    });

    $(document).off('change.rcm83Tipo', 'input[name="rcm83-tipo-add"]')
      .on('change.rcm83Tipo', 'input[name="rcm83-tipo-add"]', function () {
        var tipo = $(this).val();
        $('#ra6-add-tipo-panel').addClass('d-none');
        if (tipo === 'linha') {
          $('#ra6-add-panel-produto').addClass('d-none');
          $('#ra6-add-panel').removeClass('d-none');
          $('#ra6-busca-add-linha').val('').trigger('focus');
          $('#ra6-sugestoes-linha').empty();
        } else {
          $('#ra6-add-panel').addClass('d-none');
          $('#ra6-add-panel-produto').removeClass('d-none');
          $('#ra6-busca-add-produto').val('').trigger('focus');
          $('#ra6-sugestoes-produto').empty();
        }
      });

    $('#ra6-btn-add-linha').off('click.ra6');
    $('#ra6-btn-add-produto').off('click.ra6');

    $('#ra6-busca-add-produto').off('input.ra6').on('input.ra6', function () {
      var termo = String($(this).val() || '').trim();
      var $box = $('#ra6-sugestoes-produto').empty();
      if (termo.length < 1) return;
      $.ajax({
        url: API_URL + '/tabelas-preco/pesquisar-produtos?q=' + encodeURIComponent(termo),
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
      }).done(function (rows) {
        var idsNaGrade = {};
        _linhasGrade.forEach(function (l) {
          if (l.tipo === 'produto') idsNaGrade[Number(l.id)] = true;
        });
        var hits = (rows || []).filter(function (p) {
          return !idsNaGrade[Number(p.id)];
        }).slice(0, 30);
        if (!hits.length) {
          $box.html('<div class="list-group-item text-muted">Nenhum produto encontrado</div>');
          return;
        }
        hits.forEach(function (p) {
          var linhaTxt = p.linha_comercial_id
            ? ('Este Produto pertence à Linha: <strong>' + esc(p.linha_descricao || p.linha_codigo || ('#' + p.linha_comercial_id)) + '</strong>')
            : '<em>Produto com Precificação Própria</em>';
          $box.append(
            $('<button type="button" class="list-group-item list-group-item-action">')
              .html('<strong>' + esc(p.nome || p.codigo) + '</strong> <span class="text-muted">' + esc(p.codigo || '') + '</span>' +
                (p.categoria_nome ? (' <span class="badge bg-light text-dark">' + esc(p.categoria_nome) + '</span>') : '') +
                '<div class="small mt-1">' + linhaTxt + '</div>')
              .on('click', function () {
                if (p.linha_comercial_id) {
                  if (typeof showNotification === 'function') {
                    showNotification('Produtos com Linha de Precificação usam o preço da Linha — adicione a Linha na grade.', 'info');
                  }
                  return;
                }
                if (adicionarProduto(p)) {
                  renderGradeVirtual();
                  _selecionadoIdx = _linhasGrade.length - 1;
                  carregarPainelInteligente(_linhasGrade[_selecionadoIdx]);
                }
                $('#ra6-busca-add-produto').val('');
                $box.empty();
                $('#ra6-add-panel-produto').addClass('d-none');
              })
          );
        });
      });
    });

    $('#ra6-btn-add-todas').off('click.ra6').on('click.ra6', function () {
      inserirTodasLinhas();
    });

    $('#ra6-busca-add-linha').off('input.ra6').on('input.ra6', function () {
      var termo = String($(this).val() || '').trim();
      var $box = $('#ra6-sugestoes-linha').empty();
      if (termo.length < 1) return;
      $.ajax({
        url: API_URL + '/tabelas-preco/pesquisar-linhas?q=' + encodeURIComponent(termo),
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
      }).done(function (rows) {
        var idsNaGrade = {};
        _linhasGrade.forEach(function (l) {
          if (l.tipo === 'linha') idsNaGrade[Number(l.id)] = true;
        });
        var hits = (rows || []).filter(function (l) {
          return !idsNaGrade[Number(l.id)];
        }).slice(0, 30);
        if (!hits.length) {
          $box.html('<div class="list-group-item text-muted">Nenhuma linha encontrada</div>');
          return;
        }
        hits.forEach(function (l) {
          var grupo = l.grupo || l.categoria_nome || '';
          $box.append(
            $('<button type="button" class="list-group-item list-group-item-action">')
              .html('<strong>' + esc(l.descricao || l.codigo) + '</strong> <span class="text-muted">' + esc(l.codigo || '') + '</span>' +
                (grupo ? (' · ' + esc(grupo)) : ''))
              .on('click', function () {
                if (adicionarLinha(l)) {
                  renderGradeVirtual();
                  _selecionadoIdx = _linhasGrade.length - 1;
                  carregarPainelInteligente(_linhasGrade[_selecionadoIdx]);
                }
                $('#ra6-busca-add-linha').val('');
                $box.empty();
                $('#ra6-add-panel').addClass('d-none');
              })
          );
        });
      });
    });

    $('#ra6-grade-tbody').off('change.ra6 input.ra6 click.ra6')
      .on('change.ra6', '.ra6-unidade', function () {
        var idx = Number($(this).data('idx'));
        if (!_linhasGrade[idx]) return;
        var u = String($(this).val() || '').trim().toUpperCase();
        _linhasGrade[idx].unidade = u || null;
        _linhasGrade[idx].forma = u ? inferirFormaDaUnidade(u) : null;
        $(this).val(u);
      })
      .on('change.ra6', '.ra6-preco', function () {
        var idx = Number($(this).data('idx'));
        var n = parsePrecoBr($(this).val());
        if (_linhasGrade[idx] && Number.isFinite(n)) {
          _linhasGrade[idx].preco = n;
          $(this).val(formatPrecoBr(n));
        }
      })
      .on('change.ra6', '.ra6-status', function () {
        var idx = Number($(this).data('idx'));
        if (_linhasGrade[idx]) _linhasGrade[idx].ativo = String($(this).val()) !== '0';
        atualizarKpis();
      })
      .on('click.ra6', '.ra6-rm-linha', function (e) {
        e.stopPropagation();
        var idx = Number($(this).data('idx'));
        if (idx < 0) return;
        _linhasGrade.splice(idx, 1);
        if (_selecionadoIdx === idx) {
          _selecionadoIdx = -1;
          $('#rcm83-painel').html('<div class="text-muted small">Selecione uma referência na grade.</div>');
        }
        renderGradeVirtual();
      })
      .on('click.ra6', '.ra6-dup-linha', function (e) {
        e.stopPropagation();
        var idx = Number($(this).data('idx'));
        var src = _linhasGrade[idx];
        if (!src) return;
        window._rcm83ClipboardDup = {
          preco: src.preco,
          unidade: src.unidade,
          ativo: src.ativo !== false,
          forma: src.forma,
          tipo: src.tipo
        };
        if (typeof showNotification === 'function') {
          showNotification('Preço/unidade/status copiados. Adicione outra referência para colar.', 'info');
        } else {
          alert('Preço, unidade e status copiados.\nAdicione outra referência (Linha ou Produto) para aplicar a cópia.');
        }
        $('#ra6-btn-add-registro').trigger('click');
      })
      .on('click.ra6', '.rcm83-ref-link, tr.rcm83-row', function (e) {
        if ($(e.target).closest('input,select,button,a.rcm83-ref-link').length && !$(e.target).closest('a.rcm83-ref-link').length) return;
        var idx = Number($(this).closest('tr').data('idx'));
        if ($(this).hasClass('rcm83-ref-link')) {
          e.preventDefault();
          idx = Number($(this).data('idx'));
          var item = _linhasGrade[idx];
          if (!item) return;
          if (item.tipo === 'linha' && typeof editarLinhaComercial === 'function') {
            editarLinhaComercial(item.id);
            return;
          }
          if (item.tipo === 'produto' && typeof editProduto === 'function') {
            editProduto(item.id);
            return;
          }
        }
        if (!Number.isFinite(idx)) return;
        _selecionadoIdx = idx;
        renderGradeVirtual();
        carregarPainelInteligente(_linhasGrade[idx]);
      });

    $('#rcm83-painel').off('click.rcm83').on('click.rcm83', '.rcm83-abrir-linha', function () {
      var id = Number($(this).data('id'));
      if (typeof editarLinhaComercial === 'function') editarLinhaComercial(id);
      else if (typeof loadPage === 'function') loadPage('linhas-comerciais');
    }).on('click.rcm83', '.rcm83-abrir-produto', function () {
      var id = Number($(this).data('id'));
      if (typeof editProduto === 'function') editProduto(id);
    });

    $('#rcm83-btn-diagnostico').off('click.rcm83').on('click.rcm83', function () {
      var item = _selecionadoIdx >= 0 ? _linhasGrade[_selecionadoIdx] : null;
      if (!item || item.tipo !== 'linha') {
        alert('Selecione uma Linha na grade para diagnosticar.');
        return;
      }
      $.ajax({
        url: API_URL + '/tabelas-preco/linhas/' + item.id + '/diagnostico',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
      }).done(function (d) {
        var msg = 'Linha: ' + ((d.linha && d.linha.descricao) || '') +
          '\nUtilizada por: ' + (d.produtos_vinculados || 0) + ' produtos' +
          '\nPresente em: ' + ((d.presente_em || []).join(', ') || '—') +
          '\nAusente em: ' + ((d.ausente_em || []).join(', ') || '—');
        if ((d.inconsistencias || []).length) {
          msg += '\n\nInconsistências:\n- ' + d.inconsistencias.map(function (i) { return i.msg; }).join('\n- ');
        }
        alert(msg);
      }).fail(function (err) {
        alert((err.responseJSON && err.responseJSON.erro) || 'Erro no diagnóstico');
      });
    });

    $('#rcm83-btn-cobertura').off('click.rcm83').on('click.rcm83', function () {
      var id = $('#tabela-preco-id').val();
      if (!id) {
        alert('Salve a tabela antes de verificar cobertura.');
        return;
      }
      $.ajax({
        url: API_URL + '/tabelas-preco/' + id + '/cobertura',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
      }).done(function (c) {
        var r = c.resumo || {};
        alert(
          'Verificador de Cobertura\n\n' +
          'Linhas sem preço: ' + ((c.linhas_sem_preco || []).length) + '\n' +
          'Produtos sem preço: ' + ((c.produtos_sem_preco || []).length) + '\n' +
          'Linhas sem produtos: ' + ((c.linhas_sem_produtos || []).length) + '\n' +
          'Duplicados: ' + ((c.registros_duplicados || []).length) + '\n' +
          'Refs inválidas: ' + ((c.referencias_invalidas || []).length) + '\n' +
          'Unidades suspeitas: ' + ((c.unidades_inexistentes || []).length) + '\n' +
          'Produtos sem Linha (geral): ' + (c.produtos_sem_linha || 0) + '\n' +
          (r.ok ? '\n✔ Cobertura OK' : ('\n⚠ Alertas: ' + (r.alertas || 0)))
        );
      }).fail(function (err) {
        alert((err.responseJSON && err.responseJSON.erro) || 'Erro na cobertura');
      });
    });

    $('#rcm83-btn-simular').off('click.rcm83').on('click.rcm83', function () {
      window.abrirSimuladorPrecificacao && window.abrirSimuladorPrecificacao($('#tabela-preco-id').val());
    });

    $('#rcm83-btn-historico').off('click.rcm83').on('click.rcm83', function () {
      var id = $('#tabela-preco-id').val();
      if (!id) {
        alert('Salve a tabela para ver o histórico.');
        return;
      }
      $.ajax({
        url: API_URL + '/tabelas-preco/' + id + '/historico',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
      }).done(function (rows) {
        if (!(rows || []).length) {
          alert('Nenhuma alteração registrada ainda.');
          return;
        }
        var txt = (rows || []).slice(0, 20).map(function (h) {
          return (h.created_at || '') + ' | ' + (h.referencia_tipo || '') + ' #' + h.referencia_id +
            ' | ' + (h.preco_anterior != null ? h.preco_anterior : '—') + ' → ' +
            (h.preco_novo != null ? h.preco_novo : '—') +
            (h.usuario ? (' | ' + h.usuario) : '');
        }).join('\n');
        alert('Histórico (últimos 20)\n\n' + txt);
      });
    });

    $('#tabela-preco-canal').off('change.ra6').on('change.ra6', function () {
      _canalId = Number($(this).val()) || null;
    });
  }

  function adicionarLinha(l) {
    var id = Number(l.id);
    if (_linhasGrade.some(function (x) { return x.tipo === 'linha' && Number(x.id) === id; })) return false;
    var clip = window._rcm83ClipboardDup;
    var row = {
      tipo: 'linha',
      id: id,
      codigo: l.codigo,
      descricao: l.descricao,
      forma: null,
      unidade: null,
      preco: 0,
      ativo: true
    };
    if (clip && clip.tipo === 'linha') {
      row.preco = clip.preco;
      row.unidade = clip.unidade;
      row.forma = clip.forma || (clip.unidade ? inferirFormaDaUnidade(clip.unidade) : null);
      row.ativo = clip.ativo !== false;
      window._rcm83ClipboardDup = null;
    }
    _linhasGrade.push(row);
    return true;
  }

  function adicionarProduto(p) {
    var id = Number(p.id);
    if (_linhasGrade.some(function (x) { return x.tipo === 'produto' && Number(x.id) === id; })) return false;
    var clip = window._rcm83ClipboardDup;
    var row = {
      tipo: 'produto',
      id: id,
      codigo: p.codigo || String(p.id),
      descricao: p.nome || p.descricao,
      forma: null,
      unidade: null,
      preco: 0,
      ativo: true
    };
    if (clip && clip.tipo === 'produto') {
      row.preco = clip.preco;
      row.unidade = clip.unidade;
      row.forma = clip.forma || (clip.unidade ? inferirFormaDaUnidade(clip.unidade) : null);
      row.ativo = clip.ativo !== false;
      window._rcm83ClipboardDup = null;
    }
    _linhasGrade.push(row);
    return true;
  }

  /**
   * Inclui de uma vez todas as Linhas de Precificação ativas
   * que ainda não estão na grade (sem sobrescrever preço já informado).
   */
  function inserirTodasLinhas() {
    if (!_linhasCache.length) {
      if (typeof showNotification === 'function') {
        showNotification('Nenhuma Linha de Precificação ativa cadastrada.', 'warning');
      } else {
        alert('Nenhuma Linha de Precificação ativa cadastrada.');
      }
      return;
    }

    var idsNaGrade = {};
    _linhasGrade.forEach(function (l) { idsNaGrade[Number(l.id)] = true; });
    var faltantes = _linhasCache.filter(function (l) {
      return !idsNaGrade[Number(l.id)];
    });

    if (!faltantes.length) {
      if (typeof showNotification === 'function') {
        showNotification('Todas as linhas ativas já estão na grade.', 'info');
      } else {
        alert('Todas as linhas ativas já estão na grade.');
      }
      return;
    }

    var msg = faltantes.length === _linhasCache.length
      ? ('Inserir as ' + faltantes.length + ' Linhas de Precificação ativas nesta tabela?')
      : ('Inserir ' + faltantes.length + ' linha(s) que ainda faltam na grade?');
    if (!window.confirm(msg)) return;

    var inseridas = 0;
    faltantes.forEach(function (l) {
      if (adicionarLinha(l)) inseridas += 1;
    });
    _scrollTop = 0;
    $('#ra6-grade-wrap').scrollTop(0);
    renderGradeVirtual();
    $('#ra6-add-panel').addClass('d-none');

    // confirm() + re-render destroem o foco no Electron — vai para o 1º preço
    focarPrimeiroPrecoGrade();

    if (typeof showNotification === 'function') {
      showNotification(inseridas + ' linha(s) inserida(s) na grade. Informe os preços e salve.', 'success');
      // toast pode roubar foco de novo
      focarPrimeiroPrecoGrade();
    }
  }

  function coletarPayload() {
    var canalId = Number($('#tabela-preco-canal').val());
    if (!canalId) {
      alert('Selecione o Canal da Tabela.');
      return null;
    }
    var codigo = ($('#tabela-preco-codigo').val() || '').trim();
    var nome = ($('#tabela-preco-nome').val() || '').trim();
    if (!codigo || !nome) {
      alert('Código e nome são obrigatórios.');
      return null;
    }

    var valores = [];
    var linhasIds = [];
    var itensProduto = [];
    for (var i = 0; i < _linhasGrade.length; i++) {
      var l = _linhasGrade[i];
      var preco = Number(l.preco);
      if (!Number.isFinite(preco) || preco < 0) {
        alert('Preço inválido em ' + (l.descricao || l.codigo));
        return null;
      }
      var unidade = l.unidade ? String(l.unidade).trim().toUpperCase() : null;
      var forma = unidade
        ? (l.forma || inferirFormaDaUnidade(unidade))
        : (l.forma || null);
      if (l.tipo === 'produto') {
        itensProduto.push({
          produto_id: Number(l.id),
          canal_venda_id: canalId,
          preco: preco,
          forma_comercializacao: forma,
          unidade_comercial: unidade,
          ativo: l.ativo !== false
        });
      } else {
        linhasIds.push(Number(l.id));
        valores.push({
          linha_comercial_id: Number(l.id),
          canal_venda_id: canalId,
          preco: preco,
          forma_comercializacao: forma,
          unidade_comercial: unidade,
          ativo: l.ativo !== false
        });
      }
    }

    return {
      codigo: codigo,
      nome: nome,
      descricao: ($('#tabela-preco-descricao').val() || '').trim(),
      ativo: $('#tabela-preco-ativo').is(':checked'),
      canal_venda_id: canalId,
      atacado_habilitado: $('#ra6-atacado-hab').is(':checked'),
      quantidade_minima: Number($('#ra6-qtd-min').val() || 0),
      tipo_contagem: $('#ra6-tipo-contagem').val() || 'TOTAL_VENDA',
      permitir_produtos_diferentes: $('#ra6-perm-prod').is(':checked'),
      permitir_categorias_diferentes: $('#ra6-perm-cat').is(':checked'),
      linhas_ids: linhasIds,
      valores: valores,
      itens_produto: itensProduto
    };
  }

  function aplicarTabela(t) {
    $('#tabela-preco-id').val(t.id || '');
    $('#tabela-preco-codigo').val(t.codigo || '');
    $('#tabela-preco-nome').val(t.nome || '');
    $('#tabela-preco-descricao').val(t.descricao || '');
    $('#tabela-preco-ativo').prop('checked', !!t.ativo);
    if (t.canal_venda_id) {
      $('#tabela-preco-canal').val(String(t.canal_venda_id));
      _canalId = Number(t.canal_venda_id);
    }
    $('#ra6-atacado-hab').prop('checked', !!t.atacado_habilitado);
    $('#ra6-qtd-min').val(Number(t.quantidade_minima || 0));
    $('#ra6-tipo-contagem').val(String(t.tipo_contagem || 'TOTAL_VENDA').toUpperCase());
    $('#ra6-perm-prod').prop('checked', t.permitir_produtos_diferentes !== false);
    $('#ra6-perm-cat').prop('checked', t.permitir_categorias_diferentes !== false);

    var mapa = {};
    (t.valores || []).forEach(function (v) {
      var lid = Number(v.linha_comercial_id);
      if (!lid) return;
      mapa[lid] = v;
    });
    _linhasGrade = (t.linhas || []).map(function (l) {
      var v = mapa[Number(l.id)] || {};
      return {
        tipo: 'linha',
        id: Number(l.id),
        codigo: l.codigo,
        descricao: l.descricao,
        forma: v.forma_comercializacao || null,
        unidade: v.unidade_comercial || null,
        preco: v.preco != null ? Number(v.preco) : 0,
        ativo: v.ativo !== false && v.ativo !== 0
      };
    });
    Object.keys(mapa).forEach(function (lid) {
      if (_linhasGrade.some(function (x) { return x.tipo === 'linha' && Number(x.id) === Number(lid); })) return;
      var v = mapa[lid];
      _linhasGrade.push({
        tipo: 'linha',
        id: Number(lid),
        codigo: v.linha_codigo || '',
        descricao: v.linha_descricao || ('Linha #' + lid),
        forma: v.forma_comercializacao || null,
        unidade: v.unidade_comercial || null,
        preco: v.preco != null ? Number(v.preco) : 0,
        ativo: v.ativo !== false && v.ativo !== 0
      });
    });
    (t.itens || []).forEach(function (it) {
      var pid = Number(it.produto_id);
      if (!pid) return;
      if (_linhasGrade.some(function (x) { return x.tipo === 'produto' && Number(x.id) === pid; })) return;
      _linhasGrade.push({
        tipo: 'produto',
        id: pid,
        codigo: it.produto_codigo || String(pid),
        descricao: it.produto_nome || ('Produto #' + pid),
        forma: it.forma_comercializacao || null,
        unidade: it.unidade_comercial || null,
        preco: it.preco != null ? Number(it.preco) : 0,
        ativo: it.ativo !== false && it.ativo !== 0
      });
    });
    renderResumo(t.resumo || null);
    if (!t.resumo && t.id) {
      $.ajax({
        url: API_URL + '/tabelas-preco/' + t.id + '/resumo',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
      }).done(function (r) { renderResumo(r); });
    }
    renderGradeVirtual();
  }

  window.abrirModalTabelaPreco = function (opts) {
    opts = opts || {};
    if (typeof ensureModalTabelaPreco === 'function') ensureModalTabelaPreco();

    _modoEdicao = !!opts.id;
    _linhasGrade = [];
    _filtro = '';
    _scrollTop = 0;

    $.when(carregarCanais(), carregarLinhas(), carregarProdutos()).then(function () {
      rebuildModalRa6();
      $('#modal-tabela-preco-titulo').text(opts.id ? 'Central — Editar Tabela' : 'Central — Nova Tabela');
      window._tabelaPrecoOnSalvo = opts.onSalvo || null;

      var modalEl = document.getElementById('modal-tabela-preco');
      var modal = bootstrap.Modal.getOrCreateInstance(modalEl);

      if (opts.id) {
        $.ajax({
          url: API_URL + '/tabelas-preco/' + opts.id,
          method: 'GET',
          headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
        }).done(function (t) {
          aplicarTabela(t || {});
          modal.show();
          if (_linhasGrade.length) {
            var tab = document.querySelector('[data-bs-target="#ra6-tab-precos"]');
            if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
          }
        }).fail(function (err) {
          alert('Erro ao carregar tabela: ' + ((err.responseJSON && err.responseJSON.erro) || err.statusText));
        });
        return;
      }

      $('#tabela-preco-id').val('');
      $('#tabela-preco-codigo').val('');
      $('#tabela-preco-nome').val('');
      $('#tabela-preco-descricao').val('');
      $('#tabela-preco-ativo').prop('checked', true);
      if (_canais[0]) {
        $('#tabela-preco-canal').val(String(_canais[0].id));
        _canalId = Number(_canais[0].id);
      }
      $('#ra6-atacado-hab').prop('checked', false);
      $('#ra6-qtd-min').val(0);
      $('#ra6-tipo-contagem').val('TOTAL_VENDA');
      renderGradeVirtual();
      modal.show();
    });
  };

  window.salvarTabelaPreco = function () {
    var id = $('#tabela-preco-id').val();
    var payload = coletarPayload();
    if (!payload) return;

    if (!id && (!payload.linhas_ids || !payload.linhas_ids.length)) {
      delete payload.linhas_ids;
      delete payload.valores;
    }
    if (!payload.itens_produto || !payload.itens_produto.length) {
      // always send array so backend can clear stale product cells
      payload.itens_produto = payload.itens_produto || [];
    }

    var req = id
      ? $.ajax({
        url: API_URL + '/tabelas-preco/' + id,
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify(payload),
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
      })
      : $.ajax({
        url: API_URL + '/tabelas-preco',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload),
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
      });

    req.done(function (salva) {
      if (typeof showNotification === 'function') {
        showNotification(_modoEdicao ? 'Alterações salvas.' : 'Tabela de Preços salva com sucesso.', 'success');
      } else {
        alert(_modoEdicao ? 'Alterações salvas.' : 'Tabela de Preços salva com sucesso.');
      }
      var modalEl = document.getElementById('modal-tabela-preco');
      var modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
      if (typeof loadTabelasPreco === 'function') loadTabelasPreco();
      if (typeof window._tabelaPrecoOnSalvo === 'function') window._tabelaPrecoOnSalvo(salva);

      if (!id && salva && salva.id && !(salva.linhas || []).length) {
        setTimeout(function () {
          window.abrirModalTabelaPreco({ id: salva.id });
        }, 250);
      }
    }).fail(function (err) {
      alert('Erro ao salvar: ' + ((err.responseJSON && err.responseJSON.erro) || err.statusText));
    });
  };
})();
