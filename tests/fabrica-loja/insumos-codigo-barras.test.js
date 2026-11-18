/**
 * Sprint Insumos 01 — campo Código de barras no cadastro de Insumos.
 * Formulário testado em VM com DOM simulado; persistência em SQLite em memória.
 * Executar: node tests/fabrica-loja/insumos-codigo-barras.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const EAN13Service = require('../../backend/services/ean13/EAN13Service');

const FONTE = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/insumos.js'), 'utf8');
const BASE = '001234567890';
const EAN_ZEROS = BASE + EAN13Service.calculateCheckDigit(BASE);

function criarAmbiente() {
  const chamadas = [];
  const valores = {};
  const ctx = {
    API_URL: '/api',
    localStorage: { getItem: () => 'token' },
    showNotification: () => {},
    console
  };
  ctx.window = ctx;
  ctx.$ = (seletor) => ({ remove() {}, on() {}, off() {} });
  ctx.$.ajax = (opcoes) => {
    chamadas.push({ ...opcoes, dados: opcoes.data ? JSON.parse(opcoes.data) : null });
    const encadeavel = {
      done(cb) {
        if (['POST', 'PUT'].includes(opcoes.method)) cb({ id: 99, ...JSON.parse(opcoes.data) });
        return encadeavel;
      },
      fail() { return encadeavel; },
      always() { return encadeavel; }
    };
    return encadeavel;
  };
  let html = '';
  let submit = null;
  ctx.document = {
    body: { insertAdjacentHTML: (_pos, conteudo) => { html = conteudo; } },
    querySelector: () => null,
    getElementById(id) {
      if (id === 'ins-modal') {
        return { addEventListener: (evento, fn) => { if (evento === 'submit') submit = fn; } };
      }
      const alvo = {
        get value() {
          if (id in valores) return valores[id];
          const m = html.match(new RegExp(`id="${id}"[^>]*?value="([^"]*)"`));
          return m ? m[1] : '';
        },
        set value(v) { valores[id] = v; },
        textContent: '',
        disabled: false,
        focus() {}
      };
      return alvo;
    }
  };
  vm.createContext(ctx);
  ctx.insCarregar = () => {};
  ctx.insCarregarEstoque = () => {};
  vm.runInContext(FONTE, ctx);
  ctx.insCarregar = () => {};
  ctx.insCarregarEstoque = () => {};
  return {
    ctx,
    chamadas,
    get html() { return html; },
    valorCampo: (id) => ctx.document.getElementById(id).value,
    definir: (id, v) => { valores[id] = v; },
    salvar: () => submit({ preventDefault() {} })
  };
}

describe('Insumos — campo Código de barras', () => {
  it('exibe o campo opcional, textual, separado do código interno', () => {
    const amb = criarAmbiente();
    amb.ctx.insAbrirEditor(null);
    assert.match(amb.html, /<label class="form-label" for="ins-codigo-barras">Código de barras<\/label>/);
    assert.match(amb.html, /id="ins-codigo-barras" type="text" inputmode="numeric"/);
    assert.doesNotMatch(amb.html, /id="ins-codigo-barras"[^>]*required/);
    ['ins-nome', 'ins-codigo', 'ins-unidade', 'ins-grupo'].forEach((id) => assert.match(amb.html, new RegExp(`id="${id}"`)));
  });

  it('novo insumo com código de barras envia o valor completo, com zeros à esquerda', () => {
    const amb = criarAmbiente();
    amb.ctx.insAbrirEditor(null);
    amb.definir('ins-nome', 'AÇAI BARRA');
    amb.definir('ins-unidade', 'KG');
    amb.definir('ins-codigo-barras', ` ${EAN_ZEROS} `);
    amb.salvar();
    const envio = amb.chamadas.find((c) => c.method === 'POST');
    assert.equal(envio.url, '/api/produtos');
    assert.equal(envio.dados.codigo_barras, EAN_ZEROS);
    assert.ok(envio.dados.codigo_barras.startsWith('00'));
    assert.notEqual(envio.dados.codigo, EAN_ZEROS);
    assert.equal(envio.dados.natureza_cadastro, 'INSUMO');
  });

  it('novo insumo sem código de barras envia vazio, sem inventar GTIN', () => {
    const amb = criarAmbiente();
    amb.ctx.insAbrirEditor(null);
    amb.definir('ins-nome', 'SEM GTIN');
    amb.definir('ins-unidade', 'UN');
    amb.salvar();
    assert.equal(amb.chamadas.find((c) => c.method === 'POST').dados.codigo_barras, '');
  });

  it('edição carrega o código existente e o preserva ao atualizar', () => {
    const amb = criarAmbiente();
    amb.ctx.insAbrirEditor({ id: 7, nome: 'X', codigo: '0007', unidade: 'UN', codigo_barras: EAN_ZEROS });
    assert.equal(amb.valorCampo('ins-codigo-barras'), EAN_ZEROS);
    amb.salvar();
    const envio = amb.chamadas.find((c) => c.method === 'PUT');
    assert.equal(envio.url, '/api/produtos/7');
    assert.equal(envio.dados.codigo_barras, EAN_ZEROS);
    assert.equal(envio.dados.codigo, '0007');
  });

  it('F3 pré-preenche o GTIN válido do XML e não faz nenhuma chamada ao salvar sozinho', () => {
    const amb = criarAmbiente();
    amb.ctx.abrirCadastroInsumoMiip({ produto_nome: 'AÇAI', unidade: 'KG', codigo_barras: EAN_ZEROS, codigo_fornecedor: '205' }, () => {});
    assert.equal(amb.valorCampo('ins-codigo-barras'), EAN_ZEROS);
    assert.notEqual(amb.valorCampo('ins-codigo'), '205');
    assert.equal(amb.chamadas.filter((c) => c.method === 'POST' || c.method === 'PUT').length, 0);
    assert.equal(amb.chamadas.some((c) => /miip/.test(c.url)), false);
  });

  it('F3 deixa o campo vazio quando o XML não tem GTIN ou ele é incompatível', () => {
    ['', 'SEM GTIN', '12345', '7891234567890'].forEach((gtin) => {
      const amb = criarAmbiente();
      amb.ctx.abrirCadastroInsumoMiip({ produto_nome: 'P', unidade: 'UN', codigo_barras: gtin }, () => {});
      assert.equal(amb.valorCampo('ins-codigo-barras'), '', `GTIN "${gtin}"`);
    });
  });

  it('o fluxo F3 não confirma vínculo MIIP ao cadastrar', () => {
    const insumos = FONTE.slice(FONTE.indexOf('window.abrirCadastroInsumoMiip'), FONTE.indexOf('function insSalvar(aoSalvar)'));
    assert.doesNotMatch(insumos, /miip\/feedback|produto_id|aplicarConfirmacao/);
  });
});

describe('Insumos — persistência do código de barras (SQLite em memória)', () => {
  function abrirBanco() {
    const db = new sqlite3.Database(':memory:');
    const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => (e ? rej(e) : res())));
    const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));
    return { db, run, get };
  }

  it('grava e relê com zeros à esquerda, aceita vazio e rejeita duplicado', async () => {
    const { db, run, get } = abrirBanco();
    await run('CREATE TABLE produtos (id INTEGER PRIMARY KEY, codigo TEXT, nome TEXT, codigo_barras TEXT)');
    const existe = (codigo, excluir) => EAN13Service.exists(db, codigo, excluir);

    const gravado = await EAN13Service.validarParaPersistencia(EAN_ZEROS, { exists: existe });
    await run('INSERT INTO produtos (id, codigo, nome, codigo_barras) VALUES (1, ?, ?, ?)', ['0001', 'A', gravado]);
    assert.equal((await get('SELECT codigo_barras FROM produtos WHERE id = 1')).codigo_barras, EAN_ZEROS);

    assert.equal(await EAN13Service.validarParaPersistencia('', { exists: existe }), '');
    await assert.rejects(EAN13Service.validarParaPersistencia(EAN_ZEROS, { exists: existe }), { statusCode: 409 });
    assert.equal(
      await EAN13Service.validarParaPersistencia(EAN_ZEROS, { produtoId: 1, codigoAtual: EAN_ZEROS, exists: existe }),
      EAN_ZEROS
    );
    await assert.rejects(EAN13Service.validarParaPersistencia('7891234567890', {}), { statusCode: 400 });
    db.close();
  });
});
