# RELATÓRIO DE ESTABILIZAÇÃO — PDV

**Código:** RELATORIO_ESTABILIZACAO_PDV  
**Sprint:** STAB-PDV-01  
**Data:** 2026-07-18  
**Escopo:** pós PDV-UC-02 — somente auditoria

---

## 1. Situação

Após PDV-UC-02 o PDV consome UC-01 para Formas de Venda e exibe quantidade na Unidade Comercial. Esta auditoria confirma estabilidade arquitetural e inventaria resquícios.

---

## 2. Fluxo validado

```
Produto
  ↓
UC-01 (items / canal PDV)
  ↓
Forma de Venda (unidade_padrao → prioridade → fallback Base)
  ↓
Quantidade (modal na UC)
  ↓
Item (unidade_comercial + id)
  ↓
MCC (PdvConversaoOrchestrator)
  ↓
Motor Estoque (Unidade Base)
  ↓
Venda persistida
  ↓
Fiscal (snapshot)
```

Cancelamento/estorno: devolve saldo na base já gravada — sem MCC, sem MUC.

---

## 3. Achados por severidade

### Bloqueantes (P0)

Nenhum.

### Médios (estabilidade / higiene)

1. **Código morto** com nomenclatura MUC (`abrirModalUnidadeComercialMuc`, `produtoTemMultiplasUnidadesMuc`, wrappers órfãos).  
2. **Busca PDV** ainda consulta `produto_unidades` (EAN) + `Muc.resolverPorBarras` (IDs incompatíveis com UC-01).  
3. **Performance:** N+1 `Uc01.listar` na busca; possível GET UC duplicado se cache sem `_fonte_uc01`.  
4. **Legado sem UC:** `peso_medio_unidade` no front (compat venda por unidade).

### Baixos

- Renomear `continuarAdicionarProdutoComUnidadeMuc` e variável `muc`.  
- Rota `GET /muc/barras/:codigo` sem uso no front PDV atual.

---

## 4. Compatibilidade

| Caso | Comportamento |
|------|----------------|
| Sem UC | Unidade Base — igual ao anterior |
| UC PDV | Modal na comercial |
| API UC indisponível | Lista vazia → Base (sem fallback MUC HTTP) |

---

## 5. Testes consultados (não reexecutados nesta sprint de docs)

| Suite | Resultado conhecido (PDV-UC-02) |
|-------|--------------------------------|
| `npm run test:pdv-uc02` | 12 OK |
| `npm run test:pdv01` | 9 OK |

---

## 6. Recomendações (próximas sprints — NÃO implementar agora)

1. **CLEAN-PDV-01** — remover código morto *Muc* + renomear símbolos vivos.  
2. **PDV-UC-03** — EAN comercial no UC-01; retirar SQL/`resolverPorBarras` MUC da busca.  
3. **PERF-PDV-01** — batch/listar UC na busca; merge `_fonte_uc01` no cache do autocomplete.  
4. Avaliar migração do legado `peso_medio_unidade` para UC/MCC quando todos os produtos tiverem Forma de Venda.

---

## 7. Veredito

🟡 **Estável** — plataforma aderente ao CORE para o fluxo de venda; limpeza residual planejada, sem alteração nesta sprint.
