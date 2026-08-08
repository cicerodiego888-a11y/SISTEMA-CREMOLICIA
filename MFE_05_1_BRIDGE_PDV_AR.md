# MFE-05.1 — Bridge PDV + Comercial → Contas a Receber (Piloto)

**Código:** MFE-05.1  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-18  

---

## Objetivo

Eliminar a criação direta de títulos de Contas a Receber pelos módulos operacionais PDV e Motor Comercial.

Fluxo oficial (flags ON):

```
PDV / Motor Comercial
  → Evento Financeiro
  → Pipeline MFE
  → Ledger
  → FinancialReceivableHandler
  → Título (projeção + persistência oficial)
```

---

## Feature Flags

| Flag | Default | Efeito |
|------|---------|--------|
| `FEATURE_MFE_PDV_AR` | **OFF** | OFF = INSERT legado no PDV; ON = bridge `SALE_*` / sem INSERT direto |
| `FEATURE_MFE_COMERCIAL_AR` | **OFF** | OFF = legado; ON = bridge `COMMERCIAL_CREDIT_*` / `PAYMENT_RECEIVED` |

Compatibilidade: flags OFF preservam 100% o comportamento legado.

---

## Bridges

| Bridge | Arquivo | Eventos |
|--------|---------|---------|
| `PdvArBridge` | `bridges/PdvArBridge.js` | `SALE_COMPLETED`, `SALE_CANCELLED`, `PAYMENT_RECEIVED` |
| `ComercialArBridge` | `bridges/ComercialArBridge.js` | `COMMERCIAL_CREDIT_GENERATED`, `COMMERCIAL_CREDIT_USED`, `PAYMENT_RECEIVED`, … |

Adapters: `publicarEventoPdvArMfe` · `publicarEventoComercialArMfe`

---

## Pontes operacionais

- **PDV:** `VendaPagamentoService` — criação de parcelas; `VendaFinanceiroService` — cancelamento  
- **Comercial:** `FinanceiroPlatformGateway` — crédito gerado / usado / pagamento  

Não alterados: Contas a Pagar, PIX, TEF, Caixa, Fiscal, Estoque.

---

## Auditoria / Outbox / Dead Letter

Trilha: `operationId` · `correlationId` · `traceId` · `eventId` · `handler` · `origem`  
Outbox e Dead Letter via Pipeline MFE (padrão MFE-02).

---

## Governança

Regra **3.4** — PDV e Motor Comercial não poderão criar títulos financeiros diretamente.

---

## Testes

```
npm run test:mfe051
npm run test:mfe
```

---

## ADR

`ADR_BRIDGE_PDV_AR.md`
