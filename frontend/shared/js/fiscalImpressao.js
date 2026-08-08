function escapeHtmlCupom(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizarTipoVendaItemCupom(item) {
    const tipo = String(item?.tipo_venda || '').toUpperCase();
    if (tipo === 'UNIDADE') return 'UNIDADE';
    if (tipo === 'PESO') return 'PESO';
    if (item?.modo_venda === 'unidade') return 'UNIDADE';
    return 'PESO';
}

function itemVendaPorUnidadeCupom(item) {
    return normalizarTipoVendaItemCupom(item) === 'UNIDADE';
}

function formatarHtmlItemCupom(item) {
    const nome = escapeHtmlCupom(item.produto_nome || item.nome || 'Produto');
    const subtotal = Number(item.subtotal || 0);
    const bolas = Number(item.quantidade_bolas || 0);
    const sabores = Array.isArray(item.sabores) ? item.sabores : [];
    const titulo = bolas > 0
      ? (String(nome).toUpperCase().includes('CASQUINHA')
        ? `${nome.toUpperCase()}`
        : `CASQUINHA ${bolas} BOLA${bolas > 1 ? 'S' : ''}`)
      : nome;
    const linhasSabores = sabores.length
      ? `\n${sabores.map((s) => `- ${escapeHtmlCupom(s.nome || s)}`).join('\n')}`
      : '';

    if (itemVendaPorUnidadeCupom(item)) {
        const qtd = Math.round(Number(item.quantidade || 0));
        const preco = Number(item.preco_unitario || item.preco || 0);
        return `
${titulo}${linhasSabores}
${qtd} UN
R$ ${preco.toFixed(2).replace('.', ',')}
Total
${subtotal.toFixed(2).replace('.', ',')}
`;
    }

    const qtd = Number(item.quantidade || 0);
    const preco = Number(item.preco_unitario || item.preco || 0);
    const forma = String(item.forma_comercializacao || '').toUpperCase();
    let un = String(item.unidade_comercial || item.unidade || '').toUpperCase();
    if (un === 'LITRO' || un === 'LITROS' || un === 'LT') un = 'L';
    if (un === 'KILO' || un === 'KILOS') un = 'KG';
    if (forma === 'PESO' || un === 'KG') {
        return `
${titulo}${linhasSabores}
${qtd.toFixed(3).replace('.', ',')} KG
${preco.toFixed(2).replace('.', ',')}/KG
${subtotal.toFixed(2).replace('.', ',')}
`;
    }
    if (forma === 'VOLUME' || un === 'L') {
        const qFmt = String(Number(qtd.toFixed(3))).replace('.', ',');
        return `
${titulo}${linhasSabores}
${qFmt} L
${preco.toFixed(2).replace('.', ',')}/L
${subtotal.toFixed(2).replace('.', ',')}
`;
    }

    return `
${titulo}${linhasSabores}
${qtd} x R$ ${preco.toFixed(2).replace('.', ',')} = R$ ${subtotal.toFixed(2).replace('.', ',')}
`;
}

async function obterDeviceNameImpressoraCupom() {
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_URL}/configuracoes/impressora_cupom`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await resp.json();
        return data.caminho || null;
    } catch (e) {
        return null;
    }
}

async function obterDadosEmpresaCupom() {
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_URL}/configuracoes`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!resp.ok) {
            return { nome_empresa: 'CDS Sistemas', endereco: '' };
        }

        const configs = await resp.json();
        const map = {};
        if (Array.isArray(configs)) {
            configs.forEach((c) => {
                map[c.chave] = c.valor;
            });
        }

        const partes = [
            map.fiscal_emitente_logradouro,
            map.fiscal_emitente_numero,
            map.fiscal_emitente_bairro,
            map.fiscal_municipio_nome
        ].filter(Boolean);

        return {
            nome_empresa: map.nome_empresa || 'CDS Sistemas',
            endereco: partes.join(', ')
        };
    } catch (e) {
        return { nome_empresa: 'CDS Sistemas', endereco: '' };
    }
}

