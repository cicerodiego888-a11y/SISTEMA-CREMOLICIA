/**
 * CanalVendaResolver — Determina o canal da venda (RCM-04.5 / RCM-05.3 / RCM-9.0.1)
 *
 * Automático:
 * - VAREJO (início / quantidade insuficiente)
 * - ATACADO (atingiu quantidade mínima de itens elegíveis)
 *
 * Manual (opts.canal_manual / body.canal no service):
 * - EVENTO e qualquer canal ativo futuro
 *
 * Contagem Atacado (RCM-9.0.1):
 * - Elegíveis: participa_atacado = 1
 * - UNIDADE / CASQUINHA / KIT / PERSONALIZADA → soma quantidade da linha
 * - PESO / VOLUME → conta 1 por linha do carrinho
 * - Estoque / MUC / preço: inalterados (eixos separados)
 *
 * RCM-04.7 — metadados de UX (progresso) anexados sem alterar regras.
 */

const configuracaoComercialRepository = require('../configuracao/ConfiguracaoComercialRepository');
const {
  FORMAS,
  inferirFormaComercializacao,
  normalizarForma
} = require('./FormaComercializacao');
const db = require('../../../database');

const CANAL_VAREJO = 'VAREJO';
const CANAL_ATACADO = 'ATACADO';
const CANAL_EVENTO = 'EVENTO';
const TIPOS = Object.freeze({
  TOTAL_VENDA: 'TOTAL_VENDA',
  POR_LINHA: 'POR_LINHA',
  POR_PRODUTO: 'POR_PRODUTO',
  POR_CATEGORIA: 'POR_CATEGORIA'
});

/** Formas contínuas: cada linha do carrinho contribui com 1 item comercial. */
const FORMAS_CONTAGEM_POR_LINHA = new Set([FORMAS.PESO, FORMAS.VOLUME]);

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

function flagParticipaAtacado(valor) {
  if (valor === false || valor === 0 || valor === '0') return false;
  if (valor === true || valor === 1 || valor === '1') return true;
  return true; // default compat: elegível
}

/**
 * Contribuição da linha para a contagem de Atacado (itens comerciais).
 * Não altera quantidade usada em estoque/preço.
 */
function contribuicaoContagemAtacado(item = {}) {
  const forma = normalizarForma(
    item.forma_comercializacao
    || inferirFormaComercializacao(item)
    || FORMAS.UNIDADE
  );
  if (FORMAS_CONTAGEM_POR_LINHA.has(forma)) {
    return 1;
  }
  const q = Number(item.quantidade || 0);
  return Number.isFinite(q) && q > 0 ? q : 0;
}

function normalizarItens(itens = []) {
  return (itens || [])
    .map((item) => {
      const quantidade = Number(item.quantidade ?? 0);
      const formaInformada = item.forma_comercializacao != null && item.forma_comercializacao !== ''
        ? normalizarForma(item.forma_comercializacao)
        : null;
      return {
        produto_id: Number(item.produto_id ?? item.id ?? 0),
        quantidade,
        categoria_id: item.categoria_id != null && item.categoria_id !== ''
          ? Number(item.categoria_id)
          : null,
        linha_comercial_id: item.linha_comercial_id != null && item.linha_comercial_id !== ''
          ? Number(item.linha_comercial_id)
          : null,
        participa_atacado: item.participa_atacado != null
          ? flagParticipaAtacado(item.participa_atacado)
          : null,
        forma_comercializacao: formaInformada,
        unidade: item.unidade != null ? item.unidade : null,
        produto_fracionado: item.produto_fracionado,
        vendido_por_peso: item.vendido_por_peso
      };
    })
    .filter((i) => i.produto_id > 0 && Number.isFinite(i.quantidade) && i.quantidade > 0);
}

/**
 * Completa participa_atacado / linha / categoria / forma a partir do cadastro.
 */
