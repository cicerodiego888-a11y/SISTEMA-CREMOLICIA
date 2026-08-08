# RCM-8.5 — Motor Comercial Unificado

| Campo | Valor |
|---|---|
| Sprint | RCM-8.5 |
| Data | 2026-08-06 |
| Base | RCM-8.0 … RCM-8.4 |
| Natureza | Comercial = mesmo Motor do PDV |

---

## Princípio

```text
Operação Comercial → Resolver Oficial → Preço → Snapshot → Documento
```

PDV e Comercial são canais distintos com o **mesmo** `ComercialPrecoResolver`.

---

## Escopo coberto

| Canal | Status |
|---|---|
| Consignação desktop | Já usava Resolver; + Detalhes + Comparar Tabelas |
| Consignação mobile | Agora resolve CONSIGNADO + snapshot antes do POST |
| Pedido / Orçamento / CRM / Representantes | Contrato unificado (`ComercialMotorUnificado.js`) — mesmo endpoint quando módulos nascerem |
| PDV | RCM-8.4 (inalterado) |

---

## APIs

```
POST /configuracao-comercial/resolver-precos   → preço oficial
POST /configuracao-comercial/comparar-tabelas → painel informativo
```

Logs: `[RCM-8.5][COMERCIAL][Resolver]`

---

## Snapshot imutável

Após gerar o documento (RCM-6.1), o item guarda: produto, linha, tabela, UC, preço, origem, quantidade, total, resolver.

Consignação **não** recalcula preço após congelar.

---

## Comparar Tabelas

Informativo. Mostra o mesmo produto em Varejo / Atacado / Consignação / Evento / Delivery. **Não altera** a tabela da operação.

---

## Teste

```bash
node backend/modules/comercial/tests/rcm85-motor-comercial-unificado.test.js
```

---

## Critérios

| Critério | Status |
|---|---|
| Mesmo Resolver do PDV | ✔ |
| Mobile alinhado | ✔ |
| Snapshot | ✔ |
| Comparar Tabelas | ✔ |
| Logs | ✔ |
| APIs unificadas | ✔ |
