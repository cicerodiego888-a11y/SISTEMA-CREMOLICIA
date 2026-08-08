# MFE-03 — Modelo Financeiro Unificado (SSOT Financeiro)

**Código:** MFE-03 (Modelo)  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  
**Nota:** Complementa o MFE-03 Ledger Operacional — domínio SSOT unificado.

---

## Objetivo

Criar o **Modelo Financeiro Unificado** do MFE.

Após esta sprint:

- Nenhum módulo deve criar lançamentos financeiros diretamente.  
- Todos geram **Eventos Financeiros**.  
- O MFE é o único responsável por produzir lançamentos oficiais.

---

## Princípio

```
Módulo → Evento Financeiro → Pipeline MFE → Ledger → Outbox → Consumidores
```

**Proibido:** Módulo → Ledger

---

## Entidades oficiais

| Entidade | Papel |
|----------|-------|
| `FinancialOperation` | Operação financeira (VENDA, PIX, …) |
| `FinancialEntry` | Linha do modelo unificado (mapeia → `FinancialLedgerEntry`) |
| `FinancialDocument` | Documento de origem (Venda, NFCe, Compra, …) |
| `FinancialAllocation` | Rateio — infraestrutura sem regras |

---

## Catálogos

### Eventos oficiais (EN)

SALE_COMPLETED · SALE_CANCELLED · PAYMENT_RECEIVED · PAYMENT_CANCELLED ·  
PURCHASE_CONFIRMED · PURCHASE_CANCELLED ·  
ACCOUNT_RECEIVABLE_CREATED · ACCOUNT_RECEIVABLE_SETTLED ·  
ACCOUNT_PAYABLE_CREATED · ACCOUNT_PAYABLE_SETTLED ·  
PIX_RECEIVED · PIX_SENT · TEF_APPROVED · TEF_CANCELLED ·  
CASH_OPENED · CASH_CLOSED ·  
STOCK_ADJUSTMENT_FINANCIAL · COMMERCIAL_CREDIT_GENERATED · COMMERCIAL_CREDIT_USED  

Aliases PT legados (VENDA_RECEBIDA, …) preservados para o pipeline.

### Origens

PDV · ERP · COMERCIAL · ESTOQUE · FISCAL · MFE · API · IMPORTACAO · INTEGRACAO  
(+ aliases COMPRA / TEF / PIX / SISTEMA / OUTROS)

### Meios financeiros (enum preparado)

DINHEIRO · PIX · TEF · CARTAO_CREDITO · CARTAO_DEBITO · BOLETO · CHEQUE ·  
TRANSFERENCIA · CREDITO_COMERCIAL · OUTRO  

### FinancialOperationType

VENDA · DEVOLUCAO · PAGAMENTO · RECEBIMENTO · TRANSFERENCIA · AJUSTE ·  
ABERTURA_CAIXA · FECHAMENTO_CAIXA · PIX · TEF · DINHEIRO · CHEQUE · BOLETO · CARTAO  

---

## Auditoria obrigatória

Toda operação carrega:

`operationId` · `correlationId` · `traceId` · `eventId` · `idempotencyKey`

Helper: `FinancialAuditTrail.criarTrilhaAuditoriaFinanceira`

---

## O que NÃO foi feito

Caixa · Bancos · AR · AP · PIX/TEF operacionais · PDV · Comercial · regras de rateio

---

## Testes

```
npm run test:mfe03modelo
npm run test:mfe
```

---

## ADR

`ADR_MODELO_FINANCEIRO.md`
