# MIDP RC3 FINAL — Preservar Dinheiro

**Sprint:** 3.8D.3  
**Versão:** RC3 FINAL  
**Política:** `PRESERVAR_DINHEIRO`  
**Data:** 2026-07-29  

## Objetivo

Implementar oficialmente a política **PRESERVAR_DINHEIRO** utilizando o  
Motor Fiscal × Não Fiscal, com decisão por **quantidade comercial**  
(fracionável × inteiro) e classificação interna dos pagamentos fiscais.

## Princípio

O operador informa apenas:

- PIX · Cartão · Dinheiro · Voucher · etc.

**Nunca** informa “Pagamento Fiscal” / “Pagamento Não Fiscal”.

Essa distribuição é responsabilidade **exclusiva** do sistema (MIDP).

O operador e o cliente **não percebem** a classificação — o PDV permanece idêntico.

## Responsabilidade

| Camada | Decide | Não conhece |
|--------|--------|-------------|
| Motor Fiscal | `valorFiscalMaximo`, `valorFiscalMinimo`, margem | Pagamentos, política MIDP |
| **MIDP** | Quantidade/valor fiscal efetivo + classificação PIX/Dinheiro fiscal | — |
| DistribuidorPagamento | Rateio dos meios com totais finais | Margem, produtos, quantidade, política, Motor Fiscal |
| XML NFC-e | Produtos/qtd/valor/pagamentos **fiscais** | Não fiscal, margem, política |

```
FiscalOperacionalResult + itens[] + pagamentos[]
              │
              ▼
     MidpPolicyFactory
              │
              ▼
   PRESERVAR_DINHEIRO (RC3 FINAL)
              │
              ▼
      MidpDecisionResult
              │
              ▼
 MidpEngine → DistribuidorPagamento(efetivo, naoFiscal, pagamentos)
              │
              ▼
           MidpResult
```

## Algoritmo

1. Receber pagamentos e itens (com preço, qtd fiscal máxima, flag fracionável).
2. Somar meios **eletrônicos** (exceto dinheiro).
3. Calcular capacidade fiscal dentro do intervalo do Motor Fiscal.
4. **Produto fracionável** → emitir quantidade proporcional:  
   `qFiscal = valorEletronico / valorUnitário` (dinheiro fiscal = 0 se eletrônico cobrir).
5. **Produto não fracionável** → emitir somente quantidade **inteira**.
6. Se faltar pouco para a próxima unidade inteira → usar **apenas o complemento mínimo em dinheiro**.
7. Classificar internamente os pagamentos fiscais (`valorFiscalPIX` = eletrônicos; `valorFiscalDinheiro` = complemento).
8. Todo dinheiro restante permanece automaticamente na parte **não fiscal**.

```
se NÃO possuiMargemFiscal:
  emitir quantidade/valor fiscal máximo
senão:
  fracionável: qF = min(qMax, eletrônico / preço)
  inteiro:     qFloor = floor(eletrônico / preço)
               se ceil necessário e há dinheiro ≥ complemento:
                 qF = ceil; dinheiroFiscal = complemento
               senão:
                 qF = qFloor
  clamp valor ∈ [mínimo, máximo]
  economia = máximo − efetivo
  naoFiscal' = naoFiscal + economia
```

### Meios eletrônicos

`pix`, `pix_tef`, `cartao`, `cartao_debito`, `cartao_credito`, `credito`,  
`debito`, `tef`, `voucher`, `vale_*`, `transferencia`, `deposito`

**Excluído:** `dinheiro`.

### Fracionável × inteiro

| Critério | Fracionável |
|----------|-------------|
| `produto_fracionado` / `vendido_por_peso` = 1 | Sim |
| `unidade` ∈ KG, LT/L, MT, M2, M3 | Sim (fallback) |
| `tipo_venda` / `modo_venda` = `UNIDADE` | **Não** (força inteiro) |

## Exemplos

### Fracionável (kg)

