# STAB-PDV-01 — Auditoria Final do PDV

**Código:** STAB-PDV-01  
**Data:** 2026-07-18  
**Tipo:** Auditoria de Estabilização (**SEM IMPLEMENTAÇÃO**)  
**Prioridade:** P0  
**Base:** PDV-UC-02 · `AUDITORIA_PDV.md` · `PDV_UC_02.md`

---

## Objetivo

Validar que o PDV está alinhado à arquitetura oficial da Plataforma CDS após PDV-UC-02, sem dependências ocultas do MUC e sem desvio do CORE.

---

## Veredito resumido

| Critério de aprovação | Status |
|----------------------|--------|
| Nenhuma regra de conversão fora do MCC (caminho UC) | ✅ |
| Forma de Venda não depende do MUC | ✅ |
| UC-01 única fonte oficial de Formas de Venda | ✅ |
| Motor Estoque recebe apenas Unidade Base | ✅ |
| Fiscal usa snapshot da venda | ✅ |
| Sem regressão nos testes PDV-UC-02 / PDV-01 | ✅ |
| Zero resquícios MUC / código morto | ⚠️ resquícios documentados (não bloqueantes) |

**Classificação Enterprise:** 🟡 Quase pronto  
**Veredito Final:** 🟡 Estável

---

## Auditoria 1 — Dependências do MUC

| Arquivo | Linha (aprox.) | Função / trecho | Utilização | Classe |
|---------|----------------|-----------------|------------|--------|
| `backend/rotas/produtos.js` | 15 | `require('../motores/muc')` | Import do motor legado | 🟡 legado isolado |
| `backend/rotas/produtos.js` | 20–30 | `anexarUnidadesComerciaisUc01` | Lista UC-01 na busca PDV | 🟢 necessária |
| `backend/rotas/produtos.js` | 607–617 | SQL `EXISTS … produto_unidades` | Match EAN na tabela MUC | 🟡 legado isolado |
| `backend/rotas/produtos.js` | 652–665 | `Muc.resolverPorBarras` | Sugestão `unidade_comercial_sugerida_id` (IDs ≠ UC-01) | 🟡 legado isolado |
| `backend/rotas/produtos.js` | 2609–2618 | `GET /muc/barras/:codigo` | API barras MUC | 🟡 legado isolado |
| `backend/rotas/produtos.js` | 2621–2622 | `/:id/unidades` (MUC routes) | Cadastro/ERP — não é fonte PDV-UC-02 | 🟡 legado isolado |
| `backend/rotas/produtos.js` | 2028 | `Muc.garantirUnidadeBase` | Cadastro produto (fora fluxo venda) | 🟡 legado isolado |
| `frontend/pdv/js/pdv.js` | 2192+ | variável `muc` em `adicionarItemNoCarrinho` | Payload UC (`unidade_comercial_*`) — **nome** legado | 🟡 legado isolado |
| `frontend/pdv/js/pdv.js` | 2518 | `continuarAdicionarProdutoComUnidadeMuc` | Aplica Forma de Venda UC-01 no modal | 🟡 legado isolado (renomear) |
| `frontend/pdv/js/pdv.js` | 2454 | `abrirModalUnidadeComercialMuc` | Modal seleção — **zero callers** | 🔴 remover |
| `frontend/pdv/js/pdv.js` | 159 | `produtoTemMultiplasUnidadesMuc` | Helper — **zero callers** | 🔴 remover |
| `frontend/shared/js/pdvFormaVendaUc01.js` | — | módulo inteiro | Resolução oficial UC-01 | 🟢 necessária |
| `frontend/pdv` | — | `require` / HTTP MUC | **Ausente** | — |

**Conclusão:** a decisão de Forma de Venda **não** usa MUC. Restam acoplamentos de busca/EAN e nomenclatura.

---

## Auditoria 2 — Fluxo completo

```
Selecionar produto
  → UC-01 (busca anexada ou GET /unidades-comercializacao)
  → resolverFormaVendaPdv (canal PDV → unidade_padrao → prioridade)
  → continuarAdicionarProdutoComUnidadeMuc (label = UC)
  → abrirModalQuantidadeProduto
  → adicionarItemNoCarrinho (unidade_comercial + id)
  → finalizar venda
  → VendaPagamentoService → pdvOperacional.processarItemVenda
  → PdvConversaoOrchestrator / MCC → quantidade_base
  → MotorEstoque.sair (base)
  → Fiscal (snapshot)
Cancelamento / estorno
  → VendaCancelamentoService → devolverEstoqueItensVenda
  → MotorEstoque.entrar com qtd já em base (sem reconversão MCC)
```

