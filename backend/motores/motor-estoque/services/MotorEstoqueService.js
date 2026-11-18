/**
 * MCC-04 — MotorEstoqueService
 *
 * API oficial do estoque. Aceita SOMENTE quantidadeBase.
 * Conversão (UC / física / fracionamento) é exclusiva do MCC.
 *
 * Fluxo: Módulo → MCC → quantidadeBase → MotorEstoque → Persistência
 */

const QuantidadeComercialRejeitadaError = require('../domain/QuantidadeComercialRejeitadaError');
const MovimentacaoEstoque = require('../domain/MovimentacaoEstoque');
const {
  OperacaoEstoque,
  OrigemEstoque,
  MOTOR_ESTOQUE_NOME,
  MOTOR_ESTOQUE_VERSAO
} = require('../domain/enums');
const ProdutoSaldoRepository = require('../repositories/ProdutoSaldoRepository');
const EstoqueMovimentacaoRepository = require('../repositories/EstoqueMovimentacaoRepository');
const saldoLocal = require('../repositories/SaldoLocalRepository');

const CAMPOS_COMERCIAIS_PROIBIDOS = [
  'quantidadeComercial',
  'quantidade_comercial',
  'unidadeComercial',
  'unidade_comercial',
  'unidadeOrigem',
  'unidade_origem',
  'fator',
  'fatorConversao',
  'fator_conversao',
  'pesoEmbalagem',
  'peso_embalagem',
  'quantidadeEmbalagens',
  'quantidade_embalagens',
  'quantidadePorEmbalagem',
  'quantidade_por_embalagem'
];

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

class MotorEstoqueService {
  constructor(deps = {}) {
    this.saldoRepo = deps.saldoRepo || ProdutoSaldoRepository;
    this.movRepo = deps.movRepo || EstoqueMovimentacaoRepository;
    this.ajustesEmAndamento = new Map();
  }

  /**
   * Rejeita qualquer payload com dados comerciais / fator.
   */
  _rejeitarCamposComerciais(entrada = {}) {
    for (const campo of CAMPOS_COMERCIAIS_PROIBIDOS) {
      if (entrada[campo] != null && entrada[campo] !== '') {
        throw new QuantidadeComercialRejeitadaError(
          `Campo "${campo}" não é aceito pelo Motor de Estoque. Converta via MCC e informe quantidadeBase.`,
          { campo }
        );
      }
    }
    if (entrada.quantidade != null && entrada.quantidadeBase == null
      && entrada.quantidade_base == null
      && entrada.quantidadeFiscal == null
      && entrada.quantidade_fiscal == null
      && entrada.deltaFiscal == null
      && entrada.ajusteFiscal == null) {
      // "quantidade" ambígua — só aceita se alias explícito quantidadeBase
      // Permitimos quantidade como alias de quantidadeBase se não houver sinal comercial
      // (compatibilidade). Se vier com unidade comercial no mesmo payload, já rejeitado acima.
    }
  }

  _resolverQuantidadeBase(entrada) {
    const q = entrada.quantidadeBase ?? entrada.quantidade_base ?? entrada.quantidade;
    const n = Number(q);
    if (!Number.isFinite(n)) {
      const err = new Error('Informe quantidadeBase (unidade base SSOT).');
      err.status = 400;
      throw err;
    }
    return round3(n);
  }

