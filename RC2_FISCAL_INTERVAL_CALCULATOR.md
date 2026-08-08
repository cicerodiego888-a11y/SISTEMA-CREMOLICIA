# RC2 — Fiscal Interval Calculator

**Sprint:** 3.8E.2  
**Versão:** RC2  
**Data:** 2026-07-29  

## Objetivo

Centralizar o cálculo do **intervalo fiscal permitido** da venda em  
`FiscalIntervalCalculator`, isolando máximo / mínimo / margem do restante  
do motor — **sem alterar o Valor Fiscal Efetivo** nesta sprint.

## Fluxograma

```
Itens / Totais / Distribuição existente
        │
        ▼
FiscalIntervalCalculator.calcular()
        │
        ▼
FiscalIntervalResult
  · valorFiscalMaximo
  · valorFiscalMinimo
  · margemFiscalDisponivel
  · possuiMargemFiscal
        │
        ▼
FiscalOperacionalService
  · lê intervalo
  · valorFiscalEfetivo = valorFiscalMaximo  (inalterado vs RC1)
  · valorNaoFiscal = total não fiscal
        │
        ▼
FiscalOperacionalResult  (contrato funcional igual ao RC1)
```

## Contratos

### FiscalIntervalResult

```json
{
  "valorFiscalMaximo": 0,
  "valorFiscalMinimo": 0,
  "margemFiscalDisponivel": 0,
  "possuiMargemFiscal": false,
  "algoritmo": "FiscalIntervalCalculator.RC2",
  "versao": "RC2",
  "tempoMs": 0
}
```

### Regras RC2 (isolamento — sem inteligência)

| Campo | Valor nesta RC2 |
|-------|-----------------|
| `valorFiscalMaximo` | = valor fiscal atual |
| `valorFiscalMinimo` | = valor fiscal atual |
| `margemFiscalDisponivel` | `0` |
| `possuiMargemFiscal` | `false` |

### FiscalOperacionalResult

Sem alteração funcional:

- `valorFiscalEfetivo` continua `= valorFiscalMaximo`
- Getters `valorFiscal` / `totalFiscal` / `totalNaoFiscal` preservados
- Apenas a **origem** de máximo / mínimo / margem muda (vem do calculator)

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `FiscalIntervalCalculator.js` | Cálculo do intervalo |
| `FiscalIntervalResult.js` | Contrato do intervalo |
| `FiscalOperacionalService.js` | Consome o calculator |
| `tests/fiscal-interval-rc2.test.js` | Paridade |

## O que este componente NÃO conhece

MIDP · Pagamento · PIX · TEF · Dinheiro · Cartão ·  
Comercial · PDV · Consignação · Pedido · Orçamento

## O que NÃO foi alterado

- Valor Fiscal Efetivo (regra)  
- MIDP / DistribuidorPagamento  
- Financeiro / NFC-e / TEF  

## Roadmap RC3

1. Implementar o **primeiro cálculo real de margem** (mínimo ≠ máximo).  
2. Definir regras de itens/saldos que reduzem o mínimo fiscal.  
3. Expor `possuiMargemFiscal = margem > 0`.  
4. Preparar consumo pelo MIDP do intervalo (sem o calculator conhecer pagamentos).  

## Testes

```bash
node backend/motores/fiscal-nao-fiscal/tests/fiscal-interval-rc2.test.js
node backend/motores/fiscal-nao-fiscal/tests/fiscal-operacional-rc1.test.js
```
