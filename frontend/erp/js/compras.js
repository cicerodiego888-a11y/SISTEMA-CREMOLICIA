let produtosCompraList = [];
let fornecedoresList = [];
let itensCompraAtual = [];
let compraImportadaXml = null;
let centralDocumentoIdAtual = null;
let modoEntradaF7Compra = false;

function loadCompras() {
    $.when(
        $.ajax({ url: `${API_URL}/produtos`, method: 'GET' }),
        $.ajax({ url: `${API_URL}/compras`, method: 'GET' }),
        $.ajax({ url: `${API_URL}/fornecedores`, method: 'GET' })
    ).done(function(produtosResp, comprasResp, fornecedoresResp) {
        produtosCompraList = produtosResp[0] || [];
        fornecedoresList = fornecedoresResp[0] || [];
        renderCompras(comprasResp[0] || []);
        consumirPendenciaCompraCentral();
    }).fail(function() {
        $('#page-content').html('<div class="alert alert-danger">Erro ao carregar compras.</div>');
    });
}

function renderCompras(compras) {
    const html = `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <div><i class="fas fa-shopping-cart"></i> Compras</div>
                <div>
                    <button class="btn btn-outline-primary btn-sm me-1" onclick="abrirCentralInteligenteEntradas()" title="Documentos fiscais entram pela Central Inteligente">
                        📥 Importar pela Central Inteligente
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="showCompraModal()"><i class="fas fa-plus"></i> Nova compra</button>
                </div>
            </div>
            <div class="card-body">
                <div class="alert alert-info">
                    Ao salvar a compra, o sistema dá entrada no estoque, atualiza custo/preço de venda e lança a despesa automaticamente no financeiro.
                </div>
                <div class="table-responsive">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Data</th>
                                <th>Fornecedor</th>
                                <th>Total</th>
                                <th>Condição</th>
                                <th>Forma</th>
                                <th>Status</th>
                                <th>Pendências</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${compras.map(c => `
                                <tr>
                                    <td>${c.id || '-'}</td>
                                    <td>${formatDate(c.data_compra)}</td>
                                    <td>${c.fornecedor || '-'}${c.tipo_entrada === 'PRODUCAO_PROPRIA' ? ' <span class="badge bg-secondary">Produção própria</span>' : ''}</td>
                                    <td>${formatCurrency(c.total)}</td>
                                    <td>${rotuloCondicaoPagamento(c.condicao_pagamento || 'avista')}</td>
                                    <td>${rotuloFormaPagamento(c.forma_pagamento)}</td>
                                    <td>${formatBadgeStatusCompra(c.status)}</td>
                                    <td>${c.parcelas_pendentes || 0}</td>
                                    <td>
                                        <button class="btn btn-sm btn-info" onclick="viewCompra(${c.id})" title="Visualizar">
                                            <i class="fas fa-eye"></i>
                                        </button>

                                        <button class="btn btn-sm btn-secondary" onclick="abrirDevolucaoCompra(${c.id})" title="Devolução interna">
                                            <i class="fas fa-undo"></i>
                                        </button>

                                        <button class="btn btn-sm btn-danger" onclick="abrirModalNFeDevolucaoCompra(${c.id})" title="NF-e devolução SEFAZ">
                                            <i class="fas fa-file-invoice"></i>
                                        </button>

                                        <button class="btn btn-sm btn-warning" onclick="cancelarCompra(${c.id})" title="Cancelar compra">
                                            <i class="fas fa-ban"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join('') || '<tr><td colspan="9" class="text-center">Nenhuma compra registrada.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
}

function formatBadgeStatusCompra(status) {
    const badges = {
        'normal': '<span class="badge bg-success">Normal</span>',
        'devolvida_parcial': '<span class="badge bg-warning text-dark"><i class="fas fa-undo"></i> Devolvido Parcial</span>',
        'devolvida': '<span class="badge bg-danger"><i class="fas fa-undo"></i> Devolvido Total</span>',
        'cancelada': '<span class="badge bg-secondary"><i class="fas fa-ban"></i> Cancelada</span>'
    };
    return badges[status] || '<span class="badge bg-success">Normal</span>';
}

function rotuloCondicaoPagamento(value) {
    const mapa = { avista: 'À vista', prazo: 'A prazo', parcelado: 'Parcelado', entrada_parcelado: 'Entrada + Parcelamento' };
    return mapa[value] || value || '-';
}

function rotuloFormaPagamento(value) {
    const mapa = {
        dinheiro: 'Dinheiro',
        pix: 'PIX',
        cartao_credito: 'Cartão crédito',
        cartao_debito: 'Cartão débito',
        boleto: 'Boleto',
        transferencia: 'Transferência',
        cheque: 'Cheque'
    };
    return mapa[value] || '-';
}

function formasPagamentoCompra(selected = '') {
    const opcoes = [
        ['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['cartao_credito', 'Cartão crédito'], ['cartao_debito', 'Cartão débito'],
        ['boleto', 'Boleto'], ['transferencia', 'Transferência'], ['cheque', 'Cheque']
    ];
    return opcoes.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function atualizarVisibilidadePagamentoCompra() {
    const condicao = $('#condicao_pagamento').val();
    if (condicao === 'avista') {
        $('#grupo_vencimento_compra').hide();
        $('#grupo_parcelas_compra').hide();
        $('#grupo_entrada_compra').hide();
        $('#data_vencimento').val($('#data_compra').val());
        $('#parcelas').val(1);
        $('#valor_entrada').val(0);
    } else if (condicao === 'prazo') {
        $('#grupo_vencimento_compra').show();
        $('#grupo_parcelas_compra').show();
        $('#grupo_entrada_compra').hide();
        if (parseInt($('#parcelas').val(), 10) < 1) $('#parcelas').val(1);
        $('#valor_entrada').val(0);
    } else if (condicao === 'parcelado') {
        $('#grupo_vencimento_compra').show();
        $('#grupo_parcelas_compra').show();
        $('#grupo_entrada_compra').hide();
        if (parseInt($('#parcelas').val(), 10) < 1) $('#parcelas').val(1);
        $('#valor_entrada').val(0);
    } else if (condicao === 'entrada_parcelado') {
        $('#grupo_vencimento_compra').show();
        $('#grupo_parcelas_compra').show();
        $('#grupo_entrada_compra').show();
        if (parseInt($('#parcelas').val(), 10) < 1) $('#parcelas').val(1);
    }
    calcularParcelasCompra();
}

function calcularParcelasCompra() {
    const total = Number($('#valor_total_nota').val()) || itensCompraAtual.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const parcelas = parseInt($('#parcelas').val(), 10) || 1;
    const dataVencimento = $('#data_vencimento').val();
    const condicao = $('#condicao_pagamento').val();
    const valorEntrada = Number($('#valor_entrada').val()) || 0;

    if (!dataVencimento || (parcelas <= 1 && condicao !== 'entrada_parcelado')) {
        $('#parcelas_detalhes').html('');
        return;
    }

    let html = '<h6>Parcelas:</h6><ul class="list-group list-group-flush">';
    const dataBase = new Date(dataVencimento);

    if (condicao === 'entrada_parcelado' && valorEntrada > 0) {
        // Entrada
        html += `<li class="list-group-item d-flex justify-content-between">
            <span>Entrada</span>
            <span>${formatCurrency(valorEntrada)} - ${dataBase.toISOString().split('T')[0]}</span>
        </li>`;
        // Parcelas restantes
        const valorRestante = total - valorEntrada;
        const valorParcela = valorRestante / parcelas;
        for (let i = 0; i < parcelas; i++) {
            const dataParcela = new Date(dataBase);
            dataParcela.setMonth(dataBase.getMonth() + i);
            html += `<li class="list-group-item d-flex justify-content-between">
                <span>Parcela ${i + 1}</span>
                <span>${formatCurrency(valorParcela)} - ${dataParcela.toISOString().split('T')[0]}</span>
            </li>`;
        }
    } else {
        // Parcelas normais
        const valorParcela = total / parcelas;
        for (let i = 0; i < parcelas; i++) {
            const dataParcela = new Date(dataBase);
            dataParcela.setMonth(dataBase.getMonth() + i);
            html += `<li class="list-group-item d-flex justify-content-between">
                <span>Parcela ${i + 1}</span>
                <span>${formatCurrency(valorParcela)} - ${dataParcela.toISOString().split('T')[0]}</span>
            </li>`;
        }
    }
    html += '</ul>';
    $('#parcelas_detalhes').html(html);
}

function formatNumberInput(value, decimals = 2) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num.toFixed(decimals) : Number(0).toFixed(decimals);
}

/** Motor de Conversão de Unidades — embalagem de compra → unidade de estoque/venda */
function produtoUsaConversaoUnidadesCompra(produto) {
    if (typeof produtoUsaConversaoUnidades === 'function') return produtoUsaConversaoUnidades(produto);
    if (typeof window.produtoUsaConversaoUnidades === 'function') return window.produtoUsaConversaoUnidades(produto);
    if (typeof window.produtoEhFracionado === 'function') return window.produtoEhFracionado(produto);
    return Number(produto?.produto_fracionado ?? produto?.vendido_por_peso ?? 0) === 1;
}

const produtoFracionadoCompra = produtoUsaConversaoUnidadesCompra;

function itemCompraUsaConversaoUnidades(item = {}) {
    return Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0) === 1;
}

const itemCompraEhFracionado = itemCompraUsaConversaoUnidades;

/** MCC-03 — produto com Conversão Física ou Unidades de Comercialização */
function produtoUsaMccEntrada(produto) {
    if (!produto) return false;
    if (Number(produto.utiliza_conversao_fisica || 0) === 1) return true;
    if (Array.isArray(produto.unidades_comercializacao) && produto.unidades_comercializacao.length > 0) {
        return true;
    }
    return false;
}

function isModoMccEntradaCompraAtivo() {
    return produtoUsaMccEntrada(obterProdutoSelecionadoCompra());
}

function obterModoEntradaMccSelecionado() {
    return String($('#modo_entrada_mcc_item').val() || 'PESO_POR_EMBALAGEM');
}

function carregarUnidadesComerciaisProdutoCompra(produtoId) {
    if (!produtoId) return Promise.resolve({ items: [], meta: null });
    return $.ajax({
        url: `${API_URL}/produtos/${produtoId}/unidades-comercializacao`,
        method: 'GET'
    }).then((rows) => {
        if (Array.isArray(rows)) return { items: rows, meta: null };
        return {
            items: Array.isArray(rows?.items) ? rows.items : (Array.isArray(rows?.data) ? rows.data : []),
            meta: rows
        };
    }).catch(() => ({ items: [], meta: null }));
}

function atualizarPainelMccEntradaCompra() {
    const produto = obterProdutoSelecionadoCompra();
    const ativo = produtoUsaMccEntrada(produto);
    const fracionadoLegado = !ativo && produtoUsaConversaoUnidadesCompra(produto);

    $('#painelMccEntrada').toggleClass('d-none', !ativo);
    $('#painelConversaoEmbalagem').toggleClass('d-none', !fracionadoLegado || ativo);

    if (!ativo || !produto) return;

    const unidades = produto.unidades_comercializacao || [];
    const $sel = $('#unidade_comercial_mcc_item');
    const atual = $sel.val();
    $sel.empty();
    $sel.append(`<option value="${String(produto.unidade || 'UN').toUpperCase()}">${String(produto.unidade || 'UN').toUpperCase()} (base)</option>`);
    unidades.forEach((u) => {
        const cod = String(u.unidade_comercial || u.codigo || '').toUpperCase();
        if (!cod) return;
        const desc = u.descricao ? ` — ${u.descricao}` : '';
        $sel.append(`<option value="${cod}">${cod}${desc}</option>`);
    });
    if (atual) $sel.val(atual);

    const exigePeso = Number(produto.utiliza_conversao_fisica || 0) === 1;
    $('#blocoPesoMccEntrada').toggleClass('d-none', !exigePeso);
    atualizarCamposModoMccEntrada();
    calcularPreviewMccEntrada();
}

function atualizarCamposModoMccEntrada() {
    const modo = obterModoEntradaMccSelecionado();
    const modoEmbalagem = modo === 'PESO_POR_EMBALAGEM';
    $('#campoPesoEmbalagemMcc').toggleClass('d-none', !modoEmbalagem);
    $('#campoPesoTotalMcc').toggleClass('d-none', modoEmbalagem);
    $('#campoVolumeTotalMcc').toggleClass('d-none', modoEmbalagem);
    $('#labelQtdMcc').text(modoEmbalagem ? 'Quantidade (UC)' : 'Volume / Quantidade');
}

function calcularPreviewMccEntrada() {
    const produto = obterProdutoSelecionadoCompra();
    if (!produtoUsaMccEntrada(produto)) return null;

    const modo = obterModoEntradaMccSelecionado();
    const unidadeComercial = String($('#unidade_comercial_mcc_item').val() || produto.unidade || 'UN').toUpperCase();
    const qtd = Number($('#quantidade_mcc_item').val() || 0);
    const valorTotal = Number($('#valor_total_mcc_item').val() || 0);
    const unidadeBase = String(produto.unidade || 'UN').toUpperCase();
    const unidades = produto.unidades_comercializacao || [];
    const uc = unidades.find((u) => String(u.unidade_comercial || '').toUpperCase() === unidadeComercial);
    const fatorUc = uc ? Number(uc.quantidade || 1) : 1;
    const qtdBase = unidadeComercial === unidadeBase ? qtd : qtd * fatorUc;

    let fatorFisico = null;
    let textoFator = '';
    if (Number(produto.utiliza_conversao_fisica || 0) === 1) {
        if (modo === 'PESO_POR_EMBALAGEM') {
            const pesoEmb = Number($('#peso_embalagem_mcc_item').val() || 0);
            const volumeEmb = uc ? Number(uc.quantidade || 0) : 1;
            if (pesoEmb > 0 && volumeEmb > 0) {
                fatorFisico = pesoEmb / volumeEmb;
                textoFator = `Fator calculado: 1 ${unidadeBase} = ${fatorFisico.toFixed(6)} ${String(produto.unidade_conversao_fisica || 'KG').toUpperCase()} (não digite o fator)`;
            }
        } else {
            const pesoTotal = Number($('#peso_total_mcc_item').val() || 0);
            const volumeTotal = Number($('#volume_total_mcc_item').val() || qtdBase || 0);
            if (pesoTotal > 0 && volumeTotal > 0) {
                fatorFisico = pesoTotal / volumeTotal;
                textoFator = `Fator calculado: 1 ${unidadeBase} = ${fatorFisico.toFixed(6)} ${String(produto.unidade_conversao_fisica || 'KG').toUpperCase()} (não digite o fator)`;
            }
        }
    }

    const custoUnitario = qtdBase > 0 ? valorTotal / qtdBase : 0;
    $('#resultado_qtd_base_mcc').text(`${formatNumberInput(qtdBase, 3)} ${unidadeBase}`);
    $('#resultado_fator_mcc').text(textoFator || (Number(produto.utiliza_conversao_fisica || 0) === 1
        ? 'Informe o peso para o sistema calcular o fator.'
        : 'Conversão comercial → unidade base (sem física).'));
    $('#resultado_custo_mcc').text(`R$ ${formatarCustoUnitarioVenda(custoUnitario)}`);

    if (custoUnitario > 0) {
        $('#preco_item').val(formatarCustoUnitarioVenda(custoUnitario));
        calcularValorVendaItem();
    }

    atualizarIndicadorDistribuicaoFiscal(qtdBase, unidadeBase);
    return { qtdBase, custoUnitario, valorTotal, unidadeComercial, modo, fatorFisico };
}

const TIPOS_COMPRA_EMBALAGEM = ['Rolo', 'Bobina', 'Caixa', 'Fardo', 'Galão', 'Tambor', 'Pacote'];

