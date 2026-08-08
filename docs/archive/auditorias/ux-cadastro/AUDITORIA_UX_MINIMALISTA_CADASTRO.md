# AUDITORIA ENTERPRISE — UX MINIMALISTA DO CADASTRO DE PRODUTOS

**Código:** AUDITORIA_UX_MINIMALISTA_CADASTRO  
**Data:** 2026-07-18  
**Tipo:** Auditoria de UX (SEM IMPLEMENTAÇÃO)  
**Fonte:** `frontend/erp/js/produtos.js` (`showProdutoModal` / `montarHtmlCamposEstoqueProduto`)  
**Premissa:** Arquitetura CORE permanece. Simplificação só na camada de UX.

---

## IMPORTANTE

Esta auditoria **não** altera código, banco, MCC, UC, Estoque, Comercial, Fiscal nem MFE.  
Perfil avaliado: atendente, operador de estoque, dono de pequeno comércio, equipe Cremolícia — **não** arquiteto/dev.

---

## Veredito global

| Pergunta | Resposta |
|----------|----------|
| A tela hoje está… | **Complexa** (borda **Muito complexa** no 1º cadastro) |
| Arquitetura | Correta e consistente |
| Problema | Densidade + jargão + cards sempre visíveis |
| Direção | Progressive disclosure: 4–6 campos no caminho feliz; resto sob demanda |

O operador não precisa “entender MCC”. Precisa cadastrar “Açaí 2L” e vender.

---

# 1. Avaliação por domínio

## 1.1 Resumo Inteligente

| Critério | Avaliação |
|----------|-----------|
| Está ajudando? | **Parcial.** Útil em edição; no produto novo repete o óbvio. |
| Pode simplificar? | **Sim.** Uma linha: nome + fase + “pronto para vender?” |
| Informação repetida? | **Sim.** Fase também no banner de Estoque; Base/Física/UC repetem cards abaixo. |
| Classificação | 🟡 Simplificar |

**Sugestão UX:** chip único (`Implantação` / `Operação`) + nome. Remover status “Produto preparado para MCC” (jargão). Contadores Base/Física/UC só em edição avançada ou tooltip.

---

## 1.2 Identificação

| Campo | Local | Quem usa | Classificação | Justificativa | Impacto |
|-------|-------|----------|---------------|---------------|---------|
| Nome / Descrição * | Identificação | 100% | 🟢 Manter | Essencial | — |
| Código | Identificação | 20% | 🔵 Quando necessário | Pode ser automático (sequência); mostrar se editar | Médio |
| Código de barras | Identificação | 80% | 🟢 Manter | PDV/caixa | — |
| Categoria | Identificação | 80% | 🟢 Manter | Organização e filtros | — |
| Subcategoria | Identificação | 20% | 🔵 Quando necessário | Só após escolher categoria; muitas lojas não usam | Baixo |
| Fornecedor | Identificação | 20% | 🟠 Agrupar | Melhor em Compra / aba secundária “Fornecimento” | Médio |

**Há campos desnecessários no 1º cadastro?** Código (se auto), Subcategoria, Fornecedor.  
**Pode reduzir?** Sim → Nome + Categoria + Barras no caminho feliz.

---

## 1.3 Unidade Base

| Campo | Local | Quem usa | Classificação | Justificativa | Impacto |
|-------|-------|----------|---------------|---------------|---------|
| Unidade Base (Estoque) | Bloco 2 | 100% (escolha) / 20% (entendimento SSOT) | 🟡 Simplificar | Conceito certo; copy “SSOT” é de dev. Label: “Unidade do estoque” | Alto |

**Está clara?** Para quem já leu o glossário, sim. Para o operador: meio.  
**O operador entende?** Entende “UN / KG / L”. Não precisa da palavra SSOT.  
**Sugestão:** default `UN`; texto: “É assim que o estoque conta (caixas, litros, kg…). Formas de vender ficam depois.”

---

## 1.4 Conversão Física (MCC)

