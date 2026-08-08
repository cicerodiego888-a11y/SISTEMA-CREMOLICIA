# ANÁLISE TÉCNICA — RCM-9.0
# Contagem para Atacado em vendas com unidades diferentes

| Campo | Valor |
|---|---|
| Sprint | RCM-9.0 (análise) |
| Data | 2026-08-07 |
| Natureza | Análise funcional e arquitetural · **sem implementação** |
| Escopo | Ativação automática do Canal Atacado |
| Restrição | Não altera código, banco, APIs ou comportamento |

---

## 1. Resumo executivo

Hoje a ativação automática do **Canal Atacado** soma o campo bruto `quantidade` das linhas elegíveis do carrinho (`TOTAL_VENDA`), **sem** distinguir Unidade Comercial, Unidade Base, peso ou peça.

No cenário Cremolicia:

| Entrada | Soma atual | Esperado pelo negócio |
|---|---|---|
| 29 picolés (UN) + 1 pote 0,250 KG | **29,25** | **30 itens comerciais** |
| Estoque | — | −29 UN + −0,250 KG |

**Diagnóstico:** a contagem de canal e a movimentação de estoque estão acopladas ao mesmo número físico da linha. O negócio precisa de **dois eixos**:

1. **Contagem comercial** → decide VAREJO × ATACADO (contexto de preço).  
2. **Quantidade base / MUC** → movimenta estoque.

A arquitetura oficial de precificação (RCM-8.0) já separa **Canal → Tabela → Preço → Snapshot** do estoque. A lacuna está só na **métrica de contagem** dentro do `CanalVendaResolver`.

---

## 2. Cenário de estudo (Cremolicia)

```text
Carrinho
  · 29 × Picolé          (UN)
  · 1 × Pote sorvete     (apresentação comercial)
       estoque equivalente = 0,250 KG

Negócio
  Contagem Atacado = 30 itens comerciais  → Tabela Atacado
  Estoque          = −29 UN e −0,250 KG
```

Com mínimo típico = 30 (`quantidade_minima` na Tabela Atacado / config):

- **Hoje:** 29 + 0,250 = **29,25** → `quantidade_insuficiente` → permanece VAREJO.  
- **Desejado:** 30 → `regra_atacado_atingida` → ATACADO.

---

## 3. Onde ocorre a contagem hoje

### 3.1 Ponto único de decisão (oficial)

| Camada | Arquivo | Função |
|---|---|---|
| **Núcleo** | `backend/modules/comercial/preco/CanalVendaResolver.js` | `resolver`, `avaliarContagem`, `somar`, `obterRegrasAtacado` |
| Orquestração | `backend/modules/comercial/configuracao/ConfiguracaoComercialService.js` | `resolverCanal`, `resolverPrecosVenda` |
| HTTP | `POST /api/configuracao-comercial/resolver-canal` | Canal apenas |
| HTTP | `POST /api/configuracao-comercial/resolver-precos` | Canal + preços por item |

Fluxo certificado:

```text
Prioridade CanalVendaResolver
  1) canal_manual (EVENTO, CONSIGNADO, …)     → não usa quantidade
  2) cliente_id → Tipo Comercial → canal_padrao → não usa quantidade
  3) Automático:
       regras ← Tabela Atacado (atacado_habilitado) senão configuracao_comercial
       elegíveis ← itens com participa_atacado ≠ 0
       avaliarContagem(tipo_contagem, quantidade_minima)
       atende? ATACADO : VAREJO
  → ComercialPrecoResolver resolve preço no canal obtido
  → Snapshot no item (PDV)
```

Trecho central (`TOTAL_VENDA`):

```171:185:backend/modules/comercial/preco/CanalVendaResolver.js
  } else {
    // TOTAL_VENDA — soma de itens elegíveis (produtos/linhas mistos OK)
    quantidadeAvaliada = somar(elegiveis);
    atende = quantidadeAvaliada >= min;
  }
// ...
function somar(itens) {
  return (itens || []).reduce((acc, i) => acc + Number(i.quantidade || 0), 0);
}
```

