# RELATÓRIO — Segurança (RCM-8.6)

| Campo | Valor |
|---|---|
| Sprint | RCM-8.6 |
| Data | 2026-08-06 |
| Resultado | **Aprovado com gaps registrados** |

---

## Controles confirmados

| Controle | Status |
|---|---|
| PDV não calcula lista localmente (faixas removidas) | ✔ |
| Consignação resolve via Motor (CONSIGNADO) | ✔ |
| Preço de lista não vem de `produto_atacado` no PDV | ✔ |
| Central não grava `produtos.tabela_preco_id` como SSOT | ✔ |
| Canal EVENTO exige perfil supervisor (UI) | ✔ |
| Logs de homologação (PDV/Comercial) | ✔ |

---

## Gaps de integridade de preço

### 1. POST `/vendas` confia no `preco_unitario` do cliente

- `VendaPagamentoService` grava o preço enviado pelo PDV.
- **Não** reexecuta o Resolver no servidor.
- Risco: cliente autenticado com permissão de venda pode forjar preço.
- Mitigação atual: UI sempre resolve antes; auditoria operacional.
- Evolução futura (sem mudar arquitetura): soft-check opcional no backend.

### 2. Consignação — snapshot do cliente pode prevalecer

- Se o POST envia `precoOrigem` / `tabelaPrecoId`, o `precoUnitario` do cliente é aceito.
- Sem snapshot, o bridge (Resolver) prevalece.
- Risco: forge de snapshot + preço.
- Evolução futura: revalidar preço no servidor antes de congelar.

### 3. Camadas legítimas (não são burla)

- Promoção
- Desconto manual (supervisor)
- Kit FIXO / oferta unidade — preço próprio documentado

---

## APIs e burla do Resolver

| Afirmação | Resultado |
|---|---|
| Nenhuma API de **lista** no PDV ignora o Resolver no happy path | ✔ |
| É possível persistir preço sem passar pelo Resolver (API write) | ⚠ Sim (gaps 1–2) |
| Módulo consegue alterar **cadastro** de tabela/linha (autorizado) | ✔ Esperado (Central) |
| Módulo consegue inventar motor paralelo | ✘ Não encontrado no PDV/Consignação |

---

## Conclusão de segurança

A arquitetura **impede motores paralelos** nos canais oficiais.  
A integridade server-side do preço na **persistência** ainda depende do cliente de confiança — gap aceito no congelamento e registrado para hardening futuro **sem** alterar o Motor Oficial.

**Segurança: aprovada para certificação RCM-8.6**, com plano de hardening pós-congelamento.
