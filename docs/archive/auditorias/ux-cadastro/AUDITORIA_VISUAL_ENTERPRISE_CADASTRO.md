# AUDITORIA VISUAL ENTERPRISE — Cadastro de Produtos

**Código:** UX-PROD-03.2  
**Prioridade:** P0  
**Tipo:** Auditoria visual (SEM implementação)  
**Data:** 2026-07-17  
**Base:** estado pós UX-PROD-01 · 02 · 03 · 03.1  
**Fonte:** `frontend/erp/js/produtos.js` (`showProdutoModal`, `#produtoFormDominios`)  
**Shell:** modal `#produtoModal` · `modal-lg` · `modal-dialog-scrollable`

---

## IMPORTANTE

Nenhuma alteração de código, CSS, HTML, JS, API, banco ou motores foi realizada.  
Conclusões com evidência da UI atual.

---

# Resumo Executivo

Após as sprints UX-PROD-01→03.1, o Cadastro deixou de ser crescimento orgânico e passou a seguir **domínios numerados** com separação PDV × MCC, Resumo Inteligente e fases Implantação × Operação.

A tela **não é Enterprise Ready plena** (ainda há densidade, scroll e UC só após salvar), mas **já atende o objetivo arquitetural visual** de clareza por domínio. A prioridade de UX-PROD-04 deve ser **repensada**: abas clássicas não são o melhor próximo passo.

| Aspecto | Antes (auditoria forense) | Agora (03.2) |
|---------|---------------------------|--------------|
| Ordem | Orgânica / misturada | Domínios 1–9 oficiais |
| PDV × Física | Misturados | Cards + badges separados |
| Física no Fiscal | Dentro do card fiscal | Domínio 3 isolado |
| Implantação | Parcial | Banners Fase 1 / Fase 2 |
| Resumo | Inexistente | Topo somente leitura |
| Classificação UX | 🟠 | **🟡 Quase pronta** |

---

# Ordem visual atual (evidência)

| # | Domínio | Evidência |
|---|---------|-----------|
| 0 | Resumo Inteligente | `#resumoInteligenteProduto` |
| 1 | Identificação | `cabecalhoDominioProduto('…', '1 · Identificação')` |
| 2 | Unidade Base | card próprio + tooltip SSOT |
| 3 | Conversão Física (MCC) | badge MCC · `border-primary` |
| 4 | UC | `#secaoUnidadesComercializacaoUc01` / aviso novo produto |
| 5 | Comercial | preços + atacado |
| 6 | Venda no PDV | badge PDV · `border-success` |
| 7 | Estoque | banners fase + física inicial + validade |
| 8 | Fiscal | collapse `#dadosFiscaisSection` |
| 9 | Avançado | glossário + legado |

---

# Auditoria 1 — Fluxo mental do operador

**Pergunta:** O cadastro acompanha a sequência natural de trabalho?

**Sequência mental esperada:** Quem é → como estoqueia → precisa de física? → como vende/compra (UC) → quanto custa → como vende no caixa → estoque inicial → fiscal → raridades.

**Avaliação:** A ordem 1→9 **acompanha** esse fluxo. Melhora clara vs. auditoria forense (onde fracionado vinha cedo e física “dentro” do fiscal).

| Nota | 🟢 Excelente |
|------|--------------|

---

# Auditoria 2 — Identificação

Campos: código, nome, categoria, subcategoria, fornecedor, código de barras — em um card.

✔ Agrupamento coerente.  
⚠ Sem marca / descrição reduzida / imagem (não inventados de propósito).  
⚠ Fornecedor ainda texto livre (não vínculo forte) — aceitável visualmente.

| Nota | 🟡 Boa |
|------|--------|

---

# Auditoria 3 — Unidade Base

✔ Label **Unidade Base (Estoque)** + tooltip SSOT + `<small>` reforçando SSOT.  
✔ Card próprio (domínio 2), não escondida em preços/fiscal.  
⚠ Card com um único campo parece “vazio”; destaque é por label/tooltip, não por hero visual.

