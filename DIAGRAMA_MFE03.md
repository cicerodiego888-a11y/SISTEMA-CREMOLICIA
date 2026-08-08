# DIAGRAMA — MFE-03 Modelo Financeiro Unificado

```mermaid
flowchart TB
  subgraph Modulos["Módulos (proibido escrever Ledger)"]
    PDV[PDV]
    ERP[ERP]
    COM[Comercial]
    EST[Estoque]
    FIS[Fiscal]
  end

  subgraph Eventos["Eventos Financeiros"]
    EV[FinancialEvent<br/>catálogo EN + aliases PT]
  end

  subgraph MFE["Motor Financeiro Enterprise"]
    PIPE[FinancialEventPipeline]
    DISP[Dispatcher + Handlers]
    OP[FinancialOperation]
    DOC[FinancialDocument]
    ENTRY[FinancialEntry]
    ALLOC[FinancialAllocation<br/>infra sem regras]
    LEDGER[FinancialLedgerEntry<br/>append-only]
    OUT[Outbox]
  end

  PDV --> EV
  ERP --> EV
  COM --> EV
  EST --> EV
  FIS --> EV

  EV --> PIPE --> DISP
  DISP --> OP
  OP --> DOC
  DISP --> ENTRY
  ENTRY --> LEDGER
  OP -.-> ALLOC
  LEDGER --> OUT

  classDef forbid fill:#fee,stroke:#c00;
  class PDV,ERP,COM,EST,FIS forbid;
```

## Fluxo oficial

```
Módulo → FinancialEvent → Pipeline → (Operation/Document) → Entry → Ledger → Outbox
```

## Proibido

```
Módulo → Ledger
```
