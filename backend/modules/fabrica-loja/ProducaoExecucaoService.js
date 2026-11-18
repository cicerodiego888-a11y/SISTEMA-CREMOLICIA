/**
 * Executa uma ordem de produção em produção (iniciada).
 * Converte pelo MCC, confere o saldo e movimenta só pelo Motor de Estoque.
 * Não gera financeiro, não transfere para a loja e não produz parcialmente.
 */

const bootstrapExecucoes = require('./migrations/006_ordem_producao_execucoes');
const { obterOrdem } = require('./OrdemProducaoService');
const { STATUS_ORDEM } = require('./constants');
const MotorEstoque = require('../../motores/motor-estoque');
const ConversaoComercialService = require('../../motores/motor-conversao-comercial/services/ConversaoComercialService');
const conversorOficial = new ConversaoComercialService();

const MENSAGEM_CONCLUIDA = 'Esta Ordem de Produção já foi concluída.';
const MENSAGEM_ESTADO = 'Esta ordem de produção não pode ser executada neste estado.';
const MENSAGEM_CONVERSAO = 'Não foi possível converter a unidade do insumo para a unidade de estoque.';
const LOCAL_CONSUMO = 'FABRICA';
const MENSAGEM_ESTOQUE = 'Estoque insuficiente para executar a produção.';

function mensagemEstoqueFabrica(faltas) {
  const nomes = faltas.map((item) => item.produto).filter(Boolean).join(', ');
  return `Estoque insuficiente de ${nomes} na Fábrica para executar esta produção.`;
}
const MENSAGEM_PRODUTO = 'O produto da Ordem de Produção precisa estar classificado como PRODUZIDO.';
const MENSAGEM_SEM_PRODUTO = 'A Ficha Técnica possui componente sem produto cadastrado.';
const MENSAGEM_NAO_INSUMO = 'A Ficha Técnica possui componente que não está classificado como INSUMO.';
const MENSAGEM_RENDIMENTO = 'A Ficha Técnica possui rendimento inválido para produção.';
const MENSAGEM_PARCIAL = 'A produção parcial não está disponível.';
const MENSAGEM_RESULTADO = 'A quantidade produzida + perda deve corresponder à quantidade planejada.';
const MENSAGEM_ACIMA = 'A quantidade produzida + perdida não pode ser maior que a quantidade planejada.';
const MENSAGEM_JA_INICIADA = 'A ordem de produção já foi iniciada.';
const MENSAGEM_NAO_INICIADA = 'É necessário iniciar a produção antes de executar esta ordem.';
const MENSAGEM_PRODUZIDA_NEGATIVA = 'A quantidade produzida não pode ser negativa.';
const MENSAGEM_PERDIDA_NEGATIVA = 'A quantidade perdida não pode ser negativa.';
const ORIGEM_PRODUCAO = 'PRODUCAO';

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

function unidade(valor) {
  return texto(valor).toUpperCase();
}

async function tabelaExiste(db, nome) {
  const row = await get(db, `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`, [nome]);
  return !!row;
}

async function colunas(db, tabela) {
  if (!(await tabelaExiste(db, tabela))) return [];
  const rows = await all(db, `PRAGMA table_info(${tabela})`);
  return rows.map((coluna) => coluna.name);
}

function converterOficial(produto, quantidade, unidadeOrigem, unidadeBase) {
  const origem = unidade(unidadeOrigem);
  const base = unidade(unidadeBase || produto.unidade || 'UN');
  if (!origem) {
    throw erro('A Ficha Técnica possui componente com unidade inválida.', 'UNIDADE_INVALIDA');
  }
  try {
    const resultado = conversorOficial.Converter({
      produto: {
        id: produto.id,
        unidade: base,
        conversoes: [],
        unidades_comercializacao: []
      },
      quantidade: Number(quantidade),
      unidadeOrigem: origem,
      unidadeBase: base,
      contexto: 'OUTROS'
    });
    const convertida = Number(resultado.quantidadeConvertida);
    if (!Number.isFinite(convertida) || convertida < 0) {
      throw erro(MENSAGEM_CONVERSAO, 'UNIDADE_INCOMPATIVEL');
    }
    return { quantidadeBase: round3(convertida), unidadeBase: base };
  } catch (err) {
    if (err.code === 'UNIDADE_INVALIDA' || err.code === 'UNIDADE_INCOMPATIVEL') throw err;
    throw erro(MENSAGEM_CONVERSAO, 'UNIDADE_INCOMPATIVEL');
  }
}

