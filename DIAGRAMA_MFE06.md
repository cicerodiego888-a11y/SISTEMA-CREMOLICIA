# DIAGRAMA — MFE-06 Contas a Pagar

```
┌──────────────┐
│   Compras    │
└──────┬───────┘
       │ FEATURE_MFE_AP?
       ├─ OFF → INSERT financeiro (legado)
       │
       └─ ON ─┐
              ▼
   PurchasePayableBridge
              │
              ▼
      FinancialGateway
       publicarCompra()
              │
              ▼
   FinancialEventPipeline
              │
       ┌──────┼──────┐
       ▼      ▼      ▼
   EventStore Ledger Outbox
              │
              ▼
  FinancialPayableHandler
              │
              ▼
     Título AP + Parcelas
     (+ persist financeiro)
```

## Proibido (Regra 3.6)

```
Compra → INSERT financeiro   (quando FEATURE_MFE_AP=ON)
Compra → Pipeline            (direto)
```
