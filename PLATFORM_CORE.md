# PLATFORM CORE — Visão executiva

**Sprint:** PLATFORM-02.1  
**Marco:** PLATFORM-02 — Arquitetura CORE Oficial  
**Data:** 2026-07-17

---

## O que é o CORE

Conjunto de motores e cadastros **homologados** que toda nova funcionalidade deve consumir:

1. **UC-01** — Unidades de Comercialização  
2. **MCC** — Conversão Comercial (única autoridade de conversão)  
3. **Motor Estoque** — Saldo e movimentação em unidade base  
4. **Motor Comercial** — Crédito, consignação, ledger  
5. **Motor Fiscal** — NFC-e / NF-e (consome snapshot; não converte)

Referência completa: `ARQUITETURA_CORE_CDS.md`.  
Governança obrigatória: `GOVERNANCE.md` (v1.0.0).

---

## Motores homologados (marco PLATFORM-02)

| Motor / Trilha | Status |
|----------------|--------|
| MCC | Homologado |
| Motor Estoque | Homologado |
| Motor Comercial | Homologado (COM-01 × MCC) |
| Motor Fiscal | Homologado (FIS-01 × MCC) |
| Compras (entrada) | Homologado (MCC-03) |
| PDV | Homologado (PDV-01) |

---

## Regra de ouro

> Toda nova funcionalidade deverá consumir estes motores.  
> Proibida a duplicação de regras já consolidadas.

---

## Motor Financeiro Enterprise (MFE)

- **Status:** **MFE-03 Ledger Operacional** — auto-lançamentos via pipeline; flags OFF  
- **Docs:** `MFE_03_LEDGER_OPERACIONAL.md` · `MFE_02_PIPELINE_EVENTOS.md` · `ROADMAP_MFE.md`  
- **Testes:** `npm run test:mfe` (mfe01+02+03)

## Próximos motores / canais

Ver `ROADMAP_MOTORES.md`: Produção, E-commerce, WMS, CRM, Portal do Contador (consomem CORE + MFE quando houver dinheiro).
