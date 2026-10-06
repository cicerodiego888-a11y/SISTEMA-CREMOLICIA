const express = require('express');
const router = express.Router();
const db = require('../database');
const moment = require('moment');
const { gravarAuditoria } = require('../services/auditoria');
const { validarCaixaAberto } = require('../middleware/validarCaixaAberto');
const lotesService = require('../services/lotesService');
const {
  resolverQuantidadesCompraItemPersistido,
  calcularDevolucaoCompraFiscalPrimeiro,
  resolverJaDevolvidoCompraFiscalPrimeiro
} = require('../services/estoqueFiscalService');
const {
  moeda,
  custoUnitarioVenda,
  itemCompraUsaConversaoUnidades,
  resolverPrecosCadastroAposCompra,
  resolverQuantidadesCompraItem
} = require('../lib/motorConversaoUnidades');
const { emitirNFeDevolucaoCompra } = require('../services/fiscal/nfeDevolucaoCompra');
const MiipService = require('../motores/miip/MiipService');
const CentralComprasBridgeService = require('../motores/central-entradas/services/CentralComprasBridgeService');
const {
  resolverCamposEntrada,
  deveGerarFinanceiroEntrada
} = require('../lib/entradaProducaoPropria');
const mcc = require('../motores/motor-conversao-comercial');
const MotorEstoque = require('../motores/motor-estoque');
const { publicarEventoCompraApMfe } = require('../motores/motor-financeiro/adapters');
const { obterMotor, FeatureFlag } = require('../motores/motor-financeiro');

const itemCompraEhFracionado = itemCompraUsaConversaoUnidades;

/** MFE-06 — FEATURE_MFE_AP */
function isCompraApBridgeAtivo() {
  try {
    return Boolean(obterMotor().featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_AP));
  } catch (_) {
    return false;
  }
}

function emitirEventoCompraApMfe(operacao) {
  Promise.resolve(publicarEventoCompraApMfe(db, operacao)).catch((err) => {
    console.error('[MFE-06] emitirEventoCompraApMfe:', err?.message || err);
  });
}

/** MCC-03 — Entrada operacional (Orchestrator obrigatório; sem Converter direto) */
const entradaMcc = new mcc.EntradaMercadoriasOperacionalService({
  orchestrator: mcc.compraOrchestrator,
  mcc: mcc.motor,
  criarLote: (dados, cb) => lotesService.criarLote(dados, cb),
  gravarAuditoria
});

function itemUsaEntradaMcc(item = {}) {
  return !!(
    item.unidade_comercial
    || item.unidade_origem
    || item.modo_entrada_conversao
    || item.peso_embalagem
    || item.peso_total
    || item.volume_total
    || item.utiliza_conversao_fisica
    || Number(item.mcc_entrada) === 1
  );
}

/**
 * Validação prévia: legado fracionado ainda checa distribuição.
 * Itens MCC / UC / física são validados na conversão operacional.
 */
function validarDistribuicaoItemCompra(item = {}) {
  if (itemUsaEntradaMcc(item)) return null;
  if (!itemCompraEhFracionado(item)) return null;

  const qtds = resolverQuantidadesCompraItem(item);
  const qtdEmb = Number(item.quantidade_embalagens || 0);
  const qtdPorEmb = Number(item.quantidade_por_embalagem || 0);
  const totalConvertido = qtdEmb > 0 && qtdPorEmb > 0
    ? qtdEmb * qtdPorEmb
    : Number(item.peso_total_compra || 0);
  const nome = String(item.produto_nome || item.produto_id || 'Produto').trim();

  if (totalConvertido <= 0) {
    return `${nome}: informe a conversão de unidades antes da distribuição fiscal.`;
  }

  const soma = Number(qtds.quantidade_fiscal || 0) + Number(qtds.quantidade_nao_fiscal || 0);
  if (soma <= 0) {
    return `${nome}: informe quantidades absolutas em fiscal e/ou não fiscal.`;
  }

  if (Math.abs(soma - totalConvertido) > 0.001) {
    return `${nome}: fiscal (${qtds.quantidade_fiscal}) + não fiscal (${qtds.quantidade_nao_fiscal}) deve somar ${totalConvertido} (total convertido).`;
  }

  return null;
}


/**
 * @param {number|string|null} centralDocumentoId
 * @param {number} compraId
 * @param {number|null} usuarioId
 * @returns {Promise<void>}
 */
async function vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, usuarioId) {
  if (!centralDocumentoId) return;

  try {
    const bridge = new CentralComprasBridgeService();
    await bridge.vincularCompra(centralDocumentoId, compraId, { usuarioId });
  } catch (err) {
    console.error('[Central] Erro ao vincular documento à compra:', err?.message);
  }
}

function agoraLocalBrasil() {
  const agora = new Date();

  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );

  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');

  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

function toDate(value, fallback = agoraLocalBrasil().slice(0, 10)) {
  return value ? moment(value).format('YYYY-MM-DD') : fallback;
}

