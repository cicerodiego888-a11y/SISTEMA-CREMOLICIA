# AUDITORIA RCM-05.21 — Tabela Comercial por Cliente (Consignado)

Data: 2026-07-31  
Prioridade: ALTA  
Status: **ARQUITETURA APROVADA PARA IMPLEMENTAÇÃO** (sem código de feature ainda)

---

## 1. Veredito

A funcionalidade **“Tabela Comercial Preferencial por Cliente”** pode ser implementada **sem quebrar** o Motor Comercial, o Resolver Comercial nem o conceito de Linhas Comerciais, desde que:

1. A tabela do cliente seja apenas **prioridade de resolução** (preferência), não um motor paralelo.
2. O Resolver continue responsável por Canal × Forma × Unidade × preço efetivo.
3. Atacado continue escolhendo **canal** via `CanalVendaResolver` (quantidade mínima).
4. Linha Comercial × Canal permaneça o SSOT operacional de preço (RCM-05.15), salvo quando a preferência do cliente forçar uma **Tabela** explícita.

**Gap atual:** não existe campo, UI, API nem uso de `cliente_id` no `ComercialPrecoResolver`.

---

## 2. Fluxo atual

```
Produto (+ categoria → linha)
        ↓
Canal (opts.canal | CanalVendaResolver | VAREJO)
        ↓
ComercialPrecoResolver
        ↓
1) linha_comercial_valores (Linha × Canal)     ← SSOT
2) tabela_preco_valores (Tabela × Canal)       ← legado / produto.tabela_preco_id
3) produto.preco_venda                         ← legado
        ↓
ERP / PDV / Mobile / Consignado gateway
```

| Dimensão | Como é escolhida hoje | Usa cliente? |
|----------|----------------------|--------------|
| Canal | `opts.canal` → `CanalVendaResolver` (qty atacado) → `VAREJO` | Não |
| Linha | `opts.linha` → `produto.linha_comercial_id` → categoria | Não |
| Tabela | `opts.tabela_preco_id` → `produto.tabela_preco_id` | Não |
| Forma/Unidade | Valor da linha/tabela → herança do produto | Não |
| Cliente | Só crédito / prazo / `perfil_comercial` | **Não no preço** |

Fontes: `backend/modules/comercial/preco/ComercialPrecoResolver.js`, `CanalVendaResolver.js`, `ConfiguracaoComercialService.resolverPrecosVenda`.

---

## 3. Fluxo proposto (aprovado)

```
Cliente
   ↓
Tabela Comercial preferencial? (opcional + flag “usar tabela fixa”)
   ↓ SIM
Resolver Comercial
   ↓
Usar tabela_preco_id do cliente
   + Canal ainda resolvido normalmente (Varejo/Atacado/Evento)
   ↓
Preço = tabela_preco_valores (Tabela × Canal)
   [se linha ligada à tabela: preferir células sincronizadas da Linha
    pertencentes às linhas daquela tabela — ver §6]
   ↓ NÃO
Resolver atual (Linha → Tabela produto → Legado)
   ↓
Sem regra → Varejo / preco_venda
```

### Prioridade oficial (RCM-05.21)

| Ordem | Regra |
|-------|--------|
| **1º** | Cliente com `usar_tabela_fixa = 1` e `tabela_preco_id` → usar essa tabela |
| **2º** | Sem preferência → Resolver atual (Linha × Canal → Tabela produto → Legado) |
| **3º** | Sem regra → canal/preço Varejo |

**Importante:** a preferência **não** substitui o Motor Comercial. Não duplicar regras de quantidade mínima, promoções ou kits.

---

## 4. Cadastro de clientes (estado atual)

Tabela `clientes` (`database.js`):

`id, nome, cpf_cnpj, telefone, email, endereco, limite_credito, credito_atual, created_at, cep, rua, numero, bairro, cidade, uf`

| Campo desejado | Existe? |
|----------------|---------|
| `tabela_preco` / `tabela_preco_id` | **Não** |
| `linha_comercial_id` | **Não** |
| `perfil_comercial` (tabela à parte) | Sim — crédito/consignado, **sem** FK de preço |
| `tipo_cliente` | **Não** |
| `clientes_config` / `clientes_comercial` | **Não existem** |

