# PDV-01 — Migração Oficial do PDV para o MCC

**Código:** PDV-01  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17

---

## Objetivo

Migrar o PDV para consumir exclusivamente o **Motor de Conversão Comercial (MCC)** e o **Motor de Estoque**.

Após esta sprint, o PDV **não realiza qualquer cálculo de conversão**.

---

## Fluxo oficial

```
Operador
  → Seleciona Produto + Unidade Comercial + Quantidade
  → PDV envia quantidade comercial (sem fator)
  → PdvVendaOperacionalService
  → PdvConversaoOrchestrator
  → MCC.Converter(contexto=PDV)
  → quantidadeBase
  → MotorEstoque.sair(origem=PDV)
  → Venda concluída
```

**Estorno / cancelamento:**

```
Cancelar venda
  → quantidade base da movimentação original (vendas_itens)
  → MotorEstoque.entrar(origem=DEVOLUCAO)
  → restaura lotes (política FEFO existente)
```

---

## O que o PDV conhece

| Conhece | Não conhece |
|---------|-------------|
| Produto | Fator |
| Unidade Comercial (UC-01, canal `pdv`) | Unidade Base (operacionalmente) |
| Quantidade comercial | Conversão Física / Matemática |
| | Estoque comercial paralelo |

---

## Artefatos

| Artefato | Caminho |
|----------|---------|
| Orchestrator | `backend/motores/motor-conversao-comercial/integracao/pdv/PdvConversaoOrchestrator.js` |
| Serviço operacional | `.../integracao/pdv/PdvVendaOperacionalService.js` |
| Baixa estoque | `VendaPagamentoService.reduzirEstoqueComFEFO` → `MotorEstoque.sair` |
| Estorno | `VendaDevolucaoService.devolverSaldosDistribuidos` → `MotorEstoque.entrar` |
| UI PDV | `frontend/pdv/js/pdv.js` — UC-01 `/unidades-comercializacao`, filtro canal PDV |
| Testes | `npm run test:pdv01` |

---

## Unidades no PDV

Exibe somente UCs com `permite_pdv` e canal `pdv`.

Exemplo (sorvete):

- ✔ L (base)
- ✔ Pote 200 ml
- ✔ Pote 500 ml
- ❌ Caixa 5 Litros (canal compra)

Produtos sem UC: usa automaticamente a unidade base (compatibilidade legado).

---

## Conversão física

O PDV **nunca pergunta fator**.  
Se o produto exige física, o MCC usa a **versão ativa** da `ConversaoFisicaLote` do lote (quando aplicável).  
Estoque permanece sempre em **unidade base**.

---

## Lotes

Política FEFO existente (`lotesService.consumirLotesFEFO`) permanece.  
O PDV não escolhe lote.  
`MotorEstoque.sair` recebe `loteId` de referência quando houver consumo FEFO.

---

## Removido do caminho PDV

- Multiplicação local por `fator_conversao` no carrinho/finalização (UC)
- Dependência operacional do MUC Conversor para baixa de estoque
- `UPDATE produtos` direto na venda/estorno (substituído pelo MotorEstoque)

---

## Critérios de aceite

- [x] PDV não faz conversão operacional
- [x] MCC resolve conversões (`contexto=PDV`)
- [x] MotorEstoque recebe apenas quantidade base
- [x] Produtos antigos (sem UC) funcionam
- [x] Testes `test:pdv01` passando

---

## Não implementado (fora de escopo)

Comercial · Fiscal · Financeiro · E-commerce