  _resolverSplitFiscal(entrada, quantidadeBase, sentido = 1) {
    const temFiscal = entrada.quantidadeFiscal != null || entrada.quantidade_fiscal != null
      || entrada.deltaFiscal != null || entrada.ajusteFiscal != null;
    const temNaoFiscal = entrada.quantidadeNaoFiscal != null || entrada.quantidade_nao_fiscal != null
      || entrada.deltaNaoFiscal != null || entrada.ajusteNaoFiscal != null;

    if (temFiscal || temNaoFiscal) {
      const fiscal = Number(
        entrada.quantidadeFiscal
        ?? entrada.quantidade_fiscal
        ?? entrada.deltaFiscal
        ?? entrada.ajusteFiscal
        ?? 0
      );
      const naoFiscal = Number(
        entrada.quantidadeNaoFiscal
        ?? entrada.quantidade_nao_fiscal
        ?? entrada.deltaNaoFiscal
        ?? entrada.ajusteNaoFiscal
        ?? 0
      );
      return {
        quantidadeFiscal: round3(fiscal),
        quantidadeNaoFiscal: round3(naoFiscal),
        quantidadeBase: round3(Math.abs(fiscal) + Math.abs(naoFiscal) || quantidadeBase)
      };
    }

    const abs = Math.abs(quantidadeBase) * sentido;
    if (Number(entrada.itemFiscal ?? entrada.item_fiscal ?? 1) === 0) {
      return {
        quantidadeFiscal: 0,
        quantidadeNaoFiscal: round3(abs),
        quantidadeBase: round3(Math.abs(quantidadeBase))
      };
    }
    return {
      quantidadeFiscal: round3(abs),
      quantidadeNaoFiscal: 0,
      quantidadeBase: round3(Math.abs(quantidadeBase))
    };
  }

  async consultarSaldo(db, produtoId) {
    return this.saldoRepo.buscarSaldo(db, produtoId);
  }

  /**
   * Entrada de estoque — quantidade já convertida pelo MCC.
   */
  async entrar(db, entrada = {}) {
    this._rejeitarCamposComerciais(entrada);
    const produtoId = Number(entrada.produtoId ?? entrada.produto_id);
    if (!Number.isFinite(produtoId)) {
      const err = new Error('produtoId obrigatório.');
      err.status = 400;
      throw err;
    }

    const qtdBase = this._resolverQuantidadeBase(entrada);
    if (!(qtdBase > 0)) {
      const err = new Error('quantidadeBase deve ser > 0 para entrada.');
      err.status = 400;
      throw err;
    }

    const split = this._resolverSplitFiscal(entrada, qtdBase, 1);
    const localMovimentacao = entrada.local || entrada.localCodigo || entrada.local_codigo || null;
    const antes = await this.saldoRepo.buscarSaldo(db, produtoId);
    const depois = await this.saldoRepo.aplicarDeltaSaldo(db, {
      produtoId,
      deltaFiscal: split.quantidadeFiscal,
      deltaNaoFiscal: split.quantidadeNaoFiscal
    });

    const local = await saldoLocal.refletirMovimento(db, {
      produtoId,
      operacao: OperacaoEstoque.ENTRADA,
      origem: entrada.origem,
      local: localMovimentacao,
      deltaFiscal: split.quantidadeFiscal,
      deltaNaoFiscal: split.quantidadeNaoFiscal,
      saldoAntes: antes
    });
    const mov = await this.movRepo.inserirMovimentacao(db, MovimentacaoEstoque.criar({
      produtoId,
      quantidadeBase: split.quantidadeBase,
      quantidadeFiscal: split.quantidadeFiscal,
      quantidadeNaoFiscal: split.quantidadeNaoFiscal,
      operacao: OperacaoEstoque.ENTRADA,
      origem: String(entrada.origem || OrigemEstoque.COMPRA).toUpperCase(),
      local: localMovimentacao,
      loteId: entrada.loteId ?? entrada.lote_id ?? null,
      referenciaTipo: entrada.referenciaTipo || entrada.referencia_tipo || null,
      referenciaId: entrada.referenciaId ?? entrada.referencia_id ?? null,
      saldoAntes: antes.estoqueAtual,
      saldoDepois: depois.estoqueAtual,
      usuarioId: entrada.usuarioId ?? entrada.usuario_id ?? null,
      motivo: entrada.motivo || null
    }));

    return {
      ok: true,
      motor: MOTOR_ESTOQUE_NOME,
      versao: MOTOR_ESTOQUE_VERSAO,
      operacao: OperacaoEstoque.ENTRADA,
      produtoId,
      unidadeBase: antes.unidadeBase,
      quantidadeBase: split.quantidadeBase,
      quantidadeFiscal: split.quantidadeFiscal,
      quantidadeNaoFiscal: split.quantidadeNaoFiscal,
      loteId: mov.loteId,
      saldo: depois,
      local,
      movimentacao: mov.toJSON()
    };
  }

