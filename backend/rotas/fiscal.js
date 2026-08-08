const express = require('express');
const router = express.Router();
const db = require('../database');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getFiscalConfig, setConfiguracao } = require('../services/fiscal/configService');
const { carregarCertificadoPfx } = require('../services/fiscal/certificateService');
const { emitirPorVendaId } = require('../services/fiscal/emissor');
const cancelarNfce = require('../services/fiscal/cancelarNfce');
const { gravarAuditoria } = require('../services/auditoria');
const { validarMotivoTexto } = require('../services/validacao/validarMotivoTexto');
const { getFiscalSubDir } = require('../services/fiscal/paths');
const {
  exportarContabilidade,
  limparExportacaoTemporaria
} = require('../services/fiscal/exportarContabilidadeService');

// Middleware para carregar perfil do usuário
function carregarPerfilUsuario(req, res, next) {
  if (!req.user || !req.user.id) {
    return next();
  }

  db.get(
    'SELECT id, username, role, COALESCE(perfil, \'USUARIO\') as perfil FROM usuarios WHERE id = ?',
    [req.user.id],
    (err, usuario) => {
      if (err || !usuario) {
        return next();
      }
      req.user.perfil = usuario.perfil;
      next();
    }
  );
}

const pastaCertificados = getFiscalSubDir('certificados');

function agoraLocalBrasil() {
  const agora = new Date();
  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );
  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');
  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, pastaCertificados);
  },
  filename: (req, file, cb) => {
    cb(null, 'certificado.pfx');
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext !== '.pfx') {
      return cb(new Error('Envie apenas arquivo .pfx'));
    }

    cb(null, true);
  }
});

