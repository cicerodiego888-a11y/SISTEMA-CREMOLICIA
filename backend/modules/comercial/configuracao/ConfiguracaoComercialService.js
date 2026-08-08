/**
 * ConfiguracaoComercialService (RCM-04.5 / RCM-05.3)
 */

const configuracaoComercialRepository = require('./ConfiguracaoComercialRepository');
const CanalVendaResolver = require('../preco/CanalVendaResolver');
const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
const db = require('../../../database');

const TIPOS_VALIDOS = new Set([
  'TOTAL_VENDA',
  'POR_LINHA',
  'POR_PRODUTO',
  'POR_CATEGORIA'
]);

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function erro(msg, statusCode = 400) {
  const e = new Error(msg);
  e.statusCode = statusCode;
  return e;
}

class ConfiguracaoComercialService {
  async obter() {
    const cfg = await configuracaoComercialRepository.obter();
    if (!cfg) throw erro('Configuração comercial não encontrada', 404);
    return cfg;
  }

  async salvar(body = {}) {
    const tipo = String(body.tipo_contagem || 'TOTAL_VENDA').toUpperCase();
    if (!TIPOS_VALIDOS.has(tipo)) {
      throw erro('tipo_contagem inválido. Use TOTAL_VENDA, POR_LINHA, POR_PRODUTO ou POR_CATEGORIA');
    }

    const qmin = Number(body.quantidade_minima);
    if (!Number.isFinite(qmin) || qmin <= 0) {
      throw erro('quantidade_minima deve ser maior que zero');
    }

    let canalId = body.canal_atacado_id != null && body.canal_atacado_id !== ''
      ? Number(body.canal_atacado_id)
      : null;

    if (canalId) {
      const canal = await dbGet('SELECT id FROM canais_venda WHERE id = ?', [canalId]);
      if (!canal) throw erro('Canal de atacado inválido');
    } else {
      const atacado = await dbGet(
        `SELECT id FROM canais_venda WHERE UPPER(codigo) = 'ATACADO' LIMIT 1`
      );
      canalId = atacado?.id || null;
    }

    return configuracaoComercialRepository.salvar({
      atacado_habilitado: !!body.atacado_habilitado,
      quantidade_minima: qmin,
      tipo_contagem: tipo,
      permitir_produtos_diferentes: body.permitir_produtos_diferentes !== false && body.permitir_produtos_diferentes !== 0,
      permitir_categorias_diferentes: body.permitir_categorias_diferentes !== false && body.permitir_categorias_diferentes !== 0,
      canal_atacado_id: canalId
    });
  }

  async resolverCanal(body = {}) {
    const canalManual = body.canal || body.canal_manual || null;
    return CanalVendaResolver.resolver({
      itens: body.itens || [],
      canal_manual: canalManual || null,
      cliente_id: body.cliente_id ?? body.clienteId ?? null,
      tipo_comercial_id: body.tipo_comercial_id ?? body.tipoComercialId ?? null,
      tipo_comercial_codigo: body.tipo_comercial_codigo ?? body.tipoComercialCodigo ?? null
    });
  }

