/**
 * HTML + PDF oficiais do comprovante (mesmo snapshot).
 * RC2.0 — Entrega · RC2.1 — Prestação de Contas (layout visual; sem recalcular).
 */

const { formatMoney, formatQty } = require('./TextoCompartilhavelBuilder');
const { TIPOS_COMPROVANTE } = require('../domain/enums');

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function padDots(label, value, width = 42) {
  const l = String(label || '');
  const r = String(value ?? '');
  const dots = Math.max(2, width - l.length - r.length);
  return `${l}${'.'.repeat(dots)}${r}`;
}

/**
 * Linhas do layout impresso (PDF texto) — visual apenas.
 */
function buildLinhasLayoutImpressao(snapshot) {
  const h = snapshot.cabecalho || {};
  const prod = snapshot.cards?.produtos || {};
  const sit = snapshot.cards?.situacaoComercial || {};
  const obs = snapshot.cards?.observacoes || {};
  const numero = h.numeroComprovante || snapshot.numeroComprovante || '—';
  const linhas = [];

  linhas.push('════════════════════════════════════════');
  if (h.empresaNome) {
    linhas.push(String(h.empresaNome).toUpperCase());
  }
  linhas.push('COMPROVANTE DE ENTREGA');
  linhas.push('════════════════════════════════════════');
  linhas.push('');
  linhas.push(`Nº Entrega: ${numero}`);
  linhas.push(`Data: ${h.data || '—'}               Hora: ${h.hora || '—'}`);
  linhas.push('');
  linhas.push(`Cliente : ${h.clienteNome || '—'}`);
  linhas.push(`CPF/CNPJ: ${h.clienteDocumento || '—'}`);
  linhas.push(`Código  : ${h.clienteCodigo || '—'}`);
  linhas.push(`Vendedor: ${h.vendedor || '—'}`);
  linhas.push('');
  linhas.push('════════════════════════════════════════');
  linhas.push('PRODUTOS ENTREGUES');
  linhas.push('════════════════════════════════════════');
  linhas.push('');
  linhas.push('Produto                     Qtd    Unit.    Total');
  linhas.push('----------------------------------------');

  (prod.itens || []).forEach((item) => {
    const nome = String(item.produto || '—').slice(0, 24).padEnd(24);
    const qtd = formatQty(item.quantidade).padStart(6);
    const unit = formatMoney(item.preco).padStart(8);
    const tot = formatMoney(item.total).padStart(8);
    linhas.push(`${nome} ${qtd} ${unit} ${tot}`);
  });

  if (!(prod.itens || []).length) {
    linhas.push('(sem itens)');
  }

  linhas.push('----------------------------------------');
  linhas.push('');
  linhas.push(padDots('Itens', formatQty(prod.quantidadeTotal)));
  linhas.push(padDots('Volumes', formatQty(prod.volumes)));
  linhas.push('');
  linhas.push('════════════════════════════════════════');
  linhas.push('RESUMO FINANCEIRO');
  linhas.push('════════════════════════════════════════');
  linhas.push('');
  linhas.push(padDots('Valor da Remessa', `R$ ${formatMoney(sit.novaRemessa ?? prod.valorComercial)}`));
  linhas.push('');
  linhas.push(padDots('Saldo Anterior', `R$ ${formatMoney(sit.saldoAnterior)}`));
  linhas.push(padDots('Saldo Atual', `R$ ${formatMoney(sit.saldoAtual)}`));
  linhas.push('');
  linhas.push('════════════════════════════════════════');
  linhas.push('OBSERVAÇÕES');
  linhas.push('');
  linhas.push('Declaro ter recebido os produtos acima');
  linhas.push('conferidos e em perfeito estado.');
  if (obs.entrega) {
    linhas.push('');
    linhas.push(String(obs.entrega));
  }
  linhas.push('');
  linhas.push('________________________________________');
  linhas.push('');
  linhas.push('Assinatura do Cliente');
  linhas.push('');
  linhas.push('Data: ____/____/________');
  linhas.push('');
  linhas.push('════════════════════════════════════════');
  linhas.push('Emitido pelo CDS Sistemas');

  return linhas;
}