| Campo | Local | Quem usa | Classificação | Justificativa | Impacto |
|-------|-------|----------|---------------|---------------|---------|
| Card inteiro MCC | Bloco 3 | 20% produtos | 🔵 Quando necessário | Maioria Cremolícia = UN/L sem lote físico | Alto |
| Switch “Utiliza Conversão Física” | MCC | 20% | 🟡 Simplificar | Renomear UX: “Produto pesado na entrada” | Alto |
| Unidade Base (readonly) | MCC | Nunca (UI) | 🔴 Remover | Duplicata do bloco 2 | Baixo |
| Unidade Física | MCC | 20% | 🔵 Quando switch ON | OK progressivo | Médio |
| Badge “MCC” | Header | Desenvolvedor | 🔴 Remover (da UI operador) | Jargão interno | Baixo |
| Texto “peso na Entrada” | MCC | 80% (quando usa) | 🟢 Manter | Única mensagem útil do card | — |
| Peso físico inicial (disabled) | Estoque | Nunca (hoje) | 🔴 Remover até existir | UI morta gera confusão | Médio |

### Perguntas específicas

| Pergunta | Resposta |
|----------|----------|
| O operador entende “Conversão Física”? | **Não.** Soa técnico. |
| O termo deveria existir na UI? | **Não** para operador. Manter no CORE/docs. |
| “Peso de Referência” seria melhor? | **Não.** Confunde com peso médio do PDV. Preferir: **“Pesado na entrada / na balança”**. |
| O card poderia ser menor? | **Sim.** Só um switch + (se ON) select Unidade Física. Sem header duplicado, sem badge MCC, sem readonly Base. |

---

## 1.5 Unidades de Comercialização (UC-01)

| Elemento | Local | Quem usa | Classificação | Justificativa | Impacto |
|----------|-------|----------|---------------|---------------|---------|
| Seção UC | Bloco 4 | 80% após 1º save | 🟡 Simplificar | Essencial, mas toolbar densa | Alto |
| Aviso “salve primeiro” | Novo produto | 100% | 🟢 Manter | Correto | — |
| Botão Adicionar | UC | 80% | 🟢 Manter | | |
| Busca + 6 filtros | UC toolbar | 20% | 🔵 Quando necessário | Só se ≥ 3 UCs | Médio |
| Cards UC | Grade | 80% | 🟢 Manter | Melhores que tabela para ≤5 UCs | — |
| Detalhe interno do card (tipo, flags, fator…) | Card UC | 20–80% | 🟡 Simplificar | Mostrar nome + unidade + “Compra/Venda”; resto no editar | Médio |

**Quantidade de info adequada?** No produto com 1–2 UCs, **excesso de chrome** (filtros/emojis).  
**Cards vs tabela?** Cards continuam melhores para o perfil Cremolícia. Tabela só se N grande.

**Inferência desejável (UX):** ao salvar produto novo com Base UN e preço de venda, criar UC padrão “UN · Venda · PDV” automaticamente — operador só adiciona CX/PCT depois.

---

## 1.6 Comercial

| Campo | Local | Quem usa | Classificação | Justificativa | Impacto |
|-------|-------|----------|---------------|---------------|---------|
| Preço de Venda * | Comercial | 100% | 🟢 Manter | | |
| Preço de Compra | Comercial | 80% | 🟢 Manter | | |
| % Lucro / Margem | Comercial | 20% | 🟡 Simplificar | Calculável; um dos dois (compra↔venda) basta no caminho feliz | Médio |
| Painel valor total / qtd / custo unitário | Comercial (fracionado) | 20% | 🔵 Quando fracionado | OK escondido hoje; manter progressivo | Médio |
| Preço Atacado + faixas | Comercial | 20% | 🔵 Quando switch ON | Já progressivo — bom padrão | Baixo |

