# AUDITORIA RCF-07 — Regressão Arquitetural (Pós Motor Comercial V2)

Data: 2026-07-31  
Prioridade: CRÍTICA — BLOQUEANTE PARA PRODUÇÃO

---

## 1. Veredito

A regressão **não** veio do ComercialPrecoResolver, Linha Comercial, Kits, Casquinhas nem Unidades de Comercialização em si.

Foi introduzida pela integração **MIDP → persistência de itens** em `VendaPagamentoService`:

```text
aplicarDecisaoMidpNosItens() retornava a MESMA referência do array
        ↓
distribuicaoItens.length = 0   ← apagava os itens
itensFinais.forEach(push)      ← nada a repor (mesma ref já vazia)
        ↓
INSERT vendas_itens nunca rodava (array vazio)
        ↓
COMMIT (antes do RCF-06) com venda + pagamento e 0 itens
        ↓
carregarVenda → qtd_itens = 0
        ↓
(DANFE de outra venda via canal de impressão — RCF-02/06)
```

**Isso ocorre no caminho feliz** (sem `itensAjuste` MIDP), ou seja, na maioria das vendas.

---

## 2. Linha do tempo

| Marco | Estado |
|-------|--------|
| `53023b4` / `HEAD` (commits) | NFC-e ok; `INSERT` itens sem padrão MIDP clear+repush |
| Working tree — MIDP + Motor Fiscal×Não Fiscal | Introduz `aplicarDecisaoMidpNosItens` + `length = 0` |
| Sintoma | Venda concluída, pagamento ok, `qtd_itens = 0` no emissor |
| RCF-02 / RCF-06 | Contêm DANFE/abort; **não** corrigiam a causa do wipe |
| **RCF-07** | Corrige a referência + `this.lastID` + logs/teste |

Não há commit isolado “primeiro falha” no remote: a regressão está no **diff não commitado** de `VendaPagamentoService.js` (+~780 linhas vs HEAD).

---

## 3. Arquivo responsável

| Campo | Valor |
|-------|--------|
| Arquivo | `backend/services/vendas/VendaPagamentoService.js` |
| Função | `aplicarDecisaoMidpNosItens` |
| Gatilho | Bloco pós-MIDP (prazo e à vista): `distribuicaoItens.length = 0` + re-push |
| Amplificador | Caminho “distribuicaoItens vazio → COMMIT” (corrigido no RCF-06 para ROLLBACK) |
| Secundário | Callback arrow em `INSERT vendas_itens` → `this.lastID` undefined (kits/casquinha) |

Não existe `VendaApplicationService` / `saveItens()` neste codebase — o SSOT de persistência é `criarVenda` em `VendaPagamentoService`.

---

## 4. Tabela de impacto por sprint

| Sprint | Alterou emissão fiscal? | Impacto |
|--------|-------------------------|---------|
| Comercial V2 (preço/linha/canal) | Não (direto) | Só preço/canal; não apaga itens |
| Resolver Comercial | Não | Resolve preço; não persiste venda |
| Unidades Comerciais | Não (direto) | Colunas extras no INSERT; sem wipe |
| Fiscal × Não Fiscal / MIDP | **Sim** | **Causa raiz** — wipe por referência |
| Kits | Indireto | Depende de `vendaItemId`; arrow `this.lastID` quebrava vínculo |
| Casquinhas | Indireto | Idem sabores com `vendaItemId` |
| VendaPagamentoService | **Sim** | Local do bug + fix |
| VendaApplicationService | N/A | Não existe no projeto |
| PDV (ordem carrinho→emitir) | Não | Ordem preservada; PDV não finaliza sem itens |

---

## 5. Fluxo anterior × atual

### Anterior (estável)

```
Carrinho → POST /vendas → BEGIN → INSERT venda → INSERT itens → COMMIT → emitir NFC-e
```

### Com regressão MIDP

```
Carrinho → MIDP decisão → length=0 (BUG) → INSERT venda → (0 itens) → pagamento → emitir (qtd=0)
```

### Após RCF-07 (+ RCF-06)

```
Carrinho → MIDP (cópia nova) → INSERT itens → COMMIT → assertVendaComItens → NFC-e → DANFE(venda_id)
```

---

## 6. Causa técnica (detalhe)

```js
// BUG (quando sem itensAjuste):
function aplicarDecisaoMidpNosItens(distribuicaoItens, decisao) {
  if (!decisao || !decisao.itensAjuste?.length) {
    return distribuicaoItens; // ← mesma referência
  }
  return distribuicaoItens.map(...); // nova só com ajuste
}

const itensFinais = aplicarDecisaoMidpNosItens(distribuicaoItens, midpResult.decisao);
distribuicaoItens.length = 0;           // zera a única cópia
itensFinais.forEach((it) => distribuicaoItens.push(it)); // vazio
```

Quando há `itensAjuste`, `.map()` cria array novo e o bug **não** aparece — por isso parecia intermitente / “só às vezes”.

---

## 7. Correção aplicada (RCF-07)

1. `aplicarDecisaoMidpNosItens` **sempre** retorna array novo (`map` + spread).
2. Guard: se MIDP zerar itens que existiam → HTTP 500 (não segue).
3. Callbacks de INSERT itens: `function (itemErr)` para `this.lastID` correto.
4. Logs `[RCF-07]` (MIDP pós-decisão, item persistido, COMMIT, pipeline fiscal).
5. Teste: `backend/services/fiscal/tests/rcf07-regressao-midp-itens.test.js`

Proteções já em RCF-06 permanecem (abort se 0 itens no emissor; DANFE amarrado à venda).

---

## 8. Evidências

### Reprodução unitária do bug

```
simularBugAntigo([{produto_id:1}], null) → length === 0
aplicarDecisaoMidpNosItens (corrigido) + clear/repush → length === 1
```

### SQL esperado pós-fix

```sql
SELECT COUNT(*) FROM vendas_itens WHERE venda_id = ?;  -- > 0 antes de emitir
```

### Teste

```
node backend/services/fiscal/tests/rcf07-regressao-midp-itens.test.js
→ RCF-07 OK — MIDP não zera itens; this.lastID com function callback
```

---

## 9. Critérios de aceitação

- [x] Identificar alteração que introduziu a regressão (MIDP clear+same-ref)
- [x] Confirmar que Comercial V2 / Resolver / UC / Kits / Casquinhas **não** são a causa direta
- [x] Restaurar rastreabilidade PDV → itens → NFC-e
- [x] Teste de regressão aprovado
- [x] Logs `[RCF-07]` nas etapas críticas

Reinicie o backend e emita uma NFC-e de homologação; espere `itens_carregados > 0` nos logs.
