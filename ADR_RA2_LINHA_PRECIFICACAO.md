# ADR RA-2 — Linha de Precificação

## Status
Aceito (2026-08-05) — **evoluído por RA-6** (2026-08-06)

## Contexto
Existia redundância entre Produto → Tabela, Produto → Política e Tabela → Política/Produto.
A Política Comercial misturava agrupamento com regras de preço.

## Decisão
Substituir o conceito de domínio **Política Comercial** por **Linha de Precificação**:

- Produto pertence a uma Linha (não escolhe Tabela como regra principal)
- Tabela define preços por Linha × Canal
- Contexto da venda / canal escolhe a Tabela
- Nome interno `linhas_comerciais` permanece por compatibilidade

## Evolução RA-6
- Nome oficial UI: **Tabela de Preços** (não “Lista”)
- Uma Tabela = um Canal (`canal_venda_id`)
- Grade: Linha | Forma | Unidade | Preço
- Ver `docs/ADR_RA6_PRECIFICACAO.md`

## Consequências
- Modelo alinhado ao Pricing Engine
- Compatibilidade preservada (APIs/tabelas legadas)
- Escrita oficial de preço: `tabela_preco_valores` com `linha_comercial_id`
