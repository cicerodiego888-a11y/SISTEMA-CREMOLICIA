const db = require('../../database');
const { resolverAmbienteNfe, CHAVE_AMBIENTE_NFE } = require('./nfeAmbienteGuard');
const { urlsNfeDaConfiguracao, CHAVES_WS_NFE } = require('./nfeWebServices');

const CHAVES_WS_NFE_TODAS = Object.values(CHAVES_WS_NFE)
  .flatMap((chave) => [`${chave}_homologacao`, `${chave}_producao`]);

function getConfiguracoes(chaves) {
  return new Promise((resolve, reject) => {
    const placeholders = chaves.map(() => '?').join(',');

    db.all(
      `SELECT chave, valor FROM configuracoes WHERE chave IN (${placeholders})`,
      chaves,
      (err, rows) => {
        if (err) return reject(err);

        const map = {};
        rows.forEach((row) => {
          map[row.chave] = row.valor;
        });

        resolve(map);
      }
    );
  });
}

/**
 * Configuração fiscal. `ambiente`/`urls` são da NFC-e (fiscal_ambiente); `ambienteNfe`/`urlsNfe`
 * são da NF-e 55 (fiscal_ambiente_nfe). O núcleo NF-e usa getFiscalConfigNfe.
 */
async function getFiscalConfig({ validarUrls = true, exigirAmbienteNfce = true } = {}) {
  const cfg = await getConfiguracoes([
    'nome_empresa',
    'cnpj',
    'telefone',
    'email',
    'endereco',
    'fiscal_ambiente',
    'fiscal_uf',
    'fiscal_codigo_uf',
    'fiscal_serie',
    'fiscal_numero_atual',
    'fiscal_token_csc',
    'fiscal_id_csc',
    'fiscal_certificado_path',
    'fiscal_certificado_senha',
    'fiscal_regime_tributario',
    'fiscal_ie',
    'fiscal_im',
    'fiscal_cnae',

    'fiscal_csc_qrcode_url_homologacao',
    'fiscal_consulta_chave_url_homologacao',
    'fiscal_ws_autorizacao_homologacao',
    'fiscal_ws_retorno_homologacao',
    'fiscal_ws_status_homologacao',

    'fiscal_csc_qrcode_url_producao',
    'fiscal_consulta_chave_url_producao',
    'fiscal_ws_autorizacao_producao',
    'fiscal_ws_retorno_producao',
    'fiscal_ws_status_producao',

    'fiscal_tp_imp',
    'fiscal_municipio_codigo',
    'fiscal_municipio_nome',
    'fiscal_uf_sigla',
    'fiscal_emitente_cep',
    'fiscal_emitente_logradouro',
    'fiscal_emitente_numero',
    'fiscal_emitente_bairro',

    'nome_fantasia',
    'razao_social',
    'fiscal_serie_nfe',
    'fiscal_numero_atual_nfe',
    CHAVE_AMBIENTE_NFE,
    ...CHAVES_WS_NFE_TODAS
  ]);

  const cfgLog = { ...cfg };
  if (cfgLog.fiscal_certificado_senha) cfgLog.fiscal_certificado_senha = '***';
  if (cfgLog.fiscal_token_csc) cfgLog.fiscal_token_csc = '***';
  console.log('[FISCAL CONFIG] Configurações carregadas:', JSON.stringify(cfgLog, null, 2));

  if (exigirAmbienteNfce && !cfg.fiscal_ambiente) {
    throw new Error('Ambiente fiscal não configurado. Selecione Produção ou Homologação.');
  }

  const ambienteFiscal = Number(cfg.fiscal_ambiente);

  console.log('[FISCAL CONFIG] Ambiente fiscal:', ambienteFiscal);

  if (exigirAmbienteNfce && ![1, 2].includes(ambienteFiscal)) {
    throw new Error('Ambiente fiscal inválido. Escolha 1 Produção ou 2 Homologação.');
  }

  const urlsHomologacao = {
    autorizacao: cfg.fiscal_ws_autorizacao_homologacao || '',
    retorno: cfg.fiscal_ws_retorno_homologacao || '',
    status: cfg.fiscal_ws_status_homologacao || '',
    consultaQr: cfg.fiscal_csc_qrcode_url_homologacao || '',
    consultaChave: cfg.fiscal_consulta_chave_url_homologacao || ''
  };

  const urlsProducao = {
    autorizacao: cfg.fiscal_ws_autorizacao_producao || '',
    retorno: cfg.fiscal_ws_retorno_producao || '',
    status: cfg.fiscal_ws_status_producao || '',
    consultaQr: cfg.fiscal_csc_qrcode_url_producao || '',
    consultaChave: cfg.fiscal_consulta_chave_url_producao || ''
  };

  const urlsSelecionadas = ambienteFiscal === 1 ? urlsProducao : urlsHomologacao;

  const ambienteNfe = resolverAmbienteNfe(cfg);
  const urlsNfe = urlsNfeDaConfiguracao(cfg, ambienteNfe.ambiente);

  if (validarUrls && !urlsSelecionadas.autorizacao) {
    throw new Error(
      ambienteFiscal === 1
        ? 'URL de autorização em PRODUÇÃO não configurada.'
        : 'URL de autorização em HOMOLOGAÇÃO não configurada.'
    );
  }

  return {
    ambiente: ambienteFiscal,
    uf: cfg.fiscal_uf_sigla || cfg.fiscal_uf || 'CE',
    codigoUf: String(cfg.fiscal_codigo_uf || '23'),
    serie: Number(cfg.fiscal_serie || 1),
    numeroAtual: Number(cfg.fiscal_numero_atual || 1),
    serieNfe: Number(cfg.fiscal_serie_nfe || cfg.fiscal_serie || 1),
    numeroAtualNfe: Number(cfg.fiscal_numero_atual_nfe || 0),
    // CSC sempre da configuração oficial (sem default/hardcode de ID ou token).
    tokenCSC: String(cfg.fiscal_token_csc || '').trim(),
    idCSC: String(cfg.fiscal_id_csc || '').trim(),
    certificadoPath: cfg.fiscal_certificado_path || '',
    certificadoSenha: cfg.fiscal_certificado_senha || '',
    crt: String(cfg.fiscal_regime_tributario || '1'),
    ie: cfg.fiscal_ie || '',
    im: cfg.fiscal_im || '',
    cnae: cfg.fiscal_cnae || '',
    nomeEmpresa: cfg.nome_empresa || '',
    nomeFantasia: cfg.nome_fantasia || cfg.nome_empresa || '',
    razaoSocial: cfg.razao_social || cfg.nome_empresa || '',
    cnpj: cfg.cnpj || '',
    telefone: cfg.telefone || '',
    email: cfg.email || '',
    endereco: cfg.endereco || '',
    municipioCodigo: String(cfg.fiscal_municipio_codigo || '2307304'),
    municipioNome: cfg.fiscal_municipio_nome || 'Juazeiro do Norte',
    cep: cfg.fiscal_emitente_cep || '',
    logradouro: cfg.fiscal_emitente_logradouro || '',
    numeroEndereco: cfg.fiscal_emitente_numero || 'S/N',
    bairro: cfg.fiscal_emitente_bairro || '',
    tpImp: Number(cfg.fiscal_tp_imp || 4),

    urls: urlsSelecionadas,
    urlsHomologacao,
    urlsProducao,
    ambienteNfe: ambienteNfe.ambiente,
    ambienteNfeOrigem: ambienteNfe.origem,
    urlsNfe
  };
}

