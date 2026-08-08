# RA-4 — UX Enterprise da Lista de Preços (planilha)

Somente UX. Arquitetura RA-2 inalterada.

> **RA-5** renomeou o conceito visual para **Lista de Preços**.

## Planilha matricial

| Linha | Forma | Unidade | Varejo | Atacado | Consignado | Evento |
|---|---|---|---|---|---|---|
| PICOLÉS ESPECIAIS | UNIDADE | UN | 3,00 | 1,50 | 1,50 | 2,50 |

## Persistência
Mesmo payload: `linhas_ids` + `valores[{linha_comercial_id, canal_venda_id, preco, forma, unidade}]`.
