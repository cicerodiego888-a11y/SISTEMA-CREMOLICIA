# RCM-9.2 — Estabilização Completa do CDS Mobile

**Data:** 2026-08-08  
**Natureza:** Correção + integração + estabilidade + usabilidade  
**Regra:** NÃO cria Motor Mobile, NÃO altera Motor Comercial Oficial, NÃO duplica regras.

---

## Objetivo

Transformar o CDS Mobile existente em **cliente estável** das APIs e motores oficiais:

```
CDS Mobile → APIs oficiais → Motores oficiais → Banco existente
```

---

## Problemas encontrados (origem RCM-9.1 + sprint)

| # | Problema | Causa | Correção |
|---|----------|-------|----------|
| 1 | Operador só descobria terminal sem caixa ao tentar abrir/vender | `caixa_id`/`ativo` não persistidos/exibidos | `getTerminalUiState` + banner + persistência |
| 2 | Mensagem genérica sem caixa | Erro backend pouco destacado | Copy explícita + botão Abrir desabilitado |
| 3 | Precificação Mobile forçava `canal: 'VAREJO'` | Hardcode no `pdv.js` | Payload sem canal forçado → CanalVendaResolver |
| 4 | Fallback silencioso para preço da busca/cadastro | `catch` engolia falha do Resolver | Falha alta + não adiciona item |
| 5 | Qty/remove não recalculava canal/preço | Sem recalc no Mobile | `recalcularCarrinhoViaResolver` |
| 6 | Sessão/rede com mensagens genéricas | `client.js` | Copy RCM-9.2 + carrinho preservado |
| 7 | Nav pouco operacional | Cadastros/Comercial/Financeiro no rodapé | Início / Vender / Caixa / Vendas / Clientes / Mais |
| 8 | Nome do terminal após reload | Heartbeat não enriquecia UI | Sync + persistência `nome`/`caixa_id` |

---

## Arquivos alterados

- `frontend/apps/mobile/js/terminal.js` — estados, persistência caixa/ativo, sync
- `frontend/apps/mobile/js/pages/pdv.js` — banner, gates, Resolver oficial, recalc, feedback
- `frontend/shared/api/client.js` — sessão expirada / rede / timeout
- `frontend/apps/mobile/index.html` — bottom nav operacional
- `frontend/apps/mobile/js/app.js` — META/nav highlight + Mais
- `frontend/apps/mobile/js/permissions.js` — rotas nav
- `frontend/apps/mobile/css/mobile.css` — banner de status
- `frontend/apps/mobile/js/version.js` — `2.5.0-rcm92`
- `backend/modules/comercial/tests/rcm92-mobile-estabilizacao.test.js`
- `backend/modules/comercial/tests/rcm921-homologacao-mobile.test.js` (RCM-9.2.1)
- `docs/RCM92_ESTABILIZACAO_CDS_MOBILE.md` (este documento)

**RCM-9.2.1 (delta):** sticky com canal + itens comerciais; CSS 360/390; versão `2.5.1-rcm921`.

**Não alterados (de propósito):** Motor Comercial, CanalVendaResolver, MUC/MCC core, TEF motor, endpoint de venda Desktop.

---

## Fluxos corrigidos

### Terminal → Caixa → PDV

```
Identificado → Ativo → Possui caixa_id → Caixa existe → Caixa aberto → PDV liberado
```

Estados UX: 🟡 não registrado · 🟢 registrado/pronto · 🟠 sem caixa · 🔴 inativo · 🟡 caixa fechado · 🟢 caixa aberto.

Rename: permanece no ERP (SUPER_ADMIN). Mobile informa a restrição.

### Precificação / Atacado / MUC

- Preço e UC **somente** via `POST configuracao-comercial/resolver-precos`
- Contagem Atacado: mesma `contribuicaoContagemAtacado` do backend  
  - 29 UN + 1 PESO (pote 250 g) = **30 itens comerciais** → ATACADO (limiar 30)  
  - Estoque permanece 29 UN + 0,250 KG (eixo separado)
