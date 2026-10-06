/**
 * Orçamentos e Pedidos — NF-E-04.0.
 * Orçamento → Aprovação → Pedido → [Emitir NF-e]. Pedido direto também é permitido.
 * "Emitir NF-e" gera a venda do pedido pelo fluxo oficial e abre a emissão NF-e existente
 * (abrirEmissaoNfe). Depende dos helpers de nfe.js (nfeRequest, nfeEsc, nfeMostrarModal...).
 */

const PED_STATUS_ORCAMENTO = {
    RASCUNHO: ['Rascunho', 'bg-secondary'],
    APRESENTADO: ['Apresentado', 'bg-info text-dark'],
    APROVADO: ['Aprovado', 'bg-success'],
    REPROVADO: ['Reprovado', 'bg-danger'],
    CANCELADO: ['Cancelado', 'bg-dark']
};
const PED_STATUS_PEDIDO = {
    ABERTO: ['Aberto', 'bg-primary'],
    FATURADO: ['Faturado', 'bg-success'],
    CANCELADO: ['Cancelado', 'bg-dark']
};
const OPC_FORMAS_PAGAMENTO = [
    ['dinheiro', 'Dinheiro'],
    ['pix', 'PIX'],
    ['cartao_credito', 'Cartão de crédito'],
    ['cartao_debito', 'Cartão de débito'],
    ['prazo', 'A prazo']
];
function pedMoeda(valor) {
    return `R$ ${(Number(valor) || 0).toFixed(2).replace('.', ',')}`;
}

function pedBadge(mapa, status) {
    const [rotulo, classe] = mapa[status] || [status || '—', 'bg-secondary'];
    return `<span class="badge ${classe}">${nfeEsc(rotulo)}</span>`;
}

// ---------------------------------------------------------------------------
// Editor de operação comercial (cliente, itens, desconto, pagamento).
// Usado no orçamento, no pedido direto e na emissão manual de NF-e.
// ---------------------------------------------------------------------------

async function opcCarregarCadastros() {
    const [clientes, produtos] = await Promise.all([nfeRequest('/clientes'), nfeRequest('/produtos')]);
    if (!clientes.ok || !produtos.ok) {
        throw new Error(nfeMensagemErro((clientes.ok ? produtos : clientes).data, 'Não foi possível carregar clientes e produtos.'));
    }
    return {
        clientes: Array.isArray(clientes.data) ? clientes.data : [],
        produtos: (Array.isArray(produtos.data) ? produtos.data : []).filter((p) => p.ativo === undefined || Number(p.ativo) !== 0)
    };
}

function opcHtmlOpcoesProdutos(produtos, selecionado) {
    return '<option value="">Selecione...</option>' + produtos.map((p) => `
        <option value="${Number(p.id)}" data-preco="${Number(p.preco_venda) || 0}"${Number(selecionado) === Number(p.id) ? ' selected' : ''}>
            ${nfeEsc(p.nome)}${p.saldo_fiscal != null ? ` (fiscal: ${Number(p.saldo_fiscal) || 0})` : ''}
        </option>`).join('');
}

const OPC_BUSCA_LIMITE = 10;

function opcNormalizarBusca(valor) {
    return String(valor || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function opcHtmlBarraProduto(classeExtra) {
    const extra = classeExtra ? ` ${classeExtra}` : '';
    return `
        <div class="opc-busca opc-busca-barra" data-opc-busca>
            <i class="fas fa-search opc-busca-barra__icone" aria-hidden="true"></i>
            <input type="search" class="form-control opc-busca-barra__input${extra}" data-opc-busca-barra data-opc-busca-input placeholder="Digite código, código de barras ou nome do produto..." autocomplete="off">
            <div class="opc-busca-resultados list-group" data-opc-busca-resultados hidden></div>
        </div>`;
}

function opcHtmlSelectProduto(prefixo, produtos, selecionado, extraClasse) {
    const classe = extraClasse ? ` ${extraClasse}` : '';
    return `<select class="opc-produto-oculto${classe}" data-campo="produto" tabindex="-1" aria-hidden="true" onchange="opcAoTrocarProduto(this, '${prefixo}')">${opcHtmlOpcoesProdutos(produtos, selecionado)}</select>`;
}

function opcHtmlLinhaItem(prefixo, produtos, item = {}) {
    return pedHtmlLinhaItem(prefixo, produtos, item);
}

function opcHtmlEditor(prefixo, cadastros, inicial = {}) {
    return pedHtmlDocumento(inicial.tipo || 'pedido', cadastros, inicial, prefixo);
}

function opcProdutos(prefixo) {
    const editor = document.getElementById(`${prefixo}Editor`);
    return (editor && editor._produtos) || [];
}

function opcFocarCampo(campo) {
    if (!campo || typeof campo.focus !== 'function') return;
    campo.focus();
    if (typeof campo.select === 'function') campo.select();
}

function opcFocarBarraProduto(prefixo) {
    const editor = document.getElementById(`${prefixo}Editor`);
    const barra = editor && editor.querySelector('[data-opc-busca-barra]');
    if (!barra || typeof barra.focus !== 'function') return false;
    barra.focus();
    if (typeof barra.select === 'function') barra.select();
    return true;
}

function opcPrepararNovaInclusao(prefixo) {
    const editor = document.getElementById(`${prefixo}Editor`);
    const barra = editor && editor.querySelector('[data-opc-busca-barra]');
    if (barra) {
        barra.value = '';
        opcFecharBuscaProduto(barra.closest('[data-opc-busca]'));
    }
    opcFocarBarraProduto(prefixo);
}

function opcFocarProdutoLinha(linha) {
    const editor = linha && linha.closest ? linha.closest('[data-opc-editor]') : null;
    const prefixo = opcPrefixoDoEditor(editor);
    if (prefixo && opcFocarBarraProduto(prefixo)) return;
    if (!linha) return;
    const quantidade = linha.querySelector('[data-campo="quantidade"]');
    if (quantidade && typeof quantidade.focus === 'function') quantidade.focus();
}

function opcLigarChangeProduto(prefixo) {
    const editor = document.getElementById(`${prefixo}Editor`);
    if (!editor) return;
    editor.querySelectorAll('[data-campo="produto"]').forEach((select) => {
        if (typeof select.onchange === 'function') return;
        select.onchange = function () { opcAoTrocarProduto(this, prefixo); };
    });
}

function opcAdicionarItem(prefixo) {
    const corpo = document.getElementById(`${prefixo}Itens`);
    if (!corpo) return;
    const produtos = opcProdutos(prefixo);
    const htmlLinha = prefixo === 'nfeManual' && typeof nfeManualHtmlLinha === 'function'
        ? nfeManualHtmlLinha(produtos)
        : pedHtmlLinhaItem(prefixo, produtos);
    corpo.insertAdjacentHTML('beforeend', htmlLinha);
    opcLigarChangeProduto(prefixo);
    if (prefixo === 'nfeManual' && typeof nfeManualEnriquecerLinhas === 'function') nfeManualEnriquecerLinhas();
    opcRecalcular(prefixo);
    if (prefixo === 'nfeManual' && typeof nfeManualAtualizarResumo === 'function') nfeManualAtualizarResumo();
    const linhas = corpo.querySelectorAll('tr[data-opc-item]');
    opcFocarProdutoLinha(linhas[linhas.length - 1]);
}

function opcRemoverItem(botao, prefixo) {
    const linha = botao.closest('tr');
    if (linha) linha.remove();
    opcRecalcular(prefixo);
}

function opcAoTrocarProduto(select, prefixo) {
    const linha = select.closest('[data-opc-item]');
    const opcao = select.options[select.selectedIndex];
    const preco = linha && linha.querySelector('[data-campo="preco"]');
    if (linha && linha.dataset.precoGravado && preco) {
        preco.value = Number(linha.dataset.precoGravado).toFixed(2);
        delete linha.dataset.precoGravado;
    } else if (opcao && preco && Number(opcao.dataset.preco) > 0) preco.value = Number(opcao.dataset.preco).toFixed(2);
    opcRecalcular(prefixo);
    if (typeof nfeManualAtualizarLinhaFiscal === 'function') nfeManualAtualizarLinhaFiscal(linha);
    if (!select.value || !linha) return;
    if (!opcFocarBarraProduto(prefixo)) {
        const quantidade = linha.querySelector('[data-campo="quantidade"]');
        opcFocarCampo(quantidade);
    }
}

function opcLerEditor(prefixo) {
    const valor = (id) => {
        const el = document.getElementById(`${prefixo}${id}`);
        return el ? el.value : '';
    };
    const itens = Array.from(document.querySelectorAll(`#${prefixo}Itens tr[data-opc-item]`)).map((tr) => ({
        produto_id: Number(tr.querySelector('[data-campo="produto"]').value) || null,
        quantidade: Number(tr.querySelector('[data-campo="quantidade"]').value) || 0,
        preco_unitario: Number(tr.querySelector('[data-campo="preco"]').value) || 0
    }));
    const forma = valor('Forma') || 'dinheiro';
    return {
        cliente_id: Number(valor('Cliente')) || null,
        itens,
        desconto: Number(valor('Desconto')) || 0,
        forma_pagamento: forma,
        parcelas: forma === 'prazo' ? Math.max(1, Number(valor('Parcelas')) || 1) : null
    };
}

function opcTotais(dados) {
    const totalItens = Math.round((dados.itens || []).reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.preco_unitario) || 0), 0) * 100) / 100;
    const desconto = Number(dados.desconto) || 0;
    return { totalItens, desconto, total: Math.round((totalItens - desconto) * 100) / 100 };
}

