/**
 * ComprovantePrestacaoBuilder — Snapshot oficial do comprovante de prestação (RC2.1).
 * Somente leitura: não altera consignação, estoque, fiscal ou financeiro.
 */

const crypto = require('crypto');
const db = require('../../../database');
const {
  TIPOS_COMPROVANTE,
  MOTOR_COMPROVANTES_VERSAO
} = require('../domain/enums');
const { buildTextoCompartilhavelPrestacao } = require('./TextoCompartilhavelBuilder');
const { buildQrCode } = require('./QrCodeBuilder');
const { buildPdfPayload } = require('./PdfComprovanteBuilder');

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatDateBr(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('pt-BR');
}

function formatTimeBr(value) {
  if (!value) {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return null;
  }
}

async function lerConfigMap() {
  try {
    const rows = await dbAll('SELECT chave, valor FROM configuracoes');
    const map = {};
    rows.forEach((r) => {
      map[r.chave] = r.valor;
    });
    return map;
  } catch (_e) {
    return {};
  }
}

function extrairFormaPagamento(mov) {
  const snap = parseJson(mov.snapshot) || {};
  const detalhes = parseJson(mov.detalhes) || {};
  return (
    mov.forma_pagamento
    || mov.formaPagamento
    || snap.formaPagamento
    || snap.contexto?.formaPagamento
    || snap.operacaoMeta?.formaPagamento
    || snap.meta?.formaPagamento
    || detalhes.formaPagamento
    || detalhes.forma_pagamento
    || null
  );
}

function classificarForma(raw) {
  const f = String(raw || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!f || f === '—' || f === '-') return 'outros';
  if (f.includes('dinheiro') || f === 'cash' || f === 'especie') return 'dinheiro';
  if (f.includes('pix')) return 'pix';
  if (
    f.includes('cartao')
    || f.includes('credito')
    || f.includes('debito')
    || f.includes('card')
  ) {
    return 'cartao';
  }
  return 'outros';
}

function agregarFormasPagamento(movsPagamento) {
  const bucket = { dinheiro: 0, pix: 0, cartao: 0, outros: 0 };
  (movsPagamento || []).forEach((mov) => {
    const valor = money(mov.valor);
    if (valor <= 0) return;
    const forma = classificarForma(extrairFormaPagamento(mov));
    bucket[forma] += valor;
  });
  return bucket;
}

class ComprovantePrestacaoBuilder {
  /**
   * @param {number|string} consignacaoId
   * @param {Object} [opcoes]
   */
  async gerar(consignacaoId, opcoes = {}) {
    const id = Number(consignacaoId);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error('consignacaoId inválido');
      err.statusCode = 400;
      throw err;
    }

    const consignacao = await dbGet(
      `SELECT c.*,
        cl.nome AS cliente_nome,
        cl.cpf_cnpj AS cliente_documento,
        cl.telefone AS cliente_telefone
       FROM consignacoes c
       LEFT JOIN clientes cl ON cl.id = c.cliente_id
       WHERE c.id = ?`,
      [id]
    );

    if (!consignacao) {
      const err = new Error('Consignação não encontrada');
      err.statusCode = 404;
      throw err;
    }

    const itens = await dbAll(
      `SELECT ci.*,
        p.nome AS produto_nome,
        p.codigo AS produto_codigo,
        COALESCE(p.unidade, 'UN') AS produto_unidade
       FROM consignacoes_itens ci
       LEFT JOIN produtos p ON p.id = ci.produto_id
       WHERE ci.consignacao_id = ?
       ORDER BY ci.id ASC`,
      [id]
    );

    const fechamentoRow = await dbGet(
      `SELECT * FROM movimentacoes_comerciais
       WHERE consignacao_id = ?
         AND UPPER(tipo_movimentacao) = 'FECHAMENTO_PRESTACAO'
       ORDER BY id DESC
       LIMIT 1`,
      [id]
    );

    const snapFechamento = parseJson(fechamentoRow?.snapshot) || {};
    const totaisSnap = snapFechamento.totais || {};

    const movsPagamento = await dbAll(
      `SELECT * FROM movimentacoes_comerciais
       WHERE consignacao_id = ?
         AND UPPER(tipo_movimentacao) = 'PAGAMENTO'
       ORDER BY id ASC`,
      [id]
    );

    const cfg = await lerConfigMap();
    const clienteId = consignacao.cliente_id;

    const itensMov = itens.map((it) => {
      const entregue = money(it.quantidade_entregue ?? it.quantidade ?? 0);
      const devolvido = money(it.quantidade_devolvida ?? 0);
      const vendido = money(
        it.quantidade_vendida
        ?? Math.max(0, entregue - devolvido - money(it.quantidade_perdida) - money(it.quantidade_cortesia))
      );
      const preco = money(it.preco_unitario);
      return {
        produtoId: it.produto_id,
        produto: it.produto_nome || `Produto #${it.produto_id}`,
        codigo: it.produto_codigo || null,
        unidade: it.produto_unidade || it.unidade_comercial || 'UN',
        entregue,
        devolvido,
        vendido,
        preco,
        valorEntregue: money(it.subtotal_entregue ?? (entregue * preco)),
        valorDevolvido: devolvido * preco,
        valorVendido: vendido * preco
      };
    });

