const fs = require('fs');
const forge = require('node-forge');

function isCaCertificate(cert) {
  const bc = cert.getExtension('basicConstraints');
  return !!(bc && bc.cA === true);
}

function isSelfSigned(cert) {
  try {
    return cert.issuer.hash === cert.subject.hash;
  } catch {
    return false;
  }
}

function bytesToHexSafe(value) {
  try {
    return value ? forge.util.bytesToHex(value) : null;
  } catch {
    return null;
  }
}

function carregarCertificadoPfx(certificadoPath, senha) {
  if (!certificadoPath) {
    throw new Error('Caminho do certificado não configurado.');
  }

  if (!fs.existsSync(certificadoPath)) {
    throw new Error(`Certificado não encontrado em: ${certificadoPath}`);
  }

  const pfxBuffer = fs.readFileSync(certificadoPath);
  const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, senha || '');

  let privateKeyPem = '';
  let certPem = '';
  let certBase64 = '';
  let certBundlePem = '';

  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] || [];

  if (!keyBags.length || !keyBags[0]?.key) {
    throw new Error('Chave privada não encontrada no PFX.');
  }

  const keyBag = keyBags[0];
  privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);

  const keyLocalKeyId =
    keyBag.attributes &&
    keyBag.attributes.localKeyId &&
    keyBag.attributes.localKeyId[0]
      ? bytesToHexSafe(keyBag.attributes.localKeyId[0])
      : null;

  const certBags =
    p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ] || [];

  if (!certBags.length) {
    throw new Error('Nenhum certificado encontrado dentro do PFX.');
  }

  const certs = certBags.filter((bag) => bag?.cert);

  let certBagFolha = null;

  if (keyLocalKeyId) {
    certBagFolha = certs.find((bag) => {
      const certLocalKeyId =
        bag.attributes &&
        bag.attributes.localKeyId &&
        bag.attributes.localKeyId[0]
          ? bytesToHexSafe(bag.attributes.localKeyId[0])
          : null;

      return certLocalKeyId && certLocalKeyId === keyLocalKeyId;
    });
  }

  if (!certBagFolha) {
    certBagFolha = certs.find((bag) => {
      const cert = bag.cert;
      if (!cert) return false;
      return !isCaCertificate(cert);
    }) || certs[0];
  }

  if (!certBagFolha || !certBagFolha.cert) {
    throw new Error('Certificado folha não encontrado no PFX.');
  }

  certPem = forge.pki.certificateToPem(certBagFolha.cert);
  certBase64 = forge.util.encode64(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certBagFolha.cert)).getBytes()
  );

  const intermediarios = certs
    .filter((bag) => bag.cert && bag.cert !== certBagFolha.cert)
    .map((bag) => bag.cert)
    .filter((cert) => isCaCertificate(cert) && !isSelfSigned(cert));

  certBundlePem = [certPem, ...intermediarios.map((c) => forge.pki.certificateToPem(c))].join('\n');

  if (!privateKeyPem || !certPem || !certBase64) {
    throw new Error('Não foi possível extrair chave privada e certificado do PFX.');
  }

  return {
    privateKeyPem,
    certPem,
    certBase64,
    certBundlePem,
    certificado: certBagFolha.cert
  };
}

function extrairNomeEmpresaDoCertificado(certificadoPath, senha) {
  try {
    const pfx = carregarCertificadoPfx(certificadoPath, senha);
    const certPem = pfx.certPem;
    const cert = forge.pki.certificateFromPem(certPem);
    
    const subject = cert.subject;
    if (subject && subject.attributes) {
      const cnAttribute = subject.attributes.find(attr => 
        attr.name === 'commonName' || 
        attr.shortName === 'CN' ||
        attr.type === '2.5.4.3'
      );
      
      if (cnAttribute && cnAttribute.value) {
        return cnAttribute.value;
      }
      
      const orgAttribute = subject.attributes.find(attr => 
        attr.name === 'organizationName' || 
        attr.shortName === 'O' ||
        attr.type === '2.5.4.10'
      );
      
      if (orgAttribute && orgAttribute.value) {
        return orgAttribute.value;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Erro ao extrair nome do certificado:', error);
    return null;
  }
}

function extrairCnpjDoSubject(cert) {
  const attrs = cert?.subject?.attributes || [];
  const pares = attrs.map((attr) => ({
    nome: String(attr.shortName || attr.name || ''),
    valor: String(attr.value || '')
  }));

  const cn = pares.find((a) => a.nome === 'CN' || a.nome === 'commonName');
  if (cn) {
    const noCn = cn.valor.match(/:(\d{14})\s*$/) || cn.valor.match(/(\d{14})/);
    if (noCn) return noCn[1];
  }

  for (const attr of pares) {
    const digits = attr.valor.replace(/\D/g, '');
    if (digits.length === 14) return digits;
    const embutido = attr.valor.match(/(\d{14})/);
    if (embutido) return embutido[1];
  }
  return null;
}

function inspecionarCertificadoPfx(certificadoPath, senha) {
  if (!certificadoPath) {
    const erro = new Error('Caminho do certificado não configurado.');
    erro.codigo = 'CERTIFICATE_CONFIGURATION_ERROR';
    throw erro;
  }
  if (!fs.existsSync(certificadoPath)) {
    const erro = new Error(`Certificado não encontrado em: ${certificadoPath}`);
    erro.codigo = 'CERTIFICATE_NOT_FOUND';
    throw erro;
  }

  let pfx;
  try {
    pfx = carregarCertificadoPfx(certificadoPath, senha);
  } catch (error) {
    const erro = new Error(error.message || 'Certificado digital inválido.');
    erro.codigo = /não encontrado/i.test(error.message || '')
      ? 'CERTIFICATE_NOT_FOUND'
      : 'CERTIFICATE_INVALID';
    throw erro;
  }

  const cert = pfx.certificado || (pfx.certPem ? forge.pki.certificateFromPem(pfx.certPem) : null);
  if (!cert) {
    const erro = new Error('Certificado folha não encontrado no PFX.');
    erro.codigo = 'CERTIFICATE_INVALID';
    throw erro;
  }

  const agora = new Date();
  const notAfter = cert.validity?.notAfter || null;
  const notBefore = cert.validity?.notBefore || null;
  const expirado = Boolean(notAfter && agora > notAfter);

  if (expirado) {
    const erro = new Error(`Certificado expirado em ${notAfter.toISOString()}`);
    erro.codigo = 'CERTIFICATE_EXPIRED';
    throw erro;
  }

  return {
    encontrado: true,
    valido: !(notBefore && agora < notBefore),
    expirado: false,
    cnpj: extrairCnpjDoSubject(cert),
    notBefore,
    notAfter,
    caminho: certificadoPath
  };
}

module.exports = {
  carregarCertificadoPfx,
  extrairNomeEmpresaDoCertificado,
  inspecionarCertificadoPfx
};