  /**
   * Saída de estoque — quantidade já convertida pelo MCC.
   */
  async sair(db, entrada = {}) {
    this._rejeitarCamposComerciais(entrada);
    const produtoId = Number(entrada.produtoId ?? entrada.produto_id);
    if (!Number.isFinite(produtoId)) {
      const err = new Error('produtoId obrigatório.');
      err.status = 400;
      throw err;
    }

    const qtdBase = this._resolverQuantidadeBase(entrada);
    if (!(qtdBase > 0)) {
      const err = new Error('quantidadeBase deve ser > 0 para saída.');
      err.status = 400;
      throw err;
    }

    const split = this._resolverSplitFiscal(entrada, qtdBase, 1);
    const antes = await this.saldoRepo.buscarSaldo(db, produtoId);

    if (antes.saldoFiscal + 1e-9 < split.quantidadeFiscal) {
      const err = new Error('Saldo fiscal insuficiente.');
      err.status = 400;
      throw err;
    }
    if (antes.saldoNaoFiscal + 1e-9 < split.quantidadeNaoFiscal) {
      const err = new Error('Saldo não fiscal insuficiente.');
      err.status = 400;
      throw err;
    }

    const depois = await this.saldoRepo.aplicarDeltaSaldo(db, {
      produtoId,
      deltaFiscal: -split.quantidadeFiscal,
      deltaNaoFiscal: -split.quantidadeNaoFiscal
    });

    const local = await saldoLocal.refletirMovimento(db, {
      produtoId,
      operacao: OperacaoEstoque.SAIDA,
      origem: entrada.origem,
      local: entrada.local || entrada.localCodigo || entrada.local_codigo,
      deltaFiscal: -split.quantidadeFiscal,
      deltaNaoFiscal: -split.quantidadeNaoFiscal,
      saldoAntes: antes
    });
    const mov = await this.movRepo.inserirMovimentacao(db, MovimentacaoEstoque.criar({
      produtoId,
      quantidadeBase: split.quantidadeBase,
      quantidadeFiscal: -split.quantidadeFiscal,
      quantidadeNaoFiscal: -split.quantidadeNaoFiscal,
      operacao: OperacaoEstoque.SAIDA,
      origem: String(entrada.origem || OrigemEstoque.VENDA).toUpperCase(),
      loteId: entrada.loteId ?? entrada.lote_id ?? null,
      referenciaTipo: entrada.referenciaTipo || entrada.referencia_tipo || null,
      referenciaId: entrada.referenciaId ?? entrada.referencia_id ?? null,
      saldoAntes: antes.estoqueAtual,
      saldoDepois: depois.estoqueAtual,
      usuarioId: entrada.usuarioId ?? entrada.usuario_id ?? null,
      motivo: entrada.motivo || null
    }));

    return {
      ok: true,
      motor: MOTOR_ESTOQUE_NOME,
      versao: MOTOR_ESTOQUE_VERSAO,
      operacao: OperacaoEstoque.SAIDA,
      produtoId,
      unidadeBase: antes.unidadeBase,
      quantidadeBase: split.quantidadeBase,
      quantidadeFiscal: split.quantidadeFiscal,
      quantidadeNaoFiscal: split.quantidadeNaoFiscal,
      loteId: mov.loteId,
      saldo: depois,
      local,
      movimentacao: mov.toJSON()
    };
  }

