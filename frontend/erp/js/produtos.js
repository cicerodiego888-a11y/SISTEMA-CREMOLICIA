function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .normalize('NFC')
        .toLowerCase();
}

// Função utilitária para normalizar produto com categoria e subcategoria
function normalizarProduto(produto, categorias = window.categoriasSistema || []) {
    const categoriaId = String(produto.categoria_id || produto.categoriaId || '');
    const subcategoriaId = String(produto.subcategoria_id || produto.subcategoriaId || '');
    const categoriaObj = categorias.find(c => String(c.id) === categoriaId);
    const subcategoriaObj = categoriaObj && categoriaObj.subcategorias ? categoriaObj.subcategorias.find(s => String(s.id) === subcategoriaId) : null;
    const flagFracionado = Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) ? 1 : 0;
    return {
        ...produto,
        produto_fracionado: flagFracionado,
        categoria: produto.categoria || produto.categoria_nome || (categoriaObj ? categoriaObj.nome : ''),
        subcategoria: produto.subcategoria || produto.subcategoria_nome || (subcategoriaObj ? subcategoriaObj.nome : '')
    };
}

function produtoUsaConversaoUnidades(produto) {
    if (!produto) return false;
    return Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) === 1;
}

/** @deprecated Alias legado — use produtoUsaConversaoUnidades */
function produtoEhFracionado(produto) {
    return produtoUsaConversaoUnidades(produto);
}

const UNIDADES_VENDA_CONVERSAO = new Set(['kg', 'g', 'l', 'ml', 'mt', 'm2', 'm3']);

function unidadeVendaSuportaConversao(unidade) {
    return UNIDADES_VENDA_CONVERSAO.has(String(unidade || '').toLowerCase());
}

function produtoCadastroUsaConversaoUnidades() {
    const forma = ($('input[name="forma_comercializacao"]:checked').val() || '').toUpperCase();
    if (forma === 'PESO' || forma === 'VOLUME') return true;
    return $('#produto_fracionado').is(':checked');
}

function obterFormaComercializacaoSelecionada() {
    return String($('input[name="forma_comercializacao"]:checked').val() || 'UNIDADE').toUpperCase();
}

function sincronizarFlagsLegadasDaForma() {
    const forma = obterFormaComercializacaoSelecionada();
    const fracionado = forma === 'PESO' || forma === 'VOLUME';
    $('#produto_fracionado').prop('checked', fracionado);
    if (forma === 'PESO' && !($('#unidade_venda').val() || '').trim()) {
        $('#unidade_venda').val('KG');
    }
    if (forma === 'VOLUME' && !($('#unidade_venda').val() || '').trim()) {
        $('#unidade_venda').val('L');
    }
}

function atualizarPaineisFormaComercializacao() {
    const forma = obterFormaComercializacaoSelecionada();
    $('#painelFormaPesoVolume').toggleClass('d-none', !(forma === 'PESO' || forma === 'VOLUME'));
    $('#painelFormaCasquinha').toggleClass('d-none', forma !== 'CASQUINHA');
    $('#painelFormaPersonalizada').toggleClass('d-none', forma !== 'PERSONALIZADA');
    sincronizarFlagsLegadasDaForma();
}

function inicializarFormaComercializacaoProduto(produto, isEdit) {
    let forma = 'UNIDADE';
    if (isEdit && produto) {
        forma = String(produto.forma_comercializacao || '').toUpperCase();
        if (!forma || forma === 'UNIDADE') {
            if (produtoEhFracionado(produto)) {
                const u = String(produto.unidade || '').toLowerCase();
                forma = ['l', 'ml'].includes(u) ? 'VOLUME' : 'PESO';
            } else {
                forma = 'UNIDADE';
            }
        }
    }

    $(`input[name="forma_comercializacao"][value="${forma}"]`).prop('checked', true);

    if (produto?.unidade_venda) {
        $('#unidade_venda').val(String(produto.unidade_venda).toUpperCase());
    } else if (forma === 'PESO') {
        $('#unidade_venda').val('KG');
    } else if (forma === 'VOLUME') {
        $('#unidade_venda').val('L');
    }

    $('input[name="forma_comercializacao"]').off('change.rcm043').on('change.rcm043', function () {
        atualizarPaineisFormaComercializacao();
    });

    atualizarPaineisFormaComercializacao();
}

function validarFormaComercializacaoAntesSalvar() {
    const forma = obterFormaComercializacaoSelecionada();
    if (forma === 'PESO' || forma === 'VOLUME') {
        if (!($('#unidade_venda').val() || '').trim()) {
            showNotification('Informe a Unidade de Venda.', 'warning');
            $('#unidade_venda').focus();
            return false;
        }
    }
    if (forma === 'CASQUINHA') {
        const min = parseInt($('#bolas_min').val(), 10);
        const max = parseInt($('#bolas_max').val(), 10);
        if (!Number.isFinite(min) || min < 1) {
            showNotification('Informe a quantidade mínima de bolas (≥ 1).', 'warning');
            $('#bolas_min').focus();
            return false;
        }
        if (!Number.isFinite(max) || max < min) {
            showNotification('A quantidade máxima deve ser ≥ mínima.', 'warning');
            $('#bolas_max').focus();
            return false;
        }
        $('#quantidade_bolas').val(max);
    }
    if (forma === 'PERSONALIZADA') {
        if (!($('#forma_personalizada_nome').val() || '').trim()) {
            showNotification('Informe o Nome da Forma.', 'warning');
            $('#forma_personalizada_nome').focus();
            return false;
        }
        if (!($('#forma_personalizada_unidade').val() || '').trim()) {
            showNotification('Informe a Unidade da Forma Personalizada.', 'warning');
            $('#forma_personalizada_unidade').focus();
            return false;
        }
    }
    return true;
}

function obterStepEstoqueProduto(unidade, usaConversao = false) {
    const unidadeNorm = String(unidade || '').toLowerCase();
    if (usaConversao || unidadeVendaSuportaConversao(unidadeNorm)) {
        return '0.001';
    }
    return '0.01';
}

