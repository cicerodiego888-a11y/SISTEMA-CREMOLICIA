# ADR — Contas a Pagar via FinancialGateway (Compras)

**Código:** ADR-MFE-06-AP  
**Status:** Accepted  
**Data:** 2026-07-18  
**Sprint:** MFE-06  

Relacionado: `ADR_FINANCIAL_GATEWAY.md` · `ADR_CONTAS_RECEBER.md`

---

## Contexto

Compras criava obrigações em `financeiro` (tipo despesa) via INSERT direto em `criarFinanceiroCompra`.  
O MFE já possui Gateway e Handler de AR; faltava o consumidor AP.

---

## Decisão

1. `FEATURE_MFE_AP` default OFF — legado intacto.  
2. `PurchasePayableBridge` → `FinancialGateway` (nunca Pipeline direto).  
3. `FinancialPayableHandler` consome Ledger; materializa título AP + parcelas.  
4. Catálogo AP completo (EN + aliases PT).  
5. Sem alterar Caixa, AR, PIX, TEF, PDV, Comercial, Fiscal.  
6. Sem cutover / remoção de bridges / regras financeiras.

---

## Consequências

### Positivas
- Terceiro consumidor oficial do MFE (após Caixa e AR)  
- Gateway unificado Caixa + AR + AP  

### Trade-offs
- Dual-path até cutover  
- Persistência async quando flag ON  

---

## Status

Accepted — piloto com flag OFF.
