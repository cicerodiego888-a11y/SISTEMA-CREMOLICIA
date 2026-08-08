# MFE-04 — Caixa Operacional (Piloto Oficial)

**Código:** MFE-04  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-18  

---

## Objetivo

Tornar o **Caixa** o primeiro consumidor oficial do MFE.

- Flag `FEATURE_MFE_CAIXA` default **OFF** → legado intacto  
- Flag **ON** → Evento → Pipeline → Ledger → `FinancialCashHandler`  
- Sem cutover definitivo  

---

## Fluxo (flag ON)

```
Operação de Caixa (legado COMMIT)
  → publicarEventoCaixaMfe / CashOrchestrator
  → FinancialEventPipeline
  → LedgerEntry
  → FinancialCashHandler (consome Ledger; nunca cria lançamento)
  → Outbox + Auditoria
```

---

## Componentes

| Peça | Arquivo |
|------|---------|
| Handler | `events/handlers/FinancialCashHandler.js` |
| Orchestrator | `orchestrators/CashOrchestrator.js` |
| Adapter | `adapters/index.js` → `publicarEventoCaixaMfe` |
| Ponte legado | `backend/rotas/caixa.js` (após COMMIT) |

---

## Eventos

CASH_OPENED · CASH_CLOSED · CASH_SUPPLY · CASH_WITHDRAWAL · CASH_ADJUSTMENT · CASH_RECONCILIATION  
(+ aliases PT CAIXA_*)

---

## Enums

- `FinancialContext` (PDV, CAIXA, …)  
- `FinancialStatus` (PENDING…ROLLED_BACK) — sem regras  
- `FeatureFlag.FEATURE_MFE_CAIXA`  

---

## Compatibilidade

Abertura, fechamento, sangria, suprimento e ajuste **100%** no fluxo legado.  
Emissão MFE é fire-and-forget e nunca bloqueia a resposta HTTP.

---

## Testes

```
npm run test:mfe04
npm run test:mfe
```

---

## ADR

`ADR_CAIXA_MFE.md`