/** Validação local antes de enviar; o backend repete todas as regras. */
function opcValidarDados(dados) {
    const erros = [];
    if (!dados.cliente_id) erros.push('Selecione o cliente.');
    if (!dados.itens || !dados.itens.length) erros.push('Informe ao menos um item.');
    (dados.itens || []).forEach((i, idx) => {
        if (!i.produto_id) erros.push(`Item ${idx + 1}: selecione o produto.`);
        if (!(i.quantidade > 0)) erros.push(`Item ${idx + 1}: quantidade deve ser maior que zero.`);
        if (!(i.preco_unitario > 0)) erros.push(`Item ${idx + 1}: preço deve ser maior que zero.`);
    });
    const t = opcTotais(dados);
    if (t.desconto < 0 || (t.totalItens > 0 && t.desconto >= t.totalItens)) erros.push('Desconto inválido.');
    return erros;
}

function opcRecalcular(prefixo) {
    const linhas = document.querySelectorAll(`#${prefixo}Itens tr[data-opc-item]`);
    linhas.forEach((tr, indice) => {
        const q = Number(tr.querySelector('[data-campo="quantidade"]').value) || 0;
        const p = Number(tr.querySelector('[data-campo="preco"]').value) || 0;
        const subtotal = tr.querySelector('[data-campo="subtotal"]');
        if (subtotal) subtotal.textContent = pedMoeda(q * p);
        const numero = tr.querySelector('[data-ped-campo="indice"]');
        if (numero) numero.textContent = String(indice + 1);
        if (prefixo !== 'nfeManual') pedAtualizarLinhaComercial(tr, prefixo);
    });
    const dados = opcLerEditor(prefixo);
    const totais = opcTotais(dados);
    const total = document.getElementById(`${prefixo}Total`);
    if (total) total.textContent = pedMoeda(totais.total);
    const resumoProdutos = document.getElementById(`${prefixo}ResumoProdutos`);
    if (resumoProdutos) resumoProdutos.textContent = pedMoeda(totais.totalItens);
    const resumoDesconto = document.getElementById(`${prefixo}ResumoDesconto`);
    if (resumoDesconto) resumoDesconto.textContent = pedMoeda(totais.desconto);
    const contador = document.getElementById(`${prefixo}Contador`);
    if (contador) {
        const n = (dados.itens || []).filter((item) => item.produto_id).length;
        contador.textContent = n === 1 ? '1 item' : `${n} itens`;
    }
    const vazio = document.getElementById(`${prefixo}Vazio`);
    const grade = document.getElementById(`${prefixo}Grade`);
    if (vazio) vazio.hidden = linhas.length > 0;
    if (grade) grade.hidden = linhas.length === 0;
    const parcelas = document.getElementById(`${prefixo}ParcelasGrupo`);
    if (parcelas) parcelas.classList.toggle('d-none', dados.forma_pagamento !== 'prazo');
}

function opcExibirErros(prefixo, erros) {
    const caixa = document.getElementById(`${prefixo}Erros`);
    if (!caixa) return;
    if (!erros || !erros.length) {
        caixa.classList.add('d-none');
        caixa.innerHTML = '';
        return;
    }
    caixa.innerHTML = `<ul class="mb-0 ps-3">${erros.map((e) => `<li>${nfeEsc(e)}</li>`).join('')}</ul>`;
    caixa.classList.remove('d-none');
}

function opcPrefixoDoEditor(editor) {
    const id = editor && editor.id ? editor.id : '';
    return id.endsWith('Editor') ? id.slice(0, -'Editor'.length) : '';
}

function opcProdutoCasaBusca(produto, termo) {
    if (!termo || !produto) return false;
    return [produto.codigo, produto.codigo_barras, produto.nome, produto.descricao]
        .some((campo) => opcNormalizarBusca(campo).includes(termo));
}

function opcFecharBuscaProduto(caixa) {
    if (!caixa) return;
    const lista = caixa.querySelector('[data-opc-busca-resultados]');
    if (lista) {
        lista.hidden = true;
        lista.innerHTML = '';
    }
    caixa._opcIndice = 0;
}

function opcMarcarResultadoAtivo(lista, indice) {
    const itens = lista.querySelectorAll('[data-opc-busca-id]');
    itens.forEach((item, i) => item.classList.toggle('active', i === indice));
    const ativo = itens[indice];
    if (ativo && typeof ativo.scrollIntoView === 'function') ativo.scrollIntoView({ block: 'nearest' });
}

function opcHtmlResultadoBusca(produto, indice) {
    const codigo = produto.codigo || produto.id;
    const estoque = Number(produto.saldo_fiscal) || 0;
    return `
        <button type="button" class="list-group-item list-group-item-action opc-busca-item${indice === 0 ? ' active' : ''}" data-opc-busca-id="${Number(produto.id)}" data-opc-busca-indice="${indice}">
            <strong>${nfeEsc(produto.nome || '')}</strong>
            <div class="small">Código ${nfeEsc(codigo)} · Estoque fiscal ${estoque} · ${pedMoeda(produto.preco_venda)}</div>
        </button>`;
}

function opcAtualizarBuscaProduto(input) {
    const caixa = input.closest('[data-opc-busca]');
    const lista = caixa && caixa.querySelector('[data-opc-busca-resultados]');
    const editor = input.closest('[data-opc-editor]');
    if (!caixa || !lista || !editor) return;
    const termo = opcNormalizarBusca(input.value);
    if (!termo) {
        opcFecharBuscaProduto(caixa);
        return;
    }
    const encontrados = (editor._produtos || []).filter((produto) => opcProdutoCasaBusca(produto, termo));
    const visiveis = encontrados.slice(0, OPC_BUSCA_LIMITE);
    const aviso = encontrados.length > OPC_BUSCA_LIMITE
        ? '<div class="opc-busca-mais">Digite mais caracteres para refinar.</div>'
        : '';
    lista.innerHTML = visiveis.length
        ? visiveis.map(opcHtmlResultadoBusca).join('') + aviso
        : '<div class="opc-busca-vazio">Nenhum produto encontrado.</div>';
    lista.hidden = false;
    caixa._opcIndice = 0;
    opcPosicionarResultados(input);
}

function opcPosicionarResultados(input) {
    const caixa = input && input.closest && input.closest('[data-opc-busca]');
    const lista = caixa && caixa.querySelector('[data-opc-busca-resultados]');
    if (!lista || lista.hidden || !input.getBoundingClientRect) return;
    const rect = input.getBoundingClientRect();
    lista.style.position = 'fixed';
    lista.style.zIndex = '2000';
    lista.style.left = `${Math.round(rect.left)}px`;
    lista.style.top = `${Math.round(rect.bottom + 2)}px`;
    const margem = 8;
    const largura = Math.max(180, Math.min(Math.round(rect.width), Math.round((window.innerWidth || rect.width) - rect.left - margem)));
    lista.style.width = `${largura}px`;
}