UI de clientes: sem card “COMERCIAL” / tabela preferencial.

`perfil_comercial.perfil_tipo` (`CONSUMIDOR | ATACADISTA | CONSIGNADO | …`) **não** escolhe tabela de preço — não reutilizar como substituto da tabela preferencial (semântica diferente).

---

## 5. Banco — relacionamento pronto?

| Tabela | Relação com preço do cliente |
|--------|------------------------------|
| `tabelas_preco` / `tabela_preco_valores` | Pronta para ser referenciada |
| `linhas_comerciais` / `linha_comercial_valores` | SSOT do resolver; tabelas sincronizam (RCM-05.15) |
| `tabela_preco_linhas` | N:N Tabela ↔ Linha |
| `clientes` | **Sem** FK para tabela |
| `perfil_comercial` | Cliente ↔ crédito; sem preço |

**Alteração necessária (implementação futura):**

```sql
-- em clientes (recomendado, simples e compatível)
ALTER TABLE clientes ADD COLUMN tabela_preco_id INTEGER
  REFERENCES tabelas_preco(id);
ALTER TABLE clientes ADD COLUMN usar_tabela_fixa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN observacao_comercial TEXT;
```

Alternativa (se quiser isolar): `clientes_comercial (cliente_id PK, tabela_preco_id, usar_tabela_fixa, observacao)`.  
**Recomendação:** colunas em `clientes` — evita tabela nova sem ganho, CRUD único.

---

## 6. Resolver Comercial — como plugar sem quebrar

### Ponto de inserção

1. `ComercialPrecoResolver.resolver(opts)` — aceitar:
   - `opts.cliente_id` **ou**
   - `opts.tabela_preco_id` já resolvido pelo caller
2. `ConfiguracaoComercialService.resolverPrecosVenda` — carregar preferência do cliente da venda/PDV e passar ao resolver.
3. PDV / Mobile / ERP — enviar `cliente_id` no `POST …/resolver-precos` quando houver cliente selecionado.

### Semântica com Linha (RCM-05.15)

Quando o cliente fixa a tabela **CONSIGNADOS**:

- Resolver **não** inventa preço fora do Motor.
- Busca preço na grade daquela tabela para o **canal efetivo** (ainda pode ser VAREJO ou ATACADO se a tabela tiver células por canal).
- Se a tabela está ligada a linhas (`tabela_preco_linhas`), o preço efetivo continua vindo dos valores sincronizados (Linha × Canal) das linhas da tabela — coerente com SSOT.
- Se a tabela só tem `tabela_preco_valores` legado, usar fallback 2 do resolver atual.

### Atacado + tabela do cliente

Exemplo “Mercantil Oliveira → ATACADO”:

- Preferência aponta para tabela ATACADO (ou tabela cujos canais incluem ATACADO).
- `CanalVendaResolver` **continua** aplicando quantidade mínima para decidir canal ATACADO vs VAREJO.
- Preço = célula (Tabela preferencial × Canal resolvido).

Exemplo “José → CONSIGNADOS + usar tabela fixa”:

- Sempre tabela CONSIGNADOS, **independentemente da quantidade**.
- Canal padrão VAREJO (ou canal explícito do PDV), sem forçar atacado.

### Varejo / Consumidor final

- Sem flag / sem tabela → comportamento idêntico ao atual.

---

## 7. Impactos

| Área | Impacto | Risco |
|------|---------|-------|
| ComercialPrecoResolver | Novo ramo prioridade 1 (cliente) | Médio — precisa testes de regressão RCM-05.15 |
| CanalVendaResolver | Nenhum (continua qty) | Baixo |
| Venda / PDV | Passar `cliente_id` no resolver-precos; recalcular ao trocar cliente | Médio |
| ERP cadastro clientes | Card COMERCIAL + persistência | Baixo |
| Mobile | Mesmo contrato API | Médio (hoje força VAREJO em add) |
| API produtos | Opcional: query `?cliente_id=` | Baixo |
| Kits | Continuam com `kits.preco` após resolver | Baixo — não misturar |
| Promoções | Overlay após preço base | Baixo |
| Consignado | Gateway hoje default VAREJO; passar cliente/tabela | Médio |
| Múltiplas tabelas | Preferência 1:1 cliente→tabela | Baixo |
| `perfil_comercial` | Não alterar para preço | — |