| Pergunta | Resposta |
|----------|----------|
| Unidade Base usada diretamente no modal com UC PDV? | **Não** — cópia `produto.unidade` recebe o código comercial |
| Conversão fora do MCC? | **Não** no caminho UC. **Sim** (legado): `peso_medio_unidade` se venda por unidade **sem** UC |
| Fallback indevido para MUC? | **Não** — fail UC → lista vazia → Unidade Base |

---

## Auditoria 3 — Unidade Comercial

| Regra | Status |
|-------|--------|
| Canal PDV (`permite_pdv` / `canais.pdv`) | ✅ |
| `unidade_padrao` | ✅ |
| `prioridade` ASC | ✅ |
| Fallback Unidade Base | ✅ |
| Parse `resp.items` | ✅ |

Evidência: `frontend/shared/js/pdvFormaVendaUc01.js` + `npm run test:pdv-uc02` (12 OK).

---

## Auditoria 4 — Código morto

| Item | Arquivo | Classe |
|------|---------|--------|
| `produtoTemMultiplasUnidadesMuc` | `pdv.js` | 🔴 remover |
| `abrirModalUnidadeComercialMuc` (+ DOM) | `pdv.js` | 🔴 remover |
| Wrappers `unidadePermitidaNoPdv` / `mapearUc01ParaPdv` / `obterUnidadesComerciaisAtivas` | `pdv.js` | 🔴 remover (lógica viva só em `PdvFormaVendaUc01`) |
| `produtoFracionado` / `quantidadeUsaTresCasas` | `pdv.js` | 🔴 remover (sem callers) |
| Nomes `*Muc` / var `muc` | `pdv.js` | 🟡 renomear (futuro) |

**NÃO remover nesta sprint** — apenas documentado.

---

## Auditoria 5 — Fluxo oficial (aderência)

```
Produto → UC-01 → Forma de Venda → Quantidade → MCC → Motor Estoque → Venda → Fiscal
```

**Aderente.** PDV escolhe UC; MCC converte; Estoque na base; Fiscal no snapshot.

---

## Auditoria 6 — Performance

| Achado | Severidade |
|--------|------------|
| N+1: `Uc01.listar` por produto na busca PDV | 🟡 |
| Possível 2º GET `/unidades-comercializacao` se cache `produtosDisponiveis` sem `_fonte_uc01` | 🟡 |
| `Muc.resolverPorBarras` extra na busca (benefício baixo — IDs ≠ UC) | 🟡 |
| Parse duplicado crítico | ❌ não encontrado |

---

## Auditoria 7 — Segurança (sobrescrita de unidade)

| Caminho | Risco |
|---------|--------|
| `continuarAdicionarProdutoComUnidadeMuc` seta `produtoParaVenda.unidade = UC` | **Intencional** (label do modal). Item carrega `unidade_comercial` no payload |
| Fallback sem UC usa `produto.unidade` base | Correto |
| `adicionarItemNoCarrinho`: `unidade_comercial \|\| produto.unidade` | Seguro se UC veio no fluxo; sem UC = base |

**Não há caminho que faça a base “vencer” a UC já resolvida no fluxo PDV-UC-02.**

---

## Auditoria 8 — Regressão (cenários)

| Cenário | Fluxo oficial? |
|---------|----------------|
| Sem UC | ✅ Base |
| Uma UC PDV | ✅ UC no modal |
| Várias UCs | ✅ `unidade_padrao` / prioridade |
| Peso / KG | ✅ UC ou base conforme cadastro |
| Caixa / Pacote / Metro / Litro | ✅ (testes UC-02) |

---

## Auditoria 9 — Governança

| Documento | Aderência |
|-----------|-----------|
| `ARQUITETURA_CORE_CDS.md` | ✅ PDV-UC-02 homologado |
| `CORE_SERVICES.md` | ✅ `pdvOperacional` / UC-01 |
| `SSOT_OFICIAL.md` | ✅ UC-01 + MCC; anti-padrão MUC em código novo respeitado no cutover |
| `GOVERNANCE.md` | ✅ UC via MCC/UC-01 na venda |

**Desvio residual:** SQL/API MUC na busca (legado isolado, não decisão de Forma de Venda).

---

## Auditoria 10 — Enterprise Ready

🟡 **Quase pronto**

Arquitetura de venda consolidada (UC-01 → MCC → Estoque → Fiscal). Bloqueios para 🟢: limpeza controlada de código morto *Muc*, desacoplar EAN da tabela `produto_unidades`, e otimizar N+1 da busca.

---

## Documentos satélites

- `AUDITORIA_PDV.md`
- `RELATORIO_ESTABILIZACAO_PDV.md`
- `CHECKLIST_PDV_ENTERPRISE.md`
