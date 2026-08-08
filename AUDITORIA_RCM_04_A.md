# AUDITORIA RCM-04.A — Sincronização Mobile × ERP

**Data:** 2026-07-30  
**Escopo:** Diagnóstico apenas (sem implementação)  
**Sintoma reportado:** Consignações criadas no CDS Mobile “permanecem só no app” e não aparecem imediatamente no ERP Desktop.

---

## Veredito executivo

**Não existe sincronização Mobile→ERP no sentido clássico (espelho local → push).**  
Mobile e Desktop consomem o **mesmo backend** (`/api/comercial/*`) e gravam no **mesmo SQLite oficial** (`mercadao.db`).

A causa raiz mais provável do sintoma **não** é “gravação só no celular”, e sim uma combinação de:

1. **Lista Desktop sem nome de cliente** + busca/filtro por nome que falha  
2. **Valor exibido R$ 0,00** em RASCUNHO (enrichment da Central)  
3. **Filtros/favoritos de status** no cockpit (ex.: só ENTREGUE)  
4. **Atualização lenta** (polling 60s, sem push)  
5. *(condicional)* **dois servidores / dois caminhos de DB** se Mobile e Electron não apontarem para a mesma instância

**Classificação dominante do sintoma:** **Alto** (UX/listagem), não Crítico de arquitetura de dados — salvo ambiente com DB duplicado.

---

## Respostas objetivas (checklist)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Endpoint ao criar no Mobile? | `POST /api/comercial/consignacoes` via `window.CDSApi.post('comercial/consignacoes', …)` |
| 2 | Grava no banco oficial do ERP? | **Sim** — `CriarConsignacaoUseCase` → `ConsignacaoRepository.inserir` → tabela `consignacoes` |
| 3 | Gravação só local (SQLite/IndexedDB)? | **Não** para consignação. Só `localStorage` de fila RCM-04.1 (`rateio`/`fechar`), não create |
| 4 | Desktop consulta a mesma tabela? | **Sim** — `GET /api/comercial/consignacoes` → mesmo repositório |
| 5 | Evento de sincronização pós-gravação? | Evento de domínio `ConsignacaoCriada` (outbox interno); **não** há push para UI Desktop |
| 6 | Desktop tem WS/SSE/polling? | **Polling 60s** na Central de Consignações; **sem** WebSocket/SSE |
| 7 | Cache impede atualização? | SW Mobile **não** cacheia `/api/*`. Desktop: memória da página + filtros; sem cache HTTP de lista |
| 8 | Chega ao banco e só não aparece? | **Cenário mais plausível: sim** (filtro/UX/refresh) |
| 9 | APIs Mobile ≠ Desktop? | **Mesmo contrato HTTP**; clients diferentes (`CDSApi` vs `MotorComercialApi`); headers Mobile extras sem filtro de listagem |
| 10 | Fila de sincronização pendente? | Só `cds-mobile-offline-queue-v1` para finalizar/rateio offline — **não** afeta create |

---

## Fluxo atual

```text
[CDS Mobile]  Nova consignação
     │
     ▼
 CDSApi  POST  {origin}/api/comercial/consignacoes
     │   body: { clienteId, perfilComercialId, observacao, dataAbertura, usuarioId }
     │   header: Authorization + X-CDS-Client: mobile (+ X-Terminal-Id opcional)
     ▼
 Express  /api/comercial  (verificarToken)
     ▼
 ConsignacaoController.criar
     ▼
 CriarConsignacaoUseCase  → status RASCUNHO → INSERT consignacoes
     ▼
 SQLite  ProgramData\MercantilFiscal\dados\mercadao.db
     │
     ├── Mobile lista: GET /api/comercial/consignacoes  (sem filtro)
     └── Desktop lista: GET /api/comercial/consignacoes  (+ filtros UI status/cliente)
                        polling a cada 60s OU botão Atualizar
```

**Não há** passo “sync agent” entre app e ERP.

---

## Fluxo esperado (arquitetural)

1. Escrita online no SSOT (já ocorre).  
2. Leitura imediata no Desktop da mesma fonte (já ocorre na API).  
3. UI Desktop deve refletir o registro **sem ambiguidade** (nome do cliente, status RASCUNHO visível, valor coerente ou “—”).  
4. Ideal: notificação/push ou refresh direcionado após mutações cross-client (hoje **ausente**).

---

## Banco utilizado

| Item | Valor |
|------|--------|
| Engine | SQLite (`sqlite3`) |
| Arquivo | `{DB_DIR}/mercadao.db` |
| Default `DB_DIR` | `%PROGRAMDATA%\MercantilFiscal\dados` (ou `process.env.DB_DIR`) |
| Tabela | `consignacoes` (+ `consignacoes_itens`, movimentações, rateio RC4.2, etc.) |
| Definição | `backend/database.js`, migration `002_consignacoes.js` |

