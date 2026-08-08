# ADR — Bridge PDV + Comercial → Contas a Receber

**Código:** ADR-MFE-05.1-BRIDGE-PDV-AR  
**Status:** Accepted  
**Data:** 2026-07-18  
**Sprint:** MFE-05.1  

Relacionado: `ADR_CONTAS_RECEBER.md` · `ADR_MOTOR_FINANCEIRO.md`

---

## Contexto

PDV (`VendaPagamentoService`) fazia `INSERT INTO contas_receber` na venda a prazo.  
Motor Comercial publicava receita em `financeiro` sem passar pelo Pipeline MFE.  
MFE-05 cobriu apenas o caminho de **pagamento** em `contas_receber.js`.

---

## Decisão

1. Criar `PdvArBridge` e `ComercialArBridge` como portas oficiais.  
2. Flags `FEATURE_MFE_PDV_AR` e `FEATURE_MFE_COMERCIAL_AR` (default **OFF**).  
3. Flag OFF → legado (INSERT / fluxo atual).  
4. Flag ON → publicar eventos oficiais → Pipeline → Ledger → `FinancialReceivableHandler` (criação oficial do título; PDV não faz INSERT).  
5. Eventos consumidos: `SALE_COMPLETED`, `SALE_CANCELLED`, `COMMERCIAL_CREDIT_GENERATED`, `COMMERCIAL_CREDIT_USED`, `PAYMENT_RECEIVED`.  
6. Sem alterar AP, PIX, TEF, Caixa, Fiscal, Estoque.  
7. Sem cutover definitivo nesta sprint.

---

## Consequências

### Positivas
- SSOT de títulos AR no MFE  
- Governança Regra 3.4 aplicável  
- Rollback imediato via flag OFF  

### Trade-offs
- Dual-path até cutover  
- Persistência async do título quando flag ON (fire-and-forget após operação)

---

## Status

Accepted — piloto com flags OFF por default.