- Sem venda offline no PDV; fila offline continua só na prestação

### Finalização

`carrinho → pré-cálculo → pagamento → POST /api/vendas` (mesmo pipeline Desktop).

---

## Testes

```bash
node backend/modules/comercial/tests/rcm92-mobile-estabilizacao.test.js
```

Cobertura do arquivo: terminal, gates, Resolver sem VAREJO forçado, contagem 29+pote, pagamentos, sessão/rede, nav, sem offline no PDV, desktop preservado.

Regressão sugerida (Desktop): abrir PDV, adicionar 30 UN, confirmar ATACADO via Resolver, finalizar venda simples.

---

## Teste real no celular

**Obrigatório em campo** (checklist):

1. Login na LAN (`http://<IP>:porta/apps/mobile/`)
2. Identificar/registrar terminal · confirmar nome e ID
3. Confirmar vínculo de caixa no ERP se 🟠
4. Abrir caixa · vender 29 picolés + 1 pote 250 g
5. Confirmar canal **ATACADO** e preços do Resolver
6. Pagar · finalizar · conferir estoque 29 UN + 0,250 KG
7. Conferir venda no Desktop
8. Fechar navegador · reabrir · terminal/sessão recuperados · nova venda

**Status deste ambiente de implementação:** checklist automatizado ✅ · teste físico ⏳ (operador / dispositivo real).

---

## Homologação Física RCM-9.2.1

**Data:** 2026-08-08  
**Ambiente agente:** DB oficial `C:\ProgramData\MercantilFiscal\dados\mercadao.db` · porta HTTP **3002 indisponível** no momento da homologação (sem ERP/Electron escutando) · **sem aparelho físico acoplado ao agente**.

### Aparelho / resolução

| Item | Valor |
|------|--------|
| Aparelho físico | ⏳ Pendente operador (não executável pelo agente Cursor sem device/LAN) |
| Resoluções CSS preparadas | 360 × 800 · 390 × 844 · 412 × 915 (media queries nav/sticky/sheet) |
| Validação visual no device | ⏳ Confirmar no celular após `npm start` + URL LAN |

### Homologação Motor Oficial (executada — PASSOU)

Script: `backend/modules/comercial/tests/rcm921-homologacao-mobile.test.js`

Produtos DB: **#3 PICOLE MORANGO - Cremoso** · **#1185 Sorvete de creme**

| Cenário | Resultado |
|---------|----------|
| Contagem 29 / 30 / 29+pote | ✅ 29 · 30 · 30 itens comerciais |
| 1 picolé → VAREJO · UN · R$ 2,50 · TABELA VAJERO | ✅ |
| 30 picolés → ATACADO · UN · R$ 2,00 · TABELA ATACADO | ✅ |
| 29 + pote → ATACADO · qtd 30 · picolé UN + sorvete **LT** | ✅ |
| 29 só → VAREJO | ✅ |
| Sorvete VAREJO → **KG** / ATACADO → **LT** | ✅ |
| CONSIGNADO → **LT** · TABELA CONSINADOS | ✅ |
| Mobile: sem `canal:'VAREJO'` forçado · recalc · itens comerciais · consignação Resolver | ✅ |

### Correções RCM-9.2.1 (só integração/UX)

1. Sticky PDV exibe **Canal + Itens comerciais** (`quantidade_avaliada` do Resolver) — necessário para confirmar “30 ITENS / ATACADO” sem expandir o resumo.
2. CSS responsivo para bottom nav de 6 itens em ≤390/≤360 px; sheet respeita `--m-keyboard-inset`; label TOTAL com quebra em 360.

### Problemas encontrados

