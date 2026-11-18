'use strict';

const OPERACOES = new Set(['HERDAR', 'SUBSTITUIR', 'ADICIONAR', 'REMOVER']);
const ORIGENS = new Set(['HERDADO', 'SUBSTITUIDO', 'ADICIONADO']);

class ErroComposicaoFichaTecnica extends Error {
  constructor(codigo, mensagem, detalhes) {
    super(mensagem);
    this.name = 'ErroComposicaoFichaTecnica';
    this.code = codigo;
    this.details = detalhes || null;
  }
}

function falhar(codigo, mensagem, detalhes) {
  throw new ErroComposicaoFichaTecnica(codigo, mensagem, detalhes);
}

function objeto(valor, campo) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    falhar('DADO_INVALIDO', `${campo} deve ser um objeto.`);
  }
  return valor;
}

function idPositivo(valor, campo, opcional) {
  if (opcional && valor == null) return null;
  if (!Number.isInteger(valor) || valor <= 0) {
    falhar('IDENTIFICADOR_INVALIDO', `${campo} deve ser um inteiro positivo.`, { campo, valor });
  }
  return valor;
}

function textoUnidade(valor, campo) {
  if (typeof valor !== 'string' || !valor.trim()) {
    falhar('UNIDADE_OBRIGATORIA', `${campo} deve ser informada.`, { campo });
  }
  return valor.trim();
}

function validarVersao(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) return valor;
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  falhar('VERSAO_INVALIDA', 'A versão da ficha padrão deve ser um número positivo ou texto não vazio.');
}

function chaveUnidade(valor) {
  return valor.trim().toUpperCase();
}

function quantidadePositiva(valor, campo, contexto) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
    falhar('QUANTIDADE_INVALIDA', `${campo} deve ser um número finito maior que zero.`, contexto);
  }
  return valor;
}

function temValor(valor) {
  return valor !== undefined && valor !== null && valor !== '';
}

function identificadorRegra(ajuste) {
  if (!temValor(ajuste.id)) return null;
  if (typeof ajuste.id === 'number' && Number.isInteger(ajuste.id) && ajuste.id > 0) return ajuste.id;
  if (typeof ajuste.id === 'string' && ajuste.id.trim()) return ajuste.id.trim();
  falhar('REGRA_ID_INVALIDO', 'O identificador da regra deve ser um inteiro positivo ou texto não vazio.');
}

function regraAplicada(ajuste, operacao, alvo) {
  return {
    id: ajuste ? identificadorRegra(ajuste) : null,
    operacao,
    componente_base_id: alvo.componente_base_id == null ? null : alvo.componente_base_id,
    produto_id: alvo.produto_id
  };
}

function validarFichaPadrao(fichaPadrao) {
  const ficha = objeto(fichaPadrao, 'A ficha padrão');
  const id = idPositivo(ficha.id, 'O id da ficha padrão', true);
  const versao = validarVersao(ficha.versao);
  const rendimento = quantidadePositiva(
    ficha.rendimento_quantidade,
    'O rendimento da ficha padrão',
    { campo: 'rendimento_quantidade' }
  );
  const unidadeRendimento = textoUnidade(ficha.rendimento_unidade, 'A unidade de rendimento');
  if (!Array.isArray(ficha.componentes) || ficha.componentes.length === 0) {
    falhar('COMPONENTES_OBRIGATORIOS', 'A ficha padrão deve possuir ao menos um componente.');
  }

  const componentes = [];
  const porId = new Map();
  const porProduto = new Map();
  for (const [indice, bruto] of ficha.componentes.entries()) {
    const componente = objeto(bruto, `O componente ${indice + 1}`);
    const componenteId = idPositivo(componente.id, `O id do componente ${indice + 1}`);
    const produtoId = idPositivo(componente.produto_id, `O produto_id do componente ${indice + 1}`);
    const quantidade = quantidadePositiva(
      componente.quantidade,
      `A quantidade do componente ${indice + 1}`,
      { componente_base_id: componenteId, produto_id: produtoId }
    );
    const unidade = textoUnidade(componente.unidade, `A unidade do componente ${indice + 1}`);
    if (porId.has(componenteId)) {
      falhar('COMPONENTE_BASE_DUPLICADO', 'A ficha padrão contém ids de componentes-base duplicados.', {
        componente_base_id: componenteId
      });
    }
    if (porProduto.has(produtoId)) {
      falhar('PRODUTO_BASE_DUPLICADO', 'A ficha padrão contém o mesmo produto_id mais de uma vez.', {
        produto_id: produtoId,
        componentes_base_id: [porProduto.get(produtoId), componenteId]
      });
    }
    const resolvido = {
      id: componenteId,
      produto_id: produtoId,
      quantidade,
      unidade
    };
    componentes.push(resolvido);
    porId.set(componenteId, resolvido);
    porProduto.set(produtoId, componenteId);
  }

  return {
    id,
    versao,
    rendimento_quantidade: rendimento,
    rendimento_unidade: unidadeRendimento,
    componentes,
    porId,
    porProduto
  };
}

