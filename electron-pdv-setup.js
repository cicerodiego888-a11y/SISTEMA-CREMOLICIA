const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const { testarServidorRemoto } = require('./electron-rede-cliente');

let setupWindow = null;
let callbacksSetup = null;

function obterConfigService() {
  return require('./backend/services/configuracaoService');
}

function precisaSetupInicialPdv(configServidor = {}) {
  if (process.argv.includes('--cds-forcar-local')) {
    return false;
  }

  if (configServidor.modo === 'cliente' && String(configServidor.ipServidor || '').trim()) {
    return false;
  }

  try {
    const configService = obterConfigService();
    return !configService.isSetupPdvConcluido();
  } catch (error) {
    console.warn('[PDV-SETUP] Não foi possível ler flag de setup:', error.message);
    return true;
  }
}

function fecharJanelaSetup() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.destroy();
  }
  setupWindow = null;
}

function registrarHandlersSetupPdv() {
  ipcMain.removeHandler('pdv-setup-testar-servidor');
  ipcMain.handle('pdv-setup-testar-servidor', async (_event, body = {}) => {
    try {
      const ipServidor = String(body.ipServidor || '').trim();
      const porta = Number.parseInt(body.porta, 10);

      if (!ipServidor) {
        return { sucesso: false, erro: 'Informe o IP do servidor.' };
      }
      if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
        return { sucesso: false, erro: 'Informe uma porta válida.' };
      }

      const online = await testarServidorRemoto(ipServidor, porta, 8000);
      if (!online) {
        return {
          sucesso: false,
          erro: `Servidor não respondeu em ${ipServidor}:${porta}. Verifique se o ERP está aberto nesse computador.`
        };
      }

      return { sucesso: true, ipServidor, porta };
    } catch (error) {
      return { sucesso: false, erro: error.message || String(error) };
    }
  });

  ipcMain.removeHandler('pdv-setup-conectar');
  ipcMain.handle('pdv-setup-conectar', async (_event, body = {}) => {
    try {
      const ipServidor = String(body.ipServidor || '').trim();
      const porta = Number.parseInt(body.porta, 10);

      if (!ipServidor) {
        return { sucesso: false, erro: 'Informe o IP do servidor.' };
      }
      if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
        return { sucesso: false, erro: 'Informe uma porta válida.' };
      }

      const online = await testarServidorRemoto(ipServidor, porta, 8000);
      if (!online) {
        return {
          sucesso: false,
          erro: `Não foi possível conectar em ${ipServidor}:${porta}. Confirme o IP e se o ERP está em execução.`
        };
      }

      const configService = obterConfigService();
      configService.salvarModoEstacaoLocal({
        modo: 'cliente',
        ipServidor,
        porta
      });
      configService.marcarSetupPdvConcluido(true);

      const onConectado = callbacksSetup && callbacksSetup.onConectado;
      fecharJanelaSetup();

      if (typeof onConectado === 'function') {
        await onConectado({
          modo: 'cliente',
          ipServidor,
          porta
        });
      }

      return { sucesso: true, reiniciado: false };
    } catch (error) {
      console.error('[PDV-SETUP] Erro ao conectar:', error);
      return { sucesso: false, erro: error.message || String(error) };
    }
  });

  ipcMain.removeHandler('pdv-setup-usar-local');
  ipcMain.handle('pdv-setup-usar-local', async () => {
    try {
      const configService = obterConfigService();
      const atual = configService.obterModoEstacaoLocal();
      configService.salvarModoEstacaoLocal({
        modo: 'local',
        porta: atual.porta || 3002
      });
      configService.marcarSetupPdvConcluido(true);

      const onLocal = callbacksSetup && callbacksSetup.onLocal;
      fecharJanelaSetup();

      if (typeof onLocal === 'function') {
        await onLocal();
      }

      return { sucesso: true };
    } catch (error) {
      console.error('[PDV-SETUP] Erro ao iniciar modo local:', error);
      return { sucesso: false, erro: error.message || String(error) };
    }
  });
}

function abrirTelaSetupPdv({ tituloJanela, onConectado, onLocal } = {}) {
  registrarHandlersSetupPdv();
  callbacksSetup = { onConectado, onLocal };

  setupWindow = new BrowserWindow({
    width: 960,
    height: 620,
    title: tituloJanela || 'CDS PDV — Conectar ao servidor',
    show: false,
    autoHideMenuBar: true,
    resizable: true,
    icon: path.join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  global.mainWindow = setupWindow;

  setupWindow.once('ready-to-show', () => {
    setupWindow.show();
    setupWindow.focus();
  });

  setupWindow.on('closed', () => {
    setupWindow = null;
  });

  const htmlPath = path.join(__dirname, 'frontend', 'pdv', 'setup-servidor.html');
  return setupWindow.loadFile(htmlPath);
}

module.exports = {
  precisaSetupInicialPdv,
  abrirTelaSetupPdv,
  fecharJanelaSetup,
  registrarHandlersSetupPdv
};
