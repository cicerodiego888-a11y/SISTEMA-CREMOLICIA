/**
 * Auditoria de ações do comprovante comercial.
 */

const {
  gravarAuditoria,
  contextoAuditoriaRequisicao
} = require('../../../services/auditoria');
const { detectarOrigemCliente } = require('../../../services/comercialOperacaoLog');
const { obterOuCriarInstanceId } = require('../../../services/sistemaDiagnostico');
const { ACOES_AUDITORIA } = require('../domain/enums');

async function registrarAcaoComprovante(req, {
  acao,
  consignacaoId,
  comprovanteId = null,
  numeroComprovante = null,
  detalhes = {}
} = {}) {
  try {
    const ctx = contextoAuditoriaRequisicao(req);
    const origem = detectarOrigemCliente(req);
    const agora = new Date();
    const acaoNorm = String(acao || '').toLowerCase();
    const acaoValida = Object.values(ACOES_AUDITORIA).includes(acaoNorm)
      ? acaoNorm
      : acaoNorm || ACOES_AUDITORIA.VISUALIZACAO;

    await gravarAuditoria({
      usuario_id: ctx.usuario_id,
      usuario_nome: ctx.usuario_nome,
      modulo: 'comprovantes',
      acao: acaoValida,
      referencia_tipo: 'consignacao',
      referencia_id: consignacaoId != null ? String(consignacaoId) : null,
      detalhes: {
        origem,
        usuario: ctx.usuario_nome,
        data: agora.toISOString().slice(0, 10),
        hora: agora.toTimeString().slice(0, 8),
        consignacaoId,
        comprovanteId,
        numeroComprovante,
        instanceId: obterOuCriarInstanceId(),
        ...detalhes
      },
      ip_requisicao: ctx.ip_requisicao
    });
  } catch (err) {
    console.error('[comprovantes] Falha ao auditar:', err?.message || err);
  }
}

module.exports = { registrarAcaoComprovante };
