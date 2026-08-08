# AUDITORIA FUNCIONAL — RCM-8.0  
## Nova Arquitetura Comercial (comportamento × estrutura existente)

| Campo | Valor |
|---|---|
| Sprint | RCM-8.0 — Auditoria funcional |
| Data | 2026-08-06 |
| Natureza | Somente leitura · sem migrations · sem novas tabelas/campos |
| Arquitetura oficial | Produto (Linha opcional) · Operação → Tabela · Resolver único |

---

## Arquitetura oficial (alvo)

```text
Produto
  ├── Categoria, Unidade Base, Estoque, Fiscal, Preço de Segurança
  └── Linha de Precificação (opcional)
        │
        ├─ COM Linha  → Resolver cotiza pela Linha na Tabela da Operação
        └─ SEM Linha  → Resolver cotiza pelo Produto na Tabela da Operação

Operação
  PDV        → Tabela Varejo
  PDV Atacado→ Tabela Atacado
  Consignação→ Tabela Consignação
  Evento     → Tabela Evento
  Delivery   → Tabela Delivery

Resolver SEMPRE devolve: preço · unidade comercial · origem · tabela utilizada
PDV e Comercial usam o MESMO Resolver.
```

---

# Auditoria 1 — Fluxo atual de precificação

## Mapa (PDV desktop)

```text
Adicionar Produto
  → enriquecerProdutoCanalPdv
       POST /configuracao-comercial/resolver-precos
         → CanalVendaResolver (canal da operação)
         → ComercialPrecoResolver.resolver (preço)
  → aplicarFormaCanalNoProdutoPdv
  → (kit / casquinha / UC / peso — ramos especiais)
  → adicionarItemNoCarrinho
       + promoção ativa (opcional)
       + obterPrecoAtacado legado (só se atacado comercial OFF)
  → atualizarCarrinho
  → agendarRecalculoCanalComercialPdv
       POST resolver-precos (carrinho inteiro)
  → Preço Final (preco_unitario ± desconto manual)
```

## Onde realmente acontece a decisão do preço?

| Camada | Decisão? |
|---|---|
| **`ComercialPrecoResolver.resolver`** | **Sim — decisão oficial de preço de lista** |
| `CanalVendaResolver` | Decide **qual canal/tabela** (contexto), não o valor |
| `ConfiguracaoComercialService.resolverPrecosVenda` | Orquestra; não calcula |
| PDV `adicionarItemNoCarrinho` | Pode **sobrescrever** (promo, faixas legado, desconto manual) |
| Kit / UC / balança | Podem **desviar** do preço do Resolver |

**Resposta:** a decisão de preço de tabela ocorre no **Resolver**. O PDV ainda aplica camadas depois (promoção, legado, manual).

---

# Auditoria 2 — Regras duplicadas

| Local | Tipo de cálculo | Status vs RCM-8.0 |
|---|---|---|
| `ComercialPrecoResolver` | Tabela×Linha / Produto / legado | **Oficial** |
| `ConfiguracaoComercialService` | Orquestra canal + resolver | OK (não duplica valor) |
| PDV `obterPrecoAtacado` + `GET /produtos/:id/atacado` | Faixas `produto_atacado` | **Duplicado** (legado) |
| PDV `buscarPromocaoAtivaProduto` | Preço promocional | Paralelo legítimo (promoção) — fora do Resolver |
| PDV desconto % / preço editado | Manual supervisor | Overlay operacional |
| PDV kit `kit.preco` | Preço do kit | **Fora** do Resolver |
| PDV UC `unidade.preco` | Preço por UC | **Paralelo** |
| PDV balança | Usa `preco_venda` do cache **sem** enrich | **Furo** |
| Mobile PDV | Resolver só VAREJO; MUC sem resolver; sem recalc | **Divergente** |
| `KitItemService` | Soma `preco_venda` SQL | **Duplicado / paralelo** |
| `linha_comercial_valores` | Preço linha×canal | **Duplicado legado** |
| `tabela_preco_produto_itens` | Preço produto×canal | Compat (útil ao RCM-8.0) |
| Compra / `motorConversaoUnidades` | Forma preço de **cadastro** | Outro bounded context (OK) |
| Controllers | Não recalculam preço (delegam) | OK |

---

# Auditoria 3 — Capacidades do Resolver vs RCM-8.0

