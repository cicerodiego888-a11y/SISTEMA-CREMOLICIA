# AUDITORIA CONSOLIDADA — PDV × UC-01 × MCC

**Consolidado em:** 2026-07-30  
**Veredito global:** APROVADO / estável — Forma de Venda via UC-01; estoque em base via MCC; fiscal por snapshot  
**Histórico detalhado:** `docs/archive/auditorias/pdv/`

---

## Linha do tempo

| Fase | Tema | Resultado |
|------|------|-----------|
| PDV-01 | Migração PDV → MCC → MotorEstoque | APROVADO |
| Forense modal | Modal mostrava Unidade Base (L) em vez de Forma de Venda PDV (KG) | Causa: parse ignorava `items` UC-01 + MUC legado |
| PDV-UC-02 | Cutover: modal consome só UC-01 | APROVADO |
| STAB-PDV-01 | Auditoria final estabilização | Quase enterprise / estável |

## Respostas oficiais (estado atual)

| Pergunta | Resposta |
|----------|----------|
| MUC decide Forma de Venda? | **Não** — fonte = UC-01 |
| Modal usa Unidade Comercial? | **Sim**, canal PDV |
| Conversão no front? | **Não** com UC (legado só sem UC) |
| Estoque recebe base? | **Sim**, via MCC em `VendaPagamentoService` |
| Fiscal recalcula UC? | **Não** — snapshot |
| Estorno reconverte? | **Não** — devolve quantidades já em base |

## Fontes arquivadas

`AUDITORIA_PDV01.md` · `AUDITORIA_PDV_UNIDADE_MODAL_UC.md` · `AUDITORIA_PDV_UC02.md` · `AUDITORIA_FINAL_PDV.md`
