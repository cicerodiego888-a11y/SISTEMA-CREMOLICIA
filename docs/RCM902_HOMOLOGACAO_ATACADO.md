# RCM-9.0.2 — Homologação Final da Contagem do Atacado

| Campo | Valor |
|---|---|
| Sprint | RCM-9.0.2 |
| Data | 2026-08-07 |
| Natureza | UX + log + homologação · sem mudança arquitetural |

---

## Ajustes

1. **Barra PDV** (`ComercialStatusCard`): exibe `29 / 30 Itens Comerciais` (compact) ou `29 de 30 Itens para Atacado` — inteiros, sem quantidade física.
2. **Log** ao ativar ATACADO por contagem (`pdv.js`):

```text
[RCM-9.0.2][ATACADO]

Itens Comerciais: 30

Canal: ATACADO

Origem: Contagem Comercial
```

3. **Cenários homologados** (regra RCM-9.0.1):

| Carrinho | Contagem | Atacado (mín. 30) |
|---|---|---|
| 30 picolés | 30 | Sim |
| 29 + 1 pote 0,250 KG | 30 | Sim |
| 28 + 2 potes | 30 | Sim |
| 30 potes | 30 | Sim |
| 29 picolés | 29 | Não |

## Teste

```bash
node backend/modules/comercial/tests/rcm902-homologacao-atacado.test.js
```
