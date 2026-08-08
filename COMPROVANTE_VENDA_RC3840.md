# RC3.8D.4.0 — Comprovante comercial de venda

**Data:** 2026-07-30

## Objetivo

Separar documento **comercial** (cliente) do **fiscal** (SEFAZ).

| Documento | Conteúdo |
|-----------|----------|
| COMPROVANTE DE VENDA | Qtd comercial · total da compra · formas de pagamento |
| DANFE / NFC-e | Parcela fiscal autorizada (inalterada) |

## Arquivos

- `backend/services/comprovanteVendaService.js`
- `GET /api/vendas/:id/comprovante`
- `frontend/shared/js/comprovanteVenda.js`
- PDV: imprime comprovante em vendas quitadas; DANFE segue no fluxo fiscal

## Teste

```bash
node backend/services/tests/comprovante-venda-rc3840.test.js
```
