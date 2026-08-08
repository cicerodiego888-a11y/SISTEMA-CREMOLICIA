# RCM-8.0 — Arquitetura Oficial de Precificação (Implementação)

| Campo | Valor |
|---|---|
| Sprint | RCM-8.0 |
| Data | 2026-08-06 |
| Natureza | Implementação definitiva · fluxo único |
| Banco | Sem novas tabelas/campos |

---

## Fluxo oficial (único)

```text
Operação → Tabela da Operação → Resolver Oficial → Preço → Snapshot

Produto possui Linha?
  SIM → Tabela → Linha → Unidade → Preço
  NÃO → Tabela → Produto → Unidade → Preço
  Sem célula → Preço de Segurança
```

Retorno do Resolver: `preco`, `unidade_comercial`, `origem`, `tabela_preco_id`.

---

## O que mudou

### Resolver (`ComercialPrecoResolver.js`)
- Removidos: `linha_comercial_valores`, tabela×canal sem referência, “compat” opacos.
- Tabela×Produto é **oficial** quando o produto **não tem** Linha.
- Com Linha e sem célula → Preço de Segurança (não mascara com Produto).

### Tabelas de Preço (UI RA-6)
- Grade aceita **Linha** ou **Produto** (nunca os dois no mesmo registro).
- Payload: `valores` (linhas) + `itens_produto` (produtos).
- Reusa `tabela_preco_valores` e `tabela_preco_produto_itens`.

### Persistência de itens produto
- Não espelha mais em `tabela_preco_valores` sem linha.
- Não grava `produtos.tabela_preco_id` ao salvar itens.

### PDV
- Removido `obterPrecoAtacado` / faixas `produto_atacado`.
- Balança passa pelo Resolver.
- Promoções e desconto manual permanecem **após** o preço resolvido.
- Atacado = canal/tabela Atacado via Resolver (recalc do carrinho).

### Comercial
- Consignação já usava o mesmo `resolver-precos` — mantido.
- Referência VAREJO no orquestrador não reutiliza mais a tabela do canal atual.

---

## Critérios de aceite

| # | Critério | Status |
|---|---|---|
| 1 | Um único Resolver | ✔ |
| 2 | Linha opcional no produto | ✔ |
| 3 | Linha tem prioridade | ✔ |
| 4 | Sem Linha → Produto | ✔ |
| 5 | Mesmo fluxo PDV/Comercial | ✔ |
| 6 | Legado de lista removido do PDV | ✔ |
| 7 | Sem migration | ✔ |

---

## Teste

```bash
node backend/modules/comercial/tests/rcm80-arquitetura-oficial.test.js
node backend/modules/comercial/tests/rcm81-certificacao-precificacao.test.js
```

Certificação de produção: `docs/CERTIFICACAO_RCM81_PRECIFICACAO.md` (RCM-8.1).

Cadastro de Produtos alinhado: `docs/RCM82_CADASTRO_PRODUTO.md` (RCM-8.2).

Limpeza final do cadastro (sem margem/faixas atacado na UI): `docs/RCM862_LIMPEZA_CADASTRO_PRODUTO.md` (RCM-8.6.2).

Central de Precificação: `docs/RCM83_CENTRAL_PRECIFICACAO.md` (RCM-8.3).

PDV consumidor puro do Motor: `docs/RCM84_PDV_MOTOR_OFICIAL.md` (RCM-8.4).

Motor Comercial Unificado: `docs/RCM85_MOTOR_COMERCIAL_UNIFICADO.md` (RCM-8.5).

**Certificação e congelamento:** `docs/ARQUITETURA_FINAL_RCM86.md` (RCM-8.6).

Consolidação do domínio na UX: `docs/RCM87_DOMINIO_COMERCIAL.md` (RCM-8.7).

---

## Operação

1. Recarregar ERP/PDV (Ctrl+F5).
2. Tabelas: cadastrar preços por Linha e/ou Produto (sem Linha).
3. PDV: validar Varejo/Atacado via Resolver (sem faixas antigas).
