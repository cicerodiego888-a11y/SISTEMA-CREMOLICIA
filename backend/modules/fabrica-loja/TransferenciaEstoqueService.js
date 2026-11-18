/**
 * Transferência física Fábrica → Loja.
 * A saída e a entrada passam pelo Motor de Estoque oficial.
 */

const bootstrap = require('./migrations/007_transferencias_estoque');
const MotorEstoque = require('../../motores/motor-estoque');
const ConversaoComercialService = require('../../motores/motor-conversao-comercial/services/ConversaoComercialService');
const { CODIGO_PRODUTO_LINHA_CONVERTIDO, listarProdutosLinhaConvertidos } = require('./produtoLinhaConvertido');

const conversorOficial = new ConversaoComercialService();
const ORIGEM_MOVIMENTO = 'TRANSFERENCIA';
const MENSAGEM_ESTOQUE = 'Quantidade disponível na Fábrica insuficiente.';
const MENSAGEM_INATIVO = 'O produto informado está inativo.';
const MENSAGEM_NATUREZA = 'Somente produto produzido pode ser transferido da Fábrica para a Loja.';
const MENSAGEM_CONVERTIDO = 'Este produto-linha foi convertido para produtos individuais e não pode ser transferido.';
const MENSAGEM_CONFIRMADA = 'Esta transferência já foi confirmada.';
const MENSAGEM_CANCELAR = 'Transferências confirmadas não podem ser canceladas por este fluxo.';
const MENSAGEM_QUANTIDADE = 'A quantidade da transferência deve ser maior que zero.';
const MENSAGEM_SEM_DISPONIVEL = 'Nenhum produto produzido está disponível para transferência para a Loja.';

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, id: this.lastID });
    });
  });
}

function erro(mensagem, codigo, statusCode = 409, detalhes) {
  const err = new Error(mensagem);
  err.code = codigo;
  err.statusCode = statusCode;
  if (detalhes) err.detalhes = detalhes;
  return err;
}

function texto(valor) {
  return String(valor == null ? '' : valor).trim();
}

function round3(valor) {
  return Math.round(Number(valor) * 1000) / 1000;
}

function comporTransferencia(saldo, quantidade) {
  const fiscal = round3(Number(saldo && saldo.saldoFiscal) || 0);
  const naoFiscal = round3(Number(saldo && saldo.saldoNaoFiscal) || 0);
  const total = round3(fiscal + naoFiscal);
  const qtd = round3(quantidade);
  if (!(total > 0) || qtd > total + 0.000001) return null;
  let quantidadeFiscal = round3(qtd * fiscal / total);
  if (quantidadeFiscal > fiscal) quantidadeFiscal = fiscal;
  let quantidadeNaoFiscal = round3(qtd - quantidadeFiscal);
  if (quantidadeNaoFiscal > naoFiscal) {
    quantidadeNaoFiscal = naoFiscal;
    quantidadeFiscal = round3(qtd - quantidadeNaoFiscal);
  }
  return { quantidadeFiscal, quantidadeNaoFiscal };
}

async function proximoCodigo(db) {
  const ano = new Date().getFullYear();
  const prefixo = `TRF-${ano}-`;
  const row = await get(db, `
    SELECT codigo FROM transferencias_estoque WHERE codigo LIKE ? ORDER BY codigo DESC LIMIT 1
  `, [`${prefixo}%`]);
  const atual = row ? Number(String(row.codigo).slice(prefixo.length)) : 0;
  return `${prefixo}${String((Number.isFinite(atual) ? atual : 0) + 1).padStart(6, '0')}`;
}

async function produtoFisico(db, produtoId) {
  if (!produtoId) throw erro('O produto informado não existe.', 'PRODUTO_NAO_ENCONTRADO', 404);
  const row = await get(db, `
    SELECT id, nome, unidade, natureza_cadastro, COALESCE(ativo, 1) AS ativo
    FROM produtos WHERE id = ?
  `, [produtoId]);
  if (!row) throw erro('O produto informado não existe.', 'PRODUTO_NAO_ENCONTRADO', 404);
  return {
    id: Number(row.id),
    nome: texto(row.nome) || `Produto ${row.id}`,
    unidade: row.unidade || 'UN',
    natureza_cadastro: row.natureza_cadastro || null,
    ativo: Number(row.ativo) !== 0
  };
}