  /**
   * Ajuste por deltas já em unidade base (UI / consignação).
   */
  async ajustar(db, entrada = {}) {
    const referenciaTipo = entrada.referenciaTipo || entrada.referencia_tipo;
    const referenciaId = entrada.referenciaId ?? entrada.referencia_id;
    const chave = String(referenciaTipo || '').toLowerCase() === 'ajuste_estoque'
      && referenciaId != null
      ? String(referenciaId)
      : null;
    const assinatura = chave ? JSON.stringify([
      Number(entrada.produtoId ?? entrada.produto_id),
      String(entrada.local || entrada.localCodigo || entrada.local_codigo || '').trim().toUpperCase(),
      Number(entrada.deltaFiscal ?? entrada.ajusteFiscal ?? entrada.ajuste_fiscal ?? 0),
      Number(entrada.deltaNaoFiscal ?? entrada.ajusteNaoFiscal ?? entrada.ajuste_nao_fiscal ?? 0),
      String(entrada.motivo || '').trim()
    ]) : null;
    const emAndamento = chave ? this.ajustesEmAndamento.get(chave) : null;
    if (emAndamento) {
      if (emAndamento.assinatura !== assinatura) {
        const err = new Error('A chave de ajuste já está em uso em outra operação.');
        err.status = 409;
        throw err;
      }
      return { ...(await emAndamento.promessa), repetida: true };
    }

    const operacao = this._ajustar(db, entrada);
    if (!chave) return operacao;
    const registro = { promessa: operacao, assinatura };
    this.ajustesEmAndamento.set(chave, registro);
    try {
      return await operacao;
    } finally {
      if (this.ajustesEmAndamento.get(chave) === registro) {
        this.ajustesEmAndamento.delete(chave);
      }
    }
  }

