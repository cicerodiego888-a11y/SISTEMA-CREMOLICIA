'use strict';

const db = require('../../database');
const moment = require('moment');
const configService = require('../configuracaoService');
const tefManager = require('../tef/TefManager');
const tefContrato = require('../tef/tefContrato');
const tefFluxoPagamento = require('../tef/tefFluxoPagamento');
const tefConfigService = require('../tef/tefConfigService');
const lotesService = require('../lotesService');
const { normalizarTipoVendaItem } = require('../vendaUnidadeHelpers');
const { separarItensDistribuidos } = require('../fiscalNaoFiscalService');
const OrquestradorPagamento = require('../OrquestradorPagamento');
const MidpService = require('../../motores/midp/MidpService');
const { distribuirItemVenda, parseVendaFiscalFlag } = require('../distribuidorEstoqueVenda');
const VendaFinanceiroService = require('./VendaFinanceiroService');
const VendaFiscalService = require('./VendaFiscalService');
const MotorEstoque = require('../../motores/motor-estoque');
const mcc = require('../../motores/motor-conversao-comercial');
const { publicarEventoPdvArMfe } = require('../../motores/motor-financeiro/adapters');
const { obterMotor, FeatureFlag } = require('../../motores/motor-financeiro');

const { agoraLocalBrasil, validarSomaPagamentosVenda } = VendaFinanceiroService;
const { emitirFiscalSeSolicitado, responderVendaComFiscal } = VendaFiscalService;
const {
  aplicarDescontoProporcionalTotais,
  montarFiscalOperacionalPagamento,
  obterTotalFiscalFinal,
  inferirDescontoGlobal,
  somarPagamentos,
  logAuditoriaPagamentoFiscal
} = require('./TotalFiscalFinal');

/**
 * RC4.31 — totais brutos do motor fiscal → totais líquidos de pagamento (vNF).
 * Itens permanecem brutos; apenas o alvo MIDP/orquestrador usa o líquido.
 */
function resolverTotaisPagamentoComDesconto(fiscalOperacional, body = {}) {
  const brutoFiscal = Number(fiscalOperacional.totalFiscal || 0);
  const brutoNaoFiscal = Number(fiscalOperacional.totalNaoFiscal || 0);
  const acrescimo = Number(body.acrescimo || body.acrescimo_total || 0);
  const desconto = inferirDescontoGlobal({
    bruto: brutoFiscal + brutoNaoFiscal,
    desconto: Number(body.desconto || 0),
    acrescimo,
    totalInformado: body.total
  });
  const totaisLiquidos = aplicarDescontoProporcionalTotais({
    valorFiscal: brutoFiscal,
    valorNaoFiscal: brutoNaoFiscal,
    desconto,
    acrescimo
  });
  const valorFiscalPagamento = totaisLiquidos.valorFiscal;
  const valorNaoFiscalPagamento = totaisLiquidos.valorNaoFiscal;
  const totalFiscalFinal = obterTotalFiscalFinal({
    valorProdutosFiscal: brutoFiscal,
    descontoFiscal: totaisLiquidos.descontoFiscal,
    acrescimos: arredondarAcrescimoFiscal(brutoFiscal, brutoNaoFiscal, acrescimo)
  });
  const fiscalOperacionalPagamento = montarFiscalOperacionalPagamento(
    fiscalOperacional,
    {
      valorFiscal: valorFiscalPagamento,
      valorNaoFiscal: valorNaoFiscalPagamento
    }
  );
  const valorPago = somarPagamentos(body.pagamentos || []);

  logAuditoriaPagamentoFiscal({
    classe: 'VendaPagamentoService',
    metodo: 'resolverTotaisPagamentoComDesconto',
    valorProdutos: brutoFiscal + brutoNaoFiscal,
    valorDesconto: desconto,
    valorLiquido: valorFiscalPagamento + valorNaoFiscalPagamento,
    valorFiscal: valorFiscalPagamento,
    valorPago,
    valorComparado: totalFiscalFinal,
    saldoFiscal: null,
    suficiente: null
  });

  const omitirItensNoMidp = desconto > 0.009
    || (valorPago > 0 && valorPago + 0.01 < brutoFiscal);

  return {
    brutoFiscal,
    brutoNaoFiscal,
    totalFiscal: valorFiscalPagamento,
    totalNaoFiscal: valorNaoFiscalPagamento,
    totalFiscalFinal: valorFiscalPagamento,
    fiscalOperacionalPagamento,
    totaisLiquidos,
    // PRESERVAR_DINHEIRO com itens brutos ignora o líquido e recria o fiscal cheio.
    omitirItensNoMidp
  };
}

function totaisFluxoSemInflar(totaisFluxo, totalFiscalLiquido, totalNaoFiscalLiquido) {
  const fiscal = Number(totaisFluxo?.totalFiscal);
  const naoFiscal = Number(totaisFluxo?.totalNaoFiscal);
  return {
    totalFiscal: Number.isFinite(fiscal)
      ? Math.min(fiscal, Number(totalFiscalLiquido))
      : Number(totalFiscalLiquido),
    totalNaoFiscal: Number.isFinite(naoFiscal) ? naoFiscal : Number(totalNaoFiscalLiquido)
  };
}

function arredondarAcrescimoFiscal(brutoFiscal, brutoNaoFiscal, acrescimo) {
  const total = Number(brutoFiscal || 0) + Number(brutoNaoFiscal || 0);
  const acres = Number(acrescimo || 0);
  if (!(total > 0) || !(acres > 0)) return 0;
  return Number(((acres * Number(brutoFiscal || 0)) / total).toFixed(2));
}

const pdvOperacional = mcc.pdvOperacional || new mcc.PdvVendaOperacionalService({ mcc: mcc.motor });

function extrairQuantidadeBolasItem(item = {}) {
  const n = Number(item.quantidade_bolas);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function extrairSaboresItem(item = {}) {
  if (Array.isArray(item.sabores) && item.sabores.length) return item.sabores;
  if (Array.isArray(item.casquinha_sabores) && item.casquinha_sabores.length) {
    return item.casquinha_sabores;
  }
  return [];
}

function persistirSaboresCasquinha(vendaItemId, item, callback) {
  const sabores = extrairSaboresItem(item);
  if (!sabores.length) {
    callback(null);
    return;
  }
  try {
    const svc = require('../../modules/comercial/casquinha/CasquinhaSaboresService');
    svc.gravarSaboresDoItem(vendaItemId, sabores)
      .then(() => callback(null))
      .catch((err) => callback(err));
  } catch (err) {
    callback(err);
  }
}

/**
 * RCM-05.9 — persiste histórico do kit e baixa estoque dos componentes
 * (nunca do produto kit). Se não for kit, baixa o produto normalmente.
 */
function persistirKitEBaixarEstoque(
  pularBaixaEstoque,
  vendaItemId,
  item,
  quantidadeFiscal,
  quantidadeNaoFiscal,
  callback
) {
  let KitVendaService;
  try {
    KitVendaService = require('../../modules/comercial/kits/KitVendaService');
  } catch (_) {
    return reduzirEstoqueDistribuidoRespeitandoPolitica(
      pularBaixaEstoque,
      vendaItemId,
      item.produto_id,
      quantidadeFiscal,
      quantidadeNaoFiscal,
      callback
    );
  }

  KitVendaService.obterKitDaVendaItem(item)
    .then(async (kit) => {
      if (!kit) {
        reduzirEstoqueDistribuidoRespeitandoPolitica(
          pularBaixaEstoque,
          vendaItemId,
          item.produto_id,
          quantidadeFiscal,
          quantidadeNaoFiscal,
          callback
        );
        return;
      }

      const componentes = KitVendaService.calcularBaixaEstoque(
        kit,
        item.quantidade,
        item.kit_itens || item.itens_kit || null
      );
      await KitVendaService.gravarHistorico(vendaItemId, kit, componentes);

      if (pularBaixaEstoque || !componentes.length) {
        callback(null);
        return;
      }

      const totalFiscalKit = Number(quantidadeFiscal || 0);
      const totalNaoFiscalKit = Number(quantidadeNaoFiscal || 0);

      let idx = 0;
      const proximo = () => {
        if (idx >= componentes.length) {
          callback(null);
          return;
        }
        const c = componentes[idx++];
        const qtdComp = Number(c.quantidade || 0);
        if (!(qtdComp > 0)) {
          proximo();
          return;
        }
        const totalQtdKit = totalFiscalKit + totalNaoFiscalKit;
        let qFiscalComp = 0;
        let qNaoFiscalComp = qtdComp;
        if (totalQtdKit > 0) {
          qFiscalComp = Number(((qtdComp * totalFiscalKit) / totalQtdKit).toFixed(6));
          qNaoFiscalComp = Number((qtdComp - qFiscalComp).toFixed(6));
        }

        reduzirEstoqueDistribuido(
          vendaItemId,
          c.produto_id,
          qFiscalComp,
          qNaoFiscalComp,
          (estErr) => {
            if (estErr) return callback(estErr);
            proximo();
          }
        );
      };
      proximo();
    })
    .catch((err) => callback(err));
}


/** MFE-05.1 — FEATURE_MFE_PDV_AR */
function isPdvArBridgeAtivo() {
  try {
    return Boolean(obterMotor().featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_PDV_AR));
  } catch (_) {
    return false;
  }
}

/** Fire-and-forget: nunca bloqueia resposta do PDV */
function emitirEventoPdvArMfe(operacao) {
  Promise.resolve(publicarEventoPdvArMfe(db, operacao)).catch((err) => {
    console.error('[MFE-05.1] emitirEventoPdvArMfe:', err?.message || err);
  });
}

/**
 * PDV-01 — baixa estoque via MotorEstoque.sair (quantidade já em unidade base).
 * FEFO de lotes permanece como política oficial de consumo de validade.
 */
function reduzirEstoqueComFEFO(vendaItemId, produtoId, quantidade, itemFiscal, callback) {
  lotesService.produtoControlaValidade(produtoId, (err, controlaValidade) => {
    if (err) return callback(err);

    const sairMotor = (loteId) => {
      const qtd = Number(quantidade || 0);
      if (!(qtd > 0)) return callback(null);

      const fiscal = Number(itemFiscal) === 1;
      MotorEstoque.sair(db, {
        produtoId,
        quantidadeBase: qtd,
        quantidadeFiscal: fiscal ? qtd : 0,
        quantidadeNaoFiscal: fiscal ? 0 : qtd,
        origem: MotorEstoque.OrigemEstoque.PDV,
        loteId: loteId || null,
        referenciaTipo: 'venda_item',
        referenciaId: vendaItemId,
        motivo: `PDV_SAIDA:venda_item:${vendaItemId}`
      }).then(() => callback(null)).catch((estErr) => {
        const e = new Error(estErr?.message || String(estErr));
        e.status = estErr?.status || 500;
        e.codigo = estErr?.codigo;
        callback(e);
      });
    };

    if (!controlaValidade) {
      return sairMotor(null);
    }

    lotesService.consumirLotesFEFO(produtoId, quantidade, (consumoErr, consumoLotes) => {
      if (consumoErr) return callback(consumoErr);

      lotesService.registrarConsumoVenda(vendaItemId, consumoLotes, (registroErr) => {
        if (registroErr) return callback(registroErr);
        const primeiro = Array.isArray(consumoLotes) ? consumoLotes[0] : null;
        const loteId = primeiro?.lote_id ?? primeiro?.loteId ?? primeiro?.id ?? null;
        sairMotor(loteId);
      });
    });
  });
}

