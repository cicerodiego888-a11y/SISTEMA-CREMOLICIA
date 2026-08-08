# AUDITORIA — PDV exibe Unidade Base (L) em vez da Forma de Venda PDV (KG)

**Código:** AUDITORIA_PDV_UNIDADE_MODAL_UC  
**Data:** 2026-07-18  
**Tipo:** Auditoria forense (SEM IMPLEMENTAÇÃO)  
**Sintoma:** Modal de quantidade do PDV mostra “Quantidade em L” mesmo existindo Forma de Venda padrão para canal PDV em KG.

---

## Respostas diretas

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | De onde o PDV obtém a unidade do modal? | `abrirModalQuantidadeProduto` usa **`produto.unidade`** (Unidade Base / estoque). |
| 2 | O PDV consulta Formas de Venda? | **Tenta** (`GET .../unidades-comercializacao`), mas o parse **ignora `items`**. Na busca PDV, pré-carrega **MUC legado**, não UC-01. |
| 3 | UC padrão PDV é carregada? | **Frequentemente não** (lista vazia ou lista MUC). Mesmo carregada, o fluxo **ignora** UC única com `quantidade === 1`. |
| 4 | Prioridade / `unidade_padrao` respeitada? | **Não.** Mapper usa `u.padrao` / `u.principal`, **não** `unidade_padrao`. Ordenação UC do backend não é usada para escolher a unidade do modal. |
| 5 | Fallback para `produto.unidade`? | **Sim** — caminho padrão de `continuarAdicionarProdutoPdv`. |
| 6 | Arquivo? | Principal: `frontend/pdv/js/pdv.js`. Busca: `backend/rotas/produtos.js` (Muc.listar). API correta: UC-01 `.../unidades-comercializacao`. |
| 7 | Fluxo esperado MCC/UC? | PDV escolhe **Forma de Venda (UC) do canal PDV** (padrão/prioridade) → quantidade na **unidade comercial** → backend MCC converte para base. PDV **não** deve rotular o modal com a Unidade Base se houver UC PDV. |

---

## Arquivos envolvidos

| Arquivo | Papel |
|---------|--------|
| `frontend/pdv/js/pdv.js` | Modal quantidade; fluxo UC; parse da API; fallback base |
| `backend/rotas/produtos.js` | Busca PDV anexa `unidades_comerciais` via **Muc.listar** (legado) |
| `backend/motores/unidades-comercializacao/...` | Fonte correta UC-01 (`{ items: [...] }`, `unidade_padrao`, canais) |
| `backend/motores/muc/...` | Legado MUC — ainda usado na busca |
| `backend/motores/motor-conversao-comercial/integracao/pdv/*` | Conversão no **backend** (OK se `unidade_comercial` vier no item) |

---

## Fluxo atual (como está)

```
Busca/seleciona produto
    ↓
iniciarFluxoAdicionarProdutoPdv(produto)
    ↓
Se produto.unidades_comerciais já é Array  ← busca PDV preenche com Muc (legado)
    → NÃO chama UC-01
Senão
    → GET /unidades-comercializacao
    → lista = resp | resp.unidades | resp.data
    → NÃO lê resp.items  ← payload real UC-01 = { items: [...] }
    → lista vira []
    ↓
obterUnidadesComerciaisAtivas → 0 ou N
    ↓
Se N > 1 → modal “Unidade comercial” (ok)
Se N === 1 e tipo≠PADRAO e quantidade≠1 → usa UC no modal
Se N === 1 e (PADRAO OU quantidade===1) → IGNORA UC
Se há unidade_comercial_sugerida_id → usa UC (só barcode MUC)
Senão
    → continuarAdicionarProdutoPdv
    → abrirModalQuantidadeProduto(produto)
    → label: produto.unidade  →  "Quantidade em L"
```

Trechos-chave:

```4422:4459:frontend/pdv/js/pdv.js
function abrirModalQuantidadeProduto(produto, callback, opcoes = {}) {
    const unidade = String(produto.unidade || 'UN').toUpperCase();
    // ...
    `${fracionado ? `Quantidade em ${unidade}` : 'Quantidade'}`
    // ...
    `Digite a quantidade em ${unidade}`
}
```