| Campo | Valor |
|-------|-------|
| Produto | 5 kg · R$150 (R$30/kg) |
| PIX | R$80 |
| Dinheiro | R$70 |

| Resultado | |
|-----------|--|
| Fiscal | **2,666… kg** · ≈ R$80 · PIX |
| Dinheiro fiscal | R$0 |
| Não fiscal | 2,333… kg · R$70 |

### Não fracionável (lâmpadas)

| Campo | Valor |
|-------|-------|
| Produto | 10 un · R$15 |
| PIX | R$80 |
| Dinheiro | R$70 |

`80 / 15 = 5,333` → **não permitido** → próxima unidade = **6** → necessário R$90 → complemento dinheiro R$10.

| Resultado | |
|-----------|--|
| Fiscal | **6 un** · R$90 · PIX 80 + Dinheiro 10 |
| Não fiscal | 4 un · R$60 (dinheiro restante) |

### XML NFC-e (trecho conceitual)

Recebe **somente** o fiscal:

- Quantidade produtos: 6  
- Valor produtos: 90  
- Pagamentos: PIX 80 · Dinheiro 10  

## Contrato MidpDecisionResult

```json
{
  "valorFiscalEfetivo": 90,
  "quantidadeFiscal": 6,
  "valorFiscalPIX": 80,
  "valorFiscalDinheiro": 10,
  "valorNaoFiscal": 60,
  "quantidadeNaoFiscal": 4,
  "economiaDinheiro": 60,
  "politica": "PRESERVAR_DINHEIRO",
  "algoritmo": "PreservarDinheiroPolicy.RC3.FINAL",
  "versao": "RC3",
  "tempoMs": 0
}
```

> `valorFiscalPIX` = soma dos **meios eletrônicos** alocados ao fiscal  
> (PIX, cartão, voucher, …), conforme o contrato do sprint.

Alias de compatibilidade: `valorFiscalEfetivoProposto` ≡ `valorFiscalEfetivo`.

## Validações

- Nunca emitir fração de produto inteiro.
- Nunca utilizar dinheiro quando o eletrônico for suficiente.
- Sempre o menor complemento possível quando necessário.
- Sempre preservar o máximo possível de dinheiro físico.
- Efetivo sempre ∈ `[valorFiscalMinimo, valorFiscalMaximo]`.

## Configuração (Sprint 3.8D.3.2)

A UI expõe **apenas ligado/desligado**. Não há seleção de política.

| `midp_ativado` | Comportamento |
|----------------|---------------|
| `false` | Fluxo legado (`LegacyDistributionPolicy`) |
| `true` | Sempre `PRESERVAR_DINHEIRO` (algoritmo RC3 FINAL homologado) |

`midp_politica` continua sendo **lida** só por compatibilidade com configs antigas.  
Na gravação, `LEGADO` é convertido automaticamente para `PRESERVAR_DINHEIRO`.

## Origens cobertas

PDV · Comercial · Consignação · Pedido · Orçamento · API  

(Todas usam o mesmo `MidpService`; apenas o rótulo de origem muda.)

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `policies/PreservarDinheiroCalculator.js` | Algoritmo oficial |
| `policies/PreservarDinheiroPolicy.js` | Política + MidpEngine |
| `MidpDecisionResult.js` | Contrato da decisão |
| `MidpService.js` | Aceita `itens` + `fiscalOperacional` |
| `VendaPagamentoService.js` | Repassa itens; aplica `itensAjuste` |
| `tests/midp-rc3-preservar-dinheiro.test.js` | Casos |

## Testes

```bash
node backend/motores/midp/tests/midp-rc3-preservar-dinheiro.test.js
node backend/motores/midp/tests/midp-rc2.test.js
node backend/motores/midp/tests/midp-rc1.test.js
```

## Critério de aprovação

O operador continua trabalhando como sempre.  
O cliente continua pagando como sempre.  
O MIDP classifica internamente os pagamentos fiscais, maximizando meios  
eletrônicos e usando dinheiro **somente** quando estritamente necessário  
para completar a emissão fiscal.
