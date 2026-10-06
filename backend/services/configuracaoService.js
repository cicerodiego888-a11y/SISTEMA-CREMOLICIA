const fs = require('fs');
const path = require('path');

const LEGACY_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'configuracoes.json');
const LEGACY_ELECTRON_PATHS = [
  path.join(__dirname, '..', '..', 'storage', 'config-servidor.json'),
  path.join(__dirname, '..', 'storage', 'config-servidor.json')
];

const DEFAULT = {
  tipoImplantacao: 'ERP_SEM_FISCAL',
  modoOperacao: 'LOCAL',
  ipServidor: '',
  porta: 3002,
  modo_confirmacao_fiscal: 'TEF',
  midp_ativado: false,
  // Persistido sempre como PRESERVAR_DINHEIRO (3.8D.3.2). LEGADO só em leituras antigas.
  midp_politica: 'PRESERVAR_DINHEIRO'
};

const TIPOS = ['ERP_SEM_FISCAL', 'ERP_FISCAL', 'ERP_MULTICAIXA'];
const MODOS = ['LOCAL', 'CLIENTE_SERVIDOR'];
const MODOS_CONFIRMACAO_FISCAL = ['TEF', 'MANUAL'];
const MIDP_POLITICAS = ['LEGADO', 'PRESERVAR_DINHEIRO'];

function getDbDir() {
  const { resolverDbDir } = require('../config/dataDir');
  return resolverDbDir();
}

function getPersistentConfigDir() {
  const dir = path.join(getDbDir(), 'config');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getConfigPath() {
  return path.join(getPersistentConfigDir(), 'configuracoes.json');
}

function getElectronConfigPath() {
  return path.join(getPersistentConfigDir(), 'config-servidor.json');
}

function getRecoveryFlagPath() {
  return path.join(getPersistentConfigDir(), 'forcar-modo-local.flag');
}

function criarFlagForcarModoLocal() {
  ensureConfigFile();
  const flagPath = getRecoveryFlagPath();
  fs.writeFileSync(flagPath, new Date().toISOString(), 'utf8');
  return flagPath;
}

function consumirFlagForcarModoLocal() {
  const flagPath = getRecoveryFlagPath();
  if (!fs.existsSync(flagPath)) return false;
  try {
    fs.unlinkSync(flagPath);
  } catch (e) {
    console.warn('Não foi possível remover flag de recuperação:', e.message);
  }
  voltarModoLocalEstacao();
  console.log('Recuperação: modo local aplicado via flag de emergência.');
  return true;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch (e) {
    console.warn(`Não foi possível ler ${filePath}:`, e.message);
    return null;
  }
}

function readLegacyElectronConfig() {
  for (const legacyPath of LEGACY_ELECTRON_PATHS) {
    const data = readJsonFile(legacyPath);
    if (data?.modo === 'cliente' && data.ipServidor) {
      return data;
    }
  }
  return null;
}

function buildConfigFromLegacyElectron(legacyElectron, baseConfig = {}) {
  const base = normalizeConfig(baseConfig);
  return normalizeConfig({
    tipoImplantacao: base.tipoImplantacao === 'ERP_SEM_FISCAL' ? 'ERP_MULTICAIXA' : base.tipoImplantacao,
    modoOperacao: 'CLIENTE_SERVIDOR',
    ipServidor: legacyElectron.ipServidor,
    porta: legacyElectron.porta || base.porta || DEFAULT.porta
  });
}

function migrateLegacyConfig() {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    return;
  }

  const legacyConfig = readJsonFile(LEGACY_CONFIG_PATH);
  if (legacyConfig) {
    const normalized = normalizeConfig(legacyConfig);
    fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf8');
    syncElectronConfig(normalized);
    console.log('Configuração migrada de', LEGACY_CONFIG_PATH, 'para', configPath);
    return;
  }

  const legacyElectron = readLegacyElectronConfig();
  if (legacyElectron) {
    const migrated = buildConfigFromLegacyElectron(legacyElectron);
    fs.writeFileSync(configPath, JSON.stringify(migrated, null, 2), 'utf8');
    syncElectronConfig(migrated);
    console.log('Configuração de rede migrada do arquivo legado para:', configPath);
    return;
  }

  fs.writeFileSync(configPath, JSON.stringify(DEFAULT, null, 2), 'utf8');
  syncElectronConfig(DEFAULT);
}

