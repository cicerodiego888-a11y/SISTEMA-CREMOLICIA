# FINANCIAL_EVENTS_CATALOG — Catálogo Oficial de Eventos Financeiros CDS

**Versão:** 1.0  
**Sprint referência:** MFE-06  
**Status:** Referência oficial da Plataforma CDS  

Todos os eventos passam por: **FinancialGateway → Pipeline → Ledger → Handler** (Regra 3.5).

---

## Legenda

| Coluna | Significado |
|--------|-------------|
| Origem | Módulo / domínio produtor |
| Contexto | `FinancialContext` resolvido pelo Gateway |
| Handler | Consumidor de domínio após Ledger |
| Flag | Feature flag do piloto |
| Resultado | Efeito principal |

---

## Caixa (MFE-04)

| Evento | Origem | Contexto | Handler | Resultado | Flag | Consumidores |
|--------|--------|----------|---------|-----------|------|--------------|
| CASH_OPENED | Caixa/PDV | CAIXA | FinancialCashHandler | Abre sessão | FEATURE_MFE_CAIXA | `rotas/caixa.js` |
| CASH_CLOSED | Caixa/PDV | CAIXA | FinancialCashHandler | Fecha sessão | FEATURE_MFE_CAIXA | `rotas/caixa.js` |
| CASH_SUPPLY | Caixa | CAIXA | FinancialCashHandler | Suprimento | FEATURE_MFE_CAIXA | `rotas/caixa.js` |
| CASH_WITHDRAWAL | Caixa | CAIXA | FinancialCashHandler | Sangria | FEATURE_MFE_CAIXA | `rotas/caixa.js` |
| CASH_ADJUSTMENT | Caixa | CAIXA | FinancialCashHandler | Ajuste | FEATURE_MFE_CAIXA | `rotas/caixa.js` |
| CASH_RECONCILIATION | Caixa | CAIXA | FinancialCashHandler | Conciliação | FEATURE_MFE_CAIXA | — |

Aliases PT: `CAIXA_*`

---

## Contas a Receber (MFE-05 / 05.1)

| Evento | Origem | Contexto | Handler | Resultado | Flag | Consumidores |
|--------|--------|----------|---------|-----------|------|--------------|
| SALE_COMPLETED | PDV | PDV | FinancialReceivableHandler | Cria AR | FEATURE_MFE_PDV_AR | `VendaPagamentoService` |
| SALE_CANCELLED | PDV | PDV | FinancialReceivableHandler | Cancela AR | FEATURE_MFE_PDV_AR | `VendaFinanceiroService` |
| PAYMENT_RECEIVED | PDV/Comercial/ERP | FINANCEIRO/PDV/COMERCIAL | FinancialReceivableHandler | Baixa/recebimento | FEATURE_MFE_AR / bridges | `contas_receber.js`, Comercial |
| COMMERCIAL_CREDIT_GENERATED | Comercial | COMERCIAL | FinancialReceivableHandler | Crédito gerado | FEATURE_MFE_COMERCIAL_AR | `FinanceiroPlatformGateway` |
| COMMERCIAL_CREDIT_USED | Comercial | COMERCIAL | FinancialReceivableHandler | Crédito usado | FEATURE_MFE_COMERCIAL_AR | `FinanceiroPlatformGateway` |
| ACCOUNT_RECEIVABLE_CREATED | ERP | FINANCEIRO | FinancialReceivableHandler | Cria título AR | FEATURE_MFE_AR | `ReceivableOrchestrator` |
| ACCOUNT_RECEIVABLE_UPDATED | ERP | FINANCEIRO | FinancialReceivableHandler | Atualiza AR | FEATURE_MFE_AR | — |
| ACCOUNT_RECEIVABLE_CANCELLED | ERP | FINANCEIRO | FinancialReceivableHandler | Cancela AR | FEATURE_MFE_AR | — |
| ACCOUNT_RECEIVABLE_SETTLED | ERP | FINANCEIRO | FinancialReceivableHandler | Liquida AR | FEATURE_MFE_AR | `contas_receber.js` |
| ACCOUNT_RECEIVABLE_PARTIAL | ERP | FINANCEIRO | FinancialReceivableHandler | Baixa parcial | FEATURE_MFE_AR | — |
| ACCOUNT_RECEIVABLE_OVERDUE | ERP | FINANCEIRO | FinancialReceivableHandler | Vencido | FEATURE_MFE_AR | — |
| ACCOUNT_RECEIVABLE_RENEGOTIATED | ERP | FINANCEIRO | FinancialReceivableHandler | Renegociado | FEATURE_MFE_AR | — |

Aliases PT: `VENDA_*` · `TITULO_AR_*` · `PRESTACAO_RECEBIDA`

---

## Contas a Pagar / Compras (MFE-06)