function formatarCustoUnitarioCadastro(valor, _usaConversao = false) {
    // CP-E1: sempre 2 casas no padrão pt-BR (30,00) — evita confusão com 30,0000 / 30.0000
    const numero = Number(valor || 0);
    if (!Number.isFinite(numero)) return '0,00';
    return numero.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function custoUnitarioVendaCadastro(valor) {
    const numero = Number(valor || 0);
    return Number.isFinite(numero) ? Math.round(numero * 10000) / 10000 : 0;
}

function resolverCustoUnitarioProdutoCadastro(produto = {}) {
    if (!produtoUsaConversaoUnidades(produto)) {
        return custoUnitarioVendaCadastro(produto.preco_compra);
    }

    const pesoTotal = Number(produto.peso_total_compra || 0);
    const valorTotal = Number(produto.valor_total_compra || 0);
    const custoLegado = Number(produto.custo_por_kg || 0);
    const precoCompra = Number(produto.preco_compra || 0);

    let unitarioReferencia = 0;
    if (pesoTotal > 0 && valorTotal > 0) {
        unitarioReferencia = custoUnitarioVendaCadastro(valorTotal / pesoTotal);
    } else if (pesoTotal > 1 && precoCompra > 0) {
        unitarioReferencia = custoUnitarioVendaCadastro(precoCompra / pesoTotal);
    }

    if (custoLegado > 0) {
        const pareceEmbalagem = precoCompra <= 0
            || (valorTotal > 0 && Math.abs(precoCompra - valorTotal) < 0.02)
            || (unitarioReferencia > 0 && precoCompra >= unitarioReferencia * 3);
        if (pareceEmbalagem && custoLegado < precoCompra) {
            return custoUnitarioVendaCadastro(custoLegado);
        }
    }

    if (unitarioReferencia > 0) {
        const pareceEmbalagem = precoCompra <= 0
            || (valorTotal > 0 && Math.abs(precoCompra - valorTotal) < 0.02)
            || precoCompra >= unitarioReferencia * 3;
        if (pareceEmbalagem) {
            return unitarioReferencia;
        }
    }

    return custoUnitarioVendaCadastro(precoCompra);
}

function parseNumeroCadastro(valor) {
    if (valor === null || valor === undefined) return 0;
    let texto = String(valor).trim();
    if (!texto) return 0;
    if (texto.includes(',') && texto.includes('.')) {
        texto = texto.replace(/\./g, '').replace(',', '.');
    } else if (texto.includes(',')) {
        texto = texto.replace(',', '.');
    }
    const numero = parseFloat(texto);
    return Number.isFinite(numero) ? numero : 0;
}

function rotuloUnidadeFormacaoPreco(unidade) {
    const u = String(unidade || 'un').toLowerCase();
    const mapa = {
        un: 'Unidade',
        kg: 'Kg',
        g: 'Grama',
        l: 'Litro',
        ml: 'Mililitro',
        mt: 'Metro',
        m2: 'm²',
        m3: 'm³'
    };
    return mapa[u] || String(unidade || 'Unidade').toUpperCase();
}

/** CP-E1 / CP-2.1 — quando true, nenhum cálculo/validação de custo deve rodar (reset/salvar/fechar). */
window._cpe1SuspenderCalculosProduto = window._cpe1SuspenderCalculosProduto || false;

function cpe1CalculosSuspensos() {
    return !!window._cpe1SuspenderCalculosProduto || !$('#produtoModal').length || !$('#produtoModal').hasClass('show');
}

function aplicarModoConversaoUnidadesCadastro() {
    const $modal = $('#produtoModal');
    if (!$modal.length) return;

    const ativo = produtoCadastroUsaConversaoUnidades();
    const unidade = ($('#unidade').val() || '').toLowerCase();
    const stepEstoque = obterStepEstoqueProduto(unidade, ativo);

    $('#label_unidade_produto').html(
        ativo
            ? 'Unidade do Estoque <span class="text-muted small">· venda</span>'
            : 'Unidade do Estoque'
    );
    $('#label_preco_compra_produto').text('Último Custo');

    // CP-2.1 — Último Custo permanece editável (implantação / sem módulo Compras)
    $('#preco_compra')
        .attr('step', ativo ? '0.0001' : '0.01')
        .prop('readonly', false)
        .removeClass('bg-light');
    $('#saldo_fiscal_inicial, #saldo_nao_fiscal_inicial, #estoque_minimo').attr('step', stepEstoque);

    if (typeof atualizarPreviewEstoqueTotalInicial === 'function') {
        atualizarPreviewEstoqueTotalInicial();
    }

    aplicarModoVendaUnidadeCadastro();
}

function aplicarModoVendaUnidadeCadastro() {
    const fracionado = produtoCadastroUsaConversaoUnidades();
    const permiteUnidade = $('#permite_venda_unidade').is(':checked');

    $('#painelVendaUnidadeCadastro').toggleClass('d-none', !fracionado);
    $('#painelCamposVendaUnidadeCadastro').toggleClass('d-none', !fracionado || !permiteUnidade);

    if (!fracionado) {
        $('#permite_venda_unidade').prop('checked', false);
    }
}

function inicializarVendaUnidadeCadastro(produto, isEdit) {
    const $modal = $('#produtoModal');
    if (!$modal.length) return;

    if (isEdit && produto) {
        $('#permite_venda_unidade').prop('checked', Number(produto.permite_venda_unidade ?? 0) === 1);
        $('#peso_medio_unidade').val(Number(produto.peso_medio_unidade ?? 0) || '');
        $('#preco_unidade').val(Number(produto.preco_unidade ?? 0) || '');
    }

    $modal
        .off('change.vendaUnidadeCadastro')
        .on('change.vendaUnidadeCadastro', '#produto_fracionado, #permite_venda_unidade', aplicarModoVendaUnidadeCadastro);

    aplicarModoVendaUnidadeCadastro();
}

/* ========== RCM-8.7 — Linha de Precificação (picker inteligente) ========== */

function garantirCssLinhaPickerProduto() {
    if (document.getElementById('cds-linha-picker-styles')) return;
    const style = document.createElement('style');
    style.id = 'cds-linha-picker-styles';
    style.textContent = `
      .cds-linha-picker { position: relative; }
      .cds-linha-picker__trigger {
        position: relative; cursor: pointer; background-image: none; padding-right: 2rem;
      }
      .cds-linha-picker__trigger::after {
        content: ''; position: absolute; right: 0.9rem; top: 50%;
        width: 0.45rem; height: 0.45rem;
        border-right: 2px solid #64748b; border-bottom: 2px solid #64748b;
        transform: translateY(-60%) rotate(45deg); pointer-events: none;
      }
      .cds-linha-picker__panel {
        position: absolute; z-index: 1080; left: 0; right: 0; top: calc(100% + 2px);
        max-height: 260px; overflow: auto; background: #fff;
        border: 1px solid #dee2e6; border-radius: 0.375rem;
        box-shadow: 0 0.5rem 1rem rgba(0,0,0,.08);
      }
      .cds-linha-picker__item { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 0.5rem 0.75rem; }
      .cds-linha-picker__item:hover, .cds-linha-picker__item:focus { background: #f1f5f9; }
      .cds-linha-picker__item.is-active { background: #e0f2fe; }
    `;
    document.head.appendChild(style);
}

function formatarDataRcm871(valor) {
    if (!valor) return '—';
    try {
        const d = new Date(valor);
        if (Number.isNaN(d.getTime())) return String(valor);
        return d.toLocaleDateString('pt-BR');
    } catch (_e) {
        return String(valor);
    }
}

function htmlOperacoesRcm871(ops, { clicavel = false } = {}) {
    const lista = Array.isArray(ops) && ops.length
        ? ops
        : [
            { canal: 'VAREJO', label: 'Varejo', com_preco: false },
            { canal: 'ATACADO', label: 'Atacado', com_preco: false },
            { canal: 'CONSIGNADO', label: 'Consignação', com_preco: false },
            { canal: 'DELIVERY', label: 'Delivery', com_preco: false },
            { canal: 'EVENTO', label: 'Evento', com_preco: false }
          ];
    return lista.map((op) => {
        const ok = !!op.com_preco;
        const label = escapeHtml(op.label || op.canal);
        const inner = `${ok ? '✔' : '✖'} ${label}`;
        if (clicavel) {
            return `<button type="button" class="btn btn-link btn-sm p-0 d-block text-start ${ok ? 'text-success' : 'text-danger'}"
                      data-rcm871-op="${escapeHtml(op.canal || '')}">${inner}</button>`;
        }
        return `<div class="small ${ok ? 'text-success' : 'text-danger'}">${inner}</div>`;
    }).join('');
}

function aplicarIndicadorComercialRcm871(codigo) {
    const map = {
        completa: { cls: 'bg-success', txt: '🟢 Linha completa' },
        parcial: { cls: 'bg-warning text-dark', txt: '🟡 Cobertura parcial' },
        fallback: { cls: 'bg-warning text-dark', txt: '🟡 Utilizando Preço de Segurança' },
        sem_preco: { cls: 'bg-danger', txt: '🔴 Produto sem preço' },
        propria: { cls: 'bg-primary', txt: '🔵 Precificação Própria' }
    };
    const m = map[codigo] || { cls: 'bg-secondary', txt: '—' };
    $('#indicadorComercialRcm871').attr('class', `badge ${m.cls} align-self-center`).text(m.txt);
}

function renderPainelLinhaPropriaRcm87() {
    const $painel = $('#painelLinhaInteligenteRcm87');
    if (!$painel.length) return;
    $painel.html(`
      <div class="fw-semibold mb-1">Produto com Precificação Própria</div>
      <div class="small text-muted mb-2">
        Este produto não pertence a nenhuma Linha de Precificação.<br>
        Sua precificação será realizada diretamente pelo Produto na <strong>Central de Precificação</strong>.
      </div>
      <button type="button" class="btn btn-sm btn-outline-primary" id="btnAbrirCentralPropriaRcm871">Abrir Central de Precificação</button>
    `);
}

function renderPainelLinhaSelecionadaRcm87(diag, linhaFallback) {
    const $painel = $('#painelLinhaInteligenteRcm87');
    if (!$painel.length) return;
    const linhaId = diag?.linha?.id || linhaFallback?.id || '';
    const nome = (diag?.linha?.descricao || diag?.linha?.codigo
        || linhaFallback?.descricao || linhaFallback?.codigo || 'Linha').toString();
    const total = Number(diag?.produtos_vinculados ?? 0);
    const deps = diag?.dependencias || {};
    const hist = diag?.historico || {};
    const ultima = formatarDataRcm871(diag?.ultima_alteracao || hist.ultima_alteracao);

    $painel.html(`
      <div class="text-uppercase small text-muted fw-semibold">Linha de Precificação</div>
      <div class="fs-5 mb-2">
        <a href="#" class="link-primary text-decoration-none" id="linkVerLinhaRcm871" data-linha-id="${linhaId}">${escapeHtml(nome)}</a>
      </div>
      <div class="d-flex flex-wrap gap-3 mb-2">
        <div><span class="text-muted small d-block">Produtos nesta Linha</span><strong>${total}</strong></div>
        <div><span class="text-muted small d-block">Tabelas</span><strong>${Number(diag?.tabelas_com_preco ?? diag?.tabelas?.length ?? deps.tabelas ?? 0)}</strong></div>
        <div><span class="text-muted small d-block">Última alteração</span><strong>${escapeHtml(ultima)}</strong></div>
      </div>
      <div class="small text-muted mb-1">Esta Linha possui preços em:</div>
      ${htmlOperacoesRcm871(diag?.operacoes, { clicavel: true })}
      <div class="border-top mt-2 pt-2 small">
        <div class="text-muted mb-1">Esta Linha influencia:</div>
        <strong>${Number(deps.produtos ?? total)}</strong> Produtos ·
        <strong>${Number(deps.tabelas ?? 0)}</strong> Tabelas ·
        <strong>${Number(deps.operacoes ?? 0)}</strong> Operações
        ${Number(deps.representantes || 0) ? ` · <strong>${Number(deps.representantes)}</strong> Representantes` : ''}
      </div>
      <div class="mt-2 d-flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-outline-secondary" id="btnVerLinhaRcm871" data-linha-id="${linhaId}">Ver Linha</button>
        <button type="button" class="btn btn-sm btn-outline-primary" id="btnAbrirCentralDaLinhaRcm871" data-linha-id="${linhaId}">Abrir Central de Precificação</button>
      </div>
    `);
}

function renderPainelOndeVendidoRcm871(operacoes) {
    const $el = $('#painelOndeVendidoRcm871');
    if (!$el.length) return;
    $el.html(`
      <div class="fw-semibold mb-1">Onde este Produto é vendido</div>
      <div class="small text-muted mb-2">Este Produto possui preço em:</div>
      ${htmlOperacoesRcm871(operacoes, { clicavel: true })}
    `);
}

function renderResumoComercialRcm871(ctx = {}) {
    const $el = $('#painelResumoComercialRcm871');
    if (!$el.length) return;
    const grupo = ctx.grupo || ($('#categoria_id option:selected').text() || '—');
    const linhaId = $('#linha_comercial_id').val();
    const linha = ctx.linha || (linhaId ? ($('#linha_comercial_trigger').text() || '—') : 'Produto com Precificação Própria');
    const forma = ctx.forma || ($('input[name="forma_comercializacao"]:checked').val() || 'UNIDADE');
    const formaLabel = ({
        UNIDADE: 'Unidade', PESO: 'Peso', VOLUME: 'Volume',
        CASQUINHA: 'Casquinha', PERSONALIZADA: 'Personalizada'
    })[String(forma).toUpperCase()] || forma;

    $el.html(`
      <div class="fw-semibold mb-2">Resumo Comercial</div>
      <div class="row g-2 small">
        <div class="col-md-6"><span class="text-muted d-block">Grupo</span>
          <a href="#" id="linkResumoGrupoRcm871">${escapeHtml(grupo === 'Carregando...' ? '—' : grupo)}</a></div>
        <div class="col-md-6"><span class="text-muted d-block">Linha</span>
          <a href="#" id="linkResumoLinhaRcm871">${escapeHtml(linha)}</a></div>
        <div class="col-md-6"><span class="text-muted d-block">Forma</span><strong>${escapeHtml(formaLabel)}</strong></div>
        <div class="col-md-6"><span class="text-muted d-block">Preço Oficial</span><strong>Central de Precificação</strong></div>
        <div class="col-md-6"><span class="text-muted d-block">Fallback</span><strong>Preço de Segurança</strong></div>
      </div>
    `);
}

function abrirCentralPrecificacaoRcm871(linhaId) {
    try {
        if (linhaId) sessionStorage.setItem('cds_central_filtro_linha_id', String(linhaId));
        else sessionStorage.removeItem('cds_central_filtro_linha_id');
    } catch (_e) { /* ignore */ }
    if (typeof loadPage === 'function') loadPage('tabelas-preco');
}

function abrirCadastroLinhaRcm871(linhaId) {
    if (!linhaId) return;
    if (typeof loadPage === 'function') {
        try { sessionStorage.setItem('cds_abrir_linha_id', String(linhaId)); } catch (_e) { /* ignore */ }
        loadPage('linhas-comerciais');
    }
}

function abrirGrupoComercialRcm871() {
    const catId = $('#categoria_id').val();
    if (typeof loadPage === 'function') {
        try {
            if (catId) sessionStorage.setItem('cds_abrir_categoria_id', String(catId));
        } catch (_e) { /* ignore */ }
        loadPage('categorias');
    }
}

function carregarPainelLinhaInteligenteRcm87(linhaId, linhaMeta) {
    if (!linhaId) {
        renderPainelLinhaPropriaRcm87();
        renderResumoComercialRcm871({ linha: 'Produto com Precificação Própria' });
        return;
    }
    const $painel = $('#painelLinhaInteligenteRcm87');
    if ($painel.length) $painel.html('<div class="text-muted small">Carregando impacto da Linha...</div>');
    $.ajax({
        url: `${API_URL}/tabelas-preco/linhas/${linhaId}/diagnostico`,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
    }).done((diag) => {
        renderPainelLinhaSelecionadaRcm87(diag, linhaMeta);
        renderResumoComercialRcm871({
            linha: diag?.linha?.descricao || diag?.linha?.codigo || linhaMeta?.descricao
        });
    }).fail(() => {
        renderPainelLinhaSelecionadaRcm87({
            linha: linhaMeta,
            produtos_vinculados: 0,
            tabelas_com_preco: 0,
            operacoes: [],
            dependencias: { produtos: 0, tabelas: 0, operacoes: 0 }
        }, linhaMeta);
    });
}

function carregarPainelProdutoComercialRcm871(produtoId) {
    if (!produtoId) {
        renderPainelOndeVendidoRcm871([]);
        aplicarIndicadorComercialRcm871($('#linha_comercial_id').val() ? 'fallback' : 'propria');
        renderResumoComercialRcm871();
        return;
    }
    $.ajax({
        url: `${API_URL}/tabelas-preco/produtos/${produtoId}/painel`,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
    }).done((painel) => {
        renderPainelOndeVendidoRcm871(painel.operacoes || []);
        aplicarIndicadorComercialRcm871(painel.indicador || 'propria');
        renderResumoComercialRcm871({
            grupo: painel.produto?.categoria,
            linha: painel.produto?.linha
                ? (painel.produto.linha.descricao || painel.produto.linha.codigo)
                : 'Produto com Precificação Própria',
            forma: painel.produto?.forma_comercializacao
        });
    }).fail(() => {
        renderPainelOndeVendidoRcm871([]);
    });
}

function aplicarSelecaoLinhaProduto(linha) {
    const id = linha?.id ? Number(linha.id) : null;
    $('#linha_comercial_id').val(id || '');
    const label = id
        ? `${linha.descricao || linha.codigo || ('#' + id)}`
        : 'Sem linha — Produto com Precificação Própria';
    $('#linha_comercial_trigger').text(label);
    carregarPainelLinhaInteligenteRcm87(id, linha);
    const pid = $('#produtoId').val();
    if (pid) carregarPainelProdutoComercialRcm871(pid);
    else {
        renderPainelOndeVendidoRcm871([]);
        aplicarIndicadorComercialRcm871(id ? 'fallback' : 'propria');
        renderResumoComercialRcm871();
    }
}

function fecharPainelLinhaPicker() {
    $('#linha_comercial_panel').addClass('d-none');
    $('#linha_comercial_trigger').attr('aria-expanded', 'false');
}

function renderListaLinhasPicker(linhas, selecionadoId) {
    const $lista = $('#linha_comercial_lista');
    if (!$lista.length) return;
    const items = [
        { id: null, descricao: 'Sem linha — Produto com Precificação Própria', codigo: '' },
        ...(linhas || [])
    ];
    $lista.html(items.map((l) => {
        const id = l.id != null ? Number(l.id) : null;
        const ativo = (selecionadoId ? Number(selecionadoId) : null) === id
            || (!selecionadoId && id == null);
        const titulo = id == null ? l.descricao : `${l.descricao || l.codigo}`;
        const meta = id == null ? '' : `<div class="small text-muted">${escapeHtml(l.codigo || '')}</div>`;
        return `<button type="button" class="cds-linha-picker__item ${ativo ? 'is-active' : ''}"
                  data-linha-id="${id == null ? '' : id}"
                  data-linha-codigo="${escapeHtml(l.codigo || '')}"
                  data-linha-descricao="${escapeHtml(l.descricao || l.nome || '')}">
                  <strong>${escapeHtml(titulo)}</strong>${meta}
                </button>`;
    }).join(''));
}

function carregarOpcoesLinhaPicker(termo) {
    const q = String(termo || '').trim();
    const url = q
        ? `${API_URL}/linhas-comerciais?ativos=1&q=${encodeURIComponent(q)}`
        : `${API_URL}/linhas-comerciais?ativos=1`;
    return $.ajax({
        url,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
    }).done((rows) => {
        renderListaLinhasPicker(Array.isArray(rows) ? rows : [], $('#linha_comercial_id').val());
    }).fail(() => {
        $('#linha_comercial_lista').html('<div class="p-2 text-danger small">Falha ao carregar Linhas de Precificação.</div>');
    });
}

function abrirCoberturaGeralRcm871() {
    $('#modalCoberturaRcm871').remove();
    const html = `
      <div class="modal fade" id="modalCoberturaRcm871" tabindex="-1">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Verificar Cobertura</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body" id="modalCoberturaRcm871Body">Carregando...</div>
            <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button></div>
          </div>
        </div>
      </div>`;
    $('body').append(html);
    const el = document.getElementById('modalCoberturaRcm871');
    bootstrap.Modal.getOrCreateInstance(el).show();
    $(el).on('hidden.bs.modal', function () { $(this).remove(); });
    $.ajax({
        url: `${API_URL}/tabelas-preco/cobertura`,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
    }).done((res) => {
        $('#modalCoberturaRcm871Body').html(`
          <div class="row g-2">
            <div class="col-md-4"><div class="border rounded p-2"><div class="small text-muted">Produtos sem Linha</div><div class="fs-4">${Number(res.produtos_sem_linha || 0)}</div></div></div>
            <div class="col-md-4"><div class="border rounded p-2"><div class="small text-muted">Produtos sem preço</div><div class="fs-4">${(res.produtos_sem_preco || []).length}</div></div></div>
            <div class="col-md-4"><div class="border rounded p-2"><div class="small text-muted">Usando Fallback</div><div class="fs-4">${Number(res.produtos_usando_preco_seguranca || 0)}</div></div></div>
            <div class="col-md-4"><div class="border rounded p-2"><div class="small text-muted">Linhas sem Produtos</div><div class="fs-4">${(res.linhas_sem_produtos || []).length}</div></div></div>
            <div class="col-md-4"><div class="border rounded p-2"><div class="small text-muted">Linhas sem preço</div><div class="fs-4">${(res.linhas_sem_preco || []).length}</div></div></div>
            <div class="col-md-4"><div class="border rounded p-2"><div class="small text-muted">Operações sem Tabela</div><div class="fs-4">${(res.operacoes_sem_tabela || []).length}</div></div></div>
          </div>
          <div class="small text-muted mt-2">Alertas: <strong>${Number(res.resumo?.alertas || 0)}</strong></div>
        `);
    }).fail((xhr) => {
        $('#modalCoberturaRcm871Body').html(`<div class="text-danger">${escapeHtml(xhr.responseJSON?.erro || 'Falha')}</div>`);
    });
}

function abrirSimularPrecoRcm871(produtoId) {
    $('#modalSimularRcm871').remove();
    const html = `
      <div class="modal fade" id="modalSimularRcm871" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Simular Preço</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
              <div class="row g-2 mb-2">
                <div class="col-md-6"><label class="form-label small">Operação</label>
                  <select class="form-select form-select-sm" id="sim-canal-rcm871">
                    <option value="VAREJO">Varejo</option>
                    <option value="ATACADO">Atacado</option>
                    <option value="CONSIGNADO">Consignação</option>
                    <option value="DELIVERY">Delivery</option>
                    <option value="EVENTO">Evento</option>
                  </select></div>
                <div class="col-md-6"><label class="form-label small">Quantidade</label>
                  <input type="number" min="1" step="1" class="form-control form-control-sm" id="sim-qtd-rcm871" value="1"></div>
                <div class="col-12"><label class="form-label small">Cliente (opcional)</label>
                  <input type="number" class="form-control form-control-sm" id="sim-cliente-rcm871" placeholder="ID do cliente"></div>
              </div>
              <div id="sim-resultado-rcm871" class="border rounded p-3 bg-light">Informe os parâmetros e simule.</div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-primary" id="btnExecSimularRcm871">Simular</button>
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
            </div>
          </div>
        </div>
      </div>`;
    $('body').append(html);
    const el = document.getElementById('modalSimularRcm871');
    bootstrap.Modal.getOrCreateInstance(el).show();
    $(el).on('hidden.bs.modal', function () { $(this).remove(); });
    const run = () => {
        $('#sim-resultado-rcm871').html('<div class="text-muted">Consultando Motor Oficial...</div>');
        const payload = {
            produto_id: Number(produtoId),
            canal: $('#sim-canal-rcm871').val(),
            quantidade: Number($('#sim-qtd-rcm871').val()) || 1
        };
        const cid = $('#sim-cliente-rcm871').val();
        if (cid) payload.cliente_id = Number(cid);
        $.ajax({
            url: `${API_URL}/tabelas-preco/simular`,
            method: 'POST',
            contentType: 'application/json',
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
            data: JSON.stringify(payload)
        }).done((r) => {
            const preco = Number(r.preco_encontrado ?? r.preco ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            $('#sim-resultado-rcm871').html(`
              <div class="small"><span class="text-muted">Tabela</span><div class="fw-semibold">${escapeHtml(r.tabela_utilizada || r.tabela?.nome || '—')}</div></div>
              <div class="small mt-1"><span class="text-muted">Linha</span><div>${r.linha ? escapeHtml(r.linha.descricao || r.linha.codigo) : '<em>Precificação Própria</em>'}</div></div>
              <div class="small mt-1"><span class="text-muted">Produto</span><div>${escapeHtml(r.produto?.nome || '—')}</div></div>
              <div class="small mt-1"><span class="text-muted">Preço</span><div class="fs-4">R$ ${preco}</div></div>
              <div class="small mt-1"><span class="text-muted">Unidade</span><div>${escapeHtml(r.unidade_comercial || '—')}</div></div>
              <div class="small mt-1"><span class="text-muted">Origem</span><div>${escapeHtml(r.origem_label || r.origem || '—')}</div></div>
              <div class="small mt-1"><span class="text-muted">Fallback</span><div>${r.fallback || r.usou_preco_seguranca ? 'Sim (Preço de Segurança)' : 'Não'}</div></div>
            `);
        }).fail((xhr) => {
            $('#sim-resultado-rcm871').html(`<div class="text-danger">${escapeHtml(xhr.responseJSON?.erro || 'Falha')}</div>`);
        });
    };
    $('#btnExecSimularRcm871').on('click', run);
}

function abrirCopiarConfigComercialRcm871() {
    $('#modalCopiarConfigRcm871').remove();
    const html = `
      <div class="modal fade" id="modalCopiarConfigRcm871" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Copiar configuração comercial</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
              <label class="form-label">Produto origem (código ou nome)</label>
              <input type="search" class="form-control mb-2" id="copiar-busca-rcm871" placeholder="Digite para pesquisar...">
              <div id="copiar-lista-rcm871" class="list-group" style="max-height:240px;overflow:auto;"></div>
              <small class="text-muted d-block mt-2">Copia: Grupo, Linha, Forma e Participa do Atacado. Não copia estoque nem fiscal.</small>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button></div>
          </div>
        </div>
      </div>`;
    $('body').append(html);
    const el = document.getElementById('modalCopiarConfigRcm871');
    bootstrap.Modal.getOrCreateInstance(el).show();
    $(el).on('hidden.bs.modal', function () { $(this).remove(); });
    let t = null;
    $('#copiar-busca-rcm871').on('input', function () {
        clearTimeout(t);
        const q = String($(this).val() || '').trim();
        t = setTimeout(() => {
            if (q.length < 1) {
                $('#copiar-lista-rcm871').empty();
                return;
            }
            $.ajax({
                url: `${API_URL}/tabelas-preco/pesquisar-produtos?q=${encodeURIComponent(q)}`,
                method: 'GET',
                headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
            }).done((rows) => {
                $('#copiar-lista-rcm871').html((rows || []).slice(0, 20).map((p) => `
                  <button type="button" class="list-group-item list-group-item-action" data-pid="${p.id}">
                    <strong>${escapeHtml(p.nome || '')}</strong> <span class="text-muted">${escapeHtml(p.codigo || '')}</span>
                  </button>`).join('') || '<div class="text-muted p-2">Nenhum produto</div>');
            });
        }, 200);
    });
    $('#copiar-lista-rcm871').on('click', '[data-pid]', function () {
        const pid = $(this).attr('data-pid');
        $.ajax({
            url: `${API_URL}/produtos/${pid}`,
            method: 'GET',
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
        }).done((p) => {
            if (p.categoria_id) $('#categoria_id').val(String(p.categoria_id)).trigger('change');
            aplicarSelecaoLinhaProduto(p.linha_comercial_id
                ? {
                    id: p.linha_comercial_id,
                    codigo: p.linha_comercial_codigo || '',
                    descricao: p.linha_comercial_descricao || p.linha_comercial_codigo || ''
                  }
                : null);
            const forma = String(p.forma_comercializacao || 'UNIDADE').toUpperCase();
            $(`input[name="forma_comercializacao"][value="${forma}"]`).prop('checked', true).trigger('change');
            $(`input[name="participa_atacado"][value="${Number(p.participa_atacado ?? 1) !== 0 ? '1' : '0'}"]`).prop('checked', true);
            if (typeof showNotification === 'function') {
                showNotification('Configuração comercial copiada.', 'success');
            }
            bootstrap.Modal.getInstance(el)?.hide();
        }).fail(() => {
            if (typeof showNotification === 'function') showNotification('Falha ao carregar produto origem.', 'danger');
        });
    });
}

function inicializarLinhaComercialProduto(produto, isEdit) {
    garantirCssLinhaPickerProduto();
    const linhaInicial = isEdit && produto?.linha_comercial_id
        ? {
            id: produto.linha_comercial_id,
            codigo: produto.linha_comercial_codigo || '',
            descricao: produto.linha_comercial_descricao || produto.linha_comercial_codigo || ('#' + produto.linha_comercial_id)
          }
        : null;
    aplicarSelecaoLinhaProduto(linhaInicial);
    if (isEdit && produto?.id) carregarPainelProdutoComercialRcm871(produto.id);

    $('#linha_comercial_trigger').off('click.rcm87').on('click.rcm87', function (e) {
        e.preventDefault();
        const $panel = $('#linha_comercial_panel');
        const aberto = !$panel.hasClass('d-none');
        if (aberto) {
            fecharPainelLinhaPicker();
            return;
        }
        $panel.removeClass('d-none');
        $(this).attr('aria-expanded', 'true');
        $('#linha_comercial_busca').val('').trigger('focus');
        carregarOpcoesLinhaPicker('');
    });

    let timerBusca = null;
    $('#linha_comercial_busca').off('input.rcm87').on('input.rcm87', function () {
        clearTimeout(timerBusca);
        const termo = $(this).val();
        timerBusca = setTimeout(() => carregarOpcoesLinhaPicker(termo), 200);
    });

    $('#linha_comercial_lista').off('click.rcm87').on('click.rcm87', '.cds-linha-picker__item', function () {
        const id = $(this).attr('data-linha-id');
        aplicarSelecaoLinhaProduto(id
            ? {
                id: Number(id),
                codigo: $(this).attr('data-linha-codigo') || '',
                descricao: $(this).attr('data-linha-descricao') || ''
              }
            : null);
        fecharPainelLinhaPicker();
    });

    $(document).off('click.rcm87LinhaOutside').on('click.rcm87LinhaOutside', function (e) {
        if (!$(e.target).closest('#linha_comercial_picker').length) {
            fecharPainelLinhaPicker();
        }
    });

    const $modal = $('#produtoModal');
    $modal.off('click.rcm871nav').on('click.rcm871nav', '#btnVerLinhaRcm871, #linkVerLinhaRcm871, #linkResumoLinhaRcm871', function (e) {
        e.preventDefault();
        const lid = $(this).attr('data-linha-id') || $('#linha_comercial_id').val();
        if (lid) abrirCadastroLinhaRcm871(lid);
    });
    $modal.on('click.rcm871nav', '#btnAbrirCentralDaLinhaRcm871, #btnAbrirCentralLinhaRcm871, #btnAbrirCentralPropriaRcm871', function (e) {
        e.preventDefault();
        const lid = $(this).attr('data-linha-id') || $('#linha_comercial_id').val() || null;
        abrirCentralPrecificacaoRcm871(lid || null);
    });
    $modal.on('click.rcm871nav', '#btnAbrirGrupoComercialRcm871, #linkResumoGrupoRcm871', function (e) {
        e.preventDefault();
        abrirGrupoComercialRcm871();
    });
    $modal.on('click.rcm871nav', '[data-rcm871-op]', function (e) {
        e.preventDefault();
        const canal = $(this).attr('data-rcm871-op');
        try { sessionStorage.setItem('cds_central_filtro_canal', String(canal || '')); } catch (_e) { /* ignore */ }
        abrirCentralPrecificacaoRcm871($('#linha_comercial_id').val() || null);
    });

    $('#btnAnalisarProdutoRcm87').off('click.rcm87').on('click.rcm87', function () {
        const pid = $('#produtoId').val() || produto?.id;
        if (pid) abrirAnaliseProdutoRcm87(pid);
    });
    $('#btnVerificarCoberturaRcm871').off('click.rcm871').on('click.rcm871', abrirCoberturaGeralRcm871);
    $('#btnSimularPrecoRcm871').off('click.rcm871').on('click.rcm871', function () {
        const pid = $('#produtoId').val() || produto?.id;
        if (pid) abrirSimularPrecoRcm871(pid);
    });
    $('#btnCopiarConfigComercialRcm871').off('click.rcm871').on('click.rcm871', abrirCopiarConfigComercialRcm871);
    $('#btnSugerirLinhaRcm871').off('click.rcm871').on('click.rcm871', function () {
        if (typeof showNotification === 'function') {
            showNotification('Sugestão de Linha de Precificação estará disponível em breve (IA Comercial).', 'info');
        } else {
            alert('Sugestão de Linha estará disponível em breve.');
        }
    });

    $('input[name="forma_comercializacao"]').off('change.rcm871resumo').on('change.rcm871resumo', function () {
        renderResumoComercialRcm871();
    });
    $('#categoria_id').off('change.rcm871resumo').on('change.rcm871resumo', function () {
        renderResumoComercialRcm871();
    });
}

function abrirAnaliseProdutoRcm87(produtoId, canal) {
    const canalSel = canal || 'VAREJO';
    $('#modalAnaliseProdutoRcm87').remove();
    const html = `
      <div class="modal fade" id="modalAnaliseProdutoRcm87" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Auditoria Comercial</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div class="mb-2">
                <label class="form-label small">Operação / Canal</label>
                <select class="form-select form-select-sm" id="analise-canal-rcm87">
                  <option value="VAREJO">Varejo</option>
                  <option value="ATACADO">Atacado</option>
                  <option value="CONSIGNADO">Consignação</option>
                  <option value="DELIVERY">Delivery</option>
                  <option value="EVENTO">Evento</option>
                </select>
              </div>
              <div id="analise-produto-resultado" class="border rounded p-3 bg-light">Carregando...</div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
            </div>
          </div>
        </div>
      </div>`;
    $('body').append(html);
    const $modal = $('#modalAnaliseProdutoRcm87');
    const carregar = () => {
        const c = $('#analise-canal-rcm87').val() || 'VAREJO';
        $('#analise-produto-resultado').html('<div class="text-muted">Consultando Motor Oficial...</div>');
        $.ajax({
            url: `${API_URL}/tabelas-preco/simular`,
            method: 'POST',
            contentType: 'application/json',
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
            data: JSON.stringify({ produto_id: Number(produtoId), canal: c, quantidade: 1 })
        }).done((r) => {
            const preco = Number(r.preco_encontrado ?? r.preco ?? 0);
            const precoFmt = preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            $('#analise-produto-resultado').html(`
              <div class="mb-2"><span class="text-muted small">Produto</span><div class="fw-semibold">${escapeHtml(r.produto?.nome || '—')}</div></div>
              <div class="mb-2"><span class="text-muted small">Linha de Precificação</span><div>${r.linha ? escapeHtml(r.linha.descricao || r.linha.codigo) : '<em>Produto com Precificação Própria</em>'}</div></div>
              <div class="mb-2"><span class="text-muted small">Tabela</span><div>${escapeHtml(r.tabela_utilizada || r.tabela?.nome || r.tabela?.codigo || '—')}</div></div>
              <div class="mb-2"><span class="text-muted small">Operação</span><div>${escapeHtml(r.canal || c)}</div></div>
              <div class="mb-2"><span class="text-muted small">Preço</span><div class="fs-4">R$ ${precoFmt}</div></div>
              <div class="mb-2"><span class="text-muted small">Unidade</span><div>${escapeHtml(r.unidade_comercial || '—')}</div></div>
              <div class="mb-2"><span class="text-muted small">Origem</span><div>${escapeHtml(r.origem_label || r.origem || '—')}</div></div>
              <div class="mb-2"><span class="text-muted small">Motor Oficial</span><div>${escapeHtml(r.motor || 'Motor Oficial de Precificação')}</div></div>
              <div class="mb-2"><span class="text-muted small">Resolver</span><div>${escapeHtml(r.resolver || 'Motor Oficial')}</div></div>
              <div><span class="text-muted small">Fallback</span><div>${r.fallback || r.usou_preco_seguranca ? 'Sim (Preço de Segurança)' : 'Não'}</div></div>
            `);
        }).fail((xhr) => {
            $('#analise-produto-resultado').html(
                `<div class="text-danger">${escapeHtml(xhr.responseJSON?.erro || 'Falha ao analisar produto')}</div>`
            );
        });
    };
    $('#analise-canal-rcm87').val(canalSel).off('change.rcm87').on('change.rcm87', carregar);
    bootstrap.Modal.getOrCreateInstance($modal[0]).show();
    carregar();
    $modal.on('hidden.bs.modal', function () { $(this).remove(); });
}
window.abrirAnaliseProdutoRcm87 = abrirAnaliseProdutoRcm87;
window.abrirCentralPrecificacaoRcm871 = abrirCentralPrecificacaoRcm871;

function inicializarMotorConversaoUnidadesCadastro() {
    const $modal = $('#produtoModal');
    if (!$modal.length) return;

    $modal
        .off('change.motorConversaoUnidades input.motorConversaoUnidades')
        .on(
            'change.motorConversaoUnidades input.motorConversaoUnidades',
            '#produto_fracionado, #unidade, #saldo_fiscal_inicial, #saldo_nao_fiscal_inicial',
            function onMotorConversaoCadastro() {
                if (cpe1CalculosSuspensos()) return;
                if ($(this).is('#saldo_fiscal_inicial, #saldo_nao_fiscal_inicial')) {
                    if (typeof atualizarPreviewEstoqueTotalInicial === 'function') {
                        atualizarPreviewEstoqueTotalInicial();
                    }
                    return;
                }
                if ($(this).is('#produto_fracionado, #unidade')) {
                    aplicarModoConversaoUnidadesCadastro();
                }
            }
        );

    aplicarModoConversaoUnidadesCadastro();
}
// Função global para minimizar modais Bootstrap
window.minimizarModal = function(modalId) {
    const $modal = $('#' + modalId);
    if ($modal.length) {
        $modal.modal('hide');
        // Adiciona botão flutuante para restaurar
        if ($('#btn-restaurar-' + modalId).length === 0) {
            const $btn = $('<button id="btn-restaurar-' + modalId + '" class="btn btn-primary position-fixed" style="bottom: 24px; right: 24px; z-index: 2000; box-shadow: 0 2px 8px #0002;">Restaurar Produto</button>');
            $btn.on('click', function() {
                $modal.modal('show');
                // Atualiza categorias e subcategorias ao restaurar
                if (typeof inicializarCategoriasESubcategorias === 'function') {
                    // Pega os dados já preenchidos
                    const produto = {
                        id: $('#produtoId').val(),
                        codigo: $('#codigo').val(),
                        nome: $('#nome').val(),
                        categoria_id: $('#categoria_id').val(),
                        subcategoria_id: $('#subcategoria_id').val(),
                        unidade: $('#unidade').val(),
                        preco_compra: $('#preco_compra').val(),
                        preco_venda: $('#preco_venda').val(),
                        estoque_atual: $('#estoque_atual').val(),
                        estoque_minimo: $('#estoque_minimo').val(),
                        fornecedor: $('#fornecedor').val()
                    };
                    inicializarCategoriasESubcategorias(produto, !!produto.id);
                }
                $(this).remove();
            });
            $('body').append($btn);
        }
    }
};
// =========================
// MÓDULO DE PRODUTOS
// =========================

// Carrega página de produtos
function loadProdutos() {
    const modoFiscal = typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0';

    $.ajax({
        url: `${API_URL}/produtos?modo_fiscal=${modoFiscal}`,
        method: 'GET',
        success: function (produtos) {
            window.produtosList = produtos || [];
            renderProdutos(window.produtosList);
        },
        error: function () {
            $('#page-content').html('<div class="alert alert-danger">Erro ao carregar produtos!</div>');
        }
    });
}
window.loadProdutos = loadProdutos;

function obterQuantidadeEstoqueProduto(p) {
    if (typeof obterEstoqueDisponivelProduto === 'function') {
        return obterEstoqueDisponivelProduto(p);
    }
    return Number(p?.estoque_atual || 0);
}

function tituloColunaEstoqueLista() {
    if (typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo()) {
        return 'Estoque Fiscal';
    }
    return 'Estoque';
}

function formatarEstoqueDetalheProduto(produto) {
    const unidade = produto.unidade || '';
    const opcoesFormato = { produtoFracionado: produtoUsaConversaoUnidades(produto) };

    if (typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo()) {
        const fiscal = Number(produto.saldo_fiscal ?? 0);
        return `<p><strong>Estoque Fiscal:</strong> ${formatarEstoqueProduto(fiscal, unidade, opcoesFormato)}</p>`;
    }

    const fiscal = Number(produto.saldo_fiscal ?? 0);
    const naoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
    const total = Number(produto.estoque_atual ?? (fiscal + naoFiscal));

    return `
        <p><strong>Estoque Fiscal:</strong> ${formatarEstoqueProduto(fiscal, unidade, opcoesFormato)}</p>
        <p><strong>Estoque Não Fiscal:</strong> ${formatarEstoqueProduto(naoFiscal, unidade, opcoesFormato)}</p>
        <p><strong>Estoque Total:</strong> ${formatarEstoqueProduto(total, unidade, opcoesFormato)}</p>
    `;
}


function resolverItemFiscalParaSalvar(saldosIniciais) {
    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();
    if (modoFiscal) return 1;
    if (Number(saldosIniciais.saldo_nao_fiscal_inicial) > 0 && Number(saldosIniciais.saldo_fiscal_inicial) === 0) {
        return 0;
    }
    return 1;
}

function obterSaldosIniciaisDoFormulario() {
    if ($('#saldo_fiscal_inicial').length) {
        const fiscal = parseFloat($('#saldo_fiscal_inicial').val()) || 0;
        const naoFiscal = parseFloat($('#saldo_nao_fiscal_inicial').val()) || 0;
        return {
            saldo_fiscal_inicial: fiscal,
            saldo_nao_fiscal_inicial: naoFiscal,
            estoque_total: fiscal + naoFiscal
        };
    }

    const legado = parseFloat($('#estoque_atual').val()) || 0;
    return {
        saldo_fiscal_inicial: legado,
        saldo_nao_fiscal_inicial: 0,
        estoque_total: legado
    };
}

/** UX-PROD-03.1 — Campos de implantação (infraestrutura de bloqueio futuro) */
const CAMPOS_IMPLANTACAO_PRODUTO = Object.freeze([
    'saldo_fiscal_inicial',
    'saldo_nao_fiscal_inicial',
    'peso_fisico_inicial_fiscal',
    'peso_fisico_inicial_nao_fiscal',
    'data_validade_inicial',
    'dias_alerta_validade'
]);

function avaliarFaseCadastroProduto(isEdit, temMovimentacoes) {
    const operacao = Boolean(isEdit && temMovimentacoes);
    return {
        fase: operacao ? 'OPERACAO' : 'IMPLANTACAO',
        label: operacao ? 'Operação' : 'Implantação',
        temMovimentacoes: Boolean(temMovimentacoes),
        camposImplantacaoSomenteLeitura: operacao,
        campos: CAMPOS_IMPLANTACAO_PRODUTO
    };
}

/**
 * UX-PROD-03.1 — prepara metadados/UI do bloqueio de implantação.
 * A lógica definitiva de travar todos os campos permanece no roadmap;
 * saldos iniciais já respeitam somente leitura após a 1ª movimentação.
 */
function prepararBloqueioImplantacaoProduto(meta) {
    const $modal = $('#produtoModal');
    if (!$modal.length) return meta;
    $modal.attr('data-fase-cadastro', meta.fase);
    $modal.data('faseCadastro', meta);
    $modal.find('[data-campo-implantacao="1"]').each(function () {
        if (meta.camposImplantacaoSomenteLeitura) {
            $(this).prop('readonly', true).addClass('bg-light');
            if ($(this).is('input[type="number"], input[type="date"]')) {
                $(this).attr('title', 'Fase Operação: implantação somente leitura. Use Ajuste de Estoque.');
            }
        }
    });
    return meta;
}

function montarHtmlCamposEstoqueProduto(produto, isEdit, opcoes = {}) {
    const temMovimentacoes = Boolean(opcoes.temMovimentacoes ?? produto?.tem_movimentacoes);
    const faseMeta = avaliarFaseCadastroProduto(isEdit, temMovimentacoes);
    const permiteEditarSaldos = !faseMeta.camposImplantacaoSomenteLeitura;
    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();
    const saldoFiscal = Number(produto?.saldo_fiscal ?? 0);
    const saldoNaoFiscal = Number(produto?.saldo_nao_fiscal ?? 0);
    const estoqueTotal = Number(produto?.estoque_atual ?? (saldoFiscal + saldoNaoFiscal));
    const unidade = produto?.unidade || '';
    const usaConversao = produtoEhFracionado(produto);
    const stepEstoque = obterStepEstoqueProduto(unidade, usaConversao);
    const usaFisica = Number(produto?.utiliza_conversao_fisica || 0) === 1
        || ($('#utiliza_conversao_fisica').length ? $('#utiliza_conversao_fisica').is(':checked') : false);
    const unidadeFisica = (produto?.unidade_conversao_fisica
        || ($('#unidade_conversao_fisica').val() || '')
        || 'KG').toUpperCase();
    const mostrarFisicaInicial = usaFisica && permiteEditarSaldos && estoqueTotal > 0;

    const bannerFase = permiteEditarSaldos
        ? `<div class="col-12 mb-3" id="bannerFaseCadastroProduto" data-fase="IMPLANTACAO">
             <div class="alert alert-info py-2 mb-0 border-0">
               <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
                 <strong><i class="fas fa-seedling me-1"></i> Fase 1 — Implantação</strong>
                 <span class="badge bg-info text-dark">Sem movimentações</span>
               </div>
               <small class="d-block mt-1">
                 Informe a quantidade inicial (e o peso do estoque, se o produto for pesado na entrada).
                 Após a primeira movimentação, estes campos ficam <strong>somente leitura</strong>.
               </small>
             </div>
           </div>`
        : `<div class="col-12 mb-3" id="bannerFaseCadastroProduto" data-fase="OPERACAO">
             <div class="alert alert-secondary py-2 mb-0 border-0">
               <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
                 <strong><i class="fas fa-lock me-1"></i> Fase 2 — Operação</strong>
                 <span class="badge bg-secondary">Implantação bloqueada</span>
               </div>
               <small class="d-block mt-1">
                 Após a implantação, alterações de estoque devem ser realizadas pelo módulo
                 <strong>Ajuste de Estoque</strong> (ou Inventário / Compra).
               </small>
             </div>
           </div>`;

    const blocoFisicaInicial = permiteEditarSaldos ? `
        <div class="col-12 mb-3 ${mostrarFisicaInicial ? '' : 'd-none'}" id="blocoConversaoFisicaInicial">
            <div class="border rounded p-3 bg-primary bg-opacity-10 border-primary border-opacity-25">
                <strong class="d-block mb-1">
                  Peso atual do estoque
                </strong>
                <small class="text-muted d-block mb-2">
                    Informe o peso correspondente à quantidade inicial
                    (unidade: <strong>${escapeHtml(unidadeFisica)}</strong>).
                    O peso real da operação continua sendo informado na Entrada da Compra.
                    <em class="d-block mt-1">(Preparação visual — persistência do lote inicial em sprint futura.)</em>
                </small>
                ${modoFiscal ? `
                    <div class="row g-2">
                        <div class="col-md-6">
                            <label class="form-label" for="peso_fisico_inicial_fiscal">Peso físico Fiscal — ${escapeHtml(unidadeFisica)}</label>
                            <input type="number" step="0.001" min="0" class="form-control" id="peso_fisico_inicial_fiscal"
                                data-campo-implantacao="1"
                                placeholder="Ex.: 6,750" disabled title="Persistência em sprint futura">
                        </div>
                    </div>
                ` : `
                    <div class="row g-2">
                        <div class="col-md-6">
                            <label class="form-label" for="peso_fisico_inicial_fiscal">Peso físico Fiscal — ${escapeHtml(unidadeFisica)}</label>
                            <input type="number" step="0.001" min="0" class="form-control" id="peso_fisico_inicial_fiscal"
                                data-campo-implantacao="1"
                                placeholder="Ex.: 6,750" disabled title="Persistência em sprint futura">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="peso_fisico_inicial_nao_fiscal">Peso físico Não Fiscal — ${escapeHtml(unidadeFisica)}</label>
                            <input type="number" step="0.001" min="0" class="form-control" id="peso_fisico_inicial_nao_fiscal"
                                data-campo-implantacao="1"
                                placeholder="Opcional" disabled title="Persistência em sprint futura">
                        </div>
                    </div>
                `}
            </div>
        </div>
    ` : '';

    if (permiteEditarSaldos) {
        if (modoFiscal) {
            return `
                ${bannerFase}
                <div class="col-md-6 mb-3">
                    <label for="saldo_fiscal_inicial" class="form-label">Quantidade Inicial Fiscal</label>
                    <input
                        type="number"
                        step="${stepEstoque}"
                        min="0"
                        class="form-control"
                        id="saldo_fiscal_inicial"
                        data-campo-implantacao="1"
                        value="${isEdit ? saldoFiscal : 0}"
                    >
                    <input type="hidden" id="saldo_nao_fiscal_inicial" data-campo-implantacao="1" value="${isEdit ? saldoNaoFiscal : 0}">
                </div>
                ${blocoFisicaInicial}
            `;
        }

        return `
            ${bannerFase}
            <div class="col-md-4 mb-3">
                <label for="saldo_fiscal_inicial" class="form-label">Quantidade Inicial Fiscal</label>
                <input
                    type="number"
                    step="${stepEstoque}"
                    min="0"
                    class="form-control"
                    id="saldo_fiscal_inicial"
                    data-campo-implantacao="1"
                    value="${isEdit ? saldoFiscal : 0}"
                >
            </div>
            <div class="col-md-4 mb-3">
                <label for="saldo_nao_fiscal_inicial" class="form-label">Quantidade Inicial Não Fiscal</label>
                <input
                    type="number"
                    step="${stepEstoque}"
                    min="0"
                    class="form-control"
                    id="saldo_nao_fiscal_inicial"
                    data-campo-implantacao="1"
                    value="${isEdit ? saldoNaoFiscal : 0}"
                >
            </div>
            <div class="col-md-4 mb-3">
                <label class="form-label">Estoque Total</label>
                <input
                    type="text"
                    class="form-control bg-light"
                    id="estoque_total_inicial_preview"
                    readonly
                    value="${formatarEstoqueProduto(estoqueTotal, unidade, { produtoFracionado: usaConversao })}"
                >
            </div>
            ${blocoFisicaInicial}
        `;
    }

    const avisoAjuste = `
        <div class="col-12 mb-2">
          <small class="text-muted">
            Após a implantação, alterações de estoque devem ser realizadas pelo módulo
            <strong>Ajuste de Estoque</strong>${podeAjustarEstoque() ? ' (botão na lista de produtos)' : ''}.
          </small>
        </div>`;

    if (modoFiscal) {
        return `
            ${bannerFase}
            ${avisoAjuste}
            <div class="col-md-6 mb-3">
                <label class="form-label">Estoque Fiscal <span class="badge bg-secondary">somente leitura</span></label>
                <input
                    type="text"
                    class="form-control bg-light"
                    readonly
                    data-campo-implantacao="1"
                    value="${formatarEstoqueProduto(saldoFiscal, unidade, { produtoFracionado: usaConversao })}"
                >
            </div>
        `;
    }

    return `
        ${bannerFase}
        ${avisoAjuste}
        <div class="col-md-4 mb-3">
            <label class="form-label">Estoque Fiscal <span class="badge bg-secondary">somente leitura</span></label>
            <input
                type="text"
                class="form-control bg-light"
                readonly
                data-campo-implantacao="1"
                value="${formatarEstoqueProduto(saldoFiscal, unidade, { produtoFracionado: usaConversao })}"
            >
        </div>
        <div class="col-md-4 mb-3">
            <label class="form-label">Estoque Não Fiscal <span class="badge bg-secondary">somente leitura</span></label>
            <input
                type="text"
                class="form-control bg-light"
                readonly
                data-campo-implantacao="1"
                value="${formatarEstoqueProduto(saldoNaoFiscal, unidade, { produtoFracionado: usaConversao })}"
            >
        </div>
        <div class="col-md-4 mb-3">
            <label class="form-label">Estoque Total</label>
            <input
                type="text"
                class="form-control bg-light"
                readonly
                value="${formatarEstoqueProduto(estoqueTotal, unidade, { produtoFracionado: usaConversao })}"
            >
        </div>
    `;
}

function atualizarCamposEstoqueModalProduto() {
    const $modal = $('#produtoModal');
    if (!$modal.length || !$modal.hasClass('show')) {
        return;
    }

    const $area = $('#areaCamposEstoqueProduto');
    if (!$area.length) {
        return;
    }

    const saldosForm = obterSaldosIniciaisDoFormulario();
    const isEdit = Boolean($('#produtoId').val());
    const temMovimentacoes = $modal.data('temMovimentacoes') === true;
    const saldosArmazenados = $modal.data('produtoSaldos') || {};

    const produto = {
        unidade: $('#unidade').val() || '',
        tem_movimentacoes: temMovimentacoes,
        saldo_fiscal: temMovimentacoes && isEdit
            ? Number(saldosArmazenados.saldo_fiscal ?? 0)
            : saldosForm.saldo_fiscal_inicial,
        saldo_nao_fiscal: temMovimentacoes && isEdit
            ? Number(saldosArmazenados.saldo_nao_fiscal ?? 0)
            : saldosForm.saldo_nao_fiscal_inicial,
        estoque_atual: temMovimentacoes && isEdit
            ? Number(saldosArmazenados.estoque_atual ?? 0)
            : saldosForm.estoque_total
    };

    $area.html(montarHtmlCamposEstoqueProduto(produto, isEdit, { temMovimentacoes }));
    prepararBloqueioImplantacaoProduto(avaliarFaseCadastroProduto(isEdit, temMovimentacoes));

    const permiteEditarSaldos = !isEdit || !temMovimentacoes;
    if (permiteEditarSaldos) {
        $('#saldo_fiscal_inicial').val(saldosForm.saldo_fiscal_inicial);
        const $naoFiscal = $('#saldo_nao_fiscal_inicial');
        if ($naoFiscal.length && $naoFiscal.attr('type') !== 'hidden') {
            $naoFiscal.val(saldosForm.saldo_nao_fiscal_inicial);
        }
    }

    inicializarPreviewEstoqueTotalInicial();
}
window.atualizarCamposEstoqueModalProduto = atualizarCamposEstoqueModalProduto;

function obterEstoqueTotalExibicaoCadastro() {
    if ($('#saldo_fiscal_inicial').length || $('#estoque_atual').length) {
        return Number(obterSaldosIniciaisDoFormulario().estoque_total || 0);
    }

    const saldos = $('#produtoModal').data('produtoSaldos') || {};
    const totalInformado = Number(saldos.estoque_total);
    if (!Number.isNaN(totalInformado)) {
        return totalInformado;
    }

    return Number(saldos.saldo_fiscal || 0) + Number(saldos.saldo_nao_fiscal || 0);
}

function atualizarPreviewValorTotalEstoqueCadastro() {
    const $compra = $('#valor_total_compra_preview');
    const $venda = $('#valor_total_venda_preview');
    if (!$compra.length && !$venda.length) {
        return;
    }

    const estoqueTotal = obterEstoqueTotalExibicaoCadastro();
    const numero = (valor) => parseFloat(String(valor ?? '').replace(',', '.')) || 0;
    const precoCompra = numero($('#preco_compra').val());
    const precoVenda = numero($('#preco_venda').val());

    if ($compra.length) {
        $compra.val(formatCurrency(estoqueTotal * precoCompra));
    }
    if ($venda.length) {
        $venda.val(formatCurrency(estoqueTotal * precoVenda));
    }
}

function atualizarPreviewEstoqueTotalInicial() {
    const $preview = $('#estoque_total_inicial_preview');
    if ($preview.length) {
        const saldos = obterSaldosIniciaisDoFormulario();
        const unidade = $('#unidade').val() || 'un';
        const opcoesFormato = { produtoFracionado: produtoCadastroUsaConversaoUnidades() };
        $preview.val(formatarEstoqueProduto(saldos.estoque_total, unidade, opcoesFormato));
    }

    if (!cpe1CalculosSuspensos()) {
        atualizarPreviewValorTotalEstoqueCadastro();
    }
}

function inicializarPreviewEstoqueTotalInicial() {
    const $modal = $('#produtoModal');
    if (!$modal.length) {
        return;
    }

    $modal.off('input.previewEstoqueTotal change.previewEstoqueTotal')
        .on(
            'input.previewEstoqueTotal change.previewEstoqueTotal',
            '#saldo_fiscal_inicial, #saldo_nao_fiscal_inicial, #unidade, #produto_fracionado, #preco_compra, #preco_venda',
            atualizarPreviewEstoqueTotalInicial
        );

    atualizarPreviewEstoqueTotalInicial();
}
window.inicializarPreviewEstoqueTotalInicial = inicializarPreviewEstoqueTotalInicial;

function formatarEstoqueExibicaoTela(produto) {
    const unidade = produto?.unidade || '';
    const valor = typeof obterEstoqueExibicaoSimplesProduto === 'function'
        ? obterEstoqueExibicaoSimplesProduto(produto)
        : Number(produto?.estoque_atual || 0);
    return formatarEstoqueProduto(valor, unidade, { produtoFracionado: produtoUsaConversaoUnidades(produto) });
}

function formatarColunaEstoqueLista(p) {
    const unidade = p.unidade || '';
    const opcoesFormato = { produtoFracionado: produtoUsaConversaoUnidades(p) };

    if (typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo()) {
        return formatarEstoqueProduto(Number(p.saldo_fiscal ?? 0), unidade, opcoesFormato);
    }

    const fiscal = Number(p.saldo_fiscal ?? 0);
    const naoFiscal = Number(p.saldo_nao_fiscal ?? 0);
    const total = Number(p.estoque_atual ?? (fiscal + naoFiscal));

    return `
        <div class="small">Fiscal: ${formatarEstoqueProduto(fiscal, unidade, opcoesFormato)}</div>
        <div class="small">Não Fiscal: ${formatarEstoqueProduto(naoFiscal, unidade, opcoesFormato)}</div>
        <div class="fw-semibold">Total: ${formatarEstoqueProduto(total, unidade, opcoesFormato)}</div>
    `;
}

const RELATORIO_PRODUTOS_FILTROS = {
    todos: 'Todos os produtos',
    estoque_baixo: 'Estoque baixo',
    proximo_minimo: 'Próximo do mínimo',
    vencidos: 'Vencidos',
    proximo_vencimento: 'Próximos do vencimento'
};

function showRelatorioEstoqueProdutos() {
    carregarRelatorioEstoqueProdutos('todos');
}

function obterTipoFiltroRelatorioAtual() {
    const modal = document.getElementById('relatorio-estoque-modal');
    if (modal) {
        return modal.getAttribute('data-tipo-filtro') || 'todos';
    }
    return $('#relatorio-tipo-filtro').val() || 'todos';
}

function aplicarFiltroRelatorioProdutos() {
    const tipoFiltro = $('#relatorio-tipo-filtro').val() || 'todos';
    const inicio = $('#relatorio-data-inicio').val() || '';
    const fim = $('#relatorio-data-fim').val() || '';
    carregarRelatorioEstoqueProdutos(tipoFiltro, inicio, fim);
}

function classificarEstoqueProduto(p) {
    const atual = obterQuantidadeEstoqueProduto(p);
    const minimo = Number(p.estoque_minimo || 0);
    if (minimo <= 0) return 'ok';
    if (atual <= minimo) return 'estoque_baixo';
    if (atual <= Math.ceil(minimo * 1.2)) return 'proximo_minimo';
    return 'ok';
}

function classificarValidadeProduto(p) {
    if (Number(p.controlar_validade || 0) !== 1 || !p.data_validade) {
        return 'nao_controla';
    }
    if (p.status_validade === 'vencido') return 'vencido';
    if (p.status_validade === 'proximo') return 'proximo_vencimento';
    return 'ok_validade';
}

function obterStatusVisualProduto(p) {
    const estoque = classificarEstoqueProduto(p);
    const validade = classificarValidadeProduto(p);
    const critico = estoque === 'estoque_baixo' || validade === 'vencido';
    const alerta = estoque === 'proximo_minimo' || validade === 'proximo_vencimento';

    if (critico) return { nivel: 'critico', estoque, validade };
    if (alerta) return { nivel: 'alerta', estoque, validade };
    return { nivel: 'ok', estoque, validade };
}

function classesLinhaStatusProduto(status) {
    if (status.nivel === 'critico') {
        return { row: 'table-danger', text: 'text-danger', estoque: 'text-danger fw-bold' };
    }
    if (status.nivel === 'alerta') {
        return { row: 'table-warning', text: 'text-warning-emphasis', estoque: 'text-warning-emphasis fw-bold' };
    }
    return { row: '', text: '', estoque: '' };
}

function montarBadgesStatusProduto(p) {
    const status = obterStatusVisualProduto(p);
    const badges = [];

    if (status.estoque === 'estoque_baixo') {
        badges.push('<span class="badge bg-danger ms-1">Estoque baixo</span>');
    } else if (status.estoque === 'proximo_minimo') {
        badges.push('<span class="badge bg-warning text-dark ms-1">Próximo do mínimo</span>');
    }

    if (status.validade === 'vencido') {
        badges.push('<span class="badge bg-danger ms-1">Vencido</span>');
    } else if (status.validade === 'proximo_vencimento') {
        const dias = Number(p.dias_para_vencer ?? 0);
        badges.push(`<span class="badge bg-warning text-dark ms-1">Vence em ${dias} dia(s)</span>`);
    }

    return badges.join('');
}

const classificarEstoqueRelatorio = classificarEstoqueProduto;
const classificarValidadeRelatorio = classificarValidadeProduto;

function filtrarProdutosRelatorio(produtos, tipoFiltro) {
    const lista = Array.isArray(produtos) ? produtos : [];

    switch (tipoFiltro) {
        case 'estoque_baixo':
            return lista.filter((p) => classificarEstoqueRelatorio(p) === 'estoque_baixo');
        case 'proximo_minimo':
            return lista.filter((p) => classificarEstoqueRelatorio(p) === 'proximo_minimo');
        case 'vencidos':
            return lista.filter((p) => {
                return classificarValidadeRelatorio(p) === 'vencido' && obterQuantidadeEstoqueProduto(p) > 0;
            });
        case 'proximo_vencimento':
            return lista.filter((p) => {
                return classificarValidadeRelatorio(p) === 'proximo_vencimento' && obterQuantidadeEstoqueProduto(p) > 0;
            });
        case 'todos':
        default:
            return lista;
    }
}

function montarBadgesStatusRelatorio(p) {
    const badges = [];
    const estoque = classificarEstoqueRelatorio(p);

    if (estoque === 'estoque_baixo') {
        badges.push('<span class="badge bg-danger">Estoque baixo</span>');
    } else if (estoque === 'proximo_minimo') {
        badges.push('<span class="badge bg-warning text-dark">Próximo do mínimo</span>');
    }

    const validade = classificarValidadeRelatorio(p);
    if (validade === 'vencido') {
        badges.push('<span class="badge bg-danger">Vencido</span>');
    } else if (validade === 'proximo_vencimento') {
        const dias = Number(p.dias_para_vencer ?? 0);
        badges.push(`<span class="badge bg-warning text-dark">Vence em ${dias} dia(s)</span>`);
    }

    if (!badges.length) {
        badges.push('<span class="badge bg-secondary">OK</span>');
    }

    return badges.join(' ');
}

function formatarValidadeRelatorio(valor) {
    if (!valor) return '-';
    const data = new Date(`${valor}T00:00:00`);
    return Number.isNaN(data.getTime()) ? valor : data.toLocaleDateString('pt-BR');
}

function montarOptionsFiltroRelatorio(tipoAtual) {
    return Object.entries(RELATORIO_PRODUTOS_FILTROS)
        .map(([valor, label]) => {
            const selected = valor === tipoAtual ? 'selected' : '';
            return `<option value="${valor}" ${selected}>${label}</option>`;
        })
        .join('');
}

function parseRelatorioData(valor) {
    if (!valor) return null;
    const data = new Date(`${valor}T00:00:00`);
    return Number.isNaN(data.getTime()) ? null : data;
}

function isRelatorioDataDentroDoIntervalo(dataString, inicio, fim) {
    if (!dataString) return false;

    const data = new Date(dataString);
    if (Number.isNaN(data.getTime())) return false;

    if (inicio && data < inicio) return false;

    if (fim) {
        const fimDoDia = new Date(fim.getTime());
        fimDoDia.setHours(23, 59, 59, 999);
        if (data > fimDoDia) return false;
    }

    return true;
}

function formatarUltimaCompraRelatorio(valor) {
    if (!valor) return '-';
    return formatDate(valor);
}

function printRelatorioEstoqueProdutos() {
    const $modal = $('#relatorio-estoque-modal');
    if (!$modal.length) return;

    const title = 'Relatório de Estoque';
    const bodyHtml = $modal.find('.modal-body').html();
    const css = `
        <style>
            body { font-family: Arial, sans-serif; color: #222; padding: 20px; }
            h1 { font-size: 20px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
            th { background: #f8f9fa; }
            tr.table-danger td { background-color: #f8d7da; }
            tr.table-warning td { background-color: #fff3cd; }
            .badge { display: inline-block; padding: 0.35em 0.65em; border-radius: 0.35rem; }
            .badge.bg-danger { background-color: #dc3545; color: white; }
            .badge.bg-warning { background-color: #ffc107; color: #212529; }
            .badge.bg-secondary { background-color: #6c757d; color: white; }
            .no-print { display: none !important; }
        </style>
    `;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>${title}</title>
                ${css}
            </head>
            <body>
                <h1>${title}</h1>
                ${bodyHtml}
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

function carregarRelatorioEstoqueProdutos(tipoFiltro = 'todos', filtroInicio = '', filtroFim = '') {
    const params = new URLSearchParams();
    const modoFiscal = typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0';
    params.append('modo_fiscal', modoFiscal);

    if (filtroInicio) params.append('inicio', filtroInicio);
    if (filtroFim) params.append('fim', filtroFim);

    $.ajax({
        url: `${API_URL}/produtos/relatorio-estoque?${params.toString()}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function(produtos) {
            renderRelatorioEstoqueProdutos(produtos || [], tipoFiltro, filtroInicio, filtroFim);
        },
        error: function(xhr) {
            const erro = xhr.responseJSON?.error || 'Erro ao carregar relatório de estoque.';
            showNotification(erro, 'danger');
        }
    });
}

function renderRelatorioEstoqueProdutos(produtos, tipoFiltro = 'todos', filtroInicio = '', filtroFim = '') {
    produtos = Array.isArray(produtos) ? produtos : [];
    const inicio = parseRelatorioData(filtroInicio);
    const fim = parseRelatorioData(filtroFim);

    let produtosFiltrados = produtos;

    if (inicio || fim) {
        produtosFiltrados = produtos.filter(p => isRelatorioDataDentroDoIntervalo(p.ultima_compra_data, inicio, fim));
    }

    const produtosExibidos = filtrarProdutosRelatorio(produtosFiltrados, tipoFiltro);

    const valorTotalFiscal = produtosExibidos.reduce((sum, p) => {
        const qtd = obterQuantidadeEstoqueProduto(p);
        return sum + (qtd * Number(p.preco_compra || 0));
    }, 0);

    const tituloModo = RELATORIO_PRODUTOS_FILTROS[tipoFiltro] || 'Todos os produtos';

    const filtroLegenda = `Exibindo ${produtosExibidos.length} produto(s) de ${produtosFiltrados.length} no período.`;

    const filtroDatasTexto = (inicio || fim)
        ? `Filtro aplicado pela data da última compra: ${filtroInicio || 'início não informado'} até ${filtroFim || 'fim não informado'}.`
        : 'Nenhum filtro de data aplicado.';

    const modalHtml = `
        <div class="modal fade" id="relatorio-estoque-modal" tabindex="-1" data-tipo-filtro="${tipoFiltro}">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Relatório de Estoque</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row g-3 mb-3 no-print">
                            <div class="col-md-4">
                                <label class="form-label">Tipo de filtro</label>
                                <select id="relatorio-tipo-filtro" class="form-select">
                                    ${montarOptionsFiltroRelatorio(tipoFiltro)}
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Data início (última compra)</label>
                                <input type="date" id="relatorio-data-inicio" class="form-control" value="${filtroInicio || ''}">
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Data fim (última compra)</label>
                                <input type="date" id="relatorio-data-fim" class="form-control" value="${filtroFim || ''}">
                            </div>
                            <div class="col-md-2 d-flex align-items-end gap-2 flex-wrap">
                                <button type="button" class="btn btn-primary w-100" onclick="aplicarFiltroRelatorioProdutos()">
                                    Aplicar
                                </button>
                            </div>
                            <div class="col-12 d-flex gap-2 flex-wrap">
                                <button type="button" class="btn btn-outline-secondary btn-sm" onclick="carregarRelatorioEstoqueProdutos($('#relatorio-tipo-filtro').val() || 'todos')">
                                    Limpar datas
                                </button>
                                <button type="button" class="btn btn-success btn-sm" onclick="printRelatorioEstoqueProdutos()">
                                    Imprimir relatório
                                </button>
                            </div>
                        </div>

                        <div class="mb-3">
                            <strong>${tituloModo}</strong>
                            <div class="text-muted">${filtroLegenda}</div>
                            <div class="text-muted">${filtroDatasTexto}</div>
                            <div class="text-muted">Valor fiscal total exibido: ${formatCurrency(valorTotalFiscal)}</div>
                        </div>

                        <div class="table-responsive">
                            <table class="table table-striped table-hover">
                                <thead>
                                    <tr>
                                        <th>Produto</th>
                                        <th>Categoria</th>
                                        <th>${tituloColunaEstoqueLista()}</th>
                                        <th>Mínimo</th>
                                        <th>Lote</th>
                                        <th>Validade</th>
                                        <th>Última compra</th>
                                        <th>Total em estoque</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${produtosExibidos.length === 0 ? `
                                        <tr>
                                            <td colspan="9" class="text-center">
                                                Nenhum produto encontrado para o filtro selecionado.
                                            </td>
                                        </tr>
                                    ` : produtosExibidos.map(p => {
                                        const estoqueAtual = obterQuantidadeEstoqueProduto(p);
                                        const estoqueMinimo = Number(p.estoque_minimo || 0);
                                        const precoCompra = Number(p.preco_compra || 0);
                                        const totalItem = estoqueAtual * precoCompra;
                                        const classes = classesLinhaStatusProduto(obterStatusVisualProduto(p));

                                        return `
                                            <tr class="${classes.row}">
                                                <td class="${classes.text}">${escapeHtml(p.nome || '-')}</td>
                                                <td>${escapeHtml(p.categoria || '-')}</td>
                                                <td>${formatarColunaEstoqueLista(p)}</td>
                                                <td>${estoqueMinimo}</td>
                                                <td>${escapeHtml(p.lote || '-')}</td>
                                                <td>${formatarValidadeRelatorio(p.data_validade)}</td>
                                                <td>${formatarUltimaCompraRelatorio(p.ultima_compra_data)}</td>
                                                <td>${formatCurrency(totalItem)}</td>
                                                <td>${montarBadgesStatusRelatorio(p)}</td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="modal-footer no-print">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    const modalEl = document.getElementById('relatorio-estoque-modal');
    const modal = new bootstrap.Modal(modalEl);

    modalEl.addEventListener('hidden.bs.modal', function () {
        modal.dispose();
        $('#relatorio-estoque-modal').remove();
        $('.modal-backdrop').remove();
    });

    modal.show();
}


function montarOptionsFiltroCategorias(produtos) {
    const mapa = new Map();

    (produtos || []).forEach(p => {
        const id = String(p.categoria_id || '');
        const nome = p.categoria || p.categoria_nome || '';

        if (id && nome) {
            mapa.set(id, nome);
        }
    });

    return Array.from(mapa.entries())
        .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
        .map(([id, nome]) => `<option value="${id}">${escapeHtml(nome)}</option>`)
        .join('');
}

function produtoEstaAtivo(p) {
    return Number(p?.ativo ?? 1) !== 0;
}

function obterFiltroStatusProduto() {
    return String($('#filtroStatusProduto').val() || 'todos');
}

function produtoBateFiltroStatus(p, filtroStatus = obterFiltroStatusProduto()) {
    const ativo = produtoEstaAtivo(p);
    if (filtroStatus === 'ativos') return ativo;
    if (filtroStatus === 'inativos') return !ativo;
    return true;
}

function aplicarFiltrosProdutos(produtos) {
    const termo = normalizarTexto($('#buscaProduto').val()).trim();
    const categoriaId = String($('#filtroCategoriaProduto').val() || '');
    const filtroStatus = obterFiltroStatusProduto();
    const base = (produtos || []).filter((p) => produtoBateFiltroStatus(p, filtroStatus));

    // Se houver termo de busca ou filtro de categoria, mostrar tabela normal
    if (termo || categoriaId) {
        $('#categorias-container').hide();
        $('#tabela-produtos-container').show();

        const filtrados = base.filter(p => {
            const bateBusca =
                !termo ||
                (p.nome && normalizarTexto(p.nome).includes(termo)) ||
                (p.codigo && normalizarTexto(p.codigo).includes(termo)) ||
                (p.categoria && normalizarTexto(p.categoria).includes(termo)) ||
                (p.fornecedor && normalizarTexto(p.fornecedor).includes(termo));

            const bateCategoria =
                !categoriaId || String(p.categoria_id || '') === categoriaId;

            return bateBusca && bateCategoria;
        });

        $('#produtos-tbody').html(renderProdutosAgrupados(filtrados));
    } else {
        // Se não houver filtro, mostrar categorias
        $('#categorias-container').show();
        $('#tabela-produtos-container').hide();
        carregarCategoriasProdutos();
    }
}

function produtoComEstoqueBaixo(p) {
    return classificarEstoqueProduto(p) === 'estoque_baixo';
}

function produtoProximoMinimo(p) {
    return classificarEstoqueProduto(p) === 'proximo_minimo';
}

function renderProdutoRow(p) {
    const ativo = produtoEstaAtivo(p);
    const status = obterStatusVisualProduto(p);
    const classes = ativo
        ? classesLinhaStatusProduto(status)
        : { row: 'table-secondary produto-linha-desabilitada', text: 'text-muted', estoque: 'text-muted' };
    const badges = montarBadgesStatusProduto(p);
    const badgeDesabilitado = ativo
        ? ''
        : '<span class="badge bg-secondary ms-1">Desabilitado</span>';
    const rowStyle = ativo ? '' : 'opacity:0.62; filter:grayscale(0.35);';
    const nomeStyle = ativo ? '' : 'text-decoration:line-through;';

    return `
        <tr class="${classes.row}" style="${rowStyle}" data-produto-id="${p.id}" data-produto-ativo="${ativo ? 1 : 0}">
            <td class="${classes.text} fw-semibold" style="${nomeStyle}">
                ${escapeHtml(p.nome || '')}
                ${badgeDesabilitado}
            </td>
            <td>${escapeHtml(p.codigo || '')}</td>
            <td>${escapeHtml(p.categoria || p.categoria_nome || '')}</td>
            <td>${escapeHtml(p.unidade || '')}</td>
            <td>${formatCurrency(p.preco_compra || 0)}</td>
            <td>${formatCurrency(p.preco_venda || 0)}</td>
            <td class="${classes.estoque}">
                ${formatarColunaEstoqueLista(p)}
                ${badges}
            </td>
            <td class="text-nowrap">
                <button class="btn btn-sm btn-info" onclick="viewProduto(${p.id})" title="Visualizar">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn btn-sm btn-warning" onclick="editProduto(${p.id})" title="Editar" ${ativo ? '' : 'disabled'}>
                    <i class="fas fa-edit"></i>
                </button>
                ${podeAjustarEstoque() ? `
                <button class="btn btn-sm btn-success" onclick="abrirModalAjustarEstoque(${p.id})" title="Ajustar Estoque" ${ativo ? '' : 'disabled'}>
                    <i class="fas fa-boxes"></i>
                </button>
                ` : ''}
                <button class="btn btn-sm btn-danger" onclick="deleteProduto(${p.id})" title="Excluir" ${ativo ? '' : 'disabled'}>
                    <i class="fas fa-trash"></i>
                </button>
                <button class="btn btn-sm btn-secondary" onclick="historicoProduto(${p.id})" title="Histórico">
                    <i class="fas fa-history"></i>
                </button>
                ${ativo ? `
                <button class="btn btn-sm btn-dark" onclick="desabilitarProduto(${p.id})" title="Desabilitar produto e linha">
                    <i class="fas fa-ban"></i>
                </button>
                ` : `
                <button class="btn btn-sm btn-outline-success" onclick="habilitarProduto(${p.id})" title="Reabilitar produto">
                    <i class="fas fa-check"></i>
                </button>
                `}
            </td>
        </tr>
    `;
}

function renderProdutosAgrupados(produtos) {
    if (!produtos || produtos.length === 0) {
        return `
            <tr>
                <td colspan="8" class="text-center text-muted py-4">
                    Nenhum produto encontrado.
                </td>
            </tr>
        `;
    }

    const grupos = {};

    produtos.forEach(produto => {
        const categoria = produto.categoria || produto.categoria_nome || 'SEM CATEGORIA';
        const subcategoria = produto.subcategoria || produto.subcategoria_nome || 'SEM SUBCATEGORIA';

        if (!grupos[categoria]) {
            grupos[categoria] = {};
        }

        if (!grupos[categoria][subcategoria]) {
            grupos[categoria][subcategoria] = [];
        }

        grupos[categoria][subcategoria].push(produto);
    });

    let html = '';

    Object.keys(grupos)
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .forEach(categoria => {
            html += `
                <tr class="table-dark">
                    <td colspan="8" style="font-weight: bold; font-size: 15px;">
                        ${escapeHtml(categoria.toUpperCase())}
                    </td>
                </tr>
            `;

            Object.keys(grupos[categoria])
                .sort((a, b) => a.localeCompare(b, 'pt-BR'))
                .forEach(subcategoria => {
                    html += `
                        <tr class="table-secondary">
                            <td colspan="8" style="font-weight: bold; padding-left: 25px;">
                                ${escapeHtml(subcategoria)}
                            </td>
                        </tr>
                    `;

                    grupos[categoria][subcategoria]
                        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'))
                        .forEach(produto => {
                            html += renderProdutoRow(produto);
                        });
                });
        });

    return html;
}

function gerarRelatorioEstoque() {
    showRelatorioEstoqueProdutos();
}

// Renderiza listagem de produtos
function renderProdutos(produtos) {
    window.produtosCache = produtos;
    window.produtosOriginais = produtos;
    const filtroStatusAtual = String(
        window._filtroStatusProdutoPreferido ||
        ($('#filtroStatusProduto').length ? $('#filtroStatusProduto').val() : '') ||
        'todos'
    );
    const html = `
        <div class="row mb-3 g-3">
            <div class="col-md-6 col-lg-4">
                <div class="card mb-0 border-danger h-100" id="cardEstoqueBaixoProdutos">
                    <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2 bg-danger bg-opacity-10">
                        <strong class="text-danger"><i class="fas fa-exclamation-triangle me-2"></i>Alertas de estoque</strong>
                        <button type="button" class="btn btn-sm btn-outline-danger" onclick="carregarEstoqueBaixoProdutos()">
                            <i class="fas fa-sync-alt"></i> Atualizar
                        </button>
                    </div>
                    <div class="card-body" id="listaEstoqueBaixoProdutos">
                        <div class="text-muted">Carregando...</div>
                    </div>
                </div>
            </div>
            <div class="col-md-6 col-lg-4">
                <div class="card-dashboard card-vencimentos h-100" id="cardVencimentosProdutos">
                    <div class="card-icon">⏰</div>
                    <div class="card-info">
                        <h3>Vencimentos</h3>
                        <p>
                            <strong id="qtdProdutosVencidos">0</strong> vencidos |
                            <strong id="qtdProdutosProximos">0</strong> próximos
                        </p>
                        <button type="button" class="btn btn-warning btn-sm" onclick="abrirModalVencimentosProdutos()">
                            Ver produtos
                        </button>
                    </div>
                </div>
            </div>
            <div class="col-md-6 col-lg-4">
                <div class="card-dashboard card-promocoes h-100" id="cardPromocoesProdutos">
                    <div class="card-icon">🎯</div>
                    <div class="card-info">
                        <h3>Promoções Inteligentes</h3>
                        <p>
                            <strong id="qtdSugestoesProdutos">0</strong> sugestões |
                            <strong id="qtdPromocoesProdutos">0</strong> ativas
                        </p>
                        <button type="button" class="btn btn-info btn-sm" onclick="abrirModalPromocoesProdutos()">
                            Ver Sugestões
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header">
                <div class="row align-items-center">
                    <div class="col-md-6">
                        <i class="fas fa-box"></i> Lista de Produtos
                    </div>
                    <div class="col-md-8 d-flex justify-content-end align-items-center gap-2 flex-wrap">
                        <button class="btn btn-secondary btn-sm" onclick="gerarRelatorioEstoque()">
                            <i class="fas fa-list"></i> Relatório de estoque
                        </button>

                        <button class="btn btn-primary btn-sm" onclick="showProdutoModal()">
                            <i class="fas fa-plus"></i> Novo Produto
                        </button>

                        <select
                            class="form-select form-select-sm"
                            id="filtroCategoriaProduto"
                            style="width: 200px;"
                        >
                            <option value="">Todas as categorias</option>
                            ${montarOptionsFiltroCategorias(produtos)}
                        </select>

                        <select
                            class="form-select form-select-sm"
                            id="filtroStatusProduto"
                            style="width: 160px;"
                            title="Filtrar por status do produto"
                        >
                            <option value="todos"${filtroStatusAtual === 'todos' ? ' selected' : ''}>Todos</option>
                            <option value="ativos"${filtroStatusAtual === 'ativos' ? ' selected' : ''}>Ativos</option>
                            <option value="inativos"${filtroStatusAtual === 'inativos' ? ' selected' : ''}>Desabilitados</option>
                        </select>

                        <input
                            type="text"
                            class="form-control form-control-sm"
                            id="buscaProduto"
                            placeholder="Buscar produto..."
                            style="width: 200px;"
                        >
                    </div>
                </div>
            </div>

            <div class="card-body">
                <div class="alert alert-info py-2 mb-3">
                    <i class="fas fa-info-circle me-2"></i>
                    Clique em uma categoria para ver os produtos. Use a busca acima para pesquisar em todos os produtos.
                    O botão <i class="fas fa-ban"></i> na categoria desabilita ela por completo (todos os produtos deixam de vender e de gerar estoque).
                    O mesmo ícone na linha do produto desabilita só aquele item.
                </div>
                <div class="d-flex flex-wrap gap-3 mb-3 small">
                    <span><span class="d-inline-block rounded px-2 py-1 bg-warning">&nbsp;</span> Amarelo: próximo do mínimo ou do vencimento</span>
                    <span><span class="d-inline-block rounded px-2 py-1 bg-danger">&nbsp;</span> Vermelho: estoque no mínimo ou abaixo / vencido</span>
                    <span><span class="d-inline-block rounded px-2 py-1 bg-secondary">&nbsp;</span> Cinza: produto/categoria desabilitado</span>
                </div>
                <div id="categorias-container">
                    ${renderCategoriasProdutos(produtos)}
                </div>
                <div class="table-responsive" id="tabela-produtos-container" style="display: none;">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>Código</th>
                                <th>Categoria</th>
                                <th>Unidade</th>
                                <th>Preço Compra</th>
                                <th>Preço de Segurança</th>
                                <th>${tituloColunaEstoqueLista()}</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody id="produtos-tbody">
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    $('#page-content').html(html);

    $('#buscaProduto, #filtroCategoriaProduto, #filtroStatusProduto').on('input change', function () {
        if (this.id === 'filtroStatusProduto') {
            window._filtroStatusProdutoPreferido = String($(this).val() || 'todos');
        }
        aplicarFiltrosProdutos(produtos);
    });

    // Carregar categorias inicialmente
    carregarCategoriasProdutos();
    inicializarCardEstoqueBaixo();
    inicializarModalVencimentosProdutos();
    carregarVencimentosProdutos();
    carregarDashboardPromocoes();
}

function renderCategoriasProdutos(produtos) {
    if (!produtos || produtos.length === 0) {
        return '<div class="alert alert-warning">Nenhum produto encontrado.</div>';
    }

    // Extrair categorias únicas dos produtos
    const categoriasMap = new Map();
    produtos.forEach(p => {
        const catId = p.categoria_id || '';
        const catNome = p.categoria || p.categoria_nome || 'Sem Categoria';
        if (!categoriasMap.has(catId)) {
            categoriasMap.set(catId, { id: catId, nome: catNome, count: 0 });
        }
        categoriasMap.get(catId).count++;
    });

    const categorias = Array.from(categoriasMap.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    return categorias.map(cat => `
        <div class="card mb-2 categoria-card" data-categoria-id="${cat.id}">
            <div class="card-header bg-light d-flex justify-content-between align-items-center" style="cursor: pointer;" onclick="toggleProdutosCategoriaMenu('${cat.id}', '${escapeHtml(cat.nome)}')">
                <strong><i class="fas fa-folder me-2"></i>${escapeHtml(cat.nome)}</strong>
                <span class="badge bg-primary">${cat.count}</span>
            </div>
            <div class="card-body p-0" id="produtos-categoria-${cat.id}" style="display: none;">
                <div class="text-center py-3">
                    <div class="spinner-border spinner-border-sm text-primary"></div>
                </div>
            </div>
        </div>
    `).join('');
}

function carregarCategoriasProdutos() {
    $('#categorias-container').html(`
        <div class="text-center py-4">
            <div class="spinner-border text-primary"></div>
            <div class="mt-2">Carregando categorias...</div>
        </div>
    `);

    $.ajax({
        url: `${API_URL}/categorias?tipo=produto`,
        method: 'GET',
        success: function(categorias) {
            if (!categorias || categorias.length === 0) {
                $('#categorias-container').html(`
                    <div class="alert alert-warning">
                        Nenhuma categoria encontrada.
                    </div>
                `);
                return;
            }

            const filtroStatus = obterFiltroStatusProduto();

            // Contar produtos por categoria (respeita filtro Ativos/Desabilitados/Todos)
            // Mantém categorias desabilitadas visíveis para permitir reabilitar
            const categoriasComContagem = categorias.map(cat => {
                const todosProdutosCategoria = (window.produtosCache || []).filter(
                    (p) => String(p.categoria_id) === String(cat.id)
                );
                const produtosCategoria = todosProdutosCategoria.filter((p) =>
                    produtoBateFiltroStatus(p, filtroStatus)
                );
                const count = produtosCategoria.length;
                const countTotal = todosProdutosCategoria.length;
                const countBaixo = produtosCategoria.filter((p) => produtoEstaAtivo(p) && produtoComEstoqueBaixo(p)).length;
                const countProximo = produtosCategoria.filter((p) => produtoEstaAtivo(p) && produtoProximoMinimo(p)).length;
                const countDesabilitados = todosProdutosCategoria.filter((p) => !produtoEstaAtivo(p)).length;
                return { ...cat, count, countTotal, countBaixo, countProximo, countDesabilitados };
            }).filter(cat => cat.countTotal > 0);

            const html = categoriasComContagem.map(cat => {
                const categoriaAtiva = Number(cat.ativo ?? 1) !== 0;
                const nomeEscapado = String(cat.nome || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const headerClass = categoriaAtiva ? 'bg-light' : 'bg-secondary bg-opacity-25';
                const cardClass = categoriaAtiva ? '' : 'opacity-75 border-secondary';

                return `
                <div class="card mb-2 categoria-card ${cardClass}" data-categoria-id="${cat.id}" data-categoria-ativa="${categoriaAtiva ? 1 : 0}">
                    <div class="card-header ${headerClass} d-flex justify-content-between align-items-center" style="cursor: pointer;" onclick="toggleProdutosCategoriaMenu(${cat.id}, '${nomeEscapado}')">
                        <strong class="${categoriaAtiva ? '' : 'text-muted'}" style="${categoriaAtiva ? '' : 'text-decoration:line-through;'}">
                            <i class="fas fa-folder me-2"></i>${escapeHtml(cat.nome)}
                            ${categoriaAtiva ? '' : '<span class="badge bg-secondary ms-2">Desabilitada</span>'}
                        </strong>
                        <span class="d-flex align-items-center gap-1 flex-wrap justify-content-end" onclick="event.stopPropagation();">
                            <span class="badge bg-primary">${cat.count}</span>
                            ${cat.countProximo > 0 ? `<span class="badge bg-warning text-dark" title="Próximo do estoque mínimo">${cat.countProximo} próx.</span>` : ''}
                            ${cat.countBaixo > 0 ? `<span class="badge bg-danger" title="Estoque no mínimo ou abaixo">${cat.countBaixo} baixo</span>` : ''}
                            ${cat.countDesabilitados > 0 ? `<span class="badge bg-secondary" title="Produtos desabilitados">${cat.countDesabilitados} off</span>` : ''}
                            ${categoriaAtiva ? `
                            <button type="button" class="btn btn-sm btn-dark ms-1" title="Desabilitar categoria e todos os produtos" onclick="desabilitarCategoriaProdutos(${cat.id}, '${nomeEscapado}')">
                                <i class="fas fa-ban"></i>
                            </button>
                            ` : `
                            <button type="button" class="btn btn-sm btn-outline-success ms-1" title="Reabilitar categoria e todos os produtos" onclick="habilitarCategoriaProdutos(${cat.id}, '${nomeEscapado}')">
                                <i class="fas fa-check"></i>
                            </button>
                            `}
                        </span>
                    </div>
                    <div class="card-body p-0" id="produtos-categoria-${cat.id}" style="display: none;">
                        <div class="text-center py-3">
                            <div class="spinner-border spinner-border-sm text-primary"></div>
                        </div>
                    </div>
                </div>
            `;
            }).join('');

            $('#categorias-container').html(html);
        },
        error: function() {
            $('#categorias-container').html(`
                <div class="alert alert-danger">
                    Erro ao carregar categorias.
                </div>
            `);
        }
    });
}

function toggleProdutosCategoriaMenu(categoriaId, categoriaNome) {
    const container = $(`#produtos-categoria-${categoriaId}`);

    if (container.is(':visible')) {
        container.slideUp();
    } else {
        // Sempre remontar a tabela para refletir status ativo/desabilitado e filtros
        const filtroStatus = obterFiltroStatusProduto();
        const produtosCategoria = (window.produtosCache || []).filter(
            (p) => String(p.categoria_id) === String(categoriaId) && produtoBateFiltroStatus(p, filtroStatus)
        );

        if (!produtosCategoria || produtosCategoria.length === 0) {
            container.html(`
                <div class="p-3 text-muted">
                    Nenhum produto nesta categoria${filtroStatus === 'todos' ? '' : ' para o filtro selecionado'}.
                </div>
            `);
        } else {
            const tabelaHtml = `
                <div class="table-responsive">
                    <table class="table table-striped table-hover mb-0">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>Código</th>
                                <th>Categoria</th>
                                <th>Unidade</th>
                                <th>Preço Compra</th>
                                <th>Preço de Segurança</th>
                                <th>${tituloColunaEstoqueLista()}</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${produtosCategoria.map(p => renderProdutoRow(p)).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            container.html(tabelaHtml);
        }

        container.slideDown();
    }
}

function renderProdutosRows(produtos) {
    if (!produtos || produtos.length === 0) {
        return '<tr><td colspan="8" class="text-center">Nenhum produto cadastrado</td></tr>';
    }

    return produtos.map((p) => renderProdutoRow(p)).join('');
}


/** UX-MASTER-01 — código automático (somente UI; payload inalterado) */
function gerarCodigoProdutoAutomatico() {
    const list = Array.isArray(window.produtosList) ? window.produtosList : [];
    let max = 0;
    list.forEach((p) => {
        const n = parseInt(String(p?.codigo || '').replace(/\D/g, ''), 10);
        if (Number.isFinite(n) && n > max) max = n;
    });
    return String(max + 1).padStart(4, '0');
}

function sugerirUnidadeFisicaPorCategoria() {
    const catId = $('#categoria_id').val();
    const cat = (window.categoriasSistema || []).find((c) => String(c.id) === String(catId));
    const nome = normalizarTexto(cat?.nome || '');
    if (/litro|bebida|suco|agua|leite|liquido/.test(nome)) return 'L';
    if (/sorvete|picole|gelato|massa|carne|queijo|frios/.test(nome)) return 'KG';
    return 'KG';
}

function montarResumoInteligenteProduto(produto, isEdit) {
    const nome = isEdit ? (produto?.nome || '—') : 'Novo produto';
    const fase = avaliarFaseCadastroProduto(isEdit, Boolean(produto?.tem_movimentacoes));

    return `
        <div class="col-12 mb-2" id="resumoInteligenteProduto">
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 py-1">
                <div class="fs-5 fw-semibold" id="resumo_produto_nome">${escapeHtml(nome)}</div>
                <span class="badge ${fase.fase === 'OPERACAO' ? 'bg-secondary' : 'bg-info text-dark'}" id="resumo_produto_fase">
                    ${escapeHtml(fase.label)}
                </span>
            </div>
            <span class="d-none" id="resumo_unidade_base"></span>
            <span class="d-none" id="resumo_conversao_fisica"></span>
            <span class="d-none" id="resumo_ucs"></span>
            <span class="d-none" id="resumo_produto_status"></span>
        </div>
    `;
}

function atualizarResumoInteligenteProduto() {
    const $resumo = $('#resumoInteligenteProduto');
    if (!$resumo.length) return;

    const nome = ($('#nome').val() || '').trim() || 'Novo produto';
    const base = String($('#unidade').val() || 'un').toUpperCase();
    const fisicaOn = $('#utiliza_conversao_fisica').is(':checked');
    const fisicaUn = fisicaOn
        ? String($('#unidade_conversao_fisica').val() || 'KG').toUpperCase() || 'KG'
        : 'Não';

    $('#resumo_produto_nome').text(nome);
    $('#resumo_unidade_base').text(base);
    $('#resumo_conversao_fisica').text(fisicaUn);

    const ucs = (window._uc01UnidadesCache || [])
        .map((u) => String(u.unidade_comercial || '').toUpperCase())
        .filter(Boolean);
    $('#resumo_ucs').text(ucs.length ? ucs.join(' · ') : base);

    const isEdit = Boolean($('#produtoId').val());
    const temMov = $('#produtoModal').data('temMovimentacoes') === true;
    const fase = avaliarFaseCadastroProduto(isEdit, temMov);
    const $fase = $('#resumo_produto_fase');
    if ($fase.length) {
        $fase
            .text(fase.label)
            .toggleClass('bg-info text-dark', fase.fase === 'IMPLANTACAO')
            .toggleClass('bg-secondary', fase.fase === 'OPERACAO');
    }
    $('#resumo_produto_status').text('');
}

function cabecalhoDominioProduto(icone, titulo, badgeHtml = '') {
    return `
        <div class="col-12 mb-2 mt-3">
            <h6 class="text-uppercase text-muted small fw-semibold mb-0 border-bottom pb-1 d-flex align-items-center justify-content-between">
                <span><i class="${icone} me-1"></i> ${titulo}</span>
                ${badgeHtml}
            </h6>
        </div>
    `;
}

// Abre modal de produto
function showProdutoModal(produto = null) {
    window._cpe1SuspenderCalculosProduto = true;
    const isEdit = produto !== null;
    const title = isEdit ? 'Editar Produto' : 'Novo Produto';
    const usaConversaoInicial = isEdit && produtoEhFracionado(produto);
    const custoUnitarioInicial = isEdit && usaConversaoInicial
        ? resolverCustoUnitarioProdutoCadastro(produto)
        : Number(isEdit ? produto.preco_compra : 0);
    // input type=number exige ponto; rótulos usam formatarCustoUnitarioCadastro (pt-BR)
    const precoCompraInicial = isEdit
        ? (Number.isFinite(custoUnitarioInicial) ? Number(custoUnitarioInicial).toFixed(2) : '0')
        : '0';
    const custoMedioExibicao = (isEdit && produto && produto.custo_medio != null && produto.custo_medio !== '')
        ? Number(produto.custo_medio).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : 'Não calculado';
    const permiteVendaUnidadeInicial = isEdit && Number(produto?.permite_venda_unidade ?? 0) === 1;
    const pesoMedioUnidadeInicial = isEdit ? Number(produto?.peso_medio_unidade ?? 0) : 0;
    const precoUnidadeInicial = isEdit ? Number(produto?.preco_unidade ?? 0) : 0;
    const estoqueTotalInicial = isEdit
        ? Number(produto.estoque_atual ?? (Number(produto.saldo_fiscal || 0) + Number(produto.saldo_nao_fiscal || 0)))
        : 0;

    // Remove modais antigos para evitar conflitos de aria-hidden e IDs duplicados
    $('#produtoModal').remove();
    $('#viewProdutoModal').remove();
    const modalHtml = `
        <div class="modal fade" id="produtoModal" tabindex="-1" aria-hidden="true"
             data-bs-backdrop="static" data-bs-keyboard="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header d-flex align-items-center justify-content-between">
                        <h5 class="modal-title mb-0">${title}</h5>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="minimizarModal('produtoModal')" title="Minimizar">
                                <i class="fas fa-window-minimize"></i>
                            </button>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                        </div>
                    </div>

                    <div class="modal-body">
                        <form id="produtoForm">
                            <input type="hidden" id="produtoId" value="${isEdit ? (produto.id || '') : ''}">

                            <div class="row" id="produtoFormDominios">
                                ${montarResumoInteligenteProduto(produto, isEdit)}

                                ${cabecalhoDominioProduto('fas fa-id-card', '1 · Identificação')}
                                <div class="col-12 mb-3">
                                    <div class="card">
                                        <div class="card-body">
                                            <div class="row">
                                                <div class="col-md-8 mb-3">
                                                    <label for="nome" class="form-label">Nome / Descrição *</label>
                                                    <input type="text" class="form-control" id="nome" required value="${isEdit ? escapeHtml(produto.nome || '') : ''}">
                                                </div>
                                                <div class="col-12 mb-3" id="areaCodigoBarrasEan13">
                                                    <label for="codigo_barras" class="form-label">Código de barras</label>
                                                    <div class="d-flex align-items-center gap-2 flex-wrap mb-2">
                                                        <input type="text" class="form-control" id="codigo_barras"
                                                               inputmode="numeric" maxlength="13" autocomplete="off"
                                                               style="max-width: 220px;"
                                                               value="${isEdit ? escapeHtml(produto.codigo_barras || '') : ''}">
                                                        <button type="button" class="btn btn-outline-primary" id="btnGerarEan13">
                                                            Gerar EAN-13
                                                        </button>
                                                    </div>
                                                    <div class="text-danger small mb-2 d-none" id="codigoBarrasEanErro"></div>
                                                    <div class="text-center py-3 border rounded bg-light d-none" id="areaEan13Preview">
                                                        <svg id="ean13BarcodeSvg" role="img" aria-label="Código de barras EAN-13"></svg>
                                                        <div class="fw-semibold mt-2" id="ean13Numero" style="letter-spacing: 0.12em;"></div>
                                                        <button type="button" class="btn btn-outline-secondary btn-sm mt-3" id="btnImprimirEtiquetaEan13">
                                                            <i class="fas fa-print me-1"></i> Imprimir etiqueta
                                                        </button>
                                                    </div>
                                                </div>
                                                <div class="col-12 mb-2" id="wrapCodigoUxMaster">
                                                    <div class="d-flex align-items-center gap-2 flex-wrap">
                                                        <span class="text-muted small" id="codigoAutoHintUx">Código gerado automaticamente ao salvar</span>
                                                        <button type="button" class="btn btn-link btn-sm px-0" id="btnEditarCodigoUx">Editar código</button>
                                                    </div>
                                                    <div class="${isEdit ? '' : 'd-none'}" id="areaCodigoManualUx">
                                                        <label for="codigo" class="form-label">Código</label>
                                                        <input type="text" class="form-control" id="codigo" value="${isEdit ? escapeHtml(produto.codigo || '') : ''}" ${isEdit ? '' : 'readonly'}>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                ${cabecalhoDominioProduto('fas fa-store', '2 · Comercial')}
                                <div class="col-12 mb-3">
                                    <div class="card border-primary border-opacity-25" id="cardComercialRcm82">
                                        <div class="card-header bg-primary bg-opacity-10 py-2 d-flex justify-content-between align-items-start flex-wrap gap-2">
                                            <div>
                                                <strong class="text-uppercase small tracking-wide">Comercial</strong>
                                                <small class="text-muted d-block">O que o Produto conhece — preços ficam na Central de Precificação</small>
                                            </div>
                                            <div class="d-flex flex-wrap gap-1">
                                                <span id="indicadorComercialRcm871" class="badge bg-secondary align-self-center">—</span>
                                                <button type="button" class="btn btn-sm btn-outline-secondary" id="btnVerificarCoberturaRcm871" title="Verificação de Consistência">Cobertura</button>
                                                <button type="button" class="btn btn-sm btn-outline-success" id="btnSimularPrecoRcm871" ${isEdit && produto?.id ? '' : 'disabled'}>Simular Preço</button>
                                                <button type="button" class="btn btn-sm btn-outline-primary" id="btnAnalisarProdutoRcm87" ${isEdit && produto?.id ? '' : 'disabled'} title="Auditoria Comercial via Motor Oficial">
                                                    <i class="fas fa-stethoscope me-1"></i> Analisar
                                                </button>
                                                <button type="button" class="btn btn-sm btn-outline-dark" id="btnCopiarConfigComercialRcm871" title="Copiar Grupo, Linha, Forma e Atacado de outro produto">Copiar</button>
                                            </div>
                                        </div>
                                        <div class="card-body">
                                            <div class="row g-3">
                                                <div class="col-md-6">
                                                    <label for="categoria_id" class="form-label">
                                                        Grupo Comercial
                                                        <i class="fas fa-info-circle text-muted ms-1" data-bs-toggle="tooltip" title="Classificação do produto. Não define preço."></i>
                                                    </label>
                                                    <div class="input-group">
                                                        <select class="form-control" id="categoria_id"><option value="">Carregando...</option></select>
                                                        <button type="button" class="btn btn-outline-secondary" id="btnAbrirGrupoComercialRcm871" title="Abrir Grupo Comercial">Abrir</button>
                                                    </div>
                                                </div>
                                                <div class="col-md-6 d-none" id="wrapSubcategoriaUxMaster">
                                                    <label for="subcategoria_id" class="form-label">Subcategoria</label>
                                                    <select class="form-control" id="subcategoria_id"><option value="">Selecione um grupo</option></select>
                                                </div>

                                                <div class="col-md-6">
                                                    <label for="unidade" class="form-label" id="label_unidade_produto">Unidade Base</label>
                                                    <select class="form-control" id="unidade">
                                                        <option value="un" ${!isEdit || produto.unidade === 'un' || !produto.unidade ? 'selected' : ''}>Unidade (UN)</option>
                                                        <option value="kg" ${isEdit && produto.unidade === 'kg' ? 'selected' : ''}>Quilograma</option>
                                                        <option value="g" ${isEdit && produto.unidade === 'g' ? 'selected' : ''}>Grama</option>
                                                        <option value="l" ${isEdit && produto.unidade === 'l' ? 'selected' : ''}>Litro</option>
                                                        <option value="ml" ${isEdit && produto.unidade === 'ml' ? 'selected' : ''}>Mililitro</option>
                                                        <option value="mt" ${isEdit && produto.unidade === 'mt' ? 'selected' : ''}>Metro</option>
                                                        <option value="m2" ${isEdit && produto.unidade === 'm2' ? 'selected' : ''}>Metro Quadrado</option>
                                                        <option value="m3" ${isEdit && produto.unidade === 'm3' ? 'selected' : ''}>Metro Cúbico</option>
                                                    </select>
                                                    <small class="text-muted">Unidade de estoque. A unidade de venda vem da Central de Precificação.</small>
                                                </div>

                                                <div class="col-12">
                                                    <label for="linha_comercial_trigger" class="form-label">
                                                        Linha de Precificação
                                                        <span class="badge bg-secondary ms-1">Opcional</span>
                                                        <i class="fas fa-info-circle text-muted ms-1" data-bs-toggle="tooltip"
                                                           title="Produtos da mesma Linha de Precificação compartilham os preços cadastrados na Central de Precificação."></i>
                                                    </label>
                                                    <div class="d-flex flex-wrap gap-2 align-items-start">
                                                        <div class="cds-linha-picker flex-grow-1" id="linha_comercial_picker" style="min-width:220px;">
                                                            <input type="hidden" id="linha_comercial_id" value="">
                                                            <button type="button" class="form-select text-start cds-linha-picker__trigger"
                                                                    id="linha_comercial_trigger"
                                                                    aria-haspopup="listbox"
                                                                    aria-expanded="false">
                                                                Sem linha — Produto com Precificação Própria
                                                            </button>
                                                            <div class="cds-linha-picker__panel d-none" id="linha_comercial_panel" role="listbox">
                                                                <div class="p-2 border-bottom sticky-top bg-white">
                                                                    <input type="search" class="form-control form-control-sm" id="linha_comercial_busca"
                                                                        placeholder="Pesquisar código ou nome..." autocomplete="off">
                                                                </div>
                                                                <div id="linha_comercial_lista"></div>
                                                            </div>
                                                        </div>
                                                        <button type="button" class="btn btn-outline-primary btn-sm" id="btnAbrirCentralLinhaRcm871" title="Abrir Central filtrando a Linha">Central</button>
                                                        <button type="button" class="btn btn-outline-secondary btn-sm" id="btnSugerirLinhaRcm871" title="Em breve: sugestão automática de Linha">✨ Sugerir Linha</button>
                                                    </div>
                                                    <div id="painelLinhaInteligenteRcm87" class="border rounded p-3 mt-2 bg-light"></div>
                                                    <div id="painelOndeVendidoRcm871" class="border rounded p-3 mt-2"></div>
                                                    <div id="painelResumoComercialRcm871" class="border rounded p-3 mt-2 bg-white"></div>
                                                </div>

                                                <div class="col-md-6" id="grupoPrecoSeguranca">
                                                    <div class="border border-warning rounded p-3 bg-warning bg-opacity-10 h-100">
                                                        <label for="preco_venda" class="form-label fw-semibold mb-1">
                                                            Preço de Segurança (Fallback) *
                                                            <i class="fas fa-info-circle text-muted ms-1" data-bs-toggle="tooltip"
                                                               title="Utilizado apenas quando não existir preço na Central de Precificação."></i>
                                                        </label>
                                                        <input type="number" step="0.01" class="form-control border-warning" id="preco_venda" required value="${isEdit ? Number(produto.preco_venda || 0) : 0}">
                                                        <small class="text-muted d-block mt-1">Utilizado apenas quando não existir um preço configurado na Central de Precificação.</small>
                                                    </div>
                                                </div>

                                                <div class="col-md-6">
                                                    <label class="form-label d-block">
                                                        Participa do Atacado
                                                        <i class="fas fa-info-circle text-muted ms-1" data-bs-toggle="tooltip"
                                                           title="Define apenas se o produto pode participar das operações de atacado. O preço sempre será obtido na Central de Precificação."></i>
                                                    </label>
                                                    <div class="btn-group" role="group" aria-label="Participa do Atacado">
                                                        <input type="radio" class="btn-check" name="participa_atacado" id="participa_atacado_sim" value="1"
                                                            ${(isEdit ? Number(produto.participa_atacado ?? 1) !== 0 : true) ? 'checked' : ''}>
                                                        <label class="btn btn-outline-success btn-sm" for="participa_atacado_sim">Sim</label>
                                                        <input type="radio" class="btn-check" name="participa_atacado" id="participa_atacado_nao" value="0"
                                                            ${(isEdit && Number(produto.participa_atacado ?? 1) === 0) ? 'checked' : ''}>
                                                        <label class="btn btn-outline-secondary btn-sm" for="participa_atacado_nao">Não</label>
                                                    </div>
                                                    <small class="text-muted d-block mt-1">Não é preço — só elegibilidade na operação Atacado.</small>
                                                </div>

                                                <div class="col-12"><hr class="my-1"></div>
                                                <div class="col-12">
                                                    <label class="form-label d-block mb-2">Forma de Comercialização</label>
                                                    <div class="d-flex flex-wrap gap-3" id="grupoFormaComercializacao">
                                                        ${['UNIDADE', 'PESO', 'VOLUME', 'CASQUINHA', 'PERSONALIZADA'].map((forma) => {
                                                            const labels = {
                                                                UNIDADE: 'Unidade',
                                                                PESO: 'Peso',
                                                                VOLUME: 'Volume',
                                                                CASQUINHA: 'Casquinha',
                                                                PERSONALIZADA: 'Personalizada'
                                                            };
                                                            const checked = (isEdit
                                                                ? String(produto.forma_comercializacao || (produtoEhFracionado(produto)
                                                                    ? (['l', 'ml'].includes(String(produto.unidade || '').toLowerCase()) ? 'VOLUME' : 'PESO')
                                                                    : 'UNIDADE')).toUpperCase()
                                                                : 'UNIDADE') === forma;
                                                            return `
                                                            <div class="form-check">
                                                                <input class="form-check-input" type="radio" name="forma_comercializacao"
                                                                    id="forma_${forma.toLowerCase()}" value="${forma}" ${checked ? 'checked' : ''}>
                                                                <label class="form-check-label" for="forma_${forma.toLowerCase()}">${labels[forma]}</label>
                                                            </div>`;
                                                        }).join('')}
                                                    </div>
                                                </div>

                                                <div class="col-12 d-none" id="painelFormaPesoVolume">
                                                    <div class="row g-2">
                                                        <div class="col-md-4">
                                                            <label for="unidade_venda" class="form-label">Unidade de Venda *</label>
                                                            <select class="form-select" id="unidade_venda">
                                                                <option value="">Selecione</option>
                                                                <option value="KG">Kg</option>
                                                                <option value="G">g</option>
                                                                <option value="L">Litro</option>
                                                                <option value="ML">ml</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div class="col-12 d-none" id="painelFormaCasquinha">
                                                    <div class="row g-2">
                                                        <div class="col-md-3">
                                                            <label for="bolas_min" class="form-label">Qtd. mínima de bolas *</label>
                                                            <input type="number" step="1" min="1" class="form-control" id="bolas_min"
                                                                value="${isEdit && Number(produto.bolas_min || produto.quantidade_bolas || 0) > 0
                                                                    ? Number(produto.bolas_min || 1)
                                                                    : (isEdit && Number(produto.quantidade_bolas || 0) > 0 ? 1 : '')}">
                                                        </div>
                                                        <div class="col-md-3">
                                                            <label for="bolas_max" class="form-label">Qtd. máxima de bolas *</label>
                                                            <input type="number" step="1" min="1" class="form-control" id="bolas_max"
                                                                value="${isEdit && Number(produto.bolas_max || produto.quantidade_bolas || 0) > 0
                                                                    ? Number(produto.bolas_max || produto.quantidade_bolas)
                                                                    : ''}">
                                                        </div>
                                                        <div class="col-md-3">
                                                            <label for="peso_medio_bola" class="form-label">Peso médio/bola (g)</label>
                                                            <input type="number" step="0.01" min="0" class="form-control" id="peso_medio_bola"
                                                                value="${isEdit && Number(produto.peso_medio_bola || 0) > 0 ? Number(produto.peso_medio_bola) : ''}"
                                                                placeholder="Opcional (estoque futuro)">
                                                        </div>
                                                        <input type="hidden" id="quantidade_bolas" value="${isEdit && Number(produto.quantidade_bolas || 0) > 0 ? Number(produto.quantidade_bolas) : ''}">
                                                    </div>
                                                    <small class="text-muted">O PDV abre o Montador de Casquinha com as opções entre mínimo e máximo.</small>
                                                </div>

                                                <div class="col-12 d-none" id="painelFormaPersonalizada">
                                                    <div class="row g-2">
                                                        <div class="col-md-6">
                                                            <label for="forma_personalizada_nome" class="form-label">Nome da Forma *</label>
                                                            <input type="text" class="form-control" id="forma_personalizada_nome" maxlength="120"
                                                                value="${isEdit ? escapeHtml(produto.forma_personalizada_nome || '') : ''}">
                                                        </div>
                                                        <div class="col-md-4">
                                                            <label for="forma_personalizada_unidade" class="form-label">Unidade *</label>
                                                            <input type="text" class="form-control" id="forma_personalizada_unidade" maxlength="40"
                                                                placeholder="Ex.: UN, CX, PCT"
                                                                value="${isEdit ? escapeHtml(produto.forma_personalizada_unidade || '') : ''}">
                                                        </div>
                                                    </div>
                                                </div>

                                                <!-- Flags internas sincronizadas pela Forma de Comercialização -->
                                                <input type="hidden" id="tabela_preco_id" value="">
                                                <input type="checkbox" class="d-none" id="produto_fracionado" ${isEdit && produtoEhFracionado(produto) ? 'checked' : ''} tabindex="-1" aria-hidden="true">
                                                <input type="checkbox" class="d-none" id="permite_venda_unidade" ${permiteVendaUnidadeInicial ? 'checked' : ''} tabindex="-1" aria-hidden="true">
                                                <input type="hidden" id="peso_medio_unidade" value="${pesoMedioUnidadeInicial > 0 ? pesoMedioUnidadeInicial : ''}">
                                                <input type="hidden" id="preco_unidade" value="${precoUnidadeInicial > 0 ? precoUnidadeInicial : ''}">
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                ${cabecalhoDominioProduto('fas fa-balance-scale', '3 · Unidades')}
                                <div class="col-12 mb-3">
                                    <div class="card" id="cardPesoProdutoUx">
                                        <div class="card-body">
                                            <div class="form-check form-switch mb-2">
                                                <input class="form-check-input" type="checkbox" id="utiliza_conversao_fisica" ${isEdit && Number(produto.utiliza_conversao_fisica || 0) === 1 ? 'checked' : ''} ${isEdit && produto?.tem_movimentacoes && Number(produto.utiliza_conversao_fisica || 0) === 1 ? 'disabled' : ''}>
                                                <label class="form-check-label" for="utiliza_conversao_fisica">Este produto é pesado na entrada da compra</label>
                                            </div>
                                            <div class="${isEdit && Number(produto.utiliza_conversao_fisica || 0) === 1 ? '' : 'd-none'}" id="painelConversaoFisicaUc01">
                                                <div class="row g-2 align-items-end">
                                                    <div class="col-md-12">
                                                        <label class="form-label mb-1">Converter</label>
                                                        <div class="d-flex flex-wrap align-items-center gap-2">
                                                            <span class="fw-semibold">1 <span id="uc01_unidade_base_readonly_label">${escapeHtml(String((isEdit ? produto.unidade : 'un') || 'un').toUpperCase())}</span></span>
                                                            <span class="text-muted">equivale aproximadamente a</span>
                                                            <input type="number" step="0.001" min="0" class="form-control" style="max-width: 120px;" id="peso_referencia_aproximado" placeholder="Ex.: 1" title="Referência visual — não altera regras do sistema">
                                                            <select class="form-control" style="max-width: 140px;" id="unidade_conversao_fisica">
                                                                <option value="">Selecione</option>
                                                                <option value="KG" ${isEdit && String(produto.unidade_conversao_fisica || '').toUpperCase() === 'KG' ? 'selected' : ''}>kg</option>
                                                                <option value="G" ${isEdit && String(produto.unidade_conversao_fisica || '').toUpperCase() === 'G' ? 'selected' : ''}>gramas</option>
                                                                <option value="L" ${isEdit && String(produto.unidade_conversao_fisica || '').toUpperCase() === 'L' ? 'selected' : ''}>litros</option>
                                                                <option value="ML" ${isEdit && String(produto.unidade_conversao_fisica || '').toUpperCase() === 'ML' ? 'selected' : ''}>ml</option>
                                                                <option value="UN" ${isEdit && String(produto.unidade_conversao_fisica || '').toUpperCase() === 'UN' ? 'selected' : ''}>unidade</option>
                                                                <option value="MT" ${isEdit && String(produto.unidade_conversao_fisica || '').toUpperCase() === 'MT' ? 'selected' : ''}>metro</option>
                                                                <option value="CM" ${isEdit && String(produto.unidade_conversao_fisica || '').toUpperCase() === 'CM' ? 'selected' : ''}>cm</option>
                                                            </select>
                                                        </div>
                                                        <input type="hidden" id="uc01_unidade_base_readonly" value="${escapeHtml(String((isEdit ? produto.unidade : 'un') || 'un').toUpperCase())}">
                                                        <small class="text-muted d-block mt-2">Esse valor serve apenas como referência. O peso real será informado na Entrada da Compra.</small>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="alert alert-secondary py-2 mb-0 mt-2 ${isEdit && produto?.tem_movimentacoes && Number(produto.utiliza_conversao_fisica || 0) === 1 ? '' : 'd-none'}" id="avisoPesoControladoPorLote">
                                                Controlado por lote. Ajuste o peso nas entradas e no Ajuste de Estoque.
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                ${cabecalhoDominioProduto('fas fa-exchange-alt', '3a · Conversões')}
                                <div class="col-12 mb-3" id="secaoConversoesProdutoRcm89" style="${isEdit ? '' : 'display:none;'}">
                                    <div class="card" id="cardConversoesProdutoRcm89">
                                        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2 py-2">
                                            <div>
                                                <strong>Conversões</strong>
                                                <span class="badge bg-secondary ms-1">MUC</span>
                                            </div>
                                            <button type="button" class="btn btn-sm btn-outline-primary" id="btnTestarConversaoRcm89" ${isEdit ? '' : 'disabled'}>
                                                <i class="fas fa-flask me-1"></i> Testar Conversão
                                            </button>
                                        </div>
                                        <div class="card-body">
                                            <p class="small text-muted mb-3">
                                                Conversões específicas deste produto (ex.: densidade LT→KG).
                                                Pares universais (L↔ML, KG↔G, M↔CM, M²↔CM², M³↔CM³) já são conhecidos pelo MUC e não precisam ser cadastrados.
                                                Não altera preço — só estoque.
                                            </p>
                                            <div class="row g-2 align-items-end mb-3" id="formNovaConversaoRcm89">
                                                <div class="col-md-3">
                                                    <label class="form-label small mb-1" for="conv_origem_rcm89">Origem</label>
                                                    <input type="text" class="form-control form-control-sm text-uppercase" id="conv_origem_rcm89"
                                                        maxlength="12" placeholder="Ex.: LT"
                                                        value="${isEdit ? escapeHtml(String((produto.unidade || 'UN')).toUpperCase()) : ''}">
                                                </div>
                                                <div class="col-md-3">
                                                    <label class="form-label small mb-1" for="conv_destino_rcm89">Destino</label>
                                                    <input type="text" class="form-control form-control-sm text-uppercase" id="conv_destino_rcm89"
                                                        maxlength="12" placeholder="Ex.: KG" list="conv_unidades_sugeridas_rcm89">
                                                    <datalist id="conv_unidades_sugeridas_rcm89">
                                                        <option value="LT"><option value="L"><option value="ML">
                                                        <option value="KG"><option value="G">
                                                        <option value="UN"><option value="M"><option value="CM">
                                                        <option value="M2"><option value="CM2"><option value="M3"><option value="CM3">
                                                        <option value="PEÇA"><option value="CX">
                                                    </datalist>
                                                </div>
                                                <div class="col-md-2">
                                                    <label class="form-label small mb-1" for="conv_fator_rcm89">Fator</label>
                                                    <input type="number" step="any" min="0" class="form-control form-control-sm" id="conv_fator_rcm89" placeholder="0,58">
                                                </div>
                                                <div class="col-md-2">
                                                    <label class="form-label small mb-1" for="conv_tipo_rcm89">Tipo</label>
                                                    <select class="form-control form-control-sm" id="conv_tipo_rcm89">
                                                        <option value="FIXA" selected>Fixa</option>
                                                    </select>
                                                </div>
                                                <div class="col-md-2">
                                                    <button type="button" class="btn btn-sm btn-primary w-100" id="btnAdicionarConversaoRcm89" ${isEdit ? '' : 'disabled'}>
                                                        <i class="fas fa-plus me-1"></i> Adicionar
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="table-responsive">
                                                <table class="table table-sm table-hover mb-0 align-middle">
                                                    <thead class="table-light">
                                                        <tr>
                                                            <th>Origem</th>
                                                            <th>Destino</th>
                                                            <th>Fator</th>
                                                            <th>Tipo</th>
                                                            <th class="text-end" style="width:90px;"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody id="tbodyConversoesRcm89">
                                                        <tr><td colspan="5" class="text-muted text-center py-3">Salve o produto para cadastrar conversões.</td></tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div id="painelSimularConversaoRcm89" class="border rounded p-3 mt-3 bg-light d-none">
                                                <div class="fw-semibold mb-2">Testar Conversão</div>
                                                <div class="row g-2 align-items-end">
                                                    <div class="col-md-3">
                                                        <label class="form-label small mb-1" for="sim_qtd_rcm89">Quantidade</label>
                                                        <input type="number" step="any" min="0" class="form-control form-control-sm" id="sim_qtd_rcm89" value="1">
                                                    </div>
                                                    <div class="col-md-3">
                                                        <label class="form-label small mb-1" for="sim_origem_rcm89">De</label>
                                                        <input type="text" class="form-control form-control-sm text-uppercase" id="sim_origem_rcm89" maxlength="12">
                                                    </div>
                                                    <div class="col-md-3">
                                                        <label class="form-label small mb-1" for="sim_destino_rcm89">Para</label>
                                                        <input type="text" class="form-control form-control-sm text-uppercase" id="sim_destino_rcm89" maxlength="12">
                                                    </div>
                                                    <div class="col-md-3">
                                                        <button type="button" class="btn btn-sm btn-success w-100" id="btnExecutarSimulacaoRcm89">Calcular</button>
                                                    </div>
                                                </div>
                                                <div id="sim_resultado_rcm89" class="mt-2 small"></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                ${cabecalhoDominioProduto('fas fa-cubes', '3b · Formas de Venda (Unidades Comerciais)')}
                                <div class="row" id="secaoUnidadesComercializacaoUc01" style="${isEdit ? '' : 'display:none;'}">
                                    <div class="col-12 mb-3">
                                        <div class="card">
                                            <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2 py-2">
                                                <strong>Formas de Venda</strong>
                                                <button type="button" class="btn btn-sm btn-primary" id="btnAdicionarUnidadeUc01" ${isEdit ? '' : 'disabled'}>
                                                    <i class="fas fa-plus me-1"></i> Adicionar
                                                </button>
                                            </div>
                                            <div class="card-body">
                                                <p class="small text-muted mb-3">
                                                    Estoque na unidade <strong id="uc01UnidadeBaseLabel">${isEdit ? escapeHtml((produto.unidade || 'UN').toUpperCase()) : '—'}</strong>.
                                                    ${isEdit ? 'Cada card é uma forma de comprar ou vender.' : 'Salve o produto para liberar as formas de venda.'}
                                                </p>
                                                <div class="row g-2 mb-3 align-items-end d-none" id="uc01ToolbarCards">
                                                    <div class="col-md-5">
                                                        <label class="form-label small mb-1" for="uc01BuscaCards">Pesquisar</label>
                                                        <input type="search" class="form-control form-control-sm" id="uc01BuscaCards"
                                                            placeholder="Nome ou unidade…" autocomplete="off">
                                                    </div>
                                                    <div class="col-md-7">
                                                        <label class="form-label small mb-1 d-block">Filtros</label>
                                                        <div class="btn-group btn-group-sm flex-wrap" role="group" id="uc01FiltrosCards">
                                                            <button type="button" class="btn btn-outline-secondary active" data-filtro-uc01="todos">Todos</button>
                                                            <button type="button" class="btn btn-outline-secondary" data-filtro-uc01="compra">Compra</button>
                                                            <button type="button" class="btn btn-outline-secondary" data-filtro-uc01="venda">Venda</button>
                                                            <button type="button" class="btn btn-outline-secondary" data-filtro-uc01="pdv">PDV</button>
                                                            <button type="button" class="btn btn-outline-secondary" data-filtro-uc01="ativos">Ativos</button>
                                                            <button type="button" class="btn btn-outline-secondary" data-filtro-uc01="inativos">Inativos</button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div id="gradeCardsUnidadesUc01" class="row g-3">
                                                    <div class="col-12 text-muted text-center py-3">Carregando...</div>
                                                </div>
                                                <div id="tbodyUnidadesUc01" class="d-none" aria-hidden="true"></div>
                                                <table id="tabelaUnidadesUc01" class="d-none" aria-hidden="true"><tbody></tbody></table>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-12 mb-3" id="avisoUc01NovoProduto" style="${isEdit ? 'display:none;' : ''}">
                                    <small class="text-muted">Após salvar, o sistema cria a forma de venda padrão automaticamente.</small>
                                </div>

                                ${cabecalhoDominioProduto('fas fa-warehouse', '4 · Estoque')}
                                <div id="areaCamposEstoqueProduto" style="display: contents;">
                                ${montarHtmlCamposEstoqueProduto(produto, isEdit, {
                                    temMovimentacoes: produto?.tem_movimentacoes
                                })}
                                </div>
                                <div class="col-md-4 mb-3">
                                    <label for="estoque_minimo" class="form-label">Estoque Mínimo</label>
                                    <input type="number" step="${usaConversaoInicial ? '0.001' : '0.01'}" class="form-control" id="estoque_minimo" value="${isEdit ? Number(produto.estoque_minimo || 0) : 0}">
                                </div>
                                <div class="col-12">
                                    <div class="row g-3 border rounded p-3 mb-2 bg-light">
                                        <div class="col-md-12">
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox" id="controlar_validade" ${isEdit && Number(produto.controlar_validade || 0) === 1 ? 'checked' : ''}>
                                                <label class="form-check-label" for="controlar_validade">Controlar validade deste produto</label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-12" id="areaLoteInicial" style="display: none;">
                                    <div class="row g-3 border rounded p-3 mb-2 bg-info bg-opacity-10">
                                        <div class="col-md-12">
                                            <strong>Validade inicial</strong>
                                            <small class="text-muted d-block">Informe a validade do estoque. Em produtos novos, o sistema cria o lote automaticamente.</small>
                                        </div>
                                        <div class="col-md-4">
                                            <label for="data_validade_inicial" class="form-label">Data Validade *</label>
                                            <input type="date" id="data_validade_inicial" class="form-control" data-campo-implantacao="1" value="${isEdit ? (produto.data_validade_inicial || produto.data_validade || '') : ''}">
                                        </div>
                                        <div class="col-md-4">
                                            <label for="dias_alerta_validade" class="form-label">Alertar (dias)</label>
                                            <input type="number" id="dias_alerta_validade" class="form-control" data-campo-implantacao="1" value="${isEdit ? Number(produto.dias_alerta_validade || 30) : 30}" min="1">
                                        </div>
                                    </div>
                                </div>

                                ${cabecalhoDominioProduto('fas fa-coins', '5 · Custos')}
                                <div class="col-12 mb-3" id="dominioCustosProduto">
                                    <div class="card">
                                        <div class="card-body">
                                            <p class="text-muted small mb-3">
                                                Esta seção apresenta o custo atual do produto.<br>
                                                O cálculo do custo é realizado durante o processo de Compra ou pela importação de NF-e.<br>
                                                O Último Custo pode ser informado manualmente quando a empresa não utilizar o módulo de Compras.
                                            </p>
                                            <div class="row g-2">
                                                <div class="col-md-4 mb-3">
                                                    <label for="preco_compra" class="form-label" id="label_preco_compra_produto">Último Custo</label>
                                                    <input type="number" step="0.01" class="form-control" id="preco_compra" value="${precoCompraInicial}">
                                                    <small class="text-muted" id="hint_preco_compra_produto">Editável para implantação, ajustes manuais ou empresas sem módulo de Compras.</small>
                                                </div>
                                                <div class="col-md-4 mb-3">
                                                    <label class="form-label">Custo Médio</label>
                                                    <input type="text" class="form-control bg-light" id="custo_medio_produto_readonly" readonly
                                                        value="${custoMedioExibicao}">
                                                    <small class="text-muted">Somente leitura. Calculado nas entradas de compra.</small>
                                                </div>
                                                <div class="col-md-4 mb-3 position-relative">
                                                    <label for="fornecedor" class="form-label">Fornecedor Preferencial</label>
                                                    <input type="text" class="form-control" id="fornecedor" autocomplete="off" value="${isEdit ? escapeHtml(produto.fornecedor || '') : ''}">
                                                    <div id="fornecedor-autocomplete" class="list-group position-absolute w-100" style="z-index: 9999; display: none;"></div>
                                                </div>
                                                <div class="col-md-8 mb-2">
                                                    <label class="form-label">Última Compra</label>
                                                    <div class="form-control bg-light" id="ultima_compra_produto_readonly" style="min-height: 38px;">
                                                        Sem histórico
                                                    </div>
                                                    <small class="text-muted">Data · Documento · Fornecedor — disponível quando houver histórico de compras.</small>
                                                </div>
                                                <div class="col-md-4 mb-2 d-flex align-items-end">
                                                    <button type="button" class="btn btn-outline-secondary w-100" id="btnVerHistoricoCustosProduto"
                                                        disabled title="Disponível em breve">
                                                        Ver Histórico de Custos
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                ${cabecalhoDominioProduto('fas fa-file-invoice', '6 · Fiscal')}
                                <div class="col-12 mb-3" id="dominioFiscalProduto">
                                    <div class="card">
                                        <div class="card-header p-2">
                                            <button class="btn btn-link text-decoration-none" type="button" data-bs-toggle="collapse" data-bs-target="#dadosFiscaisSection" aria-expanded="false" aria-controls="dadosFiscaisSection">
                                                <i class="fas fa-file-invoice me-1"></i> Abrir dados fiscais
                                            </button>
                                        </div>
                                        <div id="dadosFiscaisSection" class="collapse" data-cpe1-lazy="fiscal">
                                            <div class="card-body">
                                                <div class="row">
                                                    <div class="col-md-3 mb-3"><label for="ncm" class="form-label">NCM</label><input type="text" class="form-control" id="ncm" value="${isEdit ? escapeHtml(produto.ncm || '') : ''}"></div>
                                                    <div class="col-md-3 mb-3"><label for="cfop" class="form-label">CFOP</label><input type="text" class="form-control" id="cfop" value="${isEdit ? escapeHtml(produto.cfop || '') : ''}"></div>
                                                    <div class="col-md-3 mb-3"><label for="csosn" class="form-label">CSOSN</label><input type="text" class="form-control" id="csosn" value="${isEdit ? escapeHtml(produto.csosn || '') : ''}"></div>
                                                    <div class="col-md-3 mb-3"><label for="origem" class="form-label">Origem</label><input type="number" class="form-control" id="origem" value="${isEdit ? Number(produto.origem || 0) : 0}"></div>
                                                    <div class="col-md-4 mb-3"><label for="cest" class="form-label">CEST</label><input type="text" class="form-control" id="cest" value="${isEdit ? escapeHtml(produto.cest || '') : ''}"></div>
                                                    <div class="col-md-4 mb-3"><label for="aliquota_icms" class="form-label">Alíquota ICMS</label><input type="number" step="0.01" class="form-control" id="aliquota_icms" value="${isEdit ? Number(produto.aliquota_icms || 0) : 0}"></div>
                                                    <div class="col-md-4 mb-3"><label for="aliquota_pis" class="form-label">Alíquota PIS</label><input type="number" step="0.01" class="form-control" id="aliquota_pis" value="${isEdit ? Number(produto.aliquota_pis || 0) : 0}"></div>
                                                    <div class="col-md-4 mb-3"><label for="aliquota_cofins" class="form-label">Alíquota COFINS</label><input type="number" step="0.01" class="form-control" id="aliquota_cofins" value="${isEdit ? Number(produto.aliquota_cofins || 0) : 0}"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                ${cabecalhoDominioProduto('fas fa-history', '7 · Histórico')}
                                <div class="col-12 mb-3" id="dominioHistoricoProduto">
                                    <div class="card bg-light">
                                        <div class="card-body">
                                            <p class="small text-muted mb-3">Somente leitura — referência operacional do produto.</p>
                                            <div class="row g-2">
                                                <div class="col-md-4"><label class="form-label small text-muted mb-0">Última Compra</label>
                                                    <div class="fw-semibold">Sem histórico</div></div>
                                                <div class="col-md-4"><label class="form-label small text-muted mb-0">Último Custo</label>
                                                    <div class="fw-semibold">${isEdit ? ('R$ ' + Number(produto.preco_compra || 0).toFixed(2)) : '—'}</div></div>
                                                <div class="col-md-4"><label class="form-label small text-muted mb-0">Custo Médio</label>
                                                    <div class="fw-semibold">${isEdit && produto.custo_medio != null && produto.custo_medio !== '' ? ('R$ ' + Number(produto.custo_medio).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : 'Não calculado'}</div></div>
                                                <div class="col-md-4"><label class="form-label small text-muted mb-0">Última Venda</label>
                                                    <div class="fw-semibold">${isEdit ? escapeHtml(produto.data_ultima_venda || produto.ultima_venda || '—') : '—'}</div></div>
                                                <div class="col-md-4"><label class="form-label small text-muted mb-0">Linha de Precificação</label>
                                                    <div class="fw-semibold" id="hist_linha_precificacao">${isEdit && produto.linha_comercial_id
                                                        ? ('#' + produto.linha_comercial_id)
                                                        : 'Produto com precificação própria'}</div></div>
                                                <div class="col-md-4"><label class="form-label small text-muted mb-0">Contexto de preço</label>
                                                    <div class="fw-semibold">Tabela da operação → Resolver Oficial</div></div>
                                                <div class="col-md-4"><label class="form-label small text-muted mb-0">Última Alteração</label>
                                                    <div class="fw-semibold">${isEdit ? escapeHtml(produto.updated_at || produto.atualizado_em || '—') : '—'}</div></div>
                                                <div class="col-md-4"><label class="form-label small text-muted mb-0">Usuário</label>
                                                    <div class="fw-semibold">${isEdit ? escapeHtml(produto.updated_by || produto.usuario || '—') : '—'}</div></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </form>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="saveProduto()">Salvar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    // Electron: backdrop static evita fechar ao clicar em lista/select nativo
    const produtoModalEl = document.getElementById('produtoModal');
    if (produtoModalEl && window.bootstrap?.Modal) {
        bootstrap.Modal.getOrCreateInstance(produtoModalEl, {
            backdrop: 'static',
            keyboard: true,
            focus: true
        }).show();
    } else {
        $('#produtoModal').modal({ backdrop: 'static', keyboard: true, show: true });
    }
    // RA-6.5.1 — tooltips Bootstrap no cadastro
    try {
        document.querySelectorAll('#produtoModal [data-bs-toggle="tooltip"]').forEach(function (el) {
            bootstrap.Tooltip.getOrCreateInstance(el);
        });
    } catch (_) { /* ignore */ }
    $('#produtoModal').data('temMovimentacoes', Boolean(produto?.tem_movimentacoes));
    prepararBloqueioImplantacaoProduto(
        avaliarFaseCadastroProduto(isEdit, Boolean(produto?.tem_movimentacoes))
    );
    if (isEdit && produto) {
        $('#produtoModal').data('produtoSaldos', {
            saldo_fiscal: produto.saldo_fiscal,
            saldo_nao_fiscal: produto.saldo_nao_fiscal,
            estoque_atual: produto.estoque_atual
        });
    }
    // Remove botão flutuante se existir ao restaurar
    $('#btn-restaurar-produtoModal').remove();

    inicializarCategoriasESubcategorias(produto, isEdit);
    inicializarAutocompleteFornecedor();
    inicializarCalculoPreco(produto, isEdit);
    inicializarMotorConversaoUnidadesCadastro();
    inicializarVendaUnidadeCadastro(produto, isEdit);
    inicializarLinhaComercialProduto(produto, isEdit);
    inicializarFormaComercializacaoProduto(produto, isEdit);
    if (isEdit && produto?.id) {
        inicializarUnidadesComercializacaoUc01(produto.id);
        inicializarConversoesProdutoRcm89(produto.id);
    }

    inicializarConversaoFisicaUc01(produto, isEdit);
    inicializarCodigoAutomaticoUxMaster(isEdit);
    inicializarSubcategoriaProgressivaUxMaster();
    atualizarResumoInteligenteProduto();

    if (isEdit && produto) {
        $('#controlar_validade').prop('checked', produto.controlar_validade == 1);
    } else {
        $('#controlar_validade').prop('checked', false);
    }

    // Inicializar controle de visibilidade do lote inicial
    inicializarControleLoteInicial();
    inicializarPreviewEstoqueTotalInicial();
    inicializarEspelhoCodigoBarras(produto, isEdit);
    inicializarEan13CadastroProduto(produto, isEdit);

    // CP-E1: libera cálculos só após montagem (evita validação/cálculo no open/reset)
    setTimeout(function () {
        window._cpe1SuspenderCalculosProduto = false;
    }, 250);

    $('#produtoModal').off('hidden.bs.modal.cpe1').on('hidden.bs.modal.cpe1', function () {
        window._cpe1SuspenderCalculosProduto = true;
    });

    if (!isEdit) {
        aplicarPadraoFiscalNovoProduto();
    }

    // ...
}

async function aplicarPadraoFiscalNovoProduto() {
    if ($('#produtoId').val()) {
        return;
    }

    try {
        const token = localStorage.getItem('token') || '';
        const response = await fetch(`${API_URL}/configuracoes-avancadas/padrao-fiscal`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
            return;
        }

        const padrao = await response.json();
        if (padrao.cfop_padrao) {
            $('#cfop').val(padrao.cfop_padrao);
        }
        if (padrao.csosn_padrao) {
            $('#csosn').val(padrao.csosn_padrao);
        }
        if (padrao.origem_padrao !== undefined && padrao.origem_padrao !== null && padrao.origem_padrao !== '') {
            const origem = parseInt(padrao.origem_padrao, 10);
            if (!Number.isNaN(origem)) {
                $('#origem').val(origem);
            }
        }
        if (padrao.cest_padrao) {
            $('#cest').val(padrao.cest_padrao);
        }
    } catch (err) {
        console.warn('Não foi possível carregar padrão fiscal da empresa:', err);
    }
}
window.aplicarPadraoFiscalNovoProduto = aplicarPadraoFiscalNovoProduto;

function inicializarCodigoAutomaticoUxMaster(isEdit) {
    const $area = $('#areaCodigoManualUx');
    const $hint = $('#codigoAutoHintUx');
    const $btn = $('#btnEditarCodigoUx');
    const $codigo = $('#codigo');
    if (!$codigo.length) return;

    if (isEdit) {
        $area.removeClass('d-none');
        $codigo.prop('readonly', false);
        $hint.addClass('d-none');
        $btn.addClass('d-none');
        return;
    }

    $area.addClass('d-none');
    $codigo.prop('readonly', true).val('');
    $hint.removeClass('d-none');
    $btn.removeClass('d-none');

    $btn.off('click.uxMaster01').on('click.uxMaster01', function () {
        $area.removeClass('d-none');
        $codigo.prop('readonly', false);
        if (!$codigo.val()) {
            $codigo.val(gerarCodigoProdutoAutomatico());
        }
        $codigo.focus();
        $hint.text('Código manual — deixe em branco para gerar automaticamente ao salvar.');
    });
}

function inicializarSubcategoriaProgressivaUxMaster() {
    const sync = () => {
        const catId = $('#categoria_id').val();
        const $wrap = $('#wrapSubcategoriaUxMaster');
        if (!$wrap.length) return;
        const cat = (window.categoriasSistema || []).find((c) => String(c.id) === String(catId));
        const temSubs = Boolean(cat && Array.isArray(cat.subcategorias) && cat.subcategorias.length);
        $wrap.toggleClass('d-none', !temSubs);
        if (!temSubs) {
            $('#subcategoria_id').val('');
        }
    };
    $('#categoria_id').off('change.uxMaster01Sub').on('change.uxMaster01Sub', sync);
    setTimeout(sync, 300);
}

function garantirUcPadraoAposCriacao(produtoSalvo) {
    const dfd = $.Deferred();
    const produtoId = produtoSalvo?.id;
    if (!produtoId) {
        return dfd.resolve().promise();
    }

    const unBase = String(produtoSalvo.unidade || $('#unidade').val() || 'un').toUpperCase();
    const headers = { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') };

    $.get(`${API_URL}/produtos/${produtoId}/unidades-comercializacao`)
        .done((payload) => {
            const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
            if (items.length > 0) {
                dfd.resolve(null);
                return;
            }
            const body = {
                descricao: unBase,
                tipo: 'PADRAO',
                unidade_comercial: unBase,
                quantidade: 1,
                unidade_base: unBase,
                unidade_padrao: 1,
                conversao_por_lote: 0,
                canais_comercializacao: { compra: 1, venda: 1, pdv: 1 },
                ativo: 1
            };
            $.ajax({
                url: `${API_URL}/produtos/${produtoId}/unidades-comercializacao`,
                method: 'POST',
                contentType: 'application/json',
                headers,
                data: JSON.stringify(body)
            }).done((res) => dfd.resolve(res)).fail(() => dfd.resolve(null));
        })
        .fail(() => dfd.resolve(null));

    return dfd.promise();
}

window.garantirUcPadraoAposCriacao = garantirUcPadraoAposCriacao;
window.gerarCodigoProdutoAutomatico = gerarCodigoProdutoAutomatico;

function inicializarEspelhoCodigoBarras(produto, isEdit) {
    const $modal = $('#produtoModal');
    if (!$modal.length) {
        return;
    }

    const codigoInicial = isEdit ? String(produto?.codigo || '').trim() : '';
    const barrasInicial = isEdit ? String(produto?.codigo_barras || '').trim() : '';

    if (barrasInicial && barrasInicial !== codigoInicial) {
        $modal.data('codigoBarrasEditadoManualmente', true);
        $modal.data('ultimoCodigoEspelhado', '');
    } else {
        $modal.data('codigoBarrasEditadoManualmente', false);
        $modal.data('ultimoCodigoEspelhado', codigoInicial);
    }

    $modal.off('input.espelhoCodigo change.espelhoCodigo')
        .on('input.espelhoCodigo change.espelhoCodigo', '#codigo', function () {
            const codigo = String($(this).val() || '').trim();
            const $barras = $('#codigo_barras');
            const barras = String($barras.val() || '').trim();
            const ultimoEspelhado = String($modal.data('ultimoCodigoEspelhado') || '');
            const manual = $modal.data('codigoBarrasEditadoManualmente') === true;

            if (!manual || barras === '' || barras === ultimoEspelhado) {
                if (window.EAN13 && window.EAN13.validate(codigo)) {
                    $barras.val(codigo);
                    $modal.data('ultimoCodigoEspelhado', codigo);
                    $modal.data('codigoBarrasEditadoManualmente', false);
                    if (typeof atualizarPreviewEan13Produto === 'function') {
                        atualizarPreviewEan13Produto();
                    }
                }
            }
        })
        .on('input.espelhoCodigo change.espelhoCodigo', '#codigo_barras', function () {
            const codigo = String($('#codigo').val() || '').trim();
            const barras = String($(this).val() || '').trim();

            if (barras === codigo) {
                $modal.data('codigoBarrasEditadoManualmente', false);
                $modal.data('ultimoCodigoEspelhado', codigo);
            } else if (barras === '') {
                $modal.data('codigoBarrasEditadoManualmente', false);
                $modal.data('ultimoCodigoEspelhado', '');
            } else {
                $modal.data('codigoBarrasEditadoManualmente', true);
            }
        });
}
window.inicializarEspelhoCodigoBarras = inicializarEspelhoCodigoBarras;

function obterCodigoBarrasFormularioProduto() {
    const ean = window.EAN13;
    const bruto = $('#codigo_barras').val();
    return ean ? ean.stripSpaces(bruto) : String(bruto || '').trim();
}

function exibirErroEan13Produto(mensagem) {
    const $erro = $('#codigoBarrasEanErro');
    if (!$erro.length) return;
    if (mensagem) {
        $erro.text(mensagem).removeClass('d-none');
    } else {
        $erro.text('').addClass('d-none');
    }
}

function atualizarPreviewEan13Produto() {
    const ean = window.EAN13;
    const codigo = obterCodigoBarrasFormularioProduto();
    const $area = $('#areaEan13Preview');
    const $svg = $('#ean13BarcodeSvg');
    const valido = Boolean(ean && ean.validate(codigo));

    if (!valido) {
        $area.addClass('d-none');
        if (codigo && ean && codigo.length >= 13) {
            exibirErroEan13Produto(ean.MSG_INVALIDO);
        } else if (codigo && /[^\d]/.test(codigo)) {
            exibirErroEan13Produto(ean ? ean.MSG_INVALIDO : 'Código de barras EAN-13 inválido.');
        } else {
            exibirErroEan13Produto('');
        }
        return;
    }

    exibirErroEan13Produto('');
    $area.removeClass('d-none');
    $('#ean13Numero').text(codigo);
    if (typeof JsBarcode === 'function' && $svg.length) {
        try {
            JsBarcode($svg.get(0), codigo, {
                format: 'EAN13',
                width: 2,
                height: 64,
                displayValue: false,
                margin: 8,
                background: 'transparent'
            });
        } catch (err) {
            console.warn('Falha ao renderizar EAN-13:', err);
        }
    }
}

function confirmarSubstituicaoEan13(codigoAtual) {
    const ean = window.EAN13;
    if (!String(codigoAtual || '').trim()) return true;
    const mensagem = (ean && ean.MSG_CONFIRMA_SUBSTITUIR)
        || 'Este produto já possui um código de barras.\nDeseja gerar um novo código?';
    return window.confirm(mensagem);
}

function gerarEan13Produto() {
    const atual = obterCodigoBarrasFormularioProduto();
    if (!confirmarSubstituicaoEan13(atual)) {
        return;
    }

    const produtoId = String($('#produtoId').val() || '').trim();
    const url = produtoId
        ? `${API_URL}/produtos/${produtoId}/codigo-barras/gerar`
        : `${API_URL}/produtos/codigo-barras/gerar`;

    $.ajax({
        url,
        method: 'POST',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
        data: JSON.stringify({ exclude_id: produtoId || null }),
        success: function (resp) {
            const codigo = resp && resp.codigo_barras ? String(resp.codigo_barras) : '';
            $('#codigo_barras').val(codigo);
            $('#produtoModal').data('codigoBarrasEditadoManualmente', true);
            atualizarPreviewEan13Produto();
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || 'Não foi possível gerar o código de barras.';
            showNotification(erro, 'danger');
        }
    });
}

function nomeEmpresaEtiquetaProduto() {
    try {
        const cfg = window.configuracoesSistema || window.empresaAtual || {};
        return cfg.nome_fantasia || cfg.nome_empresa || cfg.razao_social || 'CREMOLÍCIA';
    } catch (_) {
        return 'CREMOLÍCIA';
    }
}

function precoEtiquetaProduto() {
    const bruto = parseFloat($('#preco_venda').val());
    const valor = Number.isFinite(bruto) ? bruto : 0;
    if (valor <= 0) return '';
    const fmt = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `R$ ${fmt}`;
}

function imprimirEtiquetaEan13Produto() {
    const ean = window.EAN13;
    const codigo = obterCodigoBarrasFormularioProduto();
    if (!ean || !ean.validate(codigo)) {
        showNotification(ean ? ean.MSG_INVALIDO : 'Código de barras EAN-13 inválido.', 'warning');
        return;
    }

    atualizarPreviewEan13Produto();
    const svgHtml = $('#ean13BarcodeSvg').prop('outerHTML') || '';
    const nome = String($('#nome').val() || 'Produto').trim() || 'Produto';
    const empresa = nomeEmpresaEtiquetaProduto();
    const preco = precoEtiquetaProduto();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showNotification('Permita popups para imprimir a etiqueta.', 'warning');
        return;
    }

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Etiqueta ${codigo}</title>
  <style>
    @page { size: 80mm 50mm; margin: 4mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; text-align: center; margin: 0; padding: 8px; }
    .empresa { font-size: 11px; letter-spacing: 0.16em; font-weight: 700; margin-bottom: 8px; }
    .nome { font-size: 14px; font-weight: 700; margin: 8px 0; text-transform: uppercase; }
    .ean { font-size: 13px; letter-spacing: 0.12em; margin-top: 6px; }
    .preco { font-size: 16px; font-weight: 700; margin-top: 10px; }
    svg { max-width: 100%; height: auto; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="empresa">${escapeHtml(empresa)}</div>
  <div class="nome">${escapeHtml(nome)}</div>
  ${svgHtml}
  <div class="ean">${escapeHtml(codigo)}</div>
  ${preco ? `<div class="preco">${escapeHtml(preco)}</div>` : ''}
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
}

function inicializarEan13CadastroProduto(produto, isEdit) {
    const $modal = $('#produtoModal');
    if (!$modal.length) return;
    $modal.data('codigoBarrasOriginal', isEdit ? String(produto?.codigo_barras || '') : '');

    $modal.off('click.ean13 input.ean13 blur.ean13')
        .on('click.ean13', '#btnGerarEan13', function (ev) {
            ev.preventDefault();
            gerarEan13Produto();
        })
        .on('click.ean13', '#btnImprimirEtiquetaEan13', function (ev) {
            ev.preventDefault();
            imprimirEtiquetaEan13Produto();
        })
        .on('input.ean13', '#codigo_barras', function () {
            const ean = window.EAN13;
            const apenas = ean ? ean.somenteDigitos($(this).val()).slice(0, 13) : String($(this).val() || '');
            if ($(this).val() !== apenas) $(this).val(apenas);
            atualizarPreviewEan13Produto();
        })
        .on('blur.ean13', '#codigo_barras', function () {
            const ean = window.EAN13;
            const codigo = obterCodigoBarrasFormularioProduto();
            const original = ean
                ? ean.stripSpaces($('#produtoModal').data('codigoBarrasOriginal'))
                : String($('#produtoModal').data('codigoBarrasOriginal') || '').trim();
            if (!codigo) {
                exibirErroEan13Produto('');
                atualizarPreviewEan13Produto();
                return;
            }
            if (original && codigo === original && ean && !ean.validate(codigo)) {
                exibirErroEan13Produto('');
                $('#areaEan13Preview').addClass('d-none');
                return;
            }
            if (!ean || !ean.validate(codigo)) {
                exibirErroEan13Produto(ean ? ean.MSG_INVALIDO : 'Código de barras EAN-13 inválido.');
                $('#areaEan13Preview').addClass('d-none');
            } else {
                atualizarPreviewEan13Produto();
            }
        });

    atualizarPreviewEan13Produto();
}

window.atualizarPreviewEan13Produto = atualizarPreviewEan13Produto;
window.gerarEan13Produto = gerarEan13Produto;
window.imprimirEtiquetaEan13Produto = imprimirEtiquetaEan13Produto;
window.inicializarEan13CadastroProduto = inicializarEan13CadastroProduto;
window.confirmarSubstituicaoEan13 = confirmarSubstituicaoEan13;

// Função para controlar visibilidade dos campos de lote inicial
function inicializarControleLoteInicial() {
    const $controlarValidade = $('#controlar_validade');
    const $areaLoteInicial = $('#areaLoteInicial');

    function atualizarVisibilidadeLoteInicial() {
        const controlarValidade = $controlarValidade.prop('checked');

        console.log('Atualizando visibilidade lote inicial:', controlarValidade);

        // Mostrar campos de lote inicial quando controlar_validade estiver marcado
        if (controlarValidade) {
            $areaLoteInicial.show();
        } else {
            $areaLoteInicial.hide();
        }
    }

    $controlarValidade.on('change', atualizarVisibilidadeLoteInicial);

    // Verificar estado inicial com delay
    setTimeout(atualizarVisibilidadeLoteInicial, 100);
}


// Inicializa categorias e subcategorias
function inicializarCategoriasESubcategorias(produto, isEdit) {
    if (!(window.categoriasAPI && window.subcategoriasAPI)) {
        $('#categoria_id').html('<option value="">Categorias indisponíveis</option>');
        $('#subcategoria_id').html('<option value="">Subcategorias indisponíveis</option>');
        return;
    }

    function renderCategorias(categoriasComSubs) {
        window.categoriasSistema = categoriasComSubs;
        let catOptions = '<option value="">Selecione</option>';
        categoriasComSubs.forEach(cat => {
            catOptions += `<option value="${cat.id}">${escapeHtml(cat.nome || '')}</option>`;
        });
        $('#categoria_id').html(catOptions);
        if (isEdit && produto && produto.categoria_id) {
            $('#categoria_id').val(String(produto.categoria_id));
        }

        function carregarSubs(catId, selectedSubId) {
            if (!catId) {
                $('#subcategoria_id').html('<option value="">Selecione uma categoria</option>');
                return;
            }
            const cat = categoriasComSubs.find(c => String(c.id) === String(catId));
            let subOptions = '<option value="">Nenhuma</option>';
            (cat && cat.subcategorias ? cat.subcategorias : []).forEach(sub => {
                subOptions += `<option value="${sub.id}">${escapeHtml(sub.nome || '')}</option>`;
            });
            $('#subcategoria_id').html(subOptions);
            if (typeof selectedSubId !== 'undefined' && selectedSubId !== null) {
                $('#subcategoria_id').val(String(selectedSubId));
            }
        }

        $('#categoria_id').off('change').on('change', function () {
            carregarSubs($(this).val());
        });

        if (isEdit && produto && typeof produto.categoria_id !== 'undefined' && produto.categoria_id !== null) {
            let subId = '';
            if (typeof produto.subcategoria_id !== 'undefined' && produto.subcategoria_id !== null && produto.subcategoria_id !== 'null') {
                subId = String(produto.subcategoria_id);
            }
            carregarSubs(produto.categoria_id, subId);
        } else {
            $('#subcategoria_id').html('<option value="">Selecione uma categoria</option>');
        }
    }

    // Renderiza rapidamente com cache local (quando houver) e em seguida
    // sempre sincroniza da API para refletir novas subcategorias sem recarregar a página.
    if (window.categoriasSistema && Array.isArray(window.categoriasSistema) && window.categoriasSistema.length > 0) {
        renderCategorias(window.categoriasSistema);
    }

    const possuiCacheCategorias = window.categoriasSistema && Array.isArray(window.categoriasSistema) && window.categoriasSistema.length > 0;

    $.when(categoriasAPI.listar('produto'), subcategoriasAPI.listar()).done(function (categorias, subcategorias) {
        categorias = categorias[0] || [];
        subcategorias = subcategorias[0] || [];

        const categoriasComSubs = (categorias || []).map(cat => ({
            ...cat,
            subcategorias: (subcategorias || []).filter(sub => String(sub.categoria_id) === String(cat.id))
        }));

        renderCategorias(categoriasComSubs);
    }).fail(function () {
        if (possuiCacheCategorias) {
            return;
        }
        $('#categoria_id').html('<option value="">Erro ao carregar categorias</option>');
        $('#subcategoria_id').html('<option value="">Erro ao carregar subcategorias</option>');
    });
}


// Inicializa autocomplete de fornecedor
function inicializarAutocompleteFornecedor() {
    $('#fornecedor').off('input').on('input', function () {
        const termo = ($(this).val() || '').trim();
        const termoNumerico = termo.replace(/\D/g, '');
        const $lista = $('#fornecedor-autocomplete');

        if (termo.length < 2) {
            $lista.hide().html('');
            return;
        }

        $.ajax({
            url: `${API_URL}/fornecedores?busca=${encodeURIComponent(termo)}`,
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            success: function (fornecedores) {
                const termoLower = termo.toLowerCase();
                const filtrados = (fornecedores || []).filter(f => {
                    if (!f) return false;

                    const nome = String(f.nome || '').toLowerCase();
                    const razao = String(f.razao_social || '').toLowerCase();
                    const cpfCnpj = String(f.cpf_cnpj || '');
                    const cpfCnpjNumerico = cpfCnpj.replace(/\D/g, '');

                    const correspondeTexto = nome.includes(termoLower) || razao.includes(termoLower) || cpfCnpj.toLowerCase().includes(termoLower);
                    const correspondeCnpjNumerico = termoNumerico.length > 0 && cpfCnpjNumerico.includes(termoNumerico);

                    return correspondeTexto || correspondeCnpjNumerico;
                });

                if (filtrados.length === 0) {
                    $lista.hide().html('');
                    return;
                }

                let html = '';
                filtrados.forEach(f => {
                    const label = f.cpf_cnpj
                        ? `${escapeHtml(f.nome || '')} - CNPJ: ${escapeHtml(f.cpf_cnpj)}`
                        : `${escapeHtml(f.nome || '')}`;
                    html += `
                        <button
                            type="button"
                            class="list-group-item list-group-item-action fornecedor-item"
                            data-nome="${escapeHtml(f.nome)}"
                        >
                            ${label}
                        </button>
                    `;
                });

                $lista.html(html).show();

                $('.fornecedor-item').off('click').on('click', function () {
                    $('#fornecedor').val($(this).text().trim());
                    $lista.hide().html('');
                });
            },
            error: function () {
                $lista.hide().html('');
            }
        });
    });

    $('#fornecedor').off('blur').on('blur', function () {
        setTimeout(() => {
            $('#fornecedor-autocomplete').hide().html('');
        }, 200);
    });
}

// RCM-8.6.2 — UI de faixas/margem atacado removida do Cadastro de Produtos.
// Preço oficial: Linha (opcional) + Tabela da operação via Resolver; Preço de Segurança = fallback.

// Atualiza preview de estoque quando custos/preço de segurança mudam (sem formação por margem)
function sincronizarFormacaoPrecoProduto(_origem = 'init') {
    if (!$('#preco_compra').length || !$('#preco_venda').length) return;
    atualizarPreviewValorTotalEstoqueCadastro();
}

function inicializarCalculoPreco(produto, isEdit) {
    const $precoCompra = $('#preco_compra');
    const $precoVenda = $('#preco_venda');

    $precoCompra
        .off('input.precoMotor change.precoMotor')
        .on('input.precoMotor change.precoMotor', () => sincronizarFormacaoPrecoProduto('compra'));

    $precoVenda
        .off('input.precoMotor change.precoMotor')
        .on('input.precoMotor change.precoMotor', () => sincronizarFormacaoPrecoProduto('venda'));

    setTimeout(() => sincronizarFormacaoPrecoProduto('init'), 0);
}


// Salva produto
async function saveProduto() {
    const id = $('#produtoId').val();

    const saldosIniciais = obterSaldosIniciaisDoFormulario();

    sincronizarFormacaoPrecoProduto('init');
    sincronizarFlagsLegadasDaForma();

    if (!validarFormaComercializacaoAntesSalvar()) {
        return;
    }

    if ($('#produto_fracionado').is(':checked') && !unidadeVendaSuportaConversao($('#unidade').val())) {
        showNotification(
            'Forma Peso/Volume exige unidade de estoque fracionável (KG, MT, LT, M², M³, etc.).',
            'warning'
        );
        return;
    }

    const fracionadoAtivo = $('#produto_fracionado').is(':checked');
    const permiteVendaUnidade = fracionadoAtivo && $('#permite_venda_unidade').is(':checked');
    const pesoMedioUnidade = parseFloat($('#peso_medio_unidade').val()) || 0;
    const precoUnidadeVenda = parseFloat($('#preco_unidade').val()) || 0;

    if (permiteVendaUnidade && (pesoMedioUnidade <= 0 || precoUnidadeVenda <= 0)) {
        const camposPendentes = [];
        if (pesoMedioUnidade <= 0) camposPendentes.push('peso médio da unidade');
        if (precoUnidadeVenda <= 0) camposPendentes.push('preço por unidade');
        showNotification(
            `Para permitir venda por unidade, informe ${camposPendentes.join(' e ')} com valor maior que zero.`,
            'warning'
        );
        if (pesoMedioUnidade <= 0) {
            $('#peso_medio_unidade').focus();
        } else {
            $('#preco_unidade').focus();
        }
        return;
    }

    const data = {
        codigo: ($('#codigo').val() || '').trim() || (!$('#produtoId').val() ? gerarCodigoProdutoAutomatico() : ''),
        nome: ($('#nome').val() || '').trim(),
        categoria_id: $('#categoria_id').val() ? String($('#categoria_id').val()) : null,
        subcategoria_id: $('#subcategoria_id').val() ? String($('#subcategoria_id').val()) : null,
        unidade: ($('#unidade').val() || '').trim(),
        preco_compra: parseFloat($('#preco_compra').val()) || 0,
        preco_venda: parseFloat($('#preco_venda').val()) || 0,
        lucro_percentual: (() => {
            const compra = parseFloat($('#preco_compra').val()) || 0;
            const venda = parseFloat($('#preco_venda').val()) || 0;
            if (compra > 0 && venda > 0) {
                return Number((((venda - compra) / compra) * 100).toFixed(2));
            }
            return null;
        })(),
        estoque_minimo: parseFloat($('#estoque_minimo').val()) || 0,
        fornecedor: ($('#fornecedor').val() || '').trim(),
        dias_alerta_validade: parseInt($('#dias_alerta_validade').val(), 10) || 30,
        controlar_validade: $('#controlar_validade').is(':checked') ? 1 : 0,
        ncm: ($('#ncm').val() || '').trim(),
        cfop: ($('#cfop').val() || '').trim(),
        csosn: ($('#csosn').val() || '').trim(),
        origem: $('#origem').val() !== '' ? parseInt($('#origem').val(), 10) : 0,
        cest: ($('#cest').val() || '').trim(),
        codigo_barras: ($('#codigo_barras').val() || '').trim(),
        aliquota_icms: parseFloat($('#aliquota_icms').val()) || 0,
        aliquota_pis: parseFloat($('#aliquota_pis').val()) || 0,
        aliquota_cofins: parseFloat($('#aliquota_cofins').val()) || 0,
        produto_fracionado: fracionadoAtivo ? 1 : 0,
        vendido_por_peso: fracionadoAtivo ? 1 : 0,
        permite_venda_unidade: permiteVendaUnidade ? 1 : 0,
        peso_medio_unidade: permiteVendaUnidade ? pesoMedioUnidade : 0,
        preco_unidade: permiteVendaUnidade ? precoUnidadeVenda : 0,
        // RCM-8.6.2 — faixas produto_atacado fora do cadastro; canal Atacado = Tabela + Resolver
        venda_atacado: 0,
        participa_atacado: $('input[name="participa_atacado"]:checked').val() === '0' ? 0 : 1,
        // RA-6.3: cadastro não vincula produto à tabela (compat DB: sempre null no fluxo oficial)
        tabela_preco_id: null,
        linha_comercial_id: $('#linha_comercial_id').val() ? Number($('#linha_comercial_id').val()) : null,
        forma_comercializacao: obterFormaComercializacaoSelecionada(),
        unidade_venda: ($('#unidade_venda').val() || '').trim().toUpperCase() || null,
        quantidade_bolas: parseFloat($('#quantidade_bolas').val()) || parseFloat($('#bolas_max').val()) || 0,
        bolas_min: parseInt($('#bolas_min').val(), 10) || null,
        bolas_max: parseInt($('#bolas_max').val(), 10) || null,
        peso_medio_bola: parseFloat($('#peso_medio_bola').val()) || 0,
        forma_personalizada_nome: ($('#forma_personalizada_nome').val() || '').trim() || null,
        forma_personalizada_unidade: ($('#forma_personalizada_unidade').val() || '').trim() || null,
        utiliza_conversao_fisica: $('#utiliza_conversao_fisica').is(':checked') ? 1 : 0,
        unidade_conversao_fisica: $('#utiliza_conversao_fisica').is(':checked')
            ? (($('#unidade_conversao_fisica').val() || '').trim().toUpperCase() || null)
            : null,
        data_validade_inicial: ($('#data_validade_inicial').val() || '').trim() || null
    };

    if ($('#saldo_fiscal_inicial').length) {
        data.saldo_fiscal_inicial = saldosIniciais.saldo_fiscal_inicial;
        data.saldo_nao_fiscal_inicial = saldosIniciais.saldo_nao_fiscal_inicial;
    }

    data.item_fiscal = resolverItemFiscalParaSalvar(saldosIniciais);
    console.log('[AUDIT PRODUTO] Payload salvar:', JSON.stringify(data, null, 2));
    console.log('[AUDIT PRODUTO] item_fiscal enviado:', data.item_fiscal);

    // Validação para produtos com controle de validade e estoque
    const saldosProdutoModal = $('#produtoModal').data('produtoSaldos');
    const estoqueParaValidade = id && saldosProdutoModal
        ? (Number(saldosProdutoModal.saldo_fiscal || 0) + Number(saldosProdutoModal.saldo_nao_fiscal || 0) || Number(saldosProdutoModal.estoque_atual || 0))
        : saldosIniciais.estoque_total;

    if (data.controlar_validade === 1 && estoqueParaValidade > 0 && !data.data_validade_inicial) {
        showNotification('Para produtos com controle de validade e estoque, informe a data de validade.', 'warning');
        $('#data_validade_inicial').focus();
        return;
    }

    if (!data.nome) {
        showNotification('Informe o nome do produto.', 'warning');
        $('#nome').focus();
        return;
    }

    const ean = window.EAN13;
    if (data.codigo_barras) {
        data.codigo_barras = ean ? ean.stripSpaces(data.codigo_barras) : data.codigo_barras.replace(/\s+/g, '');
        if (ean && !ean.validate(data.codigo_barras)) {
            const produtoIdAtual = String($('#produtoId').val() || '');
            const original = String($('#produtoModal').data('codigoBarrasOriginal') || '');
            const legadoInalterado = Boolean(produtoIdAtual) && data.codigo_barras === ean.stripSpaces(original) && original;
            if (!legadoInalterado) {
                showNotification(ean.MSG_INVALIDO, 'warning');
                exibirErroEan13Produto(ean.MSG_INVALIDO);
                $('#codigo_barras').focus();
                return;
            }
        }
    }

    if (data.preco_venda <= 0 && !data.linha_comercial_id) {
        showNotification('Informe um Preço de Segurança válido (ou selecione uma Linha de Precificação).', 'warning');
        $('#preco_venda').focus();
        return;
    }

    if (data.preco_compra < 0) {
        showNotification('Último Custo inválido. Informe um valor maior ou igual a zero na seção Custos.', 'warning');
        $('#preco_compra').focus();
        const $custos = $('#dominioCustosProduto');
        if ($custos.length) {
            $custos[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    if (saldosIniciais.saldo_fiscal_inicial < 0 || saldosIniciais.saldo_nao_fiscal_inicial < 0) {
        showNotification('Saldos iniciais não podem ser negativos.', 'warning');
        $('#saldo_fiscal_inicial').focus();
        return;
    }

    if ($('#saldo_fiscal_inicial').length && saldosIniciais.estoque_total < 0) {
        showNotification('Estoque inicial inválido.', 'warning');
        $('#saldo_fiscal_inicial').focus();
        return;
    }

    if (data.estoque_minimo < 0) {
        showNotification('Estoque mínimo inválido.', 'warning');
        $('#estoque_minimo').focus();
        return;
    }

    const url = id ? `${API_URL}/produtos/${id}` : `${API_URL}/produtos`;
    const method = id ? 'PUT' : 'POST';

    $.ajax({
        url: url,
        method: method,
        contentType: 'application/json',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        data: JSON.stringify(data),
        success: function (produtoSalvo) {
            const eraCriacao = !id;
            // CP-E1: suspende cálculos/validações antes de fechar/limpar o modal
            window._cpe1SuspenderCalculosProduto = true;
            const finalizar = () => {
                try {
                    $('#produtoModal').off('input.previewEstoqueTotal change.previewEstoqueTotal');
                    $('#produtoModal').off('change.motorConversaoUnidades input.motorConversaoUnidades');
                    $('#produtoModal').modal('hide');
                } finally {
                    setTimeout(function () {
                        window._cpe1SuspenderCalculosProduto = false;
                    }, 400);
                }
                showNotification('Produto salvo com sucesso!', 'success');
                if (window.produtosList && Array.isArray(window.produtosList)) {
                    const produtoNormalizado = normalizarProduto(produtoSalvo, window.categoriasSistema || []);
                    const indexExistente = window.produtosList.findIndex(p => String(p.id) === String(produtoNormalizado.id));

                    if (indexExistente >= 0) {
                        window.produtosList[indexExistente] = produtoNormalizado;
                    } else {
                        window.produtosList.unshift(produtoNormalizado);
                    }

                    if (typeof renderProdutos === 'function') {
                        renderProdutos(window.produtosList);
                    }
                } else {
                    loadProdutos();
                }
            };

            if (eraCriacao && produtoSalvo?.id) {
                garantirUcPadraoAposCriacao(produtoSalvo).always(finalizar);
            } else {
                finalizar();
            }
        },
        error: function (xhr) {
            window._cpe1SuspenderCalculosProduto = false;
            const erro = xhr.responseJSON?.error || 'Erro desconhecido';
            showNotification(
                'Não foi possível salvar o produto: ' + erro + '. Corrija os dados e tente novamente.',
                'danger'
            );
        }
    });
}
window.saveProduto = saveProduto;


// Histórico de preços
function showHistoricoPrecos(produtoId) {
    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/historico-precos`,
        method: 'GET',
        success: function (rows) {
            const modalHtml = `
                <div class="modal fade" id="historicoPrecosModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Histórico de preços</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="table-responsive">
                                    <table class="table table-sm table-striped">
                                        <thead>
                                            <tr>
                                                <th>Data</th>
                                                <th>P. compra (de →)</th>
                                                <th>P. venda (de →)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${(rows && rows.length)
                                                ? rows.map(r => `
                                                    <tr>
                                                        <td>${formatDateTime(r.created_at)}</td>
                                                        <td>${formatCurrency(r.preco_compra_anterior || 0)} → ${formatCurrency(r.preco_compra_novo || 0)}</td>
                                                        <td>${formatCurrency(r.preco_venda_anterior || 0)} → ${formatCurrency(r.preco_venda_novo || 0)}</td>
                                                    </tr>
                                                `).join('')
                                                : '<tr><td colspan="3" class="text-center">Nenhuma alteração de preço registrada ainda.</td></tr>'
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#modal-container').html(modalHtml);
            $('#historicoPrecosModal').modal('show');
        },
        error: function () {
            showNotification('Erro ao carregar histórico de preços.', 'danger');
        }
    });
}
window.showHistoricoPrecos = showHistoricoPrecos;


function historicoProduto(produtoId) {
    const token = localStorage.getItem('token') || '';
    const headers = { Authorization: 'Bearer ' + token };
    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();

    Promise.all([
        fetch(`${API_URL}/produtos/${produtoId}/historico-estoque`, { headers }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${API_URL}/produtos/${produtoId}/historico-precos`, { headers }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${API_URL}/produtos/${produtoId}`, { headers }).then((r) => (r.ok ? r.json() : null))
    ])
        .then(([ajustes, precos, produto]) => {
            const nomeProduto = produto?.nome || `Produto #${produtoId}`;

            const linhasAjustes = (ajustes && ajustes.length)
                ? ajustes.map((r) => `
                    <tr>
                        <td>${formatDateTime(r.criado_em)}</td>
                        <td>${escapeHtml(r.usuario_nome || '-')}</td>
                        <td>${escapeHtml(r.motivo || '-')}</td>
                        <td class="text-end">${Number(r.ajuste_fiscal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
                        ${modoFiscal ? '' : `<td class="text-end">${Number(r.ajuste_nao_fiscal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>`}
                        <td class="text-end">${Number(r.estoque_total_antes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} → ${Number(r.estoque_total_depois || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
                    </tr>
                `).join('')
                : `<tr><td colspan="${modoFiscal ? 5 : 6}" class="text-center text-muted">Nenhum ajuste de estoque registrado.</td></tr>`;

            const linhasPrecos = (precos && precos.length)
                ? precos.map((r) => `
                    <tr>
                        <td>${formatDateTime(r.created_at)}</td>
                        <td>${formatCurrency(r.preco_compra_anterior || 0)} → ${formatCurrency(r.preco_compra_novo || 0)}</td>
                        <td>${formatCurrency(r.preco_venda_anterior || 0)} → ${formatCurrency(r.preco_venda_novo || 0)}</td>
                    </tr>
                `).join('')
                : '<tr><td colspan="3" class="text-center text-muted">Nenhuma alteração de preço registrada.</td></tr>';

            const modalHtml = `
                <div class="modal fade" id="historicoProdutoModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-xl modal-dialog-scrollable">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Histórico — ${escapeHtml(nomeProduto)}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <ul class="nav nav-tabs mb-3" role="tablist">
                                    <li class="nav-item" role="presentation">
                                        <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#hist-ajustes" type="button">Ajustes de Estoque</button>
                                    </li>
                                    <li class="nav-item" role="presentation">
                                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#hist-precos" type="button">Preços</button>
                                    </li>
                                </ul>
                                <div class="tab-content">
                                    <div class="tab-pane fade show active" id="hist-ajustes">
                                        <div class="table-responsive">
                                            <table class="table table-sm table-striped">
                                                <thead>
                                                    <tr>
                                                        <th>Data</th>
                                                        <th>Usuário</th>
                                                        <th>Motivo</th>
                                                        <th class="text-end">Ajuste Fiscal</th>
                                                        ${modoFiscal ? '' : '<th class="text-end">Ajuste Não Fiscal</th>'}
                                                        <th class="text-end">Total (antes → depois)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>${linhasAjustes}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="hist-precos">
                                        <div class="table-responsive">
                                            <table class="table table-sm table-striped">
                                                <thead>
                                                    <tr>
                                                        <th>Data</th>
                                                        <th>P. compra (de →)</th>
                                                        <th>P. venda (de →)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>${linhasPrecos}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#historicoProdutoModal').remove();
            $('#modal-container').append(modalHtml);
            $('#historicoProdutoModal').modal('show');
        })
        .catch(() => {
            showNotification('Erro ao carregar histórico do produto.', 'danger');
        });
}
window.historicoProduto = historicoProduto;


// Excluir produto
function deleteProduto(id) {
    if (!confirm('Tem certeza que deseja excluir este produto?')) {
        return;
    }

    $.ajax({
        url: `${API_URL}/produtos/${id}`,
        method: 'DELETE',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function () {
            showNotification('Produto excluído com sucesso!', 'success');
            loadProdutos();
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || 'Erro desconhecido';
            showNotification('Erro ao excluir produto: ' + erro, 'danger');
        }
    });
}
window.deleteProduto = deleteProduto;

function alterarStatusAtivoProdutoUi(id, ativo) {
    const habilitar = Number(ativo) === 1;
    const acaoLabel = habilitar ? 'reabilitar' : 'desabilitar';
    const msgConfirm = habilitar
        ? 'Reabilitar este produto? Ele voltará a aparecer no PDV e nas buscas.'
        : 'Desabilitar este produto?\n\nA linha ficará cinza/desabilitada e o produto deixará de aparecer no PDV e nas buscas. Você poderá reabilitar depois.';

    if (!confirm(msgConfirm)) {
        return;
    }

    $.ajax({
        url: `${API_URL}/produtos/${id}/${habilitar ? 'ativar' : 'desativar'}`,
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (resp) {
            showNotification(
                resp?.message || (habilitar ? 'Produto reabilitado.' : 'Produto desabilitado.'),
                'success'
            );
            loadProdutos();
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || 'Erro desconhecido';
            showNotification(`Erro ao ${acaoLabel} produto: ` + erro, 'danger');
        }
    });
}

function desabilitarProduto(id) {
    alterarStatusAtivoProdutoUi(id, 0);
}
window.desabilitarProduto = desabilitarProduto;

function habilitarProduto(id) {
    alterarStatusAtivoProdutoUi(id, 1);
}
window.habilitarProduto = habilitarProduto;

function alterarStatusCategoriaProdutosUi(id, ativar, nomeCategoria) {
    const habilitar = Number(ativar) === 1;
    const nome = nomeCategoria || 'esta categoria';
    const msg = habilitar
        ? `Reabilitar a categoria "${nome}"?\n\nTodos os produtos e subcategorias dela voltarão a poder ser vendidos e receber estoque.`
        : `Desabilitar a categoria "${nome}" por completo?\n\nTodos os produtos dela serão desabilitados e não poderão ser vendidos nem gerar/ajustar estoque enquanto a categoria estiver desabilitada.`;

    if (!confirm(msg)) return;

    $.ajax({
        url: `${API_URL}/categorias/${id}/${habilitar ? 'ativar' : 'desativar'}`,
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (resp) {
            const qtd = habilitar
                ? Number(resp?.produtos_habilitados || 0)
                : Number(resp?.produtos_desabilitados || 0);
            showNotification(
                resp?.message ||
                    (habilitar
                        ? `Categoria reabilitada (${qtd} produto(s)).`
                        : `Categoria desabilitada (${qtd} produto(s)).`),
                'success'
            );
            loadProdutos();
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.erro || xhr.responseJSON?.error || 'Erro desconhecido';
            showNotification(
                `Erro ao ${habilitar ? 'habilitar' : 'desabilitar'} categoria: ` + erro,
                'danger'
            );
        }
    });
}

function desabilitarCategoriaProdutos(id, nome) {
    alterarStatusCategoriaProdutosUi(id, 0, nome);
}
window.desabilitarCategoriaProdutos = desabilitarCategoriaProdutos;

function habilitarCategoriaProdutos(id, nome) {
    alterarStatusCategoriaProdutosUi(id, 1, nome);
}
window.habilitarCategoriaProdutos = habilitarCategoriaProdutos;


// Editar produto
function editProduto(id) {
    $.ajax({
        url: `${API_URL}/produtos/${id}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (produto) {
            showProdutoModal(produto);
        },
        error: function () {
            showNotification('Erro ao carregar produto para edição.', 'danger');
        }
    });
}
window.editProduto = editProduto;


function abrirModalAjustarEstoque(produtoId) {
    if (!podeAjustarEstoque()) {
        showNotification('Acesso restrito: apenas ADMIN ou SUPER_ADMIN podem ajustar estoque.', 'warning');
        return;
    }

    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (produto) {
            const saldoFiscal = Number(produto.saldo_fiscal ?? 0);
            const saldoNaoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
            const estoqueTotal = Number(produto.estoque_atual ?? (saldoFiscal + saldoNaoFiscal));
            const unidade = produto.unidade || '';
            const opcoesFormato = { produtoFracionado: produtoUsaConversaoUnidades(produto) };
            const stepAjuste = obterStepEstoqueProduto(unidade, opcoesFormato.produtoFracionado);
            const controlaValidade = Number(produto.controlar_validade || 0) === 1;
            const usaFisica = Number(produto.utiliza_conversao_fisica || 0) === 1;

            const camposFiscal = modoFiscal ? `
                <div class="col-md-6 mb-3">
                    <label class="form-label">Saldo Fiscal Atual</label>
                    <input type="text" class="form-control bg-light" id="ajuste_saldo_fiscal_atual" readonly value="${formatarEstoqueProduto(saldoFiscal, unidade, opcoesFormato)}">
                </div>
                <div class="col-md-6 mb-3">
                    <label for="ajuste_fiscal" class="form-label">Ajuste Fiscal (+/-)</label>
                    <input type="number" step="${stepAjuste}" class="form-control" id="ajuste_fiscal" value="0">
                </div>
            ` : `
                <div class="col-md-4 mb-3">
                    <label class="form-label">Saldo Fiscal Atual</label>
                    <input type="text" class="form-control bg-light" id="ajuste_saldo_fiscal_atual" readonly value="${formatarEstoqueProduto(saldoFiscal, unidade, opcoesFormato)}">
                </div>
                <div class="col-md-4 mb-3">
                    <label class="form-label">Saldo Não Fiscal Atual</label>
                    <input type="text" class="form-control bg-light" id="ajuste_saldo_nao_fiscal_atual" readonly value="${formatarEstoqueProduto(saldoNaoFiscal, unidade, opcoesFormato)}">
                </div>
                <div class="col-md-4 mb-3">
                    <label class="form-label">Estoque Total</label>
                    <input type="text" class="form-control bg-light" id="ajuste_estoque_total_atual" readonly value="${formatarEstoqueProduto(estoqueTotal, unidade, opcoesFormato)}">
                </div>
                <div class="col-md-6 mb-3">
                    <label for="ajuste_fiscal" class="form-label">Ajuste Fiscal (+/-)</label>
                    <input type="number" step="${stepAjuste}" class="form-control" id="ajuste_fiscal" value="0">
                </div>
                <div class="col-md-6 mb-3">
                    <label for="ajuste_nao_fiscal" class="form-label">Ajuste Não Fiscal (+/-)</label>
                    <input type="number" step="${stepAjuste}" class="form-control" id="ajuste_nao_fiscal" value="0">
                </div>
            `;

            const camposValidade = controlaValidade ? `
                <div class="col-12"><hr class="my-2"><small class="text-muted">Produto com controle de validade — informe validade em ajustes positivos.</small></div>
                <div class="col-md-4 mb-3">
                    <label for="ajuste_lote" class="form-label">Lote</label>
                    <input type="text" class="form-control" id="ajuste_lote" value="">
                </div>
                <div class="col-md-4 mb-3">
                    <label for="ajuste_data_fabricacao" class="form-label">Data Fabricação</label>
                    <input type="date" class="form-control" id="ajuste_data_fabricacao" value="">
                </div>
                <div class="col-md-4 mb-3">
                    <label for="ajuste_data_validade" class="form-label">Data Validade</label>
                    <input type="date" class="form-control" id="ajuste_data_validade" value="">
                </div>
            ` : '';

            const modalHtml = `
                <div class="modal fade" id="ajustarEstoqueModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Ajustar Estoque — ${escapeHtml(produto.nome || '')}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <form id="ajustarEstoqueForm">
                                    <input type="hidden" id="ajuste_produto_id" value="${produtoId}">
                                    <input type="hidden" id="ajuste_controla_validade" value="${controlaValidade ? 1 : 0}">
                                    <input type="hidden" id="ajuste_unidade_base" value="${escapeHtml(unidade)}">
                                    <input type="hidden" id="ajuste_utiliza_fisica" value="${usaFisica ? 1 : 0}">
                                    <div class="row">
                                        <div class="col-md-6 mb-3">
                                            <label for="ajuste_unidade_origem" class="form-label">Unidade do Ajuste *</label>
                                            <select class="form-select" id="ajuste_unidade_origem">
                                                <option value="${escapeHtml(unidade)}">${escapeHtml(unidade || 'UN')} (base)</option>
                                            </select>
                                            <small class="text-muted">Unidades carregadas pelo MCC — sem lista fixa.</small>
                                        </div>
                                        <div class="col-md-6 mb-3 d-flex align-items-end">
                                            <div id="ajuste_aviso_fisica" class="small text-muted ${usaFisica ? '' : 'd-none'}">
                                                Conversão Física: informe apenas a quantidade. A conversão é feita automaticamente pelo sistema.
                                            </div>
                                        </div>
                                        ${camposFiscal}
                                        <div class="col-12 mb-3">
                                            <div class="card border-0 bg-light">
                                                <div class="card-body py-2" id="ajuste_preview_mcc">
                                                    <div class="small text-muted mb-1">Preview (MCC)</div>
                                                    <div><strong>Quantidade Informada:</strong> <span id="prev_qtd_informada">—</span></div>
                                                    <div><strong>Quantidade Base:</strong> <span id="prev_qtd_base">—</span></div>
                                                    <div><strong>Saldo Atual:</strong> <span id="prev_saldo_atual">—</span></div>
                                                    <div><strong>Saldo Final:</strong> <span id="prev_saldo_final">—</span></div>
                                                    <div id="prev_erro" class="text-danger small mt-1 d-none"></div>
                                                </div>
                                            </div>
                                        </div>
                                        ${camposValidade}
                                        <div class="col-12 mb-3">
                                            <label for="ajuste_motivo" class="form-label">Motivo *</label>
                                            <textarea class="form-control" id="ajuste_motivo" rows="2" required placeholder="Descreva o motivo do ajuste"></textarea>
                                        </div>
                                        <div class="col-12">
                                            <div class="alert alert-warning py-2 mb-0 d-none" id="ajuste_erro_local"></div>
                                        </div>
                                    </div>
                                </form>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                                <button type="button" class="btn btn-primary" id="btnConfirmarAjusteEstoque">Confirmar Ajuste</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#ajustarEstoqueModal').remove();
            const host = document.body || document.getElementById('modal-container');
            host.insertAdjacentHTML('beforeend', modalHtml);
            const modalEl = document.getElementById('ajustarEstoqueModal');
            modalEl.style.zIndex = '2060';
            const confirmar = document.getElementById('btnConfirmarAjusteEstoque');
            if (confirmar) {
                confirmar.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    salvarAjusteEstoque();
                });
            }
            const formAjuste = document.getElementById('ajustarEstoqueForm');
            if (formAjuste) {
                formAjuste.addEventListener('submit', (ev) => {
                    ev.preventDefault();
                    salvarAjusteEstoque();
                });
            }
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                const instancia = bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: true, keyboard: true, focus: true });
                modalEl.addEventListener('shown.bs.modal', () => {
                    if (window.electronAPI && typeof window.electronAPI.forcarReflow === 'function') {
                        window.electronAPI.forcarReflow();
                    }
                    const campo = document.getElementById('ajuste_fiscal');
                    if (campo) campo.focus();
                }, { once: true });
                instancia.show();
            }

            carregarUnidadesAjusteEstoque(produtoId, unidade).then(() => {
                atualizarPreviewAjusteEstoque();
            });

            $('#ajuste_fiscal, #ajuste_nao_fiscal, #ajuste_unidade_origem').off('input.ajusteMcc change.ajusteMcc')
                .on('input.ajusteMcc change.ajusteMcc', () => atualizarPreviewAjusteEstoque());
        },
        error: function () {
            showNotification('Erro ao carregar produto para ajuste de estoque.', 'danger');
        }
    });
}
window.abrirModalAjustarEstoque = abrirModalAjustarEstoque;

function carregarUnidadesAjusteEstoque(produtoId, unidadeFallback) {
    return $.ajax({
        url: `${API_URL}/produtos/${produtoId}/ajuste-estoque/unidades`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        }
    }).then((meta) => {
        const $sel = $('#ajuste_unidade_origem');
        if (!$sel.length) return meta;
        $sel.empty();
        const unidades = Array.isArray(meta?.unidades) ? meta.unidades : [];
        if (!unidades.length) {
            const base = meta?.unidade_base || unidadeFallback || 'UN';
            $sel.append(`<option value="${escapeHtml(base)}">${escapeHtml(base)} (base)</option>`);
            return meta;
        }
        unidades.forEach((u) => {
            const cod = String(u.unidade_comercial || '').toUpperCase();
            const desc = u.descricao || cod;
            $sel.append(`<option value="${escapeHtml(cod)}">${escapeHtml(desc)}</option>`);
        });
        if (meta.utiliza_conversao_fisica) {
            $('#ajuste_aviso_fisica').removeClass('d-none');
            if (!meta.tem_conversao_fisica_ativa) {
                $('#ajuste_aviso_fisica').html(
                    'Conversão Física sem lote ativo: ajuste em Unidade Base ou registre a física na Entrada.'
                );
            }
        }
        return meta;
    }).catch(() => {
        const base = unidadeFallback || 'UN';
        const $sel = $('#ajuste_unidade_origem');
        if ($sel.length && $sel.find('option').length === 0) {
            $sel.append(`<option value="${escapeHtml(base)}">${escapeHtml(base)} (base)</option>`);
        }
        return null;
    });
}
window.carregarUnidadesAjusteEstoque = carregarUnidadesAjusteEstoque;

let _previewAjusteTimer = null;
function atualizarPreviewAjusteEstoque() {
    clearTimeout(_previewAjusteTimer);
    _previewAjusteTimer = setTimeout(() => {
        const produtoId = $('#ajuste_produto_id').val();
        if (!produtoId) return;
        const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();
        const payload = {
            unidade_origem: $('#ajuste_unidade_origem').val(),
            quantidade_fiscal: parseFloat($('#ajuste_fiscal').val()) || 0,
            quantidade_nao_fiscal: modoFiscal ? 0 : (parseFloat($('#ajuste_nao_fiscal').val()) || 0)
        };
        if (payload.quantidade_fiscal === 0 && payload.quantidade_nao_fiscal === 0) {
            $('#prev_qtd_informada, #prev_qtd_base, #prev_saldo_atual, #prev_saldo_final').text('—');
            $('#prev_erro').addClass('d-none').text('');
            return;
        }
        $.ajax({
            url: `${API_URL}/produtos/${produtoId}/ajuste-estoque/preview`,
            method: 'POST',
            contentType: 'application/json',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            data: JSON.stringify(payload),
            success: function (prev) {
                $('#prev_erro').addClass('d-none').text('');
                const t = prev.preview_texto || {};
                $('#prev_qtd_informada').text(t.quantidade_informada || '—');
                $('#prev_qtd_base').text(t.quantidade_base || '—');
                $('#prev_saldo_atual').text(t.saldo_atual || '—');
                $('#prev_saldo_final').text(t.saldo_final || '—');
            },
            error: function (xhr) {
                const erro = xhr.responseJSON?.error || 'Falha no preview MCC';
                $('#prev_erro').removeClass('d-none').text(erro);
                $('#prev_qtd_informada, #prev_qtd_base, #prev_saldo_atual, #prev_saldo_final').text('—');
            }
        });
    }, 280);
}
window.atualizarPreviewAjusteEstoque = atualizarPreviewAjusteEstoque;

function avisoAjusteEstoque(mensagem, foco) {
    const caixa = document.getElementById('ajuste_erro_local');
    if (caixa) {
        caixa.textContent = mensagem;
        caixa.classList.remove('d-none');
    }
    if (typeof showNotification === 'function') showNotification(mensagem, 'warning');
    if (foco) {
        const campo = document.getElementById(foco);
        if (campo) campo.focus();
    }
}

function salvarAjusteEstoque() {
    const produtoId = $('#ajuste_produto_id').val();
    const motivo = ($('#ajuste_motivo').val() || '').trim();
    const ajusteFiscal = parseFloat($('#ajuste_fiscal').val()) || 0;
    const ajusteNaoFiscal = parseFloat($('#ajuste_nao_fiscal').val()) || 0;
    const controlaValidade = $('#ajuste_controla_validade').val() === '1';
    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();
    const unidadeOrigem = ($('#ajuste_unidade_origem').val() || '').trim();
    const caixa = document.getElementById('ajuste_erro_local');
    if (caixa) caixa.classList.add('d-none');

    if (!motivo) {
        avisoAjusteEstoque('Informe o motivo do ajuste.', 'ajuste_motivo');
        return;
    }

    if (ajusteFiscal === 0 && ajusteNaoFiscal === 0) {
        avisoAjusteEstoque('Informe um ajuste diferente de zero no campo Ajuste Fiscal.', 'ajuste_fiscal');
        return;
    }

    if (!unidadeOrigem) {
        avisoAjusteEstoque('Selecione a unidade do ajuste.', 'ajuste_unidade_origem');
        return;
    }

    const ajustePositivo = Math.max(0, ajusteFiscal) + Math.max(0, (modoFiscal ? 0 : ajusteNaoFiscal));
    if (controlaValidade && ajustePositivo > 0 && !($('#ajuste_data_validade').val() || '').trim()) {
        showNotification('Informe a data de validade para ajuste positivo em produto com controle de validade.', 'warning');
        $('#ajuste_data_validade').focus();
        return;
    }

    const payload = {
        unidade_origem: unidadeOrigem,
        ajuste_fiscal: ajusteFiscal,
        ajuste_nao_fiscal: modoFiscal ? 0 : ajusteNaoFiscal,
        motivo
    };

    if (controlaValidade) {
        payload.lote = ($('#ajuste_lote').val() || '').trim() || undefined;
        payload.data_fabricacao = ($('#ajuste_data_fabricacao').val() || '').trim() || undefined;
        payload.data_validade = ($('#ajuste_data_validade').val() || '').trim() || undefined;
    }

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/ajustar-estoque`,
        method: 'POST',
        contentType: 'application/json',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        data: JSON.stringify(payload),
        success: function () {
            $('#ajustarEstoqueModal').modal('hide');
            showNotification('Estoque ajustado com sucesso!', 'success');
            loadProdutos();
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || 'Erro desconhecido';
            showNotification('Erro ao ajustar estoque: ' + erro, 'danger');
        }
    });
}
window.salvarAjusteEstoque = salvarAjusteEstoque;


// Visualizar produto
function viewProduto(id) {
    const modoFiscal = typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0';

    $.ajax({
        url: `${API_URL}/produtos/${id}?modo_fiscal=${modoFiscal}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (produto) {
            const produtoNormalizado = normalizarProduto(produto, window.categoriasSistema || []);
            const modalHtml = `
                <div class="modal fade" id="viewProdutoModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header d-flex align-items-center justify-content-between">
                                <h5 class="modal-title">Detalhes do Produto</h5>
                                <div class="d-flex gap-2">
                                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="minimizarModal('viewProdutoModal')" title="Minimizar">
                                        <i class="fas fa-window-minimize"></i>
                                    </button>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                </div>
                            </div>
                            <div class="modal-body">
                                <p><strong>Nome:</strong> ${escapeHtml(produtoNormalizado.nome || '-')}</p>
                                <p><strong>Código:</strong> ${escapeHtml(produtoNormalizado.codigo || '-')}</p>
                                <p><strong>Grupo Comercial:</strong> ${escapeHtml(produtoNormalizado.categoria || '-')}</p>
                                <p><strong>Subcategoria:</strong> ${escapeHtml(produtoNormalizado.subcategoria || '-')}</p>
                                <p><strong>Unidade Base:</strong> ${escapeHtml(produtoNormalizado.unidade || '-')}</p>
                                <p><strong>Linha de Precificação:</strong> ${
                                    produto.linha_comercial_id
                                        ? escapeHtml(
                                            (produto.linha_comercial_descricao || produto.linha_comercial_codigo || ('#' + produto.linha_comercial_id))
                                          )
                                        : '<em>Produto com precificação própria</em>'
                                }</p>
                                <p><strong>Conversão de Unidades:</strong> ${produtoUsaConversaoUnidades(produtoNormalizado) ? 'Sim (venda fracionada)' : 'Não'}</p>
                                <p><strong>Preço de Compra:</strong> ${
                                    produtoUsaConversaoUnidades(produtoNormalizado)
                                        ? `R$ ${formatarCustoUnitarioCadastro(produtoNormalizado.preco_compra, true)} / ${escapeHtml(String(produtoNormalizado.unidade || 'un').toUpperCase())}`
                                        : formatCurrency(produtoNormalizado.preco_compra || 0)
                                }</p>
                                <p><strong>Preço de Segurança:</strong> ${formatCurrency(produtoNormalizado.preco_venda || 0)}</p>
                                ${formatarEstoqueDetalheProduto(produto)}
                                <p><strong>Estoque Mínimo:</strong> ${Number(produtoNormalizado.estoque_minimo || 0)}</p>
                                <p><strong>Fornecedor:</strong> ${escapeHtml(produtoNormalizado.fornecedor || '-')}</p>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#modal-container').html(modalHtml);
            $('#viewProdutoModal').modal('show');
        },
        error: function () {
            showNotification('Erro ao carregar detalhes do produto.', 'danger');
        }
    });
}
window.viewProduto = viewProduto;

// ============================================
// FUNÇÕES DE PROMOÇÕES INTELIGENTES
// ============================================

/**
 * Carrega dados do dashboard de promoções (card)
 */
async function carregarDashboardPromocoes() {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/dashboard`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            console.error('Erro ao carregar dashboard de promoções');
            return;
        }

        const dados = await response.json();

        // Atualizar elementos do card
        $('#qtdSugestoesProdutos').text(dados.sugestoes_pendentes || 0);
        $('#qtdPromocoesProdutos').text(dados.promocoes_ativas || 0);
    } catch (error) {
        console.error('Erro ao carregar dashboard de promoções:', error);
    }
}

function formatarMoedaPromocao(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

async function carregarEstatisticasPromocoes() {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/dashboard`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            console.error('Erro ao carregar estatísticas de promoções');
            return;
        }

        const dados = await response.json();

        $('#statsPromocoesCriadas').text(dados.promocoes_criadas || 0);
        $('#statsProdutosSalvosVencimento').text(dados.produtos_salvos_vencimento || 0);
        $('#statsReceitaGerada').text(`R$ ${formatarMoedaPromocao(dados.receita_gerada || 0)}`);
        $('#statsPerdasEvitadas').text(`R$ ${formatarMoedaPromocao(dados.perdas_evitadas || 0)}`);
    } catch (error) {
        console.error('Erro ao carregar estatísticas de promoções:', error);
    }
}

/**
 * Abre modal com sugestões de promoções
 */
async function abrirModalPromocoesProdutos() {
    // Limpar modal anterior
    $('#modalPromocoesProdutos').remove();

    const modalHtml = `
        <div class="modal fade" id="modalPromocoesProdutos" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Promoções Inteligentes - Sugestões</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <ul class="nav nav-tabs" id="abas-promocoes" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active" id="aba-sugestoes" data-bs-toggle="tab" data-bs-target="#painel-sugestoes" type="button" role="tab" aria-controls="painel-sugestoes" aria-selected="true">
                                    Sugestões
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="aba-ativas" data-bs-toggle="tab" data-bs-target="#painel-ativas" type="button" role="tab" aria-controls="painel-ativas" aria-selected="false">
                                    Ativas
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="aba-encerradas" data-bs-toggle="tab" data-bs-target="#painel-encerradas" type="button" role="tab" aria-controls="painel-encerradas" aria-selected="false">
                                    Encerradas
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="aba-estatisticas" data-bs-toggle="tab" data-bs-target="#painel-estatisticas" type="button" role="tab" aria-controls="painel-estatisticas" aria-selected="false">
                                    Estatísticas
                                </button>
                            </li>
                        </ul>

                        <div class="tab-content mt-3" id="conteudo-abas-promocoes">
                            <!-- ABA SUGESTÕES -->
                            <div class="tab-pane fade show active" id="painel-sugestoes" role="tabpanel" aria-labelledby="aba-sugestoes">
                                <div id="lista-sugestoes" class="spinner-wrapper">
                                    <div class="text-center">
                                        <div class="spinner-border spinner-border-sm text-primary"></div>
                                        <p class="text-muted mt-2">Carregando sugestões...</p>
                                    </div>
                                </div>
                            </div>

                            <!-- ABA ATIVAS -->
                            <div class="tab-pane fade" id="painel-ativas" role="tabpanel" aria-labelledby="aba-ativas">
                                <div id="lista-promocoes-ativas" class="spinner-wrapper">
                                    <div class="text-center">
                                        <div class="spinner-border spinner-border-sm text-primary"></div>
                                        <p class="text-muted mt-2">Carregando promoções ativas...</p>
                                    </div>
                                </div>
                            </div>

                            <!-- ABA ENCERRADAS -->
                            <div class="tab-pane fade" id="painel-encerradas" role="tabpanel" aria-labelledby="aba-encerradas">
                                <div id="lista-promocoes-encerradas" class="spinner-wrapper">
                                    <div class="text-center">
                                        <div class="spinner-border spinner-border-sm text-primary"></div>
                                        <p class="text-muted mt-2">Carregando promoções encerradas...</p>
                                    </div>
                                </div>
                            </div>

                            <!-- ABA ESTATÍSTICAS -->
                            <div class="tab-pane fade" id="painel-estatisticas" role="tabpanel" aria-labelledby="aba-estatisticas">
                                <div class="row g-3">
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Promoções criadas</p>
                                                <p class="h5 fw-bold mb-0" id="statsPromocoesCriadas">0</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Produtos salvos do vencimento</p>
                                                <p class="h5 fw-bold mb-0" id="statsProdutosSalvosVencimento">0</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Receita gerada por promoções</p>
                                                <p class="h5 fw-bold mb-0" id="statsReceitaGerada">R$ 0,00</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Perdas evitadas</p>
                                                <p class="h5 fw-bold mb-0" id="statsPerdasEvitadas">R$ 0,00</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-warning" onclick="verificarPromocoeExpiradas()">
                            <i class="fas fa-exclamation-triangle"></i> Verificar Expiradas
                        </button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                        <button type="button" class="btn btn-primary" onclick="abrirModalGerarSugestoesAvancado()">
                            <i class="fas fa-magic"></i> Gerar Sugestões
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Adicionar modal ao DOM
    if (!$('#modal-container').length) {
        $('body').append('<div id="modal-container"></div>');
    }
    $('#modal-container').html(modalHtml);

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalPromocoesProdutos'));
    modal.show();

    // Carregar dados das três abas e as estatísticas da promoção inteligente
    carregarEstatisticasPromocoes();
    carregarSugestoesPromocoes(true);
    carregarPromocoes('ativas');
    carregarPromocoes('encerradas');
}

window.abrirModalPromocoesProdutos = abrirModalPromocoesProdutos;

/**
 * Abre modal avançado para gerar sugestões com seleção de produtos e desconto customizável
 */
async function abrirModalGerarSugestoesAvancado() {
    // Limpar modal anterior
    $('#modalGerarSugestoesAvancado').remove();

    const modalHtml = `
        <div class="modal fade" id="modalGerarSugestoesAvancado" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-cog"></i> Gerar Sugestões de Promoções
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <!-- Seção de Desconto -->
                        <div class="mb-4">
                            <label for="descontoPercentual" class="form-label">
                                <strong>Desconto Percentual (%)</strong>
                            </label>
                            <div class="input-group">
                                <input type="number" class="form-control" id="descontoPercentual" 
                                    value="15" min="1" max="100" step="0.5">
                                <span class="input-group-text">%</span>
                            </div>
                            <small class="form-text text-muted">Deixe em branco para usar o desconto padrão (15%)</small>
                        </div>

                        <!-- Seção de Seleção de Produtos -->
                        <div class="mb-3">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <label class="form-label mb-0">
                                    <strong>Selecionar Produtos</strong>
                                </label>
                                <div>
                                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="selecionarTodosProdutosAvancado()">
                                        Selecionar Todos
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="desseleccionarTodosProdutosAvancado()">
                                        Desselecionar Todos
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Lista de Produtos com Checkboxes -->
                        <div id="listaProdutosAvancado" class="border rounded p-3" style="max-height: 300px; overflow-y: auto;">
                            <div class="text-center">
                                <div class="spinner-border spinner-border-sm text-primary"></div>
                                <p class="text-muted mt-2">Carregando produtos...</p>
                            </div>
                        </div>

                        <small class="form-text text-muted d-block mt-2">
                            <strong id="qtdProdutosSelecionados">0</strong> produtos selecionados.
                            Elegíveis por validade (até 7 dias) ou giro baixo (15+ dias sem venda).
                        </small>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="gerarSugestoesAvancado()">
                            <i class="fas fa-check-circle"></i> Gerar Sugestões
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Adicionar modal ao DOM
    if (!$('#modal-container-avancado').length) {
        $('body').append('<div id="modal-container-avancado"></div>');
    }
    $('#modal-container-avancado').html(modalHtml);

    // Fechar modal de sugestões anterior, se estiver aberto
    const modalSugestoesEl = document.getElementById('modalPromocoesProdutos');
    if (modalSugestoesEl) {
        const modalSugestoes = bootstrap.Modal.getInstance(modalSugestoesEl) || new bootstrap.Modal(modalSugestoesEl);
        modalSugestoes.hide();
    }

    // Mostrar modal avançado
    const modal = new bootstrap.Modal(document.getElementById('modalGerarSugestoesAvancado'));
    modal.show();

    // Carregar produtos elegíveis para promoção (validade + giro)
    await carregarProdutosElegiveisPromocao();
}

window.abrirModalGerarSugestoesAvancado = abrirModalGerarSugestoesAvancado;

function montarDetalheProdutoElegivel(produto) {
    if (Number(produto.controlar_validade) === 1 && Number.isFinite(Number(produto.dias_para_vencer))) {
        const dias = Number(produto.dias_para_vencer);
        if (dias < 0) {
            return `Validade: venceu há ${Math.abs(dias)} dia(s)`;
        }
        if (dias === 0) {
            return 'Validade: vence hoje';
        }
        return `Validade: ${dias} dia(s) para vencer`;
    }

    if (Number.isFinite(Number(produto.dias_sem_venda))) {
        return `Sem venda há ${produto.dias_sem_venda} dia(s)`;
    }

    if (String(produto.motivo || '').includes('Nunca Vendeu')) {
        return 'Nunca vendido';
    }

    return 'Elegível para promoção';
}

/**
 * Carrega produtos elegíveis para sugestão (validade ou giro baixo)
 */
async function carregarProdutosElegiveisPromocao() {
    const container = $('#listaProdutosAvancado');

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/produtos-elegiveis`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar produtos elegíveis');
        }

        const produtosElegiveis = await response.json();

        if (!produtosElegiveis || produtosElegiveis.length === 0) {
            container.html(`
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> Nenhum produto elegível no momento.
                    Produtos entram aqui por validade próxima/vencida ou por giro baixo (15+ dias sem venda).
                </div>
            `);
            return;
        }

        let html = '<div class="list-group">';

        produtosElegiveis.forEach(p => {
            const detalhe = montarDetalheProdutoElegivel(p);

            html += `
                <label class="list-group-item">
                    <div class="d-flex align-items-center">
                        <input type="checkbox" class="form-check-input me-3 checkbox-produto-avancado" 
                            value="${p.id}" data-nome="${escapeHtml(p.nome)}" data-preco="${p.preco_venda}">
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between align-items-start gap-2">
                                <strong>${escapeHtml(p.nome)}</strong>
                                ${formatarBadgeMotivoSugestao(p.motivo)}
                            </div>
                            <small class="text-muted">
                                ${escapeHtml(detalhe)} |
                                Estoque: ${formatarEstoqueExibicaoTela(p)} |
                                Preço: ${formatCurrency(p.preco_venda || 0)}
                            </small>
                        </div>
                    </div>
                </label>
            `;
        });

        html += '</div>';
        container.html(html);

        $('.checkbox-produto-avancado').on('change', atualizarContadorProdutosSelecionados);
        atualizarContadorProdutosSelecionados();
    } catch (error) {
        console.error('Erro ao carregar produtos elegíveis:', error);
        container.html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> Erro ao carregar produtos elegíveis.
            </div>
        `);
    }
}

window.carregarProdutosElegiveisPromocao = carregarProdutosElegiveisPromocao;

/** @deprecated Use carregarProdutosElegiveisPromocao */
async function carregarProdutosComValidade() {
    return carregarProdutosElegiveisPromocao();
}

window.carregarProdutosComValidade = carregarProdutosComValidade;

/**
 * Atualiza contador de produtos selecionados
 */
function atualizarContadorProdutosSelecionados() {
    const qtd = $('.checkbox-produto-avancado:checked').length;
    $('#qtdProdutosSelecionados').text(qtd);
}

/**
 * Seleciona todos os produtos
 */
function selecionarTodosProdutosAvancado() {
    $('.checkbox-produto-avancado').prop('checked', true);
    atualizarContadorProdutosSelecionados();
}

window.selecionarTodosProdutosAvancado = selecionarTodosProdutosAvancado;

/**
 * Desseleciona todos os produtos
 */
function desseleccionarTodosProdutosAvancado() {
    $('.checkbox-produto-avancado').prop('checked', false);
    atualizarContadorProdutosSelecionados();
}

window.desseleccionarTodosProdutosAvancado = desseleccionarTodosProdutosAvancado;

/**
 * Gera sugestões com opções avançadas (múltiplos produtos e desconto customizável)
 */
async function gerarSugestoesAvancado() {
    // Obter produtos selecionados
    const produtosSelecionados = $('.checkbox-produto-avancado:checked').map(function() {
        return parseInt($(this).val());
    }).get();

    if (produtosSelecionados.length === 0) {
        showNotification('Selecione pelo menos um produto', 'warning');
        return;
    }

    // Obter desconto percentual
    const desconto = parseFloat($('#descontoPercentual').val()) || 15;

    if (desconto <= 0 || desconto > 100) {
        showNotification('Desconto deve estar entre 1% e 100%', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/gerar-sugestoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({
                produto_ids: produtosSelecionados,
                desconto_percentual: desconto
            })
        });

        if (!response.ok) {
            throw new Error('Erro ao gerar sugestões');
        }

        const resultado = await response.json();
        showNotification(
            resultado.message || `${resultado.total} sugestão(ões) gerada(s).`,
            resultado.total > 0 ? 'success' : 'info'
        );
        
        // Fechar modal
        bootstrap.Modal.getInstance(document.getElementById('modalGerarSugestoesAvancado')).hide();

        // Recarregar dados
        carregarSugestoesPromocoes();
        carregarDashboardPromocoes();
    } catch (error) {
        console.error('Erro ao gerar sugestões:', error);
        showNotification('Erro ao gerar sugestões', 'danger');
    }
}

window.gerarSugestoesAvancado = gerarSugestoesAvancado;

function formatarBadgeMotivoSugestao(motivo) {
    const texto = String(motivo || '-');
    let badgeClass = 'bg-secondary';

    if (texto.startsWith('🔴')) badgeClass = 'bg-danger';
    else if (texto.startsWith('🟠')) badgeClass = 'bg-warning text-dark';
    else if (texto.startsWith('🟡')) badgeClass = 'bg-warning text-dark';
    else if (texto.startsWith('⚫')) badgeClass = 'bg-dark';

    return `<span class="badge ${badgeClass}">${escapeHtml(texto)}</span>`;
}

function ehMotivoValidade(motivo) {
    const texto = String(motivo || '');
    return texto.includes('Vence') || texto.includes('Vencido') || texto === 'vencimento_proximo';
}

function formatarInfoValidadeSugestao(sugestao) {
    const dias = Number(sugestao.dias_para_vencer);

    if (!Number.isFinite(dias)) return '';

    if (dias < 0) {
        return `<br><small class="text-muted">Venceu há ${Math.abs(dias)} dia(s)</small>`;
    }

    if (dias === 0) {
        return '<br><small class="text-muted">Vence hoje</small>';
    }

    return `<br><small class="text-muted">${dias} dia(s) para vencer</small>`;
}

function formatarInfoSugestao(sugestao) {
    if (ehMotivoValidade(sugestao.motivo)) {
        return formatarInfoValidadeSugestao(sugestao);
    }

    const diasSemVenda = Number(sugestao.dias_sem_venda);
    if (Number.isFinite(diasSemVenda)) {
        return `<br><small class="text-muted">Sem venda há ${diasSemVenda} dia(s)</small>`;
    }

    if (String(sugestao.motivo || '').includes('Nunca Vendeu')) {
        return '<br><small class="text-muted">Nunca vendido</small>';
    }

    return '';
}

/**
 * Carrega sugestões de promoções
 */
async function carregarSugestoesPromocoes(autoGerar = false) {
    const container = $('#lista-sugestoes');
    container.html('<div class="text-center"><div class="spinner-border spinner-border-sm text-primary"></div></div>');

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/sugestoes`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar sugestões');
        }

        const sugestoes = await response.json();

        if (!sugestoes || sugestoes.length === 0) {
            if (autoGerar) {
                const resultado = await gerarSugestoesPromocoes({ silent: true });
                if (resultado?.total > 0) {
                    return carregarSugestoesPromocoes(false);
                }
            }

            container.html(`
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> Nenhuma sugestão de promoção disponível no momento.
                </div>
            `);
            return;
        }

        let html = '<div class="table-responsive"><table class="table table-striped table-hover">';
        html += `
            <thead>
                <tr>
                    <th>Produto</th>
                    <th>Motivo</th>
                    <th>${tituloColunaEstoqueLista()}</th>
                    <th>Preço Atual</th>
                    <th>Desconto Sugerido</th>
                    <th>Preço Promocional</th>
                    <th>Ações</th>
                </tr>
            </thead>
            <tbody>
        `;

        sugestoes.forEach(s => {
            const desconto = Number(s.desconto_percentual || 0).toFixed(2);
            const diasInfo = formatarInfoSugestao(s);
            html += `
                <tr>
                    <td>
                        <strong>${escapeHtml(s.nome_produto || '-')}</strong>
                        ${diasInfo}
                    </td>
                    <td>${formatarBadgeMotivoSugestao(s.motivo)}</td>
                    <td>${escapeHtml(formatarEstoqueExibicaoTela(s))}</td>
                    <td>${formatCurrency(s.preco_atual || 0)}</td>
                    <td><span class="badge bg-danger">${desconto}%</span></td>
                    <td>${formatCurrency(s.preco_sugerido || 0)}</td>
                    <td>
                        <button class="btn btn-sm btn-success" onclick="aceitarSugestaoPromocao(${s.id})" title="Editar desconto e criar promoção">
                            <i class="fas fa-check"></i> Aceitar
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="rejeitarSugestaoPromocao(${s.id})" title="Descartar sugestão">
                            <i class="fas fa-times"></i> Rejeitar
                        </button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.html(html);
    } catch (error) {
        console.error('Erro ao carregar sugestões:', error);
        container.html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> Erro ao carregar sugestões.
            </div>
        `);
    }
}

/**
 * Carrega promoções (ativas ou encerradas)
 */
async function carregarPromocoes(tipo) {
    const container = tipo === 'ativas' 
        ? $('#lista-promocoes-ativas') 
        : $('#lista-promocoes-encerradas');

    container.html('<div class="text-center"><div class="spinner-border spinner-border-sm text-primary"></div></div>');

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes?status=${tipo}`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar promoções');
        }

        const promocoes = await response.json();

        if (!promocoes || promocoes.length === 0) {
            const mensagem = tipo === 'ativas' 
                ? 'Nenhuma promoção ativa no momento.'
                : 'Nenhuma promoção encerrada.';
            container.html(`
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> ${mensagem}
                </div>
            `);
            return;
        }

        let html = '<div class="table-responsive"><table class="table table-striped table-hover">';
        html += `
            <thead>
                <tr>
                    <th>Produto</th>
                    <th>Preço Original</th>
                    <th>Preço Promocional</th>
                    <th>Desconto</th>
                    <th>Período</th>
                    <th>Status</th>
                    ${tipo === 'ativas' ? '<th>Ações</th>' : ''}
                </tr>
            </thead>
            <tbody>
        `;

        promocoes.forEach(p => {
            const desconto = Number(p.desconto_percentual || 0).toFixed(2);
            const dataInicio = new Date(p.data_inicio).toLocaleDateString('pt-BR');
            const dataFim = new Date(p.data_fim).toLocaleDateString('pt-BR');
            
            // Calcular status real
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            const fimDate = new Date(p.data_fim);
            fimDate.setHours(0, 0, 0, 0);
            const inicioDate = new Date(p.data_inicio);
            inicioDate.setHours(0, 0, 0, 0);
            
            let statusReal = p.status;
            let badgeClass = 'bg-secondary';
            
            if (p.status === 'ativa') {
                if (fimDate < hoje) {
                    statusReal = '⚠️ EXPIRADA';
                    badgeClass = 'bg-danger';
                } else if (inicioDate > hoje) {
                    statusReal = '🕐 NÃO INICIADA';
                    badgeClass = 'bg-warning text-dark';
                } else {
                    statusReal = '✅ VIGENTE';
                    badgeClass = 'bg-success';
                }
            } else if (p.status === 'encerrada') {
                statusReal = '❌ ENCERRADA';
                badgeClass = 'bg-secondary';
            }

            html += `
                <tr>
                    <td><strong>${escapeHtml(p.nome_produto || '-')}</strong></td>
                    <td>${formatCurrency(p.preco_original || 0)}</td>
                    <td>${formatCurrency(p.preco_promocional || 0)}</td>
                    <td>${desconto}%</td>
                    <td>${dataInicio} até ${dataFim}</td>
                    <td><span class="badge ${badgeClass}">${statusReal}</span></td>
                    ${tipo === 'ativas' ? `
                        <td>
                            <button class="btn btn-sm btn-danger" onclick="encerrarPromocao(${p.id})">
                                <i class="fas fa-stop-circle"></i> Encerrar
                            </button>
                        </td>
                    ` : ''}
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.html(html);
    } catch (error) {
        console.error('Erro ao carregar promoções:', error);
        container.html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> Erro ao carregar promoções.
            </div>
        `);
    }
}

/**
 * Aceita sugestão de promoção - abre modal para editar desconto
 */
async function aceitarSugestaoPromocao(sugestaoId) {
    try {
        // Buscar dados da sugestão
        const response = await fetch(`${API_URL}/produtos/promocoes/sugestoes`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar sugestões');
        }

        const sugestoes = await response.json();
        const sugestao = sugestoes.find(s => s.id === sugestaoId);

        if (!sugestao) {
            throw new Error('Sugestão não encontrada');
        }

        // Abrir modal para confirmar e editar desconto
        abrirModalConfirmarSugestao(sugestao);
    } catch (error) {
        console.error('Erro ao aceitar sugestão:', error);
        showNotification('Erro ao aceitar sugestão', 'danger');
    }
}

/**
 * Abre modal para confirmar sugestão e editar desconto
 */
async function abrirModalConfirmarSugestao(sugestao) {
    const hoje = new Date().toISOString().split('T')[0];
    const amanhaDate = new Date();
    amanhaDate.setDate(amanhaDate.getDate() + 1);
    const amanha = amanhaDate.toISOString().split('T')[0];

    const modalHtml = `
        <div class="modal fade" id="modalConfirmarSugestao" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-check-circle text-success"></i> Confirmar Promoção
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label"><strong>Produto</strong></label>
                                <p class="form-control-static">${escapeHtml(sugestao.nome_produto || '')}</p>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label"><strong>Motivo</strong></label>
                                <p class="form-control-static">
                                    <span class="badge bg-info">${sugestao.motivo.replace(/_/g, ' ')}</span>
                                </p>
                            </div>
                        </div>

                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label"><strong>Preço Atual</strong></label>
                                <p class="form-control-static">${formatCurrency(sugestao.preco_atual || 0)}</p>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label"><strong>Estoque Disponível</strong></label>
                                <p class="form-control-static">${escapeHtml(formatarEstoqueExibicaoTela(sugestao))}</p>
                            </div>
                        </div>

                        <hr>

                        <div class="row mb-3">
                            <div class="col-md-4">
                                <label for="descontoConfirmar" class="form-label">
                                    <strong>Desconto (%)</strong>
                                </label>
                                <div class="input-group">
                                    <input type="number" class="form-control" id="descontoConfirmar" 
                                        value="${Number(sugestao.desconto_percentual || 15).toFixed(2)}" 
                                        min="1" max="100" step="0.5">
                                    <span class="input-group-text">%</span>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label"><strong>Preço Promocional</strong></label>
                                <p class="form-control-static" id="precoPromocionalDisplay">
                                    ${formatCurrency(sugestao.preco_sugerido || 0)}
                                </p>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label"><strong>Economia</strong></label>
                                <p class="form-control-static text-success" id="economiaDisplay">
                                    ${formatCurrency((sugestao.preco_atual - sugestao.preco_sugerido) || 0)}
                                </p>
                            </div>
                        </div>

                        <hr>

                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label for="dataInicioConfirmar" class="form-label"><strong>Data Início</strong></label>
                                <input type="date" class="form-control" id="dataInicioConfirmar" value="${hoje}">
                            </div>
                            <div class="col-md-6">
                                <label for="dataFimConfirmar" class="form-label"><strong>Data Fim</strong></label>
                                <input type="date" class="form-control" id="dataFimConfirmar" value="${amanha}">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-success" onclick="confirmarSugestaoPromocao(${sugestao.id}, ${sugestao.produto_id}, ${sugestao.preco_atual})">
                            <i class="fas fa-check"></i> Criar Promoção
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (!$('#modal-container-sugestao').length) {
        $('body').append('<div id="modal-container-sugestao"></div>');
    }
    $('#modal-container-sugestao').html(modalHtml);

    const modal = new bootstrap.Modal(document.getElementById('modalConfirmarSugestao'));
    modal.show();

    // Atualizar preço promocional ao mudar desconto
    const precoAtualValue = sugestao.preco_atual || 0;
    $('#descontoConfirmar').on('change', function() {
        const desconto = parseFloat($(this).val()) || 0;
        const precoPromocional = (precoAtualValue * (1 - desconto / 100)).toFixed(2);
        const economia = (precoAtualValue - precoPromocional).toFixed(2);
        
        $('#precoPromocionalDisplay').text(formatCurrency(precoPromocional));
        $('#economiaDisplay').text(formatCurrency(economia));
    });
}

/**
 * Confirma e cria a promoção
 */
async function confirmarSugestaoPromocao(sugestaoId, produtoId, precoOriginal) {
    try {
        const desconto = parseFloat($('#descontoConfirmar').val()) || 15;
        const dataInicio = $('#dataInicioConfirmar').val();
        const dataFim = $('#dataFimConfirmar').val();

        if (!dataInicio || !dataFim) {
            showNotification('Preencha as datas de início e fim', 'warning');
            return;
        }

        if (new Date(dataInicio) > new Date(dataFim)) {
            showNotification('Data de fim não pode ser anterior à data de início', 'warning');
            return;
        }

        // Calcular preço promocional
        const precoPromocional = (precoOriginal * (1 - desconto / 100)).toFixed(2);

        // Criar promoção
        const responsePromocao = await fetch(`${API_URL}/produtos/promocoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({
                produto_id: produtoId,
                preco_original: precoOriginal,
                preco_promocional: precoPromocional,
                data_inicio: dataInicio,
                data_fim: dataFim
            })
        });

        if (!responsePromocao.ok) {
            throw new Error('Erro ao criar promoção');
        }

        const resultadoPromocao = await responsePromocao.json();

        // Marcar sugestão como aceita
        const responseSugestao = await fetch(`${API_URL}/produtos/promocoes/sugestoes/${sugestaoId}/processar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({ acao: 'aceitar' })
        });

        if (!responseSugestao.ok) {
            console.warn('Sugestão não foi marcada como aceita, mas a promoção foi criada');
        }

        showNotification('Promoção criada e ativada com sucesso!', 'success');
        
        // Fechar modal
        bootstrap.Modal.getInstance(document.getElementById('modalConfirmarSugestao')).hide();
        
        // Recarregar dados
        carregarSugestoesPromocoes();
        carregarPromocoes('ativas');
        carregarDashboardPromocoes();
    } catch (error) {
        console.error('Erro ao confirmar sugestão:', error);
        showNotification('Erro ao criar promoção', 'danger');
    }
}

window.aceitarSugestaoPromocao = aceitarSugestaoPromocao;
window.confirmarSugestaoPromocao = confirmarSugestaoPromocao;

/**
 * Rejeita sugestão de promoção
 */
async function rejeitarSugestaoPromocao(sugestaoId) {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/sugestoes/${sugestaoId}/processar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({ acao: 'rejeitar' })
        });

        if (!response.ok) {
            throw new Error('Erro ao rejeitar sugestão');
        }

        showNotification('Sugestão rejeitada!', 'info');
        carregarSugestoesPromocoes();
    } catch (error) {
        console.error('Erro ao rejeitar sugestão:', error);
        showNotification('Erro ao rejeitar sugestão', 'danger');
    }
}

window.rejeitarSugestaoPromocao = rejeitarSugestaoPromocao;

/**
 * Encerra promoção ativa
 */
async function encerrarPromocao(promocaoId) {
    if (!confirm('Tem certeza que deseja encerrar esta promoção?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/${promocaoId}/encerrar`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({ motivo_encerramento: 'Encerrada pelo usuário' })
        });

        if (!response.ok) {
            throw new Error('Erro ao encerrar promoção');
        }

        showNotification('Promoção encerrada com sucesso!', 'success');
        carregarPromocoes('ativas');
        carregarPromocoes('encerradas');
        carregarDashboardPromocoes();
    } catch (error) {
        console.error('Erro ao encerrar promoção:', error);
        showNotification('Erro ao encerrar promoção', 'danger');
    }
}

window.encerrarPromocao = encerrarPromocao;

/**
 * Verifica e encerra promoções expiradas manualmente
 */
async function verificarPromocoeExpiradas() {
    try {
        const response = await fetch(`${API_URL}/produtos/verificar-expiradas-agora`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao verificar promoções expiradas');
        }

        const resultado = await response.json();
        
        showNotification(resultado.message, 'success');
        
        // Recarregar as listas de promoções
        carregarPromocoes('ativas');
        carregarPromocoes('encerradas');
        carregarDashboardPromocoes();
        carregarEstatisticasPromocoes();
        
    } catch (error) {
        console.error('Erro ao verificar promoções expiradas:', error);
        showNotification('Erro ao verificar promoções expiradas', 'danger');
    }
}

window.verificarPromocoeExpiradas = verificarPromocoeExpiradas;
/**
 * Gera sugestões automáticas (versão simples - sem parâmetros)
 * @deprecated Use gerarSugestoesAvancado() em vez disso
 */
async function gerarSugestoesPromocoes(options = { silent: false }) {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/gerar-sugestoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({
                produto_ids: [],
                desconto_percentual: 15
            })
        });

        if (!response.ok) {
            throw new Error('Erro ao gerar sugestões');
        }

        const resultado = await response.json();
        if (!options.silent) {
            showNotification(resultado.message || `${resultado.total} sugestão(ões) gerada(s).`, resultado.total > 0 ? 'success' : 'info');
        }

        if (!options.silent) {
            carregarSugestoesPromocoes();
        }
        carregarDashboardPromocoes();

        return resultado;
    } catch (error) {
        console.error('Erro ao gerar sugestões:', error);
        if (!options.silent) {
            showNotification('Erro ao gerar sugestões', 'danger');
        }
        return null;
    }
}