**Excesso?** Margem + compra + venda juntos = 3 campos para 1 decisão.  
**Preço pode ser calculado?** Sim: venda = compra × (1+m%) **ou** m% derivado. Mostrar um campo “principal” e o outro como derivado.  
**Margem precisa aparecer?** Não no 1º cadastro; opcional “Calcular margem”.

---

## 1.7 Venda no PDV (auditoria completa)

| Campo | Local | Quem usa | Classificação | Justificativa | Impacto |
|-------|-------|----------|---------------|---------------|---------|
| Card “Venda no PDV” | Bloco 6 | 20% (fracionados) | 🟠 Agrupar / 🔵 | Duplica mentalmente UC; deveria ser pergunta curta ou sumir se UC cobrir | Alto |
| Permite Venda Fracionada | PDV | 20% | 🔵 Quando necessário | Produtos à balança | Alto |
| Permitir também venda por unidade | PDV | 20% | 🟡 Simplificar → 🔴 futuro | Frequentemente = UC UN + UC KG; candidato a inferência | Alto |
| Peso médio da unidade | PDV | 20% | 🔵 Se fracionado + venda UN | | Médio |
| Preço por unidade | PDV | 20% | 🔵 Idem | Pode vir da UC | Médio |
| Badge PDV + texto anti-MCC | Header | Desenvolvedor | 🟡 Simplificar | Texto defensivo é cheiro de UX confusa | Baixo |

### Respostas obrigatórias PDV

| Pergunta | Resposta |
|----------|----------|
| Este card precisa existir? | **Hoje sim** (PDV ainda lê flags do produto). **No destino UX:** não como card permanente — PDV deveria consumir UCs (+ regra de balança). |
| PDV pode consumir UCs automaticamente? | **Sim, é o alvo.** Enquanto o legado `produto_fracionado` existir, manter bridge; não expandir o card. |
| Switch “Permitir também venda por unidade” é necessário? | **Para o operador, raramente.** Se existir UC UN ativa para PDV, inferir `permite_venda_unidade=1`. |
| Pode desaparecer? | **Da UI principal, sim** (manter persistência via inferência/legado). |
| Pode ser inferido? | **Sim.** |
| Duplicação com UC? | **Sim — a principal fonte de complexidade mental da tela.** |

---

## 1.8 Estoque

| Campo | Local | Quem usa | Classificação | Justificativa | Impacto |
|-------|-------|----------|---------------|---------------|---------|
| Banner Fase Implantação/Operação | Estoque | 80% | 🟡 Simplificar | Duplica Resumo; uma fonte de verdade | Médio |
| Estoque Fiscal Inicial | Estoque | 80% 1º cadastro | 🟢 Manter (só implantação) | | |
| Estoque Não Fiscal Inicial | Estoque | 20% | 🔵 Modo avançado / fiscal off | Muitos operadores querem “Estoque inicial” único | Alto |
| Estoque Total (preview) | Estoque | 80% | 🟢 Manter | | |
| Estoque Mínimo | Estoque | 80% | 🟢 Manter | Pode default 0 colapsado | Baixo |
| Controlar validade | Estoque | 20–80% | 🔵 Switch | Já progressivo — bom | — |
| Data validade / alerta dias | Estoque | 20% | 🔵 Se controlar validade | | |
| Bloco peso físico inicial disabled | Estoque | Nunca | 🔴 Remover até sprint | | Alto |

**Implantação clara?** Conceito sim; execução poluída (banner + resumo + campos disabled).  
**Repetição?** Fase ×2; “estoque” em vários labels.

**Sugestão caminho feliz:** um campo **“Quantidade inicial”** (mapear para fiscal; não-fiscal 0). Detalhe fiscal/não-fiscal em “Mais opções de estoque”.

---

## 1.9 Fiscal

| Elemento | Quem usa | Classificação | Nota |
|----------|----------|---------------|------|
| Collapse Dados Fiscais | 20% / contador | 🟢 Manter | Já escondido o suficiente |
| NCM, CFOP, CSOSN, Origem, CEST, alíquotas | 20% | 🔵 Dentro do collapse | OK |

