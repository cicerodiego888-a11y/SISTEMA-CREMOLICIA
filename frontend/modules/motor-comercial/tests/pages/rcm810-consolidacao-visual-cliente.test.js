/**
 * RCM-8.10 — Consolidação visual: 1 cliente = 1 card; N consignações independentes.
 */

const {
  buildTrabalhoPrioritario,
  buildFilaOperacional
} = require('../../pages/Dashboard/centralTrabalhoMappers');
const CentralTrabalhoView = require('../../pages/Dashboard/CentralTrabalhoView');

function miltonPayload() {
  return {
    pendenciasView: {},
    consignacoes: [
      {
        id: 1,
        clienteId: 7,
        status: 'EM_PRESTACAO',
        documento: 'CONS-2026-000001',
        saldo: 271,
        valorTotal: 271,
        itens: [{ id: 1 }, { id: 2 }, { id: 3 }],
        prestacaoContasAtiva: { status: 'ABERTA' }
      },
      {
        id: 2,
        clienteId: 7,
        status: 'RASCUNHO',
        documento: 'CONS-2026-000002',
        saldo: 0,
        valorTotal: 22.5,
        itens: [{ id: 4 }]
      },
      {
        id: 3,
        clienteId: 7,
        status: 'ENTREGUE',
        documento: 'CONS-2026-000003',
        saldo: 50,
        valorTotal: 50,
        itens: [{ id: 5 }, { id: 6 }]
      }
    ],
    perfis: [{ clienteId: 7, clienteNome: 'MILTON PEREIRA DE ALENCAR JUNIOR' }]
  };
}

