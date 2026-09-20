/**
 * STAB-06.3 — EmitirNfcePrestacaoUseCase
 *
 * Orquestra apenas: Venda Oficial (criarVendaInterna) → emitirPorVendaId.
 * Não monta XML / SOAP / SEFAZ. Não fecha a prestação.
 *
 * @module motores/motor-comercial/usecases/consignacao/EmitirNfcePrestacaoUseCase
 */

const BaseUseCase = require('../base/BaseUseCase');
const {
  montarPayloadCriarVenda,
  buildResumoFinalPrestacao,
  calcularIntegridadeComercial
} = require('../../../../services/vendas/adapters/PrestacaoVendaAdapter');
const { criarVendaInterna } = require('../../../../services/vendas/criarVendaInterna');
const { emitirPorVendaId } = require('../../../../services/fiscal/emissor');
const { DocumentoInvalidoError } = require('../../domain/errors');
const {
  garantirPrestacaoAberta,
  calcularTotaisPrestacao,
  listarMovimentacoesPrestacao
} = require('./prestacaoOperacaoHelpers');
const { gerarCorrelationId } = require('./consignacaoUseCaseHelpers');
const faturamentoStore = require('../../services/prestacaoFaturamentoStore');
const db = require('../../../../database');

class EmitirNfcePrestacaoUseCase extends BaseUseCase {
  constructor(deps = {}) {
    super(deps);
    this._criarVendaFn = deps.criarVendaFn || criarVendaInterna;
    this._emitirPorVendaId = deps.emitirPorVendaId || emitirPorVendaId;
    this._faturamentoStore = deps.faturamentoStore || faturamentoStore;
    this._vincularOrigem = deps.vincularOrigem || vincularOrigemConsignacao;
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
  }

