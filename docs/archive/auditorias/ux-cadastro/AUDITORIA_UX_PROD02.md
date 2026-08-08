# AUDITORIA — UX-PROD-02

**Data:** 2026-07-17  
**Tipo:** Pós-implementação UX

---

## Veredito

**APROVADO** — separação visual/conceitual PDV × MCC sem impacto em CORE.

---

## Evidências

| Critério | Evidência (`produtos.js`) |
|----------|---------------------------|
| Card Venda no PDV | Badge `PDV`, `#produto_fracionado` “Permite Venda Fracionada” |
| Card Conversão Física | Badge `MCC`, `#utiliza_conversao_fisica` |
| Separação | Glossário + seção UC entre os dois cards |
| Sem fator | Textos de física sem jargão técnico |
| IDs/payload | Inalterados (`produto_fracionado`, `utiliza_conversao_fisica`) |

---

## Smoke

1. Abrir cadastro — ver glossário  
2. Card verde PDV ≠ card azul MCC  
3. Ativar fracionado — não afeta painel física  
4. Ativar física — não afeta painel PDV  
5. Salvar produto — sem regressão  

---

## Pendências

- Mobile (UX-04)  
- Abas por domínio (UX-03)  
