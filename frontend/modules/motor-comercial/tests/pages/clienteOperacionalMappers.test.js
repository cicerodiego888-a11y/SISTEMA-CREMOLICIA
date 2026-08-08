/**
 * clienteOperacionalMappers Tests — Sprint UX-01
 */

const {
  groupPerfisByCliente,
  filtrarClientesOperacional,
  enrichClienteCard
} = require('../../pages/PerfilComercial/clienteOperacionalMappers');
const { mapPerfilListItem } = require('../../pages/PerfilComercial/perfilMappers');

describe('clienteOperacionalMappers', () => {
  test('groupPerfisByCliente agrupa múltiplos perfis do mesmo cliente', () => {
    const perfis = [
      mapPerfilListItem({ id: 1, clienteId: 10, perfilTipo: 'CONSIGNADO', cliente: { nome: 'Loja A', cidade: 'Fortaleza' } }),
      mapPerfilListItem({ id: 2, clienteId: 10, perfilTipo: 'ATACADISTA', cliente: { nome: 'Loja A', cidade: 'Fortaleza' } })
    ];

    const grupos = groupPerfisByCliente(perfis);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].nome).toBe('Loja A');
    expect(grupos[0].perfis).toHaveLength(2);
    expect(grupos[0].capacidades).toContain('Consignação');
    expect(grupos[0].capacidades).toContain('Atacado');
  });

  test('groupPerfisByCliente NÃO usa perfil.id como clienteId (evita abrir cliente errado)', () => {
    const perfis = [
      mapPerfilListItem({
        id: 5,
        clienteId: 42,
        perfilTipo: 'CONSIGNADO',
        cliente: { nome: 'Francisco das Chagas' }
      }),
      mapPerfilListItem({
        id: 42,
        clienteId: 1,
        perfilTipo: 'CONSIGNADO',
        cliente: { nome: 'Cicero Diego' }
      })
    ];

    const grupos = groupPerfisByCliente(perfis);
    expect(grupos).toHaveLength(2);

    const francisco = grupos.find((g) => g.clienteId === 42);
    const cicero = grupos.find((g) => g.clienteId === 1);
    expect(francisco.nome).toBe('Francisco das Chagas');
    expect(cicero.nome).toBe('Cicero Diego');
    // Abrir cliente 42 nunca deve apontar para o perfil cujo id=42 (Cícero)
    expect(francisco.clienteId).toBe(42);
    expect(francisco.perfis[0].id).toBe(5);
  });

  test('groupPerfisByCliente ignora perfil sem clienteId', () => {
    const grupos = groupPerfisByCliente([
      mapPerfilListItem({ id: 9, perfilTipo: 'CONSIGNADO', cliente: { nome: 'Órfão' } })
    ]);
    expect(grupos).toHaveLength(0);
  });

  test('filtrarClientesOperacional busca por documento', () => {
    const clientes = [{
      clienteId: 1,
      nome: 'Mercantil',
      documento: '12345678900',
      telefone: '85999999999',
      codigo: '1',
      capacidades: [],
      status: 'Ativo'
    }];

    const filtrados = filtrarClientesOperacional(clientes, '123456');
    expect(filtrados).toHaveLength(1);
  });

  test('enrichClienteCard preenche saldo e consignações', () => {
    const grupo = { clienteId: 1, nome: 'Teste', perfilPrincipal: { saldoUtilizado: 0 } };
    const enriched = enrichClienteCard(grupo, { saldo: 1250, consignacoesAbertas: [{ id: 1 }, { id: 2 }] });
    expect(enriched.saldoAtual).toBe(1250);
    expect(enriched.consignacoesAbertas).toBe(2);
  });
});
