# RCM-9.2.3 — Auditoria de Operação Real do CDS Mobile

**Data:** 2026-08-08  
**Natureza:** Homologação operacional (sem novo motor / sem alteração Resolver / MUC / Contagem / arquitetura)  
**Script:** `backend/modules/comercial/tests/rcm923-auditoria-operacao-mobile.test.js`  
**Evidência runtime:** `docs/RCM923_AUDITORIA_RUNTIME.json`

---

## Ambiente

| Item | Valor |
|------|--------|
| Servidor | `npm start` (Electron + Express) |
| Porta | **3002** |
| URL local | `http://127.0.0.1:3002/apps/mobile/` |
| URL LAN (config ERP) | `http://192.168.0.9:3002/apps/mobile/` (**não** usar `.22` — IP antigo) |
| DB | `C:\ProgramData\MercantilFiscal\dados\mercadao.db` |
| Operador | Diego (id 1) |
| Host simulado Mobile | `mobile-rcm923-*` |
| Build Mobile (código) | sticky RCM-9.2.2.2 · UX RCM-9.2.2.1 · versão `2.5.3-rcm923` |

**Aparelho físico acoplado ao agente:** não.  
Itens de toque/PWA/resolução visual no celular ficam no checklist do operador (seção final).

---

## 1. Terminal + Caixa

| Check | Resultado | Evidência |
|-------|-----------|-----------|
| Login | ✅ | JWT Diego |
| Terminal identificado | ✅ | **id 24** · nome `CDS Mobile RCM923` |
| Nome correto | ✅ | persistido / reutilizado no `/terminais/auto` |
| Caixa correto | ✅ | **caixa_id 4** (vínculo na 1ª sessão) |
| Caixa aberto | ✅ | sessão **16** |
| Status operacional | ✅ | equivalente a 🟢 / `CAIXA_ABERTO` |
| PDV liberado | ✅ | vendas subsequentes aceitas |

---

## 2. Venda Varejo

