/**
 * CentralDfePersistenciaService — Persistência de documentos DF-e na Central de Entradas.
 *
 * Sprint 4: inbox only — sem compras, estoque, financeiro ou MIIP.
 *
 * @class CentralDfePersistenciaService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { xmlPossuiNfeCompleta, classificarXml, CLASSE_XML } = require('../core/xmlDocumento');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const { resolverDb, criarDbHelpers } = require('../repositories/dbHelpers');
const { extrairMetadadosNota } = require('../../../services/fiscal/dfeXmlMetadados');
const { emitirEvento } = require('../utils/centralEventosEmitter');
const { TIPOS_EVENTO } = require('../config/centralEventosTipos');

class CentralDfePersistenciaService {
  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   * @param {import('../repositories/CentralDocumentosRepository')} [deps.documentosRepository]
   * @param {import('../repositories/CentralHistoricoRepository')} [deps.historicoRepository]
   */
  constructor(deps = {}) {
    /** @private */
    this._db = deps.db ?? null;
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository({ db: this._db });
    /** @private */
    this._historicoRepository = deps.historicoRepository
      ?? new CentralHistoricoRepository({ db: this._db });
  }

  /** @private */
  _obterSql() {
    return criarDbHelpers(resolverDb(this._db));
  }

  /**
   * @param {string} chave
   * @returns {Promise<boolean>}
   */
  async existeCompraComChave(chave) {
    if (!chave) return false;

    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      'SELECT id FROM compras WHERE chave_acesso = ? LIMIT 1',
      [chave]
    );

    return Boolean(row);
  }

  /**
   * @param {Object} dados
   * @param {string} dados.xml
   * @param {string} [dados.nsu]
   * @param {string} dados.origem
   * @returns {Promise<{ novo: boolean, duplicado: boolean, ignorado: boolean, documento: Object|null, motivo?: string }>}
   */
  async persistirDocumentoDfe(dados) {
    const metadados = extrairMetadadosNota(dados.xml);
    const chave = metadados.chave;

    if (!chave) {
      return {
        novo: false,
        duplicado: false,
        ignorado: true,
        documento: null,
        motivo: 'XML sem chave de acesso identificável'
      };
    }

    const existente = await this._documentosRepository.buscarPorChave(chave);
    if (existente) {
      const xmlNovoCompleto = xmlPossuiNfeCompleta(dados.xml);
      const xmlAtualCompleto = xmlPossuiNfeCompleta(existente.xml);

      if (!xmlAtualCompleto && xmlNovoCompleto && !existente.parseJson && !existente.compraId) {
        const metadadosCompletos = extrairMetadadosNota(dados.xml);
        const atualizado = await this._documentosRepository.atualizar(existente.id, {
          xml: dados.xml,
          numero: metadadosCompletos.numero || existente.numero,
          serie: metadadosCompletos.serie || existente.serie,
          fornecedor: metadadosCompletos.fornecedor || existente.fornecedor,
          cnpjFornecedor: metadadosCompletos.cnpjFornecedor || existente.cnpjFornecedor,
          dataEmissao: metadadosCompletos.dataEmissao || existente.dataEmissao,
          valorTotal: metadadosCompletos.valorTotal || existente.valorTotal,
          nsu: dados.nsu || existente.nsu,
          status: DocumentoFiscalStatus.SINCRONIZADA,
          statusDetalhe: 'XML completo recuperado sem duplicar documento'
        });

        await this._historicoRepository.inserir({
          documentoId: existente.id,
          statusAnterior: existente.status,
          statusNovo: DocumentoFiscalStatus.SINCRONIZADA,
          detalhe: 'Recuperação de XML — mesmo documento, sem duplicidade'
        });

        await emitirEvento({
          tipo: TIPOS_EVENTO.XML_RECEBIDO,
          origem: dados.origem || 'dfe',
          descricao: 'XML completo recuperado no documento existente',
          resultado: DocumentoFiscalStatus.SINCRONIZADA,
          sucesso: true,
          documentoId: existente.id
        });

        return {
          novo: false,
          duplicado: false,
          recuperado: true,
          ignorado: false,
          documento: atualizado,
          motivo: 'XML recuperado no documento existente'
        };
      }

      return {
        novo: false,
        duplicado: true,
        ignorado: false,
        documento: existente,
        motivo: 'Documento já existente na Central'
      };
    }

    const jaComprada = await this.existeCompraComChave(chave);
    const classeXml = classificarXml(dados.xml);
    const status = jaComprada
      ? DocumentoFiscalStatus.DUPLICADA
      : (classeXml === CLASSE_XML.COMPLETO
        ? DocumentoFiscalStatus.SINCRONIZADA
        : DocumentoFiscalStatus.AGUARDANDO_XML);

    const documento = await this._documentosRepository.inserir({
      chave,
      numero: metadados.numero,
      serie: metadados.serie,
      modelo: metadados.modelo,
      fornecedor: metadados.fornecedor,
      cnpjFornecedor: metadados.cnpjFornecedor,
      dataEmissao: metadados.dataEmissao,
      dataEntrada: metadados.dataEntrada,
      valorTotal: metadados.valorTotal,
      xml: dados.xml,
      nsu: dados.nsu ?? null,
      origem: dados.origem,
      status,
      statusDetalhe: jaComprada
        ? 'NF-e já registrada em compras'
        : (status === DocumentoFiscalStatus.AGUARDANDO_XML
          ? 'Documento localizado no DF-e sem XML completo'
          : null)
    });

    const detalheHistorico = dados.origem === 'consulta_chave'
      ? 'Documento recebido via consulta por chave DF-e'
      : dados.origem === 'upload_manual'
        ? 'Documento recebido via upload manual de XML'
        : status === DocumentoFiscalStatus.AGUARDANDO_XML
        ? 'Documento localizado no DF-e — aguardando XML'
        : 'Documento recebido via Distribuição DF-e';

    await this._historicoRepository.inserir({
      documentoId: documento.id,
      statusAnterior: null,
      statusNovo: status,
      detalhe: detalheHistorico
    });

    if (status === DocumentoFiscalStatus.SINCRONIZADA || status === DocumentoFiscalStatus.AGUARDANDO_XML) {
      const { emitirDocumentoRecebido } = require('../utils/centralEventosEmitter');
      emitirDocumentoRecebido(documento, dados.origem || 'dfe').catch(() => {});
    }

    if (status === DocumentoFiscalStatus.AGUARDANDO_XML) {
      emitirEvento({
        tipo: TIPOS_EVENTO.XML_AGUARDANDO,
        origem: dados.origem || 'dfe',
        descricao: 'Documento localizado sem XML completo',
        resultado: DocumentoFiscalStatus.AGUARDANDO_XML,
        sucesso: true,
        documentoId: documento.id
      }).catch(() => {});
    }

    return {
      novo: status === DocumentoFiscalStatus.SINCRONIZADA || status === DocumentoFiscalStatus.AGUARDANDO_XML,
      duplicado: status === DocumentoFiscalStatus.DUPLICADA,
      ignorado: false,
      aguardandoXml: status === DocumentoFiscalStatus.AGUARDANDO_XML,
      documento
    };
  }
}

module.exports = CentralDfePersistenciaService;
