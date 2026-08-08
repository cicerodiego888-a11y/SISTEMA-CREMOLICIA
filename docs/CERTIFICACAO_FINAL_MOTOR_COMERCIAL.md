# CERTIFICAÇÃO FINAL — Motor Comercial CDS

| Campo | Valor |
|---|---|
| Sprint | RCM-9.0.3 |
| Data | 2026-08-07 |
| Natureza | Auditoria final · **sem alteração de código** |
| Escopo | Precificação · Contagem Atacado · MUC · Central · PDV · Comercial · Mobile |
| Base | RCM-8.0 → 8.9 · RCM-9.0.1 · RCM-9.0.2 · CERTIFICAÇÃO RCM-8.1 |

---

## Veredito

### Arquitetura Comercial oficial — **CERTIFICADA PARA PRODUÇÃO**

O fluxo comercial certificado é único, documentado e em uso no PDV Desktop e no Motor Comercial (Consignação):

```text
Operação
  → CanalVendaResolver          (canal · contagem comercial RCM-9.0.1)
  → ComercialPrecoResolver      (preço · UC da Tabela)
  → Snapshot
  → MUC / MCC                   (estoque · eixo separado)
```

Porta HTTP oficial: `POST /api/configuracao-comercial/resolver-precos`  
(`ConfiguracaoComercialService.resolverPrecosVenda`).

**Não há segundo motor de preço de lista em produção no PDV Desktop.**  
**Não há segundo algoritmo de contagem de Atacado.**  
**Não há segundo MUC no caminho operacional de venda.**  
**Há uma única Central de Precificação.**

Ressalvas conhecidas (não invalidam o núcleo certificado) estão na §8.

---

## 1. Matriz de certificação

| # | Verificação | Resultado | Severidade residual |
|---|---|---|---|
| 1 | Um único Resolver Oficial de Precificação | **PASS** | — |
| 2 | Um único algoritmo de Contagem Comercial | **PASS** | — |
| 3 | Um único MUC de conversões (caminho venda/estoque) | **PASS** | Baixa (preview compras) |
| 4 | Uma única Central de Precificação | **PASS** | — |
| 5 | PDV Desktop e Comercial no mesmo fluxo | **PASS** | — |
| 6 | Mobile no mesmo fluxo | **PASS parcial** | Alta (PDV Mobile força VAREJO) |
| 7 | Sem regras antigas de atacado no preço de lista | **PASS** (caminho venda) | Média (API/CRUD residual) |
| 8 | Sem cálculos paralelos de preço de lista | **PASS** | Baixa (ofertas pós-resolver) |
| 9 | Sem atalhos de preço de lista | **PASS** | Baixa (consulta display) |
| 10 | Sem atalhos de unidade no PDV (estoque) | **PASS** | Baixa (preview compras) |

---

## 2. Resolver Oficial de Precificação

### Certificado

| Peça | Local |
|---|---|
| Motor | `backend/modules/comercial/preco/ComercialPrecoResolver.js` |
| Orquestração de venda | `ConfiguracaoComercialService.resolverPrecosVenda` |
| Rota | `POST .../configuracao-comercial/resolver-precos` |

Hierarquia oficial (RCM-8.0):

```text
Tabela × Linha  →  Tabela × Produto  →  Preço de Segurança
```

Unidade Comercial vem da **Tabela**, não do cadastro de preço do produto.

### Ausências no PDV (confirmadas)

| Artefato legado | PDV Desktop |
|---|---|
| `function obterPrecoAtacado` | **Não existe** |
| Leitura de faixas `produto_atacado` para preço | **Não existe** |
| Cálculo de lista local substituindo o Resolver | **Não existe** |

### Call sites oficiais de `ComercialPrecoResolver.resolver`

- `ConfiguracaoComercialService` (venda / comparar tabelas)
- `CentralPrecificacaoService` (simulador)
- `PdvVendaOperacionalService` (enrich)
- Bridges / listagens de produto (exibição via resolver)

**Conclusão §2:** um Resolver Oficial. Preço de lista da operação passa por ele.

---

## 3. Contagem Comercial (Atacado)

### Certificado

Único algoritmo: `CanalVendaResolver.contribuicaoContagemAtacado` → `somar` / `avaliarContagem`.

| Forma | Contribuição (RCM-9.0.1) |
|---|---|
| UNIDADE / CASQUINHA / KIT / PERSONALIZADA | Quantidade da linha |
| PESO / VOLUME | 1 por linha |

PDV Desktop **não** reimplementa a soma: usa `quantidadeAtual` / `quantidadeNecessaria` da API.  
Homologação UX: RCM-9.0.2 (`Itens Comerciais`).

O `reduce` de `quantidade` no rodapé do PDV é contador visual de itens do carrinho — **não** ativa Atacado.

**Conclusão §3:** um algoritmo de Contagem Comercial.

---

## 4. MUC — Conversões

### Certificado (caminho operacional)

Ordem oficial (`resolverUnidadeComercialOficial`):

```text
Identidade → catálogo UC opcional → produto_conversoes → canônicas MUC → erro oficial
```

Orchestrators PDV / Comercial / Estoque / Compra consomem esse resolvedor.  
PDV envia `quantidade_comercial`; **não** multiplica `fator_conversao` localmente para baixa de estoque.

Docs: `RCM88_MUC_ARQUITETURA.md`, `RCM89_CONVERSOES_PRODUTO.md`.

**Conclusão §4:** um MUC no fluxo de venda/estoque.

---

## 5. Central de Precificação

| Peça | Local |
|---|---|
| Página | `frontend/erp/pages/tabelas-preco.html` |
| Shell | `frontend/erp/js/tabelas-preco.js` |
| UI oficial (RA-6) | `frontend/erp/js/tabelas-preco-ra6.js` |
| Alias de menu | “listas de preços” → mesma Central |

