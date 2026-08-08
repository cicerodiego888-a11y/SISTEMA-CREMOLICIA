# AUDITORIA ENTERPRISE — Cadastro de Produtos

**Código:** AUDITORIA_PRODUTO_ENTERPRISE  
**Prioridade:** P0  
**Tipo:** Auditoria Forense (sem implementação)  
**Data:** 2026-07-17  
**Fonte principal:** `frontend/erp/js/produtos.js` (`showProdutoModal` / `modalHtml` ~1461–2090)  
**Shell:** `frontend/erp/pages/produtos.html` (stub; UI montada em JS)

---

## IMPORTANTE

Nenhuma alteração de código, layout ou campos foi realizada.  
Conclusões baseadas em evidências da implementação e em `ARQUITETURA_CORE_CDS.md`, `SSOT_OFICIAL.md`, `GOVERNANCE.md`, `CORE_SERVICES.md`.

---

# Resumo Executivo

O Cadastro de Produto é o **hub de entrada** da plataforma (identificação, preço, estoque, fiscal, PDV fracionado, UC-01, conversão física). Após UC/MCC/PLATFORM-02, a tela **acumulou camadas** sem reorganização por domínio.

| Aspecto | Situação |
|---------|----------|
| SSOT Unidade Base | Presente (`#unidade`) |
| UC-01 | Presente, só em edição |
| Conversão Física (flag) | Presente, alinhada ao CORE |
| UX / organização | Crescimento orgânico; mistura de conceitos |
| Lógica na UI | Cálculos de custo/preço/preview no front |
| Legado | MUC oculto; ghosts `data_validade`/`lote`; “Vendido por Peso” paralelo |

**Classificação final: 🟢 Enterprise Ready** (UX-PROD-05 — 2026-07-17).  
Reorganização estrutural do Cadastro desktop **congelada**. Evoluções: correções, pontuais ou novas features.

---

# AUDITORIA 1 — Organização Geral da Tela

## Blocos em ordem visual (`#produtoModal`)

| # | Bloco | Evidência |
|---|--------|-----------|
| 1 | Identificação (código, nome, categoria, subcategoria, unidade) | ~1524–1572 |
| 2 | Vendido por Peso + venda por unidade | ~1574–1628 |
| 3 | Motor Conversão Unidades (alerta) + custo unitário por total | ~1631–1684 |
| 4 | Preços (compra, lucro %, venda) | ~1687–1723 |
| 5 | Estoque inicial / mínimo / totais preview | `#areaCamposEstoqueProduto` ~367–480; ~1733–1763 |
| 6 | Fornecedor | ~1768–1775 |
| 7 | Validade / lote inicial | ~1787–1825 |
| 8 | Card “Dados Fiscais” (collapse) + atacado | ~1830–1908 |
| 9 | Utiliza Conversão Física | ~1912–1945 |
| 10 | UC-01 | ~1948–1995 |
| 11 | MUC legado (sempre oculto) | ~1997–2031 |

**Quirk estrutural:** Conversão Física, UC-01 e MUC ficam **dentro do card fiscal** mas **fora** do collapse `#dadosFiscaisSection` — aparecem como “continuação fiscal” sem serem fiscais.

## Resposta

A organização **não** segue uma lógica operacional única por domínio.  
**Cresceu ao longo do projeto** (preço → estoque → fiscal → atacado → fracionado → MCC flags → UC-01), com aninhamento inconsistente.

---

# AUDITORIA 2 — Responsabilidade dos Campos

Legenda: ✔ correto · ⚠ dúvida · ❌ domínio errado / misturado

| Campo | Domínio | Status | Nota |
|-------|---------|--------|------|
| `codigo`, `nome` | Produto | ✔ | |
| `categoria_id`, `subcategoria_id` | Produto | ✔ | |
| `unidade` | Produto (SSOT base) | ✔ | |
| `produto_fracionado` / `vendido_por_peso` | PDV / legado | ⚠ | Paralelo a UC+MCC |
| `permite_venda_unidade`, `peso_medio_unidade`, `preco_unidade` | PDV | ⚠ | Peso no cadastro ≠ conversão física |
| `cadastro_valor_total_referencia`, fórmula custo | Compras / legado | ⚠ | Motor de custo na UI |
| `preco_compra`, `preco_venda`, `lucro_percentual` | Comercial / preço | ✔ | Cálculo cruzado na UI |
| `saldo_*_inicial`, `estoque_minimo` | Estoque | ⚠ | Cadastro inicial OK; saldos operacionais = Motor Estoque |
| `valor_total_*_preview` | UI | ✔ | Somente preview |
| `fornecedor` | Fornecedores / texto | ⚠ | Texto livre + autocomplete (não SSOT vínculo forte) |
| `controlar_validade`, `data_validade_inicial`, `dias_alerta_validade` | Estoque / lote | ✔ | |
| `ncm`, `cfop`, `csosn`, `origem`, `cest`, alíquotas, `codigo_barras` | Fiscal | ✔ | |
| `venda_atacado` + faixas | Comercial / preço | ✔ | CRUD separado |
| `utiliza_conversao_fisica`, `unidade_conversao_fisica` | MCC (flag produto) | ✔ | Sem fator |
| UC-01 (grid/modal) | UC / Produto | ✔ | CRUD separado |
| MUC `fator_conversao` | Legado | ❌ | Oculto; fator no cadastro de UC legado |
| `data_validade`, `lote` no save | Ghost | ❌ | Sem input na tela |