`normalizarItens` só preserva `produto_id`, `quantidade`, `categoria_id`, `linha_comercial_id`, `participa_atacado`. **Não** lê `unidade_comercial`, `forma_comercializacao`, fator MUC nem quantidade base.

### 3.2 PDV Desktop

| Função | Papel |
|---|---|
| `montarItensResolverCanalPdv()` | Envia `{ produto_id, quantidade, categoria_id, participa_atacado }` |
| `agendarRecalculoCanalComercialPdv()` | `POST resolver-precos` a cada mudança de carrinho |
| `atualizarCarrinho()` | Dispara o recálculo |
| Badge / progresso | Usa `quantidadeAtual` / `quantidadeNecessaria` do resolver |

Arquivo: `frontend/pdv/js/pdv.js`.

### 3.3 PDV Mobile

Força `canal: 'VAREJO'` em `resolver-precos`. **Não** aplica contagem automática de Atacado (lacuna já documentada em `AUDITORIA_PDV_PRECIFICACAO.md`).

### 3.4 Comercial / Consignação

`NovaConsignacao` envia canal manual **CONSIGNADO**. Bypass completo da regra de quantidade. Correto para o domínio consignado.

### 3.5 Preço (não é contagem)

`ComercialPrecoResolver` **não** decide Atacado por quantidade. Só precifica no canal já resolvido. Faixas `produto_atacado` foram removidas do fluxo oficial (RCM-8.0 / RCM-8.6.2).

### 3.6 MUC / MCC / Estoque

Convertem **quantidade comercial → base** para baixa de estoque. **Não** participam da decisão de canal. Separação correta e deve ser preservada.

### 3.7 MIDP

Distribuição fiscal × não fiscal. **Sem** relação com Atacado.

---

## 4. O que a contagem utiliza hoje?

| Critério | Usado? |
|---|---|
| Quantidade física bruta da linha (`item.quantidade`) | **Sim** (único input da soma) |
| Quantidade na Unidade Comercial da Tabela | Não (campo nem enviado no payload de canal) |
| Quantidade convertida para Unidade Base (MUC) | Não |
| Número de linhas / inclusões no carrinho | Não |
| Forma de Comercialização | Não |
| Snapshot / Kit expandido | Não (kit = 1 linha com sua `quantidade`) |

**Resposta objetiva:** a contagem usa a **quantidade informada na linha do carrinho**, tratada como escalar adimensional. Em vendas mistas UN + KG isso se comporta como **soma de magnitudes físicas heterogêneas** — não como “itens comerciais”.

Exemplo com mín. = 30:

| Carrinho | Soma | Canal |
|---|---|---|
| 20 UN + 15 UN | 35 | ATACADO |
| 20 UN + 10,5 KG | 30,5 | ATACADO |
| 29 UN + 0,250 KG | 29,25 | VAREJO |
| 25 UN + 0,8 KG | 25,8 | VAREJO |

---

## 5. A arquitetura oficial prevê algo equivalente?

| Domínio | Conceito | Relação com contagem Atacado |
|---|---|---|
| Motor Oficial de Precificação | Canal → Tabela → Preço → Snapshot | Canal é **contexto**; a métrica de ativação é detalhe interno do `CanalVendaResolver` |
| Central / Tabela Atacado | `quantidade_minima`, `tipo_contagem`, `atacado_habilitado` | Já parametrizam o **limiar** e o **modo de agregação** (TOTAL_VENDA, POR_PRODUTO, POR_LINHA, POR_CATEGORIA) — **não** a unidade da métrica |
| Produto | `participa_atacado`, `forma_comercializacao`, Unidade Base | Elegibilidade e forma de venda; base é estoque |
| Tabela | Unidade Comercial (RCM-8.8) | Define UC do **preço**, não da contagem atual |
| MUC / RCM-8.9 | Conversões canônicas e do produto | Estoque; ortogonal ao canal |
| Linha | Agrupa preço | Só entra em `POR_LINHA` |
| Snapshot | Congela preço/canal/UC | Pós-decisão |
| Docs | `AUDITORIA_ARQUITETURA_PRECIFICACAO.md` §9, `RCM80`, `AUDITORIA_CANAL_COMERCIAL` | Oficializam Atacado = canal do carrinho via `TOTAL_VENDA` + `participa_atacado` |

