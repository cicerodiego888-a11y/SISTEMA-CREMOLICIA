# ARQUITETURA FINAL — RCM-8.6
# Certificação e Congelamento da Arquitetura Comercial

| Campo | Valor |
|---|---|
| Sprint | RCM-8.6 |
| Data | 2026-08-06 |
| Natureza | Certificação · **sem novas funcionalidades** |
| Status | **ARQUITETURA CERTIFICADA E CONGELADA** |
| Base | RCM-8.0 … RCM-8.5 |

---

## Declaração oficial

A Arquitetura Comercial do CDS Sistemas está **certificada e congelada**.

- Existe **um único** Motor Oficial de Precificação: `ComercialPrecoResolver`.
- Porta HTTP oficial de venda: `POST /configuracao-comercial/resolver-precos` → `ConfiguracaoComercialService.resolverPrecosVenda`.
- Nenhuma evolução futura poderá introduzir motor, tabela própria ou regra paralela de preço de lista.
- Toda nova funcionalidade comercial **deverá** reutilizar obrigatoriamente este Motor.

---

## Fluxo oficial (imutável)

```text
Operação → Tabela da Operação → ComercialPrecoResolver → Preço → Snapshot → Documento

Produto possui Linha?
  SIM → Tabela × Linha × Unidade → Preço
  NÃO → Tabela × Produto × Unidade → Preço
  Sem célula → Preço de Segurança (produto.preco_venda)
```

Camadas **após** o Resolver (permitidas): promoção, desconto manual autorizado, oferta explícita (Kit FIXO / venda por unidade).

---

## Canais certificados

| Canal | Usa Motor Oficial | Snapshot documento | Observação |
|---|---|---|---|
| PDV Desktop | ✔ | Carrinho sim · `vendas_itens` parcial | Gap: persistir snapshot (dívida registrada) |
| PDV Mobile | ✔ | Carrinho | Mesmo endpoint |
| Consignação Desktop | ✔ | ✔ RCM-6.1 | Congelado após item |
| Consignação Mobile | ✔ | ✔ RCM-8.5 | Mesmo contrato |
| Evento / Atacado / Delivery | ✔ via canal | Conforme documento | Canais no Resolver |
| Pedido / Orçamento / CRM / Representantes | Contrato `ComercialMotorUnificado` | Quando nascerem | Módulos ainda não operacionais |

---

## Critérios de aceite

| # | Critério | Resultado |
|---|---|---|
| 1 | Um Motor Oficial | ✔ |
| 2 | Mesmo Resolver em PDV e Comercial | ✔ |
| 3 | Sem regra de lista no PDV (faixas) | ✔ |
| 4 | Consignação via Resolver + freeze | ✔ |
| 5 | APIs de venda unificadas | ✔ (porta oficial) |
| 6 | Snapshot consignação | ✔ |
| 7 | Performance | ✔ (ver RELATORIO_PERFORMANCE) |
| 8 | Segurança | ✔ parcial · gaps registrados |
| 9 | Legado identificado (não removido) | ✔ |
| 10 | Arquitetura congelada | ✔ |

---

## Dívidas registradas (não bloqueiam congelamento)

1. Kit SOMA ainda soma `produtos.preco_venda` em SQL (`KitItemService`) — oferta/formação de kit, não PDV lista.
2. `vendas_itens` ainda não persiste snapshot RCM-6.1 completo.
3. Cliente autenticado pode enviar `preco_unitario` no POST venda / snapshot consignação sem revalidação server-side.
4. `linha_comercial_valores` e `produto_atacado` permanecem no banco (obsoletos para lista; ver RELATORIO_CODIGO_LEGADO).
5. Pedido/Orçamento/CRM/Representantes: módulos ausentes — contrato obrigatório já definido.

Evoluções futuras tratam essas dívidas **sem** alterar o fluxo oficial do Resolver.

---

## Documentos da certificação

| Relatório | Arquivo |
|---|---|
| Arquitetura final | `docs/ARQUITETURA_FINAL_RCM86.md` (este) |
| Código legado | `docs/RELATORIO_CODIGO_LEGADO.md` |
| Performance | `docs/RELATORIO_PERFORMANCE.md` |
| Consistência | `docs/RELATORIO_CONSISTENCIA.md` |
| Segurança | `docs/RELATORIO_SEGURANCA.md` |

Teste de performance: `backend/modules/comercial/tests/rcm86-certificacao-performance.test.js`

---

## Congelamento

A partir de RCM-8.6:

> Nenhuma sprint poderá alterar a arquitetura do Motor Oficial.  
> Toda precificação de lista nascerá exclusivamente em  
> `ComercialPrecoResolver` / `resolver-precos`.
