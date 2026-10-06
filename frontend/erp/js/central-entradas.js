/**
 * Central Inteligente de Entradas — Sprint 9 (Polimento Enterprise).
 *
 * UX, acabamento visual e experiência do usuário. Reutiliza 100% do backend existente.
 * Regras de negócio (MIIP, Parser, Pipeline, Compras) não são alteradas aqui.
 */

function centralUx() {
    return window.CentralEntradasUX || {};
}

function cargaCentral() {
    return window.CentralEntradasCarga || {};
}

const centralEntradasState = {
    pagina: 1,
    limite: 20,
    total: 0,
    totalPaginas: 1,
    documentos: [],
    documentoSelecionadoId: null,
    metadados: null,
    ordenarPor: 'created_at',
    ordenarDirecao: 'desc',
    carregando: false,
    carregandoDashboard: false,
    carregandoInteligencia: false,
    sincronizando: false,
    ultimaSincronizacao: null,
    sincronizacaoNsu: null,
    notasNovasUltimaSync: 0,
    processando: false,
    etapaProcessamento: null,
    detalheAtual: null,
    xmlAtual: null,
    parseAtual: null,
    abaAtiva: 'resumo',
    indicadores: null,
    ultimoDashboardContadores: null,
    operacional: null,
    alertas: null,
    pendencias: null,
    atencao: null,
    filtroRapidoAtivo: '',
    fornecedorStats: null,
    servicoStatus: null,
    configuracoes: null,
    viewAtiva: 'inbox',
    eventosLog: [],
    eventosTotal: 0,
    notificacoesVistas: new Set(),
    tickerServico: null,
    tickerNotificacoes: null,
    tickerSync: null,
    uploadArquivos: [],
    uploadEmAndamento: false,
    falhaSync: null,
    promessaInteligencia: null,
    erroDocumentos: null,
    promessaDocumentos: null,
    requestIdDocumentos: 0,
    abortDocumentos: null
};

const guardaDashboardCentral = cargaCentral().criarGuardaCarga
    ? cargaCentral().criarGuardaCarga()
    : {
        ocupado() { return false; },
        executar(fn) { return Promise.resolve().then(fn); }
    };

const CENTRAL_STATUS_META = {
    RECEBIDA: { cor: '#94a3b8', bg: 'rgba(148,163,184,.12)', icone: 'fa-envelope', badge: 'central-badge-light', descricao: 'Documento recebido' },
    AGUARDANDO_XML: { cor: '#64748b', bg: 'rgba(100,116,139,.12)', icone: 'fa-hourglass-half', badge: 'bg-secondary', descricao: 'Documento localizado, aguardando XML' },
    XML_RECUPERANDO: { cor: '#475569', bg: 'rgba(71,85,105,.12)', icone: 'fa-sync', badge: 'bg-secondary', descricao: 'Recuperando XML na SEFAZ' },
    ERRO_RECUPERACAO: { cor: '#dc3545', bg: 'rgba(220,53,69,.12)', icone: 'fa-unlink', badge: 'bg-danger', descricao: 'Falha ao recuperar XML — recuperável' },
    SINCRONIZADA: { cor: '#0d6efd', bg: 'rgba(13,110,253,.10)', icone: 'fa-inbox', badge: 'bg-primary', descricao: 'Nova nota encontrada' },
    EM_PROCESSAMENTO: { cor: '#f59e0b', bg: 'rgba(245,158,11,.12)', icone: 'fa-cog', badge: 'bg-warning text-dark', descricao: 'Pipeline em execução' },
    AGUARDANDO_REVISAO: { cor: '#fd7e14', bg: 'rgba(253,126,20,.12)', icone: 'fa-user-check', badge: 'central-badge-orange', descricao: 'Produtos aguardando revisão' },
    REVISADA: { cor: '#0dcaf0', bg: 'rgba(13,202,240,.12)', icone: 'fa-clipboard-check', badge: 'bg-info', descricao: 'Revisão concluída' },
    PRONTA_PARA_COMPRA: { cor: '#198754', bg: 'rgba(25,135,84,.12)', icone: 'fa-check-circle', badge: 'bg-success', descricao: 'Pronta para lançamento' },
    EM_COMPRA: { cor: '#6610f2', bg: 'rgba(102,16,242,.12)', icone: 'fa-shopping-cart', badge: 'bg-info', descricao: 'Aberta na tela de Compras' },
    GRAVADA: { cor: '#6c757d', bg: 'rgba(108,117,125,.12)', icone: 'fa-archive', badge: 'bg-secondary', descricao: 'Compra concluída' },
    DESCARTADA: { cor: '#212529', bg: 'rgba(33,37,41,.10)', icone: 'fa-trash-alt', badge: 'bg-dark', descricao: 'Documento descartado' },
    ERRO: { cor: '#dc3545', bg: 'rgba(220,53,69,.12)', icone: 'fa-exclamation-triangle', badge: 'bg-danger', descricao: 'Falha no processamento' },
    DUPLICADA: { cor: '#dc3545', bg: 'rgba(220,53,69,.12)', icone: 'fa-copy', badge: 'bg-danger', descricao: 'Nota já lançada no sistema' }
};

function metaStatusCentral(status) {
    return CENTRAL_STATUS_META[status] || CENTRAL_STATUS_META.RECEBIDA;
}

