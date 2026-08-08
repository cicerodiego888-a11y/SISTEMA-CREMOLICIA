/**
 * TiposComerciaisService — Regras de negócio (RCM-7.1 / RCM-7.2)
 *
 * Cliente → Tipo Comercial → Canal Padrão + Canais Permitidos
 *           → Tabela ativa do Canal → Resolver
 */

const tiposComerciaisRepository = require('./TiposComerciaisRepository');
const canaisVendaRepository = require('../canais/CanaisVendaRepository');

const CODIGOS_SISTEMA = new Set(['CONSUMIDOR_FINAL']);

function erro(msg, statusCode = 400) {
  const e = new Error(msg);
  e.statusCode = statusCode;
  return e;
}

function validarPayload(dados, { parcial = false } = {}) {
  if (!parcial || dados.codigo !== undefined) {
    if (!String(dados.codigo || '').trim()) throw erro('Código é obrigatório');
  }
  if (!parcial || dados.descricao !== undefined) {
    if (!String(dados.descricao || '').trim()) throw erro('Descrição é obrigatória');
  }
  if (!parcial || dados.canal_padrao !== undefined) {
    if (!String(dados.canal_padrao || '').trim()) throw erro('Canal Padrão é obrigatório');
  }
}

function normalizarListaCanais(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (c == null) return null;
      if (typeof c === 'number' || /^\d+$/.test(String(c))) return { id: Number(c) };
      if (typeof c === 'string') return { codigo: String(c).trim().toUpperCase() };
      return {
        id: c.id != null ? Number(c.id) : null,
        codigo: c.codigo != null ? String(c.codigo).trim().toUpperCase() : null
      };
    })
    .filter(Boolean);
}

class TiposComerciaisService {
  async _enriquecer(tipo) {
    if (!tipo) return null;
    let canais = [];
    try {
      canais = await tiposComerciaisRepository.listarCanaisPermitidos(tipo.id);
    } catch (_) {
      canais = [];
    }
    // Compat RCM-7.1: se ainda não houver N:N, expõe só o padrão
    if (!canais.length && tipo.canal_padrao) {
      const canal = await canaisVendaRepository.buscarPorCodigo(tipo.canal_padrao);
      if (canal) {
        canais = [{
          id: canal.id,
          codigo: canal.codigo,
          nome: canal.nome || canal.codigo,
          ativo: !!canal.ativo
        }];
      }
    }
    return {
      ...tipo,
      canais_permitidos: canais,
      canais_permitidos_codigos: canais.map((c) => c.codigo)
    };
  }

  async listar(filtros = {}) {
    const apenasAtivos = filtros.ativos === '1' || filtros.ativos === true;
    const lista = await tiposComerciaisRepository.listar({ apenasAtivos });
    return Promise.all(lista.map((t) => this._enriquecer(t)));
  }

  async buscarPorId(id) {
    return this._enriquecer(await tiposComerciaisRepository.buscarPorId(id));
  }

  async buscarPorCodigo(codigo) {
    return this._enriquecer(await tiposComerciaisRepository.buscarPorCodigo(codigo));
  }

  /**
   * Resolve IDs de canais a partir de códigos/ids; garante canal padrão incluso.
   */
  async _resolverCanalIds(canalPadraoCodigo, canaisPermitidosRaw) {
    const canalPadrao = await canaisVendaRepository.buscarPorCodigo(canalPadraoCodigo);
    if (!canalPadrao || !canalPadrao.ativo) {
      throw erro(`Canal padrão inválido ou inativo: ${canalPadraoCodigo}`);
    }

    const lista = normalizarListaCanais(canaisPermitidosRaw);
    const ids = new Set();

    if (!lista.length) {
      ids.add(Number(canalPadrao.id));
    } else {
      for (const item of lista) {
        let canal = null;
        if (item.id) canal = await canaisVendaRepository.buscarPorId(item.id);
        else if (item.codigo) canal = await canaisVendaRepository.buscarPorCodigo(item.codigo);
        if (!canal || !canal.ativo) {
          throw erro(`Canal permitido inválido ou inativo: ${item.codigo || item.id}`);
        }
        ids.add(Number(canal.id));
      }
      ids.add(Number(canalPadrao.id));
    }

    return { canalPadrao, canalIds: [...ids] };
  }

