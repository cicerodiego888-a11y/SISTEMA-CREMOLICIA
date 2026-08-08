/**
 * Comprovante comercial de venda (RC3.8D.4.0).
 * Cliente: produtos, qtd comercial, total, formas de pagamento.
 * Não exibe Fiscal × Não Fiscal / MIDP.
 */

function escapeHtmlComprovante(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatarMoedaComprovante(valor) {
    return `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
}

function rotuloFormaComprovante(forma) {
    const key = String(forma || '').toLowerCase().trim();
    const mapa = {
        dinheiro: 'Dinheiro',
        pix: 'PIX',
        cartao_credito: 'Cartão de Crédito',
        cartao_debito: 'Cartão de Débito',
        credito: 'Cartão de Crédito',
        debito: 'Cartão de Débito',
        prazo: 'A Prazo',
        misto: 'Misto',
        voucher: 'Voucher'
    };
    return mapa[key] || (forma ? String(forma) : 'Pagamento');
}

function consolidarPagamentosComprovante(lista) {
    const mapa = new Map();
    (lista || []).forEach((p) => {
        const forma = String(p.forma_pagamento || p.forma || '').toLowerCase();
        const valor = Number(p.valor || 0);
        if (!(valor > 0) || !forma) return;
        mapa.set(forma, Number(((mapa.get(forma) || 0) + valor).toFixed(2)));
    });
    return Array.from(mapa.entries()).map(([forma, valor]) => ({ forma, valor }));
}

function linhaPagamentoComprovante(label, valor, largura = 40) {
    const valorTxt = formatarMoedaComprovante(valor);
    const pontos = Math.max(2, largura - label.length - valorTxt.length);
    return `${label}${'.'.repeat(pontos)}${valorTxt}`;
}

/**
 * Monta HTML a partir de payload em memória (pós-venda imediato).
 */
function montarHtmlComprovanteVendaLocal(vendaId, venda, total, pagamentos) {
    const empresa = venda.nome_empresa || 'Empresa';
    const cupom = venda.codigo || vendaId;
    const dataHora = venda.data_venda || venda.created_at
        ? new Date(venda.data_venda || venda.created_at).toLocaleString('pt-BR')
        : new Date().toLocaleString('pt-BR');
    const itens = Array.isArray(venda.itens) ? venda.itens : [];
    const totalFinal = Number(total != null ? total : venda.total || 0);
    const pags = consolidarPagamentosComprovante(
        pagamentos || venda.pagamentos || venda.recebimentos || []
    );

    const blocoItens = itens.map((item) => {
        const nome = escapeHtmlComprovante(item.produto_nome || item.nome || 'Produto');
        const un = String(item.unidade_comercial || item.unidade || 'UN').toUpperCase();
        const qRaw = Number(item.quantidade || 0);
        const qtd = (un === 'UN' || String(item.tipo_venda || '').toUpperCase() === 'UNIDADE')
            ? String(Math.round(qRaw))
            : String(Number(qRaw.toFixed(3)));
        const unit = formatarMoedaComprovante(item.preco_unitario || item.preco || 0);
        const sub = formatarMoedaComprovante(
            item.subtotal != null
                ? item.subtotal
                : qRaw * Number(item.preco_unitario || item.preco || 0)
        );
        return `
${nome}

Qtd.: ${qtd} ${escapeHtmlComprovante(un)}

Valor Unit.: ${unit}

Subtotal: ${sub}
`;
    }).join('\n----------------------------------------\n');

    const blocoPag = pags.length
        ? pags.map((p) => linhaPagamentoComprovante(rotuloFormaComprovante(p.forma), p.valor)).join('\n\n')
        : linhaPagamentoComprovante(
            rotuloFormaComprovante(venda.forma_pagamento),
            totalFinal
        );

    const linha = '----------------------------------------';

    return `
<pre style="
  font-family: monospace;
  font-size: 13px;
  width: 320px;
  margin: 0 auto;
  white-space: pre-wrap;
">
${linha}
          COMPROVANTE DE VENDA
${linha}

${escapeHtmlComprovante(empresa)}

Data: ${escapeHtmlComprovante(dataHora)}

Cupom: ${escapeHtmlComprovante(String(cupom))}

${linha}
${blocoItens}
${linha}

TOTAL DA COMPRA

${formatarMoedaComprovante(totalFinal)}

${linha}

FORMA DE PAGAMENTO

${blocoPag}

${linha}

Obrigado pela preferência!

Volte sempre!
</pre>
`.trim();
}

async function obterEmpresaComprovante() {
    if (typeof obterDadosEmpresaCupom === 'function') {
        return obterDadosEmpresaCupom();
    }
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_URL}/configuracoes`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!resp.ok) return { nome_empresa: 'Empresa' };
        const configs = await resp.json();
        const map = {};
        if (Array.isArray(configs)) {
            configs.forEach((c) => { map[c.chave] = c.valor; });
        }
        return { nome_empresa: map.nome_empresa || 'Empresa' };
    } catch (e) {
        return { nome_empresa: 'Empresa' };
    }
}

