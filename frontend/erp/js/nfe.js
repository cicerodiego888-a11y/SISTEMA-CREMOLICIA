/**
 * NF-e modelo 55 — interface operacional do ERP (NF-E-03).
 * Apenas consome /api/nfe e /api/vendas: emissão, numeração, XML, DANFE e
 * decisões fiscais pertencem exclusivamente ao backend.
 */

const NFE_PERMISSAO_EMITIR = 'NF-E-EMITIR';
const NFE_PERMISSAO_CANCELAR = 'NF-E-CANCELAR';
const NFE_MSG_SEM_DOCUMENTO = 'Informe o CPF ou CNPJ do destinatário para emitir a NF-e.';
const NFE_MSG_CANCELAMENTO = 'Cancele somente se a operação fiscal realmente precisar ser cancelada.';
const NFE_MSG_NAO_PRONTA = 'NF-e não está pronta para emissão.';
const NFE_MSG_SEM_PERMISSAO = 'Usuário sem permissão para emitir NF-e.';
const NFE_JUSTIFICATIVA_MIN = 15;
const NFE_NATUREZA_PADRAO = 'VENDA DE MERCADORIA';
const NFE_CFOP_PADRAO = '5102';
const NFE_UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
    'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
];
const NFE_CAMPOS_EXTRAS = [
    'mod_frete', 'frete', 'transportadora', 'volumes', 'peso',
    'desconto', 'acrescimo', 'observacoes', 'dados_adicionais'
];

const NFE_STATUS_LABEL = {
    autorizada: 'Autorizada',
    cancelamento_rejeitado: 'Autorizada (cancelamento rejeitado)',
    rejeitada: 'Rejeitada',
    denegada: 'Denegada',
    cancelada: 'Cancelada',
    emitindo: 'Emitindo',
    transmitindo: 'Transmitindo',
    aguardando_retorno: 'Aguardando retorno',
    lote_processamento: 'Em processamento na SEFAZ',
    erro_transmissao: 'Erro de transmissão',
    erro_comunicacao: 'Erro de comunicação',
    erro_assinatura: 'Erro de assinatura',
    erro_validacao: 'Erro de validação',
    timeout: 'Tempo esgotado',
    servico_indisponivel: 'SEFAZ indisponível',
    nao_localizada_sefaz: 'Não localizada na SEFAZ',
    pendente_reenvio: 'Pendente de reenvio',
    pendente: 'Pendente'
};

const NFE_STATUS_BADGE = {
    autorizada: 'bg-success',
    cancelamento_rejeitado: 'bg-success',
    rejeitada: 'bg-danger',
    denegada: 'bg-dark',
    cancelada: 'bg-secondary',
    emitindo: 'bg-info text-dark',
    transmitindo: 'bg-info text-dark',
    aguardando_retorno: 'bg-warning text-dark',
    lote_processamento: 'bg-warning text-dark',
    nao_localizada_sefaz: 'bg-warning text-dark'
};

const NFE_EVENTO_LABEL = {
    emissao: 'Emissão / retorno da SEFAZ',
    autorizacao: 'Autorização',
    erro: 'Erro',
    consulta: 'Consulta à SEFAZ',
    consulta_erro: 'Falha na consulta',
    consulta_automatica: 'Consulta automática',
    reenvio: 'Reenvio',
    cancelamento: 'Cancelamento',
    cancelamento_rejeitado: 'Cancelamento rejeitado'
};

const NFE_FILA_FINALIZADA = ['autorizado', 'cancelado'];

let NFE_EMISSAO_EM_CURSO = false;
const NFE_DADOS_DIGITADOS = {};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function nfeEsc(valor) {
    return String(valor == null ? '' : valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function nfeSomenteDigitos(valor) {
    return String(valor == null ? '' : valor).replace(/\D/g, '');
}

function nfeNotificar(mensagem, tipo) {
    if (typeof showNotification === 'function') showNotification(mensagem, tipo || 'info');
}

function nfeDataHora(valor) {
    if (!valor) return '—';
    const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? String(valor) : d.toLocaleString('pt-BR');
}

function nfeNumeroFormatado(numero) {
    if (numero == null || numero === '') return '—';
    return String(numero).padStart(6, '0');
}

function nfeChaveFormatada(chave) {
    const digitos = nfeSomenteDigitos(chave);
    return digitos ? digitos.replace(/(\d{4})(?=\d)/g, '$1 ') : '—';
}

function nfeRotuloStatus(status) {
    const s = String(status || '').toLowerCase();
    return NFE_STATUS_LABEL[s] || (s ? s.replace(/_/g, ' ') : '—');
}

function nfeRotuloOrigem(nota) {
    const n = nota || {};
    if (String(n.tipo || '').toUpperCase() === 'DEVOLUCAO_COMPRA') return 'Devolução';
    if (n.origem === 'PEDIDO') return n.pedido_id ? `Pedido #${Number(n.pedido_id)}` : 'Pedido';
    if (n.origem === 'MANUAL') return 'Manual';
    return '—';
}

function nfeBadgeStatus(status) {
    const s = String(status || '').toLowerCase();
    const classe = NFE_STATUS_BADGE[s] || (s.startsWith('erro') || s === 'timeout' || s === 'servico_indisponivel'
        ? 'bg-danger'
        : 'bg-light text-dark border');
    return `<span class="badge ${classe}">${nfeEsc(nfeRotuloStatus(s))}</span>`;
}

function nfeRotuloAmbiente(ambiente) {
    if (Number(ambiente) === 2) return 'Homologação';
    if (Number(ambiente) === 1) return 'Produção';
    return '—';
}

// ---------------------------------------------------------------------------
// Recurso e permissões (espelho da regra do backend; o backend sempre valida)
// ---------------------------------------------------------------------------

function nfeRecursoHabilitado() {
    if (typeof implantacaoPermiteNfe === 'function') return implantacaoPermiteNfe();
    const cfg = (typeof window !== 'undefined' && window.CONFIG_IMPLANTACAO) || {};
    return Boolean(cfg.recursos && cfg.recursos.nfe === true);
}

function nfeUsuarioAtual() {
    try {
        if (typeof obterUsuarioLogado === 'function') return obterUsuarioLogado() || {};
        return JSON.parse(localStorage.getItem('user') || '{}');
    } catch (_) {
        return {};
    }
}

function nfeUsuarioTemPermissao(permissao) {
    const user = nfeUsuarioAtual();
    const role = String(user.role || '').toLowerCase();
    const perfil = String(user.perfil || '').trim().toUpperCase();
    if (role === 'admin' || role === 'supervisor' || perfil === 'ADMIN' || perfil === 'SUPER_ADMIN') {
        return true;
    }
    let permissoes = user.permissoes;
    if (typeof normalizarPermissoes === 'function') {
        permissoes = normalizarPermissoes(permissoes);
    } else if (typeof permissoes === 'string') {
        permissoes = permissoes.split(',').map((p) => p.trim()).filter(Boolean);
    }
    return Array.isArray(permissoes) && permissoes.includes(permissao);
}

/** Para outras telas (pedidos.js): constantes deste arquivo não são globais entre scripts. */
function nfeUsuarioPodeEmitir() {
    return nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR);
}

function nfeTextoEmissao(chave) {
    return { semPermissao: NFE_MSG_SEM_PERMISSAO, naoPronta: NFE_MSG_NAO_PRONTA }[chave] || '';
}

// ---------------------------------------------------------------------------
// Comunicação com a API
// ---------------------------------------------------------------------------

async function nfeRequest(caminho, opcoes = {}) {
    const metodo = opcoes.method || 'GET';
    const formato = opcoes.formato || 'json';
    const headers = { Authorization: `Bearer ${localStorage.getItem('token') || ''}` };
    if (opcoes.body !== undefined) headers['Content-Type'] = 'application/json';

    // timeoutMs: só para leituras das telas (evita carregamento infinito); a emissão não usa.
    const controle = opcoes.timeoutMs && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controle ? setTimeout(() => controle.abort(), opcoes.timeoutMs) : null;
    let resp;
    try {
        resp = await fetch(`${API_URL}${caminho}`, {
            method: metodo,
            headers,
            body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined,
            signal: controle ? controle.signal : undefined
        });
    } catch (_) {
        return {
            ok: false,
            status: 0,
            data: {
                success: false,
                mensagem: controle && controle.signal.aborted
                    ? 'O servidor demorou para responder.'
                    : 'Não foi possível comunicar com o servidor.'
            }
        };
    } finally {
        if (timer) clearTimeout(timer);
    }

    if (resp.status === 401 && typeof handleUnauthorized === 'function') {
        handleUnauthorized();
    }

    if (formato === 'json' || !resp.ok) {
        let data = {};
        try { data = await resp.json(); } catch (_) { data = {}; }
        return { ok: resp.ok, status: resp.status, data, headers: resp.headers };
    }
    if (formato === 'blob') {
        return { ok: true, status: resp.status, blob: await resp.blob(), headers: resp.headers };
    }
    return { ok: true, status: resp.status, text: await resp.text(), headers: resp.headers };
}

function nfeMensagemErro(data, padrao) {
    if (!data) return padrao;
    return data.mensagem || data.message || data.error || padrao;
}

function nfeMensagemPermissao(resp, padrao) {
    if (resp && resp.status === 403) return 'Você não tem permissão para esta operação de NF-e.';
    return nfeMensagemErro(resp && resp.data, padrao);
}

// ---------------------------------------------------------------------------
// Destinatário: pré-preenchimento, validação e payload
// ---------------------------------------------------------------------------

function nfeCpfValido(valor) {
    const cpf = nfeSomenteDigitos(valor);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    const calc = (fatorInicial) => {
        let soma = 0;
        for (let i = 0; i < fatorInicial - 1; i++) soma += Number(cpf[i]) * (fatorInicial - i);
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };
    return calc(10) === Number(cpf[9]) && calc(11) === Number(cpf[10]);
}

function nfeCnpjValido(valor) {
    const cnpj = nfeSomenteDigitos(valor);
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
    const calc = (tamanho) => {
        const pesos = tamanho === 12
            ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
            : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        let soma = 0;
        for (let i = 0; i < tamanho; i++) soma += Number(cnpj[i]) * pesos[i];
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
    };
    return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

function dadosIniciaisEmissaoNfe(venda) {
    const v = venda || {};
    const salvo = v.id != null ? NFE_DADOS_DIGITADOS[String(v.id)] : null;
    if (salvo) return { ...salvo };
    const documento = nfeSomenteDigitos(v.cliente_cpf || v.cpf_cnpj_nota || '');
    return {
        tipo: documento.length === 14 ? 'CNPJ' : 'CPF',
        documento,
        nome: v.cliente_nome || '',
        inscricao_estadual: v.cliente_inscricao_estadual || '',
        logradouro: v.cliente_rua || '',
        numero: v.cliente_numero || '',
        complemento: '',
        bairro: v.cliente_bairro || '',
        municipio: v.cliente_cidade || '',
        uf: String(v.cliente_uf || '').toUpperCase(),
        cep: nfeSomenteDigitos(v.cliente_cep || ''),
        natureza: NFE_NATUREZA_PADRAO,
        cfop: NFE_CFOP_PADRAO,
        dados_adicionais: ''
    };
}

function validarDadosEmissaoNfe(dados, contexto = {}) {
    const d = dados || {};
    const erros = [];
    const add = (campo, mensagem) => erros.push({ campo, mensagem });

    if (contexto.possuiParcelaFiscal === false) {
        add(null, 'Venda sem parcela fiscal: não há itens para a NF-e.');
    }

    const documento = nfeSomenteDigitos(d.documento);
    const tipo = String(d.tipo || '').toUpperCase();
    if (!documento) {
        add('documento', NFE_MSG_SEM_DOCUMENTO);
    } else if (tipo === 'CNPJ') {
        if (!nfeCnpjValido(documento)) add('documento', 'CNPJ do destinatário inválido.');
    } else if (tipo === 'CPF') {
        if (!nfeCpfValido(documento)) add('documento', 'CPF do destinatário inválido.');
    } else {
        add('tipo', 'Selecione o tipo de documento (CPF ou CNPJ).');
    }

    if (!String(d.nome || '').trim()) add('nome', 'Informe o nome ou razão social do destinatário.');
    if (!String(d.logradouro || '').trim()) add('logradouro', 'Informe o logradouro do destinatário.');
    if (!String(d.numero || '').trim()) add('numero', 'Informe o número do endereço (use S/N se não houver).');
    if (!String(d.bairro || '').trim()) add('bairro', 'Informe o bairro do destinatário.');
    if (!String(d.municipio || '').trim()) add('municipio', 'Informe o município do destinatário.');
    if (!NFE_UFS.includes(String(d.uf || '').toUpperCase())) add('uf', 'Selecione a UF do destinatário.');
    if (nfeSomenteDigitos(d.cep).length !== 8) add('cep', 'Informe o CEP do destinatário com 8 dígitos.');

    if (!String(d.natureza || '').trim()) add('natureza', 'Informe a natureza da operação.');
    if (!/^[567]\d{3}$/.test(nfeSomenteDigitos(d.cfop))) {
        add('cfop', 'Informe o CFOP de saída com 4 dígitos (5xxx, 6xxx ou 7xxx).');
    }

    return { valido: erros.length === 0, erros };
}

function montarPayloadEmissaoNfe(dados, extras = {}) {
    const d = dados || {};
    const documento = nfeSomenteDigitos(d.documento);
    const cnpj = String(d.tipo || '').toUpperCase() === 'CNPJ';
    const payload = {
        dest_tipo_pessoa: cnpj ? 'PJ' : 'PF',
        dest_nome: String(d.nome || '').trim(),
        dest_inscricao_estadual: String(d.inscricao_estadual || '').trim(),
        dest_logradouro: String(d.logradouro || '').trim(),
        dest_numero: String(d.numero || '').trim(),
        dest_bairro: String(d.bairro || '').trim(),
        dest_municipio: String(d.municipio || '').trim(),
        dest_uf: String(d.uf || '').trim().toUpperCase(),
        dest_cep: nfeSomenteDigitos(d.cep),
        natureza_operacao: String(d.natureza || '').trim(),
        cfop: nfeSomenteDigitos(d.cfop)
    };
    payload[cnpj ? 'dest_cnpj' : 'dest_cpf'] = documento;
    const complemento = String(d.complemento || '').trim();
    if (complemento) payload.dest_complemento = complemento;

    const extrasCompletos = { ...extras };
    if (String(d.dados_adicionais || '').trim() && extrasCompletos.dados_adicionais === undefined) {
        extrasCompletos.dados_adicionais = String(d.dados_adicionais).trim();
    }
    NFE_CAMPOS_EXTRAS.forEach((campo) => {
        const valor = extrasCompletos[campo];
        if (valor !== undefined && valor !== null && valor !== '') payload[campo] = valor;
    });
    return payload;
}

// ---------------------------------------------------------------------------
// Interpretação das respostas do backend (sem regra fiscal: só apresentação)
// ---------------------------------------------------------------------------

function classificarResultadoEmissaoNfe(resp) {
    const httpStatus = resp ? resp.status : 0;
    const data = (resp && resp.data) || {};
    const status = String(data.status || '').toLowerCase();
    const codigo = String(data.codigo || data.code || '').toUpperCase();
    const base = {
        notaId: data.notaId || null,
        numero: data.numero != null ? data.numero : null,
        serie: data.serie != null ? data.serie : null,
        chave: data.chaveAcesso || data.chave || null,
        protocolo: data.protocolo || null,
        cStat: data.cStat || null,
        xMotivo: data.xMotivo || null,
        mensagem: nfeMensagemErro(data, ''),
        sugestao: data.sugestao || null
    };

    if (httpStatus === 403) {
        return { ...base, tipo: 'sem_permissao', mensagem: 'Você não tem permissão para emitir NF-e.', podeTentarNovamente: false };
    }
    if (data.success === true && status === 'autorizada') {
        return { ...base, tipo: 'autorizada', podeTentarNovamente: false };
    }
    if (status === 'rejeitada') {
        return { ...base, tipo: 'rejeitada', podeTentarNovamente: true };
    }
    const verificando = ['aguardando_retorno', 'lote_processamento', 'emitindo', 'transmitindo', 'erro_transmissao',
        'emissao_em_andamento', 'erro_comunicacao', 'timeout', 'servico_indisponivel', 'consulta_previa_falhou'];
    if (httpStatus === 409 || verificando.includes(status)
        || ['EMISSAO_EM_ANDAMENTO', 'LOTE_PROCESSAMENTO', 'CONSULTA_PREVIA_FALHOU'].includes(codigo)) {
        return { ...base, tipo: 'verificando', podeTentarNovamente: false };
    }
    if (status === 'nao_localizada_sefaz' || codigo === 'NFE_NAO_LOCALIZADA_SEFAZ') {
        return { ...base, tipo: 'erro', podeTentarNovamente: data.podeNovaTentativa !== false };
    }
    const bloqueios = ['denegada', 'cancelada', 'venda_cancelada', 'ambiente_bloqueado', 'modulo_desabilitado',
        'sem_itens', 'sem_itens_fiscais'];
    if (bloqueios.includes(status) || ['NFE_DENEGADA', 'NFE_CANCELADA', 'VENDA_CANCELADA', 'NFE_PRODUCAO_BLOQUEADA'].includes(codigo)) {
        return { ...base, tipo: 'bloqueada', podeTentarNovamente: false };
    }
    return {
        ...base,
        tipo: 'erro',
        mensagem: base.mensagem || 'Não foi possível emitir a NF-e.',
        podeTentarNovamente: true
    };
}

function situacaoNfeVenda(info) {
    if (!info) return 'indisponivel';
    const status = String(info.nota && info.nota.status || '').toLowerCase();
    if (info.acao === 'autorizada') return 'autorizada';
    if (info.acao === 'consultar') return 'verificando';
    if (status === 'cancelada') return 'cancelada';
    if (status === 'denegada') return 'denegada';
    if (info.acao === 'emitir_novamente') {
        if (status === 'rejeitada') return 'rejeitada';
        if (status === 'nao_localizada_sefaz') return 'nao_localizada';
        return 'falha';
    }
    if (info.acao === 'emitir') return 'sem_nfe';
    return 'indisponivel';
}

// ---------------------------------------------------------------------------
// Modais (container próprio para não sobrescrever o modal da venda)
// ---------------------------------------------------------------------------

function nfeContainerModais() {
    let container = document.getElementById('nfe-modal-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'nfe-modal-container';
        document.body.appendChild(container);
    }
    return container;
}

function nfeMostrarModal(id, html, aoFechar) {
    const anterior = document.getElementById(id);
    if (anterior) anterior.remove();
    nfeContainerModais().insertAdjacentHTML('beforeend', html);
    const el = document.getElementById(id);
    el.addEventListener('hidden.bs.modal', () => {
        el.remove();
        if (typeof aoFechar === 'function') aoFechar();
    });
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(el).show();
    }
    return el;
}

function nfeFecharModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal && bootstrap.Modal.getInstance(el)) {
        bootstrap.Modal.getInstance(el).hide();
    } else {
        el.remove();
    }
}

function nfeOcultarModalVenda() {
    const el = document.getElementById('vendaModal');
    if (el && typeof bootstrap !== 'undefined' && bootstrap.Modal && bootstrap.Modal.getInstance(el)) {
        bootstrap.Modal.getInstance(el).hide();
    }
}

function nfeReabrirVenda(vendaId) {
    if (!vendaId || typeof viewVenda !== 'function') return;
    const el = document.getElementById('vendaModal');
    const instancia = el && typeof bootstrap !== 'undefined' && bootstrap.Modal ? bootstrap.Modal.getInstance(el) : null;
    if (instancia && el.classList.contains('show')) {
        el.addEventListener('hidden.bs.modal', () => viewVenda(vendaId), { once: true });
        instancia.hide();
        return;
    }
    viewVenda(vendaId);
}

function nfeAtualizarTelasAposMudanca(vendaId) {
    nfeReabrirVenda(vendaId);
    nfeRecarregarSecaoAtual();
}

// ---------------------------------------------------------------------------
// Seção NF-e no modal da venda
// ---------------------------------------------------------------------------

function nfeBotao(rotulo, icone, classe, onclick, id, titulo) {
    const dica = titulo ? ` title="${nfeEsc(titulo)}" aria-label="${nfeEsc(titulo)}" data-acao="${nfeEsc(titulo)}"` : '';
    return `<button type="button" class="btn btn-sm ${classe}"${id ? ` id="${id}"` : ''}${dica} onclick="${onclick}">`
        + `<i class="fas ${icone}"></i> ${rotulo}</button>`;
}

