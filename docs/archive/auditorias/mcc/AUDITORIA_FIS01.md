# AUDITORIA FIS-01 — Motor Fiscal × MCC

**Sprint:** FIS-01  
**Data:** 2026-07-17  
**Resultado:** APROVADO

---

## Checklist

| Regra | Status | Evidência |
|-------|--------|-----------|
| Sem `Converter` na emissão | OK | `FiscalOperacionalService` só lê `vendas_itens` |
| Sem × `fator_conversao` no XML | OK | `obterQuantidadeComercial` usa `quantidade` comercial |
| UC no `uCom`/`uTrib` | OK | `obterUnidadeDocumento` |
| Legado sem UC → base | OK | fallback `quantidade_fiscal` + `unidade` produto |
| Estoque fora do fiscal | OK | cancel SEFAZ sem stock; cancel venda = MotorEstoque |
| DANFE alinhado à UC | OK | `obterQuantidadeImpressao` / `obterUnidadeImpressao` |
| Auditoria `recalculouConversao: false` | OK | snapshot |

---

## Testes

```
npm run test:fis01
```

**Resultado:** 9 passou, 0 falhou (legado, NFC-e UC, Kg, pote/NF-e, cancelamento, xmlBuilder, export).

---

## Decisão oficial

Motor Fiscal consome o resultado MCC já persistido na venda.  
Não é autoridade de conversão nem de estoque.
