# MCC — Homologação Final (MCC-HOM-01)

**Código:** MCC-HOM-01  
**Data:** 2026-07-17  
**Status:** **APROVADO COMO MOTOR CORE OFICIAL**  
**Escopo:** Homologação arquitetural — sem novas funcionalidades

---

## Decisão oficial

O **Motor de Conversão Comercial (MCC)** passa oficialmente a ser um dos motores **CORE** da Plataforma CDS.

A partir desta homologação:

> Compras, Estoque, PDV, Fiscal, Motor Comercial e demais módulos **deverão obrigatoriamente** utilizar o MCC para qualquer conversão entre Unidades de Comercialização e Unidade Base (e conversão física por lote).

### Gate de migração (ressalva transparente)

Ainda existem artefatos **legados** (`motorConversaoUnidades`, MUC `ConversorUnidades`) no fluxo operacional atual.  
Eles **não invalidam** a aprovação do MCC; definem o backlog obrigatório de integração.

- **Proibido:** criar novas regras de conversão fora do MCC.  
- **Obrigatório:** migrar consumidores legados nas sprints de integração operacional.

Detalhes: `AUDITORIA_MCC.md` · `CHECKLIST_MCC.md`

---

## Evidências de teste

| Suite | Resultado |
|-------|-----------|
| `npm run test:mcc` (MCC-01) | 11 OK |
| `npm run test:mcc02` | 9 OK |
| `npm run test:mcc021` | 8 OK |
| `npm run test:mci01` | 12 OK |
| `npm run test:mcc-hom` | 9 OK |

**Stress (referência):** 100.000 conversões ~60ms (com cache) · multi-lote ~90ms · 50.000 em escala 100×10k lotes ~130ms.

**Concorrência:** 4 workers × 5.000 conversões — resultados idênticos.

**Versionamento:** UPDATE/DELETE bloqueados; nova versão íntegra.

---

## Critérios de aceite

| Critério | Status |
|----------|--------|
| Nenhuma responsabilidade indevida no MCC | ✔ |
| Nenhuma dependência circular | ✔ |
| Todos os testes MCC + HOM passando | ✔ |
| Stress aprovado | ✔ |
| Thread-safe (Node) | ✔ |
| Versionamento íntegro | ✔ |
| Auditoria íntegra | ✔ |
| Arquitetura Enterprise aprovada | ✔ |
| Zero novos cálculos fora do MCC | ✔ |
| Legados mapeados para migração | ✔ (gate) |

---

## Princípio congelado

> Um Produto → Uma Unidade Base (SSOT) → N Unidades de Comercialização → Lote → Histórico de Conversões → Conversão Ativa → **MCC**.

---

## Próximos passos (fora desta sprint)

1. Integrar Entrada de Mercadorias operacional → orchestrator  
2. Migrar Compras/Estoque/PDV/Fiscal de MUC/`motorConversaoUnidades` → MCC  
3. Aplicar precisão comercial  
4. Persistência opcional de auditoria de conversão
