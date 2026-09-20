/**
 * ORQUESTRADOR DE PAGAMENTOS - ARQUITETURA OFICIAL CDS SISTEMAS
 * 
 * Este é o ÚNICO local onde todas as decisões de pagamento devem existir.
 * O frontend (PDV) NÃO deve tomar nenhuma decisão de fluxo de pagamento.
 * 
 * FLUXO OBRIGATÓRIO:
 * Venda → Motor Fiscal → MIDP (valor_fiscal, valor_nao_fiscal → pagamentos) → 
 * Motor Financeiro → 1º Recebimento Fiscal → Confirmação (TEF/Manual) → 
 * status = aguardando_nao_fiscal → 2º Recebimento Não Fiscal → 
 * status = quitada → NFC-e
 *
 * A distribuição de meios (Fiscal × Não Fiscal) é responsabilidade exclusiva do MIDP.
 * Este orquestrador apenas consome o MidpResult.
 */

const tefManager = require('./tef/TefManager');
const tefContrato = require('./tef/tefContrato');
const tefConfigService = require('./tef/tefConfigService');
const tefFluxoPagamento = require('./tef/tefFluxoPagamento');
const MidpService = require('../motores/midp/MidpService');
const {
  TOLERANCIA_MONETARIA,
  obterTotalFiscalFinal,
  pagamentoFiscalSuficiente,
  somarPagamentos,
  logAuditoriaPagamentoFiscal
} = require('./vendas/TotalFiscalFinal');

/**
 * Converte MidpResult no formato legado interno do orquestrador.
 */
function mapearMidpParaDistribuicao(midpResult) {
  if (midpResult && typeof midpResult.paraDistribuicaoLegada === 'function') {
    return midpResult.paraDistribuicaoLegada();
  }

  const pagamentosFiscal = midpResult?.pagamentosFiscal || midpResult?.recebimentosFiscal || [];
  const pagamentosNaoFiscal = midpResult?.pagamentosNaoFiscal || midpResult?.recebimentosNaoFiscal || [];

  return {
    recebimentosFiscal: pagamentosFiscal,
    recebimentosNaoFiscal: pagamentosNaoFiscal,
    saldoFiscal: Number(midpResult?.saldoFiscal || 0),
    saldoNaoFiscal: Number(midpResult?.saldoNaoFiscal || 0)
  };
}

/**
 * Processa o fluxo completo de pagamento de uma venda
 * Esta é a entrada principal do orquestrador
 *
 * @param {object} params
 * @param {import('../motores/midp/MidpResult')} [params.midpResult] — resultado do MidpService.distribuir()
 * @param {string} [params.origem] — origem da venda (log MIDP, se midpResult omitido)
 */
