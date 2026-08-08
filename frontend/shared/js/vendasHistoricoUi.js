function escapeHtmlHistoricoVenda(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function historicoVendaModoFiscalAtivo() {
    return typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();
}

function itemPossuiParteFiscalHistorico(item) {
    return Number(item?.quantidade_fiscal ?? 0) > 0 || Number(item?.valor_fiscal ?? 0) > 0;
}

function filtrarItensHistoricoVenda(venda) {
    const itens = Array.isArray(venda?.itens) ? venda.itens : [];
    if (!historicoVendaModoFiscalAtivo()) {
        return itens;
    }
    return itens.filter(itemPossuiParteFiscalHistorico);
}

function obterTotalExibicaoHistoricoVenda(venda, itensFiltrados = []) {
    if (historicoVendaModoFiscalAtivo()) {
        const valorFiscal = Number(venda?.valor_fiscal ?? 0);
        if (valorFiscal > 0) {
            return valorFiscal;
        }
        return itensFiltrados.reduce((total, item) => total + Number(item.valor_fiscal || 0), 0);
    }
    return Number(venda?.total || 0);
}

function exibirCupomNaoFiscalHistorico(venda) {
    if (historicoVendaModoFiscalAtivo()) {
        return false;
    }
    return typeof vendaPossuiCupomNaoFiscal === 'function' && vendaPossuiCupomNaoFiscal(venda);
}

function vendaHistoricoTemCupomFiscal(venda) {
    if (!venda) return false;
    if (venda.nfce_id || venda.nfce_numero) return true;
    if (typeof vendaPossuiNfceAutorizada === 'function' && vendaPossuiNfceAutorizada(venda)) {
        return true;
    }
    return Number(venda.valor_fiscal || 0) > 0 && Boolean(venda.nfce_status);
}

function vendaHistoricoTemCupomNaoFiscal(venda) {
    if (!venda) return false;
    if (typeof vendaPossuiCupomNaoFiscal === 'function') {
        return vendaPossuiCupomNaoFiscal(venda);
    }
    if (Number(venda.valor_nao_fiscal || 0) > 0) return true;
    if (typeof vendaPossuiNfceAutorizada === 'function' && vendaPossuiNfceAutorizada(venda)) {
        return false;
    }
    return Number(venda.valor_fiscal || 0) === 0 && Number(venda.total || 0) > 0;
}

function montarHtmlAcoesHistoricoVenda(venda, opcoes = {}) {
    const incluirDevolucao = opcoes.incluirDevolucao !== false;
    const id = Number(venda.id);
    const dropdownId = `acoesVenda${id}`;
    const cancelada = String(venda.status || '').toLowerCase() === 'cancelada'
        || Number(venda.cancelada || 0) === 1;

    const temFiscal = vendaHistoricoTemCupomFiscal(venda);
    const temNaoFiscal = vendaHistoricoTemCupomNaoFiscal(venda);
    const nfceNumero = venda.nfce_numero ? ` #${venda.nfce_numero}` : '';
    const tipoCupom = temFiscal ? 'fiscal' : (temNaoFiscal ? 'nao_fiscal' : null);

    const blocoImpressao = tipoCupom ? `
        <li><hr class="dropdown-divider my-1"></li>
        <li>
            <button
                type="button"
                class="dropdown-item py-2"
                onclick="${tipoCupom === 'fiscal' ? `reimprimirCupomFiscalHistorico(${id})` : `reimprimirCupomNaoFiscalHistorico(${id})`}"
            >
                <i class="${tipoCupom === 'fiscal' ? 'fas fa-print' : 'fas fa-receipt'} fa-fw me-2 text-muted"></i>
                ${tipoCupom === 'fiscal'
                    ? `Reimprimir cupom fiscal${escapeHtmlHistoricoVenda(nfceNumero)}`
                    : 'Reimprimir cupom não fiscal'}
            </button>
        </li>
        ${tipoCupom === 'fiscal' ? `
        <li>
            <button type="button" class="dropdown-item py-2" onclick="abrirXmlNfceHistorico(${id})">
                <i class="fas fa-file-code fa-fw me-2 text-muted"></i>Abrir XML${escapeHtmlHistoricoVenda(nfceNumero)}
            </button>
        </li>` : ''}
    ` : '';

    const blocoOperacional = !cancelada ? `
        <li><hr class="dropdown-divider my-1"></li>
        ${incluirDevolucao ? `
        <li>
            <button type="button" class="dropdown-item py-2" onclick="abrirDevolucaoVenda(${id})">
                <i class="fas fa-undo fa-fw me-2 text-muted"></i>Devolução parcial
            </button>
        </li>` : ''}
        <li>
            <button type="button" class="dropdown-item py-2 text-danger" onclick="cancelarVendaNaoFiscal(${id})">
                <i class="fas fa-times fa-fw me-2"></i>Cancelar venda
            </button>
        </li>
    ` : '';

    return `
        <div class="historico-venda-acoes">
            <button
                type="button"
                class="btn btn-sm btn-outline-primary"
                onclick="viewVenda(${id})"
                title="Ver detalhes"
            >
                <i class="fas fa-eye"></i>
            </button>
            <div class="dropdown d-inline-block">
                <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary historico-venda-acoes-menu"
                    id="${dropdownId}"
                    data-bs-toggle="dropdown"
                    data-bs-boundary="viewport"
                    aria-expanded="false"
                    title="Mais ações"
                >
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end historico-venda-acoes-dropdown shadow-sm" aria-labelledby="${dropdownId}">
                    <li>
                        <button type="button" class="dropdown-item py-2" onclick="viewVenda(${id})">
                            <i class="fas fa-eye fa-fw me-2 text-muted"></i>Ver detalhes
                        </button>
                    </li>
                    <li>
                        <button type="button" class="dropdown-item py-2" onclick="verResumoVendaFiscalTEF(${id})">
                            <i class="fas fa-file-alt fa-fw me-2 text-muted"></i>Resumo NFC-e / TEF
                        </button>
                    </li>
                    ${blocoImpressao}
                    ${blocoOperacional}
                </ul>
            </div>
        </div>
    `;
}

window.montarHtmlAcoesHistoricoVenda = montarHtmlAcoesHistoricoVenda;
window.historicoVendaModoFiscalAtivo = historicoVendaModoFiscalAtivo;
window.filtrarItensHistoricoVenda = filtrarItensHistoricoVenda;
window.obterTotalExibicaoHistoricoVenda = obterTotalExibicaoHistoricoVenda;
window.exibirCupomNaoFiscalHistorico = exibirCupomNaoFiscalHistorico;