function pluralizarTipoEmbalagem(tipo, quantidade) {
    const qtd = Number(quantidade || 0);
    if (qtd === 1) return tipo;
    const irregulares = { 'Galão': 'Galões', 'Tambor': 'Tambores' };
    return irregulares[tipo] || `${tipo}s`;
}

function opcoesCompraEmbalagemHtml(selecionado = 'Rolo') {
    return TIPOS_COMPRA_EMBALAGEM.map((tipo) => {
        const selected = String(selecionado) === tipo ? ' selected' : '';
        return `<option value="${tipo}"${selected}>${tipo}</option>`;
    }).join('');
}

function formatarCustoUnitarioVenda(value) {
    return formatNumberInput(value, 4);
}

function obterProdutoSelecionadoCompra() {
    const produtoId = $('#produto_id_item').val();
    if (!produtoId) return null;
    return produtosCompraList.find(p => String(p.id) === String(produtoId)) || null;
}

function isModoConversaoUnidadesCompraAtivo() {
    return produtoUsaConversaoUnidadesCompra(obterProdutoSelecionadoCompra());
}

const isModoFracionadoCompraAtivo = isModoConversaoUnidadesCompraAtivo;

function calcularConversaoEmbalagemCompra() {
    if (!isModoConversaoUnidadesCompraAtivo()) return null;

    const compraEm = String($('#compra_em_item').val() || 'Rolo');
    const qtdEmbalagens = Number($('#quantidade_embalagens_item').val() || 0);
    const qtdPorEmbalagem = Number($('#quantidade_por_embalagem_item').val() || 0);
    const valorTotal = Number($('#valor_total_fracionado_item').val() || 0);
    const unidade = String($('#unidade_fracionada_item').val() || 'UN').toUpperCase();
    const qtdTotal = qtdEmbalagens * qtdPorEmbalagem;
    const custoUnitario = qtdTotal > 0 ? valorTotal / qtdTotal : 0;

    $('#resultado_qtd_total_fracionado').text(`${formatNumberInput(qtdTotal, 3)} ${unidade}`);
    $('#resultado_custo_unitario_fracionado').text(`R$ ${formatarCustoUnitarioVenda(custoUnitario)}`);

    if (qtdEmbalagens > 0 && qtdPorEmbalagem > 0) {
        const tipoPlural = pluralizarTipoEmbalagem(compraEm, qtdEmbalagens);
        $('#resultado_formula_conversao').text(
            `${formatNumberInput(qtdEmbalagens, 3)} ${tipoPlural} × ${formatNumberInput(qtdPorEmbalagem, 3)} ${unidade} = ${formatNumberInput(qtdTotal, 3)} ${unidade}`
        );
    } else {
        $('#resultado_formula_conversao').text('');
    }

    atualizarIndicadorDistribuicaoFiscal(qtdTotal, unidade);

    if (custoUnitario > 0) {
        $('#preco_item').val(formatarCustoUnitarioVenda(custoUnitario));
        $('#custo_unitario_fracionado_item').val(formatarCustoUnitarioVenda(custoUnitario));
        calcularValorVendaItem();
    } else {
        $('#custo_unitario_fracionado_item').val('');
    }

    return { qtdTotal, custoUnitario, valorTotal, unidade, compraEm };
}

function atualizarPainelConversaoUnidadesCompra() {
    const produto = obterProdutoSelecionadoCompra();
    const mccAtivo = produtoUsaMccEntrada(produto);
    const ativo = !mccAtivo && produtoUsaConversaoUnidadesCompra(produto);

    $('#painelConversaoEmbalagem').toggleClass('d-none', !ativo);
    $('#linhaPrecoCompraNormal .campo-preco-compra-item').toggleClass('d-none', ativo || mccAtivo);
    $('#campoCustoUnitarioFracionado').toggleClass('d-none', !ativo);

    if (ativo && produto) {
        $('#unidade_fracionada_item').val(String(produto.unidade || 'UN').toUpperCase());
        if (!$('#quantidade_embalagens_item').val()) {
            $('#quantidade_embalagens_item').val('1');
        }
        calcularConversaoEmbalagemCompra();
    } else if (!mccAtivo) {
        $('#custo_unitario_fracionado_item').val('');
    }

    atualizarPainelMccEntradaCompra();
    atualizarCamposQuantidadeCompra();
}

const atualizarPainelFracionadoCompra = atualizarPainelConversaoUnidadesCompra;

function isModoEntradaF7CompraAtivo() {
    if (isModoConversaoUnidadesCompraAtivo()) return true;
    return !!modoEntradaF7Compra;
}

function toggleModoEntradaF7Compra() {
    if (isModoConversaoUnidadesCompraAtivo()) {
        showNotification('Motor de Conversão de Unidades exige distribuição absoluta: Fiscal + Não Fiscal = total convertido.', 'info');
        return;
    }
    modoEntradaF7Compra = !modoEntradaF7Compra;
    atualizarCamposQuantidadeCompra();
    const status = modoEntradaF7Compra ? 'ativado' : 'desativado';
    showNotification(`Modo F7 (entrada fiscal/não fiscal) ${status}.`, 'info');
}

function obterTotalConvertidoItemCompra() {
    if (!isModoConversaoUnidadesCompraAtivo()) return null;

    const qtdEmbalagens = Number($('#quantidade_embalagens_item').val() || 0);
    const qtdPorEmbalagem = Number($('#quantidade_por_embalagem_item').val() || 0);
    const unidade = String($('#unidade_fracionada_item').val() || 'UN').toUpperCase();
    const qtdTotal = qtdEmbalagens * qtdPorEmbalagem;

    if (qtdTotal <= 0) return null;
    return { qtdTotal, unidade };
}

function validarDistribuicaoFiscalCompra(qtdFiscal, qtdNaoFiscal, totalConvertido, unidade = '') {
    const fiscal = Number(qtdFiscal || 0);
    const naoFiscal = Number(qtdNaoFiscal || 0);
    const total = Number(totalConvertido || 0);
    const soma = fiscal + naoFiscal;
    const unidadeLabel = unidade ? ` ${unidade}` : '';

    if (total <= 0) {
        return { ok: false, mensagem: 'Total convertido inválido.' };
    }
    if (soma <= 0) {
        return {
            ok: false,
            mensagem: `Informe quantidades absolutas${unidadeLabel}: Fiscal + Não Fiscal = ${formatNumberInput(total, 3)}${unidadeLabel}.`
        };
    }
    if (Math.abs(soma - total) > 0.001) {
        return {
            ok: false,
            mensagem: `Fiscal + Não Fiscal deve somar ${formatNumberInput(total, 3)}${unidadeLabel}. Informado: ${formatNumberInput(fiscal, 3)} + ${formatNumberInput(naoFiscal, 3)} = ${formatNumberInput(soma, 3)}.`
        };
    }

    return { ok: true, fiscal, naoFiscal, total, soma };
}

function atualizarIndicadorDistribuicaoFiscal(totalInformado, unidadeInformada) {
    const $painel = $('#painelIndicadorDistribuicaoFiscal');
    const $indicador = $('#indicadorDistribuicaoFiscal');
    if (!$indicador.length) return;

    if (!isModoConversaoUnidadesCompraAtivo()) {
        $painel.addClass('d-none');
        $indicador.addClass('d-none').removeClass('alert-success alert-warning alert-danger alert-info').text('');
        return;
    }

    $painel.removeClass('d-none');

    const totalInfo = obterTotalConvertidoItemCompra();
    const qtdTotal = Number(totalInformado ?? totalInfo?.qtdTotal ?? 0);
    const unidade = String(unidadeInformada || totalInfo?.unidade || 'UN').toUpperCase();

    if (qtdTotal <= 0) {
        $indicador.removeClass('d-none alert-success alert-warning alert-danger').addClass('alert alert-info py-2 mb-0');
        $indicador.text('Informe a conversão de embalagem para distribuir o estoque em valores absolutos.');
        return;
    }

    const qtdFiscal = Number($('#quantidade_fiscal_item').val() || 0);
    const qtdNaoFiscal = Number($('#quantidade_nao_fiscal_item').val() || 0);
    const soma = qtdFiscal + qtdNaoFiscal;
    const diff = Number((qtdTotal - soma).toFixed(3));
    const ok = Math.abs(diff) <= 0.001;

    $indicador.removeClass('d-none alert-success alert-warning alert-danger alert-info');

    if (soma === 0) {
        $indicador.addClass('alert alert-info py-2 mb-0');
        $indicador.html(`Informe <strong>valores absolutos</strong> em ${unidade}: Fiscal + Não Fiscal = <strong>${formatNumberInput(qtdTotal, 3)} ${unidade}</strong>.`);
        return;
    }

    if (ok) {
        $indicador.addClass('alert alert-success py-2 mb-0');
        $indicador.html(`✓ ${formatNumberInput(qtdFiscal, 3)} + ${formatNumberInput(qtdNaoFiscal, 3)} = ${formatNumberInput(qtdTotal, 3)} ${unidade}`);
        return;
    }

    if (soma < qtdTotal) {
        $indicador.addClass('alert alert-warning py-2 mb-0');
        $indicador.html(`${formatNumberInput(qtdFiscal, 3)} + ${formatNumberInput(qtdNaoFiscal, 3)} = ${formatNumberInput(soma, 3)} ${unidade}. Faltam <strong>${formatNumberInput(diff, 3)} ${unidade}</strong> para completar ${formatNumberInput(qtdTotal, 3)}.`);
        return;
    }

    $indicador.addClass('alert alert-danger py-2 mb-0');
    $indicador.html(`${formatNumberInput(qtdFiscal, 3)} + ${formatNumberInput(qtdNaoFiscal, 3)} = ${formatNumberInput(soma, 3)} ${unidade}. Excede o total convertido em <strong>${formatNumberInput(Math.abs(diff), 3)} ${unidade}</strong>.`);
}

function atualizarCamposQuantidadeCompra() {
    const fracionado = isModoConversaoUnidadesCompraAtivo();
    const ativo = fracionado || isModoEntradaF7CompraAtivo();
    const unidade = fracionado
        ? String($('#unidade_fracionada_item').val() || obterProdutoSelecionadoCompra()?.unidade || 'UN').toUpperCase()
        : '';

    $('#campoQuantidadeSimplesCompra').toggleClass('d-none', ativo);
    $('#campoQuantidadeFiscalCompra').toggleClass('d-none', !ativo);
    $('#campoQuantidadeNaoFiscalCompra').toggleClass('d-none', !ativo);

    if (fracionado) {
        $('#labelQtdFiscalCompra').text(`Fiscal (${unidade})`);
        $('#labelQtdNaoFiscalCompra').text(`Não Fiscal (${unidade})`);
    } else {
        $('#labelQtdFiscalCompra').text('Qtd Fiscal');
        $('#labelQtdNaoFiscalCompra').text('Qtd Não Fiscal');
    }

    let indicador = '';
    if (fracionado) {
        indicador = `Distribua em ${unidade} com valores absolutos (nunca %): Fiscal + Não Fiscal = total convertido.`;
    } else if (ativo) {
        indicador = 'F7 ativo: informe Qtd Fiscal e/ou Qtd Não Fiscal';
    }

    $('#indicadorModoF7Compra')
        .toggleClass('d-none', !indicador)
        .text(indicador);
    $('#hintTeclaF7Compra').toggleClass('d-none', fracionado);
    $('#colunaQuantidadeCompraHeader').text(ativo ? 'Qtd' : 'Qtd Fiscal');
    atualizarIndicadorDistribuicaoFiscal();
    if ($('#itensCompraBody').length) {
        renderItensCompraTabela();
    }
}

function onCompraModalKeyDown(event) {
    if (event.key !== 'F7') return;
    if (!$('#compraModal').hasClass('show')) return;
    event.preventDefault();
    toggleModoEntradaF7Compra();
}

function resolverQuantidadesItemCompra(quantidadeSimples, quantidadeFiscal, quantidadeNaoFiscal) {
    if (isModoConversaoUnidadesCompraAtivo() || isModoEntradaF7CompraAtivo()) {
        const qtdFiscal = Number(quantidadeFiscal || 0);
        const qtdNaoFiscal = Number(quantidadeNaoFiscal || 0);
        return {
            quantidade_fiscal: qtdFiscal,
            quantidade_nao_fiscal: qtdNaoFiscal,
            quantidade: qtdFiscal + qtdNaoFiscal
        };
    }

    const qtd = Number(quantidadeSimples || 0);
    return {
        quantidade_fiscal: qtd,
        quantidade_nao_fiscal: 0,
        quantidade: qtd
    };
}

function formatarQuantidadeItemCompra(item = {}) {
    const qtdFiscal = Number(item.quantidade_fiscal ?? item.quantidade ?? 0);
    const qtdNaoFiscal = Number(item.quantidade_nao_fiscal || 0);
    const qtdTotal = Number(item.quantidade ?? (qtdFiscal + qtdNaoFiscal));

    if (itemCompraEhFracionado(item) && qtdNaoFiscal > 0) {
        return `${formatNumberInput(qtdFiscal, 3)} + ${formatNumberInput(qtdNaoFiscal, 3)}`;
    }

    if (isModoEntradaF7CompraAtivo() && !itemCompraEhFracionado(item)) {
        return formatNumberInput(qtdTotal);
    }

    if (itemCompraEhFracionado(item)) {
        return formatNumberInput(qtdFiscal, 3);
    }

    return formatNumberInput(qtdFiscal);
}

function calcularSubtotalFinanceiroItemCompra(item = {}) {
    const quantidade = Number(item.quantidade || 0);
    const preco = Number(item.preco_unitario || 0);
    return Number((quantidade * preco).toFixed(2));
}

function normalizeItemCompra(item = {}) {
    const qtds = item.quantidade_fiscal !== undefined || item.quantidade_nao_fiscal !== undefined
        ? {
            quantidade_fiscal: Number(item.quantidade_fiscal || 0),
            quantidade_nao_fiscal: Number(item.quantidade_nao_fiscal || 0),
            quantidade: Number(item.quantidade_fiscal || 0) + Number(item.quantidade_nao_fiscal || 0)
        }
        : {
            quantidade_fiscal: Number(item.quantidade || 1),
            quantidade_nao_fiscal: 0,
            quantidade: Number(item.quantidade || 1)
        };
    const quantidade = qtds.quantidade || Number(item.quantidade || 1);
    const fracionado = itemCompraEhFracionado(item);
    const casasCusto = fracionado ? 4 : 2;
    const custo = fracionado
        ? resolverCustoUnitarioItemCompra(item, quantidade)
        : Number(item.preco_unitario || item.preco_compra || 0);
    const margem = Number(item.margem_lucro ?? item.lucro_percentual ?? 30);
    const ultimoPrecoCompra = Number(item.ultimo_preco_compra || custo);
    const precoVenda = Number(item.preco_venda_sugerido || item.preco_venda || (custo * (1 + margem / 100)) || 0);
    const normalizado = {
        produto_id: item.produto_id ? Number(item.produto_id) : '',
        produto_nome: item.produto_nome || item.nome || item.descricao_produto || '',
        codigo_barras: item.codigo_barras || item.codigo || '',
        unidade: item.unidade || 'UN',
        ncm: item.ncm || '',
        quantidade,
        quantidade_fiscal: qtds.quantidade_fiscal,
        quantidade_nao_fiscal: qtds.quantidade_nao_fiscal,
        preco_unitario: Number(custo.toFixed(casasCusto)),
        ultimo_preco_compra: Number(ultimoPrecoCompra.toFixed(casasCusto)),
        margem_lucro: Number(margem.toFixed(2)),
        preco_venda_sugerido: Number(precoVenda.toFixed(2)),
        produto_fracionado: itemCompraEhFracionado(item) ? 1 : 0,
        vendido_por_peso: itemCompraEhFracionado(item) ? 1 : 0,
        peso_total_compra: Number(item.peso_total_compra || item.quantidade || 0),
        custo_por_kg: Number((item.custo_por_kg || custo || 0).toFixed(casasCusto)),
        atualizar_preco_venda: Number(item.atualizar_preco_venda ?? 1),
        frete_rateado: Number(item.frete_rateado || 0),
        desconto_rateado: Number(item.desconto_rateado || 0),
        outras_despesas_rateado: Number(item.outras_despesas_rateado || 0),
        custo_unitario_final: Number((item.custo_unitario_final || custo || 0).toFixed(casasCusto)),
        subtotal: calcularSubtotalFinanceiroItemCompra({
            ...item,
            quantidade,
            preco_unitario: Number(custo.toFixed(casasCusto))
        }),
        data_validade: item.data_validade || null,
        compra_em: item.compra_em || '',
        codigo_fornecedor: item.codigo_fornecedor || item.codigoFornecedor || '',
        miip_sugestao: item.miip_sugestao || null,
        miip_resultado: item.miip_resultado || null,
        quantidade_embalagens: Number(item.quantidade_embalagens || 0),
        quantidade_por_embalagem: Number(item.quantidade_por_embalagem || 0),
        valor_total_embalagem: Number(item.valor_total_embalagem || 0)
    };

    return sincronizarQuantidadesEstoqueItemCompra(
        sincronizarPrecosCadastroItemCompra(normalizado)
    );
}