function montarItensCupomNaoFiscal(venda) {
    const itens = Array.isArray(venda?.itens) ? venda.itens : [];
    const valorFiscal = Number(venda?.valor_fiscal || 0);
    const valorNaoFiscal = Number(venda?.valor_nao_fiscal || 0);

    if (valorFiscal <= 0 || valorNaoFiscal <= 0) {
        return itens.map((item) => ({
            ...item,
            produto_nome: item.produto_nome || item.nome || 'Produto',
            subtotal: Number(item.subtotal || 0),
            quantidade: Number(item.quantidade || 0),
            preco_unitario: Number(item.preco_unitario || 0)
        }));
    }

    return itens
        .filter((item) => Number(item.valor_nao_fiscal || 0) > 0 || Number(item.quantidade_nao_fiscal || 0) > 0)
        .map((item) => {
            const valNf = Number(item.valor_nao_fiscal || 0);
            const qtdNf = Number(item.quantidade_nao_fiscal || item.quantidade || 0);
            const preco = qtdNf > 0 ? valNf / qtdNf : Number(item.preco_unitario || 0);
            return {
                ...item,
                produto_nome: item.produto_nome || item.nome || 'Produto',
                quantidade: qtdNf,
                preco_unitario: preco,
                subtotal: valNf
            };
        });
}

function obterTotalCupomNaoFiscal(venda) {
    const valorNaoFiscal = Number(venda?.valor_nao_fiscal || 0);
    if (valorNaoFiscal > 0) return valorNaoFiscal;
    return Number(venda?.total || 0);
}

function montarHtmlCupomNaoFiscal(vendaId, venda, total, desconto) {
    const dataHora = venda.data_venda || venda.created_at
        ? new Date(venda.data_venda || venda.created_at).toLocaleString('pt-BR')
        : new Date().toLocaleString('pt-BR');

    const formaPagamentoTexto = {
        dinheiro: 'Dinheiro',
        cartao_credito: 'Cartão de Crédito',
        cartao_debito: 'Cartão de Débito',
        pix: 'PIX',
        prazo: 'A Prazo',
        misto: 'Misto'
    }[venda.forma_pagamento] || venda.forma_pagamento || '-';

    const clienteNome = venda.cliente_nome || '';
    const linha = '------------------------------------------------';
    const itensHtml = (venda.itens || []).map((item) => formatarHtmlItemCupom(item)).join('');

    return `
<pre style="
  font-family: monospace;
  font-size: 13px;
  width: 300px;
  margin: 0 auto;
  white-space: pre-wrap;
">
        ${escapeHtmlCupom(venda.nome_empresa || 'CDS Sistemas')}
${escapeHtmlCupom(venda.endereco || '')}

COMPROVANTE NÃO FISCAL
Venda #${vendaId}
${dataHora}

${linha}
Item                 Qtd Vl.Unit Total
${itensHtml}
${linha}
Total: R$ ${Number(total || 0).toFixed(2).replace('.', ',')}
Desconto: R$ ${Number(desconto || 0).toFixed(2).replace('.', ',')}
Forma pag.: ${formaPagamentoTexto}
${clienteNome ? `Cliente: ${escapeHtmlCupom(clienteNome)}` : ''}
${linha}
ESTE COMPROVANTE NÃO POSSUI VALOR FISCAL
OBRIGADO PELA PREFERÊNCIA!
VOLTE SEMPRE.
</pre>
`;
}

async function enviarCupomNaoFiscalParaImpressora(vendaId, venda, total, desconto) {
    const cupomHtml = montarHtmlCupomNaoFiscal(vendaId, venda, total, desconto);
    const deviceName = await obterDeviceNameImpressoraCupom();

    if (window.electronAPI?.abrirComprovante) {
        window.electronAPI.abrirComprovante(cupomHtml, {
            silent: false,
            autoFecharMs: 5000,
            deviceName
        });
        return;
    }

    if (window.electronAPI?.imprimirDANFESilencioso) {
        await window.electronAPI.imprimirDANFESilencioso(cupomHtml, deviceName);
        if (typeof showNotification === 'function') {
            showNotification('Cupom não fiscal enviado para impressora.', 'success');
        }
        return;
    }

    const janela = window.open('', '_blank', 'width=420,height=720');
    if (!janela) {
        if (typeof showNotification === 'function') {
            showNotification('Permita pop-ups para visualizar o cupom não fiscal.', 'warning');
        }
        return;
    }

    janela.document.open();
    janela.document.write(cupomHtml);
    janela.document.close();
    janela.focus();
    janela.print();
}