function nfeHtmlSecaoVenda(venda) {
    if (!nfeRecursoHabilitado() || !venda || !venda.nfe) return '';
    const info = venda.nfe;
    const nota = info.nota || null;
    const vendaId = Number(venda.id);
    const podeEmitir = nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR);
    const podeCancelar = nfeUsuarioTemPermissao(NFE_PERMISSAO_CANCELAR);
    const situacao = situacaoNfeVenda(info);
    const notaId = nota ? Number(nota.id) : null;

    const botoes = [];
    const btnDanfe = () => nfeBotao('DANFE', 'fa-file-pdf', 'btn-outline-primary', `nfeAbrirDanfe(${notaId})`, 'btnNfeDanfeVenda');
    const btnXml = () => nfeBotao('XML', 'fa-file-code', 'btn-outline-secondary', `nfeBaixarXml(${notaId})`, 'btnNfeXmlVenda');
    const btnHistorico = () => nfeBotao('Histórico', 'fa-history', 'btn-outline-dark', `nfeAbrirHistorico(${notaId}, ${vendaId})`, 'btnNfeHistoricoVenda');
    const btnConsultar = (rotulo) => nfeBotao(rotulo, 'fa-search', 'btn-outline-info', `nfeConsultarSituacao(${notaId}, ${vendaId})`, 'btnNfeConsultarVenda');
    const btnEmitir = (rotulo) => nfeBotao(rotulo, 'fa-file-invoice', 'btn-primary', `abrirEmissaoNfe(${vendaId})`, 'btnEmitirNfeVenda');

    let alerta = '';
    const detalheNota = nota && nota.numero != null
        ? ` — nº <strong>${nfeEsc(nfeNumeroFormatado(nota.numero))}</strong> série ${nfeEsc(nota.serie)}`
        : '';
    const motivoSefaz = nota && (nota.cstat || nota.xmotivo)
        ? `<div class="small mt-1">${nota.cstat ? `cStat <strong>${nfeEsc(nota.cstat)}</strong> — ` : ''}${nfeEsc(nota.xmotivo || '')}</div>`
        : '';
    const mensagemNota = nota && nota.mensagem && !nota.xmotivo
        ? `<div class="small mt-1">${nfeEsc(nota.mensagem)}</div>` : '';
    const sugestaoNota = nota && nota.sugestao
        ? `<div class="small mt-1"><i class="fas fa-lightbulb"></i> ${nfeEsc(nota.sugestao)}</div>` : '';

    switch (situacao) {
        case 'autorizada':
            alerta = `<div class="alert alert-success py-2 mb-2"><i class="fas fa-check-circle"></i> NF-e autorizada${detalheNota}`
                + `${nota && nota.protocolo ? `<div class="small mt-1">Protocolo ${nfeEsc(nota.protocolo)}</div>` : ''}</div>`;
            botoes.push(btnDanfe(), btnXml());
            if (podeEmitir) botoes.push(btnConsultar('Consultar'));
            botoes.push(btnHistorico());
            if (podeCancelar) {
                botoes.push(nfeBotao('Cancelar NF-e', 'fa-ban', 'btn-outline-danger', `nfeAbrirCancelamento(${notaId}, ${vendaId})`, 'btnNfeCancelarVenda'));
            }
            break;
        case 'cancelada':
            alerta = `<div class="alert alert-secondary py-2 mb-2"><i class="fas fa-ban"></i> NF-e cancelada${detalheNota}</div>`;
            botoes.push(btnDanfe(), btnXml(), btnHistorico());
            break;
        case 'rejeitada':
            alerta = `<div class="alert alert-danger py-2 mb-2"><i class="fas fa-times-circle"></i> NF-e rejeitada pela SEFAZ${detalheNota}`
                + `${motivoSefaz}${mensagemNota}${sugestaoNota}</div>`;
            if (podeEmitir && info.pode_emitir) botoes.push(btnEmitir('Emitir novamente'));
            botoes.push(btnHistorico());
            break;
        case 'verificando':
            alerta = `<div class="alert alert-warning py-2 mb-2"><i class="fas fa-sync"></i> Consultando NF-e — `
                + `Estamos verificando a situação da NF-e.${detalheNota ? `<div class="small mt-1">NF-e${detalheNota}</div>` : ''}</div>`;
            if (podeEmitir && nota && nota.chave) botoes.push(btnConsultar('Consultar situação'));
            botoes.push(btnHistorico());
            break;
        case 'denegada':
            alerta = `<div class="alert alert-dark py-2 mb-2"><i class="fas fa-exclamation-triangle"></i> NF-e denegada pela SEFAZ${detalheNota}${motivoSefaz}</div>`;
            botoes.push(btnHistorico());
            break;
        case 'nao_localizada':
            alerta = `<div class="alert alert-warning py-2 mb-2"><i class="fas fa-question-circle"></i> NF-e anterior não localizada na SEFAZ${detalheNota}</div>`;
            if (podeEmitir && info.pode_emitir) botoes.push(btnEmitir('Emitir novamente'));
            botoes.push(btnHistorico());
            break;
        case 'falha':
            alerta = `<div class="alert alert-danger py-2 mb-2"><i class="fas fa-exclamation-circle"></i> NF-e não emitida (${nfeEsc(nfeRotuloStatus(nota && nota.status))})${detalheNota}`
                + `${motivoSefaz}${mensagemNota}${sugestaoNota}</div>`;
            if (podeEmitir && info.pode_emitir) botoes.push(btnEmitir('Emitir novamente'));
            if (notaId) botoes.push(btnHistorico());
            break;
        case 'sem_nfe':
            if (podeEmitir && info.pode_emitir) botoes.push(btnEmitir('Emitir NF-e'));
            break;
        default:
            break;
    }

    const avisoPermissao = !podeEmitir && info.pode_emitir
        ? `<div class="small text-muted mb-2" id="nfeSemPermissaoEmitir"><i class="fas fa-lock"></i> ${NFE_MSG_SEM_PERMISSAO}</div>`
        : '';

    if (!alerta && !botoes.length && !avisoPermissao) {
        if (!info.motivo_bloqueio) return '';
        return `<div class="nfe-secao-venda small text-muted mb-3" id="nfeSecaoVenda"><i class="fas fa-file-invoice"></i> NF-e: ${nfeEsc(info.motivo_bloqueio)}</div>`;
    }

    const ambiente = nota && nota.ambiente != null
        ? `<span class="badge bg-warning text-dark ms-2">${nfeEsc(nfeRotuloAmbiente(nota.ambiente))}</span>` : '';
    return `
        <div class="card border-primary-subtle mb-3 nfe-secao-venda" id="nfeSecaoVenda" data-recurso="nfe">
            <div class="card-body py-2">
                <div class="fw-semibold mb-2"><i class="fas fa-file-invoice"></i> NF-e (modelo 55)${ambiente}</div>
                ${alerta}
                ${avisoPermissao}
                <div class="d-flex flex-wrap gap-2">${botoes.join('')}</div>
            </div>
        </div>`;
}

// ---------------------------------------------------------------------------
// Emissão
// ---------------------------------------------------------------------------

function nfeCampo(id, rotulo, valor, opcoes = {}) {
    const col = opcoes.col || 'col-md-6';
    const extra = opcoes.attrs || '';
    return `
        <div class="${col}">
            <label class="form-label small mb-1" for="${id}">${rotulo}</label>
            <input type="text" class="form-control form-control-sm nfe-campo" id="${id}" value="${nfeEsc(valor)}" ${extra}>
            <div class="invalid-feedback" data-erro-para="${id}"></div>
        </div>`;
}

function nfeHtmlFormularioEmissao(venda, dados) {
    const ufOptions = ['<option value="">UF</option>']
        .concat(NFE_UFS.map((uf) => `<option value="${uf}"${dados.uf === uf ? ' selected' : ''}>${uf}</option>`))
        .join('');
    return `
        <div id="nfeEmissaoFormulario">
            <div class="alert alert-info py-2 small mb-3">
                <i class="fas fa-flask"></i> Emissões de NF-e liberadas somente em <strong>homologação</strong>.
                Os dados abaixo valem apenas para esta emissão e não alteram o cadastro do cliente.
            </div>
            <div id="nfeEmissaoErros" class="alert alert-danger py-2 small d-none"></div>
            <h6 class="border-bottom pb-1">Destinatário</h6>
            <div class="row g-2 mb-3">
                <div class="col-md-3">
                    <label class="form-label small mb-1" for="nfeDestTipo">Tipo</label>
                    <select class="form-select form-select-sm nfe-campo" id="nfeDestTipo">
                        <option value="CPF"${dados.tipo === 'CPF' ? ' selected' : ''}>CPF</option>
                        <option value="CNPJ"${dados.tipo === 'CNPJ' ? ' selected' : ''}>CNPJ</option>
                    </select>
                    <div class="invalid-feedback" data-erro-para="nfeDestTipo"></div>
                </div>
                ${nfeCampo('nfeDestDocumento', 'Documento', dados.documento, { col: 'col-md-4', attrs: 'inputmode="numeric" maxlength="18"' })}
                ${nfeCampo('nfeDestNome', 'Nome / Razão social', dados.nome, { col: 'col-md-5', attrs: 'maxlength="60"' })}
                ${nfeCampo('nfeDestIe', 'Inscrição Estadual', dados.inscricao_estadual, { col: 'col-md-4', attrs: 'maxlength="20" placeholder="Número, ISENTO ou em branco"' })}
            </div>
            <h6 class="border-bottom pb-1">Endereço</h6>
            <div class="row g-2 mb-3">
                ${nfeCampo('nfeDestLogradouro', 'Logradouro', dados.logradouro, { col: 'col-md-6', attrs: 'maxlength="60"' })}
                ${nfeCampo('nfeDestNumero', 'Número', dados.numero, { col: 'col-md-2', attrs: 'maxlength="60"' })}
                ${nfeCampo('nfeDestComplemento', 'Complemento', dados.complemento, { col: 'col-md-4', attrs: 'maxlength="60"' })}
                ${nfeCampo('nfeDestBairro', 'Bairro', dados.bairro, { col: 'col-md-4', attrs: 'maxlength="60"' })}
                ${nfeCampo('nfeDestMunicipio', 'Município', dados.municipio, { col: 'col-md-4', attrs: 'maxlength="60"' })}
                <div class="col-md-2">
                    <label class="form-label small mb-1" for="nfeDestUf">UF</label>
                    <select class="form-select form-select-sm nfe-campo" id="nfeDestUf">${ufOptions}</select>
                    <div class="invalid-feedback" data-erro-para="nfeDestUf"></div>
                </div>
                ${nfeCampo('nfeDestCep', 'CEP', dados.cep, { col: 'col-md-2', attrs: 'inputmode="numeric" maxlength="9"' })}
            </div>
            <h6 class="border-bottom pb-1">Operação</h6>
            <div class="row g-2 mb-2">
                ${nfeCampo('nfeNatureza', 'Natureza da operação', dados.natureza, { col: 'col-md-8', attrs: 'maxlength="60"' })}
                ${nfeCampo('nfeCfop', 'CFOP', dados.cfop, { col: 'col-md-4', attrs: 'inputmode="numeric" maxlength="4"' })}
                <div class="col-12">
                    <label class="form-label small mb-1" for="nfeDadosAdicionais">Informações complementares (opcional)</label>
                    <textarea class="form-control form-control-sm nfe-campo" id="nfeDadosAdicionais" rows="2" maxlength="500">${nfeEsc(dados.dados_adicionais || '')}</textarea>
                </div>
            </div>
        </div>
        <div id="nfeEmissaoProgresso" class="d-none"></div>
        <div id="nfeEmissaoResultado" class="d-none"></div>`;
}

const NFE_CAMPOS_FORMULARIO = {
    tipo: 'nfeDestTipo',
    documento: 'nfeDestDocumento',
    nome: 'nfeDestNome',
    inscricao_estadual: 'nfeDestIe',
    logradouro: 'nfeDestLogradouro',
    numero: 'nfeDestNumero',
    complemento: 'nfeDestComplemento',
    bairro: 'nfeDestBairro',
    municipio: 'nfeDestMunicipio',
    uf: 'nfeDestUf',
    cep: 'nfeDestCep',
    natureza: 'nfeNatureza',
    cfop: 'nfeCfop',
    dados_adicionais: 'nfeDadosAdicionais'
};

function nfeLerFormularioEmissao() {
    const dados = {};
    Object.keys(NFE_CAMPOS_FORMULARIO).forEach((campo) => {
        const el = document.getElementById(NFE_CAMPOS_FORMULARIO[campo]);
        dados[campo] = el ? String(el.value || '').trim() : '';
    });
    dados.uf = dados.uf.toUpperCase();
    return dados;
}

function nfeExibirErrosFormulario(erros) {
    document.querySelectorAll('#modalEmitirNfe .nfe-campo').forEach((el) => el.classList.remove('is-invalid'));
    const caixa = document.getElementById('nfeEmissaoErros');
    if (!caixa) return;
    if (!erros.length) {
        caixa.classList.add('d-none');
        caixa.innerHTML = '';
        return;
    }
    erros.forEach((erro) => {
        const id = erro.campo ? NFE_CAMPOS_FORMULARIO[erro.campo] : null;
        const el = id ? document.getElementById(id) : null;
        if (el) {
            el.classList.add('is-invalid');
            const fb = document.querySelector(`#modalEmitirNfe [data-erro-para="${id}"]`);
            if (fb) fb.textContent = erro.mensagem;
        }
    });
    caixa.innerHTML = `<ul class="mb-0 ps-3">${erros.map((e) => `<li>${nfeEsc(e.mensagem)}</li>`).join('')}</ul>`;
    caixa.classList.remove('d-none');
}

/**
 * Contexto do formulário de emissão aberto:
 * - venda: venda já existente → POST /nfe/vendas/:id/emitir;
 * - pedido / manual: nenhuma venda existe ainda. Só o "Confirmar emissão" fatura (venda, estoque,
 *   financeiro, pedido FATURADO) e emite, numa única requisição. Cancelar não chama o backend.
 */
let NFE_CONTEXTO_EMISSAO = null;
const NFE_MSG_SEM_EFEITO_ATE_CONFIRMAR = 'A venda só é registrada ao confirmar a emissão (baixa de estoque e financeiro, como qualquer venda). '
    + 'Cancelar este formulário não altera pedido, estoque nem financeiro.';

function nfeRotuloConfirmacao(contexto) {
    return contexto && contexto.tipo !== 'venda' ? 'Confirmar emissão' : 'Emitir NF-e';
}

function nfePodeAbrirEmissao() {
    if (!nfeRecursoHabilitado()) {
        nfeNotificar('Módulo NF-e desabilitado nesta implantação.', 'warning');
        return false;
    }
    if (!nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR)) {
        nfeNotificar('Você não tem permissão para emitir NF-e.', 'warning');
        return false;
    }
    if (NFE_EMISSAO_EM_CURSO) {
        nfeNotificar('Já existe uma emissão de NF-e em andamento.', 'warning');
        return false;
    }
    return true;
}

function nfeAbrirModalEmissao({ titulo, venda, possuiParcelaFiscal, contexto, aviso, complementoHtml, aoFechar }) {
    NFE_CONTEXTO_EMISSAO = { ...contexto };
    const dados = dadosIniciaisEmissaoNfe(venda);
    const vendaId = contexto.tipo === 'venda' ? Number(contexto.vendaId) : '';
    const html = `
        <div class="modal fade" id="modalEmitirNfe" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false"
             data-venda-id="${vendaId}" data-contexto="${nfeEsc(contexto.tipo)}" data-parcela-fiscal="${possuiParcelaFiscal ? '1' : '0'}" aria-labelledby="modalEmitirNfeLabel">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="modalEmitirNfeLabel">
                            <i class="fas fa-file-invoice"></i> Emitir NF-e — ${nfeEsc(titulo)}
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar" id="nfeBtnFecharX"></button>
                    </div>
                    <div class="modal-body">
                        ${aviso ? `<div class="alert alert-warning py-2 small mb-3" id="nfeAvisoFaturamento">${nfeEsc(aviso)}</div>` : ''}
                        ${complementoHtml || ''}
                        ${nfeHtmlFormularioEmissao(venda, dados)}
                    </div>
                    <div class="modal-footer" id="nfeEmissaoRodape">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="nfeBtnCancelarEmissao">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="btnConfirmarEmissaoNfe" onclick="confirmarEmissaoNfe()">
                            <i class="fas fa-paper-plane"></i> ${nfeRotuloConfirmacao(contexto)}
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

    const el = nfeMostrarModal('modalEmitirNfe', html, () => {
        const vendaFinal = Number(el.dataset.vendaId) || null;
        NFE_CONTEXTO_EMISSAO = null;
        if (typeof aoFechar === 'function') aoFechar({ vendaId: vendaFinal, houveMudanca: el.dataset.reabrirVenda === '1' });
    });
    el.addEventListener('hide.bs.modal', (ev) => {
        if (NFE_EMISSAO_EM_CURSO) ev.preventDefault();
    });
    return el;
}

async function abrirEmissaoNfe(vendaId) {
    const id = Number(vendaId);
    if (!nfePodeAbrirEmissao()) return;

    const prontidao = await nfeRequest('/nfe/prontidao');
    if (prontidao.ok && prontidao.data && prontidao.data.pronta === false) {
        nfeMostrarNaoPronta(prontidao.data, id);
        return;
    }

    const resp = await nfeRequest(`/vendas/${id}`);
    const venda = resp.data || {};
    if (!resp.ok || !venda.id) {
        nfeNotificar(nfeMensagemErro(resp.data, 'Não foi possível carregar a venda.'), 'danger');
        return;
    }
    if (!venda.nfe || !venda.nfe.pode_emitir) {
        const motivo = venda.nfe && venda.nfe.motivo_bloqueio;
        nfeNotificar(motivo ? `NF-e indisponível: ${motivo}` : 'NF-e indisponível para esta venda.', 'warning');
        return;
    }

    nfeOcultarModalVenda();
    nfeAbrirModalEmissao({
        titulo: `Venda #${venda.codigo || venda.id}`,
        venda,
        possuiParcelaFiscal: !!venda.nfe.possui_parcela_fiscal,
        contexto: { tipo: 'venda', vendaId: id },
        aoFechar: ({ houveMudanca }) => {
            if (houveMudanca) nfeAtualizarTelasAposMudanca(id);
            else nfeReabrirVenda(id);
        }
    });
}

/** Dados do destinatário no formato de venda (pré-preenchimento do formulário). */
function nfeVendaVirtualDoCliente(cliente) {
    const c = cliente || {};
    return {
        id: null,
        cliente_cpf: c.cpf_cnpj || c.cliente_documento || '',
        cliente_nome: c.nome || c.cliente_nome || '',
        cliente_inscricao_estadual: c.inscricao_estadual || c.cliente_inscricao_estadual || '',
        cliente_rua: c.rua || c.cliente_rua || '',
        cliente_numero: c.numero || c.cliente_numero || '',
        cliente_bairro: c.bairro || c.cliente_bairro || '',
        cliente_cidade: c.cidade || c.cliente_cidade || '',
        cliente_uf: c.uf || c.cliente_uf || '',
        cliente_cep: c.cep || c.cliente_cep || ''
    };
}

/**
 * Formulário NF-e de um pedido ABERTO. Abrir/cancelar não fatura: o pedido só vira venda
 * (e FATURADO) no "Confirmar emissão" (POST /pedidos/:id/emitir-nfe). Prontidão: checada pelo chamador.
 */
function nfeHtmlItensPedido(pedido) {
    const itens = (pedido && pedido.itens) || [];
    if (!itens.length) return '';
    const linhas = itens.map((item) => `
        <tr>
            <td>${nfeEsc(item.produto_nome || item.produto_id)}</td>
            <td class="text-end">${nfeEsc(item.quantidade)}</td>
            <td class="text-end">${typeof pedMoeda === 'function' ? pedMoeda(item.preco_unitario) : nfeEsc(item.preco_unitario)}</td>
            <td class="text-end">${typeof pedMoeda === 'function' ? pedMoeda(item.subtotal) : nfeEsc(item.subtotal)}</td>
        </tr>`).join('');
    return `
        <div class="mb-3" id="nfeItensPedidoOrigem">
            <div class="small text-muted mb-1">Origem: Pedido ${nfeEsc(pedido.codigo || `#${pedido.id}`)}. Valores gravados no pedido.</div>
            <table class="table table-sm mb-1">
                <thead><tr><th>Produto</th><th class="text-end">Qtd.</th><th class="text-end">Preço</th><th class="text-end">Subtotal</th></tr></thead>
                <tbody>${linhas}</tbody>
            </table>
            <div class="text-end small">Total do pedido: <strong>${typeof pedMoeda === 'function' ? pedMoeda(pedido.total) : nfeEsc(pedido.total)}</strong></div>
        </div>`;
}

function abrirEmissaoNfePedido(pedido, opcoes = {}) {
    const p = pedido || {};
    if (!nfePodeAbrirEmissao()) return null;
    return nfeAbrirModalEmissao({
        titulo: `Pedido ${p.codigo || `#${p.id}`}`,
        venda: { ...nfeVendaVirtualDoCliente(p), id: `pedido-${Number(p.id)}` },
        possuiParcelaFiscal: true,
        contexto: { tipo: 'pedido', pedidoId: Number(p.id) },
        aviso: NFE_MSG_SEM_EFEITO_ATE_CONFIRMAR,
        complementoHtml: nfeHtmlItensPedido(p),
        aoFechar: opcoes.aoFechar
    });
}

/**
 * Formulário NF-e de uma operação manual (itens já digitados). Nenhuma venda existe até o
 * "Confirmar emissão" (POST /nfe/manual/emitir); chave_operacao evita faturar duas vezes.
 */
function abrirEmissaoNfeManual(operacao, cliente, opcoes = {}) {
    if (!nfePodeAbrirEmissao()) return null;
    const chave = opcoes.chave || `nfe-manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return nfeAbrirModalEmissao({
        titulo: 'Emissão manual',
        venda: { ...nfeVendaVirtualDoCliente(cliente), id: chave },
        possuiParcelaFiscal: true,
        contexto: { tipo: 'manual', operacao: { ...operacao }, chave },
        aviso: NFE_MSG_SEM_EFEITO_ATE_CONFIRMAR,
        aoFechar: opcoes.aoFechar
    });
}

