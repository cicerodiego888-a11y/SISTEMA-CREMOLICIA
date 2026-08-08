# RELATÓRIO — Fluxo Mental do Operador

**Código:** RELATORIO_FLUXO_MENTAL  
**Data:** 2026-07-18  
**Sprint:** UX-ENTERPRISE-01  
**Tipo:** Relatório de auditoria (sem implementação)

---

## Objetivo

Avaliar se o Cadastro de Produtos e o ciclo operacional estão preparados para o público da CDS Sistemas — operador de mercadinho a distribuidora — **sem** depender de conhecimento de MCC, UC, Motor ou MFE.

---

## Fluxo auditado

Produto → Compra → Peso → Estoque → Venda → Cancelar → Ajuste → NFC-e → Consulta.

---

## Pontos excelentes

- PDV: busca, finalizar, cancelar — claros  
- NFC-e embutida no finalizar (modo fiscal)  
- Cancelar venda com confirmação simples  
- Código automático + forma de venda padrão (UX-MASTER-01)  
- Margem automática no cadastro  
- Fiscal do produto recolhido  
- Linguagem do cadastro principal sem MCC/SSOT/CORE  

---

## Pontos bons

- Progressive disclosure no cadastro (peso, validade, mais opções)  
- Estoque sobe sozinho após compra  
- Consulta de produto legível  
- Default UN e copy “Unidade do Estoque”  

---

## Pontos médios

- Scroll do cadastro ainda com 8 blocos  
- Fiscal × Não Fiscal no estoque inicial  
- Dois conceitos de peso (entrada × PDV)  
- Modal “Unidade comercial” no PDV  
- View produto: “Conversão de Unidades”  

---

## Pontos ruins

- Compra: título **Motor de Conversão Comercial (MCC)**  
- Compra: **Quantidade (UC)** e dois motores paralelos  
- Ajuste: **Preview (MCC)** e “Conversão Física”  
- Toasts “Produto exige Conversão Física”  
- Hint “Motor Indústria”  
- Checkbox “prep. UC-02” no editor de formas  

---

## Campos desnecessários (UX)

MCC nos títulos · UC na label · Preview MCC · fator 6 casas · Motor Indústria · UC-02 · alíquotas no 1º dia · numeração excessiva de seções.

---

## Campos automáticos (já / desejados)

**Já:** código, UC padrão, margem, fator na compra, default UN.  
**Desejados:** 1 campo quantidade inicial; PDV inferido; esconder segundo motor; último fornecedor.

---

## Campos ocultáveis

Fornecedor · Subcategoria · Validade · Atacado · Peso médio · Preço UN · Fiscal · Ajuste NF · Toolbar formas · Detalhe MCC.

---

## Melhorias recomendadas (só UX — próximas sprints)

1. **Compra:** renomear painel → “Peso da balança / Embalagem”; zerar palavras MCC/UC/Motor.  
2. **Ajuste:** “Como ficará o estoque”; zerar MCC.  
3. **Cadastro:** unificar narrativa dos dois switches de peso (tooltip único).  
4. **Happy path estoque:** um campo “Quantidade inicial” quando F12 off simplificado.  
5. **Consulta:** “Vendido por peso: Sim/Não”.  
6. **Editor formas:** esconder UC-02 / prioridade.

---

## Nota por tela

| Tela | Nota |
|------|------|
| Cadastro Produto | ★★★★☆ |
| Compra | ★★☆☆☆ |
| Informar Peso | ★★☆☆☆ |
| Estoque (auto) | ★★★★☆ |
| Venda PDV | ★★★★☆ |
| Cancelar Venda | ★★★★★ |
| Ajuste Estoque | ★★☆☆☆ |
| NFC-e | ★★★★☆ |
| Consulta | ★★★★☆ |

---

## Nota geral

**★★★☆☆** (3/5) — jornada completa.  
Cadastro isolado: **★★★★☆**.

---

## Veredito Final

### 🟠 Precisa Refinar

Não é 🔴 Complexo no cadastro (já evoluiu).  
Não é 🟢 Enterprise Ready na **jornada** enquanto Compra e Ajuste falarem MCC.

**Operador:** precisa de **treinamento** (especialmente entrada com peso).  
**vs ERP BR:** ciclo com peso = **mais complexo**; PDV = similar/melhor.  
**Mercearia amanhã:** primeira impressão **Aceitável**.

---

## ADR?

**(x) NÃO** — auditoria de UX apenas.
