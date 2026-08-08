/**
 * QR Code do comprovante (validação futura).
 */

const crypto = require('crypto');

async function buildQrCode({ id, numeroComprovante, empresa, versao }) {
  const payload = {
    id,
    numero: numeroComprovante,
    empresa: empresa || null,
    versao: versao || '1.0.0',
    ts: new Date().toISOString()
  };
  const raw = JSON.stringify(payload);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const conteudo = `CDS|ENTREGA|${id}|${numeroComprovante}|${hash.slice(0, 16)}|${versao}`;

  let dataUrl = null;
  try {
    const QRCode = require('qrcode');
    dataUrl = await QRCode.toDataURL(conteudo, { margin: 1, width: 180 });
  } catch (_e) {
    dataUrl = null;
  }

  return {
    id,
    numeroComprovante,
    empresa: empresa || null,
    hash,
    versao: versao || '1.0.0',
    conteudo,
    dataUrl
  };
}

module.exports = { buildQrCode };
