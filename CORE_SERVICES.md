# CORE Services — Contratos públicos congelados

**Sprint:** PLATFORM-02.1  
**Regra:** qualquer alteração nestes contratos exige **ADR**.

---

## 1. MCC — `backend/motores/motor-conversao-comercial`

### Interfaces / funções públicas

| Contrato | Tipo |
|----------|------|
| `Converter` / `ConverterAsync` / `converter` | API principal |
| `CalcularConversaoFisica` | Conversão física |
| `consultarConversaoAtiva` / `consultarHistorico` / `criarNovaVersao` / `criarVersaoInicial` | Versionamento |
| `limparCache` | Cache |
| `validarEntradaConverter` / `normalizarContexto` | Validação |
| Bootstrap schema MCC | Infra |

### Orchestrators / Adapters

| Contrato | Canal |
|----------|-------|
| `CompraConversaoOrchestrator` / `entradaOperacional` | Compras |
| `PdvConversaoOrchestrator` / `pdvOperacional` | PDV |
| `ComercialConversaoOrchestrator` / `comercialOperacional` | Comercial |
| `FiscalOperacionalService` / `fiscalOperacional` | Fiscal (read-only) |
| `ModoEntradaConversao` | Enum/modo entrada |

### Domain / DTOs

`UnidadeComercial` · `ResultadoConversao` · `ConversaoFisicaLote`

### Enums

`TipoConversao` · `ContextoConversao` · `OrigemConversaoFisica` · `MotivoVersaoConversao` · `MOTOR_NOME` · `MOTOR_VERSAO`

### Errors

`ConversaoFisicaObrigatoriaError` · `ConversaoFisicaImutavelError` · `PesoInvalidoError` · `VolumeInvalidoError` · `UnidadeNaoPermitidaError`

### Services internos (públicos via index — uso preferencial via Converter/orchestrator)

`ConversaoComercialService` · `ConversaoAgrupamentoService` · `ConversaoFracionamentoService` · `ConversaoFisicaService` · `ConversaoCompostaService` · `ConversaoFisicaCalculator` · `ConversaoFisicaLoteService` · `ConversaoCache`

---

## 2. Motor Estoque — `backend/motores/motor-estoque`

| Contrato | Tipo |
|----------|------|
| `entrar` / `sair` / `ajustar` / `inventariar` / `reservar` / `liberarReserva` / `consultarSaldo` | API |
| `MotorEstoqueService` / `motor` | Serviço |
| `MovimentacaoEstoque` | Domain |
| `OperacaoEstoque` / `OrigemEstoque` | Enums |
| `QuantidadeComercialRejeitadaError` | Error |
| `ProdutoSaldoRepository` / `EstoqueMovimentacaoRepository` | Repos (avançado) |
| `bootstrapMotorEstoqueSchema` | Infra |

---

## 3. UC-01 — `backend/motores/unidades-comercializacao`

| Contrato | Tipo |
|----------|------|
| Facade `listar` / `criar` / `atualizar` / `excluir` | API |
| `toUnidadeComercialDTO` | DTO |
| Constants / validators / bootstrap | Suporte |

---

## 4. Motor Comercial — `backend/motores/motor-comercial`

| Contrato | Tipo |
|----------|------|
| `inicializar` / `encerrar` / `obterContainer` / `estaInicializado` | Lifecycle |
| `usecases.perfil` / `usecases.consignacao` | Use cases |
| `dto` / `errors` / `contracts` / `projections` / `repositories` | Namespaces |
| `InfrastructureError` / `VERSAO_MODULO` | Meta |
| Bridges platform (EstoquePlatformGateway via DI) | Adapter |

Eventos / outbox: contratos em `domain/events` e bridges (alteração → ADR).

---

## 5. Motor Fiscal

| Contrato | Tipo |
|----------|------|
| `buildNfceXml` e helpers em `services/fiscal/xmlBuilder.js` | Emissão |
| DANFE (`danfe.js`) | Impressão |
| `FiscalOperacionalService.mapearItemDocumento` | Snapshot UC (via MCC) |
| Validadores `unidadeFiscal.js` | Regras fiscais |

---

## 6. MFE — Motor Financeiro Enterprise (MFE-07)

Pacote: `backend/motores/motor-financeiro/` — flags OFF por default.

| Contrato | Tipo |
|----------|------|
| **`FinancialGateway`** | **Porta pública oficial** — Caixa · AR · AP · **Liquidação** |
| `FinancialSettlement` / `FinancialSettlementHandler` | **Domínio Liquidação (MFE-07)** |
| `publicarLiquidacao` / `publicarPix` / `publicarTef` / … | Métodos de liquidação no Gateway |
| `MeioFinanceiro` | Enum consolidado (DINHEIRO…OUTRO) |
| `FEATURE_MFE_SETTLEMENT` | Flag piloto liquidação (default OFF) |
| `PurchasePayableBridge` / `FEATURE_MFE_AP` | AP / Compras |
| Bridges AR / `FEATURE_MFE_AR*` | Contas a Receber |
| `FinancialCashHandler` / `FEATURE_MFE_CAIXA` | Caixa |
| Outbox / Dead Letter / Audit | Observabilidade |

Docs: `MFE_07_SETTLEMENT.md` · `FINANCIAL_EVENTS_CATALOG.md` · `MFE_06_CONTAS_PAGAR.md` · `ROADMAP_MFE.md`.

---

## 7. Comunicação oficial

```
Consumidor → FinancialGateway → Pipeline → Ledger → Handlers
Liquidação → publicarLiquidacao / publicarPix… → FinancialSettlementHandler
```

Não publicar paths internos (`Pipeline`, `Ledger`, `repositories`) como contrato estável — preferir `FinancialGateway`.