function contarItensHtmlComprovante(html, nomesEsperados = []) {
    let count = 0;
    const h = String(html || '');
    (nomesEsperados || []).forEach((nome) => {
        const n = String(nome || '').trim();
        if (n && h.includes(n)) count += 1;
    });
    if (!nomesEsperados.length) {
        const matches = h.match(/CASQUINHA|PRODUTO|Qtd\.|x R\$/gi) || [];
        return Math.max(1, Math.floor(matches.length / 2));
    }
    return count;
}

function extrairTotalHtmlComprovante(html) {
    const bloco = String(html || '').split('TOTAL DA COMPRA')[1] || '';
    const m = bloco.match(/R\$\s*([\d.,]+)/);
    if (!m) return null;
    return Number(String(m[1]).replace(/\./g, '').replace(',', '.'));
}

function logAuditoriaRcf101Frontend(payload) {
    console.log('[RCF-10.1]', {
        Venda: payload.vendaId,
        URL: payload.url,
        'Itens Banco': payload.itensBanco,
        'Itens API': payload.itensApi,
        'Itens HTML': payload.itensHtml,
        'Itens Impressos': payload.itensImpressos,
        'Total Banco': payload.totalBanco,
        'Total HTML': payload.totalHtml,
        'Total Impresso': payload.totalImpresso,
        'HTML bytes': payload.htmlBytes
    });
}

async function enviarHtmlComprovanteParaImpressora(html, contextoRcf101 = null) {
    if (contextoRcf101) {
        const itensHtml = contextoRcf101.itensHtml
            ?? contarItensHtmlComprovante(html, contextoRcf101.nomesItens);
        const totalHtml = contextoRcf101.totalHtml ?? extrairTotalHtmlComprovante(html);
        logAuditoriaRcf101Frontend({
            vendaId: contextoRcf101.vendaId,
            url: contextoRcf101.url,
            itensBanco: contextoRcf101.itensBanco,
            itensApi: contextoRcf101.itensApi,
            itensHtml,
            itensImpressos: itensHtml,
            totalBanco: contextoRcf101.totalBanco,
            totalHtml: totalHtml ?? contextoRcf101.totalBanco,
            totalImpresso: totalHtml ?? contextoRcf101.totalBanco,
            htmlBytes: String(html || '').length
        });
    }

    const deviceName = typeof obterDeviceNameImpressoraCupom === 'function'
        ? await obterDeviceNameImpressoraCupom()
        : null;

    if (window.electronAPI?.abrirComprovante) {
        window.electronAPI.abrirComprovante(html, {
            silent: false,
            autoFecharMs: 5000,
            deviceName
        });
        return;
    }

    if (window.electronAPI?.imprimirDANFESilencioso) {
        await window.electronAPI.imprimirDANFESilencioso(html, deviceName);
        if (typeof showNotification === 'function') {
            showNotification('Comprovante de venda enviado para impressora.', 'success');
        }
        return;
    }

    const janela = window.open('', '_blank', 'width=420,height=720');
    if (!janela) {
        if (typeof showNotification === 'function') {
            showNotification('Permita pop-ups para visualizar o comprovante.', 'warning');
        }
        return;
    }
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    janela.print();
}

/**
 * Imprime comprovante comercial.
 * Preferência: GET /vendas/:id/comprovante (fonte persistida).
 * Fallback: montagem local com payload da venda.
 */