function reduzirEstoqueDistribuido(
  vendaItemId,
  produtoId,
  quantidadeFiscal,
  quantidadeNaoFiscal,
  callback
) {

  const executarNaoFiscal = () => {

    if (Number(quantidadeNaoFiscal || 0) <= 0) {
      return callback(null);
    }

    reduzirEstoqueComFEFO(
      vendaItemId,
      produtoId,
      quantidadeNaoFiscal,
      0,
      callback
    );

  };

  if (Number(quantidadeFiscal || 0) <= 0) {
    return executarNaoFiscal();
  }

  reduzirEstoqueComFEFO(
    vendaItemId,
    produtoId,
    quantidadeFiscal,
    1,
    (err) => {

      if (err) {
        return callback(err);
      }

      executarNaoFiscal();

    }
  );

}

/** STAB-06 — estoque já baixado na Entrega de consignação */
function isPoliticaEstoqueJaBaixado(body = {}) {
  const politica = body.politicaEstoque
    || (body.metadata && body.metadata.politicaEstoque)
    || null;
  return String(politica || '').toUpperCase() === 'JA_BAIXADO_CONSIGNACAO';
}

function isOrigemConsignacao(body = {}) {
  const origem = body.origem || (body.metadata && body.metadata.origem) || '';
  return String(origem).toUpperCase() === 'CONSIGNACAO'
    || String(origem).toUpperCase() === 'CONSIGNACAO_PRESTACAO';
}

/**
 * Origem semântica para log MIDP (não altera distribuição).
 * Todas as origens usam o mesmo MidpService — apenas o rótulo do log muda.
 */
function resolverOrigemMidp(body = {}) {
  const origemRaw = body.origem || (body.metadata && body.metadata.origem) || '';
  const origem = String(origemRaw || '').toUpperCase().trim();

  if (origem === 'CONSIGNACAO' || origem === 'CONSIGNACAO_PRESTACAO') {
    return 'CONSIGNACAO';
  }
  if (origem === 'COMERCIAL' || origem === 'VENDA_COMERCIAL') {
    return 'COMERCIAL';
  }
  if (origem === 'PEDIDO' || origem === 'PEDIDO_FATURADO') {
    return 'PEDIDO';
  }
  if (origem === 'ORCAMENTO' || origem === 'ORCAMENTO_CONVERTIDO') {
    return 'ORCAMENTO';
  }
  if (origem === 'PDV' || origem === '') {
    return origem === 'PDV' ? 'PDV' : 'PDV';
  }
  return origem || 'PDV';
}

/**
 * Único ponto de chamada à distribuição de meios (MIDP).
 * VendaPagamentoService nunca acessa DistribuidorPagamento diretamente.
 */
function distribuirPagamentosMidp({
  valorFiscal,
  valorNaoFiscal,
  pagamentos,
  formaPagamentoPadrao,
  origem,
  fiscalOperacional,
  itens
}) {
  return MidpService.distribuir({
    valorFiscal,
    valorNaoFiscal,
    pagamentos: Array.isArray(pagamentos) ? pagamentos : [],
    formaPagamentoPadrao,
    origem: origem || 'PDV',
    fiscalOperacional: fiscalOperacional || null,
    itens: Array.isArray(itens) ? itens : []
  });
}

/**
 * Aplica ajuste de quantidades/valores fiscais decidido pelo MIDP (PRESERVAR_DINHEIRO).
 * Não altera o total da venda — apenas move fiscal → não fiscal conforme a decisão.
 * RCF-07: sempre retorna array NOVO (nunca a mesma referência) — senão
 * `distribuicaoItens.length = 0` + re-push apaga os itens antes do INSERT.
 */
function aplicarDecisaoMidpNosItens(distribuicaoItens, decisao) {
  const base = Array.isArray(distribuicaoItens) ? distribuicaoItens : [];
  if (!decisao || !Array.isArray(decisao.itensAjuste) || decisao.itensAjuste.length === 0) {
    return base.map((item) => ({ ...item }));
  }
  return base.map((item, index) => {
    const adj = decisao.itensAjuste[index];
    if (!adj) return { ...item };
    return {
      ...item,
      quantidade_fiscal: Number(adj.quantidade_fiscal),
      quantidade_nao_fiscal: Number(adj.quantidade_nao_fiscal),
      valor_fiscal: Number(adj.valor_fiscal),
      valor_nao_fiscal: Number(adj.valor_nao_fiscal)
    };
  });
}

function lerTotaisDecisaoMidp(midpResult, totalFiscal, totalNaoFiscal) {
  const decisao = midpResult && midpResult.decisao ? midpResult.decisao : null;
  if (!decisao) {
    return { totalFiscal, totalNaoFiscal };
  }
  const efetivo = decisao.valorFiscalEfetivo != null
    ? Number(decisao.valorFiscalEfetivo)
    : Number(decisao.valorFiscalEfetivoProposto);
  return {
    totalFiscal: Number.isFinite(efetivo) ? efetivo : totalFiscal,
    totalNaoFiscal: Number(decisao.valorNaoFiscal != null ? decisao.valorNaoFiscal : totalNaoFiscal)
  };
}

function distribuirItemSemBaixaEstoque(item, vendaFiscal) {
  const qtd = Number(item.quantidade || 0);
  const preco = Number(item.preco_unitario || 0);
  const subtotal = Number((qtd * preco).toFixed(2));
  let qFiscal = item.quantidade_fiscal != null ? Number(item.quantidade_fiscal) : null;
  let qNao = item.quantidade_nao_fiscal != null ? Number(item.quantidade_nao_fiscal) : null;

  if (qFiscal == null && qNao == null) {
    if (parseVendaFiscalFlag(vendaFiscal)) {
      qFiscal = qtd;
      qNao = 0;
    } else {
      qFiscal = 0;
      qNao = qtd;
    }
  } else {
    qFiscal = Number(qFiscal || 0);
    qNao = Number(qNao || 0);
    if (Math.abs((qFiscal + qNao) - qtd) > 0.0001) {
      qNao = Math.max(0, qtd - qFiscal);
    }
  }

  const valorFiscal = Number((qFiscal * preco).toFixed(2));
  const valorNaoFiscal = Number((subtotal - valorFiscal).toFixed(2));

  return {
    ...item,
    quantidade_fiscal: qFiscal,
    quantidade_nao_fiscal: qNao,
    valor_fiscal: valorFiscal,
    valor_nao_fiscal: valorNaoFiscal,
    subtotal: item.subtotal != null ? item.subtotal : subtotal
  };
}

function reduzirEstoqueDistribuidoRespeitandoPolitica(
  pularBaixa,
  vendaItemId,
  produtoId,
  quantidadeFiscal,
  quantidadeNaoFiscal,
  callback
) {
  if (pularBaixa) {
    return callback(null);
  }
  return reduzirEstoqueDistribuido(
    vendaItemId,
    produtoId,
    quantidadeFiscal,
    quantidadeNaoFiscal,
    callback
  );
}

function atualizarStatusPagamentoVenda(vendaId, status, tefTransacaoId) {
  if (tefTransacaoId) {
    db.run(
      `UPDATE vendas SET status_pagamento = ?, tef_transacao_id = ? WHERE id = ?`,
      [status, tefTransacaoId, vendaId]
    );
  } else {
    db.run(
      `UPDATE vendas SET status_pagamento = ? WHERE id = ?`,
      [status, vendaId]
    );
  }
}

// Função para gravar recebimentos
function flattenRecebimentos(recebimentos) {
  if (!Array.isArray(recebimentos)) {
    return [];
  }

  return recebimentos.flatMap((item) => (Array.isArray(item) ? item : [item]));
}

