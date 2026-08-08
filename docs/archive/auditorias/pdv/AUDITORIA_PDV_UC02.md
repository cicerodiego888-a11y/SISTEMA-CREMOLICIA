# AUDITORIA — PDV-UC-02 (Cutover PDV → UC-01)

**Código:** AUDITORIA_PDV_UC02  
**Data:** 2026-07-18  
**Sprint:** PDV-UC-02  
**Base:** `AUDITORIA_PDV_UNIDADE_MODAL_UC.md`

---

## Veredito

**APROVADO** — o PDV deixa de usar MUC como fonte da Forma de Venda e consome exclusivamente UC-01 para o label do modal de quantidade.

---

## Problema (antes)

1. Parse da API ignorava `resp.items` (payload oficial UC-01).  
2. Busca PDV anexava `Muc.listar` e o front pulava a consulta UC-01.  
3. Heurística descartava UC única se `tipo === PADRAO` ou `quantidade === 1`.  
4. Mapper lia `padrao` / `principal`, não `unidade_padrao`.  
5. Modal lia `produto.unidade` (base) quando a UC não era aplicada.

Sintoma: Base **L** + Forma PDV **KG** → modal “Quantidade em **L**”.

---

## Correção (depois)

| Item | Status |
|------|--------|
| Parse `items` | OK |
| Fonte UC-01 (`ProdutoUnidadeComercialService`) | OK |
| Busca PDV sem MUC como lista principal | OK |
| `unidade_padrao` + `prioridade` | OK |
| Heurísticas antigas removidas | OK |
| Fallback Unidade Base sem UC | OK |
| Fallback HTTP MUC removido | OK |
| Conversão MCC intacta | OK |

---

## Legado removido (PDV)

- Uso de `Muc.listar` na busca PDV como fonte de `unidades_comerciais`  
- Fallback `GET /produtos/:id/unidades` no fluxo de adição  
- Regras `tipo ≠ PADRAO` e `quantidade ≠ 1` para decidir UC  

**Mantido (fora do escopo cutover visual):** `Muc.resolverPorBarras` na busca (sugestão por EAN legado; só aplica se o id existir na lista UC).

---

## Fluxo antigo vs novo

**Antigo:** MUC pré-carregado → skip UC-01 → heurística → fallback base → “Quantidade em L”.

**Novo:** UC-01 (`items`) → filtro PDV → `unidade_padrao` / prioridade → `produto.unidade = UC` → “Quantidade em KG”.

---

## Testes

`npm run test:pdv-uc02` — 12 OK (labels e resolução).

---

## ADR?

**(x) NÃO** — cutover de integração UI PDV ↔ UC-01; arquitetura já definida em UC-01 / PDV-01 / MCC.
