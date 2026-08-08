# AUDITORIA RCM-9.1 — CDS Mobile: Vendas + Terminal

**Data:** 2026-08-08  
**Tipo:** SOMENTE DIAGNÓSTICO (sem alteração de código, banco, API ou arquitetura)  
**Ambiente observado (runtime):** Electron/`npm start` — porta **3002**, `tipoImplantacao: ERP_MULTICAIXA`, `multiCaixa: true`, `ipServidor: 192.168.0.22`, DB `C:\ProgramData\MercantilFiscal\dados\mercadao.db`

---

## Sumário executivo

O Mobile **tem fluxo completo de venda** e **chama** `POST /api/vendas` quando passa pelos gates. A impossibilidade prática de vender, no modo multi-caixa atual, concentra-se em **cadeia Terminal → vínculo com Caixa → Sessão aberta**, não na ausência do endpoint de venda.

A inconsistência de nome/identidade do terminal vem de: (1) hostname sintético por dispositivo (`mobile-{ts}-{rand}`) persistido no **browser storage**; (2) nome gravado só no **INSERT** do auto-registro; (3) **renomeação** restrita a SUPER_ADMIN / ERP; (4) **gestão de vínculo terminal↔caixa ausente no Mobile**.

---

## 1. Terminal / Identidade

### 1.1 Cadastro e auto-registro

| Item | Evidência |
|------|-----------|
| Endpoint | `GET /api/terminais/auto` — `backend/server.js` (sem JWT) |
| Handler | `registrarTerminalAuto` — `backend/rotas/terminais.js` |
| Lookup | `SELECT * FROM terminais WHERE hostname = ?` (UNIQUE) |
| INSERT | `nome`, `hostname`, `usuario_*`, `cliente_tipo`, `plataforma`, `ultimo_ip` |
| UPDATE (heartbeat) | **Não atualiza `nome`** — só `ultima_conexao`, usuário e meta de cliente |

**Rejeição explícita de hostname:**

```javascript
if (!hostname || hostname === 'web-browser') {
  return res.status(400).json({ error: 'Hostname do terminal inválido.' });
}
```

No código atual do Mobile **não** se envia `web-browser`. Desktop browser PDV usa `pdv-{ts}-{rand}` (`frontend/shared/js/estacaoHostname.js`). Mobile usa `mobile-{ts}-{rand}` (`frontend/apps/mobile/js/terminal.js` → `ensureHostname`).

### 1.2 O que identifica um celular

| Camada | Identificador | Persistência |
|--------|---------------|--------------|
| Dispositivo (app) | `hostname` sintético | `localStorage.cds_mobile_terminal_hostname` |
| Plataforma | `terminal_id` (= `terminais.id`) | `localStorage.cds_mobile_terminal_id` |
| Exibição | `nome` | `localStorage.cds_mobile_terminal_nome` + coluna `terminais.nome` |
| Headers | `X-Terminal-Id`, `X-CDS-Client: mobile` | por request |
| JWT | **não** carrega `terminal_id` no login mobile | login só `{ username, password }` |

**Estabilidade:** enquanto o `localStorage` do browser/PWA do celular não for limpo, o mesmo `hostname` → mesmo `terminal_id`. Limpar dados do site gera **novo** hostname e **novo** terminal no banco (sem `caixa_id`).

### 1.3 Nome do terminal

| Pergunta | Resposta |
|----------|----------|
| Onde cadastrar (1ª vez) | Tela Mobile “Registrar Terminal” (`pdv.js` → `renderRegisterTerminal`) |
| Endpoint que grava nome na criação | `GET /terminais/auto?nome=…&hostname=…&origem=mobile` (só no INSERT) |
| Campo no banco | `terminais.nome` |
| Endpoint de rename | `PUT/POST /api/terminais/auto/nome` (**SUPER_ADMIN**) ou `PUT /api/terminais/:id` (JWT + multiCaixa) |
| Mobile chama rename depois? | **Não** — após registro não há tela de “renomear este terminal” no PDV |
| Heartbeat sobrescreve nome? | **Não** no UPDATE do backend |
| Auto-registro recria terminal? | Só se hostname novo (storage limpo / outro browser) |
| Onde exibe | Aba Caixa do PDV Mobile (`term.nome`); lista Caixas/Terminais (`caixas.js`) |

