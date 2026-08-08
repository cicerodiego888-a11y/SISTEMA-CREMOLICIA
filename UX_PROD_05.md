# UX-PROD-05 — Redesign Enterprise da Grade de Unidades de Comercialização

**Código:** UX-PROD-05  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  

---

## Objetivo

Substituir a tabela técnica de UC por **cards de formas de comercialização** — somente UX. Sem alterar regras, APIs ou MCC.

---

## Layout

Cada UC é um card (grid desktop / coluna mobile) com:

- Nome + ícone de tipo (📦 ✂ ⚖ ⭐)
- Resumo quantidade ↔ Unidade Base
- Tipo, prioridade, status Ativo/Inativo
- Canais resumidos: 🛒 Compra · 🏪 Venda · 💳 PDV
- Badge ⭐ Padrão quando aplicável
- **▼ Mais detalhes** (IDs, flags, canais completos)
- Ações: Editar · Duplicar · Desativar/Ativar · Excluir

---

## Ordenação

1. Unidade Padrão  
2. Prioridade  
3. Nome  

---

## Filtros e pesquisa

Filtros: Todos · Compra · Venda · PDV · Ativos · Inativos  
Pesquisa: nome, tipo, unidade  

---

## O que NÃO foi alterado

MCC · Estoque · Comercial · Fiscal · MFE · APIs · Banco · conversões · payloads CRUD

Duplicar = abre editor pré-preenchido (POST novo).  
Desativar = PUT `ativo` existente.

---

## Enterprise Ready

Após esta sprint, o Cadastro de Produtos fica **congelado** para reorganização estrutural geral.  
Mudanças futuras: correções, melhorias pontuais ou novas funcionalidades de negócio.

---

## ADR

**(x) NÃO**
