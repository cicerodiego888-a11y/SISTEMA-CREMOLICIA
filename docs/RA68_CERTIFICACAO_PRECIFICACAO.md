# RA-6.8 — Certificação Enterprise da Arquitetura de Precificação

| Campo | Valor |
|---|---|
| Tipo | Certificação (sem novas funcionalidades) |
| Data | 2026-08-06 |
| Base | RA-6 → RA-6.7 |
| Evidências | `backend/modules/comercial/tests/ra68-certificacao-precificacao.test.js` |
| Métricas brutas | `docs/RA68_METRICS.json` |

---

## Arquitetura oficial certificada

```text
Produto
    ↓
Linha de Precificação
    ↓
Tabela de Preços (canal da venda)
    ↓
Unidade de Comercialização
    ↓
Preço
    ↓
Preço de Segurança (fallback)
    ↓
MUC
    ↓
Estoque
```

**Confirmado:** o Resolver **nunca** usa `produto.tabela_preco_id` no fluxo oficial.

---

## 1. Certificação do Resolver

| Cenário | Resultado | Evidência |
|---|---|---|
| Produto com preço na Tabela | ✓ 58 / KG (Varejo) | `comPrecoTabela` |
| Produto sem preço na Tabela (Linha órfã) | ✓ Preço de Segurança 99,9 | `precoSeguranca` |
| Produto usando Preço de Segurança | ✓ `fallback: true` | idem |
| Produto sem Linha (sem tabela do canal) | ✓ Segurança 12,5 | `semLinha` |
| Produto sem Linha (com tabela no contexto) | ⚠ Compat Tabela×Canal ainda pode retornar preço | `semLinhaComTabela` — **ressalva** |
| Linha inexistente | ✓ Fallback segurança | `linhaInexistente` |
| Linha sem preço | ✓ Fallback segurança | `linhaSemPreco` |
| Canal inexistente + tabela explícita | ✓ Segurança (JOIN exige canal da célula) | `canalInexistente` |
| Unidade Comercial ≠ Base | ✓ Base KG → venda LITRO 28 | `unidadeDiferenteBase` |
| Erro controlado | ✓ `erro` + aviso oficial | `erroControlado` |
| Ignora `produto.tabela_preco_id` | ✓ Isca Atacado ignorada | `ignoraProdutoTabelaPrecoId` |
| Sem conversão no Resolver | ✓ Sem `ConversorUnidades` / `paraBase` | `semConversaoMuc` |

Tempo dos cenários funcionais: **~70 ms**.

---

## 2. Certificação dos Canais

Cada canal com **Tabela própria** (mono-canal):

| Canal | Preço | Unidade | Status |
|---|---|---|---|
| VAREJO | 58,00 | KG | ✓ |
| ATACADO | 28,00 | LITRO | ✓ |
| CONSIGNADO | 26,00 | LITRO | ✓ |
| DELIVERY | 55,00 | KG | ✓ |
| EVENTO | 30,00 | LITRO | ✓ |

---

## 3. Certificação do MUC

| Conversão | Status |
|---|---|
| Base KG → Venda KG (fator 1) | ✓ |
| Base KG → Venda LITRO (fator 0,9) | ✓ |
| Base UN → Venda CX (fator 12) | ✓ |
| Base MT → Venda RL (fator 50) | ✓ |
| Resolver **não** converte | ✓ (análise estática + runtime) |

Conversão permanece exclusiva em `backend/motores/muc/converters/ConversorUnidades.js`.

---

## 4. Certificação de Escalabilidade

Ambiente: SQLite produção local (`mercadao.db`), Node, máquina do desenvolvedor.

| Cenário | N | Tempo | ms/item |
|---|---|---|---|
| `resolverLista` | 100 produtos | 9 ms | 0,090 |
| `resolverLista` | 1.000 produtos | 95 ms | 0,095 |
| Resolves async (reuso 1k) | 10.000 | 731 ms | 0,073 |
| Resolves sync (cache Tabela×Linha) | 50.000 | 2.743 ms | 0,055 |
| Insert 100 linhas + células | 100 | 481 ms | 4,81 |

**Notas metodológicas**

- 10k / 50k medem **throughput do Resolver** (reuso de amostra + cache), não insert de 50k produtos permanentes no banco oficial.
- 100 e 1.000 produtos foram inseridos e removidos no `finally` do teste.
- Heap delta: ~0,8 MB (100) / ~1,7 MB (1.000) no lote async.

**Conclusão de performance:** com cache Tabela×Linha aquecido, o Resolver sustenta dezenas de milhares de resolves/segundo-ordem (~18k/s sync neste ambiente). Adequado a PDV multi-item.

---

## 5. Certificação SQL

### Índices aplicados (migration `017_ra68_indices_performance`)

Somente índices — **sem alteração de comportamento**:

| Índice | Motivo |
|---|---|
| `idx_produtos_linha_comercial` | Hot path resolve Linha do produto |
| `idx_tabela_preco_valores_canal` | Recriação pós-012 (podia estar ausente) |
| `idx_tabela_preco_valores_linha` | Lookup por linha |
| `uq_tpv_tabela_linha_canal` | Integridade + chave oficial (IF NOT EXISTS) |

### EXPLAIN QUERY PLAN (hot path)

