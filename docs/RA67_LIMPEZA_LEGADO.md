# RA-6.7 — Limpeza Definitiva do Legado da Precificação

| Campo | Valor |
|---|---|
| Tipo | Limpeza técnica |
| Base | RA-6.6 |
| Não altera | Regras de negócio, arquitetura oficial, MUC, Fiscal, Ledger, Outbox |

---

## Arquitetura oficial (intacta)

```text
Produto
    ↓
Linha de Precificação
    ↓
Tabela de Preços
    ↓
Unidade de Comercialização
    ↓
Preço
    ↓
MUC
    ↓
Estoque
```

---

## Inventário (classificação)

### Removido (CÓDIGO MORTO)

| Item | Motivo |
|---|---|
| `frontend/erp/js/tabelas-preco-ra11.js` | UX RA-1.1 nunca carregada no `index.html` |
| `frontend/erp/js/tabelas-preco-ra2.js` | UX “Lista de Preços” nunca carregada |
| `aplicarTabelaPrecoSelecionadaProduto` / `carregarOpcoesTabelaPrecoProduto` / `pesquisarTabelasPrecoAutocomplete` / `obterPoliticasComerciaisSelecionadasProduto` em `produtos.js` | Stubs sem callers |
| `TabelasPrecoRepository.upsertValores` | Alias `@deprecated` sem callers externos |

### Mantido (COMPATIBILIDADE)

| Item | Motivo |
|---|---|
| Paths 2–4 do `ComercialPrecoResolver` (`tabela_preco_produto_itens`, `linha_comercial_valores`, tabela×canal) | Produtos/dados antigos ainda podem resolver por esses caminhos |
| Coluna `produtos.tabela_preco_id` + hidden no cadastro (sempre `null`) | Schema/API; Resolver **não** usa no fluxo oficial |
| `TabelaPrecoProduto*` + body `itens` | API ainda aceita; sync canal-only |
| Escrita/leitura `linha_comercial_valores` | API linhas/categorias + COALESCE na grade |
| `ProdutoPoliticasComerciaisService` (N:N) | Resolução A-1 e rotas de produto |
| Aliases de busca (“política comercial”, “lista de preços”) | Usuário antigo encontra a tela oficial |
| Testes `ra11-*`, `rcm056`, etc. | Guardam o caminho de compat |

### Ativo (oficial)

| Item | Papel |
|---|---|
| `tabelas-preco-ra6.js` | UX Tabela mono-canal |
| `tabelas-preco.js` | Shell lista + API client |
| `linhas-comerciais.js` | CRUD Linha de Precificação |
| Resolver path Tabela×Linha + Preço de Segurança | SSOT de preço |
| Cadastro produto: Linha + Preço de Segurança + Unidade Base | RA-6.3 / 6.5 / 6.6 |

---

## Nomenclatura padronizada (UI / mensagens)

| Antes (exposto) | Depois |
|---|---|
| Política Comercial / Políticas Comerciais | **Linha de Precificação** |
| Lista de Preços | **Tabela de Preços** |
| Preço Base | **Preço de Segurança** (já na RA-6.5.1) |

Nomes internos de tabela/coluna (`linhas_comerciais`, `produto_politicas_comerciais`) **não** foram renomeados — evitam migration destrutiva.

---

## O que NÃO foi feito (de propósito)

- Drop de colunas/tabelas (`tabela_preco_id`, `tabela_preco_produto_itens`, `linha_comercial_valores`)
- Remoção dos fallbacks do Resolver
- Mudança de regras de preço / PDV / MUC / Fiscal

Isso exige sprint de cutover de dados, não limpeza.

---

## Testes

Executados na sprint:

- `ra66-unidade-comercial-tabela.test.js`
- `ra64-resolver-linha.test.js`
- `ra6-precificacao.test.js`
- `rcm0515-tabela-preco-arquitetura.test.js` (atualizado para RA-6.7)

---

## Critérios de aceite

- [x] Código morto de UX RA-1.1 / RA-2 removido
- [x] Stubs órfãos do cadastro de produto removidos
- [x] Conceitos antigos não expostos na UI ativa (nomenclatura oficial)
- [x] Compatibilidade de runtime preservada
- [x] Arquitetura RA-6.6 intacta
