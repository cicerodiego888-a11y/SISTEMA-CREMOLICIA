/**
 * RCM-8.1 — Edição operacional na tela de Entrega
 */

const EntregaConsignacaoPage = require('../../pages/EntregaConsignacao/index');
const {
  podeEditarItensEntrega,
  aplicarQuantidadeLocal,
  aplicarTrocaProduto,
  produtoJaExisteNaConsignacao,
  snapshotPreservado,
  validarQuantidadeEdicao,
  montarConfirmacaoEntrega,
  MENSAGEM_EDICAO_BLOQUEADA
} = require('../../pages/EntregaConsignacao/entregaItensEdicao');

describe('entregaItensEdicao', () => {
  test('RASCUNHO permite edição e ENTREGUE bloqueia', () => {
    expect(podeEditarItensEntrega('RASCUNHO')).toBe(true);
    expect(podeEditarItensEntrega('ENTREGUE')).toBe(false);
    expect(podeEditarItensEntrega('CANCELADA')).toBe(false);
  });

  test('alterar quantidade recalcula total sem mudar snapshot', () => {
    const item = {
      produtoNome: 'Sorvete',
      quantidadeEntregue: 5,
      precoUnitario: 28,
      unidadeComercial: 'LITRO',
      linhaComercialId: 7,
      tabelaPrecoId: 3,
      canalVenda: 'CONSIGNADO',
      precoOrigem: 'tabela_preco_linha',
      precoFallback: false
    };
    const depois = aplicarQuantidadeLocal(item, 7);
    expect(depois.precoUnitario).toBe(28);
    expect(depois.subtotalEntregue).toBe(196);
    expect(depois.unidadeComercial).toBe('LITRO');
    expect(snapshotPreservado(item, depois)).toBe(true);
  });

  test('UN exige inteiro e LITRO aceita decimal', () => {
    expect(validarQuantidadeEdicao(2, 'UN').ok).toBe(true);
    expect(validarQuantidadeEdicao(2.5, 'UN').ok).toBe(false);
    expect(validarQuantidadeEdicao(2.5, 'LITRO').ok).toBe(true);
  });

  test('confirmação de entrega pede revisão explícita', () => {
    const conf = montarConfirmacaoEntrega({
      clienteNome: 'Cicero Diego',
      quantidadeItens: 2,
      valorTotal: 45,
      formatCurrency: (v) => `R$ ${v}`
    });
    expect(conf.cancelLabel).toBe('Voltar e revisar');
    expect(conf.confirmLabel).toBe('Confirmar entrega');
    expect(conf.message).toContain('Cicero Diego');
  });
});

describe('EntregaConsignacaoPage edição', () => {
  test('renderiza ações quando RASCUNHO', () => {
    const page = new EntregaConsignacaoPage(10);
    page.loading.consignacao = false;
    page.loading.prestacao = false;
    page.consignacao = {
      id: 10,
      status: 'RASCUNHO',
      clienteNome: 'Cicero Diego',
      itens: [{
        id: 1,
        produtoNome: 'Sorvete',
        quantidadeEntregue: 5,
        precoUnitario: 28,
        unidadeComercial: 'LITRO',
        status: 'ATIVO'
      }]
    };
    const section = page._createItemsSection();
    expect(section.textContent).toContain('Itens da consignação');
    expect(section.textContent).toContain('Editar');
    expect(section.textContent).not.toContain('Remover');
    expect(section.textContent).toContain('LITRO');
    expect(section.querySelector('.cds-table')).toBeTruthy();
    expect(section.textContent).not.toContain('Adicionar produto');
    expect(section.querySelector('#entrega-lip-host')).toBeFalsy();
    const headers = [...section.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual([
      'Produto', 'Quantidade', 'Unidade', 'Preço', 'Valor', 'Observação', 'Status', 'Editar'
    ]);
  });

  test('após ENTREGUE o botão Editar não altera o item', () => {
    const page = new EntregaConsignacaoPage(10);
    page.loading.consignacao = false;
    page.loading.prestacao = false;
    page.consignacao = {
      id: 10,
      status: 'ENTREGUE',
      itens: [{
        id: 1,
        produtoNome: 'Sorvete',
        quantidade: 5,
        precoUnitario: 28,
        unidadeComercial: 'LITRO'
      }]
    };
    const section = page._createItemsSection();
    expect(section.textContent).toContain('Editar');
    expect(section.querySelector('#entrega-lip-host')).toBeFalsy();
    page._iniciarEdicaoItem(page.consignacao.itens[0]);
    expect(page._modalEdicao).toBeFalsy();
    expect(MENSAGEM_EDICAO_BLOQUEADA).toBe('Esta consignação não pode mais ser editada.');
  });

  test('Editar abre modal de quantidade sem redesenhar a seção', () => {
    const page = new EntregaConsignacaoPage(10);
    page.loading.consignacao = false;
    page.loading.prestacao = false;
    page.root = document.createElement('div');
    page.consignacao = {
      id: 10,
      status: 'RASCUNHO',
      itens: [{
        id: 1,
        produtoNome: 'Sorvete',
        quantidadeEntregue: 10,
        precoUnitario: 28,
        unidadeComercial: 'LITRO',
        linhaComercialId: 7,
        tabelaPrecoId: 3,
        canalVenda: 'CONSIGNADO',
        precoOrigem: 'tabela_preco_linha',
        precoFallback: false
      }]
    };
    const section = page._createItemsSection();
    expect(section.querySelectorAll('.cds-entrega-items__editar')).toHaveLength(1);
    page._iniciarEdicaoItem(page.consignacao.itens[0]);
    expect(page._modalEdicao).toBeTruthy();
    expect(page._modalEdicao.textContent).toContain('Quantidade');
    expect(page._modalEdicao.textContent).toContain('LITRO');
    expect(page._modalEdicao.querySelector('[data-field="quantidade"]').value).toBe('10');
    expect(page._modalEdicao.textContent).toContain('Trocar produto');
    expect(page._modalEdicao.querySelector('#entrega-lip-troca-host')).toBeTruthy();
    expect(page._modalEdicao.querySelector('#entrega-lip-troca-host').hidden).toBe(true);
  });

  test('troca de produto aplica snapshot do produto novo', () => {
    const atual = {
      id: 1,
      produtoId: 10,
      produtoNome: 'Milk Shakes - G',
      precoUnitario: 15,
      unidadeComercial: 'UN',
      linhaComercialId: 1,
      tabelaPrecoId: 2,
      canalVenda: 'CONSIGNADO',
      precoOrigem: 'tabela_preco_linha',
      precoFallback: false
    };
    const novo = aplicarTrocaProduto(atual, {
      produtoId: 20,
      produtoNome: 'Sorvete',
      precoUnitario: 28,
      unidadeComercial: 'LITRO',
      linhaComercialId: 7,
      tabelaPrecoId: 3,
      canalVenda: 'CONSIGNADO',
      precoOrigem: 'tabela_preco_linha',
      precoFallback: false
    }, 5);
    expect(novo.produtoId).toBe(20);
    expect(novo.produtoNome).toBe('Sorvete');
    expect(novo.precoUnitario).toBe(28);
    expect(novo.subtotalEntregue).toBe(140);
    expect(produtoJaExisteNaConsignacao([atual], 10, 1)).toBe(false);
    expect(produtoJaExisteNaConsignacao([atual], 10, 99)).toBe(true);
  });
});