async function enriquecerParticipaAtacado(itens = []) {
  const normalizados = normalizarItens(itens);
  if (!normalizados.length) return [];

  const ids = [...new Set(normalizados.map((i) => i.produto_id))];
  const placeholders = ids.map(() => '?').join(',');
  let mapa = new Map();
  try {
    const rows = await dbAll(
      `SELECT id,
              COALESCE(participa_atacado, 1) AS participa_atacado,
              categoria_id,
              linha_comercial_id,
              forma_comercializacao,
              unidade,
              COALESCE(produto_fracionado, 0) AS produto_fracionado,
              COALESCE(vendido_por_peso, 0) AS vendido_por_peso
       FROM produtos WHERE id IN (${placeholders})`,
      ids
    );
    mapa = new Map(rows.map((r) => [Number(r.id), r]));
  } catch (_) {
    try {
      const rows = await dbAll(
        `SELECT id,
                COALESCE(participa_atacado, 1) AS participa_atacado,
                categoria_id,
                linha_comercial_id
         FROM produtos WHERE id IN (${placeholders})`,
        ids
      );
      mapa = new Map(rows.map((r) => [Number(r.id), r]));
    } catch (__) {
      /* noop */
    }
  }

  return normalizados.map((i) => {
    const row = mapa.get(i.produto_id);
    const produtoCtx = {
      forma_comercializacao: i.forma_comercializacao != null
        ? i.forma_comercializacao
        : (row?.forma_comercializacao || null),
      unidade: i.unidade != null ? i.unidade : (row?.unidade || null),
      produto_fracionado: i.produto_fracionado != null
        ? i.produto_fracionado
        : (row?.produto_fracionado ?? 0),
      vendido_por_peso: i.vendido_por_peso != null
        ? i.vendido_por_peso
        : (row?.vendido_por_peso ?? 0)
    };
    const forma = i.forma_comercializacao
      || inferirFormaComercializacao(produtoCtx)
      || FORMAS.UNIDADE;

    return {
      ...i,
      participa_atacado: i.participa_atacado != null
        ? flagParticipaAtacado(i.participa_atacado)
        : (row ? flagParticipaAtacado(row.participa_atacado) : true),
      categoria_id: i.categoria_id != null
        ? i.categoria_id
        : (row?.categoria_id != null ? Number(row.categoria_id) : null),
      linha_comercial_id: i.linha_comercial_id != null
        ? i.linha_comercial_id
        : (row?.linha_comercial_id != null ? Number(row.linha_comercial_id) : null),
      forma_comercializacao: normalizarForma(forma),
      unidade: produtoCtx.unidade,
      produto_fracionado: produtoCtx.produto_fracionado,
      vendido_por_peso: produtoCtx.vendido_por_peso
    };
  });
}

/**
 * RA-6: regras de atacado preferem a Tabela Atacado; fallback config comercial.
 */
async function obterRegrasAtacado(config) {
  try {
    const tabelasPrecoRepository = require('../tabelas-preco/TabelasPrecoRepository');
    const tabelaAtacado = await tabelasPrecoRepository.buscarAtivaPorCanal('ATACADO');
    if (tabelaAtacado && tabelaAtacado.atacado_habilitado) {
      return {
        atacado_habilitado: true,
        quantidade_minima: Number(tabelaAtacado.quantidade_minima || 0),
        tipo_contagem: String(tabelaAtacado.tipo_contagem || TIPOS.TOTAL_VENDA).toUpperCase(),
        permitir_produtos_diferentes: !!tabelaAtacado.permitir_produtos_diferentes,
        permitir_categorias_diferentes: !!tabelaAtacado.permitir_categorias_diferentes,
        canal_atacado_id: tabelaAtacado.canal_venda_id || config?.canal_atacado_id || null,
        fonte: 'tabela_preco',
        tabela_preco_id: tabelaAtacado.id
      };
    }
  } catch (_) { /* ignore */ }

  return {
    atacado_habilitado: !!(config && config.atacado_habilitado),
    quantidade_minima: Number(config?.quantidade_minima || 0),
    tipo_contagem: String(config?.tipo_contagem || TIPOS.TOTAL_VENDA).toUpperCase(),
    permitir_produtos_diferentes: config?.permitir_produtos_diferentes !== false,
    permitir_categorias_diferentes: config?.permitir_categorias_diferentes !== false,
    canal_atacado_id: config?.canal_atacado_id || null,
    fonte: 'configuracao_comercial',
    tabela_preco_id: null
  };
}

