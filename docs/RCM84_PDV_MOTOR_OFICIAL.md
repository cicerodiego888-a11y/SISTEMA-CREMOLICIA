# RCM-8.4 — Integração Total do PDV com o Motor Oficial

| Campo | Valor |
|---|---|
| Sprint | RCM-8.4 |
| Data | 2026-08-06 |
| Base | RCM-8.0 … RCM-8.3 |
| Natureza | PDV = consumidor puro do Resolver |

---

## Fluxo oficial

```text
Código → Produto → Motor Oficial → Preço → Carrinho → Venda
```

Alterações de **quantidade**, **cliente** e **canal** disparam `resolver-precos` e atualizam o carrinho sem removê-lo.

---

## O que mudou

| Área | Comportamento |
|---|---|
| Preço de lista | Somente `ComercialPrecoResolver` via `resolver-precos` |
| Snapshot no item | `tabela`, `linha`, `origem`, `unidade`, `resolver` |
| Detalhes | Botão “Detalhes da Precificação” no item |
| UC / MUC | Preço pelo Resolver (unidade só identifica estoque) |
| Kit FIXO | Preço próprio (congelado) |
| Kit lista/SOMA | Preço pelo Resolver |
| Oferta UNIDADE | `preco_unidade` congelado (não é lista) |
| Promo / desconto | Após o Resolver |
| Balança | Enrich → Resolver → peso |
| Logs | `[RCM-8.4][PDV][Resolver]` JSON + tempo_ms |
| Mobile | Kit FIXO vs lista; MUC via Resolver |

---

## Critérios

| Critério | Status |
|---|---|
| Sem regra de preço no PDV (lista) | ✔ |
| Qty / cliente / canal recalculam | ✔ |
| Carrinho com snapshot | ✔ |
| Balança / kits / promo | ✔ |

---

## Teste

```bash
node backend/modules/comercial/tests/rcm84-pdv-motor-oficial.test.js
```
