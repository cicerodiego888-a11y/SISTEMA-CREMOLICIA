/**
 * cancelarVendaInterna — mesmo fluxo de POST /api/vendas/cancelar/:id (cancelarVendaPost):
 * devolve estoque, cancela recebimentos e financeiro, registra vendas_canceladas.
 * Sem HTTP / sem validarCaixaAbertoCancelamentoVenda.
 *
 * @module backend/services/vendas/cancelarVendaInterna
 */

'use strict';

const { cancelarVendaPost } = require('./VendaCancelamentoService');

/**
 * @param {number} vendaId
 * @param {string} motivo
 * @param {{ id?: number, username?: string }} [usuario]
 * @returns {Promise<Object>}
 */
function cancelarVendaInterna(vendaId, motivo, usuario = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = {
      body: { motivo },
      user: { id: usuario.id || null, username: usuario.username || null },
      ip: null
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        if (settled) return this;
        settled = true;
        const code = this.statusCode || 200;
        if (code >= 400 || (data && data.sucesso === false)) {
          const err = new Error((data && (data.mensagem || data.error)) || `Erro HTTP ${code}`);
          err.status = code;
          err.data = data;
          reject(err);
        } else {
          resolve(data);
        }
        return this;
      }
    };
    try {
      cancelarVendaPost(Number(vendaId), motivo, req, res);
    } catch (error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });
}

module.exports = { cancelarVendaInterna };