async function produtoTransferivel(db, produtoId) {
  const produto = await produtoFisico(db, produtoId);
  if (!produto.ativo) throw erro(MENSAGEM_INATIVO, 'PRODUTO_INATIVO');
  if (String(produto.natureza_cadastro || '').toUpperCase() !== 'PRODUZIDO') {
    throw erro(MENSAGEM_NATUREZA, 'PRODUTO_NAO_TRANSFERIVEL');
  }
  const convertidos = await listarProdutosLinhaConvertidos(db, [produto.id]);
  if (convertidos.length) throw erro(MENSAGEM_CONVERTIDO, CODIGO_PRODUTO_LINHA_CONVERTIDO);
  return produto;
}

function converterOficial(produto, quantidade, unidadeOrigem) {
  const origem = texto(unidadeOrigem).toUpperCase();
  const base = texto(produto.unidade || 'UN').toUpperCase();
  if (!origem) throw erro('A unidade da transferência é inválida.', 'UNIDADE_INVALIDA');
  try {
    const resultado = conversorOficial.Converter({
      produto: { id: produto.id, unidade: base, conversoes: [], unidades_comercializacao: [] },
      quantidade: Number(quantidade),
      unidadeOrigem: origem,
      unidadeBase: base,
      contexto: 'OUTROS'
    });
    const convertida = Number(resultado.quantidadeConvertida);
    if (!Number.isFinite(convertida) || convertida < 0) {
      throw erro(`Não há conversão oficial de ${origem} para ${base} no produto ${produto.nome}.`, 'UNIDADE_INCOMPATIVEL');
    }
    return round3(convertida);
  } catch (err) {
    if (err.code === 'UNIDADE_INVALIDA' || err.code === 'UNIDADE_INCOMPATIVEL') throw err;
    throw erro(`Não há conversão oficial de ${origem} para ${base} no produto ${produto.nome}.`, 'UNIDADE_INCOMPATIVEL');
  }
}

async function normalizarItens(db, itens) {
  if (!Array.isArray(itens) || !itens.length) throw erro('Informe ao menos um produto.', 'ITEM_OBRIGATORIO');
  const saida = [];
  for (const item of itens) {
    const produto = await produtoTransferivel(db, item.produto_id);
    const quantidade = Number(item.quantidade);
    if (!Number.isFinite(quantidade) || quantidade < 0) throw erro(MENSAGEM_QUANTIDADE, 'QUANTIDADE_INVALIDA');
    if (!(quantidade > 0)) throw erro(MENSAGEM_QUANTIDADE, 'QUANTIDADE_INVALIDA');
    const unidade = texto(item.unidade || produto.unidade).toUpperCase();
    const quantidadeBase = converterOficial(produto, quantidade, unidade);
    saida.push({
      produto_id: produto.id,
      produto_nome: produto.nome,
      natureza_cadastro: produto.natureza_cadastro,
      quantidade,
      unidade,
      quantidade_base: quantidadeBase,
      unidade_base: texto(produto.unidade || 'UN').toUpperCase(),
      observacao: texto(item.observacao)
    });
  }
  return saida;
}

