/**
 * RCM-8.3 — Central Oficial de Precificação
 * Resumo, diagnóstico, cobertura, simulador, histórico e duplicação.
 */

const db = require('../../../database');
const tabelasPrecoRepository = require('./TabelasPrecoRepository');
const TabelaPrecoProdutoService = require('./TabelaPrecoProdutoService');
const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');

const OPERACOES_CANAL = {
  VAREJO: ['PDV Desktop', 'PDV Mobile'],
  ATACADO: ['Atacado'],
  CONSIGNADO: ['Consignação'],
  EVENTO: ['Evento'],
  DELIVERY: ['Delivery'],
  BALCAO: ['Balcão']
};

const TODAS_OPERACOES = [
  'PDV Desktop',
  'PDV Mobile',
  'Atacado',
  'Consignação',
  'Evento',
  'Delivery',
  'Balcão'
];

function erro(mensagem, statusCode = 400, extra = {}) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function operacoesDoCanal(codigo) {
  const c = String(codigo || '').toUpperCase();
  return OPERACOES_CANAL[c] || (c ? [`Canal ${c}`] : []);
}

class CentralPrecificacaoService {
  /**
   * Resumo inteligente do cabeçalho da tabela.
   */
  async resumo(tabelaId) {
    const tabela = await tabelasPrecoRepository.buscarPorId(tabelaId);
    if (!tabela) throw erro('Tabela de preço não encontrada', 404);

    const valores = await all(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN COALESCE(ativo,1)=1 THEN 1 ELSE 0 END) AS ativos,
              AVG(CASE WHEN COALESCE(ativo,1)=1 THEN preco END) AS preco_medio
       FROM tabela_preco_valores
       WHERE tabela_preco_id = ? AND linha_comercial_id IS NOT NULL`,
      [tabelaId]
    ).catch(() => [{ n: 0, ativos: 0, preco_medio: null }]);

    const itens = await all(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN COALESCE(ativo,1)=1 THEN 1 ELSE 0 END) AS ativos,
              AVG(CASE WHEN COALESCE(ativo,1)=1 THEN preco END) AS preco_medio
       FROM tabela_preco_produto_itens
       WHERE tabela_preco_id = ?`,
      [tabelaId]
    ).catch(() => [{ n: 0, ativos: 0, preco_medio: null }]);

    const qLinhas = Number(valores[0]?.n || 0);
    const qProdutos = Number(itens[0]?.n || 0);
    const total = qLinhas + qProdutos;
    const somaMedias = [];
    if (valores[0]?.preco_medio != null) somaMedias.push(Number(valores[0].preco_medio));
    if (itens[0]?.preco_medio != null) somaMedias.push(Number(itens[0].preco_medio));
    const precoMedio = somaMedias.length
      ? somaMedias.reduce((a, b) => a + b, 0) / somaMedias.length
      : null;

    const usadas = operacoesDoCanal(tabela.canal_codigo);
    const naoUsadas = TODAS_OPERACOES.filter((op) => !usadas.includes(op));

