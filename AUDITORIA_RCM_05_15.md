# AUDITORIA RCM-05.15 — Tabelas de Preço × Linha Comercial

Data: 2026-07-31  
Prioridade: CRÍTICA (pré-homologação Cremolícia)

---

## 1. Arquitetura encontrada (antes)

Dois eixos de preço **desconectados**:

```
produtos ──tabela_preco_id──► tabelas_preco ──► tabela_preco_valores ──► canais
produtos ──linha_comercial_id──► linhas_comerciais ──► linha_comercial_valores ──► canais
```

- `tabelas_preco` **não** tinha `linha_comercial_id` nem junction.
- UI “Nova Tabela” mostrava apenas Código / Nome / Descrição + grade de canais.
- `ComercialPrecoResolver` priorizava `linha_comercial_valores` e usava tabela só como fallback.

---

## 2. Divergências vs arquitetura oficial

| Oficial | Antes |
|---------|--------|
| Produto → Categoria → **Linha** → **Tabela** → Canal → Forma → Unidade → Preço | Linha e Tabela irmãs; UI sem contexto de Linha |
| Preço pertence a uma Linha | Preços órfãos de Linha na tela de Tabelas |
| Forma/Unidade herdadas da Linha | Operador preenchia tudo na grade de canais |

---

## 3. Alterações realizadas

### Banco (`012_tabela_preco_linha.js`)
- Tabela `tabela_preco_linhas` (N:N Tabela ↔ Linha)
- Coluna `tabela_preco_valores.linha_comercial_id`
- Índice único `(tabela, IFNULL(linha,0), canal)`
- Backfill via `produtos.tabela_preco_id` + `produtos.linha_comercial_id`
- Sync `INSERT OR IGNORE` para `linha_comercial_valores` (sem perda)

### API
- CRUD passa a exigir `linhas_ids`
- `POST /api/tabelas-preco/grade-por-linhas` gera Linha × Canais com herança de forma/unidade/preço da Linha
- Ao salvar valores com linha: **sincroniza** `linha_comercial_valores` (SSOT do Resolver)

### ERP
- Modal com checkboxes de Linhas Comerciais
- Grade: Linha | Canal | Forma | Unidade | Preço
- Lista exibe coluna “Linhas Comerciais”

### Resolver
- Documentado RCM-05.15: runtime continua Linha×Canal; Tabela alimenta a Linha ao salvar

---

## 4. Estrutura final

```
tabelas_preco
    └── tabela_preco_linhas ──► linhas_comerciais
    └── tabela_preco_valores (linha_comercial_id, canal_venda_id, forma, unidade, preço)
            └── sync ──► linha_comercial_valores
```

---

## 5. Fluxo ComercialPrecoResolver (atualizado)

1. Resolve Linha (produto / categoria)
2. Busca preço em `linha_comercial_valores` (Canal)
3. Fallback: `tabela_preco_valores` (legado)
4. Fallback: `produto.preco_venda`

A UI de Tabelas é o meio oficial de cadastrar preços **por Linha**; o Resolver não duplica regra — consome a Linha.

---

## 6. Evidências de testes

```
node backend/modules/comercial/tests/rcm0515-tabela-preco-arquitetura.test.js
→ RCM-05.15 OK — arquitetura Tabelas de Preço × Linha Comercial
```

Validado por contrato:
- Seleção de Linha Comercial
- Geração automática dos canais
- Herança Forma / Unidade
- Cadastro de preços + sync Resolver
- Migração / ERP / documentação PDV-Mobile (sem mudança de contrato do Resolver)

---

## Critérios de aceitação

- [x] Relacionamento explícito Tabela ↔ Linhas
- [x] UI representa a arquitetura V2
- [x] Operador vê para qual Linha cadastra preço
- [x] Forma/Unidade herdadas
- [x] Preço é o foco da edição
- [x] Resolver permanece único responsável em runtime
- [x] Sem alteração de APIs de venda PDV/Mobile
