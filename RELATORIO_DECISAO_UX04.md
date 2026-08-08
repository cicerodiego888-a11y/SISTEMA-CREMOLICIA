# RELATÓRIO DE DECISÃO — UX-PROD-04

**Código:** RELATORIO_DECISAO_UX04  
**Origem:** UX-PROD-03.2 — Auditoria Visual Enterprise  
**Data:** 2026-07-17  
**Status:** DECISÃO (sem implementação)

---

## Contexto

UX-PROD-04 estava planejada como **abas por domínio**.  
A auditoria visual pós UX-PROD-01→03.1 recomenda **revisar** esse escopo.

---

## Decisão oficial

| Pergunta | Resposta |
|----------|----------|
| Abas clássicas como próximo passo obrigatório? | **NÃO** |
| Cards recolhíveis como abordagem preferida? | **SIM** |
| Tela atual suficiente sem mudança? | **Quase** — melhorias de densidade ainda valem |

---

## Escopo recomendado para UX-PROD-04 (revisado)

**Nome sugerido:** UX-PROD-04 — Densidade Progressiva (Cards Recolhíveis + Navegação Leve)

### Incluir

1. Cards recolhíveis por domínio (defaults: 1–3 abertos em novo; 4–9 recolhidos ou sob demanda)  
2. Manter Fiscal já em collapse; alinhar Avançado / Comercial-atacado  
3. Mini-nav ou âncoras sticky (Resumo + saltos 1–9) — **sem** trocar o formulário por abas Bootstrap  
4. Ampliar modal da grade UC (`modal-xl` ou painel dedicado) / agrupar canais  
5. Mover glossário para perto do Resumo ou domínio Base/Física (descoberta)  

### Não incluir (ainda)

- Abas clássicas multi-página do formulário  
- Persistência do lote físico inicial (sprint própria)  
- UC no create (draft) — pode ser UX-PROD-04.1 ou UX-05  
- Mobile parity (permanece UX-04 legado)

### Plano B (só se cards falharem em teste de operador)

Abas clássicas com Resumo sticky e validação cross-tab no Salvar.

---

## Critérios de sucesso UX-PROD-04

- Scroll reduzido sem perder a narrativa 1–9  
- Operador encontra Fiscal/Estoque em ≤ 2 cliques  
- Zero regressão de save / F12 / UC CRUD  
- Sem alteração de MCC / APIs / banco  

---

## Impacto no ROADMAP

```
… → UX-PROD-03.1 ✅
  → UX-PROD-03.2 ✅ (auditoria visual)
  → UX-PROD-04 = cards recolhíveis + nav leve  ← PRÓXIMA (revisada)
    → (opcional) abas clássicas só se plano B
    → UX-04 legado + mobile
```

---

## Veredito

**Não iniciar abas agora.**  
Priorizar **cards recolhíveis** e densidade da UC. A tela já está arquiteturalmente alinhada; falta conforto operacional, não redesign conceitual.
