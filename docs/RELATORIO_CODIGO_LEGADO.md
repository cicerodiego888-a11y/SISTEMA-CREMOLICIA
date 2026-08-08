# RELATÓRIO — Código Legado e Código Morto (RCM-8.6)

| Campo | Valor |
|---|---|
| Sprint | RCM-8.6 |
| Data | 2026-08-06 |
| Ação nesta sprint | **Apenas inventário** — nada removido |

---

## 1. Caminhos de preço fora do Motor (ainda ativos)

| Local | Severidade | Classificação | Ação sugerida (futura) |
|---|---|---|---|
| `KitItemService.somarItens` — `SUM(p.preco_venda)` | Alta | Ativo (kit SOMA) | Migrar formação Kit → Resolver |
| `KitService` sync SOMA → `produtos.preco_venda` | Alta | Ativo | Idem |
| MUC `unidade.preco` / `montarPayloadVenda` | Média | Ativo (API); PDV desktop usa Resolver | Documentar oferta vs lista |
| `EtiquetaMapper` / `ProdutoMapper` `obterPrecoVenda` | Média | Ativo (etiqueta ≠ venda) | Manter; canal default |
| ERP CRUD `produto_atacado` | Média | Ativo cadastro; **morto no PDV** | Remover UI após migração |
| Escrita `linha_comercial_valores` (Linhas) | Média | Ativo write; morto no `resolver()` | Parar escrita → deprecate |
| `produtos.tabela_preco_id` | Baixa | Ignorado pelo Resolver | Não usar; limpar depois |
| Consulta PDV display `preco_venda` | Display | Ativo | Aceitável (preview) |

---

## 2. Banco — candidatos obsoletos (não remover agora)

| Objeto | Motivo | Manter por |
|---|---|---|
| `produto_atacado` | Substituído por Tabela Atacado + Resolver | Cadastro ERP legado |
| `linha_comercial_valores` | Fora do fluxo oficial RCM-8.0 | Compat / cache warm |
| `produtos.tabela_preco_id` | Produto não escolhe tabela | Dados históricos |
| Colunas de preview em consultas | Ruído | Relatórios antigos |

**Oficiais (manter):** `tabelas_preco`, `tabela_preco_valores`, `tabela_preco_produto_itens`, `tabela_preco_historico`, `linhas_comerciais`, `canais_venda`, `produtos.preco_venda` (segurança), `produtos.linha_comercial_id`, `consignacoes_itens` snapshot.

---

## 3. Código morto / semi-morto

| Item | Pode remover? | Precisa manter? |
|---|---|---|
| `obterPrecoAtacado` no PDV | Já removido | — |
| Consumo PDV de `produto_atacado` | Já morto | Tabela/API ERP até decisão |
| `buscarPrecoLinha` no caminho `resolver()` | Sim (após testes legados) | Export/cache até LCV retired |
| `ORIGEM_LINHA` em asserts antigos | Atualizar testes | — |
| `ComercialMotorUnificado` PEDIDO/ORCAMENTO | Não | Contrato futuro |
| Promo / desconto manual | Não | Camadas oficiais pós-Resolver |

---

## 4. Separação final

### Pode remover (sprints futuras dedicadas)

- UI/API de faixas `produto_atacado` após migração completa de Atacado para Tabelas.
- Escrita em `linha_comercial_valores` após validar zero leitores de lista.
- Exports mortos do Resolver (`buscarPrecoLinha` se não houver consumers).

### Precisa manter

- `ComercialPrecoResolver` + `resolver-precos`.
- Snapshot consignação RCM-6.1.
- Preço de Segurança em produto.
- Overlay promo / desconto / Kit FIXO (oferta).
- Contrato `ComercialMotorUnificado`.

---

## Conclusão

O legado está **identificado e contido**. Não bloqueia o congelamento da arquitetura. Remoções ocorrerão em sprints de limpeza, sem alterar o Motor Oficial.
