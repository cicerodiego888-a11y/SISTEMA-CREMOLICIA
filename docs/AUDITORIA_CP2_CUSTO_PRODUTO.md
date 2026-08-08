# AUDITORIA CP-2 — Responsabilidade do Bloco "Compras" no Cadastro de Produto

| Campo | Valor |
|---|---|
| Tipo | Auditoria de domínio (sem implementação) |
| Data | 2026-08-06 |
| Escopo | Bloco **5 · Compras** do cadastro de produto vs Compras / NF-e / Central Inteligente |
| Restrição | Não altera código, banco, UI |

---

## Sumário executivo

O bloco **5 · Compras** no cadastro de produto mistura dois mundos:

1. **Snapshot permanente do Produto** — Último Custo (`preco_compra`), Fornecedor Preferencial (texto), e (idealmente) Custo Médio.  
2. **Calculadora de entrada** — Valor Total Pago, Quantidade Comprada, “Cada Unidade Custou”, botão Recalcular.

Essa calculadora **já existe** (de forma mais completa) em Compras + MCC + rateio de frete/desconto. No cadastro, ela é apoio UX / implantação — e, para produtos fracionados, ainda grava campos auxiliares (`valor_total_compra`, `peso_total_compra`, `custo_por_kg`).

**Custo Médio** na UI é **stub**: não há coluna `custo_medio` nem motor que a calcule; o campo espelha o Último Custo ou mostra "—".

**Parecer recomendado: B** — manter no Produto apenas snapshot (Último Custo, Custo Médio como consulta, Fornecedor Preferencial); mover a calculadora Valor÷Quantidade para o domínio de Compra/Entrada.

---

## 1. Responsabilidade de cada campo

### Valor Total Pago

| | |
|---|---|
| **Pertence a** | **Compra / NF-e** (evento de entrada). No cadastro é apenas **apoio de cálculo**. |
| **Justificativa** | Representa o valor de **uma** aquisição (ou referência de implantação), não um atributo estável do produto. Em Compras esse valor vem do XML/item + rateio. Persistência no produto só ocorre em fluxo **fracionado** (`valor_total_compra`) como auxiliar de conversão — não como SSOT comercial. |

### Quantidade Comprada (Quantidade Total)

| | |
|---|---|
| **Pertence a** | **Compra / NF-e** (evento de entrada). No cadastro é **apoio**. |
| **Justificativa** | Quantidade é do documento/movimentação. No cadastro alimenta `total ÷ qtd → custo unitário` e, se fracionado, pode gravar `peso_total_compra`. Estoque inicial pode sugerir a quantidade, o que reforça o caráter de “evento”, não de cadastro permanente. |

### Cada Unidade Custou / Custo Unitário Calculado

| | |
|---|---|
| **Pertence a** | **Derivado da Compra** (ou da calculadora de apoio). Resultado deve alimentar o **Último Custo** do Produto. |
| **Justificativa** | Não é campo independente: é `Valor Total ÷ Quantidade`. No MCC/Compras o equivalente é `custo_unitario_final` / `precoCompra`. No modal só aparece como display e, ao Recalcular, escreve `#preco_compra`. |

### Último Custo

| | |
|---|---|
| **Pertence a** | **Produto** (snapshot) — atualizado preferencialmente pela **Compra**. |
| **Justificativa** | Coluna real `produtos.preco_compra`. Usado em formação de margem no cadastro, listagens, relatórios e histórico de preço. Compras faz `UPDATE produtos SET preco_compra = ?` na entrada. É o “custo vigente” do produto, não o total da NF. |

### Custo Médio

| | |
|---|---|
| **Pertence a** | **Produto** (indicador derivado) — **calculado pelo processo de Compra/estoque**, consultado no cadastro. |
| **Justificativa** | Conceitualmente é atributo do produto ao longo do tempo (média ponderada das entradas). **Hoje não está implementado** (sem coluna, sem writer); a UI é espelho/fallback do Último Custo. Responsabilidade correta: Motor de Custos na entrada; cadastro só lê. |

