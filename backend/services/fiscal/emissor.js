const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { getFiscalConfig, incrementaNumeroFiscal, setConfiguracao } = require('./configService');
const { carregarCertificadoPfx } = require('./certificateService');
const {
  buildNfceXml
} = require('./xmlBuilder');
const { gerarQRCodeNFCe, obterUrlChaveConsulta } = require('./qrcode');
const { assinarNFe } = require('./signer');
const { montarLote, enviarLote } = require('./soapClient');
const { compactarXml, extrairChaveEProtocoloAutorizados } = require('./utils');
const { validarItensFiscal } = require('./validadorFiscal');
const { gerarDanfeHtml } = require('./danfe');
const { getFiscalSubDir } = require('./paths');

function itemEntraNaNfce(item) {
  return Number(item.quantidade_fiscal || 0) > 0
    && Number(item.valor_fiscal || 0) > 0;
}

console.log('EMISSOR REAL:', __filename);

function salvarDebug(nome, conteudo) {
  const pasta = getFiscalSubDir('debug');
  fs.writeFileSync(path.join(pasta, nome), String(conteudo ?? ''), 'utf8');
}

/**
 * RCF-06 — Carrega venda + itens + pagamentos para emissão.
 * Itens via LEFT JOIN produtos (INNER JOIN ocultava linhas órfãs → qtd_itens=0 falso).
 */
function carregarVenda(vendaId) {
  return new Promise((resolve, reject) => {
    const id = Number(vendaId);
    db.get(`
      SELECT v.*, c.nome as cliente_nome, c.cpf_cnpj as cliente_cpf
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = ?
    `, [id], (err, venda) => {
      if (err) return reject(err);
      if (!venda) return reject(new Error('Venda não encontrada.'));

      db.get(
        'SELECT COUNT(*) AS total FROM vendas_itens WHERE venda_id = ?',
        [id],
        (cntErr, cntRow) => {
          if (cntErr) return reject(cntErr);
          const totalItensPersistidos = Number(cntRow?.total || 0);

          db.all(`
            SELECT
              vi.*,
              p.nome as produto_nome,
              p.ncm as produto_ncm,
              p.cfop,
              p.csosn,
              p.origem,
              p.cest as produto_cest,
              p.codigo_barras as produto_codigo_barras,
              p.unidade,
              p.produto_fracionado,
              p.vendido_por_peso
            FROM vendas_itens vi
            LEFT JOIN produtos p ON p.id = vi.produto_id
            WHERE vi.venda_id = ?
            ORDER BY vi.id
          `, [id], (itErr, itens) => {
            if (itErr) return reject(itErr);

            const carregarTefEVoltar = () => {
              db.get(
                'SELECT * FROM tef_transacoes WHERE venda_id = ? LIMIT 1',
                [id],
                (tefErr, tef) => {
                  if (tefErr) {
                    console.error('Erro ao carregar TEF:', tefErr);
                  }
                  if (tef) {
                    venda.tef = tef;
                  }
                  resolve({
                    venda,
                    itens: itens || [],
                    totalItensPersistidos
                  });
                }
              );
            };

            db.all(`
              SELECT
                forma_pagamento,
                valor,
                tipo_recebimento,
                tef_transacao_id,
                nsu,
                autorizacao
              FROM venda_recebimentos
              WHERE venda_id = ?
                AND status = 'aprovado'
              ORDER BY id
            `, [id], (recErr, recebimentos) => {
              if (recErr) return reject(recErr);

              if (Array.isArray(recebimentos) && recebimentos.length > 0) {
                venda.pagamentos = recebimentos;
                carregarTefEVoltar();
                return;
              }

              db.all(
                'SELECT forma_pagamento, valor FROM venda_pagamentos WHERE venda_id = ?',
                [id],
                (pgErr, pagamentos) => {
                  if (pgErr) return reject(pgErr);
                  venda.pagamentos = pagamentos || [];
                  carregarTefEVoltar();
                }
              );
            });
          });
        }
      );
    });
  });
}

