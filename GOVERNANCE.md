# GOVERNANCE — Plataforma CDS

**Versão:** 1.1.0  
**Status:** OFICIAL  
**Data:** 2026-07-17  
**Changelog governança:** Regra 2.1 (EST-MCC-01) — telas de estoque sem lista fixa de unidades.

---

## Objetivo

Este documento estabelece as regras arquiteturais obrigatórias da Plataforma CDS.

Estas regras possuem caráter permanente.

Qualquer exceção deverá obrigatoriamente possuir ADR aprovado.

---

## Princípios Fundamentais

A Plataforma CDS é orientada por Motores (Engines).

Cada Motor possui responsabilidade única (Single Responsibility).

Cada domínio possui uma única Fonte da Verdade (Single Source of Truth — SSOT).

É proibida duplicação de regras de negócio.

---

## Regra 1 — Estoque

Somente o Motor de Estoque movimenta estoque.

É proibido:

- INSERT em estoque
- UPDATE em saldo
- DELETE de movimentações

fora do Motor de Estoque.

---

## Regra 2 — Conversões

Somente o MCC realiza conversões.

É proibido:

- converter litros
- converter kg
- converter caixas
- converter metros
- converter pacotes

fora do MCC.

**Regra 2.1 — Unidades em telas de estoque**

Toda tela que movimenta estoque (Ajuste, Inventário, Compra, PDV, etc.)
deverá consultar o MCC / UC-01 para obter as Unidades de Comercialização válidas.

É **proibido** criar listas fixas (hardcode) de unidades nessas telas.

Sprint de referência: `EST-MCC-01`.

---

## Regra 3 — Financeiro

Somente o **Motor Financeiro Enterprise (MFE)** movimenta dinheiro.

Nenhum módulo pode:

- lançar caixa
- lançar banco
- lançar AR/AP
- **gerar Ledger / FinancialEntry diretamente**

diretamente.

Módulos **publicam Eventos Financeiros**; o MFE materializa o estado.  

**Regra 3.1 — SSOT Modelo Unificado (MFE-03)**

É **proibido** qualquer módulo escrever no Ledger.

Fluxo oficial exclusivo:

```
Evento Financeiro → Pipeline MFE → Ledger → Outbox
```

Entidades oficiais: `FinancialOperation` · `FinancialEntry` · `FinancialDocument` · `FinancialAllocation`.  
Docs: `MFE_03_MODELO_FINANCEIRO.md` · `ADR_MODELO_FINANCEIRO.md` · `MFE_VISAO_ENTERPRISE.md` · `ADR_MOTOR_FINANCEIRO.md`.

**Regra 3.2 — Caixa via MFE (MFE-04)**

O Caixa **não poderá** gerar lançamentos financeiros diretamente.

Todo lançamento deverá ser produzido pelo Motor Financeiro Enterprise
(Evento → Pipeline → Ledger → `FinancialCashHandler`).

Piloto controlado por `FEATURE_MFE_CAIXA` (default OFF).  
Docs: `MFE_04_CAIXA.md` · `ADR_CAIXA_MFE.md`.

**Regra 3.3 — Contas a Receber via MFE (MFE-05)**

Contas a Receber **não poderá** criar títulos diretamente no Ledger.

Todos os títulos deverão nascer do Pipeline Financeiro
(Evento → Pipeline → Ledger → `FinancialReceivableHandler`).

Piloto controlado por `FEATURE_MFE_AR` (default OFF).  
Docs: `MFE_05_CONTAS_RECEBER.md` · `ADR_CONTAS_RECEBER.md`.

**Regra 3.4 — PDV e Motor Comercial não criam títulos financeiros diretamente (MFE-05.1)**

PDV e Motor Comercial **não poderão** criar títulos financeiros diretamente.

Todo título de Contas a Receber deverá nascer do Motor Financeiro Enterprise:

```
Evento Financeiro → Pipeline → Ledger → FinancialReceivableHandler
```

Pontes oficiais: `PdvArBridge` · `ComercialArBridge`.  
Piloto controlado por `FEATURE_MFE_PDV_AR` e `FEATURE_MFE_COMERCIAL_AR` (default OFF).  
Docs: `MFE_05_1_BRIDGE_PDV_AR.md` · `ADR_BRIDGE_PDV_AR.md`.

**Regra 3.5 — FinancialGateway é a única interface pública do MFE (MFE-05.2)**

O `FinancialGateway` é a **única interface pública** do Motor Financeiro.

É **proibido** publicar Eventos Financeiros diretamente no Pipeline.

Fluxo oficial:

```
Módulo / Bridge / Orchestrator → FinancialGateway → Pipeline → Ledger → Handlers
```

Docs: `MFE_05_2_FINANCIAL_GATEWAY.md` · `ADR_FINANCIAL_GATEWAY.md` · `DIAGRAMA_GATEWAY_FINANCEIRO.md`.

