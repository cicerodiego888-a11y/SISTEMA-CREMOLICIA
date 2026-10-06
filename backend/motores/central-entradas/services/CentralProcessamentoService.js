/**
 * CentralProcessamentoService — Pipeline oficial: Parser + MIIP + status.
 *
 * Sprint 5: único pipeline de processamento da Central.
 *
 * @class CentralProcessamentoService
 */

const NFeParserService = require('../../../shared/nfe/NFeParserService');
const NFeParserError = require('../../../shared/nfe/errors/NFeParserError');
const { enriquecerParseComMiip } = require('../../../shared/nfe/enriquecerParseComMiip');
const ProcessamentoResultadoDTO = require('../contracts/ProcessamentoResultadoDTO');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { validarTransicao } = require('../core/MaquinaEstadosDocumento');
const { xmlPossuiNfeCompleta } = require('../core/xmlDocumento');
const { paraDocumentoDetalheDTO } = require('../utils/centralEntradasMapper');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoService = require('./CentralHistoricoService');

const ETAPAS_PIPELINE = Object.freeze([
  { codigo: 'localizar', label: 'Localizando documento' },
  { codigo: 'parse', label: 'Parser oficial NF-e' },
  { codigo: 'miip', label: 'Identificação MIIP' },
  { codigo: 'persistir', label: 'Persistindo resultados' },
  { codigo: 'status', label: 'Atualizando status' }
]);

