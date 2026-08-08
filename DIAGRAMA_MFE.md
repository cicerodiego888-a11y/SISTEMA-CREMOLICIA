# DIAGRAMA_MFE — Motor Financeiro Enterprise

**Sprint:** MFE-00  
**Data:** 2026-07-17  

---

## 1. Posição na Plataforma CORE

```
                        Plataforma CDS
                               │
        ┌──────────────────────┴──────────────────────┐
        ▼                                             ▼
   Motores CORE                              Consumidores
──────────────────────────────────────────────────────────
MCC · Estoque · Comercial · Fiscal
**MFE (Financeiro Enterprise)**  ← SSOT dinheiro
MIIP · Central Inteligente
──────────────────────────────────────────────────────────
PDV · Compras · E-commerce · App Vendas
Marketplace · Portal Contador · Produção
```

---

## 2. Camadas internas do MFE

```
┌─────────────────────────────────────────────────────┐
│           Motor Financeiro Enterprise (MFE)         │
├─────────────────────────────────────────────────────┤
│  Event Ingest  (IFinancialConsumer / handlers)      │
│         │                                           │
│         ▼                                           │
│  Ledger Append-Only  (IFinancialLedger)             │
│         │                                           │
│    ┌────┼────┬────────┬────────┐                    │
│    ▼    ▼    ▼        ▼        ▼                    │
│  Caixa Banco  AR      AP   Conciliação              │
│    │     │    │        │        │                   │
│    └─────┴────┴────────┴────────┘                   │
│                    │                                │
│                    ▼                                │
│         Fluxo · Projeção · Relatórios               │
└─────────────────────────────────────────────────────┘
```

---

## 3. Princípio: módulos produzem eventos

```
┌──────────┐     VENDA_RECEBIDA      ┌─────┐     ┌────────┐
│   PDV    │ ───────────────────────►│ MFE │────►│ Caixa  │
└──────────┘                         └──┬──┘     └────────┘
                                        │
┌──────────┐   TITULO_AP_CRIADO         │        ┌────────┐
│ Compras  │ ───────────────────────────┤───────►│   AP   │
└──────────┘                            │        └────────┘
                                        │
┌──────────┐  PRESTACAO_RECEBIDA        │        ┌────────┐
│Comercial │ ───────────────────────────┘───────►│ Fluxo  │
└──────────┘   (efeito empresa; CC comercial     └────────┘
                permanece no Motor Comercial)
```

---

## 4. Envelope do evento

```
FinancialEvent
├── type            (ex.: VENDA_RECEBIDA)
├── correlationId
├── causationId
├── idempotencyKey
├── origem          (PDV | COMPRA | COMERCIAL | …)
├── operadorId
├── timestamp
└── payload         (valores, contas, referências)
```

---

## 5. Ledger append-only

```
t0  CREDIT  Caixa     +100   ← VENDA_RECEBIDA
t1  DEBIT   Caixa     -100   ← VENDA_CANCELADA (compensatório)
     ✗ UPDATE / DELETE proibidos
```

---

## 6. Feature flags (migração)

```
FINANCEIRO_V2 (master)
  ├── FIN_EVENTS
  ├── FIN_LEDGER
  ├── FIN_PIX
  ├── FIN_TEF
  └── FIN_CONCILIACAO

Todos OFF → legado permanece
ON por consumidor → strangler gradual
```

---

## 7. Dependências (direção)

```
Permitido:  Consumidores ──publish──► MFE
Permitido:  MFE ──read context──► Comercial / Fiscal / … (sem acoplamento estrutural)
Proibido:   MFE bootstrap depende de PDV/Compras para existir
Proibido:   Consumidor escreve caixa/banco/AR/AP diretamente
```
