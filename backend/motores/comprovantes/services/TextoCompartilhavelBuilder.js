/**
 * Monta textoCompartilhavel oficial a partir do snapshot (única fonte).
 */

function formatMoney(v) {
  const n = Number(v);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(3)));
}

function buildTextoCompartilhavel(snapshot) {
  const h = snapshot.cabecalho || {};
  const prod = snapshot.cards?.produtos || {};
  const sit = snapshot.cards?.situacaoComercial || {};
  const hist = snapshot.cards?.historico || {};
  const obs = snapshot.cards?.observacoes || {};
  const ind = snapshot.indicadores || {};

  const linhas = [];
  linhas.push(`*COMPROVANTE DE ENTREGA*`);
  linhas.push(`${h.empresaNome || 'Empresa'}`);
  linhas.push(`Nº ${h.numeroComprovante || snapshot.numeroComprovante || '—'}`);
  linhas.push(`${h.data || ''} ${h.hora || ''}`.trim());
  linhas.push('');
  linhas.push(`*Cliente:* ${h.clienteNome || '—'}`);
  if (h.clienteDocumento) linhas.push(`Doc: ${h.clienteDocumento}`);
  if (h.clienteCodigo) linhas.push(`Código: ${h.clienteCodigo}`);
  if (h.vendedor) linhas.push(`Vendedor: ${h.vendedor}`);
  if (h.rota) linhas.push(`Rota: ${h.rota}`);
  if (h.veiculo) linhas.push(`Veículo: ${h.veiculo}`);
  linhas.push('');
  linhas.push(`*PRODUTOS*`);
  (prod.itens || []).forEach((item) => {
    linhas.push(
      `• ${item.produto} — ${formatQty(item.quantidade)} ${item.unidade || 'UN'} × ${formatMoney(item.preco)} = ${formatMoney(item.total)}`
    );
  });
  linhas.push(`Qtd total: ${formatQty(prod.quantidadeTotal)}`);
  linhas.push(`Volumes: ${formatQty(prod.volumes)}`);
  linhas.push(`Valor comercial: ${formatMoney(prod.valorComercial)}`);
  linhas.push('');
  linhas.push(`*SITUAÇÃO COMERCIAL*`);
  linhas.push(`Saldo anterior: ${formatMoney(sit.saldoAnterior)}`);
  linhas.push(`Nova remessa: ${formatMoney(sit.novaRemessa)}`);
  linhas.push(`Saldo atual: ${formatMoney(sit.saldoAtual)}`);
  linhas.push(`Limite: ${formatMoney(sit.limite)}`);
  linhas.push(`Crédito disponível: ${formatMoney(sit.creditoDisponivel)}`);
  linhas.push(`Consignações abertas: ${sit.consignacoesAbertas ?? 0}`);
  linhas.push(`Valor em aberto: ${formatMoney(sit.valorEmAberto)}`);
  linhas.push(`Status: ${sit.statusComercial || ind.statusCredito || '—'}`);
  linhas.push('');
  if (hist && (hist.ultimaEntrega || hist.ultimaPrestacao || hist.maiorRemessa != null)) {
    linhas.push(`*HISTÓRICO*`);
    if (hist.ultimaEntrega) linhas.push(`Última entrega: ${hist.ultimaEntrega}`);
    if (hist.ultimaPrestacao) linhas.push(`Última prestação: ${hist.ultimaPrestacao}`);
    if (hist.maiorRemessa != null) linhas.push(`Maior remessa: ${formatMoney(hist.maiorRemessa)}`);
    if (hist.mediaRemessas != null) linhas.push(`Média remessas: ${formatMoney(hist.mediaRemessas)}`);
    if (hist.perdasEmpresa != null || hist.perdasCliente != null) {
      linhas.push(`Perdas empresa: ${formatMoney(hist.perdasEmpresa)}`);
      linhas.push(`Perdas cliente: ${formatMoney(hist.perdasCliente)}`);
    }
    if (hist.indicePerdas != null) linhas.push(`Índice de perdas: ${hist.indicePerdas}%`);
    linhas.push('');
  }
  if (obs.entrega || obs.vendedor || obs.internas) {
    linhas.push(`*OBSERVAÇÕES*`);
    if (obs.entrega) linhas.push(obs.entrega);
    if (obs.vendedor) linhas.push(`Vendedor: ${obs.vendedor}`);
    if (obs.internas) linhas.push(`Internas: ${obs.internas}`);
    linhas.push('');
  }
  linhas.push(`ID: ${snapshot.id}`);
  linhas.push(`Hash: ${snapshot.qrCode?.hash || snapshot.assinaturaHash || '—'}`);
  linhas.push(`Gerado por CDS Motor de Comprovantes v${snapshot.versao || '1'}`);

  return linhas.join('\n');
}

