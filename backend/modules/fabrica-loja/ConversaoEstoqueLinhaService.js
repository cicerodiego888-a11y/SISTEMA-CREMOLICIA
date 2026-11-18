/**
 * Conversão do estoque dos produtos-linha legados (FABRICA-CONVERSAO-02).
 *
 * PRODUTO-LINHA → saída (Motor de Estoque) → SABORES da Linha → entradas (Motor de Estoque).
 * A distribuição por sabor é sempre informada (fiscal e não fiscal); nada é rateado aqui.
 * Vendas, consignações e documentos antigos continuam apontando para o produto-linha.
 *
 * Cada produto-linha é convertido uma única vez. Devoluções de consignações antigas voltam
 * para o produto-linha como saldo residual: não é estoque disponível e não reabre a conversão.
 *
 * A estrutura vem da migration 011 (bootstrap da Fábrica, quando a Linha de Produtos existe):
 * sem ela, a leitura responde vazio e a conversão é recusada.
 */

const MotorEstoque = require('../../motores/motor-estoque');

const ORIGEM_MOVIMENTO = 'CONVERSAO_LEGADO';
const REFERENCIA_TIPO = 'conversao_estoque_linha';
const MENSAGEM_ESTRUTURA_AUSENTE = 'A estrutura de conversão de estoque da Linha não está instalada neste banco.';
const MENSAGEM_DUPLICADA = 'Esta conversão já foi executada.';
const MENSAGEM_JA_CONVERTIDO = 'Este produto-linha já foi convertido.';
const AVISO_PENDENTE = 'Conversão pendente de distribuição física.';

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

function erro(mensagem, codigo, statusCode = 400, detalhes) {
  const falha = new Error(mensagem);
  falha.code = codigo;
  falha.statusCode = statusCode;
  if (detalhes) falha.detalhes = detalhes;
  return falha;
}

function round3(valor) {
  return Math.round(Number(valor) * 1000) / 1000;
}

function idPositivo(valor, mensagem, codigo) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw erro(mensagem, codigo, 400);
  return id;
}