function recalcularLinhaCompra(index, origem = 'custo') {
    const item = itensCompraAtual[index];
    if (!item) return;
    item.quantidade = Number(item.quantidade || 0);

    if (itemCompraEhFracionado(item)) {
        item.preco_unitario = resolverCustoUnitarioItemCompra(item, item.quantidade);
        item.custo_unitario_final = item.preco_unitario;
        item.custo_por_kg = item.preco_unitario;
    } else {
        item.preco_unitario = Number(item.preco_unitario || 0);
    }

    item.margem_lucro = Number(item.margem_lucro || 0);
    item.preco_venda_sugerido = Number(item.preco_venda_sugerido || 0);

    if (origem === 'margem' || origem === 'custo') {
        item.preco_venda_sugerido = Number((item.preco_unitario * (1 + (item.margem_lucro / 100))).toFixed(2));
    } else if (origem === 'venda') {
        item.margem_lucro = item.preco_unitario > 0
            ? Number((((item.preco_venda_sugerido - item.preco_unitario) / item.preco_unitario) * 100).toFixed(2))
            : 0;
    }

    item.subtotal = calcularSubtotalFinanceiroItemCompra(item);

    sincronizarPrecosCadastroItemCompra(item);
}


function recalcularTotaisCompraNota() {
    const valorProdutos = itensCompraAtual.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const desconto = Number($('#valor_desconto').val()) || 0;
    const frete = Number($('#valor_frete').val()) || 0;
    const outras = Number($('#valor_outras_despesas').val()) || 0;
    const totalNota = Number((valorProdutos - desconto + frete + outras).toFixed(2));

    $('#valor_produtos').val(formatNumberInput(valorProdutos));
    $('#valor_total_itens').val(formatNumberInput(valorProdutos));
    $('#valor_total_nota').val(formatNumberInput(totalNota));
    $('#totalCompra').text(formatCurrency(totalNota));

    const totalXml = Number($('#valor_total_nota').val()) || totalNota;
    const diferenca = Number((totalXml - totalNota).toFixed(2));

    $('#conferencia_total_compra').remove();

    let classe = Math.abs(diferenca) <= 0.05 ? 'alert-success' : 'alert-warning';
    let texto = Math.abs(diferenca) <= 0.05
        ? 'Conferência OK: total dos itens bate com o total da nota.'
        : `Atenção: diferença entre XML e itens: ${formatCurrency(diferenca)}. Verifique frete, desconto ou despesas.`;

    $('#valor_total_nota').closest('.row').after(`
      <div class="col-12 mt-2" id="conferencia_total_compra">
        <div class="alert ${classe} py-2 mb-0">${texto}</div>
      </div>
    `);
}

function removerItemCompra(index) {
    if (index < 0 || index >= itensCompraAtual.length) return;
    itensCompraAtual.splice(index, 1);
    renderItensCompraTabela();
    calcularParcelasCompra();
}

function formatarPrecoCompraItem(item = {}) {
    const fracionado = itemCompraEhFracionado(item);
    const valor = Number(item.preco_unitario || 0);
    if (fracionado) {
        return `R$ ${formatarCustoUnitarioVenda(valor)}`;
    }
    return formatCurrency(valor);
}

function resolverCustoUnitarioItemCompra(item = {}, quantidadeInformada) {
    if (!itemCompraEhFracionado(item)) {
        return Number(item.preco_unitario || item.preco_compra || 0);
    }

    const quantidade = Number(quantidadeInformada ?? item.quantidade ?? 0);
    const valorTotal = Number(item.valor_total_embalagem || 0);
    let custo = Number(item.custo_unitario_final || item.custo_por_kg || item.preco_unitario || 0);

    if (valorTotal > 0 && quantidade > 0) {
        const custoCalculado = valorTotal / quantidade;
        if (!custo || Math.abs(custo - valorTotal) < 0.01) {
            custo = custoCalculado;
        }
    }

    return Number(custo.toFixed(4));
}

function sincronizarPrecosCadastroItemCompra(item = {}) {
    const fracionado = itemCompraEhFracionado(item);
    const quantidade = Number(item.quantidade || 0);
    const casasCusto = fracionado ? 4 : 2;
    const custo = fracionado
        ? resolverCustoUnitarioItemCompra(item, quantidade)
        : Number(item.preco_unitario || 0);

    item.preco_unitario = Number(custo.toFixed(casasCusto));
    item.custo_unitario_final = item.preco_unitario;
    item.custo_por_kg = item.preco_unitario;
    item.margem_lucro = Number(item.margem_lucro ?? 30);

    if (Number(item.atualizar_preco_venda ?? 1) === 1 && item.preco_unitario > 0) {
        item.preco_venda_sugerido = Number((item.preco_unitario * (1 + item.margem_lucro / 100)).toFixed(2));
    }

    return item;
}

function sincronizarQuantidadesEstoqueItemCompra(item = {}) {
    if (!itemCompraEhFracionado(item)) return item;

    const qtdFiscal = Number(item.quantidade_fiscal || 0);
    const qtdNaoFiscal = Number(item.quantidade_nao_fiscal || 0);
    const totalConvertido = Number(item.peso_total_compra || 0)
        || (Number(item.quantidade_embalagens || 0) * Number(item.quantidade_por_embalagem || 0));
    const qtdEmbalagens = Number(item.quantidade_embalagens || 0);
    const somaInformada = qtdFiscal + qtdNaoFiscal;

    let quantidadeEstoque = somaInformada > 0 ? somaInformada : totalConvertido;
    if (qtdEmbalagens > 0 && Math.abs(quantidadeEstoque - qtdEmbalagens) < 0.001 && totalConvertido > qtdEmbalagens) {
        quantidadeEstoque = totalConvertido;
    }

    item.quantidade_fiscal = qtdFiscal;
    item.quantidade_nao_fiscal = qtdNaoFiscal;
    item.quantidade = quantidadeEstoque;
    item.peso_total_compra = totalConvertido > 0 ? totalConvertido : quantidadeEstoque;
    return item;
}

