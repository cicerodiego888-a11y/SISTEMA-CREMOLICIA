function formatarMoedaDashboard(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

/** Quantidade operacional legível (evita 183.931034…) */
function formatarQuantidadeDashboard(valor) {
    const n = Number(valor || 0);
    if (!Number.isFinite(n)) return '0';
    if (Math.abs(n - Math.round(n)) < 0.001) {
        return Math.round(n).toLocaleString('pt-BR');
    }
    return n.toLocaleString('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function escapeHtmlDashboard(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function labelFormaPagamentoDashboard(forma) {
    const chave = String(forma || '').toLowerCase().trim();
    const mapa = {
        dinheiro: 'Dinheiro',
        pix: 'PIX',
        cartao_credito: 'Cartão crédito',
        credito: 'Cartão crédito',
        cartao_debito: 'Cartão débito',
        debito: 'Cartão débito',
        prazo: 'A prazo',
        misto: 'Pagamento misto',
        nao_informado: 'Não informado'
    };
    return mapa[chave] || (chave ? chave.charAt(0).toUpperCase() + chave.slice(1) : 'Não informado');
}

function setDashboardText(id, valor) {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
}

function formatarDataBr(iso) {
    if (!iso) return '';
    const partes = String(iso).split('-');
    if (partes.length !== 3) return iso;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function montarListaProdutosDashboard(lista, modoFiscalAtivo, mensagemVazia) {
    if (!lista || lista.length === 0) {
        return `<div class="dash-empty-state">${escapeHtmlDashboard(mensagemVazia || 'Nenhum produto vendido no período.')}</div>`;
    }

    return lista.map((item, index) => {
        let quantidadeHtml;
        if (modoFiscalAtivo) {
            quantidadeHtml = `<strong>${escapeHtmlDashboard(formatarQuantidadeDashboard(item.quantidade_vendida || item.quantidade_fiscal || 0))}</strong>`;
        } else {
            quantidadeHtml = `
                <span class="text-end">
                    <strong>${escapeHtmlDashboard(formatarQuantidadeDashboard(item.quantidade_vendida || 0))}</strong>
                    <small class="text-muted d-block">
                        F: ${escapeHtmlDashboard(formatarQuantidadeDashboard(item.quantidade_fiscal || 0))} |
                        NF: ${escapeHtmlDashboard(formatarQuantidadeDashboard(item.quantidade_nao_fiscal || 0))}
                    </small>
                </span>
            `;
        }

        return `
        <div class="dash-list-row">
            <span>${index + 1}. ${escapeHtmlDashboard(item.nome)}</span>
            ${quantidadeHtml}
        </div>
    `;
    }).join('');
}

function aplicarValorCard(id, valorHtml) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = valorHtml;
}

function aplicarIndicadorPrincipal(id, valor, mensagemVazia) {
    const el = document.getElementById(id);
    if (!el) return;

    const vazio = valor === null || valor === undefined || valor === '' || Number(valor) === 0;
    if (vazio && mensagemVazia) {
        el.innerHTML = `<span class="dash-card__empty">${escapeHtmlDashboard(mensagemVazia)}</span>`;
        return;
    }

    el.textContent = valor;
}

function montarResumoExecutivo(data) {
    const vendas = Number(data.vendas_hoje || 0);
    const faturamento = formatarMoedaDashboard(data.faturamento_hoje);
    const ticket = formatarMoedaDashboard(data.ticket_medio_hoje);
    const lucro = formatarMoedaDashboard(data.lucro_estimado_hoje);

    if (vendas === 0) {
        return 'Nenhuma venda realizada hoje. O painel exibe o desempenho do período selecionado nos indicadores operacionais.';
    }

    return `Hoje foram realizadas <strong>${vendas}</strong> venda(s). O faturamento acumulado é de <strong>${faturamento}</strong>. O ticket médio é de <strong>${ticket}</strong>. Lucro estimado de <strong>${lucro}</strong>.`;
}

function labelStatusVendaDashboard(status) {
    const chave = String(status || '').toLowerCase().trim();
    const mapa = {
        finalizada: 'Finalizada',
        concluida: 'Concluída',
        cancelada: 'Cancelada',
        pendente: 'Pendente',
        aberta: 'Aberta'
    };
    return mapa[chave] || (chave ? chave.charAt(0).toUpperCase() + chave.slice(1) : '—');
}

function classeBadgeStatusVenda(status) {
    const chave = String(status || '').toLowerCase().trim();
    if (chave.includes('cancel')) return 'dash-badge--danger';
    if (chave.includes('pend') || chave.includes('abert')) return 'dash-badge--warning';
    return 'dash-badge--success';
}

function formatarHorarioVenda(venda) {
    const origem = venda?.created_at || venda?.data_venda;
    if (!origem) return '—';
    const data = new Date(origem);
    if (Number.isNaN(data.getTime())) return String(origem).slice(11, 16) || '—';
    return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function valorVendaDashboard(venda, modoFiscalAtivo) {
    if (modoFiscalAtivo) {
        return formatarMoedaDashboard(venda.valor_fiscal ?? venda.total);
    }
    return formatarMoedaDashboard(venda.total);
}

function montarTabelaUltimasVendas(lista, modoFiscalAtivo) {
    if (!lista || lista.length === 0) {
        return '<div class="dash-empty-state">Nenhuma venda registrada no período.</div>';
    }

    const linhas = lista.map((venda) => `
        <tr>
            <td>${escapeHtmlDashboard(formatarHorarioVenda(venda))}</td>
            <td>${escapeHtmlDashboard(venda.cliente_nome || 'Consumidor')}</td>
            <td><strong>${escapeHtmlDashboard(valorVendaDashboard(venda, modoFiscalAtivo))}</strong></td>
            <td>${escapeHtmlDashboard(labelFormaPagamentoDashboard(venda.forma_pagamento))}</td>
            <td><span class="dash-badge ${classeBadgeStatusVenda(venda.status)}">${escapeHtmlDashboard(labelStatusVendaDashboard(venda.status))}</span></td>
        </tr>
    `).join('');

    return `
        <table class="table table-sm dash-table mb-0">
            <thead>
                <tr>
                    <th>Horário</th>
                    <th>Cliente</th>
                    <th>Valor</th>
                    <th>Pagamento</th>
                    <th>Situação</th>
                </tr>
            </thead>
            <tbody>${linhas}</tbody>
        </table>
    `;
}

function calcularPeriodoAnterior(inicio, fim) {
    const inicioDate = new Date(`${inicio}T00:00:00`);
    const fimDate = new Date(`${fim}T00:00:00`);
    const dias = Math.max(1, Math.round((fimDate - inicioDate) / (1000 * 60 * 60 * 24)) + 1);
    const anteriorFim = new Date(inicioDate);
    anteriorFim.setDate(anteriorFim.getDate() - 1);
    const anteriorInicio = new Date(anteriorFim);
    anteriorInicio.setDate(anteriorInicio.getDate() - (dias - 1));
    return {
        inicio: anteriorInicio.toISOString().slice(0, 10),
        fim: anteriorFim.toISOString().slice(0, 10)
    };
}

function destruirGraficoDashboard() {
    if (window._dashboardChartInstance) {
        window._dashboardChartInstance.destroy();
        window._dashboardChartInstance = null;
    }
}

function renderizarGraficoEvolucao(diasAtual, diasAnterior) {
    const canvas = document.getElementById('dashboardGraficoEvolucao');
    const empty = document.getElementById('dashboardGraficoEmpty');
    const kpiHost = document.getElementById('dashboardGraficoKpis');
    if (!canvas) return;

    destruirGraficoDashboard();

    const serieAtual = Array.isArray(diasAtual) ? [...diasAtual].reverse() : [];
    if (!serieAtual.length) {
        canvas.classList.add('d-none');
        if (empty) empty.classList.remove('d-none');
        if (kpiHost) kpiHost.innerHTML = '';
        return;
    }

    canvas.classList.remove('d-none');
    if (empty) empty.classList.add('d-none');

    const labels = serieAtual.map((item) => formatarDataBr(item.data));
    const faturamento = serieAtual.map((item) => Number(item.valor_total || 0));
    const vendas = serieAtual.map((item) => Number(item.total_vendas || 0));

    const mapaAnterior = (Array.isArray(diasAnterior) ? diasAnterior : []).reduce((acc, item, index) => {
        acc[index] = Number(item.valor_total || 0);
        return acc;
    }, {});

    const faturamentoAnterior = labels.map((_, index) => mapaAnterior[index] ?? null);

    const totalReceita = faturamento.reduce((s, v) => s + v, 0);
    const totalReceitaAnt = faturamentoAnterior.reduce((s, v) => s + (Number(v) || 0), 0);
    const totalVendas = vendas.reduce((s, v) => s + v, 0);
    const deltaReceita = totalReceitaAnt > 0
        ? ((totalReceita - totalReceitaAnt) / totalReceitaAnt) * 100
        : null;

    if (kpiHost && window.CDSChartTheme) {
        kpiHost.innerHTML = CDSChartTheme.renderKpiStrip([
            {
                label: 'Receita',
                value: formatarMoedaDashboard(totalReceita),
                delta: deltaReceita,
                hint: 'Comparado ao período anterior'
            },
            {
                label: 'Vendas',
                value: String(totalVendas),
                hint: 'Quantidade no período'
            },
            {
                label: 'Período anterior',
                value: formatarMoedaDashboard(totalReceitaAnt),
                hint: 'Mesma duração'
            }
        ]);
    }

    if (typeof Chart === 'undefined') {
        if (empty) {
            empty.textContent = 'Biblioteca de gráficos indisponível.';
            empty.classList.remove('d-none');
        }
        canvas.classList.add('d-none');
        return;
    }

    const theme = window.CDSChartTheme;
    if (theme) theme.applyDefaults(Chart);

    const receitaDs = theme
        ? theme.lineReceita('Receita', faturamento)
        : {
            label: 'Receita',
            data: faturamento,
            type: 'line',
            borderColor: '#334155',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35
        };
    receitaDs.yAxisID = 'y';

    const comparativoDs = theme
        ? theme.lineComparativo('Período anterior', faturamentoAnterior)
        : {
            label: 'Período anterior',
            data: faturamentoAnterior,
            type: 'line',
            borderColor: '#94a3b8',
            borderDash: [5, 4],
            borderWidth: 2,
            fill: false
        };
    comparativoDs.yAxisID = 'y';

    const volumeDs = theme
        ? theme.lineVolume('Quantidade de vendas', vendas, 'y1')
        : {
            label: 'Quantidade de vendas',
            data: vendas,
            type: 'line',
            borderColor: '#64748b',
            borderWidth: 2,
            yAxisID: 'y1',
            fill: false
        };

    const options = theme
        ? theme.baseOptions({
            plugins: {
                tooltip: {
                    callbacks: {
                        title(items) {
                            return items[0] ? items[0].label : '';
                        },
                        label(ctx) {
                            const label = ctx.dataset.label || '';
                            const raw = ctx.parsed.y;
                            if (ctx.dataset.yAxisID === 'y1' || label.toLowerCase().includes('quantidade')) {
                                return ` ${label}: ${raw ?? '—'}`;
                            }
                            return ` ${label}: ${formatarMoedaDashboard(raw)}`;
                        }
                    }
                }
            },
            scales: {
                y: theme.scaleY({
                    ticks: {
                        callback: (value) => formatarMoedaDashboard(value),
                        maxTicksLimit: 5
                    }
                }),
                y1: theme.scaleY({
                    position: 'right',
                    grid: { drawOnChartArea: false, display: false },
                    ticks: { maxTicksLimit: 4 }
                })
            }
        })
        : {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom' } },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => formatarMoedaDashboard(v) } },
                y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }
            }
        };

    window._dashboardChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [receitaDs, comparativoDs, volumeDs]
        },
        options
    });
}