| Capacidade alvo | Suporte atual | Lacuna comportamental |
|---|---|---|
| Resolver por **Linha** | ✔ Oficial (`buscarPrecoTabelaLinha`) | Nenhuma |
| Resolver por **Produto** | ⚠ Existe como **compat** (`tabela_preco_produto_itens`, origem `tabela_preco_produto`) | Tratado como fallback, não como caminho de primeira classe quando não há linha |
| Resolver **Unidade Comercial** | ✔ | Nenhuma |
| Resolver **Preço** | ✔ | Nenhuma |
| Resolver **Origem** | ✔ | Nenhuma |
| Devolver **tabela utilizada** | ✔ `tabela_preco_id` / nome | Nenhuma |
| Sem Linha → usar Produto na Tabela | ⚠ Parcial | Só funciona se existir célula em `tabela_preco_produto_itens` **e** `pularCompat` não bloquear; UI da Tabela RA-6 **não cadastra** produto na grade |
| Com Linha sem célula → Preço Segurança | ✔ (via `pularCompat`) | Alinhado à proteção; não tenta produto se a linha “deveria” ter preço |

### O que falta (comportamento — sem banco)

1. **Promover** “Tabela × Produto” a caminho **oficial** quando o produto **não tem** Linha (hoje é “compat”).
2. **UI da Tabela** permitir incluir referência **Produto** (hoje só Linha) — usando store já existente `tabela_preco_produto_itens` / API compat.
3. Garantir que PDV/Comercial **não recalculem** preço após o Resolver (exceto promoção/desconto manual documentados).
4. Alinhar Mobile ao mesmo contrato do Resolver (canal da operação, não só VAREJO).

---

# Auditoria 4 — Cadastro de Produtos

**O cadastro atual já permite identificar a Linha de Precificação?**

**Sim.**

- UI: picker “Linha de Precificação” (`frontend/erp/js/produtos.js`)
- Campo: `linha_comercial_id` (opcional — pode ficar vazio)
- Preço de Segurança: `preco_venda` com texto de fallback

**Menor alteração necessária:** nenhuma para “identificar a Linha”.  
Opcional (comportamento/UX): deixar explícito no formulário que Linha vazia = precificação **por Produto** na Tabela (hoje a mensagem enfatiza só o caminho com Linha).

---

# Auditoria 5 — Tabelas de Preços

| Necessidade RCM-8.0 | Capacidade atual |
|---|---|
| Referência **Linha** | ✔ `tabela_preco_valores.linha_comercial_id` + UI RA-6 |
| Referência **Produto** | ✔ estrutura `tabela_preco_produto_itens` (produto_id × tabela × canal + preço + unidade) — **não** na grade RA-6 |
| Unidade comercial | ✔ nas duas stores |
| Preço | ✔ |

**Conclusão:** a estrutura **já consegue** armazenar Produto ou Linha (em stores distintas já existentes).  
O que falta é **comportamento unificado** (Resolver + UI tratarem Produto como referência oficial da grade quando não há Linha) — **não** uma nova tabela, a priori.

---

# Auditoria 6 — PDV

| Pergunta | Resposta |
|---|---|
| Todo cálculo passa pelo Resolver? | **Não.** Caminho principal sim; há paralelos. |
| Cálculo paralelo? | Sim: faixas atacado legado, kit, UC, balança sem enrich, mobile MUC |
| Preço calculado no PDV? | Sim em desconto %, edição manual, promo overlay, legado atacado |
| Consulta direta ao Produto? | Lista `GET /produtos` já normaliza via Resolver (canal default); balança/cache podem usar preço “velho” |
| Uso de preço legado? | Sim: `produto.preco_venda` como fallback do Resolver **e** faixas `produto_atacado` |

---

# Auditoria 7 — Comercial (Consignação / Motor)

| Pergunta | Resposta |
|---|---|
| Usa o mesmo Resolver? | **Sim** — `POST resolver-precos` / `ComercialPrecoResolver` |
| Lógica exclusiva? | Canal **sempre** `CONSIGNADO`; snapshot no item; Tipo Comercial não escolhe preço |
| Duplicação? | Menor que o PDV; formação de preço de **Kit** no ERP ainda fora do Resolver |

---

# Auditoria 8 — Eliminar complexidade (visão de domínio)

| Componente | Continua necessário? | Simplificar? | Remover? |
|---|---|---|---|
| **Lista / Tabela de Preços** | Sim | Manter 1 tabela ativa por operação/contexto | Não |
| **Linha de Precificação** | Sim (opcional no produto) | Só agrupar famílias | Não |
| **Contexto / Canal da operação** | Sim (escolhe qual Tabela) | Pode ficar implícito na operação | Não fundir com Tabela |
| **Tipo / Política de Cliente** | Sim se restringe contextos | Não misturar com preço | Não |
| **Resolver único** | Sim | Única porta de preço de lista | Não |
| **Faixas `produto_atacado`** | Não (domínio: regra na Tabela Atacado) | — | **Eliminar do fluxo** quando Tabela Atacado existir |
| **`linha_comercial_valores` como preço** | Não (preço vive na Tabela) | — | **Desativar no Resolver** |
| **Preço no Kit via SQL cru** | Duvidoso | Kit deveria cotar via Resolver ou preço próprio de oferta | Simplificar |
| **Cache do Resolver** | Mecanismo técnico OK | Manter | Não |
| **N:N políticas no produto (UI multi)** | Domínio avançado | 1 Linha na UI basta agora | Não obrigatório |

