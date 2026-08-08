/**
 * RCM-04.5 — Configuração Comercial + CanalVendaResolver
 */

const assert = require('assert');
const path = require('path');

const CanalVendaResolver = require(path.join(__dirname, '../preco/CanalVendaResolver'));
const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
const configuracaoService = require(path.join(__dirname, '../configuracao/ConfiguracaoComercialService'));
const tabelasService = require(path.join(__dirname, '../tabelas-preco/TabelasPrecoService'));
const canaisService = require(path.join(__dirname, '../canais/CanaisVendaService'));
const { bootstrapComercialV2Schema } = require(path.join(__dirname, '../index'));
const db = require(path.join(__dirname, '../../../database'));

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
      return;
    }
    setTimeout(resolve, 500);
  });
}

async function run() {
  ComercialPrecoResolver.setLogsHabilitados(false);
  await whenReady();
  await bootstrapComercialV2Schema(db);

  // Homologação: forçar estado seed conhecido (DB de produção pode ter atacado ligado)
  await configuracaoService.salvar({
    atacado_habilitado: false,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA'
  });

  const cfgInicial = await configuracaoService.obter();
  assert.ok(cfgInicial, 'configuração comercial seed');
  assert.strictEqual(cfgInicial.atacado_habilitado, false, 'atacado inicia desabilitado');
  assert.strictEqual(cfgInicial.quantidade_minima, 30);
  assert.strictEqual(cfgInicial.tipo_contagem, 'TOTAL_VENDA');

  // Compat: desabilitado → sempre VAREJO
  const desabilitado = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 100 }]
  });
  assert.strictEqual(desabilitado.canal, 'VAREJO');
  assert.strictEqual(desabilitado.motivo, 'atacado_desabilitado');

  const canais = await canaisService.listar({ ativos: '1' });
  const atacado = canais.find((c) => String(c.codigo).toUpperCase() === 'ATACADO');
  const varejo = canais.find((c) => String(c.codigo).toUpperCase() === 'VAREJO');
  assert.ok(atacado && varejo, 'canais VAREJO/ATACADO');

  await configuracaoService.salvar({
    atacado_habilitado: true,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });

  const abaixo = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 10 }, { produto_id: 2, quantidade: 5 }]
  });
  assert.strictEqual(abaixo.canal, 'VAREJO');
  assert.strictEqual(abaixo.motivo, 'quantidade_insuficiente');

  const totalOk = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 20 }, { produto_id: 2, quantidade: 15 }]
  });
  assert.strictEqual(totalOk.canal, 'ATACADO');
  assert.strictEqual(totalOk.atacado, true);
  assert.strictEqual(totalOk.motivo, 'regra_atacado_atingida');

  await configuracaoService.salvar({
    atacado_habilitado: true,
    quantidade_minima: 10,
    tipo_contagem: 'POR_PRODUTO',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });

  const porProdutoFalha = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 12 }, { produto_id: 2, quantidade: 5 }]
  });
  assert.strictEqual(porProdutoFalha.canal, 'VAREJO');

  const porProdutoOk = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 12 }, { produto_id: 2, quantidade: 10 }]
  });
  assert.strictEqual(porProdutoOk.canal, 'ATACADO');

  // Bloqueio produtos diferentes
  await configuracaoService.salvar({
    atacado_habilitado: true,
    quantidade_minima: 5,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: false,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });
  const mistos = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 20 }, { produto_id: 2, quantidade: 20 }]
  });
  assert.strictEqual(mistos.motivo, 'produtos_diferentes_bloqueados');
  assert.strictEqual(mistos.canal, 'VAREJO');

  // Integração ComercialPrecoResolver + CanalVendaResolver
  const suffix = Date.now().toString(36).toUpperCase();
  const tabela = await tabelasService.criar({
    codigo: `RC45_${suffix}`,
    nome: `Tabela RC45 ${suffix}`,
    ativo: true,
    valores: [
      { canal_venda_id: varejo.id, preco: 10 },
      { canal_venda_id: atacado.id, preco: 7 }
    ]
  });

  await configuracaoService.salvar({
    atacado_habilitado: true,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });

  const produtoFake = {
    id: 999001,
    nome: 'Produto RC45',
    preco_venda: 99,
    tabela_preco_id: tabela.id
  };

  const precoVarejo = await ComercialPrecoResolver.resolver({
    produto: produtoFake,
    itens: [{ produto_id: 1, quantidade: 5 }]
  });
  assert.strictEqual(precoVarejo.canal, 'VAREJO');
  assert.strictEqual(precoVarejo.preco_venda, 10);

  const precoAtacado = await ComercialPrecoResolver.resolver({
    produto: produtoFake,
    itens: [{ produto_id: 1, quantidade: 35 }]
  });
  assert.strictEqual(precoAtacado.canal, 'ATACADO');
  assert.strictEqual(precoAtacado.preco_venda, 7);

  // Fallback sem tabela
  const fallback = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Sem Tabela', preco_venda: 4.5 },
    canal: 'ATACADO'
  });
  assert.strictEqual(fallback.preco_venda, 4.5);
  assert.strictEqual(fallback.fallback, true);

  // API compartilhada resolverPrecosVenda
  const lote = await configuracaoService.resolverPrecosVenda({
    itens: [{ produto_id: 1, quantidade: 40 }]
  });
  assert.ok(lote.canal === 'ATACADO' || lote.canal === 'VAREJO');
  assert.ok(Array.isArray(lote.itens));
  if (lote.itens[0] && !lote.itens[0].erro) {
    assert.ok(Number.isFinite(Number(lote.itens[0].preco_varejo)));
    assert.ok(Number.isFinite(Number(lote.itens[0].desconto_atacado)));
    if (lote.canal === 'ATACADO' && Number(lote.itens[0].preco_varejo) > Number(lote.itens[0].preco_venda)) {
      assert.ok(Number(lote.itens[0].desconto_unitario_atacado) > 0);
      assert.ok(Number(lote.itens[0].desconto_atacado) > 0);
    }
  }

  // Restaura config padrão (compat)
  await configuracaoService.salvar({
    atacado_habilitado: false,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });

  console.log('RCM-04.5 OK');
}

run().catch((err) => {
  console.error('RCM-04.5 FALHOU:', err);
  process.exit(1);
});
