# ARQUITETURA CORE — Plataforma CDS

**Código:** PLATFORM-02.1  
**Status:** OFICIAL  
**Data:** 2026-07-17  

Este documento é a **principal referência arquitetural** da Plataforma CDS.  
Alterações estruturais exigem ADR.

Documentos satélites: `PLATFORM_CORE.md` · `CORE_SERVICES.md` · `SSOT_OFICIAL.md` · `DEPENDENCIAS_OFICIAIS.md` · `ROADMAP_MOTORES.md` · `ARQUITETURA_GERAL.md`

**Governança obrigatória:** [`GOVERNANCE.md`](./GOVERNANCE.md) (v1.0.0) — regras permanentes; exceção somente com ADR.

---

## Decisão oficial

A Plataforma CDS opera sobre uma **Arquitetura CORE consolidada**.

Os motores homologados são a **única base autorizada** para novas implementações.  
É proibida a duplicação de regras de negócio já consolidadas (conversão, estoque base, crédito/consignação, emissão fiscal).

---

## Diagrama oficial

```
                        Plataforma CDS
                               │
        ┌──────────────────────┴──────────────────────┐
        ▼                                             ▼
   Motores CORE                              Motores de Domínio
───────────────────────────────────────────────────────────────
Motor Conversão Comercial (MCC)
Motor Estoque
Motor Comercial
Motor Fiscal
Motor Financeiro Enterprise — MFE (arquitetura oficial · MFE-00)
MIIP
Central Inteligente
───────────────────────────────────────────────────────────────
Consumidores
Compras · PDV · NFC-e · NF-e · E-commerce · Portal do Contador · App de Vendas
```

### Fluxo canônico (produto → documento)

```
Canal (Compras / PDV / Comercial / Ajuste de Estoque)
  → Produto
  → Unidade Comercial (UC-01)  [lista dinâmica via MCC]
  → Quantidade Comercial
  → MCC (Converter / Orchestrator)
  → Quantidade Base
  → Motor Estoque
  → (opcional) Motor Fiscal ← snapshot da operação (sem recalcular)
```

**EST-MCC-01:** Ajuste de Estoque → `EstoqueAdjustmentOrchestrator` → MCC → `MotorEstoque.ajustar`.

---

## SSOT oficiais

| Domínio | SSOT |
|---------|------|
| Estoque | Motor Estoque |
| Conversões | MCC |
| Crédito Comercial | Motor Comercial |
| Consignação | Motor Comercial |
| Fiscal | Motor Fiscal |
| Financeiro | Motor Financeiro |
| Produtos | Cadastro de Produtos |
| Clientes | Cadastro de Clientes |
| Fornecedores | Cadastro de Fornecedores |
| Unidades Comerciais | UC-01 (`unidades-comercializacao`) |

Detalhamento: `SSOT_OFICIAL.md`.

---

## Princípio de produto e estoque

> **Um Produto → Uma Unidade Base (SSOT) → N Unidades de Comercialização → MCC → Estoque.**

- Cadastro **declara**; Entrada/Compra **mede**; MCC **converte**; Motor Estoque **armazena**  
- Cadastro é **declarativo** (UX-PROD-01 / GOVERNANCE Regra 6.1)  
- UX do cadastro organiza-se por **domínios** (UX-PROD-03): Identificação → Base → Física → UC → Comercial → PDV → Estoque → Fiscal → Avançado  

**Proibido**

- Fator físico no cadastro do produto  
- Conversão fora do MCC  
- Estoque por Unidade Comercial  
- Conversão dentro do Motor de Estoque  
- Lista fixa de unidades em telas de estoque  
- Motor Fiscal recalcular fator ou movimentar estoque  

---

## Motores CORE — responsabilidades

### MCC — Motor de Conversão Comercial

| | |
|--|--|
| **Responsável** | Converter UC → quantidade base; conversão física por lote (versionada); orquestrar entradas/vendas/comercial |
| **Não responsável** | Persistência de saldo; emissão fiscal; crédito; UI |
| **Consumidores** | Compras, PDV, Motor Comercial, Motor Fiscal (read-only), **Ajuste de Estoque (EST-MCC-01)** |
| **Dependências** | UC-01 (unidades), DB (lotes/versão) |
| **Eventos** | Auditoria em memória / snapshot na operação (sem outbox fiscal) |
| **APIs** | `Converter`, `ConverterAsync`, `CalcularConversaoFisica`, versionamento, orchestrators (`compra`, `pdv`, `comercial`, **`estoque`**) |

### Motor Estoque

| | |
|--|--|
| **Responsável** | Entrada, saída, ajuste, inventário, reserva, saldo — **somente quantidade base** |
| **Não responsável** | Conversão, UC, fator, fiscal, financeiro |
| **Consumidores** | Compras, PDV, Motor Comercial (via adapters), ajustes |
| **Dependências** | DB (`produto_saldos`, movimentações) |
| **Eventos** | Movimentação auditável por origem (`OrigemEstoque`) |
| **APIs** | `entrar`, `sair`, `ajustar`, `inventariar`, `reservar`, `liberarReserva`, `consultarSaldo` |

### Motor Comercial