**Conclusão:** a arquitetura prevê **Atacado como canal de venda** e já separa preço de estoque. **Não** há ainda um conceito certificado de “quantidade comercial para contagem de canal” distinto da quantidade da linha. Isso é a lacuna do RCM-9.0 — não um conflito com RCM-8.x.

Os modos `POR_*` mudam **como** se agrega a mesma métrica bruta; nenhum corrige UN+KG.

---

## 6. Alternativas (sem implementar)

### Opção A — Continuar com quantidade física (status quo)

**Prós**
- Zero alteração.
- Determinística e já testada (`rcm053`, RA-6).
- Simples de auditar.

**Contras**
- Falha no caso Cremolicia (29,25 &lt; 30).
- Mistura dimensões (UN + KG).
- UX confusa: progresso “29,25 / 30”.
- Empurra o operador a “inventar” quantidades só para bater o mínimo.

**Impacto:** nenhum. **Aderência ao negócio:** baixa.

---

### Opção B — Contar pela Forma de Comercialização

Regra candidata (reusa `forma_comercializacao` já no produto):

- `UNIDADE` / `CASQUINHA` / `KIT` → soma `quantidade` da linha.  
- `PESO` / `VOLUME` → conta **1 por linha** (uma inclusão comercial), independentemente de 0,250 KG ou 2,5 L.

**Prós**
- Reutiliza domínio existente (RCM-04.3).
- Sem tabela/campo novo.
- Casa com o exemplo: 29 + 1 = 30.
- Não depende de MUC nem de preço.

**Contras**
- Venda a granel de 5 KG em **uma** linha conta 1 (pode ser pouco ou muito, conforme política).
- Venda a granel digitada como várias pesagens (várias linhas) conta N.
- Exige enriquecer o resolver com `forma_comercializacao` (já disponível no cadastro).
- Personalizada / casquinha precisam de regra explícita (hoje costumam ser “peça”).

**Impacto:** baixo–médio (1 serviço núcleo + payload PDV + testes + progresso UX).

---

### Opção C — Contar pela Unidade Comercial utilizada na venda

Usar a quantidade na **UC da operação/Tabela** (já retornada pelo Resolver de preço / RCM-8.8):

- Linha em UN/POTE/PÇ → soma a quantidade comercial.  
- Se o PDV já opera em UC discreta (“1 pote”), a contagem natural é 29+1.  
- Se o PDV ainda grava 0,250 na linha com UC=KG, o problema **não some** sem alinhar a inclusão do item.

**Prós**
- Alinha com arquitetura UC na Tabela (RCM-8.8).
- Separação clara: UC = comercial; Base = estoque (MUC).
- Sem novo cadastro se a UC já vem da tabela/snapshot.

**Contras**
- Depende do PDV enviar `unidade_comercial` + quantidade **comercial** no payload de canal (hoje não envia UC).
- Produtos pesados vendidos “na balança” em KG continuam ambíguos sem regra auxiliar (B ou E).
- Risco se alguém confundir com converter tudo para base via MUC (isso **não** deve alimentar o canal).

**Impacto:** baixo–médio (payload + `normalizarItens` + `somar`).

---

### Opção D — Contar inclusões no carrinho (número de linhas / add)

**Prós**
- Implementação trivial (`elegiveis.length`).

**Contras**
- 29 picolés em **uma** linha = 1 inclusão → nunca atinge 30.
- Incompatível com o exemplo e com `TOTAL_VENDA` certificado.
- Quebra o modelo mental “comprei 30 unidades”.

