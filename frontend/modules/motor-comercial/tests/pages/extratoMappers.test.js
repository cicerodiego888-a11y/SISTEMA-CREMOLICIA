/**
 * extratoMappers — Conta Corrente
 */

const {
  mapExtratoRow,
  buildResumoFinanceiro,
  buildExtrato
} = require('../../pages/ContaCorrente/extratoMappers');

describe('extratoMappers', () => {
  test('mapExtratoRow usa motivo como descrição', () => {
    const row = mapExtratoRow({
      id: 1,
      tipoMovimentacao: 'ENTREGA',
      motivo: 'Entrega de consignação',
      valor: 40,
      saldoProjetado: 40
    });
    expect(row.descricao).toBe('Entrega de consignação');
    expect(row.tipoLabel).toBe('Entrega');
    expect(row.saldoProjetado).toBe(40);
  });

  test('buildResumoFinanceiro prefere saldoDevedor da situação', () => {
    const resumo = buildResumoFinanceiro(
      { saldoAtual: 10 },
      { saldoEmAberto: 0 },
      { saldoDevedor: 150, saldo: 150 }
    );
    expect(resumo.saldoAtual).toBe(150);
  });

  test('buildExtrato prioriza lancamentos da conta corrente', () => {
    const rows = buildExtrato(
      {
        lancamentos: [
          { id: 1, tipo: 'ENTREGA', descricao: 'Entrega (2 itens)', valor: 70, saldoProjetado: 70 }
        ]
      },
      [
        { id: 9, tipoMovimentacao: 'PERFIL_CRIADO', ledger: 'PERFIL', valor: 0 },
        { id: 10, tipoMovimentacao: 'ABERTURA_PRESTACAO', valor: 0 }
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].descricao).toBe('Entrega (2 itens)');
  });

  test('buildExtrato fallback filtra perfil e abertura', () => {
    const rows = buildExtrato({}, [
      { id: 1, tipoMovimentacao: 'PERFIL_CRIADO', ledger: 'PERFIL', valor: 0 },
      { id: 2, tipoMovimentacao: 'ABERTURA_PRESTACAO', valor: 0 },
      { id: 3, tipoMovimentacao: 'ENTREGA', motivo: 'Entrega', valor: 40 }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tipo).toBe('ENTREGA');
  });
});
