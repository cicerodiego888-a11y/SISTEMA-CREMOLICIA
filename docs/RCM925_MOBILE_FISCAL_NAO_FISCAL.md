# RCM-9.2.5 — Mobile Fiscal / Não Fiscal

**Data:** 2026-08-08  
**Natureza:** Interface Mobile para o módulo Fiscal/Não Fiscal já existente no Desktop.  
**Sem** Motor Fiscal Mobile · **sem** nova API · **sem** tabela · **sem** alteração de Resolver/MUC/estoque/backend fiscal.

---

## Auditoria prévia (Desktop)

| Peça | Local | Papel |
|------|--------|--------|
| `pdv_modo_fiscal_ativo` | `localStorage` | Estado F12 (`'1'` fiscal / `'0'` completo) |
| `alternarModoFiscalGlobal` | `frontend/shared/js/core.js` | Toggle F12 + sync servidor |
| `modoFiscalAtivoSistema` | `core.js` | Leitura do estado |
| `modo_dashboard_fiscal` | `GET/PUT /api/configuracoes/modo_dashboard_fiscal` | Persistência compartilhada ERP↔PDV |
| `emitir_fiscal` | `POST /api/vendas` | Contrato de venda fiscal/não fiscal |
| `modoFiscalHelpers.js` | `frontend/shared/js/` | Helpers de exibição/estoque |

No Desktop: **F12 ON** → venda fiscal (`emitir_fiscal: true`); **F12 OFF** → venda não fiscal.

---

## Mobile — o que foi feito

Arquivo novo: `frontend/apps/mobile/js/modoFiscal.js`

- Lê/grava `localStorage.pdv_modo_fiscal_ativo` (mesma chave)
- Sincroniza com `configuracoes/modo_dashboard_fiscal` (mesma API)
- Chip compacto no PDV: **🟢 FISCAL** / **⚪ NÃO FISCAL** (toque alterna)
- Na finalização: `emitir_fiscal` = modo atual (remove checkbox paralelo “Emitir NFC-e”)

Arquivos tocados:

- `frontend/apps/mobile/js/pages/pdv.js`
- `frontend/apps/mobile/css/mobile.css`
- `frontend/apps/mobile/index.html` (cache CSS `rcm925`)

---

## Fluxo

```text
Operador toca chip
  → localStorage + PUT /api/configuracoes/modo_dashboard_fiscal
  → Finalizar venda
  → emitir_fiscal = modo atual
  → POST /api/vendas (backend fiscal existente)
```

Desktop e Mobile passam a compartilhar o mesmo estado no servidor.

---

## UX

- Chip ao lado do status do terminal (não ocupa o carrinho)
- Pagamento mostra hint: `🟢 FISCAL` ou `⚪ NÃO FISCAL`
- NFC-e pós-venda continua só se `canDoAction('emitir_nfce')` (igual antes)

---

## Testes

Contrato fonte: `backend/modules/comercial/tests/rcm925-mobile-fiscal.test.js`

Checklist operacional:

| Cenário | Status |
|---------|--------|
| Fiscal ON → venda com `emitir_fiscal` | ⏳ aparelho / operação |
| Fiscal OFF → venda não fiscal | ⏳ |
| Alternar ON de novo | ⏳ |
| Reabrir Mobile (sync servidor) | ⏳ |
| Preço / canal / MUC / estoque inalterados na regra | ✅ (código não toca) |

---

## Critério de aceite

Operador ativa/desativa Fiscal no Mobile e vende sem abrir o Desktop.  
Nenhum código fiscal/comercial paralelo.

## Declaração

RCM-9.2.5 — CDS Mobile passou a controlar o módulo Fiscal/Não Fiscal oficial via o mesmo contrato do Desktop (F12 / `pdv_modo_fiscal_ativo` / `modo_dashboard_fiscal` / `emitir_fiscal`).
