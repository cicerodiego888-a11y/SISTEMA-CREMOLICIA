/**
 * CentralSefazOperationalGate — Controle operacional das chamadas SEFAZ DistDFe.
 *
 * Rate limit, cooldown, circuit breaker, bloqueio de concorrência e telemetria.
 * Também aplica a janela de 1 hora exigida pela SEFAZ após cStat 656
 * (consumo indevido) e após ultNSU = maxNSU, por CNPJ, persistida entre processos.
 *
 * @class CentralSefazOperationalGate
 */

const ESTADOS_CIRCUITO = Object.freeze({
  FECHADO: 'fechado',
  ABERTO: 'aberto',
  MEIO_ABERTO: 'meio_aberto'
});

const TIPOS_CONSULTA = Object.freeze({
  DIST_NSU: 'distNSU',
  CONS_CHAVE: 'consChNFe'
});

const MOTIVOS_JANELA = Object.freeze({
  CONSUMO_INDEVIDO: 'CSTAT_656',
  NSU_ALCANCADO: 'NSU_ALCANCADO'
});

const JANELA_SEFAZ_MS = 60 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paraMs(valor) {
  if (valor == null || valor === '') return null;
  const ms = typeof valor === 'number' ? valor : Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

function maiorMs(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.max(a, b);
}

function iso(ms) {
  return ms == null ? null : new Date(ms).toISOString();
}

function horaLocal(ms) {
  return new Date(ms).toLocaleString('pt-BR');
}

/**
 * Persistência da janela SEFAZ em `central_entradas_config`, com leitura do
 * último cStat 656 real já registrado em `central_entradas_eventos`.
 */
class JanelaSefazStore {
  constructor(deps = {}) {
    this._db = deps.db ?? null;
  }

  static chave(cnpj) {
    return `sefaz_distdfe_janela_${cnpj}`;
  }

  /** @private */
  _sql() {
    const { resolverDb, criarDbHelpers } = require('../repositories/dbHelpers');
    return criarDbHelpers(resolverDb(this._db));
  }

  async obter(cnpj) {
    const CentralConfigRepository = require('../repositories/CentralConfigRepository');
    const repo = new CentralConfigRepository({ db: this._db });
    const registro = await repo.buscarPorChave(JanelaSefazStore.chave(cnpj));
    const salvo = registro ? (repo.parseValor(registro) || {}) : {};

    return {
      ultimo656Em: maiorMs(paraMs(salvo.ultimo656Em), await this._ultimo656Registrado()),
      nsuAlcancadoEm: paraMs(salvo.nsuAlcancadoEm)
    };
  }

  async salvar(cnpj, estado) {
    const CentralConfigRepository = require('../repositories/CentralConfigRepository');
    const repo = new CentralConfigRepository({ db: this._db });
    await repo.salvar(JanelaSefazStore.chave(cnpj), {
      ultimo656Em: iso(estado.ultimo656Em),
      nsuAlcancadoEm: iso(estado.nsuAlcancadoEm)
    }, 'json');
  }

  /** @private */
  async _ultimo656Registrado() {
    const sql = this._sql();
    await sql.whenReady();
    const row = await sql.get(
      `SELECT created_at FROM central_entradas_eventos
       WHERE COALESCE(origem, '') <> 'teste'
         AND tipo IN ('SYNC_CONCLUIDA', 'SYNC_ERRO')
         AND detalhe_json LIKE '%"cStat":"656"%'
       ORDER BY id DESC LIMIT 1`
    );
    if (!row?.created_at) return null;
    return paraMs(`${String(row.created_at).replace(' ', 'T')}Z`);
  }
}

class CentralSefazOperationalGate {
  /**
   * @param {Object} [opcoes]
   */
  constructor(opcoes = {}) {
    this._minIntervaloMs = Number(opcoes.minIntervaloMs) || 2000;
    this._limiteFalhas = Number(opcoes.limiteFalhas) || 5;
    this._timeoutAbertoMs = Number(opcoes.timeoutAbertoMs) || 60 * 1000;
    this._cooldownErroMs = Number(opcoes.cooldownErroMs) || 15 * 1000;
    this._janelaSefazMs = Number(opcoes.janelaSefazMs) || JANELA_SEFAZ_MS;
    this._janelaStore = opcoes.janelaStore ?? null;
    this.resetar();
  }

  resetar() {
    this._emVoo = false;
    this._ultimaChamada = 0;
    this._falhasConsecutivas = 0;
    this._cooldownAte = 0;
    this._circuito = ESTADOS_CIRCUITO.FECHADO;
    this._abertoEm = 0;
    this._ultimoErro = null;
    this._janelas = new Map();
    this._telemetria = {
      chamadas: 0,
      sucessos: 0,
      erros: 0,
      bloqueios: 0,
      ultimaChamadaEm: null,
      ultimaFalhaEm: null
    };
  }

  /** @private */
  _store() {
    if (!this._janelaStore) this._janelaStore = new JanelaSefazStore();
    return this._janelaStore;
  }

  /**
   * @private
   * @param {string} cnpj
   * @param {{ ultimo656Em: number|null, nsuAlcancadoEm: number|null }} estado
   * @param {string} tipoConsulta
   */
  _calcularJanela(cnpj, estado, tipoConsulta, agora = Date.now()) {
    const ate656 = estado.ultimo656Em != null ? estado.ultimo656Em + this._janelaSefazMs : null;
    const ateNsu = tipoConsulta === TIPOS_CONSULTA.DIST_NSU && estado.nsuAlcancadoEm != null
      ? estado.nsuAlcancadoEm + this._janelaSefazMs
      : null;

    const base = {
      cnpj,
      ultimo656Em: iso(estado.ultimo656Em),
      nsuAlcancadoEm: iso(estado.nsuAlcancadoEm)
    };

    if (ate656 != null && agora < ate656) {
      return {
        ...base,
        bloqueado: true,
        motivoCodigo: MOTIVOS_JANELA.CONSUMO_INDEVIDO,
        desbloqueioEm: iso(ate656),
        motivo: `SEFAZ em cooldown por cStat 656 (consumo indevido). Nova consulta liberada em ${horaLocal(ate656)}. Último 656 real: ${horaLocal(estado.ultimo656Em)}.`
      };
    }

    if (ateNsu != null && agora < ateNsu) {
      return {
        ...base,
        bloqueado: true,
        motivoCodigo: MOTIVOS_JANELA.NSU_ALCANCADO,
        desbloqueioEm: iso(ateNsu),
        motivo: `Distribuição DF-e em dia (ultNSU = maxNSU). Regra SEFAZ: nova consulta somente após ${horaLocal(ateNsu)}.`
      };
    }

    return { ...base, bloqueado: false, desbloqueioEm: null };
  }

  /**
   * @param {string} cnpj
   * @param {string} [tipoConsulta]
   * @returns {Promise<Object>}
   */
  async verificarJanelaSefaz(cnpj, tipoConsulta = TIPOS_CONSULTA.DIST_NSU) {
    const memoria = this._janelas.get(cnpj) || { ultimo656Em: null, nsuAlcancadoEm: null };
    let persistido = { ultimo656Em: null, nsuAlcancadoEm: null };
    try {
      persistido = await this._store().obter(cnpj);
    } catch (error) {
      console.warn('[CE][GATE] falha ao ler janela SEFAZ persistida', error.message);
    }
    const estado = {
      ultimo656Em: maiorMs(memoria.ultimo656Em, persistido.ultimo656Em),
      nsuAlcancadoEm: maiorMs(memoria.nsuAlcancadoEm, persistido.nsuAlcancadoEm)
    };
    this._janelas.set(cnpj, estado);
    return this._calcularJanela(cnpj, estado, tipoConsulta);
  }

  /**
   * Registra um cStat 656 REAL recebido da SEFAZ.
   *
   * @param {string} cnpj
   * @param {number|string|Date} [em]
   */
  async registrarConsumoIndevido(cnpj, em = Date.now()) {
    const atual = await this.verificarJanelaSefaz(cnpj);
    const estado = {
      ultimo656Em: maiorMs(paraMs(atual.ultimo656Em), paraMs(em instanceof Date ? em.getTime() : em)),
      nsuAlcancadoEm: paraMs(atual.nsuAlcancadoEm)
    };
    this._janelas.set(cnpj, estado);
    await this._store().salvar(cnpj, estado);
    const janela = this._calcularJanela(cnpj, estado, TIPOS_CONSULTA.DIST_NSU);
    console.warn('[CE][GATE] cStat 656 registrado', {
      cnpj,
      ultimo656Em: janela.ultimo656Em,
      desbloqueioEm: janela.desbloqueioEm
    });
    return janela;
  }

  /**
   * Registra consulta DistDFe real concluída com ultNSU = maxNSU.
   *
   * @param {string} cnpj
   * @param {number|string|Date} [em]
   */
  async registrarNsuAlcancado(cnpj, em = Date.now()) {
    const atual = await this.verificarJanelaSefaz(cnpj);
    const estado = {
      ultimo656Em: paraMs(atual.ultimo656Em),
      nsuAlcancadoEm: paraMs(em instanceof Date ? em.getTime() : em)
    };
    this._janelas.set(cnpj, estado);
    await this._store().salvar(cnpj, estado);
    const janela = this._calcularJanela(cnpj, estado, TIPOS_CONSULTA.DIST_NSU);
    console.log('[CE][GATE] ultNSU = maxNSU — próxima consulta DistDFe após', janela.desbloqueioEm);
    return janela;
  }

  /** @private */
  _janelasAtivas(agora = Date.now()) {
    const ativas = [];
    for (const [cnpj, estado] of this._janelas.entries()) {
      const janela = this._calcularJanela(cnpj, estado, TIPOS_CONSULTA.DIST_NSU, agora);
      if (janela.bloqueado) ativas.push(janela);
    }
    return ativas;
  }

  /**
   * @returns {Object}
   */
  obterEstado() {
    const agora = Date.now();
    return {
      disponivel: this.podeConsultar(),
      circuito: this._circuito,
      emVoo: this._emVoo,
      falhasConsecutivas: this._falhasConsecutivas,
      cooldownMsRestante: Math.max(0, this._cooldownAte - agora),
      janelaSefaz: this._janelasAtivas(agora),
      ultimoErro: this._ultimoErro,
      telemetria: { ...this._telemetria }
    };
  }

  /**
   * @returns {boolean}
   */
  podeConsultar() {
    return this.avaliar().permitido;
  }

  /**
   * @returns {{ permitido: boolean, motivo?: string }}
   */
  avaliar() {
    if (this._emVoo) {
      return { permitido: false, motivo: 'Consulta SEFAZ já em andamento' };
    }

    const agora = Date.now();
    if (agora < this._cooldownAte) {
      return { permitido: false, motivo: 'Cooldown SEFAZ ativo' };
    }

    const janela656 = this._janelasAtivas(agora)
      .find((j) => j.motivoCodigo === MOTIVOS_JANELA.CONSUMO_INDEVIDO);
    if (janela656) {
      return { permitido: false, motivo: janela656.motivo };
    }

    if (this._circuito === ESTADOS_CIRCUITO.ABERTO) {
      if (agora - this._abertoEm < this._timeoutAbertoMs) {
        return { permitido: false, motivo: 'Circuit breaker SEFAZ aberto' };
      }
      this._circuito = ESTADOS_CIRCUITO.MEIO_ABERTO;
    }

    return { permitido: true };
  }

  /**
   * @param {Function} fn
   * @param {Object} [opcoes]
   * @param {string} [opcoes.cnpj]
   * @param {string} [opcoes.origem]
   * @param {string} [opcoes.tipoConsulta]
   * @returns {Promise<*>}
   */
  /**
   * Lança SEFAZ_GATE_BLOQUEADO quando a janela SEFAZ do CNPJ está ativa.
   * Não renova a janela: apenas tentativas locais bloqueadas.
   *
   * @param {string} cnpj
   * @param {Object} [opcoes]
   */
  async exigirJanelaLivre(cnpj, opcoes = {}) {
    const janela = await this.verificarJanelaSefaz(
      cnpj,
      opcoes.tipoConsulta || TIPOS_CONSULTA.DIST_NSU
    );
    if (!janela.bloqueado) return janela;

    this._telemetria.bloqueios += 1;
    console.warn('[CE][GATE] janela SEFAZ ativa — consulta não enviada', {
      cnpj: janela.cnpj,
      origem: opcoes.origem || null,
      motivo: janela.motivoCodigo,
      ultimo656Em: janela.ultimo656Em,
      desbloqueioEm: janela.desbloqueioEm
    });
    const erro = new Error(janela.motivo);
    erro.code = 'SEFAZ_GATE_BLOQUEADO';
    erro.statusCode = 429;
    erro.janelaSefaz = { ...janela, origem: opcoes.origem || null };
    throw erro;
  }

  async executar(fn, opcoes = {}) {
    if (opcoes.cnpj) {
      await this.exigirJanelaLivre(opcoes.cnpj, opcoes);
    }

    const avaliacao = this.avaliar();
    if (!avaliacao.permitido) {
      this._telemetria.bloqueios += 1;
      console.warn('[CE][GATE] bloqueado', avaliacao.motivo);
      const erro = new Error(avaliacao.motivo);
      erro.code = 'SEFAZ_GATE_BLOQUEADO';
      erro.statusCode = 429;
      throw erro;
    }

    console.log('[CE][GATE] permitido', { circuito: this._circuito, origem: opcoes.origem || null });
    this._emVoo = true;
    const espera = this._minIntervaloMs - (Date.now() - this._ultimaChamada);
    if (espera > 0 && opcoes.respeitarIntervalo !== false) {
      await sleep(espera);
    }

    this._ultimaChamada = Date.now();
    this._telemetria.chamadas += 1;
    this._telemetria.ultimaChamadaEm = new Date().toISOString();

    try {
      const resultado = await fn();
      this._registrarSucesso();
      return resultado;
    } catch (error) {
      this._registrarFalha(error);
      throw error;
    } finally {
      this._emVoo = false;
    }
  }

  /** @private */
  _registrarSucesso() {
    this._falhasConsecutivas = 0;
    this._cooldownAte = 0;
    this._circuito = ESTADOS_CIRCUITO.FECHADO;
    this._telemetria.sucessos += 1;
  }

  /** @private */
  _registrarFalha(error) {
    this._falhasConsecutivas += 1;
    this._ultimoErro = error?.message || String(error);
    this._telemetria.erros += 1;
    this._telemetria.ultimaFalhaEm = new Date().toISOString();
    this._cooldownAte = Date.now() + this._cooldownErroMs;
    console.warn('[CE][GATE] falha', {
      motivo: this._ultimoErro,
      cooldownMs: this._cooldownErroMs,
      circuito: this._circuito
    });

    if (this._falhasConsecutivas >= this._limiteFalhas) {
      this._circuito = ESTADOS_CIRCUITO.ABERTO;
      this._abertoEm = Date.now();
    }
  }
}

const gate = new CentralSefazOperationalGate();

module.exports = gate;
module.exports.CentralSefazOperationalGate = CentralSefazOperationalGate;
module.exports.JanelaSefazStore = JanelaSefazStore;
module.exports.ESTADOS_CIRCUITO = ESTADOS_CIRCUITO;
module.exports.TIPOS_CONSULTA = TIPOS_CONSULTA;
module.exports.MOTIVOS_JANELA = MOTIVOS_JANELA;