function nfeHtmlEtapas(estadoFinal) {
    const etapas = ['Preparando', 'Assinando', 'Enviando à SEFAZ', 'Aguardando retorno', 'Finalizando'];
    // Índice da última etapa concluída comprovada pela resposta real do backend.
    const concluidas = {
        autorizada: 5, rejeitada: 5, verificando: 2, erro: 0, bloqueada: 0, sem_permissao: 0
    };
    if (!estadoFinal) {
        return `
            <div class="d-flex align-items-center gap-2 mb-2">
                <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
                <strong>Processando no servidor…</strong>
            </div>
            <div class="small text-muted mb-2">
                Preparação, assinatura, envio à SEFAZ e retorno acontecem nesta mesma requisição.
                Aguarde a resposta; não feche o sistema.
            </div>
            <ul class="list-unstyled small mb-0">${etapas.map((e) => `<li class="text-muted"><i class="far fa-circle"></i> ${e}</li>`).join('')}</ul>`;
    }
    const n = concluidas[estadoFinal] != null ? concluidas[estadoFinal] : 0;
    return `<ul class="list-unstyled small mb-0">${etapas.map((e, i) => (i < n
        ? `<li class="text-success"><i class="fas fa-check"></i> ${e}</li>`
        : `<li class="text-muted"><i class="far fa-circle"></i> ${e}</li>`)).join('')}</ul>`;
}

function nfeDefinirEmissaoEmCurso(emCurso) {
    NFE_EMISSAO_EM_CURSO = emCurso;
    const btn = document.getElementById('btnConfirmarEmissaoNfe');
    if (btn) {
        btn.disabled = emCurso;
        btn.innerHTML = emCurso
            ? '<span class="spinner-border spinner-border-sm"></span> Emitindo NF-e...'
            : `<i class="fas fa-paper-plane"></i> ${nfeRotuloConfirmacao(NFE_CONTEXTO_EMISSAO)}`;
    }
    ['nfeBtnCancelarEmissao', 'nfeBtnFecharX', 'nfeBtnVoltarConferencia', 'nfeBtnManualContinuar', 'nfeManualBtnCancelarDoc'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = emCurso;
    });
    document.querySelectorAll('#modalEmitirNfe .nfe-campo').forEach((el) => { el.disabled = emCurso; });
    const conferenciaAberta = document.getElementById('nfeManualEtapaFiscal');
    const travarComercial = emCurso || (conferenciaAberta && !conferenciaAberta.hidden);
    document.querySelectorAll('.nfe-manual-comercial').forEach((el) => { el.disabled = travarComercial; });
}

/**
 * Resposta do "Confirmar emissão" de pedido/manual. Sem `status` do emissor, a recusa foi
 * anterior ao faturamento (validação, prontidão, operação em andamento): nada foi registrado.
 */
function classificarResultadoConfirmacaoNfe(resp) {
    const data = (resp && resp.data) || {};
    let r;
    if (data.status || (resp && resp.status === 403)) {
        r = classificarResultadoEmissaoNfe(resp);
    } else {
        const codigo = String(data.codigo || '').toUpperCase();
        const mensagem = nfeMensagemErro(data, 'Não foi possível confirmar a emissão.');
        if (codigo === 'NFE_NAO_PRONTA') {
            const pendencias = Array.isArray(data.pendencias) && data.pendencias.length
                ? `\n${data.pendencias.map((p) => `• ${p.mensagem || p}`).join('\n')}` : '';
            r = { tipo: 'bloqueada', mensagem: `${mensagem}${pendencias}`, podeTentarNovamente: false };
        } else if (['FATURAMENTO_EM_ANDAMENTO', 'OPERACAO_EM_ANDAMENTO', 'PEDIDO_NAO_ELEGIVEL', 'PEDIDO_NAO_ENCONTRADO'].includes(codigo)) {
            r = { tipo: 'bloqueada', mensagem, podeTentarNovamente: false };
        } else {
            r = { tipo: 'erro', mensagem, podeTentarNovamente: true };
        }
        r.mensagem = `${r.mensagem}\nNenhuma venda foi registrada.`;
    }
    if (data.faturamento_desfeito) {
        r.mensagem = `${r.mensagem || 'NF-e não emitida.'}\nA venda gerada nesta tentativa foi cancelada automaticamente `
            + '(estoque devolvido e financeiro estornado). Nada ficou faturado.';
    }
    if (data.codigo_desfazimento) {
        r.mensagem = `${r.mensagem || ''}\n${data.mensagem_desfazimento || 'Faturamento pendente de revisão.'}`;
        r.podeTentarNovamente = false;
    }
    return r;
}

function nfeRequisicaoConfirmacao(contexto, payload) {
    if (contexto.tipo === 'pedido') {
        return nfeRequest(`/pedidos/${Number(contexto.pedidoId)}/emitir-nfe`, { method: 'POST', body: { dados_nfe: payload } });
    }
    if (contexto.tipo === 'pedidos') {
        return nfeRequest('/nfe/pedidos/emitir', {
            method: 'POST',
            body: {
                pedido_ids: contexto.pedidoIds,
                itens_avulsos: contexto.itensAvulsos || [],
                forma_pagamento: contexto.operacao && contexto.operacao.forma_pagamento,
                dados_nfe: payload
            }
        });
    }
    if (contexto.tipo === 'manual') {
        return nfeRequest('/nfe/manual/emitir', {
            method: 'POST',
            body: { ...contexto.operacao, chave_operacao: contexto.chave, dados_nfe: payload }
        });
    }
    return nfeRequest(`/nfe/vendas/${Number(contexto.vendaId)}/emitir`, { method: 'POST', body: payload });
}

async function confirmarEmissaoNfe() {
    if (NFE_EMISSAO_EM_CURSO) return;
    const modal = document.getElementById('modalEmitirNfe');
    if (!modal) return;
    const contexto = NFE_CONTEXTO_EMISSAO || { tipo: 'venda', vendaId: Number(modal.dataset.vendaId) };
    const dados = nfeLerFormularioEmissao();
    const validacao = validarDadosEmissaoNfe(dados, {
        possuiParcelaFiscal: modal.dataset.parcelaFiscal === '1'
    });
    nfeExibirErrosFormulario(validacao.erros);
    if (!validacao.valido) return;

    const chaveDados = contexto.tipo === 'venda' ? contexto.vendaId
        : contexto.tipo === 'pedido' ? `pedido-${contexto.pedidoId}`
        : contexto.tipo === 'pedidos' ? `pedidos-${(contexto.pedidoIds || []).join('-')}`
        : contexto.chave;
    NFE_DADOS_DIGITADOS[String(chaveDados)] = { ...dados };
    const progresso = document.getElementById('nfeEmissaoProgresso');
    const resultado = document.getElementById('nfeEmissaoResultado');
    if (resultado) { resultado.classList.add('d-none'); resultado.innerHTML = ''; }
    if (progresso) { progresso.innerHTML = nfeHtmlEtapas(null); progresso.classList.remove('d-none'); }
    nfeDefinirEmissaoEmCurso(true);

    let resp;
    try {
        resp = await nfeRequisicaoConfirmacao(contexto, montarPayloadEmissaoNfe(dados));
    } finally {
        nfeDefinirEmissaoEmCurso(false);
    }

    const r = contexto.tipo === 'venda' ? classificarResultadoEmissaoNfe(resp) : classificarResultadoConfirmacaoNfe(resp);
    const data = (resp && resp.data) || {};
    let vendaId = contexto.tipo === 'venda' ? Number(contexto.vendaId) : null;
    if (contexto.tipo !== 'venda' && data.venda_id && !data.faturamento_desfeito) {
        // Venda faturada nesta confirmação: novas tentativas seguem pela venda existente, sem novo faturamento.
        vendaId = Number(data.venda_id);
        NFE_CONTEXTO_EMISSAO = { tipo: 'venda', vendaId };
        NFE_DADOS_DIGITADOS[String(vendaId)] = { ...dados };
        modal.dataset.vendaId = String(vendaId);
        modal.dataset.reabrirVenda = '1';
    }
    if (r.tipo === 'rejeitada' && r.notaId && !r.sugestao) {
        const det = await nfeRequest(`/nfe/notas/${r.notaId}`);
        if (det.ok && det.data && det.data.nota) r.sugestao = det.data.nota.erro_sugestao || null;
    }
    if (r.notaId || r.tipo === 'autorizada') modal.dataset.reabrirVenda = '1';
    if (progresso) progresso.innerHTML = nfeHtmlEtapas(r.tipo);
    nfeRenderResultadoEmissao(vendaId, r);
}

function nfeHtmlResultadoEmissao(r) {
    const linhaSefaz = (r.cStat || r.xMotivo)
        ? `<div><strong>cStat:</strong> ${nfeEsc(r.cStat || '—')} — <strong>xMotivo:</strong> ${nfeEsc(r.xMotivo || '—')}</div>` : '';
    const sugestao = r.sugestao ? `<div class="mt-1"><i class="fas fa-lightbulb"></i> ${nfeEsc(r.sugestao)}</div>` : '';
    switch (r.tipo) {
        case 'autorizada':
            return `
                <div class="alert alert-success mb-0" id="nfeResultadoAutorizada">
                    <h5 class="alert-heading"><i class="fas fa-check-circle"></i> NF-e autorizada</h5>
                    <div><strong>Número:</strong> ${nfeEsc(nfeNumeroFormatado(r.numero))}</div>
                    <div><strong>Série:</strong> ${nfeEsc(r.serie != null ? r.serie : '—')}</div>
                    <div><strong>Chave:</strong> <code>${nfeEsc(nfeChaveFormatada(r.chave))}</code></div>
                    <div><strong>Protocolo:</strong> ${nfeEsc(r.protocolo || '—')}</div>
                    <div class="small text-muted mt-2">A venda permanece concluída; a NF-e segue o próprio ciclo fiscal.</div>
                </div>`;
        case 'rejeitada':
            return `
                <div class="alert alert-danger mb-0" id="nfeResultadoRejeitada">
                    <h5 class="alert-heading"><i class="fas fa-times-circle"></i> NF-e rejeitada pela SEFAZ</h5>
                    ${linhaSefaz}${sugestao}
                    <div class="small text-muted mt-2">A nota rejeitada fica registrada no histórico. Corrija os dados e emita novamente.</div>
                </div>`;
        case 'verificando':
            return `
                <div class="alert alert-warning mb-0" id="nfeResultadoVerificando">
                    <h5 class="alert-heading"><i class="fas fa-sync"></i> Estamos verificando a situação da NF-e.</h5>
                    <div>${nfeEsc(r.mensagem || 'Aguardando o retorno da SEFAZ.')}</div>
                    <div class="small text-muted mt-2">Não emita novamente: consulte a situação para concluir.</div>
                </div>`;
        case 'sem_permissao':
            return `<div class="alert alert-danger mb-0" id="nfeResultadoErro">${nfeEsc(r.mensagem)}</div>`;
        default:
            return `
                <div class="alert ${r.tipo === 'bloqueada' ? 'alert-secondary' : 'alert-danger'} mb-0" id="nfeResultadoErro">
                    <h5 class="alert-heading"><i class="fas fa-exclamation-circle"></i> NF-e não emitida</h5>
                    <div style="white-space: pre-line">${nfeEsc(r.mensagem || 'Não foi possível emitir a NF-e.')}</div>
                    ${linhaSefaz}${sugestao}
                </div>`;
    }
}

function nfeRenderResultadoEmissao(vendaId, r) {
    const formulario = document.getElementById('nfeEmissaoFormulario');
    const resultado = document.getElementById('nfeEmissaoResultado');
    const rodape = document.getElementById('nfeEmissaoRodape');
    if (!resultado || !rodape) return;
    resultado.innerHTML = nfeHtmlResultadoEmissao(r);
    resultado.classList.remove('d-none');

    const fechar = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>';
    if (r.tipo === 'autorizada') {
        if (formulario) formulario.classList.add('d-none');
        rodape.innerHTML = `
            <button type="button" class="btn btn-outline-primary" onclick="nfeAbrirDanfe(${Number(r.notaId)})"><i class="fas fa-file-pdf"></i> DANFE</button>
            <button type="button" class="btn btn-outline-secondary" onclick="nfeBaixarXml(${Number(r.notaId)})"><i class="fas fa-file-code"></i> XML</button>
            ${fechar}`;
        nfeNotificar('NF-e autorizada.', 'success');
        return;
    }
    if (r.tipo === 'verificando') {
        if (formulario) formulario.classList.add('d-none');
        const consultar = r.notaId && nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR)
            ? `<button type="button" class="btn btn-info" id="nfeBtnConsultarResultado" onclick="nfeConsultarDoModalEmissao(${Number(r.notaId)}, ${Number(vendaId)})"><i class="fas fa-search"></i> Consultar situação</button>`
            : '';
        rodape.innerHTML = `${consultar}${fechar}`;
        return;
    }
    if (r.podeTentarNovamente) {
        if (formulario) formulario.classList.remove('d-none');
        rodape.innerHTML = `${fechar}
            <button type="button" class="btn btn-primary" id="btnConfirmarEmissaoNfe" onclick="confirmarEmissaoNfe()">
                <i class="fas fa-redo"></i> Corrigir / Emitir novamente
            </button>`;
        return;
    }
    if (formulario) formulario.classList.add('d-none');
    rodape.innerHTML = fechar;
}

async function nfeConsultarDoModalEmissao(notaId, vendaId) {
    const btn = document.getElementById('nfeBtnConsultarResultado');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Consultando...'; }
    const resp = await nfeRequest(`/nfe/notas/${Number(notaId)}/consultar`, { method: 'POST' });
    const data = resp.data || {};
    if (!resp.ok) {
        nfeNotificar(nfeMensagemPermissao(resp, 'Não foi possível consultar a NF-e.'), 'danger');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Consultar situação'; }
        return;
    }
    const status = String(data.status || '').toLowerCase();
    const r = classificarResultadoEmissaoNfe({
        status: 200,
        data: {
            ...data,
            success: status === 'autorizada',
            chaveAcesso: data.chave,
            notaId: data.notaId || notaId
        }
    });
    if (status === 'autorizada') {
        const det = await nfeRequest(`/nfe/notas/${Number(notaId)}`);
        if (det.ok && det.data && det.data.nota) {
            r.numero = det.data.nota.numero;
            r.serie = det.data.nota.serie;
        }
    }
    const progresso = document.getElementById('nfeEmissaoProgresso');
    if (progresso) progresso.innerHTML = nfeHtmlEtapas(r.tipo);
    nfeRenderResultadoEmissao(vendaId, r);
}

// ---------------------------------------------------------------------------
// Consulta, DANFE, XML
// ---------------------------------------------------------------------------

async function nfeConsultarSituacao(notaId, vendaId) {
    if (!nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR)) {
        nfeNotificar('Você não tem permissão para consultar a NF-e na SEFAZ.', 'warning');
        return null;
    }
    nfeNotificar('Consultando a situação da NF-e na SEFAZ...', 'info');
    const resp = await nfeRequest(`/nfe/notas/${Number(notaId)}/consultar`, { method: 'POST' });
    if (!resp.ok) {
        nfeNotificar(nfeMensagemPermissao(resp, 'Não foi possível consultar a NF-e.'), 'danger');
        return resp.data;
    }
    const data = resp.data || {};
    const partes = [`Situação: ${nfeRotuloStatus(data.status)}`];
    if (data.cStat) partes.push(`cStat ${data.cStat}`);
    if (data.xMotivo) partes.push(data.xMotivo);
    nfeNotificar(partes.join(' — '), data.status === 'autorizada' ? 'success' : 'info');
    nfeAtualizarTelasAposMudanca(vendaId);
    return data;
}

async function nfeAbrirDanfe(notaId) {
    const resp = await nfeRequest(`/nfe/notas/${Number(notaId)}/danfe`, { formato: 'text' });
    if (!resp.ok) {
        nfeNotificar(nfeMensagemErro(resp.data, 'DANFE não disponível para esta NF-e.'), 'warning');
        return false;
    }
    const janela = window.open('', '_blank', 'width=900,height=1000');
    if (!janela) {
        nfeNotificar('Permita pop-ups para visualizar o DANFE.', 'warning');
        return false;
    }
    janela.document.open();
    janela.document.write(resp.text);
    janela.document.close();
    janela.focus();
    return true;
}

async function nfeBaixarDanfePdf(notaId) {
    const resp = await nfeRequest(`/nfe/documentos/VENDA/${Number(notaId)}/pdf`, { formato: 'blob' });
    if (!resp.ok) {
        nfeNotificar(nfeMensagemErro(resp.data, 'PDF do DANFE não disponível.'), 'warning');
        return false;
    }
    nfeSalvarBlob(resp.blob, nfeNomeArquivo(resp.headers, `DANFE-NFe-${notaId}.pdf`));
    return true;
}

async function nfeBaixarXml(notaId) {
    const resp = await nfeRequest(`/nfe/notas/${Number(notaId)}/xml?download=1`, { formato: 'blob' });
    if (!resp.ok) {
        nfeNotificar(nfeMensagemErro(resp.data, 'XML não disponível para esta NF-e.'), 'warning');
        return false;
    }
    nfeSalvarBlob(resp.blob, nfeNomeArquivo(resp.headers, `NFe-${notaId}.xml`));
    return true;
}

function nfeNomeArquivo(headers, padrao) {
    const disp = headers && typeof headers.get === 'function' ? headers.get('Content-Disposition') : '';
    const m = String(disp || '').match(/filename="?([^";]+)"?/i);
    return m ? m[1] : padrao;
}

function nfeSalvarBlob(blob, nome) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Cancelamento
// ---------------------------------------------------------------------------

function validarJustificativaCancelamentoNfe(texto) {
    const limpo = String(texto || '').trim();
    if (limpo.length < NFE_JUSTIFICATIVA_MIN) {
        return { valido: false, erro: `A justificativa deve ter no mínimo ${NFE_JUSTIFICATIVA_MIN} caracteres.` };
    }
    if (typeof validarMotivoTexto === 'function') {
        const r = validarMotivoTexto(limpo);
        if (!r.valido) return { valido: false, erro: r.erro };
    }
    return { valido: true, erro: null };
}

function nfeAbrirCancelamento(notaId, vendaId) {
    if (!nfeUsuarioTemPermissao(NFE_PERMISSAO_CANCELAR)) {
        nfeNotificar('Você não tem permissão para cancelar NF-e.', 'warning');
        return;
    }
    nfeOcultarModalVenda();
    let alterou = false;
    const html = `
        <div class="modal fade" id="modalCancelarNfe" tabindex="-1" data-bs-backdrop="static" data-nota-id="${Number(notaId)}">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title"><i class="fas fa-ban"></i> Cancelar NF-e</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-warning py-2 small"><i class="fas fa-exclamation-triangle"></i> ${NFE_MSG_CANCELAMENTO}</div>
                        <label class="form-label small" for="nfeJustificativaCancelamento">Justificativa (mínimo ${NFE_JUSTIFICATIVA_MIN} caracteres)</label>
                        <textarea class="form-control" id="nfeJustificativaCancelamento" rows="3" maxlength="255"></textarea>
                        <div class="invalid-feedback" id="nfeJustificativaErro"></div>
                        <div id="nfeCancelamentoResultado" class="mt-2"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Voltar</button>
                        <button type="button" class="btn btn-danger" id="btnConfirmarCancelamentoNfe">Confirmar cancelamento</button>
                    </div>
                </div>
            </div>
        </div>`;
    const el = nfeMostrarModal('modalCancelarNfe', html, () => {
        if (alterou) nfeAtualizarTelasAposMudanca(vendaId);
        else nfeReabrirVenda(vendaId);
    });
    el.querySelector('#btnConfirmarCancelamentoNfe').addEventListener('click', async () => {
        const campo = document.getElementById('nfeJustificativaCancelamento');
        const v = validarJustificativaCancelamentoNfe(campo.value);
        campo.classList.toggle('is-invalid', !v.valido);
        document.getElementById('nfeJustificativaErro').textContent = v.erro || '';
        if (!v.valido) return;

        const btn = document.getElementById('btnConfirmarCancelamentoNfe');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Cancelando...';
        const resp = await nfeRequest(`/nfe/notas/${Number(notaId)}/cancelar`, {
            method: 'POST',
            body: { justificativa: campo.value.trim() }
        });
        const data = resp.data || {};
        const caixa = document.getElementById('nfeCancelamentoResultado');
        if (resp.ok && data.success) {
            alterou = true;
            caixa.innerHTML = `<div class="alert alert-success py-2 mb-0">NF-e cancelada.${data.protocoloCancelamento ? ` Protocolo ${nfeEsc(data.protocoloCancelamento)}` : ''}</div>`;
            btn.classList.add('d-none');
            nfeNotificar('NF-e cancelada.', 'success');
            return;
        }
        if (resp.ok) alterou = true;
        const msg = resp.ok
            ? `Cancelamento rejeitado pela SEFAZ (situação: ${nfeRotuloStatus(data.status)}).`
            : nfeMensagemPermissao(resp, 'Não foi possível cancelar a NF-e.');
        caixa.innerHTML = `<div class="alert alert-danger py-2 mb-0">${nfeEsc(msg)}</div>`;
        btn.disabled = false;
        btn.textContent = 'Confirmar cancelamento';
    });
}

