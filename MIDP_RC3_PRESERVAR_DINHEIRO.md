# MIDP RC3 — Preservar Dinheiro

**Sprint:** 3.8D.3  
**Versão:** RC3  
**Data:** 2026-07-29  

## Objetivo

Implementar a política oficial `PRESERVAR_DINHEIRO`, que decide o  
**Valor Fiscal Efetivo Proposto** dentro do intervalo fornecido pelo  
Motor Fiscal × Não Fiscal — **sem alterar** esse motor.

## Princípio

| Responsável | Decide |
|-------------|--------|
| Motor Fiscal | `valorFiscalMaximo`, `valorFiscalMinimo`, `margemFiscalDisponivel` |
| MIDP | `valorFiscalEfetivoProposto` ∈ [mínimo, máximo] |
| DistribuidorPagamento | Rateio dos meios com totais finais apenas |

## Fluxograma

```
FiscalOperacionalResult + pagamentos[]
        │
        ▼
MidpPolicyFactory → PRESERVAR_DINHEIRO
        │
        ▼
PreservarDinheiroPolicy
  1. Lê intervalo (não recalcula)
  2. Soma meios eletrônicos (exceto dinheiro)
  3. Decide valorFiscalEfetivoProposto
  4. economia = máximo − proposto
  5. naoFiscal' = naoFiscal + economia
        │
        ▼
MidpDecisionResult
        │
        ▼
MidpEngine → DistribuidorPagamento(proposto, naoFiscal', pagamentos)
        │
        ▼
MidpResult (+ decisao)
```

## Algoritmo

```
se NÃO possuiMargemFiscal:
  proposto = valorFiscalMaximo
senão:
  eletronico = Σ(PIX, TEF, débito, crédito, voucher, transferência, …)
  proposto = min(máximo, max(mínimo, eletronico))

economiaDinheiro = máximo − proposto
valorNaoFiscal' = valorNaoFiscal + economiaDinheiro
```

`proposto` é sempre clampado em `[mínimo, máximo]`.

### Meios eletrônicos

`pix`, `pix_tef`, `cartao`, `cartao_debito`, `cartao_credito`, `credito`,  
`debito`, `tef`, `voucher`, `vale_*`, `transferencia`, `deposito`  

**Excluído:** `dinheiro`.

## Exemplos

| Máx | Mín | Eletrônico | Proposto | Economia |
|-----|-----|------------|----------|----------|
| 100 | 82  | 90         | 90       | 10       |
| 100 | 82  | 70         | 82       | 18       |
| 100 | 82  | 150        | 100      | 0        |
| 100 | 100 | qualquer   | 100      | 0 (sem margem) |

## Contrato MidpDecisionResult

```json
{
  "valorFiscalEfetivoProposto": 0,
  "valorNaoFiscal": 0,
  "economiaDinheiro": 0,
  "politica": "PRESERVAR_DINHEIRO",
  "algoritmo": "PreservarDinheiroPolicy.RC3",
  "versao": "RC3",
  "tempoMs": 0
}
```

## Configuração

| `midp_politica` | Comportamento |
|-----------------|---------------|
| `LEGADO` | Sempre distribui com `valorFiscalMaximo` (idêntico ao RC2) |
| `PRESERVAR_DINHEIRO` | Usa `valorFiscalEfetivoProposto` |

## Compatibilidade

- Motor Fiscal / `FiscalOperacionalResult` / `FiscalIntervalResult` **imutáveis**
- `DistribuidorPagamento` **não conhece** margem nem política
- `LEGADO` → resultado idêntico ao RC2

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `MidpDecisionResult.js` | Contrato da decisão |
| `policies/PreservarDinheiroPolicy.js` | Algoritmo oficial |
| `tests/midp-rc3-preservar-dinheiro.test.js` | Casos |

## Testes

```bash
node backend/motores/midp/tests/midp-rc3-preservar-dinheiro.test.js
node backend/motores/midp/tests/midp-rc2.test.js
```
