# RCM-7.2.1 — Canal da Operação na Nova Consignação

| Campo | Valor |
|---|---|
| Sprint | RCM-7.2.1 |
| Data | 2026-08-06 |
| Base | RCM-7.2 |
| Escopo | Bugfix — Canal Manual na Preparar Entrega / Nova Consignação |

---

## Bug

A tela **Preparar Entrega / Nova Consignação** exibia o Canal derivado do Tipo Comercial do Cliente (ex.: VAREJO), em vez do canal oficial da operação (**CONSIGNADO**).

---

## Arquitetura oficial (ordem do Resolver)

```text
1) canal_manual          ← prioridade absoluta
2) Tipo Comercial        ← canal padrão / permitido
3) Fallback              ← VAREJO / regras de atacado
```

Na consignação, a UI **sempre** envia `canal_manual = CONSIGNADO` antes da resolução e **nunca** usa o Canal Padrão do Cliente no card.

---

## Correção

| Ponto | Comportamento |
|---|---|
| Estado inicial | `data.canalVenda = CONSIGNADO` |
| Card | Título **Canal da Operação** · 🟢 **CONSIGNADO** |
| `resolver-precos` | `{ canal: 'CONSIGNADO' }` sem `cliente_id` |
| Snapshot do item | `canalVenda = CONSIGNADO` |
| Aceite de tela | Nunca VAREJO / ATACADO / DELIVERY como Canal da Operação |

---

## Critério de aceite

Nenhuma tela de Consignação poderá exibir VAREJO, ATACADO ou DELIVERY como **Canal da Operação**.

O Canal deverá ser sempre **CONSIGNADO** durante todo o fluxo da consignação.