function addMonths(date, months) {
  return moment(date).add(months, 'months').format('YYYY-MM-DD');
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function createSlugCodigo(nome = '') {
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toUpperCase();
}

function calcularRateioItens(itens, totais = {}) {
  const valorProdutos = moeda(
    itens.reduce((sum, item) => sum + moeda(item.subtotal), 0)
  );

  const frete = moeda(totais.valor_frete);
  const desconto = moeda(totais.valor_desconto);
  const outras = moeda(totais.valor_outras_despesas);

  return itens.map((item) => {
    const subtotalItem = moeda(
      Number(item.subtotal) > 0
        ? item.subtotal
        : (Number(item.valor_total_embalagem) || Number(item.preco_unitario || 0) * Number(item.quantidade || 0))
    );
    const subtotal = moeda(item.subtotal !== undefined ? item.subtotal : subtotalItem);
    const proporcao = valorProdutos > 0 ? subtotal / valorProdutos : 0;

    const freteRateado = moeda(frete * proporcao);
    const descontoRateado = moeda(desconto * proporcao);
    const outrasRateado = moeda(outras * proporcao);

    const quantidade = Number(
      item.quantidade_convertida
      ?? item.peso_total_compra
      ?? item.quantidade
      ?? 0
    );
    const custoTotalFinal = moeda(subtotal + freteRateado + outrasRateado - descontoRateado);
    const precisaCustoUnitarioFino = itemUsaEntradaMcc(item) || itemCompraEhFracionado(item);
    const custoUnitarioFinal = quantidade > 0
      ? (precisaCustoUnitarioFino
        ? custoUnitarioVenda(custoTotalFinal / quantidade)
        : moeda(custoTotalFinal / quantidade))
      : (precisaCustoUnitarioFino
        ? custoUnitarioVenda(item.preco_unitario)
        : moeda(item.preco_unitario));

    return {
      ...item,
      frete_rateado: freteRateado,
      desconto_rateado: descontoRateado,
      outras_despesas_rateado: outrasRateado,
      custo_unitario_final: custoUnitarioFinal
    };
  });
}

function garantirFornecedorCompra(dados, callback) {
  const nome = String(dados.fornecedor || '').trim();
  const cnpj = digitsOnly(dados.fornecedor_cnpj || '');

  if (!nome) return callback(null);

  if (!cnpj) return callback(null);

  db.get(`
    SELECT id FROM fornecedores 
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(cpf_cnpj, '.', ''), '/', ''), '-', ''), ' ', '') = ?
    LIMIT 1
  `, [cnpj], (err, existente) => {
    if (err) return callback(err);
    if (existente) return callback(null);

    db.run(`
      INSERT INTO fornecedores (
        nome, razao_social, cpf_cnpj, rua, numero, bairro, cidade, uf, cep, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      nome,
      nome,
      cnpj,
      dados.fornecedor_rua || null,
      dados.fornecedor_numero || null,
      dados.fornecedor_bairro || null,
      dados.fornecedor_cidade || null,
      dados.fornecedor_uf || null,
      dados.fornecedor_cep || null,
      'Fornecedor cadastrado automaticamente pela importação de XML de compra.'
    ], callback);
  });
}

function montarParcelasFinanceiroCompra(compra) {
  const {
    id,
    data_compra,
    condicao_pagamento,
    data_vencimento,
    parcelas,
    valor_entrada,
    total
  } = compra;

  const qtdParcelas = Math.max(1, Number(parcelas) || 1);
  const valorTotal = Number(total) || 0;
  const vencimentoBase = toDate(data_vencimento, data_compra);
  const lista = [];

  if (condicao_pagamento === 'parcelado' && qtdParcelas > 1) {
    const valorBase = Math.floor((valorTotal / qtdParcelas) * 100) / 100;
    const resto = Math.round((valorTotal - (valorBase * qtdParcelas)) * 100) / 100;
    for (let i = 1; i <= qtdParcelas; i++) {
      const valorParcela = Number((valorBase + (i === qtdParcelas ? resto : 0)).toFixed(2));
      lista.push({
        numero: i,
        totalParcelas: qtdParcelas,
        valor: valorParcela,
        saldo: valorParcela,
        vencimento: addMonths(vencimentoBase, i - 1),
        status: 'ABERTO'
      });
    }
    return lista;
  }

  if (condicao_pagamento === 'entrada_parcelado' && qtdParcelas > 0 && valor_entrada > 0) {
    const totalParcelas = qtdParcelas + 1;
    lista.push({
      numero: 1,
      totalParcelas,
      valor: Number(valor_entrada),
      saldo: 0,
      vencimento: data_compra,
      status: 'PAGO'
    });
    const valorRestante = valorTotal - Number(valor_entrada);
    const valorBase = Math.floor((valorRestante / qtdParcelas) * 100) / 100;
    const resto = Math.round((valorRestante - (valorBase * qtdParcelas)) * 100) / 100;
    for (let i = 1; i <= qtdParcelas; i++) {
      const valorParcela = Number((valorBase + (i === qtdParcelas ? resto : 0)).toFixed(2));
      lista.push({
        numero: i + 1,
        totalParcelas,
        valor: valorParcela,
        saldo: valorParcela,
        vencimento: addMonths(vencimentoBase, i - 1),
        status: 'ABERTO'
      });
    }
    return lista;
  }

  const pagoNaHora = condicao_pagamento === 'avista';
  lista.push({
    numero: 1,
    totalParcelas: 1,
    valor: valorTotal,
    saldo: pagoNaHora ? 0 : valorTotal,
    vencimento: pagoNaHora ? data_compra : vencimentoBase,
    status: pagoNaHora ? 'PAGO' : 'ABERTO'
  });
  return lista;
}

function criarFinanceiroCompra(compra, callback) {
  const {
    id,
    data_compra,
    fornecedor,
    total,
    condicao_pagamento,
    forma_pagamento,
    data_vencimento,
    parcelas,
    valor_entrada,
    observacao
  } = compra;

  const qtdParcelas = Math.max(1, Number(parcelas) || 1);
  const valorTotal = Number(total) || 0;
  const descricaoBase = `Compra ${id}${fornecedor ? ` - ${fornecedor}` : ''}`;
  const vencimentoBase = toDate(data_vencimento, data_compra);

  // MFE-06: flag ON → Gateway (sem INSERT direto); OFF → legado
  if (isCompraApBridgeAtivo()) {
    db.run('DELETE FROM financeiro WHERE compra_id = ?', [id], (deleteErr) => {
      if (deleteErr) return callback(deleteErr);
      const parcelasAr = montarParcelasFinanceiroCompra(compra);
      emitirEventoCompraApMfe({
        tipo: 'compra_confirmada',
        eventType: 'PURCHASE_CONFIRMED',
        compra_id: id,
        valor: valorTotal,
        total: valorTotal,
        fornecedor,
        data_compra,
        data_vencimento: vencimentoBase,
        forma_pagamento,
        condicao_pagamento,
        total_parcelas: parcelasAr.length,
        parcelas: parcelasAr,
        observacao,
        persistirTitulo: true,
        idempotencyKey: `compra-ap:confirm:${id}`
      });
      callback(null);
    });
    return;
  }

  db.run('DELETE FROM financeiro WHERE compra_id = ?', [id], (deleteErr) => {
    if (deleteErr) return callback(deleteErr);

    const inserir = (payload, done) => {
      db.run(`
        INSERT INTO financeiro (
          tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
          referencia_id, referencia_tipo, status, origem, documento, vencimento,
          numero_parcela, total_parcelas, compra_id, pessoa_nome, observacao, baixado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'despesa',
        payload.descricao,
        payload.valor,
        data_compra,
        'compras',
        forma_pagamento || null,
        id,
        'compra',
        payload.status,
        'compra',
        null,
        payload.vencimento,
        payload.numero_parcela,
        payload.total_parcelas,
        id,
        fornecedor || null,
        observacao || null,
        payload.status === 'pago' ? data_compra : null
      ], done);
    };

    if (condicao_pagamento === 'parcelado' && qtdParcelas > 1) {
      const valorBase = Math.floor((valorTotal / qtdParcelas) * 100) / 100;
      const resto = Math.round((valorTotal - (valorBase * qtdParcelas)) * 100) / 100;
      let pendentes = qtdParcelas;
      for (let i = 1; i <= qtdParcelas; i++) {
        const valorParcela = Number((valorBase + (i === qtdParcelas ? resto : 0)).toFixed(2));
        inserir({
          descricao: `${descricaoBase} - Parcela ${i}/${qtdParcelas}`,
          valor: valorParcela,
          vencimento: addMonths(vencimentoBase, i - 1),
          numero_parcela: i,
          total_parcelas: qtdParcelas,
          status: 'pendente'
        }, (err) => {
          if (err) return callback(err);
          pendentes -= 1;
          if (pendentes === 0) callback(null);
        });
      }
      return;
    }

    if (condicao_pagamento === 'entrada_parcelado' && qtdParcelas > 0 && valor_entrada > 0) {
      const totalParcelas = qtdParcelas + 1;
      let pendentes = totalParcelas;
      inserir({
        descricao: `${descricaoBase} - Entrada`,
        valor: valor_entrada,
        vencimento: data_compra,
        numero_parcela: 1,
        total_parcelas: totalParcelas,
        status: 'pago'
      }, (err) => {
        if (err) return callback(err);
        pendentes -= 1;
        if (pendentes === 0) callback(null);
      });
      const valorRestante = valorTotal - valor_entrada;
      const valorBase = Math.floor((valorRestante / qtdParcelas) * 100) / 100;
      const resto = Math.round((valorRestante - (valorBase * qtdParcelas)) * 100) / 100;
      for (let i = 1; i <= qtdParcelas; i++) {
        const valorParcela = Number((valorBase + (i === qtdParcelas ? resto : 0)).toFixed(2));
        inserir({
          descricao: `${descricaoBase} - Parcela ${i + 1}/${totalParcelas}`,
          valor: valorParcela,
          vencimento: addMonths(vencimentoBase, i - 1),
          numero_parcela: i + 1,
          total_parcelas: totalParcelas,
          status: 'pendente'
        }, (err) => {
          if (err) return callback(err);
          pendentes -= 1;
          if (pendentes === 0) callback(null);
        });
      }
      return;
    }

    const pagoNaHora = condicao_pagamento === 'avista';
    inserir({
      descricao: descricaoBase,
      valor: valorTotal,
      vencimento: pagoNaHora ? data_compra : vencimentoBase,
      numero_parcela: 1,
      total_parcelas: 1,
      status: pagoNaHora ? 'pago' : 'pendente'
    }, callback);
  });
}

