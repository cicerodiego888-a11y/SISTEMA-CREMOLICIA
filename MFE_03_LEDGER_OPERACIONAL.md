# MFE-03 — Ledger Financeiro Operacional

**Código:** MFE-03  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  

---

## Objetivo

Todo evento processado pelo Pipeline gera automaticamente um ou mais `LedgerEntry` no FinancialLedger (append-only).

Sem migração de consumidores legados. Sem caixa/AR/AP/PIX/TEF operacionais.

---

## Fluxo

```
FinancialEvent → Pipeline → Dispatcher/Handler
  → EventToLedgerMapper (auto)
  → FinancialLedgerService.criarLancamento()
  → LedgerEntry + Outbox LEDGER_ENTRY_CREATED + Auditoria
```

---

## LedgerEntry (oficial)

id · ledgerId · eventId · tipoLancamento · natureza · valor · moeda · contaFinanceira · centroCusto · historico · origem · operador · correlationId · causationId · idempotencyKey · createdAt

### Tipos operacionais

RECEITA · DESPESA · TRANSFERENCIA · ESTORNO · AJUSTE · PROVISAO · ABERTURA_CAIXA · FECHAMENTO_CAIXA · SANGRIA · SUPRIMENTO · PIX · TEF · BOLETO · CARTAO · DINHEIRO · OUTROS

### Natureza

CREDITO · DEBITO (valor sempre absoluto)

---

## FinancialLedgerService

| API | Função |
|-----|--------|
| `criarLancamento(db, entry, { fromPipeline })` | Única forma de gravar |
| `consultarHistorico` | Lista |
| `consultarPorEvento` | Por eventId |
| `consultarPorCorrelationId` | Por correlação |
| `consultarSaldoLogico` | Diagnóstico/testes |

Proibido: INSERT direto, UPDATE, DELETE.

---

## Testes

```
npm run test:mfe03
npm run test:mfe
```

---

## Decisão

O Ledger Operacional materializa automaticamente os efeitos financeiros estruturais de cada evento do pipeline, sem expor regras de caixa/banco aos consumidores.