  /**
   * Resolve canal da venda + preços de cada item (compartilhado PDV/Comercial/Pedidos).
   * body.canal força canal manual (ex.: EVENTO / CONSIGNADO).
   * body.cliente_id — RCM-7.1: canal via Tipo Comercial do cliente.
   * body.tabela_preco_id — contexto da venda (RA-2); produto não escolhe tabela.
   */
  async resolverPrecosVenda(body = {}) {
    const canalManual = body.canal
      ? String(body.canal).trim().toUpperCase()
      : null;

    const canalInfo = await CanalVendaResolver.resolver({
      itens: body.itens || [],
      canal_manual: canalManual || null,
      cliente_id: body.cliente_id ?? body.clienteId ?? null,
      tipo_comercial_id: body.tipo_comercial_id ?? body.tipoComercialId ?? null,
      tipo_comercial_codigo: body.tipo_comercial_codigo ?? body.tipoComercialCodigo ?? null
    });

    const canal = canalInfo.canal;
    const tabelaContexto = body.tabela_preco_id != null && body.tabela_preco_id !== ''
      ? Number(body.tabela_preco_id)
      : (canalInfo.tabela_preco_id != null ? Number(canalInfo.tabela_preco_id) : null);
    const itensEntrada = await CanalVendaResolver.enriquecerParticipaAtacado(body.itens || []);

    const saida = [];
    for (const item of itensEntrada) {
      const produto = await dbGet(
        `SELECT id, nome, preco_venda, tabela_preco_id, linha_comercial_id, categoria_id,
                forma_comercializacao, unidade_venda, unidade,
                produto_fracionado, vendido_por_peso,
                COALESCE(participa_atacado, 1) AS participa_atacado
         FROM produtos WHERE id = ?`,
        [item.produto_id]
      );
      if (!produto) {
        saida.push({
          produto_id: item.produto_id,
          quantidade: item.quantidade,
          erro: 'Produto não encontrado'
        });
        continue;
      }

      const tabelaOpts = Number.isFinite(tabelaContexto) && tabelaContexto > 0
        ? { tabela_preco_id: tabelaContexto }
        : {};

      const preco = await ComercialPrecoResolver.resolver({
        produto,
        canal,
        ...tabelaOpts
      });

      // Referência VAREJO: sempre pela tabela do canal VAREJO (não reutilizar tabela do canal atual)
      let precoVarejo = Number(preco.preco_venda);
      if (String(canal).toUpperCase() !== 'VAREJO') {
        const precoRef = await ComercialPrecoResolver.resolver({
          produto,
          canal: 'VAREJO'
        });
        precoVarejo = Number(precoRef.preco_venda);
      }

      const precoCanal = Number(preco.preco_venda);
      const qtd = Number(item.quantidade || 0);
      const descontoUnitario = String(canal).toUpperCase() === 'ATACADO'
        && Number.isFinite(precoVarejo)
        && Number.isFinite(precoCanal)
        && precoVarejo > precoCanal
        ? Number((precoVarejo - precoCanal).toFixed(4))
        : 0;
      const descontoAtacado = descontoUnitario > 0 && qtd > 0
        ? Number((descontoUnitario * qtd).toFixed(2))
        : 0;

      saida.push({
        produto_id: produto.id,
        nome: produto.nome,
        quantidade: item.quantidade,
        preco_venda: preco.preco_venda,
        preco_varejo: precoVarejo,
        desconto_unitario_atacado: descontoUnitario,
        desconto_atacado: descontoAtacado,
        preco_origem: preco.origem,
        preco_fallback: preco.fallback,
        canal: preco.canal,
        tabela_preco_id: preco.tabela_preco_id,
        tabela_preco_nome: preco.tabela_preco_nome || null,
        linha_comercial_id: preco.linha_comercial_id,
        linhaComercial: preco.linhaComercial,
        formaComercializacao: preco.formaComercializacao,
        forma_comercializacao: preco.forma_comercializacao,
        unidadeComercial: preco.unidadeComercial,
        unidade_comercial: preco.unidade_comercial,
        unidade_rotulo: preco.unidade_rotulo,
        forma_herdada: preco.forma_herdada,
        participa_atacado: CanalVendaResolver.flagParticipaAtacado(produto.participa_atacado),
        resolver: 'Motor Oficial'
      });

      // RCM-8.5 — log estruturado Comercial (mesmo motor do PDV)
      try {
        console.log('[RCM-8.5][COMERCIAL][Resolver]', JSON.stringify({
          operacao: canal,
          tabela: preco.tabela_preco_nome || preco.tabela_preco_id || null,
          produto: produto.id,
          linha: preco.linha_comercial_id || null,
          preco: preco.preco_venda,
          origem: preco.origem,
          tempo_ms: null,
          documento: body.documento || body.documento_tipo || null
        }));
      } catch (_) { /* ignore */ }
    }

    return {
      ...canalInfo,
      canal,
      canal_manual: !!canalInfo.canal_manual,
      itens: saida,
      motor: 'ComercialPrecoResolver',
      sprint: 'RCM-8.5'
    };
  }