// ---------------------------------------------------------------------------
// Detalhe + histórico
// ---------------------------------------------------------------------------

function nfeParseDetalhes(detalhes) {
    if (!detalhes) return {};
    if (typeof detalhes === 'object') return detalhes;
    try { return JSON.parse(detalhes); } catch (_) { return {}; }
}

function nfeHtmlEventoHistorico(ev) {
    const d = nfeParseDetalhes(ev.detalhes);
    const rotulo = NFE_EVENTO_LABEL[ev.acao] || String(ev.acao || 'Evento').replace(/_/g, ' ');
    const extras = [];
    if (d.status) extras.push(`Situação: ${nfeRotuloStatus(d.status)}`);
    if (d.cStat) extras.push(`cStat ${d.cStat}`);
    if (d.xMotivo) extras.push(d.xMotivo);
    if (d.protocolo) extras.push(`Protocolo ${d.protocolo}`);
    if (d.protocoloEvento) extras.push(`Protocolo do evento ${d.protocoloEvento}`);
    if (d.mensagem || d.erro) extras.push(d.mensagem || d.erro);
    return `
        <li class="list-group-item small">
            <div class="d-flex justify-content-between">
                <strong>${nfeEsc(rotulo)}</strong>
                <span class="text-muted">${nfeEsc(nfeDataHora(ev.criado_em))}</span>
            </div>
            ${extras.length ? `<div>${nfeEsc(extras.join(' — '))}</div>` : ''}
            ${ev.usuario_nome ? `<div class="text-muted">Usuário: ${nfeEsc(ev.usuario_nome)}</div>` : ''}
        </li>`;
}

function nfeHtmlLogOperacional(log) {
    return `
        <li class="list-group-item small">
            <div class="d-flex justify-content-between">
                <strong>${nfeEsc(String(log.acao || '').replace(/_/g, ' '))}</strong>
                <span class="text-muted">${nfeEsc(nfeDataHora(log.criado_em))}</span>
            </div>
            <div>${Number(log.sucesso) ? '<span class="text-success">Sucesso</span>' : '<span class="text-danger">Sem sucesso</span>'}
                ${log.cstat ? ` — cStat ${nfeEsc(log.cstat)}` : ''}
                ${log.tempo_resposta_ms ? ` — ${nfeEsc(log.tempo_resposta_ms)} ms` : ''}</div>
            ${log.usuario_nome ? `<div class="text-muted">Usuário: ${nfeEsc(log.usuario_nome)}</div>` : ''}
        </li>`;
}

