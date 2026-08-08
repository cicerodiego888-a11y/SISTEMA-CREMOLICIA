# MFE-07 — Liquidação Financeira (PIX / TEF / Dinheiro / Cartões)

**Código:** MFE-07  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-18  

---

## Objetivo

Criar o domínio oficial de **Liquidação Financeira** do MFE.

O meio de pagamento passa a ser **atributo** da liquidação — não um fluxo separado por SDK.

```
Título Financeiro
  → FinancialSettlement
  → Meio Financeiro
  → Gateway → Pipeline → Ledger → FinancialSettlementHandler
```

---

## Feature Flag

`FEATURE_MFE_SETTLEMENT` = **OFF** (default)

Sem cutover · Sem integração SDK PIX/TEF nesta sprint.

---

## Componentes

| Peça | Arquivo |
|------|---------|
| Domínio | `domain/FinancialSettlement.js` |
| Handler | `events/handlers/FinancialSettlementHandler.js` |
| Gateway | `publicarLiquidacao` + `publicarPix/Tef/Dinheiro/...` |

---

## Eventos

`PAYMENT_SETTLED` · `PIX_SETTLED` · `TEF_SETTLED` · `CASH_SETTLED` · `CARD_SETTLED` · `CHECK_SETTLED` · `BANK_TRANSFER_SETTLED` · `BOLETO_SETTLED` · `PAYMENT_REVERSED` · `PAYMENT_FAILED`

Aliases PT: `LIQUIDACAO_*` · `PIX_LIQUIDADO` · …

---

## Meios Financeiros (enum consolidado)

`DINHEIRO` · `PIX` · `TEF` · `CARTAO_CREDITO` · `CARTAO_DEBITO` · `BOLETO` · `CHEQUE` · `TRANSFERENCIA` · `CREDITO_COMERCIAL` · `OUTRO`

---

## Testes

```
npm run test:mfe07
```

---

## ADR

`ADR_FINANCIAL_SETTLEMENT.md`