  /**
   * RCM-8.5 — Comparar Tabelas (informativo; não altera a operação).
   * Resolve o mesmo produto em cada canal/tabela ativa.
   */
  async compararTabelas(body = {}) {
    const produtoId = Number(body.produto_id || body.produtoId);
    if (!Number.isFinite(produtoId) || produtoId <= 0) {
      throw erro('Informe produto_id');
    }

    const produto = await dbGet(
      `SELECT id, nome, preco_venda, tabela_preco_id, linha_comercial_id, categoria_id,
              forma_comercializacao, unidade_venda, unidade,
              COALESCE(participa_atacado, 1) AS participa_atacado
       FROM produtos WHERE id = ?`,
      [produtoId]
    );
    if (!produto) throw erro('Produto não encontrado', 404);

    const canaisPedido = Array.isArray(body.canais) && body.canais.length
      ? body.canais.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
      : null;

    const tabelas = await new Promise((resolve, reject) => {
      db.all(
        `SELECT t.id, t.codigo, t.nome, t.ativo, c.codigo AS canal_codigo, c.nome AS canal_nome
         FROM tabelas_preco t
         LEFT JOIN canais_venda c ON c.id = t.canal_venda_id
         WHERE COALESCE(t.ativo, 1) = 1
         ORDER BY c.codigo COLLATE NOCASE, t.nome COLLATE NOCASE`,
        [],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    }).catch(() => []);

    const comparacoes = [];
    const vistosCanal = new Set();

    for (const t of tabelas) {
      const canal = String(t.canal_codigo || 'VAREJO').toUpperCase();
      if (canaisPedido && !canaisPedido.includes(canal)) continue;
      if (vistosCanal.has(canal) && !body.todas_tabelas) continue;
      vistosCanal.add(canal);

      const t0 = Date.now();
      const preco = await ComercialPrecoResolver.resolver({
        produto,
        canal,
        tabela_preco_id: t.id
      });
      comparacoes.push({
        canal,
        canal_nome: t.canal_nome || canal,
        tabela_id: t.id,
        tabela_codigo: t.codigo,
        tabela_nome: t.nome,
        preco: preco.preco_venda != null ? Number(preco.preco_venda) : null,
        unidade_comercial: preco.unidade_comercial || produto.unidade || 'UN',
        origem: preco.origem,
        linha_comercial_id: preco.linha_comercial_id || null,
        tempo_ms: Date.now() - t0
      });
    }

    // Canais sem tabela dedicada ainda assim resolve via canal
    const canaisFallback = canaisPedido || ['VAREJO', 'ATACADO', 'CONSIGNADO', 'EVENTO', 'DELIVERY'];
    for (const canal of canaisFallback) {
      if (vistosCanal.has(canal)) continue;
      const t0 = Date.now();
      const preco = await ComercialPrecoResolver.resolver({ produto, canal });
      comparacoes.push({
        canal,
        canal_nome: canal,
        tabela_id: preco.tabela_preco_id || null,
        tabela_codigo: null,
        tabela_nome: preco.tabela_preco_nome || null,
        preco: preco.preco_venda != null ? Number(preco.preco_venda) : null,
        unidade_comercial: preco.unidade_comercial || produto.unidade || 'UN',
        origem: preco.origem,
        linha_comercial_id: preco.linha_comercial_id || null,
        tempo_ms: Date.now() - t0
      });
    }

    return {
      produto: { id: produto.id, nome: produto.nome, codigo: produto.codigo || null },
      comparacoes,
      informativo: true,
      mensagem: 'Comparação informativa — não altera a tabela da operação.',
      motor: 'ComercialPrecoResolver',
      sprint: 'RCM-8.5'
    };
  }
}

module.exports = new ConfiguracaoComercialService();
