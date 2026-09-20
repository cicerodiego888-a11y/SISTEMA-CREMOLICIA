/**
 * RCM-8.9 — Acesso rápido à Entrega Complementar no card da Central
 *
 * Garante: botão no card → consignacaoId correto → rota complementar
 * (sem recriar o fluxo RCM-8.7). Preservado sob RCM-8.10 (ação por operação).
 */

const {
  buildTrabalhoPrioritario,
  podeAdicionarProdutoComplementar
} = require('../../pages/Dashboard/centralTrabalhoMappers');
const CentralTrabalhoView = require('../../pages/Dashboard/CentralTrabalhoView');

describe('RCM-8.9 — Ent. Complementar no card', () => {
  test('card agrupado renderiza Ent. Complementar só na operação elegível', () => {
    const acoes = [];
    const host = document.createElement('div');
    document.body.appendChild(host);

    const card = {
      agrupado: true,
      clienteId: 7,
      clienteNome: 'Milton',
      valor: 22.5,
      itens: 1,
      quantidadeConsignacoes: 2,
      statusLabel: '2 operações',
      situacao: '2 consignações em aberto',
      nivel: 'warning',
      estados: ['E2', 'E3'],
      consignacoes: [
        {
          clienteId: 7,
          consignacaoId: 19,
          estado: 'E3',
          acaoLabel: 'Fechar Atendimento',
          acaoTipo: 'prestacao',
          entregaLabel: 'CONS-2026-000019',
          valor: 22.5,
          itens: 1,
          podeEntregaComplementar: true
        },
        {
          clienteId: 7,
          consignacaoId: 20,
          estado: 'E2',
          acaoLabel: 'Continuar Entrega',
          acaoTipo: 'entrega',
          entregaLabel: 'CONS-2026-000020',
          valor: 0,
          itens: 0,
          podeEntregaComplementar: false
        }
      ]
    };

    const section = CentralTrabalhoView._renderFila([card], {
      formatCurrency: (v) => `R$ ${v}`,
      onAcao: (a) => acoes.push(a)
    });
    host.appendChild(section);

    expect(section.querySelectorAll('.cds-entity-card').length).toBe(1);
    expect(section.querySelectorAll('.cds-central-ops__op').length).toBe(2);

    const secundarios = section.querySelectorAll('.cds-central-ops__op-btn--ghost');
    expect(secundarios.length).toBe(1);
    expect(secundarios[0].textContent).toBe('Ent. Complementar');

    secundarios[0].click();
    expect(acoes).toHaveLength(1);
    expect(acoes[0].acaoTipo).toBe('entrega-complementar');
    expect(acoes[0].consignacaoId).toBe(19);
    expect(acoes[0].clienteId).toBe(7);

    document.body.innerHTML = '';
  });

  test('rota derivada da operação usa consignacaoId (não clienteId)', () => {
    const item = buildTrabalhoPrioritario({
      pendenciasView: {},
      consignacoes: [
        { id: 19, clienteId: 7, status: 'ENTREGUE', documento: 'CONS-019' }
      ],
      perfis: [{ clienteId: 7, clienteNome: 'Milton' }]
    })[0];

    expect(item.podeEntregaComplementar).toBe(true);
    const op = item.consignacoes[0];
    expect(op.podeEntregaComplementar).toBe(true);
    const path = `/consignacoes/${op.consignacaoId}/entrega-complementar`;
    expect(path).toBe('/consignacoes/19/entrega-complementar');
    expect(path).not.toContain('/consignacoes/7/');
  });

  test('CANCELADA não é elegível (RCM-8.8)', () => {
    expect(podeAdicionarProdutoComplementar({ id: 1, status: 'CANCELADA' }).elegivel).toBe(false);
  });
});