function resumir(doc, itens) {
  const lista = itens || [];
  return {
    id: Number(doc.id),
    codigo: doc.codigo,
    origem_local: doc.origem_local || 'FABRICA',
    destino_local: doc.destino_local || 'LOJA',
    status: doc.status,
    data_transferencia: doc.data_transferencia,
    observacao: doc.observacao || '',
    usuario_id: doc.usuario_id == null ? null : Number(doc.usuario_id),
    usuario_nome: doc.usuario_nome || '',
    correlation_id: doc.correlation_id || null,
    confirmada_em: doc.confirmada_em || null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    itens: lista.map((item) => ({
      id: item.id == null ? null : Number(item.id),
      produto_id: Number(item.produto_id),
      produto_nome: item.produto_nome || '',
      quantidade: Number(item.quantidade),
      unidade: item.unidade || '',
      quantidade_base: item.quantidade_base == null ? null : Number(item.quantidade_base),
      quantidade_fiscal: item.quantidade_fiscal == null ? null : Number(item.quantidade_fiscal),
      quantidade_nao_fiscal: item.quantidade_nao_fiscal == null ? null : Number(item.quantidade_nao_fiscal),
      observacao: item.observacao || ''
    })),
    quantidade_total: round3(lista.reduce((soma, item) => soma + Number(item.quantidade || 0), 0))
  };
}

async function ler(db, id) {
  const doc = await get(db, `SELECT * FROM transferencias_estoque WHERE id = ?`, [Number(id)]);
  if (!doc) throw erro('A transferência informada não existe.', 'TRANSFERENCIA_NAO_ENCONTRADA', 404);
  const itens = await all(db, `
    SELECT * FROM transferencia_estoque_itens WHERE transferencia_id = ? ORDER BY id
  `, [doc.id]);
  return resumir(doc, itens);
}

async function listarTransferencias(db, filtros) {
  await bootstrap(db);
  const dados = filtros || {};
  const where = [];
  const params = [];
  if (texto(dados.status)) {
    where.push('status = ?');
    params.push(texto(dados.status).toUpperCase());
  }
  const rows = await all(db, `
    SELECT * FROM transferencias_estoque
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY id DESC
  `, params);
  const saida = [];
  for (const row of rows) {
    const itens = await all(db, `
      SELECT produto_id, produto_nome, quantidade, unidade FROM transferencia_estoque_itens
      WHERE transferencia_id = ? ORDER BY id
    `, [row.id]);
    saida.push(resumir(row, itens));
  }
  return saida;
}

async function obterTransferencia(db, id) {
  await bootstrap(db);
  return ler(db, id);
}

