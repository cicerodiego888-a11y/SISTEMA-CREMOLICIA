# RCM-9.0.4 — Padronização do uso de Nullish Coalescing (`??`)

**Data:** 2026-08-07  
**Escopo:** limpeza técnica (sintaxe) — Frontend + Backend  
**Não altera:** regras de negócio, arquitetura, comportamento funcional intencional, UX visual.

---

## Objetivo

Eliminar misturas **inválidas** entre `??` e `||` / `&&` (erro ECMAScript / V8: `SyntaxError: missing ) after argument list`) e padronizar fallbacks numéricos com cadeia `??`.

---

## Varredura

| Métrica | Valor |
|--------|------:|
| Arquivos JS varridos (`frontend/`, `backend/`, `scripts/`, electron\*.js) | **1652** |
| Falhas de sintaxe (`node --check`) após correção | **0** |
| Misturas **inválidas** (`??` + `\|\|`/`&&` sem agrupamento) encontradas | **2** (mesmo arquivo) |
| Misturas inválidas corrigidas | **2** |
| Padronizações adicionais `(a ?? b) \|\| 0` → `a ?? b ?? 0` | **2** |
| Bundle gerado (`motor-comercial.bundle.js`) | **não editado** (fonte sim; regenerar no release se necessário) |

---

## Arquivo corrigido

### `frontend/erp/js/linhas-comerciais.js`

**Problema (inválido):**

```javascript
Number(deps.produtos ?? diag.produtos_vinculados || 0)
Number(deps.tabelas ?? diag.tabelas_com_preco || 0)
```

Mistura de `??` com `||` **sem parênteses** → `SyntaxError`.

**Correção intermediária (sintaxe válida):**

```javascript
Number((deps.produtos ?? diag.produtos_vinculados) || 0)
```

**Padronização final (RCM-9.0.4):**

```javascript
Number(deps.produtos ?? diag.produtos_vinculados ?? 0)
Number(deps.tabelas ?? diag.tabelas_com_preco ?? 0)
```

Linhas: **319–320**.  
Verificação: `node --check frontend/erp/js/linhas-comerciais.js` → OK.

---

## Padrões analisados e **mantidos** (comportamento intencional)

Não foram convertidos automaticamente os casos em que `||` / `&&` **não** formam mistura inválida com `??`, ou em que a troca por só `??` **mudaria** o significado (falsy vs nullish):

| Padrão | Exemplo | Motivo de manter |
|--------|---------|------------------|
| `Number(x ?? 0) \|\| ''` | `produtos.js` (peso/preço unidade) | `0` vira campo vazio no form |
| `Number(x ?? 0) \|\| null` | MIIP / Conta Corrente | `0` tratado como “sem id/qtd” |
| `Number(x ?? 90) \|\| 90` | Central Entradas | `0` rejeitado de propósito |
| `a ?? (b \|\| c)` | compras, financeiro, estoque | `\|\|` já agrupado à direita |
| `fn(a \|\| b) ?? c` | prioridade, mappers | `\|\|` dentro de chamada |
| `a ?? items.filter(x \|\| y)` | Consignações | `\|\|` no callback, não na cadeia |
| `?.` + `\|\|` | amplo no ERP | optional chaining ≠ nullish |

Esses padrões são **sintaticamente válidos** e passaram no `node --check` global.

---

## Confirmação de não alteração de comportamento

- A única correção de **erro de sintaxe** restabelece código que **não executava** no browser.
- A padronização final em `linhas-comerciais.js` usa cadeia `??` sobre contadores numéricos (`produtos` / `tabelas`), onde `null`/`undefined` devem cair em `0` e `0` permanece `0`.
- Nenhum fluxo comercial, fiscal, estoque, PDV ou precificação foi alterado em regra.
- Nenhuma mudança de arquitetura certificada do Motor Comercial.

---

## Critérios de aceite

| Critério | Status |
|----------|--------|
| Nenhum erro de sintaxe JavaScript no escopo | ✅ 1652 arquivos / 0 falhas |
| Nenhuma mistura inválida `??` + `\|\|`/`&&` | ✅ |
| Código padronizado nos pontos corrigidos | ✅ |
| `node --check` nos arquivos alterados | ✅ |
| Sem alteração funcional intencional | ✅ |
| Sem alteração visual deliberada | ✅ |
| Sem alteração de arquitetura | ✅ |

---

## Como evitar regressão

1. Preferir sempre: `valorA ?? valorB ?? 0`
2. Nunca escrever: `valorA ?? valorB \|\| 0` sem parênteses
3. Se precisar de fallback **falsy** (`0`, `''`, `false`), documentar e usar parênteses explícitos: `(a ?? b) \|\| fallback`
4. Não confundir `?.` (optional chaining) com `??` (nullish coalescing)

---

## Comandos de verificação

```bash
node --check frontend/erp/js/linhas-comerciais.js
```

Varredura completa realizada em 2026-08-07: **1652** arquivos JS com `node --check` → **0** falhas.