  async _ajustar(db, entrada = {}) {
    this._rejeitarCamposComerciais(entrada);
    const produtoId = Number(entrada.produtoId ?? entrada.produto_id);
    const deltaFiscal = Number(entrada.deltaFiscal ?? entrada.ajusteFiscal ?? entrada.ajuste_fiscal ?? 0);
    const deltaNaoFiscal = Number(
      entrada.deltaNaoFiscal ?? entrada.ajusteNaoFiscal ?? entrada.ajuste_nao_fiscal ?? 0
    );
    const motivo = String(entrada.motivo || '').trim();

    if (!Number.isFinite(produtoId)) {
      const err = new Error('produtoId obrigatório.');
      err.status = 400;
      throw err;
    }
    if (deltaFiscal === 0 && deltaNaoFiscal === 0) {
      const err = new Error('Informe ao menos um delta fiscal ou não fiscal diferente de zero.');
      err.status = 400;
      throw err;
    }
    if (!motivo) {
      const err = new Error('Motivo do ajuste é obrigatório.');
      err.status = 400;
      throw err;
    }

    const referenciaTipo = entrada.referenciaTipo || entrada.referencia_tipo;
    const referenciaId = entrada.referenciaId ?? entrada.referencia_id;
    if (String(referenciaTipo || '').toLowerCase() === 'ajuste_estoque' && referenciaId != null) {
      const movimentoExistente = await new Promise((resolve, reject) => {
        db.get(`
          SELECT * FROM estoque_movimentacoes
          WHERE referencia_tipo = 'ajuste_estoque' AND referencia_id = ?
          LIMIT 1
        `, [referenciaId], (err, row) => (err ? reject(err) : resolve(row || null)));
      });
      if (movimentoExistente) {
        const localSolicitado = String(
          entrada.local || entrada.localCodigo || entrada.local_codigo || ''
        ).trim().toUpperCase();
        const mesmaOperacao = Number(movimentoExistente.produto_id) === produtoId
          && String(movimentoExistente.local || '') === localSolicitado
          && round3(Number(movimentoExistente.quantidade_fiscal))
            === round3(deltaFiscal)
          && round3(Number(movimentoExistente.quantidade_nao_fiscal))
            === round3(deltaNaoFiscal)
          && String(movimentoExistente.motivo || '') === motivo;
        if (!mesmaOperacao) {
          const err = new Error('A chave de ajuste já foi utilizada em outra operação.');
          err.status = 409;
          throw err;
        }

        const saldo = await this.saldoRepo.buscarSaldo(db, produtoId);
        const saldoLocalAtual = localSolicitado
          ? await saldoLocal.consultarSaldoLocal(db, produtoId, localSolicitado)
          : null;
        return {
          ok: true,
          motor: MOTOR_ESTOQUE_NOME,
          operacao: OperacaoEstoque.AJUSTE,
          produtoId,
          unidadeBase: saldo.unidadeBase,
          quantidadeBase: round3(Math.abs(deltaFiscal) + Math.abs(deltaNaoFiscal)),
          saldo,
          local: localSolicitado || null,
          saldo_local: saldoLocalAtual,
          movimentacao: MovimentacaoEstoque.criar(movimentoExistente).toJSON(),
          saldo_fiscal: saldo.saldoFiscal,
          saldo_nao_fiscal: saldo.saldoNaoFiscal,
          estoque_atual: saldo.estoqueAtual,
          repetida: true
        };
      }
    }

    const antes = await this.saldoRepo.buscarSaldo(db, produtoId);
    const sf = round3(antes.saldoFiscal + deltaFiscal);
    const snf = round3(antes.saldoNaoFiscal + deltaNaoFiscal);
    if (sf < 0) {
      const err = new Error('Ajuste fiscal resultaria em saldo fiscal negativo.');
      err.status = 400;
      throw err;
    }
    if (snf < 0) {
      const err = new Error('Ajuste não fiscal resultaria em saldo não fiscal negativo.');
      err.status = 400;
      throw err;
    }

    const localInformado = entrada.local ?? entrada.localCodigo ?? entrada.local_codigo;
    let saldoLocalAntes = null;
    if (localInformado != null && String(localInformado).trim() !== '') {
      const local = String(localInformado).trim().toUpperCase();
      if (![saldoLocal.LOCAL_FABRICA, saldoLocal.LOCAL_LOJA].includes(local)) {
        const err = new Error('Local de estoque inválido.');
        err.status = 400;
        throw err;
      }
      if (!(await saldoLocal.tabelaPronta(db))) {
        const err = new Error('O controle de saldo por local não está disponível.');
        err.status = 500;
        throw err;
      }
      saldoLocalAntes = await saldoLocal.consultarSaldoLocal(db, produtoId, local);
      if (round3(saldoLocalAntes.saldoFiscal + deltaFiscal) < 0) {
        const err = new Error('Ajuste fiscal resultaria em saldo fiscal local negativo.');
        err.status = 400;
        throw err;
      }
      if (round3(saldoLocalAntes.saldoNaoFiscal + deltaNaoFiscal) < 0) {
        const err = new Error('Ajuste não fiscal resultaria em saldo não fiscal local negativo.');
        err.status = 400;
        throw err;
      }
    }

    const depois = await this.saldoRepo.aplicarDeltaSaldo(db, {
      produtoId,
      deltaFiscal,
      deltaNaoFiscal
    });

    let local = null;
    let saldoDepoisLocal = null;
    if (saldoLocalAntes) {
      local = await saldoLocal.refletirMovimento(db, {
        produtoId,
        operacao: OperacaoEstoque.AJUSTE,
        origem: String(entrada.origem || OrigemEstoque.AJUSTE_MANUAL).toUpperCase(),
        local: localInformado,
        deltaFiscal,
        deltaNaoFiscal,
        saldoAntes: antes
      });
      saldoDepoisLocal = await saldoLocal.consultarSaldoLocal(db, produtoId, localInformado);
    }

    const qtdBase = round3(Math.abs(deltaFiscal) + Math.abs(deltaNaoFiscal));
    const mov = await this.movRepo.inserirMovimentacao(db, MovimentacaoEstoque.criar({
      produtoId,
      quantidadeBase: qtdBase,
      quantidadeFiscal: deltaFiscal,
      quantidadeNaoFiscal: deltaNaoFiscal,
      operacao: OperacaoEstoque.AJUSTE,
      origem: String(entrada.origem || OrigemEstoque.AJUSTE_MANUAL).toUpperCase(),
      local,
      loteId: entrada.loteId ?? entrada.lote_id ?? null,
      referenciaTipo: entrada.referenciaTipo || entrada.referencia_tipo || null,
      referenciaId: entrada.referenciaId ?? entrada.referencia_id ?? null,
      saldoAntes: antes.estoqueAtual,
      saldoDepois: depois.estoqueAtual,
      usuarioId: entrada.usuarioId ?? entrada.usuario_id ?? null,
      motivo
    }));

    return {
      ok: true,
      motor: MOTOR_ESTOQUE_NOME,
      operacao: OperacaoEstoque.AJUSTE,
      produtoId,
      unidadeBase: antes.unidadeBase,
      quantidadeBase: qtdBase,
      saldo: depois,
      local,
      saldo_local: saldoDepoisLocal,
      movimentacao: mov.toJSON(),
      saldo_fiscal: depois.saldoFiscal,
      saldo_nao_fiscal: depois.saldoNaoFiscal,
      estoque_atual: depois.estoqueAtual
    };
  }

