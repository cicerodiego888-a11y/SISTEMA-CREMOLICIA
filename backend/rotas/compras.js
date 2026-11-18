const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
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
const {
  resolverProdutoItemCompra,
  itemPodeEntrarEstoque,
  MENSAGEM_PRODUTO_NAO_CADASTRADO,
  CODIGO_PRODUTO_NAO_CADASTRADO,
  MOTIVO_PRODUTO_INATIVO,
  MENSAGEM_PRODUTO_INATIVO,
  MOTIVO_PRODUTO_NAO_INSUMO,
  MENSAGEM_PRODUTO_NAO_INSUMO,
  produtoPodeSerInsumoCompra
} = require('../modules/compras/resolverProdutoItem');
const { confirmarProdutoItemCompra } = require('../modules/compras/confirmarProdutoItem');
const {
  STATUS: STATUS_FISCAL_ENTRADA,
  itemEhUsoEConsumo,
  resolverFiscalEntrada,
  resolverBloqueioOrigem,
  carregarEmpresaFiscal
} = require('../modules/compras/resolverFiscalEntrada');
const { carregarContextoFiscalConfiavel, localizarItemXml } = require('../modules/compras/contextoFiscalConfiavel');
const {
  resolverDestinoItemCompra,
  vincularUnidadeDestino
} = require('../modules/compras/destinoEstoqueItem');
const { publicarEventoCompraApMfe } = require('../motores/motor-financeiro/adapters');
const { obterMotor, FeatureFlag } = require('../motores/motor-financeiro');

const comprasIdempotentesEmProcessamento = new Map();

function serializarConteudoCanonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(serializarConteudoCanonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((chave) => (
      `${JSON.stringify(chave)}:${serializarConteudoCanonico(valor[chave])}`
    )).join(',')}}`;
  }
  return JSON.stringify(valor);
}

function hashConteudoCompra(valor) {
  return crypto.createHash('sha256').update(serializarConteudoCanonico(valor)).digest('hex');
}

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

function ensureProductForItem(item, callback) {
  confirmarProdutoItemCompra(db, item, {
    miip: MiipService,
    contexto: { origem: 'compra', ponto: 'ensureProductForItem' }
  })
    .then((resultado) => {
      if (!itemPodeEntrarEstoque(resultado)) {
        const err = new Error(MENSAGEM_PRODUTO_NAO_CADASTRADO);
        err.status = 409;
        err.codigo = CODIGO_PRODUTO_NAO_CADASTRADO;
        err.item = resultado;
        return callback(err);
      }
      if (!produtoPodeSerInsumoCompra(resultado)) {
        const err = new Error(MENSAGEM_PRODUTO_NAO_INSUMO);
        err.status = 400;
        err.codigo = MOTIVO_PRODUTO_NAO_INSUMO;
        err.item = resultado;
        return callback(err);
      }
      callback(null, resultado.produtoId);
    })
    .catch((err) => callback(err));
}

function resolverItensAntesDeGravar(itens) {
  const resultados = [];
  let indice = 0;

  return new Promise((resolve, reject) => {
    const passo = () => {
      if (indice >= itens.length) return resolve(resultados);
      const item = itens[indice];
      if (itemEhUsoEConsumo(item)) {
        // Uso e consumo não passa pelo vínculo de insumo/estoque; o produto foi validado no resolvedor fiscal.
        resultados.push({ situacao: 'VINCULADO', produtoId: Number(item.produto_id) || null });
        indice += 1;
        return passo();
      }
      ensureProductForItem(item, (err, produtoId) => {
        if (err && err.codigo === CODIGO_PRODUTO_NAO_CADASTRADO) {
          resultados.push({
            ...(err.item || {}),
            situacao: CODIGO_PRODUTO_NAO_CADASTRADO,
            produtoId: null
          });
          indice += 1;
          return passo();
        }
        if (err) return reject(err);
        resultados.push({ situacao: 'VINCULADO', produtoId: Number(produtoId) });
        indice += 1;
        return passo();
      });
    };
    passo();
  });
}

/** Uso e consumo: grava só o item com a classificação fiscal; sem MCC, estoque ou alteração do produto. */
function inserirItemUsoConsumoCompra(compraId, item, cb) {
  const fiscal = item.fiscal_entrada;
  if (!fiscal || fiscal.status !== STATUS_FISCAL_ENTRADA.APLICAVEL) {
    const err = new Error('Item de uso e consumo sem classificação fiscal validada.');
    err.status = 422;
    err.codigo = 'FISCAL_ENTRADA_PENDENTE';
    return cb(err);
  }
  const quantidade = Number(item.quantidade || 0);
  const subtotal = moeda(item.subtotal ?? quantidade * Number(item.preco_unitario || 0));
  const xml = fiscal.dados_xml_originais || {};
  db.run(`
    INSERT INTO compras_itens (
      compra_id, produto_id, quantidade, preco_unitario, subtotal,
      descricao_produto, codigo_barras, unidade, ncm,
      frete_rateado, desconto_rateado, outras_despesas_rateado, custo_unitario_final,
      atualizar_preco_venda, item_fiscal, quantidade_fiscal, quantidade_nao_fiscal,
      destino_estoque, finalidade_item, cfop_xml, cst_csosn_xml, orig_xml,
      cfop_entrada, regra_fiscal_entrada, origem_regra_fiscal, justificativa_fiscal,
      numero_item_xml, central_documento_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    compraId,
    Number(item.produto_id) || null,
    quantidade,
    Number(item.preco_unitario || 0),
    subtotal,
    item.produto_nome || null,
    item.codigo_barras || null,
    item.unidade || 'UN',
    item.ncm || null,
    Number(item.frete_rateado || 0),
    Number(item.desconto_rateado || 0),
    Number(item.outras_despesas_rateado || 0),
    quantidade > 0 ? moeda(subtotal / quantidade) : 0,
    fiscal.finalidade,
    xml.cfop || null,
    xml.cst_csosn || null,
    xml.orig || null,
    fiscal.cfop_entrada,
    fiscal.regra,
    fiscal.origem_regra,
    String(item.justificativa_fiscal || '').trim() || null,
    fiscal.numero_item_xml ?? null,
    fiscal.central_documento_id ?? null
  ], (err) => cb(err || null));
}