### Fornecedor Preferencial

| | |
|---|---|
| **Pertence a** | **Produto** (preferência cadastral). Relação operacional com fornecedor também existe em **Compra/NF-e**. |
| **Justificativa** | Campo texto `produtos.fornecedor` (não há `fornecedor_id` no produto). Serve como default/preferência. Compras pode atualizar via `COALESCE(?, fornecedor)`. A entidade rica permanece em `fornecedores` + documento de compra. |

### Botão Recalcular Custo

| | |
|---|---|
| **O cálculo deveria acontecer** | Primariamente na **Compra / importação XML / Central → Compras**. No cadastro só como **apoio de implantação** (produto novo sem NF). |
| **Justificativa** | A fórmula trivial total÷qtd já roda em `compras.js`, rateio backend e MCC. No cadastro o botão só evita limpar `preco_compra` com campos incompletos (CP-E1) e dispara sincronização de margem/Preço de Segurança. Duplica responsabilidade do módulo de Compras. |

---

## 2. Funcionalidades que dependem desses campos no cadastro

### Dependem do Último Custo (`preco_compra`) no Produto

| Dependência | Onde |
|---|---|
| Formação de lucro estimado / sync com Preço de Segurança | `produtos.js` (`sincronizarFormacaoPrecoProduto`) |
| Validação de save (`preco_compra >= 0`) | `produtos.js` |
| Listagem / valor de estoque (qtd × custo) | `produtos.js` |
| Persistência CRUD produto | `backend/rotas/produtos.js` |
| Atualização pós-entrada | `backend/rotas/compras.js` |
| Histórico `produtos_preco_historico` | `produtos.js` / `compras.js` |
| Normalização custo unitário fracionado (GET) | `produtos.js` backend + `motorConversaoUnidades` |

### Dependem da calculadora (Valor Total / Qtd / Recalcular) **somente no modal**

| Dependência | Severidade se remover do cadastro |
|---|---|
| UX de calcular custo sem digitar unitário | Baixa (ainda digita Último Custo) |
| Validação “par incompleto” no save | Removível |
| Persistência fracionada `valor_total_compra` / `peso_total_compra` / `custo_por_kg` via cadastro | Média — GET fracionado usa esses campos |
| Sync quantidade ↔ estoque inicial | Baixa/UX |
| Compras / MCC / Central | **Não dependem** desses IDs do modal |

### Custo Médio / Última Compra (readonly)

Nenhuma funcionalidade real depende: são **stubs de UI**. Relatório de produtos calcula `ultima_compra_data` por subquery, mas o GET do modal não popula “Última Compra”.

### Mobile

Já **não** possui o painel Valor÷Quantidade; envia só `preco_compra` / `fornecedor`.

---

## 3. Quando uma NF-e é importada — quem deveria calcular

### Fluxo atual (evidência)

```text
Central Inteligente de Entradas
    ↓  (upload / revisão / payload-compra)
Compras (tela / itens)
    ↓  rateio frete/desconto (backend)
MCC EntradaMercadoriasOperacionalService._resolverPrecos
    ↓  precoCompra, precoVenda opcional (margem)
UPDATE produtos.preco_compra (+ preco_venda/lucro se flag)
    ↓
produtos_preco_historico
```

A Central **não** calcula custo. O parse XML direto em Compras foi descontinuado; o caminho oficial é Central → Compras.

### Fluxo ideal

```text
NF-e / XML
    ↓
Central Inteligente (documento, vínculo, revisão)
    ↓
Compra / Entrada de Mercadorias (itens, qtd, valor, rateio)
    ↓
Motor de Custos (custo unitário final, último custo, custo médio ponderado)
    ↓
Atualiza Produto (snapshot: último custo, custo médio, fornecedor)
    ↓
Histórico de custos / preços
    ↓
Cadastro do Produto apenas CONSULTA (e permite override manual controlado)
```