  /**
   * Inventário: define saldos contados (já em unidade base).
   */
  async inventariar(db, entrada = {}) {
    this._rejeitarCamposComerciais(entrada);
    const produtoId = Number(entrada.produtoId ?? entrada.produto_id);
    const saldoFiscalContado = Number(
      entrada.saldoFiscalContado ?? entrada.saldo_fiscal_contado ?? entrada.saldoFiscal ?? 0
    );
    const saldoNaoFiscalContado = Number(
      entrada.saldoNaoFiscalContado ?? entrada.saldo_nao_fiscal_contado ?? entrada.saldoNaoFiscal ?? 0
    );

    if (!Number.isFinite(produtoId)) {
      const err = new Error('produtoId obrigatório.');
      err.status = 400;
      throw err;
    }
    if (saldoFiscalContado < 0 || saldoNaoFiscalContado < 0) {
      const err = new Error('Saldos de inventário não podem ser negativos.');
      err.status = 400;
      throw err;
    }

    const antes = await this.saldoRepo.buscarSaldo(db, produtoId);
    const deltaFiscal = round3(saldoFiscalContado - antes.saldoFiscal);
    const deltaNaoFiscal = round3(saldoNaoFiscalContado - antes.saldoNaoFiscal);

    if (deltaFiscal === 0 && deltaNaoFiscal === 0) {
      return {
        ok: true,
        motor: MOTOR_ESTOQUE_NOME,
        operacao: OperacaoEstoque.INVENTARIO,
        produtoId,
        unidadeBase: antes.unidadeBase,
        quantidadeBase: 0,
        saldo: antes,
        semAlteracao: true
      };
    }

    const depois = await this.saldoRepo.definirSaldos(db, {
      produtoId,
      saldoFiscal: saldoFiscalContado,
      saldoNaoFiscal: saldoNaoFiscalContado
    });

    const qtdBase = round3(Math.abs(deltaFiscal) + Math.abs(deltaNaoFiscal));
    const mov = await this.movRepo.inserirMovimentacao(db, MovimentacaoEstoque.criar({
      produtoId,
      quantidadeBase: qtdBase,
      quantidadeFiscal: deltaFiscal,
      quantidadeNaoFiscal: deltaNaoFiscal,
      operacao: OperacaoEstoque.INVENTARIO,
      origem: OrigemEstoque.INVENTARIO,
      loteId: entrada.loteId ?? entrada.lote_id ?? null,
      referenciaTipo: entrada.referenciaTipo || 'inventario',
      referenciaId: entrada.referenciaId ?? null,
      saldoAntes: antes.estoqueAtual,
      saldoDepois: depois.estoqueAtual,
      usuarioId: entrada.usuarioId ?? null,
      motivo: entrada.motivo || 'INVENTARIO'
    }));

    return {
      ok: true,
      motor: MOTOR_ESTOQUE_NOME,
      operacao: OperacaoEstoque.INVENTARIO,
      produtoId,
      unidadeBase: antes.unidadeBase,
      quantidadeBase: qtdBase,
      saldo: depois,
      movimentacao: mov.toJSON()
    };
  }