**Causa do “não consigo dar nome”:** o operador **consegue** informar nome na 1ª tela de registro; o que falha depois é **renomear**, **garantir que o ERP mostre/vincule** esse terminal, e **não perder a identidade** ao limpar o storage. A API de rename existe, mas exige SUPER_ADMIN e **não é usada pelo fluxo operacional do Mobile**.

---

## 2. Caixa / Sessão

### Fluxo oficial (multi-caixa = ON neste ambiente)

```
Terminal registrado (hostname estável + terminal_id)
        ↓
Vínculo terminais.caixa_id  ← feito no ERP “Gerenciar Caixas” (Mobile NÃO faz)
        ↓
POST /api/caixa/abrir { valor_inicial, terminal_id }  (+ X-Terminal-Id)
        ↓
caixa_sessoes status=aberto
        ↓
POST /api/vendas  (middleware validarCaixaAberto)
```

### Endpoints

| Método | Path | Exige |
|--------|------|--------|
| `GET` | `/api/caixa/aberto` | JWT; resolve `terminal_id` de body/query/`X-Terminal-Id` |
| `POST` | `/api/caixa/abrir` | JWT + `exigirTerminalId` (multi-caixa) + `validarTerminalParaAbertura` |
| `POST` | `/api/vendas` | JWT + `validarCaixaAberto` |

### `validarTerminalParaAbertura` (bloqueios reais)

1. Terminal não encontrado  
2. Terminal inativo  
3. **`caixa_id` nulo** → `"Terminal não vinculado a um caixa. Vincule no ERP em Gerenciar Caixas."`  
4. Caixa inativo  

### Etapa mais provável de quebra no Mobile

| Ordem | Etapa | Sintoma |
|------:|-------|---------|
| 1 | Rede (celular ≠ host Electron) | “Falha de rede…” — nunca chega ao auto/caixa |
| 2 | Terminal sem `caixa_id` | Falha ao **Abrir caixa** |
| 3 | Caixa fechado | Finalizar venda **desabilitado** / toast “Abra o caixa…” |
| 4 | `terminal_id` ausente | `400 terminal_id é obrigatório no modo multi-caixa` |
| 5 | Sessão não encontrada p/ terminal | `Nenhum caixa aberto neste terminal` no pré-cálculo/venda |

O Mobile **não quebra por falta de chamada a `/vendas`** se passar de 1–4; o POST existe (`pdv.js` ~linha 575).

---

## 3. Venda Mobile — mapa por etapa

| Etapa | Endpoint | Payload / notas | Headers | Falha típica |
|-------|----------|-----------------|---------|--------------|
| Produto | `GET produtos/consulta-pdv/buscar` ou `produtos/search` | q, limite | Auth + X-CDS-Client + X-Terminal-Id | rede / 401 |
| Preço | `POST configuracao-comercial/resolver-precos` | `{ itens, canal: 'VAREJO' }` **hardcoded** | idem | fallback silencioso p/ preço da busca |
| Carrinho | — | `sessionStorage` `cds-mobile-pdv-cart` | — | limpa ao fechar aba |
| Pagamento (UI) | — | dinheiro / PIX / cartão / TEF | — | — |
| Pré-cálculo | `POST vendas/pre-calcular-distribuicao` | itens + `emitir_fiscal` + `terminal_id` | + validarCaixaAberto | caixa/terminal |
| Venda | `POST vendas` | itens, total, pagamentos[], `terminal_id`; **sem `cliente_id` / `canal_venda`** | idem | estoque / caixa / validação |
| Pós NF | `POST fiscal/emitir/venda/:id` | opcional | idem | SEFAZ / config fiscal |
| Estoque / Financeiro | server-side na criação | — | — | regras backend |

**Conclusão:** o Mobile **chega** a `POST /api/vendas` quando terminal+caixa estão OK. Não há evidência de que o botão Finalizar chame outro backend.

---

## 4. Erros mapeados (relevância Mobile)

### Efetivamente ligados ao fluxo Mobile atual

| Erro | Quando | Severidade |
|------|--------|------------|
| Hostname do terminal inválido | hostname vazio/`web-browser` | P1 (config/bug cliente) |
| Terminal não vinculado a um caixa… | abrir caixa sem `caixa_id` | **P0** |
| Terminal inativo / caixa inativo | abrir caixa | P0/P1 |
| Já existe um caixa aberto neste terminal | reabrir | P2 |
| terminal_id é obrigatório no modo multi-caixa | abrir/vender sem id | **P0** |
| Nenhum caixa aberto neste terminal | vender com caixa fechado | **P0** |
| Abra o caixa antes de vender (UI) | Finalizar com caixa fechado | **P0** (gate client) |
| Falha de rede / timeout | API_URL/host inacessível | **P0** |
| 401 / sessão | token inválido | P0 operacional |