function escapeHtmlCentralEntradas(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatarMoedaCentral(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function formatarDataCentral(data) {
    if (!data) return '—';
    const texto = String(data);
    if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
        const [ano, mes, dia] = texto.substring(0, 10).split('-');
        return `${dia}/${mes}/${ano}`;
    }
    return texto;
}

function formatarDataHoraCentral(data) {
    if (!data) return '—';
    const date = new Date(data);
    if (Number.isNaN(date.getTime())) return String(data);
    return date.toLocaleString('pt-BR');
}

function tempoDesdeCentral(data) {
    if (!data) return null;
    const inicio = new Date(data).getTime();
    if (Number.isNaN(inicio)) return null;

    const diffSeg = Math.max(0, Math.floor((Date.now() - inicio) / 1000));
    if (diffSeg < 60) return 'agora mesmo';
    if (diffSeg < 3600) return `há ${Math.floor(diffSeg / 60)} min`;
    if (diffSeg < 86400) return `há ${Math.floor(diffSeg / 3600)} h`;
    return `há ${Math.floor(diffSeg / 86400)} dia(s)`;
}

function labelOrigemCentral(origem) {
    const mapa = {
        dfe: 'DF-e',
        upload_manual: 'Upload',
        consulta_chave: 'Chave'
    };
    return mapa[origem] || origem || '—';
}

function iconeOrigemCentral(origem) {
    const mapa = {
        dfe: 'fa-cloud-download-alt',
        upload_manual: 'fa-file-upload',
        consulta_chave: 'fa-key'
    };
    return mapa[origem] || 'fa-file';
}

function obterLabelStatusCentral(status) {
    const meta = (centralEntradasState.metadados?.estados || []).find((e) => e.codigo === status);
    return meta?.label || status || '—';
}

function renderBadgeStatusCentral(status, label) {
    const meta = metaStatusCentral(status);
    return `<span class="badge ${meta.badge} central-entradas-badge-status" title="${escapeHtmlCentralEntradas(meta.descricao)}">
        <i class="fas ${meta.icone} me-1"></i>${escapeHtmlCentralEntradas(label || obterLabelStatusCentral(status))}
    </span>`;
}

async function centralEntradasFetch(path, options = {}) {
    const token = localStorage.getItem('token');
    const { timeoutMs, ...fetchOptions } = options;
    let timeoutId = null;
    const controller = !fetchOptions.signal && timeoutMs ? new AbortController() : null;
    if (controller && timeoutMs) {
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
        const response = await fetch(`${API_URL}/central-entradas${path}`, {
            ...fetchOptions,
            signal: fetchOptions.signal || controller?.signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(fetchOptions.headers || {})
            }
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Erro HTTP ${response.status}`);
        }
        return data;
    } catch (error) {
        if (error && error.name === 'AbortError') {
            const abortado = new Error('Tempo esgotado ao comunicar com o servidor.');
            abortado.code = 'TIMEOUT';
            throw abortado;
        }
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

async function centralEntradasUpload(arquivos) {
    const token = localStorage.getItem('token');
    const formData = new FormData();

    arquivos.forEach((arquivo) => {
        formData.append('xml', arquivo);
    });

    const usuario = obterUsuarioLogadoCentral();
    if (usuario?.id != null) {
        formData.append('usuario_id', String(usuario.id));
    }

    const response = await fetch(`${API_URL}/central-entradas/upload`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`
        },
        body: formData
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok && !data.itens) {
        throw new Error(data.error || `Erro HTTP ${response.status}`);
    }
    return data;
}

function arquivoXmlValidoCentral(arquivo) {
    const nome = String(arquivo?.name || '');
    if (!/\.xml$/i.test(nome)) {
        return { valido: false, mensagem: 'Apenas arquivos .xml são permitidos' };
    }
    return { valido: true };
}

function renderListaArquivosUploadCentral() {
    const lista = document.getElementById('centralUploadLista');
    const btnEnviar = document.getElementById('centralUploadEnviar');
    if (!lista) return;

    const arquivos = centralEntradasState.uploadArquivos || [];
    if (!arquivos.length) {
        lista.classList.add('d-none');
        lista.innerHTML = '';
        if (btnEnviar) btnEnviar.disabled = true;
        return;
    }

    lista.classList.remove('d-none');
    lista.innerHTML = `
        <div class="central-upload-lista-header">
            <span><i class="fas fa-file-code me-1"></i> ${arquivos.length} arquivo(s) selecionado(s)</span>
            <button type="button" class="btn btn-link btn-sm text-danger p-0" id="centralUploadLimpar">Limpar</button>
        </div>
        <ul class="central-upload-lista-itens">
            ${arquivos.map((arquivo, idx) => `
                <li>
                    <span class="central-upload-item-nome" title="${escapeHtmlCentralEntradas(arquivo.name)}">
                        <i class="fas fa-file-xml text-primary me-1"></i>
                        ${escapeHtmlCentralEntradas(arquivo.name)}
                    </span>
                    <span class="text-muted small">${(arquivo.size / 1024).toFixed(1)} KB</span>
                    <button type="button" class="btn btn-sm btn-link text-danger p-0 central-upload-remover" data-idx="${idx}" title="Remover">
                        <i class="fas fa-times"></i>
                    </button>
                </li>
            `).join('')}
        </ul>
    `;

    if (btnEnviar) btnEnviar.disabled = centralEntradasState.uploadEmAndamento;
}

function renderResultadoUploadCentral(resultado) {
    const container = document.getElementById('centralUploadResultado');
    const progresso = document.getElementById('centralUploadProgresso');
    if (!container) return;

    if (progresso) progresso.classList.add('d-none');

    const itens = Array.isArray(resultado?.itens) ? resultado.itens : [];
    const resumoClass = resultado.importados > 0 ? 'success' : 'warning';

    const codigoLabel = {
        IMPORTADO: { texto: 'Upload concluído', classe: 'text-success' },
        XML_INVALIDO: { texto: 'XML inválido', classe: 'text-danger' },
        EXTENSAO_INVALIDA: { texto: 'Extensão inválida', classe: 'text-danger' },
        DOCUMENTO_JA_EXISTENTE: { texto: 'Documento já existente', classe: 'text-warning' },
        DOCUMENTO_DUPLICADO: { texto: 'Documento duplicado', classe: 'text-danger' },
        NF_CANCELADA: { texto: 'NF cancelada', classe: 'text-danger' },
        ERRO_PROCESSAMENTO: { texto: 'Erro no processamento', classe: 'text-danger' }
    };

    container.classList.remove('d-none');
    container.innerHTML = `
        <div class="alert alert-${resumoClass} py-2 mb-2">
            <strong>${escapeHtmlCentralEntradas(resultado.mensagem || 'Processamento concluído')}</strong>
            <div class="small mt-1">
                Enviados: ${resultado.totalEnviados || 0} ·
                Importados: ${resultado.importados || 0} ·
                Duplicados: ${resultado.duplicados || 0} ·
                Inválidos: ${resultado.invalidos || 0} ·
                Cancelados: ${resultado.cancelados || 0}
            </div>
        </div>
        ${itens.length ? `
            <ul class="central-upload-resultado-itens list-unstyled mb-0">
                ${itens.map((item) => {
                    const meta = codigoLabel[item.codigo] || { texto: item.mensagem, classe: 'text-muted' };
                    return `
                        <li class="central-upload-resultado-item">
                            <span class="central-upload-item-nome">${escapeHtmlCentralEntradas(item.nomeArquivo)}</span>
                            <span class="small ${meta.classe}">${escapeHtmlCentralEntradas(meta.texto)}</span>
                        </li>
                    `;
                }).join('')}
            </ul>
        ` : ''}
    `;
}

function abrirModalUploadCentral() {
    centralEntradasState.uploadArquivos = [];
    centralEntradasState.uploadEmAndamento = false;

    const resultado = document.getElementById('centralUploadResultado');
    const progresso = document.getElementById('centralUploadProgresso');
    const input = document.getElementById('centralUploadInput');

    if (resultado) {
        resultado.classList.add('d-none');
        resultado.innerHTML = '';
    }
    if (progresso) progresso.classList.add('d-none');
    if (input) input.value = '';

    renderListaArquivosUploadCentral();

    const modalEl = document.getElementById('centralUploadModal');
    if (!modalEl) return;

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

function adicionarArquivosUploadCentral(fileList) {
    const novos = Array.from(fileList || []);
    if (!novos.length) return;

    const invalidos = [];
    const validos = [];

    novos.forEach((arquivo) => {
        const check = arquivoXmlValidoCentral(arquivo);
        if (!check.valido) {
            invalidos.push(`${arquivo.name}: ${check.mensagem}`);
        } else {
            validos.push(arquivo);
        }
    });

    if (invalidos.length) {
        showNotification(invalidos.join('; '), 'warning');
    }

    if (!validos.length) return;

    const existentes = new Set((centralEntradasState.uploadArquivos || []).map((f) => `${f.name}|${f.size}`));
    const merged = [...(centralEntradasState.uploadArquivos || [])];

    validos.forEach((arquivo) => {
        const chave = `${arquivo.name}|${arquivo.size}`;
        if (!existentes.has(chave)) {
            merged.push(arquivo);
            existentes.add(chave);
        }
    });

    centralEntradasState.uploadArquivos = merged;
    renderListaArquivosUploadCentral();
}

async function enviarUploadCentralEntradas() {
    const arquivos = centralEntradasState.uploadArquivos || [];
    if (!arquivos.length || centralEntradasState.uploadEmAndamento) return;

    const btnEnviar = document.getElementById('centralUploadEnviar');
    const progresso = document.getElementById('centralUploadProgresso');
    const resultado = document.getElementById('centralUploadResultado');

    centralEntradasState.uploadEmAndamento = true;
    if (btnEnviar) {
        btnEnviar.disabled = true;
        btnEnviar.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Enviando...';
    }
    if (progresso) {
        progresso.classList.remove('d-none');
        progresso.innerHTML = `
            <div class="d-flex align-items-center gap-2 text-primary small">
                <span class="spinner-border spinner-border-sm"></span>
                Enviando ${arquivos.length} arquivo(s)...
            </div>
        `;
    }
    if (resultado) {
        resultado.classList.add('d-none');
        resultado.innerHTML = '';
    }

    try {
        const resposta = await centralEntradasUpload(arquivos);
        renderResultadoUploadCentral(resposta);

        if (resposta.importados > 0) {
            showNotification(resposta.mensagem || 'Upload concluído.', 'success');
            await Promise.all([
                carregarDashboardCentral(),
                carregarDocumentosCentral({ pagina: 1 })
            ]);

            const primeiroImportado = (resposta.itens || []).find((i) => i.codigo === 'IMPORTADO' && i.documentoId);
            if (primeiroImportado?.documentoId) {
                await selecionarDocumentoCentral(primeiroImportado.documentoId);
            }
        } else if (resposta.duplicados > 0) {
            showNotification('Nenhum documento novo — verifique duplicatas.', 'warning');
        } else {
            showNotification(resposta.mensagem || 'Nenhum documento importado.', 'warning');
        }

        centralEntradasState.uploadArquivos = [];
        renderListaArquivosUploadCentral();
    } catch (error) {
        showNotification('Erro no upload: ' + error.message, 'danger');
    } finally {
        centralEntradasState.uploadEmAndamento = false;
        if (btnEnviar) {
            btnEnviar.disabled = !(centralEntradasState.uploadArquivos || []).length;
            btnEnviar.innerHTML = '<i class="fas fa-upload"></i> Enviar';
        }
    }
}

/* ============================================================
 * Dashboard
 * ============================================================ */

function renderCardsDashboardCentral(contadores = {}) {
    const UX = centralUx();
    const snapshot = UX.obterSnapshotKpisCentral?.();
    const prev = snapshot?.contadores || {};

    const cards = [
        { titulo: 'Novas Notas', valor: contadores.novas ?? 0, status: 'SINCRONIZADA', subtitulo: 'aguardando processamento', trendKey: 'novas' },
        { titulo: 'Aguardando XML', valor: contadores.aguardandoXml ?? 0, status: 'AGUARDANDO_XML', subtitulo: 'XML ainda indisponível', trendKey: 'aguardandoXml', invertTrend: true },
        { titulo: 'Em Processamento', valor: contadores.emProcessamento ?? 0, status: 'EM_PROCESSAMENTO', subtitulo: 'pipeline em execução', trendKey: 'emProcessamento' },
        { titulo: 'Aguardando Revisão', valor: contadores.aguardandoRevisao ?? 0, status: 'AGUARDANDO_REVISAO', subtitulo: 'pendências MIIP', trendKey: 'aguardandoRevisao', invertTrend: true },
        { titulo: 'Prontas para Compra', valor: contadores.prontasParaCompra ?? 0, status: 'PRONTA_PARA_COMPRA', subtitulo: 'prontas para lançamento', trendKey: 'prontasParaCompra' },
        { titulo: 'Compras Gravadas', valor: contadores.gravadas ?? 0, status: 'GRAVADA', subtitulo: 'fluxo concluído', trendKey: 'gravadas' },
        { titulo: 'Erros', valor: contadores.erros ?? 0, status: 'ERRO', subtitulo: 'exigem atenção', trendKey: 'erros', invertTrend: true }
    ];

    return cards.map((card) => {
        const meta = metaStatusCentral(card.status);
        const trend = UX.renderTendenciaKpiCentral
            ? UX.renderTendenciaKpiCentral(card.valor, prev[card.trendKey], card.invertTrend)
            : '';
        return `
        <div class="col-6 col-md-4 col-xl-2">
            <div class="central-entradas-kpi central-entradas-card-click central-entradas-anim-in"
                 data-status-filtro="${card.status}"
                 style="--kpi-cor:${meta.cor}; --kpi-bg:${meta.bg}"
                 title="${escapeHtmlCentralEntradas(meta.descricao)}"
                 tabindex="0"
                 role="button"
                 aria-label="${escapeHtmlCentralEntradas(card.titulo)}: ${card.valor}">
                <div class="central-entradas-kpi-icone">
                    <i class="fas ${meta.icone}"></i>
                </div>
                <div class="central-entradas-kpi-corpo">
                    <div class="central-entradas-kpi-valor">${escapeHtmlCentralEntradas(card.valor)}</div>
                    <div class="central-entradas-kpi-titulo">${escapeHtmlCentralEntradas(card.titulo)}</div>
                    <div class="central-entradas-kpi-subtitulo">${escapeHtmlCentralEntradas(card.subtitulo)}</div>
                    ${trend}
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderIndicadoresCentral() {
    const container = document.getElementById('centralEntradasIndicadores');
    if (!container) return;

    const ind = centralEntradasState.indicadores || {};
    const ultima = centralEntradasState.ultimaSincronizacao;
    const tempoSync = tempoDesdeCentral(ultima);
    const sincronizando = centralEntradasState.sincronizando;
    const nsu = centralEntradasState.sincronizacaoNsu;

    container.innerHTML = `
        <div class="central-entradas-indicadores central-entradas-anim-in ${sincronizando ? 'central-entradas-indicadores--ativo' : ''}">
            <div class="central-entradas-indicador">
                <i class="fas fa-satellite-dish ${sincronizando ? 'fa-spin text-primary' : 'text-primary'}"></i>
                <div>
                    <div class="central-entradas-indicador-label">Última DistDFe (NSU)</div>
                    <div class="central-entradas-indicador-valor">
                        ${sincronizando
                            ? 'Sincronizando...'
                            : (ultima ? `${escapeHtmlCentralEntradas(formatarDataHoraCentral(ultima))}` : 'Nunca sincronizado')}
                    </div>
                    ${tempoSync && !sincronizando ? `<div class="central-entradas-indicador-extra">${escapeHtmlCentralEntradas(tempoSync)}</div>` : ''}
                    ${centralEntradasState.sefazDisponivel === false
                        ? '<div class="central-entradas-indicador-extra text-danger">SEFAZ indisponível</div>'
                        : ''}
                </div>
            </div>
            <div class="central-entradas-indicador">
                <i class="fas fa-coins text-success"></i>
                <div>
                    <div class="central-entradas-indicador-label">Valor das notas de hoje</div>
                    <div class="central-entradas-indicador-valor">${escapeHtmlCentralEntradas(formatarMoedaCentral(ind.valorTotalDia))}</div>
                    <div class="central-entradas-indicador-extra">${escapeHtmlCentralEntradas(ind.documentosHoje ?? 0)} documento(s) hoje</div>
                </div>
            </div>
            <div class="central-entradas-indicador">
                <i class="fas fa-database text-secondary"></i>
                <div>
                    <div class="central-entradas-indicador-label">Documentos monitorados</div>
                    <div class="central-entradas-indicador-valor">${escapeHtmlCentralEntradas(ind.totalDocumentos ?? 0)}</div>
                    ${nsu?.ultNsu ? `<div class="central-entradas-indicador-extra">NSU ${escapeHtmlCentralEntradas(nsu.ultNsu)}</div>` : ''}
                </div>
            </div>
            ${centralEntradasState.notasNovasUltimaSync > 0 && !sincronizando
                ? `<div class="central-entradas-indicador central-entradas-indicador--novas central-entradas-anim-pulse">
                    <i class="fas fa-bell text-warning"></i>
                    <div>
                        <div class="central-entradas-indicador-label">Última sincronização</div>
                        <div class="central-entradas-indicador-valor">+${centralEntradasState.notasNovasUltimaSync} nova(s)</div>
                    </div>
                </div>`
                : ''}
        </div>
    `;
}

function renderPainelAtencaoCentral() {
    const container = document.getElementById('centralEntradasAtencao');
    if (!container) return;

    const itens = centralEntradasState.atencao?.itens || [];
    if (!itens.length) {
        container.innerHTML = `
            <div class="central-entradas-atencao central-entradas-atencao--ok central-entradas-anim-in">
                <i class="fas fa-check-circle text-success"></i>
                <span>Nenhuma pendência crítica no momento. A Central está em dia.</span>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="central-entradas-atencao central-entradas-anim-in">
            <div class="central-entradas-atencao-titulo">
                <i class="fas fa-bell text-warning"></i> O que requer sua atenção
            </div>
            <div class="central-entradas-atencao-itens">
                ${itens.map((item, idx) => `
                    <div class="central-entradas-atencao-item" style="--item-cor:${escapeHtmlCentralEntradas(item.cor)}">
                        <i class="fas ${escapeHtmlCentralEntradas(item.icone)}"></i>
                        <span class="flex-grow-1">${escapeHtmlCentralEntradas(item.mensagem)}</span>
                        <button type="button" class="btn btn-sm btn-outline-primary central-atencao-acao"
                            data-atencao-idx="${idx}">
                            ${escapeHtmlCentralEntradas(item.acao?.label || 'Ação')}
                        </button>
                    </div>
                `).join('')}
            </div>
        </div>`;
}

function renderCardsOperacionaisCentral() {
    const container = document.getElementById('centralEntradasOperacional');
    if (!container) return;

    if (centralEntradasState.carregandoInteligencia && !centralEntradasState.operacional) {
        container.innerHTML = centralUx().renderSkeletonKpisCentral?.(6) || '';
        return;
    }

    const UX = centralUx();
    const op = centralEntradasState.operacional || {};
    const prev = UX.obterSnapshotKpisCentral?.()?.operacional || {};

    const cards = [
        { titulo: 'Valor do mês', valor: formatarMoedaCentral(op.valorTotalMes), icone: 'fa-calendar-alt', cor: '#198754', trendVal: op.valorTotalMes, trendPrev: prev.valorTotalMes },
        { titulo: 'Tempo médio processamento', valor: op.tempoMedioProcessamentoMinutos != null ? `${op.tempoMedioProcessamentoMinutos} min` : '—', icone: 'fa-stopwatch', cor: '#0d6efd', trendVal: op.tempoMedioProcessamentoMinutos, trendPrev: prev.tempoMedioProcessamentoMinutos, invertTrend: true },
        { titulo: 'Identificação automática', valor: op.taxaIdentificacaoAutomatica != null ? `${op.taxaIdentificacaoAutomatica}%` : '—', icone: 'fa-brain', cor: '#6610f2', trendVal: op.taxaIdentificacaoAutomatica, trendPrev: prev.taxaIdentificacaoAutomatica },
        { titulo: 'Revisão manual', valor: op.taxaRevisaoManual != null ? `${op.taxaRevisaoManual}%` : '—', icone: 'fa-user-check', cor: '#fd7e14', trendVal: op.taxaRevisaoManual, trendPrev: prev.taxaRevisaoManual, invertTrend: true },
        { titulo: 'Compras concluídas hoje', valor: op.comprasConcluidasHoje ?? 0, icone: 'fa-check-double', cor: '#20c997', trendVal: op.comprasConcluidasHoje, trendPrev: prev.comprasConcluidasHoje },
        { titulo: 'Pendências críticas', valor: op.pendenciasCriticas ?? 0, icone: 'fa-exclamation-circle', cor: '#dc3545', trendVal: op.pendenciasCriticas, trendPrev: prev.pendenciasCriticas, invertTrend: true }
    ];

    container.innerHTML = cards.map((card) => {
        const trend = UX.renderTendenciaKpiCentral
            ? UX.renderTendenciaKpiCentral(card.trendVal, card.trendPrev, card.invertTrend)
            : '';
        return `
        <div class="col-6 col-md-4 col-xl-2">
            <div class="central-entradas-kpi central-entradas-kpi--operacional central-entradas-anim-in"
                 style="--kpi-cor:${card.cor}; --kpi-bg:${card.cor}18"
                 title="${escapeHtmlCentralEntradas(card.titulo)}">
                <div class="central-entradas-kpi-icone"><i class="fas ${card.icone}"></i></div>
                <div class="central-entradas-kpi-corpo">
                    <div class="central-entradas-kpi-valor">${escapeHtmlCentralEntradas(card.valor)}</div>
                    <div class="central-entradas-kpi-titulo">${escapeHtmlCentralEntradas(card.titulo)}</div>
                    ${trend}
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderPainelAlertasCentral() {
    const container = document.getElementById('centralEntradasAlertas');
    if (!container) return;

    if (centralEntradasState.carregandoInteligencia && !centralEntradasState.alertas) {
        container.innerHTML = centralUx().renderSkeletonPainelBlocoCentral?.() || '';
        return;
    }

    const alertas = centralEntradasState.alertas?.alertas || [];
    if (!alertas.length) {
        container.innerHTML = centralUx().renderEmptyStateCentral?.('alertas') || '';
        return;
    }

    container.innerHTML = `
        <div class="central-entradas-alertas-lista">
            ${alertas.map((alerta) => `
                <div class="central-entradas-alerta central-entradas-alerta--${escapeHtmlCentralEntradas(alerta.gravidade)} central-entradas-anim-in"
                     style="--alerta-cor:${escapeHtmlCentralEntradas(alerta.cor)}">
                    <div class="central-entradas-alerta-icone">
                        <i class="fas ${escapeHtmlCentralEntradas(alerta.icone)}"></i>
                    </div>
                    <div class="central-entradas-alerta-corpo">
                        <div class="central-entradas-alerta-titulo">
                            ${escapeHtmlCentralEntradas(alerta.descricao)}
                            <span class="badge bg-secondary ms-1">${escapeHtmlCentralEntradas(alerta.quantidade ?? 0)}</span>
                        </div>
                        <div class="central-entradas-alerta-acao small text-muted">
                            ${escapeHtmlCentralEntradas(alerta.acaoSugerida || '')}
                        </div>
                    </div>
                    ${alerta.documentoIds?.length
                        ? `<button type="button" class="btn btn-sm btn-outline-secondary central-alerta-ver"
                               data-doc-id="${alerta.documentoIds[0]}">Ver</button>`
                        : ''}
                </div>
            `).join('')}
        </div>`;
}

function renderPainelPendenciasCentral() {
    const container = document.getElementById('centralEntradasPendenciasBody');
    if (!container) return;

    if (centralEntradasState.carregandoInteligencia && !centralEntradasState.pendencias) {
        container.innerHTML = centralUx().renderSkeletonPainelBlocoCentral?.() || '';
        return;
    }

    const secoes = centralEntradasState.pendencias?.secoes || {};
    const resumo = centralEntradasState.pendencias?.resumo || {};

    const blocos = [
        { chave: 'aguardandoRevisao', titulo: 'Aguardando revisão', icone: 'fa-user-check', cor: '#fd7e14' },
        { chave: 'comprasAbertas', titulo: 'Compras abertas', icone: 'fa-shopping-cart', cor: '#6610f2' },
        { chave: 'erros', titulo: 'Erros', icone: 'fa-exclamation-triangle', cor: '#dc3545' },
        { chave: 'xmlInvalido', titulo: 'XML inválido', icone: 'fa-file-excel', cor: '#dc3545' }
    ];

    const totalPendencias = blocos.reduce((acc, b) => acc + (resumo[b.chave] ?? 0), 0);
    const temItens = blocos.some((b) => (secoes[b.chave] || []).length > 0);

    if (!totalPendencias && !temItens) {
        container.innerHTML = centralUx().renderEmptyStateCentral?.('pendencias') || '';
        return;
    }

    container.innerHTML = `
        <div class="row g-2 mb-3">
            ${blocos.map((b) => `
                <div class="col-6 col-md-3">
                    <div class="central-entradas-pendencia-resumo" style="--pend-cor:${b.cor}">
                        <i class="fas ${b.icone}"></i>
                        <div>
                            <div class="fw-bold">${resumo[b.chave] ?? 0}</div>
                            <div class="small text-muted">${escapeHtmlCentralEntradas(b.titulo)}</div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="central-entradas-pendencias-secoes">
            ${blocos.map((b) => {
                const itens = secoes[b.chave] || [];
                if (!itens.length) return '';
                return `
                    <div class="central-entradas-pendencia-secao mb-2">
                        <div class="small fw-semibold text-muted mb-1">${escapeHtmlCentralEntradas(b.titulo)}</div>
                        ${itens.slice(0, 5).map((item) => `
                            <div class="central-entradas-pendencia-item central-pendencia-ver"
                                 data-doc-id="${item.documentoId}" role="button">
                                <span class="text-truncate">${escapeHtmlCentralEntradas(item.fornecedor || '—')}</span>
                                <span class="text-muted small">${escapeHtmlCentralEntradas(formatarMoedaCentral(item.valorTotal))}</span>
                            </div>
                        `).join('')}
                    </div>`;
            }).join('')}
        </div>`;
}

function renderFiltrosRapidosCentral() {
    const container = document.getElementById('centralEntradasFiltrosRapidos');
    if (!container) return;

    const presets = centralEntradasState.metadados?.filtrosRapidos || [
        { codigo: 'hoje', label: 'Hoje' },
        { codigo: 'ontem', label: 'Ontem' },
        { codigo: 'ultimos_7_dias', label: 'Últimos 7 dias' },
        { codigo: 'ultimos_30_dias', label: 'Últimos 30 dias' },
        { codigo: 'este_mes', label: 'Este mês' },
        { codigo: 'pendentes', label: 'Pendentes' },
        { codigo: 'prontas', label: 'Prontas' }
    ];

    container.innerHTML = presets.map((preset) => {
        const ativo = centralEntradasState.filtroRapidoAtivo === preset.codigo ? 'ativa' : '';
        return `<button type="button" class="central-entradas-filtro-rapido ${ativo}"
            data-filtro-rapido="${escapeHtmlCentralEntradas(preset.codigo)}"
            title="${escapeHtmlCentralEntradas(preset.label)}">${escapeHtmlCentralEntradas(preset.label)}</button>`;
    }).join('');
}

function renderScoreBadgeCentral(score, cor) {
    const UX = centralUx();
    if (score == null) {
        return '<span class="central-entradas-score central-entradas-score--na" title="Score indisponível" aria-label="Score indisponível">—</span>';
    }
    const corFinal = cor || UX.corScoreCentral?.(score) || '#94a3b8';
    const desc = UX.descricaoScoreCentral?.(score) || 'Score geral da nota';
    return `<span class="central-entradas-score central-entradas-score--anim" style="--score-cor:${escapeHtmlCentralEntradas(corFinal)}"
        title="${escapeHtmlCentralEntradas(desc)}" aria-label="Score ${score} por cento">${escapeHtmlCentralEntradas(score)}%</span>`;
}

async function carregarInteligenciaCentral() {
    if (centralEntradasState.promessaInteligencia) {
        return centralEntradasState.promessaInteligencia;
    }

    const jaTemOperacional = Boolean(centralEntradasState.operacional);
    centralEntradasState.carregandoInteligencia = true;
    if (!jaTemOperacional) {
        renderCardsOperacionaisCentral();
        renderPainelAlertasCentral();
        renderPainelPendenciasCentral();
    }

    const execucao = (async () => {
        try {
            const [operacional, alertas, pendencias, atencao] = await Promise.all([
                centralEntradasFetch('/operacional'),
                centralEntradasFetch('/alertas'),
                centralEntradasFetch('/pendencias?limite=20'),
                centralEntradasFetch('/atencao')
            ]);

            centralEntradasState.operacional = operacional;
            centralEntradasState.alertas = alertas;
            centralEntradasState.pendencias = pendencias;
            centralEntradasState.atencao = atencao;

            renderPainelAtencaoCentral();
            renderCardsOperacionaisCentral();
            renderPainelAlertasCentral();
            renderPainelPendenciasCentral();

            centralUx().salvarSnapshotKpisCentral?.(
                { contadores: centralEntradasState.ultimoDashboardContadores || {} },
                operacional
            );
        } catch (error) {
            console.warn('Inteligência operacional:', error.message);
        } finally {
            centralEntradasState.carregandoInteligencia = false;
            centralEntradasState.promessaInteligencia = null;
        }
    })();

    centralEntradasState.promessaInteligencia = execucao;
    return execucao;
}

function renderBannerSyncCentral() {
    const container = document.getElementById('centralEntradasBannerSync');
    if (!container) return;

    const banner = cargaCentral().montarBannerFalhaSync?.(centralEntradasState.falhaSync);
    if (!banner) {
        container.classList.add('d-none');
        container.innerHTML = '';
        return;
    }

    container.classList.remove('d-none');
    container.innerHTML = `
        <div class="alert alert-warning py-2 px-3 mb-0" role="status">
            <strong>${escapeHtmlCentralEntradas(banner.titulo)}</strong>
            ${banner.codigo ? `<span class="badge bg-warning text-dark ms-1">${escapeHtmlCentralEntradas(banner.codigo)}</span>` : ''}
            <div class="small">${escapeHtmlCentralEntradas(banner.mensagem)}</div>
        </div>`;
}

function aplicarPayloadDashboardCentral(dashboard = {}) {
    const contadores = dashboard.contadores || {};
    centralEntradasState.ultimoDashboardContadores = contadores;

    const cardsContainer = document.getElementById('centralEntradasCards');
    if (cardsContainer) {
        cardsContainer.innerHTML = renderCardsDashboardCentral(contadores);
    }

    centralEntradasState.indicadores = dashboard.indicadores || centralEntradasState.indicadores;
    centralEntradasState.ultimaSincronizacao = dashboard.ultimaSincronizacao
        || dashboard.sincronizacao?.dataSincronizacao
        || centralEntradasState.ultimaSincronizacao;
    centralEntradasState.sincronizacaoNsu = dashboard.sincronizacao || centralEntradasState.sincronizacaoNsu;
    renderIndicadoresCentral();
}

function aplicarAberturaCentral(abertura = {}) {
    if (abertura.health) {
        centralEntradasState.health = abertura.health;
    }
    if (abertura.sefazDisponivel !== undefined) {
        centralEntradasState.sefazDisponivel = abertura.sefazDisponivel;
    }
    if (abertura.ultimaSincronizacaoNsu) {
        centralEntradasState.ultimaSincronizacao = abertura.ultimaSincronizacaoNsu;
    }
    if (abertura.dashboard) {
        aplicarPayloadDashboardCentral(abertura.dashboard);
    }
    if (abertura.sefazDisponivel === false) {
        showNotification(abertura.mensagem || 'SEFAZ indisponível', 'warning');
    }
    renderPainelServicoCentral();
}

function tratarResultadoSyncAberturaCentral(sync) {
    carregarStatusServicoCentral();
    if (sync && sync.sucesso === false && !sync.ignorado) {
        centralEntradasState.sefazDisponivel = false;
        centralEntradasState.falhaSync = sync;
        const msg = sync.erro?.mensagem || sync.mensagem || 'Falha na última sincronização.';
        showNotification((sync.erro?.codigo ? `[${sync.erro.codigo}] ` : '') + msg, 'warning');
    } else if (sync && sync.sucesso !== false) {
        centralEntradasState.falhaSync = null;
        if (sync.notasNovas) {
            centralEntradasState.notasNovasUltimaSync = sync.notasNovas;
        }
        if (sync.ultimaSincronizacao) {
            centralEntradasState.ultimaSincronizacao = sync.ultimaSincronizacao;
        }
    }
    renderBannerSyncCentral();
    renderIndicadoresCentral();
}

async function carregarStatsFornecedorCentral(cnpj) {
    if (!cnpj) {
        centralEntradasState.fornecedorStats = null;
        return;
    }
    try {
        centralEntradasState.fornecedorStats = await centralEntradasFetch(
            `/fornecedor/${encodeURIComponent(String(cnpj).replace(/\D/g, ''))}/estatisticas`
        );
    } catch {
        centralEntradasState.fornecedorStats = null;
    }
}

function renderStatsFornecedorCentral() {
    const stats = centralEntradasState.fornecedorStats;
    if (!stats?.quantidadeNotas) return '';

    const ultima = stats.ultimaNota?.createdAt
        ? tempoDesdeCentral(stats.ultimaNota.createdAt) || formatarDataCentral(stats.ultimaNota.dataEmissao)
        : '—';

    return `
        <div class="central-entradas-fornecedor-stats mt-3 central-entradas-anim-in">
            <label class="central-entradas-label">Inteligência do fornecedor</label>
            <div class="row g-2 small">
                <div class="col-6"><span class="text-muted">Precisão MIIP</span><br><strong>${stats.precisaoMediaMiip != null ? stats.precisaoMediaMiip + '%' : '—'}</strong></div>
                <div class="col-6"><span class="text-muted">Notas (${stats.periodoDias}d)</span><br><strong>${stats.quantidadeNotas}</strong></div>
                <div class="col-6"><span class="text-muted">Tempo médio</span><br><strong>${stats.tempoMedioLancamentoMinutos != null ? stats.tempoMedioLancamentoMinutos + ' min' : '—'}</strong></div>
                <div class="col-6"><span class="text-muted">Pendências</span><br><strong>${stats.pendencias}</strong></div>
                <div class="col-12"><span class="text-muted">Última nota</span><br><strong>${escapeHtmlCentralEntradas(ultima)}</strong></div>
            </div>
        </div>`;
}

function executarAcaoAtencaoCentral(acao) {
    if (!acao) return;

    if (acao.tipo === 'filtrar_status') {
        mostrarViewCentral('inbox');
        const select = document.getElementById('centralFiltroStatus');
        if (select) select.value = acao.status || '';
        centralEntradasState.filtroRapidoAtivo = '';
        centralEntradasState.pagina = 1;
        renderFiltrosRapidosCentral();
        carregarDocumentosCentral();
        return;
    }

    if (acao.tipo === 'sincronizar') {
        sincronizarCentralEntradas();
        return;
    }

    if (acao.tipo === 'abrir_alerta' && acao.documentoId) {
        mostrarViewCentral('inbox');
        selecionarDocumentoCentral(Number(acao.documentoId));
    }
}

/* ============================================================
 * Sprint 8 — Automação e serviço
 * ============================================================ */

function renderPainelServicoCentral() {
    const container = document.getElementById('centralEntradasServico');
    if (!container) return;

    const UX = centralUx();
    const estado = UX.resolverEstadoServicoCentral?.(centralEntradasState) || {
        label: 'Serviço',
        descricao: '',
        icone: 'fa-circle',
        classe: ''
    };

    const s = centralEntradasState.servicoStatus || {};
    const ultima = s.ultimaExecucao;
    const proxima = s.proximaExecucao;
    const ultimo = s.ultimoResultado || {};
    const duracao = ultimo.duracaoMs != null ? `${Math.round(ultimo.duracaoMs / 1000)}s` : '—';
    const qtd = ultimo.notasNovas != null ? ultimo.notasNovas : '—';
    const executando = estado.codigo === 'sincronizando';

    container.innerHTML = `
        <div class="central-entradas-servico central-ux-servico ${estado.classe} central-entradas-anim-in ${executando ? 'central-entradas-servico--ativo' : ''}"
             role="status" aria-live="polite" aria-label="Estado do serviço: ${escapeHtmlCentralEntradas(estado.label)}">
            <div class="central-entradas-servico-status">
                <span class="central-ux-servico-icone" aria-hidden="true">
                    <i class="fas ${estado.icone}"></i>
                </span>
                <div>
                    <strong>${escapeHtmlCentralEntradas(estado.label)}</strong>
                    <div class="central-ux-servico-descricao small text-muted">${escapeHtmlCentralEntradas(estado.descricao)}</div>
                </div>
                ${executando ? '<span class="badge bg-primary ms-2 central-ux-badge-pulse">Em execução</span>' : ''}
            </div>
            <div class="central-entradas-servico-metricas">
                <div title="Data e hora da última tentativa de sincronização"><span class="label">Última tentativa</span><span>${escapeHtmlCentralEntradas(ultima ? formatarDataHoraCentral(ultima) : '—')}</span></div>
                <div title="Última DistDFe que atualizou o NSU"><span class="label">Última DistDFe (NSU)</span><span>${escapeHtmlCentralEntradas(formatarDataHoraCentral(centralEntradasState.ultimaSincronizacao) || '—')}</span></div>
                <div title="Próxima execução agendada"><span class="label">Próxima execução</span><span>${escapeHtmlCentralEntradas(proxima ? formatarDataHoraCentral(proxima) : '—')}</span></div>
                <div title="Duração da última sincronização"><span class="label">Duração última sync</span><span>${escapeHtmlCentralEntradas(duracao)}</span></div>
                <div title="Notas recebidas na última sincronização"><span class="label">Notas na última sync</span><span>${escapeHtmlCentralEntradas(qtd)}</span></div>
                <div title="Disponibilidade operacional da SEFAZ"><span class="label">SEFAZ</span><span>${escapeHtmlCentralEntradas(s.sefaz?.disponivel === false ? 'Indisponível' : 'Disponível')}</span></div>
                <div title="Último NSU conhecido"><span class="label">Último NSU</span><span>${escapeHtmlCentralEntradas(centralEntradasState.health?.ultimoNsu || dashboardNsu() || '—')}</span></div>
                <div title="Documentos aguardando XML"><span class="label">Aguardando XML</span><span>${escapeHtmlCentralEntradas(String(centralEntradasState.health?.filas?.aguardandoXml ?? centralEntradasState.ultimoDashboardContadores?.aguardandoXml ?? '—'))}</span></div>
            </div>
        </div>`;
}

async function carregarStatusServicoCentral() {
    try {
        centralEntradasState.servicoStatus = await centralEntradasFetch('/servico/status');
        renderPainelServicoCentral();
    } catch { /* ignore */ }
}

function mostrarViewCentral(view) {
    centralEntradasState.viewAtiva = view;
    const inbox = document.getElementById('centralEntradasViewInbox');
    const config = document.getElementById('centralEntradasViewConfig');
    const log = document.getElementById('centralEntradasViewLog');
    if (inbox) inbox.classList.toggle('d-none', view !== 'inbox');
    if (config) config.classList.toggle('d-none', view !== 'config');
    if (log) log.classList.toggle('d-none', view !== 'log');

    document.querySelectorAll('.central-nav-view').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    if (view === 'config') carregarConfigCentral();
    if (view === 'log') carregarLogCentral();
}

async function carregarConfigCentral() {
    const container = document.getElementById('centralConfigForm');
    if (!container) return;

    try {
        const cfg = await centralEntradasFetch('/config');
        centralEntradasState.configuracoes = cfg;
        container.innerHTML = `
            <div class="row g-3">
                <div class="col-md-6">
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="cfgSyncAutomatica" ${cfg.syncAutomaticaHabilitada ? 'checked' : ''}>
                        <label class="form-check-label" for="cfgSyncAutomatica">Sincronização automática</label>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="cfgSyncAoAbrir" ${cfg.syncAoAbrir ? 'checked' : ''}>
                        <label class="form-check-label" for="cfgSyncAoAbrir">Buscar ao abrir a Central</label>
                    </div>
                </div>
                <div class="col-md-4">
                    <label class="form-label" for="cfgIntervalo">Intervalo (minutos)</label>
                    <input type="number" class="form-control" id="cfgIntervalo" min="1" max="1440" value="${cfg.syncIntervaloMinutos || 15}">
                </div>
                <div class="col-md-4">
                    <label class="form-label" for="cfgMaxDocs">Máx. iterações por sync</label>
                    <input type="number" class="form-control" id="cfgMaxDocs" min="1" max="200" value="${cfg.syncMaxDocumentos || 50}">
                </div>
                <div class="col-md-4">
                    <div class="form-check form-switch mt-4">
                        <input class="form-check-input" type="checkbox" id="cfgNotificar" ${cfg.notificarNovasNotas !== false ? 'checked' : ''}>
                        <label class="form-check-label" for="cfgNotificar">Notificar novas notas</label>
                    </div>
                </div>
                <div class="col-md-3">
                    <label class="form-label">Horário permitido — início</label>
                    <input type="time" class="form-control" id="cfgPermInicio" value="${escapeHtmlCentralEntradas(cfg.horarioPermitidoInicio || '06:00')}">
                </div>
                <div class="col-md-3">
                    <label class="form-label">Horário permitido — fim</label>
                    <input type="time" class="form-control" id="cfgPermFim" value="${escapeHtmlCentralEntradas(cfg.horarioPermitidoFim || '23:59')}">
                </div>
                <div class="col-md-3">
                    <label class="form-label">Horário bloqueado — início</label>
                    <input type="time" class="form-control" id="cfgBloqInicio" value="${escapeHtmlCentralEntradas(cfg.horarioBloqueadoInicio || '')}">
                </div>
                <div class="col-md-3">
                    <label class="form-label">Horário bloqueado — fim</label>
                    <input type="time" class="form-control" id="cfgBloqFim" value="${escapeHtmlCentralEntradas(cfg.horarioBloqueadoFim || '')}">
                </div>
                <div class="col-12">
                    <button type="button" class="btn btn-primary" id="centralBtnSalvarConfig">
                        <i class="fas fa-save me-1"></i> Salvar configurações
                    </button>
                </div>
            </div>`;
    } catch (error) {
        container.innerHTML = `<div class="alert alert-danger">${escapeHtmlCentralEntradas(error.message)}</div>`;
    }
}

async function salvarConfigCentral() {
    const payload = {
        syncAutomaticaHabilitada: document.getElementById('cfgSyncAutomatica')?.checked ?? false,
        syncAoAbrir: document.getElementById('cfgSyncAoAbrir')?.checked ?? true,
        syncIntervaloMinutos: Number(document.getElementById('cfgIntervalo')?.value) || 15,
        syncMaxDocumentos: Number(document.getElementById('cfgMaxDocs')?.value) || 50,
        notificarNovasNotas: document.getElementById('cfgNotificar')?.checked ?? true,
        horarioPermitidoInicio: document.getElementById('cfgPermInicio')?.value || '06:00',
        horarioPermitidoFim: document.getElementById('cfgPermFim')?.value || '23:59',
        horarioBloqueadoInicio: document.getElementById('cfgBloqInicio')?.value || '',
        horarioBloqueadoFim: document.getElementById('cfgBloqFim')?.value || ''
    };

    try {
        centralEntradasState.configuracoes = await centralEntradasFetch('/config', {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
        showNotification('Configurações salvas. Serviço de sync reiniciado.', 'success');
        await carregarStatusServicoCentral();
    } catch (error) {
        showNotification('Erro ao salvar: ' + error.message, 'danger');
    }
}

async function carregarLogCentral() {
    const tbody = document.getElementById('centralLogBody');
    if (!tbody) return;

    const busca = document.getElementById('centralLogBusca')?.value?.trim() || '';
    const tipo = document.getElementById('centralLogTipo')?.value || '';

    try {
        const resultado = await centralEntradasFetch(`/eventos?limite=50${tipo ? `&tipo=${encodeURIComponent(tipo)}` : ''}${busca ? `&busca=${encodeURIComponent(busca)}` : ''}`);
        centralEntradasState.eventosLog = resultado.eventos || [];
        centralEntradasState.eventosTotal = resultado.total || 0;

        if (!centralEntradasState.eventosLog.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Nenhum evento registrado.</td></tr>';
            return;
        }

        tbody.innerHTML = centralEntradasState.eventosLog.map((ev) => `
            <tr>
                <td class="small">${escapeHtmlCentralEntradas(formatarDataHoraCentral(ev.createdAt))}</td>
                <td><span class="badge bg-secondary">${escapeHtmlCentralEntradas(ev.tipo)}</span></td>
                <td class="small">${escapeHtmlCentralEntradas(ev.origem || '—')}</td>
                <td>${escapeHtmlCentralEntradas(ev.descricao || '—')}</td>
                <td class="small">${ev.duracaoMs != null ? ev.duracaoMs + ' ms' : '—'}</td>
                <td>${ev.sucesso === true ? '<span class="text-success">OK</span>' : (ev.sucesso === false ? '<span class="text-danger">Erro</span>' : '—')}</td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-danger">${escapeHtmlCentralEntradas(error.message)}</td></tr>`;
    }
}

async function pollNotificacoesCentral() {
    if (!document.getElementById('centralEntradasServico')) return;

    try {
        const { notificacoes } = await centralEntradasFetch('/notificacoes?apenas_nao_lidas=true&limite=10');
        (notificacoes || []).forEach((n) => {
            if (centralEntradasState.notificacoesVistas.has(n.id)) return;
            centralEntradasState.notificacoesVistas.add(n.id);
            const tipo = n.tipo === 'SYNC_ERRO' || n.tipo === 'ERRO' ? 'danger'
                : (n.tipo === 'NOVAS_NOTAS' ? 'success' : 'info');
            showNotification(n.titulo + (n.mensagem ? ': ' + n.mensagem : ''), tipo);
            centralEntradasFetch(`/notificacoes/${n.id}/lida`, { method: 'PATCH' }).catch(() => {});
        });
    } catch { /* ignore */ }
}

function iniciarAutomacaoCentral() {
    if (centralEntradasState.tickerServico) clearInterval(centralEntradasState.tickerServico);
    if (centralEntradasState.tickerNotificacoes) clearInterval(centralEntradasState.tickerNotificacoes);

    carregarStatusServicoCentral();
    pollNotificacoesCentral();

    centralEntradasState.tickerServico = setInterval(() => {
        if (document.getElementById('centralEntradasServico')) {
            carregarStatusServicoCentral();
        } else {
            clearInterval(centralEntradasState.tickerServico);
            centralEntradasState.tickerServico = null;
        }
    }, 30000);

    centralEntradasState.tickerNotificacoes = setInterval(() => {
        if (document.getElementById('centralEntradasServico')) {
            pollNotificacoesCentral();
        } else {
            clearInterval(centralEntradasState.tickerNotificacoes);
            centralEntradasState.tickerNotificacoes = null;
        }
    }, 45000);
}

function iniciarTickerSincronizacao() {
    if (centralEntradasState.tickerSync) clearInterval(centralEntradasState.tickerSync);
    centralEntradasState.tickerSync = setInterval(() => {
        if (document.getElementById('centralEntradasIndicadores')) {
            renderIndicadoresCentral();
        } else {
            clearInterval(centralEntradasState.tickerSync);
            centralEntradasState.tickerSync = null;
        }
    }, 60000);
}

/* ============================================================
 * Grid
 * ============================================================ */

function montarOptionsStatusCentral(statusSelecionado) {
    const estados = centralEntradasState.metadados?.estados || [];
    const options = ['<option value="">Todos</option>'];
    estados.forEach((estado) => {
        const selected = statusSelecionado === estado.codigo ? 'selected' : '';
        options.push(`<option value="${escapeHtmlCentralEntradas(estado.codigo)}" ${selected}>${escapeHtmlCentralEntradas(estado.label)}</option>`);
    });
    return options.join('');
}

function obterFiltrosCentralDaTela() {
    return {
        busca: document.getElementById('centralFiltroBusca')?.value?.trim() || '',
        status: document.getElementById('centralFiltroStatus')?.value || '',
        origem: document.getElementById('centralFiltroOrigem')?.value || '',
        dataEmissaoInicio: document.getElementById('centralFiltroDataInicio')?.value || '',
        dataEmissaoFim: document.getElementById('centralFiltroDataFim')?.value || '',
        filtroRapido: centralEntradasState.filtroRapidoAtivo || ''
    };
}

function renderGridCentralEntradas() {
    const tbody = document.getElementById('centralEntradasGridBody');
    const contador = document.getElementById('centralEntradasContador');
    if (!tbody) return;

    const Carga = cargaCentral();
    const mostrarSkeleton = Carga.deveMostrarSkeletonDocumentos
        ? Carga.deveMostrarSkeletonDocumentos({
            carregando: centralEntradasState.carregando,
            quantidadeDocumentos: (centralEntradasState.documentos || []).length,
            erro: centralEntradasState.erroDocumentos
        })
        : (centralEntradasState.carregando && !(centralEntradasState.documentos || []).length);

    if (mostrarSkeleton) {
        tbody.innerHTML = centralUx().renderSkeletonGridCentral?.(8) || '';
        if (contador) contador.textContent = 'Carregando...';
        return;
    }

    if (centralEntradasState.erroDocumentos && !(centralEntradasState.documentos || []).length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-4 border-0">
                    <div class="text-center py-4" role="alert">
                        <div class="text-danger mb-2">
                            ${escapeHtmlCentralEntradas(centralEntradasState.erroDocumentos.mensagem)}
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-primary" id="centralBtnRetryDocumentos">
                            Tentar novamente
                        </button>
                    </div>
                </td>
            </tr>
        `;
        if (contador) contador.textContent = 'Erro ao carregar';
        return;
    }

    const filtros = obterFiltrosCentralDaTela();
    const temFiltro = !!(filtros.busca || filtros.status || filtros.origem
        || filtros.dataEmissaoInicio || filtros.dataEmissaoFim || filtros.filtroRapido);

    if (!centralEntradasState.documentos.length) {
        const emptyTipo = temFiltro ? 'pesquisa' : 'documentos';
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-0 border-0">
                    ${centralUx().renderEmptyStateCentral?.(emptyTipo) || ''}
                </td>
            </tr>
        `;
    } else {
        tbody.innerHTML = centralEntradasState.documentos.map((doc) => {
            const meta = metaStatusCentral(doc.status);
            const selecionado = centralEntradasState.documentoSelecionadoId === doc.id ? 'central-entradas-row-selected' : '';
            const numero = doc.numero ? `${doc.numero}${doc.serie ? '/' + doc.serie : ''}` : '—';
            const miipBadge = doc.miipDisponivel
                ? '<span class="central-entradas-badge-miip" title="Processado pelo MIIP"><i class="fas fa-brain"></i> MIIP</span>'
                : '';

            return `
                <tr class="central-entradas-row ${selecionado}" data-documento-id="${doc.id}"
                    style="--row-cor:${meta.cor}"
                    tabindex="0"
                    role="button"
                    aria-label="Documento ${escapeHtmlCentralEntradas(doc.fornecedor || 'sem fornecedor')}, ${escapeHtmlCentralEntradas(numero)}">
                    <td class="central-entradas-cell-status">
                        <span class="central-entradas-status-dot" style="background:${meta.bg}; color:${meta.cor}"
                              title="${escapeHtmlCentralEntradas(meta.descricao)}">
                            <i class="fas ${meta.icone}"></i>
                        </span>
                    </td>
                    <td>
                        <div class="central-entradas-fornecedor">${escapeHtmlCentralEntradas(doc.fornecedor || '—')}</div>
                        <small class="text-muted">${escapeHtmlCentralEntradas(doc.cnpjFornecedor || '')}</small>
                    </td>
                    <td>
                        <div class="fw-semibold">${escapeHtmlCentralEntradas(numero)}</div>
                        <small class="text-muted"><i class="fas ${iconeOrigemCentral(doc.origem)} me-1"></i>${escapeHtmlCentralEntradas(labelOrigemCentral(doc.origem))}</small>
                    </td>
                    <td>${escapeHtmlCentralEntradas(formatarDataCentral(doc.dataEmissao))}</td>
                    <td class="fw-semibold">${escapeHtmlCentralEntradas(formatarMoedaCentral(doc.valorTotal))}</td>
                    <td>${renderScoreBadgeCentral(doc.scoreGeral, doc.scoreCor)}</td>
                    <td>
                        ${renderBadgeStatusCentral(doc.status, doc.statusLabel)}
                        ${miipBadge}
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (contador) {
        contador.textContent = `${centralEntradasState.total} documento${centralEntradasState.total === 1 ? '' : 's'}`;
    }

    renderPaginacaoCentral();
}

function renderPaginacaoCentral() {
    const container = document.getElementById('centralEntradasPaginacao');
    if (!container) return;

    const { pagina, totalPaginas, total } = centralEntradasState;
    if (total <= 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="d-flex justify-content-between align-items-center px-3 py-2 border-top">
            <small class="text-muted">
                Página ${pagina} de ${totalPaginas}
            </small>
            <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-outline-secondary" id="centralPaginaAnterior"
                    ${pagina <= 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i> Anterior
                </button>
                <button type="button" class="btn btn-outline-secondary" id="centralPaginaProxima"
                    ${pagina >= totalPaginas ? 'disabled' : ''}>
                    Próxima <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        </div>
    `;
}

/* ============================================================
 * Painel lateral — abas
 * ============================================================ */

function dashboardNsu() {
    return centralEntradasState.sincronizacaoNsu?.ultNsu || '';
}

function renderPainelLateralPlaceholder() {
    const painel = document.getElementById('centralEntradasPainelLateral');
    if (!painel) return;

    painel.innerHTML = `
        <div class="card h-100 central-entradas-painel-card">
            <div class="card-header">
                <i class="fas fa-file-invoice me-2"></i> Detalhe do documento
            </div>
            <div class="card-body d-flex flex-column justify-content-center">
                ${centralUx().renderEmptyStateCentral?.('selecao') || ''}
            </div>
        </div>
    `;
}

const CENTRAL_TIMELINE_ICONES = {
    RECEBIDA: { icone: 'fa-envelope', cor: '#94a3b8' },
    AGUARDANDO_XML: { icone: 'fa-hourglass-half', cor: '#64748b' },
    XML_RECUPERANDO: { icone: 'fa-sync', cor: '#475569' },
    ERRO_RECUPERACAO: { icone: 'fa-unlink', cor: '#dc3545' },
    SINCRONIZADA: { icone: 'fa-cloud-download-alt', cor: '#0d6efd' },
    EM_PROCESSAMENTO: { icone: 'fa-cog', cor: '#f59e0b' },
    AGUARDANDO_REVISAO: { icone: 'fa-user-check', cor: '#fd7e14' },
    REVISADA: { icone: 'fa-clipboard-check', cor: '#0dcaf0' },
    PRONTA_PARA_COMPRA: { icone: 'fa-check-circle', cor: '#198754' },
    EM_COMPRA: { icone: 'fa-shopping-cart', cor: '#6610f2' },
    GRAVADA: { icone: 'fa-archive', cor: '#6c757d' },
    DUPLICADA: { icone: 'fa-copy', cor: '#dc3545' },
    ERRO: { icone: 'fa-exclamation-triangle', cor: '#dc3545' },
    DESCARTADA: { icone: 'fa-trash-alt', cor: '#212529' }
};

function renderTimelineCentral(historico) {
    const UX = centralUx();

    if (!historico || !historico.length) {
        return UX.renderEmptyStateCentral?.('historico') || '<p class="text-muted small mb-0">Nenhum evento registrado.</p>';
    }

    return `
        <div class="central-entradas-timeline-enterprise" role="list" aria-label="Histórico do documento">
            ${historico.map((item) => {
                const meta = CENTRAL_TIMELINE_ICONES[item.statusNovo] || { icone: 'fa-circle', cor: '#94a3b8' };
                const dt = UX.formatarDataHoraSeparadoCentral?.(item.createdAt) || { data: '—', hora: '—' };
                const origem = UX.inferirOrigemTimelineCentral?.(item) || 'Sistema';
                const usuario = item.usuarioId ? `Usuário #${item.usuarioId}` : 'Sistema automático';
                const descricao = item.detalhe
                    || (item.statusAnteriorLabel
                        ? `Transição de ${item.statusAnteriorLabel} para ${item.statusNovoLabel || item.statusNovo}`
                        : `Status definido como ${item.statusNovoLabel || item.statusNovo}`);

                return `
                <div class="central-entradas-timeline-enterprise-item central-entradas-anim-in" role="listitem"
                     style="--tl-cor:${meta.cor}">
                    <div class="central-entradas-timeline-enterprise-marker" aria-hidden="true">
                        <span class="central-entradas-timeline-enterprise-icone" style="background:${meta.cor}1a; color:${meta.cor}">
                            <i class="fas ${meta.icone}"></i>
                        </span>
                    </div>
                    <div class="central-entradas-timeline-enterprise-card">
                        <div class="central-entradas-timeline-enterprise-top">
                            <strong class="central-entradas-timeline-enterprise-status">
                                ${item.statusAnteriorLabel
                                    ? `<span class="text-muted">${escapeHtmlCentralEntradas(item.statusAnteriorLabel)}</span>
                                       <i class="fas fa-arrow-right mx-1 small text-muted" aria-hidden="true"></i>`
                                    : ''}
                                ${escapeHtmlCentralEntradas(item.statusNovoLabel || item.statusNovo)}
                            </strong>
                            <div class="central-entradas-timeline-enterprise-datahora" title="${escapeHtmlCentralEntradas(formatarDataHoraCentral(item.createdAt))}">
                                <span class="central-entradas-timeline-enterprise-data">${escapeHtmlCentralEntradas(dt.data)}</span>
                                <span class="central-entradas-timeline-enterprise-hora">${escapeHtmlCentralEntradas(dt.hora)}</span>
                            </div>
                        </div>
                        <div class="central-entradas-timeline-enterprise-descricao">${escapeHtmlCentralEntradas(descricao)}</div>
                        <div class="central-entradas-timeline-enterprise-meta">
                            <span title="Usuário responsável"><i class="far fa-user me-1" aria-hidden="true"></i>${escapeHtmlCentralEntradas(usuario)}</span>
                            <span title="Origem do evento"><i class="fas fa-route me-1" aria-hidden="true"></i>${escapeHtmlCentralEntradas(origem)}</span>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>
    `;
}

function renderAcoesPipelineCentral(doc) {
    const processando = centralEntradasState.processando;
    const etapa = centralEntradasState.etapaProcessamento;

    const etapasPadrao = [
        { codigo: 'localizar', label: 'Localizar documento' },
        { codigo: 'parse', label: 'Parser NF-e' },
        { codigo: 'miip', label: 'Identificação MIIP' },
        { codigo: 'persistir', label: 'Persistir resultados' },
        { codigo: 'status', label: 'Atualizar status' }
    ];

    const progressoHtml = processando || etapa
        ? `<div class="central-entradas-pipeline-progress mb-2">
            ${etapasPadrao.map((e) => {
                const ativa = etapa === e.codigo;
                const concluida = etapa === 'concluido' || (etapa && etapasPadrao.findIndex((x) => x.codigo === etapa) > etapasPadrao.findIndex((x) => x.codigo === e.codigo));
                return `<div class="central-entradas-pipeline-step ${ativa ? 'ativa' : ''} ${concluida ? 'concluida' : ''}">
                    <i class="fas ${concluida ? 'fa-check-circle' : ativa ? 'fa-spinner fa-spin' : 'fa-circle'} me-1"></i>
                    ${escapeHtmlCentralEntradas(e.label)}
                </div>`;
            }).join('')}
           </div>`
        : '';

    const podeProcessar = doc.status === 'SINCRONIZADA' && !processando;
    const podeRecuperarXml = ['AGUARDANDO_XML', 'ERRO_RECUPERACAO'].includes(doc.status) && !processando;
    const podeReprocessar = ['ERRO', 'AGUARDANDO_REVISAO', 'REVISADA', 'PRONTA_PARA_COMPRA'].includes(doc.status) && !processando;
    const podeAbrirCompra = ['PRONTA_PARA_COMPRA', 'EM_COMPRA', 'REVISADA'].includes(doc.status) && doc.parseDisponivel;
    const aguardandoRevisao = doc.status === 'AGUARDANDO_REVISAO';

    let acoesHtml = '';
    if (podeProcessar) {
        acoesHtml += `<button type="button" class="btn btn-primary btn-sm w-100 mb-2" id="centralBtnProcessar" data-doc-id="${doc.id}">
            <i class="fas fa-cogs me-1"></i> Processar documento
        </button>`;
    }
    if (podeRecuperarXml) {
        acoesHtml += `<button type="button" class="btn btn-outline-secondary btn-sm w-100 mb-2" id="centralBtnRecuperarXml" data-doc-id="${doc.id}">
            <i class="fas fa-download me-1"></i> Recuperar XML
        </button>`;
    }
    if (podeReprocessar) {
        acoesHtml += `<button type="button" class="btn btn-outline-primary btn-sm w-100 mb-2" id="centralBtnReprocessar" data-doc-id="${doc.id}">
            <i class="fas fa-redo me-1"></i> Reprocessar
        </button>`;
    }
    if (aguardandoRevisao && typeof MiipCentralRevisao !== 'undefined') {
        acoesHtml += `<button type="button" class="btn btn-warning btn-sm w-100 mb-2" id="centralBtnRevisarMiip" data-doc-id="${doc.id}">
            <i class="fas fa-search me-1"></i> Abrir Central de Revisão
        </button>`;
    }
    if (podeAbrirCompra) {
        acoesHtml += `<button type="button" class="btn btn-success btn-sm w-100 mb-2" id="centralBtnAbrirCompra" data-doc-id="${doc.id}">
            <i class="fas fa-shopping-cart me-1"></i> Abrir em Compras
        </button>`;
    }

    return progressoHtml + (acoesHtml || '');
}

function renderAbaResumoCentral(doc) {
    const UX = centralUx();
    const meta = metaStatusCentral(doc.status);
    const detalhe = centralEntradasState.detalheAtual;
    const exec = UX.extrairDadosExecutivoCentral?.(
        doc,
        centralEntradasState.parseAtual,
        centralEntradasState.parseAtual,
        detalhe?.historico
    ) || {};

    const gaugeHtml = UX.renderGaugeScoreCentral
        ? `<div class="text-center mb-3">${UX.renderGaugeScoreCentral(doc.scoreGeral, doc.scoreCor, { tamanho: 108 })}</div>`
        : '';

    return `
        ${gaugeHtml}

        <div class="central-entradas-resumo-executivo mb-3 central-entradas-anim-in"
             style="border-left-color:${meta.cor}; background:${meta.bg}">
            <div class="d-flex align-items-center gap-2 mb-1">
                <i class="fas ${meta.icone}" style="color:${meta.cor}" aria-hidden="true"></i>
                <strong>${escapeHtmlCentralEntradas(obterLabelStatusCentral(doc.status))}</strong>
            </div>
            <div class="small text-muted">${escapeHtmlCentralEntradas(meta.descricao)}</div>
        </div>

        <div class="central-entradas-painel-executivo mb-3">
            <label class="central-entradas-label">Painel executivo</label>
            <div class="row g-2 central-entradas-exec-grid">
                <div class="col-6">
                    <div class="central-entradas-exec-item" title="Fornecedor emissor da NF-e">
                        <i class="fas fa-building" aria-hidden="true"></i>
                        <div>
                            <span class="central-entradas-exec-label">Fornecedor</span>
                            <span class="central-entradas-exec-valor">${escapeHtmlCentralEntradas(exec.fornecedor)}</span>
                            <small class="text-muted">${escapeHtmlCentralEntradas(exec.cnpjFornecedor)}</small>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="central-entradas-exec-item" title="Transporte / frete na nota">
                        <i class="fas fa-truck" aria-hidden="true"></i>
                        <div>
                            <span class="central-entradas-exec-label">Transportadora</span>
                            <span class="central-entradas-exec-valor">${escapeHtmlCentralEntradas(exec.transportadora)}</span>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="central-entradas-exec-item" title="Volumes e unidades">
                        <i class="fas fa-boxes" aria-hidden="true"></i>
                        <div>
                            <span class="central-entradas-exec-label">Volumes</span>
                            <span class="central-entradas-exec-valor">${escapeHtmlCentralEntradas(exec.volumes)}</span>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="central-entradas-exec-item" title="Peso bruto (quando disponível no XML)">
                        <i class="fas fa-weight-hanging" aria-hidden="true"></i>
                        <div>
                            <span class="central-entradas-exec-label">Peso</span>
                            <span class="central-entradas-exec-valor">${escapeHtmlCentralEntradas(exec.peso)}</span>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="central-entradas-exec-item" title="Condição de pagamento">
                        <i class="fas fa-credit-card" aria-hidden="true"></i>
                        <div>
                            <span class="central-entradas-exec-label">Pagamento</span>
                            <span class="central-entradas-exec-valor text-truncate d-block">${escapeHtmlCentralEntradas(exec.pagamento)}</span>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="central-entradas-exec-item" title="Valor total da nota">
                        <i class="fas fa-coins" aria-hidden="true"></i>
                        <div>
                            <span class="central-entradas-exec-label">Valor total</span>
                            <span class="central-entradas-exec-valor text-success fw-semibold">${escapeHtmlCentralEntradas(formatarMoedaCentral(exec.valorTotal ?? doc.valorTotal))}</span>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="central-entradas-exec-item" title="Quantidade de itens">
                        <i class="fas fa-list-ol" aria-hidden="true"></i>
                        <div>
                            <span class="central-entradas-exec-label">Itens</span>
                            <span class="central-entradas-exec-valor">${escapeHtmlCentralEntradas(exec.qtdItens)}</span>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="central-entradas-exec-item" title="Precisão da identificação MIIP">
                        <i class="fas fa-brain" aria-hidden="true"></i>
                        <div>
                            <span class="central-entradas-exec-label">Precisão MIIP</span>
                            <span class="central-entradas-exec-valor">${escapeHtmlCentralEntradas(exec.precisaoMiip)}</span>
                        </div>
                    </div>
                </div>
                <div class="col-12">
                    <div class="central-entradas-exec-item" title="Tempo entre início e conclusão do processamento">
                        <i class="fas fa-stopwatch" aria-hidden="true"></i>
                        <div>
                            <span class="central-entradas-exec-label">Tempo de processamento</span>
                            <span class="central-entradas-exec-valor">${escapeHtmlCentralEntradas(exec.tempoProcessamento)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row g-2 mb-3">
            <div class="col-6">
                <label class="central-entradas-label">Número / Série</label>
                <div>${escapeHtmlCentralEntradas(doc.numero || '—')}${doc.serie ? '/' + escapeHtmlCentralEntradas(doc.serie) : ''}</div>
            </div>
            <div class="col-6">
                <label class="central-entradas-label">Emissão</label>
                <div>${escapeHtmlCentralEntradas(formatarDataCentral(doc.dataEmissao))}</div>
            </div>
        </div>

        <div class="mb-3">
            <label class="central-entradas-label">Origem</label>
            <div><i class="fas ${iconeOrigemCentral(doc.origem)} me-1 text-muted" aria-hidden="true"></i>${escapeHtmlCentralEntradas(labelOrigemCentral(doc.origem))}</div>
        </div>

        <div class="mb-3">
            <label class="central-entradas-label">Chave de acesso</label>
            <div class="central-entradas-chave">${escapeHtmlCentralEntradas(doc.chave || '—')}</div>
        </div>

        <div class="central-entradas-divider"></div>
        <label class="central-entradas-label">Ações do pipeline</label>
        ${renderAcoesPipelineCentral(doc) || '<div class="text-muted small">Nenhuma ação disponível para este status.</div>'}
        ${renderStatsFornecedorCentral()}
    `;
}

function renderAbaItensCentral() {
    const parse = centralEntradasState.parseAtual?.parse;
    if (!parse) {
        return '<div class="text-muted small py-3 text-center"><i class="fas fa-hourglass-half me-1"></i> Documento ainda não processado.<br>Os itens ficam disponíveis após o processamento.</div>';
    }

    const itens = parse.itens || [];
    if (!itens.length) {
        return '<div class="text-muted small py-3 text-center">Nenhum item no parse.</div>';
    }

    return `
        <div class="central-entradas-itens-lista">
            ${itens.map((item, i) => `
                <div class="central-entradas-item-card central-entradas-anim-in">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="central-entradas-item-nome">
                            <span class="central-entradas-item-indice">${i + 1}</span>
                            ${escapeHtmlCentralEntradas(item.produto_nome || '—')}
                        </div>
                        ${item.produto_id
                            ? '<span class="central-entradas-badge-vinculado" title="Produto identificado"><i class="fas fa-link"></i></span>'
                            : '<span class="central-entradas-badge-pendente" title="Produto não identificado"><i class="fas fa-question"></i></span>'}
                    </div>
                    <div class="central-entradas-item-meta">
                        ${item.codigo_barras ? `<span><i class="fas fa-barcode me-1"></i>${escapeHtmlCentralEntradas(item.codigo_barras)}</span>` : ''}
                        <span>${escapeHtmlCentralEntradas(item.quantidade || 0)} ${escapeHtmlCentralEntradas(item.unidade || 'UN')}</span>
                        <span>${escapeHtmlCentralEntradas(formatarMoedaCentral(item.preco_unitario))}</span>
                        <span class="fw-semibold">${escapeHtmlCentralEntradas(formatarMoedaCentral(item.subtotal))}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderAbaMiipCentral(doc) {
    const miip = centralEntradasState.parseAtual?.miipResumo;

    if (!doc.parseDisponivel) {
        return '<div class="text-muted small py-3 text-center"><i class="fas fa-brain me-1"></i> O MIIP é executado durante o processamento do documento.</div>';
    }

    if (!miip?.resumo) {
        return '<div class="text-muted small py-3 text-center"><i class="fas fa-info-circle me-1"></i> Parse concluído sem dados MIIP (motor indisponível no momento do processamento).</div>';
    }

    const r = miip.resumo;
    const kpis = [
        { label: 'Itens na nota', valor: r.totalItens ?? 0, icone: 'fa-list', cor: '#0d6efd' },
        { label: 'Identificados automaticamente', valor: r.identificadosAutomaticamente ?? 0, icone: 'fa-magic', cor: '#198754' },
        { label: 'Precisam de confirmação', valor: r.precisamConfirmacao ?? 0, icone: 'fa-user-check', cor: '#fd7e14' },
        { label: 'Precisam de cadastro', valor: r.precisamCadastro ?? 0, icone: 'fa-plus-circle', cor: '#dc3545' }
    ];

    const precisao = r.totalItens > 0
        ? Math.round(((r.identificadosAutomaticamente || 0) / r.totalItens) * 100)
        : 0;

    return `
        <div class="central-entradas-miip-precisao mb-3 central-entradas-anim-in">
            <div class="d-flex justify-content-between small mb-1">
                <span><i class="fas fa-brain me-1 text-primary"></i> Identificação automática</span>
                <strong>${precisao}%</strong>
            </div>
            <div class="progress" style="height:8px">
                <div class="progress-bar bg-primary" style="width:${precisao}%"></div>
            </div>
        </div>
        <div class="central-entradas-miip-kpis">
            ${kpis.map((k) => `
                <div class="central-entradas-miip-kpi central-entradas-anim-in" style="--miip-cor:${k.cor}">
                    <i class="fas ${k.icone}"></i>
                    <div class="central-entradas-miip-kpi-valor">${escapeHtmlCentralEntradas(k.valor)}</div>
                    <div class="central-entradas-miip-kpi-label">${escapeHtmlCentralEntradas(k.label)}</div>
                </div>
            `).join('')}
        </div>
        ${miip.operacaoId ? `<div class="small text-muted mt-2"><i class="fas fa-fingerprint me-1"></i>Sessão: ${escapeHtmlCentralEntradas(miip.operacaoId)}</div>` : ''}
    `;
}

function renderAbaXmlCentral(doc) {
    if (!doc.xmlDisponivel) {
        return '<div class="text-muted small py-3 text-center">XML indisponível para este documento.</div>';
    }

    if (centralEntradasState.xmlAtual === null) {
        return `
            <div class="text-center py-3">
                <button type="button" class="btn btn-outline-primary btn-sm" id="centralBtnCarregarXml" data-doc-id="${doc.id}">
                    <i class="fas fa-code me-1"></i> Carregar XML original
                </button>
            </div>
        `;
    }

    return `
        <div class="d-flex justify-content-end mb-2">
            <button type="button" class="btn btn-outline-secondary btn-sm" id="centralBtnExportarXmlPainel" data-doc-id="${doc.id}">
                <i class="fas fa-download me-1"></i> Baixar XML
            </button>
        </div>
        <pre class="central-entradas-xml-viewer">${escapeHtmlCentralEntradas(centralEntradasState.xmlAtual)}</pre>
    `;
}

function renderAbaCompraCentral(doc) {
    if (doc.compraVinculada) {
        return `
            <div class="central-entradas-compra-ok central-entradas-anim-in">
                <i class="fas fa-check-circle"></i>
                <div>
                    <strong>Compra concluída</strong>
                    <div class="small text-muted">Documento vinculado à compra <strong>#${escapeHtmlCentralEntradas(doc.compraId)}</strong>.</div>
                    <div class="small text-muted">Estoque e financeiro atualizados pela tela de Compras.</div>
                </div>
            </div>
        `;
    }

    const podeAbrir = ['PRONTA_PARA_COMPRA', 'EM_COMPRA', 'REVISADA'].includes(doc.status) && doc.parseDisponivel;

    return `
        <div class="text-muted small mb-3">
            O lançamento é feito na tela oficial de Compras, com o formulário pré-preenchido.
            O usuário pode ajustar produtos, valores, pagamento e fornecedor antes de salvar.
        </div>
        ${podeAbrir
            ? `<button type="button" class="btn btn-success btn-sm w-100" id="centralBtnAbrirCompra" data-doc-id="${doc.id}">
                <i class="fas fa-shopping-cart me-1"></i> Abrir em Compras
            </button>`
            : `<div class="alert alert-light small py-2 mb-0"><i class="fas fa-lock me-1"></i>Disponível quando o documento estiver pronto para compra.</div>`}
    `;
}

function renderConteudoAbaCentral(detalhe) {
    const doc = detalhe.documento;
    switch (centralEntradasState.abaAtiva) {
        case 'itens': return renderAbaItensCentral();
        case 'miip': return renderAbaMiipCentral(doc);
        case 'xml': return renderAbaXmlCentral(doc);
        case 'historico': return renderTimelineCentral(detalhe.historico);
        case 'compra': return renderAbaCompraCentral(doc);
        default: return renderAbaResumoCentral(doc);
    }
}

function renderPainelLateralCentral(detalhe) {
    const painel = document.getElementById('centralEntradasPainelLateral');
    if (!painel || !detalhe?.documento) return;

    const doc = detalhe.documento;
    const abas = [
        { id: 'resumo', label: 'Resumo', icone: 'fa-file-invoice' },
        { id: 'itens', label: 'Itens', icone: 'fa-list' },
        { id: 'miip', label: 'MIIP', icone: 'fa-brain' },
        { id: 'xml', label: 'XML', icone: 'fa-code' },
        { id: 'historico', label: 'Histórico', icone: 'fa-history' },
        { id: 'compra', label: 'Compra', icone: 'fa-shopping-cart' }
    ];

    painel.innerHTML = `
        <div class="card h-100 central-entradas-painel-card central-entradas-anim-in">
            <div class="card-header d-flex justify-content-between align-items-center">
                <span class="text-truncate"><i class="fas fa-file-invoice me-2"></i> NF ${escapeHtmlCentralEntradas(doc.numero || '—')}</span>
                ${renderBadgeStatusCentral(doc.status, doc.statusLabel)}
            </div>
            <div class="central-entradas-abas" role="tablist" aria-label="Detalhes do documento">
                ${abas.map((aba) => `
                    <button type="button"
                        class="central-entradas-aba ${centralEntradasState.abaAtiva === aba.id ? 'ativa' : ''}"
                        data-aba="${aba.id}"
                        role="tab"
                        aria-selected="${centralEntradasState.abaAtiva === aba.id ? 'true' : 'false'}"
                        title="${escapeHtmlCentralEntradas(aba.label)}">
                        <i class="fas ${aba.icone}" aria-hidden="true"></i>
                        <span>${escapeHtmlCentralEntradas(aba.label)}</span>
                    </button>
                `).join('')}
            </div>
            <div class="card-body central-entradas-painel-body" role="tabpanel">
                ${renderConteudoAbaCentral(detalhe)}
            </div>
        </div>
    `;
}

/* ============================================================
 * Ações — sincronização, processamento, revisão, compra
 * ============================================================ */

async function carregarDashboardCentral(opcoes = {}) {
    return guardaDashboardCentral.executar(() => carregarDashboardCentralInterno(opcoes));
}

async function carregarDashboardCentralInterno(opcoes = {}) {
    const {
        dashboardPronto = null,
        buscarHealth = true,
        buscarInteligencia = true
    } = opcoes;

    const jaTemDados = Boolean(centralEntradasState.ultimoDashboardContadores);
    const mostrarSkeleton = cargaCentral().deveMostrarSkeletonKpis
        ? cargaCentral().deveMostrarSkeletonKpis({ jaTemDados, forcarSkeleton: opcoes.forcarSkeleton })
        : !jaTemDados;

    const cardsContainer = document.getElementById('centralEntradasCards');
    const indicadoresContainer = document.getElementById('centralEntradasIndicadores');

    centralEntradasState.carregandoDashboard = true;
    if (mostrarSkeleton) {
        if (cardsContainer) {
            cardsContainer.innerHTML = centralUx().renderSkeletonKpisCentral?.(7) || '';
        }
        if (indicadoresContainer && !centralEntradasState.indicadores) {
            indicadoresContainer.innerHTML = centralUx().renderSkeletonIndicadoresCentral?.() || '';
        }
    }

    try {
        const dashboard = dashboardPronto || await centralEntradasFetch('/dashboard');
        aplicarPayloadDashboardCentral(dashboard);

        if (buscarHealth) {
            centralEntradasFetch('/health')
                .then((health) => {
                    centralEntradasState.health = health;
                    renderPainelServicoCentral();
                    renderIndicadoresCentral();
                })
                .catch(() => null);
        }

        if (buscarInteligencia) {
            carregarInteligenciaCentral();
        }
        return dashboard;
    } catch (error) {
        if (cardsContainer && !jaTemDados) {
            cardsContainer.innerHTML = '<div class="col-12 text-danger small">Erro ao carregar dashboard.</div>';
        }
        throw error;
    } finally {
        centralEntradasState.carregandoDashboard = false;
    }
}

async function atualizarDashboardAposSyncCentral(sync) {
    if (cargaCentral().temContadoresValidos?.(sync?.dashboard?.contadores)) {
        aplicarPayloadDashboardCentral(sync.dashboard);
        carregarInteligenciaCentral();
        return;
    }
    await carregarDashboardCentral({ buscarInteligencia: true, buscarHealth: true });
}

function atualizarIndicadorSyncBotao() {
    const btn = document.getElementById('centralBtnSincronizar');
    if (!btn) return;

    if (centralEntradasState.sincronizando) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Sincronizando...';
    } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sync-alt"></i> Sincronizar SEFAZ';
    }
}

async function sincronizarCentralEntradas() {
    if (centralEntradasState.sincronizando) return;

    centralEntradasState.sincronizando = true;
    atualizarIndicadorSyncBotao();
    renderIndicadoresCentral();

    try {
        const resultado = await centralEntradasFetch('/sincronizar', { method: 'POST' });

        centralEntradasState.notasNovasUltimaSync = resultado.notasNovas || 0;
        centralEntradasState.ultimaSincronizacao = resultado.ultimaSincronizacao || new Date().toISOString();

        if (resultado.sucesso) {
            const msg = resultado.notasNovas > 0
                ? `${resultado.notasNovas} nova${resultado.notasNovas === 1 ? '' : 's'} nota${resultado.notasNovas === 1 ? '' : 's'} encontrada${resultado.notasNovas === 1 ? '' : 's'}.`
                : 'Sincronização concluída. Nenhuma nota nova.';
            const tecnico = [
                resultado.cStat ? `cStat ${resultado.cStat}` : null,
                resultado.xMotivo || null,
                resultado.ultNsu ? `NSU ${resultado.ultNsu}` : null
            ].filter(Boolean).join(' — ');
            showNotification(tecnico ? `${msg} ${tecnico}` : msg, 'success');
            if (resultado.ultimaSincronizacao) {
                centralEntradasState.ultimaSincronizacao = resultado.ultimaSincronizacao;
            }
        } else {
            const erros = resultado.erro?.mensagem
                || (resultado.erros || []).join('; ')
                || resultado.mensagem
                || 'Falha na sincronização';
            showNotification((resultado.erro?.codigo ? `[${resultado.erro.codigo}] ` : '') + erros, 'warning');
            if (resultado.erro?.codigo === 'SEFAZ_INDISPONIVEL' || resultado.erro?.codigo === 'SEFAZ_ENDPOINT' || resultado.erro?.codigo === 'TIMEOUT') {
                centralEntradasState.sefazDisponivel = false;
            }
        }

        await Promise.all([
            carregarDashboardCentral(),
            carregarDocumentosCentral({ pagina: 1 })
        ]);
    } catch (error) {
        showNotification('Erro ao sincronizar: ' + error.message, 'danger');
    } finally {
        centralEntradasState.sincronizando = false;
        atualizarIndicadorSyncBotao();
        renderIndicadoresCentral();
        carregarStatusServicoCentral();
    }
}

function obterUsuarioLogadoCentral() {
    try {
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        return usuario || { id: null, nome: 'Sistema' };
    } catch {
        return { id: null, nome: 'Sistema' };
    }
}

async function carregarProdutosParaRevisaoCentral() {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/produtos`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return [];
    return response.json().catch(() => []);
}

async function abrirCentralRevisaoMiip(documentoId, dadosImportacao) {
    if (typeof MiipCentralRevisao === 'undefined') {
        showNotification('Central de Revisão MIIP não disponível.', 'danger');
        return;
    }

    const produtos = await carregarProdutosParaRevisaoCentral();

    MiipCentralRevisao.iniciar({
        dadosImportacao,
        apiUrl: API_URL,
        produtos,
        obterUsuario: obterUsuarioLogadoCentral,
        abrirCadastroProduto: function (item, callback) {
            if (typeof showProdutoModal !== 'function') {
                showNotification('Cadastre o produto em Produtos e retorne à revisão.', 'info');
                if (typeof callback === 'function') callback(null);
                return;
            }
            showProdutoModal(null);
            $('#produtoModal').one('shown.bs.modal', function () {
                $('#nome').val(item.produto_nome || '');
                if ($('#codigo_barras').length) $('#codigo_barras').val(item.codigo_barras || '');
                if ($('#ncm').length) $('#ncm').val(item.ncm || '');
                if ($('#unidade').length) $('#unidade').val(item.unidade || 'UN');
            });
            $('#produtoModal').one('hidden.bs.modal', async function () {
                const lista = await carregarProdutosParaRevisaoCentral();
                const ultimo = lista[lista.length - 1];
                if (typeof callback === 'function') callback(ultimo || null);
            });
        },
        onConcluir: async function (resultado) {
            try {
                const itens = resultado?.itens || dadosImportacao.itens;
                await centralEntradasFetch(`/${documentoId}/revisar/concluir`, {
                    method: 'POST',
                    body: JSON.stringify({ itens, usuario_id: obterUsuarioLogadoCentral()?.id })
                });
                showNotification('Documento pronto para lançamento.', 'success');
                await Promise.all([
                    carregarDashboardCentral(),
                    carregarDocumentosCentral()
                ]);
                await selecionarDocumentoCentral(documentoId);
            } catch (error) {
                showNotification('Erro ao concluir revisão: ' + error.message, 'danger');
            }
        },
        onCancelar: function () {
            showNotification('Revisão MIIP cancelada.', 'warning');
        }
    });
}

async function processarDocumentoCentral(documentoId) {
    if (centralEntradasState.processando) return;

    centralEntradasState.processando = true;
    centralEntradasState.etapaProcessamento = 'localizar';
    centralEntradasState.abaAtiva = 'resumo';

    if (centralEntradasState.detalheAtual) {
        renderPainelLateralCentral(centralEntradasState.detalheAtual);
    }

    try {
        const resultado = await centralEntradasFetch(`/${documentoId}/processar`, {
            method: 'POST',
            body: JSON.stringify({ usuario_id: obterUsuarioLogadoCentral()?.id })
        });

        centralEntradasState.etapaProcessamento = resultado.etapaAtual || 'concluido';

        if (!resultado.sucesso) {
            showNotification(resultado.mensagem || 'Falha no processamento.', 'danger');
            return;
        }

        showNotification(resultado.mensagem || 'Processamento concluído.', 'success');

        await Promise.all([
            carregarDashboardCentral(),
            carregarDocumentosCentral()
        ]);

        await selecionarDocumentoCentral(documentoId);

        if (resultado.proximaAcao === 'revisar_produtos' && resultado.parse) {
            await abrirCentralRevisaoMiip(documentoId, resultado.parse);
        }
    } catch (error) {
        showNotification('Erro ao processar: ' + error.message, 'danger');
    } finally {
        centralEntradasState.processando = false;
        centralEntradasState.etapaProcessamento = null;
        if (centralEntradasState.detalheAtual) {
            renderPainelLateralCentral(centralEntradasState.detalheAtual);
        }
    }
}

async function recuperarXmlDocumentoCentral(documentoId) {
    try {
        const resultado = await centralEntradasFetch(`/${documentoId}/recuperar-xml`, {
            method: 'POST',
            body: JSON.stringify({ usuario_id: obterUsuarioLogadoCentral()?.id })
        });
        if (resultado.recuperado) {
            showNotification('XML recuperado. O documento permanece o mesmo, sem duplicidade.', 'success');
        } else {
            showNotification(resultado.mensagem || 'XML ainda indisponível. O documento continua em espera.', 'info');
        }
        await Promise.all([
            carregarDashboardCentral(),
            carregarDocumentosCentral()
        ]);
        await selecionarDocumentoCentral(documentoId);
    } catch (error) {
        showNotification('Erro ao recuperar XML: ' + error.message, 'danger');
    }
}

async function reprocessarDocumentoCentral(documentoId) {
    try {
        const resultado = await centralEntradasFetch(`/${documentoId}/reprocessar`, {
            method: 'POST',
            body: JSON.stringify({ usuario_id: obterUsuarioLogadoCentral()?.id })
        });
        if (resultado.idempotente && !resultado.reprocessado) {
            showNotification(resultado.motivo || 'Reprocessamento bloqueado para não duplicar efeitos.', 'info');
        } else if (resultado.sucesso) {
            showNotification(resultado.mensagem || 'Reprocessamento concluído.', 'success');
        } else {
            showNotification(resultado.mensagem || 'Falha no reprocessamento.', 'danger');
        }
        await Promise.all([
            carregarDashboardCentral(),
            carregarDocumentosCentral()
        ]);
        await selecionarDocumentoCentral(documentoId);
    } catch (error) {
        showNotification('Erro ao reprocessar: ' + error.message, 'danger');
    }
}

async function abrirRevisaoMiipCentral(documentoId) {
    try {
        const payload = await centralEntradasFetch(`/${documentoId}/payload-compra`);
        if (payload.dadosCompra) {
            await abrirCentralRevisaoMiip(documentoId, payload.dadosCompra);
        }
    } catch (error) {
        showNotification('Erro ao abrir revisão: ' + error.message, 'danger');
    }
}

async function abrirCompraDesdeCentral(documentoId) {
    try {
        const resultado = await centralEntradasFetch(`/${documentoId}/abrir-compra`, {
            method: 'POST',
            body: JSON.stringify({ usuario_id: obterUsuarioLogadoCentral()?.id })
        });

        sessionStorage.setItem('central_abrir_compra', JSON.stringify({
            documentoId: resultado.documentoId || documentoId,
            dadosCompra: resultado.dadosCompra
        }));

        if (typeof loadPage === 'function') {
            loadPage('compras');
        } else {
            showNotification('Navegue até Compras para concluir o lançamento.', 'info');
        }
    } catch (error) {
        showNotification('Erro ao abrir Compras: ' + error.message, 'danger');
    }
}

async function buscarChaveCentralEntradas() {
    const input = document.getElementById('centralFiltroChave');
    const chave = String(input?.value || '').replace(/\D/g, '');

    if (chave.length !== 44) {
        showNotification('Informe uma chave de acesso com 44 dígitos.', 'warning');
        return;
    }

    try {
        const resultado = await centralEntradasFetch(`/buscar-chave?chave=${encodeURIComponent(chave)}`);

        if (resultado.documento?.id) {
            await Promise.all([
                carregarDashboardCentral(),
                carregarDocumentosCentral({ pagina: 1 })
            ]);
            await selecionarDocumentoCentral(resultado.documento.id);
            showNotification(resultado.novo ? 'Nota importada da SEFAZ.' : 'Nota localizada na Central.', 'success');
        } else {
            showNotification(resultado.mensagem || 'Nota não encontrada.', 'info');
        }
    } catch (error) {
        showNotification('Erro na busca por chave: ' + error.message, 'danger');
    }
}

async function carregarXmlDocumentoCentral(documentoId) {
    try {
        const xmlDoc = await centralEntradasFetch(`/${documentoId}/xml`);
        centralEntradasState.xmlAtual = xmlDoc.xml || '';
        if (centralEntradasState.detalheAtual) {
            renderPainelLateralCentral(centralEntradasState.detalheAtual);
        }
    } catch (error) {
        showNotification('Erro ao carregar XML: ' + error.message, 'danger');
    }
}

async function exportarXmlCentral(documentoId) {
    const id = documentoId || centralEntradasState.documentoSelecionadoId;
    if (!id) {
        showNotification('Selecione um documento para exportar o XML.', 'warning');
        return;
    }

    try {
        const xmlDoc = await centralEntradasFetch(`/${id}/xml`);
        if (!xmlDoc.xml) {
            showNotification('XML indisponível para este documento.', 'warning');
            return;
        }

        const blob = new Blob([xmlDoc.xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `NFe-${xmlDoc.chave || id}.xml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showNotification('XML exportado com sucesso.', 'success');
    } catch (error) {
        showNotification('Erro ao exportar XML: ' + error.message, 'danger');
    }
}

/* ============================================================
 * Carregamento de dados
 * ============================================================ */

async function carregarDocumentosCentral(opcoes = {}) {
    if (centralEntradasState.abortDocumentos) {
        try { centralEntradasState.abortDocumentos.abort(); } catch { /* ignore */ }
    }

    const requestId = (centralEntradasState.requestIdDocumentos || 0) + 1;
    centralEntradasState.requestIdDocumentos = requestId;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    centralEntradasState.abortDocumentos = controller;

    const execucao = carregarDocumentosCentralInterno(opcoes, requestId, controller);
    centralEntradasState.promessaDocumentos = execucao;
    try {
        return await execucao;
    } finally {
        if (centralEntradasState.promessaDocumentos === execucao) {
            centralEntradasState.promessaDocumentos = null;
        }
        if (centralEntradasState.abortDocumentos === controller) {
            centralEntradasState.abortDocumentos = null;
        }
    }
}

async function carregarDocumentosCentralInterno(opcoes, requestId, controller) {
    const Carga = cargaCentral();
    const jaTemDocumentos = (centralEntradasState.documentos || []).length > 0;
    centralEntradasState.carregando = true;
    centralEntradasState.erroDocumentos = jaTemDocumentos ? centralEntradasState.erroDocumentos : null;
    renderGridCentralEntradas();

    const timeoutMs = Carga.TIMEOUT_LISTAGEM_MS || 20000;
    const timeoutId = controller
        ? setTimeout(() => {
            try { controller.abort(); } catch { /* ignore */ }
        }, timeoutMs)
        : null;

    try {
        if (opcoes.pagina) centralEntradasState.pagina = opcoes.pagina;
        if (opcoes.ordenarPor) centralEntradasState.ordenarPor = opcoes.ordenarPor;
        if (opcoes.ordenarDirecao) centralEntradasState.ordenarDirecao = opcoes.ordenarDirecao;

        const filtros = {
            ...obterFiltrosCentralDaTela(),
            pagina: centralEntradasState.pagina,
            limite: centralEntradasState.limite,
            ordenar_por: centralEntradasState.ordenarPor,
            ordenar_direcao: centralEntradasState.ordenarDirecao
        };

        const params = new URLSearchParams();
        Object.entries(filtros).forEach(([chave, valor]) => {
            if (valor !== '' && valor != null) {
                const param = chave === 'filtroRapido' ? 'filtro_rapido' : chave;
                params.append(param, valor);
            }
        });

        const resultado = await centralEntradasFetch(`/?${params.toString()}`, {
            signal: controller?.signal
        });

        if (Carga.deveAplicarRespostaListagem
            && !Carga.deveAplicarRespostaListagem(centralEntradasState.requestIdDocumentos, requestId)) {
            return null;
        }

        centralEntradasState.documentos = resultado.documentos || [];
        centralEntradasState.total = resultado.paginacao?.total || 0;
        centralEntradasState.totalPaginas = resultado.paginacao?.totalPaginas || 1;
        centralEntradasState.pagina = resultado.paginacao?.pagina || 1;
        centralEntradasState.erroDocumentos = null;
    } catch (error) {
        if (error && error.name === 'AbortError') {
            return null;
        }
        if (Carga.deveAplicarRespostaListagem
            && !Carga.deveAplicarRespostaListagem(centralEntradasState.requestIdDocumentos, requestId)) {
            return null;
        }
        centralEntradasState.erroDocumentos = Carga.montarEstadoErroListagem
            ? Carga.montarEstadoErroListagem(error)
            : { mensagem: 'Não foi possível carregar os documentos da Central.', detalhe: error.message };
        console.error('[Central Entradas] Falha ao listar documentos:', error);
        showNotification(centralEntradasState.erroDocumentos.mensagem, 'danger');
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (!Carga.deveAplicarRespostaListagem
            || Carga.deveAplicarRespostaListagem(centralEntradasState.requestIdDocumentos, requestId)) {
            centralEntradasState.carregando = false;
            renderGridCentralEntradas();
        }
    }
}

async function selecionarDocumentoCentral(id) {
    centralEntradasState.documentoSelecionadoId = id;
    centralEntradasState.abaAtiva = 'resumo';
    centralEntradasState.xmlAtual = null;
    centralEntradasState.parseAtual = null;
    renderGridCentralEntradas();

    const painel = document.getElementById('centralEntradasPainelLateral');
    if (painel) {
        painel.innerHTML = centralUx().renderSkeletonPainelCentral?.() || '';
    }

    try {
        const detalhe = await centralEntradasFetch(`/${id}`);
        centralEntradasState.detalheAtual = detalhe;
        await carregarStatsFornecedorCentral(detalhe.documento?.cnpjFornecedor);
        renderPainelLateralCentral(detalhe);

        if (detalhe.documento?.parseDisponivel) {
            centralEntradasFetch(`/${id}/parse`)
                .then((parseDoc) => {
                    centralEntradasState.parseAtual = parseDoc;
                    if (centralEntradasState.documentoSelecionadoId === id
                        && ['itens', 'miip', 'resumo'].includes(centralEntradasState.abaAtiva)) {
                        renderPainelLateralCentral(centralEntradasState.detalheAtual);
                    }
                })
                .catch(() => {});
        }
    } catch (error) {
        showNotification('Erro ao carregar detalhe: ' + error.message, 'danger');
        renderPainelLateralPlaceholder();
    }
}

function alternarOrdenacaoCentral(campo) {
    if (centralEntradasState.ordenarPor === campo) {
        centralEntradasState.ordenarDirecao = centralEntradasState.ordenarDirecao === 'asc' ? 'desc' : 'asc';
    } else {
        centralEntradasState.ordenarPor = campo;
        centralEntradasState.ordenarDirecao = 'desc';
    }
    centralEntradasState.pagina = 1;
    carregarDocumentosCentral();
}

/* ============================================================
 * Eventos
 * ============================================================ */

function limparFiltrosCentralEntradas() {
    const ids = ['centralFiltroBusca', 'centralFiltroDataInicio', 'centralFiltroDataFim'];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const status = document.getElementById('centralFiltroStatus');
    const origem = document.getElementById('centralFiltroOrigem');
    if (status) status.value = '';
    if (origem) origem.value = '';
    centralEntradasState.filtroRapidoAtivo = '';
    centralEntradasState.pagina = 1;
    renderFiltrosRapidosCentral();
    carregarDocumentosCentral();
}

function bindEventosCentralEntradas() {
    $(document).off('.centralEntradas');

    window.removeEventListener('online', renderPainelServicoCentral);
    window.removeEventListener('offline', renderPainelServicoCentral);
    window.addEventListener('online', renderPainelServicoCentral);
    window.addEventListener('offline', renderPainelServicoCentral);

    $(document).on('click.centralEntradas', '#centralEmptySync', function () {
        sincronizarCentralEntradas();
    });

    $(document).on('click.centralEntradas', '#centralEmptyLimparFiltros', function () {
        limparFiltrosCentralEntradas();
    });

    $(document).on('keydown.centralEntradas', '.central-entradas-row', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const id = Number($(this).data('documento-id'));
            if (id) selecionarDocumentoCentral(id);
        }
    });

    $(document).on('keydown.centralEntradas', '.central-entradas-card-click', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            $(this).trigger('click');
        }
    });

    $(document).on('click.centralEntradas', '#centralBtnProcessar', function () {
        const id = Number($(this).data('doc-id'));
        if (id) processarDocumentoCentral(id);
    });

    $(document).on('click.centralEntradas', '#centralBtnRecuperarXml', function () {
        const id = Number($(this).data('doc-id'));
        if (id) recuperarXmlDocumentoCentral(id);
    });

    $(document).on('click.centralEntradas', '#centralBtnReprocessar', function () {
        const id = Number($(this).data('doc-id'));
        if (id) reprocessarDocumentoCentral(id);
    });

    $(document).on('click.centralEntradas', '#centralBtnRevisarMiip', function () {
        const id = Number($(this).data('doc-id'));
        if (id) abrirRevisaoMiipCentral(id);
    });

    $(document).on('click.centralEntradas', '#centralBtnAbrirCompra', function () {
        const id = Number($(this).data('doc-id'));
        if (id) abrirCompraDesdeCentral(id);
    });

    $(document).on('click.centralEntradas', '#centralBtnCarregarXml', function () {
        const id = Number($(this).data('doc-id'));
        if (id) carregarXmlDocumentoCentral(id);
    });

    $(document).on('click.centralEntradas', '#centralBtnExportarXml, #centralBtnExportarXmlPainel', function () {
        const id = Number($(this).data('doc-id')) || centralEntradasState.documentoSelecionadoId;
        exportarXmlCentral(id);
    });

    $(document).on('click.centralEntradas', '.central-entradas-aba', function () {
        const aba = $(this).data('aba');
        if (!aba || aba === centralEntradasState.abaAtiva) return;
        centralEntradasState.abaAtiva = aba;
        if (centralEntradasState.detalheAtual) {
            renderPainelLateralCentral(centralEntradasState.detalheAtual);
        }
    });

    $(document).on('click.centralEntradas', '#centralBtnSincronizar', function () {
        sincronizarCentralEntradas();
    });

    $(document).on('click.centralEntradas', '#centralBtnAdicionarDocumento', function () {
        abrirModalUploadCentral();
    });

    $(document).on('click.centralEntradas', '#centralUploadSelecionar', function () {
        document.getElementById('centralUploadInput')?.click();
    });

    $(document).on('change.centralEntradas', '#centralUploadInput', function () {
        adicionarArquivosUploadCentral(this.files);
        this.value = '';
    });

    $(document).on('click.centralEntradas', '#centralUploadEnviar', function () {
        enviarUploadCentralEntradas();
    });

    $(document).on('click.centralEntradas', '#centralUploadLimpar', function () {
        centralEntradasState.uploadArquivos = [];
        renderListaArquivosUploadCentral();
    });

    $(document).on('click.centralEntradas', '.central-upload-remover', function () {
        const idx = Number($(this).data('idx'));
        if (Number.isNaN(idx)) return;
        centralEntradasState.uploadArquivos = (centralEntradasState.uploadArquivos || []).filter((_, i) => i !== idx);
        renderListaArquivosUploadCentral();
    });

    $(document).on('click.centralEntradas', '#centralUploadAtalhoChave', function () {
        const modalEl = document.getElementById('centralUploadModal');
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        document.getElementById('centralFiltroChave')?.focus();
        showNotification('Informe a chave de 44 dígitos no filtro abaixo.', 'info');
    });

    $(document).on('click.centralEntradas', '#centralUploadAtalhoSefaz', function () {
        const modalEl = document.getElementById('centralUploadModal');
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        sincronizarCentralEntradas();
    });

    const dropzone = document.getElementById('centralUploadDropzone');
    if (dropzone) {
        ['dragenter', 'dragover'].forEach((evento) => {
            dropzone.addEventListener(evento, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('central-upload-dropzone--ativo');
            });
        });
        ['dragleave', 'drop'].forEach((evento) => {
            dropzone.addEventListener(evento, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('central-upload-dropzone--ativo');
            });
        });
        dropzone.addEventListener('drop', (e) => {
            adicionarArquivosUploadCentral(e.dataTransfer?.files);
        });
    }

    $(document).on('click.centralEntradas', '#centralBtnAtualizar', function () {
        Promise.all([
            carregarDashboardCentral(),
            carregarDocumentosCentral()
        ]).then(() => showNotification('Central atualizada.', 'info'));
    });

    $(document).on('click.centralEntradas', '#centralBtnAtualizarDashboard', function () {
        carregarDashboardCentral().then(() => showNotification('Dashboard atualizado.', 'info'));
    });

    $(document).on('click.centralEntradas', '#centralBtnBuscarChave', function () {
        buscarChaveCentralEntradas();
    });

    $(document).on('keypress.centralEntradas', '#centralFiltroChave', function (event) {
        if (event.which === 13) buscarChaveCentralEntradas();
    });

    $(document).on('click.centralEntradas', '#centralBtnRetryDocumentos', function () {
        carregarDocumentosCentral({ pagina: 1 });
    });

    $(document).on('click.centralEntradas', '#centralBtnFiltrar', function () {
        centralEntradasState.pagina = 1;
        carregarDocumentosCentral();
        carregarDashboardCentral();
    });

    $(document).on('click.centralEntradas', '.central-entradas-card-click', function () {
        const status = $(this).data('status-filtro');
        const select = document.getElementById('centralFiltroStatus');
        if (select) select.value = status;
        centralEntradasState.pagina = 1;
        carregarDocumentosCentral();
    });

    $(document).on('click.centralEntradas', '.central-entradas-row', function () {
        const id = Number($(this).data('documento-id'));
        if (id) selecionarDocumentoCentral(id);
    });

    $(document).on('click.centralEntradas', '#centralPaginaAnterior', function () {
        if (centralEntradasState.pagina > 1) {
            carregarDocumentosCentral({ pagina: centralEntradasState.pagina - 1 });
        }
    });

    $(document).on('click.centralEntradas', '#centralPaginaProxima', function () {
        if (centralEntradasState.pagina < centralEntradasState.totalPaginas) {
            carregarDocumentosCentral({ pagina: centralEntradasState.pagina + 1 });
        }
    });

    $(document).on('click.centralEntradas', '.central-entradas-sort', function () {
        alternarOrdenacaoCentral($(this).data('sort'));
    });

    $(document).on('keypress.centralEntradas', '#centralFiltroBusca', function (event) {
        if (event.which === 13) {
            centralEntradasState.pagina = 1;
            carregarDocumentosCentral();
        }
    });

    $(document).on('click.centralEntradas', '.central-entradas-filtro-rapido', function () {
        const codigo = $(this).data('filtro-rapido');
        if (centralEntradasState.filtroRapidoAtivo === codigo) {
            centralEntradasState.filtroRapidoAtivo = '';
        } else {
            centralEntradasState.filtroRapidoAtivo = codigo;
            const select = document.getElementById('centralFiltroStatus');
            if (select) select.value = '';
        }
        centralEntradasState.pagina = 1;
        renderFiltrosRapidosCentral();
        carregarDocumentosCentral();
    });

    $(document).on('click.centralEntradas', '.central-atencao-acao', function () {
        const idx = Number($(this).data('atencao-idx'));
        const item = centralEntradasState.atencao?.itens?.[idx];
        if (item?.acao) executarAcaoAtencaoCentral(item.acao);
    });

    $(document).on('click.centralEntradas', '.central-alerta-ver, .central-pendencia-ver', function () {
        const id = Number($(this).data('doc-id'));
        if (id) selecionarDocumentoCentral(id);
    });

    $(document).on('click.centralEntradas', '.central-nav-view', function () {
        mostrarViewCentral($(this).data('view'));
    });

    $(document).on('click.centralEntradas', '#centralBtnSalvarConfig', function () {
        salvarConfigCentral();
    });

    $(document).on('click.centralEntradas', '#centralBtnFiltrarLog', function () {
        carregarLogCentral();
    });

    $(document).on('keypress.centralEntradas', '#centralLogBusca', function (event) {
        if (event.which === 13) carregarLogCentral();
    });
}

