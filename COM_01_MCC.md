# COM-01 — Integração Oficial do Motor Comercial ao MCC

**Código:** COM-01  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17

---

## Objetivo

Migrar o Motor Comercial para consumir exclusivamente o **MCC** e o **Motor de Estoque** nas operações de consignação.

O Motor Comercial permanece responsável por: consignação, crédito comercial e prestação de contas.  
**Não** calcula fator nem conversão.

---

## Fluxos

### Entrega
```
Produto → UC → Quantidade → MCC → quantidadeBase → MotorEstoque.sair(origem=CONSIGNACAO)
```

### Devolução
```
Quantidade comercial → MCC → quantidadeBase → MotorEstoque.entrar(origem=DEVOLUCAO)
```

### Prestação (venda / cortesia)
```
Quantidade comercial → MCC → quantidadeBase → Ledger Comercial
```
(Estoque físico já baixado na entrega.)

### Perda
```
Quantidade comercial → MCC → quantidadeBase → Ledger + outbox ESTOQUE_REGISTRAR_PERDA
```
Política: estoque já saiu na entrega (`JA_BAIXADO_ENTREGA`). MCC alimenta auditoria/base no ledger.

### Crédito comercial
Sem alteração — SSOT do Motor Comercial. MCC só resolve quantidades.

---

## Artefatos

| Artefato | Caminho |
|----------|---------|
| Orchestrator | `integracao/comercial/ComercialConversaoOrchestrator.js` |
| Operacional | `integracao/comercial/ComercialOperacionalService.js` |
| Gateway estoque | `motor-comercial/bridges/platform/EstoquePlatformGateway.js` |
| Helper UC | `motor-comercial/services/mccQuantidadeComercial.js` |
| Testes | `npm run test:com01` |

---

## Critérios de aceite

- [x] Entrega usa MCC → MotorEstoque.sair
- [x] Devolução usa MCC → MotorEstoque.entrar
- [x] Prestação (venda/cortesia) usa MCC no ledger
- [x] Perda usa MCC (+ outbox estoque documental)
- [x] Estoque recebe apenas quantidade base
- [x] Legado sem UC = identidade na base
- [x] Testes `test:com01`

---

## Fora de escopo

Fiscal · Financeiro · E-commerce
