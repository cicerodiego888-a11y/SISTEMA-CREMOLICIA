# AUDITORIA RCF-10 — Comprovante Comercial Pós-Autorização

Data: 2026-07-31  
Prioridade: CRÍTICA — GO LIVE  
Status: **IMPLEMENTADO / CERTIFICADO EM TESTES**

---

## 1. Veredito

Após autorização da NFC-e, o cliente recebe **um único comprovante comercial** montado a partir da **venda completa**, com carimbo da NFC-e (número, série, chave, protocolo, QR, ambiente).

A separação Fiscal × Não Fiscal permanece interna. O XML **não é alterado** e **não monta** itens, totais nem pagamentos do comprovante.

---

## 2. Arquitetura

```
Carrinho → Venda → Separação F×NF (interna) → XML fiscal → SEFAZ
                                                      ↓
                                                 Autorizada
                                                      ↓
                              Recarregar venda completa
                                                      ↓
                    ComprovanteComercialPosFiscalService
                                                      ↓
                              Carimbo NFC-e + impressão
```

| Fonte | Uso no comprovante |
|-------|-------------------|
| `vendas_itens` | Produtos, qtd, valores |
| `vendas.total` | TOTAL DA COMPRA |
| pagamentos/recebimentos | Todas as formas |
| Nota/XML (leitura) | nº, série, chave, protocolo, QR, ambiente |

**Nunca:** `<det>`, `<pag>`, `vNF` do XML para montar o corpo comercial.

---

## 3. Entregas

| Artefato | Papel |
|----------|-------|
| `backend/services/comercial/ComprovanteComercialPosFiscalService.js` | Serviço oficial |
| `GET /api/fiscal/comprovante-comercial/venda/:id` | API |
| `GET /api/fiscal/comprovante-remontado/venda/:id` | Alias → RCF-10 |
| PDV / `imprimirComprovanteComercialPosFiscal` | Impressão pós-autorização |
| `reimprimirComprovanteVendaHistorico` | Mesmo serviço (nunca DANFE ao cliente) |
| Logs `[RCF-10]` | Auditoria venda × XML × impressos |

DANFE (`/danfe/...`) permanece **100% fiscal** para uso interno/reimpressão fiscal.

---

## 4. Não exibir ao cliente

Total Fiscal/Não Fiscal, Itens Fiscais/Não Fiscais, Valor Fiscal/Não Fiscal, Operação/Distribuição/Modo Fiscal, Tributos Incidentes, ICMS, PIS, COFINS, MIDP.

---

## 5. Testes

```bash
node backend/services/fiscal/tests/rcf10-comprovante-remontagem.test.js
node backend/services/fiscal/tests/rcf10-comprovante-comercial.test.js
node backend/services/fiscal/tests/rcf10-regressao.test.js
```

---

## 6. Critérios de aceitação

- [x] XML permanece 100% fiscal
- [x] DANFE permanece 100% fiscal
- [x] Comprovante reconstruído da venda completa
- [x] Todos os produtos ao cliente
- [x] Todos os pagamentos ao cliente
- [x] Total impresso = `vendas.total`
- [x] QR / chave / protocolo após autorização
- [x] Cliente não identifica F×NF
- [x] Reimpressão usa o mesmo serviço
- [x] Testes RCF-10 aprovados