function opcSelecionarResultadoBusca(botao) {
    const editor = botao.closest('[data-opc-editor]');
    const prefixo = opcPrefixoDoEditor(editor);
    const id = botao.getAttribute('data-opc-busca-id') || '';
    const caixa = botao.closest('[data-opc-busca]');
    if (!editor || !prefixo || !id) return;
    opcAdicionarItem(prefixo);
    const linhas = document.querySelectorAll(`#${prefixo}Itens tr[data-opc-item]`);
    const select = linhas.length ? linhas[linhas.length - 1].querySelector('[data-campo="produto"]') : null;
    if (select) {
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const input = caixa && caixa.querySelector('[data-opc-busca-input]');
    if (input) input.value = '';
    opcFecharBuscaProduto(caixa);
    opcFocarBarraProduto(prefixo);
}

function opcNormalizarDecimal(event) {
    const campo = event.target;
    if (!campo || !campo.matches || !campo.matches('[data-campo="quantidade"], [data-campo="preco"]')) return;
    if (!String(campo.value).includes(',')) return;
    const pos = campo.selectionStart;
    campo.value = String(campo.value).replace(/,/g, '.');
    if (pos != null && typeof campo.setSelectionRange === 'function') campo.setSelectionRange(pos, pos);
}

function opcBuscaDelegada(event) {
    const input = event.target;
    if (!input || !input.matches || !input.matches('[data-opc-busca-input]')) return;
    opcAtualizarBuscaProduto(input);
}

function opcMouseBuscaDelegado(event) {
    const botao = event.target && event.target.closest && event.target.closest('[data-opc-busca-id]');
    if (!botao) return;
    event.preventDefault();
    opcSelecionarResultadoBusca(botao);
}

function opcTeclaDelegada(event) {
    const alvo = event.target;
    if (!alvo || !alvo.matches) return;
    if (alvo.matches('[data-campo="produto"]')) return;
    if (alvo.matches('[data-opc-busca-input]')) {
        if (event.key === 'Enter') event.preventDefault();
        opcBuscaProdutoTecla(event, alvo);
        return;
    }
    if (event.key !== 'Enter') return;
    const campo = alvo.getAttribute && alvo.getAttribute('data-campo');
    if (campo !== 'quantidade' && campo !== 'preco') return;
    event.preventDefault();
    const linha = alvo.closest('[data-opc-item]');
    if (!linha) return;
    if (campo === 'quantidade') {
        opcFocarCampo(linha.querySelector('[data-campo="preco"]'));
        return;
    }
    const prefixo = opcPrefixoDoEditor(alvo.closest('[data-opc-editor]'));
    if (prefixo && opcFocarBarraProduto(prefixo)) return;
    if (prefixo) opcAdicionarItem(prefixo);
}

function opcBuscaProdutoTecla(event, input) {
    const caixa = input.closest('[data-opc-busca]');
    const lista = caixa && caixa.querySelector('[data-opc-busca-resultados]');
    const aberta = lista && !lista.hidden;
    if (!aberta) return;
    const itens = Array.from(lista.querySelectorAll('[data-opc-busca-id]'));
    if (event.key === 'Escape') {
        event.preventDefault();
        opcFecharBuscaProduto(caixa);
        return;
    }
    if (!itens.length) return;
    let indice = Number(caixa._opcIndice) || 0;
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        indice = Math.min(itens.length - 1, indice + 1);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        indice = Math.max(0, indice - 1);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        opcSelecionarResultadoBusca(itens[indice] || itens[0]);
        return;
    } else {
        return;
    }
    caixa._opcIndice = indice;
    opcMarcarResultadoAtivo(lista, indice);
}

