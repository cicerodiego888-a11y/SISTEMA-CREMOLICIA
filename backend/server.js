const path = require('path');

console.log('SERVER RODANDO DE:', process.cwd());
console.log('SERVER FILE:', __filename);

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { isCorsOriginAllowed } = require('./config/secrets');
const { verificarToken } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use((req, res, next) => {
  cors({
    origin(origin, callback) {
      if (isCorsOriginAllowed(origin, req.headers.host)) {
        return callback(null, true);
      }
      callback(new Error('Origem não permitida pelo CORS'));
    },
    credentials: true
  })(req, res, next);
});
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/ping', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok' });
});

const mobileIconsDir = path.join(__dirname, '../frontend/apps/mobile/icons');
function sendMobileIcon(res, fileName, contentType) {
  res.type(contentType);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(mobileIconsDir, fileName));
}

// Ícones na RAIZ do domínio — iOS/Android buscam aqui ao salvar o atalho/link
app.get('/favicon.ico', (req, res) => sendMobileIcon(res, 'favicon-32.png', 'image/png'));
app.get(['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/apple-touch-icon-180x180.png', '/apple-touch-icon-180x180-precomposed.png'], (req, res) => {
  sendMobileIcon(res, 'apple-touch-icon.png', 'image/png');
});
app.get('/icon-192.png', (req, res) => sendMobileIcon(res, 'icon-192.png', 'image/png'));
app.get('/icon-512.png', (req, res) => sendMobileIcon(res, 'icon-512.png', 'image/png'));
app.get('/icon-512-maskable.png', (req, res) => sendMobileIcon(res, 'icon-512-maskable.png', 'image/png'));
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, '../frontend/manifest.webmanifest'));
});

// MIME correto para PWA (atalho/ícone no celular)
express.static.mime.define({
  'application/manifest+json': ['webmanifest'],
  'image/png': ['png'],
  'image/x-icon': ['ico']
});
app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders(res, filePath) {
    if (/\.(png|ico|webmanifest|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

function getWritableStoragePath() {
    if (process.platform === 'win32') {
      return path.join(
        process.env.PROGRAMDATA || 'C:\\ProgramData',
        'CDS Sistemas',
        'CDS Sistemas'
      );
    }
  
    return path.join(process.cwd(), 'dados-app');
  }
  
  // primeiro tenta no local correto (produção)
  app.use('/storage', express.static(path.join(getWritableStoragePath(), 'storage')));
  
  // fallback (para desenvolvimento)
  app.use('/storage', express.static(path.join(__dirname, '../storage')));

// Rotas públicas
const { router: authRouter } = require('./rotas/auth');
app.use('/api/auth', authRouter);

// Rota pública para configuração de fundo do login
const db = require('./database');
app.get('/api/configuracoes/login_background', (req, res) => {
    db.get("SELECT valor FROM configuracoes WHERE chave = 'login_background'", [], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ valor: row ? row.valor : null });
    });
});

const frontendRoot = path.join(__dirname, '../frontend');

// Login e módulos ERP/PDV (páginas HTML)
app.get('/login', (req, res) => {
    res.sendFile(path.join(frontendRoot, 'shared/login.html'));
});

app.get(['/pdv', '/pdv/'], verificarToken, (req, res) => {
    res.sendFile(path.join(frontendRoot, 'pdv/index.html'));
});

app.get(['/erp', '/erp/'], verificarToken, (req, res) => {
    res.sendFile(path.join(frontendRoot, 'erp/index.html'));
});


