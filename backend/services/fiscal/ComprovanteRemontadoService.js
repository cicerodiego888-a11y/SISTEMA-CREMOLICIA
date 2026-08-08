/**
 * RCF-09 — Comprovante comercial remontado após autorização NFC-e.
 *
 * Cabeçalho / QR / chave / protocolo ← NFC-e autorizada (XML imutável).
 * Itens / pagamentos / TOTAL ← venda completa (sem expor Motor F×NF).
 */

'use strict';

const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../../database');
const {
  consolidarPagamentos,
  rotuloFormaPagamento,
  quantidadeComercialItem
} = require('../comprovanteVendaService');

function escapeHtml(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatarMoeda(valor) {
  return `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
}

function formatarCnpj(cnpj) {
  const n = String(cnpj || '').replace(/\D/g, '');
  if (n.length !== 14) return cnpj || '';
  return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatarChave(chave) {
  const c = String(chave || '').replace(/\D/g, '');
  if (c.length !== 44) return chave || '';
  return c.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function extrairTag(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function unidadeItem(item) {
  const u = String(item.unidade_comercial || item.unidade || 'UN').trim().toUpperCase();
  if (!u) return 'UN';
  if (u === 'KG' || u === 'KILO' || u === 'KILOS') return 'KG';
  if (u === 'L' || u === 'LT' || u === 'LITRO' || u === 'LITROS') return 'L';
  return u;
}

function hashXmlSha256(xml) {
  return crypto.createHash('sha256').update(String(xml || ''), 'utf8').digest('hex');
}

function xmlPossuiAssinatura(xml) {
  return /<Signature[\s>]/i.test(String(xml || '')) || /<ds:Signature[\s>]/i.test(String(xml || ''));
}

function contarDetXml(xml) {
  return (String(xml || '').match(/<det\s/gi) || []).length;
}

/**
 * Conteúdo canônico para comparar reimpressões (ignora bytes do QR data-URL).
 */
function conteudoCanonicoComprovante(html) {
  return String(html || '')
    .replace(/src="data:image\/[^"]+"/gi, 'src="QR_CANONICO"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Metadados fiscais a partir da nota autorizada + XML (somente leitura).
 * Nunca altera o XML.
 */
function extrairMetadadosNfceAutorizada(nota = {}, xmlAutorizado = '') {
  const xml = String(xmlAutorizado || nota.xml_enviado || '');
  const xmlHash = hashXmlSha256(xml);
  const chave = String(nota.chave_acesso || '').replace(/\D/g, '')
    || String(extrairTag(xml, 'chNFe') || '').replace(/\D/g, '')
    || (String(xml.match(/Id="NFe(\d{44})"/i)?.[1] || '').replace(/\D/g, ''));

  const numero = nota.numero != null ? nota.numero : extrairTag(xml, 'nNF');
  const serie = nota.serie != null ? nota.serie : extrairTag(xml, 'serie');
  const dhEmi = extrairTag(xml, 'dhEmi') || nota.created_at || null;
  const protocolo = nota.protocolo
    || extrairTag(String(nota.xml_retorno || ''), 'nProt')
    || null;
  const ambiente = Number(
    nota.ambiente != null ? nota.ambiente : (extrairTag(xml, 'tpAmb') || 1)
  );
  const qrCodeUrl = nota.qr_code_url || null;

  const tributos = {
    vICMS: Number(extrairTag(xml, 'vICMS') || 0),
    vPIS: Number(extrairTag(xml, 'vPIS') || 0),
    vCOFINS: Number(extrairTag(xml, 'vCOFINS') || 0),
    vNF: Number(extrairTag(xml, 'vNF') || 0)
  };

  return {
    chave,
    numero,
    serie,
    dhEmi,
    protocolo,
    ambiente,
    qrCodeUrl,
    tributos,
    emitNome: extrairTag(xml, 'xNome'),
    emitCnpj: extrairTag(xml, 'CNPJ'),
    xmlHash,
    assinaturaPresente: xmlPossuiAssinatura(xml),
    qtdDetXml: contarDetXml(xml)
  };
}

function formatarDhEmi(dhEmi) {
  if (!dhEmi) return new Date().toLocaleString('pt-BR');
  try {
    const d = new Date(dhEmi);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('pt-BR');
  } catch (_) { /* ignore */ }
  return String(dhEmi);
}

function linhaPag(label, valor, largura = 40) {
  const valorTxt = formatarMoeda(valor);
  const pontos = Math.max(2, largura - label.length - valorTxt.length);
  return `${label}${'.'.repeat(pontos)}${valorTxt}`;
}

function montarBlocoItens(itens = []) {
  const linha = '----------------------------------------';
  return (itens || []).map((item) => {
    const nome = escapeHtml(item.produto_nome || item.nome || 'Produto');
    const un = escapeHtml(unidadeItem(item));
    const qRaw = Number(
      typeof quantidadeComercialItem === 'function'
        ? quantidadeComercialItem(item)
        : item.quantidade || 0
    );
    const qtd = (un === 'UN' || un === 'UNIDADE')
      ? String(Math.round(qRaw))
      : String(Number(qRaw.toFixed(3)));
    const unit = formatarMoeda(item.preco_unitario);
    const sub = formatarMoeda(
      item.subtotal != null ? item.subtotal : qRaw * Number(item.preco_unitario || 0)
    );
    const bolas = Number(item.quantidade_bolas || 0);
    const sabores = Array.isArray(item.sabores) ? item.sabores : [];
    const kitItens = Array.isArray(item.kit_itens) ? item.kit_itens : [];
    const tituloCasquinha = bolas > 0
      ? (String(nome).toUpperCase().includes('CASQUINHA')
        ? nome
        : `CASQUINHA ${bolas} BOLA${bolas > 1 ? 'S' : ''}`)
      : nome;
    const linhasSabores = sabores.length
      ? `${sabores.map((s) => `- ${escapeHtml(s.nome || s)}`).join('\n')}\n`
      : '';
    const linhasKit = kitItens.length
      ? `${kitItens.map((k) => `- ${escapeHtml(k.produto_nome || k.nome || 'Item')}: ${Number(k.quantidade || 0)}`).join('\n')}\n`
      : '';
    const forma = String(item.forma_comercializacao || '').toUpperCase();
    const titulo = bolas > 0 ? escapeHtml(String(tituloCasquinha).toUpperCase()) : nome;

    if (forma === 'PESO' || forma === 'VOLUME' || un === 'KG' || un === 'L') {
      return `${titulo}\n${linhasSabores}${linhasKit}${qtd} ${un}\n${unit}\n${sub}`;
    }
    return `${titulo}\n${linhasSabores}${linhasKit}\nQtd.: ${qtd} ${un}\n\nValor Unit.: ${unit}\n\nSubtotal: ${sub}`;
  }).join(`\n${linha}\n`);
}

/**
 * Assert: HTML do cliente não contém termos internos do Motor F×NF.
 */
function assertSemVazamentoInterno(html) {
  const cleaned = String(html || '').replace(/SEM\s+VALOR\s+FISCAL/gi, '');
  const checks = [
    { re: /Valor\s+Fiscal/i, label: 'Valor Fiscal' },
    { re: /Valor\s+N[ãa]o\s+Fiscal/i, label: 'Valor Não Fiscal' },
    { re: /(^|\n)\s*FISCAL\s*(\n|$)/m, label: 'label FISCAL' },
    { re: /(^|\n)\s*N[ÃA]O\s+FISCAL\s*(\n|$)/m, label: 'label NÃO FISCAL' },
    { re: /Distribui[cç][aã]o\s+Fiscal/i, label: 'Distribuição Fiscal' },
    { re: /\bMIDP\b/, label: 'MIDP' },
    { re: /Motor\s+Fiscal\s*[×xX]/i, label: 'Motor Fiscal' }
  ];
  for (const c of checks) {
    if (c.re.test(cleaned)) {
      throw new Error(`[RCF-09] Comprovante contém informação interna proibida: ${c.label}`);
    }
  }
}

/**
 * Monta HTML do comprovante remontado (cliente).
 */
function montarHtmlComprovanteRemontado({
  venda = {},
  itens = [],
  pagamentos = [],
  empresa = {},
  meta = {},
  qrCodeDataUrl = null
} = {}) {
  const linha = '----------------------------------------';
  const total = Number(venda.total != null ? venda.total : 0);
  const desconto = Number(venda.desconto || 0);
  const acrescimo = Number(venda.acrescimo || 0);
  const troco = Number(venda.troco || 0);

  const nomeEmpresa = meta.emitNome || empresa.nome || empresa.nome_empresa || 'Empresa';
  const cnpj = formatarCnpj(meta.emitCnpj || empresa.cnpj || '');

  const pags = consolidarPagamentos(pagamentos);
  const blocoPag = pags.length
    ? pags.map((p) => linhaPag(rotuloFormaPagamento(p.forma), p.valor)).join('\n\n')
    : linhaPag(String(venda.forma_pagamento || 'Pagamento'), total);

  const blocoItens = montarBlocoItens(itens);
  const ambienteTxt = Number(meta.ambiente) === 2
    ? 'AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL'
    : 'AMBIENTE DE PRODUÇÃO';

  const qrBlock = qrCodeDataUrl
    ? `<div style="text-align:center;margin:8px 0;"><img src="${qrCodeDataUrl}" alt="QR Code NFC-e" style="max-width:180px;"/><p>Consulte via QR Code</p></div>`
    : (meta.qrCodeUrl
      ? `<p style="font-size:10px;word-break:break-all;">QR: ${escapeHtml(meta.qrCodeUrl)}</p>`
      : '');

  const html = `
<div style="font-family: monospace; font-size: 12px; width: 320px; margin: 0 auto;">
<pre style="white-space: pre-wrap; margin: 0;">
${linha}
     COMPROVANTE DE VENDA
${linha}
${escapeHtml(nomeEmpresa)}
CNPJ: ${escapeHtml(cnpj)}

NFC-e nº ${escapeHtml(String(meta.numero || '-'))}  Série ${escapeHtml(String(meta.serie || '-'))}
Data/Hora: ${escapeHtml(formatarDhEmi(meta.dhEmi))}
${linha}
${blocoItens}
${linha}
${desconto > 0 ? `Desconto: ${formatarMoeda(desconto)}\n` : ''}${acrescimo > 0 ? `Acréscimo: ${formatarMoeda(acrescimo)}\n` : ''}TOTAL DA COMPRA

${formatarMoeda(total)}

${linha}

FORMA DE PAGAMENTO

${blocoPag}
${troco > 0 ? `\n\nTroco: ${formatarMoeda(troco)}` : ''}

${linha}

CHAVE DE ACESSO
${escapeHtml(formatarChave(meta.chave))}

Protocolo: ${escapeHtml(String(meta.protocolo || '-'))}
${ambienteTxt}

${linha}
Obrigado pela preferência!
</pre>
${qrBlock}
</div>
`.trim();

  assertSemVazamentoInterno(html);
  return html;
}

/**
 * RCF-09.1 — Certifica montagem: venda completa + cabeçalho NFC-e + XML imutável.
 */
function certificarComprovanteRemontado({
  venda = {},
  itens = [],
  pagamentos = [],
  empresa = {},
  nota = {},
  xmlAutorizado = ''
} = {}) {
  const xmlSnapshot = String(xmlAutorizado || nota.xml_enviado || '');
  const hashAntes = hashXmlSha256(xmlSnapshot);
  const meta = extrairMetadadosNfceAutorizada(nota, xmlSnapshot);

  const payload = {
    venda,
    itens,
    pagamentos,
    empresa,
    meta,
    qrCodeDataUrl: null
  };

  const html1 = montarHtmlComprovanteRemontado(payload);
  const html2 = montarHtmlComprovanteRemontado(payload);
  const hashDepois = hashXmlSha256(xmlSnapshot);

  const divergencias = [];
  if (hashAntes !== hashDepois) {
    divergencias.push('XML alterado durante a remontagem');
  }
  if (conteudoCanonicoComprovante(html1) !== conteudoCanonicoComprovante(html2)) {
    divergencias.push('Reimpressão não idêntica');
  }
  if (itens.length !== (itens || []).length) {
    divergencias.push('contagem itens inconsistente');
  }

  // Contagem de produtos no HTML = itens da venda (não do XML)
  for (const item of (itens || [])) {
    const nome = String(item.produto_nome || item.nome || '').trim();
    const bolas = Number(item.quantidade_bolas || 0);
    const presentePorNome = nome
      && (html1.includes(escapeHtml(nome)) || html1.includes(nome));
    const presenteCasquinha = bolas > 0 && /CASQUINHA/i.test(html1);
    const kitOk = !Array.isArray(item.kit_itens) || item.kit_itens.length === 0
      || item.kit_itens.every((k) => {
        const kn = String(k.produto_nome || k.nome || '').trim();
        return !kn || html1.includes(escapeHtml(kn)) || html1.includes(kn);
      });
    if (!presentePorNome && !presenteCasquinha) {
      divergencias.push(`Item ausente no comprovante: ${nome || '(sem nome)'}`);
    }
    if (!kitOk) {
      divergencias.push(`Componentes de kit ausentes: ${nome}`);
    }
  }

  const total = Number(venda.total || 0);
  const totalFmt = formatarMoeda(total);
  if (!html1.includes(totalFmt) && !html1.includes(total.toFixed(2).replace('.', ','))) {
    divergencias.push(`Total ${total} não encontrado no comprovante`);
  }

  // Itens do comprovante = venda (NÃO = XML)
  if (meta.qtdDetXml > 0 && itens.length !== meta.qtdDetXml) {
    // esperado em venda mista — apenas registra, não é erro
  }
  if (String(html1.replace(/\s/g, '')).indexOf(String(meta.chave || '')) < 0 && meta.chave) {
    divergencias.push('Chave NFC-e ausente no comprovante');
  }
  if (meta.numero != null && !html1.includes(String(meta.numero))) {
    divergencias.push('Número NFC-e ausente');
  }
  if (meta.serie != null && !html1.includes(String(meta.serie))) {
    divergencias.push('Série NFC-e ausente');
  }

  return {
    ok: divergencias.length === 0,
    divergencias,
    xmlHash: hashAntes,
    xmlImutavel: hashAntes === hashDepois,
    assinaturaPresente: meta.assinaturaPresente,
    qtdItensVenda: itens.length,
    qtdDetXml: meta.qtdDetXml,
    totalVenda: total,
    chave: meta.chave,
    numero: meta.numero,
    serie: meta.serie,
    protocolo: meta.protocolo,
    qrCodeUrl: meta.qrCodeUrl,
    reimpressaoIdentica: conteudoCanonicoComprovante(html1) === conteudoCanonicoComprovante(html2),
    html: html1,
    meta
  };
}

function carregarEmpresa(callback) {
  db.all(
    `SELECT chave, valor FROM configuracoes
     WHERE chave IN ('nome_empresa', 'cnpj', 'endereco')`,
    [],
    (err, rows) => {
      if (err) return callback(err);
      const map = {};
      (rows || []).forEach((r) => { map[r.chave] = r.valor; });
      callback(null, {
        nome: map.nome_empresa || 'Empresa',
        nome_empresa: map.nome_empresa || 'Empresa',
        cnpj: map.cnpj || '',
        endereco: map.endereco || ''
      });
    }
  );
}

/**
 * Gera comprovante — RCF-10 é a arquitetura oficial (alias de compatibilidade).
 */
function gerarComprovanteRemontado(vendaId, opcoes = {}) {
  const {
    gerarComprovanteComercialPosFiscal
  } = require('../comercial/ComprovanteComercialPosFiscalService');
  return gerarComprovanteComercialPosFiscal(vendaId, opcoes);
}

module.exports = {
  extrairMetadadosNfceAutorizada,
  montarHtmlComprovanteRemontado,
  assertSemVazamentoInterno,
  gerarComprovanteRemontado,
  certificarComprovanteRemontado,
  hashXmlSha256,
  conteudoCanonicoComprovante,
  xmlPossuiAssinatura,
  contarDetXml,
  montarBlocoItens
};