async function processarFluxoPagamentoVenda({
  totalFiscal,
  totalNaoFiscal,
  descontoFiscal,
  formaPagamento,
  pagamentos,
  tefHabilitado,
  modoConfirmacaoFiscal,
  midpResult,
  origem
}) {
  // Validações básicas
  totalFiscal = Number(totalFiscal || 0);
  totalNaoFiscal = Number(totalNaoFiscal || 0);

  // Distribuição exclusiva via MIDP (nunca DistribuidorPagamento direto)
  const resultadoMidp = midpResult || MidpService.distribuir({
    valorFiscal: totalFiscal,
    valorNaoFiscal: totalNaoFiscal,
    pagamentos: Array.isArray(pagamentos) ? pagamentos : [],
    formaPagamentoPadrao: formaPagamento,
    origem: origem || 'ORQUESTRADOR'
  });

  const distribuicao = mapearMidpParaDistribuicao(resultadoMidp);

  // RC4.31 — única validação de pagamento fiscal (total líquido / vNF)
  const totalFiscalFinal = obterTotalFiscalFinal({
    valorProdutosFiscal: totalFiscal,
    descontoFiscal: Number(descontoFiscal || 0)
  });
  let distribuicaoEfetiva = distribuicao;
  let resultadoMidpEfetivo = resultadoMidp;
  let valorPagoFiscal = somarPagamentos(distribuicaoEfetiva.recebimentosFiscal);
  let saldoFiscal = Number(distribuicaoEfetiva.saldoFiscal || 0);
  const valorPagoInformado = somarPagamentos(pagamentos);

  let suficiente = pagamentoFiscalSuficiente(valorPagoFiscal, totalFiscalFinal)
    && saldoFiscal <= TOLERANCIA_MONETARIA;

  // Rede de segurança: PRESERVAR_DINHEIRO pode ter usado itens brutos e deixado saldo,
  // embora o pagamento informado cubra o total fiscal líquido. Redistribui só o pagamento.
  if (!suficiente && pagamentoFiscalSuficiente(valorPagoInformado, totalFiscalFinal)) {
    resultadoMidpEfetivo = MidpService.distribuir({
      valorFiscal: totalFiscalFinal,
      valorNaoFiscal: totalNaoFiscal,
      pagamentos: Array.isArray(pagamentos) ? pagamentos : [],
      formaPagamentoPadrao: formaPagamento,
      origem: `${origem || 'ORQUESTRADOR'}:RC431`,
      midpPolitica: 'LEGADO'
    });
    distribuicaoEfetiva = mapearMidpParaDistribuicao(resultadoMidpEfetivo);
    valorPagoFiscal = somarPagamentos(distribuicaoEfetiva.recebimentosFiscal);
    saldoFiscal = Number(distribuicaoEfetiva.saldoFiscal || 0);
    suficiente = pagamentoFiscalSuficiente(valorPagoFiscal, totalFiscalFinal)
      && saldoFiscal <= TOLERANCIA_MONETARIA;
  }

  logAuditoriaPagamentoFiscal({
    classe: 'OrquestradorPagamento',
    metodo: 'processarFluxoPagamentoVenda',
    valorProdutos: totalFiscal,
    valorDesconto: Number(descontoFiscal || 0),
    valorLiquido: totalFiscalFinal,
    valorFiscal: totalFiscalFinal,
    valorPago: valorPagoFiscal,
    valorComparado: totalFiscalFinal,
    saldoFiscal,
    suficiente
  });

  if (!suficiente) {
    return {
      sucesso: false,
      erro: 'Pagamento fiscal insuficiente.',
      distribuicao: distribuicaoEfetiva,
      midp: resultadoMidpEfetivo
    };
  }
  
  // Processar recebimento fiscal (TEF ou Confirmação Manual)
  const resultadoFiscal = await processarRecebimentoFiscal({
    recebimentosFiscal: distribuicaoEfetiva.recebimentosFiscal,
    totalFiscal,
    tefHabilitado,
    modoConfirmacaoFiscal,
    formaPagamento
  });
  
  if (!resultadoFiscal.sucesso) {
    return {
      sucesso: false,
      erro: resultadoFiscal.erro,
      tef: resultadoFiscal.tef,
      distribuicao: distribuicaoEfetiva,
      midp: resultadoMidpEfetivo
    };
  }
  
  // Determinar status do pagamento (somente recebimentos confirmados, nunca o plano do distribuidor)
  // Venda mista: se o MIDP já cobriu o não fiscal (saldoNaoFiscal ≈ 0) com os meios
  // informados (ex.: PIX único R$10 → fiscal 5 + NF 5), confirma as duas etapas de uma vez.
  // Caso contrário, mantém 2ª etapa (aguardando_nao_fiscal).
  const saldoNf = Number(distribuicaoEfetiva.saldoNaoFiscal || 0);
  const nfJaCobertoPeloMidp =
    totalFiscal > 0
    && totalNaoFiscal > 0
    && saldoNf <= 0.01
    && Array.isArray(distribuicaoEfetiva.recebimentosNaoFiscal)
    && distribuicaoEfetiva.recebimentosNaoFiscal.length > 0;

  const recebimentosNaoFiscalConfirmados = nfJaCobertoPeloMidp
    ? (distribuicaoEfetiva.recebimentosNaoFiscal || [])
    : (
      totalFiscal > 0 && totalNaoFiscal > 0
        ? []
        : (distribuicaoEfetiva.recebimentosNaoFiscal || [])
    );

  const statusPagamento = determinarStatusPagamento({
    totalFiscal,
    totalNaoFiscal,
    fiscalProcessado: resultadoFiscal.sucesso,
    recebimentosNaoFiscalConfirmados
  });

  console.log('[ORQUESTRADOR] statusPagamento=', statusPagamento, {
    totalFiscal,
    totalNaoFiscal,
    saldoNf,
    nfJaCobertoPeloMidp
  });

  // Montar recebimentos para gravar
  const recebimentosParaGravar = montarRecebimentosParaGravar({
    distribuicao: distribuicaoEfetiva,
    statusPagamento,
    totalFiscal,
    totalNaoFiscal,
    resultadoFiscal
  });
  
  return {
    sucesso: true,
    statusPagamento,
    recebimentos: recebimentosParaGravar,
    distribuicao: distribuicaoEfetiva,
    midp: resultadoMidpEfetivo,
    resultadoFiscal,
    proximaAcao: determinarProximaAcao(statusPagamento, totalNaoFiscal)
  };
}