function dataCompacta(data = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}${p(data.getMonth() + 1)}${p(data.getDate())}`;
}

function correlationDaConversao(produtoOrigemId, data) {
  return `CONVERSAO-LINHA-${produtoOrigemId}-${dataCompacta(data)}`;
}

async function estruturaInstalada(db) {
  const tabelas = await all(db, `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('linhas_produtos', 'linhas_produtos_legado', 'conversoes_estoque_linha', 'conversoes_estoque_linha_itens')
  `);
  return tabelas.length === 4;
}

async function exigirEstrutura(db) {
  if (!(await estruturaInstalada(db))) throw erro(MENSAGEM_ESTRUTURA_AUSENTE, 'ESTRUTURA_NAO_INSTALADA', 409);
}

async function lerProduto(db, id) {
  return get(db, `
    SELECT id, codigo, nome, ativo, natureza_cadastro, linha_produtos_id, unidade,
           COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
           COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
           COALESCE(estoque_atual, 0) AS estoque_atual,
           saldo_fiscal IS NULL AND saldo_nao_fiscal IS NULL AS saldo_desconhecido
    FROM produtos WHERE id = ?
  `, [id]);
}

function mapearProduto(p) {
  return {
    id: Number(p.id),
    codigo: p.codigo || '',
    nome: p.nome,
    ativo: Number(p.ativo) === 1,
    natureza_cadastro: p.natureza_cadastro || null,
    unidade: p.unidade || 'UN',
    saldo_fiscal: round3(p.saldo_fiscal),
    saldo_nao_fiscal: round3(p.saldo_nao_fiscal),
    estoque_atual: round3(p.estoque_atual)
  };
}

async function consignacoesEmAberto(db, produtoId) {
  const row = await get(db, `
    SELECT COUNT(*) AS itens,
           COALESCE(SUM(ci.quantidade_entregue - COALESCE(ci.quantidade_devolvida, 0) - COALESCE(ci.quantidade_vendida, 0)
             - COALESCE(ci.quantidade_perdida, 0) - COALESCE(ci.quantidade_cortesia, 0)), 0) AS quantidade
    FROM consignacoes_itens ci
    JOIN consignacoes c ON c.id = ci.consignacao_id
    WHERE ci.produto_id = ? AND c.status = 'ENTREGUE'
  `, [produtoId]).catch(() => null);
  return { itens: Number(row && row.itens) || 0, quantidade: round3(row && row.quantidade) };
}

function situacaoLegado(produto, conversoes) {
  if (conversoes) return 'CONVERTIDO';
  if (!produto.ativo) return 'INATIVO';
  if (produto.estoque_atual > 0) return 'PENDENTE';
  return 'SEM_ESTOQUE';
}

const BLOQUEIOS = {
  CONVERTIDO: { codigo: 'PRODUTO_LINHA_JA_CONVERTIDO', mensagem: MENSAGEM_JA_CONVERTIDO },
  INATIVO: { codigo: 'ORIGEM_INATIVA', mensagem: 'Produto-linha inativo não pode ser convertido.' },
  SEM_ESTOQUE: { codigo: 'ORIGEM_SEM_ESTOQUE', mensagem: 'O produto-linha não possui estoque para converter.' }
};

/**
 * Situação do produto-linha para a tela. Depois de convertido, o que estiver no produto
 * (devolução de consignação antiga) é saldo residual, nunca estoque disponível; a pendência
 * de consignação é informada à parte e não soma com nenhum dos dois.
 */
function resumoLegado(produto, conversoes, consignacao) {
  const situacao = situacaoLegado(produto, conversoes);
  const convertido = situacao === 'CONVERTIDO';
  return {
    situacao,
    convertivel: situacao === 'PENDENTE',
    estoque_disponivel: convertido ? 0 : produto.estoque_atual,
    saldo_residual: convertido ? produto.estoque_atual : 0,
    consignacao_pendente: consignacao.quantidade,
    consignacao_itens: consignacao.itens,
    bloqueio: BLOQUEIOS[situacao] || null,
    aviso: situacao === 'PENDENTE' ? AVISO_PENDENTE : null
  };
}

async function registrarProdutoLegado(db, entrada) {
  await exigirEstrutura(db);
  const linhaId = idPositivo(entrada && entrada.linha_produtos_id, 'Informe a Linha de Produtos.', 'LINHA_OBRIGATORIA');
  const produtoId = idPositivo(entrada && entrada.produto_id, 'Informe o produto-linha.', 'PRODUTO_OBRIGATORIO');
  const linha = await get(db, 'SELECT id FROM linhas_produtos WHERE id = ?', [linhaId]);
  if (!linha) throw erro('Linha de Produtos não encontrada.', 'LINHA_INEXISTENTE', 404);
  const produto = await lerProduto(db, produtoId);
  if (!produto) throw erro('Produto não encontrado.', 'PRODUTO_INEXISTENTE', 404);
  if (String(produto.natureza_cadastro || '').toUpperCase() === 'INSUMO') {
    throw erro('Insumo não pode ser produto-linha.', 'PRODUTO_INSUMO', 400);
  }
  if (produto.linha_produtos_id != null) {
    throw erro('Este produto é um sabor de uma Linha, não um produto-linha.', 'PRODUTO_E_SABOR', 400);
  }
  try {
    await run(db, 'INSERT INTO linhas_produtos_legado (linha_produtos_id, produto_id) VALUES (?, ?)', [linhaId, produtoId]);
  } catch (err) {
    if (/unique/i.test(String(err.message))) throw erro('Este produto já está vinculado como produto-linha.', 'LEGADO_DUPLICADO', 409);
    throw err;
  }
  return { linha_produtos_id: linhaId, produto_id: produtoId };
}

async function listarConversaoLinhas(db) {
  if (!(await estruturaInstalada(db))) return { instalada: false, linhas: [], conversoes: [] };
  const linhas = await all(db, 'SELECT id, codigo, nome, ativo FROM linhas_produtos ORDER BY nome COLLATE NOCASE');
  const legados = await all(db, `
    SELECT l.linha_produtos_id, p.id, p.codigo, p.nome, p.ativo, p.natureza_cadastro, p.unidade,
           COALESCE(p.saldo_fiscal, 0) AS saldo_fiscal, COALESCE(p.saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
           COALESCE(p.estoque_atual, 0) AS estoque_atual,
           (SELECT COUNT(*) FROM conversoes_estoque_linha c WHERE c.produto_origem_id = p.id) AS conversoes
    FROM linhas_produtos_legado l
    JOIN produtos p ON p.id = l.produto_id
    ORDER BY p.id
  `);
  const sabores = await all(db, `
    SELECT linha_produtos_id, COUNT(*) AS quantidade
    FROM produtos
    WHERE linha_produtos_id IS NOT NULL AND UPPER(COALESCE(natureza_cadastro, '')) <> 'INSUMO'
    GROUP BY linha_produtos_id
  `);
  const conversoes = await all(db, `
    SELECT c.id, c.correlation_id, c.linha_produtos_id, lp.nome AS linha_nome, c.produto_origem_id, p.nome AS produto_origem_nome,
           c.quantidade_total, c.status, c.usuario_nome, c.created_at
    FROM conversoes_estoque_linha c
    JOIN linhas_produtos lp ON lp.id = c.linha_produtos_id
    JOIN produtos p ON p.id = c.produto_origem_id
    ORDER BY c.id DESC
  `);
  const consignacoes = new Map();
  for (const l of legados) consignacoes.set(Number(l.id), await consignacoesEmAberto(db, l.id));
  return {
    instalada: true,
    linhas: linhas.map((linha) => ({
      id: Number(linha.id),
      codigo: linha.codigo || '',
      nome: linha.nome,
      ativo: Number(linha.ativo) === 1,
      quantidade_sabores: Number((sabores.find((s) => Number(s.linha_produtos_id) === Number(linha.id)) || {}).quantidade || 0),
      produtos_legado: legados
        .filter((l) => Number(l.linha_produtos_id) === Number(linha.id))
        .map((l) => {
          const produto = mapearProduto(l);
          const conversao = conversoes.find((c) => Number(c.produto_origem_id) === produto.id);
          return {
            ...produto,
            conversoes: Number(l.conversoes),
            conversao_id: conversao ? Number(conversao.id) : null,
            ...resumoLegado(produto, Number(l.conversoes), consignacoes.get(produto.id))
          };
        })
    })),
    conversoes: conversoes.map((c) => ({ ...c, quantidade_total: round3(c.quantidade_total) }))
  };
}

async function obterGradeConversao(db, produtoOrigemId) {
  await exigirEstrutura(db);
  const origemId = idPositivo(produtoOrigemId, 'Informe o produto-linha.', 'ORIGEM_OBRIGATORIA');
  const vinculo = await get(db, `
    SELECT l.linha_produtos_id, lp.codigo, lp.nome
    FROM linhas_produtos_legado l JOIN linhas_produtos lp ON lp.id = l.linha_produtos_id
    WHERE l.produto_id = ?
  `, [origemId]);
  if (!vinculo) throw erro('Este produto não está identificado como produto-linha legado.', 'PRODUTO_NAO_LEGADO', 404);
  const origem = await lerProduto(db, origemId);
  if (!origem) throw erro('Produto de origem não encontrado.', 'ORIGEM_INEXISTENTE', 404);
  const sabores = await all(db, `
    SELECT id, codigo, nome, ativo, natureza_cadastro, unidade,
           COALESCE(saldo_fiscal, 0) AS saldo_fiscal, COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
           COALESCE(estoque_atual, 0) AS estoque_atual
    FROM produtos
    WHERE linha_produtos_id = ? AND UPPER(COALESCE(natureza_cadastro, '')) <> 'INSUMO'
    ORDER BY nome COLLATE NOCASE
  `, [vinculo.linha_produtos_id]);
  const conversoes = await all(db, `
    SELECT id, correlation_id, quantidade_total, status, created_at
    FROM conversoes_estoque_linha WHERE produto_origem_id = ? ORDER BY id DESC
  `, [origemId]);
  const produtoOrigem = mapearProduto(origem);
  const consignacao = await consignacoesEmAberto(db, origemId);
  return {
    linha: { id: Number(vinculo.linha_produtos_id), codigo: vinculo.codigo || '', nome: vinculo.nome },
    origem: { ...produtoOrigem, ...resumoLegado(produtoOrigem, conversoes.length, consignacao) },
    consignacoes_em_aberto: consignacao,
    correlation_id: conversoes.length ? conversoes[conversoes.length - 1].correlation_id : correlationDaConversao(origemId),
    sabores: sabores.map((s) => {
      const produto = mapearProduto(s);
      const produzido = String(produto.natureza_cadastro || '').toUpperCase() === 'PRODUZIDO';
      return { ...produto, apto: produzido, motivo_bloqueio: produzido ? null : 'Sabor sem natureza PRODUZIDO.' };
    }),
    conversoes
  };
}

function quantidadeInformada(valor, produtoId) {
  if (valor === '' || valor == null) return 0;
  const n = Number(valor);
  if (!Number.isFinite(n)) throw erro(`Quantidade inválida para o produto ${produtoId}.`, 'QUANTIDADE_INVALIDA', 400);
  if (n < 0) throw erro(`A quantidade do produto ${produtoId} não pode ser negativa.`, 'QUANTIDADE_NEGATIVA', 400);
  return round3(n);
}

/**
 * Valida tudo antes de mexer no estoque. Lança o primeiro problema encontrado.
 */
async function validarConversao(db, entrada) {
  const dados = entrada || {};
  const origemId = idPositivo(dados.produto_origem_id, 'Informe o produto-linha de origem.', 'ORIGEM_OBRIGATORIA');
  const origem = await lerProduto(db, origemId);
  if (!origem) throw erro('Produto de origem não encontrado.', 'ORIGEM_INEXISTENTE', 404);
  const vinculo = await get(db, 'SELECT linha_produtos_id FROM linhas_produtos_legado WHERE produto_id = ?', [origemId]);
  if (!vinculo) throw erro('Este produto não está identificado como produto-linha legado.', 'PRODUTO_NAO_LEGADO', 400);
  const linhaId = Number(vinculo.linha_produtos_id);
  if (dados.linha_produtos_id != null && Number(dados.linha_produtos_id) !== linhaId) {
    throw erro('O produto-linha não pertence à Linha selecionada.', 'LINHA_DIVERGENTE', 400);
  }
  const anterior = await get(db, 'SELECT id, correlation_id FROM conversoes_estoque_linha WHERE produto_origem_id = ? ORDER BY id LIMIT 1', [origemId]);
  if (anterior) {
    throw erro(MENSAGEM_JA_CONVERTIDO, 'PRODUTO_LINHA_JA_CONVERTIDO', 409, { conversao_id: Number(anterior.id), correlation_id: anterior.correlation_id });
  }
  if (Number(origem.ativo) !== 1) throw erro('Produto-linha inativo não pode ser convertido.', 'ORIGEM_INATIVA', 400);
  if (Number(origem.saldo_desconhecido) === 1) throw erro('O estoque do produto-linha não é conhecido.', 'ORIGEM_SALDO_DESCONHECIDO', 400);
  const origemFiscal = round3(origem.saldo_fiscal);
  const origemNaoFiscal = round3(origem.saldo_nao_fiscal);
  if (origemFiscal < 0 || origemNaoFiscal < 0) throw erro('O produto-linha está com saldo negativo.', 'ORIGEM_SALDO_NEGATIVO', 400);
  const origemTotal = round3(origemFiscal + origemNaoFiscal);
  if (!(origemTotal > 0)) throw erro('O produto-linha não possui estoque para converter.', 'ORIGEM_SEM_ESTOQUE', 400);
  const reserva = await get(db, `SELECT COUNT(*) AS q FROM estoque_reservas WHERE produto_id = ? AND status = 'ATIVA'`, [origemId]).catch(() => null);
  if (reserva && Number(reserva.q) > 0) throw erro('O produto-linha possui reserva de estoque ativa.', 'ORIGEM_COM_RESERVA', 409);

  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (!itens.length) throw erro('Informe a distribuição por sabor.', 'DISTRIBUICAO_OBRIGATORIA', 400);
  const legados = new Set((await all(db, 'SELECT produto_id FROM linhas_produtos_legado')).map((l) => Number(l.produto_id)));
  const vistos = new Set();
  const preparados = [];
  for (const item of itens) {
    const produtoId = idPositivo(item && item.produto_id, 'Produto destino inválido.', 'DESTINO_INVALIDO');
    if (vistos.has(produtoId)) throw erro(`O produto ${produtoId} aparece mais de uma vez.`, 'DESTINO_DUPLICADO', 400);
    vistos.add(produtoId);
    const fiscal = quantidadeInformada(item.quantidade_fiscal, produtoId);
    const naoFiscal = quantidadeInformada(item.quantidade_nao_fiscal, produtoId);
    const destino = await lerProduto(db, produtoId);
    if (!destino) throw erro(`Produto destino ${produtoId} não encontrado.`, 'DESTINO_INEXISTENTE', 404);
    if (String(destino.natureza_cadastro || '').toUpperCase() === 'INSUMO') {
      throw erro(`${destino.nome} é insumo e não pode receber estoque da Linha.`, 'DESTINO_INSUMO', 400);
    }
    if (legados.has(produtoId)) throw erro(`${destino.nome} é outro produto-linha.`, 'DESTINO_PRODUTO_LINHA', 400);
    if (Number(destino.linha_produtos_id) !== linhaId) {
      throw erro(`${destino.nome} não pertence a esta Linha de Produtos.`, 'DESTINO_OUTRA_LINHA', 400);
    }
    if (String(destino.natureza_cadastro || '').toUpperCase() !== 'PRODUZIDO') {
      throw erro(`${destino.nome} não está classificado como PRODUZIDO.`, 'DESTINO_NAO_PRODUZIDO', 400);
    }
    const total = round3(fiscal + naoFiscal);
    const reativar = item.reativar === true || item.reativar === 1 || item.reativar === '1';
    if (reativar && !(total > 0)) {
      throw erro(`${destino.nome} não recebeu estoque e não pode ser reativado pela conversão.`, 'REATIVACAO_SEM_ESTOQUE', 400);
    }
    if (total > 0 && Number(destino.ativo) !== 1 && !reativar) {
      throw erro(`${destino.nome} está inativo. Marque "Reativar" para que ele receba estoque.`, 'DESTINO_INATIVO', 400);
    }
    preparados.push({ produto: destino, quantidade_fiscal: fiscal, quantidade_nao_fiscal: naoFiscal, quantidade_total: total, reativar });
  }

  const somaFiscal = round3(preparados.reduce((s, i) => s + i.quantidade_fiscal, 0));
  const somaNaoFiscal = round3(preparados.reduce((s, i) => s + i.quantidade_nao_fiscal, 0));
  const somaTotal = round3(somaFiscal + somaNaoFiscal);
  const detalhes = {
    origem: { fiscal: origemFiscal, nao_fiscal: origemNaoFiscal, total: origemTotal },
    informado: { fiscal: somaFiscal, nao_fiscal: somaNaoFiscal, total: somaTotal },
    diferenca: { fiscal: round3(origemFiscal - somaFiscal), nao_fiscal: round3(origemNaoFiscal - somaNaoFiscal), total: round3(origemTotal - somaTotal) }
  };
  if (somaTotal < origemTotal) throw erro('A soma dos sabores é menor que o estoque do produto-linha.', 'SOMA_MENOR', 400, detalhes);
  if (somaTotal > origemTotal) throw erro('A soma dos sabores é maior que o estoque do produto-linha.', 'SOMA_MAIOR', 400, detalhes);
  if (detalhes.diferenca.fiscal !== 0 || detalhes.diferenca.nao_fiscal !== 0) {
    throw erro('A divisão fiscal / não fiscal dos sabores não confere com o produto-linha.', 'SOMA_FISCAL_DIVERGENTE', 400, detalhes);
  }
  return { origem, linhaId, itens: preparados, totais: detalhes };
}

async function obterConversao(db, id) {
  await exigirEstrutura(db);
  const conversaoId = idPositivo(id, 'Conversão inválida.', 'CONVERSAO_INVALIDA');
  const c = await get(db, `
    SELECT c.*, lp.codigo AS linha_codigo, lp.nome AS linha_nome, p.codigo AS origem_codigo, p.nome AS origem_nome,
           COALESCE(p.estoque_atual, 0) AS origem_estoque_atual
    FROM conversoes_estoque_linha c
    JOIN linhas_produtos lp ON lp.id = c.linha_produtos_id
    JOIN produtos p ON p.id = c.produto_origem_id
    WHERE c.id = ?
  `, [conversaoId]);
  if (!c) throw erro('Conversão não encontrada.', 'CONVERSAO_INEXISTENTE', 404);
  const itens = await all(db, `
    SELECT i.*, p.codigo, p.nome, p.ativo
    FROM conversoes_estoque_linha_itens i JOIN produtos p ON p.id = i.produto_id
    WHERE i.conversao_id = ? ORDER BY i.quantidade_total DESC, p.nome COLLATE NOCASE
  `, [conversaoId]);
  const movimentacoes = await all(db, `
    SELECT id, produto_id, operacao, origem, quantidade_base, quantidade_fiscal, quantidade_nao_fiscal, saldo_antes, saldo_depois, motivo, created_at
    FROM estoque_movimentacoes
    WHERE referencia_tipo = ? AND referencia_id = ?
    ORDER BY id
  `, [REFERENCIA_TIPO, conversaoId]);
  const distribuidoFiscal = round3(itens.reduce((s, i) => s + Number(i.quantidade_fiscal || 0), 0));
  const distribuidoNaoFiscal = round3(itens.reduce((s, i) => s + Number(i.quantidade_nao_fiscal || 0), 0));
  return {
    id: Number(c.id),
    descricao_operacao: 'Operação de conversão de estoque legado.',
    totais: {
      fiscal_origem: round3(c.quantidade_fiscal),
      fiscal_distribuido: distribuidoFiscal,
      nao_fiscal_origem: round3(c.quantidade_nao_fiscal),
      nao_fiscal_distribuido: distribuidoNaoFiscal,
      total_origem: round3(c.quantidade_total),
      total_distribuido: round3(distribuidoFiscal + distribuidoNaoFiscal)
    },
    correlation_id: c.correlation_id,
    status: c.status,
    linha: { id: Number(c.linha_produtos_id), codigo: c.linha_codigo || '', nome: c.linha_nome },
    origem: { id: Number(c.produto_origem_id), codigo: c.origem_codigo || '', nome: c.origem_nome, estoque_atual: round3(c.origem_estoque_atual) },
    quantidade_total: round3(c.quantidade_total),
    quantidade_fiscal: round3(c.quantidade_fiscal),
    quantidade_nao_fiscal: round3(c.quantidade_nao_fiscal),
    observacao: c.observacao || '',
    usuario_id: c.usuario_id != null ? Number(c.usuario_id) : null,
    usuario_nome: c.usuario_nome || '',
    created_at: c.created_at,
    itens: itens.map((i) => ({
      produto_id: Number(i.produto_id),
      codigo: i.codigo || '',
      nome: i.nome,
      quantidade_fiscal: round3(i.quantidade_fiscal),
      quantidade_nao_fiscal: round3(i.quantidade_nao_fiscal),
      quantidade_total: round3(i.quantidade_total),
      estoque_antes: round3(i.estoque_antes),
      estoque_depois: round3(i.estoque_depois),
      reativado: Number(i.reativado) === 1,
      ativo: Number(i.ativo) === 1
    })),
    movimentacoes
  };
}

async function converterEstoqueLinha(db, entrada, contexto) {
  await exigirEstrutura(db);
  const dados = entrada || {};
  const origemId = idPositivo(dados.produto_origem_id, 'Informe o produto-linha de origem.', 'ORIGEM_OBRIGATORIA');
  const correlationId = correlationDaConversao(origemId);
  const usuarioId = contexto && contexto.usuario_id ? Number(contexto.usuario_id) : null;
  const usuarioNome = (contexto && contexto.usuario_nome) || null;

  await run(db, 'BEGIN IMMEDIATE');
  let conversaoId;
  try {
    const validada = await validarConversao(db, dados);
    const { origem, linhaId, itens, totais } = validada;
    const motivo = `${ORIGEM_MOVIMENTO}:${correlationId}`;

    const inserida = await run(db, `
      INSERT INTO conversoes_estoque_linha (
        correlation_id, linha_produtos_id, produto_origem_id, quantidade_total, quantidade_fiscal, quantidade_nao_fiscal,
        status, observacao, usuario_id, usuario_nome
      ) VALUES (?, ?, ?, ?, ?, ?, 'CONCLUIDA', ?, ?, ?)
    `, [correlationId, linhaId, origem.id, totais.origem.total, totais.origem.fiscal, totais.origem.nao_fiscal,
      String(dados.observacao || '').trim() || null, usuarioId, usuarioNome]);
    conversaoId = inserida.id;

    await MotorEstoque.sair(db, {
      produtoId: origem.id,
      quantidadeBase: totais.origem.total,
      quantidadeFiscal: totais.origem.fiscal,
      quantidadeNaoFiscal: totais.origem.nao_fiscal,
      origem: ORIGEM_MOVIMENTO,
      local: MotorEstoque.LOCAL_LOJA,
      referenciaTipo: REFERENCIA_TIPO,
      referenciaId: conversaoId,
      usuarioId,
      motivo
    });

    for (const item of itens) {
      const antes = round3(item.produto.estoque_atual);
      let depois = antes;
      if (item.quantidade_total > 0) {
        const movimento = await MotorEstoque.entrar(db, {
          produtoId: item.produto.id,
          quantidadeBase: item.quantidade_total,
          quantidadeFiscal: item.quantidade_fiscal,
          quantidadeNaoFiscal: item.quantidade_nao_fiscal,
          origem: ORIGEM_MOVIMENTO,
          local: MotorEstoque.LOCAL_LOJA,
          referenciaTipo: REFERENCIA_TIPO,
          referenciaId: conversaoId,
          usuarioId,
          motivo
        });
        depois = round3(movimento.saldo.estoqueAtual);
      }
      let reativado = 0;
      if (item.reativar && Number(item.produto.ativo) !== 1) {
        await run(db, `UPDATE produtos SET ativo = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [item.produto.id]);
        reativado = 1;
      }
      await run(db, `
        INSERT INTO conversoes_estoque_linha_itens (
          conversao_id, produto_id, quantidade_fiscal, quantidade_nao_fiscal, quantidade_total, estoque_antes, estoque_depois, reativado
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [conversaoId, item.produto.id, item.quantidade_fiscal, item.quantidade_nao_fiscal, item.quantidade_total, antes, depois, reativado]);
    }

    const origemDepois = await lerProduto(db, origem.id);
    const entradas = await get(db, `
      SELECT COALESCE(SUM(quantidade_fiscal), 0) AS fiscal, COALESCE(SUM(quantidade_nao_fiscal), 0) AS nao_fiscal
      FROM estoque_movimentacoes
      WHERE referencia_tipo = ? AND referencia_id = ? AND operacao = 'ENTRADA'
    `, [REFERENCIA_TIPO, conversaoId]);
    if (round3(origemDepois.estoque_atual) !== 0
      || round3(entradas.fiscal) !== totais.origem.fiscal
      || round3(entradas.nao_fiscal) !== totais.origem.nao_fiscal) {
      throw erro('A conferência da conversão não fechou. Nada foi gravado.', 'CONFERENCIA_FALHOU', 500);
    }
    await run(db, 'COMMIT');
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* a transação já pode ter sido encerrada */ }
    if (/UNIQUE/i.test(String(err && err.message)) && /correlation_id/i.test(String(err.message))) {
      throw erro(MENSAGEM_DUPLICADA, 'CONVERSAO_DUPLICADA', 409, { correlation_id: correlationId });
    }
    throw err;
  }

  const conversao = await obterConversao(db, conversaoId);
  if (contexto && typeof contexto.auditar === 'function') {
    await contexto.auditar({
      acao: 'CONVERSAO_ESTOQUE_LINHA',
      referencia_id: conversao.id,
      detalhes: {
        correlation_id: conversao.correlation_id,
        linha: conversao.linha.nome,
        produto_origem_id: conversao.origem.id,
        quantidade_total: conversao.quantidade_total,
        itens: conversao.itens.map((i) => ({ produto_id: i.produto_id, quantidade_total: i.quantidade_total, reativado: i.reativado }))
      }
    });
  }
  return conversao;
}

module.exports = {
  ORIGEM_MOVIMENTO_CONVERSAO: ORIGEM_MOVIMENTO,
  estruturaConversaoInstalada: estruturaInstalada,
  correlationDaConversao,
  registrarProdutoLegado,
  listarConversaoLinhas,
  obterGradeConversao,
  validarConversao,
  converterEstoqueLinha,
  obterConversao
};