// Rotas protegidas (API)
const produtosRoutes = require('./rotas/produtos');
const clientesRoutes = require('./rotas/clientes');
const comprasRoutes = require('./rotas/compras');
const miipRoutes = require('./rotas/miip');
const categoriasRoutes = require('./rotas/categorias');
const subcategoriasRoutes = require('./rotas/subcategorias');
const vendasRoutes = require('./rotas/vendas');
const financeiroRoutes = require('./rotas/financeiro');
const configuracoesRoutes = require('./rotas/configuracoes');
const configuracaoRedeRoutes = require('./rotas/configuracao_rede');
const fiscalRoutes = require('./rotas/fiscal');
const fornecedoresRoutes = require('./rotas/fornecedores');
const impressaoRoutes = require('./rotas/impressao');
const caixaRoutes = require('./rotas/caixa');
const caixasRoutes = require('./rotas/caixas');
const terminaisRoutes = require('./rotas/terminais');
const backupRoutes = require('./rotas/backup');
const tefRoutes = require('./rotas/tef');
const pixRoutes = require('./rotas/pix');
const dashboardRoutes = require('./rotas/dashboard');
const contasReceberRoutes = require('./rotas/contas_receber');
const alertasRoutes = require('./rotas/alertas');
const auditoriaRoutes = require('./rotas/auditoria');
const licencaRoutes = require('./rotas/licenca');
const dfeRoutes = require('./rotas/dfe');
const centralEntradasRoutes = require('./rotas/central-entradas');
const equipamentosRoutes = require('./rotas/equipamentos');
const laboratorioEquipamentosRoutes = require('./rotas/laboratorioEquipamentos');
const engenhariaReversaRoutes = require('./rotas/engenhariaReversa');
const comercialRoutes = require('./motores/motor-comercial/routes/comercial.routes');
const conversaoFisicaLoteRoutes = require('./motores/motor-conversao-comercial/routes/conversaoFisicaLote.routes');
const { canaisRouter: canaisVendaRoutes, tabelasRouter: tabelasPrecoRoutes, configuracaoRouter: configuracaoComercialRoutes, diagnosticoRouter: diagnosticoComercialRoutes, casquinhaSaboresRouter: casquinhaSaboresRoutes, linhasRouter: linhasComerciaisRoutes, kitsRouter: kitsCombosRoutes, tiposComerciaisRouter: tiposComerciaisRoutes } = require('./modules/comercial');
const licencaMiddleware = require('./middleware/licencaMiddleware');
const configuracoesAvancadasRoutes = require('./rotas/configuracoes_avancadas');
const { exigirRecurso } = require('./middleware/validarRecursoImplantacao');
const configService = require('./services/configuracaoService');

configService.ensureConfigFile();
configService.reloadGlobalConfig();

app.use('/api/produtos', verificarToken, produtosRoutes);
app.use('/api/clientes', verificarToken, clientesRoutes);
app.use('/api/compras', verificarToken, comprasRoutes);
app.use('/api/miip', verificarToken, miipRoutes);
app.use('/api/categorias', verificarToken, categoriasRoutes);
app.use('/api/subcategorias', verificarToken, subcategoriasRoutes);
app.use('/api/vendas', verificarToken, vendasRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/financeiro', verificarToken, financeiroRoutes);
app.use('/api/contas-receber', verificarToken, contasReceberRoutes);
app.use('/api/configuracoes', verificarToken, configuracoesRoutes);
app.use('/api/configuracao-rede', verificarToken, configuracaoRedeRoutes);
app.use('/api/configuracoes-avancadas', verificarToken, configuracoesAvancadasRoutes);
app.use('/api/fiscal', verificarToken, fiscalRoutes);
app.use('/api/fornecedores', verificarToken, fornecedoresRoutes);
app.use('/api/impressao', verificarToken, impressaoRoutes);
app.use('/api/caixa', verificarToken, caixaRoutes);
app.use('/api/caixas', verificarToken, exigirRecurso('multiCaixa'), caixasRoutes);
app.get('/api/terminais/auto', terminaisRoutes.registrarTerminalAuto);
app.get('/api/terminais/auto/offline', terminaisRoutes.registrarTerminalOffline);
app.put(
  '/api/terminais/auto/nome',
  verificarToken,
  terminaisRoutes.exigirSuperAdminTerminal,
  terminaisRoutes.atualizarNomeTerminalPdv
);
app.post(
  '/api/terminais/auto/nome',
  verificarToken,
  terminaisRoutes.exigirSuperAdminTerminal,
  terminaisRoutes.atualizarNomeTerminalPdv
);
app.use('/api/terminais', verificarToken, exigirRecurso('multiCaixa'), terminaisRoutes);
app.use('/api/backup', verificarToken, backupRoutes);
app.use('/api/tef', verificarToken, tefRoutes);
app.use('/api/pix', verificarToken, pixRoutes);
app.use('/api/alertas', verificarToken, alertasRoutes);
app.use('/api/auditoria', verificarToken, auditoriaRoutes);
app.use('/api/sistema', verificarToken, require('./rotas/sistema'));
app.use('/api/dfe', verificarToken, exigirRecurso('fiscal'), dfeRoutes);
app.use('/api/central-entradas', verificarToken, exigirRecurso('fiscal'), centralEntradasRoutes);
app.use('/api/equipamentos', verificarToken, equipamentosRoutes);
app.use('/api/laboratorio-equipamentos', verificarToken, laboratorioEquipamentosRoutes);
app.use('/api/engenharia-reversa', verificarToken, engenhariaReversaRoutes);
app.use('/api/comercial', verificarToken, comercialRoutes);
app.use('/api/canais-venda', verificarToken, canaisVendaRoutes);
app.use('/api/tipos-comerciais', verificarToken, tiposComerciaisRoutes);
app.use('/api/tabelas-preco', verificarToken, tabelasPrecoRoutes);
app.use('/api/configuracao-comercial', verificarToken, configuracaoComercialRoutes);
app.use('/api/diagnostico-comercial', verificarToken, diagnosticoComercialRoutes);
app.use('/api/casquinha-sabores', verificarToken, casquinhaSaboresRoutes);
app.use('/api/linhas-comerciais', verificarToken, linhasComerciaisRoutes);
app.use('/api/kits', verificarToken, kitsCombosRoutes);
app.use('/api/lotes/:loteId/conversao-fisica', verificarToken, conversaoFisicaLoteRoutes);

// Rotas de licença (públicas)
app.use('/api/licenca', licencaRoutes);

// Middleware de licença para todas as APIs exceto auth e licença
app.use('/api', licencaMiddleware);

// Rota principal — redireciona para o ERP modular
app.get('/', verificarToken, (req, res) => {
    res.redirect('/erp');
});

// Rota para arquivos estáticos (não proteger)
app.get('*.js', (req, res, next) => {
    next();
});
app.get('*.css', (req, res, next) => {
    next();
});
app.get('*.png', (req, res, next) => {
    next();
});
app.get('*.jpg', (req, res, next) => {
    next();
});

// Error handler — JSON inválido
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Requisição inválida.' });
    }
    next(err);
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Erro:', err);
    if (err && String(err.message || '').includes('CORS')) {
        return res.status(403).json({ error: 'Origem não permitida pelo CORS' });
    }
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// Iniciar servidor somente após o banco estar pronto (evita SQLITE_BUSY no login do PDV)
const server = http.createServer(app);
module.exports = server;

