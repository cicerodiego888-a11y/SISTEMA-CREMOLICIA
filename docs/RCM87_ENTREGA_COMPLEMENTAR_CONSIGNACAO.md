# RCM-8.7 — Entrega Complementar em Consignação ENTREGUE

| Campo | Valor |
|-------|--------|
| Sprint | RCM-8.7 |
| Escopo | Extensão controlada do fluxo de consignação |
| Fora de escopo | Resolver, RCM-6.1 (congelamento), Motor Fiscal, cancelamento RCM-8.8, Prestação RCM-8.6 |

> Nota: existe documentação anterior `docs/RCM87_DOMINIO_COMERCIAL.md` (terminologia de precificação). Este documento trata **Entrega Complementar**.

## Conceito

A consignação permanece a **mesma operação comercial**. Cada complementação é um **novo evento de entrega** vinculado à consignação original — sem reabrir `RASCUNHO` e sem reprocessar a entrega original.

```
ENTREGUE → + Adicionar produto → Entrega Complementar → movimenta só itens novos
```

## Elegibilidade

Permitido somente quando:

- status = `ENTREGUE`
- prestação **não** está `FECHADA` / `ENCERRADA`
- status não é terminal (`QUITADA`, `ENCERRADA`, `CANCELADA`, `ACERTADA`)

Mensagem de bloqueio:

> Esta consignação já possui prestação encerrada. Para adicionar novos produtos, inicie uma nova consignação.

## Fluxo

1. Operador visualiza consignação ENTREGUE
2. Clica **+ Adicionar produto**
3. Abre tela `ENTREGA COMPLEMENTAR` (não o wizard de RASCUNHO)
4. Seleciona produto(s) via LIP
5. Frontend resolve preço com **canal = CONSIGNADO**
6. Confirma → `POST /consignacoes/:id/entrega-complementar`
7. Backend: elegibilidade → limite incremental → insert itens + ledger + outbox estoque + crédito
8. Status permanece `ENTREGUE`

## Estrutura utilizada

| Peça | Papel |
|------|--------|
| `consignacoes_itens` | Nova linha **ou** incremento da linha existente (UNIQUE `consignacao_id`+`produto_id`) |
| `movimentacoes_comerciais` tipo `ENTREGA` | Ledger incremental; `snapshot.contexto.operacao = ENTREGA_COMPLEMENTAR` |
| `correlationId` | Identifica o evento complementar (idempotência) |
| Outbox `ESTOQUE_BAIXAR_PRODUTO` | Payload **somente** com quantidade incremental do evento |
| Sem migration | Histórico derivado do ledger + itens |

### Mesmo produto já entregue

Se o produto complementar já existe em `consignacoes_itens`:

1. **Não** faz `INSERT` (evita `SQLITE_CONSTRAINT` UNIQUE)
2. Soma `quantidade_entregue` / `subtotal_entregue` na linha existente
3. Mantém snapshot RCM-6.1 da linha (`preco_unitario`, origem, tabela) congelado
4. Ledger + estoque usam **somente a quantidade incremental** do evento

## Precificação

- Resolver oficial com `canal = CONSIGNADO`
- Snapshot por item novo: `linha_comercial_id`, `tabela_preco_id`, `canal_venda`, `unidade_comercial`, `preco_origem`, `preco_fallback`, preço aplicado
- Snapshots dos itens da entrega original **não são alterados**

## Estoque / Crédito / Ledger

- Estoque: baixa só dos novos itens
- Crédito/limite: valida e consome **valor incremental**
- Ledger: uma `ENTREGA` por item novo, mesmo `correlationId`
- Retry com o mesmo `correlationId` → resposta idempotente, sem duplicar

## Prestação de Contas

Itens novos entram em `consignacoes_itens` e passam a compor a grade da Prestação.
Lifecycle RCM-8.6 (contexto/versionamento) permanece intacto.

## Histórico / UI

- `GET /consignacoes/:id/entregas` → Entrega Original + Complementares
- Cockpit (aba Itens) e tela complementar exibem os eventos separados
- Reimpressão/visualização de comprovante: somente leitura (sem efeitos)

## Endpoints / Use Cases

| Método | Path | Use Case |
|--------|------|----------|
| POST | `/consignacoes/:id/entrega-complementar` | `RegistrarEntregaComplementarUseCase` |
| GET | `/consignacoes/:id/entregas` | helpers `montarHistoricoEntregas` |

## Arquivos principais

**Backend**

- `usecases/consignacao/RegistrarEntregaComplementarUseCase.js`
- `usecases/consignacao/entregaComplementarHelpers.js`
- `controllers/ConsignacaoController.js`
- `routes/comercial.routes.js`
- `http/dto/ConsignacaoDTO.js` (`RegistrarEntregaComplementarRequest`)
- `events/comercialEventosTipos.js` (`CONSIGNACAO_ENTREGA_COMPLEMENTAR`)

**Frontend**

- `pages/EntregaComplementar/`
- rota `/consignacoes/:id/entrega-complementar`
- ação **+ Adicionar produto** (Detalhes, ActionMenu, Drawer)

## Entrada pela Central de Trabalho (RCM-8.9)

No card da **Minha Fila de Trabalho**, consignações elegíveis exibem a ação secundária:

**[ Ent. Complementar ]**

ao lado da ação principal (Fechar / Continuar Atendimento).

### Regras

| Item | Comportamento |
|------|----------------|
| Identidade | Usa **`consignacaoId` do card** — nunca resolve só por `clienteId` |
| Elegibilidade | Mesma regra RCM-8.7 (`ENTREGUE`, não terminal, prestação não FECHADA/ENCERRADA) |
| Navegação | `/consignacoes/:id/entrega-complementar` |
| Backend | Reutiliza `POST .../entrega-complementar` + `RegistrarEntregaComplementarUseCase` |
| Mesma consignação | Novo item grava no mesmo `consignacao_id` |
| CANCELADA | Botão não aparece (RCM-8.8) |
| Duplo clique | Lock curto de navegação na Central |

### Garantias

- Não cria nova consignação
- Não reabre `RASCUNHO`
- Não reprocessa entrega original
- Efeitos incrementais (estoque / crédito / Ledger) conforme RCM-8.7

## Testes

```bash
node tests/motor-comercial/rcm87-entrega-complementar.test.js
npx jest frontend/modules/motor-comercial/tests/pages/rcm89-entrega-complementar-card.test.js --env=jsdom
npx jest frontend/modules/motor-comercial/tests/pages/centralTrabalhoMappers.test.js --env=jsdom
```

Cobertura: elegibilidade, Resolver CONSIGNADO, snapshot, original intacto, estoque/ledger/crédito incremental, idempotência, bloqueios, histórico, múltiplas complementações, **botão no card + consignacaoId**.

## Critério de aceite

Consignação → entregar → ENTREGUE → + Adicionar produto → Resolver CONSIGNADO → confirmar → somente novo item no estoque/ledger → histórico Original + Complementar → Prestação enxerga o total — **sem** reabrir ou reprocessar a entrega original.

Central: card ENTREGUE elegível → **Ent. Complementar** → mesma consignação → novo produto incremental.