### Possíveis, mas secundários para “não vende”

estoque insuficiente, produto inválido, pagamento/TEF/PIX, fiscal SEFAZ, licença, permissão `abrir_caixa`.

### “web-browser”

Backend **bloqueia**. Mobile **não usa**. Risco residual: cliente legado/cache antigo ou outro front; não é o caminho oficial do CDS Mobile atual.

---

## 5. Identidade do Mobile — avaliação

| Mecanismo | Existe? | Suficiente? |
|-----------|---------|-------------|
| `terminal_id` estável via hostname em localStorage | Sim | Parcial — depende do storage do browser |
| Device ID nativo / IMEI / install-id PWA | Não | — |
| JWT com terminal | Não (mobile) | Identidade runtime = header/body |
| Heartbeat 2 min | Sim | Mantém online; não renomeia |

**Veredito:** mecanismo **funcional porém frágil**. Suficiente se o operador não limpar dados e o ERP vincular o terminal. **Inconsistente** entre aparelhos (cada um gera hostname próprio — correto) e após wipe de storage (vira “outro terminal”).

**Nesta sprint não se propõe nova identidade** — apenas o diagnóstico acima.

---

## 6. Nome do terminal — síntese do problema

```
[Mobile] Digita nome → registerTerminal
    → localStorage.nome = X
    → GET terminais/auto?nome=X&hostname=mobile-…
    → INSERT terminais.nome = X   (primeira vez)
    → UI PDV mostra X

Depois:
  - Heartbeat NÃO altera terminais.nome
  - Não há tela Mobile para PUT /terminais/auto/nome
  - PUT /auto/nome exige SUPER_ADMIN
  - Gestão/vínculo = ERP Desktop (“Gerenciar Caixas”)
  - Limpar storage → novo hostname → novo terminal (nome “perdido” do ponto de vista do usuário)
```

---

## 7. Comparação Desktop × Mobile

| Função | Desktop | Mobile | Diferença |
|--------|---------|--------|-----------|
| Login | ✔ | ✔ | Login compartilhado; Mobile → `/apps/mobile/` |
| Terminal | ✔ OS hostname (Electron) / `pdv-*` (browser) | ✔ `mobile-*` | Identidade sintética no phone |
| Nome terminal | ✔ + rename SUPER_ADMIN/ERP | ✔ só no 1º registro | Mobile sem rename operacional |
| Caixa abrir/fechar | ✔ | ✔ | Mesmas APIs |
| Sessão | ✔ por terminal | ✔ por terminal | Igual no multi-caixa |
| Operador | ✔ JWT | ✔ JWT | Igual |
| Catálogo | ✔ | ✔ | Igual |
| Carrinho | ✔ | ✔ sessionStorage | Volátil no Mobile |
| Precificação | ✔ Motor + Atacado | ✔ Motor **forçado VAREJO** | Gap RCM-9.0.3 |
| Atacado | ✔ | ✖ | canal hardcoded |
| Pagamento | ✔ | ✔ | TEF físico limitado no phone |
| Venda | ✔ `POST /vendas` | ✔ `POST /vendas` | Mobile sem `cliente_id`/`canal_venda` |
| Estoque | ✔ backend | ✔ backend | Igual |
| Fiscal | ✔ | ✔ opcional pós-venda | Igual conceito |
| Histórico | ✔ | ✔ | Igual API |
| Fechamento | ✔ | ✔ | Igual |
| Gerenciar Caixas / vínculo | ✔ ERP | ✖ | **PARITY_MATRIX: pendente** |
| Gestão Terminais | ✔ ERP | ✖ lista somente | Sem vincular/renomear |

---

## 8. Rede

| Item | Valor / risco |
|------|----------------|
| API_URL Mobile | `location.origin + '/api'` (`frontend/shared/api/client.js`) — **mesmo origin** da página |
| URL correta do celular | `http://192.168.0.22:3002/apps/mobile/` (IP do config avançado / LAN do PC) |
| Risco localhost | Abrir `http://127.0.0.1:3002` **no celular** → API no próprio celular → **falha** |
| Porta | 3002 (pode mudar se ocupada no Electron) |
| CORS | Origens LAN privadas liberadas (`isPrivateLanHost`) |
| Firewall Windows | Pode bloquear inbound 3002 → P0 rede |
| Desktop vs Mobile backends | **CRÍTICO se** o phone apontar para outro processo Node/outra porta/`DB_DIR` |

