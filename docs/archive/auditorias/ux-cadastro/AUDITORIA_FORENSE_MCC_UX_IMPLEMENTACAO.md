# AUDITORIA FORENSE — Implementação das Unidades de Comercialização (MCC)

**Código:** AUDITORIA_MCC_UX_IMPLEMENTACAO  
**Prioridade:** P0  
**Tipo:** Auditoria Forense (sem implementação)  
**Data:** 2026-07-17  
**Escopo:** UI ERP de Produtos e Compras × arquitetura MCC/UC homologada  

---

## Decisão desta auditoria

**NÃO** foi alterado código, layout ou comportamento.  
Somente leitura de implementação existente e documentos oficiais.

---

## Referências oficiais usadas

| Documento | Papel |
|-----------|--------|
| `ARQUITETURA_CORE_CDS.md` / `ARQUITETURA_GERAL.md` | Um Produto → Uma Unidade Base → N UCs → MCC → Estoque; fator físico **não** no produto |
| `ADR_UNIDADES_COMERCIALIZACAO.md` / `UC_01_ARQUITETURA.md` / `UC_01_1_REFINAMENTO.md` | Cadastro de UCs |
| `MCC_02_CONVERSAO_FISICA_LOTE.md` / `MCC_02_1_VERSIONAMENTO.md` | Conversão física **por lote** |
| `MCC_03_ENTRADA_OPERACIONAL.md` / `MCI_01_ENTRADA_MERCADORIAS.md` | Peso/volume na **Entrada** |
| `GOVERNANCE.md` Regra 6 e 7 | Unidade Base; conversão física no lote |

---

# AUDITORIA 1 — Cadastro do Produto

## Pergunta

A tela de cadastro do produto solicita alguma informação que deveria pertencer ao lote?

## Resposta

**SIM** (parcial) — **não** pede fator/peso físico do lote, mas **declara** Conversão Física no produto e mistura conceitos legados de peso.

## Campos analisados

### Aderentes (permitidos no produto)

| Campo | Evidência | Avaliação |
|-------|-----------|-----------|
| Unidade Base `#unidade` | `frontend/erp/js/produtos.js` ~1560 | **OK** — SSOT do produto |
| `#utiliza_conversao_fisica` | ~1912–1926 | **OK** como **flag** (arquitetura prevê flags no produto) |
| `#unidade_conversao_fisica` | ~1927–1943 | **OK** como destino físico declarado (não é fator) |
| Texto explícito “fator **não** é informado no cadastro” | ~1924–1926 | **OK** — alinhado à arquitetura |
| Seção UC-01 | `#secaoUnidadesComercializacaoUc01` ~1948–1995 | **OK** — N unidades comerciais |
| Quantidade UC (`#uc01_quantidade`) | `abrirModalEditarUnidadeUc01` ~5056–5057 | **OK** — fator **comercial** (agrupamento), não físico |

### Divergentes / risco de confusão

| Campo | Evidência | Problema |
|-------|-----------|----------|
| `#produto_fracionado` — “Vendido por Peso” | ~1574–1585 | Conceito **legado** paralelo à Conversão Física / UC; operador pode confundir “peso de venda” com “conversão física por lote” |
| `#peso_medio_unidade` | ~1603–1611 | Peso no **cadastro** (PDV venda por UN). **Não** é o fator físico do lote, mas é “peso no produto” — desvio semântico |
| Coluna **“Lote”** na grade UC + flag “Conversão por Lote” | tabela UC ~1983; modal UC (~prep. UC-02) | Antecipa conceito de lote **no cadastro de UC**, misturando UC comercial com conversão física |
| Tipo UC `CONVERSAO_FISICA` | `UC01_TIPOS` ~4854 | Label “Conversão Física” dentro do cadastro de **Unidade Comercial** — mistura camadas |

### O que **não** está no cadastro (correto)

- Campo editável de **fator físico** (1 L = X Kg)  
- Peso total da balança / peso da embalagem da compra  
- Criação de `ConversaoFisicaLote`

`saveProduto` (~2906–2910) envia só flags; comentário: *“fator NÃO é cadastrado aqui”*.

---

# AUDITORIA 2 — Fluxo da Conversão Física

## Hoje a UI solicita dados da Conversão Física em:

| Local | O quê | Evidência |
|-------|-------|-----------|
| **Cadastro Produto** | Flag + unidade destino (`utiliza_conversao_fisica`, `unidade_conversao_fisica`) | `produtos.js` ~1912–1943 |
| **Entrada Compra** | Peso por embalagem **ou** peso total (+ volume opcional) | `compras.js` `#painelMccEntrada` ~1795–1854; validação ~1245–1256 |
| **Outro** | Preview de fator (somente leitura) | `#resultado_fator_mcc` ~1841; `calcularPreviewMccEntrada` ~298–345 |

## Comparação com arquitetura

