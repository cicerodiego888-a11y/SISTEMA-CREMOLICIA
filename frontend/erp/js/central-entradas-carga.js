/**
 * Orquestração da abertura da Central de Entradas (CE-01.4).
 * UI ≠ DistDFe. Sem dependência de DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CentralEntradasCarga = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function extrairContadoresAbertura(abertura) {
    return abertura?.dashboard?.contadores || null;
  }

  function temContadoresValidos(contadores) {
    return Boolean(contadores) && typeof contadores === 'object';
  }

  function deveMostrarSkeletonKpis({ jaTemDados, forcarSkeleton } = {}) {
    if (jaTemDados) return false;
    return Boolean(forcarSkeleton) || !jaTemDados;
  }

  function deveConsultarDashboardAposSync(resultadoSync) {
    if (temContadoresValidos(resultadoSync?.dashboard?.contadores)) {
      return false;
    }
    return true;
  }

  function montarBannerFalhaSync(sync) {
    if (!sync || sync.sucesso !== false || sync.ignorado) {
      return null;
    }
    return {
      visivel: true,
      titulo: 'Falha na última sincronização.',
      mensagem: sync.erro?.mensagem || sync.mensagem || 'Falha na última sincronização.',
      codigo: sync.erro?.codigo || null
    };
  }

  function criarGuardaCarga() {
    let emAndamento = null;
    return {
      ocupado() {
        return emAndamento != null;
      },
      executar(fn) {
        if (emAndamento) {
          return emAndamento;
        }
        emAndamento = Promise.resolve()
          .then(fn)
          .finally(() => {
            emAndamento = null;
          });
        return emAndamento;
      }
    };
  }

  /**
   * @param {Object} deps
   * @returns {Promise<Object>}
   */
  async function orquestrarAberturaCentral(deps = {}) {
    const chamadas = {
      aoAbrir: 0,
      dashboard: 0,
      health: 0,
      metadados: 0,
      documentos: 0,
      sincronizarAoAbrir: 0,
      inteligencia: 0
    };

    function contar(nome) {
      chamadas[nome] += 1;
      deps.registrarChamada?.(nome);
    }

    const aoAbrirP = Promise.resolve().then(() => {
      contar('aoAbrir');
      return deps.buscarAoAbrir();
    });
    const metaP = deps.buscarMetadados
      ? Promise.resolve().then(() => {
        contar('metadados');
        return deps.buscarMetadados();
      })
      : Promise.resolve(null);
    const docsP = deps.buscarDocumentos
      ? Promise.resolve().then(() => {
        contar('documentos');
        return deps.buscarDocumentos();
      })
      : Promise.resolve(null);

    const abertura = await aoAbrirP;
    let contadores = extrairContadoresAbertura(abertura);

    if (!temContadoresValidos(contadores) && deps.buscarDashboard) {
      contar('dashboard');
      const dash = await deps.buscarDashboard();
      contadores = dash?.contadores || {};
      deps.aplicarDashboard?.(dash);
    } else if (abertura?.dashboard) {
      deps.aplicarDashboard?.(abertura.dashboard);
    }

    deps.pintarKpis(contadores || {});
    deps.aplicarAbertura?.(abertura);

    if (abertura?.health) {
      deps.aplicarHealth?.(abertura.health);
    } else if (deps.buscarHealth) {
      Promise.resolve()
        .then(() => {
          contar('health');
          return deps.buscarHealth();
        })
        .then((health) => deps.aplicarHealth?.(health))
        .catch((error) => deps.registrarErro?.(error));
    }

    if (deps.buscarInteligencia) {
      Promise.resolve()
        .then(() => {
          contar('inteligencia');
          return deps.buscarInteligencia();
        })
        .then((dados) => deps.aplicarInteligencia?.(dados))
        .catch((error) => deps.registrarErro?.(error));
    }

    const kpisPintadosAntesDoSync = true;

    if (deps.sincronizarAoAbrir) {
      Promise.resolve()
        .then(() => {
          contar('sincronizarAoAbrir');
          return deps.sincronizarAoAbrir();
        })
        .then(async (sync) => {
          deps.tratarSync?.(sync);
          if (temContadoresValidos(sync?.dashboard?.contadores)) {
            deps.pintarKpis(sync.dashboard.contadores);
            deps.aplicarDashboard?.(sync.dashboard);
            return;
          }
          if (deveConsultarDashboardAposSync(sync) && deps.atualizarDashboard) {
            contar('dashboard');
            const dash = await deps.atualizarDashboard();
            deps.aplicarDashboard?.(dash);
            if (dash?.contadores) {
              deps.pintarKpis(dash.contadores);
            }
          }
        })
        .catch((error) => {
          deps.tratarSync?.({
            sucesso: false,
            mensagem: error.message,
            erro: { mensagem: error.message, operacional: true }
          });
        });
    }

    try {
      const metadados = await metaP;
      if (metadados) deps.aplicarMetadados?.(metadados);
    } catch (error) {
      deps.registrarErro?.(error);
    }

    if (docsP) {
      docsP.catch((error) => deps.registrarErro?.(error));
    }

    return {
      kpisPintadosAntesDoSync,
      chamadas,
      contadores: contadores || {}
    };
  }

  return {
    extrairContadoresAbertura,
    temContadoresValidos,
    deveMostrarSkeletonKpis,
    deveConsultarDashboardAposSync,
    montarBannerFalhaSync,
    criarGuardaCarga,
    orquestrarAberturaCentral,
    TIMEOUT_LISTAGEM_MS: 20000,
    deveMostrarSkeletonDocumentos({ carregando, quantidadeDocumentos, erro } = {}) {
      return Boolean(carregando) && !quantidadeDocumentos && !erro;
    },
    deveAplicarRespostaListagem(requestIdEsperado, requestIdRecebido) {
      return Number(requestIdEsperado) === Number(requestIdRecebido);
    },
    montarEstadoErroListagem(error) {
      return {
        mensagem: 'Não foi possível carregar os documentos da Central.',
        detalhe: error?.message || String(error || 'Erro desconhecido')
      };
    }
  };
}));