window.gerarSugestoesPromocoes = gerarSugestoesPromocoes;

window.viewProduto = viewProduto;


// Escape HTML
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatarNumeroEstoqueProduto(numero, maxCasas = 3) {
    const qtd = Number(numero || 0);
    const factor = Math.pow(10, maxCasas);
    const arredondado = Math.round(qtd * factor) / factor;
    return String(parseFloat(arredondado.toFixed(maxCasas))).replace('.', ',');
}

function formatarEstoqueProduto(valor, unidade = '', opcoes = {}) {
    const numero = Number(valor || 0);
    const unidadeNorm = String(unidade || 'un').toLowerCase();
    const label = String(unidade || 'UN').toUpperCase();
    const fracionado = Boolean(opcoes.produtoFracionado);
    const usaDecimais = fracionado || unidadeVendaSuportaConversao(unidadeNorm);

    if (usaDecimais) {
        return `${formatarNumeroEstoqueProduto(numero, 3)} ${label}`;
    }

    return `${Math.round(numero)} ${label}`;
}

function montarTabelaEstoqueResumo(lista, classeLinha) {
  if (!lista.length) return '';

  return `
    <table class="table table-sm table-hover mb-0">
      <thead>
        <tr>
          <th>Produto</th>
          <th>Código</th>
          <th class="text-end">Estoque</th>
          <th class="text-end">Mínimo</th>
        </tr>
      </thead>
      <tbody>
        ${lista.map((p) => `
          <tr class="${classeLinha}">
            <td class="fw-semibold">${escapeHtml(p.nome || '')}</td>
            <td>${escapeHtml(p.codigo || '-')}</td>
            <td class="text-end fw-bold">${formatarColunaEstoqueLista(p)}</td>
            <td class="text-end">${formatarEstoqueProduto(p.estoque_minimo, p.unidade, { produtoFracionado: produtoUsaConversaoUnidades(p) })}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function montarListaEstoqueBaixoProdutos(criticos, proximos) {
  const listaCriticos = Array.isArray(criticos) ? criticos : [];
  const listaProximos = Array.isArray(proximos) ? proximos : [];

  if (!listaCriticos.length && !listaProximos.length) {
    return '<div class="text-muted">Nenhum alerta de estoque no momento.</div>';
  }

  let html = '<div class="d-flex flex-column gap-2">';

  if (listaCriticos.length) {
    html += `
      <div class="d-flex justify-content-between align-items-center">
        <span class="text-danger fw-semibold">Estoque no mínimo ou abaixo (${listaCriticos.length})</span>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="carregarRelatorioEstoqueProdutos('estoque_baixo')">Ver todos</button>
      </div>
    `;
  }

  if (listaProximos.length) {
    html += `
      <div class="d-flex justify-content-between align-items-center">
        <span class="text-warning-emphasis fw-semibold">Próximo do mínimo (${listaProximos.length})</span>
        <button type="button" class="btn btn-sm btn-outline-warning" onclick="carregarRelatorioEstoqueProdutos('proximo_minimo')">Ver todos</button>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

function separarProdutosPorEstoque(produtos) {
  const criticos = [];
  const proximos = [];

  (produtos || []).forEach((p) => {
    const tipo = classificarEstoqueProduto(p);
    if (tipo === 'estoque_baixo') criticos.push(p);
    else if (tipo === 'proximo_minimo') proximos.push(p);
  });

  return { criticos, proximos };
}

async function carregarEstoqueBaixoProdutos() {
  const container = document.getElementById('listaEstoqueBaixoProdutos');
  if (!container) return;

  container.innerHTML = '<div class="text-muted">Carregando...</div>';

  const cache = window.produtosCache || window.produtosList || [];
  if (cache.length) {
    const { criticos, proximos } = separarProdutosPorEstoque(cache);
    container.innerHTML = montarListaEstoqueBaixoProdutos(criticos, proximos);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/produtos/estoque/baixo?modo_fiscal=${modoFiscalQueryParam()}`, {
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
      }
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao carregar estoque baixo.');
    }

    container.innerHTML = montarListaEstoqueBaixoProdutos(data, []);
  } catch (error) {
    console.error('Erro estoque baixo:', error);
    container.innerHTML = '<div class="text-danger">Erro ao carregar alertas de estoque.</div>';
  }
}