| | |
|--|--|
| **Responsável** | Perfil comercial, consignação, ledger, crédito, projeções, outbox |
| **Não responsável** | Conversão (usa MCC); estoque físico direto (usa MotorEstoque via bridge) |
| **Consumidores** | ERP Comercial, App de Vendas (futuro) |
| **Dependências** | MCC (`comercialOperacional`), bridges platform |
| **Eventos** | Domain events + outbox (`ESTOQUE_*`, etc.) |
| **APIs** | `inicializar` / usecases perfil & consignação / projections / dto |

### Motor Fiscal

| | |
|--|--|
| **Responsável** | Emitir NFC-e/NF-e, XML, validação fiscal, registrar UC no documento |
| **Não responsável** | Conversão, fator, conversão física, estoque |
| **Consumidores** | PDV, ERP |
| **Dependências** | Snapshot venda + `FiscalOperacionalService` (MCC integracao) |
| **Eventos** | Status SEFAZ / cancelamento documento |
| **APIs** | Serviços em `backend/services/fiscal/` |

### UC-01 — Unidades de Comercialização

| | |
|--|--|
| **Responsável** | Cadastro de UCs por produto (canais, prioridade, padrão) |
| **Não responsável** | Converter quantidades; movimentar estoque |
| **Consumidores** | MCC, PDV UI, Produtos |
| **APIs** | `MotorUnidadesComercializacao` / rotas UC |

### MIIP / Central Inteligente

| | |
|--|--|
| **Responsável** | Inteligência de produto / central de entradas e revisão |
| **Não responsável** | SSOT de estoque ou conversão comercial |
| **Status** | Domínio auxiliar homologado em trilhas próprias |

### Motor Financeiro Enterprise (MFE)

| | |
|--|--|
| **Status** | **MFE-07** Settlement + AP + Gateway + AR + Caixa — flags OFF; sem cutover |
| **Responsável** | **FinancialGateway** · Pipeline · Ledger · Cash/Receivable/Payable/**Settlement** Handlers · Bridges · Outbox · DL · Auditoria |
| **Não responsável** | SDKs PIX/TEF físicos (roadmap); estoque; conversão; fiscal; crédito comercial (regra de negócio) |
| **SSOT** | Todo dinheiro da plataforma (quando flags ligadas por consumidor) |
| **Princípio** | Gateway → Pipeline → Ledger → Handler; liquidação unificada (Regra 3.7) |
| **Modelo** | `FinancialOperation` · `FinancialEntry` · `FinancialDocument` · `FinancialAllocation` · `FinancialInstallment` · **`FinancialSettlement`** |
| **Pacote** | `backend/motores/motor-financeiro/` |
| **Docs** | `MFE_07_SETTLEMENT.md` · `FINANCIAL_EVENTS_CATALOG.md` · `ROADMAP_MFE.md` |

---

## Contratos públicos congelados

Alteração futura **exige ADR**. Lista canônica em `CORE_SERVICES.md`.

Resumo:

| Pacote | Contratos públicos |
|--------|-------------------|
| MCC | `Converter*`, `CalcularConversaoFisica`, enums, errors, orchestrators/operacionais (compra, pdv, comercial, fiscal), domain entities |
| Motor Estoque | `entrar/sair/ajustar/...`, `OperacaoEstoque`, `OrigemEstoque`, `QuantidadeComercialRejeitadaError` |
| UC-01 | Facade listar/criar/atualizar/excluir + DTO |
| Motor Comercial | Facade init + usecases + dto + errors + contracts |
| Fiscal | Emissão via services + snapshot `FiscalOperacionalService` |
| MFE | **`FinancialGateway`** (porta oficial) · Bridges/Orchestrators · Handlers — `motor-financeiro` (MFE-05.2) |

---

## Comunicação entre motores

Permitido:

- Serviços / facades públicas (`require('.../motor-estoque')`, `require('.../motor-conversao-comercial')`)
- Orchestrators / adapters em `integracao/`
- Eventos / outbox (Motor Comercial)
- APIs HTTP oficiais

Proibido:

- Dependência circular entre motores
- Duplicar `Converter` / fator fora do MCC
- Motor Estoque importar MCC/UC/MUC
- Motor Fiscal recalcular conversão

---

## Integrações homologadas

| Código | Fluxo |
|--------|--------|
| UC-01 / UC-01.1 | Unidades comerciais |
| MCC-01 … MCC-04 | Conversão + Estoque |
| MCC-HOM-01 | Homologação enterprise MCC |
| MCI-01 / MCC-03 | Entrada de mercadorias |
| PDV-01 | PDV → MCC → MotorEstoque |
| **PDV-UC-02** | PDV cutover UI → UC-01 (Forma de Venda; sem MUC) |
| COM-01 | Comercial → MCC → MotorEstoque |
| FIS-01 | Fiscal ← snapshot MCC/UC |

---

## Legado

Inventário oficial: seção em `DEPENDENCIAS_OFICIAIS.md`.  
Nesta sprint **não se remove código** — apenas classificação (ATIVO / EM MIGRAÇÃO / OBSOLETO / REMOVER).

---

## Build e qualidade

Relatório único: `PLATFORM_02_1_BUILD_REPORT.md`.
