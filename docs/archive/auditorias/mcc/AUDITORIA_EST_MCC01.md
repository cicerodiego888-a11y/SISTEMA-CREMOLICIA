# AUDITORIA — EST-MCC-01

**Data:** 2026-07-17  
**Tipo:** Pós-implementação  

---

## Veredito

**APROVADO** — fluxo oficial Ajuste → Orchestrator → MCC → Motor Estoque respeitado.

---

## Evidências

| Critério | Evidência |
|----------|-----------|
| Sem conversão na UI | Preview via `POST .../ajuste-estoque/preview`; UI só exibe |
| Combo dinâmico | `GET .../ajuste-estoque/unidades` + `listarUnidadesAjuste` |
| Estoque só base | `prepararDeltasBase` → `aplicarAjusteEstoqueProduto` → `MotorEstoque.ajustar` |
| Física sem fator na UI | Unidade KG no combo; fator no lote via `aplicarParaBase` |
| Legado | Sem `unidade_origem` no body → deltas já em base |
| F12 | Campos NF ocultos / zerados no save |
| F7 Compra | Nenhuma alteração em `compras.js` |

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Ajuste em KG sem lote físico ativo | Erro MCC claro; aviso no modal |
| Mobile ainda sem combo UC | Paridade futura (UX-PROD-02) |

---

## Testes

```
npm run test:est-mcc01  → 9 OK
```

---

## Governança

Regra adicionada: telas que movimentam estoque consultam MCC para UCs — proibido lista fixa.
