/**
 * Prontidão da NF-e modelo 55 para homologação — diagnóstico LOCAL.
 *
 * Só lê configuração do banco ativo e o arquivo PFX no disco. Nunca abre conexão
 * de rede (sem SOAP, DNS ou HTTPS) e nunca reserva número. Não devolve senha,
 * caminho completo do certificado nem chave privada.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { onlyDigits } = require('./utils');
const { inspecionarCertificadoPfx } = require('./certificateService');
const { nfeProducaoLiberada, resolverAmbienteNfe, CHAVE_AMBIENTE_NFE } = require('./nfeAmbienteGuard');
const { resolverWebserviceNfe, urlsNfeDaConfiguracao, CHAVES_WS_NFE } = require('./nfeWebServices');
const dataDir = require('../../config/dataDir');

const STATUS_PRONTA = 'PRONTA_PARA_HOMOLOGACAO';
const STATUS_NAO_CONFIGURADA = 'NAO_CONFIGURADA';
const MSG_NAO_PRONTA = 'NF-e não está pronta para emissão.';
const MSG_PRONTA = 'NF-e pronta para emissão em homologação.';

const CHAVES_CONFIG = [
  'nome_empresa',
  'razao_social',
  'cnpj',
  'fiscal_ie',
  'fiscal_codigo_uf',
  'fiscal_uf_sigla',
  'fiscal_uf',
  'fiscal_ambiente',
  CHAVE_AMBIENTE_NFE,
  'fiscal_serie_nfe',
  'fiscal_numero_atual_nfe',
  'fiscal_certificado_path',
  'fiscal_certificado_senha',
  ...Object.values(CHAVES_WS_NFE).flatMap((chave) => [`${chave}_homologacao`, `${chave}_producao`])
];

const SERVICOS_WS = [
  ['autorizacao', 'autorização'],
  ['consultaProtocolo', 'consulta'],
  ['status', 'status do serviço'],
  ['evento', 'evento']
];

function cnpjValido(valor) {
  const c = onlyDigits(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base) => {
    let soma = 0;
    let peso = base.length - 7;
    for (let i = 0; i < base.length; i += 1) {
      soma += Number(base[i]) * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

function formatarCnpj(valor) {
  const c = onlyDigits(valor);
  if (c.length !== 14) return c || null;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

function item(id, nome, nivel, mensagem, valor = null, codigo = null) {
  return { id, nome, nivel, ok: nivel === 'ok' || nivel === 'alerta', mensagem, valor, codigo };
}

function lerConfiguracoesPadrao(chaves) {
  const db = require('../../database');
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT chave, valor FROM configuracoes WHERE chave IN (${chaves.map(() => '?').join(',')})`,
      chaves,
      (err, rows) => {
        if (err) return reject(err);
        const map = {};
        (rows || []).forEach((r) => { map[r.chave] = r.valor; });
        resolve(map);
      }
    );
  });
}

function lerProximoNumeroPadrao({ cnpj, ambiente, serie }) {
  const db = require('../../database');
  return new Promise((resolve) => {
    db.get(
      `SELECT proximo_numero FROM fiscal_numeracao
       WHERE empresa_cnpj = ? AND CAST(ambiente AS INTEGER) = ? AND modelo = '55' AND CAST(serie AS INTEGER) = ?`,
      [onlyDigits(cnpj).padStart(14, '0').slice(-14), Number(ambiente), Number(serie)],
      (err, row) => resolve(err || !row ? null : Number(row.proximo_numero) || null)
    );
  });
}

function dbDirPadrao() {
  try {
    return require('../../database').dbDir || dataDir.resolverDbDir();
  } catch (_) {
    return dataDir.resolverDbDir();
  }
}

function avaliarDbDir(dir, env) {
  if (!dir) return item('dbDir', 'Banco de dados', 'pendente', 'DB_DIR não identificado.');
  if (dataDir.mesmoDiretorio(dir, dataDir.dirPadraoCremolicia(env))) {
    return item('dbDir', 'Banco de dados', 'ok', 'Banco da CDS Cremolícia.', dir);
  }
  return item('dbDir', 'Banco de dados', 'alerta', `DB_DIR fora do padrão (${dataDir.dirPadraoCremolicia(env)}).`, dir);
}

function avaliarEmpresa(cfg) {
  const nome = String(cfg.nome_empresa || cfg.razao_social || '').trim();
  const ie = onlyDigits(cfg.fiscal_ie || '');
  const faltando = [];
  if (!nome) faltando.push('razão social / nome da empresa');
  if (!ie) faltando.push('inscrição estadual');
  if (faltando.length) {
    return item('empresa', 'Empresa', 'pendente', `Informe: ${faltando.join(' e ')}.`, nome || null);
  }
  return item('empresa', 'Empresa', 'ok', `IE ${ie}.`, nome);
}

function avaliarCnpj(cfg) {
  const c = onlyDigits(cfg.cnpj || '');
  if (!c) return item('cnpj', 'CNPJ', 'pendente', 'CNPJ da empresa não configurado.');
  if (!cnpjValido(c)) return item('cnpj', 'CNPJ', 'pendente', 'CNPJ da empresa inválido.', formatarCnpj(c));
  return item('cnpj', 'CNPJ', 'ok', 'CNPJ da empresa ativa.', formatarCnpj(c));
}

function avaliarCertificado(cfg, inspecionar) {
  const caminho = String(cfg.fiscal_certificado_path || '').trim();
  if (!caminho) return item('certificado', 'Certificado', 'pendente', 'Certificado A1 não configurado.');
  const arquivo = path.basename(caminho);
  if (!fs.existsSync(caminho)) {
    return item('certificado', 'Certificado', 'pendente', 'Arquivo do certificado A1 não encontrado.', arquivo, 'CERTIFICATE_NOT_FOUND');
  }
  if (!cfg.fiscal_certificado_senha) {
    return item('certificado', 'Certificado', 'pendente', 'Senha do certificado não configurada.', arquivo);
  }
  let inspecao;
  try {
    inspecao = inspecionar(caminho, cfg.fiscal_certificado_senha);
  } catch (err) {
    const codigo = err.codigo || err.code || 'CERTIFICATE_INVALID';
    const mensagem = codigo === 'CERTIFICATE_EXPIRED'
      ? 'Certificado A1 vencido.'
      : 'Não foi possível abrir o certificado (senha incorreta ou arquivo inválido).';
    return item('certificado', 'Certificado', codigo === 'CERTIFICATE_EXPIRED' ? 'bloqueado' : 'pendente', mensagem, arquivo, codigo);
  }
  const validade = inspecao.notAfter ? new Date(inspecao.notAfter).toLocaleDateString('pt-BR') : null;
  const resumo = [arquivo, validade ? `válido até ${validade}` : null].filter(Boolean).join(' — ');
  if (inspecao.valido === false) {
    return item('certificado', 'Certificado', 'bloqueado', 'Certificado A1 ainda não está no período de validade.', resumo, 'CERTIFICATE_INVALID');
  }
  const cnpjCert = onlyDigits(inspecao.cnpj || '');
  if (cnpjCert.length !== 14) {
    return item('certificado', 'Certificado', 'bloqueado', 'Não foi possível identificar o CNPJ do certificado.', resumo, 'CERTIFICATE_CONFIGURATION_ERROR');
  }
  const cnpjEmpresa = onlyDigits(cfg.cnpj || '');
  if (cnpjEmpresa.length !== 14) {
    return item('certificado', 'Certificado', 'pendente', `Configure o CNPJ da empresa para conferir o certificado (CNPJ do certificado ${formatarCnpj(cnpjCert)}).`, resumo);
  }
  if (cnpjCert !== cnpjEmpresa) {
    return item(
      'certificado',
      'Certificado',
      'bloqueado',
      `CNPJ do certificado (${formatarCnpj(cnpjCert)}) diverge do CNPJ da empresa (${formatarCnpj(cnpjEmpresa)}).`,
      resumo,
      'CERTIFICATE_CONFIGURATION_ERROR'
    );
  }
  return item('certificado', 'Certificado', 'ok', `CNPJ do certificado = CNPJ da empresa (${formatarCnpj(cnpjCert)}).`, resumo);
}

function avaliarAmbiente(amb) {
  if (!amb.valido) {
    return item('ambiente', 'Ambiente', 'pendente', `Ambiente da NF-e inválido (${CHAVE_AMBIENTE_NFE} = ${amb.valorConfigurado}). Use 2 = Homologação.`, null, 'NFE_AMBIENTE_INVALIDO');
  }
  const origem = amb.origem === 'padrao' ? `padrão; ${CHAVE_AMBIENTE_NFE} não configurado` : CHAVE_AMBIENTE_NFE;
  if (amb.ambiente === 2) return item('ambiente', 'Ambiente', 'ok', `Homologação (tpAmb = 2) — ${origem}.`, 'Homologação');
  if (nfeProducaoLiberada()) return item('ambiente', 'Ambiente', 'alerta', `Produção (tpAmb = 1) — ${origem}.`, 'Produção');
  return item(
    'ambiente',
    'Ambiente',
    'bloqueado',
    `NF-e configurada em Produção (${CHAVE_AMBIENTE_NFE} = 1), bloqueada nesta versão: use ${CHAVE_AMBIENTE_NFE} = 2.`,
    'Produção',
    'NFE_PRODUCAO_BLOQUEADA'
  );
}

function rotuloAmbienteNfce(cfg) {
  const v = String(cfg.fiscal_ambiente || '').trim();
  if (v === '1') return 'Produção';
  if (v === '2') return 'Homologação';
  return null;
}

function serieConfigurada(cfg) {
  const s = Number(cfg.fiscal_serie_nfe);
  return String(cfg.fiscal_serie_nfe ?? '').trim() !== '' && Number.isInteger(s) && s >= 1 && s <= 999 ? s : null;
}

function avaliarSerie(cfg) {
  const s = serieConfigurada(cfg);
  if (s == null) return item('serie', 'Série', 'pendente', 'Série da NF-e (fiscal_serie_nfe) não configurada ou inválida (1 a 999).');
  return item('serie', 'Série', 'ok', 'Série da NF-e modelo 55.', s);
}

async function avaliarNumeracao(cfg, amb, lerProximoNumero) {
  const serie = serieConfigurada(cfg);
  const cnpj = onlyDigits(cfg.cnpj || '');
  const ambiente = amb.ambiente || 2;
  let proximo = null;
  let origem = 'fiscal_numero_atual_nfe';
  if (serie != null && cnpj.length === 14) {
    const daTabela = await lerProximoNumero({ cnpj, ambiente, serie });
    if (daTabela) {
      proximo = daTabela;
      origem = 'fiscal_numeracao';
    }
  }
  if (proximo == null) {
    const n = Number(cfg.fiscal_numero_atual_nfe);
    proximo = Number.isInteger(n) && n >= 1 ? n : null;
  }
  if (proximo == null || proximo > 999999999) {
    return item('numeracao', 'Numeração', 'pendente', 'Próximo número da NF-e não configurado.');
  }
  return item('numeracao', 'Numeração', 'ok', `Próximo número previsto (${origem}); nenhum número é reservado pelo diagnóstico.`, proximo);
}

/** Mesmo resolvedor do emissor (resolverWebserviceNfe), para os quatro serviços NF-e. */
function resolverWebservices(cfg, amb) {
  if (!amb.valido) return null;
  const config = {
    ambiente: amb.ambiente,
    codigoUf: String(cfg.fiscal_codigo_uf || '23'),
    urlsNfe: urlsNfeDaConfiguracao(cfg, amb.ambiente)
  };
  const out = {};
  SERVICOS_WS.forEach(([servico]) => { out[servico] = resolverWebserviceNfe(servico, amb.ambiente, config); });
  return out;
}

