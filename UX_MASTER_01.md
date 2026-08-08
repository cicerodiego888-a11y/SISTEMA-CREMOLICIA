# UX-MASTER-01 — Cadastro Inteligente de Produtos

**Código:** UX-MASTER-01  
**Data:** 2026-07-18  
**Tipo:** Evolução de UX (sem alterar arquitetura CORE)  
**Prioridade:** P0  
**Fonte:** `frontend/erp/js/produtos.js`

---

## Objetivo

Transformar o Cadastro de Produtos em um fluxo inteligente: o sistema decide o máximo possível; o operador vê só o necessário.

Princípio: *Se o sistema consegue descobrir sozinho, não perguntar.*

---

## Caminho feliz (novo produto)

Campos visíveis essenciais:

1. Nome  
2. Categoria  
3. Unidade do Estoque (default UN)  
4. Preço de Venda  
5. Preço de Compra (opcional)  
6. Quantidade Inicial  

Código automático · UC padrão após save · Margem calculada · Fornecedor/Fiscal/Atacado/PDV detalhado sob demanda.

---

## O que mudou (UX)

| Bloco | Antes | Depois |
|-------|--------|--------|
| Resumo | Card denso + jargão | Nome + chip de fase |
| Identificação | Código sempre aberto | Código auto + “Editar código” |
| Unidade | “Unidade Base / SSOT” | “Unidade do Estoque” |
| Física | Card MCC | “Peso do Produto” (switch + referência) |
| UC | Toolbar sempre + cards densos | “Formas de Venda”; toolbar se ≥3; cards mínimos |
| Comercial | Margem editável | Margem auto + “Editar” |
| PDV | Card técnico | Switch “vendido por peso” + progressivo |
| Estoque | Labels técnicos | Quantidade Inicial Fiscal / Não Fiscal |
| Avançado | Glossário + previews | **Removido** |
| Mais opções | — | Fornecedor colapsado |

---

## Inferências (somente UI)

- Código sequencial se vazio no create  
- Unidade do Estoque default `UN`  
- UC `PADRAO` (Base · Venda · PDV) após 1º save se lista vazia  
- Margem a partir de compra/venda  
- Unidade física sugerida por categoria quando “pesado na entrada”  
- Não Fiscal permanece 0 se não informado (lógica oficial F12)  
- `peso_referencia_aproximado` é **somente visual** — **não** entra no payload  

---

## O que NÃO mudou

MCC · UC schema · Motor Estoque · Comercial · Fiscal · MFE · Banco · APIs · Payloads oficiais · Regras de negócio.

Campos persistidos continuam: `utiliza_conversao_fisica`, `unidade_conversao_fisica`, `produto_fracionado`, saldos, preços, fiscal, etc.

---

## Progressive disclosure

| Elemento | Quando aparece |
|----------|----------------|
| Código manual | “Editar código” / edição |
| Subcategoria | Categoria com subcategorias |
| Painel peso | Switch pesado na entrada ON |
| Toolbar UC | ≥ 3 formas |
| Painel PDV unidade | Vendido por peso ON |
| Atacado | Switch ON |
| Validade | Controlar validade ON |
| Fiscal | Collapse |
| Fornecedor | Mais opções |

---

## Smoke (manual)

Produto comum · fracionado · sorvete · com UC · validade · fiscal · sem fiscal · estoque inicial · já movimentado · F12 ON · F12 OFF.

---

## Próxima sprint recomendada

**UX-MASTER-02** — Convergência PDV ← Formas de Venda (inferir flags legadas; reduzir ainda mais o card PDV).
