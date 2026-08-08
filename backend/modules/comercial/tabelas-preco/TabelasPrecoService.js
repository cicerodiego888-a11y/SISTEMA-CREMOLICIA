/**
 * TabelasPrecoService — RCM-8.0 / RA-6
 * Uma Tabela = Um Canal (operação).
 * Grade: referência Linha OU Produto (nunca ambos no mesmo registro) × Unidade × Preço.
 */

const tabelasPrecoRepository = require('./TabelasPrecoRepository');
const TabelaPrecoProdutoService = require('./TabelaPrecoProdutoService');
const db = require('../../../database');

function erro(mensagem, statusCode = 400, extra = {}) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function validarDadosGerais(dados, { parcial = false } = {}) {
  if (!parcial || dados.codigo !== undefined) {
    const codigo = String(dados.codigo || '').trim();
    if (!codigo) throw erro('Código é obrigatório');
  }
  if (!parcial || dados.nome !== undefined) {
    const nome = String(dados.nome || '').trim();
    if (!nome) throw erro('Nome é obrigatório');
  }
}

function normalizarEValidarValores(valores) {
  if (valores == null) return null;
  if (!Array.isArray(valores)) {
    throw erro('Informe a lista de valores [{ linha_comercial_id, canal_venda_id, preco }]');
  }

  const FORMAS = new Set(['UNIDADE', 'PESO', 'VOLUME', 'CASQUINHA', 'KIT', 'PERSONALIZADA']);
  const vistos = new Set();
  const normalizados = [];

  for (const item of valores) {
    const canalId = Number(item?.canal_venda_id);
    if (!Number.isFinite(canalId) || canalId <= 0) {
      throw erro('Canal de venda inválido na grade de valores');
    }

    const linhaId = item?.linha_comercial_id != null && item.linha_comercial_id !== ''
      ? Number(item.linha_comercial_id)
      : null;
    if (linhaId != null && (!Number.isFinite(linhaId) || linhaId <= 0)) {
      throw erro('Linha comercial inválida na grade de valores');
    }

    const chave = `${linhaId || 0}:${canalId}`;
    if (vistos.has(chave)) {
      throw erro('Não é permitido Linha × Canal duplicados na grade de valores');
    }
    vistos.add(chave);

    if (item.preco === '' || item.preco === null || item.preco === undefined) {
      continue;
    }

    const preco = Number(item.preco);
    if (!Number.isFinite(preco)) throw erro('Preço inválido');
    if (preco < 0) throw erro('Não é permitido preço negativo');

    let forma = item.forma_comercializacao != null && String(item.forma_comercializacao).trim() !== ''
      ? String(item.forma_comercializacao).trim().toUpperCase()
      : null;
    if (forma && !FORMAS.has(forma)) {
      throw erro(`Forma de comercialização inválida: ${forma}`);
    }

    let unidade = item.unidade_comercial != null && String(item.unidade_comercial).trim() !== ''
      ? String(item.unidade_comercial).trim().toUpperCase()
      : null;

    // RA-6.6 — Unidade Comercial é o SSOT da grade; Forma omitida é derivada da Unidade
    if (!forma && unidade) {
      if (['KG', 'G', 'KILO', 'KILOS', 'GRAMA', 'GRAMAS'].includes(unidade)) forma = 'PESO';
      else if (['L', 'LT', 'LITRO', 'LITROS', 'ML'].includes(unidade)) forma = 'VOLUME';
      else forma = 'UNIDADE';
    }

    // Unidade NULL = herda Unidade Base do Produto no Resolver (não bloqueia PESO/VOLUME)

    normalizados.push({
      linha_comercial_id: linhaId,
      canal_venda_id: canalId,
      preco,
      forma_comercializacao: forma,
      unidade_comercial: unidade,
      ativo: item.ativo === false || item.ativo === 0 ? false : true
    });
  }

  return normalizados;
}

function extrairValoresDoBody(body) {
  if (Array.isArray(body?.valores)) return body.valores;
  if (Array.isArray(body)) return body;
  return null;
}