class CentralProcessamentoService {
  /**
   * @param {Object} [deps]
   * @param {import('../repositories/CentralDocumentosRepository')} [deps.documentosRepository]
   * @param {import('./CentralHistoricoService')} [deps.historicoService]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository();
    /** @private */
    this._historicoService = deps.historicoService
      ?? new CentralHistoricoService();
  }

  /**
   * @private
   * @param {number|string} id
   * @param {string} statusAtual
   * @param {string} statusNovo
   * @param {Object} [opcoes]
   */
  async _transicionar(id, statusAtual, statusNovo, opcoes = {}) {
    const validacao = validarTransicao(statusAtual, statusNovo);
    if (!validacao.valido) {
      const erro = new Error(validacao.erro);
      erro.statusCode = 400;
      throw erro;
    }

    await this._documentosRepository.atualizar(id, {
      status: statusNovo,
      statusDetalhe: opcoes.detalhe ?? null,
      usuarioId: opcoes.usuarioId ?? null
    });

    if (statusAtual !== statusNovo) {
      await this._historicoService.registrar({
        documentoId: id,
        statusAnterior: statusAtual,
        statusNovo,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: opcoes.detalhe ?? `Transição: ${statusAtual} → ${statusNovo}`
      });
    }
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async processar(documentoId, opcoes = {}) {
    const etapasConcluidas = [];
    let etapaAtual = ETAPAS_PIPELINE[0].codigo;

    try {
      etapaAtual = 'localizar';
      const documento = await this._documentosRepository.buscarPorId(documentoId);

      if (!documento) {
        const erro = new Error('Documento não encontrado');
        erro.statusCode = 404;
        throw erro;
      }

      if (!documento.xml || !xmlPossuiNfeCompleta(documento.xml)) {
        const erro = new Error('XML não disponível para processamento');
        erro.statusCode = 400;
        throw erro;
      }

      if (documento.parseJson && !opcoes.forcarReprocessamento) {
        const erro = new Error('Documento já processado. Use forcarReprocessamento para reprocessar.');
        erro.statusCode = 409;
        throw erro;
      }

      const statusInicial = documento.status;
      if (statusInicial !== DocumentoFiscalStatus.SINCRONIZADA) {
        const erro = new Error(`Documento não pode ser processado no status ${statusInicial}`);
        erro.statusCode = 400;
        throw erro;
      }

      etapasConcluidas.push('localizar');

      await this._transicionar(documentoId, statusInicial, DocumentoFiscalStatus.EM_PROCESSAMENTO, {
        detalhe: 'Início do pipeline oficial de processamento',
        usuarioId: opcoes.usuarioId
      });

      etapaAtual = 'parse';
      const parsed = await NFeParserService.parse(documento.xml);
      etapasConcluidas.push('parse');

      etapaAtual = 'miip';
      const { miipImportacao, possuiPendencias, erroMiip } = await enriquecerParseComMiip(parsed);
      etapasConcluidas.push('miip');

      etapaAtual = 'persistir';
      const processadoEm = new Date().toISOString();
      const miipResumo = miipImportacao
        ? {
          operacaoId: miipImportacao.operacaoId,
          resumo: miipImportacao.resumo,
          resultados: miipImportacao.resultados
        }
        : null;

      await this._documentosRepository.atualizar(documentoId, {
        parseJson: parsed,
        miipSessaoId: miipImportacao?.operacaoId ?? null,
        miipResumoJson: miipResumo,
        processadoEm
      });
      etapasConcluidas.push('persistir');

      etapaAtual = 'status';
      const statusNovo = possuiPendencias
        ? DocumentoFiscalStatus.AGUARDANDO_REVISAO
        : DocumentoFiscalStatus.PRONTA_PARA_COMPRA;

      const detalheStatus = possuiPendencias
        ? 'MIIP identificou pendências — aguardando Central de Revisão'
        : 'Todos os itens identificados — pronto para Compras';

      if (erroMiip) {
        await this._historicoService.registrar({
          documentoId,
          statusAnterior: DocumentoFiscalStatus.EM_PROCESSAMENTO,
          statusNovo: DocumentoFiscalStatus.EM_PROCESSAMENTO,
          usuarioId: opcoes.usuarioId ?? null,
          detalhe: `MIIP indisponível: ${erroMiip}`
        });
      }

      await this._transicionar(
        documentoId,
        DocumentoFiscalStatus.EM_PROCESSAMENTO,
        statusNovo,
        { detalhe: detalheStatus, usuarioId: opcoes.usuarioId }
      );
      etapasConcluidas.push('status');

      const atualizado = await this._documentosRepository.buscarPorId(documentoId);

      const { emitirDocumentoProcessado } = require('../utils/centralEventosEmitter');
      emitirDocumentoProcessado(atualizado, {
        sucesso: true,
        mensagem: possuiPendencias
          ? 'Processamento concluído com pendências MIIP'
          : 'Processamento concluído',
        origem: 'api'
      }).catch(() => {});

      return ProcessamentoResultadoDTO.create({
        sucesso: true,
        documento: paraDocumentoDetalheDTO(atualizado),
        parse: parsed,
        miipImportacao,
        possuiPendencias,
        proximaAcao: possuiPendencias ? 'revisar_produtos' : 'abrir_compra',
        etapaAtual: 'concluido',
        etapas: ETAPAS_PIPELINE.map((e) => ({
          ...e,
          concluida: etapasConcluidas.includes(e.codigo)
        })),
        mensagem: possuiPendencias
          ? 'Processamento concluído com pendências MIIP'
          : 'Processamento concluído — pronto para Compras'
      }).toJSON();
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 409) {
        throw error;
      }

      if (error instanceof NFeParserError || error.statusCode === 400) {
        try {
          const doc = await this._documentosRepository.buscarPorId(documentoId);
          if (doc?.status === DocumentoFiscalStatus.EM_PROCESSAMENTO) {
            await this._transicionar(
              documentoId,
              DocumentoFiscalStatus.EM_PROCESSAMENTO,
              DocumentoFiscalStatus.ERRO,
              { detalhe: error.message, usuarioId: opcoes.usuarioId }
            );
          }
        } catch {
          // ignora falha ao registrar ERRO
        }
      }

      return ProcessamentoResultadoDTO.create({
        sucesso: false,
        etapaAtual,
        etapas: ETAPAS_PIPELINE.map((e) => ({
          ...e,
          concluida: etapasConcluidas.includes(e.codigo)
        })),
        mensagem: error.message,
        erros: [error.message]
      }).toJSON();
    }
  }
}

module.exports = CentralProcessamentoService;
