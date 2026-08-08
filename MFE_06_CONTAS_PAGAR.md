# MFE-06 — Contas a Pagar / Compras (Piloto Oficial)

**Código:** MFE-06  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-18  

---

## Objetivo

Transformar Compras no primeiro consumidor oficial de Contas a Pagar (AP) via `FinancialGateway`.

```
Compra Confirmada
  → PurchasePayableBridge
  → FinancialGateway.publicarCompra()
  → Pipeline → Ledger → FinancialPayableHandler → Título AP
```

---

## Feature Flag

`FEATURE_MFE_AP` = **OFF** (default)

| Flag | Comportamento |
|------|----------------|
| OFF | `criarFinanceiroCompra` legado (INSERT `financeiro`) |
| ON | Sem INSERT direto; evento → Handler persiste |

---

## Componentes

| Peça | Arquivo |
|------|---------|
| Handler | `events/handlers/FinancialPayableHandler.js` |
| Bridge | `bridges/PurchasePayableBridge.js` |
| Adapter | `publicarEventoCompraApMfe` |
| Ponte | `backend/rotas/compras.js` (`criarFinanceiroCompra`) |

---

## Eventos

`PURCHASE_CONFIRMED` · `PURCHASE_CANCELLED`  
`ACCOUNT_PAYABLE_CREATED` · `UPDATED` · `CANCELLED` · `SETTLED` · `PARTIAL` · `OVERDUE` · `RENEGOTIATED`  
Aliases PT: `TITULO_AP_*`

Catálogo: `FINANCIAL_EVENTS_CATALOG.md`

---

## Testes

```
npm run test:mfe06
```

---

## ADR

`ADR_CONTAS_PAGAR.md`
