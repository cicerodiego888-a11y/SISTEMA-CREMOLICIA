# MFE-00 — Visão Arquitetural do Motor Financeiro Enterprise

**Código:** MFE-00  
**Prioridade:** P0  
**Status:** OFICIAL (arquitetura — sem implementação operacional)  
**Data:** 2026-07-17  
**Versão:** 1.0.0  

Documentos relacionados: `ADR_MOTOR_FINANCEIRO.md` · `DIAGRAMA_MFE.md` · `ROADMAP_MFE.md` · `ADR_FINANCEIRO_SSOT.md` · `GOVERNANCE.md`

---

## Objetivo

Definir oficialmente a arquitetura do **Motor Financeiro Enterprise (MFE)**, único responsável pelas regras financeiras da Plataforma CDS.

Esta sprint **não** implementa rotinas operacionais, migrations nem cutover.

---

## Visão

O MFE é o **SSOT financeiro** da Plataforma CDS.

| Domínio | Autoridade |
|---------|------------|
| Conversões | MCC |
| Estoque | Motor Estoque |
| Crédito Comercial | Motor Comercial |
| Fiscal | Motor Fiscal |
| **Dinheiro / Caixa / Banco / AR / AP** | **MFE** |

Todo fluxo financeiro deverá obrigatoriamente passar pelo MFE.

---

## Responsabilidades do MFE

O MFE é responsável exclusivamente por:

| Área | Escopo |
|------|--------|
| Caixa | Abertura, fechamento, sangria, suprimento, saldos |
| Bancos | Contas bancárias, extratos, saldos |
| Contas a Receber (AR) | Títulos, baixas, vencimentos |
| Contas a Pagar (AP) | Títulos, baixas, vencimentos |
| Fluxo de Caixa | Realizado e projetado |
| Ledger Financeiro | Append-only, auditoria |
| Conciliação Bancária | Matching extrato × lançamentos |
| PIX / Cartão / TEF | Efeitos financeiros (autorização pode ser canal; dinheiro é MFE) |
| Juros / Multas / Descontos | Cálculo e lançamento financeiro |
| Estornos Financeiros | Compensatórios (nunca UPDATE/DELETE de ledger) |
| Rateios / Centro de Custos / Plano de Contas | Contabilidade gerencial |
| Auditoria Financeira | Rastreio completo |
| Eventos Financeiros | Catálogo + consumo |
| Projeção de Fluxo | Forecast |
| Fechamento de Caixa | Consolidação do período |

---

## Fora de escopo do MFE

| Proibido ao MFE |
|-----------------|
| Estoque |
| Conversão (MCC) |
| Fiscal (emissão/XML) |
| Comercial (crédito / consignação / CC comercial) |
| Cadastro de Clientes / Produtos |
| Produção |
| MIIP |

Conta corrente **comercial** permanece SSOT do Motor Comercial.  
Espelho no caixa/empresa ocorre **somente** via eventos financeiros → MFE.

---

## SSOT oficial

> Todo dinheiro da Plataforma pertence ao MFE.

Nenhum módulo poderá alterar diretamente:

- Caixa  
- Banco  
- AR / AP  
- Saldos financeiros  

Alinhado à **Regra 3** de `GOVERNANCE.md`.

---

## Princípio fundamental

Os demais módulos **nunca** lançam dinheiro.

Eles apenas produzem **Eventos Financeiros**.

### Exemplos

```
PDV → VENDA_RECEBIDA → MFE → Receita → Caixa → Fluxo

Compra → TITULO_AP_CRIADO → MFE → Contas a Pagar

Motor Comercial → PRESTACAO_RECEBIDA → MFE → Recebimento → (efeito empresa) → Fluxo
```

---

## Arquitetura em camadas

```
Motor Financeiro Enterprise
  → Ledger (append-only)
  → Eventos (catálogo + consumidores)
  → Caixa
  → Banco
  → AR
  → AP
  → Conciliação
  → Fluxo
  → Relatórios
```

Diagrama detalhado: `DIAGRAMA_MFE.md`.

---

## Ledger

O Ledger Financeiro é **Append Only**.

Proibido:

- UPDATE de lançamentos  
- DELETE de lançamentos  

Correções exclusivamente por **lançamentos compensatórios** (estornos / contra-partidas).

---

## Catálogo inicial de eventos

