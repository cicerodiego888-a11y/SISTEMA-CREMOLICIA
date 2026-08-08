# HOMOLOGAÇÃO RA-1.1.5 — Nova Arquitetura de Tabelas de Preço

**Sprint:** RA-1.1.5  
**Data:** 2026-08-05  
**Escopo:** validação / auditoria (sem alteração de domínio, sem remoção de Política Comercial)  
**Arquitetura alvo:**

```
Produto → Tabela de Preço → Canal → Preço
```

**Política Comercial:** camada de compatibilidade apenas.

---

## Veredito do gate RA-1.2

| Critério | Status |
|---|---|
| Nenhuma escrita depender da Política Comercial | ❌ **não atendido** |
| `ComercialPrecoResolver` usar Política **apenas** como fallback | ⚠ **parcial** (async OK; sync ainda prioriza Política) |
| Nenhum módulo novo cadastrar Política | ✔ **atendido** (Produto / Tabela RA-1.1) |
| Testes relevantes verdes | ✔ **atendido** (`ra11-tabela-produto`) |

**Conclusão:** **RA-1.2 NÃO deve iniciar.**  
A Política Comercial **não deve ser removida**. Dependências remanescentes estão documentadas abaixo.

---

## FASE 1 — Callers do `ComercialPrecoResolver`

### Ordem oficial (async `resolver`)

1. `tabela_preco_produto` — Produto × Tabela × Canal (`tabela_preco_produto_itens`)
2. `linha_comercial` — Política × Canal (**compat / fallback**)
3. `tabela_preco` — Tabela × Canal legado (`tabela_preco_valores`)
4. `produto.preco_venda` — legado

### Quem já usa a arquitetura nova (async)

| Caller | Uso | Origem observada no fluxo novo |
|---|---|---|
| `ConfiguracaoComercialService.resolverPrecosVenda` | PDV / Mobile / Consignação UI | `tabela_preco_produto` |
| `PdvVendaOperacionalService` | venda operacional PDV | `resolver` async |
| `ProdutoPlatformGateway.buscarPorId` | Motor Comercial | `resolver` async |
| `backend/rotas/produtos.js` | listagem / detalhe / preço async | `resolver` / `obterPrecoVendaAsync` |
| `lotesService` | valor financeiro lotes | `obterPrecoVendaAsync` |
| Script de homologação RA-1.1.5 | create → resolve | `tabela_preco_produto` (VAREJO/ATACADO) |

### Quem ainda depende do fallback / caminho sync de Política

| Caller | Problema |
|---|---|
| `resolverSync` / `obterPrecoVenda` | **Prioriza cache de Política (`linha`) antes de Tabela×Produto.** Não lê `tabela_preco_produto_itens`. |
| `EtiquetaMapper` | usa `obterPrecoVenda` (sync) |
| `ProdutoMapper` (equipamentos) | usa `obterPrecoVenda` (sync) |
| `ProdutoUnidadeService` (MUC) | usa `obterPrecoVenda` (sync) |
| Produtos com `linha_comercial_id` + valores em `linha_comercial_valores` | async ainda resolve Política se **não** houver item em `tabela_preco_produto_itens` |

### Evidência de teste real (FASE 3)

Script local (produto + tabela + itens → resolve → cleanup):

- async VAREJO → `origem: tabela_preco_produto`, `preco: 12.34`, `fallback: false`
- async ATACADO → `origem: tabela_preco_produto`, `preco: 10`
- API `resolverPrecosVenda` → mesma origem/preço
- sync VAREJO → caiu em `produto.preco_venda` (9.99) — **confirma gap do caminho sync**

Teste automatizado:

- `backend/modules/comercial/tests/ra11-tabela-produto.test.js` → **PASS**

---

## FASE 2 — Matriz de módulos consumidores

Legenda:

- ✔ utiliza arquitetura nova (Produto → Tabela → Canal → Preço) no fluxo principal
- ⚠ utiliza compatibilidade (Resolver com fallback Política / tabela legado / sync incompleto)
- ❌ ainda depende da Política Comercial (escrita ou leitura obrigatória)

