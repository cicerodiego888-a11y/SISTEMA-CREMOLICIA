# ROADMAP_MFE — Motor Financeiro Enterprise

**Sprint referência:** MFE-07 Liquidação Financeira  
**Data:** 2026-07-18  
**Status atual:** Gateway + Caixa + AR + AP + **Settlement** (flags OFF) — legado intacto

---

## Fase 0 — Visão

| Entrega | Status |
|---------|--------|
| `MFE_VISAO_ENTERPRISE.md` | Feito |
| `ADR_MOTOR_FINANCEIRO.md` | Feito |
| `DIAGRAMA_MFE.md` | Feito |
| Integração CORE / GOVERNANCE | Feito |

---

## Fase 1 — Fundação do motor (MFE-01) — FEITO

| Entrega | Status |
|---------|--------|
| Pacote `backend/motores/motor-financeiro/` | Feito |
| Contratos `IFinancial*` | Feito |
| Schema ledger / events / outbox / audit | Feito |
| Feature flags default OFF | Feito |
| Testes `npm run test:mfe01` | Feito |
| Docs `MFE_01_FUNDACAO.md` · `AUDITORIA_MFE01.md` | Feito |

---

## Fase 1.5 — Pipeline de eventos (MFE-02) — FEITO

| Entrega | Status |
|---------|--------|
| `FinancialEventPipeline` | Feito |
| Dispatcher + handlers vazios | Feito |
| Ledger somente via pipeline | Feito |
| Idempotência / Dead Letter / Outbox | Feito |
| `npm run test:mfe02` | Feito |

---

## Fase 1.6 — Ledger Operacional (MFE-03) — FEITO

| Entrega | Status |
|---------|--------|
| `FinancialLedgerService` | Feito |
| Auto-lançamentos por evento | Feito |
| Tipos/natureza oficiais | Feito |
| Outbox por LedgerEntry | Feito |
| `npm run test:mfe03` | Feito |

---

## Fase 1.7 — Modelo Financeiro Unificado (MFE-03 Modelo) — FEITO

| Entrega | Status |
|---------|--------|
| `FinancialOperation` / `FinancialEntry` / `FinancialDocument` / `FinancialAllocation` | Feito |
| Catálogo EN + aliases PT | Feito |
| `OrigemFinanceira` / `MeioFinanceiro` / `FinancialOperationType` | Feito |
| Trilha auditoria (operationId/correlation/trace/event/idempotency) | Feito |
| ADR `ADR_MODELO_FINANCEIRO.md` | Feito |
| `npm run test:mfe03modelo` | Feito |
| Consumidores legados | Intactos |

---

## Fase 2 — Caixa + eventos núcleo — FEITO (piloto MFE-04)

| Entrega | Status |
|---------|--------|
| `FinancialCashHandler` | Feito |
| `CashOrchestrator` + adapter `publicarEventoCaixaMfe` | Feito |
| Eventos CASH_* / CAIXA_* | Feito |
| `FEATURE_MFE_CAIXA` default OFF | Feito |
| Ponte `rotas/caixa.js` (dual-path) | Feito |
| `npm run test:mfe04` | Feito |
| Cutover definitivo | ⏳ futuro |

---

## Fase 3 — AR / AP — PARCIAL (MFE-05 + MFE-05.1)

| Entrega | Status |
|---------|--------|
| `FinancialReceivableHandler` | Feito |
| `ReceivableOrchestrator` + `publicarEventoArMfe` | Feito |
| Eventos ACCOUNT_RECEIVABLE_* | Feito |
| `FinancialInstallment` | Feito (infra) |
| `FEATURE_MFE_AR` default OFF | Feito |
| Ponte `contas_receber.js` (pagamento) | Feito |
| `npm run test:mfe05` | Feito |
| Bridge PDV → AR (`PdvArBridge`) | Feito (MFE-05.1) |
| Bridge Comercial → AR (`ComercialArBridge`) | Feito (MFE-05.1) |
| `FEATURE_MFE_PDV_AR` / `FEATURE_MFE_COMERCIAL_AR` OFF | Feito |
| Wire PDV + `FinanceiroPlatformGateway` | Feito |
| `npm run test:mfe051` | Feito |
| Contas a Pagar (AP) | Feito (MFE-06 piloto) |
| Cutover definitivo bridges / AP | ⏳ futuro |

---

## Fase 3.1 — FinancialGateway (MFE-05.2) — FEITO

| Entrega | Status |
|---------|--------|
| `FinancialGateway` (porta pública oficial) | Feito |
| Métodos `publicar*` (venda, caixa, AR, AP, PIX, TEF, …) | Feito |
| Bridges / Orchestrators → Gateway | Feito |
| Context resolvido pelo Gateway | Feito |
| Regra 3.5 GOVERNANCE + CORE_SERVICES | Feito |
| `npm run test:mfe052` | Feito |

---

## Fase 3.2 — Contas a Pagar / Compras (MFE-06) — FEITO (piloto)

| Entrega | Status |
|---------|--------|
| `FinancialPayableHandler` | Feito |
| `PurchasePayableBridge` + `publicarEventoCompraApMfe` | Feito |
| Eventos PURCHASE_* + ACCOUNT_PAYABLE_* | Feito |
| `FEATURE_MFE_AP` default OFF | Feito |
| Ponte `compras.js` (`criarFinanceiroCompra`) | Feito |
| `FINANCIAL_EVENTS_CATALOG.md` | Feito |
| `npm run test:mfe06` | Feito |
| Cutover definitivo AP | ⏳ futuro |

---

## Fase 4 — Liquidação Financeira (MFE-07) — FEITO (infra)

| Entrega | Status |
|---------|--------|
| `FinancialSettlement` | Feito |
| `FinancialSettlementHandler` | Feito |
| Eventos `*_SETTLED` / `PAYMENT_REVERSED` / `PAYMENT_FAILED` | Feito |
| Gateway `publicarLiquidacao` + especializações | Feito |
| `FEATURE_MFE_SETTLEMENT` default OFF | Feito |
| `FINANCIAL_EVENTS_CATALOG` atualizado | Feito |
| `npm run test:mfe07` | Feito |
| Integração SDK PIX/TEF | ⏳ futuro |
| Cutover liquidação operacional | ⏳ futuro |

---

## Fase 5 — PDV / PIX / TEF (cutover operacional)

- Cutover flags `FEATURE_MFE_PDV_AR` / `FEATURE_MFE_SETTLEMENT` / `FIN_PIX` / `FIN_TEF`
- Strangler residual em `VendaPagamentoService` / `financeiro`
- SDKs físicos PIX/TEF

---

## Fase 6 — Banco + conciliação + projeção

- `IBankService` · `IReconciliation` · `IProjectionService`
- `FIN_CONCILIACAO`
- Relatórios e fechamento

---

## Princípios de migração (fixos)

1. Legado continua até flag do consumidor.  
2. Nunca big-bang no PDV.  
3. IdempotencyKey obrigatória.  
4. Correção só por compensatório.  
5. Modelo igual ao MCC (inventariar → coexistir → cortar).

---

## Fora do roadmap MFE

- Regras de crédito/consignação (Motor Comercial)  
- Conversão / estoque / fiscal  
- Implementação nesta sprint MFE-00  