const motorEquipamentos = require('./motores/equipamentos');
const motorComercial = require('./motores/motor-comercial');
const monitorService = require('./motores/equipamentos/monitor/MonitorService');
const driverManager = require('./motores/equipamentos/core/DriverManager');

async function inicializarMotorEquipamentos() {
    await motorEquipamentos.inicializar();
    driverManager.obterRelatorioCarregamento();
    monitorService.iniciar();
    console.log('Motor de Equipamentos inicializado (fila, drivers, monitor).');
}

async function inicializarMotorComercial() {
    await motorComercial.inicializar({ db });
}

const { sincronizarFinanceiroVendasCanceladas } = require('./services/vendas/VendaFinanceiroService');

async function inicializarFinanceiroVendas() {
    const resultado = await sincronizarFinanceiroVendasCanceladas();
    if (resultado.registros_corrigidos > 0) {
        console.log(
            `Financeiro: ${resultado.registros_corrigidos} registro(s) sincronizado(s) em ${resultado.vendas} venda(s) cancelada(s).`
        );
    }
}

db.whenReady(async (readyErr) => {
    if (readyErr) {
        console.error('Servidor não iniciado: banco indisponível.', readyErr.message);
        process.exit(1);
        return;
    }

    try {
        await inicializarFinanceiroVendas();
    } catch (err) {
        console.error('Falha ao sincronizar financeiro de vendas canceladas:', err.message);
    }

    try {
        await inicializarMotorEquipamentos();
    } catch (err) {
        console.error('Falha ao inicializar Motor de Equipamentos:', err.message);
    }

    try {
        await inicializarMotorComercial();
    } catch (err) {
        console.error('ERRO: Inicialização do Motor Comercial cancelada.');
        console.error(err.message);
        process.exit(1);
    }

    try {
        const centralSyncBackground = require('./motores/central-entradas/services/CentralSyncBackgroundService');
        await centralSyncBackground.iniciar();
    } catch (err) {
        console.error('Falha ao inicializar sync automática Central Entradas:', err.message);
    }

    const encerrarSyncCentral = () => {
        try {
            const centralSyncBackground = require('./motores/central-entradas/services/CentralSyncBackgroundService');
            centralSyncBackground.parar();
        } catch { /* ignore */ }
    };
    process.on('SIGTERM', encerrarSyncCentral);
    process.on('SIGINT', encerrarSyncCentral);

    server.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
        console.log(`Acesse: http://localhost:${PORT}/login`);
        console.log('Configuração avançada:', configService.getRecursos());
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Porta ${PORT} já está em uso. Pare o processo que usa a porta ou escolha outra porta.`);
            console.error(`No Windows, use: set PORT=3001 && npm start`);
            process.exit(1);
        }
        console.error('Erro ao iniciar o servidor:', err);
        process.exit(1);
    });
});