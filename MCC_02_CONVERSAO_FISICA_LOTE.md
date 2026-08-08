# MCC-02 — Conversão Física por Lote

**Código:** MCC-02  
**Status:** Infraestrutura entregue (sem integração operacional)  
**Versão motor:** 1.1.0-mcc02

---

## Decisão oficial

A conversão física **pertence ao lote de compra**, nunca ao cadastro do produto.

```
Produto → Unidade Base → Unidades de Comercialização → Lote → Conversão Física → MCC
```

**Proibido:**

```
Produto → Fator Litro/Kg
```

---

## Produto (somente flags)

| Campo | Papel |
|-------|--------|
| `utiliza_conversao_fisica` | Declara que exige física |
| `unidade` / base | SSOT de estoque |
| `unidade_conversao_fisica` | Unidade destino (ex.: KG) |

Nenhum fator é salvo no produto.

---

## Entidade `ConversaoFisicaLote`

Tabela: `conversoes_fisicas_lotes`

| Campo | Descrição |
|-------|-----------|
| id | PK |
| produto_id | Produto |
| lote_id | Lote (1:1) |
| unidade_base | Ex.: L |
| unidade_destino | Ex.: KG |
| quantidade_base | Ex.: 5 |
| quantidade_destino | Ex.: 3,375 |
| fator | destino/base (ex.: 0,675) |
| origem | enum oficial |
| created_at / updated_at | auditoria schema |

### OrigemConversaoFisica

`MANUAL` · `FABRICANTE` · `CALCULADA` · `IMPORTADA_XML` · `IMPORTADA_PLANILHA`

---

## Fluxo no Converter()

```
Produto exige Conversão Física?
  → NÃO → conversão matemática (PADRAO / AGRUPAMENTO / FRACIONAMENTO)
  → SIM
      → lote/conversão informada? → aplicar fator do lote
      → senão → ConversaoFisicaObrigatoriaError
```

### Erro oficial

```js
ConversaoFisicaObrigatoriaError
// "Produto exige Conversão Física por Lote.
//  Informe o peso do lote antes de movimentar o estoque."
// codigo: MCC_CONVERSAO_FISICA_OBRIGATORIA  status: 422
```

Módulos **não** devem implementar validação local — reutilizar esta exceção.

---

## ConversaoResult (expandido)

- `quantidadeOriginal` / `unidadeOrigem`
- `quantidadeConvertida` / `unidadeDestino`
- `unidadeBase` (SSOT)
- `tipoConversao` / `fatorAplicado`
- `loteUtilizado` / `origemConversao`
- `precisao` / `auditoria` (memória, `persistido: false`)

---

## Cache

Chave: `produto + lote + contexto + unidade origem + quantidade`  
Lotes distintos **não** compartilham cache/fator.

---

## Exemplo

```js
const { Converter, ConversaoFisicaLote } = require('./backend/motores/motor-conversao-comercial');

const conversao = ConversaoFisicaLote.criar({
  produtoId: 1, loteId: 10, loteCodigo: 'L20260717',
  unidadeBase: 'L', unidadeDestino: 'KG',
  quantidadeBase: 5, quantidadeDestino: 3.375,
  origem: 'MANUAL'
});

Converter({
  produto: { id: 1, unidade_base: 'L', utiliza_conversao_fisica: 1 },
  quantidade: 10,
  unidadeOrigem: 'L',
  contexto: 'VENDA',
  conversaoFisicaLote: conversao
});
// → 6.75 KG
```

Composta: Caixa → Litro → Kg (agrupamento + física do lote).

---

## Fora de escopo (MCC-02)

Entrada de Compra · PDV · Estoque · APIs de compra · NFC-e/NF-e · UI · persistência operacional da compra

---

## Testes

```bash
npm run test:mcc02
npm run test:mcc:all
```