  async processar(entrada) {
    const correlationId = entrada.correlationId || gerarCorrelationId();
    const uow = this.obterUnitOfWork();
    if (!uow) throw new Error('UnitOfWork não configurado');

    const ctx = await uow.executar(async (tx) => {
      const consignacao = await tx.consignacao.buscarPorId(entrada.consignacaoId);
      const grupo = garantirPrestacaoAberta(consignacao);
      const itens = await tx.consignacaoItem.listarPorConsignacao(consignacao.id);
      const movs = await listarMovimentacoesPrestacao(tx, grupo.id, consignacao.id);
      const totais = calcularTotaisPrestacao(movs, grupo.id);
      return { consignacao, grupo, itens, totais };
    });

    const { consignacao, grupo, itens, totais } = ctx;
    const itensVendidos = (itens || [])
      .filter((i) => Number(i.quantidadeVendida || 0) > 0)
      .map((i) => ({
        produtoId: i.produtoId,
        quantidade: Number(i.quantidadeVendida),
        precoUnitario: Number(i.precoUnitario || 0),
        itemId: i.id
      }));

    const totalVendido = Number(totais.totalVendido || 0);
    const totalRecebido = Number(totais.totalRecebido || 0);
    const integridade = calcularIntegridadeComercial(totalVendido, totalRecebido);
    const resumo = buildResumoFinalPrestacao({
      totalVendido,
      totalRecebido,
      emitirFiscal: true,
      temItensFiscais: itensVendidos.length > 0
    });

    let faturamento = await this._faturamentoStore.obterPorConsignacao(consignacao.id);
    const dtoAtual = this._faturamentoStore.toDto(faturamento);

    // Já autorizada → só reimpressão
    if (dtoAtual.situacaoFiscal === this._faturamentoStore.SITUACAO.AUTORIZADA && dtoAtual.vendaId) {
      return {
        stab: 'STAB-06.3',
        correlationId,
        consignacaoId: consignacao.id,
        grupoPrestacaoId: grupo.id,
        resumo,
        integridade,
        vendaId: dtoAtual.vendaId,
        fiscal: {
          success: true,
          reused: true,
          status: 'autorizada',
          numero: dtoAtual.nfce?.numero,
          chave: dtoAtual.nfce?.chave,
          protocolo: dtoAtual.nfce?.protocolo
        },
        faturamento: dtoAtual,
        mensagem: 'NFC-e já autorizada. Use Visualizar/Reimprimir DANFE.'
      };
    }

    if (totalVendido <= 0.01 || itensVendidos.length === 0) {
      faturamento = await this._faturamentoStore.salvar({
        consignacaoId: consignacao.id,
        grupoPrestacaoId: grupo.id,
        situacaoFiscal: this._faturamentoStore.SITUACAO.NAO_APLICAVEL,
        faturada: true,
        nfceMotivo: 'Sem venda consignada nesta prestação'
      });
      return {
        stab: 'STAB-06.3',
        correlationId,
        consignacaoId: consignacao.id,
        grupoPrestacaoId: grupo.id,
        resumo,
        integridade,
        vendaId: null,
        fiscal: { success: true, status: 'sem_venda' },
        faturamento: this._faturamentoStore.toDto(faturamento),
        mensagem: 'Sem itens vendidos — emissão não aplicável.'
      };
    }

    // Reutilizar venda oficial existente
    let vendaId = dtoAtual.vendaId;
    let vendaCriada = false;

    if (!vendaId) {
      // POST /vendas não emite NFC-e (endpoint dedicado). emitir_fiscal:true
      // faz a venda oficial nascer fiscal (mesmo contrato do PDV Mobile).
      const itensParaEmissao = itensVendidos.map((i) => ({
        ...i,
        quantidade_fiscal: Number(i.quantidadeFiscal ?? i.quantidade_fiscal ?? i.quantidade),
        quantidade_nao_fiscal: Number(i.quantidadeNaoFiscal ?? i.quantidade_nao_fiscal ?? 0)
      }));

      const payload = montarPayloadCriarVenda({
        consignacaoId: consignacao.id,
        prestacaoId: grupo.id,
        grupoPrestacaoId: grupo.id,
        clienteId: consignacao.clienteId,
        itensVendidos: itensParaEmissao,
        totalVendido,
        totalRecebido,
        emitirFiscal: true
      });
      payload.metadata.correlationId = correlationId;
      payload.emitir_fiscal = true;

      const venda = await this._criarVendaFn(payload);
      vendaId = Number(venda.id || venda.venda_id);
      vendaCriada = true;

      await this._vincularOrigem({
        vendaId,
        consignacaoId: consignacao.id,
        grupoPrestacaoId: grupo.id,
        metadata: payload.metadata
      });

      faturamento = await this._faturamentoStore.salvar({
        consignacaoId: consignacao.id,
        grupoPrestacaoId: grupo.id,
        vendaId,
        situacaoFiscal: this._faturamentoStore.SITUACAO.PENDENTE,
        faturada: false
      });
    }

    // Garante itens fiscais em vendas já criadas sem split (retry / legado)
    await promoverItensVendaParaNfce(vendaId);

    // Chama exclusivamente o Motor Fiscal oficial
    let fiscal;
    try {
      fiscal = await this._emitirPorVendaId(vendaId);
    } catch (err) {
      fiscal = {
        success: false,
        status: 'erro',
        message: err.message || 'Falha ao emitir NFC-e'
      };
    }
    const interpretado = interpretarResultadoFiscal(fiscal, this._faturamentoStore);

    faturamento = await this._faturamentoStore.salvar({
      consignacaoId: consignacao.id,
      grupoPrestacaoId: grupo.id,
      vendaId,
      nfceNotaId: interpretado.notaId,
      situacaoFiscal: interpretado.situacaoFiscal,
      faturada: interpretado.faturada,
      nfceChave: interpretado.chave,
      nfceNumero: interpretado.numero != null ? String(interpretado.numero) : null,
      nfceProtocolo: interpretado.protocolo,
      nfceStatus: interpretado.status,
      nfceMotivo: interpretado.motivo
    });

    return {
      stab: 'STAB-06.3.2',
      correlationId,
      consignacaoId: consignacao.id,
      grupoPrestacaoId: grupo.id,
      resumo,
      integridade,
      vendaId,
      vendaCriada,
      nfceNotaId: interpretado.notaId,
      fiscal,
      faturamento: this._faturamentoStore.toDto(faturamento),
      mensagem: interpretado.mensagem
    };
  }
}