async function carregarGraficoEvolucaoVendas(apiUrl, inicio, fim, modoFiscalAtivo) {
    try {
        const anterior = calcularPeriodoAnterior(inicio, fim);
        const modo = modoFiscalAtivo ? '1' : '0';
        const headers = { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') };

        const [respAtual, respAnterior] = await Promise.all([
            fetch(`${apiUrl}/vendas/relatorio/periodo?data_inicio=${inicio}&data_fim=${fim}&modo_fiscal=${modo}`, { headers }),
            fetch(`${apiUrl}/vendas/relatorio/periodo?data_inicio=${anterior.inicio}&data_fim=${anterior.fim}&modo_fiscal=${modo}`, { headers })
        ]);

        const atual = respAtual.ok ? await respAtual.json() : { dias: [] };
        const previo = respAnterior.ok ? await respAnterior.json() : { dias: [] };
        renderizarGraficoEvolucao(atual.dias || [], previo.dias || []);
    } catch (error) {
        console.error('Erro gráfico dashboard:', error);
        const empty = document.getElementById('dashboardGraficoEmpty');
        const canvas = document.getElementById('dashboardGraficoEvolucao');
        if (canvas) canvas.classList.add('d-none');
        if (empty) {
            empty.textContent = 'Não foi possível carregar o gráfico de evolução.';
            empty.classList.remove('d-none');
        }
    }
}

async function carregarUltimasVendasDashboard(apiUrl, inicio, fim, modoFiscalAtivo) {
    const container = document.getElementById('dashboardUltimasVendas');
    if (!container) return;

    try {
        const response = await fetch(`${apiUrl}/vendas?todas=1`, {
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
        });
        const lista = response.ok ? await response.json() : [];
        const filtradas = (Array.isArray(lista) ? lista : [])
            .filter((venda) => {
                const data = String(venda.data_venda || '').slice(0, 10);
                return data >= inicio && data <= fim;
            })
            .sort((a, b) => {
                const da = new Date(a.created_at || a.data_venda).getTime();
                const db = new Date(b.created_at || b.data_venda).getTime();
                return db - da;
            })
            .slice(0, 8);

        container.innerHTML = montarTabelaUltimasVendas(filtradas, modoFiscalAtivo);
    } catch (error) {
        console.error('Erro últimas vendas dashboard:', error);
        container.innerHTML = '<div class="dash-empty-state">Não foi possível carregar as últimas vendas.</div>';
    }
}

function aplicarFaturamentoDashboard(id, valorPrincipal, fiscal, naoFiscal, modoFiscalAtivo, mensagemVazia) {
    const el = document.getElementById(id);
    if (!el) return;

    const valor = Number(valorPrincipal || 0);
    if (valor === 0 && mensagemVazia) {
        el.innerHTML = `<span class="dash-card__empty">${escapeHtmlDashboard(mensagemVazia)}</span>`;
        return;
    }

    if (modoFiscalAtivo) {
        el.textContent = formatarMoedaDashboard(valorPrincipal);
        return;
    }

    el.innerHTML = `
        <div>${formatarMoedaDashboard(valorPrincipal)}</div>
        <small class="text-muted d-block" style="font-size:0.78rem">
            Fiscal: ${formatarMoedaDashboard(fiscal)} |
            Não fiscal: ${formatarMoedaDashboard(naoFiscal)}
        </small>
    `;
}

function montarListaEstoqueBaixo(lista) {
    if (!lista || lista.length === 0) {
        return '<div class="text-muted">Nenhum produto com estoque baixo.</div>';
    }

    return lista.map((item) => `
        <div class="d-flex justify-content-between border-bottom py-2">
            <span>${escapeHtmlDashboard(item.nome)}</span>
            <span class="text-danger">
                <strong>${typeof obterEstoqueExibicaoSimplesProduto === 'function'
                    ? obterEstoqueExibicaoSimplesProduto(item)
                    : Number(item.estoque_atual || 0)}</strong>
                <small class="text-muted">/ mín. ${Number(item.estoque_minimo || 0)} ${escapeHtmlDashboard(item.unidade || '')}</small>
            </span>
        </div>
    `).join('');
}

function montarListaFormasPagamento(lista) {
    if (!lista || lista.length === 0) {
        return '<div class="text-muted">Nenhuma venda no período.</div>';
    }

    return lista.map((item) => `
        <div class="d-flex justify-content-between border-bottom py-2">
            <span>${escapeHtmlDashboard(labelFormaPagamentoDashboard(item.forma_pagamento))}</span>
            <span class="text-end">
                <strong>${formatarMoedaDashboard(item.total)}</strong><br>
                <small class="text-muted">${Number(item.quantidade || 0)} venda(s)</small>
            </span>
        </div>
    `).join('');
}

function montarListaValidadeProdutos(lista) {
    if (!Array.isArray(lista) || lista.length === 0) {
        return '<div class="text-muted">Nenhum produto encontrado.</div>';
    }

    return lista.map(item => `
        <div class="d-flex justify-content-between border-bottom py-2">
            <div>
                <strong>${item.produto_nome || item.nome}</strong><br>
                <small>Lote: ${item.lote || '-'} | Estoque: ${item.quantidade_atual ?? 0}</small>
            </div>
            <div class="text-end">
                <strong>${formatarDataBr(item.data_validade || '-')}</strong>
                ${item.dias_para_vencer !== undefined ? `<br><small class="text-muted">${item.dias_para_vencer} dias</small>` : ''}
            </div>
        </div>
    `).join('');
}

function montarListaBackups(lista) {
    if (!lista || lista.length === 0) {
        return '<div class="text-muted">Nenhum backup encontrado.</div>';
    }

    return lista.slice(0,5).map(item => `
        <div class="d-flex justify-content-between border-bottom py-2">
            <div class="text-truncate" style="max-width:70%">${escapeHtmlDashboard(item.arquivo)}</div>
            <div class="text-end"><small class="text-muted">${formatarDataBr(item.modificado_em.slice(0,10))}</small></div>
        </div>
    `).join('');
}

function montarListaAlerts(alerts) {
    if (!alerts) return '<div class="text-muted">Sem alertas no momento.</div>';

    const parts = [];
    if (Number(alerts.delecoes_24h || 0) > 0) {
        parts.push(`<div class="mb-2">Deleções últimas 24h: <strong>${Number(alerts.delecoes_24h)}</strong></div>`);
    }

    if (alerts.usuarios_ativos_ultima_hora && alerts.usuarios_ativos_ultima_hora.length) {
        parts.push('<div class="mb-2"><strong>Usuários com alta atividade (última hora):</strong></div>');
        parts.push('<div>');
        parts.push(alerts.usuarios_ativos_ultima_hora.map(u => `<div class="d-flex justify-content-between py-1"><span>${escapeHtmlDashboard(u.usuario_nome || 'Anônimo')}</span><small>${Number(u.total)}</small></div>`).join(''));
        parts.push('</div>');
    }

    if (alerts.ultimo_backup_horas !== null) {
        parts.push(`<div class="mt-2">Horas desde último backup: <strong>${alerts.ultimo_backup_horas}</strong></div>`);
        if (alerts.backup_atrasado) {
            parts.push('<div class="text-danger">Backup atrasado: último backup tem mais de 24 horas.</div>');
        }
    }

    if (Array.isArray(alerts.persistentes) && alerts.persistentes.length) {
        parts.push('<hr>');
        parts.push('<div class="mb-1"><strong>Alertas persistentes:</strong></div>');
        parts.push(alerts.persistentes.map(a => `
            <div class="d-flex justify-content-between align-items-center py-1">
                <div>
                    <strong>${escapeHtmlDashboard(a.tipo)}</strong>
                    <div class="small text-muted">${escapeHtmlDashboard(a.descricao || '')}</div>
                </div>
                <div class="text-end">
                    <small class="text-muted">${formatarDataBr((a.criado_em||'').slice(0,10))}</small>
                    <div><button class="btn btn-sm btn-outline-success ms-2" data-alert-id="${a.id}" onclick="resolverAlerta(${a.id})">Resolver</button></div>
                </div>
            </div>
        `).join(''));
    }

    if (parts.length === 0) return '<div class="text-muted">Sem alertas no momento.</div>';
    return parts.join('');
}

async function resolverAlerta(id) {
    const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
    try {
        const resp = await fetch(`${apiUrl}/alertas/${id}/resolve`, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
        });
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new Error(body.error || 'Erro ao resolver alerta');
        }
        showNotification('Alerta resolvido', 'success');
        carregarDashboard();
    } catch (e) {
        console.error('Erro resolver alerta:', e);
        showNotification(e.message || 'Erro ao resolver alerta', 'danger');
    }
}