function buildLinhasLayoutPrestacao(snapshot) {
  const h = snapshot.cabecalho || {};
  const resumo = snapshot.cards?.resumoPrestacao || {};
  const mov = snapshot.cards?.movimentacao || {};
  const formas = snapshot.cards?.formasPagamento || {};
  const obs = snapshot.cards?.observacoes || {};
  const numero = h.numeroComprovante || snapshot.numeroComprovante || '—';
  const linhas = [];

  linhas.push('════════════════════════════════════════');
  if (h.empresaNome) linhas.push(String(h.empresaNome).toUpperCase());
  linhas.push('COMPROVANTE DE PRESTAÇÃO DE CONTAS');
  linhas.push('════════════════════════════════════════');
  linhas.push('');
  linhas.push(`Nº Prestação: ${numero}`);
  linhas.push(`Data: ${h.data || '—'}               Hora: ${h.hora || '—'}`);
  linhas.push('');
  linhas.push(`Cliente : ${h.clienteNome || '—'}`);
  linhas.push(`CPF/CNPJ: ${h.clienteDocumento || '—'}`);
  linhas.push(`Código  : ${h.clienteCodigo || '—'}`);
  linhas.push(`Vendedor: ${h.vendedor || '—'}`);
  linhas.push('');
  linhas.push('════════════════════════════════════════');
  linhas.push('RESUMO DA PRESTAÇÃO');
  linhas.push('════════════════════════════════════════');
  linhas.push('');
  linhas.push(padDots('Valor entregue', formatMoney(resumo.valorEntregue)));
  linhas.push(padDots('Valor devolvido', formatMoney(resumo.valorDevolvido)));
  linhas.push(padDots('Valor vendido', formatMoney(resumo.valorVendido)));
  linhas.push(padDots('Valor recebido', formatMoney(resumo.valorRecebido)));
  linhas.push('');
  linhas.push(padDots('Saldo anterior', formatMoney(resumo.saldoAnterior)));
  linhas.push(padDots('Saldo após prestação', formatMoney(resumo.saldoAposPrestacao)));
  linhas.push('');
  linhas.push('════════════════════════════════════════');
  linhas.push('MOVIMENTAÇÃO DOS PRODUTOS');
  linhas.push('════════════════════════════════════════');
  linhas.push('');
  linhas.push('Produto                     Entregue  Devolvido  Vendido');
  linhas.push('----------------------------------------');
  (mov.itens || []).forEach((item) => {
    const nome = String(item.produto || '—').slice(0, 24).padEnd(24);
    const ent = formatQty(item.entregue).padStart(8);
    const dev = formatQty(item.devolvido).padStart(10);
    const ven = formatQty(item.vendido).padStart(8);
    linhas.push(`${nome} ${ent} ${dev} ${ven}`);
  });
  if (!(mov.itens || []).length) linhas.push('(sem itens)');
  linhas.push('----------------------------------------');
  linhas.push('');
  linhas.push(padDots('Total Entregue', formatQty(mov.totalEntregue)));
  linhas.push(padDots('Total Devolvido', formatQty(mov.totalDevolvido)));
  linhas.push(padDots('Total Vendido', formatQty(mov.totalVendido)));
  linhas.push('');
  linhas.push('════════════════════════════════════════');
  linhas.push('FORMA DE PAGAMENTO');
  linhas.push('════════════════════════════════════════');
  linhas.push('');
  linhas.push(padDots('Dinheiro', formatMoney(formas.dinheiro)));
  linhas.push(padDots('PIX', formatMoney(formas.pix)));
  linhas.push(padDots('Cartão', formatMoney(formas.cartao)));
  linhas.push(padDots('Outros', formatMoney(formas.outros)));
  linhas.push('');
  linhas.push('════════════════════════════════════════');
  linhas.push('OBSERVAÇÕES');
  linhas.push('');
  linhas.push('Declaro estar de acordo com a presente');
  linhas.push('prestação de contas.');
  if (obs.prestacao) {
    linhas.push('');
    linhas.push(String(obs.prestacao));
  }
  linhas.push('');
  linhas.push('________________________________________');
  linhas.push('');
  linhas.push('Assinatura do Cliente');
  linhas.push('');
  linhas.push('Data: ____/____/________');
  linhas.push('');
  linhas.push('════════════════════════════════════════');
  linhas.push('Emitido pelo CDS Sistemas');

  return linhas;
}

