# ADR — Caixa como consumidor do MFE

**Código:** ADR-MFE-04-CAIXA  
**Status:** Accepted  
**Data:** 2026-07-18  
**Sprint:** MFE-04  

Relacionado: `ADR_MOTOR_FINANCEIRO.md` · `ADR_MODELO_FINANCEIRO.md`

---

## Contexto

O Caixa operacional escrevia apenas em `caixa_movimentacoes` sem passar pelo Ledger.  
O MFE já possui Pipeline + Ledger. É necessário um piloto seguro, com feature flag, sem cutover.

---

## Decisão

1. **Dual-path:** legado continua escrevendo operacionalmente; com `FEATURE_MFE_CAIXA=ON`, após COMMIT publica Evento Financeiro.  
2. **FinancialCashHandler** consome **somente** LedgerEntries — nunca cria lançamentos.  
3. Eventos oficiais EN de caixa + aliases PT.  
4. `FinancialContext` / `FinancialStatus` acompanham o modelo.  
5. Dead Letter + Outbox + Auditoria via pipeline existente.  
6. Sem alteração em PDV/Comercial/AR/AP/PIX/TEF/Fiscal.

---

## Consequências

### Positivas
- Piloto real do MFE sem risco operacional  
- Governança: Caixa não gera Ledger direto  

### Trade-offs
- Dual-write até cutover futuro  
- Projeção CashHandler em memória (persistência operacional ainda é legado)  

---

## Alternativas rejeitadas

| Alternativa | Motivo |
|-------------|--------|
| Cutover imediato (só MFE escreve caixa) | Risco alto; fora do escopo |
| Handler cria Ledger | Viola princípio (Ledger só via Pipeline) |

---

## Status

Accepted — piloto com flag OFF por default.