function inicializarCardEstoqueBaixo() {
  carregarEstoqueBaixoProdutos();
}

window.carregarEstoqueBaixoProdutos = carregarEstoqueBaixoProdutos;

function inicializarModalVencimentosProdutos() {
    if ($('#modalVencimentosProdutos').length) return;

    $('body').append(`
        <div class="modal fade" id="modalVencimentosProdutos" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Produtos vencidos ou próximos do vencimento</h5>
                        <button type="button" class="btn-close" onclick="fecharModalVencimentosProdutos()" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <table class="table table-striped table-hover">
                            <thead>
                                <tr>
                                    <th>Produto</th>
                                    <th>${tituloColunaEstoqueLista()}</th>
                                    <th>Lote</th>
                                    <th>Validade</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody id="listaVencimentosProdutos">
                                <tr>
                                    <td colspan="5">Carregando...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `);
}

async function carregarVencimentosProdutos() {
    try {
        const modoFiscal = typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0';
        const response = await fetch(`${API_URL}/produtos/vencimentos/alertas?dias=30&modo_fiscal=${modoFiscal}`, {
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao carregar vencimentos');
        }

        $('#qtdProdutosVencidos').text(data.vencidos || 0);
        $('#qtdProdutosProximos').text(data.proximos || 0);

        renderizarListaVencimentosProdutos(data.produtos || []);
    } catch (error) {
        console.error('Erro ao carregar vencimentos:', error);
        $('#qtdProdutosVencidos').text('0');
        $('#qtdProdutosProximos').text('0');
    }
}

function renderizarListaVencimentosProdutos(produtos) {
    const tbody = $('#listaVencimentosProdutos');

    if (!tbody.length) return;

    if (!produtos.length) {
        tbody.html(`
            <tr>
                <td colspan="5" class="text-center text-muted">
                    Nenhum produto vencido ou próximo do vencimento.
                </td>
            </tr>
        `);
        return;
    }

    tbody.html(produtos.map((produto) => {
        const vencido = produto.status_validade === 'vencido';
        const statusTexto = vencido
            ? 'Vencido'
            : `Vence em ${produto.dias_para_vencer} dia(s)`;

        const linhaClasse = vencido ? 'table-danger' : 'table-warning';
        const badgeClasse = vencido ? 'bg-danger' : 'bg-warning text-dark';

        const validadeFormatada = produto.data_validade
            ? new Date(produto.data_validade + 'T00:00:00').toLocaleDateString('pt-BR')
            : '-';

        return `
            <tr class="${linhaClasse}">
                <td class="fw-semibold">${escapeHtml(produto.nome || '-')}</td>
                <td>${formatarEstoqueExibicaoTela(produto)}</td>
                <td>${escapeHtml(produto.lote || '-')}</td>
                <td>${validadeFormatada}</td>
                <td>
                    <span class="badge ${badgeClasse}">
                        ${statusTexto}
                    </span>
                </td>
            </tr>
        `;
    }).join(''));
}

function abrirModalVencimentosProdutos() {
    carregarVencimentosProdutos();
    const el = document.getElementById('modalVencimentosProdutos');
    if (el) {
        bootstrap.Modal.getOrCreateInstance(el).show();
    }
}

function fecharModalVencimentosProdutos() {
    const el = document.getElementById('modalVencimentosProdutos');
    if (el) {
        bootstrap.Modal.getInstance(el)?.hide();
    }
}

/* ========== UC-01.1 — Unidades de Comercialização ========== */

const UC01_TIPOS = [
    { value: 'PADRAO', label: 'Padrão (estoque)', icone: '', tooltip: 'Mesma unidade do estoque. Quantidade = 1.' },
    { value: 'AGRUPAMENTO', label: 'Agrupamento', icone: '', tooltip: 'Agrupa várias unidades (ex.: Caixa = 12 UN).' },
    { value: 'FRACIONAMENTO', label: 'Fracionamento', icone: '', tooltip: 'Fraciona a unidade do estoque (ex.: Pote 200 ml).' },
    { value: 'CONVERSAO_FISICA', label: 'Medida física', icone: '', tooltip: 'Medida física (ex.: L ↔ Kg). O peso real é informado na Entrada.' }
];

const UC01_CANAIS = [
    { key: 'compra', label: 'Compra' },
    { key: 'venda_erp', label: 'Venda ERP' },
    { key: 'venda_atacado', label: 'Venda Atacado' },
    { key: 'venda_varejo', label: 'Venda Varejo' },
    { key: 'pdv', label: 'PDV' },
    { key: 'nfce', label: 'NFC-e' },
    { key: 'nfe', label: 'NF-e' },
    { key: 'comercial', label: 'Comercial' },
    { key: 'orcamento', label: 'Orçamento' }
];

const UC01_FILTRO_PADRAO = 'todos';

function metaTipoUc01(tipo) {
    const key = String(tipo || '').toUpperCase();
    const fromCatalog = (window._uc01Catalogo?.tipos || []).find((t) => String(t.value || '').toUpperCase() === key);
    if (fromCatalog) {
        const iconeOficial = ({
            PADRAO: '⭐',
            AGRUPAMENTO: '📦',
            FRACIONAMENTO: '✂',
            CONVERSAO_FISICA: '⚖'
        })[key];
        return {
            value: fromCatalog.value,
            label: key === 'CONVERSAO_FISICA'
                ? 'Medida Física'
                : (fromCatalog.label || key),
            icone: iconeOficial || fromCatalog.icone || '•',
            tooltip: fromCatalog.tooltip || ''
        };
    }
    return UC01_TIPOS.find((t) => t.value === key)
        || { value: tipo, label: key === 'CONVERSAO_FISICA' ? 'Medida Física' : (tipo || '—'), icone: '•', tooltip: '' };
}

function flagSimNaoBadge(v) {
    return Number(v) === 1
        ? '<span class="badge bg-success">✔</span>'
        : '<span class="badge bg-secondary">✘</span>';
}

function canaisUc01De(unidade) {
    const c = unidade?.canais_comercializacao || {};
    return {
        compra: Number(c.compra ?? unidade?.permite_compra) === 1 ? 1 : 0,
        venda_erp: Number(c.venda_erp ?? unidade?.permite_venda) === 1 ? 1 : 0,
        venda_atacado: Number(c.venda_atacado ?? unidade?.permite_venda) === 1 ? 1 : 0,
        venda_varejo: Number(c.venda_varejo ?? unidade?.permite_venda) === 1 ? 1 : 0,
        pdv: Number(c.pdv ?? unidade?.permite_pdv) === 1 ? 1 : 0,
        nfce: Number(c.nfce ?? unidade?.permite_pdv) === 1 ? 1 : 0,
        nfe: Number(c.nfe ?? unidade?.permite_venda) === 1 ? 1 : 0,
        comercial: Number(c.comercial ?? unidade?.permite_venda) === 1 ? 1 : 0,
        orcamento: Number(c.orcamento ?? unidade?.permite_venda) === 1 ? 1 : 0
    };
}

function unidadeUc01TemVenda(canais) {
    return Boolean(
        canais.venda_erp || canais.venda_atacado || canais.venda_varejo
        || canais.comercial || canais.nfe || canais.nfce || canais.orcamento
    );
}

function ordenarUnidadesUc01(unidades) {
    return [...(unidades || [])].sort((a, b) => {
        const padA = Number(a.unidade_padrao) === 1 ? 0 : 1;
        const padB = Number(b.unidade_padrao) === 1 ? 0 : 1;
        if (padA !== padB) return padA - padB;
        const priA = Number(a.prioridade || 9999);
        const priB = Number(b.prioridade || 9999);
        if (priA !== priB) return priA - priB;
        return String(a.descricao || a.unidade_comercial || '')
            .localeCompare(String(b.descricao || b.unidade_comercial || ''), 'pt-BR', { sensitivity: 'base' });
    });
}

function filtrarUnidadesUc01(unidades, filtro, busca) {
    const q = String(busca || '').trim().toLowerCase();
    return (unidades || []).filter((u) => {
        const canais = canaisUc01De(u);
        const ativo = Number(u.ativo) !== 0;
        if (filtro === 'compra' && !canais.compra) return false;
        if (filtro === 'venda' && !unidadeUc01TemVenda(canais)) return false;
        if (filtro === 'pdv' && !canais.pdv) return false;
        if (filtro === 'ativos' && !ativo) return false;
        if (filtro === 'inativos' && ativo) return false;
        if (!q) return true;
        const meta = metaTipoUc01(u.tipo);
        const hay = [
            u.descricao, u.unidade_comercial, u.unidade_base, u.tipo, meta.label
        ].map((x) => String(x || '').toLowerCase()).join(' ');
        return hay.includes(q);
    });
}

function resumoQuantidadeUc01(u) {
    const qtd = Number(u.quantidade || 0);
    const base = String(u.unidade_base || '').toUpperCase() || 'UN';
    const tipo = String(u.tipo || '').toUpperCase();
    if (tipo === 'PADRAO') return `1 ${escapeHtml(base)} (estoque)`;
    if (tipo === 'CONVERSAO_FISICA') {
        return `${escapeHtml(String(u.unidade_comercial || '').toUpperCase())} ↔ ${escapeHtml(base)}`;
    }
    const qtdFmt = Number.isInteger(qtd) ? String(qtd) : String(qtd);
    return `${escapeHtml(qtdFmt)} ${escapeHtml(base)}`;
}

function badgesCanaisUc01Card(canais) {
    const chips = [];
    if (canais.compra) chips.push('<span class="badge rounded-pill text-bg-light border me-1 mb-1">🛒 Compra</span>');
    if (unidadeUc01TemVenda(canais)) chips.push('<span class="badge rounded-pill text-bg-light border me-1 mb-1">🏪 Venda</span>');
    if (canais.pdv) chips.push('<span class="badge rounded-pill text-bg-light border me-1 mb-1">💳 PDV</span>');
    return chips.length ? chips.join('') : '<span class="text-muted small">Sem canais</span>';
}

function montarCardUnidadeUc01(u) {
    const canais = canaisUc01De(u);
    const nome = escapeHtml(u.descricao || u.unidade_comercial || 'Forma de venda');
    const codigoUn = escapeHtml(String(u.unidade_comercial || '').toUpperCase());
    const padrao = Number(u.unidade_padrao) === 1;
    const ativo = Number(u.ativo) !== 0;
    const ondeVende = [];
    if (canais.compra) ondeVende.push('Compra');
    if (unidadeUc01TemVenda(canais)) ondeVende.push('Venda');
    if (canais.pdv) ondeVende.push('PDV');

    return `
        <div class="col-12 col-md-6 col-xl-4" data-uc01-card-id="${u.id}">
            <div class="card h-100 ${ativo ? '' : 'opacity-75 border-secondary'} ${padrao ? 'border-primary border-opacity-50' : ''}">
                <div class="card-body d-flex flex-column">
                    <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                        <div>
                            <div class="fs-5 fw-semibold mb-0">${nome}</div>
                            <div class="text-muted small">${resumoQuantidadeUc01(u)} · <strong>${codigoUn}</strong></div>
                        </div>
                        ${padrao ? '<span class="badge bg-primary">Padrão</span>' : ''}
                    </div>
                    <div class="mb-3 small">
                        <span class="text-muted">Onde vende:</span>
                        <strong>${ondeVende.length ? escapeHtml(ondeVende.join(' · ')) : '—'}</strong>
                        ${ativo ? '' : ' <span class="badge bg-secondary">Inativo</span>'}
                    </div>
                    <div class="mt-auto">
                        <div class="btn-group btn-group-sm w-100" role="group">
                            <button type="button" class="btn btn-outline-primary" title="Editar" onclick="editarUnidadeUc01PorId(${u.id})">
                                <i class="fas fa-edit"></i> Editar
                            </button>
                            <button type="button" class="btn btn-outline-secondary" title="Duplicar" onclick="duplicarUnidadeUc01(${u.id})">
                                <i class="fas fa-copy"></i>
                            </button>
                            <button type="button" class="btn btn-outline-danger" title="Excluir" onclick="excluirUnidadeUc01(${u.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

function atualizarBlocoConversaoFisicaInicial() {
    const $bloco = $('#blocoConversaoFisicaInicial');
    if (!$bloco.length) return;
    const fisica = $('#utiliza_conversao_fisica').is(':checked');
    const fiscal = parseFloat($('#saldo_fiscal_inicial').val()) || 0;
    const nf = parseFloat($('#saldo_nao_fiscal_inicial').val()) || 0;
    const total = fiscal + nf;
    $bloco.toggleClass('d-none', !(fisica && total > 0));
}

function inicializarConversaoFisicaUc01(produto, isEdit) {
    const syncPainel = () => {
        const ativo = $('#utiliza_conversao_fisica').is(':checked');
        const temMov = $('#produtoModal').data('temMovimentacoes') === true;
        $('#painelConversaoFisicaUc01').toggleClass('d-none', !ativo);
        const unBase = String($('#unidade').val() || 'un').toUpperCase();
        $('#uc01_unidade_base_readonly').val(unBase);
        $('#uc01_unidade_base_readonly_label').text(unBase);
        $('#uc01UnidadeBaseLabel').text(unBase);
        $('#avisoPesoControladoPorLote').toggleClass('d-none', !(ativo && temMov));
        if (ativo && temMov) {
            $('#utiliza_conversao_fisica').prop('disabled', true);
            $('#unidade_conversao_fisica, #peso_referencia_aproximado').prop('disabled', true);
        }
        if (ativo && !$('#unidade_conversao_fisica').val()) {
            const sugerida = sugerirUnidadeFisicaPorCategoria();
            $('#unidade_conversao_fisica').val(sugerida);
        }
        atualizarBlocoConversaoFisicaInicial();
        atualizarResumoInteligenteProduto();
    };

    $('#utiliza_conversao_fisica')
        .off('change.uc01')
        .on('change.uc01', syncPainel);
    $('#unidade, #unidade_conversao_fisica, #nome, #categoria_id')
        .off('change.uc01Base input.resumoUx03')
        .on('change.uc01Base input.resumoUx03 change.resumoUx03', syncPainel);
    $(document)
        .off('input.uxProd01Fisica', '#saldo_fiscal_inicial, #saldo_nao_fiscal_inicial')
        .on('input.uxProd01Fisica', '#saldo_fiscal_inicial, #saldo_nao_fiscal_inicial', atualizarBlocoConversaoFisicaInicial);

    syncPainel();
}

function inicializarToolbarCardsUc01() {
    window._uc01FiltroAtivo = window._uc01FiltroAtivo || UC01_FILTRO_PADRAO;
    window._uc01BuscaAtiva = window._uc01BuscaAtiva || '';

    $('#uc01FiltrosCards').off('click.uxProd05').on('click.uxProd05', '[data-filtro-uc01]', function () {
        window._uc01FiltroAtivo = $(this).data('filtro-uc01') || UC01_FILTRO_PADRAO;
        $('#uc01FiltrosCards [data-filtro-uc01]').removeClass('active');
        $(this).addClass('active');
        renderGradeUnidadesUc01(window._uc01UnidadesCache || [], { preservarCache: true });
    });

    $('#uc01BuscaCards').off('input.uxProd05').on('input.uxProd05', function () {
        window._uc01BuscaAtiva = $(this).val() || '';
        renderGradeUnidadesUc01(window._uc01UnidadesCache || [], { preservarCache: true });
    });

    $(document)
        .off('click.uxProd05Det', '[data-uc01-toggle-detalhes]')
        .on('click.uxProd05Det', '[data-uc01-toggle-detalhes]', function () {
            const id = $(this).data('uc01-toggle-detalhes');
            const $det = $(`#uc01Detalhes_${id}`);
            const aberto = !$det.hasClass('d-none');
            $det.toggleClass('d-none', aberto);
            $(this).text(aberto ? '▼ Mais detalhes' : '▲ Menos detalhes');
        });
}

