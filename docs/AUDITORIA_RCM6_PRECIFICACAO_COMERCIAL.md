# AUDITORIA RCM-6 — Adequação do Motor Comercial à Arquitetura Oficial de Precificação

| Campo | Valor |
|---|---|
| Tipo | Auditoria (sem implementação) |
| Data | 2026-08-06 |
| Base | RA-6 / RA-6.4 / RA-6.6 / RA-6.8 + Motor Comercial (Consignação) |
| Restrição | Não altera código nem banco |

---

## Arquitetura oficial (referência)

```text
Produto
    ↓
Linha de Precificação
    ↓
Tabela de Preços
    ↓
Canal
    ↓
Unidade Comercial
    ↓
Preço
    ↓
Preço de Segurança (fallback)
```

---

## 1. Nova Consignação — como o preço é obtido?

| | |
|---|---|
| **Usa Resolver Oficial?** | **Sim** (caminho principal) |
| **Consulta própria?** | Não (não há SQL de preço no Wizard) |

### Evidência

1. `_recalcularPrecosCanalVenda` chama `POST /configuracao-comercial/resolver-precos` com **`canal: 'CONSIGNADO'`** forçado  
   (`frontend/modules/motor-comercial/pages/NovaConsignacao/index.js` ~894–906).
2. API client: `MotorComercialApi.resolverPrecosVenda` → `ConfiguracaoComercialService.resolverPrecosVenda` → `ComercialPrecoResolver.resolver`.
3. O preço retornado (`row.preco_venda`) sobrescreve `item.preco` antes de persistir.

### Ressalvas

| Ponto | Detalhe |
|---|---|
| LIP / busca ERP | Exibe temporariamente `produto.preco_venda` do ERP até o recálculo do canal |
| Aplicação incompleta | Só aplica **preço**; **não** aplica `unidade_comercial` / `unidade_rotulo` do Resolver |
| Fallback no bridge | `ProdutoPlatformGateway.buscarPorId` chama `ComercialPrecoResolver.resolver({ produto })` **sem canal** → default VAREJO / Preço de Segurança (usado se `precoUnitario` não vier no add-item) |

---

## 2. Entrega — quem fornece Preço / Unidade / Tabela / Canal?

| Campo | Quem fornece | Observação |
|---|---|---|
| **Preço** | Item já persistido (`precoUnitario` / `preco`) | Entrega **não** resolve de novo |
| **Unidade Comercial** | **Não** — usa `produtos.unidade` (JOIN) | UC da Tabela Consignado não persiste no item |
| **Tabela** | **Não** gravada no item | Implícita no momento da preparação |
| **Canal** | **Não** gravado no item | Implícito: CONSIGNADO na preparação |

Valor da entrega = `quantidadeEntregue × precoUnitario`  
(`RegistrarEntregaConsignacaoUseCase`).

---

## 3. Prestação de Contas

| | |
|---|---|
| **Usa preço do Resolver na hora?** | **Não** |
| **Usa preço gravado anteriormente?** | **Sim** (`item.precoUnitario`) |

Venda, perda, cortesia, devolução: `quantidade × item.precoUnitario`.

Comportamento **correto** para congelar o preço da consignação/entrega. Não recalcula Tabela Consignado na prestação.

---

## 4. Conta Corrente

| | |
|---|---|
| **Lógica própria de preço?** | **Não** |

Extrato reconstrói a partir do **ledger** (`movimentacoes_comerciais`): soma `valor` por tipo. Sem Resolver, sem tabela, sem markup.

---

## 5. Dashboard Comercial

| | |
|---|---|
| **Base** | Valores da **venda/movimentação já realizada** (agregação) |
| **Recalcula preço?** | **Não** |

Indicadores somam ENTREGA / VENDA / etc. do ledger (`DashboardProjectionService` + helpers). Sem Resolver.

---

## 6. Canal CONSIGNADO

| Regra | Status |
|---|---|
| Sempre força canal `CONSIGNADO` na Nova Consignação | ✓ |
| Tabela = ativa do canal CONSIGNADO (`buscarAtivaPorCanal`) | ✓ (via Resolver) |
| Nunca usa `produto.tabela_preco_id` no fluxo oficial do Resolver | ✓ (RA-6.4) |
| Nunca consulta direta a `linha_comercial_valores` como SSOT | ✓ (só compat no Resolver, e pode ser pulada) |
| Preço de Segurança como oficial? | **Não** — só **fallback** se não houver célula Tabela×Linha |

**Ressalva:** se a Tabela Consignado não tiver preço para a Linha, o Resolver cai no Preço de Segurança (`produtos.preco_venda`) — desenho RA-6.5.1, não preço oficial da tabela.

---

## 7. Produtos vendidos por peso (ex.: Sorvete → LITRO)

### Fluxo ideal (arquitetura)

```text
Tabela Consignado
    ↓
Unidade Comercial (ex.: LITRO)
    ↓
Resolver (preço + UC)
    ↓
MUC (conversão → Unidade Base)
    ↓
Estoque
```

### Situação atual no Motor Comercial

| Elo | Status |
|---|---|
| Resolver retorna UC (LITRO/KG) | ✓ (API) |
| Nova Consignação aplica UC no item | ✗ (só aplica preço) |
| Persistência `unidade_comercial` no item | ✗ (schema sem coluna) |
| Leitura na entrega | `produtos.unidade` (base) |
| MUC na prestação | ✓ (`resolverQuantidadeBaseMcc` / MCC) — mas a origem da unidade comercial da tabela **não** viaja |

