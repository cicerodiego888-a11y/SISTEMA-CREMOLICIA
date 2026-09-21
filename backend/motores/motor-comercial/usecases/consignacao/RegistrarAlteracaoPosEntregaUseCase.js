/**
 * UC — RegistrarAlteracaoPosEntregaUseCase (RCM-8.13)
 *
 * Altera quantidades já entregues sem reprocessar a entrega original.
 * Movimenta estoque/crédito/Ledger somente pelo DELTA.
 * Emite novo comprovante completo (lista atual + bloco de atualização).
 *
 * @class RegistrarAlteracaoPosEntregaUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  DocumentoInvalidoError,
  DomainError,
  ProdutoNaoEncontradoNaConsignacaoError,
  QuantidadeInvalidaError,
  PerfilSemLimiteDisponivelError
} = require('../../domain/errors');
const { gerarCorrelationId, enfileirarEvento } = require('./consignacaoUseCaseHelpers');
const {
  criarSnapshotConsignacao,
  registrarMovimentacaoComercial,
  consumirLimitePerfil,
  prestacaoEstaAberta
} = require('./consignacaoOperacaoHelpers');
const { montarHistoricoEntregas } = require('./entregaComplementarHelpers');
const {
  OPERACAO_ALTERACAO_POS_ENTREGA,
  MOTIVOS_ALTERACAO_POS_ENTREGA,
  avaliarElegibilidadeAlteracaoPosEntrega,
  obterComprovanteDoHistorico
} = require('./atualizacaoEntregaHelpers');
const { sincronizarCacheConsignacao } = require('../../services/projections/ledgerCacheSync');
const { sincronizarCreditoComercial } = require('../../services/sincronizarCreditoComercial');
const { validarQuantidadePorUnidade } = require('../../services/quantidadeUnidadeComercial');
const {
  OUTBOX_EVENT_TYPES,
  OUTBOX_BRIDGE_NAMES,
  enfileirarBridgeOutbox
} = require('../../integrations/outbox/outboxUseCaseHelpers');

class RegistrarAlteracaoPosEntregaUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
    this._perfilComercialRepository = deps.perfilComercialRepository ?? null;
    this._consignacaoRepository = deps.consignacaoRepository ?? null;
    this._consignacaoItemRepository = deps.consignacaoItemRepository ?? null;
    this._movimentacaoComercialRepository = deps.movimentacaoComercialRepository ?? null;
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
    if (!Array.isArray(entrada.itens) || !entrada.itens.length) {
      throw new DocumentoInvalidoError('Informe ao menos um item para alteração pós-entrega');
    }
    const motivo = String(entrada.motivo || '').trim().toUpperCase();
    if (!motivo) {
      throw new DocumentoInvalidoError('motivo é obrigatório para alteração pós-entrega');
    }
    if (!MOTIVOS_ALTERACAO_POS_ENTREGA.includes(motivo) && motivo !== 'OUTRO') {
      // Aceita motivo livre se vier como OUTRO + observação; demais listados
      if (!MOTIVOS_ALTERACAO_POS_ENTREGA.includes(motivo)) {
        // permite qualquer motivo não vazio (operacional), mas recomenda catálogo
      }
    }
  }

  async processar(entrada) {
    const consignacao = await this._consignacaoRepository.buscarPorId(entrada.consignacaoId);
    const elegibilidade = avaliarElegibilidadeAlteracaoPosEntrega(consignacao);
    if (!elegibilidade.elegivel) {
      throw new DomainError(elegibilidade.mensagem, {
        codigo: elegibilidade.codigo || 'ALTERACAO_POS_ENTREGA_BLOQUEADA'
      });
    }

    const correlationId = entrada.correlationId ?? gerarCorrelationId();
    const motivo = String(entrada.motivo || 'AJUSTE_OPERACIONAL').trim().toUpperCase();
    const observacao = entrada.observacao || null;
    const origem = entrada.origem ?? 'USUARIO';

    // Idempotência
    if (this._movimentacaoComercialRepository?.listar) {
      const existentes = await this._movimentacaoComercialRepository.listar({
        consignacaoId: consignacao.id,
        correlationId
      });
      const movsAlt = (existentes || []).filter((mov) => {
        const tipo = String(mov.tipoMovimentacao || mov.tipo || '').toUpperCase();
        const op = String(mov.snapshot?.contexto?.operacao || '').toUpperCase();
        return tipo === 'ENTREGA' && op === OPERACAO_ALTERACAO_POS_ENTREGA;
      });
      if (movsAlt.length) {
        const itens = await this._consignacaoItemRepository.listarPorConsignacao(consignacao.id);
        const historico = montarHistoricoEntregas(existentes, itens);
        const evento = historico.find((h) => String(h.correlationId) === String(correlationId));
        return {
          consignacao,
          itensAlterados: [],
          movimentacoes: movsAlt,
          valorDelta: Number(evento?.valorTotal || 0),
          correlationId,
          idempotente: true,
          entregas: historico,
          comprovante: evento?.comprovante
            || obterComprovanteDoHistorico(historico, correlationId)
        };
      }
    }

    const itensAtuais = await this._consignacaoItemRepository.listarPorConsignacao(consignacao.id);
    const linhasPreparadas = [];

    for (const linha of entrada.itens) {
      let item = null;
      if (linha.itemId) {
        item = itensAtuais.find((i) => Number(i.id) === Number(linha.itemId)) || null;
      } else if (linha.produtoId) {
        item = itensAtuais.find((i) => Number(i.produtoId) === Number(linha.produtoId)) || null;
      }

      if (!item) {
        throw new ProdutoNaoEncontradoNaConsignacaoError(
          consignacao.id,
          linha.produtoId ?? linha.itemId
        );
      }

      if (linha.quantidadeNova == null && linha.novaQuantidade == null && linha.quantidade == null) {
        throw new QuantidadeInvalidaError(null);
      }

      const quantidadeNova = Number(
        linha.quantidadeNova ?? linha.novaQuantidade ?? linha.quantidade
      );
      if (!Number.isFinite(quantidadeNova) || quantidadeNova < 0) {
        throw new QuantidadeInvalidaError(quantidadeNova);
      }

      // 0 é permitido (cliente desistiu do produto)
      if (quantidadeNova > 0) {
        const qtdCheck = validarQuantidadePorUnidade(
          quantidadeNova,
          item.unidadeComercial || item.unidade || 'UN'
        );
        if (!qtdCheck.ok) {
          throw new QuantidadeInvalidaError(quantidadeNova);
        }
      }

      const quantidadeAnterior = Number(item.quantidadeEntregue) || 0;
      const delta = quantidadeNova - quantidadeAnterior;
      if (delta === 0) continue;

      // Não recalcula preço — snapshot existente
      const precoUnitario = Number(item.precoUnitario) || 0;

      linhasPreparadas.push({
        item,
        quantidadeAnterior,
        quantidadeNova,
        delta,
        precoUnitario,
        valorDelta: delta * precoUnitario
      });
    }

    if (!linhasPreparadas.length) {
      throw new DocumentoInvalidoError(
        'Nenhuma quantidade foi alterada (todas iguais à situação atual)'
      );
    }

    const valorDeltaTotal = linhasPreparadas.reduce((s, l) => s + l.valorDelta, 0);

    if (valorDeltaTotal > 0) {
      await this._validarLimiteIncremental(consignacao, valorDeltaTotal);
    }

    const snapshotItensAntes = itensAtuais.map((i) => ({
      id: i.id,
      produtoId: i.produtoId,
      quantidadeEntregue: i.quantidadeEntregue,
      precoUnitario: i.precoUnitario,
      linhaComercialId: i.linhaComercialId,
      tabelaPrecoId: i.tabelaPrecoId,
      canalVenda: i.canalVenda,
      precoOrigem: i.precoOrigem,
      precoFallback: i.precoFallback
    }));

    return this.executarEscrita(async (uow, eventos, outboxEnqueue) => {
      const consTx = await uow.consignacao.buscarPorId(entrada.consignacaoId);
      const elegTx = avaliarElegibilidadeAlteracaoPosEntrega(consTx);
      if (!elegTx.elegivel) {
        throw new DomainError(elegTx.mensagem, {
          codigo: elegTx.codigo || 'ALTERACAO_POS_ENTREGA_BLOQUEADA'
        });
      }

      if (uow.movimentacaoComercial?.listar) {
        const movsTx = await uow.movimentacaoComercial.listar({
          consignacaoId: consTx.id,
          correlationId
        });
        const jaFeito = (movsTx || []).some((mov) => {
          const tipo = String(mov.tipoMovimentacao || '').toUpperCase();
          const op = String(mov.snapshot?.contexto?.operacao || '').toUpperCase();
          return tipo === 'ENTREGA' && op === OPERACAO_ALTERACAO_POS_ENTREGA;
        });
        if (jaFeito) {
          const itens = await uow.consignacaoItem.listarPorConsignacao(consTx.id);
          const historico = montarHistoricoEntregas(movsTx, itens);
          return {
            consignacao: consTx,
            itensAlterados: [],
            movimentacoes: movsTx,
            valorDelta: 0,
            correlationId,
            idempotente: true,
            entregas: historico,
            comprovante: obterComprovanteDoHistorico(historico, correlationId)
          };
        }
      }

      if (valorDeltaTotal > 0) {
        await consumirLimitePerfil(uow, consTx.perfilComercialId, valorDeltaTotal, {});
      }

      let grupoCiclo = null;
      if (prestacaoEstaAberta(consTx)) {
        grupoCiclo = consTx.prestacaoContasAtiva;
      } else {
        const {
          buscarGrupoPrestacaoAbertaDoCliente,
          vincularConsignacaoAoGrupoPrestacao
        } = require('./prestacaoCicloClienteHelpers');
        const ciclo = await buscarGrupoPrestacaoAbertaDoCliente(uow, consTx.clienteId);
        if (ciclo?.grupo) {
          grupoCiclo = ciclo.grupo;
          await vincularConsignacaoAoGrupoPrestacao(uow, consTx, grupoCiclo);
        }
      }

      const itensAlterados = [];
      const movimentacoes = [];
      const itensBaixa = [];
      const itensEntrada = [];

      for (const linha of linhasPreparadas) {
        const { item, quantidadeAnterior, quantidadeNova, delta, precoUnitario, valorDelta } = linha;

        const itemAtualizado = await uow.consignacaoItem.atualizar(item.id, {
          quantidadeEntregue: quantidadeNova,
          subtotalEntregue: quantidadeNova * precoUnitario
        });

        const itemEvento = {
          ...itemAtualizado,
          quantidadeEntregue: Math.abs(delta),
          quantidadeIncremental: delta,
          quantidadeAnterior,
          quantidadeNova,
          delta,
          precoUnitario
        };
        itensAlterados.push(itemEvento);

        if (delta > 0) {
          itensBaixa.push(itemEvento);
        } else if (delta < 0) {
          itensEntrada.push({
            ...itemEvento,
            quantidadeEntregue: Math.abs(delta)
          });
        }

        const mov = await registrarMovimentacaoComercial(uow, {
          consignacaoId: consTx.id,
          consignacaoItemId: item.id,
          tipoMovimentacao: 'ENTREGA',
          origem,
          correlationId,
          grupoPrestacaoContasId: grupoCiclo?.id ?? null,
          snapshot: {
            ...criarSnapshotConsignacao(consTx, {
              operacao: OPERACAO_ALTERACAO_POS_ENTREGA,
              alteracaoPosEntrega: true,
              motivo,
              observacao
            }),
            documento: consTx.documento,
            item: {
              id: item.id,
              produtoId: item.produtoId,
              produtoNome: item.produtoNome || item.produto || null,
              quantidade: delta,
              quantidadeAnterior,
              delta,
              quantidadeAtual: quantidadeNova,
              precoUnitario,
              unidadeComercial: item.unidadeComercial,
              linhaComercialId: item.linhaComercialId,
              tabelaPrecoId: item.tabelaPrecoId,
              canalVenda: item.canalVenda,
              precoOrigem: item.precoOrigem,
              precoFallback: item.precoFallback
            }
          },
          usuarioId: entrada.usuarioId ?? null,
          valor: valorDelta,
          quantidade: delta,
          motivo,
          detalhes: {
            alteracaoPosEntrega: true,
            quantidadeAnterior,
            quantidadeNova,
            delta,
            observacao
          }
        });
        movimentacoes.push(mov);
      }

      // Garantia: não altera snapshot de preço dos itens
      for (const original of snapshotItensAntes) {
        const atual = await uow.consignacaoItem.buscarPorId(original.id);
        if (!atual) continue;
        const precoOk = Number(atual.precoUnitario) === Number(original.precoUnitario)
          && String(atual.precoOrigem || '') === String(original.precoOrigem || '')
          && Number(atual.tabelaPrecoId || 0) === Number(original.tabelaPrecoId || 0)
          && Number(atual.linhaComercialId || 0) === Number(original.linhaComercialId || 0);
        if (!precoOk) {
          throw new DomainError('Snapshot de preço foi alterado indevidamente', {
            codigo: 'SNAPSHOT_PRECO_ALTERADO',
            detalhes: { itemId: original.id }
          });
        }
      }

      await sincronizarCacheConsignacao(uow, consTx.id);
      const consignacaoAtualizada = await uow.consignacao.buscarPorId(consTx.id);

      if (itensBaixa.length) {
        await enfileirarBridgeOutbox(outboxEnqueue, {
          eventType: OUTBOX_EVENT_TYPES.ESTOQUE_BAIXAR_PRODUTO,
          bridgeName: OUTBOX_BRIDGE_NAMES.ESTOQUE,
          payload: {
            consignacaoId: consTx.id,
            itens: itensBaixa,
            correlationId,
            alteracaoPosEntrega: true
          },
          correlationId,
          requestId: entrada.requestId ?? null
        });
      }

      if (itensEntrada.length) {
        await enfileirarBridgeOutbox(outboxEnqueue, {
          eventType: OUTBOX_EVENT_TYPES.ESTOQUE_ENTRADA_DEVOLUCAO,
          bridgeName: OUTBOX_BRIDGE_NAMES.ESTOQUE,
          payload: {
            consignacaoId: consTx.id,
            itens: itensEntrada,
            correlationId,
            alteracaoPosEntrega: true
          },
          correlationId,
          requestId: entrada.requestId ?? null
        });
      }

      enfileirarEvento(eventos, EVENTOS_DOMINIO.CONSIGNACAO_ALTERACAO_POS_ENTREGA, consTx.id, {
        consignacao: consignacaoAtualizada,
        itensAlterados,
        movimentacoes,
        valorDelta: valorDeltaTotal,
        correlationId,
        motivo,
        observacao,
        alteracaoPosEntrega: true
      }, correlationId);

      await sincronizarCreditoComercial(uow, eventos, consignacaoAtualizada || consTx, {
        origem: 'ALTERACAO_POS_ENTREGA',
        correlationId,
        usuarioId: entrada.usuarioId ?? null
      });

      const todasMovs = uow.movimentacaoComercial?.listar
        ? await uow.movimentacaoComercial.listar({ consignacaoId: consTx.id })
        : movimentacoes;
      const todosItens = await uow.consignacaoItem.listarPorConsignacao(consTx.id);
      const entregas = montarHistoricoEntregas(todasMovs, todosItens);
      const comprovante = obterComprovanteDoHistorico(entregas, correlationId);

      return {
        consignacao: consignacaoAtualizada || consTx,
        itensAlterados,
        movimentacoes,
        valorDelta: valorDeltaTotal,
        correlationId,
        idempotente: false,
        motivo,
        observacao,
        entregas,
        comprovante
      };
    });
  }

  /**
   * @private
   */
  async _validarLimiteIncremental(consignacao, valorIncremental) {
    if (!this._perfilComercialRepository || !(valorIncremental > 0)) return;

    const perfil = await this._perfilComercialRepository.buscarPorId(consignacao.perfilComercialId);
    if (!perfil) {
      throw new PerfilSemLimiteDisponivelError({
        perfilId: consignacao.perfilComercialId,
        motivo: 'Perfil não encontrado'
      });
    }
    if (perfil.bloqueado) {
      throw new DomainError('Perfil comercial bloqueado', { codigo: 'CLIENTE_BLOQUEADO' });
    }

    let saldoAbertoDerivado = Number(perfil.saldoAberto ?? 0);
    if (this._movimentacaoComercialRepository && this._consignacaoRepository) {
      try {
        const consignacoes = await this._consignacaoRepository.listar({
          perfilComercialId: perfil.id
        });
        const movimentacoes = [];
        for (const c of consignacoes) {
          const movs = await this._movimentacaoComercialRepository.listar({
            consignacaoId: c.id
          });
          movimentacoes.push(...(movs || []));
        }
        const { derivarSaldoAbertoPerfil } = require('../../services/projections/ledgerCacheDerivation');
        saldoAbertoDerivado = derivarSaldoAbertoPerfil(movimentacoes);
      } catch (_e) {
        /* usa saldo do perfil */
      }
    }

    const limiteDisponivel = Number(perfil.limiteComercial) - saldoAbertoDerivado;
    if (valorIncremental > limiteDisponivel) {
      throw new PerfilSemLimiteDisponivelError({
        perfilId: perfil.id,
        valorSolicitado: valorIncremental,
        limiteDisponivel,
        motivo: 'Limite comercial insuficiente para a alteração pós-entrega'
      });
    }
  }
}

module.exports = RegistrarAlteracaoPosEntregaUseCase;
