/**
 * RCF-10 / RCF-10.1 — Comprovante Comercial Pós-Autorização.
 *
 * Layout oficial: cupom comercial de supermercado (não DANFE).
 * NFC-e carimba apenas: número, série, chave, protocolo, QR, data autorização.
 * Produtos / totais / pagamentos ← venda completa. XML imutável.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const db = require('../../database');
const { getFiscalSubDir } = require('../fiscal/paths');
const { buildPdfBase64FromTexto } = require('../../motores/comprovantes/services/PdfComprovanteBuilder');
const {
  consolidarPagamentos,
  rotuloFormaPagamento,
  quantidadeComercialItem
} = require('../comprovanteVendaService');

const LARGURA = 50;
const SEP_DUPLO = '='.repeat(LARGURA);
const SEP_SIMPLES = '-'.repeat(LARGURA);

function escapeHtml(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatarMoedaSimples(valor) {
  return Number(valor || 0).toFixed(2).replace('.', ',');
}

function formatarMoeda(valor) {
  return `R$ ${formatarMoedaSimples(valor)}`;
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

/** Chave em duas linhas (22+22 dígitos com espaços a cada 4). */
function formatarChaveDuasLinhas(chave) {
  const fmt = formatarChave(chave);
  if (!fmt || fmt.length < 20) return fmt;
  const partes = fmt.split(' ');
  if (partes.length <= 6) return fmt;
  return `${partes.slice(0, 5).join(' ')}\n${partes.slice(5).join(' ')}`;
}

