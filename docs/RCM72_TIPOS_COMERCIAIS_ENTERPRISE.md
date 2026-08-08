# RCM-7.2 — Evolução Enterprise dos Tipos Comerciais

| Campo | Valor |
|---|---|
| Sprint | RCM-7.2 |
| Data | 2026-08-06 |
| Base | RCM-7.1 + RA-6.9 |
| Escopo | Canais Permitidos (N:N) · Cadastro · PDV · Validação Consignação |

---

## Arquitetura oficial

```text
CLIENTE
        │
        ▼
Tipo Comercial
        │
        ├──────────────┐
        ▼              ▼
Canal Padrão      Canais Permitidos
        │              │
        └──────┬───────┘
               ▼
Tabela Ativa do Canal
               ▼
Resolver Oficial
               ▼
Preço
```

Cliente continua conhecendo **apenas** o Tipo Comercial (sem Tabela / Linha).

---

## Entidade

| Campo | Observação |
|---|---|
| Código / Descrição / Canal Padrão / Ativo / Observações | RCM-7.1 |
| **Canais Permitidos** | RCM-7.2 — relação N:N `tipo_comercial_canais` |

Regra: o **Canal Padrão** deve sempre estar na lista de permitidos (garantido no service).

---

## Compatibilidade RCM-7.1

Tipos existentes recebem automaticamente:

`Canal Permitido = Canal Padrão`

Seeds enterprise (extras):

| Tipo | Padrão | Permitidos |
|---|---|---|
| Consumidor Final | VAREJO | VAREJO |
| Atacadista | ATACADO | ATACADO, EVENTO |
| Revendedor | ATACADO | ATACADO, CONSIGNADO, EVENTO |
| Distribuidor | ATACADO | ATACADO, CONSIGNADO, DELIVERY |
| Cliente Especial | VAREJO | VAREJO, DELIVERY, EVENTO |

---

## Cadastro

**Configurações → Comercial → Tipos Comerciais**

Aba **Canais Permitidos**: checkboxes dos canais ativos.  
Canal Padrão aparece marcado e não pode ser desmarcado.

---

## PDV

| Situação | Comportamento |
|---|---|
| 1 canal permitido | Seleciona automaticamente |
| Vários canais | Usa Canal Padrão |
| Troca manual | Somente canais autorizados |
| Canal não autorizado | Bloqueado (aviso) |

---

## Consignação

Continua com `canal_manual = CONSIGNADO` (fluxo inalterado).

Validação soft: se o Tipo do cliente **não** permite CONSIGNADO, exibe aviso.

Configurável: `localStorage.CDS_AVISO_CONSIGNACAO_CANAL` (`1` = liga aviso; **default desligado**).

Motivo (RCM-7.2.1): `canal_manual = CONSIGNADO` tem prioridade absoluta — Consumidor Final e demais Tipos sem CONSIGNADO na lista **podem** consignar sem alerta operacional.

---

## Resolver

**Sem alteração.** Continua recebendo Canal (+ produto/linha/tabela) e devolvendo Preço.

---

## APIs

| Método | Rota | Uso |
|---|---|---|
| CRUD | `/api/tipos-comerciais` | body aceita `canais_permitidos` |
| POST | `/api/tipos-comerciais/resolver-canal` | retorna `canais_permitidos_codigos` |
| POST | `/api/tipos-comerciais/validar-canal` | `{ cliente_id, canal }` → `{ permitido }` |

---

## Critérios de aceite

| # | Critério | Status |
|---|---|---|
| 1 | Cliente desacoplado da Tabela | ✓ |
| 2 | Cliente desacoplado da Linha | ✓ |
| 3 | Tipo com múltiplos canais | ✓ |
| 4 | Canal padrão permanece | ✓ |
| 5 | Resolver único | ✓ |
| 6 | Compat RCM-7.1 | ✓ |
| 7 | Arquitetura de Precificação intacta | ✓ |

---

## Arquivos

| Área | Path |
|---|---|
| Migration | `019_tipos_comerciais_canais.js` |
| Service/Repo | `tipos-comerciais/` |
| UI | `tipos-comerciais.html` / `.js` |
| PDV | `frontend/pdv/js/pdv.js` |
| Consignação | `NovaConsignacao/index.js` |
| Testes | `rcm72-tipos-comerciais-enterprise.test.js` |