**Está escondido o suficiente?** **Sim.** Não abrir por default. Defaults por categoria = ganho futuro.

---

## 1.10 Avançado

| Elemento | Quem usa | Classificação | Justificativa | Impacto |
|----------|----------|---------------|---------------|---------|
| Card Avançado inteiro | Desenvolvedor / 20% | 🔴 Remover da tela principal | Não agrega ao operador | Alto |
| Previews valor total compra/venda | 20% | 🟠 Agrupar | Se útil, 1 linha sob Comercial | Médio |
| Glossário Base/UC/Física/PDV | Desenvolvedor | 🔴 Remover | Treinamento ≠ formulário | Alto |

**Há campos que deveriam sair dali?** **Todos.** Glossário → help/docs. Previews → Comercial opcional ou sumir.

---

# 2. Inventário campo a campo (consolidado)

Legenda: 🟢 Manter · 🟡 Simplificar · 🟠 Agrupar · 🔵 Sob demanda · 🔴 Remover (da UX; não do CORE)

| Campo | Local | Uso | Class. | Impacto |
|-------|-------|-----|--------|---------|
| Resumo (bloco) | Topo | 80% | 🟡 | Médio |
| Nome | Identificação | 100% | 🟢 | — |
| Código | Identificação | 20% | 🔵 | Médio |
| Categoria | Identificação | 80% | 🟢 | — |
| Subcategoria | Identificação | 20% | 🔵 | Baixo |
| Fornecedor | Identificação | 20% | 🟠 | Médio |
| Código barras | Identificação | 80% | 🟢 | — |
| Unidade Base | Base | 100% | 🟡 | Alto |
| Switch Física | MCC | 20% | 🟡+🔵 | Alto |
| Base readonly MCC | MCC | Nunca | 🔴 | Baixo |
| Unidade Física | MCC | 20% | 🔵 | Médio |
| Badge/jargão MCC | MCC | Dev | 🔴 | Baixo |
| UC seção | UC | 80% pós-save | 🟡 | Alto |
| Toolbar filtros UC | UC | 20% | 🔵 | Médio |
| Cards UC | UC | 80% | 🟢 | — |
| Preço venda | Comercial | 100% | 🟢 | — |
| Preço compra | Comercial | 80% | 🟢 | — |
| % Lucro | Comercial | 20% | 🟡 | Médio |
| Custo por total | Comercial | 20% | 🔵 | Médio |
| Atacado | Comercial | 20% | 🔵 | Baixo |
| Card PDV | PDV | 20% | 🟠 | Alto |
| Fracionado | PDV | 20% | 🔵 | Alto |
| Venda por UN switch | PDV | 20% | 🟡→inferir | Alto |
| Peso médio / preço UN | PDV | 20% | 🔵 | Médio |
| Banner fase | Estoque | 80% | 🟡 | Médio |
| Saldos inicial F/NF | Estoque | 80/20 | 🟡 | Alto |
| Estoque mínimo | Estoque | 80% | 🟢 | Baixo |
| Validade | Estoque | 20–80% | 🔵 | — |
| Peso físico inicial UI | Estoque | Nunca | 🔴 | Alto |
| Fiscal collapse | Fiscal | 20% | 🟢 | — |
| Previews Avançado | Avançado | 20% | 🟠 | Médio |
| Glossário | Avançado | Dev | 🔴 | Alto |

---

# 3. Perguntas obrigatórias

## 3.1 Se você fosse dono de sorveteria no 1º cadastro, o que preencheria?

Exatamente:

1. **Nome** (ex.: Picolé Chocolate)  
2. **Unidade do estoque** (UN — default)  
3. **Preço de venda**  
4. **Preço de compra** (opcional, mas desejável)  
5. **Código de barras** (se houver)  
6. **Quantidade inicial** (se já tem no freezer)  

Opcional no mesmo dia: Categoria.  
**Nada mais** no primeiro minuto.

---

