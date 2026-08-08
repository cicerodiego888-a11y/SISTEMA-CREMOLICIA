# RA-2 — Linha de Precificação

## Modelo oficial (atualizado em RA-6)

```
Categoria → Produto → Linha de Precificação → Tabela de Preços (1 canal) → Preço
```

| Conceito | Responsabilidade |
|---|---|
| Categoria | Classificação |
| Linha de Precificação | Agrupa produtos com a mesma estratégia de preço |
| Tabela de Preços | Define preços das Linhas para **um** Canal |
| Canal | Dimensão/contexto da tabela |
| Preço Base | `produto.preco_venda` (fallback) |

## Persistência oficial

Preços oficiais: `tabela_preco_valores` (tabela × linha × canal) + `tabela_preco_linhas`

**Nome de domínio (UI):** Tabela de Preços  
**Nome técnico (API/banco):** `tabelas_preco`

> RA-6: uma tabela = um canal. Ver `docs/RA6_PRECIFICACAO.md`.

## Resolver

1. `tabela_preco_linha` — Tabela × Linha × Canal  
2. Compat `tabela_preco_produto`  
3. Compat `linha_comercial`  
4. Compat `tabela_preco` (canal)  
5. `produto.preco_venda`

Tabela vem de: `opts.tabela_preco_id` → tabela ativa do canal → `configuracao_comercial.tabela_preco_padrao_id` → compat produto → PADRAO/primeira ativa.

## Produto

Cadastro oficial: Categoria + Linha de Precificação + Tabela (opcional) + Preço Base.