```2574:2593:frontend/pdv/js/pdv.js
const unicas = obterUnidadesComerciaisAtivas(produtoComUnidades);
if (unicas.length === 1 && String(unicas[0].tipo || '').toUpperCase() !== 'PADRAO'
    && Number(unicas[0].quantidade || 1) !== 1) {
    continuarAdicionarProdutoComUnidadeMuc(...); // só neste caso troca unidade
    return;
}
// ...
continuarAdicionarProdutoPdv(...); // usa produto.unidade (L)
```

```2601:2606:frontend/pdv/js/pdv.js
$.get(`${API_URL}/produtos/${produto.id}/unidades-comercializacao`)
    .done((resp) => {
        const lista = Array.isArray(resp) ? resp : (resp?.unidades || resp?.data || []);
        // falta: resp.items
```

```155:171:frontend/pdv/js/pdv.js
principal: u.padrao || u.principal || 0,  // UC-01 envia unidade_padrao
```

```631:637:backend/rotas/produtos.js
produto.unidades_comerciais = await Muc.listar(db, produto.id);  // não UC-01
```

---

## Fluxo esperado (MCC / UC)

```
Produto (Unidade Base = L) — SSOT estoque
    ↓
Formas de Venda (UC-01)
  · PADRAO L (estoque) — canais conforme cadastro
  · KG com canal PDV + unidade_padrao / prioridade
    ↓
PDV
  1. Carrega UC-01 (items)
  2. Filtra canal PDV (canais.pdv / permite_pdv)
  3. Escolhe unidade_padrao do canal PDV, senão menor prioridade
  4. Modal: "Quantidade em KG" (unidade comercial)
  5. Item envia unidade_comercial (+ id)
  6. Backend PdvConversaoOrchestrator / MCC → quantidade na base L
```

Regra: **cadastro declara UC · PDV vende em UC · MCC converte · estoque na base.**  
O label do modal deve seguir a **UC escolhida**, não a base — salvo ausência de UC PDV (aí sim fallback base).

---

## Causa raiz (composta)

1. **Parse da API UC-01 sem `items`** → Formas de Venda frequentemente **não entram** no fluxo.  
2. **Busca PDV injeta MUC legado** e o front trata qualquer Array como “já carregado”, **pulando UC-01**.  
3. **Heurística que descarta UC única** se `tipo === PADRAO` **ou** `quantidade === 1` → KG com fator 1 (ou física) cai no fallback.  
4. **`unidade_padrao` não mapeado** para `principal` → “padrão PDV” não influencia o modal.  
5. **Modal de quantidade sempre lê `produto.unidade`** (base), a menos que o ramo `continuarAdicionarProdutoComUnidadeMuc` sobrescreva.

Para o caso L (base) + KG (forma PDV padrão): o operador vê **L** porque o PDV quase nunca aplica a UC KG antes do modal.

---

## Correção recomendada (NÃO implementar agora)

Ordem sugerida (só UX/PDV front + opcional busca):

1. Parse: `const lista = resp?.items || resp?.unidades || …`  
2. Busca PDV: anexar UC-01 (`ProdutoUnidadeComercialService.listar` / items), não só Muc; ou sempre reconsultar UC-01 no `iniciarFluxo…`  
3. Escolha: entre UCs com canal PDV, preferir `unidade_padrao === 1`, depois `prioridade` ASC  
4. Remover (ou afrouxar) o filtro `quantidade !== 1` / exclusão cega de PADRAO quando a UC comercial ≠ base ou canal PDV aponta KG  
5. `mapearUc01ParaPdv`: `principal: Number(u.unidade_padrao) === 1`  
6. Garantir que, com UC PDV resolvida, `abrirModalQuantidadeProduto` receba produto com `unidade` = código comercial (já feito em `continuarAdicionarProdutoComUnidadeMuc`)

**Não alterar** MCC, fórmulas, payloads de conversão — apenas resolução da UC na UI do PDV (e, se necessário, a fonte na busca).

---

## ADR?

**(x) NÃO** — bug de integração PDV↔UC-01 na camada de apresentação/seleção.  
Arquitetura MCC/UC já define o fluxo esperado acima.

---

## Veredito

Não é falha do cadastro da Forma de Venda em si.  
É o **PDV que não resolve/aplica a UC-01** antes de montar o label do modal, caindo no **fallback da Unidade Base (L)**.
