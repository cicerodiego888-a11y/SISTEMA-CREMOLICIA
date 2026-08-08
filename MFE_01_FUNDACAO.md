# MFE-01 — Fundação do Motor Financeiro Enterprise

**Código:** MFE-01  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  

---

## Objetivo

Criar a infraestrutura oficial do MFE (Ledger, Event Store, Contratos, Auditoria, Feature Flags).

**Não** migra regras operacionais. **Não** altera consumidores (PDV/Compras/Comercial).

---

## Pacote

`backend/motores/motor-financeiro/`

```
bootstrap/ application/ domain/ contracts/
events/ ledger/ repositories/ services/
orchestrators/ adapters/ migrations/ tests/
```

---

## Bootstrap

`bootstrapMotorFinanceiro(db)` registra:

| Componente | Papel |
|------------|-------|
| MotorFinanceiro | Facade CORE |
| FinancialLedger | Append-only |
| FinancialEventDispatcher | Dispatch interno |
| FinancialEventStore | Persistência + idempotência |
| FinancialAudit | Auditoria |
| FeatureFlags | Flags (default OFF) |

Schema também no boot do `database.js` (após Motor Estoque).

---

## Tabelas

`financial_ledger` · `financial_events` · `financial_outbox` · `financial_dead_letter` · `financial_idempotency` · `financial_audit`

Sem migração de dados legados.

---

## Feature flags (OFF)

`FINANCEIRO_V2` · `FIN_LEDGER` · `FIN_EVENTS` (+ PIX/TEF/CONCILIACAO reservadas)

---

## Contratos públicos

`IFinancialLedger` · `IFinancialEvent` · `IFinancialEventStore` · `IFinancialPublisher` · `IFinancialConsumer` · `IFinancialAudit`

---

## Testes

```
npm run test:mfe01
```

---

## Fora de escopo (confirmado)

Caixa · Bancos · AR · AP · Fluxo · PIX · TEF · Conciliação · Relatórios

---

## Decisão

O MFE existe fisicamente na Plataforma CDS como infraestrutura CORE.  
Financeiro legado permanece integralmente ativo até cutover futuro.