async function produtoCompleto(db, produtoId) {
  const nomes = await colunas(db, 'produtos');
  if (!nomes.length) throw erro('O produto informado não existe.', 'PRODUTO_NAO_ENCONTRADO', 404);
  const custo = nomes.includes('preco_compra') ? 'preco_compra' : 'NULL AS preco_compra';
  const medio = nomes.includes('custo_medio') ? 'custo_medio' : 'NULL AS custo_medio';
  const ativo = nomes.includes('ativo') ? 'COALESCE(ativo, 1) AS ativo' : '1 AS ativo';
  const natureza = nomes.includes('natureza_cadastro') ? 'natureza_cadastro' : 'NULL AS natureza_cadastro';
  const row = await get(db, `
    SELECT id, nome, unidade, ${natureza}, ${ativo}, ${custo}, ${medio}
    FROM produtos WHERE id = ?
  `, [produtoId]);
  if (!row) throw erro('O produto informado não existe.', 'PRODUTO_NAO_ENCONTRADO', 404);
  return {
    id: Number(row.id),
    nome: texto(row.nome) || `Produto ${row.id}`,
    unidade: row.unidade || 'UN',
    natureza_cadastro: row.natureza_cadastro || null,
    ativo: Number(row.ativo) !== 0,
    preco_compra: row.preco_compra == null ? null : Number(row.preco_compra),
    custo_medio: row.custo_medio == null ? null : Number(row.custo_medio)
  };
}

async function carregarFicha(db, fichaId) {
  if (!fichaId) throw erro('A ordem não possui ficha técnica para produção.', 'FICHA_OBRIGATORIA');
  const ficha = await get(db, `
    SELECT id, codigo, nome, produto_id, produto_nome, rendimento_quantidade,
           rendimento_unidade, observacoes, ativa
    FROM fichas_tecnicas WHERE id = ?
  `, [fichaId]);
  if (!ficha) throw erro('A ficha técnica informada não existe.', 'FICHA_NAO_ENCONTRADA', 404);
  if (Number(ficha.ativa) === 0) throw erro('A Ficha Técnica está inativa.', 'FICHA_INATIVA');
  const componentes = await all(db, `
    SELECT id, ordem, produto_id, descricao, quantidade, unidade, observacao
    FROM ficha_tecnica_componentes WHERE ficha_id = ? ORDER BY ordem, id
  `, [fichaId]);
  const etapas = await all(db, `
    SELECT ordem, titulo, descricao, tempo_minutos, observacao
    FROM ficha_tecnica_etapas WHERE ficha_id = ? ORDER BY ordem, id
  `, [fichaId]);
  const informacoes = await all(db, `
    SELECT ordem, titulo, valor FROM ficha_tecnica_informacoes WHERE ficha_id = ? ORDER BY ordem, id
  `, [fichaId]);
  return { ficha, componentes, etapas, informacoes };
}

function carregarSnapshotFicha(item) {
  const snapshot = item.ficha_padrao_snapshot;
  if (!snapshot) return null;
  return {
    ficha: {
      id: Number(snapshot.ficha_padrao_id),
      codigo: snapshot.codigo,
      nome: snapshot.nome,
      produto_id: null,
      rendimento_quantidade: snapshot.rendimento_quantidade,
      rendimento_unidade: snapshot.rendimento_unidade,
      observacoes: snapshot.observacoes || '',
      ativa: 1
    },
    componentes: snapshot.componentes || [],
    etapas: snapshot.etapas || [],
    informacoes: snapshot.informacoes || []
  };
}

async function localFabrica(db) {
  if (!(await tabelaExiste(db, 'unidades_negocio'))) {
    return { local: 'FABRICA', unidade_negocio_id: null };
  }
  const row = await get(db, `
    SELECT id FROM unidades_negocio
    WHERE tipo = 'FABRICA' AND COALESCE(ativa, 1) = 1
    ORDER BY id LIMIT 1
  `);
  return { local: 'FABRICA', unidade_negocio_id: row ? Number(row.id) : null };
}

function informado(valor) {
  return valor != null && valor !== '';
}

function lerQuantidade(valor, nome) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) throw erro(`A quantidade ${nome} é inválida.`, 'QUANTIDADE_INVALIDA');
  return round3(numero);
}