function buildHtmlComprovantePrestacao(snapshot) {
  const h = snapshot.cabecalho || {};
  const resumo = snapshot.cards?.resumoPrestacao || {};
  const mov = snapshot.cards?.movimentacao || {};
  const formas = snapshot.cards?.formasPagamento || {};
  const obs = snapshot.cards?.observacoes || {};
  const numero = h.numeroComprovante || snapshot.numeroComprovante || '—';

  const rows = (mov.itens || []).map((item) => `
    <tr>
      <td class="produto">${esc(item.produto)}</td>
      <td class="num">${esc(formatQty(item.entregue))}</td>
      <td class="num">${esc(formatQty(item.devolvido))}</td>
      <td class="num">${esc(formatQty(item.vendido))}</td>
    </tr>`).join('');

  const logo = h.logo
    ? `<img class="logo" src="${esc(h.logo)}" alt="Logo" />`
    : '';

  const obsExtra = obs.prestacao
    ? `<p class="obs-extra">${esc(obs.prestacao)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Comprovante ${esc(numero)}</title>
<style>
  *{box-sizing:border-box}
  body{
    font-family:"Segoe UI",Arial,Helvetica,sans-serif;
    color:#111;margin:0;padding:28px 32px;font-size:13px;line-height:1.45;max-width:720px;
  }
  .rule{border:none;border-top:2px solid #111;margin:16px 0}
  .rule-light{border:none;border-top:1px solid #ccc;margin:10px 0}
  .header{text-align:center}
  .logo{max-height:64px;max-width:200px;margin:0 auto 8px;display:block}
  .empresa{font-size:14px;font-weight:600;margin:0 0 4px;letter-spacing:.02em}
  .titulo{font-size:17px;font-weight:700;margin:8px 0 0;letter-spacing:.05em;text-transform:uppercase}
  .meta-doc{margin:14px 0 4px;font-size:13px}
  .meta-doc .num-entrega{font-size:15px;font-weight:700}
  .meta-row{display:flex;justify-content:space-between;gap:16px;margin-top:4px}
  .cliente{margin:12px 0}
  .cliente-line{display:grid;grid-template-columns:88px 1fr;gap:6px;margin:3px 0}
  .cliente-line .lbl{color:#444;font-weight:600}
  .sec-title{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px}
  table{width:100%;border-collapse:collapse;margin:0}
  thead th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#333;padding:6px 4px;border-bottom:1px solid #111}
  thead th.num,td.num{text-align:right;white-space:nowrap}
  tbody td{padding:7px 4px;border-bottom:1px solid #e5e5e5;vertical-align:top}
  tbody tr:last-child td{border-bottom:1px solid #111}
  td.produto{font-weight:500}
  .totais,.fin-block{margin-top:10px}
  .totais-line,.fin-line{
    display:flex;justify-content:space-between;gap:12px;
    font-variant-numeric:tabular-nums;margin:4px 0;
  }
  .totais-line .val,.fin-line .val{font-weight:600;text-align:right;min-width:100px}
  .obs-box{margin:8px 0 16px}
  .obs-decl{margin:0 0 8px;max-width:420px}
  .obs-extra{margin:8px 0 0;color:#333;font-size:12px}
  .assinatura{margin:28px 0 8px;max-width:360px}
  .assinatura .linha{border:none;border-top:1px solid #111;margin:36px 0 8px;width:100%}
  .assinatura .cap{font-size:12px;color:#333}
  .assinatura .data{margin-top:14px;font-size:12px}
  .footer{text-align:center;margin-top:28px;font-size:11px;color:#555;letter-spacing:.03em}
  @media print{body{padding:12px 16px;max-width:none}}
</style>
</head>
<body>
  <div class="header">
    ${logo}
    ${h.empresaNome ? `<div class="empresa">${esc(h.empresaNome)}</div>` : ''}
    <div class="titulo">Comprovante de Prestação de Contas</div>
  </div>
  <hr class="rule"/>

  <div class="meta-doc">
    <div class="num-entrega">Nº Prestação: ${esc(numero)}</div>
    <div class="meta-row">
      <span>Data: ${esc(h.data || '—')}</span>
      <span>Hora: ${esc(h.hora || '—')}</span>
    </div>
  </div>

  <div class="cliente">
    <div class="cliente-line"><span class="lbl">Cliente</span><span>${esc(h.clienteNome || '—')}</span></div>
    <div class="cliente-line"><span class="lbl">CPF/CNPJ</span><span>${esc(h.clienteDocumento || '—')}</span></div>
    <div class="cliente-line"><span class="lbl">Código</span><span>${esc(h.clienteCodigo || '—')}</span></div>
    <div class="cliente-line"><span class="lbl">Vendedor</span><span>${esc(h.vendedor || '—')}</span></div>
  </div>

  <hr class="rule"/>
  <div class="sec-title">Resumo da Prestação</div>
  <div class="fin-block">
    <div class="fin-line"><span class="lbl">Valor entregue</span><span class="val">${esc(formatMoney(resumo.valorEntregue))}</span></div>
    <div class="fin-line"><span class="lbl">Valor devolvido</span><span class="val">${esc(formatMoney(resumo.valorDevolvido))}</span></div>
    <div class="fin-line"><span class="lbl">Valor vendido</span><span class="val">${esc(formatMoney(resumo.valorVendido))}</span></div>
    <div class="fin-line"><span class="lbl">Valor recebido</span><span class="val">${esc(formatMoney(resumo.valorRecebido))}</span></div>
  </div>
  <div class="fin-block">
    <div class="fin-line"><span class="lbl">Saldo anterior</span><span class="val">${esc(formatMoney(resumo.saldoAnterior))}</span></div>
    <div class="fin-line"><span class="lbl">Saldo após prestação</span><span class="val">${esc(formatMoney(resumo.saldoAposPrestacao))}</span></div>
  </div>

  <hr class="rule"/>
  <div class="sec-title">Movimentação dos Produtos</div>
  <table>
    <thead>
      <tr>
        <th>Produto</th>
        <th class="num">Entregue</th>
        <th class="num">Devolvido</th>
        <th class="num">Vendido</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="4">Sem itens</td></tr>'}
    </tbody>
  </table>
  <div class="totais">
    <div class="totais-line"><span class="lbl">Total Entregue</span><span class="val">${esc(formatQty(mov.totalEntregue))}</span></div>
    <div class="totais-line"><span class="lbl">Total Devolvido</span><span class="val">${esc(formatQty(mov.totalDevolvido))}</span></div>
    <div class="totais-line"><span class="lbl">Total Vendido</span><span class="val">${esc(formatQty(mov.totalVendido))}</span></div>
  </div>

  <hr class="rule"/>
  <div class="sec-title">Forma de Pagamento</div>
  <div class="fin-block">
    <div class="fin-line"><span class="lbl">Dinheiro</span><span class="val">${esc(formatMoney(formas.dinheiro))}</span></div>
    <div class="fin-line"><span class="lbl">PIX</span><span class="val">${esc(formatMoney(formas.pix))}</span></div>
    <div class="fin-line"><span class="lbl">Cartão</span><span class="val">${esc(formatMoney(formas.cartao))}</span></div>
    <div class="fin-line"><span class="lbl">Outros</span><span class="val">${esc(formatMoney(formas.outros))}</span></div>
  </div>

  <hr class="rule"/>
  <div class="sec-title">Observações</div>
  <div class="obs-box">
    <p class="obs-decl">Declaro estar de acordo com a presente prestação de contas.</p>
    ${obsExtra}
  </div>

  <div class="assinatura">
    <hr class="linha"/>
    <div class="cap">Assinatura do Cliente</div>
    <div class="data">Data: ____/____/________</div>
  </div>

  <hr class="rule-light"/>
  <div class="footer">Emitido pelo CDS Sistemas</div>
</body>
</html>`;
}