async function imprimirCupomNaoFiscal(vendaId, venda, total, desconto) {
    if (!vendaId || !venda) {
        if (typeof showNotification === 'function') {
            showNotification('Dados insuficientes para imprimir cupom não fiscal.', 'warning');
        }
        return;
    }

    try {
        let vendaCupom = venda;
        if (!venda.nome_empresa) {
            const empresa = await obterDadosEmpresaCupom();
            vendaCupom = { ...venda, ...empresa };
        }

        const itensNf = montarItensCupomNaoFiscal(vendaCupom);
        const totalNf = obterTotalCupomNaoFiscal(vendaCupom);
        const totalEfetivo = totalNf > 0
          ? totalNf
          : Number(total != null ? total : vendaCupom.total || 0);

        await enviarCupomNaoFiscalParaImpressora(
          vendaId,
          { ...vendaCupom, itens: itensNf.length ? itensNf : (vendaCupom.itens || []) },
          totalEfetivo,
          Number(desconto != null ? desconto : vendaCupom.desconto || 0)
        );
    } catch (error) {
        console.error('Erro ao imprimir cupom não fiscal:', error);
        if (typeof showNotification === 'function') {
            showNotification('Erro ao imprimir cupom não fiscal.', 'danger');
        }
    }
}

async function imprimirDANFEFiscal(vendaId, opcoes = {}) {
    if (!vendaId) {
        if (typeof showNotification === 'function') {
            showNotification('Venda não informada para reimpressão.', 'warning');
        }
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const notaId = opcoes.notaId || opcoes.nota_id || null;
        // RCF-06: sempre amarrar à venda; nunca buscar só por notaId sem vendaId
        const qsParts = [];
        if (notaId) qsParts.push(`notaId=${encodeURIComponent(notaId)}`);
        const qs = qsParts.length ? `?${qsParts.join('&')}` : '';
        const url = `${API_URL}/fiscal/danfe/venda/${vendaId}${qs}`;

        console.log('[RCF-06] imprimirDANFEFiscal', { vendaId, notaId, url });

        const resposta = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
        });

        const htmlDanfe = await resposta.text();
        const hdrVenda = resposta.headers.get('X-CDS-Venda-Id');
        const hdrNota = resposta.headers.get('X-CDS-Nota-Id');
        console.log('[RCF-06] DANFE headers', { hdrVenda, hdrNota, status: resposta.status });

        if (!resposta.ok) {
            console.error('Erro ao buscar DANFE:', { status: resposta.status, resposta: htmlDanfe });
            if (typeof showNotification === 'function') {
                showNotification(`Erro ao abrir cupom fiscal: ${htmlDanfe}`, 'danger');
            }
            return;
        }

        if (hdrVenda && String(hdrVenda) !== String(vendaId)) {
            console.error('[RCF-06] Abortando impressão: DANFE pertence a outra venda', {
                esperado: vendaId,
                obtido: hdrVenda,
                notaId: hdrNota
            });
            if (typeof showNotification === 'function') {
                showNotification('RCF-06: DANFE pertence a outra venda. Impressão abortada.', 'danger');
            }
            return;
        }

        const deviceName = await obterDeviceNameImpressoraCupom();

        if (window.electronAPI?.abrirComprovante) {
            window.electronAPI.abrirComprovante(htmlDanfe, {
                silent: false,
                autoFecharMs: 5000,
                deviceName
            });
            return;
        }

        if (window.electronAPI?.imprimirDANFESilencioso) {
            await window.electronAPI.imprimirDANFESilencioso(htmlDanfe, deviceName);
            if (typeof showNotification === 'function') {
                showNotification('Cupom fiscal enviado para impressora.', 'success');
            }
            return;
        }

        const janela = window.open('', '_blank', 'width=380,height=720');
        if (!janela) {
            if (typeof showNotification === 'function') {
                showNotification('Permita pop-ups para visualizar o cupom fiscal.', 'warning');
            }
            return;
        }

        janela.document.open();
        janela.document.write(htmlDanfe);
        janela.document.close();

        setTimeout(() => {
            if (!janela.closed) janela.close();
        }, 5000);
    } catch (error) {
        console.error('Erro ao imprimir DANFE fiscal:', error);
        if (typeof showNotification === 'function') {
            showNotification('Erro ao imprimir cupom fiscal.', 'danger');
        }
    }
}

