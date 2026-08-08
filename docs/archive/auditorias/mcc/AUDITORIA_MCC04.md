# AUDITORIA — MCC-04 Motor de Estoque

**Data:** 2026-07-17  
**Código:** MCC-04  
**Status:** APROVADO (implementação)

---

## Checklist de aceite

| # | Critério | Resultado |
|---|----------|-----------|
| 1 | Estoque conhece somente Unidade Base | OK |
| 2 | Nenhum cálculo de conversão no MotorEstoque | OK |
| 3 | API rejeita quantidade/unidade comercial e fator | OK |
| 4 | Entrada de compra usa `MotorEstoque.entrar` | OK |
| 5 | Ajustes usam `MotorEstoque.ajustar` | OK |
| 6 | Auditoria `estoque_movimentacoes` (só base) | OK |
| 7 | `loteId` preservado sem recalcular fator | OK |
| 8 | Reserva / inventário em quantidade base | OK |
| 9 | Compatibilidade (alias `quantidade` = base) | OK |
| 10 | Testes `npm run test:mcc04` | OK |

---

## Confirmação: Estoque nunca chama

| Proibido | Status no `motor-estoque/` |
|----------|----------------------------|
| `ConversorUnidades` | Ausente |
| `motorConversaoUnidades` | Ausente |
| `resolverBaixaEstoque` / `resolverEntradaEstoque` | Ausente |
| `Converter` (MCC) | Ausente (conversão fica no caller) |
| Helpers de fator / embalagem | Ausentes |

Gate automatizado no `mcc04.test.js`.

---

## Evidências

- Pacote: `backend/motores/motor-estoque/`
- Bootstrap schema em `database.js`
- Compras: UPDATE de saldo substituído por `MotorEstoque.entrar`
- `ajusteEstoqueService` delega saldo/auditoria oficial ao MotorEstoque

---

## Riscos residuais

| Risco | Nota |
|-------|------|
| PDV / Vendas ainda debitam saldo inline | Fora de escopo MCC-04; migrar depois para `MotorEstoque.sair` |
| MUC `resolverBaixaEstoque` ainda existe | Fora do MotorEstoque; não usado pela API de estoque CORE |
| `produtos_ajustes_estoque` mantido | Compatibilidade UI histórico; auditoria oficial = `estoque_movimentacoes` |

---

## Decisão

O Motor de Estoque é oficialmente agnóstico a unidades comerciais.  
Toda conversão permanece exclusiva do MCC.
