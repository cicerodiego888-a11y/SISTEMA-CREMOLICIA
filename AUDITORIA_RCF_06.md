# AUDITORIA RCF-06 — Carregamento da Venda para Emissão Fiscal

Data: 2026-07-31  
Prioridade: CRÍTICA — BLOQUEANTE

---

## 1. Sintoma (logs)

```
ENTROU NO EMISSOR  venda_id = 34
Venda carregada    venda_id = 34  qtd_itens = 0  pagamentos = 1
…
DANFE servido      venda_id = 19  nota = 2008
```

A emissão da venda **34** rodou sem itens; em seguida o cupom fiscal da venda **19** (NFC-e #2008) foi servido.

---

## 2. Fluxograma (falha)

```
POST /vendas (ou emitir/venda/34)
        ↓
carregarVenda(34)  →  itens = []   ← FALHA A
        ↓
(antes) status=sem_itens_fiscais  OU  fluxo segue sem abort duro
        ↓
imprimirDANFEFiscal(34, { notaId: <stale/outra> })
        ↓
GET /fiscal/danfe/nota/:notaId     ← FALHA B (sem checar venda_id)
        ↓
DANFE da venda 19 (#2008)
```

---

## 3. Causas raiz

| # | Ponto | Problema |
|---|--------|----------|
| A | `carregarVenda` | `INNER JOIN produtos` podia zerar o resultado se `produto_id` órfão; e **zero itens** era tratado como `sem_itens_fiscais` (sucesso), sem abortar a emissão. |
| B | `GET /danfe/nota/:notaId` | Servia DANFE **só** pelo id da nota, sem exigir `venda_id`. |
| C | `imprimirDANFEFiscal` | Com `notaId`, chamava `/danfe/nota/:id` e **pulava** a checagem `hdrVenda === vendaId` (`&& !notaId`). |
| D | `VendaPagamentoService` | Caminho `distribuicaoItens.length === 0` fazia **COMMIT** de venda vazia e seguia para o fluxo fiscal. |
| E | Venda a prazo | `COMMIT` sem aguardar callback antes de responder (corrida possível). |

Não há fallback SQL “última NFC-e global” no emissor após RCF-02; a troca 34→19 vinha do **canal de impressão** (notaId sem amarração à venda).

---

## 4. Correção aplicada

| Arquivo | Mudança |
|---------|---------|
| `emissor.js` | `LEFT JOIN produtos`; conta `vendas_itens`; `assertVendaComItens` **throws** se zero itens; reuse de nota valida `nota.venda_id`; logs `[RCF-06]` (itens, pagamentos, produtos, nota). |
| `rotas/fiscal.js` | DANFE por venda valida `nota.venda_id`; `/danfe/nota` exige `?vendaId=` quando informado; emissão retorna `venda_sem_itens` (409). |
| `fiscalImpressao.js` | Sempre `GET /danfe/venda/:vendaId?notaId=`; aborta se header diverge **sempre**. |
| `VendaPagamentoService.js` | Venda sem itens → **ROLLBACK**; prazo COMMIT com callback. |

---

## 5. Proteção obrigatória

```js
if (Number(nota.venda_id) !== Number(vendaId)) {
  // HTTP 409 / throw
  "RCF-06: DANFE pertence a outra venda."
}
```

```js
assertVendaComItens(vendaId, itens, totalItensPersistidos);
// throw se length === 0 — nunca consulta outra nota
```

---

## 6. Teste

```
node backend/services/fiscal/tests/rcf06-carregar-venda.test.js
→ RCF-06 OK — carregamento venda / DANFE amarrados; zero itens aborta
```

---

## 7. Critérios de aceitação

- [x] Nenhuma venda chega ao emissor com zero itens sem abort
- [x] Nenhum DANFE servido para venda diferente da solicitada
- [x] Venda inconsistente → emissão abortada imediatamente
- [x] Nunca NFC-e de outra venda como fallback
- [x] Logs: venda, itens, pagamento, nota_id, nota.venda_id, número, total, produtos

Reinicie o backend e valide uma venda fiscal de homologação.