| Esperado | Implementado |
|----------|--------------|
| Produto: declarar exigência (sem fator) | **SIM** |
| Entrada: coletar peso/volume | **SIM** |
| Lote: persistir fator (backend MCC) | Fora do escopo UI desta auditoria; UI **não** edita fator do lote |
| Fator digitado pelo operador | **NÃO** (correto) |

---

# AUDITORIA 3 — UX Operacional

## O operador informa

| Modo | Campo | Pensamento exigido |
|------|-------|---------------------|
| Peso por embalagem | `#peso_embalagem_mcc_item` | Peso da caixa/pote |
| Peso total | `#peso_total_mcc_item` (placeholder `67,500`) | Peso total da balança |
| Volume total (modo peso total) | `#volume_total_mcc_item` | Volume/quantidade total |

## A interface obriga o operador a pensar em “fator”?

**Não como entrada.**  
Textos explícitos:

- Compra: *“Nunca informe ‘1 Litro = X Kg’ — o sistema calcula o fator a partir do peso.”* (~1836)  
- Preview: *“Fator calculado: … (não digite o fator)”* (`calcularPreviewMccEntrada` ~320, 327)

## Desvios UX

1. **Preview do fator no front** (`compras.js` ~314–327) recalcula `peso/volume` no browser. Arquitetura diz que o **MCC** calcula. É espelho informativo, mas ainda **expõe** a linguagem “fator” ao operador.  
2. Coexistência do painel legado **“Motor de Conversão de Unidades”** (`#painelConversaoEmbalagem` ~1856) para fracionado sem MCC — segundo mental model.  
3. “Vendido por Peso” + “Peso médio da unidade” no produto reforçam linguagem de peso **fora** da Entrada.

---

# AUDITORIA 4 — Localização da Conversão Física

## Fluxo esperado

```
Cadastro Produto → Entrada Compra → Conversão Física → Lote → MCC → Estoque Base
```

## Fluxo observado (UI)

```
Cadastro Produto
  → declara flag + unidade destino (+ UC comerciais)
Entrada Compra (#painelMccEntrada)
  → UC + qtd + peso (embalagem OU total)
  → preview fator/qtd base (front)
  → payload peso_* para backend (MCC-03)
Lote
  → UI de compra coleta validade se controlar_validade; fator físico não é editado na UI de lote
```

## Veredito localização

**Posicionamento principal está correto** (peso na Entrada).  
**Resíduo no Cadastro:** apenas flags (aceitável) + conceitos legados/mistura UC (desvio).

---

# AUDITORIA 5 — Unidades de Comercialização × Conversão Física

## Separação

| Seção | Separada? | Evidência |
|-------|-----------|-----------|
| UC-01 card | Sim, bloco próprio | `#secaoUnidadesComercializacaoUc01` |
| Conversão Física (flag) | Sim, bloco imediatamente **acima** das UCs | ~1912 vs ~1948 |
| MUC legado | Separado, **oculto** | `#secaoUnidadesComerciaisMuc` `display:none` ~1997 |

## Misturas / inconsistências

| Item | Problema |
|------|----------|
| Tipo UC `CONVERSAO_FISICA` | Nome de **conversão física** dentro do modelo de **UC comercial** (`UC01_TIPOS` ~4854) |
| Coluna/flag “Lote” na UC | Sugere conversão por lote no cadastro de UC |
| “Vendido por Peso” vs “Utiliza Conversão Física” | Dois switches de “peso” com significados diferentes |
| MUC oculto ainda com UI de **“Fator → base”** | `abrirModalEditarUnidadeMuc` / `#muc_fator` ~5243–5245 — código morto/legado, risco se reativado |
| Compra: MCC e legado “Motor de Conversão de Unidades” | Dois painéis (`#painelMccEntrada` vs `#painelConversaoEmbalagem`) |

---

# AUDITORIA 6 — Caso Sorvete Flocos

## Cenário

- Compra: 20 caixas = 100 litros (UC)  
- Balança: 67,500 Kg  

## A UI permite esse fluxo naturalmente?

**SIM**, via modo **Peso total**:

1. Produto com `utiliza_conversao_fisica` + UC “Caixa” (qtd comercial → L)  
2. Compra: `#painelMccEntrada`  
3. Unidade comercial = CX; quantidade = 20 (ou volume 100 no modo peso total)  
4. Modo `#modo_entrada_mcc_item` = `PESO_TOTAL`  
5. `#peso_total_mcc_item` = `67,500` (placeholder já documenta esse exemplo ~1824)  
6. `#volume_total_mcc_item` = `100` se necessário  
7. Operador **não** digita 0,675  

Validação obriga peso quando conversão física (~1252–1254).

## Exige cálculo do operador?

**Não** para o fator.  
Pode exigir escolha consciente do **modo** (peso por embalagem vs peso total) e, no modo total, informar volume se o default da UC não bastar — esforço operacional aceitável, não cálculo de fator.

---

# AUDITORIA 7 — Arquitetura × Implementação

