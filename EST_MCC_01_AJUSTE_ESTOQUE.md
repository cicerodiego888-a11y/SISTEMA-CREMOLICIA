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
O ajuste também recebe o local (`FABRICA` ou `LOJA`) e registra o delta nesse saldo local, sem alterar o saldo do outro local.

---

## Fluxo oficial

```
Operador
  → Tela Ajuste Estoque
  → Local do estoque (Fábrica / Loja)
  → EstoqueAdjustmentOrchestrator
  → MCC
  → Motor Estoque (saldo geral + saldo do local selecionado)
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
| Saldo por local | `backend/motores/motor-estoque/repositories/SaldoLocalRepository.js` |
| Local na movimentação | `backend/motores/motor-estoque/migrations/003_estoque_movimentacao_local.js` |
| Testes | `backend/motores/motor-conversao-comercial/tests/est-mcc01.test.js` |

---

## APIs

| Método | Path | Função |
|--------|------|--------|
| GET | `/api/produtos/:id/ajuste-estoque/unidades` | Combo dinâmico (base + UC + física) |
| POST | `/api/produtos/:id/ajuste-estoque/preview` | Preview informado → base → saldo final do local selecionado |
| POST | `/api/produtos/:id/ajustar-estoque` | `local` (`FABRICA` / `LOJA`); com `unidade_origem` → MCC; sem → legado (base) |

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
9. O ajuste valida o saldo fiscal e não fiscal do local selecionado e registra a movimentação nesse local.
10. A confirmação fica desabilitada enquanto a solicitação está em andamento para evitar clique duplo.
11. O seletor abre em Loja para preservar a interpretação legada; escolha Fábrica ao registrar saldo nesse local.
12. Cada confirmação recebe um identificador de solicitação reutilizado em reenvios; uma solicitação já aplicada não duplica saldo, movimento, histórico ou auditoria.

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