| Módulo | Status | Observação |
|---|---|---|
| **PDV** | ✔ / ⚠ | UI e `PdvVendaOperacionalService` / `resolverPrecosVenda` usam async → nova arquitetura quando há itens na tabela. Sync/mappers de equipamento ainda ⚠. |
| **Motor Comercial** | ✔ | `ProdutoPlatformGateway` chama `ComercialPrecoResolver.resolver` (async). |
| **Consignação** | ✔ | `NovaConsignacao` → `api.resolverPrecosVenda` → async. |
| **Compras** | ✔ | Não resolve preço de venda via Política; sem dependência crítica de preço comercial. |
| **Importação XML** | ✔ | Sem dependência de Política para SSOT de preço de venda. |
| **Promoções** | ✔ / ⚠ | Motor próprio; não cadastra Política. Se consumir preço via sync legado, ⚠. |
| **Cadastro de Produtos** | ✔ | Fluxo oficial: vincular **Tabela de Preço**. UI de Políticas removida do formulário. API ainda aceita `politicas_comerciais_ids` (compat). |
| **Tabelas de Preço** | ✔ / ⚠ | UX RA-1.1 (`tabelas-preco-ra11.js`) = Produto×Canal. Backend ainda aceita `linhas_ids` / sync legado → `linha_comercial_valores`. |
| **Dashboard** | ✔ | Sem cadastro/resolve obrigatório via Política. |
| **Workflow** | ✔ | Sem dependência de Política para preço. |
| **Conta Corrente** | ✔ | Sem SSOT de preço via Política. |
| **Projection Services** | ✔ | Não usam Política como SSOT de preço. |
| **APIs comerciais** | ⚠ | `/comercial/resolver-precos-venda` ✔ nova; CRUD `/linhas-comerciais` ❌ escrita Política; produto API ainda persiste políticas se enviadas. |
| **Políticas Comerciais (menu ERP)** | ❌ | Tela completa de cadastro/edição ainda ativa (`linhas-comerciais`). |
| **Equipamentos / Etiquetas / MUC** | ⚠ | `obterPrecoVenda` sync **não** usa `tabela_preco_produto_itens`. |
| **Categoria × Linha** | ✔ | Sync/create automático desativado (A-1). |

---

## FASE 3 — Testes reais executados

| Fluxo | Resultado |
|---|---|
| Criar produto | OK |
| Criar tabela com itens Produto×Canal | OK |
| Cadastrar / alterar preços na tabela | OK (via service RA-1.1) |
| Consultar preço async (VAREJO/ATACADO) | OK — `tabela_preco_produto` |
| Consultar via API `resolverPrecosVenda` | OK — mesma origem |
| Consultar via `resolverSync` | FALHA de cobertura — usa `preco_venda` legado (não lê itens novos) |
| Teste `ra11-tabela-produto` | PASS |
| Venda / consignação end-to-end em UI | Não reexecutado nesta sprint; caminho de código aponta para o mesmo `resolverPrecosVenda` homologado |

Garantia do fluxo oficial nos caminhos **async de venda/consignação/motor**: **SIM**.  
Garantia em **todos** os fluxos (incluindo sync etiquetas/MUC): **NÃO** — gap documentado.

---

## FASE 4 — Auditoria de banco

Snapshot durante homologação (banco oficial local):

| Tabela / coluna | Escrita atual | Papel |
|---|---|---|
| `tabela_preco_produto_itens` | **Escrita ativa (oficial)** | SSOT RA-1.1 Produto×Tabela×Canal×Preço |
| `tabelas_preco` | Escrita ativa | Cadastro da lista |
| `produtos.tabela_preco_id` | Escrita ativa | Vínculo produto → tabela |
| `tabela_preco_valores` | Escrita de **sincronização/compat** | Mirror canal-only ao salvar itens RA-1.1; também path legado |
| `linhas_comerciais` | **Escrita ativa** via CRUD Políticas | Compat / cadastro legado ainda vivo |
| `linha_comercial_valores` | **Escrita ativa** via CRUD Política e via `TabelasPrecoRepository.substituirValores` (legado `linhas_ids`) | Fallback do Resolver |
| `produto_politicas_comerciais` | Escrita **condicional** (API produto se enviar IDs) | N:N A-1; contagem homologação = 0 |
| `produtos.linha_comercial_id` | Legado; pode ser atualizado por APIs antigas | Compat |

### Resumo

| Recebem escrita operacional | Recebem só sync/compat | Já não deveriam ser usadas no fluxo oficial |
|---|---|---|
| `tabela_preco_produto_itens`, `tabelas_preco`, `produtos.tabela_preco_id` | `tabela_preco_valores` (mirror) | **Nenhuma removida** — Política ainda escrita pelo menu/CRUD |
| `linhas_comerciais` / `linha_comercial_valores` (ainda) | — | Fluxo oficial de preço **não** deveria escrever aqui (ainda escreve) |

