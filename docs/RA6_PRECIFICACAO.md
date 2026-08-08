# RA-6 — Consolidação Definitiva da Precificação CDS

## Modelo mental oficial

```
Produto → Linha de Precificação → Tabela de Preços (1 canal) → Preço
                                                      ↓
                                              Preço Base (fallback)
```

Exemplos:

| Código | Nome | Canal |
|---|---|---|
| TAB0001 | Tabela Varejo | VAREJO |
| TAB0002 | Tabela Atacado | ATACADO |
| TAB0003 | Tabela Consignado | CONSIGNADO |
| TAB0004 | Tabela Delivery | DELIVERY |

## Persistência

- Cabeçalho: `tabelas_preco` + `canal_venda_id` + regras (`atacado_habilitado`, `quantidade_minima`, `tipo_contagem`, …)
- Valores: `tabela_preco_valores` (Lista/Tabela × Linha × Canal) — UI grava **um canal**
- Migration: `016_tabela_mono_canal_ra6`

## UX

- Cadastro: Código, Nome, Canal, Descrição, Ativa → Editor
- Abas: Dados | Preços | Regras Comerciais
- Adicionar Linha via pesquisa (sem checklist gigante)
- Grade virtualizada (pesquisa + sticky + lazy render)

## Resolver

1. `tabela_preco_id` explícito
2. Tabela ativa do **canal** solicitado
3. `configuracao_comercial.tabela_preco_padrao_id` (compat)
4. `produto.tabela_preco_id` (compat)
5. PADRAO / primeira ativa
6. Preço Base

## Atacado

Decidido pelas **regras da Tabela Atacado** (fallback: Configuração Comercial).

Contagens: `TOTAL_VENDA` (oficial misturando produtos), `POR_LINHA`, `POR_PRODUTO`, `POR_CATEGORIA`.

## Consignação

Força canal `CONSIGNADO` → resolve na Tabela Consignado.

## Fora de escopo

Motor Fiscal, Ledger, Outbox, Resilience, Projection, APIs públicas externas.