| Grandeza | Quem calcula (ideal) |
|---|---|
| Último Custo | Motor de Custos na **entrada** → grava no Produto |
| Custo Médio | Motor de Custos (média ponderada das entradas) → grava/consulta no Produto |
| Margem | Definida na **Compra** (ou política comercial) no momento da entrada |
| Preço sugerido | Compra/MCC: `custo × (1 + margem/100)`; **não** confundir com Preço Oficial (Tabela) nem com Preço de Segurança |

---

## 4. Duplicidade de responsabilidade

| Responsabilidade | Cadastro Produto | Compras | Central Inteligente | Importação XML |
|---|---|---|---|---|
| Valor total da aquisição | Calculadora UI | Itens + totais | Documento | Origem do valor |
| Quantidade comprada | Calculadora UI | Itens / MCC estoque | Itens do XML | Origem da qtd |
| Custo unitário | Recalcular → Último Custo | Rateio + MCC | — | — |
| Último Custo no produto | Edita e salva | **UPDATE** na entrada | — | via Compras |
| Margem → preço venda | Sync Lucro/Preço Segurança | Margem por item + flag | — | via Compras |
| Fornecedor | Texto preferencial | Fornecedor da NF + UPDATE | Emitente | Origem |
| Custo Médio | Stub UI | **Deveria** calcular | — | — |

**Duplicações claras**

1. `total ÷ quantidade` — cadastro, compras (embalagem), MCC.  
2. `venda = custo × (1 + margem%)` — cadastro e compras.  
3. “Último Custo / Custo Médio” repetidos no bloco Compras e no Histórico do mesmo modal (stubs).  
4. Fornecedor como texto livre no produto vs entidade `fornecedores` vs emitente da NF.

---

## 5. Fluxo recomendado (domínio)

```text
Compra / NF-e
    ↓
XML → Central Inteligente (documento)
    ↓
Abre / conclui Compra
    ↓
Motor de Custos (+ rateio + MCC)
    ↓
Atualiza Produto
    • Último Custo
    • Custo Médio (quando implementado)
    • Fornecedor Preferencial (opcional)
    • Preço de Segurança / venda (só se política/flag da entrada)
    ↓
Histórico
    ↓
Cadastro do Produto: consulta + override manual (implantação)
```

O cadastro **não** deve ser o lugar onde se “simula uma compra” de forma rotineira.

---

## 6. Se o usuário NÃO utiliza o módulo de Compras

Deve informar o custo **diretamente no Último Custo** do cadastro do produto (digitação manual).

Opcionalmente, manter uma **calculadora leve** (Valor ÷ Quantidade) só como atalho de implantação — desde que claramente rotulada como “apoio”, não como documento de compra.

Não deve ser obrigatório passar por Central/XML para cadastrar um produto novo com custo inicial.

---

## 7. O cadastro deve permitir editar manualmente o Último Custo?

### **Sim**

**Justificativa**

- Implantação / produtos sem NF histórica.  
- Ajustes pontuais (erro de entrada, custo promocional, inventário).  
- Já é o comportamento atual e alimenta margem no próprio cadastro.

**Ressalvas**

- Override manual deve ser consciente: a próxima compra com flag de atualização **sobrescreve** `preco_compra`.  
- Ideal: registrar em histórico quando o custo muda pelo cadastro (já há caminho parcial via `produtos_preco_historico` no update de produtos).  
- Não deve ser confundido com Preço Oficial de venda (Tabela) nem com Preço de Segurança (embora hoje a formação de margem ainda amarre os dois no cadastro).

---

## 8. Se este bloco for removido — o que quebra?

### A) Remover só a calculadora (Valor Total, Quantidade, fórmula, Recalcular)

| O que quebra / muda | Impacto |
|---|---|
| Operador perde atalho total÷qtd no cadastro | UX — ainda digita Último Custo |
| Validação do “par incompleto” | Some (positivo) |
| Gravação via cadastro de `valor_total_compra` / `peso_total_compra` / `custo_por_kg` (fracionado) | Médio — revisar normalização GET fracionado |
| Compras / Central / MCC | **Não quebram** |
| Mobile | Já sem painel |