---

# AUDITORIA 3 — Arquitetura CORE

## Violação de SSOT?

| Regra | Violação? |
|-------|-----------|
| Unidade Base no produto | **Não** |
| Estoque só Motor Estoque | **Parcial** — saldos iniciais no cadastro são bootstrap; ajustes posteriores usam outras telas |
| Conversão só MCC | **Parcial** — UI calcula custo/qty fracionado e preview (não fator físico no produto) |
| Crédito = Motor Comercial | **Não** no cadastro |
| Financeiro = MFE | **Não** no cadastro |

## Regras duplicadas / cálculo fora do motor

| Lógica na UI | Função | Linhas | Problema |
|--------------|--------|--------|----------|
| Custo = total ÷ qtd | `calcularCustoUnitarioReferenciaCadastro` | ~114–135 | Duplica concern de custo/entrada |
| Formação preço compra↔lucro↔venda | `sincronizarFormacaoPrecoProduto` | ~2756–2790 | Aceitável como UX; não é SSOT financeiro |
| Preview conversão fracionada | `aplicarModoConversaoUnidadesCadastro` | ~156–191 | Legado paralelo ao MCC |
| Steps/format estoque fracionado | helpers ~40–60, ~4608+ | Formatação, não SSOT |

---

# AUDITORIA 4 — Unidades de Comercialização

| Conceito | Onde | Separado? |
|----------|------|-----------|
| Unidade Base | `#unidade` cedo na tela | Parcial — longe da seção UC |
| UC-01 | card próprio (só edit) | Sim |
| Conversão Física | switch + destino | Sim do UC, mas **junto** do card fiscal |
| Venda por Peso | topo, antes de preços | **Misturado** semanticamente com física |
| Conversão Comercial (qty UC) | modal UC `#uc01_quantidade` | Sim |
| MUC legado | oculto, fator → base | Morto / risco |

**Resposta:** Conceitos **parcialmente separados**, **visualmente misturados** (peso PDV × física MCC × UC × fiscal no mesmo scroll).

---

# AUDITORIA 5 — Fluxo Operacional (Sorvete Flocos)

Passos típicos do operador hoje:

1. Nome, categoria, **Unidade = L**  
2. Decide “Vendido por Peso?” (dúvida — sorvete vende em L/pote, não necessariamente “peso”)  
3. Preenche preços / estoque inicial  
4. Fiscal (NCM…)  
5. Liga **Utiliza Conversão Física** → Converter para **KG**  
6. **Salva** (obrigatório para UC)  
7. Reabre → adiciona UC “Caixa 5 L” (qtd 5)  
8. Só na **Compra** informa 20 CX e 67,500 Kg  

### Dúvidas / excesso / jargão

- “Vendido por Peso” vs “Conversão Física”  
- “Motor de Conversão de Unidades” vs “MCC” (na compra)  
- UC só após salvar  
- Tipo UC “Conversão Física” / coluna Lote  
- Card fiscal contendo blocos não fiscais  

---

# AUDITORIA 6 — UX (sem treinamento?)

| Conceito | Operador entende sozinho? |
|----------|---------------------------|
| Unidade Base | Parcial (rótulo “Unidade”) |
| UC | Difícil (só após salvar; muitos canais) |
| Conversão Física | Médio (texto ajuda) |
| Venda por Peso | Confunde com física |
| Compra (peso) | Melhor na tela de compras |

**Dificuldades:** sobrecarga de switches; ordem não operacional; jargão técnico; mobile sem UC/física.

---

# AUDITORIA 7 — Campos / código mortos

| Item | Evidência |
|------|-----------|
| `#secaoUnidadesComerciaisMuc` sempre `display:none` | ~1997 |
| `inicializarUnidadesComerciaisMuc` nunca chamada | ~5174+ |
| `#btnAdicionarUnidadeMuc` disabled | ~2002 |
| `data_validade`, `lote` no payload sem input | `saveProduto` ~2887–2888 |
| Fallback `#estoque_atual` em helpers | Não no modal atual |
| Painéis fracionado `d-none` até switch | Legado ativo, não morto |

---

# AUDITORIA 8 — Dependências (quem consome)

| Campo / bloco | Consumidores |
|---------------|--------------|
| `unidade`, nome, código | PDV, Fiscal, Compras, Mobile, MCC, listagens |
| `produto_fracionado` / peso médio | PDV, Compras (legado), Mobile |
| Preços | PDV, Comercial, Compras, Fiscal (valor) |
| Saldos iniciais | Motor Estoque / bootstrap |
| Flags fiscal | NFC-e / NF-e |
| `utiliza_conversao_fisica` | Compras MCC-03, MCC |
| UC-01 | PDV-01, Compras, Fiscal (snapshot) |
| Atacado | ERP vendas |
| Validade | Alertas estoque / lotes |
| MUC | Rotas ainda montadas; UI morta |

