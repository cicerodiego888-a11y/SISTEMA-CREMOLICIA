# RCM-7.5 — Consolidação da UX da Consignação

| Campo | Valor |
|---|---|
| Sprint | RCM-7.5 |
| Tipo | UX / Organização Visual |
| Data | 2026-08-06 |
| Base | RCM-6.1 · RCM-7.2 · RCM-7.3 · Auditoria RCM-7.4 |
| Não altera | Resolver · Precificação · MUC · Fiscal · Ledger · Outbox · Banco · APIs · Regras |

---

## Objetivo

Consolidar a interface da Nova Consignação para refletir a arquitetura oficial do CDS — **somente UX**.

---

## Entregas

### 1. Resumo Financeiro único

Exibe apenas:

- Limite Comercial
- Valor desta Entrega
- Saldo após Entrega
- Utilização (%) + barra

Removidos: credit-strip duplicado, Limite/Saldo na barra do cliente, resumo-grade com crédito, painel lateral “Crédito Disponível”.

### 2. Card Operação

- Operação → Consignação  
- Cliente  
- Tipo Comercial  
- Tabela de Preços  
- Status → Precificação Congelada (quando há itens)

### 3. Snapshot por item (grade)

Linha de Precificação · Tabela de Preços · UC · Origem · Preço  
Sem cores chamativas.

### 4. Preço de Segurança

Se `precoFallback = true` → “Utilizando Preço de Segurança”  
Se `false` → nada.

### 5. Conferência

Colunas: Produto · Linha de Precificação · Tabela de Preços · UC · Preço · Origem · Quantidade · Total

### 6. Padronização de textos

Usar: Operação · Consignação · Tipo Comercial · Tabela de Preços · Linha de Precificação · Preço Oficial · Preço de Segurança  

Não usar: Lista de Preços · Política Comercial · Canal da Venda

---

## Resultado esperado

| Dimensão | Nota |
|---|---|
| Arquitetura | A |
| Experiência do Usuário | A |