  async criar(dados) {
    validarPayload(dados);
    const { canalPadrao, canalIds } = await this._resolverCanalIds(
      dados.canal_padrao,
      dados.canais_permitidos ?? dados.canaisPermitidos
    );

    try {
      const criado = await tiposComerciaisRepository.criar({
        codigo: dados.codigo,
        descricao: dados.descricao,
        canal_padrao: canalPadrao.codigo,
        ativo: dados.ativo !== undefined ? !!dados.ativo : true,
        observacoes: dados.observacoes ?? null
      });
      await tiposComerciaisRepository.substituirCanaisPermitidos(criado.id, canalIds);
      return this.buscarPorId(criado.id);
    } catch (error) {
      if (error.message && /UNIQUE/i.test(error.message)) {
        throw erro('Já existe um tipo comercial com este código');
      }
      throw error;
    }
  }

  async atualizar(id, dados) {
    const existente = await tiposComerciaisRepository.buscarPorId(id);
    if (!existente) throw erro('Tipo comercial não encontrado', 404);

    validarPayload(dados, { parcial: true });

    if (
      dados.codigo !== undefined &&
      CODIGOS_SISTEMA.has(String(existente.codigo).toUpperCase()) &&
      String(dados.codigo).trim().toUpperCase() !== String(existente.codigo).toUpperCase()
    ) {
      throw erro('Não é permitido alterar o código de tipos do sistema');
    }

    const canalPadraoCodigo = dados.canal_padrao !== undefined
      ? dados.canal_padrao
      : existente.canal_padrao;

    const temCanaisNoPayload = dados.canais_permitidos !== undefined
      || dados.canaisPermitidos !== undefined;

    let canalIds = null;
    if (temCanaisNoPayload || dados.canal_padrao !== undefined) {
      const atuais = temCanaisNoPayload
        ? (dados.canais_permitidos ?? dados.canaisPermitidos)
        : (await tiposComerciaisRepository.listarCanaisPermitidos(id)).map((c) => c.codigo);
      const resolved = await this._resolverCanalIds(canalPadraoCodigo, atuais);
      dados = { ...dados, canal_padrao: resolved.canalPadrao.codigo };
      canalIds = resolved.canalIds;
    }

    try {
      await tiposComerciaisRepository.atualizar(id, dados);
      if (canalIds) {
        await tiposComerciaisRepository.substituirCanaisPermitidos(id, canalIds);
      }
      return this.buscarPorId(id);
    } catch (error) {
      if (error.message && /UNIQUE/i.test(error.message)) {
        throw erro('Já existe um tipo comercial com este código');
      }
      throw error;
    }
  }

  async excluir(id) {
    const existente = await tiposComerciaisRepository.buscarPorId(id);
    if (!existente) throw erro('Tipo comercial não encontrado', 404);
    if (CODIGOS_SISTEMA.has(String(existente.codigo).toUpperCase())) {
      throw erro('Não é possível excluir tipos padrão do sistema (CONSUMIDOR_FINAL)');
    }
    return tiposComerciaisRepository.excluir(id);
  }

  /**
   * Verifica se o canal está na lista permitida do tipo.
   */
  async canalPermitido(tipoIdOuCodigo, canalCodigo) {
    const tipo = typeof tipoIdOuCodigo === 'number' || /^\d+$/.test(String(tipoIdOuCodigo))
      ? await this.buscarPorId(tipoIdOuCodigo)
      : await this.buscarPorCodigo(tipoIdOuCodigo);
    if (!tipo) return false;
    const codigo = String(canalCodigo || '').trim().toUpperCase();
    const lista = tipo.canais_permitidos_codigos || [];
    if (lista.includes(codigo)) return true;
    // Compat: canal padrão sempre permitido
    return String(tipo.canal_padrao).toUpperCase() === codigo;
  }

