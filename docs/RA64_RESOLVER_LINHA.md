# RA-6.4 — Resolver Oficial baseado em Linha

## Fluxo oficial

```text
Produto → Linha de Precificação → Tabela do Canal (fluxo da venda) → Preço
                                → Preço Base (fallback)
                                → Erro controlado
```

## Removido do fluxo oficial

`produto.tabela_preco_id` — nunca é critério de resolução (permanece só como dado histórico).

## Quem escolhe a Tabela

1. `opts.tabela_preco_id` (contexto da venda)  
2. Tabela ativa do **Canal**  
3. Compat: config padrão / PADRAO  

## Atacado

Canal ATACADO → Tabela Atacado → mesma Linha → preço atacado.

## Mensagem controlada

`Nenhum preço encontrado para esta Linha de Precificação na Tabela selecionada.`

## Escopo

Alterado: `ComercialPrecoResolver` (+ teste).  
Não alterado: Produto UI, Editor de Tabelas, PDV, Consignação, Fiscal, Ledger, Outbox.
