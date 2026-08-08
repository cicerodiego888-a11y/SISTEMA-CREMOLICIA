# AUDITORIA RCM-05.2 — Produto × Tabelas de Preço

**Tipo:** Diagnóstico arquitetural (somente leitura)  
**Data:** 2026-07-30  
**Escopo:** Motor Comercial V2 — sem alteração de regra, banco, API ou telas  

---

## Veredito

| Pergunta | Resposta |
|----------|----------|
| Um produto pode participar oficialmente de **várias** `tabelas_preco` ao mesmo tempo? | **Não** |
| Um produto pode ter preços distintos Varejo / Atacado / Evento? | **Sim** — via **canais** na **mesma** tabela |
| Complexidade para evoluir a N:N real | **Alta** |

Há **dependência estrutural** em `produtos.tabela_preco_id` (N:1). Não existe junction produto↔tabela.

---

## 1. Banco de Dados

### Tabelas do Motor Comercial

| Tabela | Papel |
|--------|-------|
| `canais_venda` | Canais (seed: VAREJO, ATACADO, EVENTO) |
| `tabelas_preco` | Cadastro de tabelas |
| `tabela_preco_valores` | Preço (+ forma/unidade RCM-05.1) por **Tabela × Canal** |
| `produtos` | Contém `tabela_preco_id` opcional |

Fonte: `backend/modules/comercial/migrations/001_canais_tabelas_preco.js` (+ 002 forma no produto, 003 config atacado, 004 forma por canal nos valores).

### `produtos.tabela_preco_id`

| Aspecto | Situação |
|---------|----------|
| Existe? | **Sim** (migration 001 + `backend/database.js`) |
| Obrigatório? | **Não** (nullable) |
| Legado puro? | **Não** — é a **ponte oficial** V2 |
| Fallback | Sem tabela / sem valor do canal → `produto.preco_venda` |
| Ainda utilizado? | **Sim** — resolver, CRUD produto, PDV, exclusão de tabela, diagnóstico, gateways |
| UNIQUE? | **Não** — vários produtos → uma tabela |

### Junction N:N?

**Não existe.** `tabela_preco_valores` **não tem** `produto_id`. Constraint relevante: `UNIQUE(tabela_preco_id, canal_venda_id)`.

---

## 2. Relacionamentos

```
produtos (N) ──tabela_preco_id──► (1) tabelas_preco
                                        │
                                        ▼
                              tabela_preco_valores (N)
                                        │
                                        ▼
                                  canais_venda (1)
```

| Relação | Cardinalidade |
|---------|---------------|
| Produto → Tabela | **N:1** (no máximo uma tabela por produto) |
| Tabela → Canais (valores) | **1:N** |
| Produto ↔ múltiplas tabelas | **Não suportado** |

**Nuance:** “Tabela Varejo / Tabela Atacado” no vocabulário de negócio **não** corresponde a várias `tabelas_preco` no produto — corresponde a linhas de canal na **mesma** tabela.

Delivery **não** é seed; pode ser cadastrado como canal.

---

## 3. ComercialPrecoResolver

Arquivo: `backend/modules/comercial/preco/ComercialPrecoResolver.js`

```
Canal (opts / CanalVendaResolver / VAREJO)
    ↓
Tabela (opts.tabela_preco_id ?? produto.tabela_preco_id)
    ↓
Preço (tabela_preco_valores WHERE tabela + canal)
    ↓  (miss → preco_venda)
Forma / Unidade (valor do canal → senão produto)
```

**Dependência direta de `produto.tabela_preco_id`:** sim — em `extrairTabelaId`. Não há resolução “entre todas as tabelas do produto”.

---

## 4. APIs que pressupõem uma tabela

