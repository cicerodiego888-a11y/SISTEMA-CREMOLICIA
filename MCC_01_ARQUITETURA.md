# MCC-01 — Arquitetura do Motor de Conversão Comercial

**Código:** MCC-01  
**Status:** Fundação CORE entregue (sem integração operacional)  
**Versão:** 1.0.0-mcc01

---

## Objetivo

Centralizar **todas** as conversões entre Unidades de Comercialização (UC-01) e a **Unidade Base de Estoque (SSOT)** em um único motor da Plataforma CDS.

> Um Produto → Uma Unidade Base → N Unidades de Comercialização → **Um Motor Central de Conversão Comercial**.

---

## Localização

```
backend/motores/motor-conversao-comercial/
├── domain/
│   ├── enums.js
│   ├── Conversao.js          # ResultadoConversao + auditoria
│   └── UnidadeComercial.js
├── services/
│   ├── ConversaoComercialService.js   # Converter() oficial
│   ├── ConversaoAgrupamentoService.js
│   ├── ConversaoFracionamentoService.js
│   ├── ConversaoFisicaService.js      # stub arquitetural
│   ├── ConversaoCompostaService.js    # cadeia preparada
│   └── ConversaoCache.js
├── validators/
│   └── ConversaoValidator.js
├── tests/
│   └── mcc01.test.js
└── index.js
```

---

## Interface oficial

```js
const { Converter } = require('./backend/motores/motor-conversao-comercial');

const resultado = Converter({
  produto,              // objeto produto (com unidade_base e unidades_comercializacao)
  quantidade,           // número
  unidadeOrigem,        // código UC (ex.: CX)
  contexto,             // COMPRA | VENDA | PDV | ...
  operacaoId,           // opcional — chave de cache da operação
  cadeia                // opcional — passos CONVERSAO_COMPOSTA
});
```

### Saída (`ResultadoConversao`)

| Campo | Descrição |
|--------|-----------|
| `quantidadeConvertida` | Quantidade na unidade base |
| `unidadeBase` | SSOT do produto |
| `origemConversao` | Unidade comercial de origem |
| `tipo` | TipoConversao |
| `contexto` | ContextoConversao |
| `precisao` | Estrutura preparada (não aplicada) |
| `auditoria` | Trilha em memória (`persistido: false`) |
| `cadeia` | Passos (simples ou compostos) |
| `cacheHit` | Se veio do cache da operação |

---

## Contextos oficiais

`COMPRA` · `VENDA` · `PDV` · `COMERCIAL` · `NFC-e` · `NF-e` · `ORCAMENTO` · `OUTROS`

---

## Tipos oficiais

| Tipo | Status MCC-01 |
|------|----------------|
| `PADRAO` | Implementado (identidade) |
| `AGRUPAMENTO` | Implementado (qtd × fator) |
| `FRACIONAMENTO` | Implementado (qtd × fator) |
| `CONVERSAO_FISICA` | Arquitetura (501) |
| `CONVERSAO_COMPOSTA` | Cadeia preparada; física nos elos → 501 |

Fator UC-01: `quantidade` = quantas unidades **base** cabem em **1** unidade comercial.

---

## Precisão (preparado)

Campos: `casasDecimais`, `arredondamento`, `precisaoComercial`.  
`aplicado: false` nesta sprint.

---

## Auditoria (sem persistência)

Toda conversão gera estrutura:

Origem → Destino → Qtd entrada → Qtd convertida → Tipo → Motor (`MotorConversaoComercial`).

---

## Cache

Cache interno por `operacaoId`. Mesma chave (produto + qtd + UC + contexto + base) não é recalculada na mesma operação.

---

## Fora de escopo (MCC-01)

- Integração Compras / Estoque / PDV / Comercial / NFC-e / NF-e  
- Conversão física por lote  
- Persistência de auditoria  
- APIs HTTP  
- Conversão automática em fluxos existentes  

---

## Consumo futuro

Compras · Estoque · PDV · Comercial · NFC-e · NF-e · Motor Financeiro · MIIP · E-commerce  

**Regra:** nenhum módulo implementa conversão própria.
