/**
 * PDV — identidade e resolução segura de produtos.
 * Uma entrada só adiciona automaticamente quando há correspondência inequívoca;
 * o ID nunca é reconhecido por digitação.
 * Banco temporário (os.tmpdir). Não abre o banco oficial.
 * Executar: npm run test:pdv-identidade
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

const Resolucao = require('../../frontend/shared/js/pdvResolucaoProduto');
const {
  prepararTermoIdentificacao,
  sqlMatchExatoProdutoPdv,
  paramsMatchExatoProdutoPdv
} = require('../../backend/services/pdv/identificacaoProdutoPdv');

const raiz = path.join(__dirname, '../..');

function ler(relativo) {
  return fs.readFileSync(path.join(raiz, relativo), 'utf8');
}

function extrairFuncao(src, nome) {
  const inicio = src.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`Função ${nome} não encontrada`);
  let nivel = 0;
  for (let i = src.indexOf(') {', inicio) + 2; i < src.length; i += 1) {
    if (src[i] === '{') nivel += 1;
    else if (src[i] === '}') {
      nivel -= 1;
      if (nivel === 0) return src.slice(inicio, i + 1);
    }
  }
  throw new Error(`Fim da função ${nome} não encontrado`);
}

function constanteMensagemInsumo(src) {
  const linha = /const MENSAGEM_PRODUTO_INSUMO_PDV = [^\n]+/.exec(src);
  if (!linha) throw new Error('MENSAGEM_PRODUTO_INSUMO_PDV não encontrada');
  return linha[0];
}

const MENSAGEM_INSUMO = 'Este produto é um insumo e não pode ser vendido pelo PDV.';

// Ordem igual ao GET /produtos (id DESC)
function catalogo() {
  return [
    { id: 340, nome: 'Matéria-prima PIC-12', codigo: 'PIC-12', codigo_barras: '', unidade: 'UN', ativo: 1 },
    { id: 210, nome: 'Picolé Uva', codigo: '0012', codigo_barras: '', unidade: 'UN', ativo: 1 },
    { id: 150, nome: 'Pote 2L Chocolate', codigo: 'POTE2L', codigo_barras: '7891234567895', unidade: 'UN', ativo: 1 },
    { id: 130, nome: 'Produto Inativo', codigo: 'INAT', codigo_barras: '7890000000017', unidade: 'UN', ativo: 0 },
    { id: 120, nome: 'Casquinha', codigo: '12', codigo_barras: '', unidade: 'UN', ativo: 1 },
    { id: 12, nome: 'Sorvete Morango 1L', codigo: 'SM1L', codigo_barras: '', unidade: 'UN', ativo: 1 },
    { id: 2, nome: 'Água 500ml', codigo: 'AGUA', codigo_barras: '', unidade: 'UN', ativo: 1 },
    { id: 1, nome: 'Açaí KG', codigo: '', codigo_barras: '', unidade: 'KG', ativo: 1 }
  ];
}

function ids(resultado) {
  return resultado.candidatos.map((p) => p.id).sort((a, b) => a - b);
}

describe('Resolução local (pdvResolucaoProduto)', () => {
  it('"12" é ambíguo entre os códigos "12" e "0012"; ID 12 e "PIC-12" não entram', () => {
    const r = Resolucao.resolverEntrada(catalogo(), '12');
    assert.equal(r.status, 'AMBIGUO');
    assert.deepEqual(ids(r), [120, 210]);
  });

  it('"12" é único quando só um código interno equivale', () => {
    const lista = catalogo().filter((p) => p.id !== 210);
    const r = Resolucao.resolverEntrada(lista, '12');
    assert.equal(r.status, 'UNICO');
    assert.equal(r.produto.id, 120);
  });

  it('ID digitado nunca seleciona produto', () => {
    const lista = catalogo().filter((p) => ![120, 210].includes(p.id));
    assert.equal(Resolucao.resolverEntrada(lista, '12').status, 'NENHUM');
    assert.equal(Resolucao.resolverEntrada(lista, '2').status, 'NENHUM');
  });

  it('letras não são descartadas: "PIC-12" só corresponde ao código "PIC-12"', () => {
    const r = Resolucao.resolverEntrada(catalogo(), 'pic-12');
    assert.equal(r.status, 'UNICO');
    assert.equal(r.produto.id, 340);
  });

  it('texto de nome com número não vira código', () => {
    assert.equal(Resolucao.resolverEntrada(catalogo(), 'pote 2l').status, 'NENHUM');
    assert.equal(Resolucao.resolverEntrada(catalogo(), 'sorvete 1l').status, 'NENHUM');
    assert.equal(Resolucao.resolverEntrada(catalogo(), 'agua 500ml').status, 'NENHUM');
  });

  it('código de barras exato é único', () => {
    const r = Resolucao.resolverEntrada(catalogo(), '7891234567895');
    assert.equal(r.status, 'UNICO');
    assert.equal(r.produto.id, 150);
  });

  it('código de barras de um produto igual ao código interno de outro é ambíguo', () => {
    const lista = catalogo().concat([{ id: 400, nome: 'Outro', codigo: '7891234567895', ativo: 1 }]);
    const r = Resolucao.resolverEntrada(lista, '7891234567895');
    assert.equal(r.status, 'AMBIGUO');
    assert.deepEqual(ids(r), [150, 400]);
  });

  it('produto inativo não é resolvido por código nem por código de barras', () => {
    assert.equal(Resolucao.resolverEntrada(catalogo(), 'INAT').status, 'NENHUM');
    assert.equal(Resolucao.resolverEntrada(catalogo(), '7890000000017').status, 'NENHUM');
  });

  it('balança: PLU 00001 resolve o produto sem código de ID 1, não "SM1L"', () => {
    const r = Resolucao.resolverEntrada(catalogo(), '2000010014890');
    assert.equal(r.status, 'UNICO');
    assert.equal(r.produto.id, 1);
    assert.equal(r.balanca.plu, '00001');
    assert.equal(r.balanca.valorTotal, 14.89);
  });

  it('balança: PLU usa o código interno numérico e ignora o ID de produto com código', () => {
    const lista = [
      { id: 7, nome: 'Açaí com código', codigo: '00045', unidade: 'KG', ativo: 1 },
      { id: 45, nome: 'Produto ID 45', codigo: 'X45', unidade: 'KG', ativo: 1 }
    ];
    const r = Resolucao.resolverEntrada(lista, '2000450010003');
    assert.equal(r.status, 'UNICO');
    assert.equal(r.produto.id, 7);
  });

  it('balança: PLU com dois produtos equivalentes é ambíguo', () => {
    const lista = [
      { id: 7, nome: 'Açaí A', codigo: '1', unidade: 'KG', ativo: 1 },
      { id: 8, nome: 'Açaí B', codigo: '00001', unidade: 'KG', ativo: 1 }
    ];
    const r = Resolucao.resolverEntrada(lista, '2000010014890');
    assert.equal(r.status, 'AMBIGUO');
    assert.ok(r.balanca);
  });

  it('código de barras real iniciado em 2 é tratado como código, não como balança', () => {
    const lista = catalogo().concat([{ id: 500, nome: 'Item de loja', codigo_barras: '2000120005005', ativo: 1 }]);
    const r = Resolucao.resolverEntrada(lista, '2000120005005');
    assert.equal(r.status, 'UNICO');
    assert.equal(r.produto.id, 500);
    assert.equal(r.balanca, null);
  });
});

function criarAmbientePdv(produtos, respostaApi = () => []) {
  const pdvSrc = ler('frontend/pdv/js/pdv.js');
  const registros = { porId: [], balanca: [], notificacoes: [], fetches: [] };
  const elementos = {};

  function elemento(id) {
    if (!elementos[id]) {
      const ouvintes = {};
      elementos[id] = {
        id,
        value: '',
        innerHTML: '',
        classList: { add() {}, remove() {} },
        addEventListener(evento, fn) { ouvintes[evento] = fn; },
        focus() { ctx.document.activeElement = this; },
        querySelector(seletor) {
          if (id !== 'listaProdutosPdv') return null;
          const indice = /^\[data-index="(\d+)"\]$/.exec(seletor)?.[1];
          if (indice == null) return null;
          const tag = new RegExp(`<button[^>]*data-index="${indice}"[^>]*>`).exec(this.innerHTML)?.[0];
          if (!tag) return null;
          return {
            dataset: { index: indice },
            disabled: /\sdisabled(?:\s|>)/.test(tag),
            focus() { ctx.document.activeElement = this; },
            closest(classe) { return classe === '.pdv-autocomplete-item' ? this : null; }
          };
        },
        ouvintes
      };
    }
    return elementos[id];
  }

  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    API_URL: '/api',
    document: { activeElement: null, getElementById: elemento },
    localStorage: { getItem: () => '' },
    fetch: (url) => {
      const termo = decodeURIComponent(/q=([^&]*)/.exec(url)[1]);
      registros.fetches.push(termo);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(respostaApi(termo)) });
    },
    showNotification: (mensagem, tipo) => registros.notificacoes.push({ mensagem, tipo }),
    pdvValidarEstoqueVenda: () => ({ sucesso: true }),
    adicionarProdutoConsultaPDV: (id) => registros.porId.push(Number(id)),
    enriquecerProdutoCanalPdv: (produto, cb) => cb({ ...produto, preco_venda: 50 }),
    buscarPromocaoAtivaProduto: () => Promise.resolve(null),
    adicionarItemNoCarrinho: (produto, quantidade) => registros.balanca.push({ id: produto.id, quantidade }),
    formatarQuantidadePdv: (q) => String(q),
    formatCurrency: (v) => `R$ ${v}`,
    focarCampoCodigo: () => {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);

  vm.runInContext(ler('frontend/shared/js/pdvResolucaoProduto.js'), ctx);
  const funcoes = [
    'produtoEhInsumoPdv', 'normalizarProdutoPdvLista', 'unidadeEhKg', 'garantirProdutoDisponivelPdv',
    'resolverProdutoEntradaPdv', 'mostrarCandidatosEntradaPdv',
    'adicionarProdutoBalancaPdv', 'adicionarProdutoPorCodigo'
  ];
  vm.runInContext(
    `let produtosDisponiveis = ${JSON.stringify(produtos)};\n`
    + `${constanteMensagemInsumo(pdvSrc)}\n`
    + funcoes.map((nome) => extrairFuncao(pdvSrc, nome)).join('\n')
    + '\nfunction quantidadeProdutosPdv() { return produtosDisponiveis.length; }',
    ctx
  );
  vm.runInContext(ler('frontend/shared/js/pdvBuscaProduto.js'), ctx);
  ctx.PdvBuscaProduto.inicializar();

  const input = elemento('buscaProdutoPdv');
  const lista = elemento('listaProdutosPdv');

  async function aguardar(ms = 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    ctx,
    registros,
    input,
    lista,
    textoLista: () => lista.innerHTML
      .replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim(),
    async digitar(texto, esperar = 260) {
      input.value = texto;
      input.ouvintes.input();
      await aguardar(esperar);
    },
    async enter() {
      input.ouvintes.keydown({ key: 'Enter', target: input, preventDefault() {}, stopPropagation() {} });
      await aguardar(10);
    },
    async seta() {
      input.ouvintes.keydown({ key: 'ArrowDown', target: input, preventDefault() {}, stopPropagation() {} });
    },
    async tab() {
      input.ouvintes.keydown({ key: 'Tab', target: input, shiftKey: false, preventDefault() {}, stopPropagation() {} });
    },
    async setaLista(key) {
      lista.ouvintes.keydown({
        key,
        target: ctx.document.activeElement,
        preventDefault() {},
        stopPropagation() {}
      });
    },
    async clicar(index) {
      lista.ouvintes.click({ target: { closest: () => ({ disabled: false, dataset: { index: String(index) } }) } });
      await aguardar(10);
    }
  };
}

describe('Fluxo do PDV desktop (pdv.js + pdvBuscaProduto.js)', () => {
  it('Enter em "12" ambíguo não adiciona nada e mostra os candidatos', async () => {
    const pdv = criarAmbientePdv(catalogo());
    await pdv.digitar('12', 0);
    await pdv.enter();
    assert.deepEqual(pdv.registros.porId, []);
    assert.match(pdv.textoLista(), /Mais de um produto corresponde a "12"/);
    assert.match(pdv.textoLista(), /Casquinha/);
    assert.match(pdv.textoLista(), /Picolé Uva/);
    assert.doesNotMatch(pdv.textoLista(), /Sorvete Morango|PIC-12/);
    assert.ok(pdv.registros.notificacoes.some((n) => n.tipo === 'warning'));
  });

  it('Enter de novo sem selecionar continua sem adicionar; seleção adiciona pelo produto_id', async () => {
    const pdv = criarAmbientePdv(catalogo());
    await pdv.digitar('12', 0);
    await pdv.enter();
    await pdv.enter();
    assert.deepEqual(pdv.registros.porId, []);
    await pdv.clicar(1);
    assert.equal(pdv.registros.porId.length, 1);
    assert.ok([120, 210].includes(pdv.registros.porId[0]));
  });

  it('digitar "12" ambíguo abre a lista local sem consultar a API', async () => {
    const pdv = criarAmbientePdv(catalogo());
    await pdv.digitar('12');
    assert.deepEqual(pdv.registros.fetches, []);
    assert.match(pdv.textoLista(), /Casquinha/);
    await pdv.seta();
    assert.equal(pdv.ctx.document.activeElement.dataset.index, '0');
    await pdv.setaLista('ArrowDown');
    assert.equal(pdv.ctx.document.activeElement.dataset.index, '1');
    pdv.input.focus();
    await pdv.tab();
    assert.equal(pdv.ctx.document.activeElement.dataset.index, '0');
    await pdv.enter();
    assert.equal(pdv.registros.porId.length, 1);
  });

  it('código único é adicionado pelo produto_id e o campo é limpo', async () => {
    const pdv = criarAmbientePdv(catalogo());
    await pdv.digitar('SM1L', 0);
    await pdv.enter();
    assert.deepEqual(pdv.registros.porId, [12]);
    assert.equal(pdv.input.value, '');
  });

  it('ao digitar um código único a lista mostra o nome do produto', async () => {
    const pdv = criarAmbientePdv(catalogo());
    await pdv.digitar('POTE2L');
    assert.match(pdv.textoLista(), /Código detectado: Pote 2L Chocolate/);
  });

  it('"pote 2l" sem correspondência exata não adiciona; a API só lista para seleção', async () => {
    const pdv = criarAmbientePdv(catalogo(), () => [
      { id: 150, nome: 'Pote 2L Chocolate', codigo: 'POTE2L', match_exato: 0 },
      { id: 151, nome: 'Pote 2L Creme', codigo: 'POTE2LC', match_exato: 0 }
    ]);
    await pdv.digitar('pote 2l', 0);
    await pdv.enter();
    assert.deepEqual(pdv.registros.porId, []);
    assert.match(pdv.textoLista(), /Nenhum código corresponde exatamente/);
  });

  it('Enter antes do fim da busca não reaproveita resultado exato do termo anterior', async () => {
    const pdv = criarAmbientePdv(catalogo(), (termo) => (termo === 'casq'
      ? [{ id: 120, nome: 'Casquinha', codigo: 'casq', match_exato: 1 }]
      : [{ id: 120, nome: 'Casquinha', codigo: '12', match_exato: 0 }]));
    await pdv.digitar('casq');
    await pdv.digitar('casqu', 0);
    await pdv.enter();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(pdv.registros.porId, []);
  });

  it('API com um único exato (ex.: código de barras de unidade comercial) adiciona pelo produto_id', async () => {
    const pdv = criarAmbientePdv(catalogo(), () => [
      { id: 900, nome: 'Caixa Picolé', codigo: 'CX', match_exato: 1 },
      { id: 901, nome: 'Caixa Outra', codigo: 'CX2', match_exato: 0 }
    ]);
    await pdv.digitar('17891234567892', 0);
    await pdv.enter();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(pdv.registros.porId, [900]);
    assert.equal(vm.runInContext('produtosDisponiveis.some((p) => p.id === 900)', pdv.ctx), true);
  });

  it('API com mais de um exato não escolhe automaticamente', async () => {
    const pdv = criarAmbientePdv(catalogo(), () => [
      { id: 900, nome: 'A', codigo: 'X1', match_exato: 1 },
      { id: 901, nome: 'B', codigo: 'X1', match_exato: 1 }
    ]);
    await pdv.digitar('X1', 0);
    await pdv.enter();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(pdv.registros.porId, []);
    assert.match(pdv.textoLista(), /Mais de um produto corresponde a "X1"/);
  });

  it('etiqueta de balança lança o produto do PLU com o peso calculado', async () => {
    const pdv = criarAmbientePdv(catalogo());
    await pdv.digitar('2000010014890', 0);
    await pdv.enter();
    assert.equal(pdv.registros.balanca.length, 1);
    assert.equal(pdv.registros.balanca[0].id, 1);
    assert.ok(Math.abs(pdv.registros.balanca[0].quantidade - 14.89 / 50) < 1e-9);
  });

  it('etiqueta de balança ambígua pede seleção e aplica o peso ao produto escolhido', async () => {
    const pdv = criarAmbientePdv([
      { id: 7, nome: 'Açaí A', codigo: '1', unidade: 'KG', ativo: 1, estoque_atual: 10 },
      { id: 8, nome: 'Açaí B', codigo: '00001', unidade: 'KG', ativo: 1, estoque_atual: 10 }
    ]);
    await pdv.digitar('2000010014890', 0);
    await pdv.enter();
    assert.deepEqual(pdv.registros.balanca, []);
    assert.match(pdv.textoLista(), /PLU 00001/);
    await pdv.clicar(1);
    assert.equal(pdv.registros.balanca.length, 1);
    assert.equal(pdv.registros.balanca[0].id, 8);
    assert.deepEqual(pdv.registros.porId, []);
  });
});

describe('Retorno do foco da busca do PDV', () => {
  it('aguarda o fechamento do último modal antes de focar a busca', () => {
    const timers = [];
    const listeners = [];
    let modalAberto = true;
    let focos = 0;
    const input = { focus() { focos += 1; } };
    const ctx = {
      document: {
        body: { classList: { contains: () => modalAberto } },
        getElementById: () => input,
        addEventListener: (evento, handler, opcoes) => {
          listeners.push({ evento, handler, opcoes });
        }
      },
      setTimeout: (callback) => timers.push(callback)
    };

    vm.createContext(ctx);
    vm.runInContext(
      extrairFuncao(ler('frontend/pdv/js/pdv.js'), 'focarCampoCodigo'),
      ctx
    );

    ctx.focarCampoCodigo();
    timers.shift()();
    assert.equal(focos, 0);
    assert.equal(listeners[0].evento, 'hidden.bs.modal');
    assert.equal(listeners[0].opcoes.once, true);

    modalAberto = false;
    listeners[0].handler();
    timers.shift()();
    assert.equal(focos, 1);
  });
});

describe('Impressão de comprovante em venda fiscal', () => {
  it('imprime o comprovante imediato só para venda não fiscal', () => {
    const impressos = [];
    const ctx = {
      imprimirComprovanteVenda: (...args) => impressos.push(args)
    };
    const pdvSrc = ler('frontend/pdv/js/pdv.js');

    vm.createContext(ctx);
    vm.runInContext(extrairFuncao(pdvSrc, 'imprimirComprovanteAntecipado'), ctx);

    ctx.imprimirComprovanteAntecipado(true, 81, { total: 25 }, 25);
    assert.equal(impressos.length, 0);

    ctx.imprimirComprovanteAntecipado(false, 82, { total: 30 }, 30);
    assert.deepEqual(impressos, [[82, { total: 30 }, 30]]);
    assert.equal((pdvSrc.match(/imprimirComprovanteAntecipado\(/g) || []).length, 3);
  });
});

describe('Correspondência exata da API (sqlite temporário)', () => {
  const dir = path.join(os.tmpdir(), 'cds-pdv-testes');
  const arquivo = path.join(dir, 'pdv-identidade-produto.db');
  let db;

  function all(sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
  }
  function run(sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, (e) => (e ? reject(e) : resolve())));
  }

  async function exatos(termo) {
    const t = prepararTermoIdentificacao(termo);
    const linhas = await all(
      `SELECT p.id, ${sqlMatchExatoProdutoPdv('p')} AS match_exato FROM produtos p ORDER BY p.id`,
      paramsMatchExatoProdutoPdv(t)
    );
    return linhas.filter((l) => l.match_exato === 1).map((l) => l.id);
  }

  before(async () => {
    fs.mkdirSync(dir, { recursive: true });
    for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });
    db = new sqlite3.Database(arquivo);
    await run('CREATE TABLE produtos (id INTEGER PRIMARY KEY, codigo TEXT, codigo_barras TEXT, nome TEXT, ativo INTEGER DEFAULT 1)');
    await run('CREATE TABLE produto_unidades (id INTEGER PRIMARY KEY, produto_id INTEGER, codigo_barras TEXT, codigo_auxiliar TEXT, ativo INTEGER DEFAULT 1)');
    for (const p of catalogo()) {
      await run('INSERT INTO produtos (id, codigo, codigo_barras, nome, ativo) VALUES (?, ?, ?, ?, ?)',
        [p.id, p.codigo, p.codigo_barras, p.nome, p.ativo]);
    }
    await run('INSERT INTO produto_unidades (produto_id, codigo_barras, codigo_auxiliar, ativo) VALUES (210, ?, NULL, 1)', ['17891234567892']);
    await run('INSERT INTO produto_unidades (produto_id, codigo_barras, codigo_auxiliar, ativo) VALUES (2, ?, NULL, 0)', ['17890000000011']);
  });

  after(async () => {
    await new Promise((resolve) => db.close(resolve));
    for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });
  });

  it('"12" é exato para os códigos "12" e "0012", nunca para o ID 12 nem "PIC-12"', async () => {
    assert.deepEqual(await exatos('12'), [120, 210]);
    assert.deepEqual(await exatos('00012'), [120, 210]);
  });

  it('"PIC-12" é exato só para o código "PIC-12" (sem descartar letras)', async () => {
    assert.deepEqual(await exatos('PIC-12'), [340]);
    assert.deepEqual(await exatos('pic-12'), [340]);
  });

  it('texto de nome com número não gera correspondência exata', async () => {
    assert.deepEqual(await exatos('pote 2l'), []);
    assert.deepEqual(await exatos('2'), []);
  });

  it('código de barras de unidade comercial ativa é exato; inativa não', async () => {
    assert.deepEqual(await exatos('17891234567892'), [210]);
    assert.deepEqual(await exatos('17890000000011'), []);
  });

  it('ID só entra na listagem quando a entrada é inteiramente numérica', () => {
    assert.equal(prepararTermoIdentificacao('012').idListagem, '12');
    assert.equal(prepararTermoIdentificacao('PIC-12').idListagem, null);
    assert.equal(prepararTermoIdentificacao('pote 2l').idListagem, null);
  });
});

describe('INSUMO não é comercializável no PDV', () => {
  function catalogoComInsumo() {
    return [
      { id: 801, nome: 'Leite em pó (insumo)', codigo: '55', codigo_barras: '7891000100103', unidade: 'KG', ativo: 1, natureza_cadastro: 'INSUMO' },
      { id: 802, nome: 'Pote sorvete (produzido)', codigo: '0055', codigo_barras: '7891000200209', unidade: 'UN', ativo: 1, natureza_cadastro: 'PRODUZIDO' },
      { id: 803, nome: 'Base açaí (insumo)', codigo: '00077', codigo_barras: '', unidade: 'KG', ativo: 1, natureza_cadastro: ' insumo ' }
    ];
  }

  it('resolvedor: código do INSUMO não é candidato; o PRODUZIDO com código equivalente fica único', () => {
    const r = Resolucao.resolverEntrada(catalogoComInsumo(), '55');
    assert.equal(r.status, 'UNICO');
    assert.equal(r.produto.id, 802);
  });

  it('resolvedor: EAN do INSUMO não resolve (TESTE C)', () => {
    assert.equal(Resolucao.resolverEntrada(catalogoComInsumo(), '7891000100103').status, 'NENHUM');
  });

  it('resolvedor: etiqueta de balança com PLU de INSUMO não resolve', () => {
    const r = Resolucao.resolverEntrada(catalogoComInsumo(), '2000770010003');
    assert.equal(r.status, 'NENHUM');
  });

  it('resolvedor: PRODUZIDO continua resolvido por EAN (TESTE G)', () => {
    const r = Resolucao.resolverEntrada(catalogoComInsumo(), '7891000200209');
    assert.equal(r.status, 'UNICO');
    assert.equal(r.produto.id, 802);
  });

  it('TESTE A — lista do PDV descarta INSUMO mesmo se o servidor enviar', () => {
    const pdv = criarAmbientePdv([]);
    const lista = pdv.ctx.normalizarProdutoPdvLista(catalogoComInsumo());
    assert.deepEqual(lista.map((p) => p.id), [802]);
  });

  it('TESTE B — Enter no código do INSUMO não adiciona nada', async () => {
    const pdv = criarAmbientePdv(catalogoComInsumo().filter((p) => p.id !== 802), () => []);
    await pdv.digitar('55', 0);
    await pdv.enter();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(pdv.registros.porId, []);
    assert.deepEqual(pdv.registros.balanca, []);
  });

  it('TESTE C — Enter no EAN do INSUMO não adiciona nada', async () => {
    const pdv = criarAmbientePdv(catalogoComInsumo(), () => []);
    await pdv.digitar('7891000100103', 0);
    await pdv.enter();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(pdv.registros.porId, []);
  });

  it('carrinho e adição por produto_id recusam INSUMO com a mensagem controlada', () => {
    const pdvSrc = ler('frontend/pdv/js/pdv.js');
    const notificacoes = [];
    const carrinho = [];
    const ctx = {
      showNotification: (mensagem, tipo) => notificacoes.push({ mensagem, tipo }),
      carrinho
    };
    vm.createContext(ctx);
    vm.runInContext(ler('frontend/shared/js/pdvResolucaoProduto.js'), Object.assign(ctx, { window: ctx }));
    vm.runInContext(
      `let produtosDisponiveis = ${JSON.stringify(catalogoComInsumo())};\n`
      + `${constanteMensagemInsumo(pdvSrc)}\n`
      + ['produtoEhInsumoPdv', 'adicionarItemNoCarrinho', 'adicionarProdutoConsultaPDV']
        .map((nome) => extrairFuncao(pdvSrc, nome)).join('\n'),
      ctx
    );

    ctx.adicionarItemNoCarrinho(catalogoComInsumo()[0], 1, 10);
    ctx.adicionarProdutoConsultaPDV(801);
    assert.equal(carrinho.length, 0);
    assert.deepEqual(notificacoes, [
      { mensagem: MENSAGEM_INSUMO, tipo: 'danger' },
      { mensagem: MENSAGEM_INSUMO, tipo: 'danger' }
    ]);
  });

  it('PDV desktop e mobile pedem os produtos com contexto=pdv', () => {
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.match(extrairFuncao(pdv, 'urlProdutosPdv'), /contexto=pdv/);
    assert.match(pdv, /data: \{ categoria_id: categoriaId, contexto: 'pdv' \}/);
    const mobile = ler('frontend/apps/mobile/js/pages/pdv.js');
    assert.match(mobile, /'produtos\/search', \{[^}]*contexto: 'pdv'/);
    assert.match(mobile, /produtos\/muc\/barras\/[^\n]+\{ contexto: 'pdv' \}/);
  });

  it('rotas do PDV aplicam o filtro de comercialização', () => {
    const rota = ler('backend/rotas/produtos.js');
    const consulta = rota.slice(rota.indexOf("router.get('/consulta-pdv/buscar'"), rota.indexOf('// LIP — Localizador'));
    assert.match(consulta, /filtroComercializavelPdv\(true/);
    const search = rota.slice(rota.indexOf("router.get('/search'"));
    assert.match(search, /filtroComercializavelPdv\(contextoPdv\(req\.query\)/);
  });
});

describe('Código-fonte', () => {
  it('pdv.js não usa mais a comparação "só dígitos" nem o ID como código', () => {
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.doesNotMatch(pdv, /function normalizarCodigoProduto\(/);
    assert.doesNotMatch(pdv, /function encontrarProdutoPorCodigoExato\(/);
    assert.doesNotMatch(pdv, /function encontrarProdutoPorCodigoOuNome\(/);
    assert.doesNotMatch(ler('frontend/shared/js/pdvBuscaProduto.js'), /String\(produto\?\.id\) === /);
  });

  it('consulta-pdv/buscar não marca o ID como correspondência exata', () => {
    const rota = ler('backend/rotas/produtos.js');
    const inicio = rota.indexOf("router.get('/consulta-pdv/buscar'");
    const trecho = rota.slice(inicio, rota.indexOf('// LIP — Localizador', inicio));
    assert.match(trecho, /sqlMatchExatoProdutoPdv\('p'\)/);
    assert.doesNotMatch(trecho, /buscaNumero/);
  });

  it('index do PDV carrega o resolvedor antes da busca e do pdv.js', () => {
    const html = ler('frontend/pdv/index.html');
    const resolvedor = html.indexOf('/shared/js/pdvResolucaoProduto.js');
    assert.ok(resolvedor > 0);
    assert.ok(resolvedor < html.indexOf('/shared/js/pdvBuscaProduto.js'));
    assert.ok(resolvedor < html.indexOf('/pdv/js/pdv.js'));
  });

  it('o banco oficial não foi carregado', () => {
    const carregado = Object.keys(require.cache).some((k) => k.endsWith(path.join('backend', 'database.js')));
    assert.equal(carregado, false);
  });
});
