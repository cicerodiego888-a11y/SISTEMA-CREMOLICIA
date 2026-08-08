# MCI-01 — Integração MCC × Entrada de Mercadorias

**Código:** MCI-01  
**Status:** Infraestrutura entregue (sem movimentação de estoque)  
**Versão motor:** 1.2.0-mci01

---

## Decisão oficial

A **Entrada de Mercadorias** é a **única origem autorizada** a criar `ConversaoFisicaLote`.

```
Fornecedor → Entrada da Compra → Lote → Conversão Física → MCC → Estoque Base
```

- MCC: exclusivamente cálculos (`Converter`, `CalcularConversaoFisica`)
- Compra/Orchestrator: coleta dados reais do lote e registra a conversão física
- Compras **não** implementa lógica interna do MCC — consome o orchestrator

---

## Camada

```
backend/motores/motor-conversao-comercial/integracao/compra/
├── CompraConversaoOrchestrator.js
└── ModoEntradaConversao.js
```

### CompraConversaoOrchestrator

1. Valida unidades comerciais (canal compra)
2. Valida conversão física obrigatória
3. Cria lote draft
4. Calcula e monta `ConversaoFisicaLote`
5. Chama MCC (`somenteUnidadeBase`) → quantidade na unidade base
6. Devolve resultado + auditoria (memória)

**Nesta sprint:** estoque **não** é movimentado (`estoqueBasePendente: true`).

---

## Modos de entrada

### Modo 1 — Peso por Embalagem

| Campo | Exemplo |
|-------|---------|
| Quantidade | 20 caixas |
| Unidade | CX (5 L) |
| Peso por embalagem | 3,375 Kg |

→ Fator `3,375 / 5 = 0,675` · Estoque base `100 L`

### Modo 2 — Peso Total

| Campo | Exemplo |
|-------|---------|
| Volume total | 100 L |
| Peso total | 67,500 Kg |

→ Fator `0,675` · Estoque base `100 L`

**Nunca** solicitar ao operador: `1 Litro = XXX Kg`.

---

## MCC — CalcularConversaoFisica()

```js
const { CalcularConversaoFisica } = require('./backend/motores/motor-conversao-comercial');

CalcularConversaoFisica({ volume: 5, peso: 3.375 });
// → { quantidadeBase, quantidadeDestino, fator: 0.675, ... }
```

---

## Erros oficiais

| Erro | Quando |
|------|--------|
| `ConversaoFisicaObrigatoriaError` | Produto exige física e peso não informado |
| `PesoInvalidoError` | Peso ≤ 0 / inválido |
| `VolumeInvalidoError` | Volume ≤ 0 / inválido |
| `UnidadeNaoPermitidaError` | UC inexistente ou sem canal compra |

---

## Uso

```js
const { CompraConversaoOrchestrator, ModoEntradaConversao } = require('...');
const orch = new CompraConversaoOrchestrator();

const r = orch.processarItem({
  produto,
  quantidade: 20,
  unidadeOrigem: 'CX',
  modo: ModoEntradaConversao.PESO_POR_EMBALAGEM,
  pesoEmbalagem: 3.375,
  compra: { id: 10, fornecedorId: 5 },
  lote: { id: 101, codigo: 'L20260717' }
});
// r.quantidadeConvertida === 100 (Litros)
// r.conversaoFisicaLote.fator === 0.675
```

---

## Fora de escopo

Entrada definitiva no estoque · PDV · NFC-e/NF-e · Comercial · Financeiro · UI · rotas HTTP de Compras

---

## Testes

```bash
npm run test:mci01
```
