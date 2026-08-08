/**
 * fecharConsignacaoMappers Tests — Sprint UX-05
 */

const {
  MOMENTOS_FECHAMENTO,
  calcularTotaisItens,
  buildPainelLateral,
  buildResumoEntrega,
  buildValidacoesFinais,
  buildItensFromMovimentacoes,
  inicializarMomentos,
  campoParaTipo,
  enriquecerItensPrestacao,
  buildPayloadOperacao,
  validarPayloadOperacao,
  calcularSaldoItem,
  proximoCampoRetorno,
  buildPainelLateralPreview,
  mergeItensRetornos,
  listarPendenciasRetornos,
  mensagemErroOperacional,
  possuiVendasPendentes
} = require('../../pages/PrestacaoContas/fecharConsignacaoMappers');

describe('fecharConsignacaoMappers', () => {
  test('MOMENTOS_FECHAMENTO — STAB-07.1 duas etapas + encerramento', () => {
    expect(MOMENTOS_FECHAMENTO).toHaveLength(3);
    expect(MOMENTOS_FECHAMENTO.map((m) => m.label)).toEqual([
      'Registrar Retornos',
      'Resumo Final',
      'Encerramento'
    ]);
  });

  test('calcularTotaisItens agrega movimentações', () => {
    const totais = calcularTotaisItens([
      { vendido: 2, devolvido: 1, perdido: 0, cortesia: 1, saldo: 1 },
      { vendido: 3, devolvido: 0, perdido: 1, cortesia: 0, saldo: 0 }
    ]);
    expect(totais.vendidos).toBe(5);
    expect(totais.devolvidos).toBe(1);
    expect(totais.pendentes).toBe(1);
  });

  test('buildPainelLateral usa SSOT financeiro (não soma itens)', () => {
    const painel = buildPainelLateral(
      { valorVendido: 500, valorRecebido: 300 },
      [{ vendido: 5, devolvido: 0, perdido: 0, cortesia: 0, saldo: 0, preco: 999 }]
    );
    expect(painel.valorVenda).toBe(500);
    expect(painel.valorRecebido).toBe(300);
    expect(painel.saldoEmAberto).toBe(200);
    expect(painel.situacaoFinanceira).toBe('PARCIALMENTE_RECEBIDA');
    expect(painel.financeiro.saldoEmAberto).toBe(200);
  });

  test('buildPainelLateral não recalcula R$ a partir dos itens', () => {
    const painel = buildPainelLateral(
      { valorVendido: 0, valorRecebido: 0 },
      [
        { vendido: 2, devolvido: 1, perdido: 0, cortesia: 0, preco: 15, enviado: 5 },
        { vendido: 1, devolvido: 0, perdido: 0, cortesia: 0, preco: 20, enviado: 3 }
      ]
    );
    expect(painel.produtosVendidos).toBe(3);
    expect(painel.produtosDevolvidos).toBe(1);
    expect(painel.valorVenda).toBe(0);
    expect(painel.saldoEmAberto).toBe(0);
  });

  test('mergeItensRetornos preserva maior quantidade entre servidor e rascunho', () => {
    const merged = mergeItensRetornos(
      [{ vendido: 0, devolvido: 0, perdido: 0, cortesia: 0, enviado: 10, preco: 5 }],
      [{ vendido: 3, devolvido: 1, perdido: 0, cortesia: 0, enviado: 10, preco: 5 }]
    );
    expect(merged[0].vendido).toBe(3);
    expect(merged[0].devolvido).toBe(1);
    expect(merged[0].saldo).toBe(6);
  });

  test('buildValidacoesFinais detecta pendências', () => {
    const avisos = buildValidacoesFinais(
      { valorVendido: 100, valorRecebido: 0, saldoAtual: 100 },
      [{ saldo: 2 }],
      { pendentes: 2 }
    );
    expect(avisos.length).toBeGreaterThan(0);
  });

  test('buildResumoEntrega monta dados do cliente', () => {
    const resumo = buildResumoEntrega(
      { clienteNome: 'Cliente Teste', documento: 'CONS-001' },
      { valorConsignado: 1000, itens: [{}, {}] }
    );
    expect(resumo.cliente).toBe('Cliente Teste');
    expect(resumo.quantidadeItens).toBe(2);
    expect(resumo.valorEntregue).toBe(1000);
  });

  test('buildResumoEntrega normaliza documento objeto e itens da consignação', () => {
    const resumo = buildResumoEntrega(
      {
        id: 42,
        cliente: { nome: 'Mercantil São José' },
        documento: { numero: 'CONS-2026-0042' },
        valor: 0,
        itens: [
          { produtoNome: 'Leite', quantidade: 10, precoUnitario: 5 }
        ]
      },
      {}
    );
    expect(resumo.cliente).toBe('Mercantil São José');
    expect(resumo.documento).toBe('CONS-2026-0042');
    expect(resumo.quantidadeItens).toBe(1);
    expect(resumo.valorEntregue).toBe(50);
  });

  test('buildItensFromMovimentacoes reconstrói grade pelo ledger', () => {
    const itens = buildItensFromMovimentacoes([
      {
        id: 1,
        consignacaoItemId: 10,
        tipoMovimentacao: 'ENTREGA',
        quantidade: 5,
        valor: 50,
        snapshot: { item: { produtoId: 3, produtoNome: 'Leite Integral' } }
      },
      {
        id: 2,
        consignacaoItemId: 10,
        tipoMovimentacao: 'VENDA_PRESTACAO',
        quantidade: 2,
        valor: 20
      }
    ]);
    expect(itens).toHaveLength(1);
    expect(itens[0].produto).toBe('Leite Integral');
    expect(itens[0].enviado).toBe(5);
    expect(itens[0].vendido).toBe(2);
    expect(itens[0].saldo).toBe(3);
  });

  test('campoParaTipo mapeia campos da grade', () => {
    expect(campoParaTipo('vendido')).toBe('venda');
    expect(campoParaTipo('devolvido')).toBe('devolucao');
  });

  test('inicializarMomentos para encerrado', () => {
    const steps = inicializarMomentos(true);
    expect(steps[2].state).toBe('current');
    expect(steps[0].state).toBe('completed');
    expect(steps[1].state).toBe('completed');
  });

  test('enriquecerItensPrestacao resolve produtoId e itemId da consignação', () => {
    const itens = enriquecerItensPrestacao(
      [{ produto: 'Leite', enviado: 5, vendido: 1 }],
      [{ id: 10, produtoId: 3, quantidade: 5, precoUnitario: 4 }]
    );
    expect(itens[0].produtoId).toBe(3);
    expect(itens[0].itemId).toBe(10);
    expect(itens[0].preco).toBe(4);
    expect(itens[0].saldo).toBe(4);
  });

  test('buildPayloadOperacao normaliza tipos numéricos para venda', () => {
    const payload = buildPayloadOperacao(
      { produtoId: '3', itemId: '10', preco: '5.5' },
      2,
      'venda'
    );
    expect(payload.produtoId).toBe(3);
    expect(payload.itemId).toBe(10);
    expect(payload.quantidade).toBe(2);
    expect(payload.precoVenda).toBe(5.5);
  });

  test('validarPayloadOperacao rejeita produto ausente', () => {
    const erros = validarPayloadOperacao({ quantidade: 1, precoVenda: 0 }, 'venda');
    expect(erros.length).toBeGreaterThan(0);
  });

  test('calcularSaldoItem e proximoCampoRetorno', () => {
    expect(calcularSaldoItem({ enviado: 10, vendido: 3, devolvido: 2, perdido: 1, cortesia: 1 })).toBe(3);
    expect(proximoCampoRetorno('devolvido', 1)).toBe('vendido');
    expect(proximoCampoRetorno('vendido', 1)).toBe('perdido');
  });

  test('buildPainelLateralPreview atualiza qtds e estima R$ da grade', () => {
    const painel = buildPainelLateralPreview(
      { valorVendido: 40, valorRecebido: 50 },
      [
        { vendido: 2, devolvido: 1, perdido: 0, cortesia: 0, saldo: 0, preco: 10 },
        { vendido: 1, devolvido: 0, perdido: 1, cortesia: 0, saldo: 0, preco: 20 }
      ]
    );
    expect(painel.produtosVendidos).toBe(3);
    expect(painel.produtosDevolvidos).toBe(1);
    expect(painel.perdas).toBe(1);
    expect(painel.valorVenda).toBe(40);
    expect(painel.valorRecebido).toBe(50);
    expect(painel.saldoEmAberto).toBe(0);
    expect(painel.preview).toBe(true);
  });

  test('buildPainelLateralPreview estima valorVenda quando SSOT ainda é zero', () => {
    const painel = buildPainelLateralPreview(
      { valorVendido: 0, valorRecebido: 0 },
      [
        { vendido: 2, devolvido: 1, perdido: 0, cortesia: 0, preco: 15, enviado: 5 },
        { vendido: 2, devolvido: 1, perdido: 0, cortesia: 0, preco: 10, enviado: 3 }
      ]
    );
    expect(painel.produtosVendidos).toBe(4);
    expect(painel.valorVenda).toBe(50);
    expect(painel.valorRecebido).toBe(0);
    expect(painel.saldoEmAberto).toBe(50);
    expect(painel.situacaoFinanceira).toBe('EM_ABERTO');
    expect(painel.financeiroEstimado).toBe(true);
    expect(painel.preview).toBe(true);
  });

  test('listarPendenciasRetornos detecta deltas e ordena devolução antes de venda', () => {
    const servidor = [
      { produto: 'A', enviado: 10, vendido: 0, devolvido: 0, perdido: 0, cortesia: 0 },
      { produto: 'B', enviado: 5, vendido: 1, devolvido: 0, perdido: 0, cortesia: 0 }
    ];
    const rascunho = [
      { vendido: 2, devolvido: 1, perdido: 0, cortesia: 0 },
      { vendido: 3, devolvido: 0, perdido: 1, cortesia: 0 }
    ];
    const pendencias = listarPendenciasRetornos(servidor, rascunho);
    expect(pendencias).toHaveLength(4);
    expect(pendencias[0]).toMatchObject({ index: 0, campo: 'devolvido', tipo: 'devolucao', delta: 1 });
    expect(pendencias[1]).toMatchObject({ index: 0, campo: 'vendido', tipo: 'venda', delta: 2 });
    expect(pendencias.find((p) => p.index === 1 && p.campo === 'perdido')).toMatchObject({ tipo: 'perda', delta: 1 });
  });

  test('listarPendenciasRetornos marca redução como inválida', () => {
    const pendencias = listarPendenciasRetornos(
      [{ vendido: 3, devolvido: 0, perdido: 0, cortesia: 0 }],
      [{ vendido: 1, devolvido: 0, perdido: 0, cortesia: 0 }]
    );
    expect(pendencias).toHaveLength(1);
    expect(pendencias[0].tipo).toBe('invalido');
  });

  test('mensagemErroOperacional oculta detalhes técnicos', () => {
    expect(mensagemErroOperacional('saldo em aberto na conferência')).toMatch(/produtos que ainda não puderam/);
    expect(mensagemErroOperacional('[PAGAMENTO_MAIOR_QUE_SALDO]')).toMatch(/pagamento/);
    expect(mensagemErroOperacional('Não existe venda registrada.')).toMatch(/vendas registradas/);
    expect(mensagemErroOperacional('Devolução indisponível com prestação fechada. Reabra a prestação')).toMatch(/prestação fechada/);
    expect(mensagemErroOperacional('DEVOLUCAO_APOS_PRESTACAO')).toMatch(/não pôde ser registrado/);
  });

  test('possuiVendasPendentes identifica movimentos que abrem prestação', () => {
    expect(possuiVendasPendentes([{ tipo: 'devolucao' }])).toBe(false);
    expect(possuiVendasPendentes([{ tipo: 'venda' }])).toBe(true);
    expect(possuiVendasPendentes([{ tipo: 'perda' }])).toBe(true);
  });
});
