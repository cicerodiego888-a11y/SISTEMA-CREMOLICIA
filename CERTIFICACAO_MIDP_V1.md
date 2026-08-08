# CERTIFICAÇÃO MIDP V1.0

**Sprint:** 3.8D.3.1  
**Modo:** CERTIFICAÇÃO (somente validação)  
**Data:** 2026-07-29  
**Política homologada:** `PRESERVAR_DINHEIRO` (`PreservarDinheiroPolicy.RC3.FINAL`)

---

## Conclusão

| Item | Resultado |
|------|-----------|
| Cenários 1–15 | **100% APROVADOS** |
| Performance (1.000 vendas) | **APROVADA** (0 falhas) |
| Divergências Produtos × Pagamentos × XML | **Nenhuma** |
| **Status** | **HOMOLOGADO PARA PRODUÇÃO** |
| **Grau de confiança** | **ALTO (95%)** |

O operador e o cliente permanecem inalterados. Nenhuma funcionalidade, algoritmo ou regra fiscal foi modificada nesta sprint.

---

## Escopo validado

| Camada | Validação |
|--------|-----------|
| Motor Fiscal × Não Fiscal | Intervalo máx/mín/margem consumido pelo MIDP |
| MIDP | Decisão quantidade/valor + classificação eletrônicos/dinheiro |
| DistribuidorPagamento | Rateio fiscal × não fiscal a partir dos totais MIDP |
| Venda (pipeline) | Itens ajustados (`itensAjuste`) + totais da decisão |
| Financeiro (invariante) | Σ produtos = Σ pagamentos |
| NFC-e | `resolverPagamentosNfce` fecha `detPag` = `vNF` fiscal |
| Estoque (invariante) | `qFiscal + qNaoFiscal = qVendida`; sem negativos |

---

## Cobertura dos cenários

| # | Cenário | Status | Evidência principal |
|---|---------|--------|---------------------|
| 1 | Somente PIX · inteiro | APROVADO | qF=10 · vF=150 · PIX 150 · XML OK |
| 2 | Somente Dinheiro · inteiro | APROVADO | qF=10 · vF=150 · Dinheiro 150 |
| 3 | PIX+Dinheiro · sem complemento | APROVADO | qF=6 · PIX 90 · Dinheiro fiscal 0 · NF 60 |
| 4 | PIX+Dinheiro · complemento mínimo | APROVADO | qF=**6** · PIX **80** · Dinheiro **10** · NF 4×60 |
| 5 | Fracionável KG · sem complemento | APROVADO | qF≈2,666 · PIX≈80 · Dinheiro fiscal 0 · NF≈2,334 |
| 6 | Mista inteiro+fracionável | APROVADO | Inteiro sem fração; invariantes OK |
| 7 | Unidades UN/KG/M/L/CX/FD | APROVADO | Inteiros sem fração; fracionáveis proporcionais |
| 8 | PIX+Débito+Crédito+Voucher+Dinheiro | APROVADO | Eletrônico 100 → fiscal 100; dinheiro preservado |
| 9 | Eletrônico = mínimo fiscal | APROVADO | efetivo=80 (=mín) · economia 20 |
| 10 | Eletrônico = máximo fiscal | APROVADO | efetivo=100 (=máx) · economia 0 |
| 11 | Complemento R$0,01 | APROVADO | 3 un · PIX 29,99 + Dinheiro 0,01 |
| 12 | Complemento 0,02 / 0,05 / 0,10 | APROVADO | 3 un · complemento exato em cada caso |
| 13 | Apenas fiscal | APROVADO | NF=0 · pag NF=0 |
| 14 | Apenas não fiscal | APROVADO | Fiscal=0 · XML N/A · dinheiro 100 NF |
| 15 | Híbrida | APROVADO | Fiscal 50 + NF 50 · sem complemento |

---

## Invariantes (todos os cenários)

1. **Produtos Fiscais = Pagamentos Fiscais** (± R$0,02)  
2. **Produtos Não Fiscais = Pagamentos Não Fiscais** (± R$0,02)  
3. **Σ Produtos = Σ Pagamentos**  
4. **XML NFC-e** (`resolverPagamentosNfce`) fecha com pagamentos fiscais  
5. **Nenhuma quantidade negativa**  
6. **Nenhuma quantidade > vendida**  
7. **Sem perda de estoque** (`qF + qNF = q`)  
8. **Sem perda financeira** (somas fechadas)

---

## Logs de certificação

Cada cenário emite `[MIDP-CERT]` com:

- Quantidade Fiscal / Não Fiscal  
- Valor Fiscal / Não Fiscal  
- PIX Fiscal / Dinheiro Fiscal  
- PIX Não Fiscal / Dinheiro Não Fiscal  
- Complemento utilizado  
- Economia de dinheiro  
- Tempo (ms)

---

## Performance (1.000 vendas simuladas)

| Métrica | Valor |
|---------|-------|
| Vendas | 1.000 |
| Falhas de invariante | **0** |
| Tempo total | **67,99 ms** |
| Tempo médio | **0,07 ms** |
| Tempo máximo | **2,72 ms** |
| P95 | 0,14 ms |
| P99 | 0,44 ms |
| Heap Δ | +3,27 MB |
| RSS Δ | +15,31 MB |

Mistura de perfis: PIX puro, complemento, KG, mista, multi-meios.

---

## Como reproduzir

```bash
node backend/motores/midp/tests/certificacao/midp-v1-certificacao.test.js
node backend/motores/midp/tests/certificacao/midp-v1-performance.test.js
```

Regressão (não alterada por esta sprint):

```bash
node backend/motores/midp/tests/midp-rc3-preservar-dinheiro.test.js
node backend/motores/midp/tests/midp-rc2.test.js
node backend/motores/midp/tests/midp-rc1.test.js
```

---

## Arquivos

### Criados

| Arquivo | Papel |
|---------|-------|
| `backend/motores/midp/tests/certificacao/midpCertHelpers.js` | Pipeline + invariantes + log CERT |
| `backend/motores/midp/tests/certificacao/midp-v1-certificacao.test.js` | Cenários 1–15 |
| `backend/motores/midp/tests/certificacao/midp-v1-performance.test.js` | 1.000 vendas |
| `CERTIFICACAO_MIDP_V1.md` | Este relatório |

### Alterados

| Arquivo | Alteração |
|---------|-----------|
| `CHANGELOG.md` | Entrada da certificação |

### **Não alterados** (obrigatório)

- Algoritmos MIDP / PreservarDinheiroCalculator  
- Motor Fiscal / margem / intervalo  
- DistribuidorPagamento  
- Regras NFC-e / Financeiro / Estoque de produção  

---

## Limitações conscientes (5% residual)

- Certificação via **pipeline unitário** (Motor Fiscal shape → MIDP → Distribuidor → `resolverPagamentosNfce`), não via PDV físico com TEF/SEFAZ ao vivo.  
- Financeiro e estoque validados por **invariantes de quantidade/valor**, não por lançamento em banco de produção.  
- Recomenda-se smoke em homologação com 1 venda real por origem (PDV, Comercial, Consignação) após ativar **MIDP** (`midp_ativado=true` — política homologada aplicada automaticamente).

---

## Critério de aprovação — checklist

- [x] 100% dos cenários aprovados  
- [x] Nenhuma divergência Produtos Fiscais × Pagamentos Fiscais × XML  
- [x] Sem quantidade negativa / acima do vendido  
- [x] Sem perda financeira nas somas  
- [x] Performance 1.000 vendas sem falha  

**MIDP V1.0 está HOMOLOGADO PARA PRODUÇÃO.**
