# ADR — Versionamento da Conversão Física por Lote

**Status:** Aceito  
**Data:** 2026-07-17  
**Código:** MCC-02.1  
**Decisores:** Plataforma CDS

---

## Contexto

Após a entrada, a conversão física do lote pode precisar de correção (conferência em balança, erro de digitação, ajuste do fabricante). Substituir o registro apagaria o rastro histórico e comprometeria auditoria/estoque.

---

## Decisão

1. Conversões físicas são **versionadas** por lote.
2. Correções **nunca** fazem UPDATE de `quantidade_base` / `quantidade_destino` / `fator`.
3. Correção = **nova versão** + desativação da anterior (`ativa=0`).
4. Apenas **uma** versão ativa por lote.
5. O MCC **sempre** usa a versão ativa.
6. Exclusão de versões é **proibida**.
7. Motivos oficiais via `MotivoVersaoConversao`.

---

## Consequências

### Positivas
- Rastreabilidade completa
- Auditoria de quem/quando/por quê
- Consistência histórica

### Trade-offs
- Mais registros por lote
- Consumidores devem sempre ler a ativa (nunca cachear versão antiga sem invalidar)

---

## Alternativas rejeitadas

| Alternativa | Motivo |
|-------------|--------|
| UPDATE in-place | Perde histórico |
| Soft-delete + recriação sem vínculo | Sem `substitui_id` |
| Fator no produto | Já rejeitado em MCC-02 |

---

## Referências

- `MCC_02_1_VERSIONAMENTO.md`
- `ADR_CONVERSAO_FISICA_LOTE.md`
- `ADR_MOTOR_CONVERSAO_COMERCIAL.md`