/* ============================================================
 * Página
 * ============================================================ */

function loadCentralEntradas() {
    centralEntradasState.pagina = 1;
    centralEntradasState.documentoSelecionadoId = null;
    centralEntradasState.documentos = [];
    centralEntradasState.total = 0;
    centralEntradasState.detalheAtual = null;
    centralEntradasState.xmlAtual = null;
    centralEntradasState.parseAtual = null;
    centralEntradasState.abaAtiva = 'resumo';
    centralEntradasState.carregando = false;
    centralEntradasState.erroDocumentos = null;
    centralEntradasState.promessaDocumentos = null;
    if (centralEntradasState.abortDocumentos) {
        try { centralEntradasState.abortDocumentos.abort(); } catch { /* ignore */ }
        centralEntradasState.abortDocumentos = null;
    }

    const html = `
        <div class="central-entradas-page">
            <div class="central-entradas-hero mb-4 central-entradas-anim-in">
                <div>
                    <h2 class="mb-1">
                        <span class="central-entradas-hero-icone"><i class="fas fa-inbox"></i></span>
                        Central Inteligente de Entradas NF
                    </h2>
                    <p class="text-muted mb-0">Importação, conferência e processamento inteligente das Notas Fiscais de Entrada.</p>
                </div>
                <div class="central-entradas-toolbar">
                    <button type="button" class="btn btn-success" id="centralBtnAdicionarDocumento" title="Adicionar documento fiscal via XML">
                        <i class="fas fa-plus"></i> Adicionar Documento
                    </button>
                    <button type="button" class="btn btn-primary" id="centralBtnSincronizar" title="Sincronizar Distribuição DF-e">
                        <i class="fas fa-sync-alt"></i> Sincronizar SEFAZ
                    </button>
                    <button type="button" class="btn btn-outline-primary" id="centralBtnAtualizar" title="Atualizar lista e dashboard">
                        <i class="fas fa-redo-alt"></i>
                    </button>
                    <button type="button" class="btn btn-outline-secondary" id="centralBtnExportarXml" title="Exportar XML do documento selecionado">
                        <i class="fas fa-file-export"></i>
                    </button>
                    <button type="button" class="btn btn-outline-secondary" id="centralBtnAtualizarDashboard" title="Atualizar somente o dashboard">
                        <i class="fas fa-chart-bar"></i>
                    </button>
                    <button type="button" class="btn btn-outline-secondary central-nav-view" data-view="config" title="Configurações">
                        <i class="fas fa-cog"></i>
                    </button>
                    <button type="button" class="btn btn-outline-secondary central-nav-view" data-view="log" title="Log operacional">
                        <i class="fas fa-list-alt"></i>
                    </button>
                    <button type="button" class="btn btn-outline-primary central-nav-view active" data-view="inbox" title="Inbox">
                        <i class="fas fa-inbox"></i>
                    </button>
                </div>
            </div>

            <div id="centralEntradasServico" class="mb-3"></div>

            <div id="centralEntradasViewConfig" class="d-none mb-4">
                <div class="card">
                    <div class="card-header"><i class="fas fa-cog me-2"></i> Configurações da Central</div>
                    <div class="card-body" id="centralConfigForm">
                        <div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>
                    </div>
                </div>
            </div>

            <div id="centralEntradasViewLog" class="d-none mb-4">
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
                        <span><i class="fas fa-list-alt me-2"></i> Log Operacional</span>
                        <div class="d-flex gap-2">
                            <input type="text" class="form-control form-control-sm" id="centralLogBusca" placeholder="Pesquisar...">
                            <select class="form-select form-select-sm" id="centralLogTipo">
                                <option value="">Todos os tipos</option>
                                <option value="SYNC_INICIADA">Sync iniciada</option>
                                <option value="SYNC_CONCLUIDA">Sync concluída</option>
                                <option value="SYNC_ERRO">Sync erro</option>
                                <option value="DOCUMENTO_RECEBIDO">Documento recebido</option>
                                <option value="DOCUMENTO_PROCESSADO">Documento processado</option>
                                <option value="COMPRA_GRAVADA">Compra gravada</option>
                                <option value="ERRO">Erro</option>
                            </select>
                            <button type="button" class="btn btn-sm btn-primary" id="centralBtnFiltrarLog"><i class="fas fa-search"></i></button>
                        </div>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm table-hover mb-0">
                            <thead class="table-light">
                                <tr>
                                    <th>Data/Hora</th><th>Evento</th><th>Origem</th><th>Descrição</th><th>Tempo</th><th>Resultado</th>
                                </tr>
                            </thead>
                            <tbody id="centralLogBody">
                                <tr><td colspan="6" class="text-center py-4 text-muted">Carregando...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div id="centralEntradasViewInbox">

            <div id="centralEntradasAtencao" class="mb-3"></div>

            <div id="centralEntradasBannerSync" class="mb-3 d-none"></div>

            <div id="centralEntradasIndicadores" class="mb-3"></div>

            <div class="row g-3 mb-3" id="centralEntradasOperacional">
                ${centralUx().renderSkeletonKpisCentral?.(6) || ''}
            </div>

            <div class="row g-3 mb-4" id="centralEntradasCards">
                ${centralUx().renderSkeletonKpisCentral?.(6) || ''}
            </div>

            <div class="row g-3 mb-3">
                <div class="col-lg-7">
                    <div class="card central-entradas-pendencias-card h-100">
                        <div class="card-header py-2">
                            <i class="fas fa-tasks me-2"></i> Central de Pendências
                        </div>
                        <div class="card-body py-3" id="centralEntradasPendenciasBody">
                            ${centralUx().renderSkeletonPainelBlocoCentral?.() || ''}
                        </div>
                    </div>
                </div>
                <div class="col-lg-5">
                    <div class="card central-entradas-alertas-card h-100">
                        <div class="card-header py-2">
                            <i class="fas fa-bell me-2"></i> Alertas Inteligentes
                        </div>
                        <div class="card-body py-3" id="centralEntradasAlertas">
                            ${centralUx().renderSkeletonPainelBlocoCentral?.() || ''}
                        </div>
                    </div>
                </div>
            </div>

            <div class="card mb-3 central-entradas-filtros-card">
                <div class="card-body py-3">
                    <div class="central-entradas-filtros-rapidos mb-3" id="centralEntradasFiltrosRapidos"></div>
                    <div class="row g-3 align-items-end">
                        <div class="col-md-3">
                            <label class="form-label" for="centralFiltroChave">Buscar na SEFAZ por chave</label>
                            <div class="input-group">
                                <input type="text" class="form-control" id="centralFiltroChave"
                                    placeholder="44 dígitos da chave de acesso" maxlength="44">
                                <button type="button" class="btn btn-outline-primary" id="centralBtnBuscarChave" title="Consultar chave na SEFAZ">
                                    <i class="fas fa-key"></i>
                                </button>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label" for="centralFiltroBusca">Pesquisar</label>
                            <input type="text" class="form-control" id="centralFiltroBusca"
                                placeholder="Chave, número NF ou fornecedor">
                        </div>
                        <div class="col-md-2">
                            <label class="form-label" for="centralFiltroStatus">Status</label>
                            <select class="form-select" id="centralFiltroStatus">
                                <option value="">Todos</option>
                            </select>
                        </div>
                        <div class="col-md-1">
                            <label class="form-label" for="centralFiltroOrigem">Origem</label>
                            <select class="form-select" id="centralFiltroOrigem">
                                <option value="">Todas</option>
                                <option value="dfe">DF-e</option>
                                <option value="upload_manual">Upload</option>
                                <option value="consulta_chave">Chave</option>
                            </select>
                        </div>
                        <div class="col-md-1">
                            <label class="form-label" for="centralFiltroDataInicio">De</label>
                            <input type="date" class="form-control" id="centralFiltroDataInicio">
                        </div>
                        <div class="col-md-1">
                            <label class="form-label" for="centralFiltroDataFim">Até</label>
                            <input type="date" class="form-control" id="centralFiltroDataFim">
                        </div>
                        <div class="col-md-1">
                            <button type="button" class="btn btn-primary w-100" id="centralBtnFiltrar" title="Aplicar filtros">
                                <i class="fas fa-search"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="central-entradas-layout">
                <div class="central-entradas-grid-area">
                    <div class="card h-100 central-entradas-grid-card">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <span><i class="fas fa-list me-2"></i> Documentos</span>
                            <span class="badge bg-secondary" id="centralEntradasContador">0 documentos</span>
                        </div>
                        <div class="card-body p-0 d-flex flex-column">
                            <div class="table-responsive flex-grow-1">
                                <table class="table table-hover mb-0 central-entradas-tabela">
                                    <thead class="table-light">
                                        <tr>
                                            <th style="width:44px"></th>
                                            <th class="central-entradas-sort" data-sort="fornecedor" style="cursor:pointer">
                                                Fornecedor <i class="fas fa-sort text-muted small"></i>
                                            </th>
                                            <th class="central-entradas-sort" data-sort="numero" style="cursor:pointer">
                                                NF / Origem <i class="fas fa-sort text-muted small"></i>
                                            </th>
                                            <th class="central-entradas-sort" data-sort="data_emissao" style="cursor:pointer">
                                                Emissão <i class="fas fa-sort text-muted small"></i>
                                            </th>
                                            <th class="central-entradas-sort" data-sort="valor_total" style="cursor:pointer">
                                                Valor <i class="fas fa-sort text-muted small"></i>
                                            </th>
                                            <th style="width:64px" title="Score geral">Score</th>
                                            <th class="central-entradas-sort" data-sort="status" style="cursor:pointer">
                                                Status <i class="fas fa-sort text-muted small"></i>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody id="centralEntradasGridBody">
                                        ${centralUx().renderSkeletonGridCentral?.(8) || ''}
                                    </tbody>
                                </table>
                            </div>
                            <div id="centralEntradasPaginacao"></div>
                        </div>
                    </div>
                </div>

                <div class="central-entradas-painel-lateral" id="centralEntradasPainelLateral"></div>
            </div>
            </div>
        </div>

        <div class="modal fade" id="centralUploadModal" tabindex="-1" aria-labelledby="centralUploadModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content central-upload-modal">
                    <div class="modal-header">
                        <h5 class="modal-title" id="centralUploadModalLabel">
                            <i class="fas fa-file-upload me-2 text-success"></i> Adicionar Documento
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <p class="text-muted small mb-3">
                            Envie NF-e em XML pela Central Inteligente. O documento seguirá o mesmo pipeline da SEFAZ (Parser → MIIP → Revisão).
                        </p>
                        <div class="central-upload-dropzone" id="centralUploadDropzone">
                            <div class="central-upload-dropzone-icone">
                                <i class="fas fa-cloud-upload-alt fa-2x text-primary"></i>
                            </div>
                            <p class="mb-2 fw-semibold">Arraste XMLs aqui</p>
                            <p class="text-muted small mb-3">ou</p>
                            <button type="button" class="btn btn-outline-primary" id="centralUploadSelecionar">
                                <i class="fas fa-folder-open me-1"></i> Selecionar XML
                            </button>
                            <input type="file" id="centralUploadInput" accept=".xml,application/xml,text/xml" multiple hidden>
                            <p class="text-muted small mt-3 mb-0">1 ou vários arquivos · somente .xml · NF-e</p>
                        </div>
                        <div id="centralUploadLista" class="central-upload-lista d-none"></div>
                        <div id="centralUploadProgresso" class="central-upload-progresso d-none"></div>
                        <div id="centralUploadResultado" class="central-upload-resultado d-none"></div>
                        <hr class="my-3">
                        <div class="central-upload-atalhos">
                            <p class="text-muted small mb-2 mb-md-0">Atalhos</p>
                            <div class="d-flex gap-2 flex-wrap">
                                <button type="button" class="btn btn-sm btn-outline-secondary" id="centralUploadAtalhoChave">
                                    <i class="fas fa-key me-1"></i> Buscar pela chave
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary" id="centralUploadAtalhoSefaz">
                                    <i class="fas fa-sync-alt me-1"></i> Consultar SEFAZ
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="centralUploadEnviar" disabled>
                            <i class="fas fa-upload me-1"></i> Enviar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#page-content').html(html);
    renderPainelLateralPlaceholder();
    bindEventosCentralEntradas();
    iniciarTickerSincronizacao();
    iniciarAutomacaoCentral();

    const posGravacao = sessionStorage.getItem('central_pos_gravacao');
    iniciarAberturaCentralEntradas({ posGravacao });
}

async function iniciarAberturaCentralEntradas({ posGravacao } = {}) {
    const Carga = cargaCentral();
    if (typeof Carga.orquestrarAberturaCentral !== 'function') {
        showNotification('Erro ao inicializar Central: orquestração indisponível.', 'danger');
        return;
    }

    try {
        await Carga.orquestrarAberturaCentral({
            buscarAoAbrir: () => centralEntradasFetch('/ao-abrir'),
            buscarMetadados: () => centralEntradasFetch('/metadados'),
            buscarDocumentos: () => carregarDocumentosCentral(),
            buscarInteligencia: () => carregarInteligenciaCentral(),
            sincronizarAoAbrir: () => centralEntradasFetch('/sincronizar-ao-abrir', { method: 'POST' }),
            atualizarDashboard: () => carregarDashboardCentral({
                buscarHealth: true,
                buscarInteligencia: false
            }),
            pintarKpis: (contadores) => aplicarPayloadDashboardCentral({
                contadores,
                indicadores: centralEntradasState.indicadores,
                sincronizacao: centralEntradasState.sincronizacaoNsu,
                ultimaSincronizacao: centralEntradasState.ultimaSincronizacao
            }),
            aplicarDashboard: (dashboard) => aplicarPayloadDashboardCentral(dashboard || {}),
            aplicarAbertura: (abertura) => aplicarAberturaCentral(abertura || {}),
            aplicarHealth: (health) => {
                centralEntradasState.health = health;
                renderPainelServicoCentral();
            },
            aplicarInteligencia: () => {},
            aplicarMetadados: (metadados) => {
                centralEntradasState.metadados = metadados;
                const select = document.getElementById('centralFiltroStatus');
                if (select) select.innerHTML = montarOptionsStatusCentral('');
                renderFiltrosRapidosCentral();
            },
            tratarSync: (sync) => {
                tratarResultadoSyncAberturaCentral(sync);
            },
            registrarErro: (error) => {
                console.warn('Central de Entradas:', error?.message || error);
            }
        });

        if (posGravacao) {
            sessionStorage.removeItem('central_pos_gravacao');
            const docId = Number(posGravacao);
            if (docId) {
                showNotification('Compra lançada com sucesso.', 'success');
                selecionarDocumentoCentral(docId);
            }
        }
    } catch (error) {
        showNotification('Erro ao inicializar Central: ' + error.message, 'danger');
        if (!centralEntradasState.ultimoDashboardContadores) {
            carregarDashboardCentral().catch(() => null);
        }
    }
}
