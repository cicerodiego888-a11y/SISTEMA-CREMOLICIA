/**
 * ComprovanteEntregaBuilder — Snapshot único do comprovante de entrega (RCM-04.4).
 */

const crypto = require('crypto');
const db = require('../../../database');
const {
  TIPOS_COMPROVANTE,
  STATUS_CREDITO,
  MOTOR_COMPROVANTES_VERSAO
} = require('../domain/enums');
const { buildTextoCompartilhavel } = require('./TextoCompartilhavelBuilder');
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

function statusCreditoPorUso(limite, saldoAtual) {
  const lim = money(limite);
  if (lim <= 0) {
    return money(saldoAtual) > 0 ? STATUS_CREDITO.AMARELO : STATUS_CREDITO.VERDE;
  }
  const pct = (money(saldoAtual) / lim) * 100;
  if (pct > 90) return STATUS_CREDITO.VERMELHO;
  if (pct >= 70) return STATUS_CREDITO.AMARELO;
  return STATUS_CREDITO.VERDE;
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

class ComprovanteEntregaBuilder {
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

    const cfg = await lerConfigMap();
    const clienteId = consignacao.cliente_id;

    const consignacoesCliente = clienteId
      ? await dbAll(
        `SELECT id, status, valor_total_entregue, saldo_aberto, data_entrega, data_encerramento, data_abertura
         FROM consignacoes WHERE cliente_id = ? ORDER BY id ASC`,
        [clienteId]
      )
      : [];

    let perfil = null;
    if (clienteId) {
      try {
        perfil = await dbGet(
          `SELECT * FROM perfil_comercial WHERE cliente_id = ? ORDER BY id DESC LIMIT 1`,
          [clienteId]
        );
      } catch (_e) {
        perfil = null;
      }
    }

    const novaRemessa = money(
      consignacao.valor_total_entregue
        ?? itens.reduce((s, it) => s + money(it.subtotal_entregue ?? (Number(it.quantidade_entregue || 0) * Number(it.preco_unitario || 0))), 0)
    );

    const outrasAbertas = consignacoesCliente.filter((c) => {
      const st = String(c.status || '').toUpperCase();
      return c.id !== id && (st === 'ENTREGUE' || st === 'RASCUNHO' || st === 'EM_PRESTACAO');
    });

    const saldoOutras = outrasAbertas.reduce((s, c) => s + money(c.saldo_aberto ?? c.valor_total_entregue), 0);
    const saldoAnterior = saldoOutras;
    const saldoAtual = saldoAnterior + novaRemessa;
    const limite = money(perfil?.limite_comercial ?? perfil?.limiteComercial ?? 0);
    const creditoDisponivel = Math.max(0, limite - saldoAtual);
    const statusComercial = statusCreditoPorUso(limite, saldoAtual);

    const entregues = consignacoesCliente.filter((c) => {
      const st = String(c.status || '').toUpperCase();
      return st === 'ENTREGUE' || st === 'ACERTADA' || st === 'ENCERRADA' || st === 'QUITADA' || c.data_entrega;
    });
    const valoresRemessa = entregues
      .map((c) => money(c.valor_total_entregue))
      .filter((v) => v > 0);
    const maiorRemessa = valoresRemessa.length ? Math.max(...valoresRemessa) : novaRemessa;
    const mediaRemessas = valoresRemessa.length
      ? valoresRemessa.reduce((a, b) => a + b, 0) / valoresRemessa.length
      : novaRemessa;

    const ultimaEntregaRow = entregues
      .filter((c) => c.data_entrega)
      .sort((a, b) => new Date(b.data_entrega) - new Date(a.data_entrega))[0];
    const ultimaPrestacaoRow = consignacoesCliente
      .filter((c) => c.data_encerramento)
      .sort((a, b) => new Date(b.data_encerramento) - new Date(a.data_encerramento))[0];

    let perdasEmpresa = 0;
    let perdasCliente = 0;
    try {
      const perdas = await dbAll(
        `SELECT tipo, COALESCE(SUM(valor), 0) AS total
         FROM movimentacoes_comerciais
         WHERE cliente_id = ? AND tipo LIKE '%PERDA%'
         GROUP BY tipo`,
        [clienteId]
      );
      perdas.forEach((p) => {
        const t = String(p.tipo || '').toUpperCase();
        if (t.includes('EMPRESA')) perdasEmpresa += money(p.total);
        else perdasCliente += money(p.total);
      });
    } catch (_e) {
      // tabela pode variar — histórico parcial ok
    }

    const basePerdas = perdasEmpresa + perdasCliente;
    const indicePerdas = novaRemessa > 0
      ? Number(((basePerdas / Math.max(novaRemessa, 1)) * 100).toFixed(1))
      : 0;

    const itensCard = itens.map((it) => {
      const qtd = money(it.quantidade_entregue ?? it.quantidade ?? 0);
      const preco = money(it.preco_unitario);
      const total = money(it.subtotal_entregue ?? (qtd * preco));
      return {
        produtoId: it.produto_id,
        produto: it.produto_nome || `Produto #${it.produto_id}`,
        codigo: it.produto_codigo || null,
        quantidade: qtd,
        unidade: it.produto_unidade || it.unidade_comercial || 'UN',
        preco,
        total
      };
    });

    const quantidadeTotal = itensCard.reduce((s, i) => s + money(i.quantidade), 0);
    const volumes = itensCard.length;
    const valorComercial = itensCard.reduce((s, i) => s + money(i.total), 0) || novaRemessa;

    const dataRef = consignacao.data_entrega || consignacao.data_abertura || new Date().toISOString();
    const numeroComprovante = `CE-${String(id).padStart(6, '0')}`;
    const comprovanteId = `cmp-entrega-${id}-${crypto.createHash('sha1').update(`${id}|${dataRef}`).digest('hex').slice(0, 10)}`;

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
      rota: opcoes.rota || null,
      veiculo: opcoes.veiculo || null,
      numeroComprovante
    };

    const cards = {
      produtos: {
        titulo: 'Produtos',
        itens: itensCard,
        quantidadeTotal,
        volumes,
        valorComercial
      },
      situacaoComercial: {
        titulo: 'Situação Comercial',
        saldoAnterior,
        novaRemessa: valorComercial,
        saldoAtual,
        limite,
        creditoDisponivel,
        consignacoesAbertas: outrasAbertas.length + (String(consignacao.status).toUpperCase() === 'ENTREGUE' ? 1 : outrasAbertas.length === 0 ? 1 : 0),
        valorEmAberto: saldoAtual,
        statusComercial
      },
      historico: {
        titulo: 'Histórico',
        ultimaEntrega: formatDateBr(ultimaEntregaRow?.data_entrega) || cabecalho.data,
        ultimaPrestacao: formatDateBr(ultimaPrestacaoRow?.data_encerramento),
        maiorRemessa,
        mediaRemessas: Number(mediaRemessas.toFixed(2)),
        perdasEmpresa,
        perdasCliente,
        indicePerdas
      },
      observacoes: {
        titulo: 'Observações',
        entrega: consignacao.observacao || opcoes.observacaoEntrega || null,
        vendedor: opcoes.observacaoVendedor || null,
        internas: opcoes.observacaoInterna || null
      },
      compartilhamento: {
        titulo: 'Compartilhamento',
        botoes: [
          { id: 'whatsapp', label: 'Compartilhar via WhatsApp', icone: '📱', habilitado: true },
          { id: 'copiar', label: 'Copiar Resumo', icone: '📋', habilitado: true },
          { id: 'pdf', label: 'Gerar PDF', icone: '📄', habilitado: true },
          { id: 'imprimir', label: 'Imprimir', icone: '🖨️', habilitado: true },
          { id: 'email', label: 'Enviar por Email', icone: '📧', habilitado: false, estrutura: true },
          { id: 'link', label: 'Copiar Link', icone: '🔗', habilitado: false, estrutura: true }
        ]
      }
    };

    const indicadores = {
      statusCredito: statusComercial,
      percentualUsoLimite: limite > 0 ? Number(((saldoAtual / limite) * 100).toFixed(1)) : null,
      regras: {
        verde: 'Até 70%',
        amarelo: '70% até 90%',
        vermelho: 'Acima de 90%'
      }
    };

    const acoes = {
      desktop: [
        { id: 'nova_entrega', label: 'Nova Entrega' },
        { id: 'voltar', label: 'Voltar' },
        { id: 'reimprimir', label: 'Reimprimir' },
        { id: 'compartilhar_novamente', label: 'Compartilhar Novamente' }
      ],
      mobile: [
        { id: 'finalizar', label: 'Finalizar' },
        { id: 'permanecer', label: 'Permanecer no Resumo' }
      ]
    };

    const parcial = {
      id: comprovanteId,
      numeroComprovante,
      tipo: TIPOS_COMPROVANTE.ENTREGA,
      versao: MOTOR_COMPROVANTES_VERSAO,
      consignacaoId: id,
      clienteId,
      cabecalho,
      cards,
      indicadores,
      acoes,
      assinatura: null
    };

    const qrCode = await buildQrCode({
      id: comprovanteId,
      numeroComprovante,
      empresa: empresaNome,
      versao: MOTOR_COMPROVANTES_VERSAO
    });

    parcial.qrCode = qrCode;
    parcial.textoCompartilhavel = buildTextoCompartilhavel(parcial);
    parcial.pdf = buildPdfPayload(parcial);

    // snapshot é cópia imutável do payload oficial
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

module.exports = ComprovanteEntregaBuilder;
