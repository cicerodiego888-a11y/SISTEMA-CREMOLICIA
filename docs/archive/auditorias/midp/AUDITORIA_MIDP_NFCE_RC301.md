# AUDITORIA MIDP → GERAÇÃO NFC-e — RC3.0.1

**Modo:** somente identificação (sem correção)  
**Data:** 2026-07-30  
**Caso:** produto 553 · 3 un · R$5,00 · PIX 10 + Dinheiro 5  

---

## Veredito

O `MidpDecisionResult` / `itensAjuste` **não chega** à NFC-e porque, no ambiente atual, a política ativa é **`LEGADO`** (e tipicamente `midp_ativado=false`).

Nesse modo:

1. **Não existe** `midpResult.decisao`  
2. **Não existe** `itensAjuste`  
3. `aplicarDecisaoMidpNosItens` é **no-op**  
4. Persistência e XML usam a distribuição **de estoque/fiscal operacional** (máximo fiscal), não a decisão PRESERVAR_DINHEIRO  

**Componente que ignora o MidpDecisionResult:**  
`LegacyDistributionPolicy` (não produz decisão) + `VendaPagamentoService.aplicarDecisaoMidpNosItens` (descarta quando `decisao` é null) + emissor/XML que só lê `vendas_itens` / `venda_recebimentos` já persistidos.

Não há `VendaApplicationService` neste repositório — o equivalente é `VendaPagamentoService` + `emissor.js` + `xmlBuilder.js`.

---

## Caso real × esperado × observado

| Campo | Esperado (PRESERVAR) | Observado no XML |
|-------|----------------------|------------------|
| Qtd fiscal | **2** | **3** |
| Valor fiscal | **10,00** | **15,00** |
| Pag. fiscal | PIX **10** · Dinheiro **0** | PIX **10** · Dinheiro **5** |
| Não fiscal | 1 un · R$5 · Dinheiro 5 | (não refletido na nota) |

Log típico já visto em produção:

```text
midpAtivado: false
politica: "LEGADO"
decisao: null
```

Com LEGADO + estoque permitindo 3 un fiscais (ou flag fiscal), a nota leva **qCom=3 / vProd=15** e `<pag>` fecha em **15**.

---

## Fluxograma real (pipeline)

```
PDV POST /vendas (emitir_fiscal)
        │
        ▼
┌───────────────────────────┐
│ Motor Fiscal × Não Fiscal │  intervalo máx/mín (estoque)
│ FiscalOperacionalResult   │  efetivo operacional = MÁXIMO
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ MidpService.distribuir    │
│ midp_politica = LEGADO*   │  ← config default
│ midp_ativado = false*     │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ LegacyDistributionPolicy  │
│ MidpEngine → Distribuidor │  só rateia MEIOS
│ MidpResult.decisao = null │  ← AQUI a decisão PRESERVAR NÃO EXISTE
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ aplicarDecisaoMidpNosItens│
│ if (!decisao) return itens│  ← ponto de descarte explícito
│ (sem alterar qtd fiscal)  │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ OrquestradorPagamento     │  usa totais Midp (LEGADO = máximos)
│ venda_recebimentos        │  fiscal/não fiscal pelos totais LEGADO
│ vendas_itens              │  quantidade_fiscal = estoque (ex.: 3)
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ POST /fiscal/emitir/...   │
│ emissor.carregarVenda     │  lê DB — NÃO chama MIDP de novo
│ itensFiscal = filter(     │  quantidade_fiscal > 0
│   vendas_itens)           │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ xmlBuilder.buildNfceXml   │
│ qCom ← mapearItemDocumento│  quantidade_fiscal ou quantidade
│ <pag> ← venda_recebimentos│  tipo_recebimento=fiscal
│         (+ fallback        │  venda_pagamentos SEM tipo)
└─────────────┬─────────────┘
              │
              ▼
         XML NFC-e
```

\*Defaults em `configuracaoService.js`: `midp_ativado: false`, `midp_politica: 'LEGADO'`.

