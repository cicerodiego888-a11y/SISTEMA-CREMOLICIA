# RA-6.6 — Unidade de Comercialização por Tabela de Preços

| Campo | Valor |
|---|---|
| Tipo | Consolidação arquitetural |
| Base | RA-6 / RA-6.3 / RA-6.4 / RA-6.5.1 |
| Não altera | Estoque, Fiscal, Ledger, Outbox, MUC, APIs públicas |

---

## Arquitetura oficial

```text
Produto
    ↓
Linha de Precificação
    ↓
Tabela de Preços
    ↓
Unidade de Comercialização
    ↓
Preço
    ↓
MUC (conversão → Unidade Base)
    ↓
Estoque
```

---

## Exemplo

Produto **Sorvete Chocolate** — Unidade Base de Estoque: **KG**

| Tabela | Linha | Unidade Comercial | Preço |
|---|---|---|---|
| Varejo | SORVETES | KG | 58,00 |
| Atacado | SORVETES | LITRO | 28,00 |
| Consignado | SORVETES | LITRO | 26,00 |
| Evento | SORVETES | LITRO | 30,00 |

A mesma Linha é cotada em unidades diferentes conforme a Tabela (canal).

---

## Grade da Tabela de Preços

Colunas oficiais:

1. **Linha de Precificação**
2. **Unidade de Comercialização**
3. **Preço**

### Forma — por que não está na grade

**Forma** (`forma_comercializacao`) **não é redundante** com Unidade para:

- `CASQUINHA` / `KIT` / `PERSONALIZADA` — controlam fluxos específicos do PDV

Para `UNIDADE` / `PESO` / `VOLUME`, Forma e Unidade se sobrepõem (UN/KG/LITRO).

Decisão RA-6.6:

- Grade UX: só Unidade + Preço
- Schema: Forma permanece
- Ao gravar sem Forma: o backend **infere** Forma a partir da Unidade (KG→PESO, LITRO→VOLUME, demais→UNIDADE)

---

## Resolver

Retorna sempre:

- `preco` / `preco_venda`
- `unidade_comercial`
- `unidade_rotulo`
- `forma_comercializacao` (derivada ou persistida)

### Compatibilidade

Se `unidade_comercial` na célula for **NULL**:

→ usa a **Unidade Base** do produto (`produto.unidade`).

---

## Cadastro do Produto

Continua apenas:

- Linha de Precificação
- Preço de Segurança
- Unidade Base de Estoque

Nenhuma Unidade Comercial é cadastrada no produto para precificação por canal.

---

## PDV

Consome `resolver-precos` e aplica **Preço + Unidade Comercial** automaticamente, sem escolha manual por canal.

---

## MUC

Quando Unidade Comercial ≠ Unidade Base:

- Resolver entrega preço + unidade comercial
- **MUC** converte quantidade para a Unidade Base do estoque
- Não duplicar lógica de conversão no Resolver/PDV

---

## Critérios de aceite

- [x] Unidade de Comercialização pertence à Tabela
- [x] Produto possui apenas Unidade Base (para estoque)
- [x] Resolver retorna Preço + Unidade Comercial
- [x] MUC permanece responsável pelas conversões
- [x] Forma documentada e mantida no schema (fora da grade)
- [x] Sem alteração fiscal / estoque / ledger / outbox