  /**
   * Fluxo oficial RCM-7.2:
   * Cliente → Tipo → (canal solicitado se permitido) | Canal Padrão → Tabela ativa
   *
   * @param {Object} opts
   * @param {number|string} [opts.cliente_id]
   * @param {number|string} [opts.tipo_comercial_id]
   * @param {string} [opts.tipo_comercial_codigo]
   * @param {string} [opts.canal] — canal desejado (deve estar permitido)
   */
  async resolverCanalOperacao(opts = {}) {
    let tipo = null;
    let clienteId = opts.cliente_id != null ? Number(opts.cliente_id) : null;
    let clienteNome = null;

    if (clienteId) {
      const row = await tiposComerciaisRepository.resolverPorCliente(clienteId);
      if (!row) throw erro('Cliente não encontrado', 404);
      clienteNome = row.cliente_nome;
      if (row.tipo_comercial_id) {
        tipo = await this.buscarPorId(row.tipo_comercial_id);
      }
    }

    if (!tipo && opts.tipo_comercial_id != null) {
      tipo = await this.buscarPorId(opts.tipo_comercial_id);
    }
    if (!tipo && opts.tipo_comercial_codigo) {
      tipo = await this.buscarPorCodigo(opts.tipo_comercial_codigo);
    }

    if (!tipo) {
      tipo = await this.buscarPorCodigo('CONSUMIDOR_FINAL');
    }

    if (!tipo || !tipo.ativo) {
      throw erro('Tipo comercial não encontrado ou inativo', 400);
    }

    const permitidos = tipo.canais_permitidos_codigos || [tipo.canal_padrao];
    const solicitado = opts.canal
      ? String(opts.canal).trim().toUpperCase()
      : null;

    let canalCodigo = String(tipo.canal_padrao || 'VAREJO').toUpperCase();
    let motivo = 'tipo_comercial';

    if (solicitado) {
      if (permitidos.includes(solicitado)) {
        canalCodigo = solicitado;
        motivo = solicitado === tipo.canal_padrao
          ? 'tipo_comercial'
          : 'tipo_comercial_canal_permitido';
      } else {
        throw erro(
          `Canal ${solicitado} não permitido para o Tipo Comercial ${tipo.descricao || tipo.codigo}`,
          400
        );
      }
    } else if (permitidos.length === 1) {
      canalCodigo = permitidos[0];
      motivo = 'tipo_comercial_unico';
    }

    const canal = await canaisVendaRepository.buscarPorCodigo(canalCodigo);
    if (!canal || !canal.ativo) {
      throw erro(`Canal (${canalCodigo}) não encontrado ou inativo`, 400);
    }

    let tabela = null;
    try {
      const tabelasPrecoRepository = require('../tabelas-preco/TabelasPrecoRepository');
      tabela = await tabelasPrecoRepository.buscarAtivaPorCanal(canal.codigo);
    } catch (_) {
      tabela = null;
    }

    return {
      cliente_id: clienteId,
      cliente_nome: clienteNome,
      tipo_comercial_id: tipo.id,
      tipo_comercial_codigo: tipo.codigo,
      tipo_comercial_descricao: tipo.descricao,
      canal: canal.codigo,
      canal_venda_id: canal.id,
      nome: canal.nome || canal.codigo,
      canal_padrao: tipo.canal_padrao,
      canais_permitidos: tipo.canais_permitidos || [],
      canais_permitidos_codigos: permitidos,
      tabela_preco_id: tabela?.id ?? null,
      tabela_preco_codigo: tabela?.codigo ?? null,
      tabela_preco_nome: tabela?.nome ?? null,
      motivo,
      canal_manual: false
    };
  }
}

module.exports = new TiposComerciaisService();
