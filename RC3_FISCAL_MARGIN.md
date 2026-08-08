# RC3 — Cálculo da Margem Fiscal

**Sprint:** 3.8E.3  
**Versão:** RC3  
**Data:** 2026-07-29  

## Objetivo

Calcular oficialmente a **Margem Fiscal Disponível** da venda  
(`máximo − mínimo`), **sem alterar o Valor Fiscal Efetivo**.

A margem fica disponível para o MIDP RC3 — ainda **não é utilizada**  
para mudar pagamentos, NFC-e ou financeiro.

## Fluxograma

```
Itens / Totais / Distribuição
        │
        ▼
FiscalIntervalCalculator (orquestra)
        │
        ▼
FiscalMarginCalculator
  · valorFiscalMaximo = soma atual de valor_fiscal
  · valorFiscalMinimo = piso permitido
  · margem = máximo − mínimo
  · possuiMargemFiscal = margem > 0
        │
        ▼
FiscalIntervalResult
        │
        ▼
FiscalOperacionalService
  · valorFiscalEfetivo = valorFiscalMaximo  ← INALTERADO
  · propaga mínimo / margem
        │
        ▼
FiscalOperacionalResult
```

## Como a margem é calculada

### Valor Fiscal Máximo

Sempre a soma atual dos `valor_fiscal` dos itens  
(distribuição fiscal já realizada pelo motor de estoque).

### Valor Fiscal Mínimo (piso)

Por item, na ordem:

1. **Com saldos de estoque** (`saldo_fiscal`, `saldo_nao_fiscal`, quantidade):  
   recalcula a distribuição **priorizando não fiscal**  
   (`distribuirQuantidadeVenda(..., vendaFiscal=false)`).  
   O valor fiscal resultante é o piso do item  
   (limitado ao `valor_fiscal` atual).

2. **Sem saldos** (apenas valores já distribuídos):
   - Item **puramente fiscal** (`valor_nao_fiscal ≈ 0`) → piso = `valor_fiscal` (travado)
   - Item **misto** (fiscal e não fiscal > 0) → piso = `0` (parcela fiscal flexível)
   - Item **puramente não fiscal** → piso = `0`

3. Mínimo total = soma dos pisos, limitado a `[0, máximo]`.

### Margem

```
margemFiscalDisponivel = valorFiscalMaximo − valorFiscalMinimo
possuiMargemFiscal = margemFiscalDisponivel > 0
```

## Quando existe margem

| Cenário | Margem |
|---------|--------|
| Somente itens puramente fiscais | Zero |
| Somente itens não fiscais | Zero |
| Totais sem lista de itens | Zero (sem flexibilidade inferível) |
| Item misto (fiscal + não fiscal no mesmo item) | Positiva |
| Item puro fiscal + item misto | Positiva (trava o puro) |
| Estoque permite reduzir fiscal priorizando NF | Positiva |

## Quando não existe

- Venda 100% fiscal (sem parcela não fiscal nos itens)
- Venda 100% não fiscal
- Chamada só com totais agregados (sem itens)

## Exemplos

### Exemplo 1 — margem zero (só fiscal)

```
Item A: fiscal 100 / NF 0
→ máximo 100, mínimo 100, margem 0
→ efetivo 100
```

### Exemplo 2 — margem positiva (item misto)

```
Item A: fiscal 71,20 / NF 35,60
→ máximo 71,20, mínimo 0,00, margem 71,20
→ efetivo 71,20  (ainda = máximo)
```

### Exemplo 3 — piso parcial

```
Item A: fiscal 70 / NF 0   (travado)
Item B: fiscal 30 / NF 20  (flexível)
→ máximo 100, mínimo 70, margem 30
→ efetivo 100
```

## Compatibilidade

- `valorFiscalEfetivo` **sempre** = `valorFiscalMaximo`
- Totais financeiros / NFC-e / MIDP de pagamento **não mudam**
- Getters `valorFiscal` / `totalFiscal` / `totalNaoFiscal` preservados

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `FiscalMarginCalculator.js` | Cálculo da margem |
| `FiscalIntervalCalculator.js` | Orquestra margin → interval |
| `tests/fiscal-margin-rc3.test.js` | Casos de margem |

## Roadmap (MIDP RC3)

1. MIDP consome `valorFiscalMinimo` / `margemFiscalDisponivel`
2. Políticas (ex.: Preservar Dinheiro) escolhem efetivo dentro do intervalo
3. Só então o efetivo poderá diferir do máximo