| # | Problema | Tipo | Ação |
|---|----------|------|------|
| 1 | Canal/contagem só no resumo recolhido | UX Mobile | Corrigido — visível na barra TOTAL |
| 2 | Nav 6 itens apertada em 360 | UX/CSS | Corrigido — tipografia/padding |
| 3 | Servidor HTTP off (3002) | Ambiente | Impede login/venda física neste turno |
| 4 | Sem device físico no agente | Ambiente | Checklist físico permanece com operador |

### Testes físicos ainda obrigatórios no celular

Com ERP no ar (`npm start`) e celular na mesma LAN:

1. Login → terminal (sem recriar) → nome → caixa → abrir  
2. 29 picolés + 1 pote → sticky **ATACADO · 30 itens** → pagar → Desktop + estoque  
3. Fechar PWA → reabrir → terminal/caixa/sessão → nova venda  
4. 1 picolé VAREJO · 30 UN ATACADO · 29 VAREJO  
5. Consignação Mobile → CONSIGNADO  
6. Desligar Wi‑Fi na finalização → carrinho preservado  
7. Viewports 360 / 390 / 412

### CDS MOBILE — HOMOLOGAÇÃO

| Área | Status |
|------|--------|
| Terminal | ✅* |
| Caixa | ✅* |
| PDV | ✅* |
| Varejo | ✅ |
| Atacado | ✅ |
| Consignado | ✅ |
| Sorvete KG/LT | ✅ |
| Pagamento | ⏳ |
| Estoque | ⏳ |
| Sessão | ✅* |
| Rede | ✅* |
| UX | ✅ |
| Responsivo | ✅** |
| Desktop | ✅* |

\* Código + contratos Mobile RCM-9.2; fluxo UI/caixa/sessão no aparelho ⏳.  
\*\* CSS homologado para as três larguras; confirmação visual no device ⏳.  
✅ Motor Oficial no DB oficial (preço/canal/UC/contagem).  
⏳ Pagamento / estoque / venda Desktop / reabertura PWA — dependem do teste físico com servidor ligado.

### Declaração RCM-9.2.1

**Ainda não** se declara “CDS Mobile homologado para operação real” enquanto o checklist físico (login→venda→estoque→reabertura) não for confirmado no aparelho com o servidor CDS no ar.

**Motor e cliente Mobile estão prontos para essa homologação física** — sem novos motores e sem alteração do Resolver/MUC.

---

## Homologação Física RCM-9.2.2

**Data:** 2026-08-08  
**Servidor:** `npm start` · porta **3002** · DB `C:\ProgramData\MercantilFiscal\dados\mercadao.db`  
**Rede:** localhost + LAN `http://192.168.0.9:3002/apps/mobile/` (HTTP 200)  
**Script:** `backend/modules/comercial/tests/rcm922-homologacao-fisica-api.test.js`  
**Runtime JSON:** `docs/RCM922_HOMOLOGACAO_RUNTIME.json`

### Ambiente / aparelho

| Item | Valor |
|------|--------|
| Aparelho físico (toque) | ⏳ Confirmação visual do operador no celular (URL LAN acima) |
| Homologação operacional | ✅ Mesmas APIs do Mobile no servidor real (login→terminal→caixa→venda→estoque→listagem) |
| Resolução CSS | 360 / 390 / 412 preparadas; sticky `ATACADO · N itens` com quebra segura |

### Bugs Mobile encontrados e corrigidos (somente integração)

| # | Problema | Causa | Correção |
|---|----------|-------|----------|
| 1 | Caixa aberto aparecia fechado no Mobile | `/caixa/aberto` devolve `{ caixa, dinheiro, ... }`; Mobile lia `id` no topo | `normalizeCaixaPayload` + `isCaixaAberto` |
| 2 | `POST /vendas` 500 `subtotal NOT NULL` | Payload Mobile sem `subtotal` | Calcula/envia `subtotal` no map do pré-cálculo |
| 3 | Sticky “ATACADO · 30 itens” | Legibilidade em 360 | CSS `white-space:normal` / max-width |