function buildTextoCompartilhavelPrestacao(snapshot) {
  const h = snapshot.cabecalho || {};
  const resumo = snapshot.cards?.resumoPrestacao || {};
  const mov = snapshot.cards?.movimentacao || {};
  const formas = snapshot.cards?.formasPagamento || {};

  const linhas = [];
  linhas.push('*COMPROVANTE DE PRESTAÇÃO DE CONTAS*');
  linhas.push(`${h.empresaNome || 'Empresa'}`);
  linhas.push(`Nº ${h.numeroComprovante || snapshot.numeroComprovante || '—'}`);
  linhas.push(`${h.data || ''} ${h.hora || ''}`.trim());
  linhas.push('');
  linhas.push(`*Cliente:* ${h.clienteNome || '—'}`);
  if (h.clienteDocumento) linhas.push(`Doc: ${h.clienteDocumento}`);
  if (h.clienteCodigo) linhas.push(`Código: ${h.clienteCodigo}`);
  if (h.vendedor) linhas.push(`Vendedor: ${h.vendedor}`);
  linhas.push('');
  linhas.push('*RESUMO DA PRESTAÇÃO*');
  linhas.push(`Valor entregue: ${formatMoney(resumo.valorEntregue)}`);
  linhas.push(`Valor devolvido: ${formatMoney(resumo.valorDevolvido)}`);
  linhas.push(`Valor vendido: ${formatMoney(resumo.valorVendido)}`);
  linhas.push(`Valor recebido: ${formatMoney(resumo.valorRecebido)}`);
  linhas.push(`Saldo anterior: ${formatMoney(resumo.saldoAnterior)}`);
  linhas.push(`Saldo após prestação: ${formatMoney(resumo.saldoAposPrestacao)}`);
  linhas.push('');
  linhas.push('*MOVIMENTAÇÃO*');
  (mov.itens || []).forEach((item) => {
    linhas.push(
      `• ${item.produto} — Ent ${formatQty(item.entregue)} / Dev ${formatQty(item.devolvido)} / Vend ${formatQty(item.vendido)}`
    );
  });
  linhas.push(`Total entregue: ${formatQty(mov.totalEntregue)}`);
  linhas.push(`Total devolvido: ${formatQty(mov.totalDevolvido)}`);
  linhas.push(`Total vendido: ${formatQty(mov.totalVendido)}`);
  linhas.push('');
  linhas.push('*FORMA DE PAGAMENTO*');
  linhas.push(`Dinheiro: ${formatMoney(formas.dinheiro)}`);
  linhas.push(`PIX: ${formatMoney(formas.pix)}`);
  linhas.push(`Cartão: ${formatMoney(formas.cartao)}`);
  linhas.push(`Outros: ${formatMoney(formas.outros)}`);
  linhas.push('');
  linhas.push('Emitido pelo CDS Sistemas');

  return linhas.join('\n');
}

module.exports = {
  buildTextoCompartilhavel,
  buildTextoCompartilhavelPrestacao,
  formatMoney,
  formatQty
};