Uma única instância Node (`npm start`) = um único `mercadao.db`.  
Se existir segundo processo Node com outro `DB_DIR` / outra pasta de dados → **dois mundos** (Crítico condicional).

---

## APIs utilizadas (amostra)

| Operação | Método / path |
|----------|----------------|
| Criar | `POST /api/comercial/consignacoes` |
| Listar | `GET /api/comercial/consignacoes` |
| Detalhe / itens | `GET .../consignacoes/:id`, `.../itens` |
| Entrega | `POST .../entrega` |
| Prestação abrir/fechar | `POST .../prestacao/abrir`, `.../fechar` |
| Venda / perda / cortesia | `POST .../prestacao/venda\|perda\|cortesia` |
| Devolução | `POST .../devolucao` |
| Pagamento | `POST .../prestacao/pagamento` |
| Rateio | `GET/PUT .../prestacao/rateio-perda` |
| Clientes | `/api/clientes`, `/api/comercial/perfil-comercial*` |
| Projeções | `/api/comercial/projections/*` |

---

## Eventos existentes

| Evento | Onde | Efeito na UI Desktop |
|--------|------|----------------------|
| `ConsignacaoCriada` | `comercialEventosTipos` + outbox/UoW | **Não** atualiza lista em tempo real |
| Outbox comercial | Integrações assíncronas | Não é “sync Mobile↔Desktop” |

---

## Validação por domínio

| Domínio | Mesma API/DB? | Observação |
|---------|---------------|------------|
| Consignação (criar/listar) | ✔ | Sintoma concentrado na **listagem Desktop** |
| Entrega | ✔ | `POST .../entrega` |
| Prestação de Contas | ✔ | Abrir/grade/rateio/fechar oficiais |
| Recebimentos | ✔ | `POST .../prestacao/pagamento` |
| Perdas | ✔ | `POST .../prestacao/perda` + rateio RC4.2 |
| Clientes / perfil consignado | ✔ | `/clientes` + `/perfil-comercial` |
| Pedidos | — | **Não há** módulo “Pedidos” separado no Mobile; fluxo é consignação |

---

## Problemas encontrados (classificados)

### 1. Lista HTTP sem `clienteNome` — busca Desktop por nome falha  
**Severidade: Alto**

- `ConsignacaoResponse.toJSON` devolve `clienteId`, **não** o nome.  
- Desktop `mapConsignacaoView` → label = `String(clienteId)`.  
- Filtro `_applyClientPipeline` (search/cliente) compara texto com esse label.  
- Operador busca “João” → **zero linhas**, embora o registro exista no banco.

**Arquivos:**  
`backend/.../http/dto/ConsignacaoDTO.js` (`ConsignacaoResponse`)  
`frontend/modules/motor-comercial/api/helpers.js`  
`frontend/modules/motor-comercial/pages/Consignacoes/index.js`

---

### 2. Valor forçado a R$ 0,00 em RASCUNHO  
**Severidade: Alto**

```js
// badges.js — enrichConsignacaoOperationalFlags
valor: Number(resumo.valorConsignado ?? resumo.valorVendido ?? 0)
```

RASCUNHO sem entrega → resumo sem valor → UI mostra **R$ 0,00**.  
Facilita a percepção de “não gravou / não sincronizou”.

**Arquivo:** `frontend/modules/motor-comercial/pages/Consignacoes/badges.js`

---

### 3. Filtros / favoritos de status escondem RASCUNHO  
**Severidade: Médio**

- Mobile cria sempre `STATUS_RASCUNHO`.  
- Se o cockpit Desktop estiver com Situação = ENTREGUE (ou favorito salvo), a API/`apiParams.status` **não retorna** o rascunho Mobile.  
- Paginação client-side (20) sobre o snapshot filtrado aumenta a chance de “sumir” visualmente.

**Arquivo:** `Consignacoes/index.js` (`filters.status`, favoritos `motor-comercial:cockpit-filtros-favoritos`)

---

### 4. Sem push cross-client; polling 60s  
**Severidade: Médio**

- Sem WebSocket/SSE no Motor Comercial.  
- Auto-refresh: `REFRESH_INTERVAL_MS = 60000`.  
- Sem clicar **Atualizar**, atraso de até 1 minuto (ou mais, se a página estiver em outra rota).

---

### 5. Filtro “Operador” compara ID numérico com texto  
**Severidade: Médio**

`c.usuario = usuarioAberturaId`. Digitar nome do operador zera a lista.

---

