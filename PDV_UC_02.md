# PDV-UC-02 — Cutover definitivo do PDV para UC-01

**Código:** PDV-UC-02  
**Data:** 2026-07-18  
**Tipo:** Consolidação Arquitetural  
**Prioridade:** P0  
**Base:** `AUDITORIA_PDV.md` (histórico modal: `docs/archive/auditorias/pdv/AUDITORIA_PDV_UNIDADE_MODAL_UC.md`)  
**ADR:** NÃO

---

## Objetivo

Eliminar a dependência do legado MUC no PDV. O modal de quantidade passa a usar exclusivamente a **Forma de Venda (UC-01)** do canal PDV.

Nenhuma regra de conversão foi alterada — apenas a resolução da unidade exibida/enviada na UI.

---

## Fluxo oficial

```
Carregar UC-01 ({ items })
    ↓
Filtrar canal PDV
    ↓
Existe unidade_padrao?
    ↓ SIM → utilizar
    ↓ NÃO → ordenar por prioridade ASC → primeira
    ↓
Nenhuma UC PDV → fallback Unidade Base
    ↓
Modal: "Quantidade em {Unidade Comercial}"
```

Com várias UCs no canal PDV, a escolha é **automática** (`unidade_padrao` / prioridade) — o operador não precisa escolher manualmente para o caminho feliz.
---

## O que foi alterado

| Área | Mudança |
|------|---------|
| PDV front | Parse `resp.items`; mapper `unidade_padrao`; resolução canal → padrão → prioridade |
| PDV front | Removidas heurísticas `tipo≠PADRAO` / `quantidade≠1` |
| PDV front | Removido fallback HTTP para MUC (`/unidades`) |
| Busca PDV | Anexa `ProdutoUnidadeComercialService.listar` (items), não `Muc.listar` |
| Shared | Módulo `pdvFormaVendaUc01.js` (fonte única da resolução) |

---

## O que NÃO foi alterado

- MCC / conversões  
- Motor Estoque  
- Comercial / Fiscal / MFE  
- Banco / schema UC-01  
- Payloads MCC / APIs de conversão  
- Estrutura UC-01  

---

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `frontend/shared/js/pdvFormaVendaUc01.js` | Resolução UC-01 (canal / padrão / prioridade) |
| `frontend/pdv/js/pdv.js` | Fluxo de adição + modal |
| `frontend/pdv/index.html` | Inclui script compartilhado |
| `backend/rotas/produtos.js` | Busca PDV anexa UC-01 |
| `tests/pdv/pdv-uc02.test.js` | Critérios de aceite (label) |
| `package.json` | `npm run test:pdv-uc02` |

---

## Critérios de aceite

| Caso | Modal |
|------|--------|
| Base L · UC PDV KG (padrão) | Quantidade em **KG** |
| Base UN · UC Caixa | Quantidade em **CX** |
| Base MT · UC Rolo | Quantidade em **ROLO** |
| Sem UC | Quantidade em **UN** (base) |
| Várias UCs · `unidade_padrao` | Padrão vence |
| Várias UCs · só prioridade | Menor prioridade |

---

## Testes

```bash
npm run test:pdv-uc02
```

---

## Arquitetura

```
Cadastro: Unidade Base (SSOT estoque) + Formas de Venda (UC-01)
PDV: escolhe UC do canal PDV → quantidade na UC
MCC: converte UC → Unidade Base
Estoque: movimenta na base
```

O PDV **não** calcula fator. O MCC permanece o único responsável pela conversão.
