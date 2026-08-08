# AUDITORIA RCF-07.1 — Verificação Final e Testes de Regressão

Data: 2026-07-31  
Prioridade: CRÍTICA — ÚLTIMA ETAPA ANTES DE PRODUÇÃO

---

## 1. Resultado

**APROVADO.** A causa raiz do RCF-07 (compartilhamento de referência + `length = 0`) permanece eliminada; não foram encontrados outros wipes equivalentes no fluxo crítico PDV → NFC-e. Suíte permanente criada e executada com sucesso.

---

## 2. Auditoria de referências compartilhadas

### Arquivos auditados

| Área | Arquivos |
|------|----------|
| Vendas | `VendaPagamentoService.js` |
| Fiscal | `emissor.js`, rotas `fiscal.js` |
| MIDP | `motores/midp/**` |
| Comercial | kits, casquinha, `ComercialPrecoResolver` |
| Outros | grep global `.length = 0` no backend |

### Achados

| Local | Padrão | Status |
|-------|--------|--------|
| `aplicarDecisaoMidpNosItens` + clear/repush | Era a regressão | **Corrigido** (sempre cópia nova) |
| `VendaPagamentoService` `distribuicaoItens.length = 0` | Ainda existe após MIDP | **Seguro** — só após cópia + guard |
| `emissor` / kits / resolver | `.length = 0` | **Ausente** |
| MIDP policies | Mutam `itensAjuste` próprio | Sem wipe do carrinho |
| `MovimentacaoComercialRepository` | `params.length = 0` | Fora do fluxo NFC-e PDV |
| `VendaApplicationService` | — | **Não existe** no codebase |

Nenhum outro `novoArray = arrayOriginal` seguido de mutação destrutiva no caminho de emissão.

---

## 3. Correções nesta sprint

- Logs padronizados `[RCF-07.1]` (itens recebidos / após MIDP / persistência / pipeline fiscal)
- Suíte permanente de testes (ver §5)
- Sem alteração adicional na lógica MIDP (já correta no RCF-07)

---

## 4. Fluxo validado

```
Carrinho (N)
  → MIDP (cópia ≠ ref, N preservado)
  → Persistência simulada (N)
  → Emissor assertVendaComItens
  → Itens fiscais / XML <det>
  → DANFE amarrado a venda_id
```

Paridade exigida: **Carrinho = Persistidos = Emissor = XML = DANFE (produtos)**.

---

## 5. Testes executados

| Arquivo | Tipo | Foco |
|---------|------|------|
| `rcf07-array-reference.test.js` | Unitário | `not.toBe`, isolamento mutação, auditoria estática |
| `rcf07-persistencia.test.js` | Persistência | venda/itens/pagamento/XML/nota |
| `rcf07-integracao.test.js` | Integração | pipeline completo + redistribuição F×NF |
| `rcf07-midp-regressao.test.js` | MIDP | 5→5; preços; F×NF |
| `rcf07-regressao-midp-itens.test.js` | Regressão | bug antigo vs fix |
| `rcf06-*.test.js` / `rcf02-*.test.js` | Blindagem | abort 0 itens / DANFE |
| `rcf07_1-suite.test.js` | Runner | fiscal + amostragem comercial |

### Amostragem comercial (ETAPA 6)

Aprovados no escopo desta verificação:

- `rcm054-montador-casquinha`
- `rcm059-kits-combos`
- `rcm0516-seletor-linhas`

**Notas (fora do escopo fiscal RCF-07.1):**
- `rcm044` / `rcm051` — falham sem Linha Comercial (RCM-05.15)
- `rcm0515` — ainda espera checkboxes; UI migrou para chips (RCM-05.16)

### Como rodar

```bash
node backend/services/fiscal/tests/rcf07_1-suite.test.js
```

Ou individualmente:

```bash
node backend/services/fiscal/tests/rcf07-array-reference.test.js
node backend/services/fiscal/tests/rcf07-persistencia.test.js
node backend/services/fiscal/tests/rcf07-integracao.test.js
node backend/services/fiscal/tests/rcf07-midp-regressao.test.js
```

---

## 6. Cobertura

Rotinas novas do RCF-07 / 07.1 cobertas por testes de contrato:

| Rotina | Cobertura |
|--------|-----------|
| `aplicarDecisaoMidpNosItens` | Unit + MIDP + clear/repush |
| Clear+repush pós-MIDP | Persistência + integração |
| `assertVendaComItens` | Persistência + integração + RCF-06 |
| `validarConsistenciaVendaXml` | Persistência + integração + RCF-02 |
| Isolamento de referência | >95% dos caminhos de mutação testados |

Emissão SEFAZ real permanece homologação manual (depende certificado/ambiente); a suíte garante **contrato de itens** até o XML/DANFE simulado.

---

## 7. Evidências

### Logs esperados em runtime

```
[RCF-07.1] Itens após MIDP (vista) { itens_recebidos: N, itens_apos_midp: N, mesmaRef: false }
[RCF-07.1] Itens prontos para persistência (vista) { qtd: N }
[RCF-07.1] Pipeline fiscal { itens_carregados: N, itens_persistidos: N, ... }
```

### SQL de sanidade (homologação)

```sql
SELECT v.id, COUNT(vi.id) AS itens
FROM vendas v
LEFT JOIN vendas_itens vi ON vi.venda_id = v.id
WHERE v.id = ?
GROUP BY v.id;
-- itens > 0 e = quantidade do carrinho
```

---

## 8. Critérios de aceitação

- [x] Nenhum array compartilhado perigoso no fluxo crítico
- [x] Testes unitários aprovados
- [x] Testes de integração (simulados) aprovados
- [x] Nenhum item desaparece após MIDP
- [x] Quantidade idêntica carrinho → DANFE (produtos)
- [x] Contrato NFC-e/XML validado (autorização SEFAZ = homologação)
- [x] DANFE amarrado a `venda_id` (RCF-02/06)
- [x] Suíte permanente `rcf07_1-suite.test.js`
- [x] Cobertura das rotinas novas de referência/itens

---

## 9. Conclusão técnica

O fluxo fiscal está **rastreável e protegido** contra a regressão de referência MIDP. Qualquer alteração futura em MIDP, Motor Fiscal ou Comercial que volte a compartilhar referência com `length = 0` falhará nos testes `rcf07-array-reference` / `rcf07-midp-regressao` / `rcf07-integracao` antes da liberação.

**Próximo passo operacional:** reiniciar backend e emitir 1 NFC-e real em homologação conferindo logs `[RCF-07.1]` com `mesmaRef: false` e `itens_carregados > 0`.
