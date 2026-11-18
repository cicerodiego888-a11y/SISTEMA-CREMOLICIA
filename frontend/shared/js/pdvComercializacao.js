/**
 * PDV — Formas de venda habilitadas (Configurações → Avançado → Comercialização).
 * Somente leitura: a fonte oficial é GET /api/configuracoes-avancadas/comercializacao.
 * Fica apenas em memória; sem resposta válida vale o comportamento atual (venda por produto).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PdvComercializacao = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const CAMINHO_API = 'configuracoes-avancadas/comercializacao';
    const PADRAO = Object.freeze({ permitirVendaPorProduto: true, permitirVendaPorLinha: false });

    let atual = { ...PADRAO };
    let origem = 'padrao';
    let carregamento = null;

    function normalizar(resposta) {
        const dados = resposta && typeof resposta === 'object' ? resposta : {};
        return {
            permitirVendaPorProduto: typeof dados.permitirVendaPorProduto === 'boolean'
                ? dados.permitirVendaPorProduto
                : PADRAO.permitirVendaPorProduto,
            permitirVendaPorLinha: typeof dados.permitirVendaPorLinha === 'boolean'
                ? dados.permitirVendaPorLinha
                : PADRAO.permitirVendaPorLinha
        };
    }

    function respostaValida(resposta) {
        return !!resposta && typeof resposta === 'object'
            && typeof resposta.permitirVendaPorProduto === 'boolean'
            && typeof resposta.permitirVendaPorLinha === 'boolean';
    }

    /**
     * @param {(caminho: string) => Promise<object>} consultar faz o GET no caminho informado
     * (relativo a /api) e devolve o corpo JSON; qualquer falha mantém o padrão.
     */
    function carregar(consultar) {
        carregamento = Promise.resolve()
            .then(() => consultar(CAMINHO_API))
            .then((resposta) => {
                if (!respostaValida(resposta)) throw new Error('Resposta de comercialização inválida.');
                atual = normalizar(resposta);
                origem = 'servidor';
            })
            .catch(() => {
                atual = { ...PADRAO };
                origem = 'padrao';
            })
            .then(obter);
        return carregamento;
    }

    function obter() {
        return { ...atual, origem };
    }

    function pronto() {
        return carregamento || Promise.resolve(obter());
    }

    function isVendaPorProdutoPermitida() {
        return atual.permitirVendaPorProduto;
    }

    function isVendaPorLinhaPermitida() {
        return atual.permitirVendaPorLinha;
    }

    return {
        CAMINHO_API,
        PADRAO,
        carregar,
        obter,
        pronto,
        normalizar,
        isVendaPorProdutoPermitida,
        isVendaPorLinhaPermitida
    };
}));