describe('RCM-8.10 — consolidação visual por cliente', () => {
  test('mesmo cliente com 2 consignações → 1 card com consignacoes[]', () => {
    const itens = buildTrabalhoPrioritario({
      pendenciasView: {},
      consignacoes: [
        { id: 10, clienteId: 1, status: 'ENTREGUE', documento: 'C-10', saldo: 22.5, valorTotal: 22.5, itens: [{}] },
        { id: 11, clienteId: 1, status: 'ENTREGUE', documento: 'C-11', saldo: 271, valorTotal: 271, itens: [{}, {}, {}] }
      ],
      perfis: [{ clienteId: 1, clienteNome: 'Milton' }]
    });
    expect(itens).toHaveLength(1);
    expect(itens[0].agrupado).toBe(true);
    expect(itens[0].consignacoes).toHaveLength(2);
    expect(itens[0].consignacoes.map((o) => o.consignacaoId).sort()).toEqual([10, 11]);
  });

  test('mesmo cliente com 3 consignações → 1 card; nenhuma escondida', () => {
    const itens = buildTrabalhoPrioritario(miltonPayload());
    expect(itens).toHaveLength(1);
    expect(itens[0].quantidadeConsignacoes).toBe(3);
    expect(itens[0].consignacoes).toHaveLength(3);
    const ids = itens[0].consignacoes.map((o) => o.consignacaoId).sort();
    expect(ids).toEqual([1, 2, 3]);
  });

  test('E2 e E4 simultâneos no mesmo cliente; status não consolidado', () => {
    const card = buildTrabalhoPrioritario(miltonPayload())[0];
    const estados = card.consignacoes.map((o) => o.estado).sort();
    expect(estados).toContain('E2');
    expect(estados).toContain('E4');
    expect(estados).toContain('E3');
    expect(card.estados.sort()).toEqual(['E2', 'E3', 'E4']);
    expect(card.consignacoes.find((o) => o.consignacaoId === 1).estado).toBe('E4');
    expect(card.consignacoes.find((o) => o.consignacaoId === 2).estado).toBe('E2');
    expect(card.consignacoes.find((o) => o.consignacaoId === 3).estado).toBe('E3');
  });

  test('totais visuais do cliente são consolidados (apresentação)', () => {
    const card = buildTrabalhoPrioritario({
      pendenciasView: {},
      consignacoes: [
        { id: 19, clienteId: 7, status: 'ENTREGUE', documento: 'CONS-019', saldo: 22.5, valorTotal: 22.5, itens: [{}] },
        { id: 14, clienteId: 7, status: 'ENTREGUE', documento: 'CONS-014', saldo: 271, valorTotal: 271, itens: [{}, {}, {}] }
      ],
      perfis: [{ clienteId: 7, clienteNome: 'Milton' }]
    })[0];
    expect(card.valor).toBe(293.5);
    expect(card.itens).toBe(4);
    expect(card.quantidadeConsignacoes).toBe(2);
  });

  test('cada consignação mantém consignacaoId e ações próprias', () => {
    const card = buildTrabalhoPrioritario(miltonPayload())[0];
    const e4 = card.consignacoes.find((o) => o.consignacaoId === 1);
    const e2 = card.consignacoes.find((o) => o.consignacaoId === 2);
    const e3 = card.consignacoes.find((o) => o.consignacaoId === 3);
    expect(e4.acaoTipo).toBe('prestacao');
    expect(e4.acaoLabel).toBe('Continuar Atendimento');
    expect(e2.acaoTipo).toBe('entrega');
    expect(e2.acaoLabel).toBe('Continuar Entrega');
    expect(e3.acaoTipo).toBe('prestacao');
    expect(e3.podeEntregaComplementar).toBe(true);
    expect(e2.podeEntregaComplementar).toBe(false);
  });

  test('View: 1 card do cliente; todas as ops; ações usam consignacaoId correto', () => {
    const acoes = [];
    const host = document.createElement('div');
    document.body.appendChild(host);

    const card = buildTrabalhoPrioritario(miltonPayload())[0];
    const section = CentralTrabalhoView._renderFila([card], {
      formatCurrency: (v) => `R$ ${Number(v).toFixed(2)}`,
      onAcao: (a) => acoes.push(a)
    });
    host.appendChild(section);

    const cards = section.querySelectorAll('.cds-entity-card');
    expect(cards.length).toBe(1);

    const ops = section.querySelectorAll('.cds-central-ops__op');
    expect(ops.length).toBe(3);

    const ids = [...ops].map((el) => el.dataset.consignacaoId).sort();
    expect(ids).toEqual(['1', '2', '3']);

    const btnAtendimento = [...section.querySelectorAll('.cds-central-ops__op-btn--primary')]
      .find((b) => b.textContent === 'Continuar Atendimento');
    const btnEntrega = [...section.querySelectorAll('.cds-central-ops__op-btn--primary')]
      .find((b) => b.textContent === 'Continuar Entrega');
    const btnComp = [...section.querySelectorAll('.cds-central-ops__op-btn--ghost')]
      .find((b) => b.textContent === 'Ent. Complementar');

    expect(btnAtendimento).toBeTruthy();
    expect(btnEntrega).toBeTruthy();
    expect(btnComp).toBeTruthy();

    btnAtendimento.click();
    btnEntrega.click();
    btnComp.click();

    expect(acoes).toHaveLength(3);
    expect(acoes[0]).toMatchObject({ consignacaoId: 1, acaoTipo: 'prestacao' });
    expect(acoes[1]).toMatchObject({ consignacaoId: 2, acaoTipo: 'entrega' });
    expect(acoes[2]).toMatchObject({ consignacaoId: 3, acaoTipo: 'entrega-complementar' });

    document.body.innerHTML = '';
  });

  test('cliente com 1 consignação continua com 1 card e consignacoes[]', () => {
    const itens = buildTrabalhoPrioritario({
      pendenciasView: {},
      consignacoes: [{ id: 99, clienteId: 5, status: 'RASCUNHO', documento: 'C-99' }],
      perfis: [{ clienteId: 5, clienteNome: 'Solo' }]
    });
    expect(itens).toHaveLength(1);
    expect(itens[0].agrupado).toBe(true);
    expect(itens[0].consignacoes).toHaveLength(1);
    expect(itens[0].consignacoes[0].consignacaoId).toBe(99);
    expect(itens[0].acaoLabel).toBe('Continuar Entrega');
  });

  test('nenhuma fusão: ids distintos no mapper e na fila', () => {
    const fila = buildFilaOperacional(miltonPayload());
    const card = fila.trabalhoPrioritario[0];
    const ids = card.consignacoes.map((o) => o.consignacaoId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(7);
  });
});