---

# AUDITORIA 9 — Ordem Ideal (proposta)

1. Identificação  
2. Unidade Base (SSOT)  
3. Unidades de Comercialização  
4. Conversão Física (flag + destino) — link “peso na Compra”  
5. Comercial (preços, atacado)  
6. PDV (fracionado / venda por UN) — se ainda necessário  
7. Estoque inicial / mínimo / validade  
8. Fiscal  
9. Compras (referências, fornecedor)  
10. Integrações (MIIP/equipamentos)  
11. Avançado / legado  

Sem implementar.

---

# AUDITORIA 10 — Governança

| Questão | Resposta |
|---------|----------|
| Campo que deveria ser de outro motor? | Fator MUC; cálculos de conversão fracionada na UI; saldos além do bootstrap |
| Regra de negócio na UI? | Sim — custo unitário, formação de preço, preview conversão |
| Lógica duplicada? | Fracionado legado × UC × MCC |
| Violação SRP da tela? | **Sim** — um modal concentra 6+ domínios |

---

# AUDITORIA 11 — Enterprise Readiness

**Se a plataforma nascesse do zero, esta tela NÃO seria construída assim.**

Motivos:

1. Scroll único monolítico com aninhamento fiscal incorreto  
2. Domínios CORE (UC/MCC) adicionados sem redesign  
3. Legado fracionado/MUC coexistindo  
4. Cálculos de domínio na UI  
5. UC indisponível no primeiro save  
6. Mobile dessincronizado  

---

# AUDITORIA 12 — Roadmap (fases)

Ver `ROADMAP_REORGANIZACAO_CADASTRO.md` e `CHECKLIST_REORGANIZACAO_CADASTRO.md`.

---

# Classificação Final

## 🟠 Refatoração recomendada

**Justificativa:** Aderência parcial ao CORE (flags, UC-01, sem fator no produto), mas organização, UX e legado impedem classificação Enterprise Ready. Não é incompatível (não 🔴); exige reorganização por domínio e limpeza de legado (não apenas 🟡).

---

# Entregáveis correlatos

- `ROADMAP_REORGANIZACAO_CADASTRO.md`  
- `CHECKLIST_REORGANIZACAO_CADASTRO.md`  
- Relacionado: `AUDITORIA_FORENSE_MCC_UX_IMPLEMENTACAO.md`

---

# Resumo Obrigatório

## Principais riscos

| Risco | Impacto |
|-------|---------|
| Operador confunde “Vendido por Peso” com Conversão Física | Entrada MCC errada / peso no lugar errado |
| UC só após primeiro save | Produto nasce incompleto para PDV/Compras |
| Cálculos de custo/preço na UI | Divergência vs backend; bypass de governança |
| MUC/fracionado paralelo a UC+MCC | Dois caminhos de conversão; dívida técnica |
| Mobile sem UC/física | Paridade quebrada entre canais |
| Ghosts no payload (`data_validade`, `lote`) | Dados inconsistentes / confusão futura |

## Quick Wins (UX-01) — esforço baixo

1. Renomear “Unidade” → “Unidade Base (estoque)”  
2. Copy explícita: peso na Entrada da Compra  
3. Separar visualmente bloco Conversão Física do card fiscal  
4. Remover ghosts do `saveProduto`  
5. Hint: “UC após salvar o produto”  
6. Clarificar/ocultar tipo UC “Conversão Física”

**Impacto estimado:** alto em clareza; baixo risco de regressão.

## Melhorias estruturais (UX-02 / UX-03)

1. Seções PDV vs MCC isoladas  
2. Abas por domínio (Identificação → Base → UC → Física → Comercial → PDV → Estoque → Fiscal → Avançado)  
3. UC disponível no fluxo de criação (draft ou pós-id imediato)  
4. Atacado e Fiscal só nas abas corretas  

**Impacto estimado:** alto em UX e governança visual; médio–alto esforço; regressão de save/fiscal/UC.

## Melhorias futuras (UX-04+)

1. Remoção UI MUC + isolamento do painel legado de embalagem  
2. Paridade mobile (UC + flag física)  
3. Extrair formação de preço/custo para serviço backend  
4. Deprecar fracionado quando UC+MCC cobrir o caso  

**Impacto estimado:** alto em limpeza e paridade; esforço alto (mobile); depende de ADR de legado.

## Ordem recomendada de implementação

```
UX-01 (quick wins)
  → UX-02 (separar peso/PDV vs física)
    → UX-03 (abas por domínio + UC no create)
      → UX-04 (legado + mobile + extrair cálculos)
```

Detalhamento: `ROADMAP_REORGANIZACAO_CADASTRO.md`  
Checklist: `CHECKLIST_REORGANIZACAO_CADASTRO.md`