/** RCF-06 — Abortar emissão se a venda não tem itens persistidos. */
function assertVendaComItens(vendaId, itens, totalItensPersistidos) {
  const qtd = Array.isArray(itens) ? itens.length : 0;
  const persistidos = totalItensPersistidos != null
    ? Number(totalItensPersistidos)
    : qtd;

  if (persistidos <= 0 || qtd <= 0) {
    const msg = `[RCF-06] Venda #${vendaId} sem itens persistidos (persistidos=${persistidos}, carregados=${qtd}). Emissão abortada.`;
    console.error(msg);
    const err = new Error(msg);
    err.code = 'RCF06_SEM_ITENS';
    throw err;
  }
}

/**
 * RCF-02 — Persiste NFC-e sempre amarrada a venda_id.
 * Nunca faz UPDATE por chave_acesso global (pode sobrescrever nota de outra venda).
 */
function salvarNota(payload) {
  return new Promise((resolve, reject) => {
    const vendaId = Number(payload.venda_id);
    if (!Number.isFinite(vendaId) || vendaId <= 0) {
      return reject(new Error('[RCF-02] salvarNota: venda_id obrigatório'));
    }

    const chave = String(payload.chave_acesso || '').trim();

    const upsertPorVenda = () => {
      db.get(`
        SELECT id, venda_id, chave_acesso, status
        FROM nfce_notas
        WHERE venda_id = ?
          AND CAST(numero AS INTEGER) = CAST(? AS INTEGER)
          AND CAST(serie AS INTEGER) = CAST(? AS INTEGER)
          AND CAST(ambiente AS INTEGER) = CAST(? AS INTEGER)
        ORDER BY id DESC
        LIMIT 1
      `, [
        vendaId,
        payload.numero,
        payload.serie,
        payload.ambiente
      ], (selectErr, existente) => {
        if (selectErr) return reject(selectErr);

        if (existente) {
          console.log('[RCF-02] salvarNota UPDATE', {
            nota_id: existente.id,
            venda_id: vendaId,
            numero: payload.numero,
            status: payload.status,
            chave: chave || null
          });
          db.run(`
            UPDATE nfce_notas
            SET
              venda_id = ?,
              chave_acesso = ?,
              status = ?,
              xml_enviado = ?,
              xml_retorno = ?,
              protocolo = ?,
              recibo = ?,
              qr_code_url = ?,
              danfe_html = ?,
              updated_at = datetime('now', 'localtime')
            WHERE id = ?
              AND venda_id = ?
          `, [
            vendaId,
            chave || null,
            payload.status,
            payload.xml_enviado || null,
            payload.xml_retorno || null,
            payload.protocolo || null,
            payload.recibo || null,
            payload.qr_code_url || null,
            payload.danfe_html || null,
            existente.id,
            vendaId
          ], function(updateErr) {
            if (updateErr) return reject(updateErr);
            if (!this.changes) {
              return reject(new Error(`[RCF-02] UPDATE nfce_notas id=${existente.id} não afetou venda_id=${vendaId}`));
            }
            resolve(existente.id);
          });
          return;
        }

        console.log('[RCF-02] salvarNota INSERT', {
          venda_id: vendaId,
          numero: payload.numero,
          status: payload.status,
          chave: chave || null
        });
        db.run(`
          INSERT INTO nfce_notas (
            venda_id, numero, serie, chave_acesso, ambiente, status,
            xml_enviado, xml_retorno, protocolo, recibo, qr_code_url, danfe_html,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
        `, [
          vendaId,
          payload.numero,
          payload.serie,
          chave || null,
          payload.ambiente,
          payload.status,
          payload.xml_enviado || null,
          payload.xml_retorno || null,
          payload.protocolo || null,
          payload.recibo || null,
          payload.qr_code_url || null,
          payload.danfe_html || null
        ], function(err) {
          if (err) return reject(err);
          resolve(this.lastID);
        });
      });
    };

    // Se a chave já existe em OUTRA venda, aborta (não sobrescrever)
    if (chave) {
      db.get(`
        SELECT id, venda_id, status
        FROM nfce_notas
        WHERE chave_acesso = ?
        ORDER BY id DESC
        LIMIT 1
      `, [chave], (errChave, rowChave) => {
        if (errChave) return reject(errChave);
        if (rowChave && Number(rowChave.venda_id) !== vendaId) {
          console.error('[RCF-02] chave_acesso já vinculada a outra venda', {
            chave,
            venda_destino: vendaId,
            nota_id: rowChave.id,
            venda_origem: rowChave.venda_id
          });
          return reject(new Error(
            `[RCF-02] Chave NFC-e ${chave} já pertence à venda #${rowChave.venda_id} (nota ${rowChave.id}). ` +
            `Não é permitido sobrescrever para a venda #${vendaId}.`
          ));
        }
        upsertPorVenda();
      });
      return;
    }

    upsertPorVenda();
  });
}

