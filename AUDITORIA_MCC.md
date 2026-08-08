# AUDITORIA CONSOLIDADA — MCC / Conversão / Estoque / Fiscal operacional

**Consolidado em:** 2026-07-30  
**Veredito global:** APROVADO (CORE) — ressalva: legados pré-MCC em migração  
**Histórico detalhado:** `docs/archive/auditorias/mcc/`

---

## Escopo

Homologação do Motor de Conversão Comercial (MCC), integrações PDV/Comercial/Compra/Fiscal e Motor de Estoque — sem reabrir algoritmos.

## Sprints / checklists unificados

| Sprint | Tema | Resultado |
|--------|------|-----------|
| MCC-HOM-01 | Homologação enterprise do motor | APROVADO (CORE) · ressalva legados |
| MCC-03 | Entrada operacional (Orchestrator → MCC → lote físico) | APROVADO |
| MCC-04 | Motor de Estoque só em unidade base | APROVADO |
| COM-01 | Motor Comercial → MCC → Estoque | APROVADO |
| EST-MCC-01 | Ajuste de estoque via Orchestrator | APROVADO |
| FIS-01 | Emissão fiscal sem recalcular conversão (snapshot UC) | APROVADO |

## Regras oficiais (síntese)

1. **Um produto → uma unidade base → N UCs → MCC → Estoque.**
2. Fator físico **não** vive no produto; conversão física é por **lote**.
3. MotorEstoque rejeita quantidade/unidade comercial.
4. PDV / Comercial / Compra / Fiscal **não** chamam `Converter` direto — usam orchestrators.
5. Fiscal / DANFE usam snapshot comercial; **não** recalculam UC na emissão.

## Ressalva aberta

Conversões legadas (`motorConversaoUnidades`, MUC, trechos de compras/produtos) ainda podem existir fora do MCC. **Nova integração deve consumir só o MCC.**

## Fontes arquivadas

`AUDITORIA_MCC_ENTERPRISE.md` · `AUDITORIA_MCC03.md` · `AUDITORIA_MCC04.md` · `AUDITORIA_COM01.md` · `AUDITORIA_EST_MCC01.md` · `AUDITORIA_FIS01.md` · `AUDITORIA_FORENSE_MCC_UX_IMPLEMENTACAO.md`
