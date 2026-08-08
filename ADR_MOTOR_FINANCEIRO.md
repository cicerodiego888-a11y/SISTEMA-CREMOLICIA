# ADR — Motor Financeiro Enterprise (MFE)

**Código:** ADR-MFE-00  
**Status:** Accepted  
**Data:** 2026-07-17  
**Sprint:** MFE-00  

Substitui/amplia a diretriz de SSOT em `ADR_FINANCEIRO_SSOT.md` com a visão Enterprise (ledger, contratos, flags, migração).

---

## Contexto

A Plataforma CDS consolidou CORE (PLATFORM-02.1 / GOVERNANCE): MCC, Estoque, Comercial e Fiscal possuem SSOT claros. O domínio financeiro ainda opera com writers dispersos (auditoria FIN-01).

É necessário um motor CORE oficial — **MFE** — alinhado ao padrão event-driven já usado no Motor Comercial (outbox → bridge).

---

## Decisão

Adotar o **Motor Financeiro Enterprise (MFE)** como:

1. **SSOT** de todo dinheiro da empresa (caixa, banco, AR, AP, fluxo, conciliação, ledger).  
2. Consumidor exclusivo de **Eventos Financeiros** produzidos pelos demais módulos.  
3. Provedor de contratos públicos listados em `MFE_VISAO_ENTERPRISE.md`.  
4. Integrante oficial da **Arquitetura CORE** (`ARQUITETURA_CORE_CDS.md`).

### Regras

- Ledger **append-only** (correção = compensatório).  
- Nenhum módulo INSERT/UPDATE/DELETE em estruturas financeiras fora do MFE.  
- Conta corrente **comercial** permanece no Motor Comercial; efeito caixa/empresa só via evento.  
- Migração gradual; legado permanece até cutover por flag.

---

## Alternativas consideradas

| # | Alternativa | Motivo de rejeição |
|---|-------------|-------------------|
| 1 | Manter writers dispersos | Viola GOVERNANCE Regra 3; duplicidade |
| 2 | Facade de rotas sem ledger | Sem auditoria/idempotência enterprise |
| 3 | **MFE event-driven + ledger** | **Escolhida** |

---

## Consequências

### Positivas

- Uma autoridade financeira clara  
- Auditoria ponta a ponta (origem → evento → ledger)  
- Idempotência e estornos seguros  
- Alinhamento com GOVERNANCE e CORE  

### Negativas / custos

- Exige criar `backend/motores/motor-financeiro/` em sprints futuras  
- Dual-write/dual-read temporário  
- Disciplina de equipes nos produtores de eventos  

---

## Escopo desta ADR (MFE-00)

**Inclui:** visão, responsabilidades, SSOT, eventos, contratos, flags, migração, diagramas, roadmap.  

**Não inclui:** código operacional, schema, cutover de PDV/Compras.

---

## Referências

- `MFE_VISAO_ENTERPRISE.md`  
- `DIAGRAMA_MFE.md`  
- `ROADMAP_MFE.md`  
- `ADR_FINANCEIRO_SSOT.md`  
- `GOVERNANCE.md` (Regra 3)  
- `ARQUITETURA_CORE_CDS.md`  
