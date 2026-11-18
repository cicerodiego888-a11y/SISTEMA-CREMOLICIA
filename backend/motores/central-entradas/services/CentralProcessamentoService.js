/**
 * CentralProcessamentoService — Pipeline oficial: Parser + MIIP + status.
 *
 * Sprint 5: único pipeline de processamento da Central.
 *
 * @class CentralProcessamentoService
 */

const NFeParserService = require('../../../shared/nfe/NFeParserService');
const { enriquecerParseComMiip } = require('../../../shared/nfe/enriquecerParseComMiip');
const ProcessamentoResultadoDTO = require('../contracts/ProcessamentoResultadoDTO');
const {
  DocumentoFiscalStatus,
  STATUS_XML_COMPLETO_LEGADO
} = require('../core/DocumentoFiscalStatus');
const { validarTransicao } = require('../core/MaquinaEstadosDocumento');
const { xmlPossuiNfeCompleta } = require('../core/xmlDocumento');
const { paraDocumentoDetalheDTO } = require('../utils/centralEntradasMapper');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const { resolverDb } = require('../repositories/dbHelpers');
const CentralHistoricoService = require('./CentralHistoricoService');
const { validarProdutosIdentificadosCompra } = require('../../../modules/compras/resolverProdutoItem');

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
    this._validarProdutos = deps.validarProdutos
      ?? ((itens) => validarProdutosIdentificadosCompra(resolverDb(deps.db ?? null), itens));
    this._parser = deps.parser ?? NFeParserService;
    this._enriquecerParseComMiip = deps.enriquecerParseComMiip ?? enriquecerParseComMiip;
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
    let processamentoIniciado = false;

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
      if (statusInicial === DocumentoFiscalStatus.EM_PROCESSAMENTO) {
        const erro = new Error('Documento já está em processamento.');
        erro.statusCode = 409;
        throw erro;
      }

      const statusProcessaveis = [
        DocumentoFiscalStatus.SINCRONIZADA,
        STATUS_XML_COMPLETO_LEGADO,
        DocumentoFiscalStatus.ERRO
      ];
      if (!statusProcessaveis.includes(statusInicial)) {
        const erro = new Error(`Documento não pode ser processado no status ${statusInicial}`);
        erro.statusCode = 400;
        throw erro;
      }

      const transicao = validarTransicao(statusInicial, DocumentoFiscalStatus.EM_PROCESSAMENTO);
      if (!transicao.valido) {
        const erro = new Error(transicao.erro);
        erro.statusCode = 400;
        throw erro;
      }

      etapasConcluidas.push('localizar');

      processamentoIniciado = await this._documentosRepository.iniciarProcessamento(
        documentoId,
        statusInicial,
        {
          detalhe: 'Início do pipeline oficial de processamento',
          usuarioId: opcoes.usuarioId
        }
      );
      if (!processamentoIniciado) {
        const atual = await this._documentosRepository.buscarPorId(documentoId);
        const erro = new Error(atual?.parseJson
          ? 'Documento já processado.'
          : atual?.status === DocumentoFiscalStatus.EM_PROCESSAMENTO
            ? 'Documento já está em processamento.'
            : 'Documento foi alterado por outra operação; atualize e tente novamente.');
        erro.statusCode = 409;
        throw erro;
      }

      await this._historicoService.registrar({
        documentoId,
        statusAnterior: statusInicial,
        statusNovo: DocumentoFiscalStatus.EM_PROCESSAMENTO,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: 'Início do pipeline oficial de processamento'
      });

      etapaAtual = 'parse';
      const parsed = await this._parser.parse(documento.xml);
      etapasConcluidas.push('parse');

      etapaAtual = 'miip';
      const { miipImportacao, possuiPendencias: possuiPendenciasMiip, erroMiip } = await this._enriquecerParseComMiip(parsed);
      const problemasProdutos = await this._validarProdutos(Array.isArray(parsed.itens) ? parsed.itens : []);
      const possuiPendencias = Boolean(possuiPendenciasMiip || problemasProdutos.length);
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
        ? possuiPendenciasMiip
          ? 'MIIP identificou pendências — aguardando Central de Revisão'
          : 'Existem itens sem vínculo válido — aguardando revisão de produtos'
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
      if (!processamentoIniciado && (error.statusCode === 404 || error.statusCode === 409)) {
        throw error;
      }

      const erros = [error.message];
      if (processamentoIniciado) {
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
        } catch (erroRegistro) {
          console.error('[Central Entradas] Falha ao registrar erro do processamento:', erroRegistro);
          erros.push(`Não foi possível registrar o estado de erro: ${erroRegistro.message}`);
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
        erros
      }).toJSON();
    }
  }
}

module.exports = CentralProcessamentoService;