  /**
   * Reserva (quantidade base). Não converte. Não baixa saldo físico nesta sprint —
   * registra reserva ATIVA para consumo futuro pelo módulo chamador.
   */
  async reservar(db, entrada = {}) {
    this._rejeitarCamposComerciais(entrada);
    const produtoId = Number(entrada.produtoId ?? entrada.produto_id);
    const qtdBase = this._resolverQuantidadeBase(entrada);
    if (!(qtdBase > 0)) {
      const err = new Error('quantidadeBase deve ser > 0 para reserva.');
      err.status = 400;
      throw err;
    }

    const saldo = await this.saldoRepo.buscarSaldo(db, produtoId);
    if (saldo.estoqueAtual + 1e-9 < qtdBase) {
      const err = new Error('Saldo insuficiente para reserva.');
      err.status = 400;
      throw err;
    }

    const reserva = await new Promise((resolve, reject) => {
      db.run(
        `
          INSERT INTO estoque_reservas (
            produto_id, quantidade_base, origem, referencia_tipo, referencia_id,
            status, lote_id, usuario_id, created_at
          ) VALUES (?, ?, ?, ?, ?, 'ATIVA', ?, ?, CURRENT_TIMESTAMP)
        `,
        [
          produtoId,
          qtdBase,
          String(entrada.origem || OrigemEstoque.RESERVA).toUpperCase(),
          entrada.referenciaTipo || entrada.referencia_tipo || null,
          entrada.referenciaId ?? entrada.referencia_id ?? null,
          entrada.loteId ?? entrada.lote_id ?? null,
          entrada.usuarioId ?? null
        ],
        function onIns(err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, produtoId, quantidadeBase: qtdBase, status: 'ATIVA' });
        }
      );
    });

    await this.movRepo.inserirMovimentacao(db, MovimentacaoEstoque.criar({
      produtoId,
      quantidadeBase: qtdBase,
      quantidadeFiscal: 0,
      quantidadeNaoFiscal: 0,
      operacao: OperacaoEstoque.RESERVA,
      origem: OrigemEstoque.RESERVA,
      loteId: entrada.loteId ?? null,
      referenciaTipo: entrada.referenciaTipo || null,
      referenciaId: entrada.referenciaId ?? reserva.id,
      saldoAntes: saldo.estoqueAtual,
      saldoDepois: saldo.estoqueAtual,
      usuarioId: entrada.usuarioId ?? null,
      motivo: entrada.motivo || 'RESERVA'
    }));

    return {
      ok: true,
      motor: MOTOR_ESTOQUE_NOME,
      operacao: OperacaoEstoque.RESERVA,
      reservado: true,
      reserva,
      produtoId,
      unidadeBase: saldo.unidadeBase,
      quantidadeBase: qtdBase,
      loteId: entrada.loteId ?? null
    };
  }

  async liberarReserva(db, { reservaId, usuarioId = null } = {}) {
    const reserva = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM estoque_reservas WHERE id = ?`,
        [reservaId],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });
    if (!reserva) {
      const err = new Error('Reserva não encontrada.');
      err.status = 404;
      throw err;
    }
    if (reserva.status !== 'ATIVA') {
      const err = new Error('Reserva já liberada ou inválida.');
      err.status = 400;
      throw err;
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE estoque_reservas SET status = 'LIBERADA', liberada_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [reservaId],
        (err) => (err ? reject(err) : resolve())
      );
    });

    const saldo = await this.saldoRepo.buscarSaldo(db, reserva.produto_id);
    await this.movRepo.inserirMovimentacao(db, MovimentacaoEstoque.criar({
      produtoId: reserva.produto_id,
      quantidadeBase: Number(reserva.quantidade_base),
      operacao: OperacaoEstoque.LIBERACAO_RESERVA,
      origem: OrigemEstoque.RESERVA,
      loteId: reserva.lote_id,
      referenciaId: reservaId,
      saldoAntes: saldo.estoqueAtual,
      saldoDepois: saldo.estoqueAtual,
      usuarioId,
      motivo: 'LIBERACAO_RESERVA'
    }));

    return { ok: true, reservado: false, reservaId, motor: MOTOR_ESTOQUE_NOME };
  }
}

module.exports = MotorEstoqueService;
