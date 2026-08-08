# RELATÓRIO — UX-MASTER-01

**Código:** RELATORIO_UX_MASTER01  
**Data:** 2026-07-18  
**Sprint:** UX-MASTER-01 — Cadastro Inteligente de Produtos

---

## Objetivo

Simplificar radicalmente a UX do Cadastro de Produtos sem alterar a arquitetura CORE.

---

## O que foi alterado

- `frontend/erp/js/produtos.js` — modal, cards UC, inferências, progressive disclosure, copy  
- Documentação: `UX_MASTER_01.md`, `AUDITORIA_UX_MASTER01.md`, `RELATORIO_UX_MASTER01.md`, `ROADMAP_UX.md`, `CHECKLIST_UX.md`, `CHANGELOG.md`

---

## O que NÃO foi alterado

MCC · UC (domínio/DB) · Motor Estoque · Motor Comercial · Fiscal · MFE · Banco · APIs · Payloads · Regras de negócio.

---

## Cards removidos

- **9 · Avançado** (glossário + previews)

## Cards simplificados

- Resumo → linha mínima  
- Conversão Física (MCC) → **Peso do Produto**  
- Unidades de Comercialização → **Formas de Venda** (cards enxutos)  
- Venda no PDV → switch mínimo  
- Unidade Base → **Unidade do Estoque**

## Campos automáticos

- Código (create)  
- UC padrão pós-save  
- Margem %  
- Unidade física sugerida por categoria  
- Default Unidade do Estoque = UN  

## Campos ocultos / progressive

- Código manual, Subcategoria, Fornecedor, Toolbar UC, detalhes PDV, Atacado, Validade, Fiscal, painel peso

## Progressive Disclosure

Implementado conforme `UX_MASTER_01.md`.

## Compatibilidade

IDs de formulário e payload preservados (`utiliza_conversao_fisica`, `produto_fracionado`, saldos, etc.).

## Testes

- `node --check frontend/erp/js/produtos.js` — OK  
- Smoke manual — checklist em `CHECKLIST_UX.md`

## Smoke

Produto comum · fracionado · sorvete · UC · validade · fiscal · F12 ON/OFF · estoque inicial · movimentado.

## Documentação

Criados/atualizados os artefatos listados acima.

## Changelog

Entrada `[UX-MASTER-01]` em `CHANGELOG.md`.

## Próxima Sprint recomendada

**UX-MASTER-02** — PDV consome Formas de Venda; reduzir flags legadas na UI.

## Arquitetura

**ADR?** (x) NÃO  
( ) SIM
