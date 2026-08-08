# UX-MASTER-01.1 — Formação do Preço

**Código:** UX-MASTER-01.1  
**Data:** 2026-07-18  
**Tipo:** Refinamento de UX (sem alterar regras de negócio)  
**Fonte:** `frontend/erp/js/produtos.js`

---

## Objetivo

Simplificar a linguagem do bloco de formação de preço no Cadastro de Produtos.  
Cálculos, payloads e regras permanecem iguais.

---

## Alterações (somente copy / apresentação)

| Antes | Depois |
|-------|--------|
| Cálculo de custo por quantidade | **Formação do Preço** |
| Valor Total Pago | **Valor Total da Compra** |
| Quantidade Total | **Quantidade Comprada** (+ unidade dinâmica) |
| Fórmula `R$ ÷ qtd = …` | Removida — mostra só **R$ valor** |
| Custo unitário / Custo por Unidade de Venda | **Cada {Unidade} Custou** |
| Margem % | **Lucro Estimado** |
| Preço de Venda | Inalterado |

Unidade dinâmica em “Cada … Custou”: Unidade, Kg, Litro, Grama, etc. (via `#unidade`).

---

## O que NÃO mudou

Fórmulas · eventos · `preco_compra` / `lucro_percentual` · APIs · banco · MCC · Estoque · Comercial · Fiscal · MFE.

---

## Smoke

Produto comum · por peso · por litro · por caixa/UN · por pacote — validar rótulo dinâmico.

---

## Próxima sprint recomendada

**UX-MASTER-02** — limpeza de copy na Compra / Ajuste (MCC/UC), alinhada a UX-ENTERPRISE-01.
