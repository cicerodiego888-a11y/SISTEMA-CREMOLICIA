# AUDITORIA RCM-04.6 — Leituras de Preços Legados

**Data:** 2026-07-30  
**Objetivo:** Eliminar leituras diretas de preço de venda; `ComercialPrecoResolver` como única porta.

## Resumo

| Classificação | Ação |
|---|---|
| MUST_FIX | Corrigido nesta sprint |
| KEEP | Fallback do resolver, SELECT/UPDATE, form UI, testes |
| UI_ONLY | Cadastro de produtos (oculto quando tabela controla) |

## MUST_FIX (corrigidos)

| Arquivo | Motivo | Correção |
|---|---|---|
| `backend/rotas/produtos.js` (search frequentes) | LIP devolvia `preco_venda` SQL | `normalizarProdutosResposta` |
| `backend/rotas/produtos.js` (promoções) | Listagem/sugestões/elegíveis | `obterPrecoVendaAsync` |
| `backend/motores/muc/.../ProdutoUnidadeService.js` | SELECT sem `tabela_preco_id` | Incluído no SELECT |
| `backend/motores/equipamentos/.../EtiquetaMapper.js` | `dados.preco_venda` | `obterPrecoVenda` |
| `backend/services/lotesService.js` | `SUM(... * p.preco_venda)` | Resolução por linha |
| `backend/.../AdicionarItemConsignacaoUseCase.js` | `produto.preco` | `produto.precoVenda` |
| `frontend/.../prepararEntregaMappers.js` | `produto.preco_venda` | preço já resolvido |

## KEEP (intencional)

- `ComercialPrecoResolver.extrairPrecoLegado` — fallback oficial
- SELECT `preco_venda` / `tabela_preco_id` como **input** do resolver
- INSERT/UPDATE de `preco_venda` (compatibilidade)
- Faixas `produto_atacado` (legado PDV quando Config Atacado desabilitada)
- Testes e migrations

## UI

- Com Tabela + preço de canal: campos de venda legado **ocultos**
- Mensagem: “Preço controlado pela Tabela de Preço.”

## Gate arquitetural

`backend/modules/comercial/tests/rcm046-arch-preco-legado.test.js`
