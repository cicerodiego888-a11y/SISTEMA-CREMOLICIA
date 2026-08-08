# AUDITORIA RC3.8D.3.3 — MIDP NÃO SEPARA ITENS

**Modo:** somente identificação (sem correção)  
**Data:** 2026-07-30  
**Caso:** produto 553 · 3 un · R$5 · PIX 10 + Dinheiro 5  
**Config observada:** `midp_ativado=true`, `midp_politica=PRESERVAR_DINHEIRO`

---

## Veredito (causa raiz única)

A separação **nunca é calculada de fato** porque o Motor Fiscal reporta **`possuiMargemFiscal=false`** (mínimo = máximo = R$15).

Isso ocorre porque `distribuicaoItens` enviado a `separarItensDistribuidos` **não carrega** `saldo_fiscal` / `saldo_nao_fiscal`.  
Sem saldos, `FiscalMarginCalculator.pisoFiscalSemSaldo` trata item **puramente fiscal** como piso = valor fiscal atual → margem 0.

Com margem 0, `PreservarDinheiroCalculator.decidirComItens` entra no ramo:

```text
if (!possuiMargemFiscal) → emitir quantidade/valor fiscais MÁXIMOS
```

Resultado: `itensAjuste` com qF=3 / R$15 (não há o que “aplicar” de diferente).  
Pagamentos: PIX 10 **e** Dinheiro 5 ambos `tipo_recebimento=fiscal`.

Com saldos no item (produto 553: fiscal 4 + não fiscal 10), a margem vira 15 e o MIDP produz corretamente qF=2 / R$10 e dinheiro não fiscal.

---

## Evidência banco (vendas 7 e 8 — 2026-07-30)

| Campo | Gravado |
|-------|---------|
| quantidade | 3 |
| quantidade_fiscal | **3** |
| quantidade_nao_fiscal | **0** |
| valor_fiscal | **15** |
| valor_nao_fiscal | **0** |

`venda_recebimentos`: PIX 10 fiscal · Dinheiro 5 **fiscal** (não há parcela não fiscal).

---

## Respostas objetivas

1. **Calculator calcula a separação esperada?**  
   **Só se `possuiMargemFiscal=true`.** No fluxo real do PDV (sem saldos nos itens): **não** — mantém 3/15.

2. **`MidpDecisionResult` contém `itensAjuste`?**  
   **Sim** — mas com `{quantidade_fiscal:3, quantidade_nao_fiscal:0, valor_fiscal:15, valor_nao_fiscal:0}`.  
   Nota: `toJSON()` **omite** `itensAjuste` (existe na instância).

3. **`aplicarDecisaoMidpNosItens()` altera os itens?**  
   **Sim, mas copia os mesmos máximos** — não é no-op por `null`; é apply sem efeito útil.

4. **`vendas_itens` grava ajustado?**  
   Grava o que veio do MIDP: **3 / 15 / 0** — sem separação PRESERVAR.

5. **Onde a separação é perdida?**  
   - **Arquivo:** `backend/motores/midp/policies/PreservarDinheiroCalculator.js`  
   - **Função:** `decidirComItens`  
   - **Ramo:** `if (!possuiMargemFiscal)` (~L426–458)  
   - **Causa upstream:** `FiscalMarginCalculator.pisoFiscalSemSaldo` + itens **sem** `saldo_*` montados em `VendaPagamentoService` (~L1026–1035)

6. **Causa raiz única**  
   **Margem fiscal zerada por ausência de saldos nos itens da venda** → MIDP PRESERVAR opera em modo “sem margem” e **não reduz** quantidade fiscal.

---

## Fluxo real (❌ = perda da separação)

```text
Venda PDV (553 × 3 · PIX 10 + Dinheiro 5)
        │
        ▼
distribuirItemVenda → qF=3, vF=15
        │
        ▼
distribuicaoItens  (SEM saldo_fiscal / saldo_nao_fiscal)
        │
        ▼
Motor Fiscal (separarItensDistribuidos)
  pisoFiscalSemSaldo → min=15=max
  possuiMargemFiscal = false
        │
        ▼
MIDP PreservarDinheiroPolicy  (ativado)
        │
        ▼
PreservarDinheiroCalculator.decidirComItens
  ❌ if (!possuiMargemFiscal) → qF=3 / R$15
  itensAjuste = [{3, 0, 15, 0}]   ← sem separação útil
        │
        ▼
MidpDecisionResult (itensAjuste presente, mas máximo)
        │
        ▼
aplicarDecisaoMidpNosItens  (aplica 3/15 — inócuo)
        │
        ▼
INSERT vendas_itens  (3 / 15 / 0)
        │
        ▼
XML NFC-e  (qCom=3, vProd=15)
```

---

## Contraste laboratório

| Entrada | possuiMargem | itensAjuste | Pagamentos |
|---------|--------------|-------------|------------|
| Itens **sem** saldo (fluxo PDV) | false | 3 / 15 | PIX+Dinheiro **fiscais** |
| Itens **com** saldo 4+10 | true | **2 / 10** + NF 1/5 | PIX fiscal · Dinheiro **não fiscal** |

---

## Não alterado nesta auditoria

Motor Fiscal · MIDP · XML · Distribuidor · Banco · algoritmo PreservarDinheiro — apenas identificação.