**Impacto:** pequeno no código, **grande** no negócio. **Descartada.**

---

### Opção E — Híbrido (recomendado na auditoria)

Combinar o que já existe, sem cadastro novo:

```text
Para cada linha elegível (participa_atacado):
  se Forma ∈ {UNIDADE, CASQUINHA, KIT, PERSONALIZADA}
       ou UC discreta (UN, UND, PC, POTE, PÇ, …)
    → contribui com quantidade da linha (comercial)
  se Forma ∈ {PESO, VOLUME}
       ou UC contínua (KG, G, L, ML, …)
    → contribui com 1 (uma inclusão comercial)
       // alternativa parametrizável futura: ceil(qtd) — NÃO recomendada agora
TOTAL_VENDA = soma das contribuições
```

**Prós**
- Resolve Cremolicia: 29 + 1 = 30.  
- Preserva estoque via MUC (inalterado).  
- Reusa `forma_comercializacao` + UC já no domínio.  
- Não cria tabela, config obrigatória nem cadastro novo.  
- Mantém `quantidade_minima` / `tipo_contagem` / `participa_atacado`.  
- Compreensível: “cada peça conta 1; cada pesagem/linha de peso conta 1”.

**Contras**
- Granel multi-quilo em uma linha = 1 (documentar como regra de negócio).  
- Precisa enriquecer itens no resolver (forma e/ou UC).  
- Progresso UX deve mostrar inteiros (30/30), não 29,25.  
- Kits/casquinha: validar se 1 kit = 1 ou = componentes (hoje kit = 1 linha → 1 na parte discreta se qty=1).

**Impacto:** concentrado em `CanalVendaResolver` (+ enrich) e ajuste fino do payload PDV; testes de canal; badge. Preço, MUC, Snapshot e Tabela **inalterados** em contrato.

---

### Opção F (encontrada) — Converter tudo para Unidade Base via MUC e somar

**Prós:** reaproveita RCM-8.9.

**Contras:** 29 UN + 0,250 KG → ainda 29,25 (ou pior, dimensões incompatíveis). **Não resolve** o caso. Pode gerar erro de conversão LT↔KG. **Descartada** para contagem de canal.

---

## 7. Qual altera menos o sistema?

| Opção | Arquivos típicos | Serviços | Compatibilidade | Risco |
|---|---|---|---|---|
| A | 0 | 0 | Total | Negócio continua falhando |
| B | ~3–6 | CanalVendaResolver + enrich + PDV payload | Alta se fallback = qty atual quando forma ausente | Médio (granel) |
| C | ~3–6 | Idem + UC no payload | Alta se UC ausente → qty atual | Médio (balança em KG) |
| D | ~1–2 | CanalVendaResolver | Quebra TOTAL_VENDA | Alto |
| E | ~4–8 | CanalVendaResolver + Forma/UC + PDV + testes + UX progresso | Alta com fallback seguro | Baixo–médio |
| F | vários + MUC | Mistura eixos | Baixa | Alto |

**Menor impacto útil:** **E** (ou B puro se a Cremolicia padronizar Forma no cadastro). Alteração localizada no **mesmo** choke point oficial da contagem — sem tocar no Resolver de preço, nas Tabelas, no MUC de estoque nem no Snapshot.

Estimativa de superfície (E):

- `CanalVendaResolver.js` (núcleo)  
- Enrich de produto (`forma_comercializacao`, opcionalmente UC)  
- `montarItensResolverCanalPdv` (campos extras opcionais)  
- Testes `rcm053` / RA-6 / novo RCM-9.x  
- Badge progresso PDV  
- Doc de regra de negócio  

**Não precisa:** migration, nova tela de cadastro, nova config obrigatória, mudança de `ComercialPrecoResolver`, mudança de baixa de estoque.

---

## 8. Funcionalidades potencialmente impactadas