router.post('/certificado/upload', upload.single('certificado'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum certificado enviado.' });
    }

    const caminhoCompleto = path.resolve(pastaCertificados, 'certificado.pfx');

    await setConfiguracao(
      'fiscal_certificado_path',
      caminhoCompleto,
      'string',
      'Caminho interno do certificado A1'
    );

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'fiscal',
      acao: 'upload_certificado',
      referencia_tipo: 'certificado',
      referencia_id: null,
      detalhes: { path: caminhoCompleto, ip: req.ip || null },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de certificado:', auditErr));

    res.json({
      success: true,
      message: 'Certificado enviado com sucesso.',
      path: caminhoCompleto
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/config', async (req, res) => {
  try {
    const config = await getFiscalConfig({ validarUrls: false });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config', carregarPerfilUsuario, async (req, res) => {
  try {
    const payload = req.body || {};

    // Validação do número NFC-e
    if (payload.fiscal_numero_atual !== undefined) {
      const numeroAtual = parseInt(payload.fiscal_numero_atual);

      if (numeroAtual < 0) {
        return res.status(400).json({
          error: 'Número NFC-e inválido'
        });
      }

      // Proteção: apenas SUPER_ADMIN pode alterar numeração NFC-e
      const usuario = req.user || {};
      if (usuario.perfil !== 'SUPER_ADMIN') {
        gravarAuditoria({
          usuario_id: usuario.id || null,
          usuario_nome: usuario.username || usuario.nome || null,
          modulo: 'fiscal',
          acao: 'tentativa_alterar_numeracao_nfce_negada',
          referencia_tipo: 'nfce',
          referencia_id: null,
          detalhes: {
            numero_solicitado: numeroAtual,
            perfil: usuario.perfil || null,
            ip: req.ip || null
          },
          ip_requisicao: req.ip || null
        }).catch((auditErr) => console.error('Erro ao gravar auditoria fiscal:', auditErr));
        return res.status(403).json({
          error: 'Apenas SUPER ADMIN pode alterar a numeração NFC-e.'
        });
      }

      gravarAuditoria({
        usuario_id: usuario.id || null,
        usuario_nome: usuario.username || usuario.nome || null,
        modulo: 'fiscal',
        acao: 'alterar_numeracao_nfce',
        referencia_tipo: 'nfce',
        referencia_id: null,
        detalhes: { numero_atual: numeroAtual, ip: req.ip || null },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria fiscal:', auditErr));
    }

    const entries = Object.entries(payload);

    for (const [chave, valor] of entries) {
      await setConfiguracao(chave, String(valor ?? ''), 'string', `Configuração fiscal: ${chave}`);
    }

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'fiscal',
      acao: 'atualizar_config_fiscal',
      referencia_tipo: 'configuracao_fiscal',
      referencia_id: null,
      detalhes: { chaves: entries.map(([chave]) => chave), ip: req.ip || null },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria fiscal:', auditErr));

    res.json({ message: 'Configurações fiscais atualizadas com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/config/certificado/testar', async (req, res) => {
  try {
    const { certificadoPath, senha } = req.body;
    const certificado = carregarCertificadoPfx(certificadoPath, senha);
    res.json({
      success: true,
      certBase64Length: certificado.certBase64.length
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/emitir/venda/:vendaId', async (req, res) => {
  try {
    const vendaId = Number(req.params.vendaId);
    const resultado = await emitirPorVendaId(vendaId);

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'fiscal',
      acao: 'emitir_nfce',
      referencia_tipo: 'venda',
      referencia_id: vendaId,
      detalhes: {
        status: resultado?.status || null,
        nota_id: resultado?.notaId || resultado?.id || null,
        venda_id: resultado?.vendaId || vendaId,
        ip: req.ip || null
      },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de emissão NFC-e:', auditErr));

    res.json(resultado);
  } catch (error) {
    console.error('[RCF-06] Erro ao emitir NFC-e:', error);
    const isSemItens = error?.code === 'RCF06_SEM_ITENS'
      || /RCF-06.*sem itens/i.test(String(error?.message || ''));
    res.status(isSemItens ? 409 : 200).json({
      success: false,
      status: isSemItens ? 'venda_sem_itens' : 'erro_emissao',
      message: error?.message || 'Erro ao emitir NFC-e.',
      code: error?.code || null
    });
  }
});

async function enviarComprovanteComercialPosFiscal(req, res) {
  const vendaId = Number(req.params.vendaId);
  const notaId = req.query.notaId != null ? Number(req.query.notaId) : null;
  const {
    gerarComprovanteComercialPosFiscal
  } = require('../services/comercial/ComprovanteComercialPosFiscalService');

  const resultado = await gerarComprovanteComercialPosFiscal(vendaId, { notaId });

  res.setHeader('X-CDS-Venda-Id', String(resultado.vendaId));
  res.setHeader('X-CDS-Nota-Id', String(resultado.notaId));
  res.setHeader('X-CDS-Xml-Immutable', '1');
  res.setHeader('X-CDS-RCF', '10.1');
  res.setHeader('X-CDS-Itens-Banco', String(resultado.qtdItens));
  res.setHeader('X-CDS-Itens-HTML', String(resultado.qtdItensHtml ?? resultado.qtdItens));
  res.setHeader('X-CDS-Total-Banco', String(resultado.total));

  if (req.query.format === 'html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(resultado.html);
  }

  return res.json({
    success: true,
    venda_id: resultado.vendaId,
    nota_id: resultado.notaId,
    total: resultado.total,
    qtd_itens: resultado.qtdItens,
    qtd_itens_html: resultado.qtdItensHtml ?? resultado.qtdItens,
    qtd_det_xml: resultado.qtdDetXml,
    snapshot_dir: resultado.snapshotDir || null,
    itens: resultado.itens || [],
    meta: {
      chave: resultado.carimbo.chave,
      numero: resultado.carimbo.numero,
      serie: resultado.carimbo.serie,
      protocolo: resultado.carimbo.protocolo,
      ambiente: resultado.carimbo.ambiente
    },
    xml_len: resultado.xmlAutorizado.length,
    html: resultado.html
  });
}

// RCF-10 — comprovante comercial pós-autorização (venda completa + carimbo NFC-e)
router.get('/comprovante-comercial/venda/:vendaId', async (req, res) => {
  try {
    await enviarComprovanteComercialPosFiscal(req, res);
  } catch (error) {
    console.error('[RCF-10] Erro comprovante comercial:', error);
    const status = error.status || error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Erro ao gerar comprovante comercial.',
      code: error.code || null
    });
  }
});

// Alias RCF-09 → RCF-10 (compatibilidade)
router.get('/comprovante-remontado/venda/:vendaId', async (req, res) => {
  try {
    await enviarComprovanteComercialPosFiscal(req, res);
  } catch (error) {
    console.error('[RCF-10] Erro comprovante remontado (alias):', error);
    const status = error.status || error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Erro ao remontar comprovante.',
      code: error.code || null
    });
  }
});

router.get('/danfe/venda/:vendaId', (req, res) => {
  const vendaId = Number(req.params.vendaId);
  const notaIdQuery = req.query.notaId != null ? Number(req.query.notaId) : null;

  // RCF-02/RCF-06: preferir notaId explícito; senão última AUTORIZADA da venda (nunca outra venda)
  const sql = notaIdQuery
    ? `
      SELECT n.id, n.venda_id, n.danfe_html, n.chave_acesso, n.protocolo, n.status, n.numero, n.serie
      FROM nfce_notas n
      WHERE n.id = ? AND n.venda_id = ?
      LIMIT 1
    `
    : `
      SELECT n.id, n.venda_id, n.danfe_html, n.chave_acesso, n.protocolo, n.status, n.numero, n.serie
      FROM nfce_notas n
      WHERE n.venda_id = ?
        AND n.status = 'autorizada'
      ORDER BY n.id DESC
      LIMIT 1
    `;
  const params = notaIdQuery ? [notaIdQuery, vendaId] : [vendaId];

  db.get(sql, params, (err, nota) => {
    if (err) {
      console.error('[RCF-06] Erro ao buscar DANFE:', err);
      return res.status(500).send('Erro interno ao buscar DANFE.');
    }

    if (!nota) {
      return res.status(404).send('NFC-e autorizada não encontrada para esta venda.');
    }

    if (Number(nota.venda_id) !== vendaId) {
      console.error('[RCF-06] DANFE pertence a outra venda', {
        esperado: vendaId,
        obtido: nota.venda_id,
        nota_id: nota.id,
        numero: nota.numero
      });
      return res.status(409).send('RCF-06: DANFE pertence a outra venda.');
    }

    if (!nota.danfe_html) {
      return res.status(404).send('DANFE não gerado para esta NFC-e.');
    }

    console.log('[RCF-06] DANFE servido', {
      venda_id: vendaId,
      nota_id: nota.id,
      nota_venda_id: nota.venda_id,
      numero: nota.numero,
      status: nota.status,
      chave: nota.chave_acesso
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-CDS-Venda-Id', String(vendaId));
    res.setHeader('X-CDS-Nota-Id', String(nota.id));
    res.send(nota.danfe_html);
  });
});

router.get('/danfe/nota/:notaId', (req, res) => {
  const notaId = Number(req.params.notaId);
  const vendaIdEsperada = req.query.vendaId != null ? Number(req.query.vendaId) : null;

  db.get(`
    SELECT n.id, n.venda_id, n.danfe_html, n.chave_acesso, n.protocolo, n.status, n.numero, n.serie
    FROM nfce_notas n
    WHERE n.id = ?
    LIMIT 1
  `, [notaId], (err, nota) => {
    if (err) {
      console.error('[RCF-06] Erro ao buscar DANFE por notaId:', err);
      return res.status(500).send('Erro interno ao buscar DANFE.');
    }
    if (!nota || !nota.danfe_html) {
      return res.status(404).send('DANFE não encontrado para esta NFC-e.');
    }

    // RCF-06: se o cliente informou vendaId, a nota DEVE pertencer a ela
    if (vendaIdEsperada != null && Number.isFinite(vendaIdEsperada) && vendaIdEsperada > 0) {
      if (Number(nota.venda_id) !== vendaIdEsperada) {
        console.error('[RCF-06] DANFE pertence a outra venda', {
          esperado: vendaIdEsperada,
          obtido: nota.venda_id,
          nota_id: nota.id,
          numero: nota.numero
        });
        return res.status(409).send('RCF-06: DANFE pertence a outra venda.');
      }
    }

    console.log('[RCF-06] DANFE por notaId', {
      nota_id: nota.id,
      venda_id: nota.venda_id,
      numero: nota.numero,
      venda_id_query: vendaIdEsperada
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-CDS-Venda-Id', String(nota.venda_id || ''));
    res.setHeader('X-CDS-Nota-Id', String(nota.id));
    res.send(nota.danfe_html);
  });
});

/** XML autorizado da NFC-e da venda (amarrado a venda_id). */
router.get('/xml/venda/:vendaId', (req, res) => {
  const vendaId = Number(req.params.vendaId);
  const notaIdQuery = req.query.notaId != null ? Number(req.query.notaId) : null;

  const sql = notaIdQuery
    ? `
      SELECT n.id, n.venda_id, n.numero, n.chave_acesso, n.status,
             n.xml_enviado, n.xml_retorno
      FROM nfce_notas n
      WHERE n.id = ? AND n.venda_id = ?
      LIMIT 1
    `
    : `
      SELECT n.id, n.venda_id, n.numero, n.chave_acesso, n.status,
             n.xml_enviado, n.xml_retorno
      FROM nfce_notas n
      WHERE n.venda_id = ?
        AND n.status = 'autorizada'
      ORDER BY n.id DESC
      LIMIT 1
    `;
  const params = notaIdQuery ? [notaIdQuery, vendaId] : [vendaId];

  db.get(sql, params, (err, nota) => {
    if (err) {
      console.error('[RCF-02] Erro ao buscar XML:', err);
      return res.status(500).json({ error: 'Erro interno ao buscar XML.' });
    }
    if (!nota) {
      return res.status(404).json({ error: 'NFC-e autorizada não encontrada para esta venda.' });
    }
    if (Number(nota.venda_id) !== vendaId) {
      return res.status(409).json({ error: 'XML não pertence à venda informada.' });
    }

    const xml = String(nota.xml_enviado || '').trim()
      || String(nota.xml_retorno || '').trim();
    if (!xml) {
      return res.status(404).json({ error: 'XML não disponível para esta NFC-e.' });
    }

    const download = req.query.download === '1' || req.query.download === 'true';
    const fileName = `nfce-venda-${vendaId}${nota.numero ? '-' + nota.numero : ''}.xml`;

    res.setHeader('X-CDS-Venda-Id', String(vendaId));
    res.setHeader('X-CDS-Nota-Id', String(nota.id));

    if (download) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xml);
    }

    res.json({
      venda_id: vendaId,
      nota_id: nota.id,
      numero: nota.numero,
      chave_acesso: nota.chave_acesso,
      status: nota.status,
      xml
    });
  });
});

function extrairTagXml(xml, tag) {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 'i');
  const match = String(xml || '').match(regex);
  return match ? match[1] : null;
}

function extrairCancelamentoSefaz(xml) {
  const texto = String(xml || '');

  const blocoEventoMatch = texto.match(/<retEvento[\s\S]*?<\/retEvento>/i);
  const blocoEvento = blocoEventoMatch ? blocoEventoMatch[0] : texto;

  return {
    cStatLote: extrairTagXml(texto, 'cStat'),
    xMotivoLote: extrairTagXml(texto, 'xMotivo'),
    cStatEvento: extrairTagXml(blocoEvento, 'cStat'),
    xMotivoEvento: extrairTagXml(blocoEvento, 'xMotivo'),
    protocoloCancelamento: extrairTagXml(blocoEvento, 'nProt'),
    dataCancelamento: extrairTagXml(blocoEvento, 'dhRegEvento')
  };
}

router.post('/notas/:id/cancelar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { justificativa } = req.body || {};

    const validacaoJustificativa = validarMotivoTexto(justificativa);
    if (!validacaoJustificativa.valido) {
      return res.status(400).json({
        error: validacaoJustificativa.erro
      });
    }

    db.get(`
      SELECT *
      FROM nfce_notas
      WHERE id = ?
    `, [id], async (err, nota) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!nota) {
        return res.status(404).json({ error: 'NFC-e não encontrada.' });
      }

      if (!nota.venda_id) {
        return res.status(400).json({
          error: 'NFC-e sem venda vinculada. Não é possível cancelar.'
        });
      }

      db.get(`
        SELECT id, status
        FROM nfce_notas
        WHERE venda_id = ?
          AND status IN ('autorizada', 'cancelamento_rejeitado')
          AND (
            (chave_acesso IS NOT NULL AND chave_acesso <> '')
            OR (xml_retorno IS NOT NULL AND xml_retorno LIKE '%<cStat>100</cStat>%')
          )
        ORDER BY id DESC
        LIMIT 1
      `, [nota.venda_id], async (authErr, notaAutorizada) => {
        if (authErr) {
          return res.status(500).json({ error: authErr.message });
        }

        if (!notaAutorizada) {
          return res.status(400).json({
            error: 'Nenhuma NFC-e autorizada encontrada para esta venda.'
          });
        }

        try {
          const cancelamento = await cancelarNfce(nota.venda_id, justificativa.trim());
          const notaIdAutorizada = cancelamento.notaId;

          const retornoTexto = typeof cancelamento.sefaz === 'string'
            ? cancelamento.sefaz
            : JSON.stringify(cancelamento.sefaz);

          const dadosCancelamento = extrairCancelamentoSefaz(retornoTexto);

          const canceladoComSucesso =
            String(dadosCancelamento.cStatEvento) === '135' ||
            String(dadosCancelamento.cStatEvento) === '136' ||
            String(dadosCancelamento.cStatEvento) === '155';

          const novoStatus = canceladoComSucesso ? 'cancelada' : 'autorizada';

          const resumoCancelamento = `
STATUS CANCELAMENTO: ${novoStatus}
cStatEvento: ${dadosCancelamento.cStatEvento || ''}
xMotivoEvento: ${dadosCancelamento.xMotivoEvento || ''}
protocoloCancelamento: ${dadosCancelamento.protocoloCancelamento || ''}
dataCancelamento: ${dadosCancelamento.dataCancelamento || ''}
justificativa: ${justificativa.trim()}
`;

          db.run(`
            UPDATE nfce_notas
            SET status = ?,
                xml_retorno = COALESCE(xml_retorno, '') || char(10) || ? || char(10) || ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
          `, [novoStatus, resumoCancelamento, retornoTexto, notaIdAutorizada], (updErr) => {
            if (updErr) {
              return res.status(500).json({ error: updErr.message });
            }

            if (!canceladoComSucesso) {
              const motivoRejeicao = dadosCancelamento.xMotivoEvento || 'Cancelamento rejeitado pela SEFAZ.';
              return res.status(400).json({
                success: false,
                error: motivoRejeicao,
                message: motivoRejeicao,
                status: novoStatus,
                chaveAcesso: cancelamento.chaveAcesso,
                retorno: cancelamento.sefaz,
                dadosCancelamento
              });
            }

            res.json({
              success: true,
              message: 'NFC-e cancelada com sucesso.',
              status: novoStatus,
              notaId: notaIdAutorizada,
              chaveAcesso: cancelamento.chaveAcesso,
              protocoloCancelamento: dadosCancelamento.protocoloCancelamento,
              dataCancelamento: dadosCancelamento.dataCancelamento,
              retorno: cancelamento.sefaz,
              dadosCancelamento
            });

            gravarAuditoria({
              usuario_id: req.user?.id || null,
              usuario_nome: req.user?.username || req.user?.nome || null,
              modulo: 'fiscal',
              acao: 'cancelar_nfce',
              referencia_tipo: 'nfce',
              referencia_id: notaIdAutorizada,
              detalhes: {
                venda_id: nota.venda_id,
                justificativa: justificativa.trim(),
                protocolo: dadosCancelamento.protocoloCancelamento || null,
                ip: req.ip || null
              },
              ip_requisicao: req.ip || null
            }).catch((auditErr) => console.error('Erro ao gravar auditoria de cancelamento NFC-e:', auditErr));
          });
        } catch (cancelErr) {
          res.status(500).json({
            error: cancelErr.message
          });
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/notas', (req, res) => {
  const todas = req.query.todas === '1';
  const params = [];
  let where = '';

  if (!todas) {
    const dataHoje = agoraLocalBrasil().split(' ')[0];
    where = ' WHERE DATE(n.created_at) = ? ';
    params.push(dataHoje);
  }

  db.all(`
    SELECT n.*, v.codigo as venda_codigo, v.total as venda_total
    FROM nfce_notas n
    LEFT JOIN vendas v ON v.id = n.venda_id
    ${where}
    ORDER BY n.id DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

router.get('/notas/:id', (req, res) => {
  db.get(`
    SELECT n.*, v.codigo as venda_codigo, v.total as venda_total
    FROM nfce_notas n
    LEFT JOIN vendas v ON v.id = n.venda_id
    WHERE n.id = ?
  `, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'NFC-e não encontrada.' });
    res.json(row);
  });
});

router.post('/exportar-contabilidade', async (req, res) => {
  let resultado = null;

  try {
    const { dataInicial, dataFinal } = req.body || {};
    resultado = await exportarContabilidade({ dataInicial, dataFinal });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${resultado.nomeZip}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Filename, X-Export-Arquivos, X-Export-Resumo');
    res.setHeader('X-Export-Filename', resultado.nomeZip);
    res.setHeader('X-Export-Arquivos', JSON.stringify(resultado.arquivosGerados));
    res.setHeader('X-Export-Resumo', JSON.stringify(resultado.resumo));

    const stream = fs.createReadStream(resultado.caminhoZip);
    stream.on('close', () => limparExportacaoTemporaria(resultado));
    stream.on('error', () => limparExportacaoTemporaria(resultado));
    res.on('close', () => limparExportacaoTemporaria(resultado));
    stream.pipe(res);
  } catch (error) {
    if (resultado) {
      limparExportacaoTemporaria(resultado);
    }

    const status = error.statusCode || 500;
    res.status(status).json({
      error: error.message || 'Erro ao exportar documentos para contabilidade.'
    });
  }
});

module.exports = router;
