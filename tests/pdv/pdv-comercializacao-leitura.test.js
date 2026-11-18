/**
 * LINHA DE PRODUTOS 02 — O PDV (Desktop e Mobile) lê a configuração de Comercialização
 * em GET /api/configuracoes-avancadas/comercializacao e guarda em memória.
 * Sem resposta válida: venda por produto = true, venda por linha = false (comportamento atual).
 * A leitura não decide nada no fluxo de venda nesta sprint.
 * Executar: npm run test:pdv-comercializacao
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TMP = path.resolve(os.tmpdir()).toLowerCase();
if (!process.env.DB_DIR || !path.resolve(process.env.DB_DIR).toLowerCase().startsWith(TMP)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/pdv/pdv-comercializacao-leitura.test.js');
  process.exit(1);
}
const DIR_CONFIG = path.join(process.env.DB_DIR, 'config');
fs.rmSync(DIR_CONFIG, { recursive: true, force: true });

const express = require('express');

const RAIZ = path.join(__dirname, '..', '..');
const CAMINHO_MODULO = path.join(RAIZ, 'frontend', 'shared', 'js', 'pdvComercializacao.js');
const PDV_DESKTOP = path.join(RAIZ, 'frontend', 'pdv', 'js', 'pdv.js');
const PDV_MOBILE = path.join(RAIZ, 'frontend', 'apps', 'mobile', 'js', 'pages', 'pdv.js');
const fonteDesktop = fs.readFileSync(PDV_DESKTOP, 'utf8');
const fonteMobile = fs.readFileSync(PDV_MOBILE, 'utf8');

const PADRAO = { permitirVendaPorProduto: true, permitirVendaPorLinha: false };

let servidor;
let base;
let perfilRequisicao = 'OPERADOR';
let rotaDisponivel = true;

function moduloNovo() {
  delete require.cache[require.resolve(CAMINHO_MODULO)];
  return require(CAMINHO_MODULO);
}

function extrairFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.ok(inicio >= 0, `função ${nome} não encontrada`);
  let i = fonte.indexOf(') {', inicio) + 2;
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}' && --nivel === 0) break;
  }
  return fonte.slice(inicio, i + 1);
}

/** Executa o carregador real do PDV Desktop com o módulo compartilhado e um fetch controlado. */
function carregarDesktop(modulo, { fetchImpl = fetch, apiUrl = base } = {}) {
  const contexto = vm.createContext({
    window: { PdvComercializacao: modulo },
    API_URL: apiUrl,
    fetch: fetchImpl,
    localStorage: { getItem: () => 'token-teste' }
  });
  vm.runInContext(extrairFuncao(fonteDesktop, 'consultarApiPdv'), contexto);
  vm.runInContext(extrairFuncao(fonteDesktop, 'carregarComercializacaoPdv'), contexto);
  return contexto.carregarComercializacaoPdv();
}

/** Executa o carregador real do PDV Mobile com o módulo compartilhado e um CDSApi controlado. */
function carregarMobile(modulo, cdsApi) {
  const contexto = vm.createContext({ window: { PdvComercializacao: modulo, CDSApi: cdsApi } });
  vm.runInContext(extrairFuncao(fonteMobile, 'carregarComercializacaoMobile'), contexto);
  return contexto.carregarComercializacaoMobile();
}

/** CDSApi equivalente ao cliente real: GET em /api/<caminho>; status != 2xx vira erro. */
function cdsApiReal() {
  return {
    get: async (caminho) => {
      const res = await fetch(`${base}/${caminho}`);
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
      return res.json();
    }
  };
}

async function salvar(produto, linha) {
  const anterior = perfilRequisicao;
  perfilRequisicao = 'SUPER_ADMIN';
  const res = await fetch(`${base}/configuracoes-avancadas/comercializacao`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permitirVendaPorProduto: produto, permitirVendaPorLinha: linha })
  });
  perfilRequisicao = anterior;
  assert.equal(res.status, 200);
}

function semOrigem(obj) {
  const { origem, ...resto } = obj;
  return resto;
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, perfil: perfilRequisicao }; next(); });
  app.use('/api/configuracoes-avancadas', (req, res, next) => (rotaDisponivel ? next() : res.status(404).json({ error: 'Not found' })));
  app.use('/api/configuracoes-avancadas', require('../../backend/rotas/configuracoes_avancadas'));
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});

