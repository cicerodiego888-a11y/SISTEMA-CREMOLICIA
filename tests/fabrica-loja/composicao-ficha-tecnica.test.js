'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolverComposicaoFichaTecnica,
  escalarComposicaoFichaTecnica
} = require('../../backend/modules/fabrica-loja/ComposicaoFichaTecnica');

function criarFicha() {
  return {
    id: 21,
    versao: 3,
    rendimento_quantidade: 100,
    rendimento_unidade: 'UN',
    componentes: [
      { id: 101, produto_id: 501, quantidade: 1400, unidade: 'G' },
      { id: 102, produto_id: 502, quantidade: 250, unidade: 'ML' },
      { id: 103, produto_id: 503, quantidade: 80, unidade: 'G' }
    ]
  };
}

function componentePorProduto(composicao, produtoId) {
  return composicao.componentes.find((componente) => componente.produto_id === produtoId);
}

function erroCom(codigo) {
  return (erro) => erro.code === codigo;
}

describe('Motor isolado de composição da ficha técnica', () => {
  it('resolve a ficha padrão sem ajustes e mantém a rastreabilidade herdada', () => {
    const resultado = resolverComposicaoFichaTecnica(criarFicha());
    assert.equal(resultado.ficha_padrao_id, 21);
    assert.equal(resultado.ficha_padrao_versao, 3);
    assert.equal(resultado.rendimento_quantidade, 100);
    assert.equal(resultado.rendimento_unidade, 'UN');
    assert.equal(resultado.componentes.length, 3);
    assert.equal(componentePorProduto(resultado, 501).origem, 'HERDADO');
    assert.equal(componentePorProduto(resultado, 501).regra.operacao, 'HERDAR');
    assert.deepEqual(resultado.componentes_removidos, []);
    assert.deepEqual(resultado.alertas, []);
    assert.deepEqual(resultado.erros, []);
  });

  it('aplica HERDAR explícito e registra o identificador da regra', () => {
    const resultado = resolverComposicaoFichaTecnica(criarFicha(), [
      { id: 'regra-1', operacao: 'HERDAR', componente_base_id: 101 }
    ]);
    assert.equal(componentePorProduto(resultado, 501).quantidade, 1400);
    assert.deepEqual(componentePorProduto(resultado, 501).regra, {
      id: 'regra-1',
      operacao: 'HERDAR',
      componente_base_id: 101,
      produto_id: 501
    });
  });

  it('adiciona um ingrediente novo sem alterar a ficha padrão', () => {
    const resultado = resolverComposicaoFichaTecnica(criarFicha(), [
      { id: 7, operacao: 'ADICIONAR', produto_id: 504, quantidade: 300, unidade: 'G' }
    ]);
    assert.deepEqual(componentePorProduto(resultado, 504), {
      componente_base_id: null,
      produto_id: 504,
      quantidade: 300,
      unidade: 'G',
      origem: 'ADICIONADO',
      regra: {
        id: 7,
        operacao: 'ADICIONAR',
        componente_base_id: null,
        produto_id: 504
      }
    });
    assert.equal(criarFicha().componentes.length, 3);
  });

  it('substitui a quantidade sem somá-la à quantidade padrão', () => {
    const resultado = resolverComposicaoFichaTecnica(criarFicha(), [
      { id: 8, operacao: 'SUBSTITUIR', componente_base_id: 101, quantidade: 1200, unidade: 'G' }
    ]);
    assert.equal(componentePorProduto(resultado, 501).quantidade, 1200);
    assert.equal(componentePorProduto(resultado, 501).origem, 'SUBSTITUIDO');
    assert.equal(componentePorProduto(resultado, 501).quantidade, 1200);
  });

  it('remove um componente e mantém seus dados na lista de removidos', () => {
    const resultado = resolverComposicaoFichaTecnica(criarFicha(), [
      { id: 9, operacao: 'REMOVER', componente_base_id: 102 }
    ]);
    assert.equal(componentePorProduto(resultado, 502), undefined);
    assert.deepEqual(resultado.componentes_removidos, [{
      componente_base_id: 102,
      produto_id: 502,
      quantidade: 250,
      unidade: 'ML',
      regra: {
        id: 9,
        operacao: 'REMOVER',
        componente_base_id: 102,
        produto_id: 502
      }
    }]);
  });

  it('preserva ingredientes que não receberam ajuste', () => {
    const resultado = resolverComposicaoFichaTecnica(criarFicha(), [
      { id: 10, operacao: 'SUBSTITUIR', componente_base_id: 101, quantidade: 1200, unidade: 'G' }
    ]);
    assert.equal(componentePorProduto(resultado, 502).quantidade, 250);
    assert.equal(componentePorProduto(resultado, 503).quantidade, 80);
    assert.equal(componentePorProduto(resultado, 503).origem, 'HERDADO');
  });

  it('resolve ajustes diferentes para produtos diferentes sem alterar a base compartilhada', () => {
    const ficha = criarFicha();
    const primeiro = resolverComposicaoFichaTecnica(ficha, [
      { operacao: 'SUBSTITUIR', componente_base_id: 101, quantidade: 1200, unidade: 'G' }
    ]);
    const segundo = resolverComposicaoFichaTecnica(ficha, [
      { operacao: 'SUBSTITUIR', componente_base_id: 101, quantidade: 1600, unidade: 'G' }
    ]);
    assert.equal(componentePorProduto(primeiro, 501).quantidade, 1200);
    assert.equal(componentePorProduto(segundo, 501).quantidade, 1600);
    assert.equal(ficha.componentes[0].quantidade, 1400);
  });

  it('rejeita produto_id duplicado na ficha padrão', () => {
    const ficha = criarFicha();
    ficha.componentes[1].produto_id = ficha.componentes[0].produto_id;
    assert.throws(() => resolverComposicaoFichaTecnica(ficha), erroCom('PRODUTO_BASE_DUPLICADO'));
  });

  it('valida a presença do rendimento e dos componentes da ficha padrão', () => {
    const fichaSemRendimento = criarFicha();
    fichaSemRendimento.rendimento_quantidade = 0;
    assert.throws(() => resolverComposicaoFichaTecnica(fichaSemRendimento), erroCom('QUANTIDADE_INVALIDA'));

    const fichaSemComponentes = criarFicha();
    fichaSemComponentes.componentes = [];
    assert.throws(() => resolverComposicaoFichaTecnica(fichaSemComponentes), erroCom('COMPONENTES_OBRIGATORIOS'));

    assert.throws(() => resolverComposicaoFichaTecnica(null), erroCom('DADO_INVALIDO'));
  });

  it('rejeita mais de uma regra para o mesmo componente-base ou produto_id', () => {
    assert.throws(() => resolverComposicaoFichaTecnica(criarFicha(), [
      { operacao: 'HERDAR', componente_base_id: 101 },
      { operacao: 'SUBSTITUIR', componente_base_id: 101, quantidade: 1300, unidade: 'G' }
    ]), erroCom('REGRA_COMPONENTE_DUPLICADA'));
    assert.throws(() => resolverComposicaoFichaTecnica(criarFicha(), [
      { operacao: 'ADICIONAR', produto_id: 504, quantidade: 300, unidade: 'G' },
      { operacao: 'ADICIONAR', produto_id: 504, quantidade: 400, unidade: 'G' }
    ]), erroCom('REGRA_PRODUTO_DUPLICADA'));
  });

  it('rejeita ADICIONAR de ingrediente que já existe na ficha padrão', () => {
    assert.throws(() => resolverComposicaoFichaTecnica(criarFicha(), [
      { operacao: 'ADICIONAR', produto_id: 501, quantidade: 300, unidade: 'G' }
    ]), erroCom('ADICIONAR_EXISTENTE'));
  });

  it('rejeita SUBSTITUIR de componente inexistente', () => {
    assert.throws(() => resolverComposicaoFichaTecnica(criarFicha(), [
      { operacao: 'SUBSTITUIR', componente_base_id: 999, quantidade: 100, unidade: 'G' }
    ]), erroCom('COMPONENTE_BASE_INEXISTENTE'));
  });

  it('rejeita REMOVER de componente inexistente', () => {
    assert.throws(() => resolverComposicaoFichaTecnica(criarFicha(), [
      { operacao: 'REMOVER', componente_base_id: 999 }
    ]), erroCom('COMPONENTE_BASE_INEXISTENTE'));
  });

  it('rejeita quantidades zero, negativas, não numéricas e não finitas', () => {
    for (const quantidade of [0, -1, NaN, Infinity, '1200']) {
      assert.throws(() => resolverComposicaoFichaTecnica(criarFicha(), [
        { operacao: 'SUBSTITUIR', componente_base_id: 101, quantidade, unidade: 'G' }
      ]), erroCom('QUANTIDADE_INVALIDA'));
    }
    for (const quantidade of [0, -1, NaN, Infinity, '300']) {
      assert.throws(() => resolverComposicaoFichaTecnica(criarFicha(), [
        { operacao: 'ADICIONAR', produto_id: 504, quantidade, unidade: 'G' }
      ]), erroCom('QUANTIDADE_INVALIDA'));
    }
  });

  it('rejeita unidade diferente em substituição sem conversão validada', () => {
    assert.throws(() => resolverComposicaoFichaTecnica(criarFicha(), [
      { operacao: 'SUBSTITUIR', componente_base_id: 101, quantidade: 1.2, unidade: 'KG' }
    ]), erroCom('UNIDADE_NAO_COMPROVADA'));
  });

  it('produz saída determinística com ajustes apresentados em ordens diferentes', () => {
    const ajustes = [
      { id: 12, operacao: 'SUBSTITUIR', componente_base_id: 101, quantidade: 1200, unidade: 'G' },
      { id: 13, operacao: 'ADICIONAR', produto_id: 505, quantidade: 50, unidade: 'G' },
      { id: 14, operacao: 'REMOVER', componente_base_id: 102 }
    ];
    const primeiro = resolverComposicaoFichaTecnica(criarFicha(), ajustes);
    const segundo = resolverComposicaoFichaTecnica(criarFicha(), [...ajustes].reverse());
    assert.deepEqual(primeiro, segundo);
  });

  it('não modifica a ficha padrão nem os ajustes recebidos', () => {
    const ficha = criarFicha();
    const ajustes = [
      { id: 15, operacao: 'SUBSTITUIR', componente_base_id: 101, quantidade: 1200, unidade: 'G' },
      { id: 16, operacao: 'ADICIONAR', produto_id: 504, quantidade: 25, unidade: 'G' }
    ];
    const fichaOriginal = JSON.stringify(ficha);
    const ajustesOriginais = JSON.stringify(ajustes);
    resolverComposicaoFichaTecnica(ficha, ajustes);
    assert.equal(JSON.stringify(ficha), fichaOriginal);
    assert.equal(JSON.stringify(ajustes), ajustesOriginais);
  });

  it('escala sem arredondar quando a unidade planejada é a unidade do rendimento', () => {
    const composicao = resolverComposicaoFichaTecnica(criarFicha());
    const escalada = escalarComposicaoFichaTecnica(composicao, 150, 'UN');
    assert.equal(escalada.fator, 1.5);
    assert.equal(componentePorProduto(escalada, 501).quantidade_consumida, 2100);
    assert.equal(componentePorProduto(escalada, 502).quantidade_consumida, 375);
    assert.equal(componentePorProduto(composicao, 501).quantidade_consumida, undefined);
    assert.notEqual(escalada.alertas, composicao.alertas);
    assert.notEqual(escalada.erros, composicao.erros);
  });

  it('rejeita escala que exigiria conversão de unidade não disponível', () => {
    const composicao = resolverComposicaoFichaTecnica(criarFicha());
    assert.throws(() => escalarComposicaoFichaTecnica(composicao, 1.5, 'CENTENA'), erroCom('UNIDADE_NAO_COMPROVADA'));
  });
});
