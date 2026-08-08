# CHECKLIST — Reorganização do Cadastro de Produtos

**Código:** CHECKLIST_REORGANIZACAO_CADASTRO  
**Uso:** Acompanhar fases do `ROADMAP_REORGANIZACAO_CADASTRO.md`  
**Data:** 2026-07-17  

Marcar `[x]` apenas quando validado em PR + teste manual.

---

## Pré-requisitos

- [ ] Ler `AUDITORIA_ENTERPRISE_CADASTRO_PRODUTO.md`  
- [ ] Ler `AUDITORIA_FORENSE_MCC_UX_IMPLEMENTACAO.md`  
- [ ] Confirmar: **sem** colocar fator físico no cadastro  
- [ ] Confirmar: peso da balança permanece na **Compra**  

---

## UX-01 — Quick Wins

- [x] Label Unidade Base  
- [x] Bloco Conversão Física fora do “parece fiscal”  
- [x] Copy: peso na Entrada / não digite fator  
- [x] Tipo UC sem nome “Conversão Física” (ou tooltip claro)  
- [x] Remover `data_validade`/`lote` fantasmas do `saveProduto`  
- [x] Hint UC após primeiro save  
- [ ] Teste manual: novo produto + edit + flag física  

---

## UX-02 — Separar PDV × Física

- [x] Seção “Venda no PDV” com fracionado / peso médio / preço UN  
- [x] Seção “Conversão Física (MCC)” isolada  
- [x] Glossário curto (Base / UC / Física)  
- [ ] Decisão documentada: manter ou deprecar fracionado  
- [ ] Teste: operador não confunde os dois switches  

---

## UX-03 — Abas / domínios

- [x] Ordem Identificação → Base → Física → UC → Comercial → PDV → Estoque → Fiscal → Avançado (vertical)  
- [x] Resumo Inteligente  
- [x] Cards por domínio  
- [x] Fluxo Implantação × Operação (UX-PROD-03.1)  
- [x] Conversão Física Inicial preparada (UI; sem persistência)  
- [x] Campos de implantação identificados (`data-campo-implantacao`)  
- [x] Auditoria visual Enterprise (UX-PROD-03.2)  
- [x] Decisão: cards recolhíveis preferidos a abas (`RELATORIO_DECISAO_UX04.md`)  
- [x] UX-PROD-05 — cards UC Enterprise (filtros, busca, ordenação, ações)  
- [ ] UX-PROD-04 — densidade progressiva (opcional / pontual pós-freeze)  
- [ ] Fluxo criar UC no primeiro cadastro (ou draft) — pontual  
- [ ] Teste regressão: save, atacado, UC CRUD, fiscal NFC-e  

---

## UX-04 — Legado + Mobile

- [ ] ADR / plano remoção MUC UI  
- [ ] Remover ou isolar `#secaoUnidadesComerciaisMuc`  
- [ ] Painel legado embalagem só se produto sem UC/MCC  
- [ ] Mobile: flag física + listagem UC mínima  
- [ ] Gate: nenhum `fator` editável no cadastro produto  
- [ ] `npm` / smoke cadastro + compra sorvete 67,500 Kg  

---

## Governança (contínuo)

- [ ] Nenhuma regra de conversão nova na UI  
- [ ] SSOT Unidade Base preservado  
- [ ] Estoque operacional só via Motor Estoque  
- [ ] CHANGELOG da fase UX-*  
- [ ] Atualizar `AUDITORIA_ENTERPRISE_CADASTRO_PRODUTO.md` status  

---

## Definition of Done (global)

- [x] Classificação sobe de 🟠 → 🟡 (03.2) → **🟢 Enterprise Ready** (UX-PROD-05)  
- [x] Freeze: sem reorganização estrutural geral do Cadastro  
- [ ] Checklist UX-01 e UX-02 100% (testes manuais remanescentes)  
- [ ] Zero campos mortos visíveis  
- [ ] Paridade mobile mínima acordada  