function resolverComposicaoFichaTecnica(fichaPadrao, ajustes = []) {
  const ficha = validarFichaPadrao(fichaPadrao);
  if (!Array.isArray(ajustes)) {
    falhar('AJUSTES_INVALIDOS', 'Os ajustes específicos devem ser uma lista.');
  }

  const porComponente = new Map();
  const produtosComRegra = new Map();
  const idsRegras = new Set();
  const adicionais = [];

  for (const [indice, bruto] of ajustes.entries()) {
    const ajuste = objeto(bruto, `O ajuste ${indice + 1}`);
    const operacao = typeof ajuste.operacao === 'string' ? ajuste.operacao.trim().toUpperCase() : '';
    if (!OPERACOES.has(operacao)) {
      falhar('OPERACAO_INVALIDA', `O ajuste ${indice + 1} possui uma operação inválida.`, {
        indice,
        operacao: ajuste.operacao
      });
    }

    const regraId = identificadorRegra(ajuste);
    if (regraId != null) {
      const chaveRegra = `${typeof regraId}:${regraId}`;
      if (idsRegras.has(chaveRegra)) {
        falhar('REGRA_DUPLICADA', 'Há mais de um ajuste com o mesmo identificador de regra.', { regra_id: regraId });
      }
      idsRegras.add(chaveRegra);
    }

    if (operacao === 'ADICIONAR') {
      if (temValor(ajuste.componente_base_id)) {
        falhar('ADICIONAL_COM_COMPONENTE_BASE', 'ADICIONAR não pode apontar para um componente da ficha padrão.');
      }
      const produtoId = idPositivo(ajuste.produto_id, `O produto_id do ajuste ${indice + 1}`);
      if (ficha.porProduto.has(produtoId)) {
        falhar('ADICIONAR_EXISTENTE', 'ADICIONAR não pode usar um produto_id já presente na ficha padrão.', {
          produto_id: produtoId
        });
      }
      if (produtosComRegra.has(produtoId)) {
        falhar('REGRA_PRODUTO_DUPLICADA', 'Há mais de uma regra para o mesmo produto_id.', { produto_id: produtoId });
      }
      produtosComRegra.set(produtoId, operacao);
      adicionais.push({
        ajuste,
        produto_id: produtoId,
        quantidade: quantidadePositiva(
          ajuste.quantidade,
          `A quantidade do ajuste ${indice + 1}`,
          { produto_id: produtoId }
        ),
        unidade: textoUnidade(ajuste.unidade, `A unidade do ajuste ${indice + 1}`)
      });
      continue;
    }

    const componenteId = idPositivo(
      ajuste.componente_base_id,
      `O componente_base_id do ajuste ${indice + 1}`
    );
    const componente = ficha.porId.get(componenteId);
    if (!componente) {
      falhar('COMPONENTE_BASE_INEXISTENTE', `${operacao} aponta para um componente que não existe na ficha padrão.`, {
        componente_base_id: componenteId,
        operacao
      });
    }
    if (temValor(ajuste.produto_id)) {
      const produtoId = idPositivo(ajuste.produto_id, `O produto_id do ajuste ${indice + 1}`);
      if (produtoId !== componente.produto_id) {
        falhar('PRODUTO_DIVERGENTE', 'O produto_id do ajuste não corresponde ao componente-base informado.', {
          componente_base_id: componenteId,
          produto_id: produtoId,
          produto_id_base: componente.produto_id
        });
      }
    }
    if (porComponente.has(componenteId)) {
      falhar('REGRA_COMPONENTE_DUPLICADA', 'Há mais de uma regra para o mesmo componente-base.', {
        componente_base_id: componenteId
      });
    }
    if (produtosComRegra.has(componente.produto_id)) {
      falhar('REGRA_PRODUTO_DUPLICADA', 'Há mais de uma regra para o mesmo produto_id.', {
        produto_id: componente.produto_id
      });
    }
    produtosComRegra.set(componente.produto_id, operacao);

    if (operacao === 'SUBSTITUIR') {
      const quantidade = quantidadePositiva(
        ajuste.quantidade,
        `A quantidade substituída do componente ${componenteId}`,
        { componente_base_id: componenteId, produto_id: componente.produto_id }
      );
      const unidade = textoUnidade(ajuste.unidade, `A unidade substituída do componente ${componenteId}`);
      if (chaveUnidade(unidade) !== chaveUnidade(componente.unidade)) {
        falhar('UNIDADE_NAO_COMPROVADA', 'SUBSTITUIR deve usar a unidade da ficha padrão; este motor não realiza conversões.', {
          componente_base_id: componenteId,
          produto_id: componente.produto_id,
          unidade_base: componente.unidade,
          unidade_informada: unidade
        });
      }
      porComponente.set(componenteId, { operacao, ajuste, quantidade, unidade });
    } else {
      if (temValor(ajuste.quantidade) || temValor(ajuste.unidade)) {
        falhar('DADOS_OPERACAO_INVALIDOS', `${operacao} não aceita quantidade nem unidade no ajuste.`, {
          componente_base_id: componenteId,
          operacao
        });
      }
      porComponente.set(componenteId, { operacao, ajuste });
    }
  }

  const componentes = [];
  const componentesRemovidos = [];
  for (const base of ficha.componentes) {
    const regra = porComponente.get(base.id);
    if (regra && regra.operacao === 'REMOVER') {
      componentesRemovidos.push({
        componente_base_id: base.id,
        produto_id: base.produto_id,
        quantidade: base.quantidade,
        unidade: base.unidade,
        regra: regraAplicada(regra.ajuste, 'REMOVER', {
          componente_base_id: base.id,
          produto_id: base.produto_id
        })
      });
      continue;
    }

    const substituido = regra && regra.operacao === 'SUBSTITUIR';
    const quantidade = substituido ? regra.quantidade : base.quantidade;
    const unidade = substituido ? regra.unidade : base.unidade;
    const operacaoAplicada = substituido ? 'SUBSTITUIR' : 'HERDAR';
    componentes.push({
      componente_base_id: base.id,
      produto_id: base.produto_id,
      quantidade,
      unidade,
      origem: substituido ? 'SUBSTITUIDO' : 'HERDADO',
      regra: regraAplicada(regra && regra.operacao === 'HERDAR' ? regra.ajuste : substituido ? regra.ajuste : null, operacaoAplicada, {
        componente_base_id: base.id,
        produto_id: base.produto_id
      })
    });
  }

  adicionais.sort((a, b) => a.produto_id - b.produto_id);
  for (const adicional of adicionais) {
    componentes.push({
      componente_base_id: null,
      produto_id: adicional.produto_id,
      quantidade: adicional.quantidade,
      unidade: adicional.unidade,
      origem: 'ADICIONADO',
      regra: regraAplicada(adicional.ajuste, 'ADICIONAR', {
        componente_base_id: null,
        produto_id: adicional.produto_id
      })
    });
  }

  const produtosFinais = new Set();
  for (const componente of componentes) {
    if (produtosFinais.has(componente.produto_id)) {
      falhar('PRODUTO_FINAL_DUPLICADO', 'A composição final contém produto_id duplicado.', {
        produto_id: componente.produto_id
      });
    }
    produtosFinais.add(componente.produto_id);
  }

  return {
    ficha_padrao_id: ficha.id,
    ficha_padrao_versao: ficha.versao,
    rendimento_quantidade: ficha.rendimento_quantidade,
    rendimento_unidade: ficha.rendimento_unidade,
    componentes,
    componentes_removidos: componentesRemovidos,
    alertas: [],
    erros: []
  };
}