function preencherDashboard(data) {
    const periodo = data.periodo || {};
    const modoFiscalAtivo = Boolean(data.modo_fiscal_ativo);

    const resumoEl = document.getElementById('dashboardResumoExecutivo');
    if (resumoEl) {
        resumoEl.innerHTML = montarResumoExecutivo(data);
    }

    const labelPeriodo = document.getElementById('dashboardPeriodoLabel');
    if (labelPeriodo) {
        const sufixoModo = modoFiscalAtivo ? ' · Somente fiscal (F12)' : ' · Fiscal + Não fiscal + Total';
        labelPeriodo.textContent = `Período: ${formatarDataBr(periodo.inicio)} a ${formatarDataBr(periodo.fim)}${sufixoModo}`;
    }

    aplicarFaturamentoDashboard(
        'dashboardFaturamentoHoje',
        data.faturamento_hoje,
        data.faturamento_hoje_fiscal,
        data.faturamento_hoje_nao_fiscal,
        modoFiscalAtivo,
        'Nenhuma venda realizada hoje.'
    );

    aplicarIndicadorPrincipal(
        'dashboardVendasHoje',
        Number(data.vendas_hoje || 0),
        'Nenhuma venda realizada hoje.'
    );

    const lucroHoje = Number(data.lucro_estimado_hoje || 0);
    if (lucroHoje === 0 && Number(data.vendas_hoje || 0) === 0) {
        aplicarIndicadorPrincipal('dashboardLucroHoje', 0, 'Sem movimentação hoje.');
    } else {
        setDashboardText('dashboardLucroHoje', formatarMoedaDashboard(lucroHoje));
    }

    const ticketHoje = Number(data.ticket_medio_hoje || 0);
    if (ticketHoje === 0 && Number(data.vendas_hoje || 0) === 0) {
        aplicarIndicadorPrincipal('dashboardTicketHoje', 0, 'Sem movimentação hoje.');
    } else {
        setDashboardText('dashboardTicketHoje', formatarMoedaDashboard(ticketHoje));
    }

    const produtosVendidos = Number(data.produtos_vendidos || 0);
    if (produtosVendidos === 0) {
        aplicarIndicadorPrincipal('dashboardProdutos', 0, 'Nenhum produto vendido no período.');
    } else {
        setDashboardText('dashboardProdutos', formatarQuantidadeDashboard(produtosVendidos));
    }

    const receber = data.contas_receber || {};
    const pedidosAbertos = Number(receber.quantidade || 0);
    if (pedidosAbertos === 0) {
        aplicarIndicadorPrincipal('dashboardPedidosAbertos', 0, 'Nenhum pedido em aberto.');
    } else {
        setDashboardText('dashboardPedidosAbertos', pedidosAbertos);
    }

    const mais = document.getElementById('dashboardMaisVendidos');
    const menos = document.getElementById('dashboardMenosVendidos');

    if (mais) {
        mais.innerHTML = montarListaProdutosDashboard(
            data.mais_vendidos || data.produtos_mais_vendidos,
            modoFiscalAtivo,
            'Nenhum produto vendido no período.'
        );
    }
    if (menos) {
        menos.innerHTML = montarListaProdutosDashboard(
            data.menos_vendidos || data.produtos_menos_vendidos,
            modoFiscalAtivo,
            'Ainda não existem dados suficientes para identificar menor giro.'
        );
    }
}

