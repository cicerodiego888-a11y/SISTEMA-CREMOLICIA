# DIAGRAMA — Liquidação Financeira (MFE-07)

```
┌─────────────────────────────────────────┐
│  Meios: PIX · TEF · Dinheiro · Cartão  │
│         Boleto · Cheque · Transferência │
└──────────────────┬──────────────────────┘
                   │
                   ▼
         FinancialGateway
      publicarLiquidacao()
      publicarPix() / Tef() / …
                   │
                   ▼
        FinancialEventPipeline
                   │
            ┌──────┼──────┐
            ▼      ▼      ▼
        EventStore Ledger Outbox
                   │
                   ▼
      FinancialSettlementHandler
                   │
                   ▼
           FinancialSettlement
         (meioFinanceiro + valor)
```

## Princípio

```
Título → Settlement → Meio → Ledger
```

Não:

```
PIX → Baixa direta
TEF → Baixa direta
```
