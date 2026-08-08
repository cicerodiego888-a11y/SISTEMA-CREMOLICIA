# CHECKLIST — PDV Enterprise

**Código:** CHECKLIST_PDV_ENTERPRISE  
**Sprint:** STAB-PDV-01  
**Data:** 2026-07-18  
**Status geral:** 🟡 Quase pronto

---

## Arquitetura CORE

- [x] Formas de Venda via UC-01
- [x] Conversão comercial → base via MCC
- [x] Motor Estoque só com Unidade Base
- [x] Fiscal com snapshot (sem Converter)
- [x] PDV não calcula fator operacional com UC
- [ ] Zero referências MUC no caminho PDV (resta EAN/SQL/barcode)
- [ ] Código morto *Muc* removido

---

## Forma de Venda (PDV-UC-02)

- [x] Parse `resp.items`
- [x] Filtro canal PDV
- [x] `unidade_padrao`
- [x] `prioridade`
- [x] Fallback Unidade Base
- [x] Heurísticas `tipo≠PADRAO` / `quantidade≠1` removidas do fluxo ativo
- [x] Sem fallback HTTP MUC no `iniciarFluxo…`

---

## Fluxo de venda

- [x] Seleção produto → UC → quantidade → carrinho
- [x] Payload com `unidade_comercial` / id
- [x] `processarItemVenda` (MCC)
- [x] Baixa estoque na base
- [x] Emissão fiscal snapshot
- [x] Cancelamento/estorno na base persistida

---

## Segurança / regressão

- [x] UC resolvida não é sobrescrita pela base no fluxo oficial
- [x] Produto sem UC → Base
- [x] Uma / várias UCs → padrão / prioridade
- [x] Testes `test:pdv-uc02` / `test:pdv01` verdes (pós PDV-UC-02)

---

## Performance

- [ ] Busca PDV sem N+1 UC-01
- [ ] Cache `produtosDisponiveis` sempre com `_fonte_uc01` quando aplicável
- [ ] Remover `Muc.resolverPorBarras` ineficaz (IDs ≠ UC)

---

## Governança

- [x] `ARQUITETURA_CORE_CDS.md` (PDV-UC-02)
- [x] `SSOT_OFICIAL.md` (UC-01 / MCC)
- [x] `CORE_SERVICES.md` (`pdvOperacional`)
- [x] `GOVERNANCE.md` (UC na movimentação)

---

## Enterprise Ready

| Item | Nota |
|------|------|
| Núcleo venda | 🟢 |
| Higiene legado | 🟡 |
| Performance busca | 🟡 |
| **Agregado** | 🟡 Quase pronto |

**Para promover a 🟢:** executar limpeza documentada (código morto + EAN UC-01 + N+1) em sprint dedicada, sem alterar regras MCC.