function avaliarWebservice(ws) {
  if (!ws) return item('webservice', 'Webservice', 'pendente', 'Webservice não resolvido: ambiente da NF-e inválido.', null, 'NFE_AMBIENTE_INVALIDO');
  const falha = SERVICOS_WS.map(([servico, rotulo]) => ({ r: ws[servico], rotulo })).find(({ r }) => !r.ok);
  if (falha) {
    const nivel = /PRODUCAO|HOMOLOGACAO|NFCE/.test(falha.r.codigo || '') ? 'bloqueado' : 'pendente';
    return item('webservice', 'Webservice', nivel, `Webservice de ${falha.rotulo}: ${falha.r.mensagem}`, null, falha.r.codigo);
  }
  const aut = ws.autorizacao;
  const nomeAmb = aut.ambiente === 1 ? 'produção' : 'homologação';
  const origem = aut.origem === 'configuracao' ? `configurado em ${aut.chave}` : aut.mensagem.replace(/\.$/, '');
  return item('webservice', 'Webservice', 'ok', `Autorização NF-e ${nomeAmb} — ${origem}.`, aut.url);
}

function avaliarProducao() {
  if (nfeProducaoLiberada()) {
    return item('producao', 'Produção', 'alerta', 'Produção NF-e LIBERADA no backend.', 'Liberada');
  }
  return item('producao', 'Produção', 'ok', 'Produção NF-e bloqueada no backend (PRODUCAO_NFE_LIBERADA = false).', 'Bloqueada');
}