    const totalEntregueQtd = itensMov.reduce((s, i) => s + i.entregue, 0);
    const totalDevolvidoQtd = itensMov.reduce((s, i) => s + i.devolvido, 0);
    const totalVendidoQtd = itensMov.reduce((s, i) => s + i.vendido, 0);

    const valorEntregue = money(
      totaisSnap.valorEntregue
      ?? consignacao.valor_total_entregue
      ?? itensMov.reduce((s, i) => s + i.valorEntregue, 0)
    );
    const valorDevolvido = money(
      totaisSnap.totalDevolvido
      ?? itensMov.reduce((s, i) => s + i.valorDevolvido, 0)
    );
    const valorVendido = money(
      totaisSnap.totalVendido
      ?? itensMov.reduce((s, i) => s + i.valorVendido, 0)
    );
    const valorRecebido = money(
      totaisSnap.totalRecebido
      ?? movsPagamento.reduce((s, m) => s + money(m.valor), 0)
    );
    const saldoAnterior = money(
      snapFechamento.saldoAberto
      ?? consignacao.valor_total_entregue
      ?? valorEntregue
    );
    const saldoAposPrestacao = money(
      totaisSnap.saldo
      ?? Math.max(0, valorVendido - valorRecebido)
    );

    const formas = agregarFormasPagamento(movsPagamento);
    const somaFormas = formas.dinheiro + formas.pix + formas.cartao + formas.outros;
    if (valorRecebido > 0 && somaFormas <= 0) {
      formas.outros = valorRecebido;
    } else if (valorRecebido > somaFormas + 0.009) {
      formas.outros += valorRecebido - somaFormas;
    }

    const dataRef = consignacao.data_encerramento
      || fechamentoRow?.data_movimentacao
      || fechamentoRow?.created_at
      || new Date().toISOString();

    const numeroComprovante = `PC-${String(id).padStart(6, '0')}`;
    const comprovanteId = `cmp-prestacao-${id}-${crypto.createHash('sha1').update(`${id}|${dataRef}`).digest('hex').slice(0, 10)}`;

    const empresaNome = cfg.nome_fantasia || cfg.nome_empresa || cfg.razao_social || 'CDS Sistemas';
    const cabecalho = {
      empresa: empresaNome,
      empresaNome,
      logo: cfg.logo || cfg.caminho_logomarca || null,
      cliente: consignacao.cliente_nome || `Cliente #${clienteId}`,
      clienteNome: consignacao.cliente_nome || `Cliente #${clienteId}`,
      clienteCodigo: clienteId != null ? String(clienteId) : null,
      clienteDocumento: consignacao.cliente_documento || null,
      clienteTelefone: consignacao.cliente_telefone || null,
      codigo: String(id),
      data: formatDateBr(dataRef),
      hora: formatTimeBr(dataRef),
      vendedor: opcoes.vendedorNome || consignacao.usuario_abertura_id || null,
      numeroComprovante
    };

    const cards = {
      resumoPrestacao: {
        titulo: 'Resumo da Prestação',
        valorEntregue,
        valorDevolvido,
        valorVendido,
        valorRecebido,
        saldoAnterior,
        saldoAposPrestacao
      },
      movimentacao: {
        titulo: 'Movimentação dos Produtos',
        itens: itensMov,
        totalEntregue: totalEntregueQtd,
        totalDevolvido: totalDevolvidoQtd,
        totalVendido: totalVendidoQtd
      },
      formasPagamento: {
        titulo: 'Forma de Pagamento',
        dinheiro: formas.dinheiro,
        pix: formas.pix,
        cartao: formas.cartao,
        outros: formas.outros
      },
      observacoes: {
        titulo: 'Observações',
        prestacao: consignacao.observacao || opcoes.observacao || null
      },
      compartilhamento: {
        titulo: 'Compartilhamento',
        botoes: [
          { id: 'pdf', label: 'Gerar PDF', icone: '📄', habilitado: true },
          { id: 'imprimir', label: 'Imprimir', icone: '🖨️', habilitado: true }
        ]
      }
    };

    const parcial = {
      id: comprovanteId,
      numeroComprovante,
      tipo: TIPOS_COMPROVANTE.PRESTACAO,
      versao: MOTOR_COMPROVANTES_VERSAO,
      consignacaoId: id,
      clienteId,
      cabecalho,
      cards,
      acoes: {
        desktop: [
          { id: 'imprimir', label: 'Imprimir' },
          { id: 'voltar', label: 'Voltar' }
        ]
      },
      assinatura: null
    };

    const qrCode = await buildQrCode({
      id: comprovanteId,
      numeroComprovante,
      empresa: empresaNome,
      versao: MOTOR_COMPROVANTES_VERSAO
    });

    parcial.qrCode = qrCode;
    parcial.textoCompartilhavel = buildTextoCompartilhavelPrestacao(parcial);
    parcial.pdf = buildPdfPayload(parcial);

    const snapshot = JSON.parse(JSON.stringify({
      ...parcial,
      geradoEm: new Date().toISOString()
    }));

    return {
      ...parcial,
      snapshot,
      geradoEm: snapshot.geradoEm
    };
  }
}

module.exports = ComprovantePrestacaoBuilder;
