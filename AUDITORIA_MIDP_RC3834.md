# AUDITORIA RC3.8D.3.4 — SALDOS NÃO CHEGAM AO MOTOR FISCAL

**Modo:** somente identificação (sem correção)  
**Data:** 2026-07-30  
**Base:** `AUDITORIA_MIDP_RC3833.md`  
**Caso:** produto 553 · `saldo_fiscal=4` · `saldo_nao_fiscal=10`

---

## Veredito (causa raiz única)

Os saldos **existem no banco**, **são retornados pelo SQL**, **estão em `produtoMap`**, e **são usados** como argumentos de `distribuirItemVenda(...)`.

Eles **deixam de existir** no momento em que `distribuicaoItens.push({...})` monta o objeto do item **sem copiar** `saldo_fiscal` / `saldo_nao_fiscal` a partir de `produto`.

Não é perda na consulta, nem no repository, nem no Motor Fiscal esperando outro nome de campo. É **omissão no mapeamento** em `VendaPagamentoService`.

---

## 1) Origem do produto

**Arquivo:** `backend/services/vendas/VendaPagamentoService.js`  
**Trecho:** ~L935–956

```sql
SELECT
  id,
  nome,
  saldo_fiscal,
  saldo_nao_fiscal,
  estoque_atual,
  produto_fracionado,
  vendido_por_peso,
  unidade
FROM produtos
WHERE id IN (...)
```

Antes de montar `distribuicaoItens`, para o produto 553:

```javascript
produtoMap[553] = {
  id: 553,
  nome: '...',
  saldo_fiscal: 4,        // ✅ presente
  saldo_nao_fiscal: 10,   // ✅ presente
  estoque_atual: ...,
  produto_fracionado: 0,
  vendido_por_peso: ...,
  unidade: 'un'
}
```

Confirmação banco (RC3.8D.3.3): `produtos` 553 → fiscal **4** · não fiscal **10**.

---

## 2) Montagem de `distribuicaoItens`

**Função:** callback de `db.all` + loop async (~L997–1036)

### Antes (`produto` + `item`)

| Fonte | Campos de saldo |
|-------|-----------------|
| `produto` (`produtoMap`) | `saldo_fiscal`, `saldo_nao_fiscal` ✅ |
| `item` (payload PDV / MCC) | tipicamente **sem** esses campos |
| Uso imediato | `distribuirItemVenda(item, Number(produto.saldo_fiscal), Number(produto.saldo_nao_fiscal), ...)` — só como **escalares** |

### Depois (`distribuicaoItens.push`)

```126:1035:backend/services/vendas/VendaPagamentoService.js
      distribuicaoItens.push({
        ...item,
        quantidade_fiscal: resultado.quantidadeFiscal,
        quantidade_nao_fiscal: resultado.quantidadeNaoFiscal,
        valor_fiscal: resultado.valorFiscal,
        valor_nao_fiscal: resultado.valorNaoFiscal,
        produto_fracionado: produto.produto_fracionado,
        vendido_por_peso: produto.vendido_por_peso,
        unidade: produto.unidade
      });
```

Copiados de `produto`: `produto_fracionado`, `vendido_por_peso`, `unidade`.  
**Não copiados:** `saldo_fiscal`, `saldo_nao_fiscal`.

Ramo `pularBaixaEstoque` (~L1002–1007): mesma omissão.

---

## 3) Mapeamento — saldos descartados?

| Pergunta | Resposta |
|----------|----------|
| Existem no objeto original (`produto`)? | **Sim** |
| São descartados? | **Sim** — nunca entram no objeto empurrado |
| Arquivo | `VendaPagamentoService.js` |
| Função | loop que monta `distribuicaoItens` (após `distribuirItemVenda`) |
| Linhas | **1026–1035** (caminho normal) · **1002–1007** (sem baixa) |
| Motivo | Objeto é montado a partir de `...item` + campos de distribuição/UC; saldos só foram lidos para o cálculo de estoque, não propagados |

Motor Fiscal (`itemComSaldos`) exige **no próprio item**:

```43:51:backend/motores/fiscal-nao-fiscal/FiscalMarginCalculator.js
function itemComSaldos(item = {}) {
  ...
  const temSaldoFiscal = item.saldo_fiscal != null;
  const temSaldoNaoFiscal = item.saldo_nao_fiscal != null;
  return qtd > 0 && temSaldoFiscal && temSaldoNaoFiscal;
}
```

Com `undefined` → cai em `pisoFiscalSemSaldo` → margem 0.

---

## 4) Camadas anteriores

Não é necessário “voltar mais”: a consulta e o `produtoMap` ainda têm os saldos. A ruptura é **só no push**.

Não há repository intermediário nesse caminho — SQL direto em `VendaPagamentoService`.

---

## 5) Fluxo real

```text
Banco produtos (553: SF=4, SNF=10)
        │
        ▼
SQL SELECT ... saldo_fiscal, saldo_nao_fiscal ...   ✅
        │
        ▼
produtoMap[553]  { saldo_fiscal:4, saldo_nao_fiscal:10 }   ✅
        │
        ▼
distribuirItemVenda(item, 4, 10, ...)   ✅ usa saldos como args
        │
        ▼
distribuicaoItens.push({ ...item, qF, vF, fracionado, unidade })
        │
        ❌ saldo_fiscal / saldo_nao_fiscal NÃO são atribuídos
        │
        ▼
separarItensDistribuidos(distribuicaoItens)
        │
        ▼
FiscalMarginCalculator.itemComSaldos → false
        │
        ▼
possuiMargemFiscal = false → MIDP máximo fiscal
```

---

## 6) Responsabilidade

| Pergunta | Resposta |
|----------|----------|
| Banco possui os saldos? | **Sim** |
| SQL retorna os saldos? | **Sim** |
| Repository retorna? | N/A neste fluxo (SQL no service) — dados ok em `produtoMap` |
| Service recebe os saldos? | **Sim** (`produto`) |
| `VendaPagamentoService` remove/omite? | **Sim — omite no `push` de `distribuicaoItens`** |
| Motor Fiscal espera outro campo? | **Não** — espera exatamente `item.saldo_fiscal` / `item.saldo_nao_fiscal` |

---

## Entrega objetiva

1. **Arquivo:** `backend/services/vendas/VendaPagamentoService.js`  
2. **Função:** montagem de `distribuicaoItens` (loop pós-`distribuirItemVenda`)  
3. **Linhas:** **1026–1035** (e espelho **1002–1007**)  
4. **Propriedades perdidas:** `saldo_fiscal`, `saldo_nao_fiscal`  
5. **Por quê:** não são incluídas no literal do `push`; só `produto_fracionado` / `vendido_por_peso` / `unidade` vêm de `produto`  
6. **Causa raiz única:** **omissão no mapeamento** ao criar `distribuicaoItens` — saldos ficam em `produtoMap` e não no item enviado ao Motor Fiscal  
7. **Camada:** **mapeamento no Service** (não consulta, não repository, não Motor Fiscal)

---

## Não alterado

MIDP · Motor Fiscal · XML · Distribuidor · Banco · algoritmo — apenas identificação.