### B) Remover o bloco Compras inteiro (inclui Último Custo e Fornecedor)

| O que quebra | Impacto |
|---|---|
| Campo `#preco_compra` e formação de Lucro Estimado / sync Preço de Segurança | **Alto** |
| Save sem `preco_compra` / `fornecedor` | Payload e validações |
| Cadastro manual de custo sem módulo Compras | **Alto** (sem alternativa) |
| Listagens que exibem custo | Continuam lendo DB, mas edição some |
| Entrada por compra ainda atualiza `preco_compra` | Operação OK se só usa Compras |
| Stubs Custo Médio / Última Compra | Sem perda real |

---

## 9. Riscos

| Risco | Descrição |
|---|---|
| Duplicidade cognitiva | Usuário acha que “Valor Total Pago” no cadastro é uma compra registrada |
| Custo Médio falso | UI sugere média real, mas é espelho do último custo |
| Fracionado acoplado à calculadora | Remover painel sem migrar `valor_total_compra`/`peso_total_compra` pode degradar custo unitário em produtos pesados |
| Fornecedor texto vs entidade | Preferencial frágil (sem FK); autocomplete grava texto com CNPJ |
| Confusão com precificação RA-6 | Último Custo ≠ Preço Oficial (Tabela) ≠ Preço de Segurança |

---

## 10. Recomendação final

### **B**

Manter no cadastro do Produto somente:

- **Último Custo** (editável; SSOT de atualização = Compra quando houver entrada)  
- **Custo Médio** (somente leitura — implementar de verdade no Motor de Custos; até lá, não fingir precisão ou explicitar “não calculado”)  
- **Fornecedor Preferencial**

Mover para o domínio de **Compras / Entrada / Central**:

- Valor Total Pago  
- Quantidade Comprada  
- Cada Unidade Custou  
- Botão Recalcular Custo  

### Justificativa técnica

1. Alinha o cadastro ao papel de **master data + snapshot**, e a Compra ao papel de **evento que atualiza custo**.  
2. Elimina duplicação da calculadora que já existe em Compras/MCC/rateio.  
3. Preserva implantação sem módulo de Compras (Último Custo manual).  
4. Não exige drop de coluna agora; é mudança de **fronteira de domínio** (próximas sprints CP).  
5. Alternativa A mantém a confusão; C remove a única forma de informar custo sem Compras.

### Fora de escopo desta auditoria (próximos passos possíveis)

- Implementar Custo Médio real.  
- Ligar Fornecedor Preferencial a `fornecedores.id`.  
- Desacoplar formação de Preço de Segurança da calculadora de compra no cadastro.  
- Tratar campos fracionados (`valor_total_compra` / `peso_total_compra`) no domínio Unidades/Conversão, não em “Compras”.

---

## Evidências principais (código)

| Área | Arquivo |
|---|---|
| UI bloco 5 · Compras | `frontend/erp/js/produtos.js` (~2281–2341, calc ~244–417) |
| Save / fracionado | `frontend/erp/js/produtos.js` (~3513–3521) |
| UPDATE custo na entrada | `backend/rotas/compras.js` (~657–684) |
| Resolução preços MCC | `EntradaMercadoriasOperacionalService._resolverPrecos` |
| Schema `preco_compra` / `fornecedor` | `backend/database.js` |
| Custo Médio | Apenas UI — **sem** coluna/writers |
| CP-E1 (contexto) | `docs/CP_E1_CADASTRO_PRODUTOS.md` |

---

## Conclusão

Há **suspeita confirmada**: parte do bloco está no módulo errado.

- **Evento de compra** (total, quantidade, recalcular) → Compra/NF-e/Central.  
- **Snapshot do produto** (último custo, custo médio, fornecedor preferencial) → Cadastro.  

**Recomendação: B.** Sem implementação nesta auditoria.