async function nfeAbrirDetalhe(notaId, aoFechar) {
    const id = Number(notaId);
    const [respNota, respHist, respLogs] = await Promise.all([
        nfeRequest(`/nfe/notas/${id}`),
        nfeRequest(`/nfe/notas/${id}/historico`),
        nfeRequest(`/nfe/logs?notaId=${id}&limite=50`)
    ]);
    if (!respNota.ok || !respNota.data || !respNota.data.nota) {
        nfeNotificar(nfeMensagemErro(respNota.data, 'NF-e não encontrada.'), 'danger');
        return;
    }
    const nota = respNota.data.nota;
    const eventos = (respHist.ok && respHist.data && respHist.data.eventos) || [];
    const logs = (respLogs.ok && respLogs.data && respLogs.data.logs) || [];
    const status = String(nota.status || '').toLowerCase();
    const autorizada = status === 'autorizada' || status === 'cancelamento_rejeitado';

    const acoes = [];
    if (nota.tem_danfe) {
        acoes.push(nfeBotao('DANFE', 'fa-file-alt', 'btn-outline-primary', `nfeAbrirDanfe(${id})`));
        acoes.push(nfeBotao('DANFE (PDF)', 'fa-file-pdf', 'btn-outline-primary', `nfeBaixarDanfePdf(${id})`));
    }
    if (nota.tem_xml) acoes.push(nfeBotao('XML', 'fa-file-code', 'btn-outline-secondary', `nfeBaixarXml(${id})`));
    if (nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR) && nota.chave_acesso && status !== 'cancelada') {
        acoes.push(nfeBotao('Consultar', 'fa-search', 'btn-outline-info', `nfeFecharModal('modalDetalheNfe'); nfeConsultarSituacao(${id}, null)`));
    }
    if (autorizada && nfeUsuarioTemPermissao(NFE_PERMISSAO_CANCELAR)) {
        acoes.push(nfeBotao('Cancelar NF-e', 'fa-ban', 'btn-outline-danger', `nfeFecharModal('modalDetalheNfe'); nfeAbrirCancelamento(${id}, null)`));
    }

    const linha = (rotulo, valor) => `<div class="col-md-6"><strong>${rotulo}:</strong> ${valor}</div>`;
    const html = `
        <div class="modal fade" id="modalDetalheNfe" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="fas fa-file-invoice"></i> NF-e ${nfeEsc(nfeNumeroFormatado(nota.numero))} — série ${nfeEsc(nota.serie)}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row g-2 small mb-3">
                            ${linha('Situação', nfeBadgeStatus(status))}
                            ${linha('Ambiente', nfeEsc(nfeRotuloAmbiente(nota.ambiente)))}
                            ${linha('Venda', nota.venda_id ? `#${nfeEsc(nota.venda_codigo || nota.venda_id)}` : '—')}
                            ${(nota.pedidos_origem || []).length ? `<div class="col-12"><strong>Pedidos de origem:</strong> ${(nota.pedidos_origem || []).map((p) => `<button type="button" class="btn btn-link btn-sm p-0 me-2" onclick="pedAbrirPedido(${Number(p.id)})">${nfeEsc(p.codigo || ('#' + p.id))}</button>`).join('')}</div>` : ''}
                            ${linha('Cliente', nfeEsc(nota.cliente_nome || '—'))}
                            ${linha('Protocolo', nfeEsc(nota.protocolo || '—'))}
                            ${linha('Emitida em', nfeEsc(nfeDataHora(nota.created_at)))}
                            <div class="col-12"><strong>Chave:</strong> <code>${nfeEsc(nfeChaveFormatada(nota.chave_acesso))}</code></div>
                            ${nota.cstat_consulta || nota.xmotivo_consulta ? `<div class="col-12"><strong>Retorno SEFAZ:</strong> ${nfeEsc(nota.cstat_consulta || '')} ${nfeEsc(nota.xmotivo_consulta || '')}</div>` : ''}
                            ${nota.erro_mensagem ? `<div class="col-12 text-danger"><strong>Erro:</strong> ${nfeEsc(nota.erro_mensagem)}</div>` : ''}
                            ${nota.erro_sugestao ? `<div class="col-12"><strong>Sugestão:</strong> ${nfeEsc(nota.erro_sugestao)}</div>` : ''}
                            ${nota.protocolo_cancelamento ? `<div class="col-12"><strong>Protocolo de cancelamento:</strong> ${nfeEsc(nota.protocolo_cancelamento)}</div>` : ''}
                            ${nota.motivo_cancelamento ? `<div class="col-12"><strong>Justificativa do cancelamento:</strong> ${nfeEsc(nota.motivo_cancelamento)}</div>` : ''}
                        </div>
                        <div class="d-flex flex-wrap gap-2 mb-3">${acoes.join('')}</div>
                        <h6>Histórico</h6>
                        <ul class="list-group mb-3" id="nfeListaHistorico">
                            ${eventos.length ? eventos.map(nfeHtmlEventoHistorico).join('') : '<li class="list-group-item small text-muted">Nenhum evento registrado.</li>'}
                        </ul>
                        <h6>Registro operacional</h6>
                        <ul class="list-group" id="nfeListaLogs">
                            ${logs.length ? logs.map(nfeHtmlLogOperacional).join('') : '<li class="list-group-item small text-muted">Nenhum registro operacional.</li>'}
                        </ul>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>`;
    nfeMostrarModal('modalDetalheNfe', html, aoFechar);
}

async function nfeAbrirHistorico(notaId, vendaId) {
    if (vendaId) nfeOcultarModalVenda();
    await nfeAbrirDetalhe(notaId, vendaId ? () => nfeReabrirVenda(vendaId) : undefined);
    const historico = document.getElementById('nfeListaHistorico');
    if (historico && typeof historico.scrollIntoView === 'function') historico.scrollIntoView({ block: 'start' });
}

// ---------------------------------------------------------------------------
// Nova NF-e — emissão manual (origem MANUAL, sem pedido)
// Documento na página Fiscal › NF-e › Nova. A venda só é registrada no
// "Confirmar emissão" (POST /nfe/manual/emitir). Leitura comercial: pedidos.js
// (opcLerEditor, opcRecalcular, opcAdicionarItem). opcHtmlEditor não é usado aqui.
// ---------------------------------------------------------------------------

const NFE_MSG_MANUAL_VENDA = 'Continuar abre a conferência da NF-e e não registra nada. A operação só vira venda '
    + '(baixa de estoque e financeiro, como qualquer venda) quando você confirmar a emissão.';
let NFE_MANUAL_CADASTROS = null;
let NFE_MANUAL_DIAG = null;

function nfeManualItemProntidao(diag, id) {
    const itens = Array.isArray(diag && diag.itens) ? diag.itens : [];
    return itens.find((item) => item && item.id === id) || null;
}

/** Ambiente, série e próximo número já presentes em GET /api/nfe/prontidao. Não reserva número. */
function nfeManualMetaFiscal(diag) {
    const serieItem = nfeManualItemProntidao(diag, 'serie');
    const numeroItem = nfeManualItemProntidao(diag, 'numeracao');
    const serie = diag && diag.serie != null && diag.serie !== ''
        ? diag.serie
        : (serieItem && serieItem.valor != null && serieItem.valor !== '' ? serieItem.valor : null);
    const numeracao = diag && diag.numeracao != null && diag.numeracao !== ''
        ? diag.numeracao
        : (numeroItem && numeroItem.valor != null && numeroItem.valor !== '' ? numeroItem.valor : null);
    const amb = String((diag && diag.ambiente) || '');
    let ambiente = 'Não definido';
    let badge = 'cds-badge cds-badge--neutral';
    if (amb === '2') {
        ambiente = 'Homologação';
        badge = 'cds-badge cds-badge--warning';
    } else if (amb === '1') {
        ambiente = 'Produção';
        badge = 'cds-badge cds-badge--error';
    }
    return {
        ambiente,
        badge,
        serie: serie != null ? String(serie) : '—',
        numero: numeracao != null ? nfeNumeroFormatado(numeracao) : '—'
    };
}

function nfeFormatarNcm(ncm) {
    const digitos = nfeSomenteDigitos(ncm);
    if (digitos.length !== 8) return digitos || '—';
    return `${digitos.slice(0, 4)}.${digitos.slice(4, 6)}.${digitos.slice(6)}`;
}

function nfeManualHtmlCabecalho(diag) {
    const meta = nfeManualMetaFiscal(diag);
    return `
        <header class="nfe-manual-header">
            <div class="nfe-manual-header__texto">
                <div class="cds-eyebrow">NF-e</div>
                <h1 class="cds-page-title" id="modalNfeManualLabel">Nova emissão manual</h1>
                <p class="cds-subtitle">Documento Fiscal Eletrônico</p>
            </div>
            <div class="nfe-manual-meta" aria-label="Identificação fiscal">
                <span class="${meta.badge}" id="nfeManualAmbiente">${nfeEsc(meta.ambiente)}</span>
                <span class="nfe-manual-chip">Série <strong id="nfeManualSerie">${nfeEsc(meta.serie)}</strong></span>
                <span class="nfe-manual-chip">Nº <strong id="nfeManualNumero">${nfeEsc(meta.numero)}</strong></span>
            </div>
        </header>`;
}

function nfeManualHtmlPassos() {
    const passos = [
        ['1', 'Destinatário'],
        ['2', 'Produtos'],
        ['3', 'Informações'],
        ['4', 'Conferência fiscal']
    ];
    return `<ol class="nfe-manual-passos" id="nfeManualPassos">${passos.map(([n, rotulo]) => `
        <li id="nfePasso${n}" data-passo="${n}"><span>${n}</span> ${rotulo}</li>`).join('')}</ol>`;
}

function nfeManualHtmlLinha(produtos) {
    const select = typeof opcHtmlSelectProduto === 'function'
        ? opcHtmlSelectProduto('nfeManual', produtos || [], '', 'nfe-manual-comercial')
        : `<select class="opc-produto-oculto nfe-manual-comercial" data-campo="produto" tabindex="-1" aria-hidden="true" onchange="opcAoTrocarProduto(this, 'nfeManual')">${typeof opcHtmlOpcoesProdutos === 'function' ? opcHtmlOpcoesProdutos(produtos || []) : '<option value="">Selecione...</option>'}</select>`;
    return `
        <tr data-opc-item>
            <td data-nfe-codigo class="nfe-manual-ro">—</td>
            <td class="nfe-manual-produto"><span data-nfe-nome>—</span>${select}</td>
            <td data-nfe-ncm class="nfe-manual-ro">—</td>
            <td data-nfe-un class="nfe-manual-ro">—</td>
            <td><input type="text" inputmode="decimal" class="form-control form-control-sm nfe-manual-comercial" data-campo="quantidade" value="1" oninput="opcRecalcular('nfeManual')"></td>
            <td><input type="text" inputmode="decimal" class="form-control form-control-sm nfe-manual-comercial" data-campo="preco" value="" oninput="opcRecalcular('nfeManual')"></td>
            <td class="text-end nfe-manual-moeda" data-campo="subtotal">—</td>
            <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger nfe-manual-comercial" onclick="opcRemoverItem(this, 'nfeManual')" title="Remover item" aria-label="Remover item"><i class="fas fa-trash"></i></button></td>
        </tr>`;
}

function nfeHtmlDocumentoManual(diag, cadastros) {
    const clientes = (cadastros.clientes || []).map((c) => `
        <option value="${Number(c.id)}" data-doc="${nfeEsc(nfeSomenteDigitos(c.cpf_cnpj || ''))}">
            ${nfeEsc(c.nome)}${c.cpf_cnpj ? ` — ${nfeEsc(c.cpf_cnpj)}` : ''}
        </option>`).join('');
    const formas = (typeof OPC_FORMAS_PAGAMENTO !== 'undefined' ? OPC_FORMAS_PAGAMENTO : [
        ['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['cartao_credito', 'Cartão de crédito'],
        ['cartao_debito', 'Cartão de débito'], ['prazo', 'A prazo']
    ]).map(([v, r]) => `<option value="${v}"${v === 'dinheiro' ? ' selected' : ''}>${r}</option>`).join('');
    return `
        <div data-estado="data" id="nfeNovaPainel" data-situacao="pronta" class="nfe-manual">
            ${nfeManualHtmlCabecalho(diag)}
            <div class="cds-alert cds-alert--success nfe-manual-status" id="nfeNovaStatus" role="status">
                <div><strong>✓ NF-e pronta para emissão.</strong>
                <span class="nfe-manual-status__amb">Ambiente: ${nfeEsc(nfeRotuloAmbienteNfe(diag))}.</span></div>
            </div>
            <div class="cds-alert cds-alert--info" id="nfeNovaAviso">${NFE_MSG_NOVA_SEM_EFEITO}</div>
            <div id="modalNfeManual">
                <div id="modalEmitirNfe" data-contexto="manual" data-parcela-fiscal="1" data-venda-id="" data-nfe-pagina="1">
                    <div id="nfeEmissaoFormulario">
                        ${nfeManualHtmlPassos()}
                        <div class="alert alert-danger d-none py-2" id="nfeManualErros"></div>
                        <div class="row g-3 nfe-manual-layout">
                            <div class="col-12 col-lg-8 col-xl-9 nfe-manual-principal">
                                <section class="cds-card nfe-manual-secao" id="nfeSecaoDestinatario">
                                    <div class="cds-card__header">
                                        <div>
                                            <h2 class="cds-card__title">01 — Destinatário</h2>
                                            <p class="cds-card__subtitle">Informe o cliente que receberá a NF-e.</p>
                                        </div>
                                    </div>
                                    <div class="cds-card__body">
                                        <label class="cds-label" for="nfeManualBusca">Buscar cliente</label>
                                        <input type="search" class="form-control form-control-sm nfe-manual-comercial" id="nfeManualBusca" placeholder="Nome, CPF ou CNPJ" oninput="nfeManualFiltrarClientes()" autocomplete="off">
                                        <p class="cds-helper" id="nfeManualBuscaResultado"></p>
                                        <label class="cds-label nfe-manual-label" for="nfeManualCliente">Cliente</label>
                                        <select class="form-select form-select-sm nfe-manual-comercial" id="nfeManualCliente" onchange="nfeManualAoSelecionarCliente()">
                                            <option value="">Selecione o cliente...</option>${clientes}
                                        </select>
                                        <p class="cds-helper" id="nfeManualFichaVazia">Selecione um cliente para identificar o destinatário.</p>
                                        <article class="nfe-manual-ficha" id="nfeManualFicha" hidden>
                                            <h3 id="nfeManualFichaNome">—</h3>
                                            <p id="nfeManualFichaDoc">CPF/CNPJ: —</p>
                                            <p id="nfeManualFichaIe">IE: —</p>
                                            <p id="nfeManualFichaEndereco">—</p>
                                            <p id="nfeManualFichaCidade">—</p>
                                        </article>
                                        <div class="nfe-manual-endereco" id="nfeManualEndereco">
                                            <div class="row g-2">
                                                <div class="col-md-3">
                                                    <label class="cds-label" for="nfeDestTipo">Tipo</label>
                                                    <select class="form-select form-select-sm nfe-campo" id="nfeDestTipo">
                                                        <option value="CPF">CPF</option>
                                                        <option value="CNPJ">CNPJ</option>
                                                    </select>
                                                    <div class="invalid-feedback" data-erro-para="nfeDestTipo"></div>
                                                </div>
                                                ${nfeCampo('nfeDestDocumento', 'CPF / CNPJ', '', { col: 'col-md-4', attrs: 'inputmode="numeric" maxlength="18"' })}
                                                ${nfeCampo('nfeDestNome', 'Nome / Razão social', '', { col: 'col-md-5', attrs: 'maxlength="60"' })}
                                                ${nfeCampo('nfeDestIe', 'Inscrição Estadual', '', { col: 'col-md-4', attrs: 'maxlength="20" placeholder="Número, ISENTO ou em branco"' })}
                                                ${nfeCampo('nfeDestLogradouro', 'Endereço', '', { col: 'col-md-6', attrs: 'maxlength="60"' })}
                                                ${nfeCampo('nfeDestNumero', 'Número', '', { col: 'col-md-2', attrs: 'maxlength="60"' })}
                                                ${nfeCampo('nfeDestComplemento', 'Complemento', '', { col: 'col-md-4', attrs: 'maxlength="60"' })}
                                                ${nfeCampo('nfeDestBairro', 'Bairro', '', { col: 'col-md-4', attrs: 'maxlength="60"' })}
                                                ${nfeCampo('nfeDestMunicipio', 'Cidade', '', { col: 'col-md-4', attrs: 'maxlength="60"' })}
                                                <div class="col-md-2">
                                                    <label class="cds-label" for="nfeDestUf">UF</label>
                                                    <select class="form-select form-select-sm nfe-campo" id="nfeDestUf">
                                                        <option value="">UF</option>
                                                        ${NFE_UFS.map((uf) => `<option value="${uf}">${uf}</option>`).join('')}
                                                    </select>
                                                    <div class="invalid-feedback" data-erro-para="nfeDestUf"></div>
                                                </div>
                                                ${nfeCampo('nfeDestCep', 'CEP', '', { col: 'col-md-2', attrs: 'inputmode="numeric" maxlength="9"' })}
                                            </div>
                                        </div>
                                    </div>
                                </section>
                                <section class="cds-card nfe-manual-secao" id="nfeSecaoProdutos">
                                    <div class="cds-card__header">
                                        <div>
                                            <h2 class="cds-card__title">02 — Produtos</h2>
                                            <p class="cds-card__subtitle">Produtos da NF-e</p>
                                        </div>
                                        <div class="nfe-manual-produtos-acoes">
                                            <span class="cds-badge cds-badge--neutral" id="nfeManualContador">0 itens</span>
                                            <button type="button" class="btn btn-sm btn-outline-secondary nfe-manual-comercial" id="nfeManualBtnImportarPedido" onclick="nfeAbrirImportarPedido()"><i class="fas fa-file-import"></i> Importar pedido</button>
                                            <button type="button" class="btn btn-sm btn-outline-primary nfe-manual-comercial" id="nfeManualBtnAdicionar" onclick="nfeManualAdicionarProduto()"><i class="fas fa-plus"></i> Adicionar produto</button>
                                        </div>
                                    </div>
                                    <div class="cds-card__body">
                                        <div id="nfePedidosOrigem" class="d-flex flex-wrap gap-2 mb-2"></div>
                                        <div id="nfeManualEditor" data-opc-editor>
                                            ${typeof opcHtmlBarraProduto === 'function' ? opcHtmlBarraProduto('nfe-manual-comercial') : ''}
                                            <div class="nfe-manual-vazio" id="nfeManualVazio">
                                                <p>Nenhum produto adicionado.</p>
                                                <p>Comece digitando para adicionar o primeiro produto.</p>
                                            </div>
                                            <div class="nfe-manual-grade cds-table-wrap" id="nfeManualGrade" hidden>
                                                <table class="table table-sm align-middle cds-table cds-table--compact mb-0">
                                                    <thead><tr>
                                                        <th>Código</th><th>Produto</th><th>NCM</th><th>Un.</th>
                                                        <th>Quantidade</th><th>Preço</th><th class="text-end">Subtotal</th><th class="text-end">Ação</th>
                                                    </tr></thead>
                                                    <tbody id="nfeManualItens"></tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                                <section class="cds-card nfe-manual-secao" id="nfeSecaoFiscal">
                                    <div class="cds-card__header">
                                        <div>
                                            <h2 class="cds-card__title">03 — Informações fiscais</h2>
                                            <p class="cds-card__subtitle">Natureza, CFOP e informações complementares desta emissão.</p>
                                        </div>
                                    </div>
                                    <div class="cds-card__body">
                                        <div class="row g-2">
                                            ${nfeCampo('nfeNatureza', 'Natureza da operação', NFE_NATUREZA_PADRAO, { col: 'col-md-8', attrs: 'maxlength="60"' })}
                                            ${nfeCampo('nfeCfop', 'CFOP', NFE_CFOP_PADRAO, { col: 'col-md-4', attrs: 'inputmode="numeric" maxlength="4"' })}
                                            <div class="col-12">
                                                <label class="cds-label" for="nfeDadosAdicionais">Informações complementares</label>
                                                <textarea class="form-control form-control-sm nfe-campo" id="nfeDadosAdicionais" rows="3" maxlength="500"></textarea>
                                                <p class="cds-helper">Até 500 caracteres. Opcional.</p>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                            <div class="col-12 col-lg-4 col-xl-3">
                                <aside class="cds-card nfe-manual-resumo" id="nfeManualResumo">
                                    <div class="cds-card__header"><h2 class="cds-card__title">Resumo da NF-e</h2></div>
                                    <div class="cds-card__body">
                                        <div class="nfe-manual-resumo__linha"><span>Subtotal</span><strong id="nfeManualSubtotalExibicao">R$ 0,00</strong></div>
                                        <label class="cds-label" for="nfeManualDesconto">Desconto (R$)</label>
                                        <input type="number" min="0" step="0.01" class="form-control form-control-sm nfe-manual-comercial" id="nfeManualDesconto" value="0" oninput="opcRecalcular('nfeManual')">
                                        <div class="nfe-manual-resumo__linha" id="nfeManualDescontoLinha"><span>Desconto</span><strong id="nfeManualDescontoExibicao">R$ 0,00</strong></div>
                                        <hr class="nfe-manual-resumo__divisor">
                                        <div class="nfe-manual-resumo__total">
                                            <span>TOTAL DA NF-e</span>
                                            <strong id="nfeManualTotal">—</strong>
                                        </div>
                                        <label class="cds-label nfe-manual-label" for="nfeManualForma">Pagamento</label>
                                        <select class="form-select form-select-sm nfe-manual-comercial" id="nfeManualForma" onchange="opcRecalcular('nfeManual')">${formas}</select>
                                        <div id="nfeManualParcelasGrupo" class="d-none">
                                            <label class="cds-label nfe-manual-label" for="nfeManualParcelas">Parcelas</label>
                                            <input type="number" min="1" step="1" class="form-control form-control-sm nfe-manual-comercial" id="nfeManualParcelas" value="1">
                                        </div>
                                    </div>
                                </aside>
                            </div>
                        </div>
                        <section class="cds-card nfe-manual-secao nfe-manual-conferencia" id="nfeManualEtapaFiscal" hidden>
                            <div class="cds-card__header">
                                <div>
                                    <h2 class="cds-card__title">04 — Conferência fiscal</h2>
                                    <p class="cds-card__subtitle">Confira o destinatário e a operação. A emissão só acontece em Confirmar emissão.</p>
                                </div>
                            </div>
                            <div class="cds-card__body">
                                <div id="nfeEmissaoErros" class="alert alert-danger py-2 small d-none"></div>
                                <div id="nfeAvisoFaturamento" class="cds-alert cds-alert--warning">${nfeEsc(NFE_MSG_SEM_EFEITO_ATE_CONFIRMAR)}</div>
                                <div id="nfeEmissaoProgresso" class="d-none"></div>
                                <div id="nfeEmissaoResultado" class="d-none"></div>
                            </div>
                        </section>
                    </div>
                    <footer class="nfe-manual-rodape" id="nfeEmissaoRodape">
                        <div id="nfeManualStatusPasso" class="nfe-manual-status-passo">Preencha o destinatário e os produtos.</div>
                        <div class="nfe-manual-acoes">
                            <button type="button" class="btn btn-secondary cds-btn cds-btn--secondary cds-btn--md" id="nfeManualBtnCancelarDoc" onclick="nfeManualCancelarDocumento()">Cancelar</button>
                            <button type="button" class="btn btn-primary cds-btn cds-btn--primary cds-btn--md" id="nfeBtnManualContinuar" onclick="confirmarNfeManual()"><i class="fas fa-arrow-right"></i> Continuar para emissão</button>
                            <button type="button" class="btn btn-secondary cds-btn cds-btn--secondary cds-btn--md" id="nfeBtnVoltarConferencia" hidden onclick="nfeManualVoltarConferencia()">Voltar</button>
                            <button type="button" class="btn btn-secondary cds-btn cds-btn--secondary cds-btn--md" id="nfeBtnCancelarEmissao" hidden onclick="nfeManualCancelarEmissao()">Cancelar emissão</button>
                            <button type="button" class="btn btn-primary cds-btn cds-btn--primary cds-btn--md" id="btnConfirmarEmissaoNfe" hidden onclick="confirmarEmissaoNfe()"><i class="fas fa-paper-plane"></i> Confirmar emissão</button>
                        </div>
                    </footer>
                </div>
            </div>
        </div>`;
}

function nfeManualHost() {
    const existente = document.getElementById('nfeSecaoConteudo');
    if (existente) return existente;
    const page = document.getElementById('page-content');
    if (!page) return null;
    page.innerHTML = `
        <div class="card shadow-sm" id="nfe-pagina" data-secao="nova">
            <div class="card-body"><div id="nfeSecaoConteudo"></div></div>
        </div>`;
    return document.getElementById('nfeSecaoConteudo');
}

function nfeMontarDocumentoManual(diag, cadastros) {
    const host = nfeManualHost();
    if (!host) return;
    NFE_MANUAL_CADASTROS = cadastros;
    NFE_MANUAL_DIAG = diag || null;
    NFE_CONTEXTO_EMISSAO = null;
    host.innerHTML = nfeHtmlDocumentoManual(diag || {}, cadastros || { clientes: [], produtos: [] });
    nfeManualPreparar(cadastros);
    const cancelarEmissao = document.getElementById('nfeBtnCancelarEmissao');
    if (cancelarEmissao) cancelarEmissao.addEventListener('click', () => nfeManualCancelarEmissao());
}

function nfeManualPreparar(cadastros) {
    if (typeof opcPrepararEditor === 'function') opcPrepararEditor('nfeManual', cadastros);
    const corpo = document.getElementById('nfeManualItens');
    if (corpo) {
        corpo.addEventListener('change', (ev) => {
            const campo = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-campo');
            if (campo === 'produto') nfeManualAtualizarLinhaFiscal(ev.target.closest('tr'));
        });
        corpo.addEventListener('input', () => nfeManualAtualizarResumo());
        corpo.addEventListener('click', () => nfeManualAtualizarResumo());
    }
    const editor = document.getElementById('nfeManualEditor');
    if (editor) editor.addEventListener('input', () => nfeManualAtualizarResumo());
    const resumo = document.getElementById('nfeManualResumo');
    if (resumo) resumo.addEventListener('input', () => nfeManualAtualizarResumo());
    const forma = document.getElementById('nfeManualForma');
    if (forma) forma.addEventListener('change', () => nfeManualAtualizarResumo());
    nfeManualEnriquecerLinhas();
    nfeManualAtualizarResumo();
    nfeManualMarcarPassos('comercial');
}

function nfeManualProdutoDaLinha(tr) {
    if (!tr) return null;
    const sel = tr.querySelector('[data-campo="produto"]');
    const id = Number(sel && sel.value);
    if (!id) return null;
    return (opcProdutos('nfeManual') || []).find((p) => Number(p.id) === id) || null;
}

function nfeManualAtualizarLinhaFiscal(tr) {
    if (!tr || !tr.querySelector('[data-nfe-codigo]')) return;
    const produto = nfeManualProdutoDaLinha(tr);
    const codigo = tr.querySelector('[data-nfe-codigo]');
    const ncm = tr.querySelector('[data-nfe-ncm]');
    const un = tr.querySelector('[data-nfe-un]');
    const nome = tr.querySelector('[data-nfe-nome]');
    if (codigo) codigo.textContent = produto ? (produto.codigo || String(produto.id)) : '—';
    if (nome) nome.textContent = produto ? (produto.nome || '—') : '—';
    if (ncm) ncm.textContent = produto ? nfeFormatarNcm(produto.ncm) : '—';
    if (un) un.textContent = produto ? (produto.unidade || 'UN') : '—';
}

function nfeManualEnriquecerLinhas() {
    document.querySelectorAll('#nfeManualItens tr[data-opc-item]').forEach((tr) => {
        if (tr.querySelector('[data-nfe-codigo]')) {
            nfeManualAtualizarLinhaFiscal(tr);
            tr.querySelectorAll('[data-opc-busca-input]').forEach((el) => el.classList.add('nfe-manual-comercial'));
            return;
        }
        const produtoTd = tr.querySelector('[data-campo="produto"]');
        if (!produtoTd) return;
        const celulaProduto = produtoTd.closest('td');
        const codigo = document.createElement('td');
        codigo.setAttribute('data-nfe-codigo', '');
        codigo.className = 'nfe-manual-ro';
        const ncm = document.createElement('td');
        ncm.setAttribute('data-nfe-ncm', '');
        ncm.className = 'nfe-manual-ro';
        const un = document.createElement('td');
        un.setAttribute('data-nfe-un', '');
        un.className = 'nfe-manual-ro';
        celulaProduto.before(codigo);
        celulaProduto.after(ncm);
        ncm.after(un);
        produtoTd.classList.add('nfe-manual-comercial');
        tr.querySelectorAll('[data-opc-busca-input], [data-campo="quantidade"], [data-campo="preco"]').forEach((el) => el.classList.add('nfe-manual-comercial'));
        const remover = tr.querySelector('button');
        if (remover) remover.classList.add('nfe-manual-comercial');
        nfeManualAtualizarLinhaFiscal(tr);
    });
}

function nfeManualRotuloItens(qtd) {
    const n = Number(qtd) || 0;
    return n === 1 ? '1 item' : `${n} itens`;
}

function nfeManualAtualizarResumo() {
    if (typeof opcLerEditor !== 'function' || typeof opcTotais !== 'function') return;
    const dados = opcLerEditor('nfeManual');
    const totais = opcTotais(dados);
    const moeda = typeof pedMoeda === 'function'
        ? pedMoeda
        : (valor) => `R$ ${(Number(valor) || 0).toFixed(2).replace('.', ',')}`;
    const subtotal = document.getElementById('nfeManualSubtotalExibicao');
    const desconto = document.getElementById('nfeManualDescontoExibicao');
    if (subtotal) subtotal.textContent = moeda(totais.totalItens);
    if (desconto) desconto.textContent = moeda(totais.desconto);
    const preenchidos = (dados.itens || []).filter((item) => item.produto_id).length;
    const contador = document.getElementById('nfeManualContador');
    if (contador) contador.textContent = nfeManualRotuloItens(preenchidos);
    document.querySelectorAll('#nfeManualItens tr[data-opc-item]').forEach((tr) => nfeManualAtualizarLinhaFiscal(tr));
    nfeManualAtualizarStatus();
}

function nfeManualAtualizarStatus() {
    const el = document.getElementById('nfeManualStatusPasso');
    if (!el || typeof opcValidarDados !== 'function') return;
    const fiscal = document.getElementById('nfeManualEtapaFiscal');
    if (fiscal && !fiscal.hidden) {
        el.textContent = 'Conferência fiscal. Nada é registrado até Confirmar emissão.';
        return;
    }
    const erros = opcValidarDados(opcLerEditor('nfeManual'));
    el.textContent = erros.length ? 'Preencha o destinatário e os produtos.' : '✓ Dados comerciais preenchidos';
}

function nfeManualMarcarPassos(etapa) {
    ['1', '2', '3', '4'].forEach((n) => {
        const el = document.getElementById(`nfePasso${n}`);
        if (!el) return;
        const fiscal = etapa === 'fiscal';
        el.classList.toggle('is-done', fiscal && n !== '4');
        el.classList.toggle('is-current', fiscal ? n === '4' : n !== '4');
    });
}

function nfeManualNormalizarBusca(valor) {
    return String(valor || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function nfeManualClienteCasaBusca(cliente, termo, digitos) {
    if (!termo) return true;
    const nome = nfeManualNormalizarBusca(cliente && cliente.nome);
    const documento = String((cliente && cliente.cpf_cnpj) || '');
    const doc = nfeSomenteDigitos(documento);
    return nome.includes(termo)
        || nfeManualNormalizarBusca(documento).includes(termo)
        || (digitos.length > 0 && doc.includes(digitos));
}

function nfeManualOpcaoCliente(cliente) {
    const option = document.createElement('option');
    option.value = String(Number(cliente.id));
    option.setAttribute('data-doc', nfeSomenteDigitos(cliente.cpf_cnpj || ''));
    option.textContent = `${cliente.nome || ''}${cliente.cpf_cnpj ? ` — ${cliente.cpf_cnpj}` : ''}`;
    return option;
}

/** O select nativo ignora option.hidden. A lista é refeita a partir dos clientes já carregados. */
function nfeManualFiltrarClientes() {
    const busca = document.getElementById('nfeManualBusca');
    const select = document.getElementById('nfeManualCliente');
    if (!busca || !select) return;
    const termo = nfeManualNormalizarBusca(busca.value);
    const digitos = nfeSomenteDigitos(termo);
    const selecionado = select.value;
    const clientes = (NFE_MANUAL_CADASTROS && NFE_MANUAL_CADASTROS.clientes) || [];
    const filtrados = clientes.filter((cliente) => nfeManualClienteCasaBusca(cliente, termo, digitos));
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = termo && !filtrados.length
        ? 'Nenhum cliente encontrado'
        : 'Selecione o cliente...';
    select.replaceChildren(placeholder, ...filtrados.map(nfeManualOpcaoCliente));
    const aindaExiste = filtrados.some((cliente) => String(cliente.id) === String(selecionado));
    select.value = aindaExiste ? String(selecionado) : '';
    /* size 1 esconde o único resultado atrás do placeholder. A lista precisa caber o cliente. */
    select.size = !termo || !filtrados.length ? 1 : Math.min(filtrados.length + 1, 8);
    const ajuda = document.getElementById('nfeManualBuscaResultado');
    if (ajuda) {
        if (!termo) ajuda.textContent = '';
        else if (!filtrados.length) ajuda.textContent = 'Nenhum cliente encontrado para essa busca.';
        else ajuda.textContent = filtrados.length === 1
            ? '1 cliente encontrado.'
            : `${filtrados.length} clientes encontrados.`;
    }
    if (selecionado && !aindaExiste) {
        nfeManualMostrarFicha(null);
        nfeManualAtualizarStatus();
    }
}

function nfeManualClienteSelecionado() {
    const select = document.getElementById('nfeManualCliente');
    const id = Number(select && select.value);
    const clientes = (NFE_MANUAL_CADASTROS && NFE_MANUAL_CADASTROS.clientes) || [];
    return clientes.find((c) => Number(c.id) === id) || null;
}

function nfeManualMostrarFicha(cliente) {
    const ficha = document.getElementById('nfeManualFicha');
    const vazia = document.getElementById('nfeManualFichaVazia');
    if (!cliente) {
        if (ficha) ficha.hidden = true;
        if (vazia) vazia.hidden = false;
        return;
    }
    if (vazia) vazia.hidden = true;
    if (ficha) ficha.hidden = false;
    const nome = document.getElementById('nfeManualFichaNome');
    const doc = document.getElementById('nfeManualFichaDoc');
    const ie = document.getElementById('nfeManualFichaIe');
    const endereco = document.getElementById('nfeManualFichaEndereco');
    const cidade = document.getElementById('nfeManualFichaCidade');
    if (nome) nome.textContent = cliente.nome || '—';
    if (doc) doc.textContent = `CPF/CNPJ: ${nfeDocumentoFormatado(cliente.cpf_cnpj)}`;
    if (ie) ie.textContent = `IE: ${cliente.inscricao_estadual ? cliente.inscricao_estadual : '—'}`;
    const linha1 = [cliente.rua, cliente.numero].filter((p) => String(p || '').trim()).join(', ');
    if (endereco) endereco.textContent = linha1 || '—';
    const cidadeUf = [cliente.cidade, cliente.uf].filter((p) => String(p || '').trim()).join(' / ');
    const cep = nfeSomenteDigitos(cliente.cep || '');
    const cepFmt = cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : (cliente.cep || '');
    const linha2 = [cliente.bairro, cidadeUf, cepFmt].filter((p) => String(p || '').trim()).join(' · ');
    if (cidade) cidade.textContent = linha2 || '—';
}

function nfeManualAplicarDestinatario(cliente, forcarDestino) {
    const dados = dadosIniciaisEmissaoNfe(nfeVendaVirtualDoCliente(cliente));
    const atribuir = (campo, id, forcar) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (!forcar && String(el.value || '').trim()) return;
        el.value = dados[campo] == null ? '' : dados[campo];
    };
    atribuir('tipo', 'nfeDestTipo', forcarDestino);
    atribuir('documento', 'nfeDestDocumento', forcarDestino);
    atribuir('nome', 'nfeDestNome', forcarDestino);
    atribuir('inscricao_estadual', 'nfeDestIe', forcarDestino);
    atribuir('logradouro', 'nfeDestLogradouro', forcarDestino);
    atribuir('numero', 'nfeDestNumero', forcarDestino);
    atribuir('complemento', 'nfeDestComplemento', forcarDestino);
    atribuir('bairro', 'nfeDestBairro', forcarDestino);
    atribuir('municipio', 'nfeDestMunicipio', forcarDestino);
    atribuir('uf', 'nfeDestUf', forcarDestino);
    atribuir('cep', 'nfeDestCep', forcarDestino);
    atribuir('natureza', 'nfeNatureza', false);
    atribuir('cfop', 'nfeCfop', false);
    atribuir('dados_adicionais', 'nfeDadosAdicionais', false);
    nfeManualMostrarFicha(cliente);
}

function nfeManualAoSelecionarCliente() {
    const select = document.getElementById('nfeManualCliente');
    if (select && select.value) select.size = 1;
    if (!nfeImportacaoAplicando && NFE_PEDIDOS_IMPORTADOS.length) {
        const clienteId = Number(select && select.value);
        if (clienteId !== Number(NFE_PEDIDOS_IMPORTADOS[0].cliente_id)) {
            nfeLimparPedidosImportados();
            nfeNotificar('Os pedidos importados foram retirados porque o cliente mudou.', 'warning');
        }
    }
    const cliente = nfeManualClienteSelecionado();
    if (cliente) nfeManualAplicarDestinatario(cliente, true);
    else nfeManualMostrarFicha(null);
    nfeManualAtualizarStatus();
}

let NFE_PEDIDOS_IMPORTADOS = [];
let nfeImportacaoAplicando = false;

function nfeRenderPedidosOrigem() {
    const secao = document.getElementById('modalEmitirNfe');
    if (secao && secao.dataset.nfePagina === '1') {
        secao.dataset.contexto = NFE_PEDIDOS_IMPORTADOS.length ? 'pedidos' : 'manual';
    }
    const alvo = document.getElementById('nfePedidosOrigem');
    if (!alvo) return;
    if (!NFE_PEDIDOS_IMPORTADOS.length) {
        alvo.innerHTML = '';
        return;
    }
    const codigos = NFE_PEDIDOS_IMPORTADOS.map((pedido) => pedido.codigo || ('#' + pedido.id)).join(', ');
    alvo.innerHTML = `<div id="nfeOrigemComercial" data-origem="FATURAMENTO"><strong>Origem comercial</strong> FATURAMENTO · <strong>Pedido de origem:</strong> ${nfeEsc(codigos)}</div>
        <span class="small text-muted">Pedidos de origem:</span>` + NFE_PEDIDOS_IMPORTADOS.map((pedido) => `
        <button type="button" class="btn btn-sm btn-outline-dark nfe-manual-comercial" data-pedido-chip="${Number(pedido.id)}" onclick="nfeRemoverPedidoImportado(${Number(pedido.id)})">
            ${nfeEsc(pedido.codigo || ('#' + pedido.id))} ×
        </button>`).join('');
}

/** Garante cliente e produto do pedido na Nova NF-e sem trocar o preço gravado. */
function nfeGarantirCadastroImportacao(snapshot) {
    if (!NFE_MANUAL_CADASTROS) NFE_MANUAL_CADASTROS = { clientes: [], produtos: [] };
    const cliente = snapshot && snapshot.cliente;
    if (cliente && cliente.id && !NFE_MANUAL_CADASTROS.clientes.some((c) => Number(c.id) === Number(cliente.id))) {
        NFE_MANUAL_CADASTROS.clientes.push(cliente);
    }
    const editor = document.getElementById('nfeManualEditor');
    const produtos = (editor && editor._produtos) || NFE_MANUAL_CADASTROS.produtos || [];
    (snapshot.pedidos || []).forEach((pedido) => {
        (pedido.itens || []).forEach((item) => {
            if (!item.produto_id || produtos.some((p) => Number(p.id) === Number(item.produto_id))) return;
            produtos.push({
                id: item.produto_id,
                nome: item.produto_nome || ('Produto ' + item.produto_id),
                preco_venda: item.preco_unitario,
                ativo: 1
            });
        });
    });
    if (editor) editor._produtos = produtos;
    NFE_MANUAL_CADASTROS.produtos = produtos;
    if (typeof nfeManualFiltrarClientes === 'function') nfeManualFiltrarClientes();
}

function nfeLimparPedidosImportados() {
    const ids = NFE_PEDIDOS_IMPORTADOS.map((pedido) => Number(pedido.id));
    NFE_PEDIDOS_IMPORTADOS = [];
    ids.forEach((id) => {
        document.querySelectorAll(`#nfeManualItens tr[data-pedido-id="${id}"]`).forEach((tr) => tr.remove());
    });
    nfeRenderPedidosOrigem();
    if (typeof opcRecalcular === 'function') opcRecalcular('nfeManual');
    nfeManualAtualizarResumo();
}