async function imprimirComprovanteVenda(vendaId, vendaOpcional, totalOpcional) {
    if (!vendaId) {
        if (typeof showNotification === 'function') {
            showNotification('Venda não informada para comprovante.', 'warning');
        }
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_URL}/vendas/${vendaId}/comprovante`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (resp.ok) {
            const data = await resp.json();
            if (data.html) {
                await enviarHtmlComprovanteParaImpressora(data.html);
                return;
            }
        }

        // Fallback local (venda ainda não consolidada / offline)
        let venda = vendaOpcional || {};
        if (!venda.nome_empresa) {
            const empresa = await obterEmpresaComprovante();
            venda = { ...venda, ...empresa };
        }
        const html = montarHtmlComprovanteVendaLocal(
            vendaId,
            venda,
            totalOpcional != null ? totalOpcional : venda.total,
            venda.pagamentos
        );
        await enviarHtmlComprovanteParaImpressora(html);
    } catch (error) {
        console.error('Erro ao imprimir comprovante de venda:', error);
        if (typeof showNotification === 'function') {
            showNotification('Erro ao imprimir comprovante de venda.', 'danger');
        }
    }
}

async function imprimirComprovanteComercialPosFiscal(vendaId, opcoes = {}) {
    if (!vendaId) {
        if (typeof showNotification === 'function') {
            showNotification('Venda não informada para comprovante.', 'warning');
        }
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const notaId = opcoes.notaId || opcoes.nota_id || null;
        const qs = notaId ? `?notaId=${encodeURIComponent(notaId)}&format=html` : '?format=html';
        const url = `${API_URL}/fiscal/comprovante-comercial/venda/${vendaId}${qs}`;

        console.log('[RCF-10] imprimirComprovanteComercialPosFiscal', { vendaId, notaId, url });

        const resposta = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!resposta.ok) {
            const errTxt = await resposta.text();
            let msg = errTxt;
            try {
                const j = JSON.parse(errTxt);
                msg = j.error || j.message || errTxt;
            } catch (_) { /* texto */ }

            if (resposta.status === 404) {
                await imprimirComprovanteVenda(vendaId);
                return;
            }
            throw new Error(msg || 'Erro ao gerar comprovante comercial.');
        }

        const html = await resposta.text();
        const hdrVenda = resposta.headers.get('X-CDS-Venda-Id');
        if (hdrVenda && String(hdrVenda) !== String(vendaId)) {
            throw new Error('RCF-10: comprovante não corresponde à venda.');
        }

        const itensBanco = Number(resposta.headers.get('X-CDS-Itens-Banco') || 0);
        const itensApi = Number(resposta.headers.get('X-CDS-Itens-HTML') || itensBanco || 0);
        const totalBanco = Number(resposta.headers.get('X-CDS-Total-Banco') || 0);

        await enviarHtmlComprovanteParaImpressora(html, {
            vendaId,
            url,
            itensBanco: itensBanco || null,
            itensApi: itensApi || null,
            totalBanco: totalBanco || null
        });
        if (typeof showNotification === 'function') {
            showNotification('Comprovante comercial enviado.', 'success');
        }
    } catch (error) {
        console.error('Erro ao imprimir comprovante comercial pós-fiscal:', error);
        if (typeof showNotification === 'function') {
            showNotification(error.message || 'Erro ao imprimir comprovante comercial.', 'danger');
        }
    }
}

/** @deprecated RCF-09 alias → RCF-10 */
async function imprimirComprovanteRemontadoNfce(vendaId, opcoes = {}) {
    return imprimirComprovanteComercialPosFiscal(vendaId, opcoes);
}

async function reimprimirComprovanteVendaHistorico(vendaId) {
    // RCF-10: mesmo serviço (nunca DANFE como comprovante do cliente)
    await imprimirComprovanteComercialPosFiscal(vendaId);
}

window.imprimirComprovanteVenda = imprimirComprovanteVenda;
window.imprimirComprovanteComercialPosFiscal = imprimirComprovanteComercialPosFiscal;
window.imprimirComprovanteRemontadoNfce = imprimirComprovanteRemontadoNfce;
window.reimprimirComprovanteVendaHistorico = reimprimirComprovanteVendaHistorico;
