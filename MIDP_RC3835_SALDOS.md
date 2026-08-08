# SPRINT RC3.8D.3.5 — Propagar saldos ao Motor Fiscal

**Data:** 2026-07-30  
**Base:** `AUDITORIA_MIDP_RC3834.md`

## Correção

`VendaPagamentoService.js` — ao montar `distribuicaoItens` / preview:

```javascript
saldo_fiscal: Number(produto.saldo_fiscal),
saldo_nao_fiscal: Number(produto.saldo_nao_fiscal),
```

Caminhos: venda normal · `pularBaixaEstoque` · preview distribuição.

## Validação (simulação 553 · SF=4 · SNF=10 · PIX 10 + Dinheiro 5)

| Critério | Resultado |
|----------|-----------|
| `possuiMargemFiscal` | `true` (margem 15) |
| MIDP qF / qNF | **2 / 1** |
| Valores | **10 / 5** |
| PIX | fiscal |
| Dinheiro | não fiscal |
| Regressão 100% fiscal (SNF=0) | margem 0 · qF=3 intacto |
| Regressão 100% NF | qF=0 · NF intacto |

## Não alterado

Motor Fiscal · MIDP · XML · Distribuidor · schema
