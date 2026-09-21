/**
 * RCM-8.13.4 — Comprovante após Entrega Complementar (inclui origem Prestação)
 *
 * Executar:
 *   node tests/motor-comercial/rcm8134-comprovante-complementar-prestacao.test.js
 *   npx jest --config frontend/modules/motor-comercial/jest.config.js --testPathPatterns="helpers|rcm8134"
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../..'));

const { unwrapUseCaseData } = require('../../frontend/modules/motor-comercial/api/helpers');
const {
  emitirComprovanteAposOperacaoEntrega,
  renderComprovanteTexto
} = require('../../frontend/modules/motor-comercial/services/comprovanteAtualizadoEntrega');
const {
  montarHistoricoEntregasAtualizado,
  obterComprovanteDoHistorico,
  OPERACAO_ALTERACAO_POS_ENTREGA
} = require('../../backend/motores/motor-comercial/usecases/consignacao/atualizacaoEntregaHelpers');
const {
  OPERACAO_ENTREGA_COMPLEMENTAR
} = require('../../backend/motores/motor-comercial/usecases/consignacao/entregaComplementarHelpers');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((err) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}\n         ${err.message}`);
    });
}

function mov({ correlationId, operacao, itemId, produtoId, produtoNome, qtd, ant, atual, ts }) {
  return {
    id: `${correlationId}-${itemId}`,
    consignacaoId: 21,
    consignacaoItemId: itemId,
    tipoMovimentacao: 'ENTREGA',
    correlationId,
    quantidade: qtd,
    valor: qtd * 2,
    dataMovimentacao: ts,
    createdAt: ts,
    snapshot: {
      capturadoEm: ts,
      contexto: { operacao },
      documento: { numero: 'CONS-2026-000021' },
      item: {
        id: itemId,
        produtoId,
        produtoNome,
        quantidade: qtd,
        quantidadeAnterior: ant,
        delta: qtd,
        quantidadeAtual: atual,
        precoUnitario: 2
      }
    }
  };
}

async function run() {
  console.log('\nRCM-8.13.4 — comprovante complementar (Prestação)\n');

  await test('unwrapUseCaseData NÃO descarta comprovante da complementação', () => {
    const out = unwrapUseCaseData({
      success: true,
      data: {
        consignacao: { id: 21 },
        correlationId: 'c-new',
        comprovante: { numeroComprovante: '004', tipo: 'COMPLEMENTAR' },
        entregas: [{ correlationId: 'c-new' }]
      }
    });
    assert.strictEqual(out.comprovante.numeroComprovante, '004');
    assert.strictEqual(out.correlationId, 'c-new');
  });

  await test('unwrapUseCaseData ainda extrai perfil simples', () => {
    const out = unwrapUseCaseData({
      success: true,
      data: { perfil: { id: 1 }, correlationId: 'x' }
    });
    assert.deepStrictEqual(out, { id: 1 });
  });

  await test('histórico gera comprovante COMPLETO na próxima sequência', () => {
    const movs = [
      mov({
        correlationId: 'c1', operacao: 'ENTREGA', itemId: 1, produtoId: 50,
        produtoNome: 'PICOLE LINHA CREMOSA', qtd: 100, ant: 0, atual: 100,
        ts: '2026-09-20T10:00:00.000Z'
      }),
      mov({
        correlationId: 'c2', operacao: OPERACAO_ENTREGA_COMPLEMENTAR, itemId: 2, produtoId: 60,
        produtoNome: 'PICOLE LINHA ESPECIAL', qtd: 25, ant: 0, atual: 25,
        ts: '2026-09-20T11:00:00.000Z'
      }),
      mov({
        correlationId: 'c3', operacao: OPERACAO_ENTREGA_COMPLEMENTAR, itemId: 2, produtoId: 60,
        produtoNome: 'PICOLE LINHA ESPECIAL', qtd: 10, ant: 25, atual: 35,
        ts: '2026-09-20T12:00:00.000Z'
      })
    ];
    const hist = montarHistoricoEntregasAtualizado(movs, []);
    assert.strictEqual(hist.length, 3);
    assert.strictEqual(hist[2].numeroComprovante, '003');
    const comp = obterComprovanteDoHistorico(hist, 'c3');
    assert.ok(comp);
    assert.strictEqual(comp.numeroComprovante, '003');
    assert.ok(comp.listaCompleta.length >= 2);
    assert.strictEqual(comp.atualizacao?.tipo, 'ENTREGA COMPLEMENTAR');
    const especial = comp.atualizacao.itens.find((i) => i.produtoId === 60);
    assert.strictEqual(especial.quantidadeAnterior, 25);
    assert.ok(String(especial.complemento).includes('10') || especial.delta === 10);
    assert.strictEqual(especial.quantidadeAtual, 35);

    const texto = renderComprovanteTexto(comp);
    assert.ok(texto.includes('COMPROVANTE DE ENTREGA Nº 003'));
    assert.ok(texto.includes('ENTREGA COMPLEMENTAR'));
    assert.ok(texto.includes('Quantidade anterior'));
    assert.ok(texto.includes('TOTAL ATUAL DA CONSIGNAÇÃO'));
  });

  await test('emitirComprovanteAposOperacaoEntrega usa comprovante da resposta (sem novo registro)', async () => {
    let apiCalls = 0;
    const api = {
      obterComprovanteEntregaHistorico: async () => {
        apiCalls += 1;
        throw new Error('não deveria buscar se já tem comprovante');
      }
    };
    const comp = await emitirComprovanteAposOperacaoEntrega({
      api,
      consignacaoId: 21,
      consignacao: { id: 21, documento: { numero: 'CONS-2026-000021' } },
      resultado: {
        correlationId: 'c3',
        consignacao: { id: 21 },
        comprovante: {
          numeroComprovante: '003',
          numeroConsignacao: 'CONS-2026-000021',
          listaCompleta: [{ produtoNome: 'X', quantidade: 1 }],
          atualizacao: { titulo: 'ATUALIZAÇÃO', tipo: 'ENTREGA COMPLEMENTAR', itens: [] }
        }
      },
      exibir: false
    });
    assert.strictEqual(comp.numeroComprovante, '003');
    assert.strictEqual(apiCalls, 0);
  });

  await test('texto do comprovante preserva quebras de linha (não fica tudo numa linha)', () => {
    const {
      renderComprovanteTexto,
      montarHtmlDocumentoComprovante
    } = require('../../frontend/modules/motor-comercial/services/comprovanteAtualizadoEntrega');
    const texto = renderComprovanteTexto({
      numeroConsignacao: 'CONS-2026-000021',
      titulo: 'COMPROVANTE DE ENTREGA Nº 006',
      listaCompleta: [
        { produtoNome: 'PICOLE LINHA CREMOSA', quantidade: 125 },
        { produtoNome: 'PICOLE LINHA ESPECIAL', quantidade: 25 }
      ],
      atualizacao: {
        titulo: 'ATUALIZAÇÃO DA CONSIGNAÇÃO',
        tipo: 'ENTREGA COMPLEMENTAR',
        itens: [{
          produtoNome: 'PICOLE LINHA ESPECIAL',
          afetado: true,
          quantidadeAnterior: 25,
          complemento: '+10',
          quantidadeAtual: 35
        }]
      },
      quantidadeTotalAtual: 150
    });
    assert.ok(texto.includes('\n'));
    assert.ok(texto.split('\n').length > 8);
    assert.ok(!texto.includes('CONSIGNAÇÃO Nº CONS-2026-000021COMPROVANTE'));
    const html = montarHtmlDocumentoComprovante(texto, 'COMPROVANTE DE ENTREGA Nº 006');
    assert.ok(html.includes('<pre>'));
    assert.ok(html.includes('white-space: pre-wrap'));
    assert.ok(html.includes('Quantidade anterior: 25'));
  });

  await test('emitirComprovanteAposOperacaoEntrega faz fallback GET reimpressão (somente leitura)', async () => {
    let gets = 0;
    const api = {
      obterComprovanteEntregaHistorico: async (id, corr) => {
        gets += 1;
        assert.strictEqual(Number(id), 21);
        assert.strictEqual(corr, 'c-fallback');
        return {
          comprovante: {
            numeroComprovante: '004',
            listaCompleta: [{ produtoNome: 'Y', quantidade: 2 }],
            atualizacao: { tipo: 'ENTREGA COMPLEMENTAR', itens: [] }
          }
        };
      }
    };
    global.window = { alert: () => {}, open: () => null };
    const comp = await emitirComprovanteAposOperacaoEntrega({
      api,
      consignacaoId: 21,
      resultado: { correlationId: 'c-fallback', consignacao: { id: 21 } }
    });
    assert.strictEqual(gets, 1);
    assert.strictEqual(comp.numeroComprovante, '004');
  });

  await test('não duplica: emissão NÃO chama RegistrarEntregaComplementar', async () => {
    let posts = 0;
    const api = {
      registrarEntregaComplementar: async () => { posts += 1; },
      obterComprovanteEntregaHistorico: async () => ({
        comprovante: { numeroComprovante: '005', listaCompleta: [], atualizacao: null }
      })
    };
    global.window = { alert: () => {}, open: () => null };
    await emitirComprovanteAposOperacaoEntrega({
      api,
      consignacaoId: 21,
      resultado: { correlationId: 'only-once' }
    });
    assert.strictEqual(posts, 0);
  });

  console.log(`\nResultado: ${passou} OK, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run();