**Desktop Electron** sobe servidor local e abre `127.0.0.1`. **Mobile** só compartilha dados se acessar **esse** servidor via IP LAN.

---

## 9. Banco / Instância

| Item | Evidência |
|------|-----------|
| Path | `DB_DIR` → `ProgramData\MercantilFiscal\dados\mercadao.db` (`backend/database.js`) |
| Mesma instância? | Sim **se** Desktop e Mobile falam com o **mesmo** processo Node |
| Risco | Segundo `npm start` / outro `PORT` / outro `DB_DIR` → dois mundos |

Não há indício de Mobile usando SQLite embutido separado: o Mobile é cliente HTTP puro.

---

## 10. Problemas classificados

### P0 — Impede venda no Mobile

| # | Problema | Causa | Arquivo / endpoint | Evidência | Impacto | Solução recomendada (futura) | Risco correção |
|---|----------|-------|--------------------|-----------|---------|------------------------------|----------------|
| P0-1 | Terminal sem caixa | Auto-registro cria terminal com `caixa_id` NULL; abrir exige vínculo ERP | `caixa.js` `validarTerminalParaAbertura`; Mobile não vincula | Erro literal no abrir caixa | Não abre sessão → não vende | UX: após registrar, orientar/vincular; ou API Mobile admin p/ vínculo | Médio — toca multi-caixa |
| P0-2 | Caixa fechado | Gate UI + `validarCaixaAberto` | `pdv.js`; middleware vendas | Toast / 400 | Não POST vendas | Operacional: abrir caixa; melhorar mensagem com causa | Baixo |
| P0-3 | Celular não alcança servidor | API same-origin + firewall/IP/porta | `client.js`; Electron bind | Falha de rede | Nada funciona | Doc/QR com URL LAN; firewall; porta fixa | Baixo |
| P0-4 | `terminal_id` perdido | Storage limpo / não registrado | `terminal.js` | Gate “Registrar Terminal” | Bloqueia PDV | Persistir melhor + re-vínculo | Médio |

### P1 — Impede operação correta

| # | Problema | Causa | Evidência | Solução futura | Risco |
|---|----------|-------|-----------|----------------|-------|
| P1-1 | Não renomeia terminal | Rename SUPER_ADMIN; Mobile sem tela | `terminais.js` `exigirSuperAdminTerminal` | Permitir rename ao dono do terminal ou tela ERP clara | Baixo/Médio |
| P1-2 | Novo terminal após wipe | Novo `mobile-*` hostname | `ensureHostname` | Install-id mais estável (sem inventar nesta sprint) | Médio |
| P1-3 | Backend A ≠ B | URL/porta/`DB_DIR` divergentes | config avançada + server.js | Único servidor; health com DB path | Alto se mal feito |

### P2 — Inconsistência funcional

| # | Problema | Causa | Impacto |
|---|----------|-------|---------|
| P2-1 | Canal sempre VAREJO | `pdv.js` hardcode `canal: 'VAREJO'` | Preço/atacado divergente do Desktop |
| P2-2 | Sem `cliente_id` / `canal_venda` no POST | Payload mobile enxuto | Backend default VAREJO |
| P2-3 | Heartbeat ignora `nome` no UPDATE | Design atual | Nome na query do heartbeat não “salva de novo” |

### P3 — UX

| # | Problema | Nota |
|---|----------|------|
| P3-1 | Mensagens genéricas | “Falha ao abrir caixa” sem sempre destacar “vincule no ERP” |
| P3-2 | Lista terminais no Mobile sem ações | Só leitura (`caixas.js`) |
| P3-3 | PARITY: Gerenciar Caixas ✖ | Documentado em `PARITY_MATRIX.md` |

---

## 11. O que esta sprint **não** fez

- Não alterou código, banco, migrations, APIs ou arquitetura.  
- Não implementou correções.  
- Não criou identidade de dispositivo nova.

---

## 12. Respostas finais (A–J)

### A) Causa principal da impossibilidade de venda

No ambiente **ERP_MULTICAIXA**, a venda Mobile depende de **terminal registrado + vinculado a um caixa no ERP + sessão aberta**. O ponto mais crítico de negócio/código é o **vínculo `terminais.caixa_id`**, exigido em `validarTerminalParaAbertura`. Sem isso, o fluxo **nem chega** (ou falha antes) ao `POST /api/vendas`. Em paralelo, **rede** (celular não apontando para `http://<IP-LAN>:3002`) é P0 de infraestrutura.

