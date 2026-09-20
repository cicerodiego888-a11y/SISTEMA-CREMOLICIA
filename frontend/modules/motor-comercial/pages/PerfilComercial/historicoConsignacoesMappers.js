/**
 * RCM-8.0 — Consulta/reimpressão de consignação a partir do snapshot gravado.
 * Não consulta Resolver nem Tabela de Preços.
 */

const STATUS_LABEL = {
  RASCUNHO: 'Em preparação',
  ENTREGUE: 'Entregue',
  ACERTADA: 'Acertada',
  QUITADA: 'Quitada',
  ENCERRADA: 'Encerrada',
  CANCELADA: 'Cancelada'
};

function formatDocumentoNumero(consignacao) {
  const doc = consignacao?.documento;
  if (doc && typeof doc === 'object' && doc.numero) return String(doc.numero);
  if (typeof doc === 'string' && doc.trim()) return doc.trim();
  const id = consignacao?.id;
  if (id == null) return '—';
  return String(id).padStart(6, '0');
}

function mapStatusConsulta(consignacao = {}) {
  if (consignacao.statusConsulta?.label) {
    return {
      codigo: consignacao.statusConsulta.codigo || consignacao.status,
      label: consignacao.statusConsulta.label
    };
  }
  if (consignacao.statusLabel) {
    return { codigo: consignacao.status, label: consignacao.statusLabel };
  }
  const status = String(consignacao.status || '').toUpperCase();
  const prestacao = consignacao.prestacaoContasAtiva || {};
  const prestacaoStatus = String(prestacao.status || '').toUpperCase();
  const saldo = Number(consignacao.saldoAberto ?? consignacao.saldo ?? 0);
  const pago = Number(consignacao.valorTotalPago ?? 0);
  const acertado = Number(consignacao.valorTotalAcertado ?? 0);

  if (status === 'CANCELADA') return { codigo: status, label: 'Cancelada' };
  if (status === 'RASCUNHO') return { codigo: status, label: 'Em preparação' };
  if (status === 'QUITADA') return { codigo: status, label: 'Quitada' };
  if (status === 'ENCERRADA' || status === 'FECHADA' || prestacaoStatus === 'FECHADA') {
    return {
      codigo: status === 'ENCERRADA' || status === 'FECHADA' ? status : (status || 'ENCERRADA'),
      label: 'Encerrada'
    };
  }
  if (status === 'ACERTADA') return { codigo: status, label: saldo > 0 ? 'Parcial' : 'Acertada' };
  if ((pago > 0 && saldo > 0) || (acertado > 0 && saldo > 0)) {
    return { codigo: status || 'ENTREGUE', label: 'Parcial' };
  }
  if (STATUS_LABEL[status]) return { codigo: status, label: STATUS_LABEL[status] };
  return { codigo: status || 'DESCONHECIDO', label: status || '—' };
}

function valorTotalSnapshot(consignacao = {}, itens = []) {
  const header = consignacao.valorTotalEntregue ?? consignacao.valorTotal ?? consignacao.valor;
  if (header != null && Number.isFinite(Number(header))) return Number(header);
  return itens.reduce((acc, item) => acc + Number(item.precoTotal ?? item.subtotalEntregue ?? 0), 0);
}

function quantidadeItensSnapshot(consignacao = {}, itens = []) {
  if (consignacao.quantidadeItens != null) return Number(consignacao.quantidadeItens);
  return itens.length;
}

function pertenceAoClienteNaLista(consignacao, clienteId) {
  if (clienteId == null || clienteId === '') return true;
  const atual = consignacao?.clienteId ?? consignacao?.cliente_id;
  if (atual == null || atual === '') return true;
  return Number(atual) === Number(clienteId);
}

function buildHistoricoConsignacoes(consignacoes = [], clienteId = null, opcoes = {}) {
  const filtradas = [...consignacoes].filter((c) => c && pertenceAoClienteNaLista(c, clienteId));
  if (!opcoes.manterOrdem) {
    filtradas.sort((a, b) => new Date(b.updatedAt || b.dataEntrega || b.dataAbertura || 0)
      - new Date(a.updatedAt || a.dataEntrega || a.dataAbertura || 0));
  }
  return filtradas
    .map((c) => {
      const status = mapStatusConsulta(c);
      const itens = c.itens || [];
      return {
        id: c.id,
        clienteId: c.clienteId,
        numero: formatDocumentoNumero(c),
        data: c.dataEntrega || c.dataAbertura || c.createdAt,
        status: status.codigo,
        statusLabel: status.label,
        quantidadeItens: quantidadeItensSnapshot(c, itens),
        valorTotal: valorTotalSnapshot(c, itens),
        atualizadoEm: c.updatedAt || c.dataEntrega || c.dataAbertura,
        cancelada: status.codigo === 'CANCELADA',
        somenteLeitura: true
      };
    });
}

function unidadeItemSnapshot(item = {}) {
  return item.unidadeComercial || item.unidade || 'UN';
}