---

## FASE 5 — Auditoria frontend

| Tela | Situação |
|---|---|
| **Produto** | Fluxo oficial = **Tabela de Preço**. Sem checkboxes de Política no formulário principal. Mantém hidden `linha_comercial_id` para compat. |
| **Tabelas de Preço** | `tabelas-preco-ra11.js` redefine modal para **Adicionar Produtos** (Produto×Canal). Fluxo oficial. |
| **Políticas Comerciais** (`linhas-comerciais`) | Menu lateral ainda presente; permite **cadastrar/editar Política**. Compat explícita — **bloqueia gate “nenhuma escrita depender da Política”**. |
| PDV / Mobile / Consignação | Consomem preços via API resolver; não cadastram Política. |

**Garantia pedida:** “nenhuma tela **nova** permita cadastrar Política” → ✔ para Produto e Tabela RA-1.1.  
Tela legada de Políticas permanece e ainda escreve.

---

## FASE 6 — Relatório consolidado

### ✔ Módulos migrados (fluxo principal na arquitetura nova)

- Cadastro de Produto → Tabela
- Tabelas de Preço (UX RA-1.1)
- PDV / Mobile (via `resolverPrecosVenda`)
- Consignação (`NovaConsignacao`)
- Motor Comercial (`ProdutoPlatformGateway`)
- APIs async de produto / configuração comercial

### ✔ / ⚠ Módulos compatíveis

- Resolver async com fallback Política / tabela legado / `preco_venda`
- Mirror `tabela_preco_valores`
- API produto ainda aceita políticas
- Backend tabela ainda aceita `linhas_ids`

### ❌ / ⚠ Dependências remanescentes (críticas para RA-1.2)

1. **CRUD Políticas Comerciais** (frontend + `LinhasComerciais*`) — escrita em `linhas_comerciais` / `linha_comercial_valores`
2. **`TabelasPrecoRepository.substituirValores`** — UPSERT em `linha_comercial_valores` no path legado
3. **`resolverSync` / `obterPrecoVenda`** — prioriza Política; **não** consulta `tabela_preco_produto_itens`
4. Consumidores sync: EtiquetaMapper, ProdutoMapper, ProdutoUnidadeService
5. Dados legados: ainda existem linhas/valores no banco (ex.: 4 políticas / 9 valores no snapshot)

### Riscos

| Risco | Severidade | Mitigação sugerida (RA-1.2+) |
|---|---|---|
| Etiqueta/balança/MUC mostram preço diferente do PDV | Alta | Alinhar `resolverSync` à ordem async (Tabela×Produto primeiro) ou migrar callers para async |
| Operador continua cadastrando Política pelo menu | Alta | Desativar/ocultar menu ou tornar read-only antes de remover |
| Salvar tabela pelo path legado reescreve `linha_comercial_valores` | Média | Rejeitar `linhas_ids` em writes novos; só leitura |
| Remover Política antes de fechar sync path | Crítica | **Proibido** até gate verde |

### Checklist para RA-1.2

- [ ] `resolverSync` / `obterPrecoVenda` passam a respeitar `tabela_preco_produto_itens` (mesma ordem do async)
- [ ] EtiquetaMapper / ProdutoMapper / MUC cobertos por teste de origem `tabela_preco_produto`
- [ ] Escrita em `linha_comercial_valores` apenas em rotas de compat explícitas (ou zerada)
- [ ] Menu **Políticas Comerciais** oculto ou somente leitura
- [ ] API produto: `politicas_comerciais_ids` deprecated / ignorado em create/update novos
- [ ] `TabelasPrecoService`: rejeitar ou ignorar `linhas_ids` em saves novos
- [ ] Contagem de produtos sem `tabela_preco_id` mas com preço só em Política → plano de migração
- [ ] Suite comercial + motor-comercial verde
- [ ] Relatório de gate RA-1.2 assinado (escritas Política = 0 no fluxo oficial)

---

## Critério de aprovação (relembrado)

A RA-1.2 somente poderá iniciar se:

1. ✔ nenhuma escrita depender da Política Comercial → **hoje: NÃO**
2. ✔ ComercialPrecoResolver utilizar Política apenas como fallback → **hoje: async SIM / sync NÃO**
3. ✔ nenhum módulo novo cadastrar Política → **SIM**
4. ✔ todos os testes permanecerem verdes → **ra11 OK**

**Política Comercial permanece.** Não remover código nem domínio até o checklist acima.