/**
 * Configuração do núcleo NF-e 55: `ambiente` = fiscal_ambiente_nfe (null se inválido, bloqueado
 * pelo nfeAmbienteGuard) e `urlsNfe` do mesmo ambiente. `ambienteNfce` = fiscal_ambiente.
 */
async function getFiscalConfigNfe() {
  const config = await getFiscalConfig({ validarUrls: false, exigirAmbienteNfce: false });
  return {
    ...config,
    ambiente: config.ambienteNfe,
    ambienteNfce: Number.isFinite(config.ambiente) ? config.ambiente : null
  };
}

function setConfiguracao(chave, valor, tipo = 'string', descricao = '') {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(chave) DO UPDATE SET
        valor = excluded.valor,
        tipo = excluded.tipo,
        descricao = excluded.descricao,
        updated_at = CURRENT_TIMESTAMP
    `, [chave, valor, tipo, descricao], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function incrementaNumeroFiscal() {
  const cfg = await getConfiguracoes([
    'fiscal_numero_atual',
    'fiscal_serie',
    'fiscal_ambiente'
  ]);

  const numeroConfig = Number(cfg.fiscal_numero_atual || 1);
  const serie = Number(cfg.fiscal_serie || 1);
  const ambiente = Number(cfg.fiscal_ambiente || 2);

  return new Promise((resolve, reject) => {
    // RCF-02: lock de escrita para reduzir corrida de numeração
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (begErr) => {
        if (begErr) return reject(begErr);

        db.get(`
          SELECT MAX(CAST(numero AS INTEGER)) AS maior
          FROM nfce_notas
          WHERE CAST(serie AS INTEGER) = ?
            AND CAST(ambiente AS INTEGER) = ?
        `, [serie, ambiente], (err, row) => {
          if (err) {
            db.run('ROLLBACK', () => reject(err));
            return;
          }

          const maiorBanco = Number(row?.maior || 0);
          const numeroSeguro = Math.max(numeroConfig, maiorBanco + 1);

          db.run(`
            INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
            VALUES (?, ?, 'number', 'Próximo número NFC-e', CURRENT_TIMESTAMP)
            ON CONFLICT(chave) DO UPDATE SET
              valor = excluded.valor,
              tipo = excluded.tipo,
              descricao = excluded.descricao,
              updated_at = CURRENT_TIMESTAMP
          `, [ 'fiscal_numero_atual', String(numeroSeguro + 1) ], (upErr) => {
            if (upErr) {
              db.run('ROLLBACK', () => reject(upErr));
              return;
            }
            db.run('COMMIT', (cmtErr) => {
              if (cmtErr) return reject(cmtErr);
              console.log(`[RCF-02] Número usado: ${numeroSeguro} → próximo ${numeroSeguro + 1}`);
              resolve(numeroSeguro);
            });
          });
        });
      });
    });
  });
}

/**
 * Chaves NF-e modelo 55. Só cria as ausentes: nunca sobrescreve valor já configurado
 * (inclusive fiscal_ambiente, que é da NFC-e).
 */
const CONFIG_NFE_PADRAO = [
  ['fiscal_serie_nfe', '1', 'number', 'Série da NF-e modelo 55'],
  ['fiscal_numero_atual_nfe', '1', 'number', 'Próximo número da NF-e modelo 55'],
  ['fiscal_ambiente', '2', 'number', 'Ambiente fiscal (1 Produção, 2 Homologação)'],
  [CHAVE_AMBIENTE_NFE, '2', 'number', 'Ambiente da NF-e modelo 55 (1 Produção, 2 Homologação)'],
  ...['autorizacao', 'evento', 'consulta', 'status'].flatMap((servico) => [
    [`fiscal_ws_nfe_${servico}_homologacao`, '', 'string', `URL NF-e ${servico} (homologação)`],
    [`fiscal_ws_nfe_${servico}_producao`, '', 'string', `URL NF-e ${servico} (produção)`]
  ])
];

function prepararConfiguracaoNfe() {
  return Promise.all(CONFIG_NFE_PADRAO.map(([chave, valor, tipo, descricao]) => new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO configuracoes (chave, valor, tipo, descricao, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [chave, valor, tipo, descricao],
      function onRun(err) {
        if (err) return reject(err);
        resolve(this.changes > 0 ? chave : null);
      }
    );
  }))).then((criadas) => criadas.filter(Boolean));
}

module.exports = {
  getFiscalConfig,
  getFiscalConfigNfe,
  setConfiguracao,
  incrementaNumeroFiscal,
  prepararConfiguracaoNfe,
  CONFIG_NFE_PADRAO
};