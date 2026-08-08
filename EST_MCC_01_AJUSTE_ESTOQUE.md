# EST-MCC-01 — Integração do Ajuste de Estoque com o MCC

**Código:** EST-MCC-01  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  
**Sprint UX:** UX-PROD-01 (combo + preview na UI)

---

## Objetivo

Permitir que o operador ajuste estoque em qualquer Unidade de Comercialização válida do produto.  
Toda conversão passa pelo MCC. O Motor de Estoque recebe **somente** quantidade na Unidade Base.

---

## Fluxo oficial

```
Operador
  → Tela Ajuste Estoque
  → EstoqueAdjustmentOrchestrator
  → MCC
  → Motor Estoque
  → Movimentação
```

---

## Componentes

| Camada | Arquivo |
|--------|---------|
| Orchestrator | `backend/motores/motor-conversao-comercial/integracao/estoque/EstoqueAdjustmentOrchestrator.js` |
| Operacional | `.../EstoqueAdjustmentOperacionalService.js` |
| Rotas | `backend/rotas/produtos.js` |
| UI | `frontend/erp/js/produtos.js` (`abrirModalAjustarEstoque`) |
| Testes | `backend/motores/motor-conversao-comercial/tests/est-mcc01.test.js` |

---

## APIs

| Método | Path | Função |
|--------|------|--------|
| GET | `/api/produtos/:id/ajuste-estoque/unidades` | Combo dinâmico (base + UC + física) |
| POST | `/api/produtos/:id/ajuste-estoque/preview` | Preview informado → base → saldo final |
| POST | `/api/produtos/:id/ajustar-estoque` | Com `unidade_origem` → MCC; sem → legado (base) |

---

## Regras

1. UI **não** converte — apenas exibe preview do backend.  
2. Combo **nunca** hardcode — vem do MCC/UC-01.  
3. Conversão Física: mostra Base + Kg (ou unidade física); **nunca** fator.  
4. Ajuste em unidade física exige conversão ativa no lote.  
5. F12: só fiscal; F12 OFF: fiscal + não fiscal.  
6. F7 na Compra: **inalterado**.  
7. Produtos legados (sem UC): unidade base apenas.  
8. Estoque inicial editável só sem movimentações; depois somente leitura.

---

## Contexto MCC

`ContextoConversao.AJUSTE_ESTOQUE`

---

## Critérios de aceite

- [x] Ajuste usa MCC  
- [x] Combo dinâmico  
- [x] Preview  
- [x] Motor Estoque só Unidade Base  
- [x] Sem conversão na UI  
- [x] F12 preservado  
- [x] F7 preservado (Compra)  
- [x] Legado compatível  
- [x] Testes `npm run test:est-mcc01`  

---

## ADR

**( ) NÃO** — não foi necessário novo ADR.  
Reutiliza ARCH CORE (MCC + Motor Estoque) e padrão dos orchestrators PDV/Compra.
