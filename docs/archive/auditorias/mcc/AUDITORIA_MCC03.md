# AUDITORIA — MCC-03 Entrada Operacional

**Data:** 2026-07-17  
**Código:** MCC-03  
**Status:** APROVADO (implementação)

---

## Checklist

| # | Critério | Resultado |
|---|----------|-----------|
| 1 | Entrada utiliza exclusivamente o MCC (via Orchestrator) | OK |
| 2 | Nenhuma rota chama Converter diretamente | OK |
| 3 | Estoque único na unidade base | OK |
| 4 | Conversão Física criada automaticamente na entrada | OK |
| 5 | Entrada é única origem de ConversaoFisicaLote | OK |
| 6 | Nenhum cálculo legado de qtd em `processarItensCompra` | OK |
| 7 | Produtos antigos (comum / fracionado) continuam funcionando | OK |
| 8 | Modos PESO_POR_EMBALAGEM e PESO_TOTAL | OK |
| 9 | Auditoria com produto/compra/lote/fator/qtd/timestamp | OK |
| 10 | Testes `npm run test:mcc03` passando | OK |

---

## Evidências técnicas

### Ponte oficial

- `EntradaMercadoriasOperacionalService` → `CompraConversaoOrchestrator.processarItem`
- `backend/rotas/compras.js` instancia o serviço operacional; **não** importa `ConversaoComercialService.Converter`

### Removido do caminho de conversão (compras)

- `resolverQuantidadesEstoqueCompraItem`
- `obterTotalConvertidoItemCompra`
- `validarDistribuicaoConversaoUnidadesItem` (substituído por validação MCC + legado residual)

### Mantido (não é conversão de unidade)

- `moeda` / `custoUnitarioVenda` (arredondamento financeiro)
- `resolverQuantidadesCompraItem` (split fiscal bruto pré-validação legado)
- `resolverPrecosCadastroAposCompra` apenas no bootstrap de produto novo (XML/legado)

### UI

- Painel MCC na Compra: UC + modos de peso + preview de quantidade base
- Fator exibido como **calculado** — nunca digitável como “1 L = x Kg”

---

## Riscos residuais

| Risco | Mitigação |
|-------|-----------|
| Produtos `produto_fracionado` sem UC | UC sintética `EMB` via MCC |
| PDV / Fiscal ainda no legado | Fora de escopo MCC-03; migração futura |
| `resolverCustoUnitarioProdutoCadastro` em produtos.js | Fora do caminho de Entrada; não alterado |

---

## Decisão

MCC-03 cumpre os critérios de aceite. A Entrada de Mercadorias passa a ser o módulo operacional oficial do MCC para criação de estoque base e Conversão Física por Lote.