| Documento / regra | UI | Divergência |
|-------------------|-----|-------------|
| Unidade Base única no produto | `#unidade` | **Nenhuma** |
| N UCs | UC-01 CRUD | **Nenhuma** (seção só após salvar produto — UX, não arquitetura) |
| Fator físico nunca no produto | Sem input de fator | **Nenhuma** |
| Conversão física no lote / entrada | Peso na compra | **Nenhuma** no caminho MCC |
| Flags no produto | `utiliza_conversao_fisica` + destino | **Nenhuma** |
| MCC única autoridade de conversão | Preview front em `calcularPreviewMccEntrada` | **Pequena** — cálculo espelhado na UI |
| Sem legado paralelo | “Vendido por Peso”, painel embalagem, MUC oculto | **Relevante** — coexistência legado |
| UC ≠ Conversão Física | Tipo UC `CONVERSAO_FISICA` + coluna Lote | **Relevante** — nomenclatura misturada |
| UC-01.1 canais/prioridade | Checkboxes canais no modal UC | **Aderente** |
| Mobile produtos | Só “vendido por peso” / peso médio | **Lacuna** — sem UC-01 / conversão física |

---

# AUDITORIA 8 — Proposta (sem implementar)

Como **deveria** ficar, seguindo a arquitetura homologada:

### Cadastro Produto
- Unidade Base (SSOT)  
- Flag “Utiliza Conversão Física” + unidade destino (KG) — **sem peso, sem fator**  
- Unidades de Comercialização (CX, Pote…): apenas descrição, código, quantidade **comercial→base**, canais  
- **Sem** tipo nomeado “Conversão Física” na UC  
- **Sem** “Vendido por Peso” se o mesmo for coberto por UC+MCC (ou renomear claramente como “PDV: venda fracionada”, separado)  
- **Sem** peso médio misturado visualmente com conversão física  

### Entrada Compra
- Selecionar UC + quantidade  
- Informar **peso medido** (total ou por embalagem)  
- Mostrar resultado em linguagem operacional (“estoque em L / custo por L”), idealmente **sem** forçar o termo “fator”  
- MCC (backend) calcula e grava no lote  

### Lote
- Resultado da conversão física versionada (MCC-02.1) — consulta/auditoria, não digitação de fator  

### Resumo
Operador pensa em **embalagem + balança**; nunca em **fator**.

---

# Evidências-chave (índice)

| Tema | Arquivo | Trecho |
|------|---------|--------|
| Flag conversão física produto | `frontend/erp/js/produtos.js` | ~1912–1943, save ~2906–2910 |
| UC-01 | `frontend/erp/js/produtos.js` | ~1948–1995, `abrirModalEditarUnidadeUc01` ~4992+ |
| MUC fator (oculto) | `frontend/erp/js/produtos.js` | ~1997–2031, `#muc_fator` ~5243 |
| Vendido por peso / peso médio | `frontend/erp/js/produtos.js` | ~1574–1611 |
| Painel MCC compra | `frontend/erp/js/compras.js` | `#painelMccEntrada` ~1795–1854 |
| Preview fator | `frontend/erp/js/compras.js` | `calcularPreviewMccEntrada` ~298–345 |
| Validação peso | `frontend/erp/js/compras.js` | `adicionarItemCompra` ~1245–1256 |
| Payload entrada | `frontend/erp/js/compras.js` | ~1284–1296 |

---

# Resultado Final

## Classificação

### 🟡 → 🟠 **Desvios relevantes (com caminho MCC aderente)**

Mais precisamente: **caminho oficial MCC/UC está majoritariamente aderente**, mas a **UX ainda carrega legado e mistura de conceitos** suficientes para classificar como **desvios relevantes (laranja claro)**, não como implementação incompatível.

## Justificativa técnica

**Pontos fortes**
- Fator físico **não** é cadastrado no produto.  
- Peso da balança é coletado na **Entrada de Compra**.  
- Modos “peso por embalagem” e “peso total” cobrem o caso Sorvete (67,500 Kg).  
- Mensagens orientam o operador a **não digitar** o fator.  
- UC-01 existe como seção distinta.

**Pontos fracos**
- Dupla linguagem de peso no cadastro (“Vendido por Peso” + Conversão Física).  
- Tipo/coluna de UC evocando Conversão Física / Lote.  
- Preview de fator no frontend e painel legado de embalagens.  
- MUC com campo fator ainda no código (oculto).  
- Mobile incompleto para UC/MCC.

**Não é 🔴** porque o fluxo homologado (flags no produto → peso na entrada → MCC) **está implementado e utilizável** sem exigir que o operador calcule o fator.

---

## Recomendações (somente orientação — fora do escopo desta auditoria)

1. Separar visualmente “PDV fracionado” de “Conversão Física MCC”.  
2. Remover ou renomear tipo UC `CONVERSAO_FISICA`.  
3. Suavizar texto “Fator calculado” na compra (linguagem operacional).  
4. Planejar desligamento do painel/MUC legado.  
5. Alinhar mobile ao ERP.

**Nenhuma correção foi aplicada nesta sprint de auditoria.**