function extrairLinhasIds(body) {
  if (Array.isArray(body?.linhas_ids)) return body.linhas_ids.map(Number).filter((n) => n > 0);
  if (Array.isArray(body?.linhasIds)) return body.linhasIds.map(Number).filter((n) => n > 0);
  if (Array.isArray(body?.linhas)) {
    return body.linhas.map((l) => Number(l?.id ?? l)).filter((n) => n > 0);
  }
  return null;
}

function extrairItensProduto(body) {
  if (Array.isArray(body?.itens)) return body.itens;
  if (Array.isArray(body?.itens_produto)) return body.itens_produto;
  if (Array.isArray(body?.produtos_itens)) return body.produtos_itens;
  return null;
}

const TIPOS_CONTAGEM = new Set([
  'TOTAL_VENDA',
  'POR_LINHA',
  'POR_PRODUTO',
  'POR_CATEGORIA'
]);

function extrairCanalId(dados) {
  const raw = dados?.canal_venda_id ?? dados?.canalId ?? dados?.canal_id ?? null;
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extrairRegras(dados = {}, existente = null) {
  return {
    atacado_habilitado: dados.atacado_habilitado !== undefined
      ? !!dados.atacado_habilitado
      : !!(existente && existente.atacado_habilitado),
    quantidade_minima: dados.quantidade_minima !== undefined
      ? Number(dados.quantidade_minima || 0)
      : Number(existente?.quantidade_minima || 0),
    tipo_contagem: (() => {
      const t = String(
        dados.tipo_contagem !== undefined
          ? dados.tipo_contagem
          : (existente?.tipo_contagem || 'TOTAL_VENDA')
      ).toUpperCase();
      return TIPOS_CONTAGEM.has(t) ? t : 'TOTAL_VENDA';
    })(),
    permitir_produtos_diferentes: dados.permitir_produtos_diferentes !== undefined
      ? !!dados.permitir_produtos_diferentes
      : (existente ? !!existente.permitir_produtos_diferentes : true),
    permitir_categorias_diferentes: dados.permitir_categorias_diferentes !== undefined
      ? !!dados.permitir_categorias_diferentes
      : (existente ? !!existente.permitir_categorias_diferentes : true)
  };
}

function normalizarValoresMonoCanal(valores, canalId) {
  if (valores == null) return null;
  // Permite body sem canal_venda_id (UI mono-canal) — injeta o canal da tabela
  const comCanal = (Array.isArray(valores) ? valores : []).map((v) => ({
    ...v,
    canal_venda_id: v.canal_venda_id || canalId
  }));
  const base = normalizarEValidarValores(comCanal);
  if (base == null) return null;
  if (!canalId) throw erro('Canal da tabela é obrigatório para gravar preços');
  const vistos = new Set();
  return base.map((v) => {
    const linhaId = v.linha_comercial_id || 0;
    if (vistos.has(linhaId)) {
      throw erro('Cada Linha de Precificação deve aparecer apenas uma vez na tabela');
    }
    vistos.add(linhaId);
    return { ...v, canal_venda_id: Number(canalId) };
  });
}

class TabelasPrecoService {
  async listar(filtros = {}) {
    const apenasAtivos = filtros.ativos === '1' || filtros.ativos === true;
    const busca = filtros.q || filtros.busca || filtros.search || null;
    const canal = filtros.canal_venda_id || filtros.canal || null;
    return tabelasPrecoRepository.listar({
      apenasAtivos,
      busca,
      canal_venda_id: canal
    });
  }

  async buscarPorId(id) {
    const tabela = await tabelasPrecoRepository.buscarPorId(id);
    if (!tabela) return null;
    const linhas = await tabelasPrecoRepository.listarLinhasDaTabela(id);
    const valores = await tabelasPrecoRepository.montarGradeValores(id);
    const itens = await TabelaPrecoProdutoService.listarItens(id);
    return { ...tabela, linhas, valores, itens };
  }

  async gradeNova() {
    return { valores: [], linhas: [] };
  }

  async gradePorLinhas(linhaIds = [], tabelaId = null, canalVendaId = null) {
    const ids = (linhaIds || []).map(Number).filter((n) => n > 0);
    if (!ids.length) return { valores: [] };
    let canalId = canalVendaId != null ? Number(canalVendaId) : null;
    if ((!canalId || canalId <= 0) && tabelaId) {
      const t = await tabelasPrecoRepository.buscarPorId(tabelaId);
      canalId = t?.canal_venda_id || null;
    }
    const valores = await tabelasPrecoRepository.montarGradePorLinhas(ids, tabelaId, canalId);
    return { valores };
  }

  async _garantirNomeUnico(nome, excludeId = null) {
    const duplicado = await tabelasPrecoRepository.buscarPorNome(nome, excludeId);
    if (duplicado) throw erro('Já existe uma tabela de preço com este nome');
  }

  async _garantirCodigoUnico(codigo, excludeId = null) {
    const existente = await tabelasPrecoRepository.buscarPorCodigo(codigo);
    if (existente && Number(existente.id) !== Number(excludeId || 0)) {
      throw erro('Já existe uma tabela de preço com este código');
    }
  }

  async _validarCanal(canalId) {
    if (!canalId) throw erro('Canal é obrigatório');
    const row = await dbGet(
      'SELECT id, codigo, ativo FROM canais_venda WHERE id = ?',
      [canalId]
    );
    if (!row || Number(row.ativo) === 0) {
      throw erro('Canal de venda inválido ou inativo');
    }
    return row;
  }

  async criar(dados) {
    validarDadosGerais(dados);
    await this._garantirNomeUnico(dados.nome);
    await this._garantirCodigoUnico(dados.codigo);

    const canalId = extrairCanalId(dados);
    await this._validarCanal(canalId);
    const regras = extrairRegras(dados);

    const itensBrutos = extrairItensProduto(dados);
    const itens = itensBrutos != null
      ? TabelaPrecoProdutoService.normalizarItens(itensBrutos)
      : null;
    const linhasIds = extrairLinhasIds(dados);
    const temLinhas = Array.isArray(linhasIds) && linhasIds.length > 0;
    const temItens = Array.isArray(itens) && itens.length > 0;

    let valores = undefined;
    if (Object.prototype.hasOwnProperty.call(dados, 'valores') || temLinhas) {
      valores = normalizarValoresMonoCanal(
        extrairValoresDoBody(dados) ?? dados.valores ?? [],
        canalId
      ) || [];
      if (temLinhas && !valores.length) {
        throw erro('Informe o preço de cada Linha na tabela');
      }
    }

    try {
      const salva = await tabelasPrecoRepository.salvarCompleto({
        codigo: dados.codigo,
        nome: dados.nome,
        descricao: dados.descricao,
        ativo: dados.ativo !== undefined ? !!dados.ativo : true,
        canal_venda_id: canalId,
        ...regras,
        linhas_ids: temLinhas ? linhasIds : (temItens ? [] : (Array.isArray(linhasIds) ? linhasIds : undefined)),
        valores
      });

      if (itens != null) {
        const itensSalvos = await TabelaPrecoProdutoService.salvarItens(salva.id, itens);
        return { ...salva, itens: itensSalvos };
      }

      const itensAtuais = await TabelaPrecoProdutoService.listarItens(salva.id);
      return { ...salva, itens: itensAtuais };
    } catch (error) {
      if (error.message && /UNIQUE/i.test(error.message)) {
        throw erro('Já existe uma tabela de preço com este código ou nome');
      }
      throw error;
    }
  }

  async atualizar(id, dados) {
    const existente = await tabelasPrecoRepository.buscarPorId(id);
    if (!existente) throw erro('Tabela de preço não encontrada', 404);

    validarDadosGerais(dados, { parcial: true });

    const codigo = dados.codigo !== undefined ? dados.codigo : existente.codigo;
    const nome = dados.nome !== undefined ? dados.nome : existente.nome;

    await this._garantirNomeUnico(nome, id);
    await this._garantirCodigoUnico(codigo, id);

    const canalId = (dados.canal_venda_id !== undefined || dados.canalId !== undefined)
      ? extrairCanalId(dados)
      : existente.canal_venda_id;
    if (canalId) await this._validarCanal(canalId);
    const regras = extrairRegras(dados, existente);

    const itensBrutos = extrairItensProduto(dados);
    const temItensBody = itensBrutos != null;
    const itens = temItensBody
      ? TabelaPrecoProdutoService.normalizarItens(itensBrutos)
      : null;

    const linhasIds = extrairLinhasIds(dados);
    const temValores = Object.prototype.hasOwnProperty.call(dados, 'valores')
      || Array.isArray(extrairValoresDoBody(dados));
    const valores = temValores
      ? (normalizarValoresMonoCanal(
        extrairValoresDoBody(dados) ?? dados.valores,
        canalId || existente.canal_venda_id
      ) || [])
      : null;

    if (linhasIds && !linhasIds.length && !temItensBody && temValores) {
      throw erro('Adicione ao menos uma Linha de Precificação ou um Produto');
    }
    if (linhasIds && linhasIds.length && valores !== null && !valores.length) {
      throw erro('Informe o preço de cada Linha na tabela');
    }

    try {
      let salva = null;
      const touchRegras = dados.atacado_habilitado !== undefined
        || dados.tipo_contagem !== undefined
        || dados.quantidade_minima !== undefined
        || dados.permitir_produtos_diferentes !== undefined
        || dados.permitir_categorias_diferentes !== undefined
        || dados.canal_venda_id !== undefined;

      if (valores !== null || linhasIds || touchRegras) {
        salva = await tabelasPrecoRepository.salvarCompleto({
          id,
          codigo,
          nome,
          descricao: dados.descricao !== undefined ? dados.descricao : existente.descricao,
          ativo: dados.ativo !== undefined ? !!dados.ativo : existente.ativo,
          canal_venda_id: canalId,
          ...regras,
          linhas_ids: linhasIds,
          valores: valores !== null ? valores : undefined
        });
      } else {
        const tabela = await tabelasPrecoRepository.atualizar(id, {
          codigo,
          nome,
          descricao: dados.descricao,
          ativo: dados.ativo,
          canal_venda_id: canalId,
          ...regras
        });
        const linhas = await tabelasPrecoRepository.listarLinhasDaTabela(id);
        const grade = await tabelasPrecoRepository.montarGradeValores(id);
        salva = { ...tabela, linhas, valores: grade };
      }

      if (temItensBody) {
        const itensSalvos = await TabelaPrecoProdutoService.salvarItens(id, itens || []);
        return { ...salva, itens: itensSalvos };
      }

      const itensAtuais = await TabelaPrecoProdutoService.listarItens(id);
      return { ...salva, itens: itensAtuais };
    } catch (error) {
      if (error.message && /UNIQUE/i.test(error.message)) {
        throw erro('Já existe uma tabela de preço com este código ou nome');
      }
      throw error;
    }
  }

  async excluir(id) {
    const existente = await tabelasPrecoRepository.buscarPorId(id);
    if (!existente) throw erro('Tabela de preço não encontrada', 404);
    return tabelasPrecoRepository.excluir(id);
  }

  async desativar(id) {
    const existente = await tabelasPrecoRepository.buscarPorId(id);
    if (!existente) throw erro('Tabela de preço não encontrada', 404);
    const tabela = await tabelasPrecoRepository.desativar(id);
    const linhas = await tabelasPrecoRepository.listarLinhasDaTabela(id);
    const valores = await tabelasPrecoRepository.montarGradeValores(id);
    return { ...tabela, linhas, valores };
  }

  async listarValores(tabelaId) {
    const tabela = await tabelasPrecoRepository.buscarPorId(tabelaId);
    if (!tabela) throw erro('Tabela de preço não encontrada', 404);
    return tabelasPrecoRepository.montarGradeValores(tabelaId);
  }

  async salvarValores(tabelaId, body) {
    const tabela = await tabelasPrecoRepository.buscarPorId(tabelaId);
    if (!tabela) throw erro('Tabela de preço não encontrada', 404);

    const canalId = tabela.canal_venda_id;
    const valores = normalizarValoresMonoCanal(extrairValoresDoBody(body), canalId);
    if (!valores) {
      throw erro('Informe a lista de valores [{ linha_comercial_id, preco }]');
    }

    return tabelasPrecoRepository.salvarValores(tabelaId, valores);
  }
}

module.exports = new TabelasPrecoService();