function buildHtmlComprovante(snapshot) {
  if (String(snapshot?.tipo || '').toUpperCase() === TIPOS_COMPROVANTE.PRESTACAO) {
    return buildHtmlComprovantePrestacao(snapshot);
  }

  const h = snapshot.cabecalho || {};
  const prod = snapshot.cards?.produtos || {};
  const sit = snapshot.cards?.situacaoComercial || {};
  const obs = snapshot.cards?.observacoes || {};
  const numero = h.numeroComprovante || snapshot.numeroComprovante || '—';

  const rows = (prod.itens || []).map((item) => `
    <tr>
      <td class="produto">${esc(item.produto)}</td>
      <td class="num">${esc(formatQty(item.quantidade))}</td>
      <td class="num">${esc(formatMoney(item.preco))}</td>
      <td class="num">${esc(formatMoney(item.total))}</td>
    </tr>`).join('');

  const logo = h.logo
    ? `<img class="logo" src="${esc(h.logo)}" alt="Logo" />`
    : '';

  const obsExtra = obs.entrega
    ? `<p class="obs-extra">${esc(obs.entrega)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Comprovante ${esc(numero)}</title>
<style>
  *{box-sizing:border-box}
  body{
    font-family:"Segoe UI",Arial,Helvetica,sans-serif;
    color:#111;
    margin:0;
    padding:28px 32px;
    font-size:13px;
    line-height:1.45;
    max-width:720px;
  }
  .rule{border:none;border-top:2px solid #111;margin:16px 0}
  .rule-light{border:none;border-top:1px solid #ccc;margin:10px 0}
  .header{text-align:center}
  .logo{max-height:64px;max-width:200px;margin:0 auto 8px;display:block}
  .empresa{font-size:14px;font-weight:600;margin:0 0 4px;letter-spacing:.02em}
  .titulo{
    font-size:18px;font-weight:700;margin:8px 0 0;
    letter-spacing:.06em;text-transform:uppercase;
  }
  .meta-doc{margin:14px 0 4px;font-size:13px}
  .meta-doc .num-entrega{font-size:15px;font-weight:700}
  .meta-row{display:flex;justify-content:space-between;gap:16px;margin-top:4px}
  .cliente{margin:12px 0}
  .cliente-line{display:grid;grid-template-columns:88px 1fr;gap:6px;margin:3px 0}
  .cliente-line .lbl{color:#444;font-weight:600}
  .sec-title{
    font-size:12px;font-weight:700;letter-spacing:.08em;
    text-transform:uppercase;margin:0 0 10px;
  }
  table{width:100%;border-collapse:collapse;margin:0}
  thead th{
    text-align:left;font-size:11px;text-transform:uppercase;
    letter-spacing:.04em;color:#333;padding:6px 4px;
    border-bottom:1px solid #111;
  }
  thead th.num,td.num{text-align:right;white-space:nowrap}
  tbody td{padding:7px 4px;border-bottom:1px solid #e5e5e5;vertical-align:top}
  tbody tr:last-child td{border-bottom:1px solid #111}
  td.produto{font-weight:500}
  .totais{margin-top:10px}
  .totais-line,.fin-line{
    display:flex;justify-content:space-between;gap:12px;
    font-variant-numeric:tabular-nums;margin:4px 0;
  }
  .totais-line .lbl,.fin-line .lbl{color:#333}
  .totais-line .val,.fin-line .val{font-weight:600;text-align:right;min-width:100px}
  .fin-line.destaque .val{font-size:14px}
  .fin-block{margin:6px 0 10px}
  .obs-box{margin:8px 0 16px}
  .obs-decl{margin:0 0 8px;max-width:420px}
  .obs-extra{margin:8px 0 0;color:#333;font-size:12px}
  .assinatura{margin:28px 0 8px;max-width:360px}
  .assinatura .linha{
    border:none;border-top:1px solid #111;margin:36px 0 8px;width:100%;
  }
  .assinatura .cap{font-size:12px;color:#333}
  .assinatura .data{margin-top:14px;font-size:12px}
  .footer{
    text-align:center;margin-top:28px;font-size:11px;color:#555;
    letter-spacing:.03em;
  }
  @media print{
    body{padding:12px 16px;max-width:none}
    .rule{margin:12px 0}
  }
</style>
</head>
<body>
  <div class="header">
    ${logo}
    ${h.empresaNome ? `<div class="empresa">${esc(h.empresaNome)}</div>` : ''}
    <div class="titulo">Comprovante de Entrega</div>
  </div>
  <hr class="rule"/>

  <div class="meta-doc">
    <div class="num-entrega">Nº Entrega: ${esc(numero)}</div>
    <div class="meta-row">
      <span>Data: ${esc(h.data || '—')}</span>
      <span>Hora: ${esc(h.hora || '—')}</span>
    </div>
  </div>

  <div class="cliente">
    <div class="cliente-line"><span class="lbl">Cliente</span><span>${esc(h.clienteNome || '—')}</span></div>
    <div class="cliente-line"><span class="lbl">CPF/CNPJ</span><span>${esc(h.clienteDocumento || '—')}</span></div>
    <div class="cliente-line"><span class="lbl">Código</span><span>${esc(h.clienteCodigo || '—')}</span></div>
    <div class="cliente-line"><span class="lbl">Vendedor</span><span>${esc(h.vendedor || '—')}</span></div>
  </div>

  <hr class="rule"/>
  <div class="sec-title">Produtos Entregues</div>
  <table>
    <thead>
      <tr>
        <th>Produto</th>
        <th class="num">Qtd</th>
        <th class="num">Unit.</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="4">Sem itens</td></tr>'}
    </tbody>
  </table>
  <div class="totais">
    <div class="totais-line"><span class="lbl">Itens</span><span class="val">${esc(formatQty(prod.quantidadeTotal))}</span></div>
    <div class="totais-line"><span class="lbl">Volumes</span><span class="val">${esc(formatQty(prod.volumes))}</span></div>
  </div>

  <hr class="rule"/>
  <div class="sec-title">Resumo Financeiro</div>
  <div class="fin-block">
    <div class="fin-line destaque">
      <span class="lbl">Valor da Remessa</span>
      <span class="val">R$ ${esc(formatMoney(sit.novaRemessa ?? prod.valorComercial))}</span>
    </div>
  </div>
  <div class="fin-block">
    <div class="fin-line"><span class="lbl">Saldo Anterior</span><span class="val">R$ ${esc(formatMoney(sit.saldoAnterior))}</span></div>
    <div class="fin-line"><span class="lbl">Saldo Atual</span><span class="val">R$ ${esc(formatMoney(sit.saldoAtual))}</span></div>
  </div>

  <hr class="rule"/>
  <div class="sec-title">Observações</div>
  <div class="obs-box">
    <p class="obs-decl">Declaro ter recebido os produtos acima conferidos e em perfeito estado.</p>
    ${obsExtra}
  </div>

  <div class="assinatura">
    <hr class="linha"/>
    <div class="cap">Assinatura do Cliente</div>
    <div class="data">Data: ____/____/________</div>
  </div>

  <hr class="rule-light"/>
  <div class="footer">Emitido pelo CDS Sistemas</div>
</body>
</html>`;
}

