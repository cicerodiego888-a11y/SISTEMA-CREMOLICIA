# Pedido → NF-e e vários pedidos na mesma NF-e

O pedido não emite sozinho. Ele entra no faturamento que já existe (`faturarOperacaoNfe` → `criarVenda` → `emitirNfePorVendaId`).

## Um pedido

Na visualização do pedido, **Emitir NF-e** abre o formulário fiscal já usado, com os itens e preços gravados. Nada é transmitido nessa abertura. A venda, o estoque e o financeiro nascem só em **Confirmar emissão** (`POST /api/pedidos/:id/emitir-nfe`).

## Vários pedidos

Na Nova NF-e, **Importar pedido** lista pedidos `ABERTO`. `POST /api/nfe/pedidos/preparar` só lê o snapshot. `POST /api/nfe/pedidos/emitir` cria **uma** venda com os preços e descontos gravados e emite pela mesma NF-e.

Regras no backend:

- todos os pedidos precisam ser do mesmo cliente;
- orçamento, cancelado e já faturado são recusados;
- o mesmo pedido não entra duas vezes na mesma venda (`UNIQUE(venda_id, pedido_id)` e `UNIQUE(nfe_id, pedido_id)`).

## Rastreio

- `venda_pedidos` — venda ↔ pedidos
- `nfe_pedidos` — NF-e ↔ pedidos
- `venda_pedido_itens` — item do pedido ↔ item da venda

`pedidos_comerciais.venda_id` continua preenchido. Vários pedidos podem apontar para a mesma venda.

## Autorização e rejeição

- Sem nota registrada, a venda é desfeita e os pedidos voltam a `ABERTO`.
- Com nota registrada (inclusive rejeitada), a venda e o estado `FATURADO` permanecem para reemitir sem baixar estoque nem lançar financeiro de novo.
- NF-e avulsa (`POST /api/nfe/manual/emitir`) não usa pedido.
