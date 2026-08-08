# MFE-05 — Contas a Receber (Piloto Oficial)

**Código:** MFE-05  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-18  

---

## Objetivo

Tornar Contas a Receber o segundo consumidor oficial do MFE.

- Flag `FEATURE_MFE_AR` default **OFF** → legado intacto  
- Flag **ON** → Evento → Pipeline → Ledger → `FinancialReceivableHandler`  
- Sem cutover definitivo  

---

## Fluxo (flag ON)

```
Operação AR (legado)
  → publicarEventoArMfe / ReceivableOrchestrator
  → FinancialEventPipeline
  → LedgerEntry
  → FinancialReceivableHandler (consome Ledger; nunca cria lançamento)
  → Projeção título + parcelas + Outbox + Auditoria
```

---

## Componentes

| Peça | Arquivo |
|------|---------|
| Handler | `events/handlers/FinancialReceivableHandler.js` |
| Orchestrator | `orchestrators/ReceivableOrchestrator.js` |
| Parcelas | `domain/FinancialInstallment.js` |
| Adapter | `publicarEventoArMfe` |
| Ponte | `backend/rotas/contas_receber.js` (pagamento) |

---

## Eventos

ACCOUNT_RECEIVABLE_CREATED · UPDATED · CANCELLED · SETTLED · PARTIAL · OVERDUE · RENEGOTIATED  
Aliases PT: TITULO_AR_*

---

## Feature Flag

`FEATURE_MFE_AR` = OFF (default)

Integração futura PDV/Comercial/PIX/TEF preparada via orchestrator — sem regras nesta sprint.

---

## Testes

```
npm run test:mfe05
npm run test:mfe
```

---

## ADR

`ADR_CONTAS_RECEBER.md`
