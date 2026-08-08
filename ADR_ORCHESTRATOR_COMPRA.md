# ADR — Orchestrator de Conversão na Compra

**Status:** Aceito  
**Data:** 2026-07-17  
**Código:** MCI-01  
**Decisores:** Plataforma CDS

---

## Contexto

O MCC (MCC-01/02) calcula conversões e resolve física por lote, mas **não** deve conhecer formulários de Compra.  
A Entrada de Mercadorias precisa registrar `ConversaoFisicaLote` a partir de peso/volume reais — e nenhum outro módulo pode criar essa conversão.

---

## Decisão

1. Criar `CompraConversaoOrchestrator` como **única** ponte Entrada → MCC → ConversaoFisicaLote.
2. O módulo Compras consome o orchestrator; **não** importa serviços internos do MCC.
3. Dois modos oficiais: `PESO_POR_EMBALAGEM` e `PESO_TOTAL` (fator sempre calculado — nunca digitado como “1 L = x Kg”).
4. Na entrada, a quantidade de estoque permanece na **unidade base**; a física fica no lote para uso futuro (vendas/PDV).
5. Erros oficiais: `PesoInvalidoError`, `VolumeInvalidoError`, `UnidadeNaoPermitidaError`, reuso de `ConversaoFisicaObrigatoriaError`.
6. Nesta sprint: infraestrutura apenas — **sem** gravar estoque nem alterar rotas/UI de Compras.

---

## Consequências

### Positivas
- Separação clara: Compra coleta · MCC calcula · Lote guarda fator
- Origem única de ConversaoFisicaLote
- Preparação para UC operacional de entrada

### Evolução MCC-03
- Rotas HTTP de Compras ligadas via `EntradaMercadoriasOperacionalService`
- Persistência de `produtos_lotes` + `ConversaoFisicaLote` + estoque base na Entrada

### Trade-offs
- PDV / Fiscal / Comercial ainda fora desta ponte (migração futura)

---

## Alternativas rejeitadas

| Alternativa | Motivo |
|-------------|--------|
| Compras chama Converter diretamente | Acopla UI/domínio de compra ao MCC |
| Qualquer módulo cria ConversaoFisicaLote | Viola origem única |
| Operador informa fator L/Kg | Erro humano; fator deve ser derivado |

---

## Referências

- `MCI_01_ENTRADA_MERCADORIAS.md`
- `MCC_03_ENTRADA_OPERACIONAL.md`
- `ADR_MOTOR_CONVERSAO_COMERCIAL.md`
- `ADR_CONVERSAO_FISICA_LOTE.md`
- `backend/motores/motor-conversao-comercial/integracao/compra/`
