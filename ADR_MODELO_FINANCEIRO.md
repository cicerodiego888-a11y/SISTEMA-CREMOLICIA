# ADR — Modelo Financeiro Unificado (SSOT)

**Código:** ADR-MFE-03-MODELO  
**Status:** Accepted  
**Data:** 2026-07-17  
**Sprint:** MFE-03 (Modelo Financeiro Unificado)

Relacionado: `ADR_MOTOR_FINANCEIRO.md` (ADR-MFE-00)

---

## Contexto

O MFE já possui Pipeline (MFE-02) e Ledger Operacional (MFE-03).  
Faltava o **vocabulário de domínio unificado** (operação, entry, documento, rateio, catálogos EN, meios, origens) para que nenhum módulo escreva no Ledger fora do fluxo de eventos.

---

## Decisão

1. Adotar as entidades de domínio:
   - `FinancialOperation`
   - `FinancialEntry` (visão SSOT; persistência via `FinancialLedgerEntry`)
   - `FinancialDocument`
   - `FinancialAllocation` (infraestrutura, sem regras)
2. Catálogo oficial de eventos em **EN**, com **aliases PT** para compatibilidade do pipeline/mapper.
3. Enums oficiais: `OrigemFinanceira` expandido, `MeioFinanceiro`, `FinancialOperationType`, `FinancialDocumentType`.
4. Trilha de auditoria obrigatória: operationId · correlationId · traceId · eventId · idempotencyKey.
5. **Governança:** nenhum módulo gera Ledger; todos geram Eventos Financeiros.

---

## Consequências

### Positivas
- SSOT financeiro explícito  
- Migração futura de PDV/Comercial/Caixa sem reinventar nomes  
- Compat total com MFE-01/02/03 Ledger  

### Trade-offs
- Dois nomes de evento (EN oficial / PT legado) até cutover completo  
- Allocation sem regras até sprint dedicada  

---

## Alternativas rejeitadas

| Alternativa | Motivo |
|-------------|--------|
| Só PT no catálogo | Dificulta integração e documentação enterprise |
| Entry = tabela nova paralela ao ledger | Duplicaria SSOT |
| Regras de rateio nesta sprint | Fora do escopo; sem consumidores |

---

## Status de implementação

Accepted — domínio criado; consumidores legados intactos; flags OFF.