function copiarComponente(componente) {
  return {
    ...componente,
    regra: componente.regra ? { ...componente.regra } : componente.regra
  };
}

function copiarLista(lista, campo) {
  if (!Array.isArray(lista)) {
    falhar('COMPOSICAO_INVALIDA', `${campo} deve ser uma lista.`);
  }
  return lista.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return { ...item };
  });
}

function escalarComposicaoFichaTecnica(composicao, quantidadePlanejada, unidadePlanejada) {
  const origem = objeto(composicao, 'A composição resolvida');
  const rendimento = quantidadePositiva(origem.rendimento_quantidade, 'O rendimento da composição');
  const unidadeRendimento = textoUnidade(origem.rendimento_unidade, 'A unidade de rendimento da composição');
  const planejada = quantidadePositiva(quantidadePlanejada, 'A quantidade planejada');
  const unidade = textoUnidade(unidadePlanejada, 'A unidade planejada');
  if (chaveUnidade(unidade) !== chaveUnidade(unidadeRendimento)) {
    falhar('UNIDADE_NAO_COMPROVADA', 'A escala exige a mesma unidade do rendimento; este motor não realiza conversões.', {
      unidade_rendimento: unidadeRendimento,
      unidade_planejada: unidade
    });
  }
  if (!Array.isArray(origem.componentes) || origem.componentes.length === 0) {
    falhar('COMPONENTES_OBRIGATORIOS', 'A composição resolvida deve possuir ao menos um componente.');
  }

  const fator = planejada / rendimento;
  if (!Number.isFinite(fator) || fator <= 0) {
    falhar('FATOR_INVALIDO', 'O fator de escala calculado é inválido.');
  }
  const componentes = origem.componentes.map((bruto, indice) => {
    const componente = objeto(bruto, `O componente resolvido ${indice + 1}`);
    idPositivo(componente.produto_id, `O produto_id do componente resolvido ${indice + 1}`);
    if (!ORIGENS.has(componente.origem)) {
      falhar('ORIGEM_INVALIDA', `O componente resolvido ${indice + 1} possui origem inválida.`, {
        origem: componente.origem
      });
    }
    const quantidade = quantidadePositiva(
      componente.quantidade,
      `A quantidade do componente resolvido ${indice + 1}`,
      { produto_id: componente.produto_id }
    );
    const quantidadeConsumida = quantidade * fator;
    if (!Number.isFinite(quantidadeConsumida) || quantidadeConsumida <= 0) {
      falhar('QUANTIDADE_ESCALADA_INVALIDA', 'A quantidade escalada de um componente é inválida.', {
        produto_id: componente.produto_id
      });
    }
    textoUnidade(componente.unidade, `A unidade do componente resolvido ${indice + 1}`);
    return { ...copiarComponente(componente), quantidade_consumida: quantidadeConsumida };
  });

  const produtos = new Set();
  for (const componente of componentes) {
    if (produtos.has(componente.produto_id)) {
      falhar('PRODUTO_FINAL_DUPLICADO', 'A composição resolvida contém produto_id duplicado.', {
        produto_id: componente.produto_id
      });
    }
    produtos.add(componente.produto_id);
  }

  return {
    ...origem,
    componentes: componentes,
    componentes_removidos: origem.componentes_removidos.map(copiarComponente),
    alertas: copiarLista(origem.alertas, 'Os alertas da composição'),
    erros: copiarLista(origem.erros, 'Os erros da composição'),
    quantidade_planejada: planejada,
    unidade_planejada: unidade,
    fator
  };
}

module.exports = {
  ErroComposicaoFichaTecnica,
  resolverComposicaoFichaTecnica,
  escalarComposicaoFichaTecnica
};
