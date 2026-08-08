# CERTIFICAÇÃO RCM-8.1 — Motor Oficial de Precificação

| Campo | Valor |
|---|---|
| Sprint | RCM-8.1 |
| Data | 2026-08-06 |
| Base | RCM-8.0 (arquitetura oficial) |
| Natureza | Homologação · certificação · sem novas funcionalidades |
| Suíte | `backend/modules/comercial/tests/rcm81-certificacao-precificacao.test.js` |
| Resultado | **CERTIFICADO** |

---

## Fluxo certificado

```text
Operação → Tabela da Operação → Resolver Oficial
  ├─ Com Linha  → Tabela × Linha → Preço (+ Unidade da Tabela)
  ├─ Sem Linha  → Tabela × Produto → Preço (+ Unidade da Tabela)
  └─ Sem célula → Preço de Segurança
→ Snapshot (imutável após documento)
```

Não existe outro caminho no Motor Oficial.

---

## Matriz dos 14 testes

| # | Cenário | Resultado |
|---|---|---|
| 1 | Produtos com Linha (Cremosa, Fruta c/ Água, Premium) | ✔ origem `tabela_preco_linha`, unidade/preço OK |
| 2 | Produtos sem Linha (Chocolate, Pistache) | ✔ origem `tabela_preco_produto` |
| 3 | Varejo | ✔ Linha + Produto + unidade + snapshot |
| 4 | Atacado | ✔ troca automática de canal + preço/unidade; sem faixas legado |
| 5 | Consignação | ✔ mesmo `resolver-precos` / `ComercialPrecoResolver` do PDV |
| 6 | Evento | ✔ canal manual + Resolver |
| 7 | Delivery | ✔ Linha + Produto |
| 8 | Unidade Comercial | ✔ KG (Varejo) / LT (Atacado/Consignação) vindos da **Tabela**; não do produto |
| 9 | Preço de Segurança | ✔ origem `produto.preco_venda`, `fallback: true` |
| 10 | Snapshot | ✔ alteração da Tabela não altera snapshot já capturado |
| 11 | PDV | ✔ `resolver-precos`, balança via Resolver, sem `obterPrecoAtacado` |
| 12 | Comercial | ✔ Consignação + porta única `ConfiguracaoComercialService` |
| 13 | Mobile | ✔ chama `resolver-precos` |
| 14 | Logs | ✔ `[RCM-8.1][Resolver]` JSON (operação, tabela, produto, linha, unidade, preço, origem) |

---

## Critérios de aceite

| Critério | Status |
|---|---|
| Produto com Linha | ✔ |
| Produto sem Linha | ✔ |
| Unidade Comercial correta (Tabela) | ✔ |
| PDV exclusivamente Resolver (lista) | ✔ |
| Comercial mesmo Resolver | ✔ |
| Mobile mesmo contrato | ✔ |
| Snapshot imutável | ✔ |
| Preço de Segurança | ✔ |
| Sem cálculo legado de lista no PDV | ✔ |
| Sem regras duplicadas no Motor | ✔ |

---

## Logs de homologação

Cada resolução emite (quando `COMERCIAL_PRECO_LOG !== '0'`):

```json
{
  "operacao": "VAREJO",
  "canal": "VAREJO",
  "tabela_id": 69,
  "tabela": "…",
  "produto_id": 1,
  "produto": "…",
  "linha_id": 10,
  "linha": "…",
  "unidade_comercial": "KG",
  "preco": 12.5,
  "origem": "Tabela × Linha de Precificação",
  "origem_codigo": "tabela_preco_linha"
}
```

Desligar: `COMERCIAL_PRECO_LOG=0`.

---

## Camadas posteriores (não são precificação de lista)

Mantidas por desenho, **após** o Resolver:

- Promoção ativa
- Desconto / preço manual (supervisor)

Ofertas especiais (Kit com `kit.preco`, UC com preço próprio de unidade) são **ofertas/conversão**, não caminhos paralelos do Motor de lista. Evoluções futuras devem cotar via Resolver quando o preço for de lista.

---

## Como reexecutar

```bash
node backend/modules/comercial/tests/rcm81-certificacao-precificacao.test.js
```

---

## Declaração

O **Motor Oficial de Precificação** está **certificado para produção**.

Toda evolução do CDS Comercial deve usar este motor como **única fonte de verdade** para formação de preço de lista.