---

## 8. Alterações necessárias (checklist de implementação)

### Banco
- [ ] Migration: `tabela_preco_id`, `usar_tabela_fixa`, `observacao_comercial` em `clientes`

### Backend
- [ ] CRUD `clientes` GET/PUT com novos campos
- [ ] `ComercialPrecoResolver`: prioridade 1º tabela do cliente
- [ ] `resolverPrecosVenda({ cliente_id, itens, canal })`
- [ ] Logs `[RCM-05.21]` origem = `cliente.tabela_preco`

### Frontend
- [ ] Card **COMERCIAL** no cadastro (select tabelas + checkbox “Usar tabela fixa” + observação)
- [ ] PDV: ao selecionar/trocar cliente, re-resolver preços do carrinho

### Não fazer
- [ ] Não criar segundo motor de preço
- [ ] Não sobrescrever Linha Comercial do produto
- [ ] Não usar `perfil_tipo` como proxy de tabela
- [ ] Não ignorar quantidade mínima quando a intenção for Atacado por canal (salvo tabela fixa que não tenha canal atacado — documentar)

---

## 9. APIs

| Endpoint | Mudança |
|----------|---------|
| `GET/PUT /api/clientes/:id` | Expor campos comerciais |
| `POST /api/configuracao-comercial/resolver-precos` | Aceitar `cliente_id` |
| `GET /api/tabelas-preco` | Já serve o select do card |

Compatibilidade: sem `cliente_id` / sem flag → **idêntico** ao RCM-05.15.

---

## 10. Interface proposta (aprovada)

```
────────────────────────────
COMERCIAL
────────────────────────────
Tabela Comercial
[ Varejo              ▼ ]

☐ Usar tabela fixa deste cliente

Observação
_________________________________
```

- Desmarcado → Resolver atual.
- Marcado → prioridade 1º (ignora seleção automática de tabela; **não** ignora canal/qty salvo regra de negócio explícita da tabela fixa).

---

## 11. Compatibilidade

| Cenário | Esperado |
|---------|----------|
| Cliente sem tabela | Como hoje |
| Cliente + CONSIGNADOS fixo | Sempre preços da tabela CONSIGNADOS × canal |
| Cliente + ATACADO (fixa ou não) | Qty mínima via CanalVendaResolver |
| Cliente Varejo | Preço varejo |
| Promoções | Continuam após preço base |
| Kits | `kits.preco` prevalece no item kit |
| Versões atuais PDV/ERP | Backward compatible |

---

## 12. Testes

Arquivo: `backend/modules/comercial/tests/rcm0521-tabela-cliente.test.js`  
(alias solicitado no brief: `rcm053-tabela-cliente.test.js` → padronizado como **0521**)

Fase auditoria: valida **estado atual** + contrato arquitetural (sem feature).  
Fase implementação: expandir asserts dos cenários ✔ do brief.

---

## 13. Critérios de aceitação (auditoria)

- [x] Confirmar que a implementação **não precisa** quebrar o Motor Comercial
- [x] Tabela do cliente = **apenas prioridade** de resolução
- [x] Não duplicar regras (canal/qty/promo/kit)
- [x] Compatível com Varejo, Atacado e Consignado (via tabela + canal)
- [x] Arquitetura **aprovada** antes da implementação

---

## 14. Decisão

**GO para implementação** na ordem: migration → Resolver → API clientes/resolver-precos → UI card → PDV recalculo → testes RCM-05.21 completos.

Referências: `AUDITORIA_RCM_05_15.md`, `ComercialPrecoResolver.js`, `CanalVendaResolver.js`, `ConfiguracaoComercialService.js`.