| Nota | 🟢 Excelente (clareza conceitual) / 🟡 (peso visual do card) |
|------|--------------------------------------------------------------|
| **Síntese** | 🟡 Boa |

---

# Auditoria 4 — Conversão Física

✔ Isolada do Fiscal (domínio 3, antes de UC).  
✔ Badge MCC + borda primary.  
✔ Copy: peso na Entrada / Estoque Inicial — **sem fator**.  
✔ Tooltip: “Não define venda no PDV”.  
⚠ Painel físico inicial ainda `disabled` (preparação 03.1) — operador pode achar “quebrado” se não ler o *em*.

| Nota | 🟢 Excelente |
|------|--------------|

---

# Auditoria 5 — Unidades de Comercialização

✔ Mensagem clara: estoque na Base; UC após salvar (novo).  
✔ Grade com Pri, Tipo, Qtd, canais, Padrão, Fís.  
🟠 Tabela com **~18 colunas** em `modal-lg` → scroll horizontal, densidade alta.  
🟠 Ícones 🛒 / abreviações Atac/Var/Com exigem tooltip/aprendizado.  
⚠ UC indisponível no create — produto nasce incompleto para operação imediata.

| Nota | 🟠 Precisa melhorar (densidade / create) |
|------|------------------------------------------|

---

# Auditoria 6 — Comercial

✔ Preço compra / margem / venda agrupados.  
✔ Atacado em subcard com switch.  
🟠 Painéis de “cálculo de custo por quantidade” ainda na UI (lógica comercial no front — risco de governança, não só visual).  
⚠ Fluxo fracionado ↔ custo unitário pode parecer “mágica” sem leitura do alerta.

| Nota | 🟡 Boa |
|------|--------|

---

# Auditoria 7 — PDV

✔ Card **Venda no PDV** com badge success, separado do MCC (domínio 6 vs 3).  
✔ Texto explícito: não interfere na Conversão Física.  
✔ Fracionada / peso médio / preço UN condicionais.  
🟡 Glossário que reforça a diferença está no **Avançado** (fim) — pouco visto na 1ª visita.

| Nota | 🟢 Excelente (separação) / 🟡 (descoberta do glossário) |
|------|----------------------------------------------------------|
| **Síntese** | 🟢 Excelente |

---

# Auditoria 8 — Estoque

✔ Estoque Inicial Fiscal / NF respeitando F12.  
✔ Banners **Fase 1 Implantação** / **Fase 2 Operação** (UX-PROD-03.1).  
✔ Conversão Física do Estoque Inicial quando física + estoque > 0.  
✔ Aviso Ajuste de Estoque na operação.  
⚠ `estoque_minimo` e validade fora do card “fase”, visualmente soltos.  
⚠ Persistência do peso inicial ainda futura.

| Nota | 🟢 Excelente (conceito) / 🟡 (agrupamento interno) |
|------|-----------------------------------------------------|
| **Síntese** | 🟡 Boa |

---

# Auditoria 9 — Fiscal

✔ Domínio 8 isolado.  
✔ Já usa **collapse** (`#dadosFiscaisSection`) — reduz poluição.  
✔ Código de barras saiu do Fiscal → Identificação.  
🟡 Conteúdo fiscal ainda longo quando expandido (NCM, alíquotas, etc.) — aceitável para o domínio.

| Nota | 🟢 Excelente |
|------|--------------|

---

# Auditoria 10 — Resumo Inteligente

✔ Útil: nome, Base, Física, UCs, status MCC, **fase**.  
✔ Somente leitura; atualiza com mudanças.  
🟡 Não mostra preço, estoque inicial nem “tem movimentações” além da fase.  
🟡 Em produto novo, UCs = “—” até salvar — correto, mas o resumo parece incompleto.  
⚠ Dois badges (fase + status) competem levemente.

| Nota | 🟡 Boa |
|------|--------|

---

# Auditoria 11 — Design System