function avaliarContagem(elegiveis, min, tipo) {
  let atende = false;
  let quantidadeAvaliada = 0;

  if (tipo === TIPOS.POR_PRODUTO) {
    const porProduto = new Map();
    for (const item of elegiveis) {
      porProduto.set(
        item.produto_id,
        (porProduto.get(item.produto_id) || 0) + contribuicaoContagemAtacado(item)
      );
    }
    const quantidades = [...porProduto.values()];
    quantidadeAvaliada = quantidades.length ? Math.min(...quantidades) : 0;
    atende = quantidades.length > 0 && quantidades.every((q) => q >= min);
  } else if (tipo === TIPOS.POR_LINHA) {
    const porLinha = new Map();
    for (const item of elegiveis) {
      const key = item.linha_comercial_id != null ? Number(item.linha_comercial_id) : `p:${item.produto_id}`;
      porLinha.set(key, (porLinha.get(key) || 0) + contribuicaoContagemAtacado(item));
    }
    const quantidades = [...porLinha.values()];
    quantidadeAvaliada = quantidades.length ? Math.min(...quantidades) : 0;
    atende = quantidades.length > 0 && quantidades.every((q) => q >= min);
  } else if (tipo === TIPOS.POR_CATEGORIA) {
    const porCat = new Map();
    for (const item of elegiveis) {
      const key = item.categoria_id != null ? Number(item.categoria_id) : `p:${item.produto_id}`;
      porCat.set(key, (porCat.get(key) || 0) + contribuicaoContagemAtacado(item));
    }
    const quantidades = [...porCat.values()];
    quantidadeAvaliada = quantidades.length ? Math.min(...quantidades) : 0;
    atende = quantidades.length > 0 && quantidades.every((q) => q >= min);
  } else {
    // TOTAL_VENDA — itens comerciais (RCM-9.0.1)
    quantidadeAvaliada = somar(elegiveis);
    atende = quantidadeAvaliada >= min;
  }

  return { atende, quantidadeAvaliada };
}

function filtrarElegiveisAtacado(itens = []) {
  return (itens || []).filter((i) => flagParticipaAtacado(i.participa_atacado));
}

/** Soma contribuições comerciais (não a quantidade física bruta). */
function somar(itens) {
  return (itens || []).reduce((acc, i) => acc + contribuicaoContagemAtacado(i), 0);
}

/**
 * Metadados de UX (RCM-04.7) — não alteram o canal resolvido.
 */
function anexarProgressoUx(resultado, config) {
  const habilitado = !!(config && config.atacado_habilitado);
  const min = Number(config?.quantidade_minima || 0);
  const atual = Number(resultado.quantidade_avaliada || 0);
  const canal = String(resultado.canal || CANAL_VAREJO).toUpperCase();
  const progressoBase = min > 0 ? Math.min(100, Math.round((atual / min) * 100)) : 0;
  const manual = !!resultado.canal_manual;

  return {
    ...resultado,
    nome: resultado.nome || canal,
    quantidadeAtual: atual,
    quantidadeNecessaria: min,
    progresso: resultado.atacado ? 100 : progressoBase,
    mostrar_progresso: habilitado && !manual && canal === CANAL_VAREJO,
    atacado_habilitado: habilitado,
    canal_manual: manual
  };
}

async function resolverNomeCanal(codigo, canalId) {
  if (canalId) {
    const row = await dbGet('SELECT nome, codigo FROM canais_venda WHERE id = ?', [canalId]);
    if (row) return String(row.nome || row.codigo || codigo);
  }
  const row = await dbGet(
    `SELECT nome, codigo FROM canais_venda WHERE UPPER(codigo) = ? LIMIT 1`,
    [String(codigo || '').toUpperCase()]
  );
  return row ? String(row.nome || row.codigo || codigo) : String(codigo || CANAL_VAREJO);
}

/**
 * Força um canal manual (EVENTO ou qualquer canal ativo).
 */
