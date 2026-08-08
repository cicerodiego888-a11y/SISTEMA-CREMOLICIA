# UX-PROD-02 — Separação Definitiva: Venda por Peso × Conversão Física

**Código:** UX-PROD-02  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  

---

## Objetivo

Eliminar a confusão visual/conceitual entre **Venda por Peso (PDV)** e **Conversão Física (MCC)** — somente UX.

---

## Conceitos oficiais

| Conceito | Domínio | Responsabilidade |
|----------|---------|------------------|
| Venda por Peso / Fracionada | PDV | Forma de comercialização no caixa |
| Conversão Física | MCC | Relaciona Unidade Base ↔ Unidade Física do lote |

---

## O que foi implementado

1. Card **Venda no PDV** (badge PDV, ícone loja/caixa) — “Permite Venda Fracionada”  
2. Card **Conversão Física (MCC)** (badge MCC, ícone exchange) — separado por UC no meio  
3. **Glossário rápido** (Base / UC / Física / Venda por Peso)  
4. Tooltips distintos por domínio  
5. Mensagens sem “fator”  
6. Documentação de fluxo operacional  

---

## Fluxo operacional (documental)

```
Produto (cadastro declarativo)
  → Compra / Entrada
  → Conversão Física (lote) — MCC
  → Quantidade Base
  → Motor Estoque
  → Venda (PDV pode usar fracionado OU UC — independente da física)
```

---

## O que NÃO foi alterado

MCC · Estoque · Comercial · Fiscal · MFE · APIs · Banco · regras · F12 · Mobile

---

## Mobile

Paridade futura: documentada em `ROADMAP_REORGANIZACAO_CADASTRO.md` (UX-04).

---

## ADR

**(x) NÃO**