### 6. Offline queue não cobre create (e navegação offline bloqueia)  
**Severidade: Baixo** (para o sintoma “não aparece no ERP”)

- Create **exige online**.  
- `app.js` aborta navegação se `navigator.onLine === false`.  
- Fila local só rateio/fechar (RCM-04.1).  
Não explica consignação **visível no Mobile** e ausente no ERP (isso implica create online bem-sucedido).

---

### 7. Headers Mobile ≠ Desktop  
**Severidade: Baixo**

`X-CDS-Client: mobile` / terminal — **não** usados no `listar` de consignações. Sem impacto direto.

---

### 8. Fallback Desktop `localhost:3000` se `API_URL` ausente  
**Severidade: Médio (ambiente)**

`motor-comercial/bootstrap/index.js` → fallback `http://localhost:3000/api/comercial`.  
Mobile no celular usa `http://<LAN-IP>:porta/api`.  
Se o Electron/ERP carregar Motor Comercial **sem** `window.API_URL` alinhado, ou se houver **dois processos** Node, podem divergir.

**Severidade sobe para Crítico** se confirmado: Mobile grava em servidor A e Desktop lê servidor B / outro `DB_DIR`.

---

### 9. Evento de domínio sem fan-out para UI  
**Severidade: Baixo**

`ConsignacaoCriada` existe, mas não atualiza outras sessões Desktop/Mobile.

---

## Arquivos envolvidos

| Camada | Arquivos |
|--------|----------|
| Mobile create/list | `frontend/apps/mobile/js/pages/comercial.js` |
| Mobile prestação/offline | `comercial-prestacao.js`, `offline-queue.js` |
| Mobile HTTP | `frontend/shared/api/client.js`, `apps/mobile/sw.js` |
| Desktop lista | `frontend/modules/motor-comercial/pages/Consignacoes/index.js`, `badges.js` |
| Desktop API | `api/MotorComercialApi.js`, `api/client.js`, `bootstrap/index.js` |
| Backend | `routes/comercial.routes.js`, `ConsignacaoController.js`, `CriarConsignacaoUseCase.js`, `ConsignacaoRepository.js`, `ConsignacaoDTO.js` |
| DB | `backend/database.js`, `migrations/002_consignacoes.js` |

---

## Como confirmar em 5 minutos (procedimento)

1. No Mobile: criar consignação e anotar o **ID** (URL `#/comercial/{id}`).  
2. No servidor: log `BANCO OFICIAL EM USO:` → path do `mercadao.db`.  
3. Query: `SELECT id, status, cliente_id, created_at FROM consignacoes WHERE id = ?`.  
4. No Desktop: limpar filtros (Situação = todas), clicar **Atualizar**, buscar pelo **ID**/documento — não pelo nome.  
5. Comparar `API_URL` do ERP (DevTools) com o host usado pelo Mobile.

| Resultado | Diagnóstico |
|-----------|-------------|
| Existe no SQLite, some com filtro/nome | Problemas 1–3 (Alto/Médio) |
| Não existe no SQLite do Desktop | Problema 8 — instâncias/DB distintos (**Crítico**) |
| Existe, aparece após Atualizar | Problema 4 (polling) |

---

## Sugestão de correção arquitetural (somente proposta)

**Não implementar nesta auditoria.**

### Curto prazo (Alto)
1. Enriquecer `GET /consignacoes` com `clienteNome` (JOIN/bridge clientes) — SSOT de listagem.  
2. Em RASCUNHO, não forçar `valor: 0` na UI (mostrar “—” ou valor estimado de itens).  
3. Reset explícito de filtros + toast “N registros · filtros ativos”.  
4. Após mutações relevantes, refresh imediato; reduzir polling ou invalidar lista ao focar a janela.

### Médio prazo
5. SSE/WebSocket `comercial.changed` para fan-out entre Desktop e Mobile.  
6. Garantir bootstrap único de `API_URL` / `DB_DIR` (health endpoint com `dbPath` + `instanceId`).  
7. Filtro operador por nome via API (não ID cru).

### Longo prazo
8. Outbox offline Mobile para create/entrega (hoje incompleto) — **com** sync para o mesmo SSOT, nunca DB paralelo de consignação.

---

## Conclusão

O CDS Mobile **já grava no ERP**. O gap não é “falta de sincronização de consignação”, e sim **falta de paridade de leitura/UX e de tempo-real na Central Desktop**, com risco ambiental se houver múltiplas instâncias de banco.

Prioridade de ação sugerida após aceite do diagnóstico:

1. Confirmar ID no `mercadao.db` (procedimento acima).  
2. Se registro existe → corrigir listagem/enrichment/filtros (**Alto**).  
3. Se não existe → unificar `API_URL`/`DB_DIR` (**Crítico**).