function ensureProductForItemLegado(item, callback) {
  const codigo = item.codigo_barras || createSlugCodigo(item.produto_nome || 'PRODUTO-IMPORTADO');
  const nome = item.produto_nome || `Produto ${codigo}`;
  const qtds = resolverQuantidadesCompraItem(item);
  const itemFiscal = qtds.quantidade_fiscal > 0 ? 1 : 0;

  db.get(
    'SELECT id FROM produtos WHERE codigo = ? OR codigo_barras = ? OR nome = ? LIMIT 1',
    [codigo, codigo, nome],
    (findErr, existente) => {
      if (findErr) return callback(findErr);
      if (existente) return callback(null, existente.id);

      const precosCadastro = resolverPrecosCadastroAposCompra(item);

      db.run(`
        INSERT INTO produtos (
          codigo, codigo_barras, nome, unidade, preco_compra, preco_venda,
          lucro_percentual, estoque_atual, estoque_minimo, fornecedor, ncm,
          saldo_fiscal, saldo_nao_fiscal, item_fiscal, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, 0, ?, CURRENT_TIMESTAMP)
      `, [
        codigo,
        item.codigo_barras || codigo,
        nome,
        item.unidade || 'UN',
        precosCadastro.precoCompra,
        precosCadastro.precoVenda ?? precosCadastro.precoCompra,
        precosCadastro.lucroPercentual,
        item.fornecedor || null,
        item.ncm || null,
        itemFiscal
      ], function(insertErr) {
        if (insertErr) return callback(insertErr);
        callback(null, this.lastID);
      });
    }
  );
}

function ensureProductForItem(item, callback) {
  if (item.produto_id) {
    return callback(null, Number(item.produto_id));
  }

  if (!MiipService.estaHabilitado()) {
    MiipService.registrarIntegracao({
      evento: 'legado_feature_flag',
      item,
      motivo: 'usarMiip=false — fluxo legado imediato'
    });
    return ensureProductForItemLegado(item, callback);
  }

  MiipService.identificar(item, { origem: 'compra', ponto: 'ensureProductForItem' })
    .then((miip) => {
      if (miip?.desabilitado) {
        return ensureProductForItemLegado(item, callback);
      }

      if (miip?.produtoId) {
        return callback(null, Number(miip.produtoId));
      }

      MiipService.registrarIntegracao({
        evento: 'miip_fallback_legado',
        item,
        resultado: miip?.resultado ?? null,
        motivo: 'MIIP não encontrou produto — executando ensureProductForItemLegado'
      });

      return ensureProductForItemLegado(item, callback);
    })
    .catch((miipErr) => {
      MiipService.registrarIntegracao({
        evento: 'miip_erro_fallback_legado',
        item,
        erro: miipErr?.message || String(miipErr),
        motivo: 'erro MIIP — executando ensureProductForItemLegado'
      });
      ensureProductForItemLegado(item, callback);
    });
}