function inicializarConversoesProdutoRcm89(produtoId) {
    window._rcm89ProdutoId = Number(produtoId);
    const unBase = String($('#unidade').val() || 'UN').toUpperCase();
    if (!$('#conv_origem_rcm89').val()) {
        $('#conv_origem_rcm89').val(unBase);
    }
    $('#sim_origem_rcm89').val(unBase);
    $('#secaoConversoesProdutoRcm89').show();
    $('#btnAdicionarConversaoRcm89, #btnTestarConversaoRcm89').prop('disabled', false);

    $('#btnAdicionarConversaoRcm89').off('click').on('click', adicionarConversaoProdutoRcm89);
    $('#btnTestarConversaoRcm89').off('click').on('click', () => {
        $('#painelSimularConversaoRcm89').toggleClass('d-none');
        if (!$('#sim_origem_rcm89').val()) {
            $('#sim_origem_rcm89').val(String($('#unidade').val() || 'UN').toUpperCase());
        }
    });
    $('#btnExecutarSimulacaoRcm89').off('click').on('click', simularConversaoProdutoRcm89);

    carregarConversoesProdutoRcm89(produtoId);
}

function carregarConversoesProdutoRcm89(produtoId) {
    const $tb = $('#tbodyConversoesRcm89');
    if (!$tb.length) return;
    $tb.html('<tr><td colspan="5" class="text-muted text-center py-3">Carregando...</td></tr>');

    $.get(`${API_URL}/produtos/${produtoId}/conversoes`)
        .done((lista) => {
            window._rcm89ConversoesCache = Array.isArray(lista) ? lista : [];
            renderConversoesProdutoRcm89(window._rcm89ConversoesCache);
        })
        .fail((xhr) => {
            const msg = escapeHtml(xhr.responseJSON?.error || 'Erro ao carregar conversões');
            $tb.html(`<tr><td colspan="5" class="text-danger text-center py-3">${msg}</td></tr>`);
        });
}