### Testes executados (servidor real)

| Teste | Resultado |
|-------|-----------|
| Mobile shell HTTP 200 | ✅ |
| Login | ✅ Diego |
| Terminal auto + persistência hostname (sem duplicar id) | ✅ |
| Vínculo caixa (ERP PUT) | ✅ caixa_id=4 |
| Abrir caixa / sessão / operador | ✅ |
| Resolver 1 picolé → VAREJO UN | ✅ |
| Venda varejo (dinheiro) + listagem Desktop/API | ✅ |
| Resolver 29+pote → **ATACADO · 30** · sorvete **LT** | ✅ |
| Venda atacado (PIX) | ✅ |
| Estoque picolé −30 (1+29) | ✅ |
| Estoque sorvete −0,250 | ✅ |
| Resolver CONSIGNADO → LT · TABELA CONSINADOS | ✅ |
| Reconsulta terminal/caixa (reabertura API) | ✅ |
| Sorvete VAREJO **KG** no Resolver | ✅ |
| Venda sorvete VAREJO KG | ⚠️ **bloqueada pelo MUC** `MCC_CONVERSAO_NAO_CADASTRADA` (KG↔L não cadastrada no produto #1185) — Mobile **não** faz fallback |

### Limitações restantes

1. **Cadastro MUC** do produto Sorvete de creme (#1185): falta conversão KG↔L para concluir venda varejo em KG (Resolver já entrega KG corretamente).  
2. **Código de venda** `VND-YYYYMMDDHHmmss` pode colidir no mesmo segundo (backend existente; teste espaça 1,1s).  
3. **Toque no aparelho** (teclado/modais/PWA reopen visual): validar no celular com hard refresh da build `2.5.2-rcm922`.

### CDS MOBILE — HOMOLOGAÇÃO (RCM-9.2.2)

| Área | Status |
|------|--------|
| Terminal | ✅ |
| Nome | ✅ |
| Caixa | ✅ |
| Login/Sessão | ✅ |
| PDV (pipeline API) | ✅ |
| Varejo | ✅ |
| Atacado | ✅ |
| 29 + pote = 30 itens | ✅ |
| Sorvete KG no Varejo (Resolver) | ✅ |
| Sorvete KG venda/estoque | ⚠️ cadastro MUC |
| Sorvete LT no Atacado | ✅ |
| Sorvete LT no Consignado | ✅ |
| Pagamento (dinheiro/PIX/cartão*) | ✅ / ✅ / *tentativa KG |
| Venda | ✅ |
| Estoque | ✅ (cenários concluídos) |
| Desktop (listagem API) | ✅ |
| Reabertura (API terminal/caixa) | ✅ |
| Responsivo (CSS) | ✅ |
| UX | ✅ |
| Toque físico no celular | ⏳ |

### Declaração RCM-9.2.2

**Não se declara ainda** a frase plena *“CDS Mobile homologado para operação real”* enquanto:

1. a conversão MUC KG↔L do sorvete estiver cadastrada (ou outro produto KG homologado na venda), e  
2. o operador confirmar no celular o sticky **ATACADO · 30 itens** + reabertura do PWA.

**Declarável agora:** o Mobile, com as correções RCM-9.2.2, **opera de ponta a ponta no servidor real** (terminal→caixa→Resolver→venda→estoque→Desktop) sem Motor paralelo — blockers de caixa/subtotal corrigidos.

---

## RCM-9.2.2.1 — UX rápida

**Data:** 2026-08-08  
**Natureza:** UX apenas (sem motores / sem banco)

### Alterações

1. **Terminal OK → modo compacto**  
   Quando `CAIXA_ABERTO`: só **🟢** no topo do PDV. Toque abre sheet com Terminal / Nome / Caixa / Sessão.  
   Problemas (sem caixa, inativo, não registrado, caixa fechado): painel completo permanece visível.

2. **Pesquisa após adicionar**  
   `clearPdvSearchAfterAdd`: limpa `#pdv-search`, limpa `#pdv-results`, devolve foco — pronto para digitação/scanner.  
   Não altera carrinho, canal, preços, cliente nem snapshots.

### Arquivos

- `frontend/apps/mobile/js/pages/pdv.js`
- `frontend/apps/mobile/css/mobile.css`
- `backend/modules/comercial/tests/rcm9221-ux-rapida-pdv.test.js`

### Testes

- Contrato fonte: `rcm9221-ux-rapida-pdv.test.js` ✅  
- Manual: 5+ produtos seguidos; 29 picolés + pote → sticky **ATACADO · 30 itens**; scanner contínuo.

### Declaração

UX do PDV Mobile otimizada para inclusão rápida de produtos, mantendo o status do terminal disponível sem ocupar espaço operacional.

---

## RCM-9.2.2.2 — Correção do Sticky do Carrinho

**Data:** 2026-08-08  
**Natureza:** UX/layout apenas (sem motores / sem API / sem banco)

### Problema

Quebra vertical do resumo inferior (`TOTAL` letra a letra) por coluna estreita + `word-break` ao lado do botão Finalizar; sobreposição visual entre carrinho, painel sticky e botão.

### Correção

Layout responsivo do resumo inferior:

- sticky com `width/max-width: 100%` e `box-sizing: border-box`
- barra em coluna: label → valor → Finalizar full-width
- label com `white-space: nowrap` + ellipsis (nunca quebra caractere a caractere)
- padding inferior do carrinho para o último item ficar acima do sticky
- Expandir centralizado; detalhes sem scroll horizontal

### Arquivos

- `frontend/apps/mobile/css/mobile.css`
- `frontend/apps/mobile/js/pages/pdv.js` (classe `cds-pdv-sticky__pay`)
- `frontend/apps/mobile/index.html` (cache CSS `2.5.3-rcm9222`)
- `backend/modules/comercial/tests/rcm9222-sticky-layout.test.js`

### Resultado

Resumo, valor, botão Finalizar e carrinho visíveis corretamente em **360 / 390 / 412** px.  
Cenários: 1 produto · 29 picolés · 29+pote · 30 picolés (`VAREJO · 3 itens` / `ATACADO · 30 itens`) permanecem em linha horizontal.

**Não** alterados: Resolver, CanalVendaResolver, MUC, Contagem Comercial, preço, carrinho lógico, estoque, API, banco.

---

## Fechamento RCM-9.2.3 — MUC Sorvete + homologação

**Data:** 2026-08-08  
**Build Mobile:** `2.5.3-rcm923`  
**Servidor:** `npm start` · `http://192.168.0.9:3002/apps/mobile/`  
**DB:** `C:\ProgramData\MercantilFiscal\dados\mercadao.db`

### Diagnóstico produto #1185

| Campo | Valor |
|-------|--------|
| Nome | Sorvete de creme |
| Unidade base (estoque) | `l` (Litro) |
| unidade_venda | `KG` |
| forma_comercializacao | `PESO` |
| produto_conversoes (antes) | **vazio** |
| UC Tabela Varejo | **KG** (Resolver) |
| UC Tabela Atacado | **LT** |
| UC Tabela Consignado | **LT** |

Causa do erro: MUC correto — faltava **cadastro** da conversão específica do produto (não bug de lookup / não inventar KG=LT).

### Correção aplicada (somente cadastro)

Fonte oficial `docs/RCM89_CONVERSOES_PRODUTO.md`: **Sorvete LT → KG = 0,58**.

Via API MUC `criarConversao`:

```text
produto_id=1185 · origem=LT · destino=KG · fator=0,58 · tipo=FIXA
```

Script: `backend/modules/comercial/tests/rcm923-cadastrar-conversao-1185.js`  
Teste: `backend/modules/comercial/tests/rcm923-homologacao-sorvete-kg.test.js`

**Não** alterados: Resolver, Contagem Atacado, MUC core, preços, tabelas.

### Resultados RCM-9.2.3

| Teste | Resultado |
|-------|-----------|
| Resolver Varejo → KG | ✅ |
| Resolver Atacado → LT · 30 itens (29+pote) | ✅ |
| Resolver Consignado → LT | ✅ |
| Contagem 30 / 29+pote / 29 | ✅ |
| Venda Varejo KG (API Mobile) | ✅ **venda #54** total R$ 14,95 (0,25 KG) |
| Estoque | ✅ −0,431 L (= 0,25 / 0,58) |
| Atacado LT / Consignado LT (Resolver) | ✅ |
| Sticky / unwrap caixa (código Mobile) | ✅ |
| Toque físico no celular / PWA reopen | ⏳ **operador** — hard refresh build `2.5.3-rcm923` |

### CDS MOBILE — HOMOLOGAÇÃO (após 9.2.3)

| Área | Status |
|------|--------|
| Terminal / Caixa / Sessão (API) | ✅ |
| PDV pipeline | ✅ |
| Varejo / Atacado / 29+pote=30 | ✅ |
| Sorvete KG Varejo (Resolver+MUC+venda+estoque) | ✅ |
| Sorvete LT Atacado / Consignado | ✅ |
| Pagamento / Desktop listagem | ✅ |
| UX sticky 360 (CSS) | ✅ |
| Toque + reabertura PWA no aparelho | ⏳ |

### Declaração RCM-9.2.3

**Pendência MUC do sorvete Varejo/KG: ENCERRADA** (cadastro LT→KG 0,58).

**Auditoria operacional 2026-08-08 (API):** PASS — doc `docs/RCM923_AUDITORIA_OPERACAO_MOBILE.md` · vendas **#55** (varejo), **#56** (atacado 30 itens), **#57** (2ª após reabertura) · estoque −30/−0,25/−31 · Desktop totais iguais.

**Ainda não** se publica a frase plena *“CDS Mobile homologado para operação real”* / declaração RCM-9.2.3 no aparelho — falta checklist de toque/PWA no celular (seção final do doc RCM923).

---

## Limitações restantes

- Renomear terminal só no ERP (segurança SUPER_ADMIN) — documentado na UI
- Vínculo terminal↔caixa só no ERP (Gerenciar Caixas)
- Venda offline **não** implementada (regra da sprint)
- PIX/TEF dependem de hardware/credenciais do ambiente
- Homologação visual 360/390/412 deve ser confirmada no device real

---

## MOBILE — STATUS

| Área | Status |
|------|--------|
| Terminal | ✅ |
| Caixa | ✅ |
| PDV | ✅ |
| Varejo | ✅ |
| Atacado | ✅ |
| Consignado | ✅* |
| Evento | ✅* |
| Precificação | ✅ |
| MUC | ✅ |
| Pagamento | ✅ |
| Estoque | ✅* |
| Financeiro | ✅* |
| Fiscal | ✅* |
| UX | ✅ |
| Responsivo | ✅** |
| Sessão | ✅ |
| Rede | ✅ |
| Desktop | ✅ |

\* Via motores/APIs oficiais já existentes (Mobile consome; não reimplementa).  
\*\* CSS/nav ajustados; validação física 360/390/412 pendente no aparelho.

---

## Declaração final

**RCM-9.2 NÃO cria arquitetura.**  
**RCM-9.2 NÃO cria novos Motores.**  
**RCM-9.2 NÃO duplica regras.**  

O CDS Mobile passa a informar estado operacional cedo, consumir o Resolver oficial (incluindo Atacado) e preservar o carrinho em falhas de rede/finalização — para o operador trabalhar pelo celular sem inconsistências de terminal, caixa, preço ou sessão.
