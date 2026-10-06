/**
 * Tipos de manifestação do destinatário (DF-e).
 *
 * Operação fiscal própria — não se mistura com o pipeline de processamento da NF-e.
 * Envio automático permanece desabilitado por padrão.
 *
 * @module motores/central-entradas/config/centralManifestacaoTipos
 */

const TIPOS_MANIFESTACAO = Object.freeze({
  CIENCIA_OPERACAO: {
    codigo: '210210',
    nome: 'Ciência da Operação',
    envioAutomaticoPermitido: false
  },
  CONFIRMACAO_OPERACAO: {
    codigo: '210200',
    nome: 'Confirmação da Operação',
    envioAutomaticoPermitido: false
  },
  DESCONHECIMENTO_OPERACAO: {
    codigo: '210220',
    nome: 'Desconhecimento da Operação',
    envioAutomaticoPermitido: false
  },
  OPERACAO_NAO_REALIZADA: {
    codigo: '210240',
    nome: 'Operação não Realizada',
    envioAutomaticoPermitido: false
  }
});

/**
 * @param {string} codigoOuNome
 * @returns {Object|null}
 */
function obterTipoManifestacao(codigoOuNome) {
  const chave = String(codigoOuNome || '').trim();
  if (!chave) return null;

  const porCodigo = Object.values(TIPOS_MANIFESTACAO).find((tipo) => tipo.codigo === chave);
  if (porCodigo) return porCodigo;

  const porChave = TIPOS_MANIFESTACAO[chave.toUpperCase()];
  return porChave || null;
}

module.exports = {
  TIPOS_MANIFESTACAO,
  obterTipoManifestacao
};
