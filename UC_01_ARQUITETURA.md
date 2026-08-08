# UC-01 — Arquitetura das Unidades de Comercialização

**Código:** UC-01 (+ UC-01.1)  
**Prioridade:** P0  
**Status:** Fundação + Refinamento CORE  
**Data:** 2026-07-17

---

## 1. Objetivo

Criar e consolidar a **fundação oficial** das Unidades de Comercialização:

- 1 Produto
- 1 Unidade Base de Estoque (SSOT)
- N Unidades de Comercialização
- Canais · Prioridade · Padrão · Prep. Conversão por Lote (UC-01.1)

---

## 2. Componentes

### Backend — Motor `unidades-comercializacao`
- Migrations `001` (UC-01) + `002` (UC-01.1)
- Repository / Service / Validator / DTO
- Routes: `/api/produtos/:id/unidades-comercializacao`
- OpenAPI: `openapi-uc01.yaml`

### ERP Desktop
- Conversão Física (flag + destino, sem fator)
- Grade UC-01.1 com canais, prioridade, padrão, lote, ícones/tooltips

### Docs
- `ADR_UNIDADES_COMERCIALIZACAO.md`
- `MODELO_UNIDADES_COMERCIALIZACAO.md`
- `UC_01_1_REFINAMENTO.md`

---

## 3. Fora de escopo (ainda)
Conversão física por lote, Compra, Estoque, PDV, NFC-e, NF-e, movimentação.

---

## 4. Decisão congelada

Unidades de Comercialização são **CORE**.  
Sempre: Um Produto → Uma Unidade Base (SSOT) → N Unidades de Comercialização.
