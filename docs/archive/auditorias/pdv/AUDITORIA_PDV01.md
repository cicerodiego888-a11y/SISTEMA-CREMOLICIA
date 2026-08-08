# AUDITORIA PDV-01 — Migração PDV → MCC → MotorEstoque

**Sprint:** PDV-01  
**Data:** 2026-07-17  
**Resultado:** APROVADO (implementação + testes unitários do orchestrator)

---

## Checklist arquitetural

| Regra | Status | Evidência |
|-------|--------|-----------|
| PDV não calcula fator/base | OK | `pdv.js` deixa de multiplicar `fator_conversao` em UC; envia `quantidade_comercial` |
| Conversão só via MCC | OK | `PdvConversaoOrchestrator` → `Converter(contexto=PDV)` |
| Rotas não chamam Converter direto | OK | `VendaPagamentoService` usa `pdvOperacional.processarItemVenda` |
| MotorEstoque só quantidadeBase | OK | `MotorEstoque.sair` / `entrar` sem campos comerciais |
| Sem criar ConversaoFisicaLote no PDV | OK | Orchestrator PDV não persiste física (só lê ativa) |
| Canal PDV nas UCs | OK | `_validarUnidadePermitidaPdv` + `filtrarUnidadesPdv` |
| Legado sem UC | OK | unidade base automática |
| Estorno sem reconversão | OK | `MotorEstoque.entrar` com qtd fiscal/não-fiscal já persistida |
| FEFO preservado | OK | `consumirLotesFEFO` antes do `sair` |

---

## Fluxo auditado (venda)

1. Frontend: produto + UC (canal pdv) + quantidade comercial  
2. `criarVenda` → `PdvVendaOperacionalService.processarItemVenda`  
3. MCC → `quantidadeConvertida` (= base) + auditoria  
4. `distribuirItemVenda` com `quantidade_estoque` = base  
5. Persistência `vendas_itens` (`fator_conversao` = fator MCC, audit)  
6. `MotorEstoque.sair({ origem: PDV, quantidadeBase, ... })`

---

## Fluxo auditado (estorno)

1. Quantidades fiscais/não-fiscais da venda original (já em base)  
2. Restauração de lotes (serviço existente)  
3. `MotorEstoque.entrar({ origem: DEVOLUCAO })`

---

## Testes

```
npm run test:pdv01
```

Cenários cobertos:

- Produto comum (legado)
- Caixa (agrupamento)
- Sorvete L / ml / pote
- Rejeição UC sem canal PDV
- Filtro de UCs para UI
- Auditoria MCC

---

## Riscos residuais

| Risco | Mitigação |
|-------|-----------|
| Pré-cálculo fiscal no frontend ainda usa `quantidade` comercial se sem UC | Backend sempre reconverte via MCC antes de distribuir |
| MUC legado ainda no fallback HTTP | Só se UC-01 falhar; caminho feliz é UC-01 |
| Venda por `peso_medio_unidade` sem UC | Mantida como compatibilidade até cadastro UC-01 |

---

## Decisão oficial

O PDV passa a ser **consumidor oficial** do MCC.  
Toda conversão Unidade Comercial → Unidade Base é exclusiva do MCC.  
Toda movimentação de estoque da venda/estorno PDV passa pelo MotorEstoque.
