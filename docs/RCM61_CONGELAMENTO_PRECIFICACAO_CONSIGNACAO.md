# RCM-6.1 — Congelamento Completo da Precificação da Consignação

| Campo | Valor |
|---|---|
| Sprint | RCM-6.1 |
| Data | 2026-08-06 |
| Base | Auditoria RCM-6 + Arquitetura RA-6.9 |
| Escopo | Item da Consignação (snapshot) · Gateway · Entrega · Prestação · MCC |

---

## Objetivo

Garantir que **toda Consignação congele completamente a precificação** no momento da preparação.

Após o item ser criado, **nunca mais** consulta Tabela de Preços / Linha / Produto para preço ou Unidade Comercial.

---

## Fluxo oficial

```text
Produto
    ↓
Linha de Precificação
    ↓
Tabela de Preços
    ↓
Canal (CONSIGNADO)
    ↓
Unidade Comercial
    ↓
Preço (+ Preço de Segurança se fallback)
    ↓
Resolver Oficial
    ↓
Item da Consignação (congelado)
    ↓
Entrega / Prestação / MCC / Estoque  ← somente dados do Item
```

---

## Dados congelados no Item

| Campo | Coluna | Descrição |
|---|---|---|
| Produto | `produto_id` | Já existia |
| Preço Unitário | `preco_unitario` | Já existia |
| Linha de Precificação | `linha_comercial_id` | RCM-6.1 ADD |
| Tabela utilizada | `tabela_preco_id` | RCM-6.1 ADD |
| Canal utilizado | `canal_venda` | RCM-6.1 ADD (ex.: `CONSIGNADO`) |
| Unidade Comercial | `unidade_comercial` | RCM-6.1 ADD |
| Origem do preço | `preco_origem` | RCM-6.1 ADD |
| Preço de Segurança? | `preco_fallback` | RCM-6.1 ADD (0/1) |

Esses campos são **imutáveis** após o insert (não há update de precificação no fluxo normal).

Migration: `012_rcm61_congelamento_precificacao` (ADD only).

---

## Responsabilidades

| Etapa | Responsabilidade |
|---|---|
| **Nova Consignação** | Chama Resolver com `canal: CONSIGNADO`; aplica preço + UC + linha + tabela + origem no item em memória; ao persistir, envia o snapshot completo |
| **AdicionarItemUseCase** | Persiste snapshot; se campos faltarem, completa via `ProdutoPlatformGateway.buscarPorId(id, { canal: 'CONSIGNADO' })` |
| **ProdutoPlatformGateway** | No fluxo de consignação, **obrigatório** informar `canal: CONSIGNADO` — nunca resolução implícita em VAREJO |
| **Entrega** | Usa exclusivamente `item.precoUnitario` (e UC do item quando relevante) — **não** consulta Produto/Linha/Tabela |
| **Prestação** | Usa `item.precoUnitario` + `item.unidadeComercial` (congelados) — **nunca recalcula** |
| **MCC / Estoque** | Recebe `unidadeOrigem` do item congelado |
| **Conta Corrente / Dashboard** | Continuam no **Ledger** — sem alteração |

---

## Unidade Comercial

1. Resolver retorna `unidade_comercial` da Tabela × Canal (RA-6.6).
2. Frontend aplica no item e envia no `POST .../itens`.
3. Repositório grava `unidade_comercial`.
4. Mapper expõe `unidade` / `unidadeComercial` a partir do snapshot.
5. Prestação → MCC → Estoque usam essa UC **sem perdas**.

---

## Compatibilidade (consignações antigas)

Itens sem `unidade_comercial` gravada:

- Usam a **Unidade Base do Produto** (`produtos.unidade`).
- Registram aviso interno (`[RCM-6.1] Item sem Unidade Comercial congelada…`) quando o fallback é materializado em operação MCC.
- Preço continua sendo o `preco_unitario` já gravado — sem reconsulta à tabela.

---

## Critérios de aceite

| # | Critério | Status |
|---|---|---|
| 1 | Item armazena toda a precificação | ✓ |
| 2 | UC percorre Entrega → Prestação → MCC | ✓ |
| 3 | Gateway usa canal CONSIGNADO na consignação | ✓ |
| 4 | Nenhum cálculo de preço após preparação | ✓ |
| 5 | Entrega/Prestação só usam dados congelados | ✓ |
| 6 | Compatibilidade preservada | ✓ |
| 7 | Arquitetura RA-6.9 respeitada | ✓ |

---

## Arquivos principais

| Área | Arquivo |
|---|---|
| Migration | `backend/motores/motor-comercial/migrations/012_rcm61_congelamento_precificacao.js` |
| Repo | `repositories/ConsignacaoItemRepository.js` |
| Mapper | `utils/comercialMapper.js` |
| Use case | `usecases/consignacao/AdicionarItemConsignacaoUseCase.js` |
| Gateway | `bridges/platform/ProdutoPlatformGateway.js` |
| Helper UC | `services/unidadeComercialCongelada.js` |
| Frontend | `frontend/.../NovaConsignacao/index.js` |
| Testes | `backend/motores/motor-comercial/tests/rcm61-congelamento-precificacao.test.js` |

---

## Fora de escopo (confirmado)

- Arquitetura da Precificação / regras do Resolver
- Fiscal · Ledger · Outbox · MUC (regras)
- APIs públicas (somente campos opcionais no body de add-item)
- Conta Corrente / Dashboard (Ledger)
