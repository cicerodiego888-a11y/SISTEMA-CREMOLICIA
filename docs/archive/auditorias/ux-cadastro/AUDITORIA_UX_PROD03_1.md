# AUDITORIA — UX-PROD-03.1

**Data:** 2026-07-17  
**Tipo:** Pós-implementação (UX)  
**Veredito:** APROVADO

---

## Evidências

| Critério | Evidência |
|----------|-----------|
| Fase Implantação × Operação | `#bannerFaseCadastroProduto` + `avaliarFaseCadastroProduto` |
| Campos identificados | `CAMPOS_IMPLANTACAO_PRODUTO` + `data-campo-implantacao` |
| Infra bloqueio preparada | `prepararBloqueioImplantacaoProduto` (metadados; sem lógica definitiva extra) |
| Física Inicial (peso, sem fator) | `#blocoConversaoFisicaInicial` — título “Conversão Física do Estoque Inicial” |
| Aviso Ajuste de Estoque | Banner Fase 2 + texto sob saldos em operação |
| F12 | Ramos `modoFiscal` em `montarHtmlCamposEstoqueProduto` |
| Sem motores/API/DB | Diff apenas `frontend/erp/js/produtos.js` + docs |

---

## Smoke sugerido

1. Novo produto → banner **Fase 1 — Implantação**  
2. Marcar Conversão Física + estoque > 0 → bloco peso aparece (disabled)  
3. Produto com `tem_movimentacoes` → banner **Fase 2**, saldos readonly, texto Ajuste de Estoque  
4. F12 ON → só fiscal; F12 OFF → fiscal + NF  
5. Salvar sem regressão  

---

## Riscos / Pendências

| Item | Status |
|------|--------|
| Persistência lote inicial / peso | Sprint futura |
| Bloqueio definitivo de todos os campos implantação | Preparado; reforço futuro |
| Abas | UX-PROD-04 |

---

## Governança

Regra 6.3 — Fluxo Implantação × Operação (UX-PROD-03.1)
