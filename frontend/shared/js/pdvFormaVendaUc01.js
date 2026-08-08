/**
 * PDV-UC-02 — Resolução da Forma de Venda (UC-01) para o canal PDV.
 * Fonte única: ProdutoUnidadeComercialService (payload { items }).
 * Sem conversão — apenas escolha da unidade comercial para a UI.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PdvFormaVendaUc01 = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function parseCanais(raw) {
        if (raw == null || raw === '') return null;
        if (typeof raw === 'string') {
            try {
                return JSON.parse(raw);
            } catch (_) {
                return null;
            }
        }
        return raw;
    }

    /** UC ativa e permitida no canal PDV (flags + canais objeto/array). */
    function unidadePermitidaNoPdv(u) {
        if (!u) return false;
        if (Number(u.ativo ?? 1) === 0) return false;
        if (u.permite_pdv === 0 || u.permite_pdv === false) return false;

        const canais = parseCanais(u.canais_comercializacao);
        if (!canais) return true;

        if (Array.isArray(canais)) {
            if (canais.length === 0) return true;
            return canais.map((c) => String(c).toLowerCase()).includes('pdv');
        }

        if (typeof canais === 'object') {
            if (Object.prototype.hasOwnProperty.call(canais, 'pdv')) {
                return Number(canais.pdv) === 1 || canais.pdv === true;
            }
            return true;
        }

        return true;
    }

    /** Extrai lista do payload oficial UC-01 e formatos legados. */
    function extrairListaUc01(resp) {
        if (Array.isArray(resp)) return resp;
        if (!resp || typeof resp !== 'object') return [];
        if (Array.isArray(resp.items)) return resp.items;
        if (Array.isArray(resp.unidades)) return resp.unidades;
        if (Array.isArray(resp.data)) return resp.data;
        return [];
    }

    /** Normaliza UC-01 → formato usado pelo PDV (sem fator operacional). */
    function mapearUc01ParaPdv(u, produto) {
        const codigo = String(u.unidade_comercial || u.unidade || '').toUpperCase();
        const unidadePadrao = Number(u.unidade_padrao) === 1
            || u.unidade_padrao === true
            || Number(u.padrao) === 1
            || Number(u.principal) === 1
            ? 1
            : 0;

        return {
            id: u.id,
            unidade: codigo,
            unidade_comercial: codigo,
            descricao: u.descricao || codigo,
            tipo: u.tipo || 'PADRAO',
            quantidade: Number(u.quantidade != null ? u.quantidade : 1),
            unidade_base: u.unidade_base || produto?.unidade || 'UN',
            preco: Number(u.preco != null ? u.preco : (produto?.preco_venda || 0)),
            permite_pdv: u.permite_pdv,
            canais_comercializacao: u.canais_comercializacao,
            ativo: u.ativo != null ? u.ativo : 1,
            prioridade: Number(u.prioridade != null ? u.prioridade : 999),
            unidade_padrao: unidadePadrao,
            // alias compat UI (modal de seleção ainda lê principal)
            principal: unidadePadrao,
            fator_conversao: Number(u.quantidade != null ? u.quantidade : 1)
        };
    }

    function obterUnidadesComerciaisAtivas(produto) {
        const lista = Array.isArray(produto?.unidades_comerciais) ? produto.unidades_comerciais : [];
        return lista.filter(unidadePermitidaNoPdv);
    }

    /**
     * Fluxo oficial PDV-UC-02:
     * canal PDV → unidade_padrao → prioridade ASC → null (fallback base).
     */
    function resolverFormaVendaPdv(produto) {
        const unidades = obterUnidadesComerciaisAtivas(produto);
        if (!unidades.length) return null;

        if (produto?.unidade_comercial_sugerida_id) {
            const sugerida = unidades.find(
                (u) => Number(u.id) === Number(produto.unidade_comercial_sugerida_id)
            );
            if (sugerida) return sugerida;
        }

        const padrao = unidades.find((u) => Number(u.unidade_padrao || u.principal) === 1);
        if (padrao) return padrao;

        const ordenadas = unidades.slice().sort((a, b) => {
            const pa = Number(a.prioridade != null ? a.prioridade : 999);
            const pb = Number(b.prioridade != null ? b.prioridade : 999);
            if (pa !== pb) return pa - pb;
            return Number(a.id || 0) - Number(b.id || 0);
        });
        return ordenadas[0] || null;
    }

    /** Label do modal de quantidade (unidade comercial ou base). */
    function labelModalQuantidade(produto, unidadeResolvida) {
        if (unidadeResolvida) {
            return String(
                unidadeResolvida.unidade_comercial
                || unidadeResolvida.unidade
                || 'UN'
            ).toUpperCase();
        }
        return String(produto?.unidade || 'UN').toUpperCase();
    }

    function aplicarUnidadesUc01NoProduto(produto, respOuLista) {
        const lista = Array.isArray(respOuLista)
            ? respOuLista
            : extrairListaUc01(respOuLista);
        const mapeadas = lista
            .filter(unidadePermitidaNoPdv)
            .map((u) => mapearUc01ParaPdv(u, produto));
        return {
            ...produto,
            unidades_comerciais: mapeadas,
            _fonte_uc01: true
        };
    }

    return {
        unidadePermitidaNoPdv,
        extrairListaUc01,
        mapearUc01ParaPdv,
        obterUnidadesComerciaisAtivas,
        resolverFormaVendaPdv,
        labelModalQuantidade,
        aplicarUnidadesUc01NoProduto
    };
}));
