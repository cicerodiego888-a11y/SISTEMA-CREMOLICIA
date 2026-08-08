# RELATÓRIO — Performance (RCM-8.6)

| Campo | Valor |
|---|---|
| Sprint | RCM-8.6 |
| Data | 2026-08-06 |
| Ambiente | SQLite local · banco oficial MercantilFiscal |
| Suite | `backend/modules/comercial/tests/rcm86-certificacao-performance.test.js` |

---

## Resultados medidos

| Cenário | Tempo | Limite certificação | Status |
|---|---|---|---|
| 100 itens · `resolver-precos` VAREJO | **48 ms** | < 15 s | ✔ |
| 300 itens | **205 ms** | < 45 s | ✔ |
| 1000 itens | **43 ms** | < 120 s | ✔ |
| Troca de operação (Varejo→Atacado→Consignado × 50) | **354 ms** | < 30 s | ✔ |
| Comparar Tabelas (1 produto) | **5 ms** | — | ✔ |

> Nota: 1000 itens pode beneficiar-se de cache aquecido do Resolver; mesmo assim permanece dentro do limite com folga.

---

## Cenários cobertos pelo smoke

- Volume: 100 / 300 / 1000 itens
- Troca de operação/canal
- Comparar tabelas (Central / API RCM-8.5)

Cenários de UI (troca de cliente / quantidade no carrinho PDV) reutilizam o mesmo endpoint; o gargalo medido é o Resolver batch.

---

## Critérios

| Critério | Resultado |
|---|---|
| Sem degradação perceptível em 100–300 itens | ✔ |
| 1000 itens aceitável em SQLite local | ✔ |
| Troca de operação estável | ✔ |
| Performance aprovada para congelamento | ✔ |

---

## Recomendações futuras (sem mudar arquitetura)

- Manter cache do Resolver; invalidar só na tabela/linha afetada.
- Batch `resolver-precos` (já usado) — nunca N chamadas unitárias na UI.
- Monitorar logs `[RCM-8.4]/` / `[RCM-8.5]` com `tempo_ms` em homologação.