function mostrarErroDashboard(mensagem) {
    const msg = `<div class="dash-empty-state text-danger">${escapeHtmlDashboard(mensagem)}</div>`;
    [
        'dashboardResumoExecutivo',
        'dashboardMaisVendidos',
        'dashboardMenosVendidos',
        'dashboardUltimasVendas'
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = msg;
    });

    destruirGraficoDashboard();
    const empty = document.getElementById('dashboardGraficoEmpty');
    const canvas = document.getElementById('dashboardGraficoEvolucao');
    if (canvas) canvas.classList.add('d-none');
    if (empty) {
        empty.textContent = 'Não foi possível carregar o gráfico de evolução.';
        empty.classList.remove('d-none');
    }
}

function dataHojeDashboard() {
    return new Date().toISOString().slice(0, 10);
}

function dataDiasAtrasDashboard(dias) {
    const data = new Date();
    data.setDate(data.getDate() - Number(dias));
    return data.toISOString().slice(0, 10);
}

function prepararFiltroDashboard() {
    const filtro = document.getElementById('dashboardFiltroRapido');
    const inicio = document.getElementById('dashboardDataInicio');
    const fim = document.getElementById('dashboardDataFim');

    if (!filtro || !inicio || !fim) return;

    const hoje = dataHojeDashboard();

    if (!filtro.value) {
        filtro.value = '7';
    }

    if (filtro.value === 'hoje') {
        inicio.value = hoje;
        fim.value = hoje;
    } else if (filtro.value === '30') {
        inicio.value = dataDiasAtrasDashboard(30);
        fim.value = hoje;
    } else if (filtro.value === '7') {
        inicio.value = dataDiasAtrasDashboard(7);
        fim.value = hoje;
    }

    const personalizado = filtro.value === 'personalizado';

    inicio.disabled = !personalizado;
    fim.disabled = !personalizado;
}

