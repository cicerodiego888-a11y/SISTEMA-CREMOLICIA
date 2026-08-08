# AUDITORIA RA-7.6 — Canal Comercial

| Campo | Valor |
|---|---|
| Sprint | RA-7.6 |
| Data | 2026-08-06 |
| Escopo | Auditoria arquitetural (somente leitura) |
| Restrição | Sem alteração de código, banco ou funcionalidade |

---

## Veredito

**Canal Comercial** é a dimensão operacional de precificação e execução da venda no CDS.  
Não é label cosmético: altera tabela ativa, célula de preço, forma/unidade comercial, snapshot e persistência da venda.

---

## 1. O que é um Canal Comercial no CDS?

Entidade cadastral em `canais_venda` (código único + nome + ativo), seeds típicos:

| Código | Papel observado |
|---|---|
| `VAREJO` | Canal padrão / início de venda |
| `ATACADO` | Canal por quantidade mínima ou Tipo Comercial atacadista |
| `EVENTO` | Canal manual no PDV |
| `CONSIGNADO` | Canal forçado na operação de consignação |
| `DELIVERY` | Canal por Tipo Comercial / tabela mono-canal |

**Schema (fundação):** `backend/modules/comercial/migrations/001_canais_tabelas_preco.js`  
**Mono-canal RA-6:** `tabelas_preco.canal_venda_id` (1 tabela ativa por canal).

---

## 2. Responsabilidade exclusiva

O Canal responde exclusivamente a:

> **“Em qual contexto comercial esta operação está sendo cotada e executada?”**

Responsabilidades **exclusivas** do Canal:

1. Chave para selecionar a **Tabela de Preços ativa** (`buscarAtivaPorCanal`).
2. Dimensão da célula oficial de preço: **Tabela × Linha × Canal** (`tabela_preco_valores`).
3. Contexto persistido na venda / item de consignação (`vendas.canal_venda`, `consignacao_itens.canal_venda`).
4. Gatilho de regras de atacado automático (VAREJO ↔ ATACADO) e canais manuais (EVENTO, CONSIGNADO).
5. Forma / Unidade Comercial por célula (migration 004).

O Canal **não** é:

- cadastro de cliente;
- linha de precificação de produto;
- política futura de crédito/desconto (isso está no Tipo Comercial — hoje só preparado).

---

## 3. O Canal representa o quê?

| Hipótese | Resposta |
|---|---|
| Tipo de venda? | **Parcialmente** — descreve o *modo* da operação (varejo, atacado, consignado…), mas não substitui o Tipo Comercial do cliente. |
| Política comercial? | **Não hoje** — política futura está no Tipo (RCM-7.3, abas preparadas). |
| Agrupador de preços? | **Sim, indiretamente** — agrupa via “1 tabela ativa por canal”. |
| Fluxo operacional? | **Sim** — PDV, consignação, finalização e snapshot usam o canal. |
| Segmento? | **Não** — segmento de cliente é o Tipo Comercial. |
| Contexto da venda? | **Sim — definição principal.** |

---

## 4. Locais de uso (inventário)

### Backend

| Área | Path |
|---|---|
| CRUD | `backend/modules/comercial/canais/CanaisVenda*.js` |
| Resolução | `backend/modules/comercial/preco/CanalVendaResolver.js` |
| Preço | `backend/modules/comercial/preco/ComercialPrecoResolver.js` |
| Orquestração | `backend/modules/comercial/configuracao/ConfiguracaoComercialService.js` → `resolverPrecosVenda` |
| Tabelas | `backend/modules/comercial/tabelas-preco/*` |
| Tipo → Canal | `backend/modules/comercial/tipos-comerciais/TiposComerciaisService.js` |
| Venda | `backend/services/vendas/VendaPagamentoService.js` |
| Fiscal | `backend/services/fiscal/emissor.js` |
| Consignação | `AdicionarItemConsignacaoUseCase`, `ConsignacaoItemRepository`, `ProdutoPlatformGateway` |
| PDV operacional | `PdvVendaOperacionalService` |

### Frontend

| Área | Path |
|---|---|
| Cadastro | `frontend/erp/js/canais-venda.js` |
| Tabelas | `frontend/erp/js/tabelas-preco-ra6.js` |
| PDV | `frontend/pdv/js/pdv.js` |
| Consignação | `frontend/modules/motor-comercial/pages/NovaConsignacao/index.js` |
| Mobile PDV | `frontend/apps/mobile/js/pages/pdv.js` (hoje força `VAREJO`) |
| Status | `frontend/shared/js/ComercialStatusCard.js` |

### CRM / Pedidos / Financeiro Comercial

| Módulo | Uso de Canal |
|---|---|
| CRM | **Não encontrado** no código |
| Pedidos | **Não encontrado** (API compartilhada citada como intenção; sem caller) |
| MFE / Financeiro | **Não encontrado** vínculo direto a `canal_venda` / Tipo |

---

## 5. Quem informa o Canal?

Prioridade oficial (`CanalVendaResolver.resolver`, RCM-7.2.1):

```text
1) canal_manual / body.canal     → PDV EVENTO, Consignação CONSIGNADO
2) Tipo Comercial do Cliente     → cliente_id → canal_padrao / permitidos
3) Automático VAREJO ↔ ATACADO   → quantidade mínima + participa_atacado
```

---

## 6. Valor arquitetural vs. “só identifica tabela”

O Canal **agrega valor** além de apontar tabela:

- decide **quando** a operação muda de contexto (atacado por qty, evento manual, consignação forçada);
- restringe canais permitidos via Tipo;
- congela snapshot comercial;
- separa regras de contagem/atacado da grade de preços.

Porém, **na prática de cadastro**, se todas as tabelas tiverem os **mesmos preços** por linha, o usuário percebe “canal mudou, preço não” — isso é **dado**, não ausência de resolver.

---

## 7. Resposta objetiva (critério de aceite #1)

**Responsabilidade exclusiva do Canal Comercial:**  
ser o **contexto operacional de cotação e execução** da venda, chaveando tabela ativa, célula de preço e persistência do documento — sem ser classificação do cliente nem linha de produto.