---

## Auditoria por ponto

### 1) “VendaApplicationService” → `VendaPagamentoService`

| Pergunta | Resposta |
|----------|----------|
| Onde MidpDecisionResult é recebido? | Só se política = `PRESERVAR_DINHEIRO` → `midpResult.decisao` |
| Onde é armazenado? | Em memória (`midpResult.decisao`); **não** há tabela MidpDecision |
| Onde deixa de ser propagado? | Com `LEGADO`: `decisao` nunca é criada. Com PRESERVAR: `aplicarDecisaoMidpNosItens` grava em `distribuicaoItens` → `vendas_itens` (aí sim propaga) |

Arquivo: `backend/services/vendas/VendaPagamentoService.js`  
Funções: `distribuirPagamentosMidp`, `aplicarDecisaoMidpNosItens`, `lerTotaisDecisaoMidp`

```206:220:backend/services/vendas/VendaPagamentoService.js
function aplicarDecisaoMidpNosItens(distribuicaoItens, decisao) {
  if (!decisao || !Array.isArray(decisao.itensAjuste) || decisao.itensAjuste.length === 0) {
    return distribuicaoItens;  // ← descarte quando LEGADO / sem decisão
  }
  // ...
}
```

### 2) Motor Fiscal

| Pergunta | Resposta |
|----------|----------|
| Retorna itensAjuste? | **Não.** Só intervalo `valorFiscalMaximo/Minimo/Efetivo` |
| Responsabilidade | Margem/estoque — **não** política de pagamento |

Arquivos:  
`backend/motores/fiscal-nao-fiscal/*`  
`FiscalOperacionalResult` não carrega `itensAjuste`.

### 3) DistribuidorPagamento

| Entrada (LEGADO) | Saída |
|------------------|-------|
| `valorFiscal` = máximo (ex. 15) | `recebimentosFiscal` rateados até 15 |
| `valorNaoFiscal` = resto | `recebimentosNaoFiscal` |
| `pagamentos` originais (PIX 10 + Dinheiro 5) | PIX 10 fiscal + Dinheiro 5 fiscal (se NF=0) |

**Não recebe** `MidpDecisionResult`. Recebe só totais finais via `MidpEngine`.

Com PRESERVAR ativo e decisão 10/5, a entrada do Distribuidor seria `valorFiscal=10` — aí PIX 10 fiscal e Dinheiro 5 não fiscal.  
Hoje, com LEGADO e máx=15, o dinheiro também entra no fiscal.

Arquivos:  
`backend/motores/midp/MidpEngine.js`  
`backend/services/DistribuidorPagamento.js`  
`backend/motores/midp/policies/LegacyDistributionPolicy.js` (sem `decisao`)

### 4) Builder XML — origem dos itens

| Origem | Uso |
|--------|-----|
| `resultadoMidp.itensAjuste` | **Nunca** lido pelo emissor/XML |
| `vendas_itens` (DB) | **Única** fonte |
| `mapearItemDocumento` | `quantidadeComercial` / `valorFiscal` a partir do item persistido |

Arquivos:  
`backend/services/fiscal/emissor.js` (`carregarVenda`, `itemEntraNaNfce`)  
`backend/services/fiscal/xmlBuilder.js` (`buildNfceXml`)  
`backend/motores/motor-conversao-comercial/integracao/fiscal/FiscalOperacionalService.js`

Se `quantidade_fiscal` persistida = 3 e `valor_fiscal` = 15 → XML com 3 / 15.

### 5) Builder `<pag>`

| Prioridade | Fonte |
|------------|--------|
| 1º | `venda_recebimentos` com `tipo_recebimento` |
| 2º | fallback `venda_pagamentos` (**sem** tipo → todos tratados como fiscais) |
| Filtro | `tipo_recebimento === 'fiscal'` **ou** ausência de tipo |

Arquivo: `xmlBuilder.resolverPagamentosNfce`

