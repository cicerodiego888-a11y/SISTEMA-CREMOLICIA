# AUDITORIA RCF-10.1 — Layout Oficial do Comprovante Comercial

Data: 2026-07-31  
Prioridade: CRÍTICA — PADRONIZAÇÃO DO CUPOM DO CLIENTE  
Status: **IMPLEMENTADO**

---

## 1. Veredito

O comprovante pós-autorização passou a ser um **cupom comercial de supermercado**:

- Sem aparência de DANFE
- Sem relatório técnico / tributos
- Hierarquia visual com negrito só nos títulos
- Tipografia Consolas / Courier New
- Alinhamento pontilhado produto ↔ total

XML e DANFE **não mudam**.

---

## 2. Layout oficial

Cabeçalho (configuração fiscal) → CUPOM DE VENDA → NFC-e nº/série/data autorização → produtos (`vendas_itens`) → TOTAL (`vendas.total`) → pagamentos → chave/protocolo → QR → mensagem final.

Data: `nota.data_autorizacao` / `dhRecbto` — **nunca** data da venda.

---

## 3. Teste

```bash
node backend/services/fiscal/tests/rcf10_1-layout-cupom.test.js
```

---

## 4. Critérios

- [x] Cupom comercial (não DANFE)
- [x] Internos F×NF ocultos
- [x] Todos itens/pagamentos
- [x] Total = `vendas.total`
- [x] nº/série/chave/protocolo/QR da NFC-e
- [x] Cabeçalho profissional
- [x] Negrito nos títulos
- [x] Reimpressão idêntica
