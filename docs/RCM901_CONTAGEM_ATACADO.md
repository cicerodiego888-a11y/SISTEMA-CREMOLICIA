# RCM-9.0.1 — Ajuste da Contagem de Atacado

| Campo | Valor |
|---|---|
| Sprint | RCM-9.0.1 |
| Data | 2026-08-07 |
| Natureza | Correção localizada · `CanalVendaResolver` |
| Banco | Sem alteração |

---

## Regra

| Forma | Contagem |
|---|---|
| UNIDADE, CASQUINHA, KIT, PERSONALIZADA | Quantidade da linha |
| PESO, VOLUME | **1** por linha do carrinho |

Exemplo Cremolicia: 29 UNIDADE + 0,250 PESO → **30** → Atacado.  
Estoque continua −29 UN e −0,250 KG (MUC inalterado).

---

## Escopo

- Alterado: `CanalVendaResolver.js` (+ enrich de `forma_comercializacao`)
- PDV: `montarItensResolverCanalPdv` envia a forma já existente no item
- **Não** alterado: preço, MUC, estoque, Central, Snapshot, schema

## Teste

```bash
node backend/modules/comercial/tests/rcm901-contagem-atacado.test.js
```