async function resolverCanalManual(codigo, config = null) {
  const cfg = config || (await configuracaoComercialRepository.obter());
  const canalCodigo = String(codigo || '').trim().toUpperCase();
  if (!canalCodigo) {
    throw Object.assign(new Error('Canal manual inválido'), { statusCode: 400 });
  }

  const canal = await dbGet(
    `SELECT id, codigo, nome, ativo FROM canais_venda WHERE UPPER(codigo) = ? LIMIT 1`,
    [canalCodigo]
  );
  if (!canal || Number(canal.ativo) === 0) {
    throw Object.assign(new Error(`Canal ${canalCodigo} não encontrado ou inativo`), { statusCode: 400 });
  }

  return anexarProgressoUx({
    canal: String(canal.codigo).toUpperCase(),
    canal_venda_id: canal.id,
    nome: canal.nome || canal.codigo,
    atacado: String(canal.codigo).toUpperCase() === CANAL_ATACADO,
    motivo: 'canal_manual',
    quantidade_avaliada: 0,
    tipo_contagem: cfg?.tipo_contagem || TIPOS.TOTAL_VENDA,
    canal_manual: true,
    config: cfg
  }, cfg);
}

/**
 * @param {Object} opts
 * @param {Array} [opts.itens]
 * @param {Object} [opts.config]
 * @param {string} [opts.canal_manual] — força canal (ex.: EVENTO / CONSIGNADO) — PRIORIDADE 1
 * @param {number|string} [opts.cliente_id] — RCM-7.1/7.2: canal via Tipo Comercial — PRIORIDADE 2
 * @param {number|string} [opts.tipo_comercial_id]
 * @param {string} [opts.tipo_comercial_codigo]
 *
 * Ordem oficial (RCM-7.2.1):
 *   1) canal_manual
 *   2) Tipo Comercial (cliente / tipo)
 *   3) Fallback automático (VAREJO / regras de atacado)
 */