function ensureConfigFile() {
  migrateLegacyConfig();
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT, null, 2), 'utf8');
    syncElectronConfig(DEFAULT);
  }
}

function normalizePadraoFiscal(obj) {
  const origem = obj?.origem_padrao;
  return {
    cfop_padrao: obj?.cfop_padrao !== undefined && obj?.cfop_padrao !== null
      ? String(obj.cfop_padrao).trim()
      : '',
    csosn_padrao: obj?.csosn_padrao !== undefined && obj?.csosn_padrao !== null
      ? String(obj.csosn_padrao).trim()
      : '',
    origem_padrao: origem !== undefined && origem !== null
      ? String(origem).trim()
      : '',
    cest_padrao: obj?.cest_padrao !== undefined && obj?.cest_padrao !== null
      ? String(obj.cest_padrao).trim()
      : ''
  };
}

function normalizeModoConfirmacaoFiscal(valor) {
  const modo = String(valor || DEFAULT.modo_confirmacao_fiscal).toUpperCase().trim();
  return modo === 'MANUAL' ? 'MANUAL' : 'TEF';
}

function normalizeMidpAtivado(valor) {
  return valor === true
    || valor === 'true'
    || valor === 1
    || valor === '1'
    || String(valor || '').toUpperCase().trim() === 'TRUE';
}

function normalizeMidpPolitica(valor) {
  const nome = String(valor || DEFAULT.midp_politica).toUpperCase().trim();
  return MIDP_POLITICAS.includes(nome) ? nome : DEFAULT.midp_politica;
}

/**
 * Política efetiva persistida (3.8D.3.2).
 * LEGADO em bancos/configs antigos → PRESERVAR_DINHEIRO na gravação.
 */
function migrarMidpPolitica(valor) {
  const nome = normalizeMidpPolitica(valor);
  if (nome === 'LEGADO') {
    return 'PRESERVAR_DINHEIRO';
  }
  return nome === 'PRESERVAR_DINHEIRO' ? nome : DEFAULT.midp_politica;
}

function normalizeConfig(obj) {
  return {
    tipoImplantacao: String(obj?.tipoImplantacao || DEFAULT.tipoImplantacao).toUpperCase(),
    modoOperacao: String(obj?.modoOperacao || DEFAULT.modoOperacao).toUpperCase(),
    ipServidor: String(obj?.ipServidor || '').trim(),
    porta: Number(obj?.porta || DEFAULT.porta),
    modo_confirmacao_fiscal: normalizeModoConfirmacaoFiscal(obj?.modo_confirmacao_fiscal),
    midp_ativado: obj?.midp_ativado === undefined
      ? DEFAULT.midp_ativado
      : normalizeMidpAtivado(obj.midp_ativado),
    midp_politica: obj?.midp_politica === undefined
      ? DEFAULT.midp_politica
      : normalizeMidpPolitica(obj.midp_politica),
    ...normalizePadraoFiscal(obj)
  };
}

function getModoConfirmacaoFiscal(cfg) {
  return normalizeModoConfirmacaoFiscal((cfg || readConfig()).modo_confirmacao_fiscal);
}

function isMidpAtivado(cfg) {
  return normalizeMidpAtivado((cfg || readConfig()).midp_ativado);
}

function getMidpPolitica(cfg) {
  // Compat: ainda lê o valor persistido (pode ser LEGADO em configs antigas).
  return normalizeMidpPolitica((cfg || readConfig()).midp_politica);
}

