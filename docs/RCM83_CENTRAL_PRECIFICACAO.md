# RCM-8.3 — Central de Precificação

| Campo | Valor |
|---|---|
| Sprint | RCM-8.3 |
| Data | 2026-08-06 |
| Base | RCM-8.0 / RCM-8.1 / RCM-8.2 |
| Natureza | Tabelas de Preços → Central Oficial |

---

## Filosofia

Toda precificação oficial nasce nesta Central via **Motor Oficial** (`ComercialPrecoResolver`).

Grade: **Linha** ou **Produto** (nunca ambos no mesmo registro) × Unidade Comercial × Preço × Status.

---

## Capacidades

| Recurso | Descrição |
|---|---|
| Resumo inteligente | Operações que usam / não usam a tabela + KPIs |
| Adicionar Registro | Escolha Linha ou Produto → pesquisa |
| Painel inteligente | Produtos da Linha / impacto do Produto |
| Filtros / ordenação | Tipo, status, nome, preço, unidade |
| Duplicar registro | Copia preço/unidade/status para nova referência |
| Duplicar tabela | Clona tabela + registros |
| Histórico | Quem, quando, preço anterior/novo |
| Diagnóstico | Linha → produtos, tabelas presentes/ausentes |
| Cobertura | Sem preço, sem linha, duplicados, refs inválidas |
| Simulador | Resolve preço sem abrir o PDV |

---

## APIs novas

```
GET  /tabelas-preco/:id/resumo
GET  /tabelas-preco/pesquisar-linhas?q=
GET  /tabelas-preco/pesquisar-produtos?q=
GET  /tabelas-preco/linhas/:linhaId/produtos
GET  /tabelas-preco/linhas/:linhaId/diagnostico
GET  /tabelas-preco/produtos/:produtoId/painel
GET  /tabelas-preco/:id/cobertura
GET  /tabelas-preco/cobertura
POST /tabelas-preco/simular
GET  /tabelas-preco/:id/historico
POST /tabelas-preco/:id/duplicar
```

Migration: `020_central_precificacao_rcm83` (histórico + `ativo` nas células).

---

## Teste

```bash
node backend/modules/comercial/tests/rcm83-central-precificacao.test.js
```

---

## Critérios

| Critério | Status |
|---|---|
| Linha ou Produto | ✔ |
| Nunca ambos | ✔ |
| Painel / Simulador / Diagnóstico / Cobertura | ✔ |
| Histórico / Duplicação | ✔ |
| Compatível Resolver (com/sem Linha) | ✔ |