function opcPrepararEditor(prefixo, cadastros) {
    const editor = document.getElementById(`${prefixo}Editor`);
    if (editor) {
        editor._produtos = cadastros.produtos || [];
        editor._clientes = cadastros.clientes || [];
        if (!editor.dataset.opcBuscaPronta) {
            editor.dataset.opcBuscaPronta = '1';
            editor.addEventListener('input', (event) => {
                opcNormalizarDecimal(event);
                opcBuscaDelegada(event);
                const campo = event.target && event.target.getAttribute && event.target.getAttribute('data-campo');
                if (campo === 'quantidade' || campo === 'preco') opcRecalcular(prefixo);
            });
            editor.addEventListener('keydown', opcTeclaDelegada);
            editor.addEventListener('mousedown', opcMouseBuscaDelegado);
        }
        if (!document.documentElement.dataset.opcBuscaScroll) {
            document.documentElement.dataset.opcBuscaScroll = '1';
            document.addEventListener('scroll', () => {
                document.querySelectorAll('[data-opc-busca-input]').forEach((campo) => opcPosicionarResultados(campo));
            }, true);
            document.addEventListener('mousedown', (evento) => {
                const dentro = evento.target && evento.target.closest && evento.target.closest('[data-opc-busca]');
                if (dentro) return;
                document.querySelectorAll('[data-opc-busca]').forEach((caixa) => opcFecharBuscaProduto(caixa));
            });
        }
        opcLigarChangeProduto(prefixo);
        const buscaCliente = document.getElementById(`${prefixo}BuscaCliente`);
        if (buscaCliente && !buscaCliente.dataset.pedBuscaCliente) {
            buscaCliente.dataset.pedBuscaCliente = '1';
            buscaCliente.addEventListener('input', () => pedFiltrarClientes(prefixo));
        }
        const selectCliente = document.getElementById(`${prefixo}Cliente`);
        if (selectCliente && !selectCliente.dataset.pedCliente) {
            selectCliente.dataset.pedCliente = '1';
            selectCliente.addEventListener('change', () => pedMostrarCliente(prefixo));
        }
    }
    opcRecalcular(prefixo);
    if (prefixo !== 'nfeManual') pedMostrarCliente(prefixo);
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function pedHtmlPaginaBase() {
    return `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <h4 class="mb-0"><i class="fas fa-file-signature"></i> Orçamentos e Pedidos</h4>
                <small class="text-muted">Orçamento aprovado gera um pedido. A NF-e é emitida pelo detalhe do pedido.</small>
            </div>
            <div class="btn-group">
                <button type="button" class="btn btn-outline-primary btn-sm" id="pedBtnNovoOrcamento" onclick="pedAbrirNovoDocumento('orcamento')"><i class="fas fa-plus"></i> Novo orçamento</button>
                <button type="button" class="btn btn-primary btn-sm" id="pedBtnNovoPedido" onclick="pedAbrirNovoDocumento('pedido')"><i class="fas fa-plus"></i> Pedido direto</button>
            </div>
        </div>
        <ul class="nav nav-tabs mb-3">
            <li class="nav-item"><button type="button" class="nav-link active" data-bs-toggle="tab" data-bs-target="#pedAbaPedidos">Pedidos</button></li>
            <li class="nav-item"><button type="button" class="nav-link" data-bs-toggle="tab" data-bs-target="#pedAbaOrcamentos">Orçamentos</button></li>
        </ul>
        <div class="tab-content">
            <div class="tab-pane fade show active" id="pedAbaPedidos">
                <table class="table table-sm table-hover align-middle" id="pedTabelaPedidos">
                    <thead><tr><th>Pedido</th><th>Origem</th><th>Cliente</th><th>Status</th><th class="text-end">Total</th><th>Venda</th><th class="text-end">Ações</th></tr></thead>
                    <tbody><tr><td colspan="7" class="text-center text-muted">Carregando...</td></tr></tbody>
                </table>
            </div>
            <div class="tab-pane fade" id="pedAbaOrcamentos">
                <table class="table table-sm table-hover align-middle" id="pedTabelaOrcamentos">
                    <thead><tr><th>Orçamento</th><th>Cliente</th><th>Status</th><th class="text-end">Total</th><th>Pedido</th><th class="text-end">Ações</th></tr></thead>
                    <tbody><tr><td colspan="6" class="text-center text-muted">Carregando...</td></tr></tbody>
                </table>
            </div>
        </div>`;
}

function pedRotuloOrigem(p) {
    return p.origem === 'ORCAMENTO' ? `Orçamento ${nfeEsc(p.orcamento_codigo || `#${p.orcamento_id}`)}` : 'Direto';
}

function pedHtmlLinhasPedidos(pedidos) {
    if (!pedidos || !pedidos.length) return '<tr><td colspan="7" class="text-center text-muted">Nenhum pedido.</td></tr>';
    return pedidos.map((p) => `
        <tr data-pedido-id="${Number(p.id)}">
            <td>${nfeEsc(p.codigo || `#${p.id}`)}</td>
            <td>${pedRotuloOrigem(p)}</td>
            <td>${nfeEsc(p.cliente_nome || '—')}</td>
            <td>${pedBadge(PED_STATUS_PEDIDO, p.status)}</td>
            <td class="text-end">${pedMoeda(p.total)}</td>
            <td>${p.venda_id ? `#${Number(p.venda_id)}` : '—'}</td>
            <td class="text-end"><button type="button" class="btn btn-sm btn-outline-dark" onclick="pedAbrirPedido(${Number(p.id)})"><i class="fas fa-eye"></i></button></td>
        </tr>`).join('');
}

function pedHtmlLinhasOrcamentos(orcamentos) {
    if (!orcamentos || !orcamentos.length) return '<tr><td colspan="6" class="text-center text-muted">Nenhum orçamento.</td></tr>';
    return orcamentos.map((o) => `
        <tr data-orcamento-id="${Number(o.id)}">
            <td>${nfeEsc(o.codigo || `#${o.id}`)}</td>
            <td>${nfeEsc(o.cliente_nome || '—')}</td>
            <td>${pedBadge(PED_STATUS_ORCAMENTO, o.status)}</td>
            <td class="text-end">${pedMoeda(o.total)}</td>
            <td>${o.pedido_id ? `<a href="#" onclick="pedAbrirPedido(${Number(o.pedido_id)}); return false;">#${Number(o.pedido_id)}</a>` : '—'}</td>
            <td class="text-end"><button type="button" class="btn btn-sm btn-outline-dark" onclick="pedAbrirOrcamento(${Number(o.id)})"><i class="fas fa-eye"></i></button></td>
        </tr>`).join('');
}

async function pedCarregarListas() {
    const [pedidos, orcamentos] = await Promise.all([nfeRequest('/pedidos'), nfeRequest('/orcamentos')]);
    const corpoPed = document.querySelector('#pedTabelaPedidos tbody');
    if (corpoPed) {
        corpoPed.innerHTML = pedidos.ok
            ? pedHtmlLinhasPedidos(pedidos.data)
            : `<tr><td colspan="7" class="text-danger">${nfeEsc(nfeMensagemErro(pedidos.data, 'Erro ao carregar pedidos.'))}</td></tr>`;
    }
    const corpoOrc = document.querySelector('#pedTabelaOrcamentos tbody');
    if (corpoOrc) {
        corpoOrc.innerHTML = orcamentos.ok
            ? pedHtmlLinhasOrcamentos(orcamentos.data)
            : `<tr><td colspan="6" class="text-danger">${nfeEsc(nfeMensagemErro(orcamentos.data, 'Erro ao carregar orçamentos.'))}</td></tr>`;
    }
}

async function loadPedidos() {
    const alvo = document.getElementById('page-content');
    if (!alvo) return;
    alvo.innerHTML = pedHtmlPaginaBase();
    await pedCarregarListas();
}

// ---------------------------------------------------------------------------
// Novo orçamento / pedido direto
// ---------------------------------------------------------------------------

function pedTextoDocumento(tipo) {
    const orcamento = tipo === 'orcamento';
    return {
        tipo: orcamento ? 'orcamento' : 'pedido',
        eyebrow: orcamento ? 'ORÇAMENTO' : 'PEDIDO',
        titulo: orcamento ? 'Novo orçamento' : 'Novo pedido direto',
        subtitulo: orcamento ? 'Documento comercial' : 'Documento comercial de venda',
        lista: orcamento ? 'Orçamentos' : 'Pedidos',
        cliente: orcamento
            ? 'Selecione o cliente que receberá o orçamento.'
            : 'Selecione o cliente que receberá o pedido.',
        resumo: orcamento ? 'Resumo do orçamento' : 'Resumo do pedido',
        total: orcamento ? 'Total do orçamento' : 'Total do pedido',
        salvar: orcamento ? 'Salvar orçamento' : 'Salvar pedido'
    };
}

function pedHtmlOpcoesClientes(clientes, selecionado) {
    return (clientes || []).map((c) => `
        <option value="${Number(c.id)}"${Number(selecionado) === Number(c.id) ? ' selected' : ''}>
            ${nfeEsc(c.nome)}${c.cpf_cnpj ? ` — ${nfeEsc(c.cpf_cnpj)}` : ''}
        </option>`).join('');
}

function pedHtmlLinhaItem(prefixo, produtos, item = {}) {
    return `
        <tr data-opc-item>
            <td data-ped-campo="codigo">—</td>
            <td class="ped-doc-produto"><span data-ped-campo="nome">—</span>${opcHtmlSelectProduto(prefixo, produtos, item.produto_id)}</td>
            <td data-ped-campo="ncm">—</td>
            <td data-ped-campo="unidade">—</td>
            <td class="ped-doc-qtd"><input type="text" inputmode="decimal" class="form-control form-control-sm" data-campo="quantidade" value="${item.quantidade != null ? Number(item.quantidade) : 1}" oninput="opcRecalcular('${prefixo}')"></td>
            <td class="ped-doc-preco"><input type="text" inputmode="decimal" class="form-control form-control-sm" data-campo="preco" value="${item.preco_unitario != null ? Number(item.preco_unitario) : ''}" oninput="opcRecalcular('${prefixo}')"></td>
            <td class="text-end ped-doc-subtotal" data-campo="subtotal">—</td>
            <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" onclick="opcRemoverItem(this, '${prefixo}')" aria-label="Remover item"><i class="fas fa-trash"></i></button></td>
        </tr>`;
}

function pedHtmlDocumento(tipo, cadastros, inicial = {}, prefixo = 'pedNovo') {
    const texto = pedTextoDocumento(tipo);
    const clientes = pedHtmlOpcoesClientes(cadastros.clientes, inicial.cliente_id);
    const formas = OPC_FORMAS_PAGAMENTO.map(([v, r]) => `<option value="${v}"${(inicial.forma_pagamento || 'dinheiro') === v ? ' selected' : ''}>${r}</option>`).join('');
    const itensIniciais = (inicial.itens || []).filter((item) => item && item.produto_id);
    const itens = itensIniciais.map((item) => pedHtmlLinhaItem(prefixo, cadastros.produtos, item)).join('');
    const semItens = !itensIniciais.length;
    return `
        <div class="ped-doc" id="${prefixo}Editor" data-opc-editor data-ped-tipo="${texto.tipo}">
            <nav aria-label="breadcrumb" class="ped-doc-breadcrumb">
                <ol class="breadcrumb mb-0">
                    <li class="breadcrumb-item">Comercial</li>
                    <li class="breadcrumb-item"><a href="#" onclick="pedCancelarNovoDocumento(); return false;">${nfeEsc(texto.lista)}</a></li>
                    <li class="breadcrumb-item active" aria-current="page">${nfeEsc(texto.titulo)}</li>
                </ol>
            </nav>
            <header class="ped-doc-header">
                <div>
                    <div class="cds-eyebrow">${nfeEsc(texto.eyebrow)}</div>
                    <h1 class="cds-page-title">${nfeEsc(texto.titulo)}</h1>
                    <p class="cds-subtitle">${nfeEsc(texto.subtitulo)}</p>
                </div>
                <span class="cds-badge cds-badge--neutral">Rascunho</span>
            </header>
            <div class="alert alert-danger d-none py-2" id="${prefixo}Erros"></div>
            <div class="ped-doc-corpo">
                <div class="ped-doc-principal">
                    <section class="cds-card ped-doc-secao">
                        <div class="cds-card__header">
                            <div>
                                <h2 class="cds-card__title">01 — Cliente</h2>
                                <p class="cds-card__subtitle">${nfeEsc(texto.cliente)}</p>
                            </div>
                        </div>
                        <div class="cds-card__body">
                            <label class="cds-label" for="${prefixo}BuscaCliente">Buscar cliente</label>
                            <input type="search" class="form-control form-control-sm" id="${prefixo}BuscaCliente" placeholder="Digite nome, CPF ou CNPJ do cliente..." autocomplete="off">
                            <p class="ped-doc-ajuda" id="${prefixo}BuscaClienteResultado"></p>
                            <label class="cds-label" for="${prefixo}Cliente">Cliente</label>
                            <select class="form-select form-select-sm" id="${prefixo}Cliente">
                                <option value="">Selecione o cliente...</option>${clientes}
                            </select>
                            <p class="ped-doc-ajuda" id="${prefixo}ClienteVazio">Selecione um cliente para continuar.</p>
                            <article class="ped-doc-ficha" id="${prefixo}ClienteFicha" hidden>
                                <h3 id="${prefixo}ClienteNome">—</h3>
                                <p id="${prefixo}ClienteDoc" hidden></p>
                                <p id="${prefixo}ClienteTelefone" hidden></p>
                                <p id="${prefixo}ClienteCidade" hidden></p>
                                <p id="${prefixo}ClienteTipo" hidden></p>
                            </article>
                        </div>
                    </section>
                    <section class="cds-card ped-doc-secao">
                        <div class="cds-card__header ped-doc-secao__topo">
                            <div>
                                <h2 class="cds-card__title">02 — Produtos</h2>
                                <p class="cds-card__subtitle">Adicione os produtos ao documento.</p>
                            </div>
                            <div class="ped-doc-secao__acoes">
                                <span class="ped-doc-contador" id="${prefixo}Contador">0 itens</span>
                                <button type="button" class="btn btn-sm btn-outline-primary" onclick="opcPrepararNovaInclusao('${prefixo}')"><i class="fas fa-plus"></i> Adicionar produto</button>
                            </div>
                        </div>
                        <div class="cds-card__body">
                            ${opcHtmlBarraProduto()}
                            <div class="ped-doc-vazio" id="${prefixo}Vazio"${semItens ? '' : ' hidden'}>
                                <p>Nenhum produto adicionado.</p>
                                <p>Comece digitando para adicionar o primeiro produto.</p>
                            </div>
                            <div class="ped-doc-grade" id="${prefixo}Grade"${semItens ? ' hidden' : ''}>
                                <table class="table table-sm align-middle mb-0">
                                    <thead><tr><th>Código</th><th>Produto</th><th>NCM</th><th>Unidade</th><th>Quantidade</th><th>Preço</th><th class="text-end">Subtotal</th><th class="text-end">Ação</th></tr></thead>
                                    <tbody id="${prefixo}Itens">${itens}</tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                    <section class="cds-card ped-doc-secao">
                        <div class="cds-card__header">
                            <div>
                                <h2 class="cds-card__title">03 — Condições comerciais</h2>
                                <p class="cds-card__subtitle">Informe as condições comerciais do documento.</p>
                            </div>
                        </div>
                        <div class="cds-card__body">
                            <div class="ped-doc-condicoes">
                                <div>
                                    <label class="cds-label" for="${prefixo}Forma">Forma de pagamento</label>
                                    <select class="form-select form-select-sm" id="${prefixo}Forma" onchange="opcRecalcular('${prefixo}')">${formas}</select>
                                </div>
                                <div id="${prefixo}ParcelasGrupo">
                                    <label class="cds-label" for="${prefixo}Parcelas">Parcelas</label>
                                    <input type="number" min="1" step="1" class="form-control form-control-sm" id="${prefixo}Parcelas" value="${Number(inicial.parcelas) || 1}">
                                </div>
                                <div>
                                    <label class="cds-label" for="${prefixo}Desconto">Desconto (R$)</label>
                                    <input type="number" min="0" step="0.01" class="form-control form-control-sm" id="${prefixo}Desconto" value="${Number(inicial.desconto) || 0}" oninput="opcRecalcular('${prefixo}')">
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
                <aside class="ped-doc-resumo" aria-label="${nfeEsc(texto.resumo)}">
                    <section class="cds-card">
                        <div class="cds-card__header"><h2 class="cds-card__title">${nfeEsc(texto.resumo)}</h2></div>
                        <div class="cds-card__body">
                            <div class="ped-doc-resumo__linha"><span>Produtos</span><strong id="${prefixo}ResumoProdutos">—</strong></div>
                            <div class="ped-doc-resumo__linha"><span>Desconto</span><strong id="${prefixo}ResumoDesconto">—</strong></div>
                            <hr class="ped-doc-resumo__divisor">
                            <div class="ped-doc-resumo__total"><span>${nfeEsc(texto.total)}</span><strong id="${prefixo}Total">—</strong></div>
                        </div>
                    </section>
                </aside>
            </div>
            <footer class="ped-doc-rodape">
                <button type="button" class="btn btn-secondary cds-btn cds-btn--secondary cds-btn--md" onclick="pedCancelarNovoDocumento()">Cancelar</button>
                <button type="button" class="btn btn-primary cds-btn cds-btn--primary cds-btn--md" id="pedBtnSalvarNovo" onclick="pedSalvarNovoDocumento('${texto.tipo}')">${nfeEsc(texto.salvar)}</button>
            </footer>
        </div>`;
}

function pedAtualizarLinhaComercial(tr, prefixo) {
    if (!tr || !tr.querySelector('[data-ped-campo]')) return;
    const select = tr.querySelector('[data-campo="produto"]');
    const produto = (opcProdutos(prefixo) || []).find((item) => Number(item.id) === Number(select && select.value));
    const texto = (campo, valor) => {
        const el = tr.querySelector(`[data-ped-campo="${campo}"]`);
        if (el) el.textContent = valor;
    };
    texto('codigo', produto ? (produto.codigo || String(produto.id)) : '—');
    texto('nome', produto ? (produto.nome || '—') : '—');
    texto('ncm', produto && produto.ncm ? String(produto.ncm) : '—');
    texto('unidade', produto && produto.unidade ? String(produto.unidade) : '—');
}

function pedFiltrarClientes(prefixo) {
    const busca = document.getElementById(`${prefixo}BuscaCliente`);
    const select = document.getElementById(`${prefixo}Cliente`);
    const editor = document.getElementById(`${prefixo}Editor`);
    if (!busca || !select || !editor) return;
    const termo = opcNormalizarBusca(busca.value);
    const digitos = termo.replace(/\D/g, '');
    const selecionado = select.value;
    const clientes = editor._clientes || [];
    const filtrados = clientes.filter((cliente) => {
        if (!termo) return true;
        const nome = opcNormalizarBusca(cliente.nome);
        const documento = opcNormalizarBusca(cliente.cpf_cnpj);
        const docDigitos = String(cliente.cpf_cnpj || '').replace(/\D/g, '');
        return nome.includes(termo) || documento.includes(termo) || (digitos && docDigitos.includes(digitos));
    });
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = termo && !filtrados.length ? 'Nenhum cliente encontrado' : 'Selecione o cliente...';
    select.replaceChildren(placeholder, ...filtrados.map((cliente) => {
        const option = document.createElement('option');
        option.value = String(Number(cliente.id));
        option.textContent = `${cliente.nome || ''}${cliente.cpf_cnpj ? ` — ${cliente.cpf_cnpj}` : ''}`;
        return option;
    }));
    const aindaExiste = filtrados.some((cliente) => String(cliente.id) === String(selecionado));
    select.value = aindaExiste ? String(selecionado) : '';
    select.size = !termo || !filtrados.length ? 1 : Math.min(filtrados.length + 1, 8);
    const ajuda = document.getElementById(`${prefixo}BuscaClienteResultado`);
    if (ajuda) {
        if (!termo) ajuda.textContent = '';
        else if (!filtrados.length) ajuda.textContent = 'Nenhum cliente encontrado para essa busca.';
        else ajuda.textContent = filtrados.length === 1 ? '1 cliente encontrado.' : `${filtrados.length} clientes encontrados.`;
    }
    if (!aindaExiste) pedMostrarCliente(prefixo);
}

function pedDefinirLinhaCliente(id, valor, visivel) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = valor || '';
    el.hidden = !visivel;
}

function pedMostrarCliente(prefixo) {
    const select = document.getElementById(`${prefixo}Cliente`);
    const editor = document.getElementById(`${prefixo}Editor`);
    const ficha = document.getElementById(`${prefixo}ClienteFicha`);
    const vazio = document.getElementById(`${prefixo}ClienteVazio`);
    if (!select || !editor) return;
    if (select.value) select.size = 1;
    const cliente = (editor._clientes || []).find((item) => String(item.id) === String(select.value));
    if (!cliente) {
        if (ficha) ficha.hidden = true;
        if (vazio) vazio.hidden = false;
        return;
    }
    if (vazio) vazio.hidden = true;
    if (ficha) ficha.hidden = false;
    const nome = document.getElementById(`${prefixo}ClienteNome`);
    if (nome) nome.textContent = cliente.nome || '—';
    pedDefinirLinhaCliente(`${prefixo}ClienteDoc`, cliente.cpf_cnpj ? `CPF/CNPJ: ${cliente.cpf_cnpj}` : '', !!cliente.cpf_cnpj);
    pedDefinirLinhaCliente(`${prefixo}ClienteTelefone`, cliente.telefone ? `Telefone: ${cliente.telefone}` : '', !!cliente.telefone);
    pedDefinirLinhaCliente(`${prefixo}ClienteCidade`, cliente.cidade ? `Cidade: ${cliente.cidade}` : '', !!cliente.cidade);
    pedDefinirLinhaCliente(`${prefixo}ClienteTipo`, cliente.tipo_comercial_descricao ? `Tipo comercial: ${cliente.tipo_comercial_descricao}` : '', !!cliente.tipo_comercial_descricao);
}

function pedCancelarNovoDocumento() {
    if (typeof loadPedidos === 'function') return loadPedidos();
}

async function pedAbrirNovoDocumento(tipo) {
    let cadastros;
    try {
        cadastros = await opcCarregarCadastros();
    } catch (err) {
        nfeNotificar(err.message, 'danger');
        return;
    }
    const alvo = document.getElementById('page-content');
    if (!alvo) return;
    alvo.innerHTML = pedHtmlDocumento(tipo, cadastros);
    opcPrepararEditor('pedNovo', cadastros);
    opcFocarBarraProduto('pedNovo');
}

async function pedSalvarNovoDocumento(tipo) {
    const dados = opcLerEditor('pedNovo');
    const erros = opcValidarDados(dados);
    opcExibirErros('pedNovo', erros);
    if (erros.length) return;
    const caminho = tipo === 'orcamento' ? '/orcamentos' : '/pedidos';
    const resp = await nfeRequest(caminho, { method: 'POST', body: dados });
    if (!resp.ok) {
        opcExibirErros('pedNovo', [nfeMensagemErro(resp.data, 'Não foi possível salvar.')]);
        return;
    }
    nfeNotificar(`${tipo === 'orcamento' ? 'Orçamento' : 'Pedido'} ${resp.data.codigo || ''} criado.`, 'success');
    await loadPedidos();
    if (tipo === 'orcamento') pedAbrirOrcamento(resp.data.id);
    else pedAbrirPedido(resp.data.id);
}

// ---------------------------------------------------------------------------
// Detalhes
// ---------------------------------------------------------------------------

function pedHtmlItens(itens) {
    return `
        <table class="table table-sm align-middle">
            <thead><tr><th>Produto</th><th class="text-end">Qtd.</th><th class="text-end">Preço un.</th><th class="text-end">Subtotal</th></tr></thead>
            <tbody>${(itens || []).map((i) => `
                <tr><td>${nfeEsc(i.produto_nome || `#${i.produto_id}`)}</td><td class="text-end">${Number(i.quantidade)}</td>
                <td class="text-end">${pedMoeda(i.preco_unitario)}</td><td class="text-end">${pedMoeda(i.subtotal)}</td></tr>`).join('')}
            </tbody>
        </table>`;
}

function pedHtmlTotais(doc) {
    const forma = (OPC_FORMAS_PAGAMENTO.find(([v]) => v === doc.forma_pagamento) || [null, doc.forma_pagamento || '—'])[1];
    return `
        <div class="d-flex justify-content-end gap-4 small">
            <div>Itens: <strong>${pedMoeda(doc.total_itens)}</strong></div>
            <div>Desconto: <strong>${pedMoeda(doc.desconto)}</strong></div>
            <div>Pagamento: <strong>${nfeEsc(forma)}${doc.parcelas ? ` (${Number(doc.parcelas)}x)` : ''}</strong></div>
            <div>Total: <strong class="fs-6">${pedMoeda(doc.total)}</strong></div>
        </div>`;
}

let pedImpressaoAtual = null;

function pedRotuloStatus(tipo, status) {
    const mapa = tipo === 'orcamento' ? PED_STATUS_ORCAMENTO : PED_STATUS_PEDIDO;
    return (mapa[status] || [status || '—'])[0];
}

function pedFormatarData(valor) {
    const texto = String(valor || '').trim();
    const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : (texto || '—');
}

function pedLinhaImpressao(rotulo, valor) {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    return `<p><span>${nfeEsc(rotulo)}</span> ${nfeEsc(texto)}</p>`;
}

function pedHtmlDocumentoImpresso(tipo, doc) {
    const orcamento = tipo === 'orcamento';
    const titulo = orcamento ? 'ORÇAMENTO' : 'PEDIDO';
    const forma = (OPC_FORMAS_PAGAMENTO.find(([v]) => v === doc.forma_pagamento) || [null, doc.forma_pagamento || ''])[1];
    const endereco = [doc.cliente_rua, doc.cliente_numero].filter((parte) => String(parte || '').trim()).join(', ');
    const enderecoCompleto = [endereco, doc.cliente_bairro].filter((parte) => String(parte || '').trim()).join(' — ');
    const cidade = [doc.cliente_cidade, doc.cliente_uf].filter((parte) => String(parte || '').trim()).join('/');
    const parcelas = Number(doc.parcelas) > 1 ? `${Number(doc.parcelas)}x` : '';
    const pagamento = [forma, parcelas].filter(Boolean).join(' · ');
    const observacoes = String(doc.observacoes || '').trim();
    const itens = (doc.itens || []).map((item) => `
        <tr>
            <td>${nfeEsc(item.produto_codigo || item.codigo || (item.produto_id ? String(item.produto_id) : '—'))}</td>
            <td>${nfeEsc(item.produto_nome || '—')}</td>
            <td>${nfeEsc(item.produto_unidade || item.unidade || '—')}</td>
            <td class="num">${nfeEsc(String(item.quantidade))}</td>
            <td class="num">${pedMoeda(item.preco_unitario)}</td>
            <td class="num">${pedMoeda(item.subtotal)}</td>
        </tr>`).join('');
    return `
        <article class="ped-impressao-folha" data-ped-impressao="${orcamento ? 'orcamento' : 'pedido'}">
            <header class="ped-impressao-topo">
                <p class="ped-impressao-marca">CDS Sistemas</p>
                <p class="ped-impressao-tipo">DOCUMENTO COMERCIAL</p>
                <h1>${titulo}</h1>
            </header>
            <section class="ped-impressao-meta">
                ${pedLinhaImpressao('Número:', doc.codigo || (doc.id ? `#${doc.id}` : ''))}
                ${pedLinhaImpressao('Data:', pedFormatarData(doc.created_at))}
                ${pedLinhaImpressao('Status:', pedRotuloStatus(tipo, doc.status))}
            </section>
            <section class="ped-impressao-bloco">
                <h2>CLIENTE</h2>
                ${pedLinhaImpressao('Nome:', doc.cliente_nome)}
                ${pedLinhaImpressao('CPF/CNPJ:', doc.cliente_documento)}
                ${pedLinhaImpressao('Telefone:', doc.cliente_telefone)}
                ${pedLinhaImpressao('Endereço:', enderecoCompleto)}
                ${pedLinhaImpressao('Cidade/UF:', cidade)}
            </section>
            <section class="ped-impressao-bloco">
                <h2>PRODUTOS</h2>
                <table class="ped-impressao-tabela">
                    <thead><tr><th>Código</th><th>Produto</th><th>Unidade</th><th class="num">Quantidade</th><th class="num">Preço unitário</th><th class="num">Subtotal</th></tr></thead>
                    <tbody>${itens}</tbody>
                </table>
            </section>
            <section class="ped-impressao-resumo">
                <p><span>Subtotal</span><strong>${pedMoeda(doc.total_itens)}</strong></p>
                <p><span>Desconto</span><strong>${pedMoeda(doc.desconto)}</strong></p>
                <p class="ped-impressao-total"><span>TOTAL</span><strong>${pedMoeda(doc.total)}</strong></p>
            </section>
            ${pagamento ? `<section class="ped-impressao-bloco"><h2>PAGAMENTO</h2>${pedLinhaImpressao('Forma de pagamento:', pagamento)}</section>` : ''}
            ${observacoes ? `<section class="ped-impressao-bloco"><h2>OBSERVAÇÕES</h2><p class="ped-impressao-obs">${nfeEsc(observacoes)}</p></section>` : ''}
            <footer class="ped-impressao-rodape">
                <p>CDS Sistemas</p>
                <p>Documento comercial sem valor fiscal.</p>
            </footer>
        </article>`;
}

function pedAbrirImpressao(tipo, doc) {
    const anterior = document.getElementById('ped-impressao');
    if (anterior) anterior.remove();
    const camada = document.createElement('div');
    camada.id = 'ped-impressao';
    camada.innerHTML = `
        <div class="ped-impressao-toolbar">
            <button type="button" class="btn btn-primary btn-sm" id="pedBtnConfirmarImpressao">Imprimir</button>
            <button type="button" class="btn btn-secondary btn-sm" id="pedBtnFecharImpressao">Fechar</button>
        </div>
        ${pedHtmlDocumentoImpresso(tipo, doc || {})}`;
    document.body.appendChild(camada);
    const confirmar = camada.querySelector('#pedBtnConfirmarImpressao');
    const fechar = camada.querySelector('#pedBtnFecharImpressao');
    if (confirmar) confirmar.addEventListener('click', () => window.print());
    if (fechar) fechar.addEventListener('click', () => camada.remove());
    window.print();
    return camada;
}

function pedImprimirOrcamentoAberto() {
    if (!pedImpressaoAtual || pedImpressaoAtual.tipo !== 'orcamento') return;
    pedAbrirImpressao('orcamento', pedImpressaoAtual.doc);
}

function pedImprimirPedidoAberto() {
    if (!pedImpressaoAtual || pedImpressaoAtual.tipo !== 'pedido') return;
    pedAbrirImpressao('pedido', pedImpressaoAtual.doc);
}

function pedHtmlAcoesOrcamento(orc) {
    const id = Number(orc.id);
    const acoes = [];
    acoes.push('<button type="button" class="btn btn-outline-secondary btn-sm" id="pedBtnImprimirOrcamento" onclick="pedImprimirOrcamentoAberto()"><i class="fas fa-print"></i> Imprimir</button>');
    if (orc.status === 'RASCUNHO') acoes.push(`<button type="button" class="btn btn-outline-info btn-sm" onclick="pedAlterarStatusOrcamento(${id}, 'APRESENTADO')">Marcar como apresentado</button>`);
    if (orc.status === 'RASCUNHO' || orc.status === 'APRESENTADO') {
        acoes.push(`<button type="button" class="btn btn-success btn-sm" id="pedBtnAprovar" onclick="pedAprovarOrcamento(${id})"><i class="fas fa-check"></i> Aprovar e gerar pedido</button>`);
        acoes.push(`<button type="button" class="btn btn-outline-danger btn-sm" onclick="pedAlterarStatusOrcamento(${id}, 'REPROVADO')">Reprovar</button>`);
        acoes.push(`<button type="button" class="btn btn-outline-dark btn-sm" onclick="pedAlterarStatusOrcamento(${id}, 'CANCELADO')">Cancelar</button>`);
    }
    if (orc.pedido_id) acoes.push(`<button type="button" class="btn btn-outline-primary btn-sm" onclick="pedAbrirPedido(${Number(orc.pedido_id)})">Ver pedido #${Number(orc.pedido_id)}</button>`);
    return acoes.join(' ');
}

async function pedAbrirOrcamento(id) {
    const resp = await nfeRequest(`/orcamentos/${Number(id)}`);
    if (!resp.ok) {
        nfeNotificar(nfeMensagemErro(resp.data, 'Orçamento não encontrado.'), 'danger');
        return;
    }
    const orc = resp.data;
    pedImpressaoAtual = { tipo: 'orcamento', doc: orc };
    const html = `
        <div class="modal fade" id="modalPedOrcamento" tabindex="-1" data-orcamento-id="${Number(orc.id)}" aria-labelledby="modalPedOrcamentoLabel">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="modalPedOrcamentoLabel">Orçamento ${nfeEsc(orc.codigo || `#${orc.id}`)} ${pedBadge(PED_STATUS_ORCAMENTO, orc.status)}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-2"><strong>Cliente:</strong> ${nfeEsc(orc.cliente_nome || '—')} ${orc.cliente_documento ? `(${nfeEsc(orc.cliente_documento)})` : ''}</p>
                        ${pedHtmlItens(orc.itens)}
                        ${pedHtmlTotais(orc)}
                    </div>
                    <div class="modal-footer justify-content-between">
                        <div>${pedHtmlAcoesOrcamento(orc)}</div>
                        <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>`;
    nfeMostrarModal('modalPedOrcamento', html);
}

async function pedAlterarStatusOrcamento(id, status) {
    const resp = await nfeRequest(`/orcamentos/${Number(id)}/status`, { method: 'POST', body: { status } });
    if (!resp.ok) {
        nfeNotificar(nfeMensagemErro(resp.data, 'Não foi possível alterar o orçamento.'), 'danger');
        return;
    }
    nfeFecharModal('modalPedOrcamento');
    await pedCarregarListas();
}

async function pedAprovarOrcamento(id) {
    if (typeof confirm === 'function' && !confirm('Aprovar o orçamento e gerar o pedido? A aprovação não emite NF-e.')) return;
    const resp = await nfeRequest(`/orcamentos/${Number(id)}/aprovar`, { method: 'POST', body: {} });
    if (!resp.ok) {
        nfeNotificar(nfeMensagemErro(resp.data, 'Não foi possível aprovar o orçamento.'), 'danger');
        return;
    }
    nfeFecharModal('modalPedOrcamento');
    nfeNotificar(`Pedido ${resp.data.codigo || ''} gerado a partir do orçamento.`, 'success');
    await pedCarregarListas();
    pedAbrirPedido(resp.data.id);
}

function pedNotaAutorizada(pedido) {
    const notas = [];
    if (pedido && pedido.nfe && pedido.nfe.nota) notas.push(pedido.nfe.nota);
    if (pedido && Array.isArray(pedido.nfe_relacionadas)) notas.push(...pedido.nfe_relacionadas);
    return notas.find((nota) => String(nota && nota.status || '').toLowerCase() === 'autorizada' && nota.id) || null;
}

/** Ação principal de NF-e no rodapé do pedido. Orçamento não usa esta função. */
function pedHtmlBotaoNfePedido(pedido) {
    const autorizada = pedNotaAutorizada(pedido);
    if (autorizada) {
        return `<button type="button" class="btn btn-outline-primary btn-sm" id="pedBtnVerNfe" onclick="nfeAbrirDetalhe(${Number(autorizada.id)})">📄 Ver NF-e</button>`;
    }
    const nfe = (pedido && pedido.nfe) || {};
    const pode = !!nfe.pode_emitir && (typeof nfeUsuarioPodeEmitir !== 'function' || nfeUsuarioPodeEmitir());
    const motivo = pode ? '' : (nfe.motivo_bloqueio
        || (typeof nfeUsuarioPodeEmitir === 'function' && !nfeUsuarioPodeEmitir() ? 'Usuário sem permissão para emitir NF-e.' : 'NF-e indisponível para este pedido.'));
    const titulo = motivo ? ` title="${nfeEsc(motivo)}"` : '';
    return `<button type="button" class="btn btn-primary btn-sm" id="pedBtnEmitirNfe"${pode ? '' : ' disabled'}${titulo} onclick="pedEmitirNfe(${Number(pedido.id)})">🧾 Emitir NF-e</button>`;
}

function pedHtmlMotivoNfePedido(pedido) {
    if (pedNotaAutorizada(pedido)) return '';
    const nfe = (pedido && pedido.nfe) || {};
    const pode = !!nfe.pode_emitir && (typeof nfeUsuarioPodeEmitir !== 'function' || nfeUsuarioPodeEmitir());
    if (pode) return '';
    const motivo = nfe.motivo_bloqueio
        || (typeof nfeUsuarioPodeEmitir === 'function' && !nfeUsuarioPodeEmitir() ? 'Usuário sem permissão para emitir NF-e.' : 'NF-e indisponível para este pedido.');
    return `<div class="ped-pedido-motivo" id="pedNfeMotivo">NF-e indisponível: ${nfeEsc(motivo)}</div>`;
}

/** Bloco NF-e do pedido: nota relacionada e motivo. A ação principal fica no rodapé. */
function pedHtmlAcaoNfePedido(pedido) {
    if (typeof nfeRecursoHabilitado === 'function' && !nfeRecursoHabilitado()) return '';
    const nfe = (pedido && pedido.nfe) || {};
    const nota = nfe.nota || null;
    const partes = [];
    if (nota) {
        partes.push(`<div class="mb-2">NF-e ${nfeEsc(nfeNumeroFormatado(nota.numero))} ${nfeBadgeStatus(nota.status)}
            <button type="button" class="btn btn-sm btn-outline-dark ms-2" onclick="nfeAbrirDetalhe(${Number(nota.id)})"><i class="fas fa-eye"></i> Ver NF-e</button></div>`);
    }
    if (nfe.pode_emitir && !nfeUsuarioPodeEmitir()) {
        partes.push(`<div class="small text-muted" id="pedSemPermissaoEmitir"><i class="fas fa-lock"></i> ${nfeTextoEmissao('semPermissao')}</div>`);
    } else if (!nfe.pode_emitir && !nota && nfe.motivo_bloqueio) {
        partes.push(`<div class="alert alert-warning py-2 mb-0" id="pedNfeBloqueio">NF-e indisponível: ${nfeEsc(nfe.motivo_bloqueio)}</div>`);
    }
    if (!partes.length) return '';
    return `<div class="card mt-3" id="pedSecaoNfe"><div class="card-header py-1"><strong><i class="fas fa-file-invoice"></i> NF-e (modelo 55)</strong></div>
        <div class="card-body py-2">${partes.join('')}</div></div>`;
}

async function pedAbrirPedido(id) {
    const resp = await nfeRequest(`/pedidos/${Number(id)}`);
    if (!resp.ok) {
        nfeNotificar(nfeMensagemErro(resp.data, 'Pedido não encontrado.'), 'danger');
        return;
    }
    const p = resp.data;
    pedImpressaoAtual = { tipo: 'pedido', doc: p };
    const cancelar = p.status === 'ABERTO'
        ? `<button type="button" class="btn btn-outline-dark btn-sm" id="pedBtnCancelarPedido" onclick="pedCancelarPedido(${Number(p.id)})">Cancelar pedido</button>`
        : '';
    const relacionadas = Array.isArray(p.nfe_relacionadas) ? p.nfe_relacionadas : [];
    const blocoNfe = relacionadas.length ? `
        <div class="mt-2" id="pedNfeRelacionadas">
            <strong>NF-e relacionadas</strong>
            <ul class="mb-0">${relacionadas.map((nota) => `
                <li>NF-e ${nfeEsc(nfeNumeroFormatado(nota.numero))} ${typeof nfeBadgeStatus === 'function' ? nfeBadgeStatus(nota.status) : nfeEsc(nota.status || '')}
                ${nota.chave_acesso ? `<div class="small"><code>${nfeEsc(nota.chave_acesso)}</code></div>` : ''}
                <button type="button" class="btn btn-link btn-sm p-0" onclick="nfeAbrirDetalhe(${Number(nota.id)})">Abrir</button></li>`).join('')}
            </ul>
        </div>` : '';
    const html = `
        <div class="modal fade" id="modalPedPedido" tabindex="-1" data-pedido-id="${Number(p.id)}" aria-labelledby="modalPedPedidoLabel">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="modalPedPedidoLabel">Pedido ${nfeEsc(p.codigo || `#${p.id}`)} ${pedBadge(PED_STATUS_PEDIDO, p.status)}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-1"><strong>Cliente:</strong> ${nfeEsc(p.cliente_nome || '—')} ${p.cliente_documento ? `(${nfeEsc(p.cliente_documento)})` : ''}</p>
                        <p class="mb-1"><strong>Origem:</strong> ${pedRotuloOrigem(p)}</p>
                        ${p.venda_id ? `<p class="mb-1"><strong>Venda:</strong> #${nfeEsc(p.venda_codigo || p.venda_id)}</p>` : ''}
                        ${pedHtmlItens(p.itens)}
                        ${pedHtmlTotais(p)}
                        ${blocoNfe}
                        ${pedHtmlAcaoNfePedido(p)}
                    </div>
                    <div class="modal-footer ped-pedido-rodape">
                        <div class="ped-pedido-acoes" id="pedAcoesPedido">
                            <button type="button" class="btn btn-outline-secondary btn-sm" id="pedBtnImprimirPedido" onclick="pedImprimirPedidoAberto()">🖨 Imprimir</button>
                            ${pedHtmlBotaoNfePedido(p)}
                            ${cancelar}
                            <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Fechar</button>
                        </div>
                        ${pedHtmlMotivoNfePedido(p)}
                    </div>
                </div>
            </div>
        </div>`;
    nfeMostrarModal('modalPedPedido', html);
}

async function pedCancelarPedido(id) {
    if (typeof confirm === 'function' && !confirm('Cancelar este pedido?')) return;
    const resp = await nfeRequest(`/pedidos/${Number(id)}/cancelar`, { method: 'POST', body: {} });
    if (!resp.ok) {
        nfeNotificar(nfeMensagemErro(resp.data, 'Não foi possível cancelar o pedido.'), 'danger');
        return;
    }
    nfeFecharModal('modalPedPedido');
    await pedCarregarListas();
}

let pedNfePreparando = false;

function pedSnapshotParaNfe(pedido) {
    return {
        cliente: {
            id: pedido.cliente_id,
            nome: pedido.cliente_nome,
            cpf_cnpj: pedido.cliente_documento,
            rua: pedido.cliente_rua,
            numero: pedido.cliente_numero,
            bairro: pedido.cliente_bairro,
            cidade: pedido.cliente_cidade,
            uf: pedido.cliente_uf,
            cep: pedido.cliente_cep,
            inscricao_estadual: pedido.cliente_inscricao_estadual
        },
        pedidos: [{
            id: pedido.id,
            codigo: pedido.codigo,
            cliente_id: pedido.cliente_id,
            cliente_nome: pedido.cliente_nome,
            desconto: pedido.desconto,
            total: pedido.total,
            itens: (pedido.itens || []).map((item) => ({
                produto_id: item.produto_id,
                produto_nome: item.produto_nome,
                quantidade: item.quantidade,
                preco_unitario: item.preco_unitario,
                subtotal: item.subtotal
            }))
        }],
        desconto: pedido.desconto,
        total: pedido.total,
        forma_pagamento: pedido.forma_pagamento
    };
}

/**
 * [Emitir NF-e] do pedido aberto abre a Nova NF-e já preenchida. Não transmite, não cria venda,
 * não baixa estoque e não lança financeiro. Isso só ocorre em Confirmar emissão.
 * Pedido já FATURADO (ex.: NF-e rejeitada) reabre a emissão da venda existente.
 */
async function pedEmitirNfe(id) {
    if (pedNfePreparando) return;
    if (!nfeUsuarioPodeEmitir()) {
        nfeNotificar(nfeTextoEmissao('semPermissao'), 'warning');
        return;
    }
    const botao = document.getElementById('pedBtnEmitirNfe');
    const htmlBotao = botao ? botao.innerHTML : '';
    pedNfePreparando = true;
    if (botao) {
        botao.disabled = true;
        botao.textContent = 'Preparando NF-e...';
    }
    try {
        const prontidao = await nfeRequest('/nfe/prontidao');
        if (!prontidao.ok || !prontidao.data || prontidao.data.pronta !== true) {
            nfeFecharModal('modalPedPedido');
            if (prontidao.ok && prontidao.data) nfeMostrarNaoPronta(prontidao.data, null);
            else nfeNotificar(nfeMensagemErro(prontidao.data, 'Não foi possível preparar a NF-e deste pedido.'), 'warning');
            return;
        }
        const resp = await nfeRequest(`/pedidos/${Number(id)}`);
        const pedido = resp.data || {};
        if (!resp.ok) {
            nfeNotificar(nfeMensagemErro(resp.data, 'Não foi possível preparar a NF-e deste pedido.'), 'danger');
            return;
        }
        if (!pedido.nfe || !pedido.nfe.pode_emitir) {
            const motivo = pedido.nfe && pedido.nfe.motivo_bloqueio;
            nfeNotificar(motivo ? `NF-e indisponível: ${motivo}` : 'Não foi possível preparar a NF-e deste pedido.', 'warning');
            return;
        }
        if (pedido.nfe.acao !== 'emitir_pedido') {
            const vendaId = Number(pedido.venda_id) || Number(pedido.nfe.venda_id) || null;
            if (!vendaId) {
                nfeNotificar('Venda do pedido não encontrada.', 'danger');
                return;
            }
            nfeFecharModal('modalPedPedido');
            await abrirEmissaoNfe(vendaId);
            return;
        }
        nfeFecharModal('modalPedPedido');
        const aberto = await abrirNfeManual({ modalNaoPronta: false });
        if (aberto !== 'aberto' || typeof nfeAplicarImportacao !== 'function') {
            nfeNotificar('Não foi possível preparar a NF-e deste pedido.', 'danger');
            return;
        }
        nfeAplicarImportacao(pedSnapshotParaNfe(pedido));
    } catch (err) {
        nfeNotificar('Não foi possível preparar a NF-e deste pedido.', 'danger');
    } finally {
        pedNfePreparando = false;
        if (botao && botao.isConnected) {
            botao.disabled = false;
            botao.innerHTML = htmlBotao;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        opcValidarDados,
        opcTotais,
        pedHtmlAcaoNfePedido,
        pedHtmlBotaoNfePedido,
        pedHtmlAcoesOrcamento,
        pedHtmlDocumentoImpresso,
        pedAbrirImpressao,
        pedHtmlLinhasPedidos,
        pedHtmlLinhasOrcamentos
    };
}
