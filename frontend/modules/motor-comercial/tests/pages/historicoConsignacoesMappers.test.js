/**
 * RCM-8.0 — Histórico de consignações / reimpressão (snapshot)
 */

const {
  buildHistoricoConsignacoes,
  buildDetalheConsulta,
  buildComprovanteConsignacaoHtml,
  mapStatusConsulta,
  reimpressaoSomenteLeitura
} = require('../../pages/PerfilComercial/historicoConsignacoesMappers');
const { buildCentralOperacoesViewModel } = require('../../pages/PerfilComercial/centralOperacoesMappers');
const CentralOperacoesView = require('../../pages/PerfilComercial/CentralOperacoesView');
const ConsultaConsignacaoModal = require('../../pages/PerfilComercial/ConsultaConsignacaoModal');

describe('historicoConsignacoesMappers', () => {
  const consignacao = {
    id: 125,
    clienteId: 2,
    documento: { numero: '000125' },
    status: 'ENTREGUE',
    dataEntrega: '2026-08-06T14:00:00.000Z',
    dataAbertura: '2026-08-06T10:00:00.000Z',
    valorTotalEntregue: 185,
    quantidadeItens: 12,
    updatedAt: '2026-08-06T14:05:00.000Z',
    clienteNome: 'Cicero Diego',
    itens: [{
      id: 1,
      produtoNome: 'Picolé Premium',
      unidadeComercial: 'UN',
      quantidadeEntregue: 10,
      precoUnitario: 2.5,
      precoTotal: 25,
      tabelaPrecoId: 3,
      canalVenda: 'CONSIGNADO',
      linhaComercialId: 7,
      precoOrigem: 'tabela_preco_linha',
      precoFallback: false
    }]
  };

  test('lista consignações sem clienteId no registro (API já filtrada)', () => {
    const rows = buildHistoricoConsignacoes([
      { ...consignacao, clienteId: undefined }
    ], 2);
    expect(rows).toHaveLength(1);
  });

  test('lista ENCERRADA, QUITADA e CANCELADA no histórico', () => {
    const rows = buildHistoricoConsignacoes([
      { ...consignacao, id: 1, documento: { numero: 'CONS-2026-000001' }, status: 'ENCERRADA' },
      { ...consignacao, id: 2, documento: { numero: 'CONS-2026-000002' }, status: 'QUITADA' },
      { ...consignacao, id: 3, documento: { numero: 'CONS-2026-000003' }, status: 'CANCELADA' }
    ], 2);
    expect(rows.map((r) => r.statusLabel).sort()).toEqual(['Cancelada', 'Encerrada', 'Quitada']);
  });

  test('lista somente consignações do cliente', () => {
    const rows = buildHistoricoConsignacoes([
      consignacao,
      { ...consignacao, id: 9, clienteId: 99 }
    ], 2);
    expect(rows).toHaveLength(1);
    expect(rows[0].numero).toBe('000125');
    expect(rows[0].statusLabel).toBe('Entregue');
    expect(rows[0].quantidadeItens).toBe(12);
    expect(rows[0].valorTotal).toBe(185);
  });

  test('detalhe usa preço e unidade congelados', () => {
    const detalhe = buildDetalheConsulta(consignacao, { tipoComercial: 'CONSIGNADO' });
    expect(detalhe.canalOperacao).toBe('CONSIGNADO');
    expect(detalhe.produtos[0].precoUnitario).toBe(2.5);
    expect(detalhe.produtos[0].unidade).toBe('UN');
    expect(detalhe.tabelaPrecoId).toBe(3);
    expect(detalhe.somenteLeitura).toBe(true);
  });

  test('comprovante de reimpressão representa a operação original', () => {
    const detalhe = buildDetalheConsulta(consignacao, { clienteNome: 'Cicero Diego' });
    const html = buildComprovanteConsignacaoHtml(detalhe);
    expect(html).toContain('COMPROVANTE DE CONSIGNAÇÃO');
    expect(html).toContain('000125');
    expect(html).toContain('Cicero Diego');
    expect(html).toContain('Picolé Premium');
    expect(html).toContain('CONSIGNADO');
    expect(reimpressaoSomenteLeitura().alteraLedger).toBe(false);
  });

  test('viewModel inclui seção de consignações no histórico', () => {
    const vm = buildCentralOperacoesViewModel({
      perfil: { clienteId: 2, clienteNome: 'Cicero Diego' },
      consignacoes: [consignacao]
    });
    expect(vm.consignacoesHistorico).toHaveLength(1);
    expect(vm.acoesPrincipais.map((a) => a.label)).toEqual([
      'Preparar Entrega',
      'Fechar Atendimento',
      'Conta Corrente',
      'Histórico',
      'Dados do Cliente'
    ]);
  });

  test('Histórico mostra seção CONSIGNAÇÕES mesmo sem registros', () => {
    const vm = buildCentralOperacoesViewModel({
      perfil: { clienteId: 2, clienteNome: 'Cicero Diego' },
      consignacoes: []
    });
    const root = CentralOperacoesView.render(vm, {
      formatCurrency: (v) => `R$ ${v}`,
      formatDate: () => '—'
    });
    expect(root.querySelector('#sec-historico-consignacoes')).toBeTruthy();
    expect(root.textContent).toContain('CONSIGNAÇÕES');
    expect(root.textContent).toContain('Nenhuma consignação');
    expect(root.textContent).toContain('Últimas movimentações');
  });

  test('Histórico renderiza Consignações sem botão extra no cabeçalho', () => {
    const vm = buildCentralOperacoesViewModel({
      perfil: { clienteId: 2, clienteNome: 'Cicero Diego' },
      consignacoes: [consignacao]
    });
    const root = CentralOperacoesView.render(vm, {
      formatCurrency: (v) => `R$ ${v}`,
      formatDate: () => '06/08/2026'
    });
    expect(root.querySelector('#sec-historico-consignacoes')).toBeTruthy();
    expect(root.textContent).toContain('CONSIGNAÇÕES');
    expect(root.querySelector('.cds-ficha-cliente__consignacao-card')).toBeTruthy();
    expect(root.textContent).toContain('Visualizar');
    expect(root.textContent).toContain('Reimprimir');
    expect(root.querySelectorAll('.cds-ficha-cliente__acao')).toHaveLength(5);
  });

  test('modal de consulta mostra resumo e snapshot', () => {
    const detalhe = buildDetalheConsulta(consignacao, { clienteNome: 'Cicero Diego' });
    const modal = ConsultaConsignacaoModal.render(detalhe, { onClose: () => {}, onReimprimir: () => {} });
    expect(modal.textContent).toContain('CONSIGNAÇÃO Nº 000125');
    expect(modal.textContent).toContain('Picolé Premium');
    expect(modal.textContent).toContain('Precificação congelada');
    expect(modal.textContent).toContain('Identificação');
    expect(modal.textContent).toContain('Unidade Comercial');
    expect(modal.textContent).toContain('Reimprimir');
  });

  test('mapStatusConsulta cobre labels oficiais', () => {
    expect(mapStatusConsulta({ status: 'RASCUNHO' }).label).toBe('Em preparação');
    expect(mapStatusConsulta({ status: 'CANCELADA' }).label).toBe('Cancelada');
  });

  test('histórico paginado mostra só a página e botão Carregar mais', () => {
    const pagina = Array.from({ length: 20 }, (_, i) => ({
      ...consignacao,
      id: 100 - i,
      documento: { numero: `CONS-${100 - i}` }
    }));
    const vm = buildCentralOperacoesViewModel({
      perfil: { clienteId: 2, clienteNome: 'Cicero Diego' },
      consignacoes: [],
      consignacoesHistorico: buildHistoricoConsignacoes(pagina, 2, { manterOrdem: true }),
      historicoPaginacao: { total: 45, page: 1, pageSize: 20, hasMore: true }
    });
    const root = CentralOperacoesView.render(vm, {
      formatCurrency: (v) => `R$ ${v}`,
      formatDate: () => '06/08/2026'
    });
    expect(root.querySelectorAll('.cds-ficha-cliente__consignacao-card')).toHaveLength(20);
    expect(root.textContent).toContain('Mostrando 20 de 45');
    expect(root.textContent).toContain('Carregar mais');
  });

  test('histórico paginado sem próxima página não oferece Carregar mais', () => {
    const vm = buildCentralOperacoesViewModel({
      perfil: { clienteId: 2, clienteNome: 'Cicero Diego' },
      consignacoes: [consignacao],
      historicoPaginacao: { total: 1, page: 1, pageSize: 20, hasMore: false }
    });
    const root = CentralOperacoesView.render(vm, {
      formatCurrency: (v) => `R$ ${v}`,
      formatDate: () => '06/08/2026'
    });
    expect(root.textContent).toContain('Mostrando 1 de 1');
    expect(root.textContent).not.toContain('Carregar mais');
  });
});