| Evento | Origem típica |
|--------|----------------|
| `VENDA_RECEBIDA` | PDV / Venda |
| `VENDA_CANCELADA` | PDV / Venda |
| `TITULO_AP_CRIADO` | Compras |
| `TITULO_AP_BAIXADO` | MFE / AP |
| `TITULO_AR_CRIADO` | PDV / Comercial / Fiscal |
| `TITULO_AR_BAIXADO` | MFE / AR |
| `CAIXA_ABERTO` | PDV / Caixa |
| `CAIXA_FECHADO` | PDV / Caixa |
| `PIX_RECEBIDO` | Canal PIX |
| `PIX_ESTORNADO` | Canal PIX |
| `TEF_APROVADO` | TEF |
| `TEF_CANCELADO` | TEF |
| `TRANSFERENCIA_BANCARIA` | MFE / Banco |
| `CONCILIACAO_REALIZADA` | MFE |
| `PRESTACAO_RECEBIDA` | Motor Comercial |

Metadados obrigatórios de evento: ver seção Eventos (envelope).

---

## Contratos públicos (congelados após implementação — alteração exige ADR)

| Interface | Responsabilidade |
|-----------|------------------|
| `IFinancialLedger` | Persistência append-only do ledger |
| `IFinancialEvent` | Contrato do evento financeiro |
| `IFinancialPublisher` | Publicação de eventos (produtores externos usam adapter) |
| `IFinancialConsumer` | Consumo/handlers internos do MFE |
| `ICashService` | Operações de caixa |
| `IBankService` | Operações bancárias |
| `IAccountsReceivable` | Contas a receber |
| `IAccountsPayable` | Contas a pagar |
| `IReconciliation` | Conciliação |
| `IProjectionService` | Projeção de fluxo |

Pacote alvo futuro: `backend/motores/motor-financeiro/` (ainda não criado nesta sprint).

---

## Envelope de eventos

Todo evento financeiro deverá carregar:

| Campo | Descrição |
|-------|-----------|
| `correlationId` | Agrupa a operação de ponta a ponta |
| `causationId` | Evento/comando que originou este |
| `idempotencyKey` | Garante processamento único |
| `origem` | Módulo produtor (PDV, COMPRA, COMERCIAL, …) |
| `operadorId` | Usuário responsável |
| `timestamp` | Instantâneo UTC/ISO |

---

## Dependências

| Direção | Regra |
|---------|--------|
| MFE **pode consumir** dados/contexto de | Motor Comercial, Fiscal, Estoque, PDV, Compras (**leitura / eventos**) |
| MFE **nunca depende** deles para existir | Bootstrap e ledger autônomos |
| Demais módulos **dependem** do MFE | Para qualquer efeito em dinheiro |

---

## Consumidores (produtores de eventos)

PDV · Compras · Motor Comercial · Fiscal · E-commerce · App Vendas · Marketplace · Portal do Contador · Produção

---

## Auditoria

Toda operação financeira deverá possuir:

Operador · Origem · Evento · Ledger · Conta · Centro de Custo · Histórico · Timestamp

---

## Feature flags (arquitetura)

Todos **desligados** inicialmente. Ativação gradual por consumidor (modelo MCC).

| Flag | Propósito |
|------|-----------|
| `FINANCEIRO_V2` | Master switch do MFE |
| `FIN_LEDGER` | Ledger append-only |
| `FIN_EVENTS` | Pipeline de eventos |
| `FIN_PIX` | Efeitos PIX via MFE |
| `FIN_TEF` | Efeitos TEF via MFE |
| `FIN_CONCILIACAO` | Conciliação bancária |

---

## Estratégia de migração

- Nenhuma rotina existente é alterada em MFE-00.  
- Financeiro legado (`rotas/financeiro`, `caixa_*`, writers atuais) continua operando.  
- Migração **strangler** por consumidor, com dual-read quando necessário.  
- Mesmo padrão adotado no MCC (legado inventariado → cutover progressivo).

Roadmap: `ROADMAP_MFE.md`.

---

## Critérios de aceite (MFE-00)

- [x] Arquitetura publicada  
- [x] Responsabilidades definidas  
- [x] SSOT definido  
- [x] Eventos definidos  
- [x] Contratos definidos  
- [x] Estratégia de migração definida  
- [x] Nenhuma implementação operacional  

---

## Decisão oficial

O Motor Financeiro Enterprise passa oficialmente a integrar a **Arquitetura CORE** da Plataforma CDS.

Todo desenvolvimento futuro no domínio financeiro deverá obrigatoriamente utilizar o **MFE** como única autoridade financeira da plataforma.