Se `venda_pagamentos` for usado sem tipo (fallback), PIX 10 + Dinheiro 5 entram **inteiros** na nota — casa com o XML observado.

### 6) Onde o MIDP PRESERVAR é descartado

**Causa raiz (ambiente atual):**

| # | Ponto | O que acontece |
|---|--------|----------------|
| **R1** | Config `midp_politica=LEGADO` (default) | Factory instancia `LegacyDistributionPolicy` |
| **R2** | `LegacyDistributionPolicy.executar` | **Não** cria `MidpDecisionResult` / `itensAjuste` |
| **R3** | `aplicarDecisaoMidpNosItens` | Retorna itens do Motor Fiscal/estoque sem ajuste de qtd |
| **R4** | Persistência `vendas_itens` | Grava qtd/valor fiscal do estoque (ex. 3×15), não 2×10 |
| **R5** | NFC-e | Lê só o persistido; ignora qualquer decisão Midp em memória |

**Causa raiz secundária (mesmo com PRESERVAR ligado no futuro):**

| # | Ponto | Risco |
|---|--------|--------|
| S1 | Fallback `venda_pagamentos` sem `tipo_recebimento` | Pagamentos originais vazam para `<pag>` |
| S2 | NFC-e assíncrona pós-COMMIT | Se `itensAjuste` não for persistido, perda permanente |

---

## Arquivos auditados

| Arquivo | Papel na falha |
|---------|----------------|
| `backend/services/configuracaoService.js` | Default LEGADO / midp off |
| `backend/motores/midp/policies/MidpPolicyFactory.js` | Seleciona LEGADO |
| `backend/motores/midp/policies/LegacyDistributionPolicy.js` | Sem decisão / sem itensAjuste |
| `backend/motores/midp/policies/PreservarDinheiroPolicy.js` | Produziria decisão (não usada se LEGADO) |
| `backend/motores/midp/MidpEngine.js` | Encapsula Distribuidor |
| `backend/services/DistribuidorPagamento.js` | Rateio só por totais |
| `backend/services/vendas/VendaPagamentoService.js` | Descarte se `!decisao`; persistência |
| `backend/services/OrquestradorPagamento.js` | Consome MidpResult de meios |
| `backend/services/fiscal/emissor.js` | Carrega DB; não conhece Midp |
| `backend/services/fiscal/xmlBuilder.js` | XML a partir de itens/pagamentos persistidos |
| `.../integracao/fiscal/FiscalOperacionalService.js` | Snapshot para `<det>` |

---

## Correção proposta (NÃO aplicar nesta sprint)

1. **Configuração:** ativar `midp_politica=PRESERVAR_DINHEIRO` (e avaliar `midp_ativado` conforme regra de feature flag — a política já é selecionada pela factory independentemente do flag em vários caminhos; validar produto).  
2. **Garantir persistência:** com PRESERVAR, `itensAjuste` → `vendas_itens.quantidade_fiscal/valor_fiscal` antes do COMMIT (já existe via `aplicarDecisaoMidpNosItens` **se** houver `decisao`).  
3. **NFC-e `<pag>`:** priorizar sempre `venda_recebimentos` tipados; nunca fallback de `venda_pagamentos` mistos sem tipo.  
4. **Log de ponte (temporário sugerido):** antes do COMMIT e no emissor, logar qtd/valor fiscal persistidos vs `midpResult.decisao` (quando existir).  
5. **Não alterar** algoritmo `PreservarDinheiroCalculator`.

---

## Critério cumprido

> Qual componente ignora o MidpDecisionResult?

**Resposta direta:**  
`LegacyDistributionPolicy` **não gera** o `MidpDecisionResult`; em seguida `aplicarDecisaoMidpNosItens` **ignora** qualquer ajuste; o **emissor/xmlBuilder** só consomem o que foi gravado em `vendas_itens` / recebimentos — portanto a NFC-e reflete o máximo fiscal de estoque + pagamentos LEGADO, não a política PRESERVAR_DINHEIRO.