function resolverQuantidades(planejada, entrada) {
  const dados = entrada || {};
  const produzida = informado(dados.quantidade_produzida)
    ? lerQuantidade(dados.quantidade_produzida, 'produzida')
    : planejada;
  const perdida = informado(dados.quantidade_perdida)
    ? lerQuantidade(dados.quantidade_perdida, 'perdida')
    : 0;
  if (produzida < 0) throw erro(MENSAGEM_PRODUZIDA_NEGATIVA, 'PRODUCAO_NEGATIVA');
  if (perdida < 0) throw erro(MENSAGEM_PERDIDA_NEGATIVA, 'PERDA_NEGATIVA');
  if (produzida + perdida > planejada + 0.000001) throw erro(MENSAGEM_ACIMA, 'PRODUCAO_ACIMA_PLANEJADO');
  if (Math.abs((produzida + perdida) - planejada) > 0.001) throw erro(MENSAGEM_RESULTADO, 'RESULTADO_DIVERGENTE');
  return {
    produzida,
    perdida,
    processada: planejada,
    rendimentoReal: planejada > 0 ? round3((produzida / planejada) * 100) : 0
  };
}

function exigirPlanejada(ordem) {
  if (ordem.status === STATUS_ORDEM.CONCLUIDA) throw erro(MENSAGEM_CONCLUIDA, 'OP_CONCLUIDA');
  if (ordem.status === STATUS_ORDEM.CANCELADA) {
    throw erro(MENSAGEM_ESTADO, 'OP_CANCELADA');
  }
  if (ordem.status !== STATUS_ORDEM.PLANEJADA && ordem.status !== STATUS_ORDEM.EM_PRODUCAO) {
    throw erro(MENSAGEM_ESTADO, 'OP_NAO_PLANEJADA');
  }
}

function dadosDoItem(item, entrada, unico) {
  const dados = entrada || {};
  if (unico) return dados;
  if (!Array.isArray(dados.itens)) return {};
  const linha = dados.itens.find((candidato) => {
    if (!candidato) return false;
    if (candidato.ordem_item_id != null && Number(candidato.ordem_item_id) === Number(item.id)) return true;
    return candidato.produto_id != null && Number(candidato.produto_id) === Number(item.produto_id);
  });
  return linha || {};
}