/**
 * Política runtime oficial (3.8D.3.2): ligada → PRESERVAR; desligada → LEGADO.
 * Não depende de midp_politica na UI.
 */
function getMidpPoliticaEfetiva(cfg) {
  return isMidpAtivado(cfg) ? 'PRESERVAR_DINHEIRO' : 'LEGADO';
}

function getPadraoFiscal(cfg) {
  return normalizePadraoFiscal(cfg || readConfig());
}

function readConfig() {
  try {
    ensureConfigFile();
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return Object.assign({}, DEFAULT, normalizeConfig(parsed));
  } catch (e) {
    console.error('Erro ao ler configuracoes.json:', e.message);
    return Object.assign({}, DEFAULT);
  }
}

function getRecursos(cfg) {
  const config = normalizeConfig(cfg || readConfig());
  const tipo = config.tipoImplantacao;
  const modo = config.modoOperacao;

  const recursos = {
    fiscal: false,
    nfce: false,
    nfe: false,
    nfse: false,
    multiCaixa: false,
    clienteServidor: false,
    terminaisPdv: false
  };

  if (tipo === 'ERP_FISCAL' || tipo === 'ERP_MULTICAIXA') {
    recursos.fiscal = true;
    recursos.nfce = true;
    recursos.nfe = true;
    recursos.nfse = true;
  }

  if (tipo === 'ERP_MULTICAIXA') {
    recursos.multiCaixa = true;
    recursos.clienteServidor = true;
    recursos.terminaisPdv = true;
  }

  if (tipo === 'ERP_FISCAL' && modo === 'CLIENTE_SERVIDOR') {
    recursos.clienteServidor = false;
  }

  return {
    tipoImplantacao: tipo,
    modoOperacao: modo,
    ipServidor: config.ipServidor,
    porta: config.porta,
    recursos
  };
}

function validateConfig(obj) {
  const errors = [];
  const config = normalizeConfig(obj);
  const { tipoImplantacao: tipo, modoOperacao: modo, ipServidor, porta } = config;

  if (!TIPOS.includes(tipo)) errors.push('tipoImplantacao inválido');
  if (!MODOS.includes(modo)) errors.push('modoOperacao inválido');

  if (!Number.isInteger(porta) || porta <= 0) errors.push('porta inválida');

  if (modo === 'CLIENTE_SERVIDOR' && !ipServidor) {
    errors.push('ipServidor obrigatório para modo CLIENTE_SERVIDOR');
  }

  if (tipo === 'ERP_FISCAL' && modo === 'CLIENTE_SERVIDOR') {
    errors.push('ERP Fiscal não suporta modo Cliente/Servidor');
  }

  if (modo === 'CLIENTE_SERVIDOR' && tipo !== 'ERP_MULTICAIXA') {
    errors.push('Modo Cliente/Servidor disponível apenas para ERP Multi-Caixa');
  }

  if (!MODOS_CONFIRMACAO_FISCAL.includes(config.modo_confirmacao_fiscal)) {
    errors.push('modo_confirmacao_fiscal inválido');
  }

  // Compat leitura: aceita LEGADO/PRESERVAR; na validação de gravação migra LEGADO.
  if (config.midp_politica !== undefined && config.midp_politica !== null) {
    const raw = String(config.midp_politica).toUpperCase().trim();
    if (raw && !MIDP_POLITICAS.includes(raw)) {
      errors.push('midp_politica inválida');
    }
  }
  config.midp_politica = migrarMidpPolitica(config.midp_politica);

  return { valid: errors.length === 0, errors, config };
}

function readElectronStationConfigRaw() {
  return readJsonFile(getElectronConfigPath()) || {};
}

function isSetupPdvConcluido() {
  const data = readElectronStationConfigRaw();
  return data.setupPdvConcluido === true;
}

