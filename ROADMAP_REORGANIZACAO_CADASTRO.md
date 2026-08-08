# ROADMAP — Reorganização do Cadastro de Produtos

**Código:** ROADMAP_REORGANIZACAO_CADASTRO  
**Base:** `AUDITORIA_UX_CADASTRO.md` (histórico: `docs/archive/auditorias/ux-cadastro/AUDITORIA_ENTERPRISE_CADASTRO_PRODUTO.md`)  
**Data:** 2026-07-17  
**Premissa:** Sem alterar a arquitetura CORE (UC/MCC/Estoque). Reorganizar UX, responsabilidades e legado.

---

## Princípios

1. Um Produto → Uma Unidade Base → N UCs → MCC na operação.  
2. Cadastro **declara**; Entrada/Compra **mede**; MCC **converte**.  
3. Remover jargão “fator” do operador.  
4. Fases incrementais — sem big-bang.

---

## Fase UX-01 — Quick Wins (baixo risco)

**Status: ✅ CONCLUÍDA (UX-PROD-01 — 2026-07-17)**

**Objetivo:** Clareza sem mover blocos grandes / sem abas.

| Item | Impacto | Status |
|------|---------|--------|
| Renomear “Unidade” → “Unidade Base (estoque)” | Alto UX | ✅ |
| Separar visualmente Conversão Física do card fiscal | Médio | ✅ |
| Texto: peso na Entrada / Estoque Inicial | Alto | ✅ |
| Renomear tipo UC `CONVERSAO_FISICA` → Medida Física | Médio | ✅ |
| Remover ghosts `data_validade`/`lote` do payload | Baixo | ✅ |
| Aviso: UC após primeiro salvar | Médio | ✅ |
| Remover UI MUC do modal | Médio | ✅ |

Entregáveis: `UX_PROD_01.md` · `AUDITORIA_UX_PROD01.md`

---

## Fase UX-02 — Separação de conceitos de peso

**Status: ✅ CONCLUÍDA (UX-PROD-02 — 2026-07-17)**

**Objetivo:** Eliminar confusão “Vendido por Peso” × Conversão Física.

| Item | Status |
|------|--------|
| Seção “Venda no PDV” com fracionado / peso médio / preço UN | ✅ |
| Seção “Conversão Física (MCC)” isolada + badge | ✅ |
| Glossário curto (Base / UC / Física / Venda por Peso) | ✅ |
| Separação visual (cards, ícones, tooltips) | ✅ |
| Avaliar deprecar fracionado quando UC+MCC cobrir | ⏳ médio prazo |

Entregáveis: `UX_PROD_02.md` · `AUDITORIA_UX_PROD02.md`

---

## Fase UX-03 — Reorganização por abas/domínios

**Status: ✅ Domínios + Implantação + Auditoria visual**  
(UX-PROD-03 · 03.1 · **03.2**)

| Item | Status |
|------|--------|
| Ordem por domínio (sem abas) | ✅ UX-PROD-03 |
| Resumo Inteligente | ✅ |
| Cards padronizados | ✅ |
| Fluxo Implantação × Operação | ✅ UX-PROD-03.1 |
| Conversão Física Inicial (UI) | ✅ preparada (sem persistência) |
| Auditoria visual Enterprise | ✅ UX-PROD-03.2 → `AUDITORIA_VISUAL_ENTERPRISE_CADASTRO.md` |
| Decisão UX-04 | ✅ `RELATORIO_DECISAO_UX04.md` — **cards recolhíveis > abas** |
| Densidade / nav leve | ⏳ UX-PROD-04 (opcional / pontual — pós freeze) |
| Cards UC Enterprise | ✅ UX-PROD-05 |
| UC no primeiro cadastro (draft) | ⏳ melhoria pontual (não reorg) |

---

## Fase UX-PROD-05 — Cards UC (Enterprise Ready)

**Status: ✅ CONCLUÍDA (2026-07-17)**

Grade técnica substituída por cards de formas de comercialização (filtros, busca, ordenação, ações).  
**Cadastro de Produtos = Enterprise Ready — congelado para reorganização estrutural geral.**

Entregáveis: `UX_PROD_05.md` · `AUDITORIA_UX_PROD05.md`

---

## Fase UX-04 — Limpeza de legado + paridade

**Objetivo:** Código morto e mobile.

| Item | Impacto | Esforço |
|------|---------|---------|
| Remover UI MUC morta (após ADR) | Médio | Médio |
| Desligar painel “Motor Conversão Unidades” quando MCC ativo | Alto | Médio |
| Paridade mobile (UC + flag física) | Alto | Alto |
| Extrair cálculos de custo para serviço backend (opcional) | Médio | Alto |

**Estimativa:** 1–2 sprints (mobile separado).

---

## Ordem recomendada de implementação

```
UX-01 ✅ → UX-02 ✅ → UX-03 ✅ → 03.1 ✅ → 03.2 ✅
  → UX-PROD-05 ✅ (cards UC)  ← ENTERPRISE READY / FREEZE estrutural
  → UX-PROD-04 (cards recolhíveis) = melhoria pontual opcional
  → UX-04 (legado + mobile) = fora do freeze de reorg do cadastro desktop
```

Não iniciar UX-03 antes de UX-01/02 (reduz retrabalho de copy/labels).  
**Pós UX-PROD-05:** sem reorganização geral do Cadastro — só correções, pontuais ou novas features.

---

## O que esta roadmap NÃO faz

- Não muda SSOT / GOVERNANCE  
- Não move fator físico para o produto  
- Não implementa Caixa/MFE no cadastro  
- Não remove MCC-03 da compra  

---

## Critérios de sucesso

- Operador cadastra Sorvete Flocos sem perguntar o que é “fator”  
- Unidade Base e UC claramente distintos  
- Conversão Física só como flag + link mental à Compra  
- Zero UI MUC ativa  
- UC como cards (formas de comercialização) — ✅ UX-PROD-05  
- Mobile com paridade mínima UC + física  
- **Cadastro desktop Enterprise Ready** — ✅ pós UX-PROD-05  