function carregarDashboardComFiltro() {
    prepararFiltroDashboard();

    const inicio = document.getElementById('dashboardDataInicio')?.value || dataDiasAtrasDashboard(7);
    const fim = document.getElementById('dashboardDataFim')?.value || dataHojeDashboard();

    carregarDashboard(inicio, fim);
}

function modoDashboardFiscalAtivo() {
    if (typeof modoFiscalAtivoSistema === 'function') {
        return modoFiscalAtivoSistema();
    }
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1';
}

function alternarModoDashboardFiscal() {
    if (typeof alternarModoFiscalGlobal === 'function') {
        alternarModoFiscalGlobal();
        return;
    }

    const novoValor = modoDashboardFiscalAtivo() ? '0' : '1';
    localStorage.setItem('pdv_modo_fiscal_ativo', novoValor);
    localStorage.setItem('modo_dashboard_fiscal', novoValor);
    carregarDashboardComFiltro();
}

async function carregarModoDashboardFiscalPadrao(apiUrl) {
    if (localStorage.getItem('pdv_modo_fiscal_ativo') !== null) {
        localStorage.setItem(
            'modo_dashboard_fiscal',
            localStorage.getItem('pdv_modo_fiscal_ativo') === '1' ? '1' : '0'
        );
        return;
    }

    if (localStorage.getItem('modo_dashboard_fiscal') !== null) {
        localStorage.setItem(
            'pdv_modo_fiscal_ativo',
            localStorage.getItem('modo_dashboard_fiscal') === '1' ? '1' : '0'
        );
        return;
    }

    try {
        const response = await fetch(`${apiUrl}/configuracoes/modo_dashboard_fiscal`, {
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (response.ok) {
            const data = await response.json();
            const valor = data.valor === '1' ? '1' : '0';
            localStorage.setItem('modo_dashboard_fiscal', valor);
            localStorage.setItem('pdv_modo_fiscal_ativo', valor);
            return;
        }
    } catch (error) {
        console.error('Erro ao carregar modo_dashboard_fiscal:', error);
    }

    localStorage.setItem('modo_dashboard_fiscal', '1');
    localStorage.setItem('pdv_modo_fiscal_ativo', '1');
}

async function carregarDashboard(inicio = null, fim = null) {
    try {
        destruirGraficoDashboard();

        const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '')
            ? API_URL
            : `${window.location.origin}/api`;

        await carregarModoDashboardFiscalPadrao(apiUrl);

        const dataInicio = inicio || dataDiasAtrasDashboard(7);
        const dataFim = fim || dataHojeDashboard();

        const modoFiscalAtivo = modoDashboardFiscalAtivo();

        console.log('Modo dashboard fiscal ativo:', modoFiscalAtivo);

        const response = await fetch(`${apiUrl}/dashboard/resumo?inicio=${dataInicio}&fim=${dataFim}&modo_fiscal=${modoFiscalAtivo ? '1' : '0'}`, {
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao carregar dashboard.');
        }

        preencherDashboard(data);

        carregarGraficoEvolucaoVendas(apiUrl, dataInicio, dataFim, modoFiscalAtivo);
        carregarUltimasVendasDashboard(apiUrl, dataInicio, dataFim, modoFiscalAtivo);

    } catch (error) {
        console.error('Erro dashboard:', error);
        mostrarErroDashboard(error.message || 'Erro ao carregar dashboard.');
    }
}

function initDashboard() {
    const filtro = document.getElementById('dashboardFiltroRapido');

    if (filtro) {
        filtro.addEventListener('change', () => {
            prepararFiltroDashboard();
            if (filtro.value !== 'personalizado') {
                carregarDashboardComFiltro();
            }
        });
    }

    document.removeEventListener('keydown', window._dashboardModoFiscalF12Handler);
    window._dashboardModoFiscalF12Handler = null;

    prepararFiltroDashboard();
    carregarDashboardComFiltro();
}

window.initDashboard = initDashboard;
window.carregarDashboard = carregarDashboard;
window.carregarDashboardComFiltro = carregarDashboardComFiltro;
window.alternarModoDashboardFiscal = alternarModoDashboardFiscal;
