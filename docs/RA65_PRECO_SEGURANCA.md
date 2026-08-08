# RA-6.5.1 — Preço de Segurança

| Campo | Valor |
|---|---|
| Tipo | UX / nomenclatura |
| Base | RA-6.4 + Auditoria RA-6.5 |
| Escopo | Somente interface e textos apresentados ao usuário |
| Não altera | Banco, schema, APIs, payloads, Resolver (lógica), PDV, Motor Comercial, Fiscal, Ledger, Outbox |

---

## Objetivo

Alinhar a interface do ERP com a arquitetura oficial: o preço oficial de venda **não** é o valor cadastrado no produto; ele vem da Tabela de Preços do canal. O valor em `produtos.preco_venda` passa a se chamar **Preço de Segurança** na UI.

---

## Fluxo oficial

```text
Produto
    ↓
Linha de Precificação
    ↓
Tabela de Preços
    ↓
Preço Oficial

Caso não exista:

    ↓
Preço de Segurança
```

---

## Nomenclatura

| Antes (UI) | Depois (UI) | Persistência |
|---|---|---|
| Preço Base | **Preço de Segurança** | Coluna `produtos.preco_venda` (inalterada) |

---

## Cadastro de produto (aba Comercial)

Organização visual:

1. **Linha de Precificação** — único elo do produto com o grafo de preços  
2. **Preço de Segurança** — campo de contingência (`#preco_venda`)

Textos de ajuda:

- Abaixo do campo: *Utilizado apenas quando não existir um preço configurado para esta Linha de Precificação na Tabela de Preços do canal da venda.*
- Complemento: *ℹ Utilizado somente como fallback do Resolver.*

Tooltip:

> Este valor não é o preço oficial de venda.  
> O preço oficial é obtido pela Tabela de Preços correspondente ao canal da operação.  
> Este campo é utilizado apenas como contingência quando não existir um preço configurado.

---

## Mensagens do Resolver (apresentação)

Quando o fallback é usado, a origem legível passa a ser:

- `Preço de Segurança`
- `Fallback (Preço de Segurança)` (diagnóstico)

A constante interna `ORIGEM_LEGADO` e a leitura de `produto.preco_venda` **não mudam**.

---

## Critérios de aceite

- [x] "Preço Base" não aparece mais na interface do ERP  
- [x] Interface utiliza "Preço de Segurança"  
- [x] Tooltip e textos de ajuda presentes  
- [x] Nenhuma alteração funcional / schema / API  
- [x] Compatível com RA-6.4 e Auditoria RA-6.5  
