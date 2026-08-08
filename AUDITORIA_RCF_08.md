# AUDITORIA RCF-08 — Motor Fiscal × Não Fiscal (Validação XML)

Data: 2026-07-31  
Prioridade: CRÍTICA

---

## 1. Veredito

A geração do XML (`buildNfceXml`) **já usava apenas itens fiscais**, mas a rotina `validarConsistenciaVendaXml()` comparava o XML com **`venda.total` (total geral)** — incorreto em vendas mistas (ex.: total 10 / fiscal 5). O DANFE também podia listar itens/total gerais.

**Correção RCF-08:** validação e DANFE amarrados ao **valor fiscal**; comprovante comercial exibe Fiscal / Não Fiscal / Total.

---

## 2. `validarConsistenciaVendaXml()`

| Campo | Valor |
|-------|--------|
| Arquivo | `backend/services/fiscal/emissor.js` |
| Método | `validarConsistenciaVendaXml(venda, xml, opcoes)` |
| Helper | `resolverTotalFiscalReferencia(venda, itensFiscais)` |

### Antes (bug)

```js
const totalVenda = Number(venda?.total ?? ...); // TOTAL GERAL
Math.abs(totalXml - totalVenda) // falhava ou rejeitava venda mista correta
```

### Depois (RCF-08)

Compara `vNF` com:

1. `venda.valor_fiscal` (preferência)
2. soma dos `itensFiscais[].valor_fiscal`
3. fallback `venda.total` (legado 100% fiscal)

Também valida:

- `<det>` count == itens fiscais
- rejeita XML que espelha o **total geral** quando há parte não fiscal

---

## 3. `buildNfceXml()`

| Campo | Valor |
|-------|--------|
| Arquivo | `backend/services/fiscal/xmlBuilder.js` |
| Método | `buildNfceXml({ config, venda, itens, numero })` |

- Recebe **somente** `itensFiscal` do emissor (`itemEntraNaNfce`: `qtd_fiscal > 0` e `valor_fiscal > 0`)
- `vProd` / `vNF` = soma `obterValorFiscalItem`
- `pag` via `resolverPagamentosNfce` + `limitarPagamentosAoTotalFiscal` (só fiscal / limitado a `vNF`)
- `vTroco` tratado no fluxo de pagamentos fiscais (866)

---

## 4. Itens no XML

```js
// emissor.js
const itensFiscal = itens.filter(itemEntraNaNfce);
buildNfceXml({ ..., itens: itensFiscal, ... });
```

Itens só não fiscais → `status: sem_itens_fiscais` (sem NFC-e).

---

## 5. Pagamentos `<pag>`

`resolverPagamentosNfce`:

- filtra `tipo_recebimento === 'fiscal'` (ou ausência de tipo)
- limita soma a `totalFiscal` (`limitarPagamentosAoTotalFiscal`)

Pagamentos não fiscais ficam fora da NFC-e.

---

## 6. Fluxo oficial

```
Venda
  ↓
Distribuição Fiscal × Não Fiscal (MIDP / estoque)
  ↓
Itens Fiscais → buildNfceXml → validarConsistencia (valor_fiscal) → SEFAZ → DANFE fiscal
Itens Não Fiscais → fora da NFC-e
  ↓
Comprovante Comercial → Fiscal + Não Fiscal + Total geral
```

---

## 7. DANFE

Arquivo: `backend/services/fiscal/danfe.js` → `gerarDanfeHtml`

- Itens: somente fiscais
- Total: `venda.valor_fiscal` (“Total Fiscal”)
- Pagamentos: filtro `tipo_recebimento === 'fiscal'`

---

## 8. Comprovante comercial

Arquivo: `backend/services/comprovanteVendaService.js`

Quando `valor_fiscal` / `valor_nao_fiscal` > 0, imprime:

```
FISCAL
NÃO FISCAL
TOTAL DA COMPRA
```

---

## 9. Logs `[RCF-08]`

- Distribuição Fiscal × Não Fiscal
- Validação XML (totais, dets, ok/divergências)
- DANFE gerado (total fiscal vs XML)

---

## 10. Testes

```bash
node backend/services/fiscal/tests/rcf08-fiscal-nao-fiscal.test.js
```

Cobre: 100% fiscal, 100% não fiscal, mista, múltiplos itens, rejeição de XML=total geral, contrato de pagamentos.

Incorporado em `rcf07_1-suite.test.js`.

---

## 11. Critérios

- [x] XML validado pelo valor fiscal
- [x] DANFE só operação fiscal
- [x] Comprovante com Fiscal / Não Fiscal / Total
- [x] Itens não fiscais fora da NFC-e
- [x] Pagamentos NFC-e limitados ao fiscal
- [x] Testes automatizados
- [x] Relatório entregue

Reinicie o backend e valide uma venda **mista** em homologação (fiscal + não fiscal).
