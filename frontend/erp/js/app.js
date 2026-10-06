/**
 * Roteador do módulo CDS ERP (Retaguarda).
 */
window.CDS_MODULE = 'erp';
window.CDS_DEFAULT_PAGE = 'dashboard';

function loadPage(page) {
    if (typeof resolverPaginaErpNav === 'function') {
        page = resolverPaginaErpNav(page);
    }
    currentPage = page;

    if (!paginaPermitidaPorImplantacao(page)) {
        showNotification('Este módulo não está habilitado para o tipo de implantação configurado.', 'warning');
        if (page !== 'dashboard') loadPage('dashboard');
        return;
    }

    if (!usuarioTemPermissao(page)) {
        showNotification('Você não tem permissão para acessar esta página.', 'warning');
        if (page !== 'dashboard') loadPage('dashboard');
        return;
    }

    if (typeof desativarPdvFullscreen === 'function') {
        desativarPdvFullscreen();
    }
    document.body.classList.remove('menu-open', 'pdv-mode');

    if (typeof destacarNavConfigComercial === 'function') {
        destacarNavConfigComercial(page);
    }
    if (typeof destacarNavFiscal === 'function') {
        destacarNavFiscal(page);
    }

    switch (page) {
        case 'dashboard':
            return carregarPaginaHtml('dashboard.html', function () {
                if (typeof initDashboard === 'function') initDashboard();
            });
        case 'produtos':
            return typeof loadProdutos === 'function'
                ? loadProdutos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar produtos.</div>');
        case 'clientes':
            return typeof loadClientes === 'function'
                ? loadClientes()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar clientes.</div>');
        case 'compras':
            return typeof loadCompras === 'function'
                ? loadCompras()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar compras.</div>');
        case 'central-entradas':
            return typeof loadCentralEntradas === 'function'
                ? loadCentralEntradas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Central de Entradas.</div>');
        case 'fornecedores':
            return typeof loadFornecedores === 'function'
                ? loadFornecedores()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar fornecedores.</div>');
        case 'vendas':
            return typeof loadVendas === 'function'
                ? loadVendas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar histórico de vendas.</div>');
        case 'pedidos':
            return typeof loadPedidos === 'function'
                ? loadPedidos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar orçamentos e pedidos.</div>');
        case 'financeiro':
            return carregarPaginaHtml('financeiro.html', function () {
                if (typeof initFinanceiro === 'function') initFinanceiro();
            });
        case 'licenca':
            return typeof loadLicenca === 'function'
                ? loadLicenca()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar licença.</div>');
        case 'caixa':
            return typeof loadCaixa === 'function'
                ? loadCaixa()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar caixa.</div>');
        case 'configuracoes':
            return typeof loadConfiguracoes === 'function'
                ? loadConfiguracoes()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar configurações.</div>');
        case 'usuarios':
            return typeof loadUsuarios === 'function'
                ? loadUsuarios()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar usuários.</div>');
        case 'equipamentos':
            return typeof loadEquipamentos === 'function'
                ? loadEquipamentos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar equipamentos.</div>');
        case 'laboratorio-equipamentos':
            return typeof loadLaboratorioEquipamentos === 'function'
                ? loadLaboratorioEquipamentos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar laboratório.</div>');
        case 'configuracoes-avancadas':
            return typeof loadConfiguracoesAvancadas === 'function'
                ? loadConfiguracoesAvancadas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar configurações avançadas.</div>');
        case 'fiscal':
            return typeof loadFiscal === 'function'
                ? loadFiscal()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar o módulo fiscal.</div>');
        case 'fiscal-nfe-nova':
        case 'fiscal-nfe':
        case 'fiscal-nfe-monitor':
        case 'fiscal-nfe-fila':
        case 'fiscal-nfe-diagnostico':
            return typeof loadNfePagina === 'function'
                ? loadNfePagina(page)
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar o módulo NF-e.</div>');
        case 'fiscal-contabil':
            return typeof loadCentralContabil === 'function'
                ? loadCentralContabil()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar a Central Contábil.</div>');
        case 'categorias':
            return carregarPaginaHtml('categorias.html', function () {
                if (typeof loadCategoriasAndSubcategorias === 'function') {
                    loadCategoriasAndSubcategorias();
                } else if (typeof loadCategorias === 'function') {
                    loadCategorias();
                }
            });
        case 'canais-venda':
            return carregarPaginaHtml('canais-venda.html', function () {
                if (typeof loadCanaisVenda === 'function') loadCanaisVenda();
            });
        case 'tipos-comerciais':
            return carregarPaginaHtml('tipos-comerciais.html', function () {
                if (typeof loadTiposComerciais === 'function') loadTiposComerciais();
            });
        case 'tabelas-preco':
            return carregarPaginaHtml('tabelas-preco.html', function () {
                if (typeof loadTabelasPreco === 'function') loadTabelasPreco();
            });
        case 'linhas-comerciais':
            return carregarPaginaHtml('linhas-comerciais.html', function () {
                if (typeof inicializarPaginaLinhasComerciais === 'function') {
                    inicializarPaginaLinhasComerciais();
                } else if (typeof loadLinhasComerciais === 'function') {
                    loadLinhasComerciais();
                }
            });
        case 'casquinha-sabores':
            return carregarPaginaHtml('casquinha-sabores.html', function () {
                if (typeof loadCasquinhaSabores === 'function') loadCasquinhaSabores();
            });
        case 'kits-combos':
            return carregarPaginaHtml('kits-combos.html', function () {
                if (typeof loadKitsCombos === 'function') loadKitsCombos();
            });
        case 'venda-no-atacado':
        case 'configuracao-comercial':
            return carregarPaginaHtml('venda-no-atacado.html', function () {
                if (typeof loadVendaNoAtacado === 'function') loadVendaNoAtacado();
            });
        case 'diagnostico-comercial':
            return carregarPaginaHtml('diagnostico-comercial.html', function () {
                if (typeof loadDiagnosticoComercial === 'function') loadDiagnosticoComercial();
            });
        case 'auditoria':
            return carregarPaginaHtml('auditoria.html', function () {
                if (typeof inicializarPaginaAuditoria === 'function') {
                    inicializarPaginaAuditoria();
                } else if (typeof carregarAuditoria === 'function') {
                    carregarAuditoria(1);
                }
            });
        case 'diagnostico-instancia':
            return carregarPaginaHtml('diagnostico-instancia.html', function () {
                if (typeof inicializarPaginaDiagnosticoInstancia === 'function') {
                    inicializarPaginaDiagnosticoInstancia();
                }
            });
        case 'caixas':
            return carregarPaginaHtml('caixas.html', function () {
                if (typeof loadCaixas === 'function') {
                    buscarCaixas();
                    if (typeof buscarTerminais === 'function') buscarTerminais();
                }
            });
        case 'terminais':
            return carregarPaginaHtml('caixas.html', function () {
                if (typeof loadCaixas === 'function') {
                    buscarCaixas();
                    if (typeof buscarTerminais === 'function') buscarTerminais();
                }
                setTimeout(function () {
                    var el = document.getElementById('central-terminais');
                    if (el && typeof el.scrollIntoView === 'function') {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }, 120);
            });
        case 'comercial-dashboard':
        case 'comercial-clientes':
        case 'comercial-consignacao-nova':
        case 'comercial-consignacao-lista':
        case 'comercial-acertos':
        case 'comercial-conta-corrente':
        case 'comercial-perdas':
        case 'comercial-cortesias':
        case 'comercial-relatorios':
        case 'comercial-pendencias':
        case 'comercial-recomendacoes':
        case 'comercial-playbooks':
            return typeof loadComercial === 'function'
                ? loadComercial(page)
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar módulo Comercial.</div>');
        default:
            $('#page-content').html('<div class="alert alert-warning">Página não encontrada.</div>');
    }
}

$(document).ready(function () {
    const pendingClienteId = sessionStorage.getItem('cds-erp-cliente-id');
    inicializarShellModulo({ defaultPage: pendingClienteId ? 'clientes' : 'dashboard' });
});
