# AUDITORIA FINAL — PDV (STAB-PDV-01)

**Código:** AUDITORIA_FINAL_PDV  
**Data:** 2026-07-18  
**Sprint:** STAB-PDV-01  
**Tipo:** Forense / estabilização — **SEM IMPLEMENTAÇÃO**

---

## Respostas diretas

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | MUC ainda decide Forma de Venda? | **Não.** Fonte = UC-01 (`PdvFormaVendaUc01` / `ProdutoUnidadeComercialService`). |
| 2 | Modal usa Unidade Comercial? | **Sim**, quando há UC canal PDV. |
| 3 | Conversão no front? | **Não** com UC. Legado: `peso_medio_unidade` só sem UC. |
| 4 | Estoque recebe base? | **Sim**, via MCC em `VendaPagamentoService`. |
| 5 | Fiscal recalcula UC? | **Não** — snapshot. |
| 6 | Estorno reconverte? | **Não** — devolve quantidades já em base. |
| 7 | Código morto? | **Sim** — modal *Muc*, helpers sem callers (documentados). |
| 8 | Pronto enterprise? | 🟡 Quase pronto / Veredito 🟡 Estável |

---

## Mapa MUC residual (PDV)

```
🟢 UC-01 na busca + resolução UI
🟡 Muc.resolverPorBarras + SQL produto_unidades (EAN)
🟡 Nomes *Muc* / var muc (semântica)
🔴 abrirModalUnidadeComercialMuc / produtoTemMultiplasUnidadesMuc (mortos)
```

---

## Evidências-chave

| Trecho | Papel |
|--------|--------|
| `pdvFormaVendaUc01.js` → `resolverFormaVendaPdv` | Decisão oficial |
| `pdv.js` → `iniciarFluxoAdicionarProdutoPdv` | Cutover PDV-UC-02 |
| `produtos.js` → `anexarUnidadesComerciaisUc01` | Busca sem Muc.listar |
| `VendaPagamentoService.js:885` | MCC `processarItemVenda` |
| `VendaDevolucaoService` | Estorno na base |

---

## Critério de consolidação oficial

Atendido para o **núcleo operacional**. Resquícios de limpeza não invalidam o cutover; devem ser tratados em sprint de higiene (ex.: STAB-PDV-02 / CLEAN-MUC-PDV).

---

## ADR?

**(x) NÃO** — auditoria de estabilidade; arquitetura já definida (UC-01, PDV-01, PDV-UC-02, MCC).
