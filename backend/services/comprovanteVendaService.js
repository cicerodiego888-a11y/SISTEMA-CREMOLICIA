/**
 * Comprovante comercial de venda (RC3.8D.4.0).
 *
 * Documento do cliente: produtos / qtd comercial / total / formas de pagamento.
 * RCF-09: não exibe Fiscal × Não Fiscal / MIDP ao cliente.
 */

'use strict';

const db = require('../database');

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
  const n = Number(valor || 0);
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function formatarDataHora(valor) {
  if (!valor) return new Date().toLocaleString('pt-BR');
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) {
    return String(valor);
  }
  return d.toLocaleString('pt-BR');
}

function rotuloFormaPagamento(forma) {
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
    voucher: 'Voucher',
    transferencia: 'Transferência',
    cheque: 'Cheque',
    boleto: 'Boleto'
  };
  return mapa[key] || (forma ? String(forma) : 'Pagamento');
}

function unidadeComercialItem(item) {
  const u = String(
    item.unidade_comercial || item.unidade || 'UN'
  ).trim().toUpperCase();
  if (!u) return 'UN';
  if (u === 'KG' || u === 'KILO' || u === 'KILOS') return 'KG';
  if (u === 'L' || u === 'LT' || u === 'LITRO' || u === 'LITROS') return 'L';
  return u;
}

function rotuloFormaComercialItem(item) {
  const forma = String(item.forma_comercializacao || '').toUpperCase();
  if (forma === 'PESO') return 'Peso';
  if (forma === 'VOLUME') return 'Volume';
  if (forma === 'CASQUINHA') return 'Casquinha';
  if (forma === 'UNIDADE') return 'Unidade';
  const tipo = String(item.tipo_venda || '').toUpperCase();
  if (tipo === 'UNIDADE') return 'Unidade';
  const un = unidadeComercialItem(item);
  if (un === 'L') return 'Volume';
  if (un === 'KG') return 'Peso';
  return tipo === 'PESO' ? 'Peso' : 'Unidade';
}

function quantidadeComercialItem(item) {
  const q = Number(item.quantidade || 0);
  const un = unidadeComercialItem(item);
  const forma = String(item.forma_comercializacao || '').toUpperCase();
  if (un === 'UN' || un === 'UNIDADE' || String(item.tipo_venda || '').toUpperCase() === 'UNIDADE') {
    return String(Math.round(q));
  }
  if (forma === 'PESO' || un === 'KG') {
    return q.toFixed(3).replace('.', ',');
  }
  const arred = Number(q.toFixed(3));
  return String(arred).replace('.', ',').replace(/,?0+$/, '') || '0';
}

function formatarPrecoUnitarioComUnidade(item) {
  const preco = Number(item.preco_unitario || item.preco || 0).toFixed(2).replace('.', ',');
  const un = unidadeComercialItem(item);
  const forma = String(item.forma_comercializacao || '').toUpperCase();
  if (forma === 'PESO' || un === 'KG') return `${preco}/KG`;
  if (forma === 'VOLUME' || un === 'L') return `${preco}/L`;
  return formatarMoeda(item.preco_unitario || item.preco || 0);
}

function subtotalItem(item) {
  if (item.subtotal != null && item.subtotal !== '') {
    return Number(item.subtotal);
  }
  return Number(item.quantidade || 0) * Number(item.preco_unitario || 0);
}

/**
 * Agrupa recebimentos por forma (sem fiscal/não fiscal).
 * @param {Array} recebimentos
 * @returns {Array<{forma:string, valor:number}>}
 */
function consolidarPagamentos(recebimentos) {
  const mapa = new Map();
  for (const r of recebimentos || []) {
    const forma = String(r.forma_pagamento || r.forma || 'outro').toLowerCase();
    const valor = Number(r.valor || 0);
    if (!(valor > 0)) continue;
    mapa.set(forma, Number(((mapa.get(forma) || 0) + valor).toFixed(2)));
  }
  return Array.from(mapa.entries()).map(([forma, valor]) => ({ forma, valor }));
}

function linhaPagamento(label, valor, largura = 40) {
  const valorTxt = formatarMoeda(valor);
  const pontos = Math.max(2, largura - label.length - valorTxt.length);
  return `${label}${'.'.repeat(pontos)}${valorTxt}`;
}

