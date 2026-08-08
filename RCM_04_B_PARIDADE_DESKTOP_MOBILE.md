# RCM-04.B — Paridade Desktop × Mobile e Correções da Listagem Comercial

**Status:** CONCLUÍDO  
**Prioridade:** P0  
**Data:** 2026-07-30  
**Origem:** `AUDITORIA_RCM_04_A.md`  
**Arquitetura:** SSOT (mesmo Motor Comercial / mesmo SQLite)

---

## Objetivo

Eliminar inconsistências da auditoria RCM-04.A que fazem o operador acreditar em falha de sincronização. Desktop e Mobile devem apresentar **os mesmos registros** da mesma base.

**Fora de escopo:** WebSocket, SSE, SignalR, push, polling inteligente (RCM-04.C+).

---

## Arquivos criados

| Arquivo | Função |
|---------|--------|
| `backend/services/sistemaDiagnostico.js` | Diagnóstico (instanceId, databaseHash, startedAt, processId…) |
| `backend/rotas/sistema.js` | `GET /api/sistema/diagnostico` |
| `backend/services/comercialOperacaoLog.js` | Logs com origem Desktop/Mobile |
| `frontend/erp/pages/diagnostico-instancia.html` | Tela Ajuda → Diagnóstico |
| `frontend/erp/js/diagnostico-instancia.js` | Carregar + Copiar Diagnóstico |
| `backend/motores/motor-comercial/tests/rcm04b.test.js` | Suite de testes |
| `RCM_04_B_PARIDADE_DESKTOP_MOBILE.md` | Este relatório |

---

## Arquivos alterados

### Backend
- `ConsignacaoRepository.js` — JOIN clientes (nome, documento, telefone) + busca ampliada
- `comercialMapper.js` — `clienteNome`, `clienteDocumento`, `clienteFantasia`, `clienteTelefone`
- `ConsignacaoDTO.js` — mesmos campos no DTO
- `ConsignacaoController.js` — busca + logs criar/editar/cancelar/entrega/prestação
- `server.js` — monta `/api/sistema`

### Desktop
- `Consignacoes/badges.js` — badges padronizados + RASCUNHO sem R$ 0,00
- `Consignacoes/index.js` — filtros ativos, refresh foco, invalidação, busca
- `Consignacoes/styles.css` — chips de filtros
- `api/helpers.js` — map view enriquecido
- Bundle regenerado

### ERP shell
- Menu **Ajuda → Diagnóstico da Instância**
- `access-control.js`, `client.js` (`X-CDS-Client`)

### Mobile
- `comercial.js` — RASCUNHO `—`; busca nome/doc/telefone/obs
- `formatters.js` — badges comerciais padronizados

---

## Endpoints

| Método | Endpoint | Mudança |
|--------|----------|---------|
| `GET` | `/api/comercial/consignacoes` | DTO + `busca`/`q` (código, nome, CPF/CNPJ, telefone, obs) |
| `GET` | `/api/comercial/consignacoes/:id` | Mesmos campos de cliente |
| `GET` | `/api/sistema/diagnostico` | **Novo** |
| Mutações | criar / editar / cancelar / entrega / prestação | Auditoria com origem |

### Payload de diagnóstico

`instanceId`, `hostname`, `apiUrl`, `dbPath`, `databaseHash`, `ambiente`, `versaoSistema`, `versaoBanco`, `processId`, `uptime`, `startedAt`, `timestampServidor`

---

## DTOs modificados

`ConsignacaoResponse`:

- `clienteId`
- `clienteNome`
- `clienteDocumento`
- `clienteFantasia` (null quando coluna inexistente)
- `clienteTelefone`

---

## Melhorias na listagem

- Nome do cliente sem N+1
- RASCUNHO / PREPARAÇÃO → `—` / “Aguardando Entrega” (sem totais inventados)
- Badges: **RASCUNHO**, **PREPARAÇÃO**, **EM ENTREGA**, **ENTREGUE**, **PRESTAÇÃO PENDENTE**, **FINALIZADA**, **CANCELADA**
- Filtros ativos visíveis + **Limpar Filtros**

## Melhorias na busca

Igual no Desktop e Mobile:

Código · Nome · CPF/CNPJ · Telefone · Observação · Fantasia (quando houver)

## Correções de cache

- Invalidação ao focar janela / Atualizar / fechar drawer
- Cache-bust `_t` nas consultas
- Sem WebSocket nesta sprint

## Tela de diagnóstico

ERP: **Ajuda → Diagnóstico da Instância** com **📋 Copiar Diagnóstico** (inclui Database Hash).

## Logs

Módulo `comercial`: criar, atualizar, cancelar, entrega, prestação abrir/fechar — com `origem`, usuário, data/hora, `consignacaoId`, `instanceId`.

---

## Testes executados

```
node backend/motores/motor-comercial/tests/rcm04b.test.js
npm run build:motor-comercial
```

| Caso | Resultado |
|------|-----------|
| Diagnóstico + databaseHash | OK |
| Origem Desktop/Mobile | OK |
| DTO (nome/doc/fantasia/telefone) | OK |
| Mapper JOIN | OK |
| RASCUNHO + badges | OK |
| mapConsignacaoView | OK |

---

## Critérios de aceitação

| Critério | Status |
|----------|--------|
| Consignações Mobile visíveis no Desktop (mesmo SSOT + refresh) | Atendido |
| Busca por nome | Atendido |
| Rascunho sem R$ 0,00 | Atendido |
| Filtros ativos visíveis | Atendido |
| Lista atualiza (foco/Atualizar/retorno) | Atendido |
| Diagnóstico confirma instância | Atendido |
| Mesmos registros Desktop × Mobile | Atendido (mesma API/DB) |

---

## Pendências RCM-04.C

- WebSocket / SSE / SignalR
- Push notifications
- Polling inteligente
- Atualização push da Central sem foco/Atualizar
- Motor de comprovantes / Resumo inteligente (RCs futuras)
