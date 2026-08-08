# Arquitetura Geral — Plataforma CDS

Documento vivo da arquitetura CORE. Atualizado conforme motores oficiais.

> **Referência principal (PLATFORM-02.1):** [`ARQUITETURA_CORE_CDS.md`](./ARQUITETURA_CORE_CDS.md)  
> **Governança obrigatória:** [`GOVERNANCE.md`](./GOVERNANCE.md) (v1.0.0)  
> Satélites: `PLATFORM_CORE.md` · `SSOT_OFICIAL.md` · `CORE_SERVICES.md` · `DEPENDENCIAS_OFICIAIS.md` · `ROADMAP_MOTORES.md`

---

## Dimensões comerciais independentes (A-1)

> Categoria ≠ Política Comercial. Conceitos evoluem em separado.

| Conceito | Papel |
|----------|--------|
| Categoria | Classificação do produto |
| Política Comercial | Estratégia comercial (`linhas_comerciais` interno) |
| Canal | Onde ocorre a venda |
| Tabela de Preço | Superfície de configuração |
| Pricing Engine | Motor único de decisão (evolução) |

Categoria **não cria** Política. Produto ↔ Políticas em N:N. Sem política explícita = todas habilitadas.  
ADR: `ADR_A1_POLITICA_COMERCIAL.md` · `docs/A1_POLITICA_COMERCIAL.md`

---

## Princípio de produto e estoque

> **Um Produto → Uma Unidade Base (SSOT) → N Unidades de Comercialização → MCC → Estoque.**

| Camada | Responsabilidade | Motor / artefato |
|--------|------------------|------------------|
| Cadastro de UCs | Definir unidades comerciais, canais, prioridade | UC-01 · `backend/motores/unidades-comercializacao/` |
| Flags de física no produto | Declarar exigência (sem fator) | `utiliza_conversao_fisica` · `unidade_conversao_fisica` |
| Entrada de Mercadorias | Coletar peso/volume; **única** origem de ConversaoFisicaLote; movimenta estoque base | **MCC-03** · `EntradaMercadoriasOperacionalService` → Orchestrator |
| Conversão física versionada | Histórico + versão ativa por lote | MCC-02.1 · `conversoes_fisicas_lotes` |
| Conversão comercial → base / física | Calcular quantidades (sempre versão ativa) | **MCC CORE** · `Converter` / `CalcularConversaoFisica` |
| Estoque | Persistir e movimentar **somente** quantidade na unidade base | **MCC-04** · `backend/motores/motor-estoque/` |
| Fiscal / MUC | Unidades fiscais e legado | MUC — **a migrar para MCC** |

**Proibido:** fator físico no produto · UPDATE de versões históricas · DELETE de versões · criar ConversaoFisicaLote fora da Entrada · **novas** regras de conversão fora do MCC · estoque por Unidade Comercial · conversão dentro do Motor de Estoque.

---

## Motor de Conversão Comercial (MCC) — CORE OFICIAL

- **Status homologação:** **APROVADO** (MCC-HOM-01 · 2026-07-17)
- **Interface:** `Converter()` / `ConverterAsync()` / `CalcularConversaoFisica()` / APIs de versão
- **Orchestrator Compra:** `CompraConversaoOrchestrator`
- **Entrada operacional:** `EntradaMercadoriasOperacionalService` (MCC-03)
- **Orchestrator PDV:** `PdvConversaoOrchestrator` + `PdvVendaOperacionalService` (PDV-01)
- **Orchestrator Comercial:** `ComercialConversaoOrchestrator` + `ComercialOperacionalService` (COM-01)
- **Fiscal:** `FiscalOperacionalService` (FIS-01) — read-only sobre snapshot da venda
- **Motor de Estoque:** `MotorEstoque` (MCC-04) — só `quantidadeBase`
- **Docs:** `MCC_HOMOLOGACAO_FINAL.md` · `MCC_03_ENTRADA_OPERACIONAL.md` · `MCC_04_ESTOQUE.md` · `PDV_01_MIGRACAO_MCC.md` · `COM_01_MCC.md` · `FIS_01_MCC.md` · ADRs / MCC_0x

### Decisão pós-homologação / MCC-03 / MCC-04 / PDV-01 / COM-01 / FIS-01

- **Compras / Entrada:** MCC converte → MotorEstoque persiste quantidade base.
- **Estoque:** agnóstico a UC; sem conversão interna.
- **PDV:** MCC converte (`contexto=PDV`) → `MotorEstoque.sair` / estorno `entrar` (**PDV-01**).
- **Motor Comercial:** MCC converte (`contexto=COMERCIAL`) → entrega/devolução via MotorEstoque (**COM-01**).
- **Motor Fiscal:** consome snapshot MCC/UC da venda (**FIS-01**) — sem recalcular; sem movimentar estoque.
- Legados (`motorConversaoUnidades`, MUC Conversor) permanecem fora dos caminhos oficiais.

---

## Unidades de Comercialização (UC)

- **Status:** UC-01 + UC-01.1
- **Docs:** `UC_01_ARQUITETURA.md` · `ADR_UNIDADES_COMERCIALIZACAO.md`

---

## Changelog arquitetural recente

| Código | Tema |
|--------|------|
| UC-01 / UC-01.1 | Fundação e refinamento das UCs |
| MCC-01 | Fundação do Motor de Conversão Comercial |
| MCC-02 | Conversão Física por Lote |
| MCI-01 | Integração Entrada de Mercadorias × MCC (infra) |
| MCC-02.1 | Versionamento da Conversão Física |
| **MCC-HOM-01** | Homologação Enterprise — MCC CORE oficial |
| **MCC-03** | Integração operacional Entrada → quantidade base |
| **MCC-04** | **Motor de Estoque — somente Unidade Base** |
| **PDV-01** | **PDV → MCC → MotorEstoque (venda/estorno)** |
| **COM-01** | **Motor Comercial → MCC → MotorEstoque (consignação)** |
| **FIS-01** | **Motor Fiscal → snapshot MCC/UC (NFC-e/NF-e)** |
| **PLATFORM-02.1** | **Consolidação Arquitetura CORE oficial** |
| **MFE-00** | **Visão Motor Financeiro Enterprise (SSOT financeiro)** |
| **MFE-01** | **Fundação MFE (Ledger · Event Store · Contratos · Flags OFF)** |
| **MFE-02** | **Pipeline oficial de eventos financeiros (única porta)** |
| **MFE-03** | **Ledger financeiro operacional (auto-lançamentos)** |
