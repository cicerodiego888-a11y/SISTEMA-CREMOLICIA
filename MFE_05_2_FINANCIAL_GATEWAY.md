# MFE-05.2 — FinancialGateway (Facade Oficial)

**Código:** MFE-05.2  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-18  

---

## Objetivo

Criar o `FinancialGateway` como **única porta pública oficial** do Motor Financeiro Enterprise.

Módulos da Plataforma CDS **não** devem conhecer Pipeline, EventPublisher, Handlers, Ledger, Outbox ou Dead Letter.

---

## Arquitetura

```
Módulo / Bridge / Orchestrator
        ↓
  FinancialGateway
        ↓
     Pipeline
        ↓
      Ledger
        ↓
     Handlers
```

---

## Interface pública

| Método | Uso |
|--------|-----|
| `publicar()` | Genérico |
| `publicarVenda()` | Vendas |
| `publicarPagamento()` | Pagamentos |
| `publicarRecebimento()` | Recebimentos |
| `publicarCreditoComercial()` | Crédito comercial |
| `publicarCaixa()` | Caixa |
| `publicarPix()` | PIX (preparado) |
| `publicarTef()` | TEF (preparado) |
| `publicarCompra()` | Compras (preparado) |
| `publicarContaReceber()` | AR |
| `publicarContaPagar()` | AP (preparado) |

Pacote: `backend/motores/motor-financeiro/gateway/FinancialGateway.js`

---

## Responsabilidades

Validar → Normalizar → Enriquecer `FinancialContext` → Enviar ao Pipeline.

- Nunca executa regra financeira  
- Nunca gera Ledger  
- Nunca conhece Handlers  

`FinancialContext` é **resolvido pelo Gateway** (módulos não definem).

---

## Bridges / Orchestrators

Mantidos como **adaptadores temporários**:

```
Bridge / Orchestrator → FinancialGateway → Pipeline
```

Flags inalteradas: `FEATURE_MFE_CAIXA` · `FEATURE_MFE_AR` · `FEATURE_MFE_PDV_AR` · `FEATURE_MFE_COMERCIAL_AR`

---

## Governança

Regra **3.5** — FinancialGateway é a única interface pública do MFE.

---

## Testes

```
npm run test:mfe052
```

---

## ADR

`ADR_FINANCIAL_GATEWAY.md`