## 3.2 O que removeria imediatamente? (da UX)

1. **Glossário** — não é formulário.  
2. **Card Avançado** (previews + glossário).  
3. **Unidade Base readonly** dentro do MCC.  
4. **Badges MCC/PDV** e frases “não interfere na Conversão Física”.  
5. **Bloco peso físico inicial disabled**.  
6. **Filtros UC** no produto com 0–2 unidades.  
7. **Banner de fase** se o Resumo já mostra a fase (manter um só).  

Justificativa: zero valor operacional no caminho feliz; aumentam medo e scroll.

---

## 3.3 O que aparece só quando necessário?

| Elemento | Condição |
|----------|----------|
| Código (se auto) | Clique “Editar código” |
| Subcategoria | Categoria selecionada |
| Fornecedor | “Mais opções” ou fluxo de Compra |
| Painel Unidade Física | Switch “Pesado na entrada” ON |
| Seção UC completa | Após 1º save (já) |
| Filtros/busca UC | ≥ 3 UCs |
| % Lucro | Toggle “Usar margem” |
| Painel custo por total | Produto fracionado / balança |
| Atacado | Switch atacado ON (já) |
| Fracionado + peso médio + preço UN | “Vende na balança” ON |
| Permitir venda por UN | Inferir; ou só se fracionado e sem UC UN |
| Não fiscal / detalhe fiscal | “Detalhar estoque fiscal” |
| Validade | Switch controlar validade (já) |
| Fiscal NCM… | Expandir Dados Fiscais (já) |
| Peso físico inicial | Só quando Física ON **e** persistência existir |

---

## 3.4 Algum card inteiro pode desaparecer?

| Card | Pode sumir? | Por quê |
|------|-------------|---------|
| **9 · Avançado** | **Sim** | Só preview + glossário |
| **6 · Venda no PDV** | **Como card permanente, sim** | Substituir por 1 pergunta sob demanda; PDV ← UC no médio prazo |
| **3 · Conversão Física** | **Como card permanente, sim** | Virar switch opcional sob Unidade Base ou “Opções de entrada” |
| **0 · Resumo** | Reduzir, não sumir | Chip de fase basta |
| Identificação / Base / Comercial / Estoque / UC / Fiscal | Não | Núcleo operacional |

---

## 3.5 O que o sistema pode inferir automaticamente?

1. **Código** sequencial (se vazio).  
2. **Unidade Base = UN** no novo produto.  
3. **UC padrão** UN · Venda · PDV após 1º save (se nenhuma UC).  
4. **`permite_venda_unidade`** se existir UC UN ativa para PDV.  
5. **`produto_fracionado`** se Unidade Base ∈ {kg,g} **ou** UC de venda por peso/balança (regra a definir com PDV).  
6. **Margem %** a partir de compra + venda (somente leitura).  
7. **Preço UN** a partir da UC correspondente.  
8. **dias_alerta_validade = 30** (já).  
9. **saldo_nao_fiscal_inicial = 0** se UI mostrar só “quantidade inicial”.  
10. **Defaults fiscais** por categoria/NCM mais usado (futuro).  
11. **Unidade Física = KG** quando “Pesado na entrada” e Base = UN (default comum Cremolícia).  

---

# 4. Resultado esperado (listas)

## 4.1 REMOVER (da UX do operador)

- Glossário no formulário  
- Card Avançado completo  
- Badge/jargão “MCC” na UI  
- Campo readonly Unidade Base no card Física  
- Bloco peso físico inicial enquanto `disabled`  
- Status “preparado para MCC” no Resumo  
- Emojis nos filtros UC (ruído)  
- Texto defensivo longo PDV×MCC (sintoma; a cura é sumir a duplicação)

## 4.2 AUTOMÁTICO

- Código (opcional)  
- Default Unidade Base UN  
- UC padrão pós-save  
- Margem calculada  
- Inferência venda-por-UN a partir de UC  
- Defaults alerta validade / não-fiscal 0  
- Default Unidade Física KG quando aplicável  

