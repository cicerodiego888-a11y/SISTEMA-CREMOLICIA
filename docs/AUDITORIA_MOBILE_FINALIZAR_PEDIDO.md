# AUDITORIA MOBILE — BOTÃO FINALIZAR PEDIDO

**Tipo:** auditoria rápida / somente leitura  
**Escopo:** CDS Mobile · PDV · botão **Finalizar** (pedido/venda)  
**Data:** 2026-08-12  
**Código alterado:** nenhum  

---

## Parecer final

**B — bug localizado no frontend**

(com componente de **estado/pagamento** no desenho do fluxo — ver §6)

---

## CAUSA PROVÁVEL

1. **Principal (toque “não faz nada”):** o botão `#pdv-pay` é renderizado com atributo HTML `disabled` quando o **caixa não está aberto** (`!aberto`) ou o **carrinho está vazio**. Com `disabled`, o browser **não dispara** o `click`. Não há toast/alerta nesse caso. No CSS mobile **não existe** estilo `.cds-mobile-btn:disabled` — o botão continua com aparência de botão primário clicável.

2. **Secundária (expectativa vs desenho):** mesmo com o botão habilitado, o toque em **Finalizar não grava a venda**. Ele só abre o bottom sheet “Forma de pagamento”. A API `POST /vendas` só roda **depois** de escolher Dinheiro / PIX / Cartão / TEF.

3. **Secundária (toque engolido):** `.cds-pdv-sticky` usa `bottom: calc(var(--m-bottom-h) + 8px)` **sem** `--m-safe-b`, enquanto a bottom nav tem altura `calc(var(--m-bottom-h) + var(--m-safe-b))` e `z-index` maior (`--z-chrome: 40` vs `--z-sticky: 6`). Em aparelhos com home indicator, parte do botão pode ficar sob a nav — o toque vai para a nav, não para Finalizar.

---

## PONTO EXATO DO CÓDIGO

| Etapa | Arquivo | Função / trecho |
|--------|---------|-----------------|
| Botão | `frontend/apps/mobile/js/pages/pdv.js` | `paintCart` · `#pdv-pay` (~L622–624) |
| Bind | idem | `addEventListener('click', () => iniciarPagamento(...))` (~L704) |
| Gate caixa/carrinho | idem | `iniciarPagamento` (~L725–731) |
| Sheet pagamento | idem | `openBottomSheet` + `[data-pay]` (~L734–756) |
| API venda | idem | `finalizarVenda` · `CDSApi.post('vendas', …)` (~L759–852) |
| Sheet util | `frontend/apps/mobile/js/forms.js` | `openBottomSheet` (~L239–267) |
| CSS disabled ausente | `frontend/apps/mobile/css/mobile.css` | `.cds-mobile-btn` (~L804+) — sem `:disabled` |
| Sticky / safe-area | idem | `.cds-pdv-sticky` (~L1641–1644) vs `.cds-mobile-bottom-nav` (~L209–213) |

---

## FLUXO ATUAL

```
#pdv-pay "Finalizar"
      ↓
[disabled se !cart.length || !aberto]? ──SIM──► NADA (sem click, sem toast)
      ↓ NÃO
iniciarPagamento(root, aberto)
      ↓
!aberto? ──► toast "Abra o caixa…" + return
!cart.length? ──► return SILENCIOSO (sem toast)
      ↓
openBottomSheet("Forma de pagamento")
      ↓
usuário escolhe data-pay (dinheiro|pix|cartao|tef)
      ↓
finalizarVenda({ forma, emitir, total, desconto, cart })
      ↓
[tef] tryTef → se falhar, return (com toast)
[dinheiro] prompt valor → se cancelar, return; se < total, toast + return
      ↓
POST vendas/pre-calcular-distribuicao
      ↓
POST vendas
      ↓
opcional: POST vendas/:id/pagamento-nao-fiscal
opcional: POST fiscal/emitir/venda/:id
      ↓
toast sucesso + limpa carrinho + navigate pdv/vendas
```

**O clique em Finalizar, sozinho, NÃO chega na API de venda.**

---

## VERIFICAÇÕES (resumo)

### 1. Botão
- Tela: PDV aba **Vender** (`renderVenderTab` → `#pdv-sticky`).
- Evento: `click` em `#pdv-pay` → `iniciarPagamento`.
- Conectado: **SIM**, quando o botão **não** está `disabled`.

### 2. Handler
- Função: `iniciarPagamento`.
- Bloqueios: `disabled` no HTML; `!aberto` (com toast); `!cart.length` (**sem** toast).
- Loading travado: **não** observado neste caminho.
- Exceção silenciosa no 1º toque: **não** — o problema típico é click inexistente (`disabled`).

### 3. Validações antes da API (só as do fluxo Finalizar)

| Condição | Mensagem | Falha |
|----------|----------|--------|
| Botão `disabled` (`!aberto` ou carrinho vazio) | **Nenhuma** | Click não dispara |
| `!aberto` em `iniciarPagamento` | “Abra o caixa antes de vender.” | `return` |
| `!cart.length` em `iniciarPagamento` | **Nenhuma** | `return` silencioso |
| TEF falhou / indisponível | toast warning/error | `return` (não chama `POST vendas`) |
| Dinheiro: prompt cancelado | **Nenhuma** | `return` |
| Dinheiro: valor &lt; total | “Valor recebido insuficiente.” | `return` |

### 4. API
- Endpoints (após escolher pagamento):  
  - `POST /api/vendas/pre-calcular-distribuicao`  
  - `POST /api/vendas`  
  - opcional `POST /api/vendas/:id/pagamento-nao-fiscal`  
  - opcional `POST /api/fiscal/emitir/venda/:id`
- **O 1º toque em Finalizar não chama esses endpoints.**  
  Classificação desse sintoma: **BUG FRONTEND** (UX/estado), não backend.

### 5. Resposta
- Erros de `finalizarVenda` passam por `catch` com `showToast` (sessão / rede / demais) — carrinho preservado.
- Sucesso: toast + `navigate('pdv/vendas')`.
- Não há evidência, neste arquivo, de “API errou e UI engoliu” no caminho feliz do 1º toque (porque a API ainda não foi chamada).

### 6. Pagamento

**Finalizar está aguardando pagamento?** → **SIM**

Ponto exato: `iniciarPagamento` abre o sheet; `finalizarVenda` / `POST vendas` só após clique em `[data-pay]` (`pdv.js` ~L748–754).

Não é TEF “travando” o 1º toque; é o próprio desenho do botão Finalizar = “escolher forma de pagamento”.

---

## CORREÇÃO RECOMENDADA

*(somente recomendação — não implementada nesta auditoria)*

1. Estilizar `:disabled` no `.cds-mobile-btn` (opacidade + cursor) e, no toque em botão desabilitado (ou wrapper), toast claro: “Abra o caixa” / “Carrinho vazio”.
2. Incluir `--m-safe-b` no `bottom` de `.cds-pdv-sticky` (paridade com outros stickies) para o botão não ficar sob a bottom nav.
3. Trocar o `return` silencioso de carrinho vazio por toast.
4. (UX) Renomear ou subtítulo: “Finalizar” → “Pagar” / “Escolher pagamento”, para alinhar expectativa com o sheet.

---

## SEVERIDADE

**Alta (operacional)** — impede ou aparenta impedir o fechamento da venda no Mobile, com feedback nulo no caso mais comum de botão `disabled` + visual ativo.

---

## FORA DE ESCOPO (não auditado)

Motor Comercial, precificação, consignação, fiscal/NFC-e completo, TEF completo, estoque, sync Desktop/Mobile, banco, arquitetura geral.
