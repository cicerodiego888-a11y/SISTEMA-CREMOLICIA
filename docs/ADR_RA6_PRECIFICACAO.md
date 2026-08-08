# ADR RA-6 — Consolidação Definitiva da Precificação CDS

## Status
Aceito (2026-08-06)

## Contexto
RA-1…RA-5 introduziram Linha, Tabela, Canal e UX matricial multi-canal (“Lista de Preços”).
A auditoria ARQ-RA concluiu: domínio Linha é sólido; metáfora multi-canal na mesma tela não escala nem é intuitiva.

## Decisão

1. **Nomenclatura oficial:** Tabela de Preços (remover “Lista de Preços” da UX).
2. **Uma Tabela = Um Canal** (`tabelas_preco.canal_venda_id`).
3. **Grade oficial:** Linha | Forma | Unidade | Preço.
4. **Resolver:** Produto → Linha → Tabela (do canal) → Preço → Preço Base.
5. **Atacado:** regras na Tabela Atacado (`TOTAL_VENDA` | `POR_LINHA` | `POR_PRODUTO` | `POR_CATEGORIA`).
6. **Consignação:** canal/Tabela Consignado — sem entidade paralela.
7. **Compat:** APIs `/tabelas-preco` preservadas; valores multi-canal legados legíveis até re-salvar.

## Consequências
- UX mono-canal com virtualização.
- SSOT permanece `tabela_preco_valores` (agora tipicamente 1 canal por tabela).
- Evoluções futuras (promoções, cashback, campanhas) sobre esta base.