| Área | Impacto se adotar E/B |
|---|---|
| PDV Desktop | Progresso e momento da troca VAREJO↔ATACADO; preços via mesmo fluxo |
| PDV Mobile | Só se passar a usar canal automático (hoje força VAREJO) |
| Consignação | Nenhum (canal manual) |
| Comercial / pedidos futuros | Mesmo resolver — beneficiam da mesma métrica |
| Relatórios / Dashboard | Só se exibirem `quantidade_avaliada` do canal; vendas históricas inalteradas |
| MUC / MCC / Estoque | **Nenhum** (eixo separado) |
| Promoções | Aplicadas após preço resolvido; indireto se canal mudar mais cedo |
| Kits / Casquinha | Contam pela qty da linha (geralmente 1) na parte discreta |
| Snapshot | Continua gravando canal/preço; sem novo campo obrigatório |
| Tipo Comercial (cliente) | Continua prioridade 2 — acima da contagem |
| Tabela / Linha / Preço | Inalterados |

---

## 9. Reuso de estruturas existentes (sem novos cadastros)

Já disponíveis e suficientes para E/B/C:

| Artefato | Uso na contagem |
|---|---|
| `participa_atacado` | Elegibilidade (mantém) |
| `quantidade_minima` + `tipo_contagem` | Limiar e agregação (mantém) |
| `forma_comercializacao` | Discriminar peça × contínuo |
| `unidade_comercial` (Tabela / item) | Refinar discretude (C/E) |
| `CanalVendaResolver` | Único ponto de mudança |
| MUC | Continua só no estoque |

**Evitar:** novos campos no produto só para “peso conta como 1”, novas tabelas de regra, configuração manual “fator de contagem por SKU”, misturar MIDP ou fiscal.

---

## 10. Benchmark interno (CDS)

| Conceito existente | Parecido? | Reaproveitável? |
|---|---|---|
| `TOTAL_VENDA` + `participa_atacado` | Sim — é o mecanismo oficial | Sim — só troca a **métrica** |
| `quantidade_comercial` (PDV/MCC/estoque) | Sim — eixo comercial vs base | Sim como **fonte** da qty da linha, não como soma em base |
| Forma de Comercialização | Sim — UNIDADE vs PESO/VOLUME | Sim — discriminador ideal |
| UC da Tabela (RCM-8.8) | Sim — “o que foi vendido” | Sim — complementar |
| Conversões produto (RCM-8.9) | Não para canal | Não (estoque) |
| Faixas `produto_atacado` | Legado por SKU | **Não** reativar |
| MIDP | Contagem fiscal | Não |
| Kits | 1 linha comercial | Sim, como está |

Não há outro motor paralelo de “contagem atacado” ativo no fluxo oficial além do `CanalVendaResolver`.

---

## 11. Critérios de aceite da análise × opções

| Critério | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| Preserva arquitetura certificada | ✔ | ✔ | ✔ | ✖ | ✔ | ✖ |
| Sem cadastro obrigatório novo | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Sem config manual nova | ✔ | ✔ | ✔ | ✔ | ✔ | ~ |
| Reusa domínio existente | ✔ | ✔ | ✔ | ~ | ✔ | ~ |
| Menor impacto no código | ✔ | ✔ | ✔ | ✔ | ✔ | ✖ |
| Compreensível ao usuário | ✖ | ✔ | ✔ | ✖ | ✔ | ✖ |
| Aderência Cremolicia 29+pote | ✖ | ✔ | ~ | ✖ | ✔ | ✖ |

---

## 12. Recomendações

### 12.1 Recomendação técnica

Adotar a **Opção E (híbrido Forma + UC discreta/contínua)** com implementação futura concentrada em `CanalVendaResolver.avaliarContagem` / `somar`, enriquecendo itens com `forma_comercializacao` (e opcionalmente `unidade_comercial`).

Fallback seguro: se forma/UC ausentes, manter soma atual da `quantidade` (compatibilidade).