**Regra 3.6 — Compras não cria títulos financeiros diretamente (MFE-06)**

Compras **não poderá** criar títulos financeiros diretamente.

Toda obrigação financeira (Contas a Pagar) deverá ser publicada através do `FinancialGateway`:

```
Compra → FinancialGateway → Pipeline → Ledger → FinancialPayableHandler
```

Piloto controlado por `FEATURE_MFE_AP` (default OFF).  
Docs: `MFE_06_CONTAS_PAGAR.md` · `ADR_CONTAS_PAGAR.md` · `FINANCIAL_EVENTS_CATALOG.md`.

**Regra 3.7 — Liquidação somente via FinancialGateway (MFE-07)**

Nenhum módulo poderá liquidar títulos diretamente.

Toda liquidação deverá ocorrer através do `FinancialGateway`:

```
Título → FinancialGateway.publicarLiquidacao() → Pipeline → Ledger → FinancialSettlementHandler
```

O meio de pagamento (PIX, TEF, dinheiro, cartão, …) é atributo da liquidação.  
Piloto controlado por `FEATURE_MFE_SETTLEMENT` (default OFF).  
Docs: `MFE_07_SETTLEMENT.md` · `ADR_FINANCIAL_SETTLEMENT.md`.

---

## Regra 4 — Crédito Comercial

Somente o Motor Comercial calcula:

- Crédito
- Conta Corrente
- Limites
- Consignação

---

## Regra 5 — Fiscal

O Motor Fiscal nunca recalcula:

- estoque
- conversão
- financeiro

Ele apenas documenta a operação.

---

## Regra 6 — Unidade Base

Todo Produto possui exatamente:

Uma Unidade Base.

Todo estoque pertence exclusivamente à Unidade Base.

**Regra 6.1 — Cadastro declarativo (UX-PROD-01)**

O Cadastro do Produto é **declarativo**.

Após a primeira movimentação operacional, os campos de implantação tornam-se somente leitura.

Alterações posteriores deverão ocorrer exclusivamente pelos Motores CORE
(Ajuste de Estoque, Inventário, Compra e demais canais oficiais).

O bloqueio operacional já existe parcialmente na UI; reforço completo permanece no roadmap UX.

**Regra 6.2 — Venda por Peso ≠ Conversão Física (UX-PROD-02)**

| Conceito | Domínio | O que é |
|----------|---------|---------|
| Venda por Peso / Fracionada | PDV | Forma de venda no caixa |
| Conversão Física | MCC | Relação Unidade Base ↔ Unidade Física do lote |

É proibido apresentar os dois conceitos como se fossem o mesmo na UI.

**Regra 6.3 — Implantação × Operação (UX-PROD-03.1)**

O Cadastro do Produto possui duas fases oficiais:

1. **Implantação** — produto sem movimentações: estoque inicial (e peso físico inicial, se aplicável) editáveis.  
2. **Operação** — produto com movimentações: campos de implantação somente leitura; alterações de estoque pelos módulos oficiais (Ajuste de Estoque, Inventário, Compra).

A UI prepara a identificação dos campos (`data-campo-implantacao`) e a detecção de fase.  
A persistência do lote/peso físico inicial permanece para sprint futura.

---

## Regra 7 — Conversão Física

Conversões físicas pertencem ao Lote.

Nunca ao Produto.

---

## Regra 8 — Contratos

Interfaces públicas são imutáveis.

Mudanças exigem:

- ADR
- Versionamento
- Compatibilidade

Contratos congelados: `CORE_SERVICES.md`.

---

## Regra 9 — Eventos

Toda comunicação entre motores deve ocorrer por:

- Serviços oficiais
- Orchestrators
- Eventos
- ou APIs públicas

Detalhamento: `DEPENDENCIAS_OFICIAIS.md`.

---

## Regra 10 — Governança

É proibida duplicação de regra de negócio.

Sempre reutilizar:

Motores CORE.

---

## SSOT Oficiais

| Domínio | SSOT |
|---------|------|
| Conversões | MCC |
| Estoque | Motor Estoque |
| Comercial | Motor Comercial |
| Fiscal | Motor Fiscal |
| Financeiro | Motor Financeiro Enterprise (MFE) |
| Produtos | Cadastro Produtos |
| Clientes | Cadastro Clientes |

Tabela expandida: `SSOT_OFICIAL.md`.

---

## Arquitetura

Todo novo módulo deverá consumir os Motores CORE.

Nunca poderá reimplementar responsabilidades existentes.

Referência: `ARQUITETURA_CORE_CDS.md` · `PLATFORM_CORE.md`.

---

## Vigência

Este documento passa a ser obrigatório para toda a Plataforma CDS.

Qualquer alteração exige ADR aprovado.