async function montarPlano(db, ordem, entrada, opcoes) {
  exigirPlanejada(ordem);
  const dados = entrada || {};
  if (ordem.itens.length !== 1 && (informado(dados.quantidade_produzida) || informado(dados.quantidade_perdida))) {
    throw erro(MENSAGEM_PARCIAL, 'PRODUCAO_PARCIAL_INDISPONIVEL');
  }
  const local = await localFabrica(db);
  const capturadoEm = new Date().toISOString();
  const produzidos = [];
  const consumos = [];

  for (const item of ordem.itens) {
    const produto = await produtoCompleto(db, item.produto_id);
    if (!produto.ativo) throw erro('O produto da Ordem de Produção está inativo.', 'PRODUTO_INATIVO');
    if (produto.natureza_cadastro !== 'PRODUZIDO') throw erro(MENSAGEM_PRODUTO, 'PRODUTO_NAO_PRODUZIDO');
    const receita = carregarSnapshotFicha(item) || await carregarFicha(db, item.ficha_tecnica_id);
    const rendimento = Number(receita.ficha.rendimento_quantidade);
    if (!(rendimento > 0)) throw erro(MENSAGEM_RENDIMENTO, 'RENDIMENTO_INVALIDO');
    if (!receita.componentes.length) {
      throw erro('A Ficha Técnica não possui componentes.', 'FICHA_SEM_COMPONENTES');
    }
    const planejadaNaFicha = converterOficial(
      { id: produto.id, nome: produto.nome },
      item.quantidade_planejada,
      item.unidade || produto.unidade,
      receita.ficha.rendimento_unidade || item.unidade || produto.unidade
    );
    const fator = planejadaNaFicha.quantidadeBase / rendimento;
    const componentes = [];
    for (const componente of receita.componentes) {
      if (!componente.produto_id) throw erro(MENSAGEM_SEM_PRODUTO, 'COMPONENTE_SEM_PRODUTO');
      const quantidade = Number(componente.quantidade);
      if (!(quantidade > 0)) {
        throw erro('A Ficha Técnica possui componente com quantidade inválida.', 'COMPONENTE_QUANTIDADE_INVALIDA');
      }
      const insumo = await produtoCompleto(db, componente.produto_id);
      if (insumo.natureza_cadastro !== 'INSUMO') throw erro(MENSAGEM_NAO_INSUMO, 'COMPONENTE_NAO_INSUMO');
      const quantidadeFicha = round3(quantidade * fator);
      const naBase = converterOficial(insumo, quantidadeFicha, componente.unidade, insumo.unidade);
      const custoUnitario = insumo.custo_medio != null ? insumo.custo_medio : insumo.preco_compra;
      componentes.push({
        produto_id: insumo.id,
        nome: insumo.nome,
        quantidade: quantidadeFicha,
        unidade: unidade(componente.unidade),
        quantidade_base: naBase.quantidadeBase,
        unidade_base: naBase.unidadeBase,
        observacao: componente.observacao || '',
        custo_unitario: custoUnitario,
        custo_total: custoUnitario == null ? null : round3(custoUnitario * naBase.quantidadeBase)
      });
      consumos.push(componentes[componentes.length - 1]);
    }
    const entradaItem = dadosDoItem(item, dados, ordem.itens.length === 1);
    const resultado = resolverQuantidades(Number(item.quantidade_planejada), entradaItem);
    const produzidoBase = resultado.produzida === 0
      ? { quantidadeBase: 0, unidadeBase: unidade(produto.unidade) }
      : converterOficial(
        produto,
        resultado.produzida,
        item.unidade || produto.unidade,
        produto.unidade
      );
    produzidos.push({
      produto_id: produto.id,
      produto_nome: produto.nome,
      quantidade_planejada: Number(item.quantidade_planejada),
      quantidade_processada: resultado.processada,
      quantidade_produzida: resultado.produzida,
      quantidade_perdida: resultado.perdida,
      rendimento_real: resultado.rendimentoReal,
      motivo_perda: texto(entradaItem.motivo_perda || entradaItem.motivo || dados.motivo_perda || dados.motivo),
      observacao_perda: texto(entradaItem.observacao_perda || entradaItem.observacao || dados.observacao_perda || dados.observacao),
      unidade: item.unidade || produto.unidade,
      quantidade_base: produzidoBase.quantidadeBase,
      unidade_base: produzidoBase.unidadeBase,
      ficha: {
        ficha_tecnica_id: Number(receita.ficha.id),
        ficha_padrao_vinculo_id: item.ficha_padrao_vinculo_id,
        ficha_padrao_versao_id: item.ficha_padrao_versao_id,
        codigo: receita.ficha.codigo,
        nome: receita.ficha.nome,
        produto_id: receita.ficha.produto_id == null ? null : Number(receita.ficha.produto_id),
        rendimento_quantidade: rendimento,
        rendimento_unidade: receita.ficha.rendimento_unidade || '',
        componentes: receita.componentes.map((componente) => ({
          produto_id: componente.produto_id == null ? null : Number(componente.produto_id),
          descricao: componente.descricao,
          quantidade: Number(componente.quantidade),
          unidade: componente.unidade || '',
          observacao: componente.observacao || ''
        })),
        etapas: receita.etapas,
        informacoes: receita.informacoes,
        capturado_em: capturadoEm
      },
      consumo: componentes
    });
  }

  const agrupado = new Map();
  for (const consumo of consumos) {
    const atual = agrupado.get(consumo.produto_id) || {
      produto_id: consumo.produto_id,
      nome: consumo.nome,
      quantidade_base: 0,
      unidade_base: consumo.unidade_base,
      linhas: []
    };
    atual.quantidade_base = round3(atual.quantidade_base + consumo.quantidade_base);
    atual.linhas.push(consumo);
    agrupado.set(consumo.produto_id, atual);
  }

  const faltas = [];
  for (const grupo of agrupado.values()) {
    const saldo = await MotorEstoque.consultarSaldoLocal(db, grupo.produto_id, LOCAL_CONSUMO);
    const disponivel = round3(saldo.saldoFiscal + saldo.saldoNaoFiscal);
    grupo.disponivel = disponivel;
    if (disponivel + 0.000001 < grupo.quantidade_base) {
      faltas.push({
        produto_id: grupo.produto_id,
        produto: grupo.nome,
        necessario: grupo.quantidade_base,
        disponivel,
        faltante: round3(grupo.quantidade_base - disponivel),
        unidade: grupo.unidade_base
      });
    }
    grupo.saldo = saldo;
  }
  if (faltas.length && !(opcoes && opcoes.previa)) {
    throw erro(mensagemEstoqueFabrica(faltas), 'ESTOQUE_INSUFICIENTE', 409, faltas);
  }

  return { local, produzidos, grupos: [...agrupado.values()], faltas };
}

