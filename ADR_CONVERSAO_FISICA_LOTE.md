# ADR — Conversão Física por Lote

**Status:** Aceito  
**Data:** 2026-07-17  
**Código:** MCC-02  
**Decisores:** Plataforma CDS

---

## Contexto

Produtos como sorvete exigem conversão L ↔ Kg, porém a densidade/peso varia por lote de compra. Armazenar fator no cadastro do produto gera inconsistência entre lotes e viola o SSOT comercial.

---

## Decisão

1. Conversão física **pertence ao lote** (`ConversaoFisicaLote` / `conversoes_fisicas_lotes`).
2. Produto declara apenas `utiliza_conversao_fisica` + `unidade_conversao_fisica` — **sem fator**.
3. O MCC é o único responsável por resolver a física via fator do lote.
4. Ausência de lote/fator → `ConversaoFisicaObrigatoriaError` (oficial, reutilizável).
5. Relação: Lote **1:1** Conversão Física; Produto **1:N** Conversões.
6. Integração com Compras/Estoque/PDV/Fiscal **não** ocorre nesta sprint — só infraestrutura.

### Arquitetura congelada

```
Produto → Unidade Base → UCs → Lote → Conversão Física → MCC
```

### Arquitetura proibida

```
Produto → Fator Litro/Kg
```

---

## Consequências

### Positivas
- Fatores reais por lote
- Consistência cross-módulo via MCC
- Cadastro de produto permanece simples

### Trade-offs
- Toda movimentação futura de produto físico exigirá contexto de lote
- Entrada de compra (sprint futura) deverá gravar `ConversaoFisicaLote`

---

## Alternativas rejeitadas

| Alternativa | Motivo |
|-------------|--------|
| Fator médio no produto | Distorce lotes |
| Fator por unidade comercial UC | Mistura matemática com física |
| Validação local em cada módulo | Duplicação; erro oficial existe |

---

## Referências

- `MCC_02_CONVERSAO_FISICA_LOTE.md`
- `ADR_MOTOR_CONVERSAO_COMERCIAL.md`
- `backend/motores/motor-conversao-comercial/`