**Conclusão parcial:** não há lógica própria de conversão no Motor Comercial; o MUC existe. Porém a **Unidade Comercial da Tabela** não é capturada no ciclo consignação → entrega → prestação.

---

## 8. Atacado Comercial

| | |
|---|---|
| Regras `TOTAL_VENDA` / `POR_LINHA` / `POR_PRODUTO` | Em `CanalVendaResolver`, preferindo **Tabela Atacado** (`atacado_habilitado`) |
| Cálculo paralelo de preço no Motor Comercial? | **Não** |
| Consignação usa atacado? | **Não** — canal manual `CONSIGNADO` bypassa a decisão VAREJO/ATACADO |

Adequado: atacado é do PDV/pedidos via mesmo Resolver; consignação não inventa regra paralela.

---

## 9. Duplicidades — preço fora do Resolver?

| Local | Tipo | Classificação |
|---|---|---|
| `resolver-precos` + `ComercialPrecoResolver` | Oficial | **ATIVO** |
| LIP / ERP `preco_venda` | Display temporário até resolve | **COMPAT / UX** |
| `ProdutoPlatformGateway` (Resolver sem canal) | Fallback add-item | **DIVERGÊNCIA** (canal errado) |
| `qty × precoUnitario` pós-persistência | Operação financeira, não precificação | **OK** |
| Conta Corrente / Dashboard | Agregação ledger | **OK** |
| Markup/margem próprio no motor-comercial | Não encontrado | — |

**Não há** segundo motor de tabela/markup no Motor Comercial. Há **gaps de aderência** (UC + bridge sem canal), não um cálculo paralelo completo.

---

## Mapa de responsabilidades

| Fluxo | Precificação | Unidade Comercial | Totais |
|---|---|---|---|
| Nova Consignação | Resolver (CONSIGNADO) | Resolvida na API, **não persistida** | Preço × qtd |
| Entrega | Preço congelado | Unidade base do produto | Preço × entregue |
| Prestação | Preço congelado | MCC com unidade informada/cadastro | Preço × operação |
| Conta Corrente | — | — | Ledger |
| Dashboard | — | — | Ledger |

---

## Fluxos (síntese)

### Preparação (oficial, com ressalvas)

```text
Produto (LIP)
    ↓
resolver-precos (canal CONSIGNADO)
    ↓
ComercialPrecoResolver
    ↓
Tabela Consignado × Linha → Preço (+ UC na resposta)
    ↓
item.preco = preço   [UC ignorada hoje]
    ↓
Persistência consignação
```

### Pós-entrega (correto)

```text
precoUnitario congelado
    ↓
Entrega / Prestação / Ledger
    ↓
Conta Corrente / Dashboard (consulta)
```

---

## Divergências (prioridade)

| # | Divergência | Severidade | Impacto |
|---|---|---|---|
| 1 | Unidade Comercial do Resolver não aplicada/persistida na consignação | **Alta** (RA-6.6) | Peso/LITRO pode baixar estoque pela unidade base errada |
| 2 | `ProdutoPlatformGateway` resolve sem canal CONSIGNADO | Média | Fallback de add-item pode usar Varejo/Segurança |
| 3 | LIP mostra `preco_venda` ERP antes do resolve | Baixa | UX transitória |
| 4 | Tabela/Canal não ficam auditáveis no item | Baixa | Rastreio |

---

## 10. Conclusão

### **B — Existem divergências**

#### Justificativa

O Motor Comercial **não** possui motor paralelo de precificação. A Nova Consignação usa o **Resolver oficial** com canal **CONSIGNADO**. Entrega, Prestação, Conta Corrente e Dashboard usam corretamente **preço/valores congelados** (ledger), sem recalcular.

Não é **A** porque há divergências materiais em relação à arquitetura RA-6.6/RA-6.9:

1. Unidade Comercial não atravessa o ciclo consignação.  
2. Bridge de produto resolve preço sem canal.  
3. Display ERP pré-resolve na LIP.

Não é **C** porque o caminho feliz já está no Resolver oficial; a correção é **aderência pontual** (capturar UC, passar canal no bridge), não reescrita do Motor Comercial.

---

## Recomendação (sem implementar nesta auditoria)

1. Na Nova Consignação, aplicar e persistir `unidade_comercial` (+ rótulo) retornados pelo Resolver.  
2. Em `ProdutoPlatformGateway.buscarPorId`, aceitar/forçar `canal: 'CONSIGNADO'` no contexto comercial.  
3. Garantir Tabela Consignado populada (Linha × Unidade × Preço) para evitar Preço de Segurança inadvertido.  
4. Manter Entrega/Prestação/Dashboard em preço congelado (não recalcular).

---

## Evidências principais

| Área | Arquivo |
|---|---|
| Resolve CONSIGNADO | `NovaConsignacao/index.js` (~880–910) |
| API resolver-precos | `MotorComercialApi.js` (~313–345) |
| Orquestração | `ConfiguracaoComercialService.resolverPrecosVenda` |
| Bridge sem canal | `ProdutoPlatformGateway.js` (~33–42) |
| Add item fallback | `AdicionarItemConsignacaoUseCase.js` (~54–56) |
| Entrega | `RegistrarEntregaConsignacaoUseCase.js` |
| Prestação | `RegistrarVendaPrestacaoUseCase.js` |
| Conta / Dashboard | `*ProjectionService` + `projectionHelpers.js` |

---

**Parecer final: B — Existem divergências.**