function comTimeout(promise, ms, mensagem) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(mensagem)), ms);
    })
  ]);
}

/**
 * Processa o recebimento fiscal (TEF ou Confirmação Manual)
 */
async function processarRecebimentoFiscal({
  recebimentosFiscal,
  totalFiscal,
  tefHabilitado,
  modoConfirmacaoFiscal,
  formaPagamento
}) {
  // Se não há fiscal, não processa nada
  if (totalFiscal <= 0 || !recebimentosFiscal || recebimentosFiscal.length === 0) {
    return { sucesso: true, tipo: 'sem_fiscal' };
  }

  console.log('[ORQUESTRADOR] processarRecebimentoFiscal', {
    totalFiscal,
    formaPagamento,
    tefHabilitado,
    modoConfirmacaoFiscal,
    qtdRecebimentos: recebimentosFiscal.length,
    jaTemTef: recebimentosFiscal.some((r) => !!r.tef_transacao_id)
  });
  
  // Determinar se deve usar TEF ou confirmação manual
  const deveUsarTef = await deveUsarTEFParaFiscal({
    tefHabilitado,
    modoConfirmacaoFiscal,
    formaPagamento,
    totalFiscal,
    recebimentosFiscal
  });

  console.log('[ORQUESTRADOR] deveUsarTef=', deveUsarTef);
  
  if (deveUsarTef) {
    return await processarTEFFiscal(recebimentosFiscal);
  }
  return await processarConfirmacaoManualFiscal(recebimentosFiscal);
}

/**
 * Processa TEF para recebimentos fiscais
 */
async function processarTEFFiscal(recebimentosFiscal) {
  const tefConfig = await comTimeout(
    tefConfigService.obterConfiguracao(),
    10000,
    'Timeout ao obter configuração TEF'
  );
  const tefOn = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
  
  if (!tefOn) {
    // TEF desligado: não bloqueia a venda — confirma fiscal manualmente
    console.log('[ORQUESTRADOR] TEF desabilitado — confirmação manual do fiscal');
    return processarConfirmacaoManualFiscal(recebimentosFiscal);
  }
  
  // Filtrar apenas recebimentos que exigem TEF
  const recebimentosTEF = recebimentosFiscal.filter(r => 
    tefFluxoPagamento.formaPagamentoUsaTEF(r.forma_pagamento)
  );
  
  if (recebimentosTEF.length === 0) {
    return { sucesso: true, tipo: 'manual', recebimentos: recebimentosFiscal };
  }

  // PDV já autorizou no pinpad — não reautorizar (evita travar a venda)
  const pendentes = recebimentosTEF.filter((r) => !r.tef_transacao_id);
  if (pendentes.length === 0) {
    console.log('[ORQUESTRADOR] TEF já autorizado no PDV — pulando nova autorização');
    return {
      sucesso: true,
      tipo: 'tef_ja_autorizado',
      transacoes: recebimentosTEF.map((r) => r.tef_transacao_id).filter(Boolean),
      recebimentos: recebimentosFiscal
    };
  }
  
  const transacoesAutorizadas = [];
  
  for (const recebimento of recebimentosTEF) {
    if (recebimento.tef_transacao_id) {
      transacoesAutorizadas.push(recebimento.tef_transacao_id);
      continue;
    }
    
    try {
      const tipoTef = tefFluxoPagamento.normalizarTipoTef(recebimento.forma_pagamento);
      console.log('[ORQUESTRADOR] Autorizando TEF', {
        forma: recebimento.forma_pagamento,
        tipo: tipoTef,
        valor: recebimento.valor
      });

      const retornoTEF = await comTimeout(
        tefManager.autorizar({
          venda_id: null,
          tipo: tipoTef,
          valor: recebimento.valor,
          parcelas: 1
        }),
        Number(process.env.TEF_TIMEOUT_MS) || 35000,
        'Timeout na autorização TEF — venda não efetivada. Verifique pinpad/TEF ou use confirmação manual.'
      );
      
      if (!tefContrato.estaAprovado(retornoTEF)) {
        for (const transacaoId of transacoesAutorizadas) {
          try {
            await tefManager.cancelar(transacaoId, 'Pagamento fiscal não aprovado');
          } catch (cancelError) {
            console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
          }
        }
        return { 
          sucesso: false, 
          erro: retornoTEF.mensagem || 'Pagamento TEF não aprovado',
          tef: retornoTEF 
        };
      }
      
      if (retornoTEF.transacao_id) {
        transacoesAutorizadas.push(retornoTEF.transacao_id);
        recebimento.tef_transacao_id = retornoTEF.transacao_id;
        recebimento.nsu = retornoTEF.nsu;
        recebimento.autorizacao = retornoTEF.autorizacao;
      }
    } catch (error) {
      console.error('Erro ao autorizar pagamento TEF fiscal:', error);
      for (const transacaoId of transacoesAutorizadas) {
        try {
          await tefManager.cancelar(transacaoId, 'Erro no pagamento fiscal');
        } catch (cancelError) {
          console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
        }
      }
      return { sucesso: false, erro: error.message };
    }
  }
  
  return { 
    sucesso: true, 
    tipo: 'tef', 
    transacoes: transacoesAutorizadas,
    recebimentos: recebimentosFiscal 
  };
}

