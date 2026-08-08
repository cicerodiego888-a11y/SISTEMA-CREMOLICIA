# UC-01.1 — Refinamento da Arquitetura das Unidades de Comercialização

**Código:** UC-01.1  
**Prioridade:** P0  
**Tipo:** Refinamento Arquitetural (Foundation)  
**Status:** Implementado  
**Data:** 2026-07-17

---

## Objetivo

Consolidar a UC-01 como componente **CORE**, preparando canais, prioridade, unidade padrão e conversão por lote (flag) para Compras, Estoque, PDV, NFC-e, NF-e, Comercial e Motor Financeiro — **sem** implementar conversão física por lote nesta sprint.

---

## Entregas

### 1. Canal de Comercialização
JSON `canais_comercializacao` por unidade:
`compra`, `venda_erp`, `venda_atacado`, `venda_varejo`, `pdv`, `nfce`, `nfe`, `comercial`, `orcamento`

Flags UC-01 `permite_compra/venda/pdv` sincronizados automaticamente (compatibilidade).

### 2. Prioridade
Campo inteiro `prioridade` — única por produto. Ordena combos e preferência operacional.

### 3. Unidade Comercial Padrão
`unidade_padrao` 0/1 — no máximo uma por produto (limpeza automática da anterior).

### 4. Conversão por Lote (prep. UC-02)
`conversao_por_lote` 0/1 — **sem efeito operacional** nesta sprint.

### 5. Tipos
`PADRAO` · `AGRUPAMENTO` · `FRACIONAMENTO` · `CONVERSAO_FISICA`  
Ícones: ⭐ 📦 ✂️ ⚖️ + tooltips na UI.

### 6. Auditorias
- Quantidade > 0  
- Prioridade única no produto  
- Unidade Comercial ≠ Base quando Tipo ≠ PADRÃO  
- Tipo PADRÃO ⇒ quantidade = 1  

### 7. UX ERP
Grade ampliada com canais, prioridade, padrão, lote; modal com checkboxes de canal e tooltips de tipo.

### 8. API / DTO / OpenAPI
- DTO `toUnidadeComercialDTO`
- Validações no service
- Spec: `backend/motores/unidades-comercializacao/openapi-uc01.yaml`
- Rotas existentes mantidas (`/unidades-comercializacao`)

### 9. Banco (compat UC-01)
Colunas novas em `produto_unidades_comercializacao`:
`prioridade`, `unidade_padrao`, `conversao_por_lote`, `canais_comercializacao`

Migration: `002_uc01_1_refinamento.js` (backfill de canais a partir de `permite_*`).

---

## Não implementado (proposital)
Conversão física, Compra, Estoque, PDV, NFC-e, NF-e, conversão automática, baixa de estoque.

---

## Critérios de aceite

- [x] Canais de comercialização
- [x] Prioridade
- [x] Unidade padrão
- [x] Flag conversão por lote (prep.)
- [x] Auditorias de consistência
- [x] Sem quebra de estoque / módulos operacionais
- [x] Documentação atualizada

---

## Decisão oficial

Unidades de Comercialização são CORE. Cada unidade possui Tipo, Canais, Prioridade, Padrão e preparação para Conversão por Lote, sempre sob:

> Um Produto → Uma Unidade Base (SSOT) → N Unidades de Comercialização.