### B) Causa da inconsistência do terminal / nome

Identidade baseada em **hostname sintético no localStorage**; nome aplicado **somente no INSERT** do auto-registro; **renomeação** não faz parte do fluxo operacional Mobile (API restringida a SUPER_ADMIN); limpeza de storage cria **outro** terminal.

### C) Mesma origem?

**Parcialmente sim:** ambos nascem da fragilidade do ciclo **auto-registro Mobile ↔ gestão só no ERP**.  
**Não totalmente:** rede/firewall é causa independente; gap de Atacado/VAREJO é outro eixo (P2).

### D) Menor correção necessária (recomendação futura)

1. Checklist operacional imediato (sem código): no ERP, vincular o terminal Mobile a um caixa; no celular abrir `http://192.168.0.22:3002/apps/mobile/`; registrar terminal; abrir caixa; vender.  
2. Menor patch de produto (próxima sprint): após `registerTerminal`, se `caixa_id` nulo, **bloquear com mensagem explícita** + deep-link/orientação ao ERP; opcionalmente permitir rename sem SUPER_ADMIN para o próprio hostname.

### E) Arquivos que deverão ser alterados (quando for corrigir)

- `frontend/apps/mobile/js/terminal.js`  
- `frontend/apps/mobile/js/pages/pdv.js`  
- `frontend/apps/mobile/js/pages/caixas.js` (gestão/vínculo, se mobile)  
- Possivelmente `backend/rotas/terminais.js` (política de rename / não recriar)  
- Possivelmente telas ERP de Gerenciar Caixas (UX de vínculo)  
- Docs de implantação (URL LAN)

### F) Será necessário alterar banco?

**Não obrigatório** para destravar vendas — campos `terminais.nome` / `caixa_id` já existem.  
Só seria necessário se se optar por install-id dedicado (fora do escopo desta auditoria).

### G) Será necessário alterar API?

**Não obrigatório** para o caminho mínimo (usar APIs atuais + vínculo ERP).  
**Sim**, se quiser rename sem SUPER_ADMIN ou vínculo terminal↔caixa pelo Mobile.

### H) Impacto no Desktop

Correções de vínculo/mensagem são neutras ou positivas. Mudança de política SUPER_ADMIN no rename afeta PDV Desktop também — avaliar.

### I) Impacto no Mobile

Desbloqueia abertura de caixa e venda; melhora percepção de “nome do terminal”; reduz terminais órfãos após wipe (se houver identidade mais estável depois).

### J) Testes para homologação

1. Celular na mesma LAN → abrir URL com IP do PC:3002 → login.  
2. Registrar terminal com nome “Celular Loja 1” → conferir em ERP Gerenciar Caixas.  
3. Vincular terminal ao caixa → Abrir caixa no Mobile → vender 1 item → conferir venda no Desktop.  
4. Reload da página Mobile → mesmo `terminal_id` / nome.  
5. Fechar caixa → Finalizar deve bloquear.  
6. (Negativo) Desvincular caixa → Abrir deve falhar com mensagem de vínculo.  
7. (Rede) Tentar localhost no phone → deve falhar; documentar.  
8. (P2) Comparar preço Atacado Desktop vs Mobile no mesmo carrinho.

---

## Apêndice — Referências de código

| Tema | Path |
|------|------|
| Auto terminal | `backend/rotas/terminais.js` (`registrarTerminalAuto`, `atualizarNomeTerminalPdv`) |
| Rotas | `backend/server.js` |
| Multi-caixa | `backend/utils/multiCaixa.js` |
| Abrir caixa | `backend/rotas/caixa.js` (`validarTerminalParaAbertura`) |
| Vendas | `backend/rotas/vendas.js` + `VendaPagamentoService.js` |
| Mobile terminal | `frontend/apps/mobile/js/terminal.js` |
| Mobile PDV | `frontend/apps/mobile/js/pages/pdv.js` |
| Mobile caixas | `frontend/apps/mobile/js/pages/caixas.js` |
| API client | `frontend/shared/api/client.js` |
| Paridade | `frontend/apps/mobile/PARITY_MATRIX.md` |
| Gap canal | `docs/CERTIFICACAO_FINAL_MOTOR_COMERCIAL.md` |

---

**Fim da auditoria RCM-9.1 — nenhum código foi modificado.**