| Área | Evidência |
|------|-----------|
| Produtos | CRUD de um único `tabela_preco_id` (`backend/rotas/produtos.js`) |
| Resolver | Uma tabela por chamada |
| Exclusão de tabela | `COUNT(*) FROM produtos WHERE tabela_preco_id = ?` |
| Config comercial | `resolverPrecosVenda` lê `tabela_preco_id` do produto |
| PDV operacional | `PdvVendaOperacionalService` usa tabela do produto |
| Gateway / Motor | `ProdutoPlatformGateway` mapeia `tabelaPrecoId`; `consultarPreco` ignora arg de tabela |
| Diagnóstico | JOIN `tabelas_preco` via `p.tabela_preco_id` |
| MUC / etiquetas / lotes | Resolver com o produto (1 tabela) |

---

## 5. Front-end

| Tela | Impede multi-tabela? |
|------|----------------------|
| Cadastro de Produtos | **Sim** — um picker `#tabela_preco_id` (`frontend/erp/js/produtos.js`) |
| Cadastro de Tabelas | Grade Canal \| Forma \| Unidade \| Preço — **sem** associação multi-produto |
| PDV | Resolve canal da venda + tabela do produto |
| Comercial | Mesma API `resolver-precos` |

Não há multi-select de tabelas no produto.

---

## 6. Testes

| Suite | Multi-tabela por produto? |
|-------|---------------------------|
| RCM-04.1 … RCM-04.6 | Não — validam tabela × canais / um vínculo |
| RCM-05.1 | Explicitamente: “mesmo produto/**tabela**”, troca de canal |

**Ausência registrada:** nenhum teste cobre produto em duas `tabelas_preco` simultaneamente.

---

## 7. Compatibilidade

| Pergunta | Resposta |
|----------|----------|
| Pode remover `tabela_preco_id` agora? | **Não** |
| Pode virar “apenas legado”? | **Não** — ainda é a ponte V2 |
| Precisa permanecer? | **Sim**, até existir modelo N:N (ou equivalente) |
| Impacto em clientes atuais? | Remoção sem migração → queda para `preco_venda` / quebra de UI e exclusão |

---

## Situação Atual

Modelo oficial: **Produto → 0..1 Tabela**, **Tabela → N Canais** (preço/forma). Multiplicidade comercial é por **canal**, não por múltiplas tabelas no produto. Produtos que compartilham a mesma tabela compartilham os **mesmos** preços por canal.

## Pontos Fortes

- Separação Canal × Tabela × Fallback legado  
- `ComercialPrecoResolver` como porta única (RCM-04.6)  
- Forma/unidade por canal com herança (RCM-05.1)  
- Exclusão de tabela bloqueada com produtos vinculados  
- Override pontual via `opts.tabela_preco_id`

## Limitações

1. Produto não pode estar em várias `tabelas_preco` oficiais  
2. Valores sem `produto_id` → preços globais à tabela  
3. DELIVERY não é seed  
4. UI com seletor único  
5. Gateway ignora parâmetro de tabela em `consultarPreco`

## Dependências (se evoluir)

Resolver + cache, CRUD produto, UI produto, contagem/exclusão de tabela, PDV `resolver-precos`, serviços operacionais, gateways, diagnóstico, testes RCM-04/05, documentação.

## Riscos

| Risco | Impacto |
|-------|---------|
| Confundir “tabela por canal” com N tabelas no produto | Cadastro e expectativas erradas |
| Remover `tabela_preco_id` sem N:N | Quebra sistêmica |
| N:N sem `produto_id` nos valores | Ambiguidade de preço compartilhado |

## Recomendação Arquitetural

**✖ Ainda existe dependência estrutural** impedindo o cenário “um produto em várias Tabelas de Preço simultaneamente”.

O desenho **oficial e correto** para Varejo/Atacado/Evento é: **uma tabela + múltiplos canais**.

Se o negócio exigir tabelas nomeadas distintas em paralelo (ex.: “Tabela Delivery” e “Tabela Evento” como entidades separadas no mesmo produto), isso exige **evolução estrutural**.

## Complexidade da evolução N:N

**Alta** — junction (ou preço por produto), migração de `tabela_preco_id`, reescrita do resolver, UI multi-vínculo, regras de exclusão, cache, PDV/Comercial e regressão completa RCM-04/05.