/**
 * Gera PDF simples (texto) a partir do layout visual RC2.0 — sem recalcular.
 */
function buildPdfBase64FromTexto(textoOuLinhas, titulo = 'Comprovante de Entrega') {
  const lines = Array.isArray(textoOuLinhas)
    ? textoOuLinhas
    : String(textoOuLinhas || '')
      .replace(/\r/g, '')
      .split('\n');

  const safeLines = lines.map((l) => String(l)
    .replace(/[()\\]/g, (c) => `\\${c}`)
    .replace(/\*/g, ''));

  const contentLines = [];
  let y = 800;
  const tituloSafe = String(titulo || '').replace(/[()\\]/g, (c) => `\\${c}`);
  contentLines.push(`BT /F1 12 Tf 50 ${y} Td (${tituloSafe}) Tj ET`);
  y -= 20;
  safeLines.forEach((line) => {
    if (y < 40) return;
    const safe = line.slice(0, 95);
    contentLines.push(`BT /F1 9 Tf 50 ${y} Td (${safe}) Tj ET`);
    y -= 11;
  });

  const stream = contentLines.join('\n');
  const objects = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
  objects.push('3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n');
  objects.push(`4 0 obj<< /Length ${Buffer.byteLength(stream, 'utf8')} >>stream\n${stream}\nendstream\nendobj\n`);
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  });
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return Buffer.from(pdf, 'utf8').toString('base64');
}

function buildPdfPayload(snapshot) {
  const isPrestacao = String(snapshot?.tipo || '').toUpperCase() === TIPOS_COMPROVANTE.PRESTACAO;
  const html = buildHtmlComprovante(snapshot);
  const linhas = isPrestacao
    ? buildLinhasLayoutPrestacao(snapshot)
    : buildLinhasLayoutImpressao(snapshot);
  const titulo = isPrestacao
    ? `Comprovante Prestação ${snapshot.numeroComprovante || ''}`
    : `Comprovante ${snapshot.numeroComprovante || ''}`;
  const base64 = buildPdfBase64FromTexto(linhas, titulo);
  const prefix = isPrestacao ? 'comprovante-prestacao' : 'comprovante-entrega';
  return {
    contentType: 'application/pdf',
    fileName: `${prefix}-${snapshot.numeroComprovante || snapshot.id}.pdf`,
    base64,
    html,
    geradoEm: new Date().toISOString()
  };
}

module.exports = {
  buildHtmlComprovante,
  buildHtmlComprovantePrestacao,
  buildLinhasLayoutImpressao,
  buildLinhasLayoutPrestacao,
  buildPdfBase64FromTexto,
  buildPdfPayload
};
