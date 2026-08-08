# MFE-02 — Pipeline Oficial de Eventos Financeiros

**Código:** MFE-02  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  

---

## Objetivo

Única porta de entrada do MFE: todo lançamento financeiro nasce de um `FinancialEvent` processado pelo pipeline.

Nenhum consumidor legado migrado. Sem regras operacionais de caixa/AR/AP.

---

## Fluxo

```
Origem
  → FinancialEvent
  → Validação + Catálogo
  → Idempotência
  → FinancialEventStore (bruto, imutável)
  → FinancialEventDispatcher (handler + retries)
  → FinancialLedger (somente via pipeline)
  → financial_outbox
  → Auditoria / Dead Letter
```

API oficial: `motor.processarEvento(db, evento)` / `publisher.publicar(db, evento)`.

---

## Componentes

| Componente | Papel |
|------------|-------|
| `FinancialEventPipeline` | Orquestra o fluxo |
| `FinancialEventStore` | Persiste evento bruto + idempotência |
| `FinancialEventDispatcher` | Valida, localiza handler, retries, ledger |
| Handlers | Um por tipo do catálogo — **vazios** (sem regra de negócio) |
| `FinancialLedger` | Append-only; exige `fromPipeline: true` |
| Dead Letter | Eventos inválidos / falha definitiva |
| Outbox | Eventos processados (sem consumidores externos) |

---

## Catálogo

Inclui: `VENDA_*`, `TITULO_AR/AP_*`, `CAIXA_*` (+ sangria/suprimento), `PIX_*`, `TEF_*`, `TRANSFERENCIA_BANCARIA`, `AJUSTE_FINANCEIRO`, `CONCILIACAO_REALIZADA`, `ESTORNO_FINANCEIRO`, `PRESTACAO_RECEBIDA`.

---

## Proibição

Criação direta de `LedgerEntry` fora do pipeline → `LedgerEntryDirectForbiddenError`.

---

## Testes

```
npm run test:mfe02
npm run test:mfe   # mfe01 + mfe02
```

---

## Decisão

O Pipeline Oficial é a única porta de entrada do Motor Financeiro Enterprise.
