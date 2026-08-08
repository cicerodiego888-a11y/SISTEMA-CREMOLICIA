/**
 * Auditoria de operações comerciais com origem Desktop/Mobile (RCM-04.B).
 */

const {
  gravarAuditoria,
  contextoAuditoriaRequisicao
} = require('./auditoria');
const { obterOuCriarInstanceId } = require('./sistemaDiagnostico');

function detectarOrigemCliente(req) {
  const header = String(req?.headers?.['x-cds-client'] || '').trim().toLowerCase();
  if (header === 'mobile') return 'Mobile';
  if (header === 'desktop' || header === 'erp') return 'Desktop';
  const ua = String(req?.headers?.['user-agent'] || '').toLowerCase();
  if (ua.includes('cds-mobile') || ua.includes('mobile')) return 'Mobile';
  const pathHint = String(req?.headers?.referer || req?.headers?.origin || '').toLowerCase();
  if (pathHint.includes('/apps/mobile')) return 'Mobile';
  return 'Desktop';
}

function extrairConsignacaoId(payload, fallbackId = null) {
  if (fallbackId != null && fallbackId !== '') return Number(fallbackId) || fallbackId;
  if (!payload || typeof payload !== 'object') return null;
  return payload.consignacao?.id
    ?? payload.id
    ?? payload.consignacaoId
    ?? payload.dados?.consignacao?.id
    ?? payload.dados?.id
    ?? payload.data?.consignacao?.id
    ?? payload.data?.id
    ?? null;
}

/**
 * Registra log de criação/atualização/entrega/prestação/cancelamento.
 * Nunca propaga erro para não interromper a operação principal.
 */
async function registrarLogOperacaoComercial(req, {
  acao,
  consignacaoId = null,
  detalhes = {}
} = {}) {
  try {
    const ctx = contextoAuditoriaRequisicao(req);
    const origem = detectarOrigemCliente(req);
    const agora = new Date();
    const instanceId = obterOuCriarInstanceId();

    await gravarAuditoria({
      usuario_id: ctx.usuario_id,
      usuario_nome: ctx.usuario_nome,
      modulo: 'comercial',
      acao,
      referencia_tipo: 'consignacao',
      referencia_id: consignacaoId != null ? String(consignacaoId) : null,
      detalhes: {
        origem,
        usuario: ctx.usuario_nome,
        data: agora.toISOString().slice(0, 10),
        hora: agora.toTimeString().slice(0, 8),
        consignacaoId,
        instanceId,
        ...detalhes
      },
      ip_requisicao: ctx.ip_requisicao
    });
  } catch (err) {
    console.error('[RCM-04.B] Falha ao registrar log comercial:', err?.message || err);
  }
}

module.exports = {
  detectarOrigemCliente,
  extrairConsignacaoId,
  registrarLogOperacaoComercial
};