function resumir(execucao) {
  const snapshot = typeof execucao.snapshot_json === 'string'
    ? JSON.parse(execucao.snapshot_json)
    : execucao.snapshot;
  return {
    id: Number(execucao.id),
    ordem_id: Number(execucao.ordem_id),
    correlation_id: execucao.correlation_id,
    local: execucao.local || 'FABRICA',
    unidade_negocio_id: execucao.unidade_negocio_id == null ? null : Number(execucao.unidade_negocio_id),
    usuario_id: execucao.usuario_id == null ? null : Number(execucao.usuario_id),
    usuario_nome: execucao.usuario_nome || '',
    quantidade_planejada: execucao.quantidade_planejada == null ? null : Number(execucao.quantidade_planejada),
    quantidade_produzida: execucao.quantidade_produzida == null ? null : Number(execucao.quantidade_produzida),
    quantidade_perdida: execucao.quantidade_perdida == null ? null : Number(execucao.quantidade_perdida),
    quantidade_processada: execucao.quantidade_planejada == null ? null : Number(execucao.quantidade_planejada),
    unidade: execucao.unidade || '',
    motivo_perda: execucao.motivo_perda || '',
    observacao_perda: execucao.observacao_perda || '',
    rendimento_real: execucao.rendimento_real == null ? null : Number(execucao.rendimento_real),
    iniciada_em: execucao.iniciada_em || execucao.created_at,
    concluida_em: execucao.concluida_em || execucao.created_at,
    created_at: execucao.created_at,
    snapshot
  };
}

async function listarExecucoes(db, ordemId) {
  await bootstrapExecucoes(db);
  const rows = await all(db, `
    SELECT * FROM ordem_producao_execucoes WHERE ordem_id = ? ORDER BY id
  `, [Number(ordemId)]);
  return rows.map(resumir);
}

async function previaProducao(db, ordemId, entrada) {
  const ordem = await obterOrdem(db, ordemId);
  const plano = await montarPlano(db, ordem, entrada || {}, { previa: true });
  const porProduto = new Map(plano.grupos.map((grupo) => [grupo.produto_id, grupo]));
  return {
    ordem_id: ordem.id,
    codigo: ordem.codigo,
    status: ordem.status,
    local: plano.local.local,
    itens: plano.produzidos.map((item) => ({
      produto_id: item.produto_id,
      produto_nome: item.produto_nome,
      quantidade: item.quantidade_planejada,
      quantidade_planejada: item.quantidade_planejada,
      unidade: item.unidade,
      ficha_codigo: item.ficha.codigo,
      ficha_nome: item.ficha.nome,
      rendimento_ficha: item.ficha.rendimento_quantidade,
      rendimento_unidade: item.ficha.rendimento_unidade
    })),
    consumos: plano.produzidos.flatMap((item) => item.consumo.map((consumo) => {
      const grupo = porProduto.get(consumo.produto_id) || {};
      return {
        produto_id: consumo.produto_id,
        produto_nome: consumo.nome,
        quantidade: consumo.quantidade_base,
        unidade: consumo.unidade_base,
        disponivel_fabrica: grupo.disponivel == null ? 0 : grupo.disponivel,
        situacao: (grupo.disponivel || 0) + 0.000001 < Number(consumo.quantidade_base) ? 'Insuficiente' : 'OK'
      };
    })),
    insumos: plano.grupos.map((grupo) => ({
      produto_id: grupo.produto_id,
      produto_nome: grupo.nome,
      necessario: grupo.quantidade_base,
      disponivel_fabrica: grupo.disponivel == null ? 0 : grupo.disponivel,
      unidade: grupo.unidade_base,
      situacao: (grupo.disponivel || 0) + 0.000001 < grupo.quantidade_base ? 'Insuficiente' : 'OK'
    })),
    faltas: plano.faltas
  };
}

function dividirSaida(saldo, quantidadeBase) {
  const fiscal = Math.min(Number(saldo.saldoFiscal) || 0, quantidadeBase);
  return {
    quantidadeFiscal: round3(fiscal),
    quantidadeNaoFiscal: round3(quantidadeBase - fiscal)
  };
}

