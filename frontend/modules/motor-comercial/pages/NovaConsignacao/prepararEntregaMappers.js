/**
 * Mapeadores do fluxo Preparar Entrega — Sprint UX-04.
 *
 * @module frontend/modules/motor-comercial/pages/NovaConsignacao/prepararEntregaMappers
 */

const FLUXO_MOMENTOS = [
  { key: 'cliente', label: 'Cliente' },
  { key: 'produtos', label: 'Produtos' },
  { key: 'conferencia', label: 'Conferência' },
  { key: 'conclusao', label: 'Conclusão' }
];

function calcularTotaisItens(itens = []) {
  const quantidadeTotal = itens.reduce((sum, item) => sum + Number(item.quantidade || 0), 0);
  const valorTotal = itens.reduce((sum, item) => sum + (Number(item.quantidade || 0) * Number(item.preco || 0)), 0);
  return {
    quantidadeItens: itens.length,
    quantidadeTotal,
    valorTotal
  };
}

const FAIXA_UTILIZACAO = Object.freeze({
  verde: { emoji: '🟢', label: 'Seguro' },
  amarelo: { emoji: '🟡', label: 'Atenção' },
  laranja: { emoji: '🟠', label: 'Próximo do limite' },
  vermelho: { emoji: '🔴', label: 'Limite excedido' },
  neutro: { emoji: '⚪', label: 'Sem limite' }
});

function calcularUtilizacaoLimite(valorTotal, creditoDisponivelApi) {
  const creditoAtual = Number(creditoDisponivelApi);
  const valor = Number(valorTotal) || 0;

  if (!(creditoAtual > 0) && creditoDisponivelApi == null) {
    return {
      percentual: null,
      percentualExibicao: '—',
      percentualUtilizadoTexto: '—',
      faixa: 'neutro',
      faixaInfo: FAIXA_UTILIZACAO.neutro,
      creditoAposEntrega: null,
      valorExcedido: 0,
      excedeLimite: false
    };
  }

  const base = Number.isFinite(creditoAtual) ? creditoAtual : 0;
  if (base <= 0 && valor <= 0) {
    return {
      percentual: null,
      percentualExibicao: '—',
      percentualUtilizadoTexto: '—',
      faixa: 'neutro',
      faixaInfo: FAIXA_UTILIZACAO.neutro,
      creditoAposEntrega: 0,
      valorExcedido: 0,
      excedeLimite: false
    };
  }

  const percentual = base > 0 ? (valor / base) * 100 : (valor > 0 ? 100 : 0);
  const excedeLimite = valor > base;
  // Projeção UX (não é SSOT): crédito após esta entrega = API − valor
  const creditoAposEntrega = excedeLimite ? 0 : Math.max(0, base - valor);
  const valorExcedido = excedeLimite ? valor - base : 0;

  let faixa = 'verde';
  if (percentual > 100) faixa = 'vermelho';
  else if (percentual > 90) faixa = 'laranja';
  else if (percentual > 70) faixa = 'amarelo';

  const pctFmt = `${percentual.toFixed(1).replace('.', ',')}%`;

  return {
    percentual,
    percentualExibicao: pctFmt,
    percentualUtilizadoTexto: `${Math.round(percentual)}% utilizado`,
    faixa,
    faixaInfo: FAIXA_UTILIZACAO[faixa],
    creditoAposEntrega,
    valorExcedido,
    excedeLimite
  };
}

function calcularDestaqueSaldoRestante(saldoRestante, limiteDisponivel) {
  const limite = Number(limiteDisponivel) || 0;
  const saldo = Number(saldoRestante);
  if (limite <= 0 || Number.isNaN(saldo)) return 'neutro';
  const pct = (saldo / limite) * 100;
  if (pct < 10) return 'critico';
  if (pct < 20) return 'alerta';
  return 'normal';
}

function buildMensagemInteligente(painel = {}) {
  const limite = Number(painel.limiteDisponivel ?? painel.creditoDisponivel ?? 0);
  const saldoRestante = painel.creditoAposEntrega ?? painel.saldoRestante;

  if (limite <= 0) {
    return {
      texto: 'Limite comercial não informado para este cliente.',
      nivel: 'info'
    };
  }

  if (painel.excedeLimite) {
    return {
      texto: `Esta entrega ultrapassa o limite em ${formatCurrency(painel.valorExcedido)}.`,
      nivel: 'danger'
    };
  }

  if (Number(painel.valorTotal) > 0 && saldoRestante > 0 && saldoRestante < limite * 0.2) {
    return {
      texto: `Após esta entrega restarão apenas ${formatCurrency(saldoRestante)} de crédito.`,
      nivel: 'warning'
    };
  }

  if (painel.faixaUtilizacao === 'laranja' || painel.faixaUtilizacao === 'amarelo') {
    return {
      texto: 'Cliente está próximo do limite comercial.',
      nivel: 'warning'
    };
  }

  if (Number(painel.valorTotal) <= 0) {
    return {
      texto: 'Adicione produtos para simular o impacto financeiro da entrega.',
      nivel: 'info'
    };
  }

  return {
    texto: 'Cliente possui crédito suficiente para esta entrega.',
    nivel: 'success'
  };
}