    return {
      id: tabela.id,
      codigo: tabela.codigo,
      nome: tabela.nome,
      descricao: tabela.descricao || '',
      ativo: !!tabela.ativo,
      canal_codigo: tabela.canal_codigo,
      canal_nome: tabela.canal_nome,
      operacoes_utilizam: usadas,
      operacoes_nao_utilizam: naoUsadas,
      quantidade_linhas: qLinhas,
      quantidade_produtos: qProdutos,
      quantidade_total: total,
      preco_medio: precoMedio != null ? Math.round(precoMedio * 100) / 100 : null,
      ultima_alteracao: tabela.updated_at || tabela.created_at || null
    };
  }

  async produtosDaLinha(linhaId) {
    const linha = await get(
      `SELECT id, codigo, descricao FROM linhas_comerciais WHERE id = ?`,
      [linhaId]
    );
    if (!linha) throw erro('Linha de Precificação não encontrada', 404);

    const produtos = await all(
      `SELECT p.id, p.codigo, p.nome, p.ativo,
              c.nome AS categoria_nome
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.linha_comercial_id = ?
       ORDER BY p.nome COLLATE NOCASE
       LIMIT 500`,
      [linhaId]
    );

    return {
      linha: {
        id: linha.id,
        codigo: linha.codigo,
        descricao: linha.descricao
      },
      produtos,
      total: produtos.length,
      mensagem: 'Todos estes produtos utilizarão este preço.'
    };
  }

  async painelProduto(produtoId) {
    const p = await get(
      `SELECT p.id, p.codigo, p.nome, p.linha_comercial_id, p.preco_venda,
              p.forma_comercializacao, p.participa_atacado, p.categoria_id, p.unidade,
              c.nome AS categoria_nome,
              lc.codigo AS linha_codigo, lc.descricao AS linha_descricao
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN linhas_comerciais lc ON lc.id = p.linha_comercial_id
       WHERE p.id = ?`,
      [produtoId]
    );
    if (!p) throw erro('Produto não encontrado', 404);

    const OPERACOES_UI = [
      { canal: 'VAREJO', label: 'Varejo' },
      { canal: 'ATACADO', label: 'Atacado' },
      { canal: 'CONSIGNADO', label: 'Consignação' },
      { canal: 'DELIVERY', label: 'Delivery' },
      { canal: 'EVENTO', label: 'Evento' }
    ];

    let canaisComPreco = [];
    if (p.linha_comercial_id) {
      canaisComPreco = await all(
        `SELECT DISTINCT UPPER(c.codigo) AS canal
         FROM tabela_preco_valores v
         INNER JOIN tabelas_preco t ON t.id = v.tabela_preco_id
         LEFT JOIN canais_venda c ON c.id = t.canal_venda_id
         WHERE v.linha_comercial_id = ? AND COALESCE(v.ativo,1)=1 AND COALESCE(t.ativo,1)=1`,
        [p.linha_comercial_id]
      );
    } else {
      canaisComPreco = await all(
        `SELECT DISTINCT UPPER(c.codigo) AS canal
         FROM tabela_preco_produto_itens i
         INNER JOIN tabelas_preco t ON t.id = i.tabela_preco_id
         LEFT JOIN canais_venda c ON c.id = t.canal_venda_id
         WHERE i.produto_id = ? AND COALESCE(i.ativo,1)=1 AND COALESCE(t.ativo,1)=1`,
        [produtoId]
      );
    }
    const setCanais = new Set(canaisComPreco.map((r) => String(r.canal || '').toUpperCase()));
    const operacoes = OPERACOES_UI.map((op) => ({
      canal: op.canal,
      label: op.label,
      com_preco: setCanais.has(op.canal)
    }));
    const comPreco = operacoes.filter((o) => o.com_preco).length;
    const usandoFallback = comPreco === 0;

    let indicador = 'propria'; // azul
    if (p.linha_comercial_id && comPreco === OPERACOES_UI.length) indicador = 'completa'; // verde
    else if (p.linha_comercial_id && comPreco > 0) indicador = 'parcial'; // amarelo/verde parcial
    else if (usandoFallback) indicador = p.linha_comercial_id ? 'fallback' : 'sem_preco';
    if (!p.linha_comercial_id && comPreco > 0) indicador = 'propria';
    if (!p.linha_comercial_id && comPreco === 0) indicador = 'sem_preco';
    if (p.linha_comercial_id && comPreco === 0) indicador = 'fallback';

    return {
      produto: {
        id: p.id,
        codigo: p.codigo,
        nome: p.nome,
        categoria_id: p.categoria_id,
        categoria: p.categoria_nome || null,
        unidade: p.unidade || null,
        forma_comercializacao: p.forma_comercializacao || 'UNIDADE',
        participa_atacado: Number(p.participa_atacado ?? 1) !== 0 ? 1 : 0,
        linha: p.linha_comercial_id
          ? { id: p.linha_comercial_id, codigo: p.linha_codigo, descricao: p.linha_descricao }
          : null,
        preco_seguranca: p.preco_venda != null ? Number(p.preco_venda) : null
      },
      operacoes,
      indicador,
      usando_fallback: usandoFallback,
      preco_oficial: 'Central de Precificação',
      fallback: 'Preço de Segurança',
      mensagem: p.linha_comercial_id
        ? 'Atenção: este produto possui Linha — o Resolver prioriza a Linha.'
        : 'Este preço afetará apenas este produto.'
    };
  }

  async pesquisarLinhas(q = '', limit = 40) {
    const termo = String(q || '').trim();
    if (!termo) return [];
    const like = `%${termo}%`;
    return all(
      `SELECT lc.id, lc.codigo, lc.descricao, lc.ativo,
              c.nome AS grupo, c.nome AS categoria_nome
       FROM linhas_comerciais lc
       LEFT JOIN categorias c ON c.id = lc.categoria_origem_id
       WHERE COALESCE(lc.ativo,1)=1
         AND (
           lc.codigo LIKE ? OR lc.descricao LIKE ?
           OR IFNULL(c.nome,'') LIKE ? OR IFNULL(c.codigo,'') LIKE ?
         )
       ORDER BY lc.descricao COLLATE NOCASE
       LIMIT ?`,
      [like, like, like, like, Math.min(Number(limit) || 40, 100)]
    );
  }

  async pesquisarProdutos(q = '', limit = 40) {
    const termo = String(q || '').trim();
    if (!termo) return [];
    const like = `%${termo}%`;
    return all(
      `SELECT p.id, p.codigo, p.nome, p.codigo_barras, p.linha_comercial_id, p.ativo,
              c.nome AS categoria_nome,
              lc.codigo AS linha_codigo, lc.descricao AS linha_descricao
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN linhas_comerciais lc ON lc.id = p.linha_comercial_id
       WHERE COALESCE(p.ativo,1)=1
         AND (
           p.codigo LIKE ? OR p.nome LIKE ?
           OR IFNULL(p.codigo_barras,'') LIKE ?
           OR IFNULL(c.nome,'') LIKE ?
           OR IFNULL(lc.codigo,'') LIKE ? OR IFNULL(lc.descricao,'') LIKE ?
         )
       ORDER BY
         CASE WHEN p.linha_comercial_id IS NULL THEN 0 ELSE 1 END,
         p.nome COLLATE NOCASE
       LIMIT ?`,
      [like, like, like, like, like, like, Math.min(Number(limit) || 40, 100)]
    );
  }

  async diagnosticarLinha(linhaId) {
    const painel = await this.produtosDaLinha(linhaId);
    const tabelas = await all(
      `SELECT DISTINCT t.id, t.codigo, t.nome, t.ativo, c.codigo AS canal_codigo,
              MAX(COALESCE(t.updated_at, t.created_at, v.created_at)) AS ultima_alteracao
       FROM tabela_preco_valores v
       INNER JOIN tabelas_preco t ON t.id = v.tabela_preco_id
       LEFT JOIN canais_venda c ON c.id = t.canal_venda_id
       WHERE v.linha_comercial_id = ? AND COALESCE(v.ativo,1)=1
       GROUP BY t.id, t.codigo, t.nome, t.ativo, c.codigo
       ORDER BY t.nome COLLATE NOCASE`,
      [linhaId]
    );

    const OPERACOES_UI = [
      { canal: 'VAREJO', label: 'Varejo' },
      { canal: 'ATACADO', label: 'Atacado' },
      { canal: 'CONSIGNADO', label: 'Consignação' },
      { canal: 'DELIVERY', label: 'Delivery' },
      { canal: 'EVENTO', label: 'Evento' }
    ];
    const canaisPresentes = new Set(tabelas.map((t) => String(t.canal_codigo || '').toUpperCase()));
    const operacoes = OPERACOES_UI.map((op) => ({
      canal: op.canal,
      label: op.label,
      com_preco: canaisPresentes.has(op.canal)
    }));

    const presentes = tabelas.map((t) => t.nome || t.codigo);
    const ausentes = OPERACOES_UI
      .filter((op) => !canaisPresentes.has(op.canal))
      .map((op) => op.label);

    const inconsistencias = [];
    if (!painel.total) {
      inconsistencias.push({ tipo: 'LINHA_SEM_PRODUTOS', msg: 'Linha sem produtos vinculados' });
    }
    if (!tabelas.length) {
      inconsistencias.push({ tipo: 'LINHA_SEM_PRECO', msg: 'Linha sem preço em nenhuma tabela' });
    }

    const ultima = tabelas
      .map((t) => t.ultima_alteracao)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;

    const produtosSemPreco = Number(painel.total || 0) > 0 && !tabelas.length
      ? Number(painel.total || 0)
      : 0;

    // Dependências (RCM-8.7.1)
    const dependencias = {
      produtos: Number(painel.total || 0),
      tabelas: tabelas.length,
      operacoes: operacoes.filter((o) => o.com_preco).length,
      representantes: 0
    };

    let statusVisual = 'completa';
    if (!painel.total) statusVisual = 'sem_produtos';
    else if (!tabelas.length) statusVisual = 'sem_preco';
    else if (ausentes.length) statusVisual = 'parcial';

    return {
      linha: painel.linha,
      produtos_vinculados: painel.total,
      produtos: painel.produtos.slice(0, 50),
      presente_em: presentes,
      tabelas,
      tabelas_com_preco: tabelas.length,
      ausente_em: ausentes,
      operacoes,
      ultima_alteracao: ultima,
      usuario_ultima_alteracao: null,
      produtos_sem_preco: produtosSemPreco,
      produtos_usando_fallback: produtosSemPreco,
      dependencias,
      status_visual: statusVisual,
      historico: {
        ultima_alteracao: ultima,
        usuario: null,
        quantidade_produtos: Number(painel.total || 0),
        quantidade_tabelas: tabelas.length
      },
      inconsistencias
    };
  }

  async verificarCobertura(tabelaId = null) {
    const filtroTabela = tabelaId ? Number(tabelaId) : null;

    const produtosSemLinha = await all(
      `SELECT COUNT(*) AS n FROM produtos WHERE COALESCE(ativo,1)=1 AND linha_comercial_id IS NULL`
    );
    const linhasSemProdutos = await all(
      `SELECT lc.id, lc.codigo, lc.descricao
       FROM linhas_comerciais lc
       WHERE COALESCE(lc.ativo,1)=1
         AND NOT EXISTS (
           SELECT 1 FROM produtos p WHERE p.linha_comercial_id = lc.id
         )
       LIMIT 100`
    );

    let produtosSemPreco = [];
    let linhasSemPreco = [];
    let duplicados = [];
    let refsInvalidas = [];
    let unidadesInexistentes = [];

    if (filtroTabela) {
      const tabela = await tabelasPrecoRepository.buscarPorId(filtroTabela);
      if (!tabela) throw erro('Tabela não encontrada', 404);

      linhasSemPreco = await all(
        `SELECT lc.id, lc.codigo, lc.descricao
         FROM linhas_comerciais lc
         WHERE COALESCE(lc.ativo,1)=1
           AND EXISTS (SELECT 1 FROM produtos p WHERE p.linha_comercial_id = lc.id AND COALESCE(p.ativo,1)=1)
           AND NOT EXISTS (
             SELECT 1 FROM tabela_preco_valores v
             WHERE v.tabela_preco_id = ? AND v.linha_comercial_id = lc.id AND COALESCE(v.ativo,1)=1
           )
         LIMIT 200`,
        [filtroTabela]
      );

      produtosSemPreco = await all(
        `SELECT p.id, p.codigo, p.nome
         FROM produtos p
         WHERE COALESCE(p.ativo,1)=1
           AND p.linha_comercial_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM tabela_preco_produto_itens i
             WHERE i.tabela_preco_id = ? AND i.produto_id = p.id AND COALESCE(i.ativo,1)=1
           )
         LIMIT 200`,
        [filtroTabela]
      );

      duplicados = await all(
        `SELECT linha_comercial_id AS ref_id, 'linha' AS tipo, COUNT(*) AS n
         FROM tabela_preco_valores
         WHERE tabela_preco_id = ? AND linha_comercial_id IS NOT NULL
         GROUP BY linha_comercial_id HAVING COUNT(*) > 1
         UNION ALL
         SELECT produto_id, 'produto', COUNT(*)
         FROM tabela_preco_produto_itens
         WHERE tabela_preco_id = ?
         GROUP BY produto_id HAVING COUNT(*) > 1`,
        [filtroTabela, filtroTabela]
      );

      refsInvalidas = await all(
        `SELECT v.id, v.linha_comercial_id AS ref_id, 'linha' AS tipo
         FROM tabela_preco_valores v
         LEFT JOIN linhas_comerciais lc ON lc.id = v.linha_comercial_id
         WHERE v.tabela_preco_id = ? AND v.linha_comercial_id IS NOT NULL AND lc.id IS NULL
         UNION ALL
         SELECT i.id, i.produto_id, 'produto'
         FROM tabela_preco_produto_itens i
         LEFT JOIN produtos p ON p.id = i.produto_id
         WHERE i.tabela_preco_id = ? AND p.id IS NULL`,
        [filtroTabela, filtroTabela]
      );

      unidadesInexistentes = await all(
        `SELECT DISTINCT unidade_comercial AS unidade, 'linha' AS origem
         FROM tabela_preco_valores
         WHERE tabela_preco_id = ?
           AND unidade_comercial IS NOT NULL AND TRIM(unidade_comercial) != ''
           AND UPPER(unidade_comercial) NOT IN ('UN','KG','G','LT','L','ML','CX','FD','PC','MT','M2','M3','LITRO','KILO')
         UNION
         SELECT DISTINCT unidade_comercial, 'produto'
         FROM tabela_preco_produto_itens
         WHERE tabela_preco_id = ?
           AND unidade_comercial IS NOT NULL AND TRIM(unidade_comercial) != ''
           AND UPPER(unidade_comercial) NOT IN ('UN','KG','G','LT','L','ML','CX','FD','PC','MT','M2','M3','LITRO','KILO')`,
        [filtroTabela, filtroTabela]
      );
    } else {
      // RCM-8.7 — diagnóstico geral do domínio
      linhasSemPreco = await all(
        `SELECT lc.id, lc.codigo, lc.descricao
         FROM linhas_comerciais lc
         WHERE COALESCE(lc.ativo,1)=1
           AND NOT EXISTS (
             SELECT 1 FROM tabela_preco_valores v
             WHERE v.linha_comercial_id = lc.id AND COALESCE(v.ativo,1)=1
           )
         LIMIT 200`
      );

      produtosSemPreco = await all(
        `SELECT p.id, p.codigo, p.nome
         FROM produtos p
         WHERE COALESCE(p.ativo,1)=1
           AND p.linha_comercial_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM tabela_preco_produto_itens i
             WHERE i.produto_id = p.id AND COALESCE(i.ativo,1)=1
           )
         LIMIT 200`
      );
    }

    const produtosUsandoSeguranca = await all(
      `SELECT COUNT(*) AS n FROM (
         SELECT p.id
         FROM produtos p
         WHERE COALESCE(p.ativo,1)=1
           AND (
             (p.linha_comercial_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM tabela_preco_valores v
               WHERE v.linha_comercial_id = p.linha_comercial_id AND COALESCE(v.ativo,1)=1
             ))
             OR
             (p.linha_comercial_id IS NULL AND NOT EXISTS (
               SELECT 1 FROM tabela_preco_produto_itens i
               WHERE i.produto_id = p.id AND COALESCE(i.ativo,1)=1
             ))
           )
       )`
    ).catch(() => [{ n: 0 }]);

    const operacoesSemTabela = await all(
      `SELECT c.id, c.codigo, c.nome
       FROM canais_venda c
       WHERE COALESCE(c.ativo,1)=1
         AND UPPER(c.codigo) IN ('VAREJO','ATACADO','CONSIGNADO','DELIVERY','EVENTO')
         AND NOT EXISTS (
           SELECT 1 FROM tabelas_preco t
           WHERE t.canal_venda_id = c.id AND COALESCE(t.ativo,1)=1
         )
       ORDER BY c.nome COLLATE NOCASE`
    ).catch(() => []);

    return {
      tabela_id: filtroTabela,
      produtos_sem_linha: Number(produtosSemLinha[0]?.n || 0),
      linhas_sem_produtos: linhasSemProdutos,
      linhas_sem_preco: linhasSemPreco,
      produtos_sem_preco: produtosSemPreco,
      produtos_usando_preco_seguranca: Number(produtosUsandoSeguranca[0]?.n || 0),
      operacoes_sem_tabela: operacoesSemTabela,
      registros_duplicados: duplicados,
      referencias_invalidas: refsInvalidas,
      unidades_inexistentes: unidadesInexistentes,
      resumo: {
        ok: !linhasSemPreco.length
          && !produtosSemPreco.length
          && !duplicados.length
          && !refsInvalidas.length
          && !operacoesSemTabela.length,
        alertas:
          linhasSemPreco.length
          + produtosSemPreco.length
          + duplicados.length
          + refsInvalidas.length
          + unidadesInexistentes.length
          + linhasSemProdutos.length
          + operacoesSemTabela.length
          + Number(produtosSemLinha[0]?.n || 0)
      }
    };
  }

  /**
   * Simula precificação via Motor Oficial (sem PDV).
   */
  async simular({ produto_id, canal, tabela_preco_id, quantidade, cliente_id } = {}) {
    const produtoId = Number(produto_id);
    if (!Number.isFinite(produtoId) || produtoId <= 0) {
      throw erro('Informe o produto');
    }

    const produto = await get(
      `SELECT id, codigo, nome, preco_venda, linha_comercial_id, unidade
       FROM produtos WHERE id = ?`,
      [produtoId]
    );
    if (!produto) throw erro('Produto não encontrado', 404);

    let canalCodigo = String(canal || '').trim().toUpperCase() || null;
    let tabelaId = tabela_preco_id != null && tabela_preco_id !== ''
      ? Number(tabela_preco_id)
      : null;

    const clienteId = cliente_id != null && cliente_id !== '' ? Number(cliente_id) : null;
    if (clienteId && Number.isFinite(clienteId)) {
      try {
        const CanalVendaResolver = require('../preco/CanalVendaResolver');
        const canalInfo = await CanalVendaResolver.resolver({
          cliente_id: clienteId,
          canal_manual: canalCodigo || undefined
        });
        if (canalInfo?.canal) canalCodigo = String(canalInfo.canal).toUpperCase();
        if (!tabelaId && canalInfo?.tabela_preco_id) tabelaId = Number(canalInfo.tabela_preco_id);
      } catch (_e) { /* ignore — segue com canal informado */ }
    }

    if (tabelaId && !canalCodigo) {
      const t = await tabelasPrecoRepository.buscarPorId(tabelaId);
      canalCodigo = t?.canal_codigo || 'VAREJO';
    }
    if (!canalCodigo) canalCodigo = 'VAREJO';

    const resultado = await ComercialPrecoResolver.resolver({
      produto,
      canal: canalCodigo,
      tabela_preco_id: tabelaId || undefined,
      quantidade: quantidade != null ? Number(quantidade) : 1,
      cliente_id: clienteId || undefined
    });

    const tabelaInfo = resultado.tabela_preco_id
      ? await tabelasPrecoRepository.buscarPorId(resultado.tabela_preco_id)
      : null;

    let linhaInfo = null;
    if (produto.linha_comercial_id) {
      linhaInfo = await get(
        `SELECT id, codigo, descricao FROM linhas_comerciais WHERE id = ?`,
        [produto.linha_comercial_id]
      );
    }

    const origem = resultado.origem || '';
    const usouSeguranca = /preco_venda|seguranca|legado|seguran/i.test(origem)
      || (Number(resultado.preco) === Number(produto.preco_venda) && !/tabela/i.test(origem));

    let origemLabel = 'Motor Oficial';
    if (/linha/i.test(origem)) origemLabel = 'Linha de Precificação';
    else if (/produto|tabela_preco_produto/i.test(origem)) origemLabel = 'Produto (Central de Precificação)';
    else if (usouSeguranca) origemLabel = 'Preço de Segurança';

    return {
      produto: {
        id: produto.id,
        codigo: produto.codigo,
        nome: produto.nome
      },
      quantidade: quantidade != null ? Number(quantidade) : 1,
      cliente_id: clienteId || null,
      canal: canalCodigo,
      operacao: canalCodigo,
      tabela: tabelaInfo
        ? { id: tabelaInfo.id, codigo: tabelaInfo.codigo, nome: tabelaInfo.nome }
        : (resultado.tabela_preco_id ? { id: resultado.tabela_preco_id } : null),
      tabela_utilizada: tabelaInfo
        ? (tabelaInfo.nome || tabelaInfo.codigo)
        : (usouSeguranca ? '—' : null),
      linha: linhaInfo,
      unidade_comercial: resultado.unidade_comercial || produto.unidade || 'UN',
      preco: resultado.preco != null ? Number(resultado.preco) : null,
      preco_encontrado: resultado.preco != null ? Number(resultado.preco) : null,
      origem: resultado.origem,
      origem_label: origemLabel,
      preco_seguranca: produto.preco_venda != null ? Number(produto.preco_venda) : null,
      usou_preco_seguranca: !!usouSeguranca && !/tabela_preco/i.test(origem),
      fallback: !!usouSeguranca && !/tabela_preco/i.test(origem),
      motor: 'Motor Oficial de Precificação',
      resolver: 'Motor Oficial'
    };
  }

  async listarHistorico(tabelaId, limit = 100) {
    return all(
      `SELECT * FROM tabela_preco_historico
       WHERE tabela_preco_id = ?
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
      [tabelaId, Math.min(Number(limit) || 100, 500)]
    ).catch(() => []);
  }

  async registrarHistorico(itens = []) {
    if (!Array.isArray(itens) || !itens.length) return 0;
    let n = 0;
    for (const h of itens) {
      await run(
        `INSERT INTO tabela_preco_historico (
          tabela_preco_id, referencia_tipo, referencia_id, referencia_label,
          preco_anterior, preco_novo, unidade_anterior, unidade_nova, usuario
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          h.tabela_preco_id,
          h.referencia_tipo,
          h.referencia_id,
          h.referencia_label || null,
          h.preco_anterior != null ? Number(h.preco_anterior) : null,
          h.preco_novo != null ? Number(h.preco_novo) : null,
          h.unidade_anterior || null,
          h.unidade_nova || null,
          h.usuario || null
        ]
      );
      n += 1;
    }
    return n;
  }

  /**
   * Diff de preços para histórico (antes × depois do save).
   */
  async capturarSnapshotPrecos(tabelaId) {
    const linhas = await all(
      `SELECT linha_comercial_id AS ref_id, preco, unidade_comercial AS unidade,
              'linha' AS tipo
       FROM tabela_preco_valores
       WHERE tabela_preco_id = ? AND linha_comercial_id IS NOT NULL`,
      [tabelaId]
    ).catch(() => []);
    const produtos = await all(
      `SELECT produto_id AS ref_id, preco, unidade_comercial AS unidade,
              'produto' AS tipo
       FROM tabela_preco_produto_itens
       WHERE tabela_preco_id = ?`,
      [tabelaId]
    ).catch(() => []);
    const map = new Map();
    [...linhas, ...produtos].forEach((r) => {
      map.set(`${r.tipo}:${r.ref_id}`, r);
    });
    return map;
  }

  async gravarDiffHistorico(tabelaId, antesMap, usuario, labels = {}) {
    const depois = await this.capturarSnapshotPrecos(tabelaId);
    const hist = [];
    const keys = new Set([...antesMap.keys(), ...depois.keys()]);
    for (const key of keys) {
      const a = antesMap.get(key);
      const d = depois.get(key);
      const [tipo, idStr] = key.split(':');
      const refId = Number(idStr);
      const pa = a ? Number(a.preco) : null;
      const pn = d ? Number(d.preco) : null;
      const ua = a?.unidade || null;
      const un = d?.unidade || null;
      if (pa === pn && ua === un) continue;
      hist.push({
        tabela_preco_id: tabelaId,
        referencia_tipo: tipo,
        referencia_id: refId,
        referencia_label: labels[key] || null,
        preco_anterior: pa,
        preco_novo: pn,
        unidade_anterior: ua,
        unidade_nova: un,
        usuario: usuario || null
      });
    }
    return this.registrarHistorico(hist);
  }

  async duplicarTabela(tabelaId, { codigo, nome, descricao } = {}) {
    const origem = await tabelasPrecoRepository.buscarPorId(tabelaId);
    if (!origem) throw erro('Tabela de origem não encontrada', 404);

    const novoCodigo = String(codigo || `${origem.codigo}_COP`).trim().toUpperCase();
    const novoNome = String(nome || `${origem.nome} Cópia`).trim();

    const existenteCod = await tabelasPrecoRepository.buscarPorCodigo(novoCodigo);
    if (existenteCod) throw erro('Já existe tabela com este código');

    const valores = await tabelasPrecoRepository.montarGradeValores(tabelaId);
    const itens = await TabelaPrecoProdutoService.listarItens(tabelaId);

    const salva = await tabelasPrecoRepository.salvarCompleto({
      codigo: novoCodigo,
      nome: novoNome,
      descricao: descricao != null ? descricao : (origem.descricao || `Cópia de ${origem.nome}`),
      ativo: true,
      canal_venda_id: origem.canal_venda_id,
      atacado_habilitado: !!origem.atacado_habilitado,
      quantidade_minima: Number(origem.quantidade_minima || 0),
      tipo_contagem: origem.tipo_contagem || 'TOTAL_VENDA',
      permitir_produtos_diferentes: origem.permitir_produtos_diferentes !== false,
      permitir_categorias_diferentes: origem.permitir_categorias_diferentes !== false,
      linhas_ids: (valores || [])
        .filter((v) => v.linha_comercial_id)
        .map((v) => Number(v.linha_comercial_id)),
      valores: (valores || [])
        .filter((v) => v.linha_comercial_id && v.preco != null)
        .map((v) => ({
          linha_comercial_id: v.linha_comercial_id,
          canal_venda_id: origem.canal_venda_id,
          preco: v.preco,
          forma_comercializacao: v.forma_comercializacao,
          unidade_comercial: v.unidade_comercial
        }))
    });

    if (itens && itens.length) {
      await TabelaPrecoProdutoService.salvarItens(
        salva.id,
        itens.map((i) => ({
          produto_id: i.produto_id,
          canal_venda_id: origem.canal_venda_id,
          preco: i.preco,
          forma_comercializacao: i.forma_comercializacao,
          unidade_comercial: i.unidade_comercial
        }))
      );
    }

    return this.resumo(salva.id).then(async (r) => ({
      ...salva,
      resumo: r
    }));
  }
}

module.exports = new CentralPrecificacaoService();