function interpretarResultadoFiscal(fiscal = {}, store = faturamentoStore) {
  const status = String(fiscal.status || '').toLowerCase();
  const success = fiscal.success === true || status === 'autorizada' || status === 'sem_itens_fiscais';
  const motivoSoap = extrairMotivoSefaz(fiscal);
  const notaId = fiscal.notaId != null ? Number(fiscal.notaId) : null;

  if (status === 'sem_itens_fiscais') {
    return {
      situacaoFiscal: store.SITUACAO.NAO_APLICAVEL,
      faturada: true,
      notaId: null,
      chave: null,
      numero: null,
      protocolo: null,
      status,
      motivo: fiscal.message || 'Venda sem itens fiscais',
      mensagem: 'Venda oficial criada. NFC-e não necessária (somente não fiscal).'
    };
  }

  if (success && (status === 'autorizada' || fiscal.chave || fiscal.chaveAcesso || fiscal.numero)) {
    return {
      situacaoFiscal: store.SITUACAO.AUTORIZADA,
      faturada: true,
      notaId,
      chave: fiscal.chaveAcesso || fiscal.chave || null,
      numero: fiscal.numero || null,
      protocolo: fiscal.protocolo || fiscal.soap?.protocolo || null,
      status: status || 'autorizada',
      motivo: null,
      mensagem: `NFC-e nº ${fiscal.numero || '—'} autorizada.`
    };
  }

  return {
    situacaoFiscal: store.SITUACAO.REJEITADA,
    faturada: false,
    notaId,
    chave: fiscal.chaveAcesso || fiscal.chave || null,
    numero: fiscal.numero || null,
    protocolo: fiscal.protocolo || null,
    status: status || 'rejeitada',
    motivo: motivoSoap || fiscal.message || 'Rejeição SEFAZ',
    mensagem: motivoSoap || fiscal.message || 'NFC-e rejeitada. Prestação permanece aberta para nova tentativa.'
  };
}

/**
 * STAB-06.3.2 — legado: venda consignada sem split fiscal (qty/valor zerados)
 * não entra na NFC-e (itemEntraNaNfce exige quantidade_fiscal e valor_fiscal > 0).
 */
function promoverItensVendaParaNfce(vendaId) {
  if (!vendaId) return Promise.resolve();
  return new Promise((resolve, reject) => {
    db.get(
      `
      SELECT
        COALESCE(SUM(COALESCE(quantidade_fiscal, 0)), 0) AS qtd_fiscal,
        COALESCE(SUM(COALESCE(valor_fiscal, 0)), 0) AS valor_fiscal,
        COALESCE(SUM(COALESCE(quantidade, 0)), 0) AS qtd_total
      FROM vendas_itens
      WHERE venda_id = ?
      `,
      [Number(vendaId)],
      (err, row) => {
        if (err) return reject(err);
        const qFiscal = Number(row?.qtd_fiscal || 0);
        const vFiscal = Number(row?.valor_fiscal || 0);
        const qTotal = Number(row?.qtd_total || 0);
        if (qTotal <= 0) return resolve();
        if (qFiscal > 0 && vFiscal > 0) return resolve();

        db.run(
          `
          UPDATE vendas_itens
          SET
            quantidade_fiscal = quantidade,
            quantidade_nao_fiscal = 0,
            valor_fiscal = subtotal,
            valor_nao_fiscal = 0,
            item_fiscal = 1
          WHERE venda_id = ?
          `,
          [Number(vendaId)],
          (updErr) => {
            if (updErr) return reject(updErr);
            db.run(
              `
              UPDATE vendas
              SET
                valor_fiscal = (
                  SELECT COALESCE(SUM(valor_fiscal), 0) FROM vendas_itens WHERE venda_id = ?
                ),
                valor_nao_fiscal = (
                  SELECT COALESCE(SUM(valor_nao_fiscal), 0) FROM vendas_itens WHERE venda_id = ?
                )
              WHERE id = ?
              `,
              [Number(vendaId), Number(vendaId), Number(vendaId)],
              (upd2Err) => (upd2Err ? reject(upd2Err) : resolve())
            );
          }
        );
      }
    );
  });
}

function extrairMotivoSefaz(fiscal) {
  const raw = String(
    fiscal?.soap?.raw
    || fiscal?.soap?.message
    || fiscal?.message
    || ''
  );
  const m = raw.match(/<xMotivo>([^<]+)<\/xMotivo>/i);
  return m ? m[1].trim() : null;
}

function vincularOrigemConsignacao({ vendaId, consignacaoId, grupoPrestacaoId, metadata }) {
  if (!vendaId) return Promise.resolve();
  return new Promise((resolve) => {
    db.run(
      `
      CREATE TABLE IF NOT EXISTS venda_origem_consignacao (
        venda_id INTEGER PRIMARY KEY,
        consignacao_id INTEGER NOT NULL,
        grupo_prestacao_id INTEGER,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
      `,
      () => {
        db.run(
          `
          INSERT OR REPLACE INTO venda_origem_consignacao
            (venda_id, consignacao_id, grupo_prestacao_id, metadata_json)
          VALUES (?, ?, ?, ?)
          `,
          [
            Number(vendaId),
            Number(consignacaoId),
            grupoPrestacaoId != null ? Number(grupoPrestacaoId) : null,
            JSON.stringify(metadata || {})
          ],
          () => resolve()
        );
      }
    );
  });
}

module.exports = EmitirNfcePrestacaoUseCase;