---

# Auditoria 9 — Plano de implementação (menor impacto)

## 9.1 Qual comportamento precisa mudar?

1. Sem Linha no produto → preço vem da **célula Produto na Tabela da operação** (oficial, não “compat”).
2. Com Linha → preço vem da **célula Linha na Tabela** (já é assim).
3. PDV e Comercial: preço de lista **somente** via Resolver; paralelos legados desligados.
4. Operação escolhe Tabela (via contexto já existente: Varejo/Atacado/…).
5. Retorno do Resolver já usado de ponta a ponta (preço, unidade, origem, tabela) — inclusive UI/diagnóstico.
6. Mobile alinhado ao desktop no contrato do Resolver.

## 9.2 Qual código precisa mudar? (sem banco)

| Área | Mudança de comportamento |
|---|---|
| `ComercialPrecoResolver` | Quando **não** houver linha: priorizar Tabela×Produto como origem **oficial** (não `fallback: true` / não rotular só “compat”) |
| `tabelas-preco-ra6.js` (+ service já existente de itens produto) | Permitir adicionar **Produto** na grade (além de Linha), gravando na store já existente de itens produto |
| `pdv.js` | Remover/ignorar `obterPrecoAtacado` quando Resolver comercial ativo; forçar enrich na balança; não sobrescrever preço de lista |
| Mobile `pdv.js` | Passar canal/cliente reais; recalc; não usar MUC sem Resolver |
| Kits (ERP) | Cotar itens via Resolver ou documentar kit como oferta com preço próprio explícito |
| Desativar leitura de `linha_comercial_valores` no Resolver (feature-flag / ordem) | Elimina duplicação de preço |

## 9.3 Banco — só se comprovado indispensável

| Alteração de banco | Indispensável agora? |
|---|---|
| Nova tabela | **Não** |
| Novo campo em `tabela_preco_valores` | **Não** — produto já tem store (`tabela_preco_produto_itens`) |
| Novo campo no produto | **Não** — Linha opcional e Preço de Segurança já existem |
| Migration de fusão das duas stores | **Não nesta fase** — só se unificação física for exigida depois |

**Veredito de banco:** a arquitetura RCM-8.0 **pode ser implementada reaproveitando a estrutura atual**, com mudanças de **comportamento e UI**.

---

# Respostas finais (apenas quatro)

### 1. O que já funciona exatamente como a nova arquitetura?

- Operação → Canal → **Tabela ativa** (Varejo/Atacado/Consignado/Evento/Delivery).
- Produto com **Linha opcional** no cadastro.
- Resolver único compartilhado (PDV desktop + Consignação) via `resolver-precos`.
- Caminho oficial **Tabela × Linha × (canal)** com unidade, origem e tabela no retorno.
- Preço de Segurança (`preco_venda`) como fallback.
- Produto **não** escolhe tabela no fluxo oficial.

### 2. O que precisa ser alterado no comportamento?

- Tratar **Tabela × Produto** como caminho oficial quando **não há Linha**.
- UI da Tabela permitir cadastrar preços por **Produto** (store já existe).
- PDV: eliminar paralelos de preço de lista (faixas legado, balança sem Resolver; alinhar mobile).
- Deixar explícito: Linha vazia = precificação por Produto.
- (Opcional) Parar de ler `linha_comercial_valores` como fonte de preço.

### 3. O que está duplicado e deve ser eliminado?

- Faixas `produto_atacado` no PDV (quando Tabela Atacado + Resolver estão ativos).
- Preço em `linha_comercial_valores` (legado paralelo à Tabela).
- Dois “sentidos” de preço de produto: cadastro cru vs Resolver (mobile/MUC/kit SQL).
- Cálculos locais que **substituem** o preço de lista após o Resolver (exceto promo/desconto manual acordados).

### 4. Existe alteração de banco realmente indispensável?

**Não.**  

A arquitetura pode ser implementada **reaproveitando**:

- `tabela_preco_valores` (Linha),
- `tabela_preco_produto_itens` (Produto),
- `produtos.linha_comercial_id` (opcional),
- `produtos.preco_venda` (segurança),
- `tabelas_preco` mono-canal / por operação,
- `ComercialPrecoResolver` + `resolver-precos`.

Qualquer mudança de schema fica **adiada** até se comprovar que as duas stores de célula (linha vs produto) impedem operação — o que hoje é limitação de **comportamento/UI**, não de capacidade estrutural.

---

## Princípio desta sprint

> Menor impacto · máximo reuso · comportamento primeiro · banco só com necessidade comprovada.

**Nenhuma alteração foi implementada nesta auditoria.**
