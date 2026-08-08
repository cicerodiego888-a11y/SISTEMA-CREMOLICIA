# AUDITORIA RCM-7.4 — Aderência da UI da Consignação à Arquitetura Oficial

| Campo | Valor |
|---|---|
| Tipo | Auditoria rápida (somente análise) |
| Data | 2026-08-06 |
| Escopo | Nova Consignação / Preparar Entrega — UI |
| Base | RA-6.x · RCM-6.1 · RCM-7.2 · RCM-7.2.1 · RCM-7.3 · RCM-7.4 |
| Código | **Não alterado** nesta auditoria |

---

## Premissa

A arquitetura oficial **não** é reavaliada.

Objetivo: verificar se a interface da Nova Consignação **obedece** à arquitetura aprovada e se ainda carrega heranças do PDV que deixaram de fazer sentido após RA-6.x / RCM-7.x.

Fontes de verdade consultadas:

| Documento / Artefato | Papel |
|---|---|
| `RCM61_CONGELAMENTO_PRECIFICACAO_CONSIGNACAO.md` | Snapshot CONSIGNADO no item |
| `RCM72_TIPOS_COMERCIAIS_ENTERPRISE.md` | Tipo → canais; consignação com `canal_manual` |
| `RCM721_CANAL_OPERACAO_CONSIGNACAO.md` | Canal da operação sempre CONSIGNADO |
| `RCM73_TIPO_COMERCIAL_ENTERPRISE.md` | UI de Tipos (cadastro) — fora da consignação |
| `RCM74_ADEQUACAO_VISUAL_CONSIGNACAO.md` | Card de canal só no PDV; resumo na consignação |
| `NovaConsignacao/index.js` · `PrepararEntregaView.js` · `prepararEntregaMappers.js` | UI atual |
| `frontend/pdv/js/pdv.js` · `ComercialStatusCard.js` | Referência PDV |

---

## 1. Card “Canal da Venda” na Consignação?

**Resposta: não faz sentido na Consignação. Deve existir apenas no PDV.**

| Critério | Avaliação |
|---|---|
| PDV | Canal dinâmico (VAREJO ↔ ATACADO / EVENTO) + progresso de Atacado — **card faz sentido** |
| Consignação | Operação nasce e permanece com `canal_manual = CONSIGNADO` — **card de troca de canal não faz sentido** |

**Estado atual (pós RCM-7.4):**

- `ComercialStatusCard` **não** é importado/montado na Nova Consignação.
- Em seu lugar: resumo compacto `cds-operacao-resumo` com **Canal da Operação = CONSIGNADO** (fixo, não seletor).

**Conclusão do item:** aderente à arquitetura. O card “Canal da Venda” permanece exclusivo do PDV.

---

## 2. A tela ainda exibe VAREJO / ATACADO (ou outro canal) como Canal da Operação?

**Resposta: não — no fluxo atual da operação o canal exibido é CONSIGNADO.**

| Camada | Comportamento observado |
|---|---|
| Estado | `data.canalVenda = CONSIGNADO` |
| Resolve | `resolverPrecosVenda(..., { canal: 'CONSIGNADO' })` sem `cliente_id` |
| Resumo UI | Canal da Operação fixo em CONSIGNADO |
| Snapshot item | `item.canalVenda = CONSIGNADO` na persistência |

O Tipo Comercial do cliente pode ser Varejo / Atacadista / etc. — isso aparece como **Tipo Comercial**, não como Canal da Operação (correto: RCM-7.2.1).

Não há indicadores de troca dinâmica VAREJO ↔ ATACADO nesta tela.

---

## 3. Informação duplicada (crédito / limite / saldo)?

**Resposta: sim — há sobreposição relevante no mesmo fluxo.**

Superfícies que repetem a mesma família de dados:

| Superfície | Campos típicos |
|---|---|
| `credit-strip` (topo) | Crédito disponível · Valor da entrega · Saldo restante |
| Barra do cliente (passo Produtos) | Limite · Saldo |
| Painel operacional (`prep-painel-operacional`) | Crédito Disponível (hero) · barra de utilização · Limite Comercial · Valor · Saldo restante |
| Resumo compacto da grade | Itens · Qtd · Valor · Saldo |
| Painel do cliente (passo Cliente) | Saldo Atual · Limite |
| Conferência | Limite Disponível · Saldo após a Entrega |

Observações:

- “Limite”, “Limite Comercial”, “Crédito disponível” e `limiteDisponivel` misturam nomenclatura sobre o mesmo eixo de risco de crédito.
- A barra de utilização do painel é de **crédito/limite da consignação**, não a barra de Atacado do PDV — propósito distinto, mas visualmente denso e redundante com o strip.

**Isso não viola** a arquitetura de precificação/canal; é **dívida de UX operacional**.

---

## 4. Componentes visuais reaproveitados / herdados do PDV?

| Componente | Status na Consignação | Parecer |
|---|---|---|
| Card **Canal da Venda** (`ComercialStatusCard`) | Removido (RCM-7.4) | Correto — exclusivo PDV |
| Barra de progresso **Atacado** (canal) | Ausente | Correto |
| Indicadores de **troca dinâmica de canal** / toasts VAREJO↔ATACADO | Ausentes | Correto |
| LIP (busca/inclusão de produtos) | Presente | Aceitável — componente compartilhado de operação, **não** herança de canal |
| Badge/economia de atacado por item | Não observado na grade | OK |
| Painel denso de crédito + barra de % | Presente | Próprio da consignação; excesso de densidade, não herança de canal PDV |

**Herdados do PDV que ainda importavam antes do RCM-7.4 e já foram tratados:** card de canal + barra de Atacado.

