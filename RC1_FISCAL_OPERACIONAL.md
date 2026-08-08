# RC1 — Motor Fiscal × Não Fiscal (Resultado Fiscal Operacional)

**Sprint:** 3.8E.1  
**Versão:** RC1  
**Data:** 2026-07-29  

## Objetivo

Formalizar o contrato oficial de saída do Motor Fiscal × Não Fiscal como  
`FiscalOperacionalResult`, preparando o terreno para políticas inteligentes  
de distribuição de pagamentos (RC2+), **sem alterar nenhuma regra fiscal**.

## Fluxograma

```
Itens da venda (já com valor_fiscal / valor_nao_fiscal por item)
        │
        ▼
calcularTotaisDistribuidos  (regra histórica — inalterada)
        │
        ▼
FiscalOperacionalService.montarFromTotais / montarFromItens
        │
        ▼
FiscalOperacionalResult
  · valorFiscalMaximo
  · valorFiscalMinimo      (= máximo nesta RC1)
  · valorFiscalEfetivo     (= máximo nesta RC1)
  · valorNaoFiscal
  · margemFiscalDisponivel (= 0 nesta RC1)
  · possuiMargemFiscal     (= false nesta RC1)
        │
        ▼
Consumidores (Venda / MIDP / Orquestrador)
  via getters: valorFiscal, totalFiscal, totalNaoFiscal
```

## Contrato oficial

```json
{
  "valorFiscalMaximo": 0,
  "valorFiscalMinimo": 0,
  "valorFiscalEfetivo": 0,
  "valorNaoFiscal": 0,
  "margemFiscalDisponivel": 0,
  "possuiMargemFiscal": false,
  "versao": "RC1",
  "algoritmo": "separarItensDistribuidos",
  "tempoMs": 0
}
```

### Regras RC1 (formalização apenas)

| Campo | Valor nesta RC1 |
|-------|-----------------|
| `valorFiscalEfetivo` | `= valorFiscalMaximo` |
| `valorFiscalMinimo` | `= valorFiscalMaximo` |
| `margemFiscalDisponivel` | `0` |
| `possuiMargemFiscal` | `false` |

Nenhum cálculo novo. Nenhuma inteligência. Nenhuma política.

## Campos

| Campo | Descrição |
|-------|-----------|
| `valorFiscalMaximo` | Total fiscal atual (soma de `valor_fiscal` dos itens) |
| `valorFiscalMinimo` | Reserva para RC2 (hoje = máximo) |
| `valorFiscalEfetivo` | Valor fiscal usado operacionalmente (hoje = máximo) |
| `valorNaoFiscal` | Total não fiscal |
| `margemFiscalDisponivel` | Diferença máximo − mínimo (hoje 0) |
| `possuiMargemFiscal` | Indica se há margem configurável (hoje false) |
| `versao` | `RC1` |
| `algoritmo` | `separarItensDistribuidos` |
| `tempoMs` | Tempo de montagem do resultado |

## Compatibilidade

| Getter / alias | Aponta para |
|----------------|-------------|
| `valorFiscal` | `valorFiscalEfetivo` |
| `totalFiscal` | `valorFiscalEfetivo` |
| `totalNaoFiscal` | `valorNaoFiscal` |

`separarItensDistribuidos()` passa a retornar `FiscalOperacionalResult`.  
Destructuring legado continua válido:

```js
const { totalFiscal, totalNaoFiscal } = separarItensDistribuidos(itens);
```

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `backend/motores/fiscal-nao-fiscal/FiscalOperacionalResult.js` | Contrato |
| `backend/motores/fiscal-nao-fiscal/FiscalOperacionalService.js` | Montagem |
| `backend/motores/fiscal-nao-fiscal/FiscalOperacionalLogger.js` | Logs |
| `backend/motores/fiscal-nao-fiscal/index.js` | Fachada |
| `backend/services/fiscalNaoFiscalService.js` | Integração + soma histórica |

## O que este motor NÃO conhece

MIDP · pagamentos · PIX · TEF · dinheiro · cartão · Comercial · PDV · Consignação · NFC-e · Financeiro

## O que NÃO foi alterado

- Regras fiscais / estoque  
- MIDP / `DistribuidorPagamento`  
- Financeiro / TEF / NFC-e  
- Motor Comercial / Motor Estoque  

## Roadmap RC2

1. Introduzir `valorFiscalMinimo` real (política / configuração).  
2. Calcular `margemFiscalDisponivel = máximo − mínimo`.  
3. Expor `possuiMargemFiscal` quando margem > 0.  
4. Permitir que o MIDP escolha `valorFiscalEfetivo` dentro da margem  
   (sem este motor conhecer meios de pagamento).  

## Testes

```bash
node backend/motores/fiscal-nao-fiscal/tests/fiscal-operacional-rc1.test.js
```

Cenários: somente fiscal, somente não fiscal, mista, PDV, Comercial,  
Consignação, Pedido, Orçamento, API — paridade com totais legados.