/**
 * @param {object} [deps]
 * @param {function} [deps.lerConfiguracoes] (chaves) => Promise<{chave: valor}>
 * @param {function} [deps.lerProximoNumero] ({cnpj, ambiente, serie}) => Promise<number|null>
 * @param {function} [deps.inspecionarCertificado] (caminho, senha) => inspeção local do PFX
 * @param {string} [deps.dbDir]
 * @param {object} [deps.env]
 */
async function diagnosticarProntidaoNfe(deps = {}) {
  const env = deps.env || process.env;
  const cfg = await (deps.lerConfiguracoes || lerConfiguracoesPadrao)(CHAVES_CONFIG);
  const amb = resolverAmbienteNfe(cfg);
  const ws = resolverWebservices(cfg, amb);
  const itens = [
    avaliarDbDir(deps.dbDir || dbDirPadrao(), env),
    avaliarEmpresa(cfg),
    avaliarCnpj(cfg),
    avaliarCertificado(cfg, deps.inspecionarCertificado || inspecionarCertificadoPfx),
    avaliarAmbiente(amb),
    avaliarSerie(cfg),
    await avaliarNumeracao(cfg, amb, deps.lerProximoNumero || lerProximoNumeroPadrao),
    avaliarWebservice(ws),
    avaliarProducao()
  ];
  const pendencias = itens.filter((i) => !i.ok).map((i) => i.nome);
  const pronta = pendencias.length === 0;
  return {
    success: true,
    pronta,
    status: pronta ? STATUS_PRONTA : STATUS_NAO_CONFIGURADA,
    titulo: pronta ? 'NF-E PRONTA PARA HOMOLOGAÇÃO' : 'NF-E NÃO CONFIGURADA',
    mensagem: pronta ? MSG_PRONTA : MSG_NAO_PRONTA,
    ambiente: amb.ambiente != null ? String(amb.ambiente) : null,
    ambienteOrigem: amb.origem,
    tpAmb: amb.ambiente,
    ambienteNfce: rotuloAmbienteNfce(cfg),
    webservices: ws
      ? Object.fromEntries(Object.entries(ws).map(([s, r]) => [s, { ok: r.ok, url: r.url, origem: r.origem, chave: r.chave }]))
      : null,
    uf: {
      sigla: String(cfg.fiscal_uf_sigla || cfg.fiscal_uf || '').trim().toUpperCase() || null,
      codigo: String(cfg.fiscal_codigo_uf || '').trim() || null
    },
    producaoBloqueada: !nfeProducaoLiberada(),
    itens,
    pendencias,
    chamadasSefaz: 0,
    verificadoEm: new Date().toISOString()
  };
}