after(async () => {
  fs.rmSync(DIR_CONFIG, { recursive: true, force: true });
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
});

describe('PDV lê a configuração de Comercialização', () => {
  const combinacoes = [
    ['1. Produto=true / Linha=false', true, false],
    ['2. Produto=false / Linha=true', false, true],
    ['3. Produto=true / Linha=true', true, true],
    ['4. Produto=false / Linha=false', false, false]
  ];

  for (const [nome, produto, linha] of combinacoes) {
    it(`${nome} (Desktop e Mobile, operador sem perfil de administrador)`, async () => {
      await salvar(produto, linha);

      const desktop = moduloNovo();
      const lidoDesktop = await carregarDesktop(desktop);
      assert.deepEqual(lidoDesktop, { permitirVendaPorProduto: produto, permitirVendaPorLinha: linha, origem: 'servidor' });
      assert.equal(desktop.isVendaPorProdutoPermitida(), produto);
      assert.equal(desktop.isVendaPorLinhaPermitida(), linha);

      const mobile = moduloNovo();
      const lidoMobile = await carregarMobile(mobile, cdsApiReal());
      assert.deepEqual(lidoMobile, lidoDesktop);
      assert.equal(mobile.isVendaPorProdutoPermitida(), produto);
      assert.equal(mobile.isVendaPorLinhaPermitida(), linha);
      assert.deepEqual(await mobile.pronto(), lidoMobile);
    });
  }

  it('antes da resposta chegar, vale o comportamento atual (Produto=true / Linha=false)', () => {
    const modulo = moduloNovo();
    assert.deepEqual(modulo.obter(), { ...PADRAO, origem: 'padrao' });
    assert.equal(modulo.isVendaPorProdutoPermitida(), true);
    assert.equal(modulo.isVendaPorLinhaPermitida(), false);
  });

  it('5. API indisponível → Produto=true / Linha=false, sem quebrar o PDV', async () => {
    await salvar(false, true);
    const modulo = moduloNovo();
    await carregarDesktop(modulo);
    assert.equal(modulo.isVendaPorLinhaPermitida(), true);

    const semServidor = await carregarDesktop(modulo, { apiUrl: 'http://127.0.0.1:1/api' });
    assert.deepEqual(semServidor, { ...PADRAO, origem: 'padrao' });

    const rede = await carregarDesktop(moduloNovo(), { fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
    assert.deepEqual(rede, { ...PADRAO, origem: 'padrao' });

    const erro500 = await carregarDesktop(moduloNovo(), {
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: 'falha' }) })
    });
    assert.deepEqual(erro500, { ...PADRAO, origem: 'padrao' });

    const mobile = moduloNovo();
    const lidoMobile = await carregarMobile(mobile, { get: () => Promise.reject(Object.assign(new Error('Não foi possível conectar ao servidor.'), { status: 0 })) });
    assert.deepEqual(lidoMobile, { ...PADRAO, origem: 'padrao' });
    assert.equal(mobile.isVendaPorProdutoPermitida(), true);
    assert.equal(mobile.isVendaPorLinhaPermitida(), false);

    assert.deepEqual(await carregarMobile(moduloNovo(), undefined), null, 'sem CDSApi o carregador apenas não faz nada');
    assert.deepEqual(await carregarDesktop(undefined), null, 'sem o módulo o carregador apenas não faz nada');
  });

  it('6. configuração não encontrada → fallback seguro', async () => {
    fs.rmSync(DIR_CONFIG, { recursive: true, force: true });
    const semArquivo = await carregarDesktop(moduloNovo());
    assert.deepEqual(semOrigem(semArquivo), PADRAO, 'sem configuracoes.json o servidor responde o padrão');

    rotaDisponivel = false;
    try {
      const desktop = await carregarDesktop(moduloNovo());
      assert.deepEqual(desktop, { ...PADRAO, origem: 'padrao' }, 'servidor sem a rota (404)');
      const mobile = await carregarMobile(moduloNovo(), cdsApiReal());
      assert.deepEqual(mobile, { ...PADRAO, origem: 'padrao' });
    } finally {
      rotaDisponivel = true;
    }

    for (const resposta of [null, {}, { permitirVendaPorLinha: true }, { permitirVendaPorProduto: 'false', permitirVendaPorLinha: 'true' }, 'texto']) {
      const modulo = moduloNovo();
      const lido = await modulo.carregar(async () => resposta);
      assert.deepEqual(lido, { ...PADRAO, origem: 'padrao' }, `resposta ${JSON.stringify(resposta)}`);
    }
  });

  it('7. nenhuma chamada ou alteração indevida no fluxo de venda atual', async () => {
    const chamadas = [];
    const modulo = moduloNovo();
    await carregarDesktop(modulo, {
      fetchImpl: async (url, opcoes) => {
        chamadas.push({ url, metodo: (opcoes && opcoes.method) || 'GET' });
        return { ok: true, status: 200, json: async () => ({ permitirVendaPorProduto: true, permitirVendaPorLinha: true, aviso: null }) };
      }
    });
    assert.deepEqual(chamadas, [{ url: `${base}/configuracoes-avancadas/comercializacao`, metodo: 'GET' }]);

    const fonteModulo = fs.readFileSync(CAMINHO_MODULO, 'utf8');
    assert.doesNotMatch(fonteModulo, /localStorage|sessionStorage|indexedDB|document\.|fetch\(|CDSApi/, 'o módulo não grava nem consulta nada sozinho');

    // LINHA DE PRODUTOS 03: além da leitura, só a opção "Vender por Linha" consulta a configuração.
    const usoForaDe = (fonte, funcoes) => funcoes
      .reduce((resto, nome) => resto.replace(extrairFuncao(fonte, nome), ''), fonte)
      .match(/PdvComercializacao|isVendaPor(Linha|Produto)Permitida|permitirVendaPor(Linha|Produto)/g) || [];
    assert.deepEqual(usoForaDe(fonteDesktop, ['carregarComercializacaoPdv', 'atualizarOpcaoVendaPorLinhaPdv', 'abrirVendaPorLinhaPdv']), [],
      'Desktop: a configuração só é usada na leitura e na opção Vender por Linha');
    assert.deepEqual(usoForaDe(fonteMobile, ['carregarComercializacaoMobile', 'atualizarOpcaoVendaPorLinhaMobile', 'bindVendaPorLinhaMobile', 'abrirVendaPorLinhaMobile']), [],
      'Mobile: a configuração só é usada na leitura e na opção Vender por Linha');
    assert.equal(fonteDesktop.match(/(?<!function )carregarComercializacaoPdv\(\)/g).length, 1, 'Desktop: leitura chamada uma vez, na inicialização');
    assert.match(extrairFuncao(fonteDesktop, 'inicializarPDV'), /carregarComercializacaoPdv\(\)/);
    assert.equal(fonteMobile.match(/(?<!function )carregarComercializacaoMobile\(\)/g).length, 1, 'Mobile: leitura chamada uma vez, ao abrir o PDV');
    assert.match(extrairFuncao(fonteMobile, 'renderPdv'), /carregarComercializacaoMobile\(\);/);

    const fontesPdv = [];
    const varrer = (dir) => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, item.name);
        if (item.isDirectory()) varrer(completo);
        else if (/\.(js|html)$/.test(item.name) && completo !== CAMINHO_MODULO) fontesPdv.push(completo);
      }
    };
    varrer(path.join(RAIZ, 'frontend', 'pdv'));
    varrer(path.join(RAIZ, 'frontend', 'apps'));
    varrer(path.join(RAIZ, 'frontend', 'shared', 'js'));
    const relativo = (f) => path.relative(RAIZ, f).replace(/\\/g, '/');
    const decidemProduto = fontesPdv.filter((f) => /isVendaPorProdutoPermitida|\.obter\(\)\.permitirVendaPor/.test(fs.readFileSync(f, 'utf8')));
    assert.deepEqual(decidemProduto, [], 'a venda por produto não depende da configuração');
    const decidemLinha = fontesPdv.filter((f) => /isVendaPorLinhaPermitida/.test(fs.readFileSync(f, 'utf8'))).map(relativo);
    assert.deepEqual(decidemLinha, ['frontend/shared/js/pdvVendaPorLinha.js'], 'só a opção Vender por Linha decide com base na configuração');
    const carregamScript = fontesPdv
      .filter((f) => f.endsWith('.html') && /pdvComercializacao\.js/.test(fs.readFileSync(f, 'utf8')))
      .map(relativo)
      .sort();
    assert.deepEqual(carregamScript, ['frontend/apps/mobile/index.html', 'frontend/pdv/index.html']);
  });
});
