# AUDITORIA COM-01 — Motor Comercial × MCC × MotorEstoque

**Sprint:** COM-01  
**Data:** 2026-07-17  
**Resultado:** APROVADO

---

## Checklist

| Regra | Status | Evidência |
|-------|--------|-----------|
| Entrega → MCC → sair | OK | `EstoquePlatformGateway.registrarSaida` → `baixarEstoqueEntrega` |
| Devolução → MCC → entrar | OK | `entrarEstoqueDevolucao` |
| Prestação venda → MCC | OK | `RegistrarVendaPrestacaoUseCase` + `resolverQuantidadeBaseMcc` |
| Perda → MCC | OK | UC + outbox `ESTOQUE_REGISTRAR_PERDA` |
| Cortesia → MCC | OK | ledger com quantidade base / auditoria |
| Sem ConversorUnidades no Motor Comercial | OK | não existia; gateway não usa mais ajuste legado direto |
| Estoque só quantidadeBase | OK | MotorEstoque rejeita campos comerciais |
| Crédito comercial intacto | OK | `sincronizarCreditoComercial` inalterado |
| FEFO na entrega | OK | `consumirLotesFEFO` antes do `sair` |
| Legado sem UC | OK | identidade na unidade base |

---

## Política perda × estoque físico

Na arquitetura atual a **ENTREGA** já debita o armazém.  
Perda/cortesia/venda prestação **não** devem debitar novamente.

COM-01: perda usa MCC para quantidade base no ledger e registra outbox documental (`JA_BAIXADO_ENTREGA`).  
`forcarAjusteFisico` existe apenas para cenários excepcionais.

---

## Testes

```
npm run test:com01
```

---

## Decisão oficial

Motor Comercial consome MCC para toda conversão de quantidade.  
Movimentação física de consignação: apenas via MotorEstoque após MCC.