```text
SEARCH v USING INDEX idx_tabela_preco_valores_linha (linha_comercial_id=?)
SEARCH c USING INTEGER PRIMARY KEY (rowid=?)
```

SQLite escolheu o índice por linha + PK do canal. A UNIQUE composta permanece para integridade.

### Gargalos / oportunidades (não alterados nesta sprint)

| Item | Severidade | Nota |
|---|---|---|
| Path compat Tabela×Canal sem Linha | Média | Pode mascarar cadastro incompleto |
| `resolverPrecosVenda` 1 SELECT produto por item | Baixa | N+1 clássico; aceitável no PDV típico; batch futuro |
| Filtro `UPPER(c.codigo)` no JOIN | Baixa | Preferível resolver `canal_venda_id` e filtrar por id (rewrite futuro) |
| `aquecerCacheCanal` não preenche cache Tabela×Linha | Baixa | Sync depende de resolve async prévio |

---

## 6. Certificação UX (estática)

| Item | Status |
|---|---|
| Cadastro Produto — Linha de Precificação | ✓ |
| Cadastro Produto — Preço de Segurança + tooltip | ✓ |
| Cadastro Linhas | ✓ (`linhas-comerciais.js`) |
| Cadastro Tabelas + Editor RA-6 | ✓ (`tabelas-preco-ra6.js`) |
| Unidade de Comercialização na grade | ✓ |
| Pesquisa de Linhas | ✓ |
| Virtualização da grade | ✓ |
| Scripts mortos RA-1.1 / RA-2 | ✓ ausentes do `index.html` |

---

## 7. Certificação PDV / Consignação

Via `ConfiguracaoComercialService.resolverPrecosVenda`:

| Cenário | Status |
|---|---|
| Varejo — preço + unidade KG | ✓ |
| Atacado — preço + unidade LITRO | ✓ |
| Consignação — preço LITRO | ✓ |
| Preço de Segurança (`preco_fallback`) | ✓ |

Sem alteração de Motor Comercial / Fiscal / Ledger / Outbox / MUC.

---

## 8. Certificação de Compatibilidade

| Item | Status |
|---|---|
| Paths compat no Resolver (`tabela_preco_produto`, `linha_comercial_valores`, tabela×canal) | ✓ presentes |
| Produto antigo sem Linha (sem tabela) | ✓ Preço de Segurança |
| Coluna `produtos.tabela_preco_id` | ✓ ignorada no resolve oficial |
| Regressão RA-6 / RA-6.4 / RA-6.6 / RA-6.7 | ✓ |

---

## 9. Melhorias aplicadas nesta sprint

1. Migration **017** — índices de desempenho (somente índices).
2. Suíte **`ra68-certificacao-precificacao.test.js`** — cenários + escala + métricas.
3. Artefato **`docs/RA68_METRICS.json`** — evidência reproduzível.

**Não aplicado (de propósito):** remoção dos paths de compatibilidade; rewrite de SQL do Resolver; batch N+1 do PDV.

---

## 10. Parecer técnico final

### **B — Arquitetura certificada com ressalvas**

#### Justificativa

A arquitetura oficial RA-6.6 está **pronta para produção em larga escala** no caminho feliz:

- Produto → Linha → Tabela do Canal → Unidade → Preço → Preço de Segurança  
- Canais isolados por Tabela  
- MUC separado do Resolver  
- PDV/Consignação consumindo preço + unidade  
- Performance do Resolver adequada com cache  
- Índices de hot path presentes  

#### Ressalvas (não bloqueiam go-live; recomendam follow-up)

1. **Compat Tabela×Canal sem Linha** ainda pode devolver preço de tabela quando o produto não tem Linha de Precificação e há tabela no contexto. O fluxo “puro” Preço de Segurança só é garantido sem match de tabela/canal. Cutover futuro: desligar path #4 após saneamento de cadastros.

2. **`resolverPrecosVenda` N+1** (1 query por produto) — ok para tickets típicos; para lotes muito grandes, considerar batch/`resolverLista`.

3. **Escalas 10k/50k** medidas como throughput com cache, não como insert físico de 50k SKUs no banco oficial (evita poluir produção). Volume real do ambiente de teste: ~1,1k produtos / ~100 linhas / ~10 tabelas.

4. Paths de compatibilidade RA-1.1 / LCV permanecem por decisão da RA-6.7 — corretos para migração, mas devem ser monitorados e eventualmente desligados.

#### Quando evoluir para parecer **A**

- Desligar (ou exigir feature-flag) o path Tabela×Canal sem Linha  
- Batch de produtos no `resolver-precos`  
- Saneamento: 100% dos produtos vendáveis com Linha + célula nas Tabelas ativas  

#### Não é parecer **C**

Não há regressão funcional, nem violação da arquitetura oficial no caminho Produto→Linha→Tabela→Preço, nem risco fiscal/estoque introduzido por esta certificação.

---

## Critérios de aceite

- [x] Cenários do Resolver executados  
- [x] Canais certificados  
- [x] MUC certificado (separação)  
- [x] PDV / Consignação certificados  
- [x] Performance validada  
- [x] Sem regressão RA-6.x  
- [x] Arquitetura oficial preservada  
- [x] Documentação completa  

**Comando de reprodução**

```bash
node backend/modules/comercial/tests/ra68-certificacao-precificacao.test.js
```
