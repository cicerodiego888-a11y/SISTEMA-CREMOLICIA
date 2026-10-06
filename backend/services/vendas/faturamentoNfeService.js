/**
 * Faturamento comercial para NF-e modelo 55 (NF-E-04.0 / 04.1).
 *
 * Pedido e emissão manual geram a venda pelo fluxo oficial (criarVendaInterna →
 * criarVenda: estoque, financeiro e MIDP), com prioridade fiscal e sem NFC-e, somente
 * quando o usuário confirma a emissão. Na mesma requisição a NF-e é emitida pelo
 * emissor existente (emitirNfePorVendaId). Se o emissor recusar sem registrar nenhuma
 * NF-e, a venda é desfeita pelo cancelamento oficial (cancelarVendaInterna).
 * Nada aqui reserva número, monta XML, assina ou chama a SEFAZ.
 */

'use strict';

const { onlyDigits } = require('../fiscal/utils');
const { resolverInscricaoEstadualDestinatario, MSG_DEST_IE_INVALIDA } = require('../fiscal/inscricaoEstadual');

const ORIGEM_VENDA = Object.freeze({ PEDIDO: 'PEDIDO', MANUAL: 'NFE_MANUAL' });
const FORMAS_PAGAMENTO = Object.freeze(['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'prazo']);

function erroFaturamento(mensagem, codigo, statusCode = 400, extra = {}) {
  const err = new Error(mensagem);
  err.code = codigo;
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function cpfValido(valor) {
  const d = onlyDigits(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base) => {
    let soma = 0;
    for (let i = 0; i < base; i += 1) soma += Number(d[i]) * (base + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function cnpjValido(valor) {
  const d = onlyDigits(valor);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base) => {
    const pesos = base === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(d[i]) * p, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

function documentoDestinatarioValido(valor) {
  const d = onlyDigits(valor);
  return d.length === 11 ? cpfValido(d) : cnpjValido(d);
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

/**
 * Itens comerciais normalizados (produto, quantidade, preço, subtotal bruto).
 * Desconto só no total, como no PDV (RC4.31: itens brutos, desconto rateado pelo criarVenda).
 */
function normalizarItensComerciais(itens) {
  if (!Array.isArray(itens) || !itens.length) {
    throw erroFaturamento('Informe ao menos um item.', 'ITENS_OBRIGATORIOS');
  }
  return itens.map((item, idx) => {
    const produtoId = Number(item.produto_id ?? item.produtoId);
    const quantidade = Number(item.quantidade);
    const preco = Number(item.preco_unitario ?? item.precoUnitario);
    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      throw erroFaturamento(`Item ${idx + 1}: produto inválido.`, 'ITEM_INVALIDO');
    }
    if (!(quantidade > 0)) throw erroFaturamento(`Item ${idx + 1}: quantidade deve ser maior que zero.`, 'ITEM_INVALIDO');
    if (!(preco > 0)) throw erroFaturamento(`Item ${idx + 1}: preço deve ser maior que zero.`, 'ITEM_INVALIDO');
    return { produto_id: produtoId, quantidade, preco_unitario: preco, subtotal: round2(quantidade * preco) };
  });
}

function totaisComerciais(itens, descontoGeral = 0) {
  const totalItens = round2(itens.reduce((s, i) => s + i.subtotal, 0));
  const desconto = round2(descontoGeral || 0);
  if (desconto < 0 || desconto >= totalItens) {
    throw erroFaturamento('Desconto geral inválido.', 'DESCONTO_INVALIDO');
  }
  return { totalItens, desconto, total: round2(totalItens - desconto) };
}

/**
 * Validação comercial/fiscal antes de gerar a venda: cliente identificado com endereço,
 * itens com produto existente e estoque fiscal suficiente para a parcela da NF-e.
 */
async function validarOperacaoNfe(db, { clienteId, itens }) {
  const cliente = clienteId
    ? await dbGet(db, 'SELECT id, nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep FROM clientes WHERE id = ?', [Number(clienteId)])
    : null;
  if (!cliente) throw erroFaturamento('Selecione o cliente (destinatário) da NF-e.', 'CLIENTE_OBRIGATORIO');
  if (!documentoDestinatarioValido(cliente.cpf_cnpj)) {
    throw erroFaturamento('Cliente sem CPF/CNPJ válido para NF-e.', 'CLIENTE_DOCUMENTO_INVALIDO');
  }
  const faltando = [['rua', 'logradouro'], ['numero', 'número'], ['bairro', 'bairro'], ['cidade', 'município'], ['uf', 'UF'], ['cep', 'CEP']]
    .filter(([campo]) => !String(cliente[campo] || '').trim())
    .map(([, rotulo]) => rotulo);
  if (faltando.length) {
    throw erroFaturamento(`Endereço do cliente incompleto: ${faltando.join(', ')}.`, 'CLIENTE_ENDERECO_INCOMPLETO');
  }

  const ids = [...new Set(itens.map((i) => i.produto_id))];
  const produtos = await dbAll(db, `SELECT id, nome, saldo_fiscal FROM produtos WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const porId = new Map(produtos.map((p) => [Number(p.id), p]));
  const qtdPorProduto = new Map();
  for (const i of itens) qtdPorProduto.set(i.produto_id, (qtdPorProduto.get(i.produto_id) || 0) + i.quantidade);
  for (const [produtoId, qtd] of qtdPorProduto) {
    const p = porId.get(produtoId);
    if (!p) throw erroFaturamento(`Produto ${produtoId} não encontrado.`, 'PRODUTO_NAO_ENCONTRADO');
    if (Number(p.saldo_fiscal || 0) < qtd) {
      throw erroFaturamento(
        `Estoque fiscal insuficiente para a NF-e: ${p.nome} (disponível ${Number(p.saldo_fiscal || 0)}, necessário ${qtd}).`,
        'SEM_PARCELA_FISCAL'
      );
    }
  }
  return cliente;
}

/** Bloqueia antes de gerar a venda se a NF-e não estiver pronta (diagnóstico local, sem SEFAZ). */
async function exigirProntidaoNfe(diagnosticar) {
  const fn = diagnosticar || require('../fiscal/nfeProntidaoService').diagnosticarProntidaoNfe;
  const diag = await fn();
  if (!diag || diag.pronta !== true) {
    throw erroFaturamento('NF-e não está pronta para emissão.', 'NFE_NAO_PRONTA', 409, {
      pendencias: (diag && diag.pendencias) || [],
      prontidao: diag || null
    });
  }
  return diag;
}

/** Payload do POST /api/vendas (criarVenda) para uma venda que será documentada por NF-e 55. */
function montarPayloadVendaNfe({ origem, clienteId, cpfCnpj, itens, desconto = 0, formaPagamento, parcelas, primeiroVencimento, usuarioId }) {
  const forma = String(formaPagamento || 'dinheiro').trim().toLowerCase();
  if (!FORMAS_PAGAMENTO.includes(forma)) {
    throw erroFaturamento('Forma de pagamento inválida.', 'FORMA_PAGAMENTO_INVALIDA');
  }
  const totais = totaisComerciais(itens, desconto);
  const payload = {
    cliente_id: Number(clienteId),
    total: totais.total,
    desconto: totais.desconto,
    forma_pagamento: forma,
    itens: itens.map((i) => ({
      produto_id: i.produto_id,
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
      subtotal: i.subtotal,
      desconto_percentual: 0
    })),
    pagamentos: [{ forma_pagamento: forma, valor: totais.total, tipo_recebimento: 'fiscal' }],
    emitir_fiscal: true,
    documento_fiscal: 'NFE',
    cpf_cnpj_nota: onlyDigits(cpfCnpj) || null,
    origem,
    origem_pdv: origem,
    canal_venda: 'VAREJO',
    usuario_id: usuarioId || null
  };
  if (forma === 'prazo') {
    payload.parcelas = Math.max(1, Number(parcelas) || 1);
    payload.primeiro_vencimento = primeiroVencimento || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  }
  return payload;
}

/**
 * Valida e gera a venda da operação. Retorna { vendaId, venda }.
 * @param {object} deps.criarVenda  substitui criarVendaInterna (testes)
 * @param {object} deps.diagnosticar substitui diagnosticarProntidaoNfe (testes)
 */
async function faturarOperacaoNfe(entrada, deps = {}) {
  const db = deps.db || require('../../database');
  const origem = entrada.origem;
  if (!Object.values(ORIGEM_VENDA).includes(origem)) {
    throw erroFaturamento('Origem do faturamento inválida.', 'ORIGEM_INVALIDA');
  }
  const itens = normalizarItensComerciais(entrada.itens);
  const cliente = await validarOperacaoNfe(db, { clienteId: entrada.clienteId, itens });
  await exigirProntidaoNfe(deps.diagnosticar);
  const payload = montarPayloadVendaNfe({ ...entrada, origem, itens, cpfCnpj: cliente.cpf_cnpj });
  const criarVenda = deps.criarVenda || require('./criarVendaInterna').criarVendaInterna;
  let venda;
  try {
    venda = await criarVenda(payload);
  } catch (err) {
    throw erroFaturamento(`Venda não registrada: ${err.message}`, err.code || 'VENDA_RECUSADA', err.statusCode || err.status || 500);
  }
  const vendaId = Number(venda && (venda.id || venda.venda_id));
  if (!vendaId) throw erroFaturamento('A venda não foi gerada.', 'VENDA_NAO_GERADA', 500);
  return { vendaId, venda, payload };
}

/**
 * Dados do formulário NF-e exigidos antes de faturar, para que a venda não seja criada
 * por uma emissão que o emissor recusaria por falta de destinatário/operação.
 */
function validarDadosNfeConfirmacao(dadosNfe) {
  const d = dadosNfe || {};
  const documento = onlyDigits(d.dest_cnpj || d.dest_cpf || '');
  if (!documento || !documentoDestinatarioValido(documento)) {
    throw erroFaturamento('Informe CPF ou CNPJ válido do destinatário.', 'DEST_DOCUMENTO_INVALIDO');
  }
  const faltando = [
    ['dest_nome', 'nome'], ['dest_logradouro', 'logradouro'], ['dest_numero', 'número'],
    ['dest_bairro', 'bairro'], ['dest_municipio', 'município'], ['dest_uf', 'UF'], ['natureza_operacao', 'natureza da operação']
  ].filter(([campo]) => !String(d[campo] || '').trim()).map(([, rotulo]) => rotulo);
  if (onlyDigits(d.dest_cep).length !== 8) faltando.push('CEP');
  if (!/^[567]\d{3}$/.test(onlyDigits(d.cfop))) faltando.push('CFOP');
  if (faltando.length) {
    throw erroFaturamento(`Dados da NF-e incompletos: ${faltando.join(', ')}.`, 'DADOS_NFE_INCOMPLETOS');
  }
  if (!resolverInscricaoEstadualDestinatario(null, d).ieXmlValida) {
    throw erroFaturamento(MSG_DEST_IE_INVALIDA, 'DEST_IE_INVALIDA');
  }
}

async function existeNotaNfeDaVenda(db, vendaId) {
  try {
    return Boolean(await dbGet(db, 'SELECT id FROM nfe_notas WHERE venda_id = ? LIMIT 1', [Number(vendaId)]));
  } catch (err) {
    if (/no such table/i.test(err.message || '')) return false;
    throw err;
  }
}

/**
 * Emite pela venda recém-faturada usando o emissor existente. Se a emissão falhar sem
 * registrar NF-e (nenhuma linha em nfe_notas), desfaz o faturamento: cancela a venda pelo
 * fluxo oficial (estorno de estoque e financeiro) e executa `aoDesfazer` (ex.: pedido volta
 * a ABERTO). Com NF-e registrada (rejeitada, em processamento...), a venda é mantida.
 */
async function emitirNfeAposFaturar({ vendaId, dadosNfe, usuario = {}, podeDesfazer = true, aoDesfazer }, deps = {}) {
  const db = deps.db || require('../../database');
  const emitir = deps.emitirNfePorVendaId || require('../fiscal/nfeEmissorVenda').emitirNfePorVendaId;
  let resultado;
  try {
    resultado = await emitir(vendaId, {
      dadosNfe: dadosNfe || {},
      usuarioId: usuario.id || null,
      usuarioNome: usuario.username || null,
      deps: deps.depsEmissao
    });
  } catch (err) {
    resultado = { success: false, status: 'erro', message: err.message, codigo: err.code || 'ERRO_EMISSAO' };
  }
  resultado = resultado || { success: false, status: 'erro', message: 'Emissor sem resposta.' };
  const base = { ...resultado, venda_id: Number(vendaId), faturamento_desfeito: false };
  if (resultado.success || !podeDesfazer || await existeNotaNfeDaVenda(db, vendaId)) return base;

  const motivo = `NF-e não emitida (${resultado.codigo || resultado.status || 'erro'}): faturamento desfeito automaticamente.`;
  try {
    const cancelar = deps.cancelarVenda || require('./cancelarVendaInterna').cancelarVendaInterna;
    await cancelar(vendaId, motivo, usuario);
    if (aoDesfazer) await aoDesfazer();
  } catch (errDesfazer) {
    console.error(`[NF-E-04.1] Falha ao desfazer faturamento da venda ${vendaId}:`, errDesfazer.message);
    return {
      ...base,
      codigo_desfazimento: 'FATURAMENTO_PENDENTE_REVISAO',
      mensagem_desfazimento: `A NF-e não foi emitida e não foi possível desfazer a venda ${vendaId} automaticamente: ${errDesfazer.message}. Cancele a venda manualmente.`
    };
  }
  return { ...base, faturamento_desfeito: true };
}

const OPERACOES_MANUAIS_FATURADAS = new Map();

/**
 * Confirmação da emissão manual: valida, fatura (uma vez por chave_operacao) e emite.
 * Repetir a mesma chave reaproveita a venda já faturada, sem criar outra.
 */
async function confirmarEmissaoNfeManual(entrada, contexto = {}, deps = {}) {
  const chave = String(entrada.chaveOperacao || '').trim();
  if (!/^[\w.-]{8,80}$/.test(chave)) {
    throw erroFaturamento('Operação de emissão sem identificador.', 'CHAVE_OPERACAO_OBRIGATORIA');
  }
  validarDadosNfeConfirmacao(entrada.dadosNfe);
  const { withLock } = require('../fiscal/nfeEmissionLockService');
  const usuario = { id: contexto.usuarioId || null, username: contexto.usuarioNome || null };
  try {
    return await withLock(`nfe-manual-${chave}`, async () => {
      const anterior = OPERACOES_MANUAIS_FATURADAS.get(chave);
      if (anterior) {
        const out = await emitirNfeAposFaturar({ vendaId: anterior, dadosNfe: entrada.dadosNfe, usuario, podeDesfazer: false }, deps);
        return { ...out, reutilizado: true };
      }
      const { vendaId } = await faturarOperacaoNfe({ ...entrada, origem: ORIGEM_VENDA.MANUAL, usuarioId: usuario.id }, deps);
      OPERACOES_MANUAIS_FATURADAS.set(chave, vendaId);
      const out = await emitirNfeAposFaturar({ vendaId, dadosNfe: entrada.dadosNfe, usuario }, deps);
      if (out.faturamento_desfeito) OPERACOES_MANUAIS_FATURADAS.delete(chave);
      return { ...out, reutilizado: false };
    });
  } catch (err) {
    if (err && err.code === 'EMISSAO_EM_ANDAMENTO') {
      throw erroFaturamento('Esta emissão já está sendo processada. Aguarde.', 'OPERACAO_EM_ANDAMENTO', 409);
    }
    throw err;
  }
}

module.exports = {
  ORIGEM_VENDA,
  FORMAS_PAGAMENTO,
  erroFaturamento,
  validarDadosNfeConfirmacao,
  emitirNfeAposFaturar,
  confirmarEmissaoNfeManual,
  documentoDestinatarioValido,
  normalizarItensComerciais,
  totaisComerciais,
  validarOperacaoNfe,
  exigirProntidaoNfe,
  montarPayloadVendaNfe,
  faturarOperacaoNfe
};