## 4.3 ESCONDIDO (sempre collapse / “Mais opções”)

- Fiscal (já)  
- Atacado (já, reforçar)  
- Fornecedor  
- Subcategoria  
- Detalhe fiscal vs não-fiscal  
- Previews de valor de estoque  
- Toolbar UC avançada  

## 4.4 SOMENTE EM CASOS ESPECÍFICOS

- Física / Unidade Física  
- Fracionado / peso médio / preço UN  
- Custo por valor total  
- Margem editável  
- Validade  
- Filtros UC  
- Código manual  

---

# 5. Wireframe simplificado (alvo UX)

```
┌─────────────────────────────────────────┐
│ Novo Produto                      [−][x]│
├─────────────────────────────────────────┤
│ Picolé Chocolate          [Implantação] │  ← resumo mínimo
│                                         │
│ Nome *        [____________________]    │
│ Categoria     [Sorvetes ▼]  [Barras]    │
│                                         │
│ Unidade do estoque  [UN ▼]              │
│ ☐ Este produto é pesado na entrada      │  ← só se marcar: Unidade física
│                                         │
│ Preço de venda * [____]                 │
│ Preço de compra  [____]  [Usar margem?] │
│                                         │
│ Quantidade inicial [____]  Mínimo [__]  │
│ ☐ Controlar validade → (datas)          │
│                                         │
│ ── Após salvar ───────────────────────  │
│ Formas de vender/comprar                │
│   [ + Adicionar ]   cards simples       │
│                                         │
│ ▸ Mais opções (Fornecedor, Atacado,     │
│    Balança/PDV legado, Fiscal, Código)  │
├─────────────────────────────────────────┤
│              [Cancelar]  [Salvar]       │
└─────────────────────────────────────────┘
```

**Ordem CORE preservada** (Identificação → Base → Física opcional → Comercial → Estoque → UC pós-save → resto oculto).  
**Cards MCC / PDV / Avançado não aparecem** no caminho feliz.

---

# 6. Plano de implementação (só UX — sem mudar CORE)

| Fase | Nome | Escopo UX | Risco CORE |
|------|------|-----------|------------|
| **UX-M-01** | Cortar ruído | Remover Glossário, Avançado, readonly Base, badges jargão, UI disabled de peso; Resumo mínimo; 1 banner de fase | Nenhum |
| **UX-M-02** | Progressive disclosure | Física/PDV/Fornecedor/Subcategoria/filtros UC atrás de condições; “Quantidade inicial” unificada | Nenhum (mesmos campos/payload) |
| **UX-M-03** | Copy humano | “Unidade do estoque”, “Pesado na entrada”, sumir SSOT/MCC da UI | Nenhum |
| **UX-M-04** | Automações leves | Código auto; UC padrão pós-save; margem readonly; default Física KG | Baixo (comportamento default, flags iguais) |
| **UX-M-05** | Convergência PDV←UC | Documentar + feature flag: inferir `permite_venda_unidade` / reduzir card PDV | Médio — exige testes PDV; **sem** remover persistência legado de imediato |

**Fora de escopo deste plano:** mudar MCC, UC schema, Motor Estoque, Fiscal, MFE.

**Critério de sucesso:** operador cadastra produto típico Cremolícia em **≤ 6 campos visíveis** e sente que “o sistema faz quase tudo sozinho”, mantendo arquitetura poderosa por baixo.

---

# 7. Relação com freeze estrutural

O freeze (UX-PROD-05) bloqueia **reorganização arquitetural** dos domínios.  
Esta auditoria propõe **redução de superfície visual** e progressive disclosure — compatível com o freeze se tratada como evolução UX pontual, não como reordenar CORE.

Recomendação de governança: abrir épico **UX-M (Minimalista)** com as fases acima, sem reabrir ROADMAP de reorganização estrutural.

---

**Fim da auditoria.**  
Próximo passo opcional (somente se solicitado): implementar UX-M-01.
