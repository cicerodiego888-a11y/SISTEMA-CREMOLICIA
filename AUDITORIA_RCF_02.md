# AUDITORIA RCF-02 — Fluxo de Emissão NFC-e

Data: 2026-07-31  
Prioridade: CRÍTICA — BLOQUEANTE PARA PRODUÇÃO

---

## 1. Fluxograma

```
Venda (POST /vendas) → venda_id
    ↓
Pagamento quitado + emitir_fiscal
    ↓
POST /fiscal/emitir/venda/:vendaId
    ↓
carregarVenda(vendaId) → itens/pagamentos da MESMA venda
    ↓
buildNfceXml + validarConsistenciaVendaXml (RCF-02)
    ↓
Assinatura → SEFAZ
    ↓
salvarNota({ venda_id })  ← upsert SOMENTE por (venda, nº, série, amb)
    ↓
Retorno { notaId, vendaId, danfeHtml }
    ↓
GET /fiscal/danfe/nota/:notaId  (ou /danfe/venda/:id?notaId=)
    ↓
Impressão (header X-CDS-Venda-Id conferido)
```

---

## 2. Ponto exato da falha

| Item | Detalhe |
|------|---------|
| Arquivo | `backend/services/fiscal/emissor.js` |
| Função | `salvarNota` |
| Problema | `SELECT ... WHERE chave_acesso = ? OR (venda_id+numero...)` + `UPDATE` **sem** regravar/`WHERE venda_id` |
| Efeito | Nota de outra venda podia ser sobrescrita; XML/DANFE coerentes entre si, mas de operação errada |

Amplificadores:
- `GET /fiscal/danfe/venda/:vendaId` pegava **qualquer** última nota da venda (`ORDER BY id DESC`), inclusive rejeitada/pendente.
- PDV **ignorava** `notaId`/`danfeHtml` do emit e reconsultava só por `vendaId`.
- `incrementaNumeroFiscal` sem lock → corrida de numeração (539).

---

## 3. Causa da regressão

Upsert de `nfce_notas` por **chave_acesso global** (sem amarração obrigatória a `venda_id` no UPDATE), combinado com reconsulta do DANFE pela “última linha da venda” sem filtrar `autorizada` nem usar o `notaId` da emissão.

---

## 4. Correção aplicada

| Arquivo | Mudança |
|---------|---------|
| `emissor.js` | `salvarNota` só por `(venda_id, numero, serie, ambiente)`; bloqueia chave de outra venda; UPDATE exige `venda_id`; validação Venda×XML; logs `[RCF-02]` |
| `rotas/fiscal.js` | DANFE só `status=autorizada`; `GET /danfe/nota/:notaId`; headers `X-CDS-Venda-Id` / `X-CDS-Nota-Id` |
| `fiscalImpressao.js` | Aceita `notaId`; aborta se header diverge |
| `pdv.js` | Passa `notaId` após emissão |
| `configService.js` | `BEGIN IMMEDIATE` na numeração |

---

## 5. Evidências / Testes

```
node backend/services/fiscal/tests/rcf02-fluxo-nfce.test.js
→ RCF-02 OK — fluxo NFC-e amarrado a venda_id/notaId
```

---

## 6. Critérios

- [x] Sem UPDATE por chave global cruzando vendas
- [x] DANFE filtrado por venda + autorizada / notaId
- [x] PDV imprime pela nota da emissão
- [x] Validação total venda×XML
- [x] Logs rastreáveis por venda_id / nota_id
- [x] Numeração com lock

Reinicie o backend e faça uma venda de teste com NFC-e para validar em homologação.
