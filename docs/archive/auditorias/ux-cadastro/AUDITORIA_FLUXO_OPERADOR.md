# AUDITORIA — Fluxo do Operador

**Código:** AUDITORIA_FLUXO_OPERADOR  
**Data:** 2026-07-18  
**Tipo:** Auditoria (sem implementação)  
**Companion:** `UX_ENTERPRISE_01.md`

---

## 1. Fluxo completo (visão operador)

```
Produto (cadastrar + salvar)
    ↓
Compra (nota + itens)
    ↓
Peso (só se produto pesado)  ← gargalo cognitivo
    ↓
Estoque (atualiza sozinho)
    ↓
Venda (PDV)
    ↓
Cancelar (se precisar)
    ↓
Ajuste (exceção)             ← gargalo de copy
    ↓
NFC-e (finalizar c/ F12)
    ↓
Consulta (detalhes)
```

---

## 2. Mapa de esforço

| Tela / etapa | Esforço | Motivo |
|--------------|---------|--------|
| Cadastro produto comum | Baixo–Médio | UX-MASTER-01 ajudou; scroll ainda longo |
| Cadastro produto pesado | Médio | Dois switches de “peso” (entrada × PDV) |
| Compra (sem peso) | Médio | Nota + itens + margem |
| Compra + peso / UC | **Alto** | MCC, UC, dois motores, Fiscal/NF |
| Estoque pós-compra | Baixo | Automático |
| PDV venda | Baixo–Médio | Limpo; modal peso/UC às vezes |
| Cancelar venda | Baixo | Óbvio |
| Ajuste estoque | **Alto** | Preview MCC, Conversão Física |
| NFC-e | Baixo | Fluxo natural se F12 on |
| Consulta produto | Baixo | Leitura; 1 label confusa |

---

## 3. Campos que podem desaparecer (da UX)

| Campo / elemento | Motivo | Sugestão |
|------------------|--------|----------|
| Título “Motor de Conversão Comercial (MCC)” | Assusta leigo | “Informe o peso da balança” |
| Label “Quantidade (UC)” | Sigla interna | “Quantidade comprada” / nome da embalagem |
| “Motor de Conversão de Unidades” | Duplica MCC | Unificar painel sem “Motor” |
| “Preview (MCC)” no ajuste | Jargão | “Como ficará o estoque” |
| “Unidades carregadas pelo MCC” | Inútil ao operador | “Unidade do ajuste” |
| “Conversão por Lote (prep. UC-02)” | Dev speak | Esconder ou “Avançado” |
| Hint “Motor Indústria” | Futuro interno | Remover |
| Fator com 6 casas | Confunde | Só mostrar resultado em linguagem humana |
| Numeração 1·…8· no cadastro | Visual de manual | Títulos curtos sem número |
| “Implantação / Operação” | Conceito CDS | “Estoque inicial” / “Já em uso” |

---

## 4. Campos só depois / sob demanda

| Campo | Quando |
|-------|--------|
| Fornecedor | Compra ou Mais opções (já) |
| Subcategoria | Categoria com filhos (já) |
| Validade | Switch validade (já) |
| Atacado | Switch (já) — poderia default colapsado mais agressivo |
| Peso médio / Preço unidade | Vendido por peso + venda por UN |
| Painel peso cadastro | Pesado na entrada ON (já) |
| Formas de Venda extras | Após 1ª necessidade (caixa/embalagem) |
| Fiscal NCM… | Contador / 1ª NFC-e |
| Ajuste Não Fiscal | Só se F12 off / loja mista |
| Toolbar Formas de Venda | ≥ 3 (já) |

---

## 5. Campos que deveriam ser automáticos

| Campo | Situação atual | Ideal operador |
|-------|----------------|----------------|
| Código | Auto (UX-MASTER-01) | Manter |
| Forma de venda padrão | Auto pós-save | Manter |
| Margem | Auto | Manter |
| Unidade estoque UN | Default | Manter |
| Unidade física sugerida | Parcial | Manter/fortalecer |
| Preço venda na compra | Sugerido | OK |
| Fator físico | Calculado | OK — esconder matemática |
| Categoria | Manual | Sugestão por nome (futuro) |
| Fornecedor | Manual | Último usado na compra |
| Conversão / flags PDV | Manual | Inferir da forma de venda |
| Não Fiscal = 0 | Implícito | Happy path 1 campo “Quantidade” |

---

## 6. Campos que o cliente provavelmente nunca preenche

- Origem / CEST / alíquotas ICMS·PIS·COFINS (loja Simples sem consultor)
- Série / Modelo / Chave (nota avulsa pequena)
- Prioridade UC / Conversão por lote
- Peso referência aproximado no cadastro
- Volume total MCC (muitos casos)
- Margem (se já tem compra+venda)
- Código manual
- Subcategoria (lojas pequenas)
- Atacado (mercadinho sem atacado)

---

## 7. Campos que confundem

| Elemento | Por quê |
|----------|---------|
| Fiscal vs Não Fiscal | Conceito fiscal, não de balcão |
| “Pesado na entrada” × “Vendido por peso” | Parecem a mesma coisa |
| Quantidade (UC) | Sigla |
| Unidade comercial (PDV/compra) | “Comercial” soa burocrático |
| Conversão de Unidades (consulta) | Não é o que o dono pergunta |
| Preview MCC | Sigla |

---

## 8. Duplicidades

- Fase Implantação: badge + banner  
- Dois painéis de conversão na compra (MCC × Unidades)  
- Preço/margem no cadastro e de novo na linha da compra  
- Saldos Fiscal/NF/Total em cadastro, ajuste e consulta  
- Conceito “peso” em cadastro + compra + PDV (3 lugares)

---

## 9. Ruídos visuais

- 8 cabeçalhos numerados no cadastro  
- Card Atacado sempre presente  
- Painéis MCC coloridos/técnicos na compra  
- Preview fator 6 decimais  
- Badge “SISTEMA FISCAL ATIVO” (útil, mas gritante)  
- Texto “(Preparação visual — persistência… sprint futura)” no cadastro  

---

## 10. Informações técnicas visíveis

| Termo | Onde |
|-------|------|
| MCC | Compra (título), Ajuste (preview/help/erro) |
| Motor | Compra (MCC + Unidades + Indústria) |
| UC | Compra “Quantidade (UC)”, prep. UC-02 no editor |
| Conversão Física | Compra toasts, Ajuste avisos |
| Unidade Base | Ajuste mensagem |
| Unidade Comercial | Editor formas / PDV modal |
| Implantação/Operação | Cadastro |
| Pipeline | Central de Entradas (se usada) |

**Não vistos no fluxo principal:** CORE · SSOT · Gateway · Pipeline (exceto Central) · MFE · Arquitetura.

---

## Perfis de cliente (teste mental)

| Perfil | Cadastra sozinho? | Opera compra pesada sozinho? |
|--------|-------------------|------------------------------|
| Mercadinho | Sim (comum) | Não |
| Sorveteria | Sim com dúvida peso | Não sem treino |
| Depósito | Sim | Parcial |
| Material construção | Sim | Parcial (kg/m) |
| Cosméticos | Sim | Sim (sem peso) |
| Distribuidora | Sim | Parcial (UC ajuda, label atrapalha) |
| Pet Shop | Sim | Sim (comum) |
