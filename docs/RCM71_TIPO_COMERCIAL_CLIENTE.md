# RCM-7.1 — Tipo Comercial do Cliente

| Campo | Valor |
|---|---|
| Sprint | RCM-7.1 |
| Data | 2026-08-06 |
| Escopo | Nova entidade · Cadastro · Cliente · Resolução de Canal |
| Restrição | Não altera Resolver de preço, MUC, Fiscal, Ledger, Outbox, fluxo de Consignação |

---

## Arquitetura oficial

```text
CLIENTE
    ↓
Tipo Comercial
    ↓
Canal Padrão
    ↓
Tabela ativa do Canal
    ↓
Resolver Oficial
    ↓
Preço
```

O Cliente **não conhece** Tabela de Preços nem Linha de Precificação.  
Conhece apenas o **Tipo Comercial**.

---

## Entidade: Tipos Comerciais

Cadastro: **Configurações → Comercial → Tipos Comerciais**

| Campo | Obrigatório | Observação |
|---|---|---|
| Código | Sim | Único |
| Descrição | Sim | |
| Canal Padrão | Sim | FK lógica → `canais_venda.codigo` |
| Ativo | Sim | |
| Observações | Não | |

**Nada mais nesta sprint:** nenhum preço, tabela ou linha.

### Seeds iniciais

| Código | Descrição | Canal Padrão |
|---|---|---|
| CONSUMIDOR_FINAL | Consumidor Final | VAREJO |
| CONSIGNADO | Consignado | CONSIGNADO |
| ATACADISTA | Atacadista | ATACADO |
| REVENDEDOR | Revendedor | ATACADO |
| DISTRIBUIDOR | Distribuidor | ATACADO |
| EVENTO | Evento | EVENTO |
| FRANQUIA | Franquia | VAREJO |
| CLIENTE_ESPECIAL | Cliente Especial | VAREJO |
| DELIVERY | Delivery | DELIVERY |

Canais `CONSIGNADO` e `DELIVERY` são criados via `INSERT OR IGNORE` se ainda não existirem.

---

## Cliente

| Campo | Regra |
|---|---|
| `tipo_comercial_id` | Obrigatório (ADD) |
| Clientes antigos | Migrados automaticamente para **Consumidor Final** |

UI: select obrigatório no cadastro/edição; coluna na listagem; detalhe exibe canal derivado.

---

## Comportamento na operação

1. Sistema lê o Tipo Comercial do Cliente.
2. Obtém o **Canal Padrão** do tipo.
3. Obtém a **Tabela ativa** do canal (`buscarAtivaPorCanal`).
4. Envia o **Canal** ao Resolver (autoridade única de preço).

Endpoints:

- `POST /api/tipos-comerciais/resolver-canal` — `{ cliente_id }` ou `{ tipo_comercial_codigo }`
- `POST /api/configuracao-comercial/resolver-canal` — aceita `cliente_id` / `tipo_comercial_id`
- `POST /api/configuracao-comercial/resolver-precos` — idem (passa `cliente_id` ao CanalVendaResolver)

`canal_manual` (ex.: CONSIGNADO na Nova Consignação) continua tendo precedência — **fluxo de consignação inalterado**.

### PDV

Quando há cliente selecionado, o PDV envia `cliente_id` em `resolver-precos` (sem canal manual).  
Assim o Tipo Comercial determina o Canal automaticamente. Ao selecionar/remover o cliente, o canal é recalculado.

---

## Exemplos

| Tipo do Cliente | Canal | Tabela |
|---|---|---|
| Consumidor Final | VAREJO | Ativa do Varejo |
| Atacadista | ATACADO | Ativa do Atacado |
| Consignado | CONSIGNADO | Ativa do Consignado |
| Delivery | DELIVERY | Ativa do Delivery |

---

## Evolução futura (não nesta sprint)

O Tipo Comercial está preparado para, no futuro, controlar:

- Limite de Crédito · Condição de Pagamento · Comissão  
- Desconto Máximo · Política de Devolução · Regras Comerciais  

Nesta sprint: **somente Canal Padrão**.

---

## Compatibilidade

- Clientes sem tipo → Consumidor Final (migration).
- Sem `cliente_id` na resolução → fluxo legado de canal (VAREJO / regras de atacado por quantidade) permanece.
- `CONSUMIDOR_FINAL` não pode ser excluído nem ter código alterado.

---

## Critérios de aceite

| # | Critério | Status |
|---|---|---|
| 1 | Cliente não conhece Tabela | ✓ |
| 2 | Cliente não conhece Linha | ✓ |
| 3 | Cliente conhece apenas Tipo Comercial | ✓ |
| 4 | Tipo determina Canal | ✓ |
| 5 | Canal determina Tabela ativa | ✓ |
| 6 | Resolver continua única autoridade de preço | ✓ |
| 7 | Compatibilidade preservada | ✓ |

---

## Arquivos principais

| Área | Caminho |
|---|---|
| Migration | `backend/modules/comercial/migrations/018_tipos_comerciais.js` |
| Módulo | `backend/modules/comercial/tipos-comerciais/` |
| Canal | `CanalVendaResolver.js` + `ConfiguracaoComercialService.js` |
| Cliente API | `backend/rotas/clientes.js` |
| UI Cadastro | `frontend/erp/pages/tipos-comerciais.html` + `js/tipos-comerciais.js` |
| UI Cliente | `frontend/erp/js/clientes.js` |
| Testes | `backend/modules/comercial/tests/rcm71-tipo-comercial.test.js` |