function processarItensCompra(compraId, itens, fornecedor, opcoes, done) {
  if (typeof opcoes === 'function') {
    done = opcoes;
    opcoes = {};
  }

  const fornecedorCnpj = opcoes?.fornecedor_cnpj || null;
  let index = 0;

  function next() {
    if (index >= itens.length) {
      done(null);
      return;
    }

    const item = itens[index++];

    const itemComContexto = {
      ...item,
      fornecedor: item.fornecedor || fornecedor || null,
      fornecedor_cnpj: item.fornecedor_cnpj || fornecedorCnpj || null,
      mcc_entrada: 1
    };

    ensureProductForItem(itemComContexto, (prodErr, produtoId) => {
      if (prodErr) return done(prodErr);

      entradaMcc.processarItemOperacional(db, {
        compraId,
        fornecedor,
        fornecedorNome: fornecedor,
        item: itemComContexto,
        produtoId,
        loteOrigem: opcoes?.loteOrigem || 'COMPRA',
        usuarioId: opcoes?.usuarioId || null
      }).then((resultadoMcc) => {
        const qtdsEstoque = resultadoMcc.qtdsEstoque;
        const precosCadastro = resultadoMcc.precos;
        const produto = resultadoMcc.produto;
        const qtdTotal = qtdsEstoque.quantidade;
        const qtdFiscal = qtdsEstoque.quantidade_fiscal;
        const qtdNaoFiscal = qtdsEstoque.quantidade_nao_fiscal;
        const itemProcessado = {
          ...itemComContexto,
          quantidade_fiscal: qtdFiscal,
          quantidade_nao_fiscal: qtdNaoFiscal,
          quantidade: qtdTotal,
          peso_total_compra: qtdTotal,
          unidade: resultadoMcc.unidadeBase || item.unidade || produto.unidade || 'UN'
        };

        const antigo = { preco_compra: produto?.preco_compra, preco_venda: produto?.preco_venda };
        const precoUnitarioGravar = precosCadastro.precoCompra;
        const custoFinalGravar = precosCadastro.precoCompra;
        const precoVendaGravar = precosCadastro.atualizarVenda
          ? (precosCadastro.precoVenda ?? Number(itemProcessado.preco_venda_sugerido || 0))
          : Number(itemProcessado.preco_venda_sugerido || 0);
        const subtotalGravar = moeda(precosCadastro.subtotal);

        db.run(`
          INSERT INTO compras_itens (
            compra_id, produto_id, quantidade, preco_unitario, subtotal,
            descricao_produto, codigo_barras, margem_lucro, preco_venda_sugerido, unidade, ncm,
            frete_rateado, desconto_rateado, outras_despesas_rateado, custo_unitario_final,
            vendido_por_peso, peso_total_compra, custo_por_kg, atualizar_preco_venda, item_fiscal,
            quantidade_fiscal, quantidade_nao_fiscal,
            compra_em, quantidade_embalagens, quantidade_por_embalagem, valor_total_embalagem
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          compraId,
          produtoId,
          qtdTotal,
          precoUnitarioGravar,
          subtotalGravar,
          itemProcessado.produto_nome || null,
          itemProcessado.codigo_barras || null,
          Number(itemProcessado.margem_lucro || 30),
          Number(precoVendaGravar || 0),
          itemProcessado.unidade || 'UN',
          itemProcessado.ncm || null,
          Number(itemProcessado.frete_rateado || 0),
          Number(itemProcessado.desconto_rateado || 0),
          Number(itemProcessado.outras_despesas_rateado || 0),
          custoFinalGravar,
          Number(itemProcessado.produto_fracionado ?? itemProcessado.vendido_por_peso ?? 0),
          qtdTotal,
          custoFinalGravar,
          Number(itemProcessado.atualizar_preco_venda ?? 1),
          qtdFiscal > 0 ? 1 : 0,
          qtdFiscal,
          qtdNaoFiscal,
          itemProcessado.compra_em || itemProcessado.unidade_comercial || null,
          Number(itemProcessado.quantidade_embalagens || itemProcessado.quantidade_comercial || 0),
          Number(itemProcessado.quantidade_por_embalagem || 0),
          Number(itemProcessado.valor_total_embalagem || itemProcessado.subtotal || subtotalGravar || 0)
        ], (insertErr) => {
          if (insertErr) return done(insertErr);

          // MCC-04 — estoque somente via MotorEstoque (quantidade base já convertida pelo MCC)
          MotorEstoque.entrar(db, {
            produtoId,
            quantidadeBase: qtdTotal,
            quantidadeFiscal: qtdFiscal,
            quantidadeNaoFiscal: qtdNaoFiscal,
            origem: MotorEstoque.OrigemEstoque.COMPRA,
            loteId: resultadoMcc.lote?.id || null,
            referenciaTipo: 'compra',
            referenciaId: compraId,
            usuarioId: opcoes?.usuarioId || null,
            motivo: `ENTRADA_COMPRA:${compraId}`
          }).then(() => {
            db.run(`
              UPDATE produtos
              SET
                preco_compra = ?,
                preco_venda = CASE WHEN ? = 1 THEN ? ELSE preco_venda END,
                lucro_percentual = CASE WHEN ? = 1 THEN ? ELSE lucro_percentual END,
                fornecedor = COALESCE(?, fornecedor),
                ncm = COALESCE(?, ncm),
                codigo_barras = COALESCE(?, codigo_barras),
                unidade = COALESCE(?, unidade),
                produto_fracionado = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(produto_fracionado, 0) END,
                vendido_por_peso = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(vendido_por_peso, 0) END,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `, [
              precosCadastro.precoCompra,
              precosCadastro.atualizarVenda ? 1 : 0,
              precosCadastro.precoVenda ?? Number(itemProcessado.preco_venda_sugerido || 0),
              precosCadastro.atualizarVenda ? 1 : 0,
              precosCadastro.lucroPercentual,
              fornecedor || null,
              itemProcessado.ncm || null,
              itemProcessado.codigo_barras || null,
              itemProcessado.unidade || 'UN',
              Number(itemProcessado.produto_fracionado ?? itemProcessado.vendido_por_peso ?? 0),
              Number(itemProcessado.produto_fracionado ?? itemProcessado.vendido_por_peso ?? 0),
              produtoId
            ], (upErr) => {
              if (upErr) return done(upErr);

              const precoCompraNovo = precosCadastro.precoCompra;
              const precoVendaNovo = precosCadastro.atualizarVenda
                ? (precosCadastro.precoVenda ?? Number(itemProcessado.preco_venda_sugerido || 0))
                : Number(antigo.preco_venda || 0);

              if (antigo && (Number(antigo.preco_compra) !== Number(precoCompraNovo)
                || Number(antigo.preco_venda) !== Number(precoVendaNovo))) {
                db.run(`
                  INSERT INTO produtos_preco_historico (
                    produto_id, preco_compra_anterior, preco_compra_novo, preco_venda_anterior, preco_venda_novo
                  ) VALUES (?, ?, ?, ?, ?)
                `, [produtoId, antigo.preco_compra, precoCompraNovo, antigo.preco_venda, precoVendaNovo], () => next());
              } else {
                next();
              }
            });
          }).catch((estErr) => {
            const err = new Error(estErr?.message || String(estErr));
            err.status = estErr?.status || 500;
            err.codigo = estErr?.codigo;
            done(err);
          });
        });
      }).catch((mccErr) => {
        const status = mccErr?.status || 400;
        const err = new Error(mccErr?.message || String(mccErr));
        err.status = status;
        err.code = mccErr?.code;
        done(err);
      });
    });
  }

  next();
}

function garantirTabelaDevolucoesCompra(callback) {
  db.run(`
    CREATE TABLE IF NOT EXISTS compras_devolucoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER NOT NULL,
      compra_item_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade DECIMAL(10,3) NOT NULL,
      valor_unitario DECIMAL(10,2) NOT NULL,
      valor_total DECIMAL(10,2) NOT NULL,
      motivo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, callback);
}

router.post('/:id/devolver', validarCaixaAberto, (req, res) => {
  const compraId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim();
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

  if (!motivo || motivo.length < 10) {
    return res.status(400).json({ error: 'Informe um motivo com no mínimo 10 caracteres.' });
  }

  const itensValidos = itens
    .map(i => ({
      compra_item_id: Number(i.compra_item_id),
      quantidade: Number(i.quantidade)
    }))
    .filter(i => i.compra_item_id > 0 && i.quantidade > 0);

  if (!itensValidos.length) {
    return res.status(400).json({ error: 'Informe ao menos um item para devolução.' });
  }

  garantirTabelaDevolucoesCompra((tableErr) => {
    if (tableErr) return res.status(500).json({ error: tableErr.message });

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      db.get('SELECT * FROM compras WHERE id = ?', [compraId], (compraErr, compra) => {
        if (compraErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: compraErr.message });
        }

        if (!compra) {
          db.run('ROLLBACK');
          return res.status(404).json({ error: 'Compra não encontrada.' });
        }

        if (String(compra.status || '').toLowerCase() === 'cancelada') {
          db.run('ROLLBACK');
          return res.status(400).json({ error: 'Compra cancelada não pode receber devolução.' });
        }

        let index = 0;
        let valorTotalDevolvido = 0;

        function processarProximo() {
          if (index >= itensValidos.length) return finalizar();

          const itemReq = itensValidos[index++];

          db.get(`
            SELECT
              ci.*,
              COALESCE(p.nome, ci.descricao_produto) AS produto_nome,
              COALESCE(p.estoque_atual, 0) AS estoque_atual,
              COALESCE((
                SELECT SUM(cd.quantidade)
                FROM compras_devolucoes cd
                WHERE cd.compra_item_id = ci.id
              ), 0) AS quantidade_ja_devolvida
            FROM compras_itens ci
            LEFT JOIN produtos p ON p.id = ci.produto_id
            WHERE ci.id = ? AND ci.compra_id = ?
          `, [itemReq.compra_item_id, compraId], (itemErr, item) => {
            if (itemErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: itemErr.message });
            }

            if (!item) {
              db.run('ROLLBACK');
              return res.status(404).json({ error: 'Item da compra não encontrado.' });
            }

            const qtdComprada = Number(item.quantidade || 0);
            const qtdJaDevolvida = Number(item.quantidade_ja_devolvida || 0);
            const qtdDisponivel = qtdComprada - qtdJaDevolvida;
            const qtdDevolver = Number(itemReq.quantidade || 0);
            const estoqueAtual = Number(item.estoque_atual || 0);

            if (qtdDevolver > qtdDisponivel) {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `Produto "${item.produto_nome}" permite devolver no máximo ${qtdDisponivel}.`
              });
            }

            if (estoqueAtual < qtdDevolver) {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `Estoque insuficiente para devolver "${item.produto_nome}". Estoque atual: ${estoqueAtual}.`
              });
            }

            const valorUnitario = Number(item.custo_unitario_final || item.preco_unitario || 0);
            const valorTotal = Number((qtdDevolver * valorUnitario).toFixed(2));
            valorTotalDevolvido += valorTotal;

            db.run(`
              INSERT INTO compras_devolucoes (
                compra_id, compra_item_id, produto_id, quantidade,
                valor_unitario, valor_total, motivo
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
              compraId,
              item.id,
              item.produto_id,
              qtdDevolver,
              valorUnitario,
              valorTotal,
              motivo
            ], (insertErr) => {
              if (insertErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: insertErr.message });
              }

              const jaDevolvido = resolverJaDevolvidoCompraFiscalPrimeiro(item, qtdJaDevolvida);
              const splitDevolucao = calcularDevolucaoCompraFiscalPrimeiro(item, qtdDevolver, jaDevolvido);

              db.run(`
                UPDATE produtos
                SET
                  saldo_fiscal = saldo_fiscal - ?,
                  saldo_nao_fiscal = saldo_nao_fiscal - ?,
                  estoque_atual = (saldo_fiscal - ?) + (saldo_nao_fiscal - ?),
                  updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `, [
                splitDevolucao.qtdFiscal,
                splitDevolucao.qtdNaoFiscal,
                splitDevolucao.qtdFiscal,
                splitDevolucao.qtdNaoFiscal,
                item.produto_id
              ], (estoqueErr) => {
                if (estoqueErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: estoqueErr.message });
                }

                processarProximo();
              });
            });
          });
        }

        function finalizar() {
          db.get(`
            SELECT COUNT(*) AS itens_pendentes
            FROM compras_itens ci
            WHERE ci.compra_id = ?
              AND ci.quantidade > COALESCE((
                SELECT SUM(cd.quantidade)
                FROM compras_devolucoes cd
                WHERE cd.compra_item_id = ci.id
              ), 0)
          `, [compraId], (sumErr, sum) => {
            if (sumErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: sumErr.message });
            }

            const statusNovo = Number(sum.itens_pendentes || 0) === 0
              ? 'devolvida'
              : 'devolvida_parcial';

            db.run(`
              INSERT INTO financeiro (
                tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                referencia_id, referencia_tipo, status, origem, documento,
                vencimento, compra_id, pessoa_nome, observacao
              ) VALUES (?, ?, ?, DATE('now','localtime'), ?, ?, ?, ?, ?, ?, ?, DATE('now','localtime'), ?, ?, ?)
            `, [
              'receita',
              `Crédito de devolução da compra ${compraId}`,
              Number(valorTotalDevolvido.toFixed(2)),
              'devolucao_compra',
              null,
              compraId,
              'devolucao_compra',
              'pendente',
              'devolucao_compra',
              null,
              compraId,
              compra.fornecedor || null,
              motivo
            ], (finErr) => {
              if (finErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: finErr.message });
              }

              db.run(`
                UPDATE compras
                SET status = ?,
                    observacao = COALESCE(observacao, '') || ?
                WHERE id = ?
              `, [
                statusNovo,
                ` | Devolução: ${motivo}`,
                compraId
              ], (upErr) => {
                if (upErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: upErr.message });
                }

                db.run('COMMIT');
                // auditoria de devolução (associando sessao de caixa quando aplicável)
                gravarAuditoria({
                  usuario_id: req.operadorId || req.user?.id || null,
                  usuario_nome: req.user?.nome || req.user?.username || null,
                  modulo: 'compras',
                  acao: 'devolucao_compra',
                  referencia_tipo: 'compra',
                  referencia_id: compraId,
                  detalhes: { status_compra: statusNovo, valor_devolvido: Number(valorTotalDevolvido.toFixed(2)), motivo, sessao_id: req.caixaSessaoId || null },
                  ip_requisicao: req.ip || null
                }).catch((auditErr) => console.error('Erro ao gravar auditoria de devolução de compra:', auditErr));

                res.json({
                  success: true,
                  message: statusNovo === 'devolvida'
                    ? 'Compra devolvida totalmente.'
                    : 'Devolução parcial registrada com sucesso.',
                  status_compra: statusNovo,
                  valor_devolvido: Number(valorTotalDevolvido.toFixed(2))
                });
              });
            });
          });
        }

        processarProximo();
      });
    });
  });
});

router.get('/', (req, res) => {
  db.all(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM compras_itens WHERE compra_id = c.id) as total_itens,
      (SELECT COUNT(*) FROM financeiro f WHERE f.compra_id = c.id AND f.status = 'pendente') as parcelas_pendentes
    FROM compras c 
    ORDER BY c.data_compra DESC, c.id DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;

  garantirTabelaDevolucoesCompra((tableErr) => {
    if (tableErr) return res.status(500).json({ error: tableErr.message });

    db.get('SELECT * FROM compras WHERE id = ?', [id], (err, compra) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!compra) return res.status(404).json({ error: 'Compra não encontrada.' });

      db.all(`
        SELECT
          ci.*,
          COALESCE(p.nome, ci.descricao_produto) AS produto_nome,
          p.codigo AS produto_codigo,
          COALESCE((
            SELECT SUM(cd.quantidade)
            FROM compras_devolucoes cd
            WHERE cd.compra_item_id = ci.id
          ), 0) AS quantidade_devolvida
        FROM compras_itens ci
        LEFT JOIN produtos p ON ci.produto_id = p.id
        WHERE ci.compra_id = ?
        ORDER BY ci.id
      `, [id], (itErr, itens) => {
        if (itErr) return res.status(500).json({ error: itErr.message });
        db.all('SELECT * FROM financeiro WHERE compra_id = ? ORDER BY numero_parcela, vencimento', [id], (finErr, financeiro) => {
          if (finErr) return res.status(500).json({ error: finErr.message });
          res.json({ ...compra, itens, financeiro });
        });
      });
    });
  });
});

router.post('/', (req, res) => {
  const {
    data_compra,
    data_emissao,
    data_entrada,
    fornecedor,
    fornecedor_cnpj,
    fornecedor_rua,
    fornecedor_numero,
    fornecedor_bairro,
    fornecedor_cidade,
    fornecedor_uf,
    fornecedor_cep,
    numero_nf,
    serie_nf,
    modelo_nf,
    chave_acesso,
    valor_produtos,
    valor_desconto,
    valor_frete,
    valor_outras_despesas,
    valor_total_nota,
    total,
    itens,
    condicao_pagamento,
    forma_pagamento,
    data_vencimento,
    parcelas,
    valor_entrada,
    observacao,
    nota_fiscal_avulsa,
    tipo_entrada,
    central_documento_id: centralDocumentoId
  } = req.body;

  const entrada = resolverCamposEntrada({ tipo_entrada, fornecedor, observacao });
  const isProducaoPropria = entrada.is_producao_propria;
  const fornecedorFinal = entrada.fornecedor;
  const observacaoFinal = entrada.observacao;
  const gerarFinanceiro = deveGerarFinanceiroEntrada(entrada.tipo_entrada);

  const isNotaAvulsa = Number(nota_fiscal_avulsa) === 1;

  if (isProducaoPropria && isNotaAvulsa) {
    return res.status(400).json({
      error: 'Produção Própria não permite Nota Fiscal Avulsa. Utilize itens para abastecer o estoque.'
    });
  }

  if (!isNotaAvulsa) {
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um item para a compra.' });
    }

    for (const item of itens) {
      const erroDistribuicao = validarDistribuicaoItemCompra(item);
      if (erroDistribuicao) {
        return res.status(400).json({ error: erroDistribuicao });
      }
    }
  }

  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) {
    return res.status(400).json({ error: 'Total da compra inválido.' });
  }

  const chaveLimpa = digitsOnly(chave_acesso || '');
  if (chaveLimpa && chaveLimpa.length !== 44) {
    return res.status(400).json({ error: 'A chave de acesso da NF deve ter 44 dígitos.' });
  }

  let totalItensCalculado;
  let totalCalculadoComAjustes;
  let diferencaTotal;
  let itensComRateio;

  if (isNotaAvulsa) {
    totalItensCalculado = moeda(valor_total_nota || totalNum);
    totalCalculadoComAjustes = moeda(valor_total_nota || totalNum);
    diferencaTotal = 0;
    itensComRateio = [];
  } else {
    totalItensCalculado = moeda(
      itens.reduce((sum, item) => sum + moeda(item.subtotal), 0)
    );

    totalCalculadoComAjustes = moeda(
      totalItensCalculado - Number(valor_desconto || 0) + Number(valor_frete || 0) + Number(valor_outras_despesas || 0)
    );

    const totalXml = moeda(valor_total_nota || totalNum);
    diferencaTotal = moeda(totalXml - totalCalculadoComAjustes);

    itensComRateio = calcularRateioItens(itens, {
      valor_frete,
      valor_desconto,
      valor_outras_despesas
    });
  }

  const condicao = isProducaoPropria ? 'avista' : (condicao_pagamento || 'avista');
  const qtdParcelas = Math.max(1, Number(parcelas) || 1);
  const formaPagamentoFinal = isProducaoPropria ? null : (forma_pagamento || null);
  const cnpjFornecedorFinal = isProducaoPropria ? null : (fornecedor_cnpj || null);

  const continuarGravacao = () => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      db.run(`
        INSERT INTO compras (
          data_compra, data_emissao, data_entrada, fornecedor, fornecedor_cnpj,
          numero_nf, serie_nf, modelo_nf, chave_acesso,
          valor_produtos, valor_desconto, valor_frete, valor_outras_despesas,
          valor_total_nota, total, total_xml, total_itens_calculado, diferenca_total,
          status, condicao_pagamento, forma_pagamento, data_vencimento,
          parcelas, valor_entrada, observacao, nota_fiscal_avulsa,
          tipo_entrada, origem_movimentacao, tipo_movimentacao
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        data_compra,
        data_emissao || null,
        data_entrada || null,
        fornecedorFinal,
        cnpjFornecedorFinal,
        numero_nf || null,
        serie_nf || null,
        modelo_nf || null,
        chaveLimpa || null,
        Number(valor_produtos) || 0,
        Number(valor_desconto) || 0,
        Number(valor_frete) || 0,
        Number(valor_outras_despesas) || 0,
        totalCalculadoComAjustes,
        totalCalculadoComAjustes,
        totalCalculadoComAjustes,
        totalItensCalculado,
        diferencaTotal,
        condicao,
        formaPagamentoFinal,
        isProducaoPropria ? null : (data_vencimento || (condicao === 'avista' ? data_compra : null)),
        isProducaoPropria ? 1 : (condicao === 'parcelado' || condicao === 'entrada_parcelado' ? qtdParcelas : 1),
        isProducaoPropria ? 0 : (Number(valor_entrada) || 0),
        observacaoFinal,
        isNotaAvulsa ? 1 : 0,
        entrada.tipo_entrada,
        entrada.origem_movimentacao,
        entrada.tipo_movimentacao
      ], function(err) {
        if (err) {
          db.run('ROLLBACK');

          if (String(err.message || '').includes('UNIQUE') || String(err.message || '').includes('compras.chave_acesso')) {
            return res.status(400).json({ error: 'Esta nota já foi lançada. A chave de acesso já existe no sistema.' });
          }

          return res.status(500).json({ error: err.message });
        }

        const compraId = this.lastID;

        const finalizarSemFinanceiro = (acaoAuditoria, mensagem, extras = {}) => {
          db.run('COMMIT');

          gravarAuditoria({
            usuario_id: req.user?.id || null,
            usuario_nome: req.user?.nome || req.user?.username || null,
            modulo: 'compras',
            acao: acaoAuditoria,
            referencia_tipo: 'compra',
            referencia_id: compraId,
            detalhes: {
              total: totalCalculadoComAjustes,
              fornecedor: fornecedorFinal,
              tipo_entrada: entrada.tipo_entrada,
              origem_movimentacao: entrada.origem_movimentacao,
              tipo_movimentacao: entrada.tipo_movimentacao,
              financeiro_gerado: false,
              ...extras
            },
            ip_requisicao: req.ip || null
          }).catch((auditErr) => console.error('Erro ao gravar auditoria de entrada:', auditErr));

          const payloadResposta = {
            id: compraId,
            message: mensagem,
            tipo_entrada: entrada.tipo_entrada,
            origem_movimentacao: entrada.origem_movimentacao,
            tipo_movimentacao: entrada.tipo_movimentacao,
            financeiro_gerado: false,
            ...extras
          };

          vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, req.user?.id)
            .finally(() => res.json(payloadResposta));
        };

        if (isNotaAvulsa) {
          // Nota Fiscal Avulsa: skip item processing, only create financial records
          criarFinanceiroCompra({
            id: compraId,
            data_compra,
            fornecedor: fornecedorFinal,
            total: totalCalculadoComAjustes,
            condicao_pagamento: condicao,
            forma_pagamento: formaPagamentoFinal,
            data_vencimento: data_vencimento || (condicao === 'avista' ? data_compra : null),
            parcelas: (condicao === 'parcelado' || condicao === 'entrada_parcelado') ? qtdParcelas : 1,
            valor_entrada: Number(valor_entrada) || 0,
            observacao: observacaoFinal
          }, (finErr) => {
            if (finErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: finErr.message });
            }

            db.run('COMMIT');

            gravarAuditoria({
              usuario_id: req.user?.id || null,
              usuario_nome: req.user?.nome || req.user?.username || null,
              modulo: 'compras',
              acao: 'criar_nota_fiscal_avulsa',
              referencia_tipo: 'compra',
              referencia_id: compraId,
              detalhes: {
                total: totalCalculadoComAjustes,
                fornecedor: fornecedorFinal,
                nota_fiscal_avulsa: true,
                tipo_entrada: entrada.tipo_entrada
              },
              ip_requisicao: req.ip || null
            }).catch((auditErr) => console.error('Erro ao gravar auditoria de nota fiscal avulsa:', auditErr));

            const payloadResposta = {
              id: compraId,
              message: 'Nota Fiscal Avulsa registrada com sucesso.',
              nota_fiscal_avulsa: true
            };

            vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, req.user?.id)
              .finally(() => res.json(payloadResposta));
          });
        } else {
          // Entrada com itens: estoque + (financeiro só se compra de fornecedor)
          console.log('Processando itens da compra:', compraId, itensComRateio);
          processarItensCompra(
            compraId,
            itensComRateio,
            fornecedorFinal,
            {
              fornecedor_cnpj: cnpjFornecedorFinal,
              loteOrigem: entrada.lote_origem
            },
            (itensErr) => {
            if (itensErr) {
              console.error('Erro ao processar itens da compra:', itensErr);
              db.run('ROLLBACK');
              const status = Number(itensErr.status) >= 400 && Number(itensErr.status) < 600
                ? Number(itensErr.status)
                : 500;
              return res.status(status).json({
                error: itensErr.message,
                codigo: itensErr.codigo || itensErr.code || undefined
              });
            }

            if (!gerarFinanceiro) {
              return finalizarSemFinanceiro(
                'criar_abastecimento_producao',
                'Abastecimento de produção própria registrado com sucesso (estoque atualizado, sem financeiro).',
                {
                  conferencia: {
                    total_xml: totalCalculadoComAjustes,
                    total_itens_calculado: totalItensCalculado,
                    diferenca_total: diferencaTotal
                  }
                }
              );
            }

            criarFinanceiroCompra({
              id: compraId,
              data_compra,
              fornecedor: fornecedorFinal,
              total: totalCalculadoComAjustes,
              condicao_pagamento: condicao,
              forma_pagamento: formaPagamentoFinal,
              data_vencimento: data_vencimento || (condicao === 'avista' ? data_compra : null),
              parcelas: (condicao === 'parcelado' || condicao === 'entrada_parcelado') ? qtdParcelas : 1,
              valor_entrada: Number(valor_entrada) || 0,
              observacao: observacaoFinal
            }, (finErr) => {
              if (finErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: finErr.message });
              }

              db.run('COMMIT');

              gravarAuditoria({
                usuario_id: req.user?.id || null,
                usuario_nome: req.user?.nome || req.user?.username || null,
                modulo: 'compras',
                acao: 'criar_compra',
                referencia_tipo: 'compra',
                referencia_id: compraId,
                detalhes: {
                  total: totalCalculadoComAjustes,
                  fornecedor: fornecedorFinal,
                  tipo_entrada: entrada.tipo_entrada,
                  financeiro_gerado: true
                },
                ip_requisicao: req.ip || null
              }).catch((auditErr) => console.error('Erro ao gravar auditoria de criação de compra:', auditErr));

              const payloadResposta = {
                id: compraId,
                message: 'Compra registrada com sucesso e integrada ao estoque/financeiro.',
                tipo_entrada: entrada.tipo_entrada,
                financeiro_gerado: true,
                conferencia: {
                  total_xml: totalCalculadoComAjustes,
                  total_itens_calculado: totalItensCalculado,
                  diferenca_total: diferencaTotal
                }
              };

              vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, req.user?.id)
                .finally(() => res.json(payloadResposta));
            });
          });
        }
      });
    });
  }

  if (chaveLimpa) {
    db.get('SELECT id, status FROM compras WHERE chave_acesso = ? LIMIT 1', [chaveLimpa], (dupErr, existente) => {
      if (dupErr) return res.status(500).json({ error: dupErr.message });

      if (existente) {
        return res.status(400).json({
          error: `Esta nota já foi lançada na compra #${existente.id}. Não é permitido lançar a mesma chave de acesso duas vezes.` 
        });
      }

      if (isProducaoPropria) {
        return continuarGravacao();
      }

      garantirFornecedorCompra({
        fornecedor: fornecedorFinal,
        fornecedor_cnpj: cnpjFornecedorFinal,
        fornecedor_rua,
        fornecedor_numero,
        fornecedor_bairro,
        fornecedor_cidade,
        fornecedor_uf,
        fornecedor_cep
      }, (fornErr) => {
        if (fornErr) return res.status(500).json({ error: fornErr.message });
        continuarGravacao();
      });
    });
  } else if (isProducaoPropria) {
    continuarGravacao();
  } else {
    garantirFornecedorCompra({
      fornecedor: fornecedorFinal,
      fornecedor_cnpj: cnpjFornecedorFinal,
      fornecedor_rua,
      fornecedor_numero,
      fornecedor_bairro,
      fornecedor_cidade,
      fornecedor_uf,
      fornecedor_cep
    }, (fornErr) => {
      if (fornErr) return res.status(500).json({ error: fornErr.message });
      continuarGravacao();
    });
  }
});

