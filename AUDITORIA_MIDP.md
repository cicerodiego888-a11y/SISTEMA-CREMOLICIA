# AUDITORIA CONSOLIDADA — MIDP → NFC-e

**Consolidado em:** 2026-07-30  
**Caso original:** RC3.0.1 — produto 553 · 3 un · R$5 · PIX 10 + Dinheiro 5  
**Histórico detalhado:** `docs/archive/auditorias/midp/AUDITORIA_MIDP_NFCE_RC301.md`

---

## Veredito (diagnóstico RC3.0.1)

O `MidpDecisionResult` / `itensAjuste` **não chegava** à NFC-e quando:

- `midp_ativado = false` e/ou  
- política efetiva = `LEGADO`

Nesse modo: `decisao = null` → `aplicarDecisaoMidpNosItens` é no-op → XML usa máximo fiscal (`qCom=3` / `vProd=15` no caso), não PRESERVAR (`qCom=2` / `vProd=10`).

**Não é bug do XML/emissor:** o pipeline fiscal só lê o que foi persistido. Sem decisão MIDP, não há o que preservar.

## Follow-up — Sprint 3.8D.3.2

Configuração simplificada:

| Estado | Runtime |
|--------|---------|
| MIDP **Desativado** | Fluxo legado (como o caso auditado) |
| MIDP **Ativado** | Sempre `PreservarDinheiroPolicy` (sem escolha de política na UI) |

`midp_politica=LEGADO` em configs antigas migra para `PRESERVAR_DINHEIRO` ao salvar.

## Ação operacional

Para o caso 553 comportar-se como PRESERVAR: **ativar MIDP** em Configurações Avançadas e reemitir/testar smoke.

## Não alterado nesta auditoria

Algoritmo MIDP · Motor Fiscal · DistribuidorPagamento · builder XML · Financeiro · Estoque