function nfeRemoverPedidoImportado(id) {
    NFE_PEDIDOS_IMPORTADOS = NFE_PEDIDOS_IMPORTADOS.filter((pedido) => Number(pedido.id) !== Number(id));
    document.querySelectorAll(`#nfeManualItens tr[data-pedido-id="${Number(id)}"]`).forEach((tr) => tr.remove());
    const desconto = NFE_PEDIDOS_IMPORTADOS.reduce((soma, pedido) => soma + (Number(pedido.desconto) || 0), 0);
    const campo = document.getElementById('nfeManualDesconto');
    if (campo) campo.value = String(Math.round(desconto * 100) / 100);
    nfeRenderPedidosOrigem();
    if (typeof opcRecalcular === 'function') opcRecalcular('nfeManual');
    nfeManualAtualizarResumo();
}

function nfeInserirItemGravado(item, pedidoId) {
    if (typeof opcAdicionarItem !== 'function') return;
    opcAdicionarItem('nfeManual');
    const linhas = document.querySelectorAll('#nfeManualItens tr[data-opc-item]');
    const linha = linhas[linhas.length - 1];
    if (!linha) return;
    linha.dataset.pedidoId = String(pedidoId);
    linha.dataset.precoGravado = String(item.preco_unitario);
    const select = linha.querySelector('[data-campo="produto"]');
    const quantidade = linha.querySelector('[data-campo="quantidade"]');
    if (select) {
        select.value = String(item.produto_id);
        if (typeof select.onchange === 'function') select.onchange();
    }
    if (quantidade) quantidade.value = String(item.quantidade);
    const preco = linha.querySelector('[data-campo="preco"]');
    if (preco) preco.value = String(item.preco_unitario);
    if (typeof nfeManualAtualizarLinhaFiscal === 'function') nfeManualAtualizarLinhaFiscal(linha);
}

function nfeAplicarImportacao(snapshot) {
    nfeGarantirCadastroImportacao(snapshot);
    const cliente = snapshot.cliente || {};
    nfeImportacaoAplicando = true;
    const select = document.getElementById('nfeManualCliente');
    if (select && cliente.id) select.value = String(cliente.id);
    nfeManualAoSelecionarCliente();
    nfeImportacaoAplicando = false;
    (snapshot.pedidos || []).forEach((pedido) => {
        if (NFE_PEDIDOS_IMPORTADOS.some((atual) => Number(atual.id) === Number(pedido.id))) return;
        NFE_PEDIDOS_IMPORTADOS.push(pedido);
        (pedido.itens || []).forEach((item) => nfeInserirItemGravado(item, pedido.id));
    });
    const campo = document.getElementById('nfeManualDesconto');
    if (campo) campo.value = String(Number(snapshot.desconto) || 0);
    const forma = document.getElementById('nfeManualForma');
    if (forma && snapshot.forma_pagamento) forma.value = snapshot.forma_pagamento;
    nfeRenderPedidosOrigem();
    if (typeof opcRecalcular === 'function') opcRecalcular('nfeManual');
    nfeManualAtualizarResumo();
}

async function nfeAbrirImportarPedido() {
    const resp = await nfeRequest('/pedidos/elegiveis-nfe');
    if (!resp.ok) {
        nfeNotificar(nfeMensagemErro(resp.data, 'Não foi possível listar os pedidos.'), 'danger');
        return;
    }
    const pedidos = Array.isArray(resp.data) ? resp.data : [];
    const clienteAtual = NFE_PEDIDOS_IMPORTADOS[0] ? NFE_PEDIDOS_IMPORTADOS[0].cliente_nome : '';
    const linhas = pedidos.map((pedido) => `
        <label class="list-group-item d-flex justify-content-between align-items-center">
            <span><input type="checkbox" class="form-check-input me-2" value="${Number(pedido.id)}" data-cliente-id="${Number(pedido.cliente_id)}">
            ${nfeEsc(pedido.codigo || ('#' + pedido.id))} · ${nfeEsc(pedido.cliente_nome || '')} · ${Number(pedido.quantidade_itens) || 0} itens</span>
            <strong>${typeof pedMoeda === 'function' ? pedMoeda(pedido.total) : nfeEsc(pedido.total)}</strong>
        </label>`).join('');
    const html = `
        <div class="modal fade" id="modalImportarPedidoNfe" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Importar pedidos para NF-e</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>
                    <div class="modal-body">
                        <p class="small text-muted mb-2">${clienteAtual ? `Cliente desta NF-e: ${nfeEsc(clienteAtual)}` : 'O primeiro pedido define o cliente.'}</p>
                        <input type="search" class="form-control form-control-sm mb-2" id="nfeBuscaPedidoImportar" placeholder="PED-000..." oninput="nfeFiltrarPedidosImportar()">
                        <div class="list-group" id="nfeListaPedidosImportar">${linhas || '<div class="text-muted small">Nenhum pedido aberto.</div>'}</div>
                        <p class="small mt-2 mb-0" id="nfeResumoImportar">Pedidos selecionados: 0</p>
                        <div class="alert alert-warning py-2 small d-none mt-2" id="nfeErroImportar"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary btn-sm" id="nfeBtnImportarSelecionados" onclick="nfeConfirmarImportarPedidos()">Importar selecionados</button>
                    </div>
                </div>
            </div>
        </div>`;
    nfeMostrarModal('modalImportarPedidoNfe', html);
    document.querySelectorAll('#nfeListaPedidosImportar input').forEach((el) => {
        el.addEventListener('change', nfeValidarSelecaoImportar);
    });
}

function nfeFiltrarPedidosImportar() {
    const termo = String((document.getElementById('nfeBuscaPedidoImportar') || {}).value || '').toLowerCase();
    document.querySelectorAll('#nfeListaPedidosImportar label').forEach((linha) => {
        linha.hidden = termo && !linha.textContent.toLowerCase().includes(termo);
    });
}

function nfeValidarSelecaoImportar() {
    const marcados = Array.from(document.querySelectorAll('#nfeListaPedidosImportar input:checked'));
    const erroEl = document.getElementById('nfeErroImportar');
    const clientes = new Set(marcados.map((el) => el.dataset.clienteId));
    const clienteFixo = NFE_PEDIDOS_IMPORTADOS[0] ? String(NFE_PEDIDOS_IMPORTADOS[0].cliente_id) : '';
    let mensagem = '';
    if (clientes.size > 1 || (clienteFixo && [...clientes].some((id) => id !== clienteFixo))) {
        mensagem = 'Este pedido pertence a outro cliente. Uma mesma NF-e não pode consolidar pedidos de clientes diferentes.';
    }
    if (erroEl) {
        erroEl.textContent = mensagem;
        erroEl.classList.toggle('d-none', !mensagem);
    }
    const resumo = document.getElementById('nfeResumoImportar');
    if (resumo) resumo.textContent = `Pedidos selecionados: ${marcados.length}`;
    return !mensagem;
}

async function nfeConfirmarImportarPedidos() {
    if (!nfeValidarSelecaoImportar()) return;
    const ids = Array.from(document.querySelectorAll('#nfeListaPedidosImportar input:checked')).map((el) => Number(el.value));
    if (!ids.length) return;
    const resp = await nfeRequest('/nfe/pedidos/preparar', { method: 'POST', body: { pedido_ids: ids.concat(NFE_PEDIDOS_IMPORTADOS.map((p) => p.id)) } });
    if (!resp.ok) {
        const erroEl = document.getElementById('nfeErroImportar');
        const mensagem = nfeMensagemErro(resp.data, 'Não foi possível importar os pedidos.');
        if (erroEl) {
            erroEl.textContent = mensagem;
            erroEl.classList.remove('d-none');
        }
        return;
    }
    nfeLimparPedidosImportados();
    nfeAplicarImportacao(resp.data);
    nfeFecharModal('modalImportarPedidoNfe');
}

function nfeManualAdicionarProduto() {
    if (typeof opcPrepararNovaInclusao === 'function') opcPrepararNovaInclusao('nfeManual');
    nfeManualAtualizarResumo();
}

function nfeManualDefinirConferencia(aberta) {
    const etapa = document.getElementById('nfeManualEtapaFiscal');
    if (etapa) etapa.hidden = !aberta;
    const continuar = document.getElementById('nfeBtnManualContinuar');
    const cancelarDoc = document.getElementById('nfeManualBtnCancelarDoc');
    const voltar = document.getElementById('nfeBtnVoltarConferencia');
    const cancelar = document.getElementById('nfeBtnCancelarEmissao');
    const confirmar = document.getElementById('btnConfirmarEmissaoNfe');
    if (continuar) continuar.hidden = aberta;
    if (cancelarDoc) cancelarDoc.hidden = aberta;
    if (voltar) voltar.hidden = !aberta;
    if (cancelar) cancelar.hidden = !aberta;
    if (confirmar) confirmar.hidden = !aberta;
    document.querySelectorAll('.nfe-manual-comercial').forEach((el) => { el.disabled = aberta; });
    nfeManualMarcarPassos(aberta ? 'fiscal' : 'comercial');
    nfeManualAtualizarStatus();
    if (aberta && etapa && typeof etapa.scrollIntoView === 'function') etapa.scrollIntoView({ block: 'nearest' });
}

function nfeManualVoltarConferencia() {
    if (NFE_EMISSAO_EM_CURSO) return;
    NFE_CONTEXTO_EMISSAO = null;
    nfeManualDefinirConferencia(false);
}

/** Cancela a conferência sem POST, venda, estoque, financeiro ou numeração. */
function nfeManualCancelarEmissao() {
    if (NFE_EMISSAO_EM_CURSO) return;
    const secao = document.getElementById('modalEmitirNfe');
    const houve = secao && secao.dataset.reabrirVenda === '1';
    NFE_CONTEXTO_EMISSAO = null;
    if (houve && document.getElementById('nfe-pagina') && NFE_SECAO_ATUAL) {
        nfeRecarregarSecaoAtual();
        return;
    }
    if (secao) secao.remove();
}

/** Limpa o preenchimento comercial. Não chama o backend. */
function nfeManualCancelarDocumento() {
    if (NFE_EMISSAO_EM_CURSO) return;
    NFE_CONTEXTO_EMISSAO = null;
    nfeManualDefinirConferencia(false);
    const busca = document.getElementById('nfeManualBusca');
    if (busca) busca.value = '';
    nfeManualFiltrarClientes();
    const select = document.getElementById('nfeManualCliente');
    if (select) select.value = '';
    const corpo = document.getElementById('nfeManualItens');
    if (corpo) corpo.innerHTML = '';
    NFE_PEDIDOS_IMPORTADOS = [];
    nfeRenderPedidosOrigem();
    const barraProduto = document.querySelector('#nfeManualEditor [data-opc-busca-barra]');
    if (barraProduto) barraProduto.value = '';
    const desconto = document.getElementById('nfeManualDesconto');
    if (desconto) desconto.value = '0';
    const forma = document.getElementById('nfeManualForma');
    if (forma) forma.value = 'dinheiro';
    const parcelas = document.getElementById('nfeManualParcelas');
    if (parcelas) parcelas.value = '1';
    ['nfeDestTipo', 'nfeDestDocumento', 'nfeDestNome', 'nfeDestIe', 'nfeDestLogradouro', 'nfeDestNumero',
        'nfeDestComplemento', 'nfeDestBairro', 'nfeDestMunicipio', 'nfeDestUf', 'nfeDestCep', 'nfeDadosAdicionais']
        .forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = id === 'nfeDestTipo' ? 'CPF' : '';
        });
    const natureza = document.getElementById('nfeNatureza');
    if (natureza) natureza.value = NFE_NATUREZA_PADRAO;
    const cfop = document.getElementById('nfeCfop');
    if (cfop) cfop.value = NFE_CFOP_PADRAO;
    nfeManualMostrarFicha(null);
    if (typeof opcExibirErros === 'function') opcExibirErros('nfeManual', []);
    if (typeof opcRecalcular === 'function') opcRecalcular('nfeManual');
    nfeManualAtualizarResumo();
}

/**
 * Abre o documento da Nova NF-e na página (somente leituras: prontidão, clientes e produtos).
 * Retorna 'aberto' | 'desabilitado' | 'sem_permissao' | 'nao_pronta' | 'erro'.
 * opcoes.modalNaoPronta = false: não abre o modal de pendências (a página mostra o estado).
 */
async function abrirNfeManual(opcoes = {}) {
    if (!nfeRecursoHabilitado()) {
        nfeNotificar('Módulo NF-e desabilitado nesta implantação.', 'warning');
        return 'desabilitado';
    }
    if (!nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR)) {
        nfeNotificar(NFE_MSG_SEM_PERMISSAO, 'warning');
        return 'sem_permissao';
    }
    const prontidao = await nfeRequest('/nfe/prontidao');
    if (!prontidao.ok || !prontidao.data || prontidao.data.pronta !== true) {
        if (prontidao.ok && prontidao.data) {
            if (opcoes.modalNaoPronta !== false) nfeMostrarNaoPronta(prontidao.data, null);
            return 'nao_pronta';
        }
        nfeNotificar(nfeMensagemErro(prontidao.data, NFE_MSG_NAO_PRONTA), 'warning');
        return 'erro';
    }
    if (typeof opcCarregarCadastros !== 'function') {
        nfeNotificar('Editor de itens indisponível.', 'danger');
        return 'erro';
    }
    let cadastros;
    try {
        cadastros = await opcCarregarCadastros();
    } catch (err) {
        nfeNotificar(err.message, 'danger');
        return 'erro';
    }
    nfeMontarDocumentoManual(prontidao.data, cadastros);
    return 'aberto';
}

/**
 * Valida o preenchimento comercial e abre a conferência fiscal na mesma página.
 * Nenhuma requisição ao backend aqui.
 */
function confirmarNfeManual() {
    const dados = opcLerEditor('nfeManual');
    const erros = opcValidarDados(dados);
    opcExibirErros('nfeManual', erros);
    if (erros.length) {
        nfeManualAtualizarStatus();
        return;
    }
    if (!nfePodeAbrirEmissao()) return;
    const cliente = nfeManualClienteSelecionado() || {};
    const chave = `nfe-manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const pedidoIds = NFE_PEDIDOS_IMPORTADOS.map((pedido) => Number(pedido.id));
    const itensAvulsos = Array.from(document.querySelectorAll('#nfeManualItens tr[data-opc-item]'))
        .filter((tr) => !tr.dataset.pedidoId)
        .map((tr) => ({
            produto_id: Number(tr.querySelector('[data-campo="produto"]').value) || null,
            quantidade: Number(tr.querySelector('[data-campo="quantidade"]').value) || 0,
            preco_unitario: Number(tr.querySelector('[data-campo="preco"]').value) || 0
        }));
    NFE_CONTEXTO_EMISSAO = pedidoIds.length
        ? { tipo: 'pedidos', pedidoIds, itensAvulsos, operacao: { ...dados }, chave }
        : { tipo: 'manual', operacao: { ...dados }, chave };
    const secao = document.getElementById('modalEmitirNfe');
    if (secao) {
        secao.dataset.contexto = pedidoIds.length ? 'pedidos' : 'manual';
        secao.dataset.parcelaFiscal = '1';
        if (!secao.dataset.vendaId) secao.dataset.vendaId = '';
    }
    nfeManualAplicarDestinatario(cliente, true);
    nfeManualDefinirConferencia(true);
}

// ---------------------------------------------------------------------------
// Painel NF-e (aba do módulo Fiscal)
// ---------------------------------------------------------------------------

function nfeFiltrosPainel() {
    const val = (id) => {
        const el = document.getElementById(id);
        return el ? String(el.value || '').trim() : '';
    };
    return {
        status: val('nfeFiltroStatus'),
        dataInicio: val('nfeFiltroInicio'),
        dataFim: val('nfeFiltroFim'),
        busca: val('nfeFiltroBusca')
    };
}

function nfeQueryNotas(filtros) {
    const params = new URLSearchParams({ tipo: 'VENDA', limite: '200' });
    if (filtros.status) params.set('status', filtros.status);
    if (filtros.dataInicio) params.set('dataInicio', filtros.dataInicio);
    if (filtros.dataFim) params.set('dataFim', filtros.dataFim);
    const busca = String(filtros.busca || '').trim();
    if (busca) {
        const digitos = nfeSomenteDigitos(busca);
        if (digitos && digitos === busca.replace(/[\s.\-/]/g, '')) {
            if (digitos.length <= 9) params.set('numero', digitos);
            else params.set('chave', digitos);
        } else {
            params.set('cliente', busca);
        }
    }
    return params.toString();
}

// ---------------------------------------------------------------------------
// Prontidão (diagnóstico local de configuração — o backend não chama a SEFAZ)
// ---------------------------------------------------------------------------

const NFE_PRONTIDAO_ICONE = {
    ok: 'fa-check-circle text-success',
    alerta: 'fa-exclamation-triangle text-warning',
    pendente: 'fa-times-circle text-danger',
    bloqueado: 'fa-lock text-danger'
};

function nfeIconeProntidao(item) {
    if (item.id === 'producao' && item.nivel === 'ok') return 'fa-lock text-success';
    return NFE_PRONTIDAO_ICONE[item.nivel] || 'fa-question-circle text-muted';
}

function nfeHtmlProntidao(diag) {
    const d = diag || {};
    const itens = Array.isArray(d.itens) ? d.itens : [];
    const pendentes = itens.filter((i) => !i.ok);
    const linhas = itens.map((i) => `
        <tr data-prontidao-item="${nfeEsc(i.id)}" data-nivel="${nfeEsc(i.nivel)}">
            <td style="width:2rem"><i class="fas ${nfeIconeProntidao(i)}"></i></td>
            <td class="fw-semibold">${nfeEsc(i.nome)}</td>
            <td>${i.valor != null && i.valor !== '' ? nfeEsc(i.valor) : '—'}<div class="small text-muted">${nfeEsc(i.mensagem || '')}</div></td>
        </tr>`).join('');
    const aviso = d.pronta ? '' : `
        <div class="alert alert-warning py-2" id="nfeProntidaoAviso">
            <strong>${NFE_MSG_NAO_PRONTA}</strong>
            <ul class="mb-0 small">${pendentes.map((i) => `<li><strong>${nfeEsc(i.nome)}</strong>: ${nfeEsc(i.mensagem || 'pendente')}</li>`).join('')}</ul>
        </div>`;
    return `
        <div class="card mb-3" id="nfeProntidaoModalCard" data-status="${nfeEsc(d.status || '')}">
            <div class="card-header">
                <strong><i class="fas fa-clipboard-check"></i> NF-e — ${nfeEsc(nfeRotuloAmbienteNfe(d))}</strong>
            </div>
            <div class="card-body py-2">
                ${aviso}
                <table class="table table-sm align-middle mb-2"><tbody>${linhas}</tbody></table>
                <div class="fw-bold ${d.pronta ? 'text-success' : 'text-danger'}" id="nfeProntidaoStatus">
                    STATUS: ${d.pronta ? 'PRONTA PARA HOMOLOGAÇÃO' : 'NF-E NÃO CONFIGURADA'}
                </div>
                <div class="small text-muted">Diagnóstico local da configuração — nenhuma chamada à SEFAZ.</div>
            </div>
        </div>`;
}

function nfeMostrarNaoPronta(diag, vendaId) {
    nfeOcultarModalVenda();
    const html = `
        <div class="modal fade" id="modalNfeNaoPronta" tabindex="-1" aria-labelledby="modalNfeNaoProntaLabel">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="modalNfeNaoProntaLabel"><i class="fas fa-exclamation-triangle text-warning"></i> ${NFE_MSG_NAO_PRONTA}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">${nfeHtmlProntidao(diag)}</div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>`;
    nfeMostrarModal('modalNfeNaoPronta', html, () => nfeReabrirVenda(vendaId));
}