function gravarRecebimentos(vendaId, recebimentos, callback, opcoes = {}) {
  const lista = flattenRecebimentos(recebimentos);
  const substituir = opcoes.substituir === true;

  function inserirTodos(errLimpeza) {
    if (errLimpeza) {
      callback(errLimpeza);
      return;
    }

    let index = 0;

    function next(err) {
      if (err) {
        callback(err);
        return;
      }
      if (index >= lista.length) {
        callback(null);
        return;
      }

      const r = lista[index++];

      db.run(`
        INSERT INTO venda_recebimentos
        (
          venda_id,
          tipo_recebimento,
          forma_pagamento,
          valor,
          tef_transacao_id,
          nsu,
          autorizacao,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        vendaId,
        r.tipo_recebimento,
        r.forma_pagamento,
        Number(r.valor || 0),
        r.tef_transacao_id || null,
        r.nsu || null,
        r.autorizacao || null,
        'aprovado'
      ], next);
    }

    next();
  }

  if (substituir) {
    // Remove órfãos de venda_id reutilizado (DELETE vendas sem cascade efetivo)
    db.run(
      'DELETE FROM venda_recebimentos WHERE venda_id = ?',
      [vendaId],
      inserirTodos
    );
    return;
  }

  inserirTodos(null);
}

/**
 * Origem do grupo <pag>: persistir o que o Orquestrador rateou (recebimentos),
 * nunca o array bruto acumulado do body quando já houver recebimentos.
 */
function resolverListaPagamentosPersistencia(recebimentos, pagamentosVenda) {
  const listaRecebimentos = flattenRecebimentos(recebimentos).filter(
    (r) => Number(r.valor || 0) > 0
  );
  if (listaRecebimentos.length > 0) {
    return listaRecebimentos;
  }
  return (Array.isArray(pagamentosVenda) ? pagamentosVenda : []).filter(
    (p) => Number(p.valor || 0) > 0
  );
}

function inserirLinhasVendaPagamentos(vendaId, lista, formaFallback, totalFallback, tef) {
  if (Array.isArray(lista) && lista.length > 0) {
    // Evita db.prepare/finalize dentro de transação (pode travar o event loop do sqlite3)
    lista.forEach((p) => {
      db.run(
        `
        INSERT INTO venda_pagamentos (
          venda_id, forma_pagamento, valor,
          tef_transacao_id, tef_nsu, tef_autorizacao,
          tef_bandeira, tef_adquirente,
          tef_comprovante_cliente, tef_comprovante_estabelecimento
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          vendaId,
          p.forma_pagamento,
          Number(p.valor || 0),
          p.tef_transacao_id || p.tef?.transacao_id || null,
          p.nsu || p.tef?.nsu || null,
          p.autorizacao || p.tef?.autorizacao || null,
          p.bandeira || p.tef?.bandeira || null,
          p.adquirente || p.tef?.adquirente || null,
          p.tef?.comprovante_cliente || null,
          p.tef?.comprovante_estabelecimento || null
        ],
        (err) => {
          if (err) console.error('[VENDA] Erro ao inserir venda_pagamentos:', err.message);
        }
      );
    });
    return;
  }

  db.run(
    `
    INSERT INTO venda_pagamentos (
      venda_id, forma_pagamento, valor,
      tef_transacao_id, tef_nsu, tef_autorizacao,
      tef_bandeira, tef_adquirente,
      tef_comprovante_cliente, tef_comprovante_estabelecimento
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      vendaId,
      formaFallback,
      Number(totalFallback || 0),
      tef?.transacao_id || null,
      tef?.nsu || null,
      tef?.autorizacao || null,
      tef?.bandeira || null,
      tef?.adquirente || null,
      tef?.comprovante_cliente || null,
      tef?.comprovante_estabelecimento || null
    ],
    (err) => {
      if (err) console.error('[VENDA] Erro ao inserir venda_pagamentos (fallback):', err.message);
    }
  );
}

// TEF exclusivo para recebimentos fiscais (conta empresa)
async function processarPagamentosTef(recebimentos) {
  let tefHabilitado = false;

  try {
    const tefConfig = await tefConfigService.obterConfiguracao();
    tefHabilitado = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
  } catch (error) {
    console.error('Erro ao verificar configuração TEF:', error);
    tefHabilitado = false;
  }

  if (!tefHabilitado) {
    console.log('TEF desabilitado, pulando autorização de pagamentos TEF');
    return { sucesso: true, transacoes: [] };
  }

  const pagamentosTef = recebimentos.filter((p) => {
    const forma = String(p.forma_pagamento || '').toLowerCase();
    return forma === 'cartao_debito'
      || forma === 'cartao_credito'
      || forma === 'cartao'
      || forma === 'pix'
      || forma === 'pix_tef';
  });

  if (pagamentosTef.length === 0) {
    return { sucesso: true, transacoes: [] };
  }

  const transacoesAutorizadas = [];

  for (const pagamento of pagamentosTef) {
    if (pagamento.tef_transacao_id) {
      transacoesAutorizadas.push(pagamento.tef_transacao_id);
      continue;
    }

    try {
      const tipoTef = tefFluxoPagamento.normalizarTipoTef(pagamento.forma_pagamento);
      const retornoTEF = await tefManager.autorizar({
        venda_id: null,
        tipo: tipoTef,
        valor: pagamento.valor,
        parcelas: 1
      });

      if (!tefContrato.estaAprovado(retornoTEF)) {
        // Cancelar transações anteriores
        for (const transacaoId of transacoesAutorizadas) {
          try {
            await tefManager.cancelar(transacaoId, 'Pagamento fiscal não aprovado');
          } catch (cancelError) {
            console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
          }
        }
        return { sucesso: false, erro: retornoTEF };
      }

      if (retornoTEF.transacao_id) {
        transacoesAutorizadas.push(retornoTEF.transacao_id);
        pagamento.tef_transacao_id = retornoTEF.transacao_id;
        pagamento.nsu = retornoTEF.nsu;
        pagamento.autorizacao = retornoTEF.autorizacao;
      }
    } catch (error) {
      console.error('Erro ao autorizar pagamento TEF fiscal:', error);
      // Cancelar transações anteriores
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

  return { sucesso: true, transacoes: transacoesAutorizadas };
}


const FORMAS_NAO_FISCAL_PERMITIDAS = new Set([
  'pix',
  'dinheiro',
  'cartao',
  'cartao_pf',
  'outro'
]);

const FORMAS_TEF_FISCAL = new Set([
  'cartao_debito',
  'cartao_credito'
]);

function calcularSaldoNaoFiscal(venda, recebimentosNaoFiscal) {
  const valorNaoFiscal = Number(venda.valor_nao_fiscal || 0);
  const recebimentos = filtrarRecebimentosDaVendaCorrente(
    venda,
    Array.isArray(recebimentosNaoFiscal) ? recebimentosNaoFiscal : []
  );
  const valorRecebido = recebimentos.reduce(
    (acc, r) => acc + Number(r.valor || 0),
    0
  );
  const saldoPendente = Math.round((valorNaoFiscal - valorRecebido) * 100) / 100;

  return {
    valorNaoFiscal,
    valorRecebido,
    saldoPendente: Math.max(0, saldoPendente)
  };
}

/**
 * Ignora recebimentos órfãos de vendas apagadas cujo venda_id foi reutilizado.
 */
function filtrarRecebimentosDaVendaCorrente(venda, recebimentos) {
  const lista = Array.isArray(recebimentos) ? recebimentos : [];
  if (!lista.length || !venda) return lista;

  const dataVenda = String(venda.data_venda || '').slice(0, 10);
  const inicioCodigo = extrairInicioTemporalDoCodigoVenda(venda.codigo);

  return lista.filter((r) => {
    const criado = String(r.created_at || '').trim();
    if (!criado) return true;

    if (inicioCodigo && criado < inicioCodigo) {
      return false;
    }

    if (dataVenda) {
      const diaCriado = criado.slice(0, 10);
      if (diaCriado && diaCriado < dataVenda) {
        return false;
      }
    }

    return true;
  });
}

function extrairInicioTemporalDoCodigoVenda(codigo) {
  const m = String(codigo || '').match(/VND-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  // Margem de 3h para divergência de fuso no código vs created_at
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(dt.getHours() - 3);
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  const s = String(dt.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function filtrarRecebimentosNaoFiscal(recebimentos) {
  return (Array.isArray(recebimentos) ? recebimentos : []).filter(
    (recebimento) => String(recebimento.tipo_recebimento || '').toLowerCase() === 'nao_fiscal'
  );
}

function resolverStatusPagamentoVenda(
  valorNaoFiscal,
  recebimentosNaoFiscal,
  statusAtual = 'quitada',
  opcoes = {}
) {
  const valor = Number(valorNaoFiscal || 0);
  const valorFiscal = Number(opcoes.valorFiscal || 0);
  const recebimentos = Array.isArray(recebimentosNaoFiscal) ? recebimentosNaoFiscal : [];

  if (valor <= 0 && valorFiscal <= 0) {
    return statusAtual;
  }

  const totalConfirmado = recebimentos.reduce(
    (acc, recebimento) => acc + Number(recebimento.valor || 0),
    0
  );
  const naoFiscalConfirmado =
    recebimentos.length > 0
    && Math.abs(totalConfirmado - valor) <= 0.01;

  // Venda mista (fiscal + não fiscal): 2ª etapa obrigatória
  if (valorFiscal > 0 && valor > 0) {
    return naoFiscalConfirmado ? statusAtual : 'aguardando_nao_fiscal';
  }

  // Venda somente não fiscal: pagamento único na criação — nunca aguarda 2ª etapa
  if (valorFiscal <= 0 && valor > 0) {
    if (naoFiscalConfirmado || statusAtual === 'quitada' || statusAtual === 'pendente') {
      return 'quitada';
    }
    return statusAtual;
  }

  // Venda somente fiscal
  return statusAtual;
}

function aplicarRegraStatusPagamentoVenda({
  valorFiscal,
  valorNaoFiscal,
  statusPagamento,
  recebimentos
}) {
  const recebimentosNaoFiscal = filtrarRecebimentosNaoFiscal(recebimentos);
  const statusFinal = resolverStatusPagamentoVenda(
    valorNaoFiscal,
    recebimentosNaoFiscal,
    statusPagamento,
    { valorFiscal }
  );

  let recebimentosFinal = Array.isArray(recebimentos) ? [...recebimentos] : [];

  if (statusFinal === 'aguardando_nao_fiscal') {
    recebimentosFinal = recebimentosFinal.filter(
      (recebimento) => String(recebimento.tipo_recebimento || '').toLowerCase() !== 'nao_fiscal'
    );
  }

  return {
    statusPagamento: statusFinal,
    recebimentos: recebimentosFinal
  };
}

function normalizarPagamentosNaoFiscal(body) {
  if (Array.isArray(body.pagamentos) && body.pagamentos.length > 0) {
    return body.pagamentos;
  }

  if (body.forma_pagamento && body.valor != null) {
    return [{
      forma_pagamento: body.forma_pagamento,
      valor: body.valor
    }];
  }

  return [];
}

function validarPagamentosNaoFiscal(pagamentos) {
  for (const pagamento of pagamentos) {
    const forma = String(pagamento.forma_pagamento || '').toLowerCase().trim();

    if (!forma) {
      return 'Informe a forma de pagamento não fiscal.';
    }

    if (FORMAS_TEF_FISCAL.has(forma) || pagamento.tef_transacao_id) {
      return 'Pagamento não fiscal não utiliza TEF.';
    }

    if (!FORMAS_NAO_FISCAL_PERMITIDAS.has(forma)) {
      return `Forma de pagamento não fiscal inválida: ${forma}.`;
    }

    if (Number(pagamento.valor || 0) <= 0) {
      return 'Valor do pagamento não fiscal deve ser maior que zero.';
    }
  }

  return null;
}

function obterTerminalId(req) {
  const rawId = req.body?.terminal_id || req.query?.terminal_id || req.headers['x-terminal-id'];
  const id = Number(rawId || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function preCalcularDistribuicao(req, res) {
const { itens, emitir_fiscal } = req.body;
const vendaFiscal = parseVendaFiscalFlag(emitir_fiscal);

if (!itens || !Array.isArray(itens) || itens.length === 0) {
  return res.status(400).json({
    sucesso: false,
    error: 'Itens da venda são obrigatórios.'
  });
}

if (itens.some((item) => item.produto_id === undefined || item.produto_id === null)) {
  return res.status(400).json({
    sucesso: false,
    error: 'Um ou mais itens da venda não possuem produto vinculado.'
  });
}

const produtoIds = Array.from(
  new Set(itens.map((item) => item.produto_id).filter((id) => id !== undefined && id !== null))
);

db.all(`
  SELECT
    id,
    nome,
    saldo_fiscal,
    saldo_nao_fiscal
  FROM produtos
  WHERE id IN (${produtoIds.map(() => '?').join(',')})
`, produtoIds, (err, produtos) => {
  if (err) {
    return res.status(500).json({ sucesso: false, error: err.message });
  }

  const produtoMap = produtos.reduce((map, produto) => {
    map[produto.id] = produto;
    return map;
  }, {});

  const itensDistribuidos = [];

  for (const item of itens) {
    const produto = produtoMap[item.produto_id];

    if (!produto) {
      return res.status(400).json({
        sucesso: false,
        error: `Produto ID ${item.produto_id} não encontrado`
      });
    }

    const resultado = distribuirItemVenda(
      item,
      Number(produto.saldo_fiscal || 0),
      Number(produto.saldo_nao_fiscal || 0),
      vendaFiscal
    );

    if (!resultado.sucesso) {
      return res.status(400).json({
        sucesso: false,
        error:
          `Saldo insuficiente para ${produto.nome}. ` +
          `Disponível: ${resultado.estoqueTotal}`
      });
    }

    itensDistribuidos.push({
      ...item,
      produto_id: item.produto_id,
      quantidade: item.quantidade,
      preco_unitario: item.preco_unitario,
      quantidade_fiscal: resultado.quantidadeFiscal,
      quantidade_nao_fiscal: resultado.quantidadeNaoFiscal,
      valor_fiscal: resultado.valorFiscal,
      valor_nao_fiscal: resultado.valorNaoFiscal,
      saldo_fiscal: Number(produto.saldo_fiscal),
      saldo_nao_fiscal: Number(produto.saldo_nao_fiscal)
    });
  }

  const { totalFiscal, totalNaoFiscal } = separarItensDistribuidos(itensDistribuidos);

  res.json({
    sucesso: true,
    valor_fiscal: totalFiscal,
    valor_nao_fiscal: totalNaoFiscal,
    itens: itensDistribuidos
  });
});
}

function resolverOrigemPdv(req) {
  const header = String(req.headers?.['x-cds-client'] || '').trim().toLowerCase();
  const raw = String(req.body?.origem_pdv || req.body?.origem_cliente || '').trim().toUpperCase();
  if (raw === 'PDV_MOBILE' || raw === 'MOBILE' || header === 'mobile') return 'PDV_MOBILE';
  if (raw === 'CONSIGNACAO' || raw === 'CONSIGNACAO_PRESTACAO') return 'CONSIGNACAO';
  if (raw === 'PEDIDO' || raw === 'NFE_MANUAL') return raw;
  if (raw === 'PDV_DESKTOP' || raw === 'DESKTOP' || raw === 'PDV') return 'PDV_DESKTOP';
  return 'PDV_DESKTOP';
}

function criarVenda(req, res) {
console.log('ENTROU NA ROTA DE EMISSAO NFC-E');
console.log('DADOS RECEBIDOS PARA EMISSAO:', req.body);

const {
  cliente_id,
  total,
  desconto,
  forma_pagamento,
  itens,
  parcelas,
  primeiro_vencimento,
  forcar,
  emitir_fiscal,
  valor_recebido,
  cpf_cnpj_nota,
  pagamentos,
  tef,
  valor_fiscal,
  valor_nao_fiscal,
  canal_venda
} = req.body;

const canalVendaGravar = String(canal_venda || 'VAREJO').trim().toUpperCase() || 'VAREJO';
const origemPdvGravar = resolverOrigemPdv(req);

const pularBaixaEstoque = isPoliticaEstoqueJaBaixado(req.body);
const origemConsignacao = isOrigemConsignacao(req.body);
const metaConsignacao = req.body.metadata || {};
const saldoEmAbertoConsignacao = Number(
  metaConsignacao.saldoEmAberto != null
    ? metaConsignacao.saldoEmAberto
    : Math.max(0, Number(total || 0) - Number(valor_recebido || 0))
);
const valorRecebidoConsignacao = Number(
  metaConsignacao.valorRecebido != null
    ? metaConsignacao.valorRecebido
    : (valor_recebido != null ? valor_recebido : total)
);
const forcarEfetivo = forcar || origemConsignacao;

const vendaFiscal = parseVendaFiscalFlag(emitir_fiscal);
// Venda faturada para NF-e modelo 55: prioriza a parcela fiscal, mas não emite NFC-e.
const documentoNfe55 = String(req.body.documento_fiscal || '').trim().toUpperCase() === 'NFE';
const emitirNfceAoConcluir = !!emitir_fiscal && !documentoNfe55;

const cpfCnpjNotaLimpo = String(cpf_cnpj_nota || '').replace(/\D/g, '');

if (cpfCnpjNotaLimpo && ![11, 14].includes(cpfCnpjNotaLimpo.length)) {
  return res.status(400).json({
    error: 'CPF/CNPJ informado na nota é inválido.'
  });
}

const pagamentosVenda = Array.isArray(pagamentos) ? pagamentos : [];

let formaPagamentoFinal = forma_pagamento;

if (pagamentosVenda.length > 1) {
  formaPagamentoFinal = "misto";
}

const erroSomaPagamentos = validarSomaPagamentosVenda(pagamentosVenda, total, {
  valor_fiscal,
  valor_nao_fiscal
});

if (erroSomaPagamentos) {
  return res.status(400).json({ error: erroSomaPagamentos });
}

const totalNum = Number(total);
const formasPendentes = ['prazo'];
const formaPagamentoNormalizada = String(forma_pagamento || '').toLowerCase().trim();
const vendaFicaPendente = formasPendentes.includes(formaPagamentoNormalizada);

const buscarNomeCliente = (callback) => {
  if (!cliente_id) {
    callback(null, null, null);
    return;
  }

  db.get(
    'SELECT nome, cpf_cnpj FROM clientes WHERE id = ?',
    [cliente_id],
    (err, cliente) => {
      if (err) {
        callback(err);
        return;
      }

      callback(null, cliente ? cliente.nome : null, cliente ? cliente.cpf_cnpj : null);
    }
  );
};

if (!itens || !Array.isArray(itens) || itens.length === 0) {
  res.status(400).json({ error: 'Informe ao menos um item na venda.' });
  return;
}
if (Number.isNaN(totalNum) || totalNum <= 0) {
  res.status(400).json({ error: 'Total inválido.' });
  return;
}

if (forma_pagamento === 'prazo' && !cliente_id) {
  return res.status(400).json({
    error: 'Cliente é obrigatório para venda a prazo.'
  });
}

const produtoIds = Array.from(new Set(itens.map(item => item.produto_id).filter(id => id !== undefined && id !== null)));

if (itens.some(item => item.produto_id === undefined || item.produto_id === null)) {
  res.status(400).json({ error: 'Um ou mais itens da venda não possuem produto vinculado.' });
  return;
}

db.all(`
  SELECT
    id,
    nome,
    saldo_fiscal,
    saldo_nao_fiscal,
    estoque_atual,
    produto_fracionado,
    vendido_por_peso,
    unidade
  FROM produtos
  WHERE id IN (${produtoIds.map(() => '?').join(',')})
`, produtoIds, (err, produtos) => {
  if (err) {
    res.status(500).json({ error: err.message });
    return;
  }

  const produtoMap = produtos.reduce((map, produto) => {
    map[produto.id] = produto;
    return map;
  }, {});

  const faltantes = itens.reduce((acumulador, item) => {
    const produto = produtoMap[item.produto_id];
    if (!produto) {
      acumulador.push(`Produto ID ${item.produto_id} não encontrado`);
    }
    return acumulador;
  }, []);

  if (faltantes.length > 0) {
    res.status(400).json({ error: 'Erro na venda: ' + faltantes.join('; ') });
    return;
  }

  const usuarioId = req.user?.id || req.usuario?.id || req.body.usuario_id || null;

  // PDV-01 — MCC converte comercial → base antes de distribuir / baixar estoque
  (async () => {
    let itensParaDistribuir = itens;
    if (!pularBaixaEstoque) {
      itensParaDistribuir = [];
      for (const item of itens) {
        try {
          const convertido = await pdvOperacional.processarItemVenda(db, {
            item,
            usuarioId
          });
          itensParaDistribuir.push(convertido);
        } catch (mccErr) {
          const status = mccErr?.status || 400;
          return res.status(status).json({
            error: mccErr?.message || String(mccErr),
            codigo: mccErr?.codigo || 'PDV_MCC_CONVERSAO'
          });
        }
      }
    }

    const distribuicaoItens = [];

    for (const item of itensParaDistribuir) {
      const produto = produtoMap[item.produto_id];

      if (pularBaixaEstoque) {
        const base = distribuirItemSemBaixaEstoque(item, vendaFiscal);
        distribuicaoItens.push({
          ...base,
          saldo_fiscal: Number(produto.saldo_fiscal),
          saldo_nao_fiscal: Number(produto.saldo_nao_fiscal),
          produto_fracionado: produto.produto_fracionado,
          vendido_por_peso: produto.vendido_por_peso,
          unidade: produto.unidade
        });
        continue;
      }

      const resultado = distribuirItemVenda(
        item,
        Number(produto.saldo_fiscal || 0),
        Number(produto.saldo_nao_fiscal || 0),
        vendaFiscal
      );

      if (!resultado.sucesso) {
        return res.status(400).json({
          error:
            `Saldo insuficiente para ${produto.nome}. ` +
            `Disponível: ${resultado.estoqueTotal}`
        });
      }

      distribuicaoItens.push({
        ...item,
        quantidade_fiscal: resultado.quantidadeFiscal,
        quantidade_nao_fiscal: resultado.quantidadeNaoFiscal,
        valor_fiscal: resultado.valorFiscal,
        valor_nao_fiscal: resultado.valorNaoFiscal,
        saldo_fiscal: Number(produto.saldo_fiscal),
        saldo_nao_fiscal: Number(produto.saldo_nao_fiscal),
        produto_fracionado: produto.produto_fracionado,
        vendido_por_peso: produto.vendido_por_peso,
        unidade: produto.unidade
      });
    }

    continuarCriarVendaAposDistribuicao(distribuicaoItens);
  })().catch((fatal) => {
    res.status(500).json({ error: fatal?.message || String(fatal) });
  });

  function continuarCriarVendaAposDistribuicao(distribuicaoItens) {

  // Venda a prazo exige cliente
  if (forma_pagamento === 'prazo') {
  if (!cliente_id) {
    res.status(400).json({ error: 'Cliente obrigatório para venda a prazo.' });
    return;
  }
  // Validar débitos e parcelas vencidas, a menos que forçar esteja ativo
  if (!forcarEfetivo) {
    const hoje = agoraLocalBrasil().slice(0, 10);
    db.get(`
      SELECT 
        SUM(CASE WHEN status = 'aberto' THEN valor_restante ELSE 0 END) as total_em_aberto,
        COUNT(CASE WHEN status = 'aberto' AND data_vencimento < ? THEN 1 END) as parcelas_vencidas
      FROM contas_receber
      WHERE cliente_id = ?
    `, [hoje, cliente_id], (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const totalEmAberto = Number(row?.total_em_aberto || 0);
      const parcelasVencidas = Number(row?.parcelas_vencidas || 0);
      if (totalEmAberto > 0 || parcelasVencidas > 0) {
        // Avisar operador e pedir confirmação
        res.status(409).json({
          aviso: 'Cliente possui débitos em aberto.',
          total_em_aberto: totalEmAberto,
          parcelas_vencidas: parcelasVencidas,
          pode_continuar: true
        });
        return;
      }
      executarVendaPrazo();
    });
    return;
  }
  // Função para executar venda a prazo
  executarVendaPrazo();
  async function executarVendaPrazo() {
    const codigo = `VND-${agoraLocalBrasil().replace(/[- :]/g, '').slice(0, 14)}`;
    const data_venda = agoraLocalBrasil().slice(0, 10);

    // Calcular valores fiscal e não fiscal (Motor Fiscal — intervalo oficial)
    const fiscalOperacional = separarItensDistribuidos(distribuicaoItens);
    // RC4.31 — pagamento valida contra total líquido (desconto global)
    const totaisPagamento = resolverTotaisPagamentoComDesconto(fiscalOperacional, req.body);
    const totalFiscal = totaisPagamento.totalFiscal;
    const totalNaoFiscal = totaisPagamento.totalNaoFiscal;
    const fiscalOperacionalPagamento = totaisPagamento.fiscalOperacionalPagamento;
    const itensMidp = totaisPagamento.omitirItensNoMidp ? [] : distribuicaoItens;

    // Obter configurações TEF e confirmação fiscal
    let tefHabilitado = false;
    let modoConfirmacaoFiscal = 'TEF';
    
    try {
      const tefConfig = await tefConfigService.obterConfiguracao();
      tefHabilitado = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
    } catch (error) {
      console.error('Erro ao verificar configuração TEF:', error);
    }
    
    modoConfirmacaoFiscal = configService.getModoConfirmacaoFiscal() || 'TEF';

    const origemMidp = resolverOrigemMidp(req.body);
    const midpResult = distribuirPagamentosMidp({
      valorFiscal: totalFiscal,
      valorNaoFiscal: totalNaoFiscal,
      pagamentos: req.body.pagamentos || [],
      formaPagamentoPadrao: formaPagamentoFinal,
      origem: origemMidp,
      fiscalOperacional: fiscalOperacionalPagamento,
      itens: itensMidp
    });

    const itensFinais = aplicarDecisaoMidpNosItens(distribuicaoItens, midpResult.decisao);
    // Propaga quantidades ajustadas para persistência / NFC-e
    console.log('[RCF-07.1] Itens após MIDP (prazo)', {
      venda_itens_recebidos: distribuicaoItens.length,
      itens_apos_midp: itensFinais.length,
      mesmaRef: itensFinais === distribuicaoItens,
      produtos: itensFinais.map((i) => i.produto_id),
      rc431_omitiu_itens: totaisPagamento.omitirItensNoMidp === true
    });
    if (!itensFinais.length && distribuicaoItens.length > 0) {
      console.error('[RCF-07.1] ABORT Rollback: MIDP zerou itens (prazo)');
      return res.status(500).json({
        error: 'RCF-07: Falha ao aplicar decisão MIDP — itens da venda foram perdidos.'
      });
    }
    distribuicaoItens.length = 0;
    itensFinais.forEach((it) => distribuicaoItens.push(it));
    console.log('[RCF-07.1] Itens prontos para persistência (prazo)', {
      qtd: distribuicaoItens.length
    });

    // RC4.31 — com desconto, o total de pagamento é o líquido; não deixar a decisão MIDP inflar.
    const totaisFluxo = totaisFluxoSemInflar(
      totaisPagamento.omitirItensNoMidp
        ? { totalFiscal, totalNaoFiscal }
        : lerTotaisDecisaoMidp(midpResult, totalFiscal, totalNaoFiscal),
      totalFiscal,
      totalNaoFiscal
    );
    const totalFiscalFluxo = totaisFluxo.totalFiscal;
    const totalNaoFiscalFluxo = totaisFluxo.totalNaoFiscal;

    // Processar fluxo de pagamento usando o Orquestrador (consome apenas MidpResult)
    const resultadoPagamento = await OrquestradorPagamento.processarFluxoPagamentoVenda({
      totalFiscal: totalFiscalFluxo,
      totalNaoFiscal: totalNaoFiscalFluxo,
      formaPagamento: formaPagamentoFinal,
      pagamentos: req.body.pagamentos || [],
      tefHabilitado,
      modoConfirmacaoFiscal,
      midpResult,
      origem: origemMidp
    });

    if (!resultadoPagamento.sucesso) {
      return res.status(400).json({
        error: resultadoPagamento.erro,
        tef: resultadoPagamento.tef
      });
    }

    const { resultadoFiscal } = resultadoPagamento;
    const resultadoStatus = aplicarRegraStatusPagamentoVenda({
      valorFiscal: totalFiscalFluxo,
      valorNaoFiscal: totalNaoFiscalFluxo,
      statusPagamento: resultadoPagamento.statusPagamento,
      recebimentos: resultadoPagamento.recebimentos
    });
    const { statusPagamento, recebimentos } = resultadoStatus;

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');
      db.run(`
        INSERT INTO vendas (codigo, data_venda, cliente_id, total, desconto, forma_pagamento, status, caixa_sessao_id, caixa_id, terminal_id, operador_id, valor_fiscal, valor_nao_fiscal, status_pagamento, tef_transacao_id, canal_venda, origem_pdv)
          VALUES (?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [codigo, data_venda, cliente_id, totalNum, desconto || 0, formaPagamentoFinal, req.caixaSessaoId || null, req.caixaId, req.terminalId || null, req.operadorId, totalFiscalFluxo, totalNaoFiscalFluxo, statusPagamento, resultadoFiscal?.transacoes?.[0] || null, canalVendaGravar, origemPdvGravar], function(err) {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json({ error: err.message });
          return;
        }
        const vendaId = this.lastID;

        gravarRecebimentos(
          vendaId,
          recebimentos,
          (err) => {
            if (err) {
              db.run('ROLLBACK');
              res.status(500).json({ error: err.message });
              return;
            }
          },
          { substituir: true }
        );

        const transacoesTefParaVincular = resultadoFiscal?.transacoes || [];

        if (tef && tef.transacao_id) {
          transacoesTefParaVincular.push(tef.transacao_id);
        }

        pagamentosVenda.forEach((p) => {
          const idTef = p.tef_transacao_id || p.tef?.transacao_id;
          if (idTef) {
            transacoesTefParaVincular.push(idTef);
          }
        });

        [...new Set(transacoesTefParaVincular)].forEach((transacaoId) => {
          db.run(`
            UPDATE tef_transacoes
            SET venda_id = ?
            WHERE id = ?
          `, [
            vendaId,
            transacaoId
          ], (tefErr) => {
            if (tefErr) {
              console.error('Erro ao vincular TEF à venda:', tefErr);
            }
          });
        });

        let itensProcessados = 0;
        distribuicaoItens.forEach(item => {
          const quantidadeFiscal =
            Number(
              item.quantidade_fiscal || 0
            );

          const quantidadeNaoFiscal =
            Number(
              item.quantidade_nao_fiscal || 0
            );

          const itemFiscal =
            quantidadeFiscal > 0
              ? 1
              : 0;

          const precoUnitario = Number(
            item.preco_unitario != null && item.preco_unitario !== ''
              ? item.preco_unitario
              : (item.preco != null && item.preco !== '' ? item.preco : 0)
          );
          const quantidadeItem = Number(
            item.quantidade != null && item.quantidade !== ''
              ? item.quantidade
              : (Number(quantidadeFiscal || 0) + Number(quantidadeNaoFiscal || 0))
          );
          if (!Number.isFinite(precoUnitario)) {
            db.run('ROLLBACK');
            res.status(400).json({ error: 'Preço unitário do item é obrigatório.' });
            return;
          }

          const valorFiscal =
            Number(
              (item.valor_fiscal || 0).toFixed(2)
            );

          const valorNaoFiscal =
            Number(
              (item.valor_nao_fiscal || 0).toFixed(2)
            );

          const tipoVenda = normalizarTipoVendaItem(item);

          db.run(`
            INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, desconto_percentual, promocao_id, desconto_atacado, tipo_preco, subtotal, item_fiscal, quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal, tipo_venda, unidade_comercial_id, unidade_comercial, fator_conversao, codigo_barras_comercial, quantidade_bolas, forma_comercializacao)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [vendaId, item.produto_id, quantidadeItem, precoUnitario, item.desconto_percentual || 0, item.promocao_id || null, item.desconto_atacado || 0, item.tipo_preco || 'varejo', item.subtotal, itemFiscal, quantidadeFiscal, quantidadeNaoFiscal, valorFiscal, valorNaoFiscal, tipoVenda, item.unidade_comercial_id || null, item.unidade_comercial || null, item.fator_conversao != null ? Number(item.fator_conversao) : 1, item.codigo_barras_comercial || null, extrairQuantidadeBolasItem(item), item.forma_comercializacao ? String(item.forma_comercializacao).toUpperCase() : null], function(itemErr) {
            if (itemErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: itemErr.message });
              return;
            }

            // RCF-07: callback clássico — arrow function quebrava this.lastID
            const vendaItemId = this.lastID;
            console.log('[RCF-07.1] Item persistido (prazo)', { vendaId, vendaItemId, produto_id: item.produto_id });
            persistirSaboresCasquinha(vendaItemId, item, (sabErr) => {
              if (sabErr) {
                db.run('ROLLBACK');
                res.status(500).json({ error: sabErr.message });
                return;
              }

            // RCM-05.9: kit → histórico + baixa componentes; senão baixa produto
            persistirKitEBaixarEstoque(pularBaixaEstoque, vendaItemId, item, item.quantidade_fiscal, item.quantidade_nao_fiscal, (estErr) => {
              if (estErr) {
                db.run('ROLLBACK');
                res.status(500).json({ error: estErr.message });
                return;
              }
              itensProcessados++;
              if (itensProcessados === distribuicaoItens.length) {
                const listaPagPersist = resolverListaPagamentosPersistencia(recebimentos, pagamentosVenda);
                console.log('[ORIGEM-PAG] venda_pagamentos (prazo)', {
                  vendaId,
                  recebimentos,
                  pagamentosBody: pagamentosVenda,
                  persistido: listaPagPersist
                });
                console.log('[RCF-07.1] COMMIT pronto (prazo)', { vendaId, itensPersistidos: itensProcessados });
                inserirLinhasVendaPagamentos(
                  vendaId,
                  listaPagPersist,
                  formaPagamentoFinal,
                  total,
                  tef
                );

                // Gerar parcelas (MFE-05.1: bridge ON → evento; OFF → INSERT legado)
                const qtdParcelas = Number(parcelas) || 1;
                const valorParcela = Math.round((totalNum / qtdParcelas) * 100) / 100;
                let vencimento = moment(primeiro_vencimento, 'YYYY-MM-DD');
                const parcelasAr = [];
                for (let i = 1; i <= qtdParcelas; i++) {
                  const dataVenc = vencimento.format('YYYY-MM-DD');
                  parcelasAr.push({
                    numero: i,
                    totalParcelas: qtdParcelas,
                    valor: valorParcela,
                    saldo: valorParcela,
                    vencimento: dataVenc
                  });
                  if (!isPdvArBridgeAtivo()) {
                    db.run(`
                      INSERT INTO contas_receber (venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela, valor_restante, data_vencimento, status)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto')
                    `, [vendaId, cliente_id, i, qtdParcelas, valorParcela, valorParcela, dataVenc]);
                  }
                  vencimento = vencimento.add(1, 'months');
                }
                if (isPdvArBridgeAtivo()) {
                  emitirEventoPdvArMfe({
                    tipo: 'venda_completa',
                    eventType: 'SALE_COMPLETED',
                    venda_id: vendaId,
                    cliente_id,
                    valor: totalNum,
                    total_parcelas: qtdParcelas,
                    data_vencimento: parcelasAr[0]?.vencimento,
                    parcelas: parcelasAr,
                    persistirTitulo: true,
                    idempotencyKey: `pdv-ar:sale:${vendaId}:prazo`
                  });
                }
                buscarNomeCliente((clienteErr, clienteNome, clienteCpf) => {
                  if (clienteErr) {
                    db.run('ROLLBACK');
                    res.status(500).json({ error: clienteErr.message });
                    return;
                  }

                  const inserirFinanceiroPrazo = (indice = 1, venc = moment(primeiro_vencimento, 'YYYY-MM-DD')) => {
                    if (indice > qtdParcelas) {
                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: commitErr.message });
                        }
                        responderVendaComFiscal(res, {
                          vendaId,
                          codigo,
                          message: 'Venda a prazo registrada com sucesso',
                          emitirFiscal: emitirNfceAoConcluir,
                          valorFiscal: totalFiscal,
                          valorNaoFiscal: totalNaoFiscal,
                          statusPagamento: statusPagamento,
                          pagamentosTef: pagamentosVenda
                        });
                      });
                      return;
                    }

                    db.run(`
                      INSERT INTO financeiro (
                        tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                        referencia_id, referencia_tipo, status, origem, documento, vencimento,
                        numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em
                      ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', 'pendente', 'venda', ?, ?, ?, ?, ?, ?, NULL)
                    `, [
                      `Venda ${codigo} - Parcela ${indice}/${qtdParcelas}`,
                      valorParcela,
                      data_venda,
                      forma_pagamento,
                      vendaId,
                      clienteCpf,
                      venc.format('YYYY-MM-DD'),
                      indice,
                      qtdParcelas,
                      vendaId,
                      clienteNome
                    ], (finErr) => {
                      if (finErr) {
                        db.run('ROLLBACK');
                        res.status(500).json({ error: finErr.message });
                        return;
                      }

                      inserirFinanceiroPrazo(indice + 1, moment(venc).add(1, 'months'));
                    });
                  };

                  inserirFinanceiroPrazo();
                });
              }
            });
            });
          });
        });
      });
    });
  }
  return;
}

// Venda à vista ou crédito antigo
const executarVenda = async () => {
  const codigo = `VND-${agoraLocalBrasil().replace(/[- :]/g, '').slice(0, 14)}`;
  const data_venda = agoraLocalBrasil().slice(0, 10);

  // Calcular valores fiscal e não fiscal (Motor Fiscal — intervalo oficial)
  const fiscalOperacional = separarItensDistribuidos(distribuicaoItens);
  // RC4.31 — pagamento valida contra total líquido (desconto global)
  const totaisPagamento = resolverTotaisPagamentoComDesconto(fiscalOperacional, req.body);
  const totalFiscal = totaisPagamento.totalFiscal;
  const totalNaoFiscal = totaisPagamento.totalNaoFiscal;
  const fiscalOperacionalPagamento = totaisPagamento.fiscalOperacionalPagamento;
  const itensMidp = totaisPagamento.omitirItensNoMidp ? [] : distribuicaoItens;

  // Obter configurações TEF e confirmação fiscal
  let tefHabilitado = false;
  let modoConfirmacaoFiscal = 'TEF';
  
  try {
    const tefConfig = await tefConfigService.obterConfiguracao();
    tefHabilitado = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
  } catch (error) {
    console.error('Erro ao verificar configuração TEF:', error);
  }
  
  modoConfirmacaoFiscal = configService.getModoConfirmacaoFiscal() || 'TEF';

  const origemMidp = resolverOrigemMidp(req.body);
  const midpResult = distribuirPagamentosMidp({
    valorFiscal: totalFiscal,
    valorNaoFiscal: totalNaoFiscal,
    pagamentos: req.body.pagamentos || [],
    formaPagamentoPadrao: formaPagamentoFinal,
    origem: origemMidp,
    fiscalOperacional: fiscalOperacionalPagamento,
    itens: itensMidp
  });

  const itensFinais = aplicarDecisaoMidpNosItens(distribuicaoItens, midpResult.decisao);
  console.log('[RCF-07.1] Itens após MIDP (vista)', {
    itens_recebidos: distribuicaoItens.length,
    itens_apos_midp: itensFinais.length,
    mesmaRef: itensFinais === distribuicaoItens,
    produtos: itensFinais.map((i) => i.produto_id),
    rc431_omitiu_itens: totaisPagamento.omitirItensNoMidp === true
  });
  if (!itensFinais.length && distribuicaoItens.length > 0) {
    console.error('[RCF-07.1] ABORT Rollback: MIDP zerou itens (vista)');
    return res.status(500).json({
      error: 'RCF-07: Falha ao aplicar decisão MIDP — itens da venda foram perdidos.'
    });
  }
  distribuicaoItens.length = 0;
  itensFinais.forEach((it) => distribuicaoItens.push(it));
  console.log('[RCF-07.1] Itens prontos para persistência (vista)', {
    qtd: distribuicaoItens.length
  });

  // RC4.31 — com desconto, o total de pagamento é o líquido; não deixar a decisão MIDP inflar.
  const totaisFluxo = totaisFluxoSemInflar(
    totaisPagamento.omitirItensNoMidp
      ? { totalFiscal, totalNaoFiscal }
      : lerTotaisDecisaoMidp(midpResult, totalFiscal, totalNaoFiscal),
    totalFiscal,
    totalNaoFiscal
  );
  const totalFiscalFluxo = totaisFluxo.totalFiscal;
  const totalNaoFiscalFluxo = totaisFluxo.totalNaoFiscal;

  // Processar fluxo de pagamento usando o Orquestrador (consome apenas MidpResult)
  let resultadoPagamento;
  try {
    resultadoPagamento = await OrquestradorPagamento.processarFluxoPagamentoVenda({
      totalFiscal: totalFiscalFluxo,
      totalNaoFiscal: totalNaoFiscalFluxo,
      formaPagamento: formaPagamentoFinal,
      pagamentos: req.body.pagamentos || [],
      tefHabilitado,
      modoConfirmacaoFiscal,
      midpResult,
      origem: origemMidp
    });
  } catch (orchErr) {
    console.error('[VENDA] Orquestrador falhou:', orchErr);
    return res.status(500).json({
      error: orchErr?.message || 'Erro no orquestrador de pagamento.'
    });
  }

  console.log('[VENDA] Orquestrador OK', {
    sucesso: resultadoPagamento.sucesso,
    statusPagamento: resultadoPagamento.statusPagamento,
    totalFiscalFluxo,
    totalNaoFiscalFluxo
  });

  if (!resultadoPagamento.sucesso) {
    return res.status(400).json({
      error: resultadoPagamento.erro,
      tef: resultadoPagamento.tef
    });
  }

  const { distribuicao, resultadoFiscal } = resultadoPagamento;
  const resultadoStatus = aplicarRegraStatusPagamentoVenda({
    valorFiscal: totalFiscalFluxo,
    valorNaoFiscal: totalNaoFiscalFluxo,
    statusPagamento: resultadoPagamento.statusPagamento,
    recebimentos: resultadoPagamento.recebimentos
  });
  const { statusPagamento, recebimentos } = resultadoStatus;

  console.log('[VENDA] Persistindo venda', {
    codigo,
    statusPagamento,
    itens: distribuicaoItens.length
  });

  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) {
        console.error('[VENDA] BEGIN IMMEDIATE falhou:', beginErr.message);
        return res.status(503).json({
          error: 'Banco ocupado ao iniciar a venda. Tente novamente.',
          detalhe: beginErr.message
        });
      }
      console.log('[VENDA] BEGIN OK — inserindo venda');
      db.run(`
      INSERT INTO vendas (
        codigo,
        data_venda,
        cliente_id,
        total,
        desconto,
        forma_pagamento,
        status,
        valor_recebido,
        caixa_sessao_id,
        caixa_id,
        terminal_id,
        cpf_cnpj_nota,
        operador_id,
        valor_fiscal,
        valor_nao_fiscal,
        status_pagamento,
        tef_transacao_id,
        canal_venda,
        origem_pdv
      )
      VALUES (?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      codigo,
      data_venda,
      cliente_id || null,
      totalNum,
      desconto || 0,
      formaPagamentoFinal,
      valor_recebido || null,
      req.caixaSessaoId || null,
      req.caixaId,
      req.terminalId || null,
      emitir_fiscal ? cpfCnpjNotaLimpo || null : null,
      req.operadorId,
      totalFiscalFluxo,
      totalNaoFiscalFluxo,
      statusPagamento,
      resultadoFiscal?.transacoes?.[0] || null,
      canalVendaGravar,
      origemPdvGravar
    ], function(err) {
      if (err) {
        db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
        return;
      }
      const vendaId = this.lastID;

      gravarRecebimentos(
        vendaId,
        recebimentos,
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            res.status(500).json({ error: err.message });
            return;
          }
        },
        { substituir: true }
      );

      const transacoesTefParaVincular = resultadoFiscal?.transacoes || [];

      if (tef && tef.transacao_id) {
        transacoesTefParaVincular.push(tef.transacao_id);
      }

      pagamentosVenda.forEach((p) => {
        const idTef = p.tef_transacao_id || p.tef?.transacao_id;
        if (idTef) {
          transacoesTefParaVincular.push(idTef);
        }
      });

      [...new Set(transacoesTefParaVincular)].forEach((transacaoId) => {
        db.run(`
          UPDATE tef_transacoes
          SET venda_id = ?
          WHERE id = ?
        `, [
          vendaId,
          transacaoId
        ], (tefErr) => {
          if (tefErr) {
            console.error('Erro ao vincular TEF à venda:', tefErr);
          }
        });
      });

      let itensProcessados = 0;
      distribuicaoItens.forEach(item => {
        const quantidadeFiscal =
          Number(
            item.quantidade_fiscal || 0
          );

        const quantidadeNaoFiscal =
          Number(
            item.quantidade_nao_fiscal || 0
          );

        const itemFiscal =
          quantidadeFiscal > 0
            ? 1
            : 0;

        const precoUnitario = Number(
          item.preco_unitario != null && item.preco_unitario !== ''
            ? item.preco_unitario
            : (item.preco != null && item.preco !== '' ? item.preco : 0)
        );
        const quantidadeItem = Number(
          item.quantidade != null && item.quantidade !== ''
            ? item.quantidade
            : (Number(quantidadeFiscal || 0) + Number(quantidadeNaoFiscal || 0))
        );
        if (!Number.isFinite(precoUnitario)) {
          db.run('ROLLBACK');
          res.status(400).json({ error: 'Preço unitário do item é obrigatório.' });
          return;
        }

        const valorFiscal =
          Number(
            (item.valor_fiscal || 0).toFixed(2)
          );

        const valorNaoFiscal =
          Number(
            (item.valor_nao_fiscal || 0).toFixed(2)
          );

        const tipoVenda = normalizarTipoVendaItem(item);

        db.run(`
          INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, desconto_percentual, promocao_id, desconto_atacado, tipo_preco, subtotal, item_fiscal, quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal, tipo_venda, unidade_comercial_id, unidade_comercial, fator_conversao, codigo_barras_comercial, quantidade_bolas, forma_comercializacao)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [vendaId, item.produto_id, quantidadeItem, precoUnitario, item.desconto_percentual || 0, item.promocao_id || null, item.desconto_atacado || 0, item.tipo_preco || 'varejo', item.subtotal, itemFiscal, quantidadeFiscal, quantidadeNaoFiscal, valorFiscal, valorNaoFiscal, tipoVenda, item.unidade_comercial_id || null, item.unidade_comercial || null, item.fator_conversao != null ? Number(item.fator_conversao) : 1, item.codigo_barras_comercial || null, extrairQuantidadeBolasItem(item), item.forma_comercializacao ? String(item.forma_comercializacao).toUpperCase() : null], function(itemErr) {
          if (itemErr) {
            db.run('ROLLBACK');
            res.status(500).json({ error: itemErr.message });
            return;
          }

          // RCF-07: callback clássico — arrow function quebrava this.lastID
          const vendaItemId = this.lastID;
          console.log('[RCF-07.1] Item persistido (vista)', { vendaId, vendaItemId, produto_id: item.produto_id });
          persistirSaboresCasquinha(vendaItemId, item, (sabErr) => {
            if (sabErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: sabErr.message });
              return;
            }

          // RCM-05.9: kit → histórico + baixa componentes; senão baixa produto
          persistirKitEBaixarEstoque(pularBaixaEstoque, vendaItemId, item, item.quantidade_fiscal, item.quantidade_nao_fiscal, (estErr) => {
            if (estErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: estErr.message });
              return;
            }
            itensProcessados++;
            if (itensProcessados === distribuicaoItens.length) {
              const listaPagPersist = resolverListaPagamentosPersistencia(recebimentos, pagamentosVenda);
              console.log('[ORIGEM-PAG] venda_pagamentos (vista)', {
                vendaId,
                totalFiscal,
                totalNaoFiscal,
                recebimentos,
                pagamentosBody: pagamentosVenda,
                persistido: listaPagPersist
              });
              console.log('[RCF-07.1] Itens persistidos antes do COMMIT', {
                vendaId,
                itensPersistidos: itensProcessados,
                totalFiscal,
                totalNaoFiscal
              });
              inserirLinhasVendaPagamentos(
                vendaId,
                listaPagPersist,
                formaPagamentoFinal,
                total,
                tef
              );

              const statusFinanceiro = vendaFicaPendente ? 'pendente' : 'recebido';
              const baixadoEm = statusFinanceiro === 'recebido' ? data_venda : null;
              const finalizarResposta = () => {
                console.log('[RCF-07.1] COMMIT', { vendaId, statusPagamento, itens: itensProcessados });
                db.run('COMMIT', (commitErr) => {
                  if (commitErr) {
                    console.error('[VENDA] COMMIT falhou:', commitErr.message);
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: commitErr.message });
                  }
                  responderVendaComFiscal(res, {
                    vendaId,
                    codigo,
                    message: origemConsignacao
                      ? 'Venda oficial (consignação) registrada com sucesso'
                      : 'Venda registrada com sucesso',
                    emitirFiscal: emitirNfceAoConcluir,
                    valorFiscal: totalFiscalFluxo,
                    valorNaoFiscal: totalNaoFiscalFluxo,
                    statusPagamento: statusPagamento,
                    recebimentos,
                    pagamentosTef: pagamentosVenda,
                    integridadeComercial: origemConsignacao
                      ? {
                        valorVenda: totalNum,
                        valorRecebido: valorRecebidoConsignacao,
                        saldoEmAberto: saldoEmAbertoConsignacao
                      }
                      : null
                  });
                });
              };

              const inserirContasReceberSeNecessario = (callback) => {
                const saldoAR = origemConsignacao
                  ? saldoEmAbertoConsignacao
                  : (forma_pagamento === 'prazo' ? totalNum : 0);

                if (saldoAR > 0.01 && cliente_id) {
                  if (isPdvArBridgeAtivo()) {
                    emitirEventoPdvArMfe({
                      tipo: 'venda_completa',
                      eventType: 'SALE_COMPLETED',
                      venda_id: vendaId,
                      cliente_id,
                      valor: saldoAR,
                      total_parcelas: 1,
                      numero_parcela: 1,
                      parcelas: [{
                        numero: 1,
                        totalParcelas: 1,
                        valor: saldoAR,
                        saldo: saldoAR,
                        vencimento: moment().add(30, 'days').format('YYYY-MM-DD')
                      }],
                      persistirTitulo: true,
                      idempotencyKey: `pdv-ar:sale:${vendaId}:saldo`
                    });
                    callback();
                    return;
                  }
                  db.run(`
                    INSERT INTO contas_receber (
                      venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela,
                      valor_restante, data_vencimento, status
                    ) VALUES (?, ?, ?, ?, ?, ?, date('now', '+30 day'), 'aberto')
                  `, [
                    vendaId,
                    cliente_id,
                    1,
                    1,
                    saldoAR,
                    saldoAR
                  ], (crErr) => {
                    if (crErr) {
                      db.run('ROLLBACK');
                      res.status(500).json({ error: crErr.message });
                      return;
                    }
                    callback();
                  });
                } else {
                  callback();
                }
              };

              buscarNomeCliente((clienteErr, clienteNome, clienteCpf) => {
                if (clienteErr) {
                  db.run('ROLLBACK');
                  res.status(500).json({ error: clienteErr.message });
                  return;
                }

                const gravarFinanceiroPadrao = (callback) => {
                  db.run(`
                    INSERT INTO financeiro (
                      tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                      referencia_id, referencia_tipo, status, origem, documento, vencimento,
                      numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em
                    ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', ?, 'venda', ?, ?, 1, 1, ?, ?, ?)
                  `, [
                    `Venda ${codigo}`,
                    totalNum,
                    data_venda,
                    forma_pagamento,
                    vendaId,
                    statusFinanceiro,
                    clienteCpf,
                    data_venda,
                    vendaId,
                    clienteNome,
                    baixadoEm
                  ], (finErr) => {
                    if (finErr) {
                      db.run('ROLLBACK');
                      res.status(500).json({ error: finErr.message });
                      return;
                    }
                    callback();
                  });
                };

                // STAB-06: Integridade Comercial — receita do recebido + AR do saldo
                const gravarFinanceiroConsignacao = (callback) => {
                  const inserirRecebido = (next) => {
                    if (valorRecebidoConsignacao <= 0.01) return next();
                    db.run(`
                      INSERT INTO financeiro (
                        tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                        referencia_id, referencia_tipo, status, origem, documento, vencimento,
                        numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em, observacao
                      ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', 'recebido', 'venda', ?, ?, 1, 1, ?, ?, ?, ?)
                    `, [
                      `Venda ${codigo} (recebido consignação)`,
                      valorRecebidoConsignacao,
                      data_venda,
                      forma_pagamento,
                      vendaId,
                      clienteCpf,
                      data_venda,
                      vendaId,
                      clienteNome,
                      data_venda,
                      `STAB-06 consignacao#${metaConsignacao.consignacaoId || ''}`
                    ], (err) => {
                      if (err) {
                        db.run('ROLLBACK');
                        res.status(500).json({ error: err.message });
                        return;
                      }
                      next();
                    });
                  };

                  const inserirPendente = (next) => {
                    if (saldoEmAbertoConsignacao <= 0.01) return next();
                    db.run(`
                      INSERT INTO financeiro (
                        tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                        referencia_id, referencia_tipo, status, origem, documento, vencimento,
                        numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em, observacao
                      ) VALUES ('receita', ?, ?, ?, 'vendas', 'prazo', ?, 'venda', 'pendente', 'venda', ?, ?, 1, 1, ?, ?, NULL, ?)
                    `, [
                      `Venda ${codigo} (saldo consignação)`,
                      saldoEmAbertoConsignacao,
                      data_venda,
                      vendaId,
                      clienteCpf,
                      data_venda,
                      vendaId,
                      clienteNome,
                      `STAB-06 consignacao#${metaConsignacao.consignacaoId || ''} saldo`
                    ], (err) => {
                      if (err) {
                        db.run('ROLLBACK');
                        res.status(500).json({ error: err.message });
                        return;
                      }
                      next();
                    });
                  };

                  inserirRecebido(() => inserirPendente(callback));
                };

                const aposFinanceiro = () => {
                  if ((forma_pagamento === 'prazo' || (origemConsignacao && saldoEmAbertoConsignacao > 0.01)) && cliente_id) {
                    const creditoAdd = origemConsignacao ? saldoEmAbertoConsignacao : totalNum;
                    db.run(`
                      UPDATE clientes
                      SET credito_atual = COALESCE(credito_atual, 0) + ?
                      WHERE id = ?
                    `, [creditoAdd, cliente_id], (credErr) => {
                      if (credErr) {
                        db.run('ROLLBACK');
                        res.status(500).json({ error: credErr.message });
                        return;
                      }

                      finalizarResposta();
                    });
                  } else {
                    finalizarResposta();
                  }
                };

                const gravar = origemConsignacao ? gravarFinanceiroConsignacao : gravarFinanceiroPadrao;
                gravar(() => inserirContasReceberSeNecessario(aposFinanceiro));
              });
            }
          });
          });
        });
      });

      // Sem itens: aborta — nunca finaliza venda vazia (RCF-06)
      if (!distribuicaoItens.length) {
        console.error('[RCF-06] distribuicaoItens vazio — ROLLBACK');
        db.run('ROLLBACK', () => {
          res.status(400).json({
            error: 'RCF-06: Venda sem itens. Persistência abortada.'
          });
        });
      }
    });
    });
  });
};