async function resolver(opts = {}) {
  const config = opts.config || (await configuracaoComercialRepository.obter());
  const regras = await obterRegrasAtacado(config);

  // 1) canal_manual — prioridade absoluta (ex.: Nova Consignação → CONSIGNADO)
  if (opts.canal_manual) {
    const manual = await resolverCanalManual(opts.canal_manual, config);
    const itens = await enriquecerParticipaAtacado(opts.itens || []);
    const elegiveis = filtrarElegiveisAtacado(itens);
    manual.quantidade_avaliada = somar(elegiveis);
    manual.quantidadeAtual = manual.quantidade_avaliada;
    return anexarProgressoUx(manual, { ...config, ...regras });
  }

  // RCM-7.1 — Cliente → Tipo Comercial → Canal (antes das regras de quantidade)
  if (opts.cliente_id || opts.tipo_comercial_id || opts.tipo_comercial_codigo) {
    try {
      const tiposService = require('../tipos-comerciais/TiposComerciaisService');
      const fromTipo = await tiposService.resolverCanalOperacao({
        cliente_id: opts.cliente_id,
        tipo_comercial_id: opts.tipo_comercial_id,
        tipo_comercial_codigo: opts.tipo_comercial_codigo
      });
      const itens = await enriquecerParticipaAtacado(opts.itens || []);
      const elegiveis = filtrarElegiveisAtacado(itens);
      return anexarProgressoUx({
        canal: fromTipo.canal,
        canal_venda_id: fromTipo.canal_venda_id,
        nome: fromTipo.nome,
        atacado: String(fromTipo.canal).toUpperCase() === CANAL_ATACADO,
        motivo: fromTipo.motivo || 'tipo_comercial',
        quantidade_avaliada: somar(elegiveis),
        tipo_contagem: regras.tipo_contagem || TIPOS.TOTAL_VENDA,
        canal_manual: false,
        config,
        tabela_preco_id: fromTipo.tabela_preco_id,
        tipo_comercial_id: fromTipo.tipo_comercial_id,
        tipo_comercial_codigo: fromTipo.tipo_comercial_codigo,
        tipo_comercial_descricao: fromTipo.tipo_comercial_descricao,
        canal_padrao: fromTipo.canal_padrao,
        canais_permitidos: fromTipo.canais_permitidos,
        canais_permitidos_codigos: fromTipo.canais_permitidos_codigos
      }, { ...config, ...regras });
    } catch (err) {
      // Sem tipo/canal: segue fluxo legado (compat)
      if (err.statusCode && err.statusCode !== 404) throw err;
    }
  }

  const itens = await enriquecerParticipaAtacado(opts.itens);
  const elegiveis = filtrarElegiveisAtacado(itens);

  const base = {
    canal: CANAL_VAREJO,
    canal_venda_id: null,
    atacado: false,
    motivo: 'padrao_varejo',
    quantidade_avaliada: 0,
    tipo_contagem: regras.tipo_contagem || TIPOS.TOTAL_VENDA,
    canal_manual: false,
    config,
    regras_fonte: regras.fonte
  };

  let resultado;

  if (!regras.atacado_habilitado) {
    resultado = { ...base, motivo: 'atacado_desabilitado', quantidade_avaliada: somar(elegiveis) };
  } else if (!itens.length) {
    resultado = { ...base, motivo: 'carrinho_vazio' };
  } else if (!elegiveis.length) {
    resultado = { ...base, motivo: 'sem_itens_elegiveis_atacado', quantidade_avaliada: 0 };
  } else if (!regras.permitir_produtos_diferentes) {
    const ids = new Set(elegiveis.map((i) => i.produto_id));
    if (ids.size > 1) {
      resultado = {
        ...base,
        motivo: 'produtos_diferentes_bloqueados',
        quantidade_avaliada: somar(elegiveis)
      };
    }
  }

  if (!resultado && !regras.permitir_categorias_diferentes) {
    const cats = new Set(elegiveis.map((i) => i.categoria_id).filter((c) => c != null));
    if (cats.size > 1) {
      resultado = {
        ...base,
        motivo: 'categorias_diferentes_bloqueadas',
        quantidade_avaliada: somar(elegiveis)
      };
    }
  }

  if (!resultado) {
    const min = Number(regras.quantidade_minima || 0);
    const tipo = String(regras.tipo_contagem || TIPOS.TOTAL_VENDA).toUpperCase();
    const { atende, quantidadeAvaliada } = avaliarContagem(elegiveis, min, tipo);

    if (!atende) {
      resultado = {
        ...base,
        motivo: 'quantidade_insuficiente',
        quantidade_avaliada: quantidadeAvaliada,
        tipo_contagem: tipo
      };
    } else {
      let canalCodigo = CANAL_ATACADO;
      let canalId = regras.canal_atacado_id || null;
      let canalNome = null;

      if (canalId) {
        const canal = await dbGet(
          'SELECT id, codigo, nome FROM canais_venda WHERE id = ? AND ativo = 1',
          [canalId]
        );
        if (canal) {
          canalCodigo = String(canal.codigo || CANAL_ATACADO).toUpperCase();
          canalId = canal.id;
          canalNome = canal.nome || canalCodigo;
        }
      } else {
        const canal = await dbGet(
          `SELECT id, codigo, nome FROM canais_venda WHERE UPPER(codigo) = 'ATACADO' AND ativo = 1 LIMIT 1`
        );
        if (canal) {
          canalCodigo = String(canal.codigo).toUpperCase();
          canalId = canal.id;
          canalNome = canal.nome || canalCodigo;
        }
      }

      resultado = {
        canal: canalCodigo,
        canal_venda_id: canalId,
        nome: canalNome || canalCodigo,
        atacado: true,
        motivo: 'regra_atacado_atingida',
        quantidade_avaliada: quantidadeAvaliada,
        tipo_contagem: tipo,
        canal_manual: false,
        config,
        regras_fonte: regras.fonte,
        tabela_preco_id: regras.tabela_preco_id
      };
    }
  }

  if (!resultado.nome) {
    resultado.nome = await resolverNomeCanal(resultado.canal, resultado.canal_venda_id);
  }

  return anexarProgressoUx(resultado, { ...config, ...regras, atacado_habilitado: regras.atacado_habilitado });
}

module.exports = {
  CANAL_VAREJO,
  CANAL_ATACADO,
  CANAL_EVENTO,
  TIPOS,
  FORMAS_CONTAGEM_POR_LINHA,
  resolver,
  resolverCanalManual,
  normalizarItens,
  enriquecerParticipaAtacado,
  filtrarElegiveisAtacado,
  flagParticipaAtacado,
  contribuicaoContagemAtacado,
  anexarProgressoUx
};