async function salvarTransferencia(db, entrada, id, contexto) {
  await bootstrap(db);
  const dados = entrada || {};
  if (texto(dados.origem_local || 'FABRICA').toUpperCase() !== 'FABRICA' || texto(dados.destino_local || 'LOJA').toUpperCase() !== 'LOJA') {
    throw erro('Nesta versão a transferência sai da Fábrica e entra na Loja.', 'ROTA_NAO_SUPORTADA');
  }
  const itens = await normalizarItens(db, dados.itens);
  if (id) {
    const atual = await ler(db, id);
    if (atual.status !== 'RASCUNHO') throw erro('Somente o rascunho pode ser alterado.', 'TRANSFERENCIA_NAO_EDITAVEL');
    await run(db, `
      UPDATE transferencias_estoque
      SET observacao = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [texto(dados.observacao) || null, atual.id]);
    await run(db, `DELETE FROM transferencia_estoque_itens WHERE transferencia_id = ?`, [atual.id]);
    for (const item of itens) {
      await run(db, `
        INSERT INTO transferencia_estoque_itens
          (transferencia_id, produto_id, produto_nome, quantidade, unidade, quantidade_base, observacao)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [atual.id, item.produto_id, item.produto_nome, item.quantidade, item.unidade, item.quantidade_base, item.observacao || null]);
    }
    return ler(db, atual.id);
  }
  const codigo = await proximoCodigo(db);
  const criada = await run(db, `
    INSERT INTO transferencias_estoque (
      codigo, origem_local, destino_local, status, data_transferencia, observacao, usuario_id, usuario_nome
    ) VALUES (?, 'FABRICA', 'LOJA', 'RASCUNHO', date('now', 'localtime'), ?, ?, ?)
  `, [
    codigo,
    texto(dados.observacao) || null,
    contexto && contexto.usuario_id ? Number(contexto.usuario_id) : null,
    contexto ? texto(contexto.usuario_nome) || null : null
  ]);
  for (const item of itens) {
    await run(db, `
      INSERT INTO transferencia_estoque_itens
        (transferencia_id, produto_id, produto_nome, quantidade, unidade, quantidade_base, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [criada.id, item.produto_id, item.produto_nome, item.quantidade, item.unidade, item.quantidade_base, item.observacao || null]);
  }
  const documento = await ler(db, criada.id);
  if (contexto && typeof contexto.auditar === 'function') {
    await contexto.auditar({
      acao: 'TRANSFERENCIA_CRIADA',
      referencia_id: documento.id,
      detalhes: { codigo: documento.codigo, origem: 'FABRICA', destino: 'LOJA' }
    });
  }
  return documento;
}

async function sugerirTransferenciaOrdem(db, ordemId) {
  await bootstrap(db);
  const bootstrapExecucoes = require('./migrations/006_ordem_producao_execucoes');
  await bootstrapExecucoes(db);
  await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  const ordem = await get(db, 'SELECT id, codigo, status FROM ordens_producao WHERE id = ?', [Number(ordemId)]);
  if (!ordem) throw erro('A ordem de produção informada não existe.', 'OP_NAO_ENCONTRADA', 404);
  const execucao = await get(db, `
    SELECT snapshot_json FROM ordem_producao_execucoes
    WHERE ordem_id = ? ORDER BY id DESC LIMIT 1
  `, [ordem.id]);
  if (!execucao || !execucao.snapshot_json) {
    return { ordem_id: Number(ordem.id), codigo: ordem.codigo, itens: [], mensagem: MENSAGEM_SEM_DISPONIVEL };
  }
  const snapshot = JSON.parse(execucao.snapshot_json);
  const grupos = new Map();
  for (const item of snapshot.produzidos || []) {
    const produtoId = Number(item.produto_id);
    const base = Number(item.quantidade_base != null ? item.quantidade_base : item.quantidade_produzida);
    if (!produtoId || !(base > 0)) continue;
    const atual = grupos.get(produtoId) || {
      produto_id: produtoId,
      produto_nome: item.produto_nome || '',
      unidade: item.unidade_base || item.unidade || 'UN',
      produzido: 0
    };
    atual.produzido = round3(atual.produzido + base);
    grupos.set(produtoId, atual);
  }
  const itens = [];
  for (const grupo of grupos.values()) {
    const saldo = await MotorEstoque.consultarSaldoLocal(db, grupo.produto_id, 'FABRICA');
    const disponivel = round3(Number(saldo.estoqueAtual) || 0);
    const quantidade = round3(Math.min(grupo.produzido, disponivel));
    if (!(quantidade > 0)) continue;
    itens.push({
      produto_id: grupo.produto_id,
      produto_nome: grupo.produto_nome,
      quantidade,
      unidade: grupo.unidade,
      produzido: grupo.produzido,
      disponivel
    });
  }
  return {
    ordem_id: Number(ordem.id),
    codigo: ordem.codigo,
    itens,
    mensagem: itens.length ? '' : MENSAGEM_SEM_DISPONIVEL
  };
}

async function consultarDisponivel(db, produtoId, local) {
  await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  const produto = await produtoFisico(db, produtoId);
  const saldo = await MotorEstoque.consultarSaldoLocal(db, produto.id, local || 'FABRICA');
  return {
    produto_id: produto.id,
    produto_nome: produto.nome,
    unidade: produto.unidade,
    local: saldo.local,
    disponivel: saldo.estoqueAtual
  };
}

async function previaTransferencia(db, id) {
  await bootstrap(db);
  await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  const doc = await ler(db, id);
  const itens = [];
  for (const item of doc.itens) {
    const produto = await produtoFisico(db, item.produto_id);
    const base = item.quantidade_base == null ? converterOficial(produto, item.quantidade, item.unidade) : Number(item.quantidade_base);
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, item.produto_id, 'FABRICA');
    const loja = await MotorEstoque.consultarSaldoLocal(db, item.produto_id, 'LOJA');
    itens.push({
      produto_id: item.produto_id,
      produto_nome: item.produto_nome,
      quantidade: item.quantidade,
      unidade: item.unidade,
      quantidade_base: base,
      disponivel_fabrica: fabrica.estoqueAtual,
      estoque_loja: loja.estoqueAtual,
      fabrica_depois: round3(fabrica.estoqueAtual - base),
      loja_depois: round3(loja.estoqueAtual + base)
    });
  }
  return { ...doc, previa_itens: itens };
}

async function confirmarTransferencia(db, id, entrada, contexto) {
  await bootstrap(db);
  await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  const dados = entrada || {};
  const correlationId = texto(dados.correlation_id || dados.correlationId) || `TRF-${id}-${Date.now()}`;
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const repetida = await get(db, `
      SELECT id FROM transferencias_estoque WHERE correlation_id = ?
    `, [correlationId]);
    if (repetida) {
      await run(db, 'ROLLBACK');
      return { transferencia: await ler(db, repetida.id), repetida: true };
    }
    const doc = await ler(db, id);
    if (doc.status === 'CONFIRMADA') throw erro(MENSAGEM_CONFIRMADA, 'TRANSFERENCIA_CONFIRMADA');
    if (doc.status !== 'RASCUNHO') throw erro('Somente um rascunho pode ser confirmado.', 'TRANSFERENCIA_NAO_CONFIRMAVEL');
    const faltas = [];
    const preparados = [];
    const restantes = new Map();
    for (const item of doc.itens) {
      const produto = await produtoTransferivel(db, item.produto_id);
      const base = item.quantidade_base == null ? converterOficial(produto, item.quantidade, item.unidade) : Number(item.quantidade_base);
      if (!restantes.has(produto.id)) {
        const inicial = await MotorEstoque.consultarSaldoLocal(db, produto.id, 'FABRICA');
        restantes.set(produto.id, {
          saldoFiscal: round3(Number(inicial.saldoFiscal) || 0),
          saldoNaoFiscal: round3(Number(inicial.saldoNaoFiscal) || 0)
        });
      }
      const saldo = restantes.get(produto.id);
      const disponivel = round3(saldo.saldoFiscal + saldo.saldoNaoFiscal);
      const composicao = comporTransferencia(saldo, base);
      if (!composicao) {
        faltas.push({
          produto: produto.nome,
          disponivel,
          solicitado: base,
          faltante: round3(base - disponivel),
          unidade: produto.unidade || item.unidade
        });
      } else {
        saldo.saldoFiscal = round3(saldo.saldoFiscal - composicao.quantidadeFiscal);
        saldo.saldoNaoFiscal = round3(saldo.saldoNaoFiscal - composicao.quantidadeNaoFiscal);
      }
      preparados.push({ ...item, produto, quantidade_base: base, composicao });
    }
    if (faltas.length) throw erro(MENSAGEM_ESTOQUE, 'ESTOQUE_INSUFICIENTE', 409, faltas);

    const ocupada = await run(db, `
      UPDATE transferencias_estoque
      SET correlation_id = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'RASCUNHO' AND correlation_id IS NULL
    `, [correlationId, doc.id]);
    if (ocupada.changes !== 1) throw erro(MENSAGEM_CONFIRMADA, 'TRANSFERENCIA_CONFIRMADA');

    for (const item of preparados) {
      await MotorEstoque.sair(db, {
        produtoId: item.produto_id,
        quantidadeBase: item.quantidade_base,
        quantidadeFiscal: item.composicao.quantidadeFiscal,
        quantidadeNaoFiscal: item.composicao.quantidadeNaoFiscal,
        origem: ORIGEM_MOVIMENTO,
        local: 'FABRICA',
        referenciaTipo: 'transferencia_estoque',
        referenciaId: doc.id,
        usuarioId: contexto && contexto.usuario_id ? Number(contexto.usuario_id) : null,
        motivo: `TRANSFERENCIA:${doc.codigo}`
      });
      await run(db, `
        UPDATE transferencia_estoque_itens
        SET quantidade_fiscal = ?, quantidade_nao_fiscal = ?
        WHERE id = ?
      `, [item.composicao.quantidadeFiscal, item.composicao.quantidadeNaoFiscal, item.id]);
    }
    if (contexto && typeof contexto.aposSaida === 'function') await contexto.aposSaida();
    for (const item of preparados) {
      await MotorEstoque.entrar(db, {
        produtoId: item.produto_id,
        quantidadeBase: item.quantidade_base,
        quantidadeFiscal: item.composicao.quantidadeFiscal,
        quantidadeNaoFiscal: item.composicao.quantidadeNaoFiscal,
        origem: ORIGEM_MOVIMENTO,
        local: 'LOJA',
        referenciaTipo: 'transferencia_estoque',
        referenciaId: doc.id,
        usuarioId: contexto && contexto.usuario_id ? Number(contexto.usuario_id) : null,
        motivo: `TRANSFERENCIA:${doc.codigo}`
      });
    }
    await run(db, `
      UPDATE transferencias_estoque
      SET status = 'CONFIRMADA', confirmada_em = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'RASCUNHO'
    `, [doc.id]);
    await run(db, 'COMMIT');
    const confirmada = await ler(db, doc.id);
    if (contexto && typeof contexto.auditar === 'function') {
      await contexto.auditar({
        acao: 'TRANSFERENCIA_CONFIRMADA',
        referencia_id: confirmada.id,
        detalhes: {
          codigo: confirmada.codigo,
          origem: 'FABRICA',
          destino: 'LOJA',
          usuario_nome: contexto.usuario_nome || '',
          itens: confirmada.itens.map((item) => ({
            produto_id: item.produto_id,
            produto: item.produto_nome,
            quantidade: item.quantidade,
            unidade: item.unidade,
            quantidade_fiscal: item.quantidade_fiscal,
            quantidade_nao_fiscal: item.quantidade_nao_fiscal
          }))
        }
      });
    }
    return { transferencia: confirmada, repetida: false };
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* a transação já pode ter sido encerrada */ }
    throw err;
  }
}

async function cancelarTransferencia(db, id, contexto) {
  await bootstrap(db);
  const doc = await ler(db, id);
  if (doc.status === 'CONFIRMADA') throw erro(MENSAGEM_CANCELAR, 'TRANSFERENCIA_CONFIRMADA');
  if (doc.status === 'CANCELADA') throw erro('A transferência já está cancelada.', 'TRANSFERENCIA_CANCELADA');
  await run(db, `
    UPDATE transferencias_estoque
    SET status = 'CANCELADA', updated_at = datetime('now', 'localtime')
    WHERE id = ? AND status = 'RASCUNHO'
  `, [doc.id]);
  const cancelada = await ler(db, doc.id);
  if (contexto && typeof contexto.auditar === 'function') {
    await contexto.auditar({
      acao: 'TRANSFERENCIA_CANCELADA',
      referencia_id: cancelada.id,
      detalhes: { codigo: cancelada.codigo }
    });
  }
  return cancelada;
}

module.exports = {
  ORIGEM_MOVIMENTO,
  MENSAGEM_ESTOQUE,
  MENSAGEM_INATIVO,
  MENSAGEM_NATUREZA,
  MENSAGEM_CONVERTIDO,
  MENSAGEM_CONFIRMADA,
  MENSAGEM_CANCELAR,
  MENSAGEM_QUANTIDADE,
  MENSAGEM_SEM_DISPONIVEL,
  sugerirTransferenciaOrdem,
  consultarDisponivel,
  listarTransferencias,
  obterTransferencia,
  salvarTransferencia,
  previaTransferencia,
  confirmarTransferencia,
  cancelarTransferencia
};