/**
 * RCF-08 — Total de referência da NFC-e = valor FISCAL (nunca o total geral da venda mista).
 */
function resolverTotalFiscalReferencia(venda, itensFiscais = []) {
  if (venda != null && venda.valor_fiscal != null && venda.valor_fiscal !== '') {
    return Number(venda.valor_fiscal);
  }
  const somaItens = (itensFiscais || []).reduce(
    (s, i) => s + Number(i.valor_fiscal || 0),
    0
  );
  if (somaItens > 0) return Number(somaItens.toFixed(2));
  // Fallback legado: venda 100% fiscal sem coluna valor_fiscal
  return Number(venda?.total ?? venda?.valor_total ?? 0);
}

/**
 * RCF-02/RCF-08 / RC4.31 — Compara totais FISCAIS da venda com o XML gerado.
 * Com desconto: vProd = soma itens; vNF = valor_fiscal líquido (obterTotalFiscalFinal).
 * @param {object} venda
 * @param {string} xml
 * @param {{ tolerancia?: number, itensFiscais?: Array }} [opcoes]
 */
function validarConsistenciaVendaXml(venda, xml, { tolerancia = 0.02, itensFiscais = null } = {}) {
  const divergencias = [];
  const xmlStr = String(xml || '');
  const itensRef = Array.isArray(itensFiscais) ? itensFiscais : [];
  const totalFiscalRef = resolverTotalFiscalReferencia(venda, itensRef);
  const totalGeral = Number(venda?.total ?? venda?.valor_total ?? 0);
  const valorNaoFiscal = Number(venda?.valor_nao_fiscal ?? 0);
  const descontoVenda = Number(venda?.desconto || 0);

  const vNF = xmlStr.match(/<vNF>([\d.]+)<\/vNF>/i);
  const totalXml = vNF ? Number(vNF[1]) : null;
  if (totalXml != null && Number.isFinite(totalFiscalRef) && Math.abs(totalXml - totalFiscalRef) > tolerancia) {
    divergencias.push(`Total XML ${totalXml} ≠ valor fiscal ${totalFiscalRef}`);
  }

  const vProdMatch = xmlStr.match(/<ICMSTot>[\s\S]*?<vProd>([\d.]+)<\/vProd>/i);
  const vProdXml = vProdMatch ? Number(vProdMatch[1]) : null;
  const vDescMatch = xmlStr.match(/<ICMSTot>[\s\S]*?<vDesc>([\d.]+)<\/vDesc>/i);
  const vDescXml = vDescMatch ? Number(vDescMatch[1]) : 0;

  // Regressão: XML não pode espelhar o total geral quando há parte não fiscal
  if (
    totalXml != null
    && valorNaoFiscal > tolerancia
    && totalGeral > totalFiscalRef + tolerancia
    && Math.abs(totalXml - totalGeral) <= tolerancia
  ) {
    divergencias.push(`XML usa total geral (${totalGeral}) em vez do fiscal (${totalFiscalRef})`);
  }

  const nItemsXml = (xmlStr.match(/<det\s/gi) || []).length;
  if (nItemsXml === 0) {
    divergencias.push('XML sem itens <det>');
  }
  if (itensRef.length > 0 && nItemsXml !== itensRef.length) {
    divergencias.push(`XML <det>=${nItemsXml} ≠ itens fiscais=${itensRef.length}`);
  }

  const somaItens = itensRef.length
    ? Number(itensRef.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0).toFixed(2))
    : null;

  if (somaItens != null) {
    // RC4.31: com desconto, soma itens = vProd (bruto); valor_fiscal/vNF = líquido
    if (descontoVenda > tolerancia || (vDescXml != null && vDescXml > tolerancia)) {
      if (vProdXml != null && Math.abs(somaItens - vProdXml) > tolerancia) {
        divergencias.push(`Soma itens fiscais ${somaItens} ≠ vProd XML ${vProdXml}`);
      }
    } else if (Math.abs(somaItens - totalFiscalRef) > tolerancia) {
      divergencias.push(`Soma itens fiscais ${somaItens} ≠ valor fiscal ${totalFiscalRef}`);
    }
  }

  return {
    ok: divergencias.length === 0,
    divergencias,
    totalVenda: totalFiscalRef, // compat: campo histórico = total fiscal de referência
    totalFiscal: totalFiscalRef,
    totalGeral,
    valorNaoFiscal,
    totalXml,
    nItemsXml,
    somaItensFiscais: somaItens
  };
}

