# ADR — Contas a Receber via MFE

**Código:** ADR-MFE-05-AR  
**Status:** Accepted  
**Data:** 2026-07-18  
**Sprint:** MFE-05  

Relacionado: `ADR_MOTOR_FINANCEIRO.md` · `ADR_CAIXA_MFE.md`

---

## Contexto

Títulos AR eram criados/baixados com INSERT/UPDATE direto (`contas_receber`, `VendaPagamentoService`).  
O MFE precisa de um piloto seguro, com flag, sem cutover.

---

## Decisão

1. Dual-path: legado continua; com `FEATURE_MFE_AR=ON`, após operação publica Evento Financeiro.  
2. `FinancialReceivableHandler` consome **somente** LedgerEntries.  
3. Catálogo AR completo (EN + aliases PT).  
4. `FinancialInstallment` prepara parcelas sem regras complexas.  
5. Sem alterar AP, PIX, TEF, Caixa, Fiscal, Estoque.  
6. Integração profunda PDV/Comercial fica para sprints futuras.

---

## Consequências

### Positivas
- Segundo consumidor oficial do MFE  
- Governança: AR não gera Ledger direto  

### Trade-offs
- Dual-write até cutover  
- Criação de título no PDV ainda legado (só bridge de pagamento nesta sprint)

---

## Status

Accepted — piloto com flag OFF por default.