function renderConversoesProdutoRcm89(lista) {
    const $tb = $('#tbodyConversoesRcm89');
    if (!$tb.length) return;
    const items = Array.isArray(lista) ? lista : [];
    if (!items.length) {
        $tb.html('<tr><td colspan="5" class="text-muted text-center py-3">Nenhuma conversão específica cadastrada.</td></tr>');
        return;
    }
    $tb.html(items.map((c) => {
        const id = Number(c.id);
        const fator = Number(c.fator);
        const fatorTxt = Number.isFinite(fator)
            ? String(fator).replace('.', ',')
            : '—';
        return `
            <tr data-conversao-id="${id}">
                <td><strong>${escapeHtml(String(c.origem || '').toUpperCase())}</strong></td>
                <td><strong>${escapeHtml(String(c.destino || '').toUpperCase())}</strong></td>
                <td>${escapeHtml(fatorTxt)}</td>
                <td><span class="badge bg-light text-dark border">${escapeHtml(String(c.tipo || 'FIXA'))}</span></td>
                <td class="text-end">
                    <button type="button" class="btn btn-sm btn-outline-danger" title="Remover"
                        onclick="excluirConversaoProdutoRcm89(${id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>`;
    }).join(''));
}

function adicionarConversaoProdutoRcm89() {
    const produtoId = window._rcm89ProdutoId;
    if (!produtoId) {
        showNotification('Salve o produto antes de adicionar conversões.', 'warning');
        return;
    }
    const origem = String($('#conv_origem_rcm89').val() || '').trim().toUpperCase();
    const destino = String($('#conv_destino_rcm89').val() || '').trim().toUpperCase();
    const fatorRaw = String($('#conv_fator_rcm89').val() || '').replace(',', '.');
    const fator = Number(fatorRaw);
    const tipo = String($('#conv_tipo_rcm89').val() || 'FIXA').toUpperCase();

    if (!origem || !destino) {
        showNotification('Informe origem e destino.', 'warning');
        return;
    }
    if (!Number.isFinite(fator) || fator <= 0) {
        showNotification('Informe um fator válido maior que zero.', 'warning');
        return;
    }

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/conversoes`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ origem, destino, fator, tipo })
    })
        .done(() => {
            $('#conv_destino_rcm89').val('');
            $('#conv_fator_rcm89').val('');
            carregarConversoesProdutoRcm89(produtoId);
            showNotification('Conversão adicionada.', 'success');
        })
        .fail((xhr) => {
            showNotification(xhr.responseJSON?.error || 'Erro ao adicionar conversão.', 'danger');
        });
}

function excluirConversaoProdutoRcm89(conversaoId) {
    const produtoId = window._rcm89ProdutoId;
    if (!produtoId || !conversaoId) return;
    if (!confirm('Remover esta conversão?')) return;

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/conversoes/${conversaoId}`,
        method: 'DELETE'
    })
        .done(() => {
            carregarConversoesProdutoRcm89(produtoId);
            showNotification('Conversão removida.', 'success');
        })
        .fail((xhr) => {
            showNotification(xhr.responseJSON?.error || 'Erro ao remover conversão.', 'danger');
        });
}
window.excluirConversaoProdutoRcm89 = excluirConversaoProdutoRcm89;
window.inicializarConversoesProdutoRcm89 = inicializarConversoesProdutoRcm89;

