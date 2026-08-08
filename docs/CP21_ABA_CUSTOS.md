# CP-2.1 — Reorganização da Aba Custos do Cadastro de Produto

| Campo | Valor |
|---|---|
| Tipo | Implementação UX (cadastro de produto) |
| Base | Auditoria CP-2 — recomendação **B** |
| Não altera | Compras, Central, XML, MCC, Fiscal, Comercial, Ledger, Outbox, MUC, Banco, APIs |

---

## Motivo

A Auditoria CP-2 confirmou que o bloco **5 · Compras** misturava:

- **Snapshot do produto** (Último Custo, Fornecedor Preferencial)
- **Calculadora de entrada** (Valor Total Pago, Quantidade, Recalcular) — domínio de Compra/NF-e

A calculadora já existe em Compras/MCC. No cadastro gerava duplicidade e confusão cognitiva.

---

## Responsabilidade da aba **Custos**

Consulta e manutenção do **custo atual do produto**:

| Campo | Comportamento |
|---|---|
| Último Custo | Editável (`preco_compra`) — implantação / sem módulo Compras / ajustes |
| Custo Médio | Somente leitura — “Não calculado” até existir motor real (nunca copia Último Custo) |
| Fornecedor Preferencial | Editável (`fornecedor`) |
| Última Compra | Somente leitura — “Sem histórico” até implementação |
| Ver Histórico de Custos | UI preparada; desabilitado (“Disponível em breve”) |

---

## Responsabilidade da **Compra**

```text
Compra / NF-e
    ↓
Motor de Custos (rateio + MCC)
    ↓
Atualiza Produto (último custo, futuro custo médio, fornecedor)
    ↓
Histórico
    ↓
Consulta no cadastro (aba Custos)
```

Valor total, quantidade e recalcular unitário permanecem no processo de Compra — **não** no cadastro.

---

## Removido do cadastro

- Valor Total Pago  
- Quantidade Comprada / Quantidade Total  
- Cada Unidade Custou / Custo Unitário Calculado  
- Botão Recalcular Custo  
- Validação do “par incompleto” no save  
- Sobrescrita de `preco_compra` via valor÷qtd no save fracionado  

Colunas DB (`valor_total_compra`, `peso_total_compra`, `custo_por_kg`) **não** foram dropadas — fora de escopo.

---

## Mensagem oficial da aba

> Esta seção apresenta o custo atual do produto.  
> O cálculo do custo é realizado durante o processo de Compra ou pela importação de NF-e.  
> O Último Custo pode ser informado manualmente quando a empresa não utilizar o módulo de Compras.

---

## Critérios de aceite

- [x] Aba renomeada para **5 · Custos**
- [x] Calculadora removida
- [x] Último Custo editável
- [x] Custo Médio somente leitura (“Não calculado”)
- [x] Fornecedor Preferencial mantido
- [x] Mensagens atualizadas
- [x] Sem alteração em Motor de Compras / APIs / banco
- [x] Compatível com Auditoria CP-2 (recomendação B)
