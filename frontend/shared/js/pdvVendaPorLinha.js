/**
 * PDV — Venda por Linha (entrada): mostrar a opção, pesquisar a Linha e listar seus produtos.
 * A opção só existe com "Permitir venda por Linha" ligado (PdvComercializacao).
 * A Linha selecionada é guardada pelo id; o nome é só exibição.
 * Selecionar Linha ou marcar produtos não adiciona item, não calcula preço e não mexe em estoque.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PdvVendaPorLinha = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MENSAGEM_LINHA_SEM_PRODUTOS = 'Esta linha não tem produtos disponíveis para venda.';
    const MENSAGEM_NENHUMA_LINHA = 'Nenhuma linha encontrada.';
    const MENSAGEM_QUANTIDADE_INVALIDA = 'Informe uma quantidade maior que zero.';
    const MENSAGEM_DISTRIBUICAO = 'Depois você poderá distribuir essa quantidade entre os produtos da linha.';
    const MENSAGEM_DISTRIBUICAO_INCOMPLETA = 'Distribua toda a quantidade antes de continuar.';
    const MENSAGEM_DISTRIBUICAO_EXCEDIDA = 'A quantidade distribuída não pode ser maior que a quantidade total.';
    // Mesmo formato do campo de quantidade do PDV: vírgula decimal (ponto de milhar só com vírgula).
    const FORMATO_QUANTIDADE = /^(\d+|\d{1,3}(\.\d{3})+),\d+$|^\d+(\.\d+)?$/;

    let selecao = null;

    function opcaoVisivel(comercializacao) {
        return !!comercializacao
            && typeof comercializacao.isVendaPorLinhaPermitida === 'function'
            && comercializacao.isVendaPorLinhaPermitida() === true;
    }

    function idValido(valor) {
        const id = Number(valor);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    function caminhoLinhas(busca) {
        const termo = String(busca ?? '').trim();
        return 'produtos/consulta-pdv/linhas' + (termo ? `?q=${encodeURIComponent(termo)}` : '');
    }

    function caminhoProdutosDaLinha(linhaProdutosId, modoFiscal) {
        const sufixo = modoFiscal === undefined || modoFiscal === null ? '' : `?modo_fiscal=${encodeURIComponent(modoFiscal)}`;
        return `produtos/consulta-pdv/linhas/${linhaProdutosId}/produtos${sufixo}`;
    }

    function normalizarLinhas(resposta) {
        return (Array.isArray(resposta) ? resposta : [])
            .filter((linha) => linha && idValido(linha.id) && String(linha.nome ?? '').trim())
            .map((linha) => ({ id: idValido(linha.id), nome: String(linha.nome).trim(), codigo: String(linha.codigo ?? '').trim() }));
    }

    function produtoVendavel(produto) {
        return !!produto
            && !!idValido(produto.id)
            && (produto.ativo === undefined || produto.ativo === null || Number(produto.ativo) !== 0)
            && String(produto.natureza_cadastro ?? '').trim().toUpperCase() !== 'INSUMO';
    }

    function normalizarProdutos(resposta) {
        return (Array.isArray(resposta) ? resposta : [])
            .filter(produtoVendavel)
            .map((produto) => ({
                id: idValido(produto.id),
                nome: String(produto.nome ?? '').trim(),
                codigo: String(produto.codigo ?? '').trim(),
                unidade: String(produto.unidade ?? '').trim()
            }));
    }

    /** @param {(caminho: string) => Promise<any>} consultar GET relativo a /api, devolve o JSON. */
    async function buscarLinhas(consultar, busca) {
        return normalizarLinhas(await consultar(caminhoLinhas(busca)));
    }

    async function selecionarLinha(consultar, linhaProdutosId, opcoes = {}) {
        const id = idValido(linhaProdutosId);
        if (!id) throw new Error('Linha de Produtos inválida.');
        const resposta = await consultar(caminhoProdutosDaLinha(id, opcoes.modoFiscal));
        const linha = resposta && resposta.linha ? resposta.linha : {};
        if (idValido(linha.id) !== id) throw new Error('Linha de Produtos não encontrada.');
        const produtos = normalizarProdutos(resposta.produtos);
        selecao = {
            linhaProdutosId: id,
            nome: String(linha.nome ?? '').trim(),
            codigo: String(linha.codigo ?? '').trim(),
            produtos,
            marcados: [],
            quantidadeTotal: null,
            quantidades: {},
            pendencias: {},
            distribuicaoConcluida: false,
            mensagem: produtos.length ? null : MENSAGEM_LINHA_SEM_PRODUTOS
        };
        return obterSelecao();
    }

    /** Quantidade do PDV: decimal com vírgula, 2 casas (normalizarQuantidadePdv), sempre maior que zero. */
    function interpretarQuantidadeTotal(valor) {
        const texto = String(valor ?? '').trim();
        if (!FORMATO_QUANTIDADE.test(texto)) return null;
        const numero = Number(texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto);
        const quantidade = Number(numero.toFixed(2));
        return Number.isFinite(quantidade) && quantidade > 0 ? quantidade : null;
    }

    function formatarQuantidade(quantidade) {
        const arredondado = Math.round(Number(quantidade) * 100) / 100;
        if (Number.isInteger(arredondado)) return String(arredondado);
        return arredondado.toFixed(2).replace('.', ',').replace(/0$/, '');
    }

    function definirQuantidadeTotal(valor) {
        if (!selecao) return { ok: false, mensagem: 'Selecione uma linha.' };
        if (!selecao.produtos.length) return { ok: false, mensagem: MENSAGEM_LINHA_SEM_PRODUTOS };
        const quantidade = interpretarQuantidadeTotal(valor);
        if (quantidade === null) return { ok: false, mensagem: MENSAGEM_QUANTIDADE_INVALIDA };
        selecao.quantidadeTotal = quantidade;
        selecao.distribuicaoConcluida = false;
        return { ok: true, quantidadeTotal: quantidade, selecao: obterSelecao() };
    }

    function marcarProduto(produtoId, marcado) {
        if (!selecao) return obterSelecao();
        const id = idValido(produtoId);
        if (!id || !selecao.produtos.some((produto) => produto.id === id)) return obterSelecao();
        const outros = selecao.marcados.filter((marcadoId) => marcadoId !== id);
        selecao.marcados = marcado ? outros.concat(id) : outros;
        removerForaDaDistribuicao();
        return obterSelecao();
    }

    /** Produtos marcados na Linha; sem marcação, todos os produtos da Linha. */
    function produtosParaDistribuir() {
        if (!selecao) return [];
        const lista = selecao.marcados.length
            ? selecao.produtos.filter((produto) => selecao.marcados.includes(produto.id))
            : selecao.produtos;
        return lista.map((produto) => ({ ...produto }));
    }

    function removerForaDaDistribuicao() {
        const ids = produtosParaDistribuir().map((produto) => String(produto.id));
        for (const mapa of [selecao.quantidades, selecao.pendencias]) {
            Object.keys(mapa).forEach((chave) => { if (!ids.includes(chave)) delete mapa[chave]; });
        }
        selecao.distribuicaoConcluida = false;
    }

    // Soma em centésimos (2 casas, como a quantidade do PDV) para não acumular erro de ponto flutuante.
    const centesimos = (quantidade) => Math.round(Number(quantidade || 0) * 100);

    function resumoDistribuicao() {
        if (!selecao || selecao.quantidadeTotal === null) return null;
        const total = centesimos(selecao.quantidadeTotal);
        const distribuido = Object.values(selecao.quantidades).reduce((soma, q) => soma + centesimos(q), 0);
        return {
            quantidadeTotal: total / 100,
            distribuido: distribuido / 100,
            restante: (total - distribuido) / 100,
            completa: distribuido === total,
            excedida: distribuido > total,
            pendencias: Object.keys(selecao.pendencias).length
        };
    }

    /** Vazio = 0 (sai da distribuição). Valor inválido ou acima do restante não é aplicado. */
    function definirQuantidadeProduto(produtoId, valor) {
        if (!selecao || selecao.quantidadeTotal === null) return { ok: false, mensagem: 'Informe a quantidade total da linha.' };
        const id = idValido(produtoId);
        if (!id || !produtosParaDistribuir().some((produto) => produto.id === id)) {
            return { ok: false, mensagem: 'Produto não pertence a esta linha.', resumo: resumoDistribuicao() };
        }
        const chave = String(id);
        const texto = String(valor ?? '').trim();
        selecao.distribuicaoConcluida = false;
        if (!texto) {
            delete selecao.quantidades[chave];
            delete selecao.pendencias[chave];
            return { ok: true, quantidade: 0, resumo: resumoDistribuicao() };
        }
        const quantidade = interpretarQuantidadeTotal(texto);
        let mensagem = null;
        if (quantidade === null) {
            mensagem = MENSAGEM_QUANTIDADE_INVALIDA;
        } else {
            const outros = Object.keys(selecao.quantidades)
                .filter((outra) => outra !== chave)
                .reduce((soma, outra) => soma + centesimos(selecao.quantidades[outra]), 0);
            if (outros + centesimos(quantidade) > centesimos(selecao.quantidadeTotal)) mensagem = MENSAGEM_DISTRIBUICAO_EXCEDIDA;
        }
        if (mensagem) {
            selecao.pendencias[chave] = { texto, mensagem };
            return { ok: false, mensagem, resumo: resumoDistribuicao() };
        }
        selecao.quantidades[chave] = quantidade;
        delete selecao.pendencias[chave];
        return { ok: true, quantidade, resumo: resumoDistribuicao() };
    }

    /** Texto a exibir no campo do produto: o digitado (se recusado) ou a quantidade aceita. */
    function valorDoCampo(produtoId) {
        if (!selecao) return '';
        const chave = String(idValido(produtoId));
        if (selecao.pendencias[chave]) return selecao.pendencias[chave].texto;
        return selecao.quantidades[chave] === undefined ? '' : formatarQuantidade(selecao.quantidades[chave]);
    }

    function obterDistribuicao() {
        if (!selecao) return null;
        return {
            linha_produtos_id: selecao.linhaProdutosId,
            quantidade_total: selecao.quantidadeTotal,
            distribuicao: produtosParaDistribuir()
                .filter((produto) => selecao.quantidades[String(produto.id)] !== undefined)
                .map((produto) => ({ produto_id: produto.id, quantidade: selecao.quantidades[String(produto.id)] }))
        };
    }

    function concluirDistribuicao() {
        const resumo = resumoDistribuicao();
        if (!resumo) return { ok: false, mensagem: 'Informe a quantidade total da linha.' };
        const pendencia = Object.values(selecao.pendencias)[0];
        let mensagem = null;
        if (resumo.excedida) mensagem = MENSAGEM_DISTRIBUICAO_EXCEDIDA;
        else if (pendencia) mensagem = pendencia.mensagem;
        else if (!resumo.completa) mensagem = MENSAGEM_DISTRIBUICAO_INCOMPLETA;
        if (mensagem) return { ok: false, mensagem, resumo };
        selecao.distribuicaoConcluida = true;
        return { ok: true, resumo, distribuicao: obterDistribuicao() };
    }

    /** Distribuição pronta para virar itens do PDV: concluída, sem pendência e fechando o total. */
    function distribuicaoConfirmada() {
        if (!selecao || !selecao.distribuicaoConcluida) return null;
        const resumo = resumoDistribuicao();
        if (!resumo || !resumo.completa || resumo.pendencias) return null;
        const distribuicao = obterDistribuicao();
        return distribuicao.distribuicao.length ? distribuicao : null;
    }

    function obterSelecao() {
        if (!selecao) return null;
        return {
            ...selecao,
            produtos: selecao.produtos.map((produto) => ({ ...produto })),
            marcados: selecao.marcados.slice(),
            quantidades: { ...selecao.quantidades },
            pendencias: Object.fromEntries(Object.entries(selecao.pendencias).map(([chave, valor]) => [chave, { ...valor }]))
        };
    }

    function limpar() {
        selecao = null;
    }

    return {
        MENSAGEM_LINHA_SEM_PRODUTOS,
        MENSAGEM_NENHUMA_LINHA,
        MENSAGEM_QUANTIDADE_INVALIDA,
        MENSAGEM_DISTRIBUICAO,
        MENSAGEM_DISTRIBUICAO_INCOMPLETA,
        MENSAGEM_DISTRIBUICAO_EXCEDIDA,
        opcaoVisivel,
        caminhoLinhas,
        caminhoProdutosDaLinha,
        normalizarLinhas,
        normalizarProdutos,
        buscarLinhas,
        selecionarLinha,
        interpretarQuantidadeTotal,
        formatarQuantidade,
        definirQuantidadeTotal,
        marcarProduto,
        produtosParaDistribuir,
        resumoDistribuicao,
        definirQuantidadeProduto,
        valorDoCampo,
        obterDistribuicao,
        concluirDistribuicao,
        distribuicaoConfirmada,
        obterSelecao,
        limpar
    };
}));