Config de Atacado (`venda-no-atacado`) parametriza limiar/contagem — **não** é uma segunda lista de preços.

**Conclusão §5:** uma Central.

---

## 6. PDV Desktop × Comercial

| Cliente | Endpoint | Canal |
|---|---|---|
| PDV Desktop | `resolver-precos` | Automático (VAREJO↔ATACADO) ou manual/cliente |
| Consignação Desktop | `resolver-precos` | Forçado `CONSIGNADO` (correto) |

Mesma porta, mesmo Resolver, mesmo Snapshot de precificação.  
Diferenças são de **contexto de canal**, não de motor paralelo.

**Conclusão §6:** mesmo fluxo oficial.

---

## 7. Mobile

| Superfície | Endpoint | Alinhamento |
|---|---|---|
| Consignação Mobile | `resolver-precos` + `canal: CONSIGNADO` | **Alinhado** |
| PDV Mobile | `resolver-precos` | **Usa o Resolver**, porém força `canal: 'VAREJO'` na inclusão |

### Ressalva (dívida conhecida)

O PDV Mobile **não** replica o recálculo de carrinho com contagem automática de Atacado do Desktop.  
Preço continua oficial (Resolver); **canal Atacado automático** não opera no Mobile até sprint dedicada.

Certificação RCM-8.1 já reconhecia “Mobile chama `resolver-precos`”.  
RCM-9.0.3 mantém: **núcleo certificado**; paridade Atacado Mobile = backlog.

**Conclusão §7:** mesmo motor de preço; gap de canal automático no PDV Mobile.

---

## 8. Legado, atalhos e resíduos

### Removidos do fluxo de lista (PASS)

- `obterPrecoAtacado` no PDV  
- Faixas na UI de cadastro (RCM-8.6.2)  
- Contagem física mista UN+KG para Atacado (corrigida em 9.0.1)

### Residuais aceitos / rastreados (não bloqueiam produção Desktop)

| Residual | Natureza | Ação futura |
|---|---|---|
| Tabela/API `produto_atacado` | CRUD/API ainda no backend | Deprecar rotas em sprint de limpeza |
| Kit FIXO / oferta unidade | Preço congelado **após** Resolver | Mantido por domínio |
| `obterPrecoVendaConsultaPdv` | Exibição/consulta | Não substitui venda |
| Preview `qtd × fator` em Compras ERP | UI de entrada | Fora do PDV |
| PDV Mobile força VAREJO | Gap de canal | Sprint Mobile Atacado |

### Separação de eixos (obrigatória)

| Eixo | Responsável | Não misturar com |
|---|---|---|
| Canal / Contagem | `CanalVendaResolver` | Estoque |
| Preço / UC tabela | `ComercialPrecoResolver` | MUC |
| Estoque / conversão | MUC + MCC | Preço |

---

## 9. Fluxo oficial (diagrama)

```text
┌─────────────────────────────────────────────────────────┐
│  PDV Desktop / Comercial / Central (simular)              │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
              POST /resolver-precos
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
 CanalVendaResolver                 ComercialPrecoResolver
 (contagem comercial)               (Tabela→Preço→UC)
         │                                   │
         └─────────────────┬─────────────────┘
                           ▼
                     Snapshot item
                           │
                           ▼
              MUC/MCC → quantidade base → Estoque
```

---

## 10. Evidências de suíte

| Suíte | Papel |
|---|---|
| `rcm81-certificacao-precificacao.test.js` | Certificação Resolver / PDV / Comercial |
| `rcm901-contagem-atacado.test.js` | Contagem por Forma |
| `rcm902-homologacao-atacado.test.js` | UX + cenários Cremolicia |
| `rcm88` / `rcm89` (MCC) | MUC / conversões produto |
| Testes RA-6 / RCM-8.4 / RCM-8.5 | Canal · PDV Motor · Comercial unificado |

---

## 11. Declaração de produção

Sob o escopo **Desktop PDV + Motor Comercial + Central + Contagem RCM-9.0.x + MUC RCM-8.8/8.9**:

> A Arquitetura Comercial do CDS está **oficialmente certificada para produção**.  
> Existe um único caminho de preço de lista, uma única contagem comercial de Atacado, um único MUC operacional e uma única Central de Precificação.

Itens em backlog (Mobile Atacado automático; purge API `produto_atacado`) **não** alteram essa certificação do núcleo; devem ser tratados em sprints específicas sem reabrir o Motor Oficial.

---

## 12. Referências

- `docs/RCM80_ARQUITETURA_OFICIAL.md`  
- `docs/CERTIFICACAO_RCM81_PRECIFICACAO.md`  
- `docs/RCM84_PDV_MOTOR_OFICIAL.md` (se presente)  
- `docs/ANALISE_CONTAGEM_ATACADO_RCM90.md`  
- `docs/RCM901_CONTAGEM_ATACADO.md`  
- `docs/RCM902_HOMOLOGACAO_ATACADO.md`  
- `docs/RCM88_MUC_ARQUITETURA.md`  
- `docs/RCM89_CONVERSOES_PRODUTO.md`  
- `backend/modules/comercial/preco/ComercialPrecoResolver.js`  
- `backend/modules/comercial/preco/CanalVendaResolver.js`  
- `backend/modules/comercial/configuracao/ConfiguracaoComercialService.js`  
- `backend/motores/motor-conversao-comercial/services/resolverUnidadeComercialOficial.js`

---

**RCM-9.0.3 — Certificação final registrada. Nenhuma alteração de código nesta sprint.**