async function executarProducao(db, ordemId, entrada, contexto) {
  await bootstrapExecucoes(db);
  await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  const dados = entrada || {};
  const correlationId = texto(dados.correlation_id || dados.correlationId) || `OP-EXEC-${ordemId}-${Date.now()}`;
  if (correlationId.length > 80) throw erro('A chave de execução é longa demais.', 'CORRELATION_INVALIDA', 400);

  await run(db, 'BEGIN IMMEDIATE');
  try {
    const repetida = await get(db, `
      SELECT * FROM ordem_producao_execucoes WHERE correlation_id = ?
    `, [correlationId]);
    if (repetida) {
      await run(db, 'ROLLBACK');
      return { ordem: await obterOrdem(db, repetida.ordem_id), execucao: resumir(repetida), repetida: true };
    }

    const ordem = await obterOrdem(db, ordemId);
    const jaExecutou = await get(db, `
      SELECT id FROM ordem_producao_execucoes WHERE ordem_id = ? LIMIT 1
    `, [ordem.id]);
    if (jaExecutou || ordem.status === STATUS_ORDEM.CONCLUIDA) {
      throw erro(MENSAGEM_CONCLUIDA, 'OP_CONCLUIDA');
    }
    if (ordem.status === STATUS_ORDEM.PLANEJADA) throw erro(MENSAGEM_NAO_INICIADA, 'OP_NAO_INICIADA');
    const plano = await montarPlano(db, ordem, dados);
    const snapshot = {
      local: plano.local.local,
      unidade_negocio_id: plano.local.unidade_negocio_id,
      capturado_em: new Date().toISOString(),
      produzidos: plano.produzidos,
      consumos: plano.produzidos.flatMap((item) => item.consumo)
    };
    const resultado = plano.produzidos[0] || {};
    const inserida = await run(db, `
      INSERT INTO ordem_producao_execucoes (
        ordem_id, correlation_id, local, unidade_negocio_id, snapshot_json, usuario_id, usuario_nome,
        quantidade_planejada, quantidade_produzida, quantidade_perdida, unidade,
        motivo_perda, observacao_perda, rendimento_real, iniciada_em, concluida_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', 'localtime')), datetime('now', 'localtime'))
    `, [
      ordem.id,
      correlationId,
      plano.local.local,
      plano.local.unidade_negocio_id,
      JSON.stringify(snapshot),
      contexto && contexto.usuario_id ? Number(contexto.usuario_id) : null,
      contexto ? texto(contexto.usuario_nome) || null : null,
      resultado.quantidade_planejada == null ? null : resultado.quantidade_planejada,
      resultado.quantidade_produzida == null ? null : resultado.quantidade_produzida,
      resultado.quantidade_perdida == null ? null : resultado.quantidade_perdida,
      resultado.unidade || null,
      resultado.motivo_perda || null,
      resultado.observacao_perda || null,
      resultado.rendimento_real == null ? null : resultado.rendimento_real,
      ordem.producao_iniciada_em || null
    ]);

    for (const grupo of plano.grupos) {
      const partes = dividirSaida(grupo.saldo, grupo.quantidade_base);
      await MotorEstoque.sair(db, {
        produtoId: grupo.produto_id,
        quantidadeBase: grupo.quantidade_base,
        quantidadeFiscal: partes.quantidadeFiscal,
        quantidadeNaoFiscal: partes.quantidadeNaoFiscal,
        origem: ORIGEM_PRODUCAO,
        local: LOCAL_CONSUMO,
        referenciaTipo: 'ordem_producao_execucao',
        referenciaId: inserida.id,
        usuarioId: contexto && contexto.usuario_id ? Number(contexto.usuario_id) : null,
        motivo: `PRODUCAO:${ordem.codigo}`
      });
    }
    if (contexto && typeof contexto.aposConsumo === 'function') await contexto.aposConsumo();

    for (const item of plano.produzidos) {
      if (!(item.quantidade_base > 0)) continue;
      await MotorEstoque.entrar(db, {
        produtoId: item.produto_id,
        quantidadeBase: item.quantidade_base,
        quantidadeFiscal: item.quantidade_base,
        quantidadeNaoFiscal: 0,
        origem: ORIGEM_PRODUCAO,
        local: LOCAL_CONSUMO,
        referenciaTipo: 'ordem_producao_execucao',
        referenciaId: inserida.id,
        usuarioId: contexto && contexto.usuario_id ? Number(contexto.usuario_id) : null,
        motivo: `PRODUCAO:${ordem.codigo}`
      });
    }

    const atualizada = await run(db, `
      UPDATE ordens_producao
      SET status = 'CONCLUIDA', updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'EM_PRODUCAO'
    `, [ordem.id]);
    if (atualizada.changes !== 1) throw erro(MENSAGEM_CONCLUIDA, 'OP_CONCLUIDA');
    await run(db, 'COMMIT');

    const execucao = (await listarExecucoes(db, ordem.id)).find((item) => item.id === inserida.id);
    const concluida = await obterOrdem(db, ordem.id);
    if (contexto && typeof contexto.auditar === 'function') {
      await contexto.auditar({
        acao: 'PRODUCAO_CONCLUIDA',
        referencia_id: ordem.id,
        detalhes: {
          codigo: ordem.codigo,
          execucao_id: inserida.id,
          produto_id: resultado.produto_id || null,
          produto: resultado.produto_nome || '',
          planejado: resultado.quantidade_planejada,
          processado: resultado.quantidade_processada,
          produzido: resultado.quantidade_produzida,
          perdido: resultado.quantidade_perdida,
          unidade: resultado.unidade || '',
          rendimento_real: resultado.rendimento_real,
          usuario_nome: contexto.usuario_nome || ''
        }
      });
    }
    return { ordem: concluida, execucao, repetida: false };
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* a transação já pode ter sido encerrada */ }
    throw err;
  }
}