// ---------------------------------------------------------------------------
// Módulo Fiscal › NF-e: páginas do menu. Abrir/navegar só faz leituras (GET);
// nada é emitido, faturado ou transmitido sem uma ação explícita do usuário.
// ---------------------------------------------------------------------------

const NFE_SECOES = {
    nova: { pagina: 'fiscal-nfe-nova', titulo: 'Nova NF-e', icone: 'fa-plus-circle' },
    emitidas: { pagina: 'fiscal-nfe', titulo: 'NF-e Emitidas', icone: 'fa-file-invoice' },
    monitor: { pagina: 'fiscal-nfe-monitor', titulo: 'Monitor NF-e', icone: 'fa-desktop' },
    fila: { pagina: 'fiscal-nfe-fila', titulo: 'Fila NF-e', icone: 'fa-tasks' },
    diagnostico: { pagina: 'fiscal-nfe-diagnostico', titulo: 'Diagnóstico NF-e', icone: 'fa-stethoscope' }
};
const NFE_TIMEOUT_TELA_MS = 20000;
const NFE_MSG_NOVA_SEM_EFEITO = 'Abrir o formulário não registra venda, não baixa estoque, não lança financeiro '
    + 'e não transmite nada à SEFAZ. Isso só acontece ao clicar em Confirmar emissão.';
let NFE_SECAO_ATUAL = null;
let NFE_CARGA_SEQ = 0;
let NFE_REPROCESSANDO = false;

function nfeSecaoDaPagina(pagina) {
    const p = String(pagina || '');
    if (NFE_SECOES[p]) return p;
    return Object.keys(NFE_SECOES).find((k) => NFE_SECOES[k].pagina === p) || null;
}

function nfeMoeda(valor) {
    if (valor == null || valor === '') return '—';
    const n = Number(valor);
    return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
}

function nfeDocumentoFormatado(doc) {
    const d = nfeSomenteDigitos(doc);
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return d || '—';
}

function nfeDataHoraLocal(iso) {
    const d = iso ? new Date(iso) : new Date();
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
}

/** Origem gravada no backend (nfe_notas.origem); notas antigas sem origem ficam "—". */
function nfeRotuloOrigemCurto(nota) {
    const origem = String((nota && nota.origem) || '').toUpperCase();
    if (origem === 'PEDIDO') return 'Pedido';
    if (origem === 'MANUAL') return 'Manual';
    return '—';
}

function nfeHtmlEstado(estado, opcoes = {}) {
    if (estado === 'loading') {
        return `<div class="text-center text-muted py-5" data-estado="loading" role="status">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${nfeEsc(opcoes.mensagem || 'Carregando...')}</div>`;
    }
    if (estado === 'empty') {
        return `<div class="text-center text-muted py-5" data-estado="empty">
            <i class="fas ${opcoes.icone || 'fa-inbox'} fa-2x d-block mb-2" aria-hidden="true"></i>
            <div>${nfeEsc(opcoes.mensagem || 'Nenhum registro encontrado.')}</div>${opcoes.extra || ''}</div>`;
    }
    const detalhe = opcoes.detalhe && opcoes.detalhe !== opcoes.mensagem
        ? `<div class="small mt-1">${nfeEsc(opcoes.detalhe)}</div>`
        : '';
    const retry = opcoes.retry === false
        ? ''
        : '<button type="button" class="btn btn-outline-danger btn-sm mt-3" data-acao="tentar-novamente"><i class="fas fa-redo"></i> Tentar novamente</button>';
    return `<div class="alert alert-danger text-center py-4 mb-0" data-estado="error" role="alert">
        <div class="fw-semibold">${nfeEsc(opcoes.mensagem || 'Não foi possível carregar.')}</div>${detalhe}${opcoes.extra || ''}
        <div>${retry}</div></div>`;
}

function nfeCargaAtual(seq) {
    return seq === NFE_CARGA_SEQ && Boolean(document.getElementById('nfe-pagina'));
}

function nfeIrPagina(pagina) {
    if (typeof loadPage === 'function') loadPage(pagina);
}

function nfeDefinirConteudo(html, aoTentarNovamente) {
    const alvo = document.getElementById('nfeSecaoConteudo');
    if (!alvo) return;
    alvo.innerHTML = html;
    const retry = aoTentarNovamente || nfeRecarregarSecaoAtual;
    alvo.querySelectorAll('[data-acao="tentar-novamente"]').forEach((btn) => {
        btn.addEventListener('click', () => retry());
    });
    alvo.querySelectorAll('[data-ir-pagina]').forEach((btn) => {
        btn.addEventListener('click', () => nfeIrPagina(btn.getAttribute('data-ir-pagina')));
    });
}

function nfeErroCarga(resp, mensagem) {
    nfeDefinirConteudo(nfeHtmlEstado('error', { mensagem, detalhe: nfeMensagemPermissao(resp, '') }));
}

function nfeHtmlFiltrosEmitidas() {
    const opcoesStatus = ['', 'autorizada', 'rejeitada', 'aguardando_retorno', 'transmitindo', 'erro_transmissao',
        'nao_localizada_sefaz', 'denegada', 'cancelada', 'cancelamento_rejeitado']
        .map((s) => `<option value="${s}">${s ? nfeEsc(nfeRotuloStatus(s)) : 'Todos'}</option>`).join('');
    return `
        <div class="row g-2 align-items-end mb-3" id="nfePainelFiltros">
            <div class="col-md-3">
                <label class="form-label small mb-1" for="nfeFiltroStatus">Status</label>
                <select class="form-select form-select-sm" id="nfeFiltroStatus">${opcoesStatus}</select>
            </div>
            <div class="col-md-2">
                <label class="form-label small mb-1" for="nfeFiltroInicio">De</label>
                <input type="date" class="form-control form-control-sm" id="nfeFiltroInicio">
            </div>
            <div class="col-md-2">
                <label class="form-label small mb-1" for="nfeFiltroFim">Até</label>
                <input type="date" class="form-control form-control-sm" id="nfeFiltroFim">
            </div>
            <div class="col-md-3">
                <label class="form-label small mb-1" for="nfeFiltroBusca">Buscar</label>
                <input type="text" class="form-control form-control-sm" id="nfeFiltroBusca" placeholder="Número, chave ou cliente">
            </div>
            <div class="col-md-2">
                <button type="button" class="btn btn-primary btn-sm w-100" id="nfeBtnFiltrar"><i class="fas fa-filter"></i> Filtrar</button>
            </div>
        </div>`;
}

/** Abre uma página NF-e do menu Fiscal (pagina = data-page ou nome da seção). */
function loadNfePagina(pagina) {
    const secao = nfeSecaoDaPagina(pagina) || 'emitidas';
    const cfg = NFE_SECOES[secao];
    NFE_SECAO_ATUAL = secao;
    NFE_CARGA_SEQ += 1;
    const alvo = document.getElementById('page-content');
    if (!alvo) return Promise.resolve();
    alvo.innerHTML = `
        <div class="card shadow-sm" id="nfe-pagina" data-secao="${secao}">
            <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div><i class="fas ${cfg.icone}"></i> Fiscal › NF-e › <strong>${cfg.titulo}</strong></div>
                ${secao === 'nova' ? '' : '<button type="button" class="btn btn-outline-primary btn-sm" id="nfeBtnAtualizar"><i class="fas fa-sync"></i> Atualizar</button>'}
            </div>
            <div class="card-body">
                <div id="nfeSecaoTopo">${secao === 'emitidas' ? nfeHtmlFiltrosEmitidas() : ''}</div>
                <div id="nfeSecaoConteudo"></div>
            </div>
        </div>`;
    const recarregar = () => nfeRecarregarSecaoAtual();
    const btnAtualizar = document.getElementById('nfeBtnAtualizar');
    if (btnAtualizar) btnAtualizar.addEventListener('click', recarregar);
    const btnFiltrar = document.getElementById('nfeBtnFiltrar');
    if (btnFiltrar) btnFiltrar.addEventListener('click', recarregar);
    const busca = document.getElementById('nfeFiltroBusca');
    if (busca) busca.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') recarregar(); });

    if (!nfeRecursoHabilitado()) {
        nfeDefinirConteudo(nfeHtmlEstado('empty', { mensagem: 'Módulo NF-e desabilitado nesta implantação.', icone: 'fa-ban' }));
        return Promise.resolve();
    }
    return nfeRecarregarSecaoAtual();
}

const NFE_MSG_CARREGANDO = {
    nova: 'Verificando a prontidão da NF-e...',
    emitidas: 'Carregando NF-e...',
    monitor: 'Carregando o monitor de NF-e...',
    fila: 'Carregando a fila de NF-e...',
    diagnostico: 'Verificando a configuração da NF-e...'
};

/** Recarrega a página NF-e aberta; sem efeito se o usuário já saiu dela. */
function nfeRecarregarSecaoAtual() {
    if (!document.getElementById('nfe-pagina') || !NFE_SECAO_ATUAL || !nfeRecursoHabilitado()) return Promise.resolve();
    const seq = ++NFE_CARGA_SEQ;
    const secao = NFE_SECAO_ATUAL;
    const carregadores = {
        nova: nfeCarregarNova,
        emitidas: nfeCarregarEmitidas,
        monitor: nfeCarregarMonitor,
        fila: nfeCarregarFila,
        diagnostico: nfeCarregarDiagnostico
    };
    nfeDefinirConteudo(nfeHtmlEstado('loading', { mensagem: NFE_MSG_CARREGANDO[secao] }));
    return Promise.resolve()
        .then(() => carregadores[secao](seq))
        .catch((err) => {
            if (!nfeCargaAtual(seq)) return;
            nfeDefinirConteudo(nfeHtmlEstado('error', {
                mensagem: 'Não foi possível carregar esta tela.',
                detalhe: err && err.message
            }));
        });
}

// --- Nova NF-e -------------------------------------------------------------
// Recurso NF-e ativo não significa NF-e pronta: [Emitir NF-e] só é liberado quando a
// prontidão oficial (GET /nfe/prontidao, a mesma do Diagnóstico NF-e) está verde.

function nfeRotuloAmbienteNfe(diag) {
    const amb = String((diag && diag.ambiente) || '');
    if (amb === '2') return 'Homologação (tpAmb 2)';
    if (amb === '1') return 'Produção (tpAmb 1)';
    return 'não definido';
}

function nfeHtmlBotaoEmitirNova(habilitado) {
    const bloqueio = habilitado
        ? ''
        : ' disabled aria-disabled="true" title="Disponível quando o Diagnóstico NF-e estiver sem pendências."';
    return `<button type="button" class="btn btn-primary" id="nfeBtnEmitirNova" data-acao="emitir-nfe"${bloqueio}>`
        + '<i class="fas fa-file-invoice"></i> Emitir NF-e</button>';
}

function nfeRenderNova(situacao, diag) {
    if (situacao === 'desabilitado') {
        nfeDefinirConteudo(nfeHtmlEstado('empty', { mensagem: 'Módulo NF-e desabilitado nesta implantação.', icone: 'fa-ban' }));
        return;
    }
    if (situacao === 'sem_permissao' || !nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR)) {
        nfeDefinirConteudo(nfeHtmlEstado('empty', { mensagem: NFE_MSG_SEM_PERMISSAO, icone: 'fa-lock' }));
        return;
    }
    if (situacao === 'pronta') {
        nfeDefinirConteudo(`
            <div data-estado="data" id="nfeNovaPainel" data-situacao="pronta" class="nfe-manual">
                ${nfeManualHtmlCabecalho(diag)}
                <div class="cds-alert cds-alert--success nfe-manual-status" id="nfeNovaStatus" role="status">
                    <div><strong>✓ NF-e pronta para emissão.</strong>
                    <span class="nfe-manual-status__amb">Ambiente: ${nfeEsc(nfeRotuloAmbienteNfe(diag))}.</span></div>
                </div>
                <div class="cds-alert cds-alert--info" id="nfeNovaAviso">${NFE_MSG_NOVA_SEM_EFEITO}</div>
                <div class="cds-alert cds-alert--error" role="alert">Não foi possível carregar clientes e produtos.</div>
            </div>`);
        return;
    }
    if (situacao === 'nao_pronta') {
        const pendentes = (Array.isArray(diag && diag.itens) ? diag.itens : []).filter((i) => !i.ok);
        nfeDefinirConteudo(`
            <div data-estado="error" id="nfeNovaPainel" data-situacao="nao_pronta" class="nfe-manual">
                ${nfeManualHtmlCabecalho(diag)}
                <div class="cds-alert cds-alert--warning" id="nfeNovaStatus" role="alert">
                    <div>
                        <strong class="cds-alert__title">Emissão de NF-e indisponível</strong>
                        <div><strong>⚠ ${NFE_MSG_NAO_PRONTA}</strong></div>
                        <ul class="mb-0" id="nfeNovaPendencias">${pendentes.map((i) => `<li><strong>${nfeEsc(i.nome)}</strong>: ${nfeEsc(i.mensagem || 'pendente')}</li>`).join('')}</ul>
                    </div>
                </div>
                <div class="d-flex flex-wrap gap-2 nfe-manual-bloqueio-acoes">
                    <button type="button" class="btn btn-outline-dark cds-btn cds-btn--secondary cds-btn--md" data-ir-pagina="fiscal-nfe-diagnostico"><i class="fas fa-stethoscope"></i> Abrir Diagnóstico NF-e</button>
                    <button type="button" class="btn btn-outline-danger cds-btn cds-btn--secondary cds-btn--md" data-acao="tentar-novamente"><i class="fas fa-redo"></i> Tentar novamente</button>
                    ${nfeHtmlBotaoEmitirNova(false)}
                </div>
            </div>`);
        return;
    }
    nfeDefinirConteudo(nfeHtmlEstado('error', { mensagem: 'Não foi possível verificar a prontidão da NF-e.' }));
}

/** [Emitir NF-e] da página: abre o editor (somente leituras até Confirmar emissão). */
async function nfeAbrirNovaNfePagina() {
    if (!document.getElementById('nfe-pagina')) return null;
    const btn = document.getElementById('nfeBtnEmitirNova');
    if (btn) btn.disabled = true;
    let situacao;
    try {
        situacao = await abrirNfeManual({ modalNaoPronta: false });
    } catch (_) {
        situacao = 'erro';
    }
    if (situacao === 'aberto') {
        if (btn) btn.disabled = false;
        return situacao;
    }
    await nfeRecarregarSecaoAtual();
    return situacao;
}

async function nfeCarregarNova(seq) {
    if (!nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR)) {
        nfeRenderNova('sem_permissao');
        return;
    }
    const resp = await nfeRequest('/nfe/prontidao', { timeoutMs: NFE_TIMEOUT_TELA_MS });
    if (!nfeCargaAtual(seq)) return;
    if (!resp.ok || !resp.data || typeof resp.data.pronta !== 'boolean') {
        nfeErroCarga(resp, 'Não foi possível verificar a prontidão da NF-e.');
        return;
    }
    if (!resp.data.pronta) {
        nfeRenderNova('nao_pronta', resp.data);
        return;
    }
    nfeDefinirConteudo(nfeHtmlEstado('loading', { mensagem: 'Carregando clientes e produtos...' }));
    let cadastros;
    try {
        cadastros = await opcCarregarCadastros();
    } catch (err) {
        if (!nfeCargaAtual(seq)) return;
        nfeRenderNova('pronta', resp.data);
        return;
    }
    if (!nfeCargaAtual(seq)) return;
    nfeMontarDocumentoManual(resp.data, cadastros);
}

// --- NF-e Emitidas ---------------------------------------------------------

function nfeHtmlAcoesNota(n, opcoes = {}) {
    const id = Number(n.id);
    const status = String(n.status || '').toLowerCase();
    const podeEmitir = nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR);
    const acoes = [nfeBotao('', 'fa-eye', 'btn-outline-dark', `nfeAbrirDetalhe(${id})`, null, 'Visualizar')];
    if (Number(n.tem_danfe)) acoes.push(nfeBotao('', 'fa-file-pdf', 'btn-outline-primary', `nfeAbrirDanfe(${id})`, null, 'DANFE'));
    if (Number(n.tem_xml)) acoes.push(nfeBotao('', 'fa-file-code', 'btn-outline-secondary', `nfeBaixarXml(${id})`, null, 'XML'));
    if (podeEmitir && n.chave_acesso && status !== 'cancelada') {
        acoes.push(nfeBotao('', 'fa-search', 'btn-outline-info', `nfeConsultarSituacao(${id}, null)`, null, 'Consultar'));
    }
    acoes.push(nfeBotao('', 'fa-history', 'btn-outline-dark', `nfeAbrirHistorico(${id}, null)`, null, 'Histórico'));
    if (opcoes.reprocessar && podeEmitir && n.pode_reenviar) {
        acoes.push(nfeBotao('', 'fa-redo', 'btn-outline-warning', `nfeReprocessarNota(${id})`, null, 'Reprocessar'));
    }
    if ((status === 'autorizada' || status === 'cancelamento_rejeitado') && nfeUsuarioTemPermissao(NFE_PERMISSAO_CANCELAR)) {
        acoes.push(nfeBotao('', 'fa-ban', 'btn-outline-danger', `nfeAbrirCancelamento(${id}, null)`, null, 'Cancelar'));
    }
    return `<div class="btn-group btn-group-sm">${acoes.join('')}</div>`;
}

