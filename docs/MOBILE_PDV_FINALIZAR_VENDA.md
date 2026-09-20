# MOBILE-PDV — Finalizar Venda

**Status:** implementado (frontend Mobile)  
**Escopo:** fluxo Completo Finalizar → Pagamento → API → Sucesso  
**Arquivos:** `frontend/apps/mobile/js/pages/pdv.js`, `frontend/apps/mobile/css/mobile.css`

---

## Objetivo

No CDS Mobile, o operador consegue fechar uma venda real:

Produto → Carrinho → **Finalizar** → Forma de pagamento → Confirmar → `POST /api/vendas` → confirmação → carrinho limpo → PDV pronto.

---

## Fluxo corrigido

```
#pdv-pay-hit / Finalizar
      ↓
[caixa fechado?] → toast "Abra o caixa antes de finalizar a venda."
[carrinho vazio?] → toast "Adicione pelo menos um produto…"
[já finalizando?] → toast "Finalizando venda..."
      ↓
iniciarPagamento() → Bottom Sheet (Dinheiro | PIX | Cartão | TEF)
      ↓
seleção de pagamento  (ainda NÃO grava)
      ↓
finalizarVenda()
  · Dinheiro → valor recebido / troco / insuficiente
  · TEF → status; se indisponível, toast e aborta
  · lock pdvFinalizandoVenda + "Finalizando venda..."
  · POST vendas/pre-calcular-distribuicao
  · POST vendas
  · pagamento-nao-fiscal (se aplicável)
  · NFC-e (se aplicável; falha ≠ apagar venda)
  · toast "Venda finalizada com sucesso."
  · limpa carrinho (só após sucesso da API)
  · navigate pdv
  · finally: libera lock
```

---

## Correções aplicadas

| Item | O que mudou |
|------|-------------|
| Safe-area | `.cds-pdv-sticky` usa `var(--m-safe-b)` — botão acima da bottom nav / home indicator |
| Hit-area | `#pdv-pay-hit` recebe toque mesmo com botão `disabled` → feedback, sem return silencioso |
| Visual disabled | `.cds-mobile-btn:disabled` / `.is-disabled` com opacidade e cinza |
| Lock | `pdvFinalizandoVenda` só durante gravação (não no sheet de pagamento) |
| Mensagens | Caixa / carrinho / sucesso / TEF / NFC-e / erro API |
| Troco | Calculado no dinheiro e exibido no sucesso quando > 0 |
| Carrinho | Nunca limpo antes da confirmação de `POST /vendas` |

---

## APIs usadas (inalteradas)

1. `POST /api/vendas/pre-calcular-distribuicao`
2. `POST /api/vendas`
3. `POST /api/vendas/:id/pagamento-nao-fiscal` (quando aplicável)
4. `POST /api/fiscal/emitir/venda/:id` (quando fiscal + permissão)

---

## Teste automatizado

`backend/modules/comercial/tests/mobile-pdv-finalizar-venda.test.js`

```bash
node backend/modules/comercial/tests/mobile-pdv-finalizar-venda.test.js
```

Valida contrato: botão, disabled, iniciarPagamento, opções de pagamento, APIs, lock, sucesso, erro, safe-area.

---

## Aceite (celular)

1. Caixa aberto → produto → Finalizar → Dinheiro → venda criada → sucesso → carrinho limpo  
2. Idem com PIX  
3. Cartão responde (sem travar)  
4. Carrinho vazio → mensagem  
5. Caixa fechado → mensagem  
6. Dinheiro insuficiente → não grava  
7. Duplo toque → uma venda  
8. Erro API → carrinho preservado  
9/10. Fiscal / não fiscal preservados  

---

## Fora de escopo

Motor Comercial, Resolver, Tabelas, Consignação, MUC, Estoque, Ledger, Outbox, regras fiscais, APIs públicas.