// Venda à vista pode ser sem cliente
if (forma_pagamento === 'credito') {
  if (!cliente_id) {
    res.status(400).json({ error: 'Cliente obrigatório para venda a crédito.' });
    return;
  }
  db.get(
    'SELECT credito_atual, limite_credito FROM clientes WHERE id = ?',
    [cliente_id],
    (err, cliente) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (!cliente) {
        res.status(400).json({ error: 'Cliente não encontrado.' });
        return;
      }
      if (Number(cliente.limite_credito) <= 0) {
        res.status(400).json({ error: 'Configure um limite de crédito maior que zero para este cliente.' });
        return;
      }
      if (Number(cliente.credito_atual) + totalNum > Number(cliente.limite_credito)) {
        res.status(400).json({ error: 'Limite de crédito excedido.' });
        return;
      }
      executarVenda();
    }
  );
} else {
  executarVenda();
}
  } // continuarCriarVendaAposDistribuicao
});
}

function consultarPagamentoNaoFiscal(req, res) {
const { id } = req.params;

db.get('SELECT * FROM vendas WHERE id = ?', [id], (err, venda) => {
  if (err) {
    res.status(500).json({ error: err.message });
    return;
  }

  if (!venda) {
    res.status(404).json({ error: 'Venda não encontrada.' });
    return;
  }

  db.all(`
    SELECT *
    FROM venda_recebimentos
    WHERE venda_id = ? AND tipo_recebimento = 'nao_fiscal'
    ORDER BY id ASC
  `, [id], (recErr, recebimentos) => {
    if (recErr) {
      res.status(500).json({ error: recErr.message });
      return;
    }

    const saldo = calcularSaldoNaoFiscal(venda, recebimentos);

    res.json({
      venda_id: Number(id),
      codigo: venda.codigo,
      status_pagamento: venda.status_pagamento,
      valor_fiscal: Number(venda.valor_fiscal || 0),
      valor_nao_fiscal: saldo.valorNaoFiscal,
      valor_recebido_nao_fiscal: saldo.valorRecebido,
      saldo_pendente: saldo.saldoPendente,
      recebimentos_nao_fiscal: recebimentos || [],
      aguardando_pagamento: venda.status_pagamento === 'aguardando_nao_fiscal'
    });
  });
});
}

