'use strict';

const db = require('../../database');
const { emitirPorVendaId } = require('../fiscal/emissor');
const cancelarNfce = require('../fiscal/cancelarNfce');
const tefManager = require('../tef/TefManager');

function extrairTagXmlCancelamento(xml, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = String(xml || '').match(regex);
  return match ? match[1] : null;
}

function extrairCancelamentoSefaz(xml) {
  const texto = String(xml || '');
  const blocoEventoMatch = texto.match(/<retEvento[\s\S]*?<\/retEvento>/i);
  const blocoEvento = blocoEventoMatch ? blocoEventoMatch[0] : texto;

  return {
    cStatEvento: extrairTagXmlCancelamento(blocoEvento, 'cStat'),
    xMotivoEvento: extrairTagXmlCancelamento(blocoEvento, 'xMotivo'),
    protocoloCancelamento: extrairTagXmlCancelamento(blocoEvento, 'nProt'),
    dataCancelamento: extrairTagXmlCancelamento(blocoEvento, 'dhRegEvento')
  };
}

function buscarNfceAutorizadaVenda(vendaId, callback) {
  db.get(`
    SELECT id, status
    FROM nfce_notas
    WHERE venda_id = ?
      AND status IN ('autorizada', 'cancelamento_rejeitado')
      AND (
        (chave_acesso IS NOT NULL AND chave_acesso <> '')
        OR (xml_retorno IS NOT NULL AND xml_retorno LIKE '%<cStat>100</cStat>%')
      )
    ORDER BY id DESC
    LIMIT 1
  `, [vendaId], callback);
}

