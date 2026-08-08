# FIS-01 — Integração Oficial do Motor Fiscal ao MCC

**Código:** FIS-01  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17

---

## Objetivo

O Motor Fiscal (NFC-e / NF-e) passa a consumir o **snapshot MCC** da operação original.  
**Não** recalcula conversões, fatores nem movimenta estoque.

---

## Arquitetura

```
Venda (PDV/COM → MCC → MotorEstoque)
  → vendas_itens (UC, qtd comercial, fator audit, qtd base fiscal)
  → FiscalOperacionalService.mapearItemDocumento  (READ ONLY)
  → XML NFC-e / NF-e
```

---

## Responsabilidades

| Motor Fiscal | Não faz |
|--------------|---------|
| Emitir XML | Conversão |
| Validar regras fiscais | Cálculo de fator |
| Registrar UC no documento | Conversão física |
| | Controle de estoque |

---

## Unidade no documento

`uCom` / `uTrib` = Unidade Comercial da venda; se ausente → Unidade Base (legado).

Exemplos: `KG`, `P200`, `P500`, `L`, `UN`.

---

## Cancelamento / estorno

Cancelamento SEFAZ não movimenta estoque.  
Cancelamento de venda → `MotorEstoque.entrar` com **quantidade base** já persistida (`quantidade_fiscal` / `nao_fiscal`) — sem reconversão (PDV-01).

---

## Artefatos

| Artefato | Caminho |
|----------|---------|
| Serviço | `integracao/fiscal/FiscalOperacionalService.js` |
| NFC-e XML | `services/fiscal/xmlBuilder.js` |
| DANFE | `services/fiscal/danfe.js` |
| Validação | `services/fiscal/unidadeFiscal.js` |
| Testes | `npm run test:fis01` |

---

## Critérios de aceite

- [x] Fiscal não realiza conversões
- [x] Documento registra UC da operação
- [x] Estoque permanece no MotorEstoque
- [x] MCC é a autoridade de conversão (na venda)
- [x] Testes `test:fis01`

---

## Fora de escopo

Financeiro · E-commerce · Portal do Contador
