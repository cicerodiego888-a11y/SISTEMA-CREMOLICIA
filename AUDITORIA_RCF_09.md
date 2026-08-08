# AUDITORIA RCF-09 — Remontagem do Comprovante Comercial após NFC-e

Data: 2026-07-31  
Prioridade: CRÍTICA

---

## 1. Veredito

Após autorização SEFAZ, o cliente recebe um **comprovante comercial remontado**:

| Camada | Fonte | Conteúdo |
|--------|-------|----------|
| Cabeçalho fiscal | XML/nota autorizada | Empresa, CNPJ, NFC-e nº, série, data/hora, chave, QR |
| Produtos | `vendas_itens` | **Todos** (fiscais + não fiscais), sem rótulos internos |
| Pagamentos | recebimentos/pagamentos | **Todas** as formas, sem split fiscal |
| Total | `vendas.total` | TOTAL DA COMPRA (geral) |
| Rodapé fiscal | XML/nota | Chave, protocolo, ambiente, tributos, QR |

O **XML autorizado permanece imutável** (somente leitura).

O **DANFE fiscal** continua disponível para reimpressão fiscal (`/danfe/...`) — documento auxiliar da NFC-e.

---

## 2. Arquitetura

```
SEFAZ autoriza NFC-e
        ↓
XML fiscal gravado (itens/pagamentos/totais FISC AIS) — NÃO altera
        ↓
ComprovanteRemontadoService.gerarComprovanteRemontado(vendaId)
        ↓
GET /api/fiscal/comprovante-remontado/venda/:id
        ↓
PDV imprime comprovante remontado (cliente)
```

---

## 3. Arquivos

| Arquivo | Papel |
|---------|--------|
| `backend/services/fiscal/ComprovanteRemontadoService.js` | Remontagem + guards anti-vazamento |
| `backend/rotas/fiscal.js` | `GET /comprovante-remontado/venda/:vendaId` |
| `frontend/shared/js/comprovanteVenda.js` | `imprimirComprovanteRemontadoNfce` / reimpressão |
| `frontend/pdv/js/pdv.js` | Pós-autorização → comprovante remontado |
| `comprovanteVendaService.js` | Removido split Fiscal/Não Fiscal do comprovante simples (RCF-09) |

---

## 4. Proibições (cliente)

Não exibir:

- Valor Fiscal / Valor Não Fiscal  
- Labels FISCAL / NÃO FISCAL  
- MIDP / Motor Fiscal × Não Fiscal / distribuição  

Guard: `assertSemVazamentoInterno(html)`.

---

## 5. Testes

```bash
node backend/services/fiscal/tests/rcf09-comprovante-remontado.test.js
```

Cobre: 100% fiscal, 100% NF (montagem), mista, multi-pagamento, desconto, acréscimo, reimpressão (contrato), XML imutável, chave NFC-e.

---

## 6. Critérios

- [x] XML autorizado imutável  
- [x] Comprovante reconstruído após autorização  
- [x] Todos os produtos no comprovante  
- [x] Todos os pagamentos no comprovante  
- [x] Total = `vendas.total`  
- [x] QR/chave da NFC-e autorizada  
- [x] Sem informação interna F×NF ao cliente  
- [x] Teste automatizado  

Reinicie o backend (`npm start`) e emita uma NFC-e: o cupom impresso ao cliente deve ser o comprovante remontado.