async function cancelarNfceAutorizadaVenda(vendaId, justificativa) {
  const cancelamento = await cancelarNfce(vendaId, justificativa.trim());
  const retornoTexto = typeof cancelamento.sefaz === 'string'
    ? cancelamento.sefaz
    : JSON.stringify(cancelamento.sefaz);
  const dadosCancelamento = extrairCancelamentoSefaz(retornoTexto);
  const canceladoComSucesso =
    String(dadosCancelamento.cStatEvento) === '135' ||
    String(dadosCancelamento.cStatEvento) === '136' ||
    String(dadosCancelamento.cStatEvento) === '155';

  if (!canceladoComSucesso) {
    throw new Error(dadosCancelamento.xMotivoEvento || 'Cancelamento de NFC-e rejeitado pela SEFAZ.');
  }

  await new Promise((resolve, reject) => {
    const resumoCancelamento = `
STATUS CANCELAMENTO: cancelada
cStatEvento: ${dadosCancelamento.cStatEvento || ''}
xMotivoEvento: ${dadosCancelamento.xMotivoEvento || ''}
protocoloCancelamento: ${dadosCancelamento.protocoloCancelamento || ''}
dataCancelamento: ${dadosCancelamento.dataCancelamento || ''}
justificativa: ${justificativa.trim()}
`;

    db.run(`
      UPDATE nfce_notas
      SET status = 'cancelada',
          xml_retorno = COALESCE(xml_retorno, '') || char(10) || ? || char(10) || ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [resumoCancelamento, retornoTexto, cancelamento.notaId], (updErr) => {
      if (updErr) return reject(updErr);
      resolve();
    });
  });
}

async function vincularNfceTransacoesVenda(vendaId, fiscal) {
  if (!fiscal?.success || !fiscal?.numero || !fiscal?.chave) {
    return;
  }

  const rows = await new Promise((resolve, reject) => {
    db.all(`
      SELECT tef_transacao_id
      FROM venda_recebimentos
      WHERE venda_id = ? AND tef_transacao_id IS NOT NULL
    `, [vendaId], (err, result) => {
      if (err) return reject(err);
      resolve(result || []);
    });
  });

  for (const row of rows) {
    try {
      await tefManager.vincularNfce(row.tef_transacao_id, fiscal.numero, fiscal.chave);
    } catch (vincError) {
      console.error(`Erro ao vincular NFC-e à transação TEF ${row.tef_transacao_id}:`, vincError);
    }
  }
}

async function emitirFiscalSeSolicitado(vendaId, emitirFiscal, venda) {
  const emitirExplicito = emitirFiscal === true
    || emitirFiscal === 'true'
    || emitirFiscal === 1
    || emitirFiscal === '1';

  if (!emitirExplicito) {
    return null;
  }

  if (Number(venda?.valor_fiscal || 0) <= 0) {
    return {
      status: 'sem_itens_fiscais',
      message: 'Venda sem itens fiscais. NFC-e não necessária.'
    };
  }

  try {
    const fiscal = await emitirPorVendaId(vendaId);

    if (fiscal?.status === 'sem_itens_fiscais') {
      return fiscal;
    }

    await vincularNfceTransacoesVenda(vendaId, fiscal);
    return fiscal;
  } catch (error) {
    console.error('Erro ao emitir NFC-e após pagamento não fiscal:', error);
    return {
      success: false,
      status: 'erro_emissao',
      message: error.message
    };
  }
}

async function responderVendaComFiscal(res, payload) {
  const t0 = Date.now();
  const mark = (label) => {
    console.log(`[STAB06-AUDIT] [${Date.now() - t0}ms] responderVendaComFiscal: ${label}`);
  };
  mark(`entrou emitirFiscal=${!!payload.emitirFiscal} valorFiscal=${payload.valorFiscal}`);

  const { resolverStatusPagamentoVenda } = require('./VendaPagamentoService');
  const valorFiscal = Number(payload.valorFiscal || 0);
  const valorNaoFiscal = Number(payload.valorNaoFiscal || 0);
  const statusInformado = payload.statusPagamento || 'quitada';

  // Se o orquestrador já quitou (PIX único cobrindo fiscal+NF), respeitar.
  // Não recalcular com recebimentos vazios — isso forçava aguardando_nao_fiscal
  // e impedia a NFC-e mesmo com a venda totalmente paga.
  const statusPagamento = statusInformado === 'quitada'
    ? 'quitada'
    : resolverStatusPagamentoVenda(
      valorNaoFiscal,
      Array.isArray(payload.recebimentos) ? payload.recebimentos.filter((r) =>
        String(r.tipo_recebimento || '').toLowerCase() === 'nao_fiscal'
      ) : [],
      statusInformado,
      { valorFiscal }
    );

  const respostaBase = {
    id: payload.vendaId,
    venda_id: payload.vendaId,
    codigo: payload.codigo,
    message: payload.message,
    status_pagamento: statusPagamento,
    valor_fiscal: valorFiscal,
    valor_nao_fiscal: valorNaoFiscal
  };

  if (!payload.emitirFiscal) {
    mark('skip fiscal — res.json imediato');
    return res.json({
      ...respostaBase,
      fiscal: null
    });
  }

  if (Number(payload.valorFiscal || 0) <= 0) {
    mark('sem valor fiscal — res.json imediato');
    return res.json({
      ...respostaBase,
      fiscal: null
    });
  }

  if (statusPagamento !== 'quitada') {
    mark('aguardando_pagamento — res.json sem emitir');
    return res.json({
      ...respostaBase,
      fiscal: {
        success: false,
        status: 'aguardando_pagamento',
        message: 'Aguardando pagamento não fiscal para emitir NFC-e.'
      }
    });
  }

  // NFC-e NÃO bloqueia o POST /vendas.
  // A venda já foi COMMIT antes desta função; o PDV emite em
  // POST /fiscal/emitir/venda/:id (timeout dedicado + modal de reemissão).
  mark('res.json imediato — NFC-e assíncrona via endpoint dedicado');
  return res.json({
    ...respostaBase,
    fiscal: {
      status: 'pendente_emissao',
      message: 'Venda registrada. Emitindo NFC-e...'
    }
  });
}

module.exports = {
  extrairTagXmlCancelamento,
  extrairCancelamentoSefaz,
  buscarNfceAutorizadaVenda,
  cancelarNfceAutorizadaVenda,
  vincularNfceTransacoesVenda,
  emitirFiscalSeSolicitado,
  responderVendaComFiscal
};