/**
 * @param {object} dados
 * @returns {string} HTML
 */
function montarHtmlComprovanteVenda(dados = {}) {
  const empresa = dados.nome_empresa || dados.empresa || 'Empresa';
  const cupom = dados.cupom || dados.venda_id || dados.id || '-';
  const dataHora = formatarDataHora(dados.data_hora || dados.data_venda || dados.created_at);
  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  const total = Number(
    dados.total != null
      ? dados.total
      : itens.reduce((s, it) => s + subtotalItem(it), 0)
  );
  const pagamentos = consolidarPagamentos(
    dados.pagamentos || dados.recebimentos || []
  );

  const blocoItens = itens.map((item) => {
    const nome = escapeHtml(item.produto_nome || item.nome || 'Produto');
    const qtd = quantidadeComercialItem(item);
    const un = escapeHtml(unidadeComercialItem(item));
    const unit = formatarPrecoUnitarioComUnidade(item);
    const sub = formatarMoeda(subtotalItem(item));
    const bolas = Number(item.quantidade_bolas || 0);
    const sabores = Array.isArray(item.sabores) ? item.sabores : [];
    const kitItens = Array.isArray(item.kit_itens) ? item.kit_itens : [];
    const tituloCasquinha = bolas > 0
      ? `${nome.toUpperCase().includes('CASQUINHA') ? nome : `CASQUINHA ${bolas} BOLA${bolas > 1 ? 'S' : ''}`}`
      : nome;
    const linhasSabores = sabores.length
      ? sabores.map((s) => `- ${escapeHtml(s.nome || s)}`).join('\n')
      : '';
    const linhasKit = kitItens.length
      ? kitItens.map((k) => `- ${escapeHtml(k.produto_nome || k.nome || 'Item')}: ${Number(k.quantidade || 0)}`).join('\n')
      : '';
    const forma = String(item.forma_comercializacao || '').toUpperCase();
    if (forma === 'PESO' || forma === 'VOLUME' || un === 'KG' || un === 'L') {
      return `
${bolas > 0 ? escapeHtml(String(tituloCasquinha).toUpperCase()) : nome}
${linhasSabores ? `${linhasSabores}\n` : ''}${linhasKit ? `${linhasKit}\n` : ''}${qtd} ${un}
${unit}
${sub}
`;
    }
    return `
${bolas > 0 ? escapeHtml(String(tituloCasquinha).toUpperCase()) : nome}
${linhasSabores ? `${linhasSabores}\n` : ''}${linhasKit ? `${linhasKit}\n` : ''}
Qtd.: ${qtd} ${un}

Valor Unit.: ${unit}

Subtotal: ${sub}
`;
  }).join('\n----------------------------------------\n');

  const blocoPag = pagamentos.length
    ? pagamentos.map((p) => linhaPagamento(rotuloFormaPagamento(p.forma), p.valor)).join('\n\n')
    : linhaPagamento(
      rotuloFormaPagamento(dados.forma_pagamento),
      total
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

${escapeHtml(empresa)}

Data: ${escapeHtml(dataHora)}

Cupom: ${escapeHtml(String(cupom))}

${linha}
${blocoItens}
${linha}

TOTAL DA COMPRA

${formatarMoeda(total)}

${linha}

FORMA DE PAGAMENTO

${blocoPag}

${linha}

Obrigado pela preferência!

Volte sempre!
</pre>
`.trim();
}

function lerNomeEmpresa(callback) {
  db.get(
    `SELECT valor FROM configuracoes WHERE chave = 'nome_empresa' LIMIT 1`,
    [],
    (err, row) => {
      if (err) {
        callback(null, 'Empresa');
        return;
      }
      callback(null, (row && row.valor) || 'Empresa');
    }
  );
}

function carregarRecebimentos(vendaId, callback) {
  db.all(
    `SELECT forma_pagamento, valor, tipo_recebimento
     FROM venda_recebimentos
     WHERE venda_id = ?
     ORDER BY id`,
    [vendaId],
    (err, rows) => {
      if (err) {
        callback(err);
        return;
      }
      if (rows && rows.length) {
        callback(null, rows);
        return;
      }
      db.all(
        `SELECT forma_pagamento, valor
         FROM venda_pagamentos
         WHERE venda_id = ?
         ORDER BY id`,
        [vendaId],
        (err2, rows2) => callback(err2, rows2 || [])
      );
    }
  );
}

/**
 * Carrega venda e gera HTML do comprovante comercial.
 * @param {number|string} vendaId
 * @param {function} callback (err, { html, dados })
 */
function gerarComprovanteVenda(vendaId, callback) {
  const id = Number(vendaId);
  if (!Number.isFinite(id) || id <= 0) {
    callback(new Error('vendaId inválido'));
    return;
  }

  db.get(`SELECT * FROM vendas WHERE id = ?`, [id], (err, venda) => {
    if (err) {
      callback(err);
      return;
    }
    if (!venda) {
      callback(Object.assign(new Error('Venda não encontrada'), { status: 404 }));
      return;
    }

    db.all(
      `SELECT vi.*, p.nome AS produto_nome, p.unidade AS unidade_produto
       FROM vendas_itens vi
       JOIN produtos p ON p.id = vi.produto_id
       WHERE vi.venda_id = ?
       ORDER BY vi.id`,
      [id],
      (errItens, itens) => {
        if (errItens) {
          callback(errItens);
          return;
        }

        const anexarExtras = async () => {
          const svcSabores = require('../modules/comercial/casquinha/CasquinhaSaboresService');
          let KitVendaService = null;
          try {
            KitVendaService = require('../modules/comercial/kits/KitVendaService');
          } catch (_) { /* optional */ }
          const out = [];
          for (const it of itens || []) {
            let sabores = [];
            let kit_itens = [];
            try {
              if (Number(it.quantidade_bolas || 0) > 0) {
                sabores = await svcSabores.listarSaboresDoItem(it.id);
              }
            } catch (_) {
              sabores = [];
            }
            try {
              if (KitVendaService && String(it.forma_comercializacao || '').toUpperCase() === 'KIT') {
                kit_itens = await KitVendaService.listarHistoricoDoItem(it.id);
              }
            } catch (_) {
              kit_itens = [];
            }
            out.push({ ...it, sabores, kit_itens });
          }
          return out;
        };

        anexarExtras()
          .then((itensComExtras) => {
        carregarRecebimentos(id, (errRec, recebimentos) => {
          if (errRec) {
            callback(errRec);
            return;
          }

          lerNomeEmpresa((_e, nomeEmpresa) => {
            const itensNorm = (itensComExtras || []).map((it) => ({
              ...it,
              produto_nome: it.produto_nome,
              unidade: it.unidade_comercial || it.unidade_produto || it.unidade || 'UN',
              quantidade_bolas: it.quantidade_bolas != null ? Number(it.quantidade_bolas) : null,
              sabores: Array.isArray(it.sabores) ? it.sabores : [],
              kit_itens: Array.isArray(it.kit_itens) ? it.kit_itens : [],
              // força uso comercial — nunca fiscal
              quantidade: Number(it.quantidade || 0),
              preco_unitario: Number(it.preco_unitario || 0),
              subtotal: Number(
                it.subtotal != null
                  ? it.subtotal
                  : Number(it.quantidade || 0) * Number(it.preco_unitario || 0)
              )
            }));

            const dados = {
              id: venda.id,
              venda_id: venda.id,
              cupom: venda.codigo || venda.id,
              data_venda: venda.data_venda || venda.created_at,
              created_at: venda.created_at,
              total: Number(venda.total || 0),
              valor_fiscal: Number(venda.valor_fiscal || 0),
              valor_nao_fiscal: Number(venda.valor_nao_fiscal || 0),
              forma_pagamento: venda.forma_pagamento,
              nome_empresa: nomeEmpresa,
              itens: itensNorm,
              pagamentos: recebimentos || []
            };

            const html = montarHtmlComprovanteVenda(dados);
            callback(null, { html, dados });
          });
        });
          })
          .catch((errSab) => callback(errSab));
      }
    );
  });
}

module.exports = {
  montarHtmlComprovanteVenda,
  consolidarPagamentos,
  gerarComprovanteVenda,
  formatarMoeda,
  rotuloFormaPagamento,
  quantidadeComercialItem
};