function renderItensCompraTabela() {
    const tbody = $('#itensCompraBody');
    const optionsProdutos = '<option value="">Selecione</option>' + produtosCompraList.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
    tbody.html(itensCompraAtual.map((item, index) => `
        <tr>
            <td style="min-width:220px;">
                <select class="form-control form-control-sm mb-1" onchange="alterarProdutoItemCompra(${index}, this.value)">
                    ${optionsProdutos.replace(`value="${item.produto_id}"`, `value="${item.produto_id}" selected`)}
                </select>
                ${renderMiipSugestaoCard(item, index)}
                <div class="text-muted small">${escapeHtml(item.produto_nome || '')}</div>
            </td>
            <td style="min-width:120px;">${escapeHtml(item.codigo_barras || '')}</td>
            <td style="min-width:110px;">${item.data_validade ? escapeHtml(item.data_validade) : '<span class="text-muted">-</span>'}</td>
            <td style="min-width:90px;">${formatarQuantidadeItemCompra(item)}</td>
            <td style="min-width:110px;">
              ${formatarPrecoCompraItem(item)}
              ${item.custo_unitario_final && Number(item.custo_unitario_final) !== Number(item.preco_unitario)
                ? `<br><small class="text-muted">Custo final: ${itemCompraEhFracionado(item) ? `R$ ${formatarCustoUnitarioVenda(item.custo_unitario_final)}` : formatCurrency(item.custo_unitario_final)}</small>` 
                : ''}
            </td>
            <td style="min-width:95px;">${formatNumberInput(item.margem_lucro)}%</td>
            <td style="min-width:110px;">
              ${formatCurrency(item.preco_venda_sugerido)}
              <br>
              <small>
                <label>
                  <input type="checkbox" ${Number(item.atualizar_preco_venda ?? 1) === 1 ? 'checked' : ''}
                    onchange="itensCompraAtual[${index}].atualizar_preco_venda = this.checked ? 1 : 0">
                  Atualizar preço
                </label>
              </small>
            </td>
            <td>${formatCurrency(item.subtotal)}</td>
            <td>
                <button class="btn btn-sm btn-warning me-1" onclick="editarItemCompra(${index})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-danger" onclick="removerItemCompra(${index})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="9" class="text-center">Nenhum item adicionado.</td></tr>');
    recalcularTotaisCompraNota();
    calcularParcelasCompra();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function obterUsuarioLogadoCompra() {
    try {
        return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
        return {};
    }
}

function miipClasseConfianca(confianca) {
    const valor = String(confianca || 'NENHUMA').toUpperCase();
    if (valor === 'ALTA') return 'miip-badge-confianca--alta';
    if (valor === 'MEDIA' || valor === 'MÉDIA') return 'miip-badge-confianca--media';
    if (valor === 'BAIXA') return 'miip-badge-confianca--baixa';
    return 'miip-badge-confianca--nenhuma';
}

function miipConfiancaLabel(confianca) {
    const valor = String(confianca || 'NENHUMA').toUpperCase();
    if (valor === 'MEDIA') return 'MÉDIA';
    return valor;
}

function miipMotorIcon(motor) {
    if (motor === 'motor_gtin') return 'fa-barcode';
    if (motor === 'motor_associacao_fornecedor') return 'fa-truck-loading';
    return 'fa-brain';
}

function miipItemExibeSugestao(item) {
    return Boolean(
        compraImportadaXml
        && item?.miip_sugestao
        && item.miip_sugestao.encontrado
        && item.miip_sugestao.status === 'pendente'
        && item.miip_sugestao.produtoId
    );
}

function renderMiipSugestaoCard(item, index) {
    const sugestao = item.miip_sugestao;
    if (!sugestao) return '';

    if (sugestao.status === 'confirmado') {
        return `<div class="miip-status-resolvido"><i class="fas fa-check-circle text-success"></i> Associação confirmada</div>`;
    }
    if (sugestao.status === 'ignorado') {
        return `<div class="miip-status-resolvido"><i class="fas fa-eye-slash"></i> Sugestão ignorada</div>`;
    }
    if (sugestao.status === 'novo_produto') {
        return `<div class="miip-status-resolvido"><i class="fas fa-plus-circle"></i> Cadastro de novo produto solicitado</div>`;
    }
    if (!miipItemExibeSugestao(item)) return '';

    const confianca = sugestao.confianca || 'NENHUMA';
    const motorLabel = escapeHtml(sugestao.motorLabel || sugestao.motor || 'MIIP');
    const produtoNome = escapeHtml(sugestao.produtoNome || 'Produto sugerido');
    const motorIcon = miipMotorIcon(sugestao.motor);

    return `
        <div class="miip-sugestao-card">
            <div class="miip-sugestao-header">
                <span class="miip-sugestao-titulo"><i class="fas fa-magic"></i> Sugestão MIIP</span>
                <span class="miip-badge-confianca ${miipClasseConfianca(confianca)}">${escapeHtml(miipConfiancaLabel(confianca))}</span>
            </div>
            <div class="miip-produto-nome">${produtoNome}</div>
            <div class="miip-motor-tag"><i class="fas ${motorIcon}"></i> ${motorLabel}</div>
            <div class="miip-acoes">
                <button type="button" class="btn btn-sm btn-confirmar" onclick="confirmarAssociacaoMiip(${index})">
                    <i class="fas fa-link"></i> Confirmar Associação
                </button>
                <button type="button" class="btn btn-sm btn-outline-primary" onclick="miipNovoProdutoItemCompra(${index})">
                    <i class="fas fa-plus"></i> Novo Produto
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="ignorarSugestaoMiip(${index})">
                    <i class="fas fa-ban"></i> Ignorar
                </button>
            </div>
        </div>
    `;
}

function renderMiipImportacaoStatus(totalSugestoes, usarMiip, resumo) {
    const container = $('#miipImportacaoStatus');
    if (!container.length) return;

    if (!compraImportadaXml) {
        container.hide().html('');
        return;
    }

    if (!usarMiip) {
        container.show().html(`
            <div class="miip-importacao-status miip-importacao-status--off">
                <i class="fas fa-power-off"></i> MIIP desativado — associação manual
            </div>
        `);
        return;
    }

    if (resumo && resumo.totalItens > 0) {
        container.show().html(`
            <div class="miip-importacao-status">
                <i class="fas fa-robot"></i>
                MIIP: ${resumo.identificadosAutomaticamente} automático(s),
                ${resumo.precisamConfirmacao} confirmação(ões),
                ${resumo.precisamCadastro} cadastro(s)
                <small class="text-muted">(${resumo.tempoProcessamento}ms)</small>
            </div>
        `);
        return;
    }

    container.show().html(`
        <div class="miip-importacao-status">
            <i class="fas fa-robot"></i>
            ${totalSugestoes > 0
                ? `${totalSugestoes} sugestão(ões) inteligente(s) encontrada(s)`
                : 'Nenhuma sugestão automática — revise os itens manualmente'}
        </div>
    `);
}

function aplicarMiipImportacaoXml(data) {
    const miip = data?.miip_importacao;
    if (!miip || !miip.usarMiipImportacaoXML) {
        carregarSugestoesMiipXml();
        return;
    }

    const resultados = Array.isArray(miip.resultados) ? miip.resultados : [];
    resultados.forEach((resultado) => {
        const item = itensCompraAtual[resultado.indice];
        if (!item) return;

        item.miip_resultado = resultado;

        if (resultado.associadoAutomaticamente && resultado.produtoEncontrado?.id) {
            item.produto_id = resultado.produtoEncontrado.id;
        }

        if (resultado.precisaConfirmacao && item.miip_sugestao) {
            item.miip_sugestao = {
                ...item.miip_sugestao,
                status: 'pendente'
            };
        }
    });

    renderMiipImportacaoStatus(
        resultados.filter((r) => r.precisaConfirmacao).length,
        true,
        miip.resumo || null
    );
    renderItensCompraTabela();
}

function aplicarSugestoesMiipXml(resposta) {
    const sugestoes = Array.isArray(resposta?.itens) ? resposta.itens : [];

    sugestoes.forEach((sugestao) => {
        const item = itensCompraAtual[sugestao.indice];
        if (!item || !sugestao.encontrado) return;

        item.miip_sugestao = {
            ...sugestao,
            status: 'pendente'
        };
    });

    renderMiipImportacaoStatus(
        sugestoes.filter((s) => s.encontrado).length,
        resposta?.usarMiip !== false
    );
    renderItensCompraTabela();
}

function carregarSugestoesMiipXml() {
    if (!compraImportadaXml || !Array.isArray(itensCompraAtual) || itensCompraAtual.length === 0) {
        renderMiipImportacaoStatus(0, false);
        return;
    }

    const payload = {
        origem: 'compra',
        fornecedor: compraImportadaXml.fornecedor || $('#fornecedor').val() || '',
        fornecedor_cnpj: compraImportadaXml.fornecedor_cnpj || '',
        itens: itensCompraAtual.map((item) => ({
            produto_nome: item.produto_nome,
            codigo_barras: item.codigo_barras,
            codigo_fornecedor: item.codigo_fornecedor,
            ncm: item.ncm,
            unidade: item.unidade,
            fornecedor_cnpj: compraImportadaXml.fornecedor_cnpj || '',
            fornecedor_nome: compraImportadaXml.fornecedor || ''
        }))
    };

    $.ajax({
        url: `${API_URL}/miip/identificar-lote`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload)
    }).done(function(resposta) {
        aplicarSugestoesMiipXml(resposta || {});
    }).fail(function() {
        renderMiipImportacaoStatus(0, false);
        showNotification('Não foi possível carregar sugestões MIIP. Continue com associação manual.', 'warning');
    });
}

function confirmarAssociacaoMiip(index) {
    const item = itensCompraAtual[index];
    const sugestao = item?.miip_sugestao;
    if (!item || !sugestao || !sugestao.produtoId) return;

    alterarProdutoItemCompra(index, sugestao.produtoId);

    const usuario = obterUsuarioLogadoCompra();
    const fornecedorCnpj = compraImportadaXml?.fornecedor_cnpj || '';

    if (fornecedorCnpj && item.codigo_fornecedor) {
        $.ajax({
            url: `${API_URL}/miip/feedback`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                confirmado: true,
                produtoId: sugestao.produtoId,
                fornecedorCnpj,
                codigoFornecedor: item.codigo_fornecedor,
                fornecedorNome: compraImportadaXml?.fornecedor || $('#fornecedor').val() || '',
                nomeItem: item.produto_nome,
                codigoBarras: item.codigo_barras,
                ncm: item.ncm,
                unidade: item.unidade,
                usuarioId: usuario.id || null,
                operacaoId: sugestao.operacaoId || null,
                motivo: 'confirmacao_importacao_xml',
                item
            })
        });
    }

    item.miip_sugestao = { ...sugestao, status: 'confirmado' };
    renderItensCompraTabela();
    showNotification('Associação confirmada.', 'success');
}

function ignorarSugestaoMiip(index) {
    const item = itensCompraAtual[index];
    if (!item?.miip_sugestao) return;

    item.miip_sugestao = { ...item.miip_sugestao, status: 'ignorado' };
    renderItensCompraTabela();
}

function miipNovoProdutoItemCompra(index) {
    const item = itensCompraAtual[index];
    if (!item) return;

    if (item.miip_sugestao) {
        item.miip_sugestao = { ...item.miip_sugestao, status: 'novo_produto' };
    }

    renderItensCompraTabela();

    if (typeof showProdutoModal === 'function') {
        showProdutoModal(null);
        $('#produtoModal').one('shown.bs.modal', function preencherNovoProdutoMiip() {
            $('#nome').val(item.produto_nome || '');
            if ($('#codigo_barras').length) $('#codigo_barras').val(item.codigo_barras || '');
            if ($('#ncm').length) $('#ncm').val(item.ncm || '');
            if ($('#unidade').length) $('#unidade').val(item.unidade || 'UN');
            if ($('#preco_compra').length) $('#preco_compra').val(formatNumberInput(item.preco_unitario || 0));
            if ($('#preco_venda').length) $('#preco_venda').val(formatNumberInput(item.preco_venda_sugerido || 0));
            if ($('#lucro_percentual').length) $('#lucro_percentual').val(formatNumberInput(item.margem_lucro || 30));
        });
        showNotification('Preencha o cadastro do novo produto e selecione-o no item.', 'info');
        return;
    }

    editarItemCompra(index);
    showNotification('Cadastre o novo produto e selecione-o no item.', 'info');
}

function alterarCampoItemCompra(index, campo, valor) {
    if (!itensCompraAtual[index]) return;
    itensCompraAtual[index][campo] = valor;
    if (campo === 'produto_nome' && String(valor).trim() === '') {
        itensCompraAtual[index].produto_id = '';
    }
}

function alterarNumeroItemCompra(index, campo, valor, origem) {
    if (!itensCompraAtual[index]) return;
    itensCompraAtual[index][campo] = Number(valor || 0);
    recalcularLinhaCompra(index, origem);
    renderItensCompraTabela();
}

function alterarProdutoItemCompra(index, produtoId) {
    const produto = produtosCompraList.find(p => String(p.id) === String(produtoId));
    if (!itensCompraAtual[index]) return;
    itensCompraAtual[index].produto_id = produtoId ? Number(produtoId) : '';
    if (produto) {
        itensCompraAtual[index].produto_nome = produto.nome;
        itensCompraAtual[index].codigo_barras = produto.codigo_barras || produto.codigo || '';
        itensCompraAtual[index].unidade = produto.unidade || 'UN';
        itensCompraAtual[index].ncm = produto.ncm || '';
        if (!Number(itensCompraAtual[index].preco_unitario)) {
            itensCompraAtual[index].preco_unitario = Number(produto.preco_compra || 0);
        }
        itensCompraAtual[index].ultimo_preco_compra = Number(produto.preco_compra || 0);
        if (!Number(itensCompraAtual[index].preco_venda_sugerido)) {
            itensCompraAtual[index].preco_venda_sugerido = Number(produto.preco_venda || 0);
        }
        if (!Number(itensCompraAtual[index].margem_lucro)) {
            itensCompraAtual[index].margem_lucro = Number(produto.lucro_percentual || 30);
        }
        recalcularLinhaCompra(index, 'custo');
        renderItensCompraTabela();
    }
}

function adicionarItemCompra() {
    const produtoId = $('#produto_id_item').val();
    const descricaoLivre = ($('#codigo_barras_item').val() || '').trim();
    const produto = produtosCompraList.find(p => String(p.id) === String(produtoId));
    const mccAtivo = produtoUsaMccEntrada(produto);
    const fracionado = !mccAtivo && produtoUsaConversaoUnidadesCompra(produto);

    let qtds = resolverQuantidadesItemCompra(
        $('#quantidade_item').val(),
        $('#quantidade_fiscal_item').val(),
        $('#quantidade_nao_fiscal_item').val()
    );
    let preco = Number($('#preco_item').val());
    const margemInput = Number($('#margem_padrao_item').val());
    const precoVendaInput = Number($('#preco_venda_item').val());
    const margem = Number.isFinite(margemInput) ? margemInput : 30;
    let valorTotalEmbalagem = 0;
    let dadosEmbalagem = {};
    let dadosMcc = {};

    if (mccAtivo) {
        const preview = calcularPreviewMccEntrada();
        if (!preview || preview.qtdBase <= 0) {
            showNotification('Informe a quantidade na unidade comercial.', 'warning');
            $('#quantidade_mcc_item').focus();
            return;
        }
        if (preview.valorTotal <= 0) {
            showNotification('Informe o valor total da compra.', 'warning');
            $('#valor_total_mcc_item').focus();
            return;
        }
        if (Number(produto.utiliza_conversao_fisica || 0) === 1) {
            const modo = preview.modo;
            if (modo === 'PESO_POR_EMBALAGEM' && !(Number($('#peso_embalagem_mcc_item').val()) > 0)) {
                showNotification('Produto exige Conversão Física: informe o peso da embalagem.', 'warning');
                $('#peso_embalagem_mcc_item').focus();
                return;
            }
            if (modo === 'PESO_TOTAL' && !(Number($('#peso_total_mcc_item').val()) > 0)) {
                showNotification('Produto exige Conversão Física: informe o peso total.', 'warning');
                $('#peso_total_mcc_item').focus();
                return;
            }
        }

        const validacaoDistribuicao = validarDistribuicaoFiscalCompra(
            qtds.quantidade_fiscal,
            qtds.quantidade_nao_fiscal,
            preview.qtdBase,
            String(produto.unidade || 'UN').toUpperCase()
        );
        if (!validacaoDistribuicao.ok) {
            showNotification(validacaoDistribuicao.mensagem, 'warning');
            return;
        }

        preco = preview.custoUnitario;
        valorTotalEmbalagem = preview.valorTotal;
        qtds = {
            quantidade: preview.qtdBase,
            quantidade_fiscal: Number(qtds.quantidade_fiscal || 0) > 0 || Number(qtds.quantidade_nao_fiscal || 0) > 0
                ? qtds.quantidade_fiscal
                : preview.qtdBase,
            quantidade_nao_fiscal: Number(qtds.quantidade_nao_fiscal || 0)
        };
        if ((Number(qtds.quantidade_fiscal || 0) + Number(qtds.quantidade_nao_fiscal || 0)) <= 0) {
            qtds.quantidade_fiscal = preview.qtdBase;
            qtds.quantidade_nao_fiscal = 0;
        }

        dadosMcc = {
            mcc_entrada: 1,
            utiliza_conversao_fisica: Number(produto.utiliza_conversao_fisica || 0),
            unidade_comercial: preview.unidadeComercial,
            quantidade_comercial: Number($('#quantidade_mcc_item').val() || 0),
            modo_entrada_conversao: preview.modo,
            peso_embalagem: Number($('#peso_embalagem_mcc_item').val() || 0) || null,
            peso_total: Number($('#peso_total_mcc_item').val() || 0) || null,
            volume_total: Number($('#volume_total_mcc_item').val() || 0) || null,
            valor_total_embalagem: preview.valorTotal,
            peso_total_compra: preview.qtdBase,
            custo_por_kg: preview.custoUnitario
        };
    } else if (fracionado) {
        const conv = calcularConversaoEmbalagemCompra();
        if (!conv || conv.qtdTotal <= 0) {
            showNotification('Informe quantidade comprada e quantidade por embalagem.', 'warning');
            return;
        }
        if (conv.valorTotal <= 0) {
            showNotification('Informe o valor total da compra.', 'warning');
            $('#valor_total_fracionado_item').focus();
            return;
        }

        const validacaoDistribuicao = validarDistribuicaoFiscalCompra(
            qtds.quantidade_fiscal,
            qtds.quantidade_nao_fiscal,
            conv.qtdTotal,
            conv.unidade
        );
        if (!validacaoDistribuicao.ok) {
            showNotification(validacaoDistribuicao.mensagem, 'warning');
            if (qtds.quantidade_fiscal <= 0) {
                $('#quantidade_fiscal_item').focus();
            } else {
                $('#quantidade_nao_fiscal_item').focus();
            }
            return;
        }

        preco = conv.custoUnitario;
        valorTotalEmbalagem = conv.valorTotal;
        dadosEmbalagem = {
            mcc_entrada: 1,
            compra_em: $('#compra_em_item').val() || '',
            quantidade_embalagens: Number($('#quantidade_embalagens_item').val() || 0),
            quantidade_por_embalagem: Number($('#quantidade_por_embalagem_item').val() || 0),
            valor_total_embalagem: conv.valorTotal,
            produto_fracionado: 1,
            vendido_por_peso: 1,
            peso_total_compra: conv.qtdTotal,
            custo_por_kg: conv.custoUnitario
        };
    } else if ((!produtoId && !descricaoLivre) || !qtds.quantidade || !preco) {
        const msgQtd = isModoEntradaF7CompraAtivo()
            ? 'Informe produto, preço e ao menos uma quantidade (fiscal ou não fiscal).'
            : 'Informe produto ou descrição, quantidade e preço.';
        showNotification(msgQtd, 'warning');
        return;
    }

    let margemFinal = margem;
    let precoVenda = preco * (1 + margem / 100);

    if (Number.isFinite(precoVendaInput) && precoVendaInput > 0) {
        precoVenda = precoVendaInput;
        margemFinal = preco > 0 ? ((precoVenda - preco) / preco) * 100 : 0;
    }

    // Verificar se o produto controla validade e validar campos de lote
    if (produto && Number(produto.controlar_validade || 0) === 1) {
        const dataValidade = $('#data_validade_item').val();

        if (!dataValidade) {
            showNotification('Para produtos com controle de validade, informe a data de validade.', 'warning');
            return;
        }
    }

    const item = normalizeItemCompra({
        produto_id: produto ? produto.id : '',
        produto_nome: produto ? produto.nome : descricaoLivre,
        codigo_barras: produto ? (produto.codigo_barras || produto.codigo || '') : '',
        quantidade: qtds.quantidade,
        quantidade_fiscal: qtds.quantidade_fiscal,
        quantidade_nao_fiscal: qtds.quantidade_nao_fiscal,
        preco_unitario: preco,
        ultimo_preco_compra: produto ? Number(produto.preco_compra || 0) : preco,
        margem_lucro: margemFinal,
        preco_venda_sugerido: precoVenda,
        unidade: produto ? (produto.unidade || 'UN') : 'UN',
        ncm: produto ? (produto.ncm || '') : '',
        data_validade: $('#data_validade_item').val() || null,
        produto_fracionado: fracionado ? 1 : (produto && produtoUsaConversaoUnidadesCompra(produto) ? 1 : 0),
        vendido_por_peso: fracionado ? 1 : (produto && produtoUsaConversaoUnidadesCompra(produto) ? 1 : 0),
        subtotal: (mccAtivo || fracionado) ? valorTotalEmbalagem : undefined,
        ...dadosEmbalagem,
        ...dadosMcc
    });

    itensCompraAtual.push(item);
    limparFormularioItemCompra();
    renderItensCompraTabela();
}

function limparFormularioItemCompra() {
    $('#codigo_barras_item').val('');
    $('#produto_id_item').val('');
    $('#quantidade_item').val('1');
    $('#quantidade_fiscal_item').val('');
    $('#quantidade_nao_fiscal_item').val('');
    $('#preco_item').val('');
    $('#margem_padrao_item').val('30');
    $('#preco_venda_item').val('');
    $('#compra_em_item').html(opcoesCompraEmbalagemHtml('Rolo'));
    $('#quantidade_embalagens_item').val('1');
    $('#quantidade_por_embalagem_item').val('');
    $('#valor_total_fracionado_item').val('');
    $('#custo_unitario_fracionado_item').val('');
    $('#resultado_formula_conversao').text('');
    $('#resultado_qtd_total_fracionado').text('0,000 UN');
    $('#resultado_custo_unitario_fracionado').text('R$ 0,0000');
    $('#data_validade_item').val('');
    $('#quantidade_mcc_item').val('1');
    $('#valor_total_mcc_item').val('');
    $('#peso_embalagem_mcc_item').val('');
    $('#peso_total_mcc_item').val('');
    $('#volume_total_mcc_item').val('');
    $('#modo_entrada_mcc_item').val('PESO_POR_EMBALAGEM');
    $('#resultado_qtd_base_mcc').text('0,000');
    $('#resultado_fator_mcc').text('');
    $('#resultado_custo_mcc').text('R$ 0,0000');
    atualizarCamposValidadeCompra();
    atualizarPainelConversaoUnidadesCompra();
    $('#codigo_barras_item').focus();
}

function calcularValorVendaItem() {
    const preco = Number($('#preco_item').val()) || 0;
    const margem = Number($('#margem_padrao_item').val()) || 30;
    const valorVenda = preco * (1 + margem / 100);
    $('#preco_venda_item').val(formatNumberInput(valorVenda));
}

function calcularMargemItem() {
    const preco = Number($('#preco_item').val()) || 0;
    const valorVenda = Number($('#preco_venda_item').val()) || 0;
    if (preco > 0) {
        const margem = ((valorVenda - preco) / preco) * 100;
        $('#margem_padrao_item').val(formatNumberInput(margem));
    }
}

function editarItemCompra(index) {
    const item = itensCompraAtual[index];
    if (!item) return;

    const temSplit = Number(item.quantidade_nao_fiscal || 0) > 0;
    modoEntradaF7Compra = temSplit;

    $('#codigo_barras_item').val(item.produto_nome || item.codigo_barras || '');
    $('#produto_id_item').val(item.produto_id || '');
    $('#quantidade_item').val(formatNumberInput(item.quantidade));
    $('#quantidade_fiscal_item').val(formatNumberInput(item.quantidade_fiscal ?? item.quantidade));
    $('#quantidade_nao_fiscal_item').val(formatNumberInput(item.quantidade_nao_fiscal || 0));
    $('#preco_item').val(formatNumberInput(
        item.preco_unitario,
        itemCompraEhFracionado(item) ? 4 : 2
    ));
    $('#margem_padrao_item').val(formatNumberInput(item.margem_lucro));
    $('#preco_venda_item').val(formatNumberInput(item.preco_venda_sugerido));
    if (itemCompraEhFracionado(item)) {
        modoEntradaF7Compra = true;
        const compraEmSalva = item.compra_em || 'Rolo';
        if (TIPOS_COMPRA_EMBALAGEM.includes(compraEmSalva)) {
            $('#compra_em_item').val(compraEmSalva);
        } else {
            $('#compra_em_item').html(
                opcoesCompraEmbalagemHtml('Rolo') +
                `<option value="${escapeHtml(compraEmSalva)}" selected>${escapeHtml(compraEmSalva)} (legado)</option>`
            );
        }
        $('#quantidade_embalagens_item').val(item.quantidade_embalagens || 1);
        $('#quantidade_por_embalagem_item').val(formatNumberInput(item.quantidade_por_embalagem || 0, 3));
        $('#valor_total_fracionado_item').val(formatNumberInput(item.valor_total_embalagem || item.subtotal || 0, 2));
    }
    $('#data_validade_item').val(item.data_validade || '');
    // Mostrar campos de lote se o produto controlar validade
    onProdutoSelecionado();
    atualizarCamposQuantidadeCompra();
    calcularValorVendaItem();
    // Remover o item da lista
    itensCompraAtual.splice(index, 1);
    renderItensCompraTabela();
    $('#codigo_barras_item').focus();
}

function onFornecedorInput() {
    const inputValue = $('#fornecedor').val();
    if (!inputValue) return;
    const fornecedor = fornecedoresList.find(f => String(f.nome || '').toLowerCase() === inputValue.trim().toLowerCase());
    if (fornecedor) {
        $('#fornecedor').val(fornecedor.nome);
    }
}

function atualizarCamposValidadeCompra() {
    const produtoId = $('#produto_id_item').val();
    const produto = produtosCompraList.find(p => String(p.id) === String(produtoId));
    const exigeValidade = !!(produto && Number(produto.controlar_validade || 0) === 1);

    $('#labelDataValidadeItem')
        .html(exigeValidade ? 'Data Validade *' : 'Data Validade');
    $('#hintDataValidadeItem').text(
        exigeValidade
            ? 'Obrigatório para produtos com controle de validade. O lote será gerado automaticamente.'
            : 'Opcional. Informe quando o produto tiver controle de validade.'
    );
    $('#data_validade_item').prop('required', exigeValidade);
}

function onProdutoSelecionado() {
    atualizarCamposValidadeCompra();
    const produto = obterProdutoSelecionadoCompra();
    if (!produto) {
        atualizarPainelConversaoUnidadesCompra();
        return;
    }

    const aplicarPainel = () => {
        atualizarPainelConversaoUnidadesCompra();
        if (produtoUsaMccEntrada(produto) || produtoUsaConversaoUnidadesCompra(produto)) {
            $('#margem_padrao_item').val(produto.lucro_percentual || 30);
            $('#quantidade_fiscal_item').val('');
            $('#quantidade_nao_fiscal_item').val('');
        }
    };

    carregarUnidadesComerciaisProdutoCompra(produto.id).then((resultado) => {
        const unidades = resultado.items || [];
        produto.unidades_comercializacao = unidades;
        if (resultado.meta) {
            if (resultado.meta.utiliza_conversao_fisica != null) {
                produto.utiliza_conversao_fisica = resultado.meta.utiliza_conversao_fisica;
            }
            if (resultado.meta.unidade_conversao_fisica != null) {
                produto.unidade_conversao_fisica = resultado.meta.unidade_conversao_fisica;
            }
        }
        const idx = produtosCompraList.findIndex((p) => String(p.id) === String(produto.id));
        if (idx >= 0) {
            produtosCompraList[idx].unidades_comercializacao = unidades;
            produtosCompraList[idx].utiliza_conversao_fisica = produto.utiliza_conversao_fisica;
            produtosCompraList[idx].unidade_conversao_fisica = produto.unidade_conversao_fisica;
        }
        aplicarPainel();
    }).catch(() => aplicarPainel());
}

function onFornecedorKeyDown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputValue = $('#fornecedor').val().trim();
    if (!inputValue) return;
    const fornecedor = fornecedoresList.find(f => String(f.nome || '').toLowerCase() === inputValue.toLowerCase());
    if (fornecedor) {
        $('#fornecedor').val(fornecedor.nome);
    }
}

function onProdutoInput() {
    const inputValue = $('#codigo_barras_item').val().trim();
    if (!inputValue) {
        $('#produto_id_item').val('');
        atualizarCamposValidadeCompra();
        atualizarPainelConversaoUnidadesCompra();
        return;
    }
    const produto = findProdutoByInput(inputValue);
    if (produto) {
        $('#produto_id_item').val(produto.id);
        $('#margem_padrao_item').val(produto.lucro_percentual || 30);
        if (!produtoUsaConversaoUnidadesCompra(produto)) {
            $('#preco_item').val(produto.preco_compra || '');
            calcularValorVendaItem();
        } else {
            $('#preco_item').val('');
            $('#preco_venda_item').val('');
        }
        onProdutoSelecionado();
    } else {
        $('#produto_id_item').val('');
        atualizarCamposValidadeCompra();
        atualizarPainelConversaoUnidadesCompra();
    }
}

function onProdutoKeyDown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputValue = $('#codigo_barras_item').val().trim();
    if (!inputValue) return;
    const produto = findProdutoByInput(inputValue);
    if (!produto) {
        showNotification('Produto não encontrado', 'warning');
        return;
    }

    $('#produto_id_item').val(produto.id);
    $('#margem_padrao_item').val(produto.lucro_percentual || 30);
    if (!produtoUsaConversaoUnidadesCompra(produto)) {
        $('#preco_item').val(produto.preco_compra || '');
        calcularValorVendaItem();
    } else {
        $('#preco_item').val('');
        $('#preco_venda_item').val('');
    }
    $('#codigo_barras_item').val(`${produto.codigo_barras || produto.codigo || ''} - ${produto.nome}`);

    onProdutoSelecionado();

    if (produtoUsaConversaoUnidadesCompra(produto)) {
        $('#quantidade_embalagens_item').focus();
        showNotification('Preencha a conversão de embalagem e a distribuição fiscal/não fiscal.', 'info');
        return;
    }

    if (Number(produto.controlar_validade || 0) === 1) {
        $('#data_validade_item').focus();
        showNotification('Preencha a data de validade e pressione ENTER novamente para adicionar.', 'info');
        return;
    }

    adicionarItemCompra();
}

function findFornecedorByTerm(term) {
    const lower = term.toLowerCase();
    return fornecedoresList.find(f => {
        const nome = String(f.nome || '').toLowerCase();
        const contato = String(f.contato || '').toLowerCase();
        return nome === lower || nome.startsWith(lower) || contato.includes(lower);
    });
}

function findProdutoByInput(input) {
    const cleaned = input.replace(/\s+-\s+.*$/, '').trim();
    const lower = input.toLowerCase().trim();
    return produtosCompraList.find(p => {
        const codigo = String(p.codigo || '').trim();
        const codigoBarras = String(p.codigo_barras || '').trim();
        const nome = String(p.nome || '').toLowerCase().trim();
        return codigo === cleaned || codigoBarras === cleaned || nome === lower;
    });
}

function showCompraModal() {
    console.log('showCompraModal chamada - gerando modal');
    itensCompraAtual = [];
    compraImportadaXml = null;
    modoEntradaF7Compra = false;
    const hoje = new Date().toISOString().split('T')[0];
    const modalHtml = `
        <div class="modal fade" id="compraModal" tabindex="-1">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Lançamento de Nova compra</h5>
                        <div>
                            <button type="button" class="btn btn-sm btn-outline-primary me-1" title="Documentos fiscais pela Central Inteligente" onclick="abrirCentralInteligenteEntradas()">
                                📥 Importar pela Central Inteligente
                            </button>
                            <button type="button" class="btn btn-sm btn-light me-1" title="Minimizar" onclick="minimizarModal('compraModal')">
                                <i class="fas fa-window-minimize"></i>
                            </button>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info mb-3">
                            Documentos fiscais (NF-e / DF-e) devem ser recebidos pela
                            <strong>Central Inteligente de Entradas</strong> antes do lançamento em Compras.
                            <button type="button" class="btn btn-sm btn-primary ms-2" onclick="abrirCentralInteligenteEntradas()">
                                📥 Abrir Central Inteligente
                            </button>
                        </div>
                        <div class="col-12" id="miipImportacaoStatus" style="display:none;"></div>

<div class="row g-3 mb-2">
    <div class="col-12">
        <h6 class="border-bottom pb-2 mb-2">Tipo de Entrada</h6>
        <div class="d-flex flex-wrap gap-4" id="tipoEntradaCompraGroup" role="radiogroup" aria-label="Tipo de Entrada">
            <div class="form-check">
                <input class="form-check-input" type="radio" name="tipo_entrada_compra" id="tipo_entrada_compra_fornecedor" value="COMPRA_FORNECEDOR" checked onchange="toggleTipoEntradaCompra()">
                <label class="form-check-label" for="tipo_entrada_compra_fornecedor">Compra de Fornecedor</label>
            </div>
            <div class="form-check">
                <input class="form-check-input" type="radio" name="tipo_entrada_compra" id="tipo_entrada_producao_propria" value="PRODUCAO_PROPRIA" onchange="toggleTipoEntradaCompra()">
                <label class="form-check-label" for="tipo_entrada_producao_propria">Produção Própria</label>
            </div>
        </div>
        <small class="text-muted d-block mt-1" id="tipoEntradaCompraHint">Entrada com fornecedor, documento e contas a pagar conforme regras atuais.</small>
    </div>
</div>

<div class="row g-3">
    <div class="col-12">
        <h6 class="border-bottom pb-2 mb-2" id="tituloDadosEntradaCompra">Dados da nota de compra</h6>
    </div>

    <div class="col-md-2">
        <label class="form-label">Data da compra *</label>
        <input type="date" class="form-control" id="data_compra" value="${hoje}">
    </div>

    <div class="col-md-2">
        <label class="form-label">Data emissão</label>
        <input type="date" class="form-control" id="data_emissao" value="${hoje}">
    </div>

    <div class="col-md-2">
        <label class="form-label">Data entrada</label>
        <input type="date" class="form-control" id="data_entrada" value="${hoje}">
    </div>

    <div class="col-md-6">
        <label class="form-label" id="labelFornecedorCompra">Fornecedor</label>
        <input type="text" class="form-control" id="fornecedor" list="lista_fornecedores" oninput="onFornecedorInput()" onkeydown="onFornecedorKeyDown(event)">
        <datalist id="lista_fornecedores">
            ${fornecedoresList.map(f => `<option value="${escapeHtml(f.nome || '')}"></option>`).join('')}
        </datalist>
        <small class="text-muted d-none" id="hintFornecedorProducao">Identificação interna — sem cadastro de fornecedor fictício.</small>
    </div>

    <div class="col-md-2">
        <label class="form-label" id="labelNumeroNfCompra">Número NF</label>
        <input type="text" class="form-control" id="numero_nf" maxlength="20">
    </div>

    <div class="col-md-2">
        <label class="form-label">Série</label>
        <input type="text" class="form-control" id="serie_nf" maxlength="10">
    </div>

    <div class="col-md-2">
        <label class="form-label">Modelo</label>
        <input type="text" class="form-control" id="modelo_nf" value="55" maxlength="5">
    </div>

    <div class="col-md-6">
        <label class="form-label">Chave de acesso</label>
        <input
            type="text"
            class="form-control"
            id="chave_acesso"
            maxlength="44"
            placeholder="Preenchida automaticamente pela Central Inteligente"
            oninput="this.value=this.value.replace(/\D/g,'')"
        >
    </div>

    <div class="col-12">
        <label class="form-label">Observação</label>
        <textarea class="form-control" id="observacao_compra" rows="2"></textarea>
    </div>
</div>

<hr>

<div class="row g-3">
    <div class="col-12">
        <div class="form-check">
            <input class="form-check-input" type="checkbox" id="nota_fiscal_avulsa" onchange="toggleNotaFiscalAvulsa()">
            <label class="form-check-label fw-bold" for="nota_fiscal_avulsa">
                Lançar Nota Fiscal Avulsa
            </label>
            <small class="text-muted d-block">Marque para registrar apenas dados fiscais e financeiros, sem itens e sem movimentação de estoque.</small>
        </div>
    </div>
</div>

<hr>

<div class="row g-3" id="itensCompraSection">
    <div class="col-12">
        <h6 class="border-bottom pb-2 mb-2">Itens da compra</h6>
    </div>
</div>
                        <!-- Linha 1: Campo de busca destacado -->
                        <div class="row g-2 mb-3">
                            <div class="col-md-12">
                                <label class="form-label fw-bold">Código de barras / descrição rápida (Enter para adicionar)</label>
                                <input type="text" class="form-control" id="codigo_barras_item" placeholder="Leitor, código ou nome" list="produtos-datalist" autocomplete="off" oninput="onProdutoInput()" onkeydown="onProdutoKeyDown(event)" style="font-size: 1.1em; font-weight: 500;">
                                <datalist id="produtos-datalist">
                                    ${produtosCompraList.map(p => `<option value="${escapeHtml((p.codigo_barras || p.codigo || '') + ' - ' + p.nome)}"></option>`).join('')}
                                </datalist>
                            </div>
                        </div>

                        <div id="adicionarItemRow">
                            <div class="row g-2 align-items-end mb-2">
                                <div class="col-md-6">
                                    <label class="form-label">Produto</label>
                                    <select class="form-control" id="produto_id_item" onchange="onProdutoSelecionado()">
                                        <option value="">Selecione</option>
                                        ${produtosCompraList.map(p => `<option value="${p.id}" data-controlar-validade="${p.controlar_validade || 0}">${escapeHtml(p.nome)}</option>`).join('')}
                                    </select>
                                </div>
                            </div>

                            <div id="painelMccEntrada" class="d-none mb-2">
                                <div class="card border-success">
                                    <div class="card-header bg-light py-2">
                                        <strong>Motor de Conversão Comercial (MCC)</strong>
                                        <small class="text-muted ms-2">Estoque sempre na unidade base — fator físico calculado automaticamente</small>
                                    </div>
                                    <div class="card-body py-2">
                                        <div class="row g-2 align-items-end">
                                            <div class="col-md-2">
                                                <label class="form-label">Unidade comercial</label>
                                                <select class="form-control" id="unidade_comercial_mcc_item"></select>
                                            </div>
                                            <div class="col-md-2">
                                                <label class="form-label" id="labelQtdMcc">Quantidade (UC)</label>
                                                <input type="number" step="0.001" min="0" class="form-control" id="quantidade_mcc_item" value="1">
                                            </div>
                                            <div class="col-md-2">
                                                <label class="form-label">Modo de peso</label>
                                                <select class="form-control" id="modo_entrada_mcc_item">
                                                    <option value="PESO_POR_EMBALAGEM">Peso por embalagem</option>
                                                    <option value="PESO_TOTAL">Peso total</option>
                                                </select>
                                            </div>
                                            <div class="col-md-2" id="campoPesoEmbalagemMcc">
                                                <label class="form-label">Peso da embalagem (Kg)</label>
                                                <input type="number" step="0.001" min="0" class="form-control" id="peso_embalagem_mcc_item" placeholder="Ex.: 3,375">
                                            </div>
                                            <div class="col-md-2 d-none" id="campoPesoTotalMcc">
                                                <label class="form-label">Peso total (Kg)</label>
                                                <input type="number" step="0.001" min="0" class="form-control" id="peso_total_mcc_item" placeholder="Ex.: 67,500">
                                            </div>
                                            <div class="col-md-2 d-none" id="campoVolumeTotalMcc">
                                                <label class="form-label">Volume total</label>
                                                <input type="number" step="0.001" min="0" class="form-control" id="volume_total_mcc_item" placeholder="Ex.: 100">
                                            </div>
                                            <div class="col-md-2">
                                                <label class="form-label">Valor total</label>
                                                <input type="number" step="0.01" min="0" class="form-control" id="valor_total_mcc_item" placeholder="R$ total">
                                            </div>
                                        </div>
                                        <div id="blocoPesoMccEntrada" class="mt-1">
                                            <small class="text-muted">Nunca informe “1 Litro = X Kg” — o sistema calcula o fator a partir do peso.</small>
                                        </div>
                                        <hr class="my-2">
                                        <div class="row g-2">
                                            <div class="col-md-12 mb-1">
                                                <span id="resultado_fator_mcc" class="text-success small"></span>
                                            </div>
                                            <div class="col-md-6">
                                                <strong>Quantidade base (estoque):</strong>
                                                <span id="resultado_qtd_base_mcc" class="ms-1">0,000</span>
                                            </div>
                                            <div class="col-md-6">
                                                <strong>Custo unitário base:</strong>
                                                <span id="resultado_custo_mcc" class="ms-1">R$ 0,0000</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div id="painelConversaoEmbalagem" class="d-none mb-2">
                                <div class="card border-info">
                                    <div class="card-header bg-light py-2">
                                        <strong>Motor de Conversão de Unidades</strong>
                                        <small class="text-muted ms-2">Ex.: 10 Rolos × 50 MT = 500 MT</small>
                                    </div>
                                    <div class="card-body py-2">
                                        <div class="row g-2 align-items-end">
                                            <div class="col-md-2">
                                                <label class="form-label">Compra em</label>
                                                <select class="form-control" id="compra_em_item">
                                                    ${opcoesCompraEmbalagemHtml('Rolo')}
                                                </select>
                                            </div>
                                            <div class="col-md-2">
                                                <label class="form-label">Quantidade Comprada</label>
                                                <input type="number" step="0.001" min="0" class="form-control" id="quantidade_embalagens_item" value="1" placeholder="Ex.: 10">
                                            </div>
                                            <div class="col-md-2">
                                                <label class="form-label">Quantidade por Embalagem</label>
                                                <input type="number" step="0.001" min="0" class="form-control" id="quantidade_por_embalagem_item" value="" placeholder="Ex.: 50">
                                            </div>
                                            <div class="col-md-2">
                                                <label class="form-label">Unidade de Venda</label>
                                                <input type="text" class="form-control" id="unidade_fracionada_item" readonly>
                                            </div>
                                            <div class="col-md-2">
                                                <label class="form-label">Valor Total</label>
                                                <input type="number" step="0.01" min="0" class="form-control" id="valor_total_fracionado_item" value="" placeholder="R$ total">
                                            </div>
                                        </div>
                                        <hr class="my-2">
                                        <div class="row g-2">
                                            <div class="col-md-12 mb-1">
                                                <span id="resultado_formula_conversao" class="text-primary small"></span>
                                            </div>
                                            <div class="col-md-6">
                                                <strong>Quantidade Total:</strong>
                                                <span id="resultado_qtd_total_fracionado" class="ms-1">0,000 UN</span>
                                            </div>
                                            <div class="col-md-6">
                                                <strong>Custo Unitário:</strong>
                                                <span id="resultado_custo_unitario_fracionado" class="ms-1">R$ 0,0000</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div id="painelIndicadorDistribuicaoFiscal" class="d-none mb-2">
                                <div id="indicadorDistribuicaoFiscal" class="d-none"></div>
                            </div>

                            <div class="row g-2 align-items-end mb-2" id="linhaQuantidadeCompra">
                                <div class="col-md-2" id="campoQuantidadeSimplesCompra">
                                    <label class="form-label">Qtd</label>
                                    <input type="number" step="0.01" class="form-control" id="quantidade_item" value="1">
                                </div>
                                <div class="col-md-2 d-none" id="campoQuantidadeFiscalCompra">
                                    <label class="form-label" id="labelQtdFiscalCompra">Fiscal</label>
                                    <input type="number" step="0.001" min="0" class="form-control" id="quantidade_fiscal_item" value="" placeholder="Ex.: 300">
                                </div>
                                <div class="col-md-2 d-none" id="campoQuantidadeNaoFiscalCompra">
                                    <label class="form-label" id="labelQtdNaoFiscalCompra">Não Fiscal</label>
                                    <input type="number" step="0.001" min="0" class="form-control" id="quantidade_nao_fiscal_item" value="" placeholder="Ex.: 200">
                                </div>
                            </div>

                            <div class="row g-2 align-items-end mb-2" id="linhaPrecoCompraNormal">
                                <div class="col-md-2 campo-preco-compra-item">
                                    <label class="form-label">Preço compra (unidade)</label>
                                    <input type="number" step="0.0001" class="form-control" id="preco_item" oninput="calcularValorVendaItem()">
                                </div>
                                <div class="col-md-2 d-none" id="campoCustoUnitarioFracionado">
                                    <label class="form-label">Custo unitário (calculado)</label>
                                    <input type="text" class="form-control" id="custo_unitario_fracionado_item" readonly>
                                </div>
                                <div class="col-md-2">
                                    <label class="form-label">Margem %</label>
                                    <input type="number" step="0.01" class="form-control" id="margem_padrao_item" value="30" oninput="calcularValorVendaItem()">
                                </div>
                                <div class="col-md-2">
                                    <label class="form-label">Valor venda</label>
                                    <input type="number" step="0.01" class="form-control" id="preco_venda_item" oninput="calcularMargemItem()">
                                </div>
                                <div class="col-md-2">
                                    <button class="btn btn-success w-100" onclick="adicionarItemCompra()"><i class="fas fa-plus"></i> Adicionar</button>
                                </div>
                            </div>

                            <div class="row g-2 mb-2">
                                <div class="col-12">
                                    <small id="indicadorModoF7Compra" class="text-primary fw-semibold d-none"></small>
                                    <small id="hintTeclaF7Compra" class="text-muted">Pressione <strong>F7</strong> para alternar entre Qtd única e Qtd Fiscal / Não Fiscal.</small>
                                </div>
                            </div>
                        </div>

                        <!-- Campos de lote / validade -->
                        <div class="row g-2 mt-2" id="camposLoteCompra">
                            <div class="col-md-4">
                                <label class="form-label" id="labelDataValidadeItem">Data Validade</label>
                                <input type="date" class="form-control" id="data_validade_item">
                            </div>
                            <div class="col-md-8 d-flex align-items-end">
                                <small class="text-muted" id="hintDataValidadeItem">Informe quando o produto tiver controle de validade.</small>
                            </div>
                        </div>
                        <div class="table-responsive mt-3" id="itensCompraTable">
                            <table class="table table-bordered align-middle">
                                <thead>
                                    <tr>
                                        <th>Produto / descrição</th>
                                        <th>Cód. barras</th>
                                        <th>Validade</th>
                                        <th id="colunaQuantidadeCompraHeader">Qtd Fiscal</th>
                                        <th>Preço compra</th>
                                        <th>Margem %</th>
                                        <th>Venda sugerida</th>
                                        <th>Subtotal</th>
                                        <th></th>
                                    </tr>
                                </thead>

                                <tbody id="itensCompraBody"></tbody>
                                <tfoot><tr><th colspan="7" class="text-end">Total</th><th id="totalCompra">${formatCurrency(0)}</th><th></th></tr></tfoot>
                            </table>
                        </div>

                        <hr>
                        <div class="row g-2 mt-2" id="totaisNotaSection">
    <div class="col-12">
        <h6 class="border-bottom pb-2 mb-2">Totais da nota</h6>
    </div>

    <div class="col-md-2" id="col_valor_produtos">
        <label class="form-label">Valor produtos</label>
        <input type="number" step="0.01" class="form-control" id="valor_produtos" value="0.00" readonly>
    </div>

    <div class="col-md-2" id="col_valor_desconto">
        <label class="form-label">Desconto</label>
        <input type="number" step="0.01" class="form-control" id="valor_desconto" value="0.00" oninput="recalcularTotaisCompraNota(); calcularParcelasCompra();">
    </div>

    <div class="col-md-2" id="col_valor_frete">
        <label class="form-label">Frete</label>
        <input type="number" step="0.01" class="form-control" id="valor_frete" value="0.00" oninput="recalcularTotaisCompraNota(); recalcularTotalNotaAvulsa(); calcularParcelasCompra();">
    </div>

    <div class="col-md-2" id="col_valor_outras_despesas">
        <label class="form-label">Outras despesas</label>
        <input type="number" step="0.01" class="form-control" id="valor_outras_despesas" value="0.00" oninput="recalcularTotaisCompraNota(); recalcularTotalNotaAvulsa(); calcularParcelasCompra();">
    </div>

    <div class="col-md-2" id="col_valor_total_itens">
        <label class="form-label">Valor total itens</label>
        <input type="number" step="0.01" class="form-control" id="valor_total_itens" value="0.00" readonly oninput="recalcularTotalNotaAvulsa()">
    </div>

    <div class="col-md-2" id="col_valor_total_nota">
        <label class="form-label">Valor total da nota *</label>
        <input type="number" step="0.01" class="form-control fw-bold" id="valor_total_nota" value="0.00" readonly>
        <small class="text-muted" id="valor_total_nota_hint">Calculado automaticamente a partir dos itens.</small>
    </div>
</div>

<hr>
                        <div class="row g-2" id="pagamentoSection">
                            <div class="col-md-3 mb-3">
                                <label class="form-label">Condição de pagamento *</label>
                                <select class="form-control" id="condicao_pagamento" onchange="atualizarVisibilidadePagamentoCompra()">
                                    <option value="avista">À vista</option>
                                    <option value="prazo">A prazo</option>
                                    <option value="parcelado">Parcelado</option>
                                    <option value="entrada_parcelado">Entrada + Parcelamento</option>
                                </select>
                            </div>
                            <div class="col-md-3 mb-3">
                                <label class="form-label">Forma de pagamento</label>
                                <select class="form-control" id="forma_pagamento"><option value="">Selecione</option>${formasPagamentoCompra()}</select>
                            </div>
                            <div class="col-md-2 mb-3" id="grupo_entrada_compra" style="display:none;">
                                <label class="form-label">Valor entrada</label>
                                <input type="number" step="0.01" class="form-control" id="valor_entrada" value="0" onchange="calcularParcelasCompra()">
                            </div>
                            <div class="col-md-2 mb-3" id="grupo_parcelas_compra" style="display:none;">
                                <label class="form-label">Parcelas após entrada</label>
                                <input type="number" min="1" class="form-control" id="parcelas" value="1" onchange="calcularParcelasCompra()">
                                <small class="text-muted">Informe quantas parcelas serão geradas após a entrada.</small>
                            </div>
                            <div class="col-md-2 mb-3" id="grupo_vencimento_compra" style="display:none;">
                                <label class="form-label">1º vencimento</label>
                                <input type="date" class="form-control" id="data_vencimento" value="${hoje}" onchange="calcularParcelasCompra()">
                            </div>
                        </div>
                        <div id="parcelas_detalhes" class="mb-3"></div>
                    </div>
                    
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="btnConfirmarEntradaCompra" onclick="saveCompra()">Salvar compra</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    console.log('Modal HTML gerado, tamanho:', modalHtml.length);
    $('#modal-container').html(modalHtml);
    $('#compraModal').modal('show');
    console.log('Modal exibido');
    $(document).off('keydown.compraF7', onCompraModalKeyDown).on('keydown.compraF7', onCompraModalKeyDown);
    $('#compraModal').off('hidden.bs.modal.compraF7').on('hidden.bs.modal.compraF7', function() {
        $(document).off('keydown.compraF7', onCompraModalKeyDown);
        modoEntradaF7Compra = false;
    });
    atualizarCamposQuantidadeCompra();
    atualizarCamposValidadeCompra();
    atualizarPainelConversaoUnidadesCompra();
    $('#quantidade_embalagens_item, #quantidade_por_embalagem_item, #valor_total_fracionado_item')
        .off('input.fracionado')
        .on('input.fracionado', calcularConversaoEmbalagemCompra);
    $('#compra_em_item')
        .off('change.fracionado')
        .on('change.fracionado', calcularConversaoEmbalagemCompra);
    $('#quantidade_mcc_item, #valor_total_mcc_item, #peso_embalagem_mcc_item, #peso_total_mcc_item, #volume_total_mcc_item')
        .off('input.mcc')
        .on('input.mcc', calcularPreviewMccEntrada);
    $('#unidade_comercial_mcc_item, #modo_entrada_mcc_item')
        .off('change.mcc')
        .on('change.mcc', () => {
            atualizarCamposModoMccEntrada();
            calcularPreviewMccEntrada();
        });
    $('#quantidade_fiscal_item, #quantidade_nao_fiscal_item')
        .off('input.distribuicao')
        .on('input.distribuicao', () => atualizarIndicadorDistribuicaoFiscal());
    renderItensCompraTabela();
    atualizarVisibilidadePagamentoCompra();
    recalcularTotaisCompraNota();
    toggleTipoEntradaCompra();
}

const FORNECEDOR_PRODUCAO_PROPRIA_LABEL = 'PRODUÇÃO PRÓPRIA';
const OBS_PRODUCAO_PROPRIA_PADRAO = 'Abastecimento proveniente da produção própria.';

function obterTipoEntradaCompra() {
    return String($('input[name="tipo_entrada_compra"]:checked').val() || 'COMPRA_FORNECEDOR');
}

function isEntradaProducaoPropriaCompra() {
    return obterTipoEntradaCompra() === 'PRODUCAO_PROPRIA';
}

function toggleTipoEntradaCompra() {
    const isProducao = isEntradaProducaoPropriaCompra();

    if (isProducao) {
        $('#tituloDadosEntradaCompra').text('Dados do abastecimento (produção própria)');
        $('#tipoEntradaCompraHint').text('Abastecimento de estoque sem financeiro e sem contas a pagar. Mesma rotina futura do Motor Indústria.');
        $('#labelFornecedorCompra').text('Fornecedor');
        $('#fornecedor').val(FORNECEDOR_PRODUCAO_PROPRIA_LABEL).prop('readonly', true).attr('list', null);
        $('#hintFornecedorProducao').removeClass('d-none');
        $('#labelNumeroNfCompra').text('Documento Fiscal (opcional)');
        const obsAtual = String($('#observacao_compra').val() || '').trim();
        if (!obsAtual || obsAtual === OBS_PRODUCAO_PROPRIA_PADRAO) {
            $('#observacao_compra').val(OBS_PRODUCAO_PROPRIA_PADRAO);
        }
        $('#pagamentoSection').hide();
        $('#parcelas_detalhes').hide();
        $('#nota_fiscal_avulsa').prop('checked', false).prop('disabled', true);
        $('#nota_fiscal_avulsa').closest('.col-12').hide();
        if ($('#itensCompraSection').is(':hidden')) {
            toggleNotaFiscalAvulsa();
        }
        $('#btnConfirmarEntradaCompra').text('Confirmar Entrada');
        compraImportadaXml = null;
    } else {
        $('#tituloDadosEntradaCompra').text('Dados da nota de compra');
        $('#tipoEntradaCompraHint').text('Entrada com fornecedor, documento e contas a pagar conforme regras atuais.');
        $('#labelFornecedorCompra').text('Fornecedor');
        if ($('#fornecedor').val() === FORNECEDOR_PRODUCAO_PROPRIA_LABEL) {
            $('#fornecedor').val('');
        }
        $('#fornecedor').prop('readonly', false).attr('list', 'lista_fornecedores');
        $('#hintFornecedorProducao').addClass('d-none');
        $('#labelNumeroNfCompra').text('Número NF');
        if (String($('#observacao_compra').val() || '').trim() === OBS_PRODUCAO_PROPRIA_PADRAO) {
            $('#observacao_compra').val('');
        }
        $('#pagamentoSection').show();
        $('#parcelas_detalhes').show();
        $('#nota_fiscal_avulsa').prop('disabled', false);
        $('#nota_fiscal_avulsa').closest('.col-12').show();
        $('#btnConfirmarEntradaCompra').text('Salvar compra');
        atualizarVisibilidadePagamentoCompra();
    }
}

function saveCompra() {
    const isNotaAvulsa = $('#nota_fiscal_avulsa').is(':checked');
    const isProducaoPropria = isEntradaProducaoPropriaCompra();
    const tipoEntrada = obterTipoEntradaCompra();

    if (isProducaoPropria && isNotaAvulsa) {
        showNotification('Produção Própria não permite Nota Fiscal Avulsa.', 'warning');
        return;
    }

    if (!isNotaAvulsa && !itensCompraAtual.length) {
        showNotification('Adicione ao menos um item.', 'warning');
        return;
    }

    if (!isProducaoPropria && !String($('#fornecedor').val() || '').trim()) {
        showNotification('Informe o fornecedor.', 'warning');
        return;
    }

    if (!isNotaAvulsa) {
        for (const item of itensCompraAtual) {
            if (!itemCompraEhFracionado(item)) continue;
            const totalConvertido = Number(item.peso_total_compra || 0)
                || (Number(item.quantidade_embalagens || 0) * Number(item.quantidade_por_embalagem || 0))
                || Number(item.quantidade || 0);
            const validacao = validarDistribuicaoFiscalCompra(
                item.quantidade_fiscal,
                item.quantidade_nao_fiscal,
                totalConvertido,
                String(item.unidade || '').toUpperCase()
            );
            if (!validacao.ok) {
                showNotification(validacao.mensagem, 'warning');
                return;
            }
        }
    }

    const total = Number($('#valor_total_nota').val()) || (isNotaAvulsa ? 0 : itensCompraAtual.reduce((sum, item) => sum + Number(item.subtotal || 0), 0));
    const valorTotalItens = Number($('#valor_total_itens').val()) || 0;

    if (isNotaAvulsa && total <= 0) {
        showNotification('Informe o valor total da nota fiscal.', 'warning');
        return;
    }

    if (isNotaAvulsa && valorTotalItens <= 0) {
        showNotification('Informe o valor total dos itens.', 'warning');
        return;
    }

    const condicaoPagamento = isProducaoPropria ? 'avista' : $('#condicao_pagamento').val();
    const valorEntrada = isProducaoPropria ? 0 : (Number($('#valor_entrada').val()) || 0);
    const parcelas = isProducaoPropria ? 1 : (parseInt($('#parcelas').val(), 10) || 1);

    if (!isProducaoPropria && condicaoPagamento === 'entrada_parcelado' && valorEntrada <= 0) {
        showNotification('Informe o valor da entrada para Entrada + Parcelamento.', 'warning');
        return;
    }

    const data = {
        tipo_entrada: tipoEntrada,
        data_compra: $('#data_compra').val(),
        data_emissao: $('#data_emissao').val(),
        data_entrada: $('#data_entrada').val(),
        fornecedor: isProducaoPropria ? FORNECEDOR_PRODUCAO_PROPRIA_LABEL : $('#fornecedor').val(),
        fornecedor_cnpj: isProducaoPropria ? '' : (compraImportadaXml?.fornecedor_cnpj || ''),
        fornecedor_rua: isProducaoPropria ? '' : (compraImportadaXml?.fornecedor_rua || ''),
        fornecedor_numero: isProducaoPropria ? '' : (compraImportadaXml?.fornecedor_numero || ''),
        fornecedor_bairro: isProducaoPropria ? '' : (compraImportadaXml?.fornecedor_bairro || ''),
        fornecedor_cidade: isProducaoPropria ? '' : (compraImportadaXml?.fornecedor_cidade || ''),
        fornecedor_uf: isProducaoPropria ? '' : (compraImportadaXml?.fornecedor_uf || ''),
        fornecedor_cep: isProducaoPropria ? '' : (compraImportadaXml?.fornecedor_cep || ''),
        numero_nf: $('#numero_nf').val().trim(),
        serie_nf: $('#serie_nf').val().trim(),
        modelo_nf: $('#modelo_nf').val().trim() || (isProducaoPropria ? '' : '55'),
        chave_acesso: ($('#chave_acesso').val() || '').replace(/\D/g, ''),
        valor_produtos: isNotaAvulsa ? valorTotalItens : (Number($('#valor_produtos').val()) || 0),
        valor_desconto: Number($('#valor_desconto').val()) || 0,
        valor_frete: Number($('#valor_frete').val()) || 0,
        valor_outras_despesas: Number($('#valor_outras_despesas').val()) || 0,
        valor_total_nota: Number($('#valor_total_nota').val()) || 0,
        total,
        itens: isNotaAvulsa ? [] : itensCompraAtual.map((item) => {
            const sincronizado = sincronizarQuantidadesEstoqueItemCompra(
                sincronizarPrecosCadastroItemCompra({ ...item })
            );
            return {
            produto_id: sincronizado.produto_id || null,
            produto_nome: sincronizado.produto_nome,
            codigo_barras: sincronizado.codigo_barras,
            unidade: sincronizado.unidade,
            ncm: sincronizado.ncm,
            quantidade: Number(sincronizado.quantidade || 0),
            quantidade_fiscal: Number(sincronizado.quantidade_fiscal ?? sincronizado.quantidade ?? 0),
            quantidade_nao_fiscal: Number(sincronizado.quantidade_nao_fiscal || 0),
            preco_unitario: Number(sincronizado.preco_unitario || 0),
            margem_lucro: Number(sincronizado.margem_lucro || 0),
            preco_venda_sugerido: Number(sincronizado.preco_venda_sugerido || 0),
            subtotal: Number(sincronizado.subtotal || 0),
            data_validade: sincronizado.data_validade || null,
            produto_fracionado: itemCompraEhFracionado(sincronizado) ? 1 : 0,
            vendido_por_peso: itemCompraEhFracionado(sincronizado) ? 1 : 0,
            peso_total_compra: Number(sincronizado.peso_total_compra || sincronizado.quantidade || 0),
            custo_por_kg: Number(sincronizado.custo_por_kg || sincronizado.preco_unitario || 0),
            custo_unitario_final: Number(sincronizado.custo_unitario_final || sincronizado.preco_unitario || 0),
            compra_em: sincronizado.compra_em || '',
            quantidade_embalagens: Number(sincronizado.quantidade_embalagens || 0),
            quantidade_por_embalagem: Number(sincronizado.quantidade_por_embalagem || 0),
            valor_total_embalagem: Number(sincronizado.valor_total_embalagem || sincronizado.subtotal || 0),
            atualizar_preco_venda: Number(sincronizado.atualizar_preco_venda ?? 1),
            mcc_entrada: Number(sincronizado.mcc_entrada || sincronizado.unidade_comercial || sincronizado.utiliza_conversao_fisica || 0) ? 1 : 0,
            utiliza_conversao_fisica: Number(sincronizado.utiliza_conversao_fisica || 0),
            unidade_comercial: sincronizado.unidade_comercial || null,
            quantidade_comercial: Number(sincronizado.quantidade_comercial || 0) || null,
            modo_entrada_conversao: sincronizado.modo_entrada_conversao || null,
            peso_embalagem: sincronizado.peso_embalagem != null ? Number(sincronizado.peso_embalagem) : null,
            peso_total: sincronizado.peso_total != null ? Number(sincronizado.peso_total) : null,
            volume_total: sincronizado.volume_total != null ? Number(sincronizado.volume_total) : null
        };
        }),
        condicao_pagamento: condicaoPagamento,
        forma_pagamento: isProducaoPropria ? '' : $('#forma_pagamento').val(),
        data_vencimento: isProducaoPropria ? '' : $('#data_vencimento').val(),
        parcelas,
        valor_entrada: valorEntrada,
        observacao: isProducaoPropria
            ? (String($('#observacao_compra').val() || '').trim() || OBS_PRODUCAO_PROPRIA_PADRAO)
            : $('#observacao_compra').val(),
        nota_fiscal_avulsa: isNotaAvulsa ? 1 : 0
    };

    if (centralDocumentoIdAtual) {
        data.central_documento_id = centralDocumentoIdAtual;
    }

    if (data.chave_acesso && data.chave_acesso.length !== 44) {
        showNotification('A chave de acesso deve ter 44 dígitos.', 'warning');
        return;
    }

    if (!data.fornecedor || !data.fornecedor.trim()) {
        showNotification('Informe o fornecedor da nota.', 'warning');
        return;
    }

    console.log('ITENS ENVIADOS:', JSON.stringify(itensCompraAtual, null, 2));

    $.ajax({
        url: `${API_URL}/compras`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(data)
    }).done(function(resposta) {
        const docCentral = centralDocumentoIdAtual;
        centralDocumentoIdAtual = null;
        $('#compraModal').modal('hide');
        const msgSucesso = isProducaoPropria
            ? (resposta?.message || 'Abastecimento de produção própria registrado (estoque atualizado, sem financeiro).')
            : (isNotaAvulsa ? 'Nota Fiscal Avulsa registrada com sucesso!' : 'Compra registrada com sucesso!');
        showNotification(msgSucesso, 'success');
        loadCompras();
        if (docCentral && typeof loadPage === 'function') {
            sessionStorage.setItem('central_pos_gravacao', String(docCentral));
        }
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao registrar compra.', 'danger');
    });
}

function toggleNotaFiscalAvulsa() {
    const isNotaAvulsa = $('#nota_fiscal_avulsa').is(':checked');
    const isProducao = typeof isEntradaProducaoPropriaCompra === 'function' && isEntradaProducaoPropriaCompra();

    if (isNotaAvulsa) {
        $('#itensCompraSection').hide();
        $('#adicionarItemRow').hide();
        $('#itensCompraTable').hide();
        $('#col_valor_produtos').hide();
        $('#col_valor_desconto').hide();
        $('#col_valor_total_itens').show();
        $('#valor_total_itens').prop('readonly', false);
        $('#valor_total_itens').val('0.00');
        $('#valor_total_nota').prop('readonly', false);
        $('#valor_total_nota').val('0.00');
        $('#valor_total_nota_hint').text('Informe o valor total da nota fiscal.');
        $('#totaisNotaSection').show();
        $('#pagamentoSection').show();
        recalcularTotalNotaAvulsa();
    } else {
        $('#itensCompraSection').show();
        $('#adicionarItemRow').show();
        $('#itensCompraTable').show();
        $('#col_valor_produtos').show();
        $('#col_valor_desconto').show();
        $('#col_valor_total_itens').show();
        $('#valor_total_itens').prop('readonly', true);
        $('#valor_produtos').prop('readonly', true);
        $('#valor_total_nota').prop('readonly', true);
        $('#valor_total_nota_hint').text('Calculado automaticamente a partir dos itens.');
        $('#totaisNotaSection').show();
        if (isProducao) {
            $('#pagamentoSection').hide();
            $('#parcelas_detalhes').hide();
        } else {
            $('#pagamentoSection').show();
        }
        recalcularTotaisCompraNota();
    }
}

function recalcularTotalNotaAvulsa() {
    const valorTotalItens = Number($('#valor_total_itens').val()) || 0;
    const frete = Number($('#valor_frete').val()) || 0;
    const outras = Number($('#valor_outras_despesas').val()) || 0;
    const totalNota = Number((valorTotalItens + frete + outras).toFixed(2));

    $('#valor_produtos').val(formatNumberInput(valorTotalItens));
    $('#valor_total_nota').val(formatNumberInput(totalNota));
}

function viewCompra(id) {
    $.ajax({ url: `${API_URL}/compras/${id}`, method: 'GET' }).done(function(compra) {
        const isNotaAvulsa = Number(compra.nota_fiscal_avulsa) === 1;

        const financeiroHtml = (compra.financeiro || []).map(f => `
            <tr>
                <td>${f.numero_parcela ? `${f.numero_parcela}/${f.total_parcelas}` : '-'}</td>
                <td>${formatDate(f.vencimento || f.data_movimento)}</td>
                <td>${f.status}</td>
                <td>${formatCurrency(f.valor)}</td>
            </tr>
        `).join('') || '<tr><td colspan="4" class="text-center">Sem lançamentos financeiros.</td></tr>';
        const itensHtml = isNotaAvulsa ? '<tr><td colspan="8" class="text-center text-muted">Nota Fiscal Avulsa - sem itens</td></tr>' : (compra.itens || []).map(item => `
            <tr>
                <td>${escapeHtml(item.produto_nome || item.descricao_produto || '-')}</td>
                <td>${item.quantidade}</td>
                <td>${formatCurrency(item.preco_unitario)}</td>
                <td>${item.margem_lucro || 30}%</td>
                <td>${formatCurrency(item.preco_venda_sugerido || 0)}</td>
                <td>${formatCurrency(item.subtotal)}</td>
            </tr>
        `).join('');
        const modalHtml = `
            <div class="modal fade" id="viewCompraModal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Compra ${compra.id}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p><strong>Fornecedor:</strong> ${escapeHtml(compra.fornecedor || '-')}</p>
                            <p>
                                <strong>Data compra:</strong> ${formatDate(compra.data_compra)}
                                ${compra.data_emissao ? ` | <strong>Emissão:</strong> ${formatDate(compra.data_emissao)}` : ''}
                                ${compra.data_entrada ? ` | <strong>Entrada:</strong> ${formatDate(compra.data_entrada)}` : ''}
                            </p>
                            <p>
                                <strong>Número NF:</strong> ${escapeHtml(compra.numero_nf || '-')}
                                | <strong>Série:</strong> ${escapeHtml(compra.serie_nf || '-')}
                                | <strong>Modelo:</strong> ${escapeHtml(compra.modelo_nf || '-')}
                            </p>
                            <p style="word-break: break-all;">
                                <strong>Chave de acesso:</strong> ${escapeHtml(compra.chave_acesso || '-')}
                            </p>
                            <p>
                                <strong>Valor produtos:</strong> ${formatCurrency(compra.valor_produtos || 0)}
                                | <strong>Desconto:</strong> ${formatCurrency(compra.valor_desconto || 0)}
                                | <strong>Frete:</strong> ${formatCurrency(compra.valor_frete || 0)}
                                | <strong>Outras despesas:</strong> ${formatCurrency(compra.valor_outras_despesas || 0)}
                            </p>
                            <p>
                                <strong>Total nota:</strong> ${formatCurrency(compra.valor_total_nota || compra.total || 0)}
                                | <strong>Condição:</strong> ${rotuloCondicaoPagamento(compra.condicao_pagamento || 'avista')}
                                | <strong>Forma:</strong> ${rotuloFormaPagamento(compra.forma_pagamento)}
                            </p>
                            <p><strong>Observação:</strong> ${escapeHtml(compra.observacao || '-')}</p>
                            <h6>Itens</h6>
                            <table class="table table-bordered"><thead><tr><th>Produto</th><th>Qtd</th><th>Preço compra</th><th>Margem</th><th>Venda sugerida</th><th>Subtotal</th></tr></thead><tbody>${itensHtml}</tbody></table>
                            <h6>Lançamentos financeiros gerados</h6>
                            <table class="table table-bordered"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead><tbody>${financeiroHtml}</tbody></table>
                        </div>
                    </div>
                </div>
            </div>
        `;
        $('#modal-container').html(modalHtml);
        $('#viewCompraModal').modal('show');
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao carregar compra.', 'danger');
    });
}

function cancelarCompra(id) {
    const modalHtml = `
        <div class="modal fade" id="modalCancelarCompra" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-warning text-dark">
                        <h5 class="modal-title"><i class="fas fa-ban"></i> Cancelar Compra #${id}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-danger">
                            <i class="fas fa-exclamation-triangle"></i>
                            O sistema vai baixar o estoque e cancelar o financeiro desta compra.
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Motivo do cancelamento</label>
                            <textarea id="motivoCancelarCompra" class="form-control" rows="3"
                                placeholder="Informe o motivo do cancelamento...">Cancelamento manual</textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Voltar</button>
                        <button type="button" class="btn btn-danger" id="btnConfirmarCancelarCompra">
                            <i class="fas fa-ban"></i> Confirmar Cancelamento
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modalCancelarCompra').remove();
    $('body').append(modalHtml);

    const modal = new bootstrap.Modal(document.getElementById('modalCancelarCompra'));
    modal.show();

    document.getElementById('btnConfirmarCancelarCompra').addEventListener('click', function() {
        const motivo = $('#motivoCancelarCompra').val().trim();
        if (!motivo) {
            showNotification('Informe o motivo do cancelamento.', 'warning');
            return;
        }

        modal.hide();

        $.ajax({
            url: `${API_URL}/compras/${id}/cancelar`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ motivo })
        }).done(function() {
            showNotification('Compra cancelada com sucesso!', 'success');
            loadCompras();
        }).fail(function(xhr) {
            showNotification(xhr.responseJSON?.error || 'Erro ao cancelar compra.', 'danger');
        });
    });

    document.getElementById('modalCancelarCompra').addEventListener('hidden.bs.modal', function() {
        $('#modalCancelarCompra').remove();
    });
}

function abrirCadastroProdutoCentralMiip(item, callback) {
    if (typeof showProdutoModal !== 'function') {
        if (typeof callback === 'function') callback(null);
        return;
    }

    showProdutoModal(null);
    $('#produtoModal').one('shown.bs.modal', function preencherNovoProdutoCentralMiip() {
        $('#nome').val(item.produto_nome || '');
        if ($('#codigo_barras').length) $('#codigo_barras').val(item.codigo_barras || '');
        if ($('#ncm').length) $('#ncm').val(item.ncm || '');
        if ($('#unidade').length) $('#unidade').val(item.unidade || 'UN');
        if ($('#preco_compra').length) $('#preco_compra').val(formatNumberInput(item.preco_unitario || 0));
        if ($('#preco_venda').length) $('#preco_venda').val(formatNumberInput(item.preco_venda_sugerido || 0));
        if ($('#lucro_percentual').length) $('#lucro_percentual').val(formatNumberInput(item.margem_lucro || 30));
    });

    $('#produtoModal').one('hidden.bs.modal', function aposCadastroCentralMiip() {
        const ultimo = produtosCompraList[produtosCompraList.length - 1];
        if (typeof callback === 'function') callback(ultimo || null);
    });
}

function finalizarImportacaoXmlCompra(data) {
    compraImportadaXml = data;
    preencherFormularioCompra(data);
    aplicarMiipImportacaoXml(data);
    showNotification('Dados da nota carregados pela Central Inteligente.', 'success');
}

function abrirCompraDesdeCentralEntradas(payload) {
    if (!payload?.dadosCompra) return;

    centralDocumentoIdAtual = payload.documentoId || null;
    showCompraModal();
    finalizarImportacaoXmlCompra(payload.dadosCompra);
}

function abrirCentralInteligenteEntradas() {
    const modalEl = document.getElementById('compraModal');
    if (modalEl) {
        const instancia = bootstrap.Modal.getInstance(modalEl);
        if (instancia) instancia.hide();
    }

    if (typeof loadPage === 'function') {
        loadPage('central-entradas');
        return;
    }

    showNotification('Abra o menu Central Inteligente de Entradas.', 'info');
}

function consumirPendenciaCompraCentral() {
    try {
        const raw = sessionStorage.getItem('central_abrir_compra');
        if (!raw) return;

        sessionStorage.removeItem('central_abrir_compra');
        const payload = JSON.parse(raw);
        abrirCompraDesdeCentralEntradas(payload);
    } catch (error) {
        console.error('Erro ao abrir compra da Central:', error);
    }
}

function preencherFormularioCompra(data) {
    $('#data_emissao').val(data.data_emissao || $('#data_compra').val());
    $('#data_entrada').val(data.data_entrada || $('#data_compra').val());
    $('#fornecedor').val(data.fornecedor || '');
    $('#numero_nf').val(data.numero_nf || '');
    $('#serie_nf').val(data.serie_nf || '');
    $('#modelo_nf').val(data.modelo_nf || '55');
    $('#chave_acesso').val(data.chave_acesso || '');
    $('#observacao_compra').val(data.observacao || '');
    $('#valor_produtos').val(formatNumberInput(data.valor_produtos || 0));
    $('#valor_desconto').val(formatNumberInput(data.valor_desconto || 0));
    $('#valor_frete').val(formatNumberInput(data.valor_frete || 0));
    $('#valor_outras_despesas').val(formatNumberInput(data.valor_outras_despesas || 0));
    $('#valor_total_nota').val(formatNumberInput(data.valor_total_nota || 0));

    // Itens
    itensCompraAtual = (data.itens || []).map(item => normalizeItemCompra(item));
    renderItensCompraTabela();

    // Pagamento padrão
    $('#condicao_pagamento').val('avista');
    atualizarVisibilidadePagamentoCompra();
}

function abrirDevolucaoCompra(id) {
    $.ajax({
        url: `${API_URL}/compras/${id}`,
        method: 'GET'
    }).done(function(compra) {
        const itens = compra.itens || [];

        const linhas = itens.map(item => {
            const qtdComprada = Number(item.quantidade || 0);
            const qtdDevolvida = Number(item.quantidade_devolvida || 0);
            const qtdDisponivel = Math.max(0, qtdComprada - qtdDevolvida);

            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(item.produto_nome || '-')}</strong><br>
                        <small>Cód: ${escapeHtml(item.produto_codigo || item.codigo_barras || '-')}</small>
                    </td>
                    <td>${qtdComprada}</td>
                    <td>${qtdDevolvida}</td>
                    <td><strong>${qtdDisponivel}</strong></td>
                    <td>${formatCurrency(item.custo_unitario_final || item.preco_unitario || 0)}</td>
                    <td>
                        <input
                            type="number"
                            class="form-control form-control-sm qtd-devolver-compra"
                            data-item-id="${item.id}"
                            min="0"
                            max="${qtdDisponivel}"
                            step="0.001"
                            value="0"
                            ${qtdDisponivel <= 0 ? 'disabled' : ''}
                        >
                    </td>
                </tr>
            `;
        }).join('');

        const modalHtml = `
            <div class="modal fade" id="modalDevolucaoCompra" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header bg-secondary text-white">
                            <h5 class="modal-title">
                                <i class="fas fa-undo"></i> Devolução da Compra #${compra.id}
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>

                        <div class="modal-body">
                            <div class="alert alert-warning">
                                Esta devolução é interna: baixa estoque e gera crédito no financeiro.
                                A emissão fiscal SEFAZ modelo 55 será a próxima etapa.
                            </div>

                            <p><strong>Fornecedor:</strong> ${escapeHtml(compra.fornecedor || '-')}</p>
                            <p><strong>Total da compra:</strong> ${formatCurrency(compra.total)}</p>

                            <div class="mb-3">
                                <label class="form-label">Motivo da devolução</label>
                                <textarea id="motivoDevolucaoCompra" class="form-control" rows="3"
                                    placeholder="Ex: Produto veio errado, danificado ou diferente do solicitado."></textarea>
                            </div>

                            <div class="table-responsive">
                                <table class="table table-sm table-bordered align-middle">
                                    <thead>
                                        <tr>
                                            <th>Produto</th>
                                            <th>Comprada</th>
                                            <th>Já devolvida</th>
                                            <th>Disponível</th>
                                            <th>Custo</th>
                                            <th>Qtd devolver</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${linhas || '<tr><td colspan="6" class="text-center">Nenhum item encontrado.</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div class="modal-footer">
                            <button class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            <button class="btn btn-danger" onclick="confirmarDevolucaoCompra(${compra.id})">
                                Confirmar devolução
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $('#modalDevolucaoCompra').remove();
        $('body').append(modalHtml);
        $('#modalDevolucaoCompra').modal('show');

        $('#modalDevolucaoCompra').on('hidden.bs.modal', function () {
            $('#modalDevolucaoCompra').remove();
        });
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao carregar compra.', 'danger');
    });
}

function confirmarDevolucaoCompra(id) {
    const motivo = $('#motivoDevolucaoCompra').val().trim();

    if (!motivo || motivo.length < 10) {
        showNotification('Informe um motivo com no mínimo 10 caracteres.', 'warning');
        return;
    }

    const itens = [];

    $('.qtd-devolver-compra').each(function() {
        const quantidade = Number($(this).val() || 0);
        const compraItemId = Number($(this).data('item-id'));
        const max = Number($(this).attr('max') || 0);

        if (quantidade > max) {
            showNotification('Quantidade devolvida maior que a disponível.', 'warning');
            itens.length = 0;
            return false;
        }

        if (quantidade > 0) {
            itens.push({
                compra_item_id: compraItemId,
                quantidade
            });
        }
    });

    if (!itens.length) {
        showNotification('Informe a quantidade de pelo menos um item para devolver.', 'warning');
        return;
    }

    if (!confirm('Confirma a devolução parcial/total dos itens selecionados?')) {
        return;
    }

    $.ajax({
        url: `${API_URL}/compras/${id}/devolver`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ motivo, itens })
    }).done(function(resp) {
        showNotification(resp.message || 'Devolução registrada com sucesso.', 'success');
        $('#modalDevolucaoCompra').modal('hide');
        loadCompras();
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao registrar devolução.', 'danger');
    });
}

function abrirModalNFeDevolucaoCompra(id) {
    $.ajax({
        url: `${API_URL}/compras/${id}`,
        method: 'GET'
    }).done(function(compra) {
        const itens = compra.itens || [];

        const itensDevolvidos = itens.filter(item => Number(item.quantidade_devolvida || 0) > 0);

        const linhas = itensDevolvidos.map(item => `
            <tr>
                <td>${escapeHtml(item.produto_nome || item.descricao_produto || '-')}</td>
                <td>${Number(item.quantidade_devolvida || 0)}</td>
                <td>${formatCurrency(item.custo_unitario_final || item.preco_unitario || 0)}</td>
                <td>${formatCurrency(Number(item.quantidade_devolvida || 0) * Number(item.custo_unitario_final || item.preco_unitario || 0))}</td>
            </tr>
        `).join('');

        const chaveAtual = String(compra.chave_acesso || '').replace(/\D/g, '');

        const modalHtml = `
            <div class="modal fade" id="modalNFeDevolucaoCompra" tabindex="-1">
                <div class="modal-dialog modal-xl modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header bg-danger text-white">
                            <h5 class="modal-title">
                                <i class="fas fa-file-invoice"></i> NF-e de Devolução SEFAZ - Compra #${compra.id}
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>

                        <div class="modal-body">
                            <div class="alert alert-warning">
                                Antes de emitir para a SEFAZ, registre primeiro a <strong>devolução interna</strong>.
                                A NF-e de devolução será emitida somente para os itens já devolvidos.
                            </div>

                            <div class="row mb-3">
                                <div class="col-md-6">
                                    <strong>Fornecedor:</strong><br>
                                    ${escapeHtml(compra.fornecedor || '-')}
                                </div>
                                <div class="col-md-3">
                                    <strong>Total da compra:</strong><br>
                                    ${formatCurrency(compra.total)}
                                </div>
                                <div class="col-md-3">
                                    <strong>Status:</strong><br>
                                    ${escapeHtml(compra.status || '-')}
                                </div>
                            </div>

                            <div class="mb-3">
                                <label class="form-label">
                                    Chave de acesso da NF-e original do fornecedor
                                </label>
                                <input
                                    type="text"
                                    id="chaveNFeFornecedorDevolucao"
                                    class="form-control"
                                    maxlength="44"
                                    placeholder="Digite ou cole a chave de 44 dígitos"
                                    value="${escapeHtml(chaveAtual)}"
                                >
                                <small class="text-muted">
                                    Obrigatório para emitir NF-e de devolução. Deve conter 44 dígitos.
                                </small>
                            </div>

                            <h6>Itens já devolvidos internamente</h6>

                            <div class="table-responsive">
                                <table class="table table-sm table-bordered align-middle">
                                    <thead>
                                        <tr>
                                            <th>Produto</th>
                                            <th>Qtd devolvida</th>
                                            <th>Valor unitário</th>
                                            <th>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${linhas || '<tr><td colspan="4" class="text-center text-danger">Nenhum item devolvido internamente. Faça primeiro a devolução interna.</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div class="modal-footer">
                            <button class="btn btn-secondary" data-bs-dismiss="modal">
                                Fechar
                            </button>

                            <button class="btn btn-primary" onclick="salvarChaveNFeFornecedor(${compra.id})">
                                Salvar chave
                            </button>

                            <button
                                class="btn btn-danger"
                                onclick="confirmarEmissaoNFeDevolucaoCompra(${compra.id})"
                                ${itensDevolvidos.length === 0 ? 'disabled' : ''}
                            >
                                Emitir NF-e devolução SEFAZ
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $('#modalNFeDevolucaoCompra').remove();
        $('body').append(modalHtml);
        $('#modalNFeDevolucaoCompra').modal('show');

        $('#modalNFeDevolucaoCompra').on('hidden.bs.modal', function () {
            $('#modalNFeDevolucaoCompra').remove();
        });
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao carregar compra.', 'danger');
    });
}