function extrairTag(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function contarDetXml(xml) {
  return (String(xml || '').match(/<det\s/gi) || []).length;
}

function unidadeItem(item) {
  const u = String(item.unidade_comercial || item.unidade || 'UN').trim().toUpperCase();
  if (!u) return 'UN';
  if (u === 'KG' || u === 'KILO' || u === 'KILOS') return 'KG';
  if (u === 'L' || u === 'LT' || u === 'LITRO' || u === 'LITROS') return 'L';
  return u;
}

function valorUnitarioItem(item) {
  if (item.valor_unitario != null && item.valor_unitario !== '') {
    return Number(item.valor_unitario);
  }
  return Number(item.preco_unitario || item.preco || 0);
}

function valorTotalItem(item) {
  if (item.valor_total != null && item.valor_total !== '') {
    return Number(item.valor_total);
  }
  if (item.subtotal != null && item.subtotal !== '') {
    return Number(item.subtotal);
  }
  return Number(item.quantidade || 0) * valorUnitarioItem(item);
}

/**
 * Data/hora da autorização NFC-e (nunca data da venda).
 * Formato: DD/MM/YYYY HH:mm:ss
 */
function formatarDataAutorizacao(valor) {
  if (!valor) return '';
  try {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
  } catch (_) {
    return String(valor);
  }
}

function centralizar(texto, largura = LARGURA) {
  const t = String(texto || '');
  if (t.length >= largura) return t;
  const pad = Math.floor((largura - t.length) / 2);
  return `${' '.repeat(pad)}${t}`;
}

function linhaPontilhada(esquerda, direita, largura = LARGURA) {
  const esq = String(esquerda || '');
  const dir = String(direita || '');
  const pontos = Math.max(2, largura - esq.length - dir.length);
  return `${esq}${'.'.repeat(pontos)}${dir}`;
}

function tit(texto) {
  return `<b>${escapeHtml(texto)}</b>`;
}

function centralizarNegrito(texto, largura = LARGURA) {
  const plain = String(texto || '');
  const line = centralizar(plain, largura);
  const idx = line.indexOf(plain);
  if (idx < 0) return tit(plain);
  return `${line.slice(0, idx)}${tit(plain)}`;
}

function linhaPontilhadaTitulo(esquerda, direita, largura = LARGURA) {
  const line = linhaPontilhada(esquerda, direita, largura);
  return line.replace(String(esquerda), tit(esquerda));
}

/**
 * Metadados NFC-e para carimbo — somente leitura.
 */
function extrairCarimboNfce(nota = {}, xmlAutorizado = '') {
  const xml = String(xmlAutorizado || nota.xml_enviado || '');
  const xmlRetorno = String(nota.xml_retorno || '');
  const chave = String(nota.chave_acesso || '').replace(/\D/g, '')
    || String(extrairTag(xml, 'chNFe') || '').replace(/\D/g, '')
    || (String(xml.match(/Id="NFe(\d{44})"/i)?.[1] || '').replace(/\D/g, ''));

  // Data: autorização da nota — nunca vendas.data
  const dataAutorizacao = nota.data_autorizacao
    || nota.autorizada_em
    || extrairTag(xmlRetorno, 'dhRecbto')
    || extrairTag(xml, 'dhRecbto')
    || extrairTag(xml, 'dhEmi')
    || null;

  const qrCodeUrl = nota.qr_code_url || nota.qrcode || nota.qr_code || null;

  return {
    chave,
    numero: nota.numero != null ? nota.numero : extrairTag(xml, 'nNF'),
    serie: nota.serie != null ? nota.serie : extrairTag(xml, 'serie'),
    dataAutorizacao,
    dhEmi: dataAutorizacao,
    protocolo: nota.protocolo
      || extrairTag(xmlRetorno, 'nProt')
      || extrairTag(xml, 'nProt')
      || null,
    ambiente: Number(
      nota.ambiente != null ? nota.ambiente : (extrairTag(xml, 'tpAmb') || 1)
    ),
    qrCodeUrl,
    qtdDetXml: contarDetXml(xml),
    vNF: Number(extrairTag(xml, 'vNF') || 0)
  };
}

function montarBlocoItensComercial(itens = []) {
  return (itens || []).map((item) => {
    const nome = escapeHtml(item.produto_nome || item.nome || 'Produto');
    const un = unidadeItem(item);
    const qtdTxt = typeof quantidadeComercialItem === 'function'
      ? quantidadeComercialItem({ ...item, unidade: un, unidade_comercial: un })
      : String(Number(item.quantidade || 0));
    const unit = formatarMoeda(valorUnitarioItem(item));
    const total = formatarMoeda(valorTotalItem(item));
    const bolas = Number(item.quantidade_bolas || 0);
    const sabores = Array.isArray(item.sabores) ? item.sabores : [];
    const kitItens = Array.isArray(item.kit_itens) ? item.kit_itens : [];
    const compostos = Array.isArray(item.compostos || item.itens_compostos)
      ? (item.compostos || item.itens_compostos)
      : [];

    const titulo = bolas > 0
      ? escapeHtml(
        String(item.produto_nome || item.nome || '').toUpperCase().includes('CASQUINHA')
          ? String(item.produto_nome || item.nome || '').toUpperCase()
          : `CASQUINHA ${bolas} BOLA${bolas > 1 ? 'S' : ''}`
      )
      : nome;

    const extras = [];
    sabores.forEach((s) => extras.push(`  - ${escapeHtml(s.nome || s)}`));
    kitItens.forEach((k) => {
      extras.push(`  - ${escapeHtml(k.produto_nome || k.nome || 'Item')}: ${Number(k.quantidade || 0)}`);
    });
    compostos.forEach((c) => {
      extras.push(`  - ${escapeHtml(c.produto_nome || c.nome || 'Item')}: ${Number(c.quantidade || 0)}`);
    });

    const forma = String(item.forma_comercializacao || '').toUpperCase();
    let linhaQtd;
    if (forma === 'PESO' || forma === 'VOLUME' || un === 'KG' || un === 'L') {
      linhaQtd = linhaPontilhada(`${qtdTxt} ${escapeHtml(un)} x ${unit}`, total);
    } else {
      linhaQtd = linhaPontilhada(`${qtdTxt} x ${unit}`, total);
    }

    const extrasTxt = extras.length ? `\n${extras.join('\n')}` : '';
    return `${titulo}${extrasTxt}\n${linhaQtd}`;
  }).join('\n\n');
}

/**
 * Cliente nunca vê termos internos F×NF / DANFE / tributos.
 */
function assertComprovanteTransparente(html) {
  const cleaned = String(html || '').replace(/SEM\s+VALOR\s+FISCAL/gi, '');
  const proibidos = [
    { re: /DANFE/i, label: 'DANFE' },
    { re: /Documento\s+Auxiliar/i, label: 'Documento Auxiliar' },
    { re: /Tributos\s+Lei\s*12\.?741/i, label: 'Tributos Lei 12.741' },
    { re: /Total\s+Fiscal/i, label: 'Total Fiscal' },
    { re: /Total\s+N[ãa]o\s+Fiscal/i, label: 'Total Não Fiscal' },
    { re: /Itens\s+Fiscais/i, label: 'Itens Fiscais' },
    { re: /Itens\s+N[ãa]o\s+Fiscais/i, label: 'Itens Não Fiscais' },
    { re: /Valor\s+Fiscal/i, label: 'Valor Fiscal' },
    { re: /Valor\s+N[ãa]o\s+Fiscal/i, label: 'Valor Não Fiscal' },
    { re: /Opera[cç][aã]o\s+Fiscal/i, label: 'Operação Fiscal' },
    { re: /Distribui[cç][aã]o\s+Fiscal/i, label: 'Distribuição Fiscal' },
    { re: /Modo\s+Fiscal/i, label: 'Modo Fiscal' },
    { re: /Modo\s+N[ãa]o\s+Fiscal/i, label: 'Modo Não Fiscal' },
    { re: /Tributos\s+Incidentes/i, label: 'Tributos Incidentes' },
    { re: /\bICMS\b/, label: 'ICMS' },
    { re: /\bPIS\b/, label: 'PIS' },
    { re: /\bCOFINS\b/, label: 'COFINS' },
    { re: /\bMIDP\b/, label: 'MIDP' },
    { re: /Motor\s+Fiscal/i, label: 'Motor Fiscal' },
    { re: /Tributos\s*\(Lei/i, label: 'Tributos (Lei…)' }
  ];
  for (const p of proibidos) {
    if (p.re.test(cleaned)) {
      throw new Error(`[RCF-10] Comprovante contém informação interna proibida: ${p.label}`);
    }
  }
}

function conteudoCanonico(html) {
  return String(html || '')
    .replace(/src="data:image\/[^"]+"/gi, 'src="QR_CANONICO"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * RCF-10.1 — Layout oficial cupom comercial (supermercado).
 */
function montarHtmlComprovanteComercial({
  venda = {},
  itens = [],
  pagamentos = [],
  empresa = {},
  carimbo = {},
  qrCodeDataUrl = null
} = {}) {
  const total = Number(venda.total != null ? venda.total : 0);
  const desconto = Number(venda.desconto || 0);
  const acrescimo = Number(venda.acrescimo || 0);
  const troco = Number(venda.troco || 0);

  // Cabeçalho: Configuração Fiscal (empresa), não XML
  const nomeEmpresa = empresa.nome || empresa.nome_empresa || 'Empresa';
  const cnpj = formatarCnpj(empresa.cnpj || '');
  const endereco = String(empresa.endereco || '').trim();
  const cidadeUf = String(empresa.cidade_uf || empresa.cidade || '').trim();

  const pags = consolidarPagamentos(pagamentos);
  const blocoPag = pags.length
    ? pags.map((p) => linhaPontilhada(
      rotuloFormaPagamento(p.forma),
      formatarMoeda(p.valor)
    )).join('\n\n')
    : linhaPontilhada(
      rotuloFormaPagamento(venda.forma_pagamento) || 'Pagamento',
      formatarMoeda(total)
    );

  const blocoItens = montarBlocoItensComercial(itens);
  const dataTxt = formatarDataAutorizacao(carimbo.dataAutorizacao || carimbo.dhEmi);

  const cabEndereco = [
    endereco ? centralizar(escapeHtml(endereco)) : '',
    cidadeUf ? centralizar(escapeHtml(cidadeUf)) : ''
  ].filter(Boolean).join('\n');

  const qrBlock = qrCodeDataUrl
    ? `<div style="text-align:center;margin:10px 0;">
<img src="${qrCodeDataUrl}" alt="QR CODE" style="max-width:160px;"/>
<div style="font-size:11px;margin-top:6px;">Consulte sua NFC-e apontando<br/>a câmera do celular.</div>
</div>`
    : (carimbo.qrCodeUrl
      ? `<div style="text-align:center;font-size:10px;margin:8px 0;word-break:break-all;">
[ QR CODE ]<br/>${escapeHtml(carimbo.qrCodeUrl)}<br/>
Consulte sua NFC-e apontando<br/>a câmera do celular.
</div>`
      : '');

  const homolog = Number(carimbo.ambiente) === 2
    ? `\n${centralizar('AMBIENTE DE HOMOLOGAÇÃO')}\n`
    : '';

  const html = `
<div style="font-family: Consolas, 'Courier New', monospace; font-size: 12px; width: 360px; margin: 0 auto; color: #000;">
<pre style="white-space: pre-wrap; margin: 0; font-family: inherit;">
${centralizarNegrito(String(nomeEmpresa).toUpperCase())}

${centralizar(`CNPJ: ${escapeHtml(cnpj)}`)}
${cabEndereco ? `\n${cabEndereco}\n` : ''}
${SEP_DUPLO}

${centralizarNegrito('CUPOM DE VENDA')}

NFC-e nº ${escapeHtml(String(carimbo.numero || '-'))}             Série ${escapeHtml(String(carimbo.serie || '-'))}

${escapeHtml(dataTxt)}

${SEP_DUPLO}


PRODUTO                               TOTAL

${SEP_SIMPLES}

${blocoItens}

${SEP_SIMPLES}
${desconto > 0 ? `\n${linhaPontilhada('Desconto', formatarMoeda(desconto))}\n` : ''}${acrescimo > 0 ? `\n${linhaPontilhada('Acréscimo', formatarMoeda(acrescimo))}\n` : ''}
${linhaPontilhadaTitulo('TOTAL DA COMPRA', formatarMoeda(total))}

${SEP_DUPLO}

${tit('FORMA DE PAGAMENTO')}

${blocoPag}${troco > 0 ? `\n\n${linhaPontilhada('Troco', formatarMoeda(troco))}` : ''}

${SEP_DUPLO}

${tit('CHAVE DE ACESSO')}

${escapeHtml(formatarChaveDuasLinhas(carimbo.chave))}


${tit('PROTOCOLO')}

${escapeHtml(String(carimbo.protocolo || '-'))}
${homolog}
${SEP_DUPLO}
</pre>
${qrBlock}
<pre style="white-space: pre-wrap; margin: 0; font-family: inherit;">
${SEP_DUPLO}

${centralizar('Obrigado pela preferência!')}

${centralizar('Volte Sempre!')}

${SEP_DUPLO}
</pre>
</div>
`.trim();

  assertComprovanteTransparente(html);
  return html;
}

function carregarEmpresa(callback) {
  db.all(
    `SELECT chave, valor FROM configuracoes
     WHERE chave IN (
       'nome_empresa', 'cnpj', 'endereco', 'cidade', 'uf',
       'cidade_uf', 'razao_social', 'nome_fantasia'
     )`,
    [],
    (err, rows) => {
      if (err) return callback(err);
      const map = {};
      (rows || []).forEach((r) => { map[r.chave] = r.valor; });
      const cidade = map.cidade || '';
      const uf = map.uf || '';
      const cidadeUf = map.cidade_uf
        || (cidade && uf ? `${cidade} - ${uf}` : (cidade || uf || ''));
      const nome = map.nome_fantasia || map.nome_empresa || map.razao_social || 'Empresa';
      callback(null, {
        nome,
        nome_empresa: nome,
        cnpj: map.cnpj || '',
        endereco: map.endereco || '',
        cidade,
        uf,
        cidade_uf: cidadeUf
      });
    }
  );
}

function htmlParaTextoPlano(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Conta itens da venda presentes no HTML (paridade Banco = HTML).
 */
function contarItensNoHtml(html, itens = []) {
  let count = 0;
  for (const item of itens || []) {
    const nome = String(item.produto_nome || item.nome || '').trim();
    const bolas = Number(item.quantidade_bolas || 0);
    if (!nome && bolas <= 0) continue;
    const presentePorNome = nome && String(html || '').includes(nome);
    const presenteCasquinha = bolas > 0 && /CASQUINHA/i.test(String(html || ''));
    if (presentePorNome || presenteCasquinha) count += 1;
  }
  return count;
}

function extrairTotalHtml(html, totalEsperado) {
  const bloco = String(html || '').split('TOTAL DA COMPRA')[1] || '';
  const fmt = Number(totalEsperado || 0).toFixed(2).replace('.', ',');
  if (bloco.includes(fmt) || bloco.includes(`R$ ${fmt}`)) {
    return Number(totalEsperado || 0);
  }
  const m = bloco.match(/R\$\s*([\d.,]+)/);
  if (m) {
    return Number(String(m[1]).replace('.', '').replace(',', '.'));
  }
  return null;
}

function logAuditoriaRcf101(payload) {
  console.log('[RCF-10.1]', {
    Venda: payload.vendaId,
    'Itens Banco': payload.itensBanco,
    'Itens API': payload.itensApi,
    'Itens HTML': payload.itensHtml,
    'Itens Impressos': payload.itensImpressos,
    'Total Banco': payload.totalBanco,
    'Total HTML': payload.totalHtml,
    'Total Impresso': payload.totalImpresso,
    Snapshot: payload.snapshotDir || null
  });
}

/**
 * Persiste comprovante.json / comprovante.html / comprovante.pdf para auditoria.
 */
function salvarSnapshotComprovante(vendaId, payload = {}) {
  const dir = path.join(getFiscalSubDir('comprovantes'), `venda-${vendaId}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const jsonPath = path.join(dir, 'comprovante.json');
  const htmlPath = path.join(dir, 'comprovante.html');
  const pdfPath = path.join(dir, 'comprovante.pdf');

  const auditJson = {
    vendaId: Number(vendaId),
    notaId: payload.notaId || null,
    geradoEm: new Date().toISOString(),
    itensBanco: payload.itensBanco,
    itensApi: payload.itensApi,
    itensHtml: payload.itensHtml,
    totalBanco: payload.totalBanco,
    totalHtml: payload.totalHtml,
    itens: (payload.itens || []).map((it) => ({
      produto_nome: it.produto_nome || it.nome,
      quantidade: it.quantidade,
      valor_total: valorTotalItem(it)
    })),
    pagamentos: payload.pagamentos || [],
    carimbo: payload.carimbo || null
  };

  fs.writeFileSync(jsonPath, JSON.stringify(auditJson, null, 2), 'utf8');
  fs.writeFileSync(htmlPath, String(payload.html || ''), 'utf8');

  const textoPlano = htmlParaTextoPlano(payload.html);
  const pdfBase64 = buildPdfBase64FromTexto(
    textoPlano,
    `Cupom Venda #${vendaId}`
  );
  fs.writeFileSync(pdfPath, Buffer.from(pdfBase64, 'base64'));

  return { dir, jsonPath, htmlPath, pdfPath };
}

function logAuditoriaRcf10(payload) {
  console.log('[RCF-10]', {
    Venda: payload.vendaId,
    'Itens venda': payload.itensVenda,
    'Itens XML': payload.itensXml,
    'Itens comprovante': payload.itensComprovante,
    'Total venda': payload.totalVenda,
    'Total XML': payload.totalXml,
    'Total comprovante': payload.totalComprovante,
    'Pagamentos venda': payload.pagamentosVenda,
    'Pagamentos comprovante': payload.pagamentosComprovante,
    QRCode: payload.qrCode ? 'sim' : 'nao',
    Chave: payload.chave,
    Protocolo: payload.protocolo
  });
}

/**
 * Gera comprovante comercial pós-autorização NFC-e.
 */
function gerarComprovanteComercialPosFiscal(vendaId, opcoes = {}) {
  const id = Number(vendaId);
  const notaId = opcoes.notaId != null ? Number(opcoes.notaId) : null;

  return new Promise((resolve, reject) => {
    if (!Number.isFinite(id) || id <= 0) {
      reject(new Error('vendaId inválido'));
      return;
    }

    const sqlNota = notaId
      ? `SELECT * FROM nfce_notas WHERE id = ? AND venda_id = ? AND status = 'autorizada' LIMIT 1`
      : `SELECT * FROM nfce_notas WHERE venda_id = ? AND status = 'autorizada' ORDER BY id DESC LIMIT 1`;
    const paramsNota = notaId ? [notaId, id] : [id];

    db.get(sqlNota, paramsNota, (errNota, nota) => {
      if (errNota) return reject(errNota);
      if (!nota) {
        return reject(Object.assign(
          new Error('NFC-e autorizada não encontrada para comprovante comercial.'),
          { status: 404, code: 'RCF10_SEM_NOTA' }
        ));
      }

      const xmlSnapshot = String(nota.xml_enviado || '');
      if (!xmlSnapshot.trim()) {
        return reject(new Error('[RCF-10] XML autorizado ausente — impossível carimbar NFC-e.'));
      }

      db.get('SELECT * FROM vendas WHERE id = ?', [id], (errV, venda) => {
        if (errV) return reject(errV);
        if (!venda) return reject(new Error('Venda não encontrada'));

        db.all(
          `SELECT vi.*, p.nome AS produto_nome, p.unidade AS unidade_produto
           FROM vendas_itens vi
           LEFT JOIN produtos p ON p.id = vi.produto_id
           WHERE vi.venda_id = ?
           ORDER BY vi.id`,
          [id],
          (errIt, itens) => {
            if (errIt) return reject(errIt);

            const carregarPags = (pagamentos) => {
              carregarEmpresa(async (errEmp, empresa) => {
                if (errEmp) return reject(errEmp);
                try {
                  if (Number(nota.venda_id) !== id) {
                    throw new Error('[RCF-10] Nota não pertence à venda informada.');
                  }

                  const carimbo = extrairCarimboNfce(nota, xmlSnapshot);
                  let qrCodeDataUrl = null;
                  if (carimbo.qrCodeUrl) {
                    qrCodeDataUrl = await QRCode.toDataURL(carimbo.qrCodeUrl);
                  }

                  const itensNorm = (itens || []).map((it) => ({
                    ...it,
                    produto_nome: it.produto_nome,
                    unidade: it.unidade_comercial || it.unidade_produto || it.unidade || 'UN',
                    unidade_comercial: it.unidade_comercial || it.unidade_produto || it.unidade || 'UN',
                    quantidade: Number(it.quantidade || 0),
                    preco_unitario: valorUnitarioItem(it),
                    valor_unitario: valorUnitarioItem(it),
                    valor_total: valorTotalItem(it),
                    subtotal: valorTotalItem(it)
                  }));

                  const pags = (pagamentos || []).map((p) => ({
                    forma_pagamento: p.forma_pagamento,
                    valor: p.valor
                  }));

                  const html = montarHtmlComprovanteComercial({
                    venda,
                    itens: itensNorm,
                    pagamentos: pags,
                    empresa: empresa || {},
                    carimbo,
                    qrCodeDataUrl
                  });

                  if (xmlSnapshot !== String(nota.xml_enviado || '')) {
                    throw new Error('[RCF-10] XML foi alterado durante a montagem — abortado.');
                  }

                  const totalVenda = Number(venda.total || 0);
                  const totalFiscal = Number(venda.valor_fiscal || 0);
                  const totalNaoFiscal = Number(venda.valor_nao_fiscal || 0);
                  const pagsConsol = consolidarPagamentos(pags);

                  const itensBanco = itensNorm.length;
                  const itensHtml = contarItensNoHtml(html, itensNorm);
                  const totalHtml = extrairTotalHtml(html, totalVenda);

                  logAuditoriaRcf10({
                    vendaId: id,
                    totalVenda,
                    totalXml: carimbo.vNF,
                    totalComprovante: totalVenda,
                    itensVenda: itensBanco,
                    itensXml: carimbo.qtdDetXml,
                    itensComprovante: itensHtml,
                    pagamentosVenda: pags.length,
                    pagamentosComprovante: pagsConsol.length,
                    qrCode: Boolean(carimbo.qrCodeUrl || qrCodeDataUrl),
                    chave: carimbo.chave,
                    protocolo: carimbo.protocolo
                  });

                  let snapshotDir = null;
                  if (opcoes.salvarSnapshot !== false) {
                    const snap = salvarSnapshotComprovante(id, {
                      notaId: nota.id,
                      html,
                      itens: itensNorm,
                      pagamentos: pagsConsol,
                      carimbo,
                      itensBanco,
                      itensApi: itensBanco,
                      itensHtml,
                      totalBanco: totalVenda,
                      totalHtml
                    });
                    snapshotDir = snap.dir;
                  }

                  logAuditoriaRcf101({
                    vendaId: id,
                    itensBanco,
                    itensApi: itensBanco,
                    itensHtml,
                    itensImpressos: itensHtml,
                    totalBanco: totalVenda,
                    totalHtml,
                    totalImpresso: totalHtml,
                    snapshotDir
                  });

                  if (itensBanco !== itensHtml) {
                    throw Object.assign(
                      new Error(
                        `[RCF-10.1] Divergência itens: banco=${itensBanco} html=${itensHtml} `
                        + `(ComprovanteComercialPosFiscalService.gerarComprovanteComercialPosFiscal)`
                      ),
                      { code: 'RCF101_ITENS_DIVERGENTES', itensBanco, itensHtml }
                    );
                  }

                  resolve({
                    html,
                    carimbo,
                    meta: carimbo,
                    xmlAutorizado: xmlSnapshot,
                    vendaId: id,
                    notaId: nota.id,
                    total: totalVenda,
                    totalFiscal,
                    totalNaoFiscal,
                    qtdItens: itensBanco,
                    qtdItensHtml: itensHtml,
                    qtdDetXml: carimbo.qtdDetXml,
                    qtdPagamentos: pagsConsol.length,
                    totalHtml,
                    snapshotDir,
                    itens: itensNorm.map((it) => ({
                      produto_nome: it.produto_nome,
                      quantidade: it.quantidade,
                      valor_total: valorTotalItem(it)
                    }))
                  });
                } catch (e) {
                  reject(e);
                }
              });
            };

            db.all(
              `SELECT forma_pagamento, valor, tipo_recebimento, status
               FROM venda_recebimentos WHERE venda_id = ? ORDER BY id`,
              [id],
              (errRec, recebimentos) => {
                if (errRec) return reject(errRec);
                if (recebimentos && recebimentos.length) {
                  return carregarPags(recebimentos.filter((r) =>
                    !r.status || String(r.status).toLowerCase() === 'aprovado'
                  ));
                }
                db.all(
                  'SELECT forma_pagamento, valor FROM venda_pagamentos WHERE venda_id = ? ORDER BY id',
                  [id],
                  (errPag, pags) => {
                    if (errPag) return reject(errPag);
                    carregarPags(pags || []);
                  }
                );
              }
            );
          }
        );
      });
    });
  });
}

module.exports = {
  extrairCarimboNfce,
  montarHtmlComprovanteComercial,
  montarBlocoItensComercial,
  assertComprovanteTransparente,
  gerarComprovanteComercialPosFiscal,
  conteudoCanonico,
  valorTotalItem,
  valorUnitarioItem,
  formatarDataAutorizacao,
  linhaPontilhada,
  centralizar,
  logAuditoriaRcf10,
  logAuditoriaRcf101,
  contarItensNoHtml,
  htmlParaTextoPlano,
  extrairTotalHtml,
  salvarSnapshotComprovante,
  LARGURA,
  SEP_DUPLO
};