/**
 * Processa confirmação manual do recebimento fiscal
 */
async function processarConfirmacaoManualFiscal(recebimentosFiscal) {
  // Confirmação manual apenas marca como aprovado
  const recebimentosConfirmados = recebimentosFiscal.map(r => ({
    ...r,
    status: 'aprovado'
  }));
  
  return { 
    sucesso: true, 
    tipo: 'manual', 
    recebimentos: recebimentosConfirmados 
  };
}

/**
 * Determina se deve usar TEF para pagamento fiscal
 */
async function deveUsarTEFParaFiscal({
  tefHabilitado,
  modoConfirmacaoFiscal,
  formaPagamento,
  totalFiscal,
  recebimentosFiscal
}) {
  if (totalFiscal <= 0) return false;
  
  const tefOn = tefFluxoPagamento.parseTefHabilitado(tefHabilitado);
  if (!tefOn) return false;
  
  const modoManual = String(modoConfirmacaoFiscal || 'TEF').toUpperCase() === 'MANUAL';
  if (modoManual) return false;

  // Já autorizado no PDV → ainda "usa TEF", mas processarTEFFiscal só valida/pula
  const recebimentos = Array.isArray(recebimentosFiscal) ? recebimentosFiscal : [];
  if (recebimentos.some((r) => r.tef_transacao_id)) {
    return true;
  }
  
  const formaNormalizada = tefFluxoPagamento.normalizarFormaPagamentoTEF(formaPagamento);
  if (!tefFluxoPagamento.formaPagamentoUsaTEF(formaNormalizada)) {
    return false;
  }

  // PIX sem operação PIX TEF habilitada → não trava pinpad; confirma fiscal direto
  if (formaNormalizada === 'pix' || formaNormalizada === 'pix_tef') {
    try {
      const cfg = await tefConfigService.obterConfiguracao();
      const pixTefOn = tefFluxoPagamento.parseTefHabilitado(cfg.pix);
      if (!pixTefOn) {
        console.log('[ORQUESTRADOR] PIX sem operação PIX TEF — confirmação manual');
        return false;
      }
    } catch (error) {
      console.error('[ORQUESTRADOR] Falha ao ler operação PIX TEF:', error.message);
      return false;
    }
  }

  return true;
}

/**
 * Determina o status do pagamento.
 * A distribuição matemática NÃO confirma recebimento — apenas recebimentos efetivos.
 */