async function emitirPorVendaId(vendaId) {
  const idNum = Number(vendaId);
  console.log('[RCF-06] ENTROU NO EMISSOR FISCAL', { venda_id: idNum });
  const {
    venda,
    itens: itensBrutos,
    totalItensPersistidos
  } = await carregarVenda(vendaId);

  const produtosResumo = (itensBrutos || []).map((it) => ({
    id: it.id,
    produto_id: it.produto_id,
    nome: it.produto_nome || null,
    qtd: it.quantidade,
    qtd_fiscal: it.quantidade_fiscal,
    valor_fiscal: it.valor_fiscal
  }));

  console.log('[RCF-06] Venda carregada', {
    venda_id: idNum,
    venda_id_registro: Number(venda?.id),
    total: venda?.total ?? venda?.valor_total ?? null,
    data_venda: venda?.data_venda || venda?.created_at || null,
    status_pagamento: venda?.status_pagamento || null,
    qtd_itens: (itensBrutos || []).length,
    qtd_itens_persistidos: totalItensPersistidos,
    qtd_pagamentos: (venda?.pagamentos || []).length,
    pagamentos: (venda?.pagamentos || []).map((p) => ({
      forma: p.forma_pagamento,
      valor: p.valor
    })),
    produtos: produtosResumo
  });

  console.log('[RCF-07.1] Pipeline fiscal', {
    venda_id: idNum,
    itens_carregados: (itensBrutos || []).length,
    itens_persistidos: totalItensPersistidos,
    pagamento: (venda?.pagamentos || []).length,
    total: venda?.total ?? null,
    valor_fiscal: venda?.valor_fiscal ?? null,
    valor_nao_fiscal: venda?.valor_nao_fiscal ?? null,
    canal: venda?.canal_venda || null
  });

  // RCF-06: zero itens → abortar (nunca consultar/reutilizar outra NFC-e)
  assertVendaComItens(idNum, itensBrutos, totalItensPersistidos);

  if (Number(venda.id) !== idNum) {
    throw new Error(`[RCF-06] Venda carregada id=${venda.id} diverge do solicitado id=${idNum}.`);
  }

  let itens = itensBrutos;
  try {
    const KitVendaService = require('../../modules/comercial/kits/KitVendaService');
    itens = await KitVendaService.expandirItensParaFiscal(itensBrutos);
  } catch (err) {
    console.warn('[RCM-05.9] expandirItensParaFiscal:', err?.message || err);
    itens = itensBrutos;
  }

  if (
    venda.status_pagamento &&
    venda.status_pagamento !== 'quitada'
  ) {
    return {
      success: false,
      status: 'aguardando_pagamento',
      message: 'Venda ainda não está totalmente quitada.'
    };
  }

  const itensFiscal = itens.filter(itemEntraNaNfce);
  const itensNaoFiscal = itens.filter((it) => !itemEntraNaNfce(it));
  // RCF-08: DANFE usa somente itens fiscais (comprovante comercial cobre o total)

  if (itensFiscal.length === 0) {
    console.log('[RCF-08] Sem itens fiscais — NFC-e não necessária', {
      venda_id: idNum,
      total_geral: Number(venda?.total || 0),
      valor_fiscal: Number(venda?.valor_fiscal || 0),
      valor_nao_fiscal: Number(venda?.valor_nao_fiscal || 0),
      itens_fiscais: 0,
      itens_nao_fiscais: itensNaoFiscal.length
    });
    return {
      success: true,
      status: 'sem_itens_fiscais',
      message: 'Venda sem itens fiscais. NFC-e não necessária.',
      vendaId: idNum
    };
  }

  console.log('[RCF-08] Distribuição Fiscal × Não Fiscal', {
    venda_id: idNum,
    total_geral: Number(venda?.total || 0),
    valor_fiscal: Number(venda?.valor_fiscal || 0),
    valor_nao_fiscal: Number(venda?.valor_nao_fiscal || 0),
    itens_fiscais: itensFiscal.length,
    itens_nao_fiscais: itensNaoFiscal.length,
    produtos_fiscais: itensFiscal.map((i) => ({
      produto_id: i.produto_id,
      qtd_fiscal: i.quantidade_fiscal,
      valor_fiscal: i.valor_fiscal
    }))
  });

  const notaAutorizada = await new Promise((resolve, reject) => {
    db.get(`
      SELECT *
      FROM nfce_notas
      WHERE venda_id = ?
        AND status = 'autorizada'
      ORDER BY id DESC
      LIMIT 1
    `, [vendaId], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });

  if (notaAutorizada) {
    if (Number(notaAutorizada.venda_id) !== idNum) {
      throw new Error(
        `RCF-06: DANFE pertence a outra venda. esperado=${idNum} obtido=${notaAutorizada.venda_id} nota=${notaAutorizada.id}`
      );
    }
    console.log('[RCF-06] Reutilizando NFC-e autorizada da MESMA venda', {
      venda_id: idNum,
      nota_id: notaAutorizada.id,
      numero: notaAutorizada.numero
    });
    return {
      success: true,
      reused: true,
      status: notaAutorizada.status,
      notaId: notaAutorizada.id,
      vendaId: idNum,
      numero: notaAutorizada.numero,
      chaveAcesso: notaAutorizada.chave_acesso,
      danfeHtml: notaAutorizada.danfe_html
    };
  }

  const notaPendenteAnterior = await new Promise((resolve, reject) => {
    db.get(`
      SELECT *
      FROM nfce_notas
      WHERE venda_id = ?
        AND status IN ('erro_transmissao', 'pendente', 'soap_enviado', 'rejeitada')
      ORDER BY id DESC
      LIMIT 1
    `, [vendaId], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });

  const config = await getFiscalConfig();

  let numero;

  if (notaPendenteAnterior && notaPendenteAnterior.numero) {
    numero = notaPendenteAnterior.numero;
    console.log(`REUTILIZANDO NÚMERO FISCAL DA TENTATIVA ANTERIOR: ${numero}`);
  } else {
    numero = await incrementaNumeroFiscal();
    console.log(`NÚMERO FISCAL GERADO: ${numero} (MAX no banco + 1)`);
  }

  if (!config.nomeEmpresa || !config.cnpj || !config.ie) {
    const notaId = await salvarNota({
      venda_id: vendaId,
      numero,
      serie: config.serie,
      chave_acesso: '',
      ambiente: config.ambiente,
      status: 'configuracao_pendente',
      xml_retorno: 'Preencha nome da empresa, CNPJ e IE nas configurações.'
    });

    return {
      success: false,
      notaId,
      status: 'configuracao_pendente',
      message: 'Configuração fiscal incompleta.'
    };
  }

  if (!config.certificadoPath || !fs.existsSync(config.certificadoPath)) {
    const caminhoInfo = config.certificadoPath || '(não informado)';

    const notaId = await salvarNota({
      venda_id: vendaId,
      numero,
      serie: config.serie,
      chave_acesso: '',
      ambiente: config.ambiente,
      status: 'configuracao_pendente',
      xml_retorno: `Certificado A1/PFX não encontrado em: ${caminhoInfo}`
    });

    return {
      success: false,
      notaId,
      status: 'configuracao_pendente',
      message: `Certificado A1/PFX não encontrado em: ${caminhoInfo}`
    };
  }

  if (!String(config.idCSC || '').trim() || !String(config.tokenCSC || '').trim()) {
    const notaId = await salvarNota({
      venda_id: vendaId,
      numero,
      serie: config.serie,
      chave_acesso: '',
      ambiente: config.ambiente,
      status: 'configuracao_pendente',
      xml_retorno: 'ID CSC e Token CSC são obrigatórios para emitir NFC-e (evitar rejeição 462/459).'
    });

    return {
      success: false,
      notaId,
      status: 'configuracao_pendente',
      message: 'Configure o ID CSC e o Token CSC nas configurações fiscais antes de emitir.'
    };
  }

  const errosFiscais =
    validarItensFiscal(
      itensFiscal,
      config.ambiente
    );
  if (errosFiscais.length > 0) {
    console.warn('Avisos fiscais (homologação):', errosFiscais.join('; '));
  }

  const xmlBase = buildNfceXml({ config, venda, itens: itensFiscal, numero });

  const checkXml = validarConsistenciaVendaXml(venda, xmlBase.xmlSemAssinatura, {
    itensFiscais: itensFiscal
  });
  console.log('[RCF-08] Validação XML', {
    venda_id: Number(vendaId),
    total_geral: checkXml.totalGeral,
    valor_fiscal: checkXml.totalFiscal,
    valor_nao_fiscal: checkXml.valorNaoFiscal,
    itens_fiscais: itensFiscal.length,
    itens_nao_fiscais: itensNaoFiscal.length,
    total_xml: checkXml.totalXml,
    n_det: checkXml.nItemsXml,
    ok: checkXml.ok,
    divergencias: checkXml.divergencias
  });
  console.log('[RCF-02] Consistência Venda×XML', {
    venda_id: Number(vendaId),
    ok: checkXml.ok,
    totalVenda: checkXml.totalVenda,
    totalXml: checkXml.totalXml,
    nItemsXml: checkXml.nItemsXml,
    divergencias: checkXml.divergencias
  });
  if (!checkXml.ok) {
    const msg = `[RCF-08] XML divergente da venda #${vendaId}: ${checkXml.divergencias.join('; ')}`;
    console.error(msg);
    const notaId = await salvarNota({
      venda_id: vendaId,
      numero,
      serie: config.serie,
      chave_acesso: '',
      ambiente: config.ambiente,
      status: 'erro_consistencia',
      xml_enviado: xmlBase.xmlSemAssinatura,
      xml_retorno: msg
    });
    return {
      success: false,
      notaId,
      status: 'erro_consistencia',
      message: msg,
      divergencias: checkXml.divergencias
    };
  }

  let xmlAssinadoFinal = null;
  let qrCodeUrl = '';
  let assinaturaErro = null;
  let certificado = null;

  try {
    salvarDebug('01-xml-nfe-original.xml', xmlBase.xmlSemAssinatura);

    certificado = carregarCertificadoPfx(config.certificadoPath, config.certificadoSenha);

    console.log('ANTES DE CHAMAR assinarNFe');
    console.log('TIPO xmlNfe:', typeof xmlBase.xmlSemAssinatura);
    console.log('TAMANHO xmlNfe:', xmlBase.xmlSemAssinatura ? xmlBase.xmlSemAssinatura.length : 0);
    console.log('CHAVE PRIVADA OK:', !!certificado.privateKeyPem);
    console.log('CERT PEM OK:', !!certificado.certPem);

    salvarDebug('01b-antes-assinatura.txt', [
      `TIPO xmlNfe: ${typeof xmlBase.xmlSemAssinatura}`,
      `TAMANHO xmlNfe: ${xmlBase.xmlSemAssinatura ? xmlBase.xmlSemAssinatura.length : 0}`,
      `CHAVE PRIVADA OK: ${!!certificado.privateKeyPem}`,
      `CERT PEM OK: ${!!certificado.certPem}`
    ].join('\n'));

    const xmlParaAssinar = compactarXml(xmlBase.xmlSemAssinatura);
    salvarDebug('01a-xml-nfe-compactado-antes-assinatura.xml', xmlParaAssinar);

    const assinatura = assinarNFe(
      xmlParaAssinar,
      certificado.privateKeyPem,
      certificado.certPem
    );

    console.log('DEPOIS DE CHAMAR assinarNFe');
    console.log('TAMANHO xmlAssinado:', assinatura.xmlAssinado ? assinatura.xmlAssinado.length : 0);

    salvarDebug('01c-depois-assinatura.txt', [
      `TAMANHO xmlAssinado: ${assinatura.xmlAssinado ? assinatura.xmlAssinado.length : 0}`,
      `DigestValue: ${assinatura.digestValue || ''}`
    ].join('\n'));

    console.log(
      `[FISCAL QR] Fonte CSC: configuracoes.fiscal_id_csc / fiscal_token_csc ` +
        `(sem cache; lido via getFiscalConfig). ` +
        `emitCNPJ=${String(config.cnpj || '').replace(/\D/g, '')} ` +
        `idCSC="${config.idCSC}" token="${config.tokenCSC}" ` +
        `tokenLen=${String(config.tokenCSC || '').length} tpAmb=${config.ambiente}`
    );

    qrCodeUrl = gerarQRCodeNFCe({
      chave: xmlBase.chave,
      ambiente: config.ambiente,
      idCSC: config.idCSC,
      CSC: config.tokenCSC,
      consultaUrl: config.urls?.consultaQr || ''
    });

    salvarDebug(
      '02a-qrcode-sha1-audit.txt',
      [
        `emitCNPJ=${String(config.cnpj || '').replace(/\D/g, '')}`,
        `chave=${xmlBase.chave}`,
        `tpAmb=${config.ambiente}`,
        `idCSC=${config.idCSC}`,
        `CSC=${config.tokenCSC}`,
        `qrCodeUrl=${qrCodeUrl}`
      ].join('\n')
    );

    const urlConsulta = obterUrlChaveConsulta(
      config.ambiente,
      config.urls?.consultaChave || config.urls?.consultaQr || ''
    );

    const infNFeSupl = `<infNFeSupl><qrCode><![CDATA[${qrCodeUrl}]]></qrCode><urlChave>${urlConsulta}</urlChave></infNFeSupl>`;

    // Inserir infNFeSupl antes da assinatura (que deve vir apos infNFe)
    const signatureMatch = assinatura.xmlAssinado.match(/(<Signature[\s>])/);
    if (signatureMatch) {
      xmlAssinadoFinal = assinatura.xmlAssinado.replace(signatureMatch[0], `${infNFeSupl}${signatureMatch[0]}`);
    } else {
      // Fallback: adicionar antes de </NFe>
      xmlAssinadoFinal = assinatura.xmlAssinado.replace('</NFe>', `${infNFeSupl}</NFe>`);
    }

    salvarDebug('02-xml-nfe-assinado.xml', assinatura.xmlAssinado);
    salvarDebug('02b-qrcode-url.txt', qrCodeUrl);
    salvarDebug('02c-infNFeSupl.xml', infNFeSupl);
    salvarDebug('02d-xml-nfe-assinado-final.xml', xmlAssinadoFinal);

    if (!xmlAssinadoFinal.includes('<Signature')) {
      throw new Error('XML final ficou sem Signature.');
    }

    console.log('XML final length:', xmlAssinadoFinal.length);
    console.log('XML includes infNFeSupl:', xmlAssinadoFinal.includes('<infNFeSupl>'));
    console.log('XML includes infNFeSupl xmlns:', xmlAssinadoFinal.includes('<infNFeSupl xmlns'));
    if (!xmlAssinadoFinal.includes('<infNFeSupl')) {
      throw new Error('XML final ficou sem infNFeSupl.');
    }

    if (!xmlAssinadoFinal.includes('<qrCode>') && !xmlAssinadoFinal.includes('<qrCode><![CDATA[')) {
      throw new Error('XML final ficou sem qrCode.');
    }
  } catch (error) {
    assinaturaErro = error;

    salvarDebug(
      '99-erro-assinatura-emissor.txt',
      error && error.stack ? error.stack : String(error)
    );

    console.error('ERRO FINAL CAPTURADO NO EMISSOR:', error);
  }

  const danfeHtml = await gerarDanfeHtml({
    venda: {
      ...venda,
      tpAmb: config.ambiente
    },
    itens: itensFiscal,
    itensFiscal,
    empresa: {
      nome: config.nomeEmpresa,
      cnpj: config.cnpj,
      endereco: config.endereco
    },
    chave: xmlBase.chave,
    numero,
    serie: config.serie,
    qrCodeUrl,
    tributos: xmlBase.valores,
    nota: {
      tpAmb: config.ambiente
    }
  });

  console.log('[RCF-08] DANFE gerado', {
    venda_id: Number(vendaId),
    total_geral: Number(venda?.total || 0),
    valor_fiscal: Number(venda?.valor_fiscal || 0),
    valor_nao_fiscal: Number(venda?.valor_nao_fiscal || 0),
    itens_fiscais: itensFiscal.length,
    itens_nao_fiscais: itensNaoFiscal.length,
    total_xml: checkXml.totalXml,
    total_danfe: Number(venda?.valor_fiscal != null ? venda.valor_fiscal : checkXml.totalFiscal),
    validacao_ok: checkXml.ok
  });

  let status = assinaturaErro ? 'configuracao_pendente' : 'pendente';
  let xmlRetorno = assinaturaErro ? assinaturaErro.message : null;
  let soapResponse = null;
  let chaveAutorizada = xmlBase.chave;

  if (!assinaturaErro) {
    const loteXml = montarLote(xmlAssinadoFinal, String(numero));

    soapResponse = await enviarLote({
      url: config.urls.autorizacao,
      loteXml,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha,
      cUF: config.codigoUf || '23',
      versaoDados: '4.00'
    });

    salvarDebug('05-soap-resposta.json', JSON.stringify(soapResponse, null, 2));
    salvarDebug('06-soap-retorno.xml', String(soapResponse.raw || soapResponse.message || ''));

    const raw = String(soapResponse.raw || soapResponse.message || '');

    if (raw.includes('<cStat>100</cStat>')) {
      status = 'autorizada';

      const authSefaz = extrairChaveEProtocoloAutorizados(raw);
      if (authSefaz?.chaveAcesso) {
        chaveAutorizada = authSefaz.chaveAcesso;
      }

      const protMatch = raw.match(/<nProt>(.*?)<\/nProt>/);
      if (protMatch) {
        soapResponse.protocolo = protMatch[1];
      } else if (authSefaz?.protocolo) {
        soapResponse.protocolo = authSefaz.protocolo;
      }
    } else if (raw.includes('<cStat>539</cStat>')) {
      status = 'rejeitada_duplicidade';

      const match = raw.match(/\[chNFe:(\d{44})\]/);

      if (match) {
        const chave = match[1];
        const numeroDuplicado = Number(chave.substring(25, 34));
        const proximo = numeroDuplicado + 1;

        await setConfiguracao('fiscal_numero_atual', String(proximo));

        console.warn(`Corrigido automaticamente para número ${proximo}`);
      }
    } else if (raw.includes('<cStat>') || /rejeic/i.test(raw)) {
      status = 'rejeitada';
    } else {
      status = soapResponse.status || 'pendente';
    }

    xmlRetorno = raw || null;
  }

  const notaId = await salvarNota({
    venda_id: vendaId,
    numero,
    serie: config.serie,
    chave_acesso: chaveAutorizada,
    ambiente: config.ambiente,
    status,
    xml_enviado: xmlAssinadoFinal,
    xml_retorno: xmlRetorno,
    protocolo: soapResponse?.protocolo || null,
    qr_code_url: qrCodeUrl,
    danfe_html: danfeHtml
  });

  const autorizada = status === 'autorizada';
  let message = null;

  if (assinaturaErro) {
    message = assinaturaErro.message;
  } else if (!autorizada) {
    message = soapResponse?.message || `NFC-e não autorizada (status: ${status}).`;
  }

  console.log('[RCF-06] NFC-e persistida', {
    venda_id: Number(vendaId),
    nota_id: notaId,
    numero,
    status,
    chave: chaveAutorizada,
    total_venda: venda?.total ?? venda?.valor_total ?? null,
    qtd_itens_fiscais: itensFiscal.length
  });

  return {
    success: autorizada,
    notaId,
    vendaId: Number(vendaId),
    status,
    numero,
    chaveAcesso: chaveAutorizada,
    qrCodeUrl,
    danfeHtml,
    message,
    soap: soapResponse
  };
}

module.exports = {
  emitirPorVendaId,
  salvarNota,
  validarConsistenciaVendaXml,
  resolverTotalFiscalReferencia,
  carregarVenda,
  assertVendaComItens,
  itemEntraNaNfce
};