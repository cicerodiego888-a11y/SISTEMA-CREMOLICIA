# UX-PROD-03 — Cadastro Enterprise por Domínios

**Código:** UX-PROD-03  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  

---

## Objetivo

Reorganizar o Cadastro de Produtos no fluxo mental do operador, por domínios — **somente UX**. Abas ficam para UX-PROD-04.

---

## Ordem oficial (vertical)

1. Resumo Inteligente (somente leitura)  
2. Identificação  
3. Unidade Base  
4. Conversão Física (MCC)  
5. Unidades de Comercialização  
6. Comercial  
7. Venda no PDV  
8. Estoque  
9. Fiscal  
10. Avançado  

---

## Resumo Inteligente

Exibe: nome, Unidade Base, Conversão Física, UCs, status MCC.  
Atualiza ao mudar nome/unidade/física/grade UC. Não edita dados.

---

## O que NÃO foi alterado

Banco · APIs · MCC · Estoque · Comercial · Fiscal · MFE · F7 · regras · IDs de campos

Campos inexistentes (marca, imagem, estoque máximo, descrição reduzida) **não** foram inventados.

---

## ADR

**(x) NÃO**
