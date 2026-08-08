# ADR — Liquidação Financeira (FinancialSettlement)

**Código:** ADR-MFE-07-SETTLEMENT  
**Status:** Accepted  
**Data:** 2026-07-18  
**Sprint:** MFE-07  

Relacionado: `ADR_FINANCIAL_GATEWAY.md` · `ADR_MOTOR_FINANCEIRO.md`

---

## Contexto

PIX, TEF, dinheiro e cartões tendiam a virar fluxos de baixa separados.  
Isso não escala e viola o princípio de liquidação unificada via MFE.

---

## Decisão

1. Criar `FinancialSettlement` como entidade de liquidação.  
2. Meio financeiro = atributo (`MeioFinanceiro`), não motor separado.  
3. `FinancialSettlementHandler` consome Ledger após Pipeline.  
4. Gateway: `publicarLiquidacao` + especializações (`publicarPix`, …).  
5. Flag `FEATURE_MFE_SETTLEMENT` default OFF.  
6. Sem SDK PIX/TEF · sem cutover · sem alterar Caixa/AR/AP/Fiscal/Estoque/Comercial.

---

## Consequências

### Positivas
- Um modelo de liquidação para todos os meios  
- Preparação limpa para SDKs futuros  

### Trade-offs
- Integrações físicas ficam para sprints posteriores  

---

## Status

Accepted.