function buildPainelResumo(itens = [], clienteProfile = {}, painelBase = null) {
  const profile = clienteProfile && typeof clienteProfile === 'object' ? clienteProfile : {};
  const { quantidadeItens, quantidadeTotal, valorTotal } = calcularTotaisItens(itens);
  const limiteComercial = Number(profile.limiteComercial ?? 0);
  // SSOT da API — nunca recalcular
  const creditoDisponivel = Number(
    profile.creditoDisponivel ?? profile.limiteDisponivel ?? 0
  );
  const limiteDisponivel = creditoDisponivel;
  const saldoAtual = Number(
    profile.saldoDevedor ?? profile.saldo ?? 0
  );
  const utilizacao = calcularUtilizacaoLimite(valorTotal, creditoDisponivel);
  const creditoAposEntrega = utilizacao.creditoAposEntrega;
  const valorMedioItem = quantidadeItens > 0 ? valorTotal / quantidadeItens : 0;
  const mensagem = buildMensagemInteligente({
    limiteDisponivel,
    creditoDisponivel,
    valorTotal,
    excedeLimite: utilizacao.excedeLimite,
    valorExcedido: utilizacao.valorExcedido,
    faixaUtilizacao: utilizacao.faixa,
    creditoAposEntrega,
    saldoRestante: creditoAposEntrega
  });

  return {
    ...(painelBase || {}),
    clienteNome: profile.nome || '—',
    quantidadeItens,
    quantidadeTotal,
    valorTotal,
    valorMedioItem,
    valorMedioItemExibicao: quantidadeItens > 0 ? formatCurrency(valorMedioItem) : '—',
    limiteComercial,
    limiteDisponivel,
    creditoDisponivel,
    creditoDisponivelExibicao: formatCurrency(creditoDisponivel),
    saldoAtual,
    saldoDevedor: saldoAtual,
    saldoCredor: Number(profile.saldoCredor ?? 0),
    saldoAposEntrega: saldoAtual + valorTotal,
    creditoAposEntrega,
    creditoAposEntregaExibicao: creditoAposEntrega != null
      ? formatCurrency(creditoAposEntrega)
      : '—',
    saldoRestante: creditoAposEntrega,
    saldoRestanteExibicao: creditoAposEntrega != null ? formatCurrency(creditoAposEntrega) : '—',
    destaqueSaldoRestante: calcularDestaqueSaldoRestante(creditoAposEntrega, creditoDisponivel),
    limiteRestante: creditoAposEntrega,
    percentualLimite: utilizacao.percentual,
    percentualLimiteExibicao: utilizacao.percentualExibicao,
    percentualUtilizadoTexto: utilizacao.percentualUtilizadoTexto,
    faixaUtilizacao: utilizacao.faixa,
    faixaInfo: utilizacao.faixaInfo,
    valorExcedido: utilizacao.valorExcedido,
    excedeLimite: utilizacao.excedeLimite,
    mensagemInteligente: mensagem.texto,
    mensagemNivel: mensagem.nivel
  };
}

function simularInclusaoProduto(itens = [], clienteProfile = {}, produto = {}, quantidade = 1) {
  const qtd = Math.max(1, Number(quantidade) || 1);
  // Preço já resolvido pela API / resolverPrecosVenda (RCM-04.6) — sem leitura direta de legado
  const preco = Number(
    produto.preco ?? produto.precoVenda ?? produto.preco_unitario ?? 0
  );
  const valorInclusao = qtd * preco;
  const painelAtual = buildPainelResumo(itens, clienteProfile);

  const itensSimulados = itens.map((item) => ({ ...item }));
  const existente = itensSimulados.find((item) => Number(item.produtoId) === Number(produto.id));
  if (existente) {
    existente.quantidade = Number(existente.quantidade || 0) + qtd;
  } else {
    itensSimulados.push({
      produtoId: produto.id,
      produto: produto.nome || produto.descricao || `Produto #${produto.id}`,
      codigo: produto.codigo || produto.codigo_barras || '',
      quantidade: qtd,
      preco
    });
  }

  const painelProjetado = buildPainelResumo(itensSimulados, clienteProfile);
  const inclusaoUltrapassaLimite = Boolean(
    painelProjetado.excedeLimite && !painelAtual.excedeLimite
  );

  return {
    produto: produto.nome || produto.descricao || '—',
    quantidade: qtd,
    valorInclusao,
    valorInclusaoExibicao: formatCurrency(valorInclusao),
    painelAtual,
    painelProjetado,
    inclusaoUltrapassaLimite
  };
}

