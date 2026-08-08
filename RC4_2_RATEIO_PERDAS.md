/**
 * RC4.2 — Rateio Inteligente de Perdas (Consignação)
 *
 * Substitui o conceito informal de "perda descontada" por rateio explícito
 * (Cliente / Empresa / Compartilhada) na Prestação de Contas.
 */

## Objetivo

Definir corretamente quem assume o prejuízo das perdas na prestação, com
entrada monetária, motivo obrigatório, auditoria e estrutura para relatórios.

## Arquivos alterados / criados

### Backend
- `backend/motores/motor-comercial/domain/RateioPerda.js`
- `backend/motores/motor-comercial/migrations/011_rateio_perdas.js`
- `backend/motores/motor-comercial/migrations/index.js`
- `backend/motores/motor-comercial/repositories/PrestacaoRateioPerdaRepository.js`
- `backend/motores/motor-comercial/usecases/consignacao/DefinirRateioPerdaUseCase.js`
- `backend/motores/motor-comercial/usecases/consignacao/ConsultarRateioPerdaUseCase.js`
- `backend/motores/motor-comercial/usecases/consignacao/index.js`
- `backend/motores/motor-comercial/controllers/ConsignacaoController.js`
- `backend/motores/motor-comercial/controllers/ProjectionController.js`
- `backend/motores/motor-comercial/routes/comercial.routes.js`
- `backend/motores/motor-comercial/infrastructure/di/bootstrapComercial.js`
- `backend/motores/motor-comercial/infrastructure/di/bootstrapUseCases.js`
- `backend/motores/motor-comercial/services/CreditoComercialService.js` (`perdaAssumidaCliente`)
- `backend/motores/motor-comercial/services/sincronizarCreditoComercial.js`
- `backend/motores/motor-comercial/tests/rc42-rateio-perdas.test.js`

### Frontend
- `frontend/modules/motor-comercial/api/MotorComercialApi.js`
- `frontend/modules/motor-comercial/pages/PrestacaoContas/rateioPerdaDomain.js`
- `frontend/modules/motor-comercial/pages/PrestacaoContas/rateioPerdaUi.js`
- `frontend/modules/motor-comercial/pages/PrestacaoContas/FecharConsignacaoView.js`
- `frontend/modules/motor-comercial/pages/PrestacaoContas/index.js`
- `frontend/modules/motor-comercial/pages/PrestacaoContas/styles.css`

## Migrações

**`011_rateio_perdas`**

| Tabela | Uso |
|--------|-----|
| `prestacao_rateio_perdas` | SSOT do rateio por `grupo_prestacao_contas_id` |
| `prestacao_rateio_perdas_auditoria` | Log append-only de alterações |

Campos: `tipo_rateio`, `valor_total_perdas`, `valor_cliente`, `valor_empresa`,
`percentual_cliente`, `percentual_empresa`, `motivo_perda`, `observacao_perda`,
`usuario_id`, timestamps.

## Endpoints

| Método | Rota | Função |
|--------|------|--------|
| `GET` | `/api/comercial/consignacoes/:id/prestacao/rateio-perda` | Consulta rateio + resumo + motivos + auditoria |
| `PUT` | `/api/comercial/consignacoes/:id/prestacao/rateio-perda` | Define rateio (cálculo + validação + auditoria + crédito) |
| `GET` | `/api/comercial/projections/rateio-perdas/indicadores` | Agregados para futuros relatórios |

Body PUT: `tipoRateio`, `valorCliente`, `valorEmpresa`, `campoEditado`,
`motivoPerda`, `observacaoPerda`, `usuarioId`.

## Regras implementadas

1. Toda perda tem responsável financeiro: **Cliente**, **Empresa** ou **Compartilhada**.
2. Cliente 100% → desconto integral no consignado (`perdaAssumidaCliente`).
3. Empresa 100% → nenhum desconto no consignado; perda operacional (estoque/despesa de PERDA permanece).
4. Compartilhada → entrada em R$; o outro lado é calculado automaticamente.
5. Percentuais são apenas informativos (não editáveis).
6. Sempre `valorCliente + valorEmpresa == valorTotalPerdas` (±0,01).
7. Motivo obrigatório (lista inicial); **Outro** exige observação.
8. Cada `DEFINIR` gera linha de auditoria (usuário, data/hora, tipo, valores, motivo, obs).
9. Fluxo operacional de consignação (grade, venda, devolução, pagamento, NFC-e) **não** muda — só o cálculo financeiro da perda.

## Impactos na Prestação de Contas

- Card **Rateio da Perda** (Retornos e Estação Operacional quando há perdas).
- **Resumo Financeiro** estendido: Venda, Recebido, Perdas, Cliente assume, Empresa assume, Valor líquido do consignado.
- Crédito comercial sincronizado com a parcela assumida pelo cliente.

## Testes executados

Arquivo: `backend/motores/motor-comercial/tests/rc42-rateio-perdas.test.js`

- ✔ Cliente assume 100%
- ✔ Empresa assume 100%
- ✔ Compartilhado
- ✔ Digitação pelo campo Cliente
- ✔ Digitação pelo campo Empresa
- ✔ Validação dos totais
- ✔ Percentuais automáticos
- ✔ Motivos da perda (obrigatório / OUTRO)
- ✔ Resumo financeiro

## Relatórios (estrutura preparada)

Endpoint de indicadores agrega base para:
Total perdido · Perda cliente · Perda empresa · Por motivo · Por consignado · Por período · Maior índice.

## Possíveis evoluções futuras

1. Rateio **por item** (hoje é por grupo de prestação).
2. Contabilização diferenciada EMPRESA vs CLIENTE no ledger (centro de custo / conta contábil).
3. Dashboard visual de perdas na Central Comercial.
4. Bloquear encerramento se houver perda sem rateio persistido.
5. Integração com apólice/seguro de freezer (motivo DEFEITO_FREEZER).

## Como validar na UI

1. Reiniciar o backend (`npm start`) para aplicar migração 011.
2. `npm run build:motor-comercial` + Ctrl+F5.
3. Abrir Prestação com perdas registradas → card Rateio → salvar → conferir Resumo Financeiro.
