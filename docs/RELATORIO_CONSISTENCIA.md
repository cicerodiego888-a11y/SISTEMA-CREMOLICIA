# RELATÓRIO — Consistência (RCM-8.6)

| Campo | Valor |
|---|---|
| Sprint | RCM-8.6 |
| Data | 2026-08-06 |

---

## Diagnóstico geral

### Existe algum módulo utilizando regra diferente?

| Módulo | Regra de lista | Consistente? |
|---|---|---|
| PDV Desktop | `resolver-precos` | ✔ |
| PDV Mobile | `resolver-precos` | ✔ |
| Consignação Desktop/Mobile | `resolver-precos` + canal CONSIGNADO | ✔ |
| Central de Precificação | Cadastro + simulação via Resolver | ✔ |
| Kit SOMA | SQL `SUM(preco_venda)` | ⚠ Exceção registrada (formação kit) |
| Pedido/Orçamento/CRM/Rep | Sem módulo operacional | Contrato unificado ✔ |

### Existe alguma duplicidade?

| Item | Situação |
|---|---|
| Dois Resolvers | **Não** — apenas `ComercialPrecoResolver` |
| Porta HTTP oficial | Uma: `/configuracao-comercial/resolver-precos` |
| LCV vs Tabela×Linha | LCV legado paralelo no banco; **não** usado no `resolver()` |
| Faixas atacado vs Tabela Atacado | Faixas só cadastro; PDV não usa |

### Existe alguma inconsistência?

| Item | Severidade | Notas |
|---|---|---|
| Snapshot PDV não persiste em `vendas_itens` | Média | Carrinho tem metadados; DB incompleto |
| Catalog search sem canal da operação | Baixa | Preview; sobrescrito no enrich |
| Mobile PDV força VAREJO em alguns fluxos | Baixa | Canal automático limitado |

### Existe algum caminho legado restante?

Sim — inventariado em `RELATORIO_CODIGO_LEGADO.md`. Nenhum reabre motor paralelo no PDV/Consignação happy path.

---

## Auditoria do Resolver

- **Um** arquivo SSOT: `backend/modules/comercial/preco/ComercialPrecoResolver.js`
- Orquestração de venda: `ConfiguracaoComercialService.resolverPrecosVenda`
- Bridges (ProdutoPlatformGateway, Central, Diagnóstico) chamam o **mesmo** Resolver

## Auditoria de Snapshot

| Documento | Congela preço após geração? |
|---|---|
| Consignação | ✔ Imutável no item |
| Prestação / devolução | Usa preço congelado |
| PDV venda | Preço do body; sem re-resolve no servidor |

## Matriz de canais

PDV Desktop · PDV Mobile · Consignação · Evento · Atacado · Delivery (via canal) → Motor Oficial.  
Pedido · Orçamento · CRM · Representantes → obrigados ao mesmo contrato quando implementados.

---

## Conclusão

**Não há segundo motor.** Inconsistências residuais são dívidas técnicas documentadas, não arquiteturas alternativas. Consistência **aprovada** para congelamento.