router.post('/:id/cancelar', (req, res) => {
  const { id } = req.params;
  const motivo = String(req.body?.motivo || 'Cancelamento manual da compra').trim();

  db.serialize(() => {
    db.run('BEGIN IMMEDIATE');

    db.get('SELECT * FROM compras WHERE id = ?', [id], (compraErr, compra) => {
      if (compraErr) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: compraErr.message });
      }

      if (!compra) {
        db.run('ROLLBACK');
        return res.status(404).json({ error: 'Compra não encontrada.' });
      }

      if (compra.status === 'cancelada') {
        db.run('ROLLBACK');
        return res.status(400).json({ error: 'Esta compra já está cancelada.' });
      }

      db.all('SELECT * FROM compras_itens WHERE compra_id = ?', [id], (itensErr, itens) => {
        if (itensErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: itensErr.message });
        }

        const validarEstoque = (index = 0) => {
          if (index >= itens.length) return baixarEstoque();

          const item = itens[index];

          db.get('SELECT nome, estoque_atual FROM produtos WHERE id = ?', [item.produto_id], (prodErr, produto) => {
            if (prodErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: prodErr.message });
            }

            const estoqueAtual = Number(produto?.estoque_atual || 0);
            const quantidadeBaixar = Number(item.quantidade || 0);

            if (estoqueAtual < quantidadeBaixar) {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `Não é possível cancelar. O produto "${produto?.nome || item.descricao_produto}" tem estoque atual ${estoqueAtual}, mas a compra adicionou ${quantidadeBaixar}.` 
              });
            }

            validarEstoque(index + 1);
          });
        };

        const baixarEstoque = (index = 0) => {
          if (index >= itens.length) return finalizarCancelamento();

          const item = itens[index];
          const qtds = resolverQuantidadesCompraItemPersistido(item);

          db.run(`
            UPDATE produtos
            SET
              saldo_fiscal = saldo_fiscal - ?,
              saldo_nao_fiscal = saldo_nao_fiscal - ?,
              estoque_atual = (saldo_fiscal - ?) + (saldo_nao_fiscal - ?),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [
            qtds.quantidade_fiscal,
            qtds.quantidade_nao_fiscal,
            qtds.quantidade_fiscal,
            qtds.quantidade_nao_fiscal,
            item.produto_id
          ], (upErr) => {
            if (upErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: upErr.message });
            }

            baixarEstoque(index + 1);
          });
        };

        const finalizarCancelamento = () => {
          db.run(`
            UPDATE financeiro
            SET status = 'cancelado',
                observacao = COALESCE(observacao, '') || ' | Cancelado junto com a compra.'
            WHERE compra_id = ?
          `, [id], (finErr) => {
            if (finErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: finErr.message });
            }

            db.run(`
              UPDATE compras
              SET status = 'cancelada',
                  cancelada_em = CURRENT_TIMESTAMP,
                  motivo_cancelamento = ?
              WHERE id = ?
            `, [motivo, id], (compraUpErr) => {
              if (compraUpErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: compraUpErr.message });
              }

              db.run('COMMIT');
              // gravar auditoria do cancelamento
              gravarAuditoria({
                usuario_id: req.user?.id || null,
                usuario_nome: req.user?.nome || req.user?.username || null,
                modulo: 'compras',
                acao: 'cancelar_compra',
                referencia_tipo: 'compra',
                referencia_id: id,
                detalhes: { motivo },
                ip_requisicao: req.ip || null
              }).catch((auditErr) => console.error('Erro ao gravar auditoria de cancelamento de compra:', auditErr));

              res.json({ message: 'Compra cancelada com segurança. Estoque e financeiro foram ajustados.' });
            });
          });
        };

        validarEstoque();
      });
    });
  });
});

/** @deprecated RC1 — Upload descontinuado; documentos entram pela Central Inteligente. */
router.post('/parse-xml', async (req, res) => {
  return res.status(410).json({
    error: 'Upload de XML em Compras foi descontinuado.',
    deprecated: true,
    mensagem: 'Documentos fiscais devem entrar pela Central Inteligente de Entradas.',
    substituicao: 'POST /api/central-entradas/sincronizar (DF-e) ou aguarde upload enterprise na Central.',
    documentacao: 'backend/motores/central-entradas/README.md'
  });
});

router.post('/:id/emitir-nfe-devolucao', async (req, res) => {
  try {
    const compraId = Number(req.params.id);

    const resultado = await emitirNFeDevolucaoCompra(compraId);

    if (!resultado.success && resultado.status === 'rejeitada') {
      return res.status(400).json({
        sucesso: false,
        autorizado: false,
        mensagem: 'NF-e de devolução rejeitada pela SEFAZ.',
        cStat: resultado.cStat,
        xMotivo: resultado.xMotivo,
        retornoSefaz: resultado.retorno,
        resultado
      });
    }

    res.json({
      message: resultado.success
        ? 'NF-e de devolução autorizada com sucesso.'
        : 'NF-e de devolução enviada/processada.',
      resultado
    });
  } catch (error) {
    console.error('Erro ao emitir NF-e de devolução:', error);
    res.status(error.statusCode || 500).json({ error: error.message, codigo: error.codigo || null });
  }
});

router.put('/:id/chave-nfe-fornecedor', (req, res) => {
  const id = Number(req.params.id);
  const chave = String(req.body?.chave || '').replace(/\D/g, '');

  if (chave.length !== 44) {
    return res.status(400).json({ error: 'A chave da NF-e deve ter 44 dígitos.' });
  }

  db.run(`
    UPDATE compras
    SET chave_acesso = ?
    WHERE id = ?
  `, [chave, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });

    res.json({
      success: true,
      message: 'Chave da NF-e original salva com sucesso.'
    });
  });
});

module.exports = router;