function simularConversaoProdutoRcm89() {
    const produtoId = window._rcm89ProdutoId;
    if (!produtoId) return;
    const quantidade = Number(String($('#sim_qtd_rcm89').val() || '').replace(',', '.'));
    const origem = String($('#sim_origem_rcm89').val() || '').trim().toUpperCase();
    const destino = String($('#sim_destino_rcm89').val() || '').trim().toUpperCase();
    const $out = $('#sim_resultado_rcm89');

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/conversoes/simular`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ quantidade, origem, destino })
    })
        .done((r) => {
            const qDest = Number(r.quantidade_destino);
            const qBase = Number(r.quantidade_base);
            $out.html(`
                <div class="alert alert-success mb-0 py-2">
                    <strong>${escapeHtml(String(r.quantidade_origem))} ${escapeHtml(r.unidade_origem)}</strong>
                    →
                    <strong>${escapeHtml(String(qDest))} ${escapeHtml(r.unidade_destino)}</strong>
                    <span class="text-muted">(${escapeHtml(String(qBase))} ${escapeHtml(r.unidade_base)} na base · fonte ${escapeHtml(r.fonte || '—')})</span>
                </div>`);
        })
        .fail((xhr) => {
            $out.html(`<div class="alert alert-danger mb-0 py-2">${escapeHtml(xhr.responseJSON?.error || 'Conversão não cadastrada.')}</div>`);
        });
}

function inicializarUnidadesComercializacaoUc01(produtoId) {
    window._uc01ProdutoIdAtual = Number(produtoId);
    const unBase = String($('#unidade').val() || 'UN').toUpperCase();
    $('#uc01UnidadeBaseLabel').text(unBase);
    window._uc01FiltroAtivo = UC01_FILTRO_PADRAO;
    window._uc01BuscaAtiva = '';
    $('#uc01BuscaCards').val('');
    $('#uc01FiltrosCards [data-filtro-uc01]').removeClass('active');
    $('#uc01FiltrosCards [data-filtro-uc01="todos"]').addClass('active');
    inicializarToolbarCardsUc01();
    carregarGradeUnidadesUc01(produtoId);
    $('#btnAdicionarUnidadeUc01').off('click').on('click', () => abrirModalEditarUnidadeUc01(null));
}

function carregarGradeUnidadesUc01(produtoId) {
    const $grade = $('#gradeCardsUnidadesUc01');
    const $tbody = $('#tbodyUnidadesUc01');
    if (!$grade.length && !$tbody.length) return;

    if ($grade.length) {
        $grade.html('<div class="col-12 text-muted text-center py-3">Carregando...</div>');
    }

    $.get(`${API_URL}/produtos/${produtoId}/unidades-comercializacao`)
        .done((payload) => {
            const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
            if (payload?.unidade_base) {
                $('#uc01UnidadeBaseLabel').text(String(payload.unidade_base).toUpperCase());
            }
            if (payload?.catalogo?.tipos) {
                window._uc01Catalogo = payload.catalogo;
            }
            renderGradeUnidadesUc01(items);
            atualizarResumoInteligenteProduto();
        })
        .fail((xhr) => {
            const msg = escapeHtml(xhr.responseJSON?.error || 'Erro ao carregar unidades');
            if ($grade.length) {
                $grade.html(`<div class="col-12 text-danger text-center py-3">${msg}</div>`);
            }
            atualizarResumoInteligenteProduto();
        });
}

function renderGradeUnidadesUc01(unidades, opcoes = {}) {
    const $grade = $('#gradeCardsUnidadesUc01');
    if (!opcoes.preservarCache) {
        window._uc01UnidadesCache = unidades || [];
    }
    const cache = window._uc01UnidadesCache || [];
    if (!$grade.length) return;

    const $toolbar = $('#uc01ToolbarCards');
    if ($toolbar.length) {
        $toolbar.toggleClass('d-none', cache.length < 3);
    }

    if (!cache.length) {
        $grade.html('<div class="col-12 text-muted text-center py-3">Nenhuma forma de venda cadastrada.</div>');
        return;
    }

    const filtradas = ordenarUnidadesUc01(
        filtrarUnidadesUc01(cache, window._uc01FiltroAtivo || UC01_FILTRO_PADRAO, window._uc01BuscaAtiva || '')
    );

    if (!filtradas.length) {
        $grade.html('<div class="col-12 text-muted text-center py-3">Nenhuma forma corresponde ao filtro/pesquisa.</div>');
        return;
    }

    $grade.html(filtradas.map(montarCardUnidadeUc01).join(''));
}

function editarUnidadeUc01PorId(unidadeId) {
    const unidade = (window._uc01UnidadesCache || []).find((u) => Number(u.id) === Number(unidadeId));
    abrirModalEditarUnidadeUc01(unidade || null);
}

function duplicarUnidadeUc01(unidadeId) {
    const origem = (window._uc01UnidadesCache || []).find((u) => Number(u.id) === Number(unidadeId));
    if (!origem) {
        showNotification('Unidade não encontrada para duplicar.', 'warning');
        return;
    }
    const clone = {
        ...origem,
        id: undefined,
        unidade_padrao: 0,
        descricao: `${origem.descricao || origem.unidade_comercial || 'Unidade'} (cópia)`,
        prioridade: undefined
    };
    abrirModalEditarUnidadeUc01(clone);
}

function alternarAtivoUnidadeUc01(unidadeId) {
    const produtoId = window._uc01ProdutoIdAtual;
    const unidade = (window._uc01UnidadesCache || []).find((u) => Number(u.id) === Number(unidadeId));
    if (!unidade) {
        showNotification('Unidade não encontrada.', 'warning');
        return;
    }
    const novoAtivo = Number(unidade.ativo) !== 0 ? 0 : 1;
    const label = novoAtivo ? 'ativar' : 'desativar';
    if (!confirm(`Deseja ${label} esta unidade de comercialização?`)) return;

    const canais = canaisUc01De(unidade);
    const payload = {
        descricao: unidade.descricao,
        tipo: unidade.tipo,
        unidade_comercial: unidade.unidade_comercial,
        quantidade: Number(unidade.quantidade),
        unidade_base: unidade.unidade_base,
        prioridade: unidade.prioridade != null ? Number(unidade.prioridade) : undefined,
        unidade_padrao: Number(unidade.unidade_padrao) === 1 ? 1 : 0,
        conversao_por_lote: Number(unidade.conversao_por_lote) === 1 ? 1 : 0,
        canais_comercializacao: canais,
        ativo: novoAtivo
    };

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/unidades-comercializacao/${unidadeId}`,
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify(payload)
    }).done(() => {
        showNotification(novoAtivo ? 'Unidade ativada.' : 'Unidade desativada.', 'success');
        carregarGradeUnidadesUc01(produtoId);
    }).fail((xhr) => {
        showNotification(xhr.responseJSON?.error || 'Erro ao atualizar status.', 'danger');
    });
}