function marcarSetupPdvConcluido(concluido = true) {
  const atual = readElectronStationConfigRaw();
  const payload = {
    ...atual,
    setupPdvConcluido: concluido === true
  };

  const electronPath = getElectronConfigPath();
  const dir = path.dirname(electronPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(electronPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function readElectronStationConfig() {
  const global = readConfig();
  const data = readElectronStationConfigRaw();
  const porta = Number.isInteger(Number(data?.porta)) && Number(data.porta) > 0
    ? Number(data.porta)
    : (global.porta || DEFAULT.porta);

  if (String(data?.modo || '').toLowerCase() === 'cliente' && String(data?.ipServidor || '').trim()) {
    return {
      modo: 'cliente',
      ipServidor: String(data.ipServidor).trim(),
      porta,
      setupPdvConcluido: data.setupPdvConcluido === true
    };
  }

  return {
    modo: 'local',
    ipServidor: '127.0.0.1',
    porta,
    setupPdvConcluido: data.setupPdvConcluido === true
  };
}

function saveElectronStationConfig({ modo, ipServidor, porta, setupPdvConcluido }) {
  const modoNormalizado = String(modo || 'local').trim().toLowerCase() === 'cliente' ? 'cliente' : 'local';
  const global = readConfig();
  const atual = readElectronStationConfigRaw();
  const portaFinal = Number.isInteger(Number(porta)) && Number(porta) > 0
    ? Number(porta)
    : (global.porta || DEFAULT.porta);

  const setupFlag = setupPdvConcluido === undefined
    ? atual.setupPdvConcluido === true
    : setupPdvConcluido === true;

  const payload = modoNormalizado === 'cliente'
    ? {
      modo: 'cliente',
      ipServidor: String(ipServidor || '').trim(),
      porta: portaFinal,
      setupPdvConcluido: setupFlag
    }
    : {
      modo: 'local',
      porta: portaFinal,
      setupPdvConcluido: setupFlag
    };

  if (payload.modo === 'cliente' && !payload.ipServidor) {
    throw new Error('IP do servidor é obrigatório no modo cliente.');
  }

  const electronPath = getElectronConfigPath();
  const dir = path.dirname(electronPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(electronPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function getModoRedeEstacaoElectron() {
  return readElectronStationConfig();
}

function syncElectronConfig(cfg) {
  const config = normalizeConfig(cfg);
  const modoRede = getModoRedeElectron(config);
  const atual = readElectronStationConfigRaw();
  const payload = modoRede.modo === 'cliente'
    ? {
      modo: 'cliente',
      ipServidor: modoRede.ipServidor,
      porta: modoRede.porta,
      setupPdvConcluido: atual.setupPdvConcluido === true
    }
    : {
      modo: 'local',
      porta: modoRede.porta,
      setupPdvConcluido: atual.setupPdvConcluido === true
    };

  const electronPath = getElectronConfigPath();
  const dir = path.dirname(electronPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(electronPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function getModoRedeElectron(cfg) {
  const config = normalizeConfig(cfg || readConfig());
  const recursos = getRecursos(config).recursos;

  if (config.modoOperacao === 'CLIENTE_SERVIDOR' && recursos.clienteServidor) {
    return {
      modo: 'cliente',
      ipServidor: config.ipServidor,
      porta: config.porta
    };
  }

  return {
    modo: 'local',
    ipServidor: '127.0.0.1',
    porta: config.porta || DEFAULT.porta
  };
}

function reloadGlobalConfig() {
  const cfg = readConfig();
  global.CONFIGURACAO_AVANCADA = cfg;
  global.CONFIGURACAO_RECURSOS = getRecursos(cfg);
  return cfg;
}

function saveConfig(obj) {
  const validation = validateConfig(obj);
  if (!validation.valid) {
    const error = new Error(validation.errors.join('; '));
    error.details = validation.errors;
    throw error;
  }

  const current = readConfig();
  const toSave = {
    ...current,
    tipoImplantacao: validation.config.tipoImplantacao,
    modoOperacao: validation.config.modoOperacao,
    ipServidor: validation.config.ipServidor,
    porta: validation.config.porta,
    modo_confirmacao_fiscal: validation.config.modo_confirmacao_fiscal,
    midp_ativado: validation.config.midp_ativado,
    // Sempre PRESERVAR_DINHEIRO na persistência (seleção de política removida da UI)
    midp_politica: migrarMidpPolitica(validation.config.midp_politica)
  };

  ensureConfigFile();
  fs.writeFileSync(getConfigPath(), JSON.stringify(toSave, null, 2), 'utf8');
  syncElectronConfig(toSave);
  reloadGlobalConfig();
  return toSave;
}

function savePadraoFiscal(obj) {
  const current = readConfig();
  const padrao = normalizePadraoFiscal(obj);
  const toSave = { ...current, ...padrao };

  ensureConfigFile();
  fs.writeFileSync(getConfigPath(), JSON.stringify(toSave, null, 2), 'utf8');
  reloadGlobalConfig();
  return toSave;
}

function recursoHabilitado(nomeRecurso) {
  const recursos = getRecursos().recursos;
  return recursos[nomeRecurso] === true;
}

function obterModoEstacaoLocal() {
  ensureConfigFile();
  return readElectronStationConfig();
}

function voltarModoLocalEstacao() {
  const current = readElectronStationConfig();
  return saveElectronStationConfig({
    modo: 'local',
    porta: current.porta || DEFAULT.porta
  });
}

function salvarModoEstacaoLocal({ modo, ipServidor, porta }) {
  const modoNormalizado = String(modo || 'local').trim().toLowerCase() === 'cliente' ? 'cliente' : 'local';
  const current = readConfig();

  if (modoNormalizado === 'cliente' && current.tipoImplantacao !== 'ERP_MULTICAIXA') {
    saveConfig({
      ...current,
      tipoImplantacao: 'ERP_MULTICAIXA',
      modoOperacao: current.modoOperacao,
      ipServidor: current.ipServidor,
      porta: current.porta,
      modo_confirmacao_fiscal: current.modo_confirmacao_fiscal,
      midp_ativado: current.midp_ativado,
      midp_politica: current.midp_politica
    });
  }

  const salvo = saveElectronStationConfig({
    modo: modoNormalizado,
    ipServidor: modoNormalizado === 'cliente' ? String(ipServidor || '').trim() : '',
    porta,
    setupPdvConcluido: true
  });

  return salvo;
}

module.exports = {
  get CONFIG_PATH() { return getConfigPath(); },
  get ELECTRON_CONFIG_PATH() { return getElectronConfigPath(); },
  DEFAULT,
  TIPOS,
  MODOS,
  MODOS_CONFIRMACAO_FISCAL,
  MIDP_POLITICAS,
  getModoConfirmacaoFiscal,
  normalizeModoConfirmacaoFiscal,
  isMidpAtivado,
  normalizeMidpAtivado,
  getMidpPolitica,
  getMidpPoliticaEfetiva,
  normalizeMidpPolitica,
  migrarMidpPolitica,
  getDbDir,
  getConfigPath,
  getElectronConfigPath,
  readConfig,
  saveConfig,
  savePadraoFiscal,
  getPadraoFiscal,
  normalizePadraoFiscal,
  validateConfig,
  ensureConfigFile,
  getRecursos,
  getModoRedeElectron,
  getModoRedeEstacaoElectron,
  readElectronStationConfig,
  saveElectronStationConfig,
  syncElectronConfig,
  reloadGlobalConfig,
  recursoHabilitado,
  obterModoEstacaoLocal,
  voltarModoLocalEstacao,
  salvarModoEstacaoLocal,
  readElectronStationConfigRaw,
  isSetupPdvConcluido,
  marcarSetupPdvConcluido,
  getRecoveryFlagPath,
  criarFlagForcarModoLocal,
  consumirFlagForcarModoLocal
};