function vendaPossuiNfceAutorizada(venda) {
    return String(venda?.nfce_status || '').toLowerCase() === 'autorizada';
}

function vendaPossuiCupomNaoFiscal(venda) {
    if (Number(venda?.valor_nao_fiscal || 0) > 0) {
        return true;
    }

    if (vendaPossuiNfceAutorizada(venda)) {
        return false;
    }

    return Number(venda?.valor_fiscal || 0) === 0 && Number(venda?.total || 0) > 0;
}

function reimprimirCupomFiscalHistorico(vendaId) {
    imprimirDANFEFiscal(vendaId);
}

/**
 * Abre/baixa o XML da NFC-e autorizada da venda (histórico PDV/ERP).
 */
async function abrirXmlNfceHistorico(vendaId, opcoes = {}) {
    if (!vendaId) {
        if (typeof showNotification === 'function') {
            showNotification('Venda não informada.', 'warning');
        }
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const notaId = opcoes.notaId || opcoes.nota_id || null;
        const qs = notaId ? `?notaId=${encodeURIComponent(notaId)}` : '';
        const resp = await fetch(`${API_URL}/fiscal/xml/venda/${vendaId}${qs}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(data.error || data.erro || 'XML não encontrado.');
        }

        const xml = String(data.xml || '').trim();
        if (!xml) {
            throw new Error('XML vazio para esta NFC-e.');
        }

        const fileName = `nfce-venda-${vendaId}${data.numero ? '-' + data.numero : ''}.xml`;
        const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        // Preferência: nova aba com o XML; fallback download
        const janela = window.open(url, '_blank');
        if (!janela) {
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
        }

        setTimeout(() => URL.revokeObjectURL(url), 60000);

        if (typeof showNotification === 'function') {
            showNotification(`XML NFC-e${data.numero ? ' #' + data.numero : ''} aberto.`, 'success');
        }
    } catch (error) {
        console.error('Erro ao abrir XML NFC-e:', error);
        if (typeof showNotification === 'function') {
            showNotification(error.message || 'Erro ao abrir XML da NFC-e.', 'danger');
        }
    }
}

async function reimprimirCupomNaoFiscalHistorico(vendaId) {
    if (!vendaId) return;

    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_URL}/vendas/${vendaId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const venda = await resp.json();

        if (!resp.ok) {
            throw new Error(venda.error || 'Erro ao carregar venda.');
        }

        const empresa = await obterDadosEmpresaCupom();
        const itens = montarItensCupomNaoFiscal(venda);

        if (!itens.length) {
            if (typeof showNotification === 'function') {
                showNotification('Esta venda não possui itens para cupom não fiscal.', 'warning');
            }
            return;
        }

        await imprimirCupomNaoFiscal(
            vendaId,
            {
                ...venda,
                ...empresa,
                itens
            },
            obterTotalCupomNaoFiscal(venda),
            Number(venda.desconto || 0)
        );
    } catch (error) {
        console.error('Erro ao reimprimir cupom não fiscal:', error);
        if (typeof showNotification === 'function') {
            showNotification(error.message || 'Erro ao reimprimir cupom não fiscal.', 'danger');
        }
    }
}

window.obterDeviceNameImpressoraCupom = obterDeviceNameImpressoraCupom;
window.imprimirDANFEFiscal = imprimirDANFEFiscal;
window.imprimirCupomNaoFiscal = imprimirCupomNaoFiscal;
window.vendaPossuiNfceAutorizada = vendaPossuiNfceAutorizada;
window.vendaPossuiCupomNaoFiscal = vendaPossuiCupomNaoFiscal;
window.reimprimirCupomFiscalHistorico = reimprimirCupomFiscalHistorico;
window.abrirXmlNfceHistorico = abrirXmlNfceHistorico;
window.reimprimirCupomNaoFiscalHistorico = reimprimirCupomNaoFiscalHistorico;
