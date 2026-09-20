/**
 * centralTrabalhoMappers Tests — UX-03 / UX-09 / UX-10
 */

const {
  ESTADOS,
  PRESTACAO_STATUS,
  buildSaudacao,
  buildResumoDia,
  buildTrabalhoPrioritario,
  buildAcaoPrincipal,
  buildAcoesRapidas,
  buildConsignadosPendentes,
  buildProximasEntregas,
  buildProximasPrestacoes,
  buildUltimasOperacoes,
  buildCentralTrabalhoViewModel,
  resolveEstadoOperacionalCliente,
  auditarCentralEstados,
  workItemFromPendencia,
  podeAdicionarProdutoComplementar
} = require('../../pages/Dashboard/centralTrabalhoMappers');

describe('centralTrabalhoMappers', () => {
  test('buildSaudacao retorna saudação com nome', () => {
    const saudacao = buildSaudacao();
    expect(saudacao.titulo).toMatch(/Bom dia|Boa tarde|Boa noite/);
    expect(saudacao.data).toContain('Hoje é');
    expect(saudacao.mensagem).toMatch(/pronto|urgência|trabalho/i);
    expect(Array.isArray(saudacao.destaques)).toBe(true);
  });

  test('buildResumoDia agrega indicadores operacionais', () => {
    const resumo = buildResumoDia({
      consignacoes: [
        { status: 'RASCUNHO' },
        { status: 'EM_PRESTACAO' },
        { status: 'ENTREGUE', prestacaoContasAtiva: { status: 'ABERTA' } }
      ],
      pendenciasView: { alertas: [] }
    });
    expect(resumo).toHaveLength(5);
    expect(resumo.find((i) => i.key === 'entregas').valor).toBe(1);
    expect(resumo.find((i) => i.key === 'prestacoes').valor).toBe(2);
  });

  test('buildResumoDia alerta clientes com saldo a receber (E5)', () => {
    const resumo = buildResumoDia({
      consignacoes: [
        { id: 8, clienteId: 3, status: 'ACERTADA', saldo: 30 },
        { id: 9, clienteId: 3, status: 'ACERTADA', saldo: 10 },
        { id: 10, clienteId: 4, status: 'QUITADA', saldo: 0 }
      ],
      pendenciasView: { alertas: [] }
    });
    const card = resumo.find((i) => i.key === 'limite');
    expect(card.valor).toBe(1);
    expect(card.label).toMatch(/Clientes com saldo/i);
  });

  test('workItemFromPendencia prioriza prestação', () => {
    const item = workItemFromPendencia({
      id: 1,
      clienteId: 10,
      cliente: 'Mercantil São José',
      tipo: 'PRESTACAO',
      descricao: 'Prestação pendente'
    });
    expect(item.acaoTipo).toBe('prestacao');
    expect(item.acaoLabel).toBe('Continuar Atendimento');
  });

  describe('UX-10 — máquina de estados', () => {
    test('E2 — entrega em andamento', () => {
      const r = resolveEstadoOperacionalCliente({
        consignacoes: [{ id: 1, clienteId: 1, status: 'RASCUNHO' }]
      });
      expect(r.estado).toBe(ESTADOS.E2);
    });

    test('E3 — pronto para fechar', () => {
      const r = resolveEstadoOperacionalCliente({
        consignacoes: [{ id: 1, clienteId: 1, status: 'ENTREGUE', saldo: 100 }]
      });
      expect(r.estado).toBe(ESTADOS.E3);
      expect(r.prestacaoStatus).toBe(PRESTACAO_STATUS.PRONTO_PARA_FECHAR);
    });

    test('E4 — prestação em andamento', () => {
      const r = resolveEstadoOperacionalCliente({
        consignacoes: [{
          id: 1,
          clienteId: 1,
          status: 'EM_PRESTACAO',
          saldo: 80,
          prestacaoContasAtiva: { status: 'ABERTA' }
        }]
      });
      expect(r.estado).toBe(ESTADOS.E4);
      expect(r.prestacaoStatus).toBe(PRESTACAO_STATUS.EM_ANDAMENTO);
    });

    test('E5 — encerrada com saldo', () => {
      const r = resolveEstadoOperacionalCliente({
        consignacoes: [{ id: 1, clienteId: 1, status: 'ACERTADA', saldo: 50 }],
        perfil: { saldoUtilizado: 50 }
      });
      expect(r.estado).toBe(ESTADOS.E5);
      expect(r.prestacaoStatus).toBe(PRESTACAO_STATUS.ENCERRADA);
    });

    test('E6 — encerrada quitada some da fila', () => {
      const r = resolveEstadoOperacionalCliente({
        consignacoes: [{ id: 1, clienteId: 1, status: 'ACERTADA', saldo: 0 }],
        perfil: { saldoUtilizado: 0 }
      });
      expect(r.estado).toBe(ESTADOS.E6);
    });

    test('E2 tem precedência sobre saldo de perfil', () => {
      const r = resolveEstadoOperacionalCliente({
        consignacoes: [{ id: 1, clienteId: 1, status: 'VALIDADA', saldo: 0 }],
        perfil: { saldoUtilizado: 200 }
      });
      expect(r.estado).toBe(ESTADOS.E2);
    });

    test('E4 tem precedência sobre ACERTADA com saldo', () => {
      const r = resolveEstadoOperacionalCliente({
        consignacoes: [
          { id: 1, clienteId: 1, status: 'EM_PRESTACAO', saldo: 10, prestacaoContasAtiva: { status: 'ABERTA' } },
          { id: 2, clienteId: 1, status: 'ACERTADA', saldo: 90 }
        ]
      });
      expect(r.estado).toBe(ESTADOS.E4);
    });
  });

  test('buildTrabalhoPrioritario E4 usa Continuar Atendimento', () => {
    const itens = buildTrabalhoPrioritario({
      pendenciasView: { alertas: [] },
      consignacoes: [{
        id: 10,
        clienteId: 3,
        status: 'EM_PRESTACAO',
        prestacaoContasAtiva: { status: 'ABERTA' }
      }],
      perfis: [{ clienteId: 3, clienteNome: 'Cícero Diego', perfilTipo: 'CONSIGNADO' }]
    });
    expect(itens).toHaveLength(1);
    expect(itens[0].clienteNome).toBe('Cícero Diego');
    expect(itens[0].estado).toBe(ESTADOS.E4);
    expect(itens[0].acaoLabel).toBe('Continuar Atendimento');
  });

  test('buildTrabalhoPrioritario E3 usa Fechar Atendimento', () => {
    const itens = buildTrabalhoPrioritario({
      pendenciasView: { alertas: [] },
      consignacoes: [{ id: 5, clienteId: 1, status: 'ENTREGUE', saldo: 40 }],
      perfis: [{ clienteId: 1, clienteNome: 'Mercado X' }]
    });
    expect(itens[0].acaoLabel).toBe('Fechar Atendimento');
    expect(itens[0].estado).toBe(ESTADOS.E3);
  });

  test('buildTrabalhoPrioritario ordena fila E2 → E3 → E4', () => {
    const itens = buildTrabalhoPrioritario({
      pendenciasView: { alertas: [] },
      consignacoes: [
        { id: 1, clienteId: 10, status: 'EM_PRESTACAO', prestacaoContasAtiva: { status: 'ABERTA' } },
        { id: 2, clienteId: 20, status: 'ENTREGUE' },
        { id: 3, clienteId: 30, status: 'RASCUNHO' }
      ],
      perfis: [
        { clienteId: 10, clienteNome: 'Cliente E4' },
        { clienteId: 20, clienteNome: 'Cliente E3' },
        { clienteId: 30, clienteNome: 'Cliente E2' }
      ]
    });
    expect(itens.map((i) => i.estado)).toEqual(['E2', 'E3', 'E4']);
  });

  test('buildAcaoPrincipal reflete label do primeiro item', () => {
    const acao = buildAcaoPrincipal([
      { acaoTipo: 'prestacao', acaoLabel: 'Continuar Atendimento', consignacaoId: 5, estado: 'E4' }
    ]);
    expect(acao.label).toBe('Continuar Atendimento');
  });

  test('buildAcaoPrincipal sugere nova consignação sem pendências', () => {
    const acao = buildAcaoPrincipal([]);
    expect(acao.label).toBe('Preparar Entrega');
    expect(acao.acaoTipo).toBe('nova-consignacao');
  });

  test('buildAcoesRapidas só tem atalhos gerais', () => {
    const acoes = buildAcoesRapidas();
    expect(acoes.fecharAtendimento).toBeUndefined();
    expect(acoes.atalhos).toHaveLength(4);
    expect(acoes.atalhos.every((a) => a.ativo)).toBe(true);
    expect(acoes.atalhos.some((a) => a.acaoTipo === 'prestacao')).toBe(false);
  });

  test('buildConsignadosPendentes só E5 — encerrada com saldo', () => {
    const lista = buildConsignadosPendentes({
      perfis: [
        {
          clienteId: 7,
          clienteNome: 'Consignado Alpha',
          cpfCnpj: '123.456.789-00',
          saldoUtilizado: 250.5
        }
      ],
      consignacoes: [
        { id: 41, clienteId: 7, status: 'ACERTADA', documento: 'C-041', saldo: 250.5 }
      ]
    });
    expect(lista).toHaveLength(1);
    expect(lista[0].estado).toBe(ESTADOS.E5);
    expect(lista[0].acaoTipo).toBe('receber-conta-corrente');
    expect(lista[0].valorEmAberto).toBe(250.5);
  });

  test('QUITADA nunca entra em Consignados Pendentes (mesmo com perfil stale)', () => {
    const lista = buildConsignadosPendentes({
      perfis: [{ clienteId: 9, clienteNome: 'Quitado', saldoUtilizado: 99 }],
      consignacoes: [
        { id: 50, clienteId: 9, status: 'QUITADA', documento: 'C-050', saldo: 0 }
      ]
    });
    expect(lista).toHaveLength(0);

    const estado = resolveEstadoOperacionalCliente({
      consignacoes: [{ id: 50, clienteId: 9, status: 'QUITADA', saldo: 0 }],
      perfil: { saldoUtilizado: 99 }
    });
    expect(estado.estado).toBe(ESTADOS.E6);
  });

  test('ACERTADA com saldo 0 e perfil stale → E6', () => {
    const estado = resolveEstadoOperacionalCliente({
      consignacoes: [{ id: 1, clienteId: 1, status: 'ACERTADA', saldo: 0 }],
      perfil: { saldoUtilizado: 50 }
    });
    expect(estado.estado).toBe(ESTADOS.E6);
    expect(buildConsignadosPendentes({
      consignacoes: [{ id: 1, clienteId: 1, status: 'ACERTADA', saldo: 0 }],
      perfis: [{ clienteId: 1, clienteNome: 'X', saldoUtilizado: 50 }]
    })).toHaveLength(0);
  });

  test('buildConsignadosPendentes NÃO lista prestação em andamento', () => {
    const lista = buildConsignadosPendentes({
      perfis: [{ clienteId: 7, clienteNome: 'Em ciclo', saldoUtilizado: 100 }],
      consignacoes: [
        { id: 41, clienteId: 7, status: 'EM_PRESTACAO', saldo: 100, prestacaoContasAtiva: { status: 'ABERTA' } }
      ]
    });
    expect(lista).toHaveLength(0);

    const prioritario = buildTrabalhoPrioritario({
      pendenciasView: {},
      consignacoes: [
        { id: 41, clienteId: 7, status: 'EM_PRESTACAO', saldo: 100, prestacaoContasAtiva: { status: 'ABERTA' } }
      ],
      perfis: [{ clienteId: 7, clienteNome: 'Em ciclo', saldoUtilizado: 100 }]
    });
    expect(prioritario).toHaveLength(1);
    expect(prioritario[0].acaoLabel).toBe('Continuar Atendimento');
  });

  test('mesmo cliente com prestação aberta + nova entrega = 1 card com 2 consignações (RCM-8.10)', () => {
    const itens = buildTrabalhoPrioritario({
      pendenciasView: { alertas: [] },
      consignacoes: [
        {
          id: 15,
          clienteId: 42,
          status: 'EM_PRESTACAO',
          documento: 'CONS-2026-000015',
          saldo: 206,
          prestacaoContasAtiva: { status: 'ABERTA' }
        },
        {
          id: 16,
          clienteId: 42,
          status: 'RASCUNHO',
          documento: 'CONS-2026-000016',
          saldo: 0
        }
      ],
      perfis: [{ clienteId: 42, clienteNome: 'CICERO MAXIMINO DE SOUSA' }]
    });
    expect(itens).toHaveLength(1);
    expect(itens[0].agrupado).toBe(true);
    expect(itens[0].quantidadeConsignacoes).toBe(2);
    expect(itens[0].consignacoes).toHaveLength(2);
    expect(itens[0].consignacoes.map((i) => i.estado).sort()).toEqual(['E2', 'E4']);
    expect(itens[0].consignacoes.find((i) => i.estado === 'E2').consignacaoId).toBe(16);
    expect(itens[0].consignacoes.find((i) => i.estado === 'E4').consignacaoId).toBe(15);
    expect(itens[0].clienteId).toBe(42);
  });

  test('mesma consignação nunca aparece nos dois blocos', () => {
    const payload = {
      consignacoes: [
        { id: 1, clienteId: 1, status: 'EM_PRESTACAO', saldo: 80, prestacaoContasAtiva: { status: 'ABERTA' } },
        { id: 2, clienteId: 2, status: 'ACERTADA', saldo: 40 }
      ],
      perfis: [
        { clienteId: 1, clienteNome: 'A', saldoAberto: 80 },
        { clienteId: 2, clienteNome: 'B', saldoAberto: 40 }
      ]
    };
    const vm = buildCentralTrabalhoViewModel(payload);
    const idsP = new Set(vm.trabalhoPrioritario.map((i) => String(i.consignacaoId)));
    const idsC = new Set(vm.consignadosPendentes.map((i) => String(i.consignacaoId)));
    idsP.forEach((id) => expect(idsC.has(id)).toBe(false));
    expect(vm.auditoriaEstados.ok).toBe(true);
  });

  test('cliente quitado desaparece', () => {
    const vm = buildCentralTrabalhoViewModel({
      consignacoes: [{ id: 1, clienteId: 9, status: 'ACERTADA', saldo: 0 }],
      perfis: [{ clienteId: 9, clienteNome: 'Quitado', saldoAberto: 0 }]
    });
    expect(vm.trabalhoPrioritario.find((i) => String(i.clienteId) === '9')).toBeUndefined();
    expect(vm.consignadosPendentes.find((i) => String(i.clienteId) === '9')).toBeUndefined();
  });

  test('buildProximasEntregas lista consignações em rascunho', () => {
    const lista = buildProximasEntregas([
      { id: 1, clienteId: 3, status: 'RASCUNHO', documento: 'C-001' },
      { id: 2, clienteId: 4, status: 'ENCERRADA', documento: 'C-002' }
    ], [{ clienteId: 3, clienteNome: 'Mercantil Central' }]);
    expect(lista).toHaveLength(1);
    expect(lista[0].cliente).toBe('Mercantil Central');
  });

  test('buildProximasPrestacoes só E3/E4 com labels corretos', () => {
    const lista = buildProximasPrestacoes([
      { id: 7, clienteId: 2, status: 'EM_PRESTACAO', documento: 'C-007', saldo: 150 },
      { id: 8, clienteId: 3, status: 'ENTREGUE', documento: 'C-008', saldo: 20 },
      { id: 9, clienteId: 4, status: 'ACERTADA', documento: 'C-009', saldo: 50 }
    ], []);
    expect(lista).toHaveLength(2);
    expect(lista.find((i) => i.id === 7).acaoLabel).toBe('Continuar Atendimento');
    expect(lista.find((i) => i.id === 8).acaoLabel).toBe('Fechar Atendimento');
    expect(lista.find((i) => i.id === 9)).toBeUndefined();
  });

  test('buildUltimasOperacoes humaniza eventos', () => {
    const hoje = new Date().toISOString();
    const ops = buildUltimasOperacoes([
      { data: hoje, tipo: 'PRESTACAO_FECHADA', descricao: 'Atendimento encerrado' }
    ], []);
    expect(ops[0].periodo).toBe('Hoje');
    expect(ops[0].descricao).toBe('Atendimento encerrado');
  });

  test('buildCentralTrabalhoViewModel monta seções UX-10', () => {
    const vm = buildCentralTrabalhoViewModel({
      dashboard: {},
      indicadores: {},
      timeline: [],
      historico: [],
      pendencias: {},
      consignacoes: [{ id: 1, status: 'RASCUNHO', clienteId: 1, documento: 'C-1' }],
      perfis: [{ clienteId: 1, clienteNome: 'Cliente Teste', saldoAberto: 0, cpfCnpj: '111' }]
    });
    expect(vm.saudacao).toBeDefined();
    expect(vm.resumoDia).toHaveLength(5);
    expect(vm.acoesRapidas.atalhos).toHaveLength(4);
    expect(vm.proximasEntregas).toHaveLength(1);
    expect(vm.trabalhoPrioritario[0].acaoLabel).toBe('Continuar Entrega');
    expect(vm.consignadosPendentes).toHaveLength(0);
    expect(vm.proximosFechamentos).toEqual(vm.proximasPrestacoes);
    expect(vm.auditoriaEstados.ok).toBe(true);
  });

  test('auditarCentralEstados detecta interseção da mesma consignação', () => {
    const result = auditarCentralEstados({
      trabalhoPrioritario: [{
        clienteId: 1,
        consignacaoId: 99,
        estado: 'E4',
        acaoLabel: 'Continuar Atendimento'
      }],
      consignadosPendentes: [{
        clienteId: 1,
        consignacaoId: 99,
        estado: 'E5',
        prestacaoStatus: 'ENCERRADA',
        valorEmAberto: 10
      }],
      acoesRapidas: { atalhos: [] }
    });
    expect(result.ok).toBe(false);
    expect(result.erros[0]).toMatch(/Trabalho Prioritário e Consignados Pendentes/);
  });

  describe('RCM-8.9 — Ent. Complementar no card', () => {
    test('botão elegível para ENTREGUE (E3)', () => {
      const itens = buildTrabalhoPrioritario({
        pendenciasView: {},
        consignacoes: [
          { id: 19, clienteId: 7, status: 'ENTREGUE', documento: 'CONS-2026-000019', saldo: 22.5 }
        ],
        perfis: [{ clienteId: 7, clienteNome: 'Milton' }]
      });
      expect(itens).toHaveLength(1);
      expect(itens[0].consignacaoId).toBe(19);
      expect(itens[0].podeEntregaComplementar).toBe(true);
      expect(itens[0].acaoTipo).toBe('prestacao');
    });

    test('botão elegível para ENTREGUE com prestação ABERTA (E4)', () => {
      const itens = buildTrabalhoPrioritario({
        pendenciasView: {},
        consignacoes: [{
          id: 19,
          clienteId: 7,
          status: 'ENTREGUE',
          documento: 'CONS-019',
          saldo: 100,
          prestacaoContasAtiva: { status: 'ABERTA' }
        }],
        perfis: [{ clienteId: 7, clienteNome: 'Milton' }]
      });
      expect(itens[0].estado).toBe('E4');
      expect(itens[0].podeEntregaComplementar).toBe(true);
      expect(itens[0].consignacaoId).toBe(19);
    });

    test('botão NÃO aparece para RASCUNHO', () => {
      const itens = buildTrabalhoPrioritario({
        pendenciasView: {},
        consignacoes: [{ id: 1, clienteId: 1, status: 'RASCUNHO' }],
        perfis: [{ clienteId: 1, clienteNome: 'A' }]
      });
      expect(itens[0].podeEntregaComplementar).toBe(false);
    });

    test('botão NÃO aparece para CANCELADA / QUITADA / ENCERRADA', () => {
      expect(podeAdicionarProdutoComplementar({ status: 'CANCELADA' }).elegivel).toBe(false);
      expect(podeAdicionarProdutoComplementar({ status: 'QUITADA' }).elegivel).toBe(false);
      expect(podeAdicionarProdutoComplementar({ status: 'ENCERRADA' }).elegivel).toBe(false);
      expect(podeAdicionarProdutoComplementar({ status: 'ACERTADA' }).elegivel).toBe(false);
    });

    test('botão NÃO aparece quando prestação FECHADA', () => {
      expect(podeAdicionarProdutoComplementar({
        status: 'ENTREGUE',
        prestacaoContasAtiva: { status: 'FECHADA' }
      }).elegivel).toBe(false);
    });

    test('ação usa consignacaoId de cada operação, não só clienteId', () => {
      const itens = buildTrabalhoPrioritario({
        pendenciasView: {},
        consignacoes: [
          {
            id: 14,
            clienteId: 7,
            status: 'ENTREGUE',
            prestacaoContasAtiva: { status: 'ABERTA' },
            documento: 'CONS-014'
          },
          {
            id: 19,
            clienteId: 7,
            status: 'ENTREGUE',
            documento: 'CONS-019'
          }
        ],
        perfis: [{ clienteId: 7, clienteNome: 'Milton' }]
      });
      expect(itens).toHaveLength(1);
      const elegiveis = (itens[0].consignacoes || []).filter((i) => i.podeEntregaComplementar);
      expect(elegiveis.length).toBeGreaterThanOrEqual(2);
      const ids = new Set(elegiveis.map((i) => i.consignacaoId));
      expect(ids.has(14)).toBe(true);
      expect(ids.has(19)).toBe(true);
      elegiveis.forEach((i) => {
        expect(i.consignacaoId).not.toBeNull();
        expect(String(i.consignacaoId)).not.toBe(String(i.clienteId));
      });
    });
  });
});