async function iniciarProducao(db, ordemId, contexto) {
  const bootstrapOrdens = require('./migrations/005_ordens_producao');
  const bootstrapInicio = require('./migrations/009_ordem_producao_inicio');
  await bootstrapOrdens(db);
  await bootstrapInicio(db);
  const ordem = await obterOrdem(db, ordemId);
  if (ordem.status === STATUS_ORDEM.EM_PRODUCAO) throw erro(MENSAGEM_JA_INICIADA, 'OP_JA_INICIADA');
  if (ordem.status !== STATUS_ORDEM.PLANEJADA) throw erro(MENSAGEM_ESTADO, 'OP_NAO_PLANEJADA');
  if (!ordem.itens.length) throw erro('A ordem não possui itens para produção.', 'ITENS_OBRIGATORIOS');
  await montarPlano(db, ordem, {});
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const atualizada = await run(db, `
      UPDATE ordens_producao
      SET status = 'EM_PRODUCAO',
          producao_iniciada_em = datetime('now', 'localtime'),
          producao_usuario_id = ?,
          producao_usuario_nome = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'PLANEJADA'
    `, [
      contexto && contexto.usuario_id ? Number(contexto.usuario_id) : null,
      contexto ? texto(contexto.usuario_nome) || null : null,
      ordem.id
    ]);
    if (atualizada.changes !== 1) throw erro(MENSAGEM_JA_INICIADA, 'OP_JA_INICIADA');
    await run(db, 'COMMIT');
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* a transação já pode ter sido encerrada */ }
    throw err;
  }
  const iniciada = await obterOrdem(db, ordem.id);
  if (contexto && typeof contexto.auditar === 'function') {
    await contexto.auditar({
      acao: 'PRODUCAO_INICIADA',
      referencia_id: iniciada.id,
      detalhes: { codigo: iniciada.codigo, status: iniciada.status, iniciada_em: iniciada.producao_iniciada_em }
    });
  }
  return iniciada;
}

module.exports = {
  ORIGEM_PRODUCAO,
  MENSAGEM_JA_INICIADA,
  MENSAGEM_NAO_INICIADA,
  MENSAGEM_CONCLUIDA,
  MENSAGEM_ESTOQUE,
  mensagemEstoqueFabrica,
  LOCAL_CONSUMO,
  MENSAGEM_PRODUTO,
  MENSAGEM_SEM_PRODUTO,
  MENSAGEM_NAO_INSUMO,
  MENSAGEM_RENDIMENTO,
  MENSAGEM_PARCIAL,
  MENSAGEM_RESULTADO,
  MENSAGEM_ACIMA,
  MENSAGEM_PRODUZIDA_NEGATIVA,
  MENSAGEM_PERDIDA_NEGATIVA,
  previaProducao,
  iniciarProducao,
  executarProducao,
  listarExecucoes
};
