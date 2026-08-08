# DIAGRAMA — FinancialGateway (MFE-05.2)

```
┌─────────────────────────────────────────────────────────┐
│              Plataforma CDS (módulos)                   │
│  PDV · Comercial · Caixa · ERP · (futuro: Fiscal/API) │
└───────────────────────────┬─────────────────────────────┘
                            │
              Bridges / Orchestrators
              (adaptadores temporários)
                            │
                            ▼
              ┌─────────────────────────┐
              │   FinancialGateway      │
              │  validar · normalizar   │
              │  resolver Context       │
              │  publicar()             │
              └────────────┬────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │  FinancialEventPipeline │
              └────────────┬────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
          EventStore     Ledger       Outbox
                            │
                            ▼
                     Domain Handlers
                   (Cash · Receivable)
                            │
                            ▼
                      Dead Letter
                     (se inválido)
```

## Fluxo oficial

```
Módulo → Bridge/Orchestrator → FinancialGateway → Pipeline → Ledger → Handler
```

## Proibido (Regra 3.5)

```
Módulo → Pipeline
Bridge → Pipeline   (direto)
```
