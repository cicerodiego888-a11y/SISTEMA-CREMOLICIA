# RCM-8.6 — Estabilidade do contexto da Prestação de Contas

| Campo | Valor |
|-------|--------|
| Sprint | RCM-8.6 (estabilidade UI) |
| Escopo | Prestação de Contas — lifecycle / contexto assíncrono |
| Fora de escopo | Motor Comercial, Resolver, RCM-6.1, estoque, ledger, fiscal, etc. |

## Problema observado

Durante a Prestação de Contas, a tela podia **trocar sozinha** de cliente/consignação
(ex.: operador em MILTON → tela passa a mostrar MAX).

## Causa encontrada

A estação `PrestacaoContasPage` iniciava:

1. `setTimeout(0)` para o primeiro `_loadData`
2. `setInterval` (auto-refresh ~45s) chamando `_loadData(true)`

O **Router** trocava o DOM com `innerHTML = ''` **sem** encerrar a instância anterior.
Com isso:

- o polling da prestação anterior continuava vivo;
- a checagem antiga do timer usava IDs globais (`#fechar-consignacao-content`,
  `#prestacao-estacao-root`) — os mesmos IDs da tela **nova**;
- callbacks/`await` do `_loadData` da operação anterior chamavam `_updateUI()` /
  `_updateHeaderMeta()` via `document.getElementById(...)`, escrevendo no DOM
  da consignação atualmente aberta.

Cenário clássico de **resposta atrasada**:

```
GET Milton (500ms)  → usuário abre Max → GET Max (100ms)
Max aplica na tela
Milton chega depois → sobrescrevia a UI (bug)
```

## Componente responsável

| Peça | Papel |
|------|--------|
| `frontend/.../PrestacaoContas/index.js` | Estação; timers + `_loadData` + render |
| `frontend/.../router/Router.js` | Montagem SPA sem dispose prévio |
| IDs globais de DOM | Canal pelo qual resposta antiga contaminava a tela nova |

Não havia estado global `currentCliente`/`currentConsignacao` compartilhado; o
vazamento era de **lifecycle de instância** + **queries DOM document-wide**.

## Correção aplicada

### 1. Contexto imutável da operação

Módulo `prestacaoOperacaoContext.js`:

- `clienteId`, `consignacaoId`, `prestacaoId`, `contextVersion`
- token por requisição (`captureContextToken`)
- aceite só se `isContextCurrent(token, atual)` e tela não `_disposed`

### 2. Lifecycle / dispose

- `PrestacaoContasPage.destroy()` cancela timers, marca disposed e dá bump na versão
- root com `data-page-destroyable="true"` + `__cdsPageInstance`
- `Router._mount` chama `_disposeMountedPages` **antes** de limpar o DOM

### 3. Proteção contra resposta atrasada

Antes de aplicar dados / erro / UI após qualquer `await` relevante:

```js
if (!this._acceptContextToken(token)) return;
```

Refresh automático consulta **somente** `this.consignacaoId` da operação aberta
e só roda se `this.root.isConnected`.

### 4. Queries escopadas

Atualizações de header/conteúdo/painel usam `this.root.querySelector` (`_qs`),
não mais `document.getElementById` solto.

## Correção de apresentação — Sem Venda

Somente UI (sem alterar persistência financeira):

- labels `SEM_VENDA` → **Sem Venda** (antes erroneamente “Quitada”)
- card/sidebar sem exibir `Valor da Venda / Recebido / Saldo` em R$ 0,00
  quando não há venda; mostra só **Situação Financeira: Sem Venda**

Arquivos: `prestacaoFinanceiroSnapshot.js`, `prestacaoOperacionalConsolidacao.js`,
`FecharConsignacaoView.js`.

## Testes

| Suite | Caminho |
|-------|---------|
| Jest | `frontend/modules/motor-comercial/tests/pages/rcm86-prestacao-contexto.test.js` |
| Node | `backend/modules/comercial/tests/rcm86-prestacao-contexto.test.js` |

Cobertura mínima:

1. contexto cliente  
2. contexto consignação  
3. contexto prestação  
4. Milton → Max  
5. Max → Milton  
6. troca rápida entre 3 clientes  
7. resposta atrasada ignorada  
8. timer antigo não atualiza  
9. polling antigo não atualiza  
10. desmontagem limpa recursos  
11. erro antigo não aparece na tela nova  
12. Sem Venda ≠ Quitada  

```bash
npm run test:motor-comercial-frontend -- --testPathPattern=rcm86-prestacao-contexto
node backend/modules/comercial/tests/rcm86-prestacao-contexto.test.js
```

## Critério de aceite

A Prestação de Contas representa **exatamente** a consignação/cliente aberta pelo
operador. Respostas, erros e polling de operações anteriores são descartados.
Regras comerciais/financeiras do motor **não** foram alteradas nesta sprint.