| Evento | Origem | Contexto | Handler | Resultado | Flag | Consumidores |
|--------|--------|----------|---------|-----------|------|--------------|
| PURCHASE_CONFIRMED | Compras | ERP | FinancialPayableHandler | Cria AP | FEATURE_MFE_AP | `compras.js` / `PurchasePayableBridge` |
| PURCHASE_CANCELLED | Compras | ERP | FinancialPayableHandler | Cancela AP | FEATURE_MFE_AP | Bridge |
| ACCOUNT_PAYABLE_CREATED | ERP/Compras | FINANCEIRO | FinancialPayableHandler | Cria título AP | FEATURE_MFE_AP | Gateway / Bridge |
| ACCOUNT_PAYABLE_UPDATED | ERP | FINANCEIRO | FinancialPayableHandler | Atualiza AP | FEATURE_MFE_AP | — |
| ACCOUNT_PAYABLE_CANCELLED | ERP | FINANCEIRO | FinancialPayableHandler | Cancela AP | FEATURE_MFE_AP | — |
| ACCOUNT_PAYABLE_SETTLED | ERP | FINANCEIRO | FinancialPayableHandler | Liquida AP | FEATURE_MFE_AP | — |
| ACCOUNT_PAYABLE_PARTIAL | ERP | FINANCEIRO | FinancialPayableHandler | Baixa parcial | FEATURE_MFE_AP | — |
| ACCOUNT_PAYABLE_OVERDUE | ERP | FINANCEIRO | FinancialPayableHandler | Vencido | FEATURE_MFE_AP | — |
| ACCOUNT_PAYABLE_RENEGOTIATED | ERP | FINANCEIRO | FinancialPayableHandler | Renegociado | FEATURE_MFE_AP | — |

Aliases PT: `TITULO_AP_*`

---

## Liquidação Financeira (MFE-07)

| Evento | Meio Financeiro | Origem | Handler | Título afetado | Resultado | Flag |
|--------|-----------------|--------|---------|----------------|-----------|------|
| PAYMENT_SETTLED | OUTRO / informado | Gateway | FinancialSettlementHandler | titleId | Liquida título | FEATURE_MFE_SETTLEMENT |
| PIX_SETTLED | PIX | Gateway.publicarPix | FinancialSettlementHandler | titleId | Liquidação PIX | FEATURE_MFE_SETTLEMENT |
| TEF_SETTLED | TEF | Gateway.publicarTef | FinancialSettlementHandler | titleId | Liquidação TEF | FEATURE_MFE_SETTLEMENT |
| CASH_SETTLED | DINHEIRO | Gateway.publicarDinheiro | FinancialSettlementHandler | titleId | Liquidação dinheiro | FEATURE_MFE_SETTLEMENT |
| CARD_SETTLED | CARTAO_CREDITO / DEBITO | Gateway.publicarCartao* | FinancialSettlementHandler | titleId | Liquidação cartão | FEATURE_MFE_SETTLEMENT |
| CHECK_SETTLED | CHEQUE | Gateway.publicarCheque | FinancialSettlementHandler | titleId | Liquidação cheque | FEATURE_MFE_SETTLEMENT |
| BANK_TRANSFER_SETTLED | TRANSFERENCIA | Gateway.publicarTransferencia | FinancialSettlementHandler | titleId | Liquidação transferência | FEATURE_MFE_SETTLEMENT |
| BOLETO_SETTLED | BOLETO | Gateway.publicarBoleto | FinancialSettlementHandler | titleId | Liquidação boleto | FEATURE_MFE_SETTLEMENT |
| PAYMENT_REVERSED | (original) | Gateway | FinancialSettlementHandler | titleId | Estorno liquidação | FEATURE_MFE_SETTLEMENT |
| PAYMENT_FAILED | (original) | Gateway | FinancialSettlementHandler | titleId | Falha liquidação | FEATURE_MFE_SETTLEMENT |

Aliases PT: `LIQUIDACAO_REALIZADA` · `PIX_LIQUIDADO` · `TEF_LIQUIDADO` · `DINHEIRO_LIQUIDADO` · `CARTAO_LIQUIDADO` · `CHEQUE_LIQUIDADO` · `TRANSFERENCIA_LIQUIDADA` · `BOLETO_LIQUIDADO` · `LIQUIDACAO_ESTORNADA` · `LIQUIDACAO_FALHOU`

Eventos legados de captura (`PIX_RECEIVED` · `TEF_APPROVED`) permanecem no catálogo para SDKs futuros — a **liquidação** usa `*_SETTLED`.

---

## Regras

1. Novos eventos exigem ADR + atualização deste catálogo.  
2. Publicação somente via `FinancialGateway` (Regra 3.5).  
3. Liquidação somente via Gateway (Regra 3.7).  
4. Handlers nunca inventam LedgerEntry.  
5. Flags default OFF — sem cutover implícito.