function nfeHtmlTabelaEmitidas(notas) {
    const linhas = notas.map((n) => `
        <tr data-nota-id="${Number(n.id)}">
            <td>${nfeEsc(nfeNumeroFormatado(n.numero))}</td>
            <td>${nfeEsc(n.serie != null ? n.serie : '—')}</td>
            <td class="text-nowrap">${nfeEsc(nfeDataHora(n.created_at))}</td>
            <td>${nfeEsc(n.cliente_nome || '—')}</td>
            <td class="text-nowrap">${nfeEsc(nfeDocumentoFormatado(n.cliente_documento))}</td>
            <td class="text-end text-nowrap">${nfeEsc(nfeMoeda(n.valor))}</td>
            <td>${nfeBadgeStatus(n.status)}</td>
            <td data-origem="${nfeEsc(n.origem || '')}">${nfeEsc(nfeRotuloOrigemCurto(n))}</td>
            <td>${n.pedido_id ? `#${Number(n.pedido_id)}` : '—'}</td>
            <td>${n.venda_id ? `#${nfeEsc(n.venda_codigo || n.venda_id)}` : '—'}</td>
            <td class="small font-monospace text-break" style="min-width:12rem">${nfeEsc(nfeChaveFormatada(n.chave_acesso))}</td>
            <td class="text-end">${nfeHtmlAcoesNota(n)}</td>
        </tr>`).join('');
    return `
        <div data-estado="data">
            <div class="small text-muted mb-2">${notas.length} NF-e listada(s).</div>
            <div class="table-responsive">
                <table class="table table-sm table-hover align-middle" id="nfeTabelaNotas">
                    <thead><tr><th>Número</th><th>Série</th><th>Data</th><th>Cliente</th><th>CPF/CNPJ</th><th class="text-end">Valor</th>
                        <th>Status</th><th>Origem</th><th>Pedido</th><th>Venda</th><th>Chave</th><th class="text-end">Ações</th></tr></thead>
                    <tbody>${linhas}</tbody>
                </table>
            </div>
        </div>`;
}

async function nfeCarregarEmitidas(seq) {
    const resp = await nfeRequest(`/nfe/notas?${nfeQueryNotas(nfeFiltrosPainel())}`, { timeoutMs: NFE_TIMEOUT_TELA_MS });
    if (!nfeCargaAtual(seq)) return;
    if (!resp.ok) {
        nfeErroCarga(resp, 'Não foi possível carregar as NF-e.');
        return;
    }
    const notas = Array.isArray(resp.data && resp.data.notas) ? resp.data.notas : [];
    nfeDefinirConteudo(notas.length ? nfeHtmlTabelaEmitidas(notas) : nfeHtmlEstado('empty', { mensagem: 'Nenhuma NF-e encontrada.' }));
}

// --- Monitor NF-e ----------------------------------------------------------

const NFE_MONITOR_ESTADOS = [
    ['transmitindo', 'Transmitindo', ['transmitindo', 'emitindo', 'pendente'], 'text-info'],
    ['aguardando_retorno', 'Aguardando retorno', ['aguardando_retorno', 'lote_processamento'], 'text-warning'],
    ['autorizada', 'Autorizada', ['autorizada'], 'text-success'],
    ['rejeitada', 'Rejeitada', ['rejeitada'], 'text-danger'],
    ['denegada', 'Denegada', ['denegada'], 'text-dark'],
    ['erro_transmissao', 'Erro de transmissão',
        ['erro_transmissao', 'erro_comunicacao', 'timeout', 'servico_indisponivel', 'erro_assinatura', 'erro_validacao'], 'text-danger'],
    ['nao_localizada_sefaz', 'Não localizada', ['nao_localizada_sefaz'], 'text-warning'],
    ['cancelada', 'Cancelada', ['cancelada'], 'text-secondary'],
    ['cancelamento_rejeitado', 'Cancelamento rejeitado', ['cancelamento_rejeitado'], 'text-danger']
];

/** Agrupa os totais por status de /nfe/monitor nos estados exibidos no Monitor. */
function nfeAgruparMonitor(totais) {
    const porStatus = {};
    let total = 0;
    (Array.isArray(totais) ? totais : []).forEach((t) => {
        const s = String((t && t.status) || '').toLowerCase();
        const q = Number(t && t.qtd) || 0;
        porStatus[s] = (porStatus[s] || 0) + q;
        total += q;
    });
    const usados = new Set();
    const cards = NFE_MONITOR_ESTADOS.map(([chave, rotulo, statuses, cor]) => {
        statuses.forEach((s) => usados.add(s));
        return { chave, rotulo, cor, qtd: statuses.reduce((acc, s) => acc + (porStatus[s] || 0), 0) };
    });
    const outros = Object.keys(porStatus).filter((s) => !usados.has(s)).reduce((acc, s) => acc + porStatus[s], 0);
    return { cards, outros, total };
}

async function nfeCarregarMonitor(seq) {
    const resp = await nfeRequest('/nfe/monitor', { timeoutMs: NFE_TIMEOUT_TELA_MS });
    if (!nfeCargaAtual(seq)) return;
    if (!resp.ok) {
        nfeErroCarga(resp, 'Não foi possível carregar o monitor de NF-e.');
        return;
    }
    const { cards, outros, total } = nfeAgruparMonitor(resp.data && resp.data.totais);
    const atualizado = `<div class="small text-muted mt-2" id="nfeMonitorAtualizado">Atualizado em ${nfeEsc(nfeDataHoraLocal(resp.data && resp.data.atualizadoEm))}</div>`;
    if (!total) {
        nfeDefinirConteudo(nfeHtmlEstado('empty', { mensagem: 'Nenhuma NF-e registrada até o momento.', extra: atualizado }));
        return;
    }
    const card = (chave, rotulo, cor, qtd) => `
        <div class="col-6 col-md-4 col-xl-3">
            <div class="card text-center h-100" data-monitor="${chave}">
                <div class="card-body py-2">
                    <div class="small text-muted">${rotulo}</div>
                    <div class="fs-4 fw-bold ${qtd ? cor : 'text-muted'}">${qtd}</div>
                </div>
            </div>
        </div>`;
    const html = cards.map((c) => card(c.chave, c.rotulo, c.cor, c.qtd)).join('')
        + (outros ? card('outros', 'Outros', 'text-secondary', outros) : '');
    nfeDefinirConteudo(`
        <div data-estado="data">
            <div class="row g-2" id="nfeMonitor">${html}</div>
            <div class="small text-muted mt-2">Total de NF-e: <strong>${total}</strong></div>
            ${atualizado}
        </div>`);
}

// --- Fila NF-e -------------------------------------------------------------

const NFE_FILA_GRUPOS = [
    ['pendentes', 'Pendentes', ['reenvio'], 'text-primary'],
    ['processamento', 'Em processamento', ['transmitindo', 'consulta'], 'text-info'],
    ['aguardando', 'Aguardando retorno', ['aguardando'], 'text-warning'],
    ['erros', 'Erros', ['erro'], 'text-danger']
];

const NFE_FILA_ROTULO = {
    reenvio: 'Pendente',
    transmitindo: 'Em processamento',
    consulta: 'Em processamento (consulta)',
    aguardando: 'Aguardando retorno',
    erro: 'Erro'
};

/** Notas que ainda precisam de ação (fila_estado ≠ autorizado/cancelado) e contadores por grupo. */
function nfeResumoFila(itens) {
    const naFila = (Array.isArray(itens) ? itens : [])
        .filter((i) => !NFE_FILA_FINALIZADA.includes(String(i.fila_estado || '').toLowerCase()));
    const contadores = {};
    NFE_FILA_GRUPOS.forEach(([chave, , estados]) => {
        contadores[chave] = naFila.filter((i) => estados.includes(String(i.fila_estado || '').toLowerCase())).length;
    });
    const datas = naFila.map((i) => i.updated_at || i.ultima_tentativa_em || i.created_at).filter(Boolean).sort();
    return { naFila, contadores, total: naFila.length, ultimaAtualizacao: datas.length ? datas[datas.length - 1] : null };
}

function nfeHtmlTabelaFila(naFila) {
    const linhas = naFila.map((i) => `
        <tr data-fila-nota-id="${Number(i.id)}" data-fila-estado="${nfeEsc(i.fila_estado || '')}">
            <td>${nfeEsc(nfeNumeroFormatado(i.numero))}</td>
            <td>${nfeEsc(i.serie != null ? i.serie : '—')}</td>
            <td>${nfeEsc(i.cliente_nome || '—')}</td>
            <td class="text-end text-nowrap">${nfeEsc(nfeMoeda(i.valor))}</td>
            <td>${nfeBadgeStatus(i.status)}<div class="small text-muted">${nfeEsc(NFE_FILA_ROTULO[String(i.fila_estado || '').toLowerCase()] || '')}</div></td>
            <td class="text-center">${Number(i.tentativas) || 0}</td>
            <td class="text-nowrap small">${nfeEsc(nfeDataHora(i.ultima_tentativa_em))}</td>
            <td class="text-nowrap small">${nfeEsc(nfeDataHora(i.updated_at))}</td>
            <td class="small">${nfeEsc(i.erro_mensagem || '—')}${i.erro_sugestao ? `<div class="text-muted">${nfeEsc(i.erro_sugestao)}</div>` : ''}</td>
            <td class="text-end">${nfeHtmlAcoesNota(i, { reprocessar: true })}</td>
        </tr>`).join('');
    return `
        <div class="table-responsive">
            <table class="table table-sm align-middle" id="nfeTabelaFila">
                <thead><tr><th>Número</th><th>Série</th><th>Cliente</th><th class="text-end">Valor</th><th>Status</th><th class="text-center">Tentativas</th>
                    <th>Última tentativa</th><th>Última atualização</th><th>Erro</th><th class="text-end">Ações</th></tr></thead>
                <tbody>${linhas}</tbody>
            </table>
        </div>`;
}

async function nfeCarregarFila(seq) {
    const resp = await nfeRequest('/nfe/fila?limite=200', { timeoutMs: NFE_TIMEOUT_TELA_MS });
    if (!nfeCargaAtual(seq)) return;
    if (!resp.ok) {
        nfeErroCarga(resp, 'Não foi possível carregar a fila de NF-e.');
        return;
    }
    const resumo = nfeResumoFila(resp.data && resp.data.itens);
    const cards = NFE_FILA_GRUPOS.map(([chave, rotulo, , cor]) => `
        <div class="col-6 col-md">
            <div class="card text-center h-100" data-fila-contador="${chave}">
                <div class="card-body py-2">
                    <div class="small text-muted">${rotulo}</div>
                    <div class="fs-4 fw-bold ${resumo.contadores[chave] ? cor : 'text-muted'}">${resumo.contadores[chave]}</div>
                </div>
            </div>
        </div>`).join('');
    const topo = `
        <div class="row g-2 mb-2" id="nfeFilaContadores">${cards}
            <div class="col-6 col-md">
                <div class="card text-center h-100" data-fila-contador="total">
                    <div class="card-body py-2">
                        <div class="small text-muted">Na fila</div>
                        <div class="fs-4 fw-bold">${resumo.total}</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="small text-muted mb-3" id="nfeFilaAtualizacao">
            Última atualização de nota: ${nfeEsc(resumo.ultimaAtualizacao ? nfeDataHora(resumo.ultimaAtualizacao) : '—')}
            · Consultado em ${nfeEsc(nfeDataHoraLocal())}
            · A fila só é lida ao abrir esta tela; nenhuma nota é enviada automaticamente.
        </div>`;
    nfeDefinirConteudo(`<div data-estado="${resumo.total ? 'data' : 'empty'}">${topo}${resumo.total
        ? nfeHtmlTabelaFila(resumo.naFila)
        : nfeHtmlEstado('empty', { mensagem: 'Nenhuma NF-e na fila.', icone: 'fa-check-circle' })}</div>`);
}

/** [Reprocessar] da fila: endpoint existente POST /nfe/notas/:id/reenviar (consulta a SEFAZ antes de retransmitir). */
async function nfeReprocessarNota(notaId) {
    if (!nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR)) {
        nfeNotificar(NFE_MSG_SEM_PERMISSAO, 'warning');
        return null;
    }
    if (NFE_REPROCESSANDO) return null;
    const confirmar = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('Reprocessar esta NF-e? O sistema consulta a SEFAZ antes e só retransmite se a nota não estiver registrada lá.')
        : false;
    if (!confirmar) return null;
    NFE_REPROCESSANDO = true;
    try {
        const resp = await nfeRequest(`/nfe/notas/${Number(notaId)}/reenviar`, { method: 'POST' });
        const data = resp.data || {};
        const sucesso = resp.ok && data.success !== false;
        nfeNotificar(nfeMensagemPermissao(resp, sucesso ? 'Reprocessamento concluído.' : 'Não foi possível reprocessar a NF-e.'),
            sucesso ? 'success' : 'warning');
        return resp;
    } finally {
        NFE_REPROCESSANDO = false;
        nfeRecarregarSecaoAtual();
    }
}

// --- Diagnóstico NF-e ------------------------------------------------------

function nfeLinhaDiag(rotulo, nivel, mensagem, valor) {
    return { rotulo, nivel, mensagem: mensagem || '', valor: valor == null ? null : valor };
}

function nfeLinhaDoItem(rotulo, item) {
    if (!item) return nfeLinhaDiag(rotulo, 'pendente', 'Não informado pelo diagnóstico.');
    return nfeLinhaDiag(rotulo, item.nivel, item.mensagem, item.valor);
}

function nfeLinhasCertificado(item) {
    if (!item) return [nfeLinhaDiag('Configurado', 'pendente', 'Não informado pelo diagnóstico.')];
    const msg = String(item.mensagem || '');
    const valor = String(item.valor || '');
    const naoConfigurado = /não configurad|não encontrado/i.test(msg) && !/CNPJ/.test(msg);
    const configurado = naoConfigurado
        ? nfeLinhaDiag('Configurado', 'pendente', msg)
        : nfeLinhaDiag('Configurado', 'ok', 'Certificado A1 configurado.', valor.split(' — ')[0] || null);
    let validade;
    const ate = valor.match(/válido até (\S+)/);
    if (item.codigo === 'CERTIFICATE_EXPIRED') validade = nfeLinhaDiag('Validade', 'bloqueado', 'Certificado A1 vencido.');
    else if (/período de validade/i.test(msg)) validade = nfeLinhaDiag('Validade', 'bloqueado', msg);
    else if (/Não foi possível abrir/i.test(msg)) validade = nfeLinhaDiag('Validade', 'pendente', msg);
    else if (ate) validade = nfeLinhaDiag('Validade', 'ok', `Válido até ${ate[1]}.`);
    else validade = nfeLinhaDiag('Validade', 'na', 'Não verificada.');
    let cnpj;
    if (item.nivel === 'ok') cnpj = nfeLinhaDiag('CNPJ compatível', 'ok', msg);
    else if (/diverge/i.test(msg)) cnpj = nfeLinhaDiag('CNPJ compatível', 'bloqueado', 'Certificado incompatível com o CNPJ da empresa.', msg);
    else if (/identificar o CNPJ/i.test(msg)) cnpj = nfeLinhaDiag('CNPJ compatível', 'bloqueado', msg);
    else if (/Configure o CNPJ/i.test(msg)) cnpj = nfeLinhaDiag('CNPJ compatível', 'pendente', msg);
    else cnpj = nfeLinhaDiag('CNPJ compatível', 'na', 'Não verificado.');
    return [configurado, validade, cnpj];
}

function nfeLinhasEmpresa(diag, porId) {
    const empresa = porId.empresa;
    const msg = String((empresa && empresa.mensagem) || '');
    const pendente = empresa && empresa.nivel !== 'ok';
    const uf = (diag && diag.uf) || {};
    return [
        nfeLinhaDiag('Razão social', pendente && /razão social/i.test(msg) ? 'pendente' : (empresa ? 'ok' : 'pendente'),
            pendente && /razão social/i.test(msg) ? 'Razão social / nome da empresa não configurado.' : 'Configurada.',
            empresa ? empresa.valor : null),
        nfeLinhaDoItem('CNPJ', porId.cnpj),
        nfeLinhaDiag('Inscrição estadual', pendente && /inscrição estadual/i.test(msg) ? 'pendente' : (empresa ? 'ok' : 'pendente'),
            pendente && /inscrição estadual/i.test(msg) ? 'Inscrição estadual não configurada.' : (msg || 'Configurada.')),
        uf.sigla
            ? nfeLinhaDiag('UF', 'ok', uf.codigo ? `Código IBGE ${uf.codigo}.` : 'Configurada.', uf.sigla)
            : nfeLinhaDiag('UF', 'alerta', 'UF da empresa não configurada.', uf.codigo || null)
    ];
}

/** Consulta, status e evento resolvidos pelo mesmo resolvedor do emissor (a autorização vem do item). */
function nfeLinhasWebservices(diag) {
    const ws = (diag && diag.webservices) || {};
    return [['consultaProtocolo', 'Consulta'], ['status', 'Status do serviço'], ['evento', 'Evento']]
        .filter(([servico]) => ws[servico])
        .map(([servico, rotulo]) => {
            const r = ws[servico];
            if (!r.ok) return nfeLinhaDiag(rotulo, 'pendente', `Configuração inválida em ${r.chave}.`);
            return nfeLinhaDiag(rotulo, 'ok', r.origem === 'configuracao' ? `Configurado em ${r.chave}.` : 'SVRS (padrão oficial).', r.url);
        });
}

/** Agrupa os itens de /nfe/prontidao (diagnóstico local) nos grupos da tela Diagnóstico NF-e. */
function nfeGruposDiagnostico(diag) {
    const itens = Array.isArray(diag && diag.itens) ? diag.itens : [];
    const porId = {};
    itens.forEach((i) => { porId[i.id] = i; });
    const grupos = [
        { id: 'certificado', titulo: 'Certificado', linhas: nfeLinhasCertificado(porId.certificado) },
        { id: 'empresa', titulo: 'Empresa', linhas: nfeLinhasEmpresa(diag, porId) },
        {
            id: 'ambiente',
            titulo: 'Ambiente',
            linhas: [
                nfeLinhaDoItem('Ambiente', porId.ambiente),
                nfeLinhaDiag('Modelo', 'ok', 'NF-e modelo 55.', '55'),
                nfeLinhaDoItem('Série', porId.serie),
                nfeLinhaDoItem('Produção', porId.producao)
            ].concat(diag && diag.ambienteNfce
                ? [nfeLinhaDiag('NFC-e (PDV)', 'na', 'fiscal_ambiente — não define o ambiente da NF-e.', diag.ambienteNfce)]
                : [])
        },
        { id: 'numeracao', titulo: 'Numeração', linhas: [nfeLinhaDoItem('Série', porId.serie), nfeLinhaDoItem('Numeração', porId.numeracao)] },
        { id: 'webservice', titulo: 'Webservice', linhas: [nfeLinhaDoItem('Autorização', porId.webservice)].concat(nfeLinhasWebservices(diag)) },
        {
            id: 'permissoes',
            titulo: 'Permissões do usuário',
            linhas: [
                nfeUsuarioTemPermissao(NFE_PERMISSAO_EMITIR)
                    ? nfeLinhaDiag(NFE_PERMISSAO_EMITIR, 'ok', 'Seu usuário pode emitir NF-e.')
                    : nfeLinhaDiag(NFE_PERMISSAO_EMITIR, 'alerta', 'Seu usuário não pode emitir NF-e.'),
                nfeUsuarioTemPermissao(NFE_PERMISSAO_CANCELAR)
                    ? nfeLinhaDiag(NFE_PERMISSAO_CANCELAR, 'ok', 'Seu usuário pode cancelar NF-e.')
                    : nfeLinhaDiag(NFE_PERMISSAO_CANCELAR, 'alerta', 'Seu usuário não pode cancelar NF-e.')
            ]
        }
    ];
    if (porId.dbDir) grupos.push({ id: 'banco', titulo: 'Banco de dados', linhas: [nfeLinhaDoItem('Banco ativo', porId.dbDir)] });
    const conhecidos = ['dbDir', 'empresa', 'cnpj', 'certificado', 'ambiente', 'serie', 'numeracao', 'webservice', 'producao'];
    const outros = itens.filter((i) => !conhecidos.includes(i.id));
    if (outros.length) grupos.push({ id: 'outros', titulo: 'Outros', linhas: outros.map((i) => nfeLinhaDoItem(i.nome || i.id, i)) });
    return grupos;
}

const NFE_DIAG_ICONE = Object.assign({}, NFE_PRONTIDAO_ICONE, { na: 'fa-minus-circle text-muted' });

function nfeHtmlDiagnostico(diag) {
    const d = diag || {};
    const grupos = nfeGruposDiagnostico(d);
    const problemas = [];
    const htmlGrupos = grupos.map((g) => {
        const linhas = g.linhas.map((l) => {
            if (l.nivel === 'pendente' || l.nivel === 'bloqueado') problemas.push(l.mensagem || `${g.titulo}: ${l.rotulo}`);
            return `
                <tr data-diag-linha="${nfeEsc(l.rotulo)}" data-nivel="${nfeEsc(l.nivel)}">
                    <td style="width:2rem"><i class="fas ${NFE_DIAG_ICONE[l.nivel] || 'fa-question-circle text-muted'}"></i></td>
                    <td class="fw-semibold" style="width:12rem">${nfeEsc(l.rotulo)}</td>
                    <td>${l.valor != null && l.valor !== '' ? `${nfeEsc(l.valor)}<div class="small text-muted">${nfeEsc(l.mensagem)}</div>` : nfeEsc(l.mensagem)}</td>
                </tr>`;
        }).join('');
        return `
            <div class="col-lg-6">
                <div class="card h-100" data-diag-grupo="${g.id}">
                    <div class="card-header py-2 fw-semibold text-uppercase small">${nfeEsc(g.titulo)}</div>
                    <div class="card-body py-1"><table class="table table-sm align-middle mb-0"><tbody>${linhas}</tbody></table></div>
                </div>
            </div>`;
    }).join('');
    const unicos = [...new Set(problemas)];
    const listaProblemas = unicos.length
        ? `<div class="alert alert-warning py-2" id="nfeDiagProblemas"><strong>${NFE_MSG_NAO_PRONTA}</strong>
               <ul class="mb-0 small list-unstyled">${unicos.map((p) => `<li>✕ ${nfeEsc(p)}</li>`).join('')}</ul></div>`
        : '';
    return `
        <div id="nfeProntidaoCard" data-status="${nfeEsc(d.status || '')}" data-estado="data">
            <div class="fw-bold mb-2 ${d.pronta ? 'text-success' : 'text-danger'}" id="nfeProntidaoStatus">
                STATUS: ${d.pronta ? 'PRONTA PARA HOMOLOGAÇÃO' : 'NF-E NÃO CONFIGURADA'}
            </div>
            ${listaProblemas}
            <div class="row g-3">${htmlGrupos}</div>
            <div class="small text-muted mt-3">
                Diagnóstico local da configuração — nenhuma chamada à SEFAZ. Verificado em ${nfeEsc(nfeDataHoraLocal(d.verificadoEm))}.
            </div>
        </div>`;
}

async function nfeCarregarDiagnostico(seq) {
    const resp = await nfeRequest('/nfe/prontidao', { timeoutMs: NFE_TIMEOUT_TELA_MS });
    if (!nfeCargaAtual(seq)) return;
    if (!resp.ok || !resp.data || !Array.isArray(resp.data.itens)) {
        nfeErroCarga(resp, 'Não foi possível carregar o diagnóstico da NF-e.');
        return;
    }
    nfeDefinirConteudo(nfeHtmlDiagnostico(resp.data));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        nfeCpfValido,
        nfeCnpjValido,
        validarDadosEmissaoNfe,
        montarPayloadEmissaoNfe,
        dadosIniciaisEmissaoNfe,
        classificarResultadoEmissaoNfe,
        classificarResultadoConfirmacaoNfe,
        situacaoNfeVenda,
        nfeQueryNotas,
        validarJustificativaCancelamentoNfe,
        nfeHtmlProntidao,
        nfeGruposDiagnostico,
        nfeRotuloAmbienteNfe,
        nfeRotuloOrigem,
        nfeRotuloOrigemCurto,
        nfeSecaoDaPagina,
        nfeAgruparMonitor,
        nfeResumoFila,
        nfeDocumentoFormatado,
        nfeMoeda,
        NFE_MSG_SEM_DOCUMENTO,
        NFE_MSG_CANCELAMENTO,
        NFE_MSG_NAO_PRONTA
    };
}
