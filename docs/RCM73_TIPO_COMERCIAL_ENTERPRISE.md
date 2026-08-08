# RCM-7.3 — Tipo Comercial Enterprise (Visão e UI)

| Campo | Valor |
|---|---|
| Sprint | RCM-7.3 |
| Data | 2026-08-06 |
| Base | RCM-7.1 / RCM-7.2 |
| Escopo | Organização em abas · layout preparado · **sem novas regras** |

---

## Objetivo

Preparar o **Tipo Comercial** como centro futuro das regras comerciais do CDS, **sem alterar** comportamento atual.

O Cliente continua conhecendo **apenas** o Tipo Comercial.

---

## Arquitetura (visão)

```text
CLIENTE
      │
      ▼
TIPO COMERCIAL
      │
      ├──────── Canal Padrão          ← ativo (RCM-7.2)
      ├──────── Canais Permitidos     ← ativo (RCM-7.2)
      ├──────── Condição Comercial    ← preparado
      ├──────── Crédito               ← preparado
      ├──────── Aprovação / Desconto  ← preparado
      └──────── Regras futuras        ← preparado
                │
                ▼
Canal → Tabela Ativa → Resolver Oficial → Preço
```

Resolver, Precificação, MUC, Fiscal, Ledger, Outbox, Consignação e Atacado: **inalterados**.

---

## Organização da tela

**Configurações → Comercial → Tipos Comerciais**

| Aba | Conteúdo | Persistência |
|---|---|---|
| **1 · Geral** | Código, Descrição, Ativo, Observações | ✓ |
| **2 · Canais** | Canal Padrão + Canais Permitidos | ✓ |
| **3 · Crédito** | Limite / Usar Limite / Ultrapassar | layout only |
| **4 · Condições** | Condição Pagamento / Tabela Financeira / Dias | layout only |
| **5 · Descontos** | Desconto Máximo / Aprovação | layout only |
| **6 · Regras** | Consignação / Bonificação / Venda Negativa / Pedido Especial | layout only |

Campos preparados estão em `<fieldset disabled>` e **nunca** entram no payload de salvar.

---

## Persistência oficial (inalterada)

```text
codigo
descricao
ativo
observacoes
canal_padrao
canais_permitidos
```

---

## Compatibilidade

| Item | Status |
|---|---|
| RCM-7.1 (Tipo no Cliente) | 100% |
| RCM-7.2 (Canais Permitidos) | 100% |
| Cliente | sem alteração |
| Motor Comercial / Resolver | sem alteração |
| Preços | sem alteração |

---

## Critérios de aceite

| # | Critério | Status |
|---|---|---|
| 1 | Tipo preparado para evolução | ✓ |
| 2 | Cliente permanece simples | ✓ |
| 3 | Resolver inalterado | ✓ |
| 4 | Compatibilidade preservada | ✓ |
| 5 | Nenhuma regra comercial nova | ✓ |
| 6 | Interface pronta para o futuro | ✓ |

---

## Arquivos

| Área | Path |
|---|---|
| UI | `frontend/erp/pages/tipos-comerciais.html` |
| JS | `frontend/erp/js/tipos-comerciais.js` |
| Testes | `backend/modules/comercial/tests/rcm73-tipo-comercial-enterprise-ui.test.js` |
