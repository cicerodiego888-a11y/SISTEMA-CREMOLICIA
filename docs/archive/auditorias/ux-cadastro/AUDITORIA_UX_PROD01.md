# AUDITORIA — UX-PROD-01

**Data:** 2026-07-17  
**Tipo:** Pós-implementação (Quick Wins)

---

## Veredito

**APROVADO** — consolidação visual sem alteração de CORE.

---

## Evidências

| Critério | Evidência |
|----------|-----------|
| Unidade Base | `#label_unidade_produto` + tooltip SSOT |
| Física fora do Fiscal | Card próprio antes de UC / Estoque |
| Sem fator | Textos de física e UC01_TIPOS / TIPOS_META |
| Medida Física | `constants.js` + `metaTipoUc01` |
| Fantasmas | `saveProduto` sem `data_validade`/`lote` |
| MUC UI | Removida do modal (JS legado permanece) |
| Física Inicial | `#blocoConversaoFisicaInicial` (disabled) |

---

## Riscos / Pendências

| Item | Nota |
|------|------|
| Lote físico inicial | UI preparada; persistência em sprint futura |
| Mobile | Sem paridade nesta sprint |
| Abas por domínio | UX-PROD-02 / UX-03 |

---

## Smoke sugerido

1. Abrir Novo Produto — seções na ordem correta  
2. Marcar Conversão Física — painel Unidade Física  
3. Preencher estoque inicial > 0 + física — bloco Inicial aparece  
4. Editar produto com UC — tipo “Medida Física”  
5. Salvar — sem regressão de preços/fiscal/UC  