**Não classificados como herança indevida de canal:** LIP, Workspace, Stepper, painel de limite comercial.

---

## 5. O que realmente agrega valor na Preparação de Consignação?

| Informação | Agrega? | Situação na UI atual |
|---|---|---|
| Cliente | Sim | Presente |
| Tipo Comercial | Sim | Presente no resumo da operação |
| Canal da Operação (CONSIGNADO) | Sim (confirmação, não seletor) | Presente no resumo |
| Tabela de Preços utilizada | Sim | Presente no resumo (nome após resolve) |
| Unidade Comercial | Sim | Parcial — ao lado do preço na grade |
| Prazo / data prevista | Sim (operacional) | Em dados do fluxo; não no resumo compacto |
| Limite / crédito / saldo | Sim (risco) | Presente **em excesso** (várias superfícies) |
| Snapshot RCM-6.1 (linha, tabela, canal, origem, fallback) | Sim (auditoria visual) | **Fraco** — congelado no dado/persistência; grade não expõe origem/fallback/linha; operador não “vê” o congelamento |

O que **não** agrega na consignação:

- Seletor / progresso de canal VAREJO–ATACADO
- Economia de atacado por item
- Qualquer UX que sugira mudança de canal no meio da preparação

---

## 6. Divergências RCM-6.1 / 7.2 / 7.3 × interface atual?

| Referência | Expectativa | UI atual | Divergência? |
|---|---|---|---|
| **RCM-6.1** | Congelar precificação no item; operação CONSIGNADO | Resolve + persistência alinhados; UC parcial na grade | **Parcial** — snapshot completo pouco visível ao operador |
| **RCM-7.2** | Tipo com canais permitidos; consignação alerta soft se Tipo não inclui CONSIGNADO | `_validarCanalConsignadoTipoComercial` mantido | **Não** (regra OK) |
| **RCM-7.2.1** | `canal_manual` absoluto; nunca VAREJO como canal da operação | Implementado; resumo mostra CONSIGNADO | **Não** na lógica; doc RCM721 ainda cita “Card Canal da Operação” (desatualizado vs RCM-7.4) |
| **RCM-7.3** | Abas do cadastro de Tipos Comerciais | Fora desta tela | **N/A** |
| **RCM-7.4** | Sem card PDV; resumo Tipo / Canal / Tabela; sem barra Atacado | Implementado | **Não** |

Única divergência material para o operador: **transparência do snapshot (RCM-6.1)** na grade/conferência. A arquitetura de canal está alinhada.

---

## Componentes corretos

- Resumo da operação (`Tipo Comercial` · `Canal da Operação CONSIGNADO` · `Tabela de Preços`)
- Forçar `canal = CONSIGNADO` no resolve (sem `cliente_id`)
- Persistência do snapshot comercial no item (backend / payload)
- Soft warning de Tipo sem canal CONSIGNADO (RCM-7.2)
- Ausência do `ComercialStatusCard` e da barra de Atacado
- LIP + grade operacional (adequados ao fluxo de preparação)

---

## Componentes incorretos / inadequados ao contexto

- **Nenhum componente de canal PDV ativo** na tela atual
- **Densidade / duplicação** de crédito·limite·saldo (incorreto do ponto de vista de clareza, não de arquitetura de preço)

---

## Componentes herdados do PDV

| Item | Situação |
|---|---|
| Card Canal da Venda | Removido |
| Barra Atacado (canal) | Removida |
| Troca dinâmica de canal | Removida |
| Padrão mental “status de canal da venda” | Substituído por “Canal da Operação” fixo |

---

## Recomendação de remoção

1. Unificar superfícies de crédito: manter **uma** fonte visual primária (ex.: strip **ou** painel hero — não ambos com os mesmos três números).
2. Remover da barra do cliente (passo Produtos) o par Limite/Saldo se o strip/painel já os exibe.
3. Não reintroduzir `ComercialStatusCard` nesta tela.

---

## Recomendação de reorganização

1. Manter o **resumo da operação** (Tipo · Canal · Tabela) como âncora comercial.
2. Agrupar risco financeiro em um único bloco: Limite · Crédito disponível · Saldo após entrega · % utilização.
3. Na grade ou no detalhe do item, expor de forma discreta o **snapshot** (tabela / UC / origem / fallback) — aderência visual ao RCM-6.1.
4. Incluir prazo/data prevista no resumo operacional quando fizer parte do momento de conferência.
5. Atualizar texto residual do doc `RCM721` (ainda menciona “Card Canal da Operação”) para apontar ao resumo RCM-7.4 — **documentação**, não regra.

---

## Parecer final

### **B — Necessita ajustes visuais**

| Critério | Nota |
|---|---|
| Canal da operação × arquitetura (RCM-7.2.1 / 7.4) | Aderente |
| Separação PDV × Consignação (card / Atacado) | Aderente |
| Clareza / não duplicação de crédito | Necessita ajuste |
| Transparência do snapshot RCM-6.1 na UI | Necessita ajuste leve |

**Não é A** — ainda há sobreposição de crédito/limite/saldo e pouca visibilidade do congelamento na grade.

**Não é C** — a UI **não** está incompatível com a arquitetura oficial de canal/precificação após RCM-7.4; as heranças críticas do PDV (card de canal e barra de Atacado) foram removidas.

---

## Resumo executivo

A Nova Consignação **já reflete** o modelo oficial de canal (sempre CONSIGNADO) e **não** deve voltar a usar o card “Canal da Venda” do PDV. Os ajustes restantes são de **organização visual** (crédito único + snapshot legível), sem reabrir regras do Resolver, Motor Comercial ou Tipos Comerciais.