✔ Cards por domínio; cabeçalhos padronizados (`cabecalhoDominioProduto`).  
✔ Badges MCC (primary) × PDV (success).  
✔ Ícones Font Awesome consistentes.  
✔ Tooltips nos pontos críticos (Base, Física, PDV).  
🟠 Espaçamento: muitos `mb-3` + cards aninhados → altura total alta.  
🟠 Modal `modal-lg` (não `xl`) com grade UC larga.  
🟡 Tipografia = Bootstrap padrão (não expressive) — OK para ERP, não “brand hero”.

| Nota | 🟡 Boa |
|------|--------|

---

# Auditoria 12 — Necessidade de Abas

## Opções

| Opção | Prós | Contras |
|-------|------|---------|
| **Abas clássicas** | Navegação por domínio sem scroll | Fragmenta contexto; estado entre abas; risco de “salvar sem ver Fiscal”; alto custo UX-04 |
| **Cards recolhíveis** | Mantém visão linear; reduz scroll; Fiscal já prova o padrão | Operador precisa expandir; defaults de open/closed críticos |
| **Tela atual** | Já coerente por domínio | Scroll longo; UC densa |

## Decisão técnica

**Cards recolhíveis atendem melhor** que abas neste momento.

Justificativa:

1. A ordem vertical **já** é o fluxo mental — abas quebram a narrativa sequencial.  
2. Fiscal **já** é collapse; Avançado/Comercial-atacado/Física-painel já têm padrões condicionais.  
3. Resumo no topo + sticky header + recolher 5–9 por default resolve 80% do scroll sem redesign de navegação.  
4. Abas clássicas são recomendáveis só se testes com operadores mostrarem perda de orientação **apesar** de cards recolhíveis.

**UX-PROD-04 proposto (revisão):**  
não “criar abas a qualquer custo”, e sim **navegação por domínio leve** = cards recolhíveis + âncoras/sticky resumo (+ opcional mini-nav). Abas ficam como plano B.

| Nota (decisão) | 🟢 Excelente (direção) |
|----------------|------------------------|

---

# Respostas obrigatórias

### 1. A tela atual já pode ser considerada Enterprise?

**NÃO** (ainda).

Motivo: densidade UC, scroll, UC só pós-save, glossário no fim, custo na UI. Conceitualmente alinhada ao CORE; operacionalmente **quase**.

### 2. Criar abas ainda é recomendado?

**NÃO** (como default da UX-PROD-04).

Justificativa: risco alto / ganho moderado; ordem vertical já correta; preferir densidade progressiva.

### 3. Cards recolhíveis seriam mais adequados?

**SIM**.

Justificativa: preservam fluxo 1–9, reduzem scroll, reutilizam padrão Fiscal, menor risco de regressão de save.

### 4. Existe algum problema crítico de UX?

**Nenhum 🔴 crítico.** Problemas 🟠:

1. Grade UC excessivamente larga (~18 colunas) em `modal-lg`  
2. UC indisponível no primeiro cadastro  
3. Scroll longo (9 domínios sempre abertos)  
4. Glossário no Avançado (baixa descoberta)  
5. Inputs de peso físico inicial disabled (pode parecer bug se copy for ignorada)

### 5. Classificação final

**🟡 Quase pronta**

(Evoluiu de 🟠 Refatoração recomendada na auditoria forense.)

---

# Matriz de notas

| # | Auditoria | Nota |
|---|-----------|------|
| 1 | Fluxo mental | 🟢 |
| 2 | Identificação | 🟡 |
| 3 | Unidade Base | 🟡 |
| 4 | Conversão Física | 🟢 |
| 5 | UC | 🟠 |
| 6 | Comercial | 🟡 |
| 7 | PDV | 🟢 |
| 8 | Estoque | 🟡 |
| 9 | Fiscal | 🟢 |
| 10 | Resumo | 🟡 |
| 11 | Design System | 🟡 |
| 12 | Abas × Cards | 🟢 (decisão) |

---

# Entregáveis correlatos

- `RELATORIO_DECISAO_UX04.md`  
- Atualizações em `ROADMAP_REORGANIZACAO_CADASTRO.md` · `CHECKLIST_REORGANIZACAO_CADASTRO.md`