function processarItensCompra(compraId, itens, fornecedor, opcoes, done) {
  if (typeof opcoes === 'function') {
    done = opcoes;
    opcoes = {};
  }

  const fornecedorCnpj = opcoes?.fornecedor_cnpj || null;
  let index = 0;
  let finalizado = false;
  let itemEmAndamento = false;
  let unidadesCarregadas = false;

  db.all(`SELECT id, codigo, tipo FROM unidades_negocio WHERE COALESCE(ativa, 1) = 1`, [], (errUnidade, unidades) => {
    if (finalizado || unidadesCarregadas) return;
    unidadesCarregadas = true;
    if (errUnidade && !/no such table/i.test(errUnidade.message || '')) return finalizar(errUnidade);
    opcoes = { ...(opcoes || {}), unidades: unidades || [] };
    next();
  });

  function finalizar(err) {
    if (finalizado) return;
    finalizado = true;
    done(err || null);
  }

  function next() {
    if (finalizado || itemEmAndamento) return;
    if (index >= itens.length) {
      return finalizar(null);
    }

    const item = itens[index++];
    itemEmAndamento = true;
    let itemFinalizado = false;
    const finalizarItem = (err) => {
      if (itemFinalizado || finalizado) return;
      itemFinalizado = true;
      itemEmAndamento = false;
      if (err) return finalizar(err);
      next();
    };
    if (itemEhUsoEConsumo(item)) {
      return inserirItemUsoConsumoCompra(compraId, item, finalizarItem);
    }
    let destino;
    try {
      destino = vincularUnidadeDestino(
        resolverDestinoItemCompra(item, { legadoSemLocal: !!opcoes.legadoSemLocal }),
        opcoes.unidades || []
      );
    } catch (destinoErr) {
      return finalizarItem(destinoErr);
    }

    const itemComContexto = {
      ...item,
      fornecedor: item.fornecedor || fornecedor || null,
      fornecedor_cnpj: item.fornecedor_cnpj || fornecedorCnpj || null,
      mcc_entrada: 1
    };

    let produtoResolvido = false;
    ensureProductForItem(itemComContexto, (prodErr, produtoId) => {
      if (produtoResolvido || itemFinalizado || finalizado) return;
      produtoResolvido = true;
      if (prodErr) return finalizarItem(prodErr);

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
            compra_em, quantidade_embalagens, quantidade_por_embalagem, valor_total_embalagem,
            destino_estoque, local_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          Number(itemProcessado.valor_total_embalagem || itemProcessado.subtotal || subtotalGravar || 0),
          destino.local,
          destino.local_id
        ], (insertErr) => {
          if (itemFinalizado || finalizado) return;
          if (insertErr) return finalizarItem(insertErr);

          // MCC-04 — estoque somente via MotorEstoque (quantidade base já convertida pelo MCC)
          MotorEstoque.entrar(db, {
            produtoId,
            quantidadeBase: qtdTotal,
            quantidadeFiscal: qtdFiscal,
            quantidadeNaoFiscal: qtdNaoFiscal,
            origem: MotorEstoque.OrigemEstoque.COMPRA,
            local: destino.local,
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
                codigo_barras = CASE WHEN COALESCE(TRIM(codigo_barras), '') = '' THEN COALESCE(?, codigo_barras) ELSE codigo_barras END,
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
              /^\d{8,14}$/.test(String(itemProcessado.codigo_barras || '').trim())
                ? String(itemProcessado.codigo_barras).trim()
                : null,
              itemProcessado.unidade || 'UN',
              Number(itemProcessado.produto_fracionado ?? itemProcessado.vendido_por_peso ?? 0),
              Number(itemProcessado.produto_fracionado ?? itemProcessado.vendido_por_peso ?? 0),
              produtoId
            ], (upErr) => {
              if (itemFinalizado || finalizado) return;
              if (upErr) return finalizarItem(upErr);

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
                `, [produtoId, antigo.preco_compra, precoCompraNovo, antigo.preco_venda, precoVendaNovo], (historyErr) => {
                  if (historyErr) return finalizarItem(historyErr);
                  finalizarItem(null);
                });
              } else {
                finalizarItem(null);
              }
            });
          }).catch((estErr) => {
            const err = new Error(estErr?.message || String(estErr));
            err.status = estErr?.status || 500;
            err.codigo = estErr?.codigo;
            finalizarItem(err);
          });
        });
      }).catch((mccErr) => {
        const status = mccErr?.status || 400;
        const err = new Error(mccErr?.message || String(mccErr));
        err.status = status;
        err.code = mccErr?.code;
        finalizarItem(err);
      });
    });
  }
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

            if (String(item.finalidade_item || '').toUpperCase() === 'USO_E_CONSUMO') {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `O item "${item.produto_nome}" é de uso e consumo e não possui estoque para devolução por este fluxo.`
              });
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

router.post('/resolver-itens', (req, res) => {
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
  Promise.all(itens.map((item) => resolverProdutoItemCompra(db, item)))
    .then((resultados) => {
      res.json({
        itens: resultados,
        pendentes: resultados.filter((item) => item.situacao === CODIGO_PRODUTO_NAO_CADASTRADO).length
      });
    })
    .catch((err) => {
      console.error('Erro ao resolver itens da compra:', err);
      res.status(500).json({ error: err.message });
    });
});

function buscarNaturezaProdutoCompra(produtoId) {
  return new Promise((resolve, reject) => {
    if (!produtoId) return resolve({ encontrado: false, natureza: null });
    db.get('SELECT natureza_cadastro FROM produtos WHERE id = ?', [produtoId], (err, row) => {
      if (err) return reject(err);
      resolve({ encontrado: !!row, natureza: row?.natureza_cadastro || null });
    });
  });
}

/**
 * Resolve a classificação fiscal de entrada dos itens de uso e consumo (itens sem a finalidade ficam inalterados).
 * UF, CFOP, CST/CSOSN, origem, CRT e destinatário vêm exclusivamente do XML original persistido no backend,
 * localizado por central_documento_id; os campos fiscais do corpo da requisição são ignorados.
 */
async function resolverFiscalEntradaItensCompra(body, usuarioId) {
  const itens = Array.isArray(body?.itens) ? body.itens : [];
  if (!itens.some(itemEhUsoEConsumo)) return itens.map(() => null);

  const empresa = await carregarEmpresaFiscal(db);
  const contexto = await carregarContextoFiscalConfiavel(db, {
    centralDocumentoId: body.central_documento_id,
    chaveAcessoInformada: body.chave_acesso
  });

  return Promise.all(itens.map(async (item) => {
    if (!itemEhUsoEConsumo(item)) return null;
    const base = { finalidade_item: item.finalidade_item };
    if (!contexto.ok) return resolverBloqueioOrigem(base, contexto.motivo);

    const { itemXml, erro } = localizarItemXml(contexto.itensXml, item);
    if (erro) return resolverBloqueioOrigem(base, erro);

    const produto = await buscarNaturezaProdutoCompra(item.produto_id);
    if (!produto.encontrado) {
      return resolverBloqueioOrigem(base, 'Vincule o item a um produto cadastrado antes de classificá-lo como uso e consumo.');
    }

    const resolucao = resolverFiscalEntrada({
      item: {
        finalidade_item: item.finalidade_item,
        cfop_xml: itemXml.cfop_xml,
        cst_csosn_xml: itemXml.cst_csosn_xml,
        orig_xml: itemXml.orig_xml,
        produto_natureza: produto.natureza,
        cfop_entrada_manual: item.cfop_entrada_manual,
        justificativa_fiscal: item.justificativa_fiscal
      },
      documento: contexto.documento,
      empresa,
      usuarioId
    });

    const divergentes = [['cfop_xml', 'CFOP'], ['cst_csosn_xml', 'CST/CSOSN'], ['orig_xml', 'origem']]
      .filter(([campo]) => item[campo] != null && String(item[campo]).trim() !== '' && String(item[campo]).trim() !== String(itemXml[campo] ?? '').trim())
      .map(([, rotulo]) => rotulo);
    const confiavelPorCampo = {
      fornecedor_uf: contexto.documento.emitente_uf,
      fornecedor_crt: contexto.documento.emitente_crt,
      destinatario_uf: contexto.documento.destinatario_uf,
      destinatario_cnpj: contexto.documento.destinatario_cnpj
    };
    const clienteDivergente = Object.entries(confiavelPorCampo).some(([campo, valor]) => (
      String(body[campo] ?? '').trim() !== '' && normalizarFiscal(body[campo]) !== normalizarFiscal(valor)
    ));
    if (divergentes.length || clienteDivergente) {
      resolucao.alertas.push('Dados fiscais enviados pelo navegador divergem do XML original e foram ignorados; prevalece o XML armazenado.');
    }

    resolucao.numero_item_xml = itemXml.numero_item_xml;
    resolucao.central_documento_id = contexto.centralDocumentoId;
    resolucao.destinatario_confiavel = {
      cnpj: contexto.documento.destinatario_cnpj,
      uf: contexto.documento.destinatario_uf
    };
    return resolucao;
  }));
}

const normalizarFiscal = (v) => String(v ?? '').trim().toUpperCase().replace(/[.\-/]/g, '');

function resumirResolucaoFiscal(item, indice, resolucao) {
  return {
    indice,
    produto_nome: item?.produto_nome || null,
    status: resolucao.status,
    finalidade: resolucao.finalidade,
    cfop_entrada: resolucao.cfop_entrada,
    regra: resolucao.regra,
    origem_regra: resolucao.origem_regra,
    escopo: resolucao.escopo,
    mensagens: resolucao.mensagens,
    alertas: resolucao.alertas,
    dados_xml_originais: resolucao.dados_xml_originais
  };
}

// Pré-visualização do tratamento fiscal proposto; não grava nada.
router.post('/validar-fiscal-entrada', (req, res) => {
  resolverFiscalEntradaItensCompra(req.body, req.user?.id)
    .then((resultados) => {
      const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
      res.json({
        itens: resultados.map((r, i) => (r ? resumirResolucaoFiscal(itens[i], i, r) : null))
      });
    })
    .catch((err) => {
      console.error('Erro ao validar tratamento fiscal de entrada:', err);
      res.status(500).json({ error: err.message });
    });
});

function validarFiscalEntradaCompra(req, res, next) {
  const itens = req.body?.itens;
  if (Number(req.body?.nota_fiscal_avulsa) === 1 || !Array.isArray(itens)) return next();

  // O resultado do servidor é a única fonte confiável; descarta qualquer valor enviado pelo cliente.
  itens.forEach((item) => {
    if (item && typeof item === 'object') delete item.fiscal_entrada;
  });

  resolverFiscalEntradaItensCompra(req.body, req.user?.id)
    .then((resultados) => {
      const pendentes = [];
      resultados.forEach((resolucao, indice) => {
        if (!resolucao) return;
        if (resolucao.status === STATUS_FISCAL_ENTRADA.APLICAVEL) {
          itens[indice].fiscal_entrada = resolucao;
          if (resolucao.destinatario_confiavel) {
            req.body.destinatario_cnpj = resolucao.destinatario_confiavel.cnpj;
            req.body.destinatario_uf = resolucao.destinatario_confiavel.uf;
          }
        } else {
          pendentes.push(resumirResolucaoFiscal(itens[indice], indice, resolucao));
        }
      });
      if (pendentes.length) {
        return res.status(422).json({
          error: 'Classificação fiscal de uso e consumo pendente ou inconsistente. Corrija os itens indicados antes de concluir a compra.',
          codigo: 'FISCAL_ENTRADA_PENDENTE',
          itens: pendentes
        });
      }
      next();
    })
    .catch((err) => {
      console.error('Erro ao validar tratamento fiscal de entrada:', err);
      res.status(500).json({ error: err.message });
    });
}

router.post('/', validarFiscalEntradaCompra, (req, res) => {
  let respostaEnviada = false;
  let reservaIdempotencia = null;
  const jsonOriginal = res.json.bind(res);
  res.json = (payload) => {
    if (reservaIdempotencia && !reservaIdempotencia.finalizada) {
      reservaIdempotencia.finalizada = true;
      if (comprasIdempotentesEmProcessamento.get(reservaIdempotencia.chave) === reservaIdempotencia) {
        comprasIdempotentesEmProcessamento.delete(reservaIdempotencia.chave);
      }
      reservaIdempotencia.resolver({ status: res.statusCode, payload });
    }
    return jsonOriginal(payload);
  };
  const responderCompra = (status, payload) => {
    if (respostaEnviada || res.headersSent) return;
    respostaEnviada = true;
    res.status(status).json(payload);
  };
  const confirmarTransacao = (aoConfirmar) => {
    let commitConcluido = false;
    db.run('COMMIT', (commitErr) => {
      if (commitConcluido) return;
      commitConcluido = true;
      if (!commitErr) return aoConfirmar();

      console.error('Erro ao confirmar transação da compra:', commitErr);
      db.run('ROLLBACK', (rollbackErr) => {
        if (rollbackErr) console.error('Erro ao desfazer transação após falha no COMMIT da compra:', rollbackErr);
        responderCompra(500, { error: commitErr.message });
      });
    });
  };

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

  const compraManualSemNfe = !chaveLimpa && !isNotaAvulsa && !isProducaoPropria && !centralDocumentoId;
  const chaveIdempotenciaRecebida = String(
    req.get('Idempotency-Key') || req.body?.idempotency_key || ''
  ).trim();
  const chaveIdempotencia = compraManualSemNfe ? chaveIdempotenciaRecebida : '';
  let hashConteudoIdempotencia = null;
  if (compraManualSemNfe) {
    if (!chaveIdempotencia || chaveIdempotencia.length > 128) {
      return responderCompra(400, {
        error: 'Informe uma chave de idempotência válida para registrar a compra manual.'
      });
    }
    const conteudoCompra = { ...req.body };
    delete conteudoCompra.idempotency_key;
    hashConteudoIdempotencia = hashConteudoCompra(conteudoCompra);
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

  if (chaveIdempotencia) {
    const emProcessamento = comprasIdempotentesEmProcessamento.get(chaveIdempotencia);
    if (emProcessamento) {
      if (emProcessamento.hash !== hashConteudoIdempotencia) {
        return responderCompra(409, {
          error: 'A chave de idempotência já está sendo usada com conteúdo diferente.'
        });
      }
      emProcessamento.resultado.then(({ status, payload }) => responderCompra(status, payload));
      return;
    }

    let resolverResultado;
    const resultado = new Promise((resolve) => {
      resolverResultado = resolve;
    });
    reservaIdempotencia = {
      chave: chaveIdempotencia,
      hash: hashConteudoIdempotencia,
      resultado,
      resolver: resolverResultado,
      finalizada: false
    };
    comprasIdempotentesEmProcessamento.set(chaveIdempotencia, reservaIdempotencia);
  }

  const condicao = isProducaoPropria ? 'avista' : (condicao_pagamento || 'avista');
  const qtdParcelas = Math.max(1, Number(parcelas) || 1);
  const formaPagamentoFinal = isProducaoPropria ? null : (forma_pagamento || null);
  const cnpjFornecedorFinal = isProducaoPropria ? null : (fornecedor_cnpj || null);

  const payloadCompraRepetida = (compraId) => ({
    id: compraId,
    message: 'Compra registrada com sucesso e integrada ao estoque/financeiro.',
    tipo_entrada: entrada.tipo_entrada,
    financeiro_gerado: true,
    conferencia: {
      total_xml: totalCalculadoComAjustes,
      total_itens_calculado: totalItensCalculado,
      diferenca_total: diferencaTotal
    }
  });
  const responderCompraIdempotente = (existente) => {
    if (existente.idempotency_payload_hash !== hashConteudoIdempotencia) {
      return responderCompra(409, {
        error: 'A chave de idempotência já foi usada com conteúdo diferente.'
      });
    }
    return responderCompra(200, payloadCompraRepetida(existente.id));
  };

  const continuarGravacao = () => {
    const gravarCompra = () => {
    db.serialize(() => {
        db.run('BEGIN IMMEDIATE', (beginErr) => {
          if (beginErr) {
            console.error('Erro ao iniciar transação da compra:', beginErr);
            return responderCompra(500, { error: beginErr.message });
          }

          db.run(`
        INSERT INTO compras (
          data_compra, data_emissao, data_entrada, fornecedor, fornecedor_cnpj,
          numero_nf, serie_nf, modelo_nf, chave_acesso, idempotency_key, idempotency_payload_hash,
          valor_produtos, valor_desconto, valor_frete, valor_outras_despesas,
          valor_total_nota, total, total_xml, total_itens_calculado, diferenca_total,
          status, condicao_pagamento, forma_pagamento, data_vencimento,
          parcelas, valor_entrada, observacao, nota_fiscal_avulsa,
          tipo_entrada, origem_movimentacao, tipo_movimentacao, destinatario_cnpj, destinatario_uf
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        chaveIdempotencia || null,
        hashConteudoIdempotencia,
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
        entrada.tipo_movimentacao,
        digitsOnly(req.body.destinatario_cnpj || '') || null,
        String(req.body.destinatario_uf || '').trim().toUpperCase() || null
      ], function(err) {
        if (err) {
          if (chaveIdempotencia && /UNIQUE constraint failed: compras\.idempotency_key/i.test(err.message || '')) {
            return db.run('ROLLBACK', (rollbackErr) => {
              if (rollbackErr) console.error('Erro ao desfazer compra duplicada por idempotência:', rollbackErr);
              db.get(
                'SELECT id, idempotency_payload_hash FROM compras WHERE idempotency_key = ? LIMIT 1',
                [chaveIdempotencia],
                (lookupErr, existente) => {
                  if (lookupErr) return responderCompra(500, { error: lookupErr.message });
                  if (existente) return responderCompraIdempotente(existente);
                  return responderCompra(500, { error: err.message });
                }
              );
            });
          }

          db.run('ROLLBACK');

          if (String(err.message || '').includes('UNIQUE') || String(err.message || '').includes('compras.chave_acesso')) {
            return responderCompra(400, { error: 'Esta nota já foi lançada. A chave de acesso já existe no sistema.' });
          }

          return responderCompra(500, { error: err.message });
        }

        const compraId = this.lastID;

        const finalizarSemFinanceiro = (acaoAuditoria, mensagem, extras = {}) => {
          confirmarTransacao(() => {
            const payloadResposta = {
              id: compraId,
              message: mensagem,
              tipo_entrada: entrada.tipo_entrada,
              origem_movimentacao: entrada.origem_movimentacao,
              tipo_movimentacao: entrada.tipo_movimentacao,
              financeiro_gerado: false,
              ...extras
            };

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
            })
              .catch((auditErr) => console.error('Erro ao gravar auditoria de entrada:', auditErr))
              .finally(() => {
                vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, req.user?.id)
                  .finally(() => responderCompra(200, payloadResposta));
              });
          });
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
              return db.run('ROLLBACK', (rollbackErr) => {
                if (rollbackErr) console.error('Erro ao desfazer compra após falha financeira:', rollbackErr);
                responderCompra(500, { error: finErr.message });
              });
            }

            confirmarTransacao(() => {
              const payloadResposta = {
                id: compraId,
                message: 'Nota Fiscal Avulsa registrada com sucesso.',
                nota_fiscal_avulsa: true
              };

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
              })
                .catch((auditErr) => console.error('Erro ao gravar auditoria de nota fiscal avulsa:', auditErr))
                .finally(() => {
                  vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, req.user?.id)
                    .finally(() => responderCompra(200, payloadResposta));
                });
            });
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
              loteOrigem: entrada.lote_origem,
              legadoSemLocal: isProducaoPropria
            },
            (itensErr) => {
            if (itensErr) {
              console.error('Erro ao processar itens da compra:', itensErr);
              const status = Number(itensErr.status) >= 400 && Number(itensErr.status) < 600
                ? Number(itensErr.status)
                : 500;
              return db.run('ROLLBACK', (rollbackErr) => {
                if (rollbackErr) console.error('Erro ao desfazer compra após falha nos itens:', rollbackErr);
                responderCompra(status, {
                  error: itensErr.message,
                  codigo: itensErr.codigo || itensErr.code || undefined
                });
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
                return db.run('ROLLBACK', (rollbackErr) => {
                  if (rollbackErr) console.error('Erro ao desfazer compra após falha financeira:', rollbackErr);
                  responderCompra(500, { error: finErr.message });
                });
              }

              confirmarTransacao(() => {
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
                })
                  .catch((auditErr) => console.error('Erro ao gravar auditoria de criação de compra:', auditErr))
                  .finally(() => {
                    vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, req.user?.id)
                      .finally(() => responderCompra(200, payloadResposta));
                  });
              });
            });
          });
        }
        });
      });
    });
    };

    if (isNotaAvulsa || !Array.isArray(itensComRateio) || itensComRateio.length === 0) {
      return gravarCompra();
    }

    resolverItensAntesDeGravar(itensComRateio)
      .then((resultados) => {
        const pendentes = resultados.filter((item) => item.situacao === CODIGO_PRODUTO_NAO_CADASTRADO);
        if (pendentes.length) {
          return responderProdutoNaoCadastrado(res, resultados);
        }
        resultados.forEach((resultado, indice) => {
          if (resultado.produtoId) itensComRateio[indice].produto_id = resultado.produtoId;
        });
        if (!isProducaoPropria) {
          for (const item of itensComRateio) {
            if (itemEhUsoEConsumo(item)) continue;
            try {
              resolverDestinoItemCompra(item);
            } catch (destinoErr) {
              return res.status(destinoErr.status || 400).json({
                error: destinoErr.message,
                codigo: destinoErr.codigo
              });
            }
          }
        }
        return gravarCompra();
      })
      .catch((err) => {
        console.error('Erro ao resolver produtos da compra:', err);
        if (!res.headersSent) {
          const status = Number(err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 500;
          res.status(status).json({
            error: err.message,
            codigo: err.codigo || err.code || undefined
          });
        }
      });
  };

  const iniciarFluxoGravacao = () => {
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
  };

  if (!chaveIdempotencia) return iniciarFluxoGravacao();
  db.get(
    'SELECT id, idempotency_payload_hash FROM compras WHERE idempotency_key = ? LIMIT 1',
    [chaveIdempotencia],
    (lookupErr, existente) => {
      if (lookupErr) return responderCompra(500, { error: lookupErr.message });
      if (existente) return responderCompraIdempotente(existente);
      iniciarFluxoGravacao();
    }
  );
});

function responderProdutoNaoCadastrado(res, resultados) {
  const inativo = resultados.some((item) => item.motivo === MOTIVO_PRODUTO_INATIVO);
  return res.status(409).json({
    error: inativo ? MENSAGEM_PRODUTO_INATIVO : MENSAGEM_PRODUTO_NAO_CADASTRADO,
    codigo: inativo ? MOTIVO_PRODUTO_INATIVO : CODIGO_PRODUTO_NAO_CADASTRADO,
    itens: resultados
  });
}

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

      db.all('SELECT * FROM compras_itens WHERE compra_id = ?', [id], (itensErr, itensTodos) => {
        if (itensErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: itensErr.message });
        }
        // Uso e consumo nunca entrou no estoque: não há o que baixar no cancelamento.
        const itens = (itensTodos || []).filter((i) => String(i.finalidade_item || '').toUpperCase() !== 'USO_E_CONSUMO');

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