function buildValidacoesConferencia(data = {}, clienteProfile = {}, options = {}) {
  const avisos = [];
  const { valorTotal } = calcularTotaisItens(data.itens || []);
  const limiteDisponivel = Number(clienteProfile?.limiteDisponivel ?? 0);
  const liberacaoOk = options.liberacaoLimiteAutorizada === true;

  if (!clienteProfile) {
    avisos.push({ message: 'Cliente não selecionado', nivel: 'danger' });
  }

  if (!data.itens?.length) {
    avisos.push({ message: 'Nenhum produto adicionado', nivel: 'danger' });
  }

  if (limiteDisponivel > 0 && valorTotal > limiteDisponivel) {
    if (liberacaoOk) {
      avisos.push({
        message: `Limite excedido — liberação gerencial autorizada para esta operação (${formatCurrency(valorTotal - limiteDisponivel)} acima)`,
        nivel: 'warning'
      });
    } else {
      avisos.push({
        message: `Valor da entrega (${formatCurrency(valorTotal)}) excede o limite disponível (${formatCurrency(limiteDisponivel)}). Solicite liberação gerencial.`,
        nivel: 'danger'
      });
    }
  } else if (limiteDisponivel > 0 && valorTotal > limiteDisponivel * 0.85) {
    avisos.push({
      message: 'Valor próximo ao limite comercial disponível',
      nivel: 'warning'
    });
  }

  if (clienteProfile?.situacao === 'BLOQUEADO') {
    avisos.push({ message: 'Cliente com situação bloqueada — verifique antes de concluir', nivel: 'warning' });
  }

  return avisos;
}

function formatOrigemPreco(origem, fallback = false) {
  if (fallback) return 'Preço de Segurança';
  const o = String(origem || '').toLowerCase();
  if (!o) return '—';
  if (o.includes('seguranca') || o.includes('segurança') || o.includes('fallback') || o.includes('safety')) {
    return 'Preço de Segurança';
  }
  if (o.includes('tabela')) return 'Tabela';
  if (o.includes('linha')) return 'Linha de Precificação';
  if (o.includes('produto')) return 'Produto';
  return String(origem);
}

function rotuloLinhaItem(item = {}) {
  return item.linhaComercialDescricao
    || item.linhaComercialCodigo
    || (item.linhaComercialId != null ? `#${item.linhaComercialId}` : '—');
}

function rotuloTabelaItem(item = {}, fallbackTabela = null) {
  return item.tabelaPrecoNome
    || fallbackTabela
    || (item.tabelaPrecoId != null ? `#${item.tabelaPrecoId}` : '—');
}

function buildClienteResumo(clienteProfile = {}) {
  const profile = clienteProfile && typeof clienteProfile === 'object' ? clienteProfile : {};
  return [
    { label: 'Cliente', value: profile.nome || '—' },
    { label: 'Telefone', value: profile.telefone || '—' },
    { label: 'Cidade', value: profile.cidade || '—' },
    {
      label: 'Tipo Comercial',
      value: profile.tipoComercialDescricao || profile.tipoComercialCodigo || '—'
    },
    {
      label: 'Capacidades',
      value: (profile.capacidades || []).join(', ') || '—'
    }
  ];
}

function buildConferenciaResumo(data = {}, clienteProfile = {}, painel = {}) {
  return [
    { label: 'Cliente', value: clienteProfile?.nome || '—' },
    { label: 'Documento', value: data.documentoNumero || data.documentoPreview || '—' },
    { label: 'Itens', value: String(painel.quantidadeItens || 0) },
    { label: 'Quantidade Total', value: String(painel.quantidadeTotal || 0) },
    { label: 'Valor desta Entrega', value: formatCurrency(painel.valorTotal), highlight: true }
  ];
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value) || 0);
}

function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('pt-BR');
}

function inicializarSteps(skipCliente = false) {
  return FLUXO_MOMENTOS.map((momento, index) => {
    if (skipCliente && index === 0) return { ...momento, state: 'completed' };
    if (skipCliente && index === 1) return { ...momento, state: 'current' };
    if (index === 0 && !skipCliente) return { ...momento, state: 'current' };
    return { ...momento, state: 'pending' };
  });
}

function stepIndexFromKey(key) {
  return FLUXO_MOMENTOS.findIndex((m) => m.key === key);
}

module.exports = {
  FLUXO_MOMENTOS,
  FAIXA_UTILIZACAO,
  calcularTotaisItens,
  calcularUtilizacaoLimite,
  calcularDestaqueSaldoRestante,
  buildMensagemInteligente,
  buildPainelResumo,
  simularInclusaoProduto,
  buildValidacoesConferencia,
  buildClienteResumo,
  buildConferenciaResumo,
  formatCurrency,
  formatDate,
  formatOrigemPreco,
  rotuloLinhaItem,
  rotuloTabelaItem,
  inicializarSteps,
  stepIndexFromKey
};