function determinarStatusPagamento({
  totalFiscal,
  totalNaoFiscal,
  fiscalProcessado,
  recebimentosNaoFiscalConfirmados
}) {
  const temFiscal = totalFiscal > 0;
  const temNaoFiscal = totalNaoFiscal > 0;
  const confirmados = Array.isArray(recebimentosNaoFiscalConfirmados)
    ? recebimentosNaoFiscalConfirmados
    : [];

  const totalConfirmadoNaoFiscal = confirmados.reduce(
    (acc, recebimento) => acc + Number(recebimento.valor || 0),
    0
  );
  const naoFiscalConfirmado =
    confirmados.length > 0
    && Math.abs(totalConfirmadoNaoFiscal - totalNaoFiscal) <= 0.01;

  if (!temFiscal && !temNaoFiscal) {
    return 'quitada';
  }

  // Venda mista: fiscal + não fiscal — 2ª etapa obrigatória
  if (temFiscal && temNaoFiscal) {
    if (!fiscalProcessado) {
      return 'pendente';
    }

    if (naoFiscalConfirmado) {
      return 'quitada';
    }

    return 'aguardando_nao_fiscal';
  }

  // Venda somente não fiscal — pagamento único na criação
  if (!temFiscal && temNaoFiscal) {
    return naoFiscalConfirmado ? 'quitada' : 'pendente';
  }

  // Venda somente fiscal
  if (temFiscal && !temNaoFiscal) {
    return fiscalProcessado ? 'quitada' : 'pendente';
  }

  return 'pendente';
}

/**
 * Monta os recebimentos para gravar no banco.
 * Venda mista na 1ª etapa grava somente recebimentos fiscais.
 */
function montarRecebimentosParaGravar({
  distribuicao,
  statusPagamento,
  totalFiscal,
  totalNaoFiscal,
  resultadoFiscal
}) {
  const { recebimentosFiscal, recebimentosNaoFiscal } = distribuicao;
  const vendaMista = Number(totalFiscal || 0) > 0 && Number(totalNaoFiscal || 0) > 0;
  // Só grava fiscal na 1ª etapa enquanto aguarda NF; se já quitada, grava os dois.
  const somenteFiscal = statusPagamento === 'aguardando_nao_fiscal';

  if (somenteFiscal) {
    return (recebimentosFiscal || []).map((recebimento) => ({
      ...recebimento,
      tipo_recebimento: 'fiscal',
      status: 'aprovado'
    }));
  }

  return [
    ...(recebimentosFiscal || []).map((recebimento) => ({
      ...recebimento,
      tipo_recebimento: recebimento.tipo_recebimento || 'fiscal',
      status: 'aprovado'
    })),
    ...(recebimentosNaoFiscal || []).map((recebimento) => ({
      ...recebimento,
      tipo_recebimento: 'nao_fiscal',
      status: 'aprovado'
    }))
  ];
}

/**
 * Determina a próxima ação a ser executada
 */
function determinarProximaAcao(statusPagamento, totalNaoFiscal) {
  if (statusPagamento === 'aguardando_nao_fiscal') {
    return 'registrar_pagamento_nao_fiscal';
  }
  
  if (statusPagamento === 'quitada' && totalNaoFiscal > 0) {
    return 'emitir_nfce';
  }
  
  if (statusPagamento === 'quitada') {
    return 'concluida';
  }
  
  return 'aguardando';
}

/**
 * Processa o pagamento não fiscal (segunda etapa do fluxo)
 */
async function processarPagamentoNaoFiscal({
  vendaId,
  valorNaoFiscal,
  pagamentosInformados
}) {
  const totalInformado = pagamentosInformados.reduce(
    (acc, p) => acc + Number(p.valor || 0),
    0
  );
  
  if (Math.abs(totalInformado - valorNaoFiscal) > 0.01) {
    return {
      sucesso: false,
      erro: 'Valor informado não confere com o saldo não fiscal pendente.',
      saldo_pendente: valorNaoFiscal
    };
  }
  
  const recebimentos = pagamentosInformados.map(pagamento => ({
    tipo_recebimento: 'nao_fiscal',
    forma_pagamento: String(pagamento.forma_pagamento).toLowerCase().trim(),
    valor: Number(pagamento.valor || 0),
    tef_transacao_id: null,
    nsu: pagamento.nsu || null,
    autorizacao: pagamento.autorizacao || null,
    status: 'aprovado'
  }));
  
  return {
    sucesso: true,
    recebimentos,
    statusPagamento: 'quitada'
  };
}

module.exports = {
  processarFluxoPagamentoVenda,
  processarPagamentoNaoFiscal,
  determinarStatusPagamento,
  montarRecebimentosParaGravar
};