/** Linha de comando: abre o banco do DB_DIR somente leitura e imprime o diagnóstico. */
async function executarCli() {
  const sqlite3 = require('sqlite3');
  const dir = dataDir.resolverDbDir();
  const arquivo = path.join(dir, 'mercadao.db');
  if (!fs.existsSync(arquivo)) throw new Error(`Banco não encontrado em ${arquivo}.`);
  const banco = new sqlite3.Database(arquivo, sqlite3.OPEN_READONLY);
  const all = (sql, params) => new Promise((resolve, reject) => {
    banco.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  try {
    const out = await diagnosticarProntidaoNfe({
      dbDir: dir,
      lerConfiguracoes: async (chaves) => {
        const rows = await all(`SELECT chave, valor FROM configuracoes WHERE chave IN (${chaves.map(() => '?').join(',')})`, chaves);
        return Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
      },
      lerProximoNumero: async ({ cnpj, ambiente, serie }) => {
        const rows = await all(
          `SELECT proximo_numero FROM fiscal_numeracao
           WHERE empresa_cnpj = ? AND CAST(ambiente AS INTEGER) = ? AND modelo = '55' AND CAST(serie AS INTEGER) = ?`,
          [onlyDigits(cnpj).padStart(14, '0').slice(-14), Number(ambiente), Number(serie)]
        ).catch(() => []);
        return rows[0] ? Number(rows[0].proximo_numero) || null : null;
      }
    });
    const rotulo = { ok: 'OK', alerta: 'ALERTA', pendente: 'PENDENTE', bloqueado: 'BLOQUEADO' };
    console.log(`NF-e — diagnóstico local (sem SEFAZ) — banco: ${arquivo} (somente leitura)`);
    for (const i of out.itens) {
      const valor = i.valor != null && i.valor !== '' ? ` [${i.valor}]` : '';
      console.log(`  ${i.nome.padEnd(16)} ${rotulo[i.nivel].padEnd(10)} ${i.mensagem}${valor}`);
    }
    console.log(`STATUS: ${out.titulo}`);
    if (!out.pronta) console.log(`${out.mensagem} Pendências: ${out.pendencias.join(', ')}.`);
    console.log(`Chamadas à SEFAZ: ${out.chamadasSefaz}`);
    return out;
  } finally {
    banco.close();
  }
}

if (require.main === module) {
  executarCli().catch((err) => {
    console.error(`Falha no diagnóstico local NF-e: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  diagnosticarProntidaoNfe,
  cnpjValido,
  formatarCnpj,
  CHAVES_CONFIG,
  STATUS_PRONTA,
  STATUS_NAO_CONFIGURADA,
  MSG_NAO_PRONTA,
  MSG_PRONTA
};