function salvarChaveNFeFornecedor(id) {
    const chave = String($('#chaveNFeFornecedorDevolucao').val() || '').replace(/\D/g, '');

    if (chave.length !== 44) {
        showNotification('A chave da NF-e precisa ter 44 dígitos.', 'warning');
        return;
    }

    $.ajax({
        url: `${API_URL}/compras/${id}/chave-nfe-fornecedor`,
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify({ chave })
    }).done(function(resp) {
        showNotification(resp.message || 'Chave salva com sucesso.', 'success');
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao salvar chave.', 'danger');
    });
}

function confirmarEmissaoNFeDevolucaoCompra(id) {
    const chave = String($('#chaveNFeFornecedorDevolucao').val() || '').replace(/\D/g, '');

    if (chave.length !== 44) {
        showNotification('Salve uma chave de NF-e válida com 44 dígitos antes de emitir.', 'warning');
        return;
    }

    if (!confirm('Confirma a emissão da NF-e modelo 55 de devolução para a SEFAZ?')) {
        return;
    }

    salvarChaveNFeFornecedor(id);

    setTimeout(function() {
        $.ajax({
            url: `${API_URL}/compras/${id}/emitir-nfe-devolucao`,
            method: 'POST',
            contentType: 'application/json'
        }).done(function(resp) {
            showNotification(resp.message || 'NF-e de devolução emitida.', 'success');
            console.log('Retorno NF-e devolução:', resp);

            $('#modalNFeDevolucaoCompra').modal('hide');
            loadCompras();
        }).fail(function(xhr) {
            const resposta = xhr.responseJSON || { respostaBruta: xhr.responseText };

            console.error('RETORNO COMPLETO SEFAZ:', resposta);
            console.error('STATUS:', xhr.status);
            console.error('DATA:', resposta);

            const motivo =
                resposta?.xMotivo ||
                resposta?.motivo ||
                resposta?.retorno?.xMotivo ||
                resposta?.retorno?.xmotivo ||
                resposta?.erro ||
                resposta?.mensagem ||
                resposta?.error ||
                'Motivo não informado pelo backend.';

            const cStat =
                resposta?.cStat ||
                resposta?.retorno?.cStat ||
                resposta?.statusSefaz ||
                '';

            alert(
                `NF-e de devolução rejeitada pela SEFAZ.\n\n` +
                `cStat: ${cStat || 'não informado'}\n` +
                `Motivo: ${motivo}`
            );
        });
    });
}