function buildProdutoConsulta(item = {}) {
  const quantidade = Number(item.quantidadeEntregue ?? item.quantidade ?? 0);
  const precoUnitario = Number(item.precoUnitario ?? item.valorUnitario ?? item.preco ?? 0);
  const total = item.precoTotal != null
    ? Number(item.precoTotal)
    : (item.subtotalEntregue != null ? Number(item.subtotalEntregue) : quantidade * precoUnitario);
  const unidadeComercial = unidadeItemSnapshot(item);
  const unidadeBase = item.unidadeBaseProduto || item.unidade || unidadeComercial;
  return {
    id: item.id,
    produtoId: item.produtoId,
    produto: item.produtoNome || item.produto || '—',
    unidade: unidadeBase,
    unidadeComercial,
    quantidade,
    quantidadeVendida: Number(item.quantidadeVendida ?? 0),
    quantidadeDevolvida: Number(item.quantidadeDevolvida ?? 0),
    quantidadePerdida: Number(item.quantidadePerdida ?? item.quantidadePerda ?? 0),
    quantidadeCortesia: Number(item.quantidadeCortesia ?? 0),
    precoUnitario,
    total,
    status: item.status || null,
    statusLabel: item.statusLabel || item.status || '—',
    linhaComercialId: item.linhaComercialId ?? null,
    tabelaPrecoId: item.tabelaPrecoId ?? null,
    canalVenda: item.canalVenda ? String(item.canalVenda).toUpperCase() : null,
    precoOrigem: item.precoOrigem ?? null,
    precoFallback: !!item.precoFallback
  };
}

function valorMovimentado(itens, campoQtd) {
  return (itens || []).reduce((acc, item) => {
    const qtd = Number(item[campoQtd] ?? 0);
    const preco = Number(item.precoUnitario ?? item.preco ?? 0);
    return acc + (qtd * preco);
  }, 0);
}

function buildResumoOperacao(consignacao = {}, itens = []) {
  return {
    totalEntregue: Number(consignacao.valorTotalEntregue ?? valorTotalSnapshot(consignacao, itens) ?? 0),
    totalVendido: Number(consignacao.valorTotalAcertado ?? 0) || valorMovimentado(itens, 'quantidadeVendida'),
    totalDevolvido: valorMovimentado(itens, 'quantidadeDevolvida'),
    perdas: valorMovimentado(itens, 'quantidadePerdida') || valorMovimentado(itens, 'quantidadePerda'),
    cortesias: valorMovimentado(itens, 'quantidadeCortesia'),
    recebimentos: Number(consignacao.valorTotalPago ?? 0),
    saldo: Number(consignacao.saldoAberto ?? consignacao.saldo ?? 0)
  };
}

function rodapeComprovante(status, statusLabel) {
  const st = String(status || '').toUpperCase();
  const label = String(statusLabel || '').toLowerCase();
  if (st === 'ENCERRADA' || label === 'encerrada') return 'Consignação encerrada.';
  if (st === 'QUITADA' || label === 'quitada') return 'Consignação quitada.';
  if (st === 'CANCELADA' || label === 'cancelada') return 'CONSIGNAÇÃO CANCELADA';
  return 'Documento referente à entrega de consignação.';
}

function buildDetalheConsulta(consignacao = {}, extras = {}) {
  const itensBrutos = extras.itens || consignacao.itens || [];
  const produtos = itensBrutos.map(buildProdutoConsulta);
  const status = mapStatusConsulta(consignacao);
  const canal = consignacao.canalOperacao
    || produtos.find((p) => p.canalVenda)?.canalVenda
    || 'CONSIGNADO';
  const tabelaPrecoId = consignacao.tabelaPrecoId
    ?? produtos.find((p) => p.tabelaPrecoId != null)?.tabelaPrecoId
    ?? null;

  return {
    id: consignacao.id,
    numero: formatDocumentoNumero(consignacao),
    clienteId: consignacao.clienteId,
    clienteNome: extras.clienteNome || consignacao.clienteNome || consignacao.cliente || '—',
    clienteDocumento: extras.clienteDocumento || consignacao.clienteDocumento || null,
    tipoComercial: extras.tipoComercial || null,
    canalOperacao: String(canal).toUpperCase(),
    tabelaPrecoId,
    situacao: status.label,
    dataPreparacao: consignacao.dataAbertura || consignacao.createdAt || null,
    dataEntrega: consignacao.dataEntrega || null,
    dataHora: consignacao.dataEntrega || consignacao.dataAbertura || consignacao.createdAt,
    atualizadoEm: consignacao.updatedAt || consignacao.dataEntrega || consignacao.dataAbertura,
    operador: consignacao.usuarioAberturaId || consignacao.usuario || extras.operador || null,
    status: status.codigo,
    statusLabel: status.label,
    valorTotal: valorTotalSnapshot(consignacao, itensBrutos),
    resumo: buildResumoOperacao(consignacao, produtos),
    produtos,
    cancelada: status.codigo === 'CANCELADA',
    cancelamento: consignacao.cancelamento || null,
    dataEncerramento: consignacao.dataEncerramento || null,
    usuarioEncerramentoId: consignacao.usuarioEncerramentoId || null,
    observacao: consignacao.observacao || null,
    somenteLeitura: true
  };
}

function escapeHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoneyBr(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor) || 0);
}

function formatDateTimeBr(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateBr(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toLocaleDateString('pt-BR');
}

/**
 * Documento de reimpressão — somente dados do snapshot da operação.
 */
function buildComprovanteConsignacaoHtml(detalhe) {
  const linhas = (detalhe.produtos || []).map((p) => `
    <tr>
      <td>${escapeHtml(p.produto)}</td>
      <td>${escapeHtml(p.quantidade)}</td>
      <td>${escapeHtml(p.unidadeComercial || p.unidade)}</td>
      <td>${escapeHtml(formatMoneyBr(p.precoUnitario))}</td>
      <td>${escapeHtml(formatMoneyBr(p.total))}</td>
    </tr>`).join('');

  const documento = detalhe.clienteDocumento
    ? `<p>CPF/CNPJ: ${escapeHtml(detalhe.clienteDocumento)}</p>`
    : '';
  const resumo = detalhe.resumo || buildResumoOperacao(detalhe, detalhe.produtos || []);
  const rodape = rodapeComprovante(detalhe.status, detalhe.statusLabel);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Comprovante de Consignação ${escapeHtml(detalhe.numero)}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 24px; }
    h1 { font-size: 16px; margin: 0 0 4px; letter-spacing: 0.04em; }
    h2 { font-size: 14px; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; }
    th { font-size: 11px; text-transform: uppercase; }
    .total { font-weight: 700; font-size: 14px; }
    .sep { border-top: 1px dashed #999; margin: 12px 0; }
    .muted { color: #444; font-size: 11px; }
    .cancelada { color: #b00020; font-weight: 700; letter-spacing: 0.06em; }
  </style>
</head>
<body>
  <h1>COMPROVANTE DE CONSIGNAÇÃO</h1>
  ${String(detalhe.status || '').toUpperCase() === 'CANCELADA'
    ? '<p class="cancelada">CONSIGNAÇÃO CANCELADA</p>'
    : ''}
  <h2>CONSIGNAÇÃO Nº ${escapeHtml(detalhe.numero)}</h2>
  <p>Cliente: ${escapeHtml(detalhe.clienteNome)}</p>
  ${documento}
  <p>Data: ${escapeHtml(formatDateTimeBr(detalhe.dataHora))}</p>
  <p>Status: ${escapeHtml(String(detalhe.statusLabel || detalhe.status || '').toUpperCase())}</p>
  <div class="sep"></div>
  <table>
    <thead>
      <tr>
        <th>Produto</th>
        <th>Qtd</th>
        <th>Unidade</th>
        <th>Preço</th>
        <th>Valor</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>
  <div class="sep"></div>
  <p>Total entregue: ${escapeHtml(formatMoneyBr(resumo.totalEntregue))}</p>
  <p>Total vendido: ${escapeHtml(formatMoneyBr(resumo.totalVendido))}</p>
  <p>Total devolvido: ${escapeHtml(formatMoneyBr(resumo.totalDevolvido))}</p>
  <p>Perdas: ${escapeHtml(formatMoneyBr(resumo.perdas))}</p>
  <p>Cortesias: ${escapeHtml(formatMoneyBr(resumo.cortesias))}</p>
  <p>Recebimentos: ${escapeHtml(formatMoneyBr(resumo.recebimentos))}</p>
  <p class="total">Saldo: ${escapeHtml(formatMoneyBr(resumo.saldo))}</p>
  <p>Canal: ${escapeHtml(detalhe.canalOperacao || 'CONSIGNADO')}</p>
  <p class="muted">${escapeHtml(rodape)}</p>
</body>
</html>`;
}

function reimpressaoSomenteLeitura() {
  return {
    criaNovaOperacao: false,
    alteraEstoque: false,
    alteraPreco: false,
    alteraLedger: false,
    alteraStatus: false,
    consultaTabela: false,
    consultaResolver: false
  };
}

module.exports = {
  formatDocumentoNumero,
  mapStatusConsulta,
  pertenceAoClienteNaLista,
  buildHistoricoConsignacoes,
  buildProdutoConsulta,
  buildDetalheConsulta,
  buildComprovanteConsignacaoHtml,
  buildResumoOperacao,
  reimpressaoSomenteLeitura,
  formatMoneyBr,
  formatDateTimeBr,
  formatDateBr,
  HISTORICO_PAGE_SIZE: 20,
  STATUS_CONSIGNACAO_OPERACIONAL: 'RASCUNHO,VALIDADA,ENTREGUE,EM_PRESTACAO,ACERTADA'
};
