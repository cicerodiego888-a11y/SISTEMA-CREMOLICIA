/**
 * PDV — Resolução segura do produto a partir de uma entrada digitada ou bipada.
 * Só existe adição automática quando exatamente um produto corresponde à entrada.
 * O ID do produto nunca é reconhecido por digitação; ele só chega por seleção.
 * INSUMO (natureza_cadastro) nunca é candidato: não é comercializável pelo PDV.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PdvResolucaoProduto = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const STATUS_UNICO = 'UNICO';
    const STATUS_AMBIGUO = 'AMBIGUO';
    const STATUS_NENHUM = 'NENHUM';

    function normalizarIdentificador(valor) {
        return String(valor ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
    }

    function somenteDigitos(valor) {
        return /^\d+$/.test(valor);
    }

    function semZerosEsquerda(valor) {
        return valor.replace(/^0+/, '') || '0';
    }

    function identificadorCorresponde(valorCadastro, entradaNormalizada) {
        const cadastro = normalizarIdentificador(valorCadastro);
        if (!cadastro || !entradaNormalizada) return false;
        if (cadastro === entradaNormalizada) return true;
        return somenteDigitos(cadastro)
            && somenteDigitos(entradaNormalizada)
            && semZerosEsquerda(cadastro) === semZerosEsquerda(entradaNormalizada);
    }

    function produtoAtivo(produto) {
        if (!produto) return false;
        const ativo = produto.ativo;
        return ativo === undefined || ativo === null || Number(ativo) !== 0;
    }

    function produtoEhInsumo(produto) {
        return String(produto?.natureza_cadastro ?? '').trim().toUpperCase() === 'INSUMO';
    }

    /** Ativo e não INSUMO: só esses chegam aos candidatos do PDV. */
    function produtoComercializavel(produto) {
        return produtoAtivo(produto) && !produtoEhInsumo(produto);
    }

    function semDuplicados(produtos) {
        const vistos = new Set();
        return produtos.filter((produto) => {
            const chave = String(produto.id);
            if (vistos.has(chave)) return false;
            vistos.add(chave);
            return true;
        });
    }

    function montarResultado(candidatos, balanca) {
        const unicos = semDuplicados(candidatos);
        let status = STATUS_NENHUM;
        if (unicos.length === 1) status = STATUS_UNICO;
        else if (unicos.length > 1) status = STATUS_AMBIGUO;
        return {
            status,
            produto: status === STATUS_UNICO ? unicos[0] : null,
            candidatos: unicos,
            balanca: balanca || null
        };
    }

    /** Correspondência exata por código de barras ou código interno (produtos comercializáveis). */
    function resolverPorCodigo(produtos, entrada) {
        const termo = normalizarIdentificador(entrada);
        if (!termo) return montarResultado([]);
        const candidatos = (Array.isArray(produtos) ? produtos : []).filter((produto) => (
            produtoComercializavel(produto)
            && (identificadorCorresponde(produto.codigo_barras, termo)
                || identificadorCorresponde(produto.codigo, termo))
        ));
        return montarResultado(candidatos);
    }

    function ehCodigoBalanca(entrada) {
        return /^2\d{12}$/.test(String(entrada ?? '').trim());
    }

    // Formato: 2 + PLU (5) + valor total em centavos (6) + DV. Ex.: 2000010014890 → PLU 00001, R$ 14,89
    function interpretarCodigoBalanca(entrada) {
        const limpo = String(entrada ?? '').trim();
        if (!ehCodigoBalanca(limpo)) return null;
        return {
            plu: limpo.substring(1, 6),
            valorTotal: Number(limpo.substring(6, 12)) / 100,
            codigoOriginal: limpo
        };
    }

    // O PLU enviado à balança é o código interno do produto ou, sem código, o ID (ProdutoMapper.toDTO).
    function resolverPluBalanca(produtos, plu, balanca) {
        const valor = String(plu ?? '').trim();
        if (!somenteDigitos(valor)) return montarResultado([], balanca);
        const alvo = semZerosEsquerda(valor);
        const candidatos = (Array.isArray(produtos) ? produtos : []).filter((produto) => {
            if (!produtoComercializavel(produto)) return false;
            const codigo = normalizarIdentificador(produto.codigo);
            if (codigo) return somenteDigitos(codigo) && semZerosEsquerda(codigo) === alvo;
            return String(produto.id) === alvo;
        });
        return montarResultado(candidatos, balanca);
    }

    /**
     * Resolve a entrada do campo de busca do PDV.
     * Uma etiqueta de balança só é interpretada quando nenhum produto possui
     * exatamente aquele código de barras / código interno.
     */
    function resolverEntrada(produtos, entrada) {
        const termo = String(entrada ?? '').trim();
        const direta = resolverPorCodigo(produtos, termo);
        if (direta.status !== STATUS_NENHUM) return direta;

        const balanca = interpretarCodigoBalanca(termo);
        if (!balanca) return direta;
        return resolverPluBalanca(produtos, balanca.plu, balanca);
    }

    return {
        STATUS_UNICO,
        STATUS_AMBIGUO,
        STATUS_NENHUM,
        resolverEntrada,
        resolverPorCodigo,
        resolverPluBalanca,
        ehCodigoBalanca,
        interpretarCodigoBalanca,
        produtoAtivo,
        produtoEhInsumo,
        produtoComercializavel
    };
}));
