# UX-PROD-03.1 — Fluxo Oficial de Implantação do Produto

**Código:** UX-PROD-03.1  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  

---

## Objetivo

Consolidar o fluxo **Implantação × Operação** no Cadastro de Produtos — somente UX e preparação de infraestrutura. Sem alterar motores nem regras do MCC.

---

## Conceito oficial — duas fases

| Fase | Condição | Comportamento |
|------|----------|---------------|
| **1 — Implantação** | Sem movimentações | Estoque Inicial Fiscal / NF (F12 OFF) editáveis; Conversão Física Inicial quando aplicável |
| **2 — Operação** | Com movimentações | Campos de implantação **somente leitura**; alterações via Ajuste de Estoque / Inventário / Compra |

---

## Campos de implantação (identificados)

| ID | Domínio |
|----|---------|
| `saldo_fiscal_inicial` | Estoque inicial |
| `saldo_nao_fiscal_inicial` | Estoque inicial (F12 OFF) |
| `peso_fisico_inicial_fiscal` | Conversão Física Inicial (UI) |
| `peso_fisico_inicial_nao_fiscal` | Conversão Física Inicial (UI, F12 OFF) |
| `data_validade_inicial` | Lote / validade inicial |
| `dias_alerta_validade` | Alerta de validade |

Marcados com `data-campo-implantacao="1"`. Lista em `CAMPOS_IMPLANTACAO_PRODUTO`.

---

## Infraestrutura de bloqueio (preparada)

- `avaliarFaseCadastroProduto(isEdit, temMovimentacoes)` → `{ fase, label, camposImplantacaoSomenteLeitura, campos }`
- `prepararBloqueioImplantacaoProduto(meta)` → metadados no modal (`data-fase-cadastro`) + UI
- Banners **Fase 1 / Fase 2** no domínio Estoque
- Badge de fase no Resumo Inteligente

A lógica definitiva de travar **todos** os campos de implantação permanece para sprint futura; saldos iniciais já respeitam somente leitura após a 1ª movimentação (comportamento pré-existente preservado).

---

## Conversão Física do Estoque Inicial

Exibida quando:

- ☑ Utiliza Conversão Física  
- Estoque Inicial > 0  
- Fase Implantação  

Pede **peso** correspondente ao estoque inicial.  
**Nunca** pede/mostra fator.  
Persistência do lote inicial = sprint posterior (inputs disabled).

---

## Ajuste de Estoque

Mensagem oficial na Fase Operação:

> Após a implantação, alterações de estoque devem ser realizadas pelo módulo **Ajuste de Estoque**.

---

## F12 / F7

- F12 ON → somente Fiscal  
- F12 OFF → Fiscal + Não Fiscal  
- F7 → inalterado  

---

## O que NÃO foi alterado

MCC · Motor Estoque · Comercial · Fiscal · Financeiro · APIs · Banco · regras de negócio

---

## ADR

**(x) NÃO**
