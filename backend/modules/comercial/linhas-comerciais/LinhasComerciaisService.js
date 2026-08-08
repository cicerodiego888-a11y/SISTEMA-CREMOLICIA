/**
 * LinhasComerciaisService (RCM-05.5 / RA-2)
 * Nome de domínio: Linha de Precificação.
 * Persistência interna: linhas_comerciais.
 * RA-2: cadastro oficial = código + descrição + ativo (sem preços/canais).
 */

const repo = require('./LinhasComerciaisRepository');

function erro(mensagem, statusCode = 400, extra = {}) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

function validarDados(dados, { parcial = false } = {}) {
  if (!parcial || dados.codigo !== undefined) {
    if (!String(dados.codigo || '').trim()) throw erro('Código é obrigatório');
  }
  if (!parcial || dados.descricao !== undefined) {
    if (!String(dados.descricao || dados.nome || '').trim()) {
      throw erro('Descrição é obrigatória');
    }
  }
}

function normalizarValores(valores) {
  if (valores == null) return null;
  if (!Array.isArray(valores)) throw erro('Informe a lista de valores');
  const FORMAS = new Set(['UNIDADE', 'PESO', 'VOLUME', 'CASQUINHA', 'KIT', 'PERSONALIZADA']);
  const vistos = new Set();
  const out = [];
  for (const item of valores) {
    const canalId = Number(item?.canal_venda_id);
    if (!Number.isFinite(canalId) || canalId <= 0) throw erro('Canal inválido');
    if (vistos.has(canalId)) throw erro('Canais duplicados na grade');
    vistos.add(canalId);
    if (item.preco === '' || item.preco == null) continue;
    const preco = Number(item.preco);
    if (!Number.isFinite(preco) || preco < 0) throw erro('Preço inválido');
    let forma = item.forma_comercializacao
      ? String(item.forma_comercializacao).trim().toUpperCase()
      : null;
    if (forma && !FORMAS.has(forma)) throw erro(`Forma inválida: ${forma}`);
    let unidade = item.unidade_comercial
      ? String(item.unidade_comercial).trim().toUpperCase()
      : null;
    if ((forma === 'PESO' || forma === 'VOLUME') && !unidade) {
      throw erro(`Unidade obrigatória para ${forma}`);
    }
    out.push({
      canal_venda_id: canalId,
      preco,
      forma_comercializacao: forma,
      unidade_comercial: unidade
    });
  }
  return out;
}

class LinhasComerciaisService {
  async listar(filtros = {}) {
    return repo.listar({
      apenasAtivos: filtros.ativos === '1' || filtros.ativos === true,
      busca: filtros.q || filtros.busca || null
    });
  }

  async buscarPorId(id) {
    const linha = await repo.buscarPorId(id);
    if (!linha) return null;
    const valores = await repo.montarGradeValores(id);
    return { ...linha, valores };
  }

  async gradeNova() {
    return { valores: await repo.montarGradeValores(null) };
  }

  async criar(dados) {
    validarDados(dados);
    const codigo = String(dados.codigo).trim().toUpperCase();
    const descricao = String(dados.descricao || dados.nome).trim();
    if (await repo.buscarPorCodigo(codigo)) {
      throw erro('Já existe uma Linha de Precificação com este código');
    }
    const ativo = dados.ativo !== undefined ? !!dados.ativo : true;

    // Compat: se cliente legado enviar valores, ainda persiste (não é fluxo oficial RA-2)
    if (Object.prototype.hasOwnProperty.call(dados, 'valores')) {
      return repo.salvarCompleto({
        codigo,
        descricao,
        ativo,
        valores: normalizarValores(dados.valores) || []
      });
    }

    const criada = await repo.criar({ codigo, descricao, ativo });
    return { ...criada, valores: [] };
  }

  async atualizar(id, dados) {
    const existente = await repo.buscarPorId(id);
    if (!existente) throw erro('Linha de Precificação não encontrada', 404);
    validarDados(dados, { parcial: true });
    const codigo = dados.codigo !== undefined
      ? String(dados.codigo).trim().toUpperCase()
      : existente.codigo;
    const descricao = dados.descricao !== undefined || dados.nome !== undefined
      ? String(dados.descricao || dados.nome).trim()
      : existente.descricao;
    const outro = await repo.buscarPorCodigo(codigo);
    if (outro && Number(outro.id) !== Number(id)) {
      throw erro('Já existe uma Linha de Precificação com este código');
    }
    // Compat legado apenas se valores vierem explicitamente
    if (Object.prototype.hasOwnProperty.call(dados, 'valores')) {
      return repo.salvarCompleto({
        id,
        codigo,
        descricao,
        ativo: dados.ativo !== undefined ? !!dados.ativo : existente.ativo,
        valores: normalizarValores(dados.valores) || []
      });
    }
    const linha = await repo.atualizar(id, {
      codigo,
      descricao,
      ativo: dados.ativo
    });
    return { ...linha, valores: await repo.montarGradeValores(id) };
  }

  async excluir(id) {
    const existente = await repo.buscarPorId(id);
    if (!existente) throw erro('Linha de Precificação não encontrada', 404);
    return repo.excluir(id);
  }

  async desativar(id) {
    const existente = await repo.buscarPorId(id);
    if (!existente) throw erro('Linha de Precificação não encontrada', 404);
    const linha = await repo.desativar(id);
    return { ...linha, valores: await repo.montarGradeValores(id) };
  }

  async relatorioMigracao() {
    const row = await repo.ultimoRelatorioMigracao();
    if (!row) return { classificados: 0, nao_classificados: 0, itens: [] };
    let detalhes = {};
    try {
      detalhes = JSON.parse(row.detalhes_json || '{}');
    } catch (_) {
      detalhes = {};
    }
    return {
      gerado_em: row.gerado_em,
      classificados: Number(row.classificados || 0),
      nao_classificados: Number(row.nao_classificados || 0),
      itens: detalhes.nao_classificados || []
    };
  }
}

module.exports = new LinhasComerciaisService();