function registrarPagamentoNaoFiscal(req, res) {
const { id } = req.params;
const pagamentosInformados = normalizarPagamentosNaoFiscal(req.body || {});

if (pagamentosInformados.length === 0) {
  res.status(400).json({ error: 'Informe ao menos um pagamento não fiscal.' });
  return;
}

const erroValidacao = validarPagamentosNaoFiscal(pagamentosInformados);
if (erroValidacao) {
  res.status(400).json({ error: erroValidacao });
  return;
}

db.get('SELECT * FROM vendas WHERE id = ?', [id], (err, venda) => {
  if (err) {
    res.status(500).json({ error: err.message });
    return;
  }

  if (!venda) {
    res.status(404).json({ error: 'Venda não encontrada.' });
    return;
  }

  if (venda.status !== 'concluida') {
    res.status(400).json({ error: 'Venda não está ativa para recebimento.' });
    return;
  }

  const valorFiscalVenda = Number(venda.valor_fiscal || 0);
  const valorNaoFiscalVenda = Number(venda.valor_nao_fiscal || 0);
  const vendaSomenteNaoFiscal = valorFiscalVenda <= 0 && valorNaoFiscalVenda > 0;

  if (vendaSomenteNaoFiscal) {
    if (venda.status_pagamento === 'quitada') {
      res.json({
        id: Number(id),
        codigo: venda.codigo,
        status_pagamento: 'quitada',
        message: 'Venda não fiscal já finalizada.',
        saldo_pendente: 0,
        fiscal: null
      });
      return;
    }

    const totalInformado = pagamentosInformados.reduce(
      (acc, p) => acc + Number(p.valor || 0),
      0
    );
    const totalEsperado = Number(venda.total || valorNaoFiscalVenda || 0);

    if (Math.abs(totalInformado - totalEsperado) > 0.01) {
      res.status(400).json({
        error: 'Valor informado não confere com o total da venda não fiscal.',
        saldo_pendente: totalEsperado
      });
      return;
    }

    const recebimentos = pagamentosInformados.map((pagamento) => ({
      tipo_recebimento: 'nao_fiscal',
      forma_pagamento: String(pagamento.forma_pagamento).toLowerCase().trim(),
      valor: Number(pagamento.valor || 0),
      tef_transacao_id: pagamento.tef_transacao_id || null,
      nsu: pagamento.nsu || null,
      autorizacao: pagamento.autorizacao || null
    }));

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      gravarRecebimentos(id, recebimentos, (gravarErr) => {
        if (gravarErr) {
          db.run('ROLLBACK');
          res.status(500).json({ error: gravarErr.message });
          return;
        }

        db.run(
          `UPDATE vendas SET status_pagamento = 'quitada' WHERE id = ?`,
          [id],
          (updateErr) => {
            if (updateErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: updateErr.message });
              return;
            }

            db.run('COMMIT', async (commitErr) => {
              if (commitErr) {
                res.status(500).json({ error: commitErr.message });
                return;
              }

              res.json({
                id: Number(id),
                codigo: venda.codigo,
                status_pagamento: 'quitada',
                message: 'Venda não fiscal finalizada com sucesso.',
                saldo_pendente: 0,
                fiscal: null
              });
            });
          }
        );
      });
    });
    return;
  }

  if (valorFiscalVenda <= 0) {
    if (venda.status_pagamento === 'quitada') {
      res.json({
        id: Number(id),
        codigo: venda.codigo,
        status_pagamento: 'quitada',
        message: 'Venda sem itens fiscais já finalizada. NFC-e não necessária.',
        saldo_pendente: 0,
        fiscal: {
          success: true,
          status: 'sem_itens_fiscais',
          message: 'Venda sem itens fiscais. NFC-e não necessária.'
        }
      });
      return;
    }

    res.status(400).json({
      error: 'Venda sem itens fiscais deve ser finalizada em POST /vendas.',
      status_pagamento: venda.status_pagamento
    });
    return;
  }

  if (venda.status_pagamento !== 'aguardando_nao_fiscal') {
    res.status(400).json({
      error: 'Venda não está aguardando pagamento não fiscal.',
      status_pagamento: venda.status_pagamento
    });
    return;
  }

  db.all(`
    SELECT *
    FROM venda_recebimentos
    WHERE venda_id = ? AND tipo_recebimento = 'nao_fiscal'
  `, [id], (recErr, recebimentosAtuais) => {
    if (recErr) {
      res.status(500).json({ error: recErr.message });
      return;
    }

    const saldo = calcularSaldoNaoFiscal(venda, recebimentosAtuais);

    if (saldo.saldoPendente <= 0) {
      res.status(400).json({ error: 'Não há saldo não fiscal pendente nesta venda.' });
      return;
    }

    const totalInformado = pagamentosInformados.reduce(
      (acc, p) => acc + Number(p.valor || 0),
      0
    );

    if (Math.abs(totalInformado - saldo.saldoPendente) > 0.01) {
      res.status(400).json({
        error: 'Valor informado não confere com o saldo não fiscal pendente.',
        saldo_pendente: saldo.saldoPendente
      });
      return;
    }

    const recebimentos = pagamentosInformados.map((pagamento) => ({
      tipo_recebimento: 'nao_fiscal',
      forma_pagamento: String(pagamento.forma_pagamento).toLowerCase().trim(),
      valor: Number(pagamento.valor || 0),
      tef_transacao_id: null,
      nsu: pagamento.nsu || null,
      autorizacao: pagamento.autorizacao || null
    }));

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      gravarRecebimentos(id, recebimentos, (gravarErr) => {
        if (gravarErr) {
          db.run('ROLLBACK');
          res.status(500).json({ error: gravarErr.message });
          return;
        }

        const recebimentosNaoFiscalRegistrados = [
          ...(Array.isArray(recebimentosAtuais) ? recebimentosAtuais : []),
          ...recebimentos
        ];
        const statusFinal = resolverStatusPagamentoVenda(
          venda.valor_nao_fiscal,
          recebimentosNaoFiscalRegistrados,
          'quitada'
        );

        db.run(
          `UPDATE vendas SET status_pagamento = ? WHERE id = ?`,
          [statusFinal, id],
          (updateErr) => {
            if (updateErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: updateErr.message });
              return;
            }

            db.run('COMMIT', async (commitErr) => {
              if (commitErr) {
                res.status(500).json({ error: commitErr.message });
                return;
              }

              const fiscal = await emitirFiscalSeSolicitado(id, req.body.emitir_fiscal, venda);

              res.json({
                id: Number(id),
                codigo: venda.codigo,
                status_pagamento: statusFinal,
                message: 'Pagamento não fiscal registrado com sucesso.',
                saldo_pendente: 0,
                fiscal
              });
            });
          }
        );
      });
    });
  });
});
}

module.exports = {
  reduzirEstoqueComFEFO,
  reduzirEstoqueDistribuido,
  atualizarStatusPagamentoVenda,
  flattenRecebimentos,
  gravarRecebimentos,
  processarPagamentosTef,
  calcularSaldoNaoFiscal,
  filtrarRecebimentosNaoFiscal,
  filtrarRecebimentosDaVendaCorrente,
  resolverStatusPagamentoVenda,
  aplicarRegraStatusPagamentoVenda,
  aplicarDecisaoMidpNosItens,
  normalizarPagamentosNaoFiscal,
  validarPagamentosNaoFiscal,
  obterTerminalId,
  preCalcularDistribuicao,
  criarVenda,
  consultarPagamentoNaoFiscal,
  registrarPagamentoNaoFiscal
};
