# MCC-04 — Migração Oficial do Estoque para o MCC

**Código:** MCC-04  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Versão:** 1.0.0-mcc04

---

## Objetivo

O Motor de Estoque passa a operar **somente** com Unidade Base (SSOT).  
Toda conversão ocorre previamente no Motor de Conversão Comercial (MCC).

---

## Decisão arquitetural

O Estoque **deixa de conhecer**: Caixa, Pacote, Metro, Kg, Litro, Pote, Bobina, fator, UC.

O Estoque **conhece apenas**:

- Produto
- Unidade Base
- Quantidade Base

```
Qualquer módulo → MCC → Quantidade Base → Motor de Estoque → Persistência
```

---

## Responsabilidades

| Faz | Não faz |
|-----|---------|
| Entrada | Conversão |
| Saída | Fracionamento |
| Saldo | Agrupamento |
| Reserva | Conversão Física |
| Inventário | Cache de conversão |
| Auditoria | Aceitar unidade comercial |

---

## API oficial

```js
const MotorEstoque = require('./backend/motores/motor-estoque');

await MotorEstoque.entrar(db, {
  produtoId,
  quantidadeBase,      // obrigatório (já convertido pelo MCC)
  quantidadeFiscal?,   // split fiscal em base
  quantidadeNaoFiscal?,
  operacao implícita: ENTRADA,
  origem: 'COMPRA',
  loteId?,             // informado pelo MCC / Entrada — nunca recalcular fator
  referenciaTipo?,
  referenciaId?
});

await MotorEstoque.sair(db, { produtoId, quantidadeBase, origem, loteId? });
await MotorEstoque.ajustar(db, { produtoId, deltaFiscal, deltaNaoFiscal, motivo });
await MotorEstoque.inventariar(db, { produtoId, saldoFiscalContado, saldoNaoFiscalContado });
await MotorEstoque.reservar(db, { produtoId, quantidadeBase });
await MotorEstoque.consultarSaldo(db, produtoId);
```

**Rejeitado:** `quantidadeComercial`, `unidadeComercial`, `fator`, embalagens, etc.  
→ `QuantidadeComercialRejeitadaError`

---

## Integração

| Caller | Uso |
|--------|-----|
| `compras.js` (MCC-03) | Após Orchestrator → `MotorEstoque.entrar` |
| `ajusteEstoqueService` | `MotorEstoque.ajustar` (+ lotes FEFO existentes) |
| Motor Comercial (via ajuste) | Indireto — quantidade já base |

---

## Auditoria

Tabela `estoque_movimentacoes`:

Produto · Quantidade Base · Origem · Lote · Operação · Timestamp · Motor

**Nunca** registra quantidade comercial.

---

## Lotes

Quando existir `loteId`, apenas persiste a referência.  
**Nunca** recalcula fator — fator permanece no MCC / `ConversaoFisicaLote`.

---

## Pacote

```
backend/motores/motor-estoque/
├── index.js
├── domain/
├── services/MotorEstoqueService.js
├── repositories/
├── migrations/001_estoque_movimentacoes.js
└── tests/mcc04.test.js
```

---

## Fora de escopo

PDV · Comercial · Fiscal · Financeiro · APIs externas

---

## Testes

```bash
npm run test:mcc04
```