**Não** converter para Unidade Base via MUC para decidir canal.  
**Não** contar número de linhas (Opção D).  
**Não** reativar faixas `produto_atacado`.

### 12.2 Recomendação arquitetural

Formalizar dois eixos já implícitos na plataforma:

```text
Eixo Comercial (Canal / Preço)
  quantidade_contagem_atacado  ← peças + inclusões contínuas
  CanalVendaResolver → ATACADO | VAREJO
  ComercialPrecoResolver → preço
  Snapshot

Eixo Físico (Estoque)
  quantidade comercial da linha + UC
  MUC / MCC → quantidade base
  Motor Estoque
```

Isso **não** cria novo motor: apenas define a métrica correta no resolver de canal, alinhada a RCM-8.0 / 8.8 / 8.9.

Documentar regra de negócio explícita:

> Em `TOTAL_VENDA`, contam-se **itens comerciais**: unidades/peças pela quantidade informada; produtos por peso/volume contam **1 por linha do carrinho**. Estoque permanece na Unidade Base via MUC.

### 12.3 Recomendação de negócio (Cremolicia)

Para o balcão:

- 29 picolés + 1 pote (mesmo que o pote pese 0,250 KG) = **30** → Atacado.  
- Progresso deve falar em “itens” (inteiros), não em “29,25”.  
- Operador **não** precisa cadastrar fator especial nem “ensinar” o sistema a somar UN+KG.  
- Se no futuro granel multi-quilo precisar contar proporcionalmente, isso seria **evolução parametrizada** — fora do MVP e fora do exemplo atual.

Boas práticas operacionais complementares (sem código):

- Preferir incluir pote/peça com quantidade **1** na UC comercial quando a Tabela for em pote/UN.  
- Manter `participa_atacado` coerente nos SKUs de balcão.  
- Cliente com Tipo Comercial continua mandando no canal (prioridade 2).

---

## 13. Veredito final

**Veredito final (implementação RCM-9.0.1):** contagem comercial híbrida por Forma adotada em `CanalVendaResolver` — ver `docs/RCM901_CONTAGEM_ATACADO.md`.

A solução com **melhor equilíbrio** entre simplicidade, manutenção e aderência ao fluxo real da Cremolicia é a **Opção E — contagem comercial híbrida (Forma de Comercialização + UC discreta/contínua)**, aplicada apenas no `CanalVendaResolver`, reutilizando domínio já certificado e **sem** novos cadastros, tabelas ou dependência de configuração manual.

Ela:

- corrige 29 + 0,250 → **30 itens**;  
- preserva −29 UN e −0,250 KG no estoque;  
- não toca no Motor Oficial de Preço nem no MUC;  
- é explicável ao usuário (“cada peça conta; cada pote/pesagem conta como um item”).

**Próximo passo (fora deste documento):** sprint de implementação RCM-9.1 com testes de regressão de canal (`TOTAL_VENDA`, `participa_atacado`, prioridade manual/cliente) e caso canônico Cremolicia 29 UN + 1 pote.

---

## 14. Referências de código e docs

- `backend/modules/comercial/preco/CanalVendaResolver.js`  
- `backend/modules/comercial/configuracao/ConfiguracaoComercialService.js`  
- `frontend/pdv/js/pdv.js` (`montarItensResolverCanalPdv`, `agendarRecalculoCanalComercialPdv`)  
- `backend/modules/comercial/preco/FormaComercializacao.js`  
- `docs/RCM80_ARQUITETURA_OFICIAL.md`  
- `docs/AUDITORIA_ARQUITETURA_PRECIFICACAO.md` §9  
- `docs/AUDITORIA_CANAL_COMERCIAL.md`  
- `docs/AUDITORIA_PDV_PRECIFICACAO.md`  
- `docs/RCM88_MUC_ARQUITETURA.md` / `docs/RCM89_CONVERSOES_PRODUTO.md`