**Cenário:** 1 picolé (#3)

| Check | Resultado |
|-------|-----------|
| Produto / Resolver | ✅ canal **VAREJO** · UC **UN** · preço **R$ 2,50** |
| Sticky (contrato UI) | ✅ label `TOTAL · canal · N itens` + nowrap (RCM-9.2.2.2) |
| Finalizar / gravação | ✅ **venda #55** · dinheiro · total **2,50** |

---

## 3. Pagamento

| Check | Resultado |
|-------|-----------|
| Pipeline pagamento Mobile | ✅ `pre-calcular` → `POST /vendas` com `subtotal` + `pagamentos[]` |
| Meios exercitados | ✅ **dinheiro** (#55, #57) · **PIX** (#56) |
| Cartão / TEF | ⏳ não exercitado nesta rodada (TEF não alterado; UI Mobile oferece cartão não-fiscal) |
| Sem erro silencioso | ✅ status HTTP < 400; ids retornados |

---

## 4. Venda Atacado

**Cenário:** 29 picolés + 1 pote 0,250 KG (#1185)

| Check | Resultado |
|-------|-----------|
| 29 picolés = 29 UN | ✅ |
| Pote 0,250 (estoque comercial) | ✅ qtd **0,25** |
| Pote = 1 item comercial | ✅ |
| Total comercial | ✅ **30** (`quantidade_avaliada`) |
| Canal | ✅ **ATACADO** |
| Preço picolé Atacado | ✅ **R$ 2,00** |
| Preço sorvete Atacado | ✅ **R$ 28,00** |
| UC sorvete | ✅ **LT** |
| Venda | ✅ **#56** · PIX · total **R$ 65,00** (= 29×2 + 0,25×28) |

---

## 5. Estoque

| Produto | Antes | Depois (pós #55+#56) | Δ | Esperado |
|---------|-------|----------------------|---|----------|
| Picolé #3 | 141 | 111 | **−30** | −1 (varejo) −29 (atacado) = **−30 UN** |
| Sorvete #1185 | 8,319 | 8,069 | **−0,250** | **−0,250** (pote; ≠ 30 UN comerciais) |
| Picolé após 2ª venda #57 | 141 → 110 | | **−31** | −30 −1 |

**Regra confirmada:** 30 itens comerciais **não** equivalem a 30 unidades de estoque do sorvete.

---

## 6–7. Desktop × Mobile (dupla verificação)

| Venda | Lista API/Desktop | Total Mobile | Total detalhe | Terminal | Pagamento |
|-------|-------------------|--------------|---------------|----------|-----------|
| #55 Varejo | ✅ | 2,50 | 2,50 | 24 | dinheiro |
| #56 Atacado | ✅ | 65,00 | 65,00 | — | pix |
| #57 2ª venda | ✅ (registrada) | 2,50 | — | 24 | dinheiro |

Sem divergência de total / pagamento / gravação nos cenários auditados.

---

## 8. Fechar / reabrir (API = identidade do terminal)

| Check | Resultado |
|-------|-----------|
| Mesmo `hostname` → mesmo `terminal_id` | ✅ **24** |
| Nome recuperado | ✅ |
| `caixa_id` recuperado | ✅ **4** |
| Sessão de caixa ainda aberta | ✅ sessão **16** |

**PWA/navegador no aparelho:** checklist operador (abaixo). Código Mobile persiste `terminal_id`, `nome`, `caixa_id`, `ativo` em `localStorage` (`terminal.js`).

---

## 9. Segunda venda após reabertura

| Check | Resultado |
|-------|-----------|
| Resolver + venda | ✅ **#57** · 1 picolé · R$ 2,50 · dinheiro |
| Pesquisa limpa / foco (contrato) | ✅ `clearPdvSearchAfterAdd` presente |
| Sticky (contrato) | ✅ nowrap + coluna full-width |
| Operacional após “reabrir” | ✅ |

---

## 10. Responsividade / UX (código)

| Largura / item | Status |
|----------------|--------|
| CSS 360 / 390 | ✅ presente |
| Sticky sem quebra vertical | ✅ RCM-9.2.2.2 |
| Finalizar full-width | ✅ |
| Scroll horizontal sticky expandido | ✅ `overflow-x: hidden` |
| Confirmação visual no aparelho 360/390/412 | ⏳ operador |

---

## Problemas encontrados

Nenhum no ciclo API desta rodada.

(Correções prévias já incorporadas: unwrap `/caixa/aberto`, `subtotal` na venda, sticky layout, limpeza de pesquisa, conversão MUC #1185.)

## Correções realizadas nesta sprint

Nenhuma alteração de código necessária — fluxo existente operou de ponta a ponta.

---

## Critério de aprovação (checklist)

| Critério | Status |
|----------|--------|
| Terminal OK | ✅ API |
| Caixa OK | ✅ API |
| Venda Varejo OK | ✅ #55 |
| Pagamento OK | ✅ dinheiro/PIX |
| Venda Atacado OK | ✅ #56 |
| 29 + pote = 30 itens | ✅ |
| Estoque correto | ✅ −30 UN / −0,25 |
| Venda no Desktop/API | ✅ |
| Valores Mobile × Desktop | ✅ |
| Terminal após reabertura | ✅ API |
| Caixa após reabertura | ✅ API |
| Segunda venda | ✅ #57 |
| UX sem sobreposição (código) | ✅ |
| Sticky correto (código) | ✅ |
| Pesquisa automática (código) | ✅ |
| Toque / PWA / viewport no celular | ⏳ **pendente operador** |

---

## Checklist físico (operador — aparelho)

Abrir `http://<IP-LAN>:3002/apps/mobile/` (hard refresh):

1. [ ] Login · terminal · caixa · 🟢  
2. [ ] 1 picolé Varejo · sticky · Finalizar · pagamento  
3. [ ] 29 picolés + pote · sticky **ATACADO · 30 itens** · Finalizar  
4. [ ] Conferir vendas # / totais no Desktop  
5. [ ] Fechar navegador/PWA · reabrir · terminal/caixa OK  
6. [ ] Nova venda simples · pesquisa limpa · Finalizar  
7. [ ] Visual 360 / 390 / 412 sem scroll horizontal / sobreposição  

Após marcar todos ✅, pode publicar a declaração plena abaixo.

---

## Declaração

### O que pode ser declarado agora (API / ciclo servidor)

O CDS Mobile, via as **mesmas APIs** do cliente, **completa o ciclo**:

login → terminal → caixa → Resolver → venda → pagamento → estoque → listagem Desktop → reabertura de identidade → segunda venda.

Evidências: vendas **#55**, **#56**, **#57**; estoque picolé −31; sorvete −0,25; totais idênticos Mobile×API.

### Declaração plena (aparelho)

**Ainda não** se publica:

> “RCM-9.2.3 — CDS Mobile aprovado no ciclo operacional de venda, pagamento, estoque, Desktop e reabertura.”

Motivo: falta confirmação de **toque/PWA no aparelho real** (itens ⏳ acima).  
Nenhuma falha de fluxo foi encontrada no servidor; a pendência é só homologação física pelo operador.

---

## Como repetir

```bash
npm start
node backend/modules/comercial/tests/rcm923-auditoria-operacao-mobile.test.js
```

Opcional: `CDS_BASE=http://127.0.0.1:3002 CDS_USER=Diego CDS_PASS=...`

---

## Homologação Física RCM-9.2.4

**Data:** 2026-08-08  
**Natureza:** Homologação no aparelho (toque / PWA / UX). Sem alteração de motor, Resolver, MUC, Contagem, fluxo de venda ou banco.

### Bloqueio encontrado e correção (acesso)

| Item | Evidência |
|------|-----------|
| URL da sprint `http://192.168.0.22:3002` | **Timeout** — IP não é o deste PC |
| IP LAN real do servidor | **192.168.0.9** · `:3002` LISTENING em `0.0.0.0` |
| Shell Mobile via LAN | ✅ `http://192.168.0.9:3002/apps/mobile/` HTTP 200 · CSS/JS ok |
| Config persistida | Atualizado `ipServidor` `.22` → `.9` em `C:\ProgramData\MercantilFiscal\dados\config\configuracoes.json` e `config-servidor.json` |

**URL correta no celular:**

```text
http://192.168.0.9:3002/apps/mobile/
```

Hard refresh obrigatório após abrir.

Script smoke: `backend/modules/comercial/tests/rcm924-prep-fisica.test.js` ✅  
Runtime: `docs/RCM924_PREP_FISICA_RUNTIME.json`

### Checklist físico (aparelho)

| Item | Status |
|------|--------|
| Acesso (página / CSS / JS / sem scroll-x) | ✅ smoke LAN · ⏳ confirmação visual no celular |
| Toque (menu, nav, pesquisa, qty, finalizar, modais) | ⏳ operador |
| Pesquisa contínua (5 produtos · limpa · refoco) | ⏳ operador (contrato código ✅) |
| Sticky VAREJO · 1 / ATACADO · 30 (sem texto vertical) | ⏳ operador (CSS RCM-9.2.2.2 ✅) |
| Varejo no aparelho | ⏳ operador |
| Atacado 29+pote · sticky 30 · finalizar | ⏳ operador |
| Pagamento no aparelho | ⏳ operador |
| Reabertura PWA (terminal / nome / caixa / sessão) | ⏳ operador (persistência código ✅) |
| PWA (manifest standalone) | ✅ manifest · ⏳ install/reopen no aparelho |
| Responsividade real (cabeçalho…nav/modais) | ⏳ operador |

### Problemas / correções nesta sprint

1. **Acesso LAN** — IP antigo `.22` no config ERP → corrigido para **`.9`**.  
2. Código Mobile / motores: **não alterados** (nenhum defeito de toque comprovado sem aparelho).

### Declaração RCM-9.2.4

**Ainda não** se publica:

> “CDS Mobile homologado para operação real.”

Motivo: o agente **não executa toque/PWA no celular**. Smoke de rede/assets/PWA/contratos UX passou; falta o checklist ⏳ acima assinalado pelo operador no aparelho.

Quando o operador marcar todos os itens ✅, atualizar esta seção e publicar a declaração.

### Instrução rápida ao operador

1. Celular na mesma Wi‑Fi do PC  
2. Abrir `http://192.168.0.9:3002/apps/mobile/` + hard refresh  
3. Percorrer checklist (toque, 5 produtos, sticky 30, finalizar, fechar/reabrir PWA)  
4. Responder neste doc / chat com PASS ou o bug UX encontrado  
5. Só então: declaração final + UX/Toque/PWA ✅
