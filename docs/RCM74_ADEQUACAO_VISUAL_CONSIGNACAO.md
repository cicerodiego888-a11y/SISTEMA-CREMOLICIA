# RCM-7.4 — Adequação Visual da Consignação

| Campo | Valor |
|---|---|
| Sprint | RCM-7.4 |
| Data | 2026-08-06 |
| Base | RCM-7.2.1 |
| Escopo | UI Nova Consignação — sem alterar Resolver / Motor Comercial / regras |

---

## Objetivo

Separar a UX de canal do PDV da UX da consignação:

| Tela | Componente |
|---|---|
| **PDV** | `ComercialStatusCard` (Canal da Venda + progresso Atacado) |
| **Nova Consignação** | Resumo compacto da operação |

---

## Resumo da operação

Exibe apenas:

1. **Tipo Comercial** do Cliente
2. **Canal da Operação** — sempre `CONSIGNADO`
3. **Tabela de Preços** utilizada (nome retornado pela resolução)

Sem barra de progresso de Atacado.

---

## Fora de escopo

- Resolver / ordem de canal
- Motor Comercial / snapshot / congelamento
- Regras de preço / MUC / Fiscal