function abrirModalEditarUnidadeUc01(unidade) {
    $('#modalUnidadeUc01Editor').remove();
    const isEdit = Boolean(unidade && unidade.id);
    const unBase = String($('#unidade').val() || 'UN').toUpperCase();
    const tipoAtual = String(unidade?.tipo || 'AGRUPAMENTO').toUpperCase();
    const canais = canaisUc01De(unidade || {});
    const tipoOptions = UC01_TIPOS.map((t) =>
        `<option value="${t.value}" title="${escapeHtml(t.tooltip)}" ${tipoAtual === t.value ? 'selected' : ''}>${t.icone} ${t.label}</option>`
    ).join('');

    const canaisHtmlFinal = isEdit || unidade
        ? UC01_CANAIS.map((c) => `
            <div class="col-md-4">
                <div class="form-check">
                    <input class="form-check-input uc01-canal" type="checkbox" id="uc01_canal_${c.key}" data-canal="${c.key}" ${Number(canais[c.key]) === 1 ? 'checked' : ''}>
                    <label class="form-check-label" for="uc01_canal_${c.key}">${escapeHtml(c.label)}</label>
                </div>
            </div>
        `).join('')
        : UC01_CANAIS.map((c) => `
            <div class="col-md-4">
                <div class="form-check">
                    <input class="form-check-input uc01-canal" type="checkbox" id="uc01_canal_${c.key}" data-canal="${c.key}" checked>
                    <label class="form-check-label" for="uc01_canal_${c.key}">${escapeHtml(c.label)}</label>
                </div>
            </div>
        `).join('');

    const html = `
        <div class="modal fade" id="modalUnidadeUc01Editor" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${isEdit ? 'Editar' : (unidade ? 'Duplicar' : 'Nova')} Forma de Venda</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row g-2">
                            <div class="col-md-8">
                                <label class="form-label">Descrição *</label>
                                <input type="text" class="form-control" id="uc01_descricao" value="${escapeHtml(unidade?.descricao || '')}" placeholder="Ex.: Caixa 5 Litros">
                            </div>
                            <div class="col-md-4">
                                <label class="form-label">Tipo *</label>
                                <select class="form-control" id="uc01_tipo">${tipoOptions}</select>
                                <small class="text-muted" id="uc01_tipo_hint"></small>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Unidade Comercial *</label>
                                <input type="text" class="form-control" id="uc01_unidade_comercial" value="${escapeHtml(unidade?.unidade_comercial || '')}" placeholder="Ex.: CX, UN">
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Quantidade *</label>
                                <input type="number" step="0.000001" min="0.000001" class="form-control" id="uc01_quantidade" value="${unidade?.quantidade != null ? unidade.quantidade : '1'}">
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Unidade do estoque</label>
                                <input type="text" class="form-control bg-light" id="uc01_unidade_base" value="${escapeHtml(unBase)}" readonly>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Prioridade *</label>
                                <input type="number" step="1" min="1" class="form-control" id="uc01_prioridade" value="${unidade?.prioridade != null ? unidade.prioridade : ''}" placeholder="Auto">
                            </div>
                            <div class="col-md-4">
                                <div class="form-check mt-4">
                                    <input class="form-check-input" type="checkbox" id="uc01_unidade_padrao" ${Number(unidade?.unidade_padrao) === 1 ? 'checked' : ''}>
                                    <label class="form-check-label" for="uc01_unidade_padrao">Unidade Comercial Padrão</label>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="form-check mt-4">
                                    <input class="form-check-input" type="checkbox" id="uc01_conversao_por_lote" ${Number(unidade?.conversao_por_lote) === 1 ? 'checked' : ''}>
                                    <label class="form-check-label" for="uc01_conversao_por_lote">Conversão por Lote (prep. UC-02)</label>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="form-check mt-4">
                                    <input class="form-check-input" type="checkbox" id="uc01_ativo" ${!unidade || Number(unidade.ativo) !== 0 ? 'checked' : ''}>
                                    <label class="form-check-label" for="uc01_ativo">Ativo</label>
                                </div>
                            </div>
                            <div class="col-12 mt-2">
                                <strong class="d-block mb-2">Canal de Comercialização</strong>
                                <div class="row g-2">${canaisHtmlFinal}</div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="btnSalvarUnidadeUc01">Salvar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(html);
    const modal = new bootstrap.Modal(document.getElementById('modalUnidadeUc01Editor'));
    modal.show();

    const syncTipoHint = () => {
        const meta = metaTipoUc01($('#uc01_tipo').val());
        $('#uc01_tipo_hint').text(meta.tooltip || '');
        if ($('#uc01_tipo').val() === 'PADRAO') {
            $('#uc01_quantidade').val('1');
            $('#uc01_unidade_comercial').val(unBase);
        }
    };
    $('#uc01_tipo').off('change').on('change', syncTipoHint);
    syncTipoHint();

    $('#btnSalvarUnidadeUc01').off('click').on('click', function () {
        const produtoId = window._uc01ProdutoIdAtual;
        const canaisPayload = {};
        $('.uc01-canal').each(function () {
            canaisPayload[$(this).data('canal')] = $(this).is(':checked') ? 1 : 0;
        });

        const payload = {
            descricao: $('#uc01_descricao').val(),
            tipo: $('#uc01_tipo').val(),
            unidade_comercial: $('#uc01_unidade_comercial').val(),
            quantidade: Number($('#uc01_quantidade').val()),
            unidade_base: unBase,
            prioridade: $('#uc01_prioridade').val() !== '' ? Number($('#uc01_prioridade').val()) : undefined,
            unidade_padrao: $('#uc01_unidade_padrao').is(':checked') ? 1 : 0,
            conversao_por_lote: $('#uc01_conversao_por_lote').is(':checked') ? 1 : 0,
            canais_comercializacao: canaisPayload,
            ativo: $('#uc01_ativo').is(':checked') ? 1 : 0
        };

        if (!payload.descricao || !payload.unidade_comercial || !(payload.quantidade > 0)) {
            showNotification('Preencha descrição, unidade comercial e quantidade (> 0).', 'warning');
            return;
        }

        const $btn = $(this).prop('disabled', true);
        const req = isEdit
            ? $.ajax({ url: `${API_URL}/produtos/${produtoId}/unidades-comercializacao/${unidade.id}`, method: 'PUT', contentType: 'application/json', data: JSON.stringify(payload) })
            : $.ajax({ url: `${API_URL}/produtos/${produtoId}/unidades-comercializacao`, method: 'POST', contentType: 'application/json', data: JSON.stringify(payload) });

        req.done(() => {
            modal.hide();
            showNotification('Unidade de comercialização salva.', 'success');
            carregarGradeUnidadesUc01(produtoId);
        }).fail((xhr) => {
            showNotification(xhr.responseJSON?.error || 'Erro ao salvar unidade.', 'danger');
        }).always(() => $btn.prop('disabled', false));
    });
}

function excluirUnidadeUc01(unidadeId) {
    const produtoId = window._uc01ProdutoIdAtual;
    if (!confirm('Excluir esta unidade de comercialização?')) return;
    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/unidades-comercializacao/${unidadeId}`,
        method: 'DELETE'
    }).done(() => {
        showNotification('Unidade excluída.', 'success');
        carregarGradeUnidadesUc01(produtoId);
    }).fail((xhr) => {
        showNotification(xhr.responseJSON?.error || 'Erro ao excluir.', 'danger');
    });
}

window.editarUnidadeUc01PorId = editarUnidadeUc01PorId;
window.excluirUnidadeUc01 = excluirUnidadeUc01;
window.duplicarUnidadeUc01 = duplicarUnidadeUc01;
window.alternarAtivoUnidadeUc01 = alternarAtivoUnidadeUc01;

/* ========== MUC — Unidades Comerciais (API auxiliar; UI oficial = UC-01) ========== */

function inicializarUnidadesComerciaisMuc(produtoId) {
    window._mucProdutoIdAtual = Number(produtoId);
    carregarGradeUnidadesMuc(produtoId);
    $('#btnAdicionarUnidadeMuc').off('click').on('click', () => abrirModalEditarUnidadeMuc(null));
}

function carregarGradeUnidadesMuc(produtoId) {
    const $tbody = $('#tbodyUnidadesMuc');
    if (!$tbody.length) return;

    $tbody.html('<tr><td colspan="7" class="text-muted text-center">Carregando...</td></tr>');

    $.get(`${API_URL}/produtos/${produtoId}/unidades`)
        .done((unidades) => renderGradeUnidadesMuc(unidades || []))
        .fail((xhr) => {
            $tbody.html(`<tr><td colspan="7" class="text-danger text-center">${escapeHtml(xhr.responseJSON?.error || 'Erro ao carregar unidades')}</td></tr>`);
        });
}

function renderGradeUnidadesMuc(unidades) {
    const $tbody = $('#tbodyUnidadesMuc');
    window._mucUnidadesCache = unidades || [];
    if (!unidades.length) {
        $tbody.html('<tr><td colspan="7" class="text-muted text-center">Nenhuma unidade comercial.</td></tr>');
        return;
    }

    $tbody.html(unidades.map((u) => `
        <tr>
            <td><strong>${escapeHtml(u.unidade || '')}</strong>${u.descricao && u.descricao !== u.unidade ? `<div class="small text-muted">${escapeHtml(u.descricao)}</div>` : ''}</td>
            <td>${Number(u.fator_conversao || 0)}</td>
            <td>${formatCurrency(u.preco || 0)}</td>
            <td>${escapeHtml(u.codigo_barras || '—')}</td>
            <td>${Number(u.principal) === 1 ? '<span class="badge bg-success">Sim</span>' : `<button type="button" class="btn btn-link btn-sm p-0" onclick="marcarPrincipalUnidadeMuc(${u.id})">Definir</button>`}</td>
            <td>${Number(u.ativo) === 1 ? 'Sim' : 'Não'}</td>
            <td class="text-nowrap">
                <button type="button" class="btn btn-sm btn-warning" onclick="editarUnidadeMucPorId(${u.id})"><i class="fas fa-edit"></i></button>
                ${Number(u.principal) === 1 ? '' : `<button type="button" class="btn btn-sm btn-danger" onclick="excluirUnidadeMuc(${u.id})"><i class="fas fa-trash"></i></button>`}
            </td>
        </tr>
    `).join(''));
}

function editarUnidadeMucPorId(unidadeId) {
    const unidade = (window._mucUnidadesCache || []).find((u) => Number(u.id) === Number(unidadeId));
    abrirModalEditarUnidadeMuc(unidade || null);
}

function abrirModalEditarUnidadeMuc(unidade) {
    $('#modalUnidadeMucEditor').remove();
    const isEdit = Boolean(unidade && unidade.id);
    const html = `
        <div class="modal fade" id="modalUnidadeMucEditor" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${isEdit ? 'Editar' : 'Nova'} Unidade Comercial</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-2">
                            <label class="form-label">Unidade *</label>
                            <input type="text" class="form-control" id="muc_unidade" value="${escapeHtml(unidade?.unidade || '')}" placeholder="Ex: ML, CX, KG">
                        </div>
                        <div class="mb-2">
                            <label class="form-label">Descrição</label>
                            <input type="text" class="form-control" id="muc_descricao" value="${escapeHtml(unidade?.descricao || '')}">
                        </div>
                        <div class="mb-2">
                            <label class="form-label">Fator de conversão → base *</label>
                            <input type="number" step="0.000001" min="0.000001" class="form-control" id="muc_fator" value="${unidade?.fator_conversao != null ? unidade.fator_conversao : '1'}">
                            <small class="text-muted">Ex.: 1 mL = 0,001 L → fator 0.001</small>
                        </div>
                        <div class="mb-2">
                            <label class="form-label">Preço</label>
                            <input type="number" step="0.01" min="0" class="form-control" id="muc_preco" value="${unidade?.preco != null ? unidade.preco : '0'}">
                        </div>
                        <div class="mb-2">
                            <label class="form-label">Código de barras</label>
                            <input type="text" class="form-control" id="muc_barras" value="${escapeHtml(unidade?.codigo_barras || '')}">
                        </div>
                        <div class="mb-2">
                            <label class="form-label">Código auxiliar</label>
                            <input type="text" class="form-control" id="muc_auxiliar" value="${escapeHtml(unidade?.codigo_auxiliar || '')}">
                        </div>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="muc_principal" ${Number(unidade?.principal) === 1 ? 'checked' : ''}>
                            <label class="form-check-label" for="muc_principal">Unidade principal</label>
                        </div>
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" id="muc_ativo" ${!isEdit || Number(unidade?.ativo) === 1 ? 'checked' : ''}>
                            <label class="form-check-label" for="muc_ativo">Ativa</label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="btnSalvarUnidadeMuc">Salvar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(html);
    const modal = new bootstrap.Modal(document.getElementById('modalUnidadeMucEditor'));
    modal.show();

    $('#btnSalvarUnidadeMuc').off('click').on('click', function () {
        const produtoId = window._mucProdutoIdAtual;
        const payload = {
            unidade: $('#muc_unidade').val(),
            descricao: $('#muc_descricao').val(),
            fator_conversao: Number($('#muc_fator').val()),
            preco: Number($('#muc_preco').val()),
            codigo_barras: $('#muc_barras').val(),
            codigo_auxiliar: $('#muc_auxiliar').val(),
            principal: $('#muc_principal').is(':checked') ? 1 : 0,
            ativo: $('#muc_ativo').is(':checked') ? 1 : 0
        };

        const req = isEdit
            ? $.ajax({ url: `${API_URL}/produtos/${produtoId}/unidades/${unidade.id}`, method: 'PUT', contentType: 'application/json', data: JSON.stringify(payload) })
            : $.ajax({ url: `${API_URL}/produtos/${produtoId}/unidades`, method: 'POST', contentType: 'application/json', data: JSON.stringify(payload) });

        req.done(() => {
            modal.hide();
            carregarGradeUnidadesMuc(produtoId);
            showNotification('Unidade comercial salva.', 'success');
        }).fail((xhr) => {
            showNotification(xhr.responseJSON?.error || 'Erro ao salvar unidade.', 'danger');
        });
    });

    document.getElementById('modalUnidadeMucEditor').addEventListener('hidden.bs.modal', () => {
        $('#modalUnidadeMucEditor').remove();
    }, { once: true });
}

function marcarPrincipalUnidadeMuc(unidadeId) {
    const produtoId = window._mucProdutoIdAtual;
    $.post(`${API_URL}/produtos/${produtoId}/unidades/${unidadeId}/principal`)
        .done(() => {
            carregarGradeUnidadesMuc(produtoId);
            showNotification('Unidade principal definida.', 'success');
        })
        .fail((xhr) => showNotification(xhr.responseJSON?.error || 'Erro ao definir principal.', 'danger'));
}

function excluirUnidadeMuc(unidadeId) {
    if (!confirm('Excluir esta unidade comercial?')) return;
    const produtoId = window._mucProdutoIdAtual;
    $.ajax({ url: `${API_URL}/produtos/${produtoId}/unidades/${unidadeId}`, method: 'DELETE' })
        .done(() => {
            carregarGradeUnidadesMuc(produtoId);
            showNotification('Unidade excluída.', 'success');
        })
        .fail((xhr) => showNotification(xhr.responseJSON?.error || 'Erro ao excluir.', 'danger'));
}

window.carregarVencimentosProdutos = carregarVencimentosProdutos;
window.abrirModalVencimentosProdutos = abrirModalVencimentosProdutos;
window.fecharModalVencimentosProdutos = fecharModalVencimentosProdutos;
window.abrirModalEditarUnidadeMuc = abrirModalEditarUnidadeMuc;
window.editarUnidadeMucPorId = editarUnidadeMucPorId;
window.marcarPrincipalUnidadeMuc = marcarPrincipalUnidadeMuc;
window.excluirUnidadeMuc = excluirUnidadeMuc;
