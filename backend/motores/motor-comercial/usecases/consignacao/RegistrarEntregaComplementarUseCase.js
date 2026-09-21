/**
 * UC — RegistrarEntregaComplementarUseCase (RCM-8.7)
 *
 * Adiciona produtos a consignação já ENTREGUE sem reabrir/reprocessar a entrega original.
 * Movimenta estoque, crédito e Ledger somente para os novos itens (valor incremental).
 *
 * @class RegistrarEntregaComplementarUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  DocumentoInvalidoError,
  DomainError,
  ProdutoInvalidoError,
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
const {
  OPERACAO_ENTREGA_COMPLEMENTAR,
  avaliarElegibilidadeEntregaComplementar,
  montarSnapshotPrecificacaoItem,
  montarHistoricoEntregas
} = require('./entregaComplementarHelpers');
const { obterComprovanteDoHistorico } = require('./atualizacaoEntregaHelpers');
const { sincronizarCacheConsignacao } = require('../../services/projections/ledgerCacheSync');
const { sincronizarCreditoComercial } = require('../../services/sincronizarCreditoComercial');
const { validarQuantidadePorUnidade } = require('../../services/quantidadeUnidadeComercial');
const {
  OUTBOX_EVENT_TYPES,
  OUTBOX_BRIDGE_NAMES,
  enfileirarBridgeOutbox
} = require('../../integrations/outbox/outboxUseCaseHelpers');

const CANAL_CONSIGNACAO = 'CONSIGNADO';

class RegistrarEntregaComplementarUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
    this._produtoBridge = deps.produtoBridge ?? null;
    this._clienteBridge = deps.clienteBridge ?? null;
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
      throw new DocumentoInvalidoError('Informe ao menos um item para a entrega complementar');
    }
    if (!this._produtoBridge) {
      throw new ProdutoInvalidoError(null, 'IProdutoBridge não configurado');
    }
  }

  async processar(entrada) {
    const liberacaoGerencial = entrada.liberacaoGerencial || null;
    const { liberacaoGerencialValida } = require('../../services/autorizacaoGerencialService');
    const liberacaoOk = liberacaoGerencialValida(liberacaoGerencial);

    if (liberacaoGerencial && !liberacaoOk) {
      throw new DomainError('Autorização gerencial inválida ou expirada', {
        codigo: 'AUTORIZACAO_GERENCIAL_INVALIDA'
      });
    }

    if (liberacaoOk && liberacaoGerencial.supervisorToken) {
      try {
        const { verificarSupervisorToken } = require('../../../../rotas/auth');
        await verificarSupervisorToken(liberacaoGerencial.supervisorToken);
      } catch (error) {
        throw new DomainError(error.message || 'Token de autorização gerencial inválido', {
          codigo: 'AUTORIZACAO_GERENCIAL_INVALIDA'
        });
      }
    }

    const consignacao = await this._consignacaoRepository.buscarPorId(entrada.consignacaoId);
    const elegibilidade = avaliarElegibilidadeEntregaComplementar(consignacao);
    if (!elegibilidade.elegivel) {
      throw new DomainError(elegibilidade.mensagem, {
        codigo: elegibilidade.codigo || 'ENTREGA_COMPLEMENTAR_BLOQUEADA'
      });
    }

    const correlationId = entrada.correlationId ?? gerarCorrelationId();

    // Idempotência: retry com o mesmo correlationId não duplica efeitos.
    if (this._movimentacaoComercialRepository?.listar) {
      const existentes = await this._movimentacaoComercialRepository.listar({
        consignacaoId: consignacao.id,
        correlationId
      });
      const movsComplementar = (existentes || []).filter((mov) => {
        const tipo = String(mov.tipoMovimentacao || mov.tipo || '').toUpperCase();
        const op = String(mov.snapshot?.contexto?.operacao || '').toUpperCase();
        return tipo === 'ENTREGA' && op === OPERACAO_ENTREGA_COMPLEMENTAR;
      });
      if (movsComplementar.length) {
        const itens = await this._consignacaoItemRepository.listarPorConsignacao(consignacao.id);
        const historico = montarHistoricoEntregas(existentes, itens);
        const evento = historico.find((h) => String(h.correlationId) === String(correlationId));
        return {
          consignacao,
          itensNovos: [],
          movimentacoes: movsComplementar,
          valorIncremental: Number(evento?.valorTotal || 0),
          correlationId,
          idempotente: true,
          entregas: historico,
          comprovante: evento?.comprovante || obterComprovanteDoHistorico(historico, correlationId)
        };
      }
    }

    const origem = entrada.origem ?? 'USUARIO';
    const linhasPreparadas = [];

    for (const linha of entrada.itens) {
      if (!linha?.produtoId) {
        throw new ProdutoInvalidoError(null, 'produtoId é obrigatório');
      }

      // Resolver oficial — sempre canal CONSIGNADO (RCM-6.1 / RCM-8.7)
      const produto = await this._produtoBridge.buscarPorId(linha.produtoId, {
        canal: CANAL_CONSIGNACAO
      });
      if (!produto) {
        throw new ProdutoInvalidoError(linha.produtoId, 'Produto não encontrado');
      }
      const ativo = await this._produtoBridge.estaAtivo(linha.produtoId);
      if (!ativo) {
        throw new ProdutoInvalidoError(linha.produtoId, 'Produto inativo');
      }

      const snap = montarSnapshotPrecificacaoItem(produto, linha);
      const qtdCheck = validarQuantidadePorUnidade(linha.quantidade, snap.unidadeComercial);
      if (!qtdCheck.ok) {
        throw new QuantidadeInvalidaError(linha.quantidade);
      }

      linhasPreparadas.push({
        produtoId: Number(linha.produtoId),
        quantidade: qtdCheck.quantidade,
        produtoNome: produto.nome || produto.descricao || null,
        ...snap
      });
    }

    const valorIncremental = linhasPreparadas.reduce(
      (sum, l) => sum + (Number(l.quantidade) * Number(l.precoUnitario)),
      0
    );

    await this._validarLimiteIncremental(consignacao, valorIncremental, {
      liberacaoOk,
      liberacaoGerencial
    });

    // Snapshot dos itens originais (antes) — garantia de não alteração
    const itensAntes = await this._consignacaoItemRepository.listarPorConsignacao(consignacao.id);
    const snapshotItensOriginais = itensAntes.map((i) => ({
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
      const elegTx = avaliarElegibilidadeEntregaComplementar(consTx);
      if (!elegTx.elegivel) {
        throw new DomainError(elegTx.mensagem, {
          codigo: elegTx.codigo || 'ENTREGA_COMPLEMENTAR_BLOQUEADA'
        });
      }

      // Re-check idempotência dentro da transação
      if (uow.movimentacaoComercial?.listar) {
        const movsTx = await uow.movimentacaoComercial.listar({
          consignacaoId: consTx.id,
          correlationId
        });
        const jaFeito = (movsTx || []).some((mov) => {
          const tipo = String(mov.tipoMovimentacao || '').toUpperCase();
          const op = String(mov.snapshot?.contexto?.operacao || '').toUpperCase();
          return tipo === 'ENTREGA' && op === OPERACAO_ENTREGA_COMPLEMENTAR;
        });
        if (jaFeito) {
          const itens = await uow.consignacaoItem.listarPorConsignacao(consTx.id);
          return {
            consignacao: consTx,
            itensNovos: [],
            movimentacoes: movsTx,
            valorIncremental: 0,
            correlationId,
            idempotente: true,
            entregas: montarHistoricoEntregas(movsTx, itens)
          };
        }
      }

      await consumirLimitePerfil(uow, consTx.perfilComercialId, valorIncremental, {
        permitirExcessoAutorizado: liberacaoOk
      });

      // RCM-8.11 — complementação permanece na consignação; Ledger usa o ciclo aberto se houver
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

      const itensNovos = [];
      const movimentacoes = [];
      /** produtoIds cuja linha já existia e só teve quantidade incrementada (UNIQUE consignacao+produto). */
      const produtosIncrementados = new Set();

      for (const linha of linhasPreparadas) {
        const existentes = await uow.consignacaoItem.listarPorConsignacao(consTx.id, {
          produtoId: linha.produtoId
        });
        const existente = (existentes || [])[0] || null;

        let item;
        let quantidadeEvento = linha.quantidade;
        let precoEvento = linha.precoUnitario;
        let unidadeEvento = linha.unidadeComercial;

        if (existente) {
          // UNIQUE(consignacao_id, produto_id): complementar o mesmo produto soma na linha.
          // Snapshot RCM-6.1 da linha (preço/origem/tabela) permanece congelado.
          produtosIncrementados.add(Number(linha.produtoId));
          const qtdAnterior = Number(existente.quantidadeEntregue) || 0;
          const subAnterior = Number(existente.subtotalEntregue) || 0;
          const valorEvento = quantidadeEvento * precoEvento;
          item = await uow.consignacaoItem.atualizar(existente.id, {
            quantidadeEntregue: qtdAnterior + quantidadeEvento,
            subtotalEntregue: subAnterior + valorEvento
          });
          unidadeEvento = existente.unidadeComercial || linha.unidadeComercial;
          item._quantidadeAnterior = qtdAnterior;
          item._quantidadeAtual = qtdAnterior + quantidadeEvento;
        } else {
          item = await uow.consignacaoItem.inserir({
            consignacaoId: consTx.id,
            produtoId: linha.produtoId,
            quantidadeEntregue: linha.quantidade,
            precoUnitario: linha.precoUnitario,
            subtotalEntregue: linha.quantidade * linha.precoUnitario,
            linhaComercialId: linha.linhaComercialId,
            tabelaPrecoId: linha.tabelaPrecoId,
            canalVenda: linha.canalVenda || CANAL_CONSIGNACAO,
            unidadeComercial: linha.unidadeComercial,
            precoOrigem: linha.precoOrigem,
            precoFallback: linha.precoFallback
          });
          precoEvento = item.precoUnitario;
          unidadeEvento = item.unidadeComercial;
          item._quantidadeAnterior = 0;
          item._quantidadeAtual = linha.quantidade;
        }

        // Payload de efeitos (estoque/ledger) sempre com a qtd incremental do evento
        const itemEvento = {
          ...item,
          quantidadeEntregue: quantidadeEvento,
          quantidadeIncremental: quantidadeEvento,
          precoUnitario: precoEvento,
          itemIncrementado: Boolean(existente)
        };
        itensNovos.push(itemEvento);

        const valorItem = Number(quantidadeEvento) * Number(precoEvento);
        const qtdAnteriorSnap = Number(item._quantidadeAnterior || 0);
        const qtdAtualSnap = Number(item._quantidadeAtual || quantidadeEvento);
        const mov = await registrarMovimentacaoComercial(uow, {
          consignacaoId: consTx.id,
          consignacaoItemId: item.id,
          tipoMovimentacao: 'ENTREGA',
          origem,
          correlationId,
          grupoPrestacaoContasId: grupoCiclo?.id ?? null,
          snapshot: {
            ...criarSnapshotConsignacao(consTx, {
              operacao: OPERACAO_ENTREGA_COMPLEMENTAR,
              entregaComplementar: true
            }),
            documento: consTx.documento,
            item: {
              id: item.id,
              produtoId: item.produtoId,
              produtoNome: item.produtoNome || linha.produtoNome || null,
              quantidade: quantidadeEvento,
              quantidadeAnterior: qtdAnteriorSnap,
              delta: quantidadeEvento,
              quantidadeAtual: qtdAtualSnap,
              precoUnitario: precoEvento,
              unidadeComercial: unidadeEvento,
              linhaComercialId: existente
                ? existente.linhaComercialId
                : item.linhaComercialId,
              tabelaPrecoId: existente ? existente.tabelaPrecoId : item.tabelaPrecoId,
              canalVenda: existente
                ? existente.canalVenda
                : item.canalVenda,
              precoOrigem: existente ? existente.precoOrigem : item.precoOrigem,
              precoFallback: existente ? existente.precoFallback : item.precoFallback,
              itemIncrementado: Boolean(existente)
            },
            liberacaoGerencial: liberacaoOk ? {
              autorizado: true,
              autorizadoPor: liberacaoGerencial.autorizadoPor || null,
              auditoriaId: liberacaoGerencial.auditoriaId || null,
              motivo: liberacaoGerencial.motivo || null,
              valorExcedido: liberacaoGerencial.valorExcedido ?? null
            } : null
          },
          usuarioId: entrada.usuarioId ?? null,
          valor: valorItem,
          quantidade: quantidadeEvento,
          motivo: entrada.motivo || entrada.observacao || 'Entrega complementar de consignação',
          detalhes: {
            entregaComplementar: true,
            itemIncrementado: Boolean(existente),
            quantidadeAnterior: qtdAnteriorSnap,
            quantidadeAtual: qtdAtualSnap,
            delta: quantidadeEvento,
            liberacaoGerencial: liberacaoOk ? liberacaoGerencial : null
          }
        });
        movimentacoes.push(mov);
      }

      // Status permanece ENTREGUE — nunca reabre RASCUNHO
      await sincronizarCacheConsignacao(uow, consTx.id);
      const consignacaoAtualizada = await uow.consignacao.buscarPorId(consTx.id);

      // Garantia: snapshot de precificação original intacto; qtd só sobe se foi incremento do mesmo produto
      for (const original of snapshotItensOriginais) {
        const atual = await uow.consignacaoItem.buscarPorId(original.id);
        if (!atual) {
          throw new DomainError('Item da entrega original foi removido indevidamente', {
            codigo: 'ENTREGA_ORIGINAL_ALTERADA'
          });
        }
        const foiIncremento = produtosIncrementados.has(Number(original.produtoId));
        const precoOk = Number(atual.precoUnitario) === Number(original.precoUnitario)
          && String(atual.precoOrigem || '') === String(original.precoOrigem || '')
          && Number(atual.tabelaPrecoId || 0) === Number(original.tabelaPrecoId || 0)
          && Number(atual.linhaComercialId || 0) === Number(original.linhaComercialId || 0);

        if (!precoOk) {
          throw new DomainError('Snapshot da entrega original foi alterado', {
            codigo: 'ENTREGA_ORIGINAL_ALTERADA',
            detalhes: { itemId: original.id }
          });
        }

        if (foiIncremento) {
          if (Number(atual.quantidadeEntregue) < Number(original.quantidadeEntregue)) {
            throw new DomainError('Quantidade da entrega original foi reduzida indevidamente', {
              codigo: 'ENTREGA_ORIGINAL_ALTERADA',
              detalhes: { itemId: original.id }
            });
          }
        } else if (Number(atual.quantidadeEntregue) !== Number(original.quantidadeEntregue)) {
          throw new DomainError('Snapshot da entrega original foi alterado', {
            codigo: 'ENTREGA_ORIGINAL_ALTERADA',
            detalhes: { itemId: original.id }
          });
        }
      }

      await enfileirarBridgeOutbox(outboxEnqueue, {
        eventType: OUTBOX_EVENT_TYPES.ESTOQUE_BAIXAR_PRODUTO,
        bridgeName: OUTBOX_BRIDGE_NAMES.ESTOQUE,
        payload: {
          consignacaoId: consTx.id,
          // quantidadeEntregue nos itensNovos já é a incremental do evento
          itens: itensNovos,
          correlationId,
          entregaComplementar: true
        },
        correlationId,
        requestId: entrada.requestId ?? null
      });

      enfileirarEvento(eventos, EVENTOS_DOMINIO.CONSIGNACAO_ENTREGA_COMPLEMENTAR, consTx.id, {
        consignacao: consignacaoAtualizada,
        itensNovos,
        movimentacoes,
        valorIncremental,
        correlationId,
        entregaComplementar: true,
        liberacaoGerencial: liberacaoOk ? liberacaoGerencial : null
      }, correlationId);

      await sincronizarCreditoComercial(uow, eventos, consignacaoAtualizada || consTx, {
        origem: 'ENTREGA_COMPLEMENTAR',
        correlationId,
        usuarioId: entrada.usuarioId ?? null
      });

      const todasMovs = uow.movimentacaoComercial?.listar
        ? await uow.movimentacaoComercial.listar({ consignacaoId: consTx.id })
        : movimentacoes;
      const todosItens = await uow.consignacaoItem.listarPorConsignacao(consTx.id);
      const entregas = montarHistoricoEntregas(todasMovs, todosItens);

      return {
        consignacao: consignacaoAtualizada || consTx,
        itensNovos,
        movimentacoes,
        valorIncremental,
        correlationId,
        idempotente: false,
        entregas,
        comprovante: obterComprovanteDoHistorico(entregas, correlationId)
      };
    });
  }

  /**
   * @private
   */
  async _validarLimiteIncremental(consignacao, valorIncremental, { liberacaoOk, liberacaoGerencial }) {
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
    if (valorIncremental > limiteDisponivel && !liberacaoOk) {
      throw new PerfilSemLimiteDisponivelError({
        perfilId: perfil.id,
        valorSolicitado: valorIncremental,
        limiteDisponivel,
        motivo: 'Limite comercial insuficiente para a entrega complementar'
      });
    }
  }
}

module.exports = RegistrarEntregaComplementarUseCase;
