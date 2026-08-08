# ADR — FinancialGateway (Facade Oficial do MFE)

**Código:** ADR-MFE-05.2-GATEWAY  
**Status:** Accepted  
**Data:** 2026-07-18  
**Sprint:** MFE-05.2  

Relacionado: `ADR_MOTOR_FINANCEIRO.md` · `ADR_BRIDGE_PDV_AR.md`

---

## Contexto

Bridges específicos (`PdvArBridge`, `ComercialArBridge`, orchestrators) chamavam o Pipeline diretamente.  
Esse modelo não escala para Compras, Marketplace, API, Fiscal, E-commerce e integrações.

---

## Decisão

1. Criar `FinancialGateway` como única porta pública do MFE.  
2. Gateway: validar · normalizar · resolver `FinancialContext` · publicar no Pipeline.  
3. Bridges e Orchestrators passam a ser adaptadores que delegam ao Gateway.  
4. Não remover bridges nesta sprint.  
5. Não alterar regras financeiras, flags, Caixa, AR, AP, PIX, TEF, Ledger ou Pipeline.  
6. `processarEvento` permanece apenas para uso interno / testes legados.

---

## Consequências

### Positivas
- Contrato único estável para a plataforma  
- Contextos financeiros centralizados  
- Escalabilidade para novos consumidores  

### Trade-offs
- Camada adicional (adaptadores temporários)  
- Cutover completo dos módulos externos fica para sprints futuras  

---

## Status

Accepted.
