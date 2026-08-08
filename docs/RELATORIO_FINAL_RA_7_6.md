# RELATÓRIO FINAL — RA-7.6  
## Canal Comercial × Tipo Comercial × Tabela de Preços

| Campo | Valor |
|---|---|
| Sprint | RA-7.6 |
| Data | 2026-08-06 |
| Natureza | Auditoria arquitetural — **sem alteração de código/banco** |
| Entregáveis | Ver seção 8 |

---

## 1. Resumo executivo

A arquitetura comercial do CDS **possui responsabilidades distintas** entre Canal, Tipo, Linha e Tabela — mas há **sobreposição perceptual** porque, hoje, o Tipo Comercial **quase só aponta para Canal**, e o Canal **quase só aponta para Tabela**.

O Resolver e o PDV estão **corretamente ligados**: ATACADO na interface **consulta** o canal/tabela. Preço igual entre canais é, na maioria dos casos, **cadastro** (tabelas sem diferenciação ou fallback para preço de segurança), não bug de “só UI”.

**Parecer:** manter o modelo atual com clarificação conceitual; evoluir Tipo → **Política Comercial**; não colapsar Canal e Tabela sem perder PDV multi-contexto.

---

## 2. Respostas aos critérios de aceitação

### 1) Responsabilidade exclusiva do Canal Comercial?

Ser o **contexto operacional da cotação/execução** (Varejo, Atacado, Evento, Consignado…): chaveia tabela ativa, célula de preço, forma/unidade e persistência do documento.

### 2) Responsabilidade exclusiva do Tipo Comercial?

**Classificar o Cliente** e definir **canal padrão + canais permitidos**.  
Hoje **não** tem regras de preço próprias; é ponte para o Canal. Abas enterprise (crédito, desconto…) estão só preparadas.

### 3) O Cliente realmente precisa conhecer o Tipo Comercial?

**Sim, se** o Tipo for a política futura (RCM-7.3).  
**Não estritamente**, se a empresa nunca for além de “um canal”: bastaria Canal (ou Tabela) no Cliente — mais simples, menos flexível.

### 4) O Canal agrega valor ou só identifica uma tabela?

**Agrega valor:** decide *quando* mudar de contexto (qty atacado, manual, consignação forçada), restringe permitidos e congela snapshot.  
**Na percepção do usuário**, se todas as tabelas tiverem os mesmos preços, parece “só um nome”.

### 5) O PDV usa o Resolver ou só exibe o nome do canal?

**Usa o Resolver.** Fluxo oficial via `resolver-precos`. Badge espelha o resultado.  
Ver `docs/AUDITORIA_PDV_PRECIFICACAO.md`.

### 6) Existe duplicidade entre Canal, Tipo e Tabela?

| Par | Duplicidade? |
|---|---|
| Canal × Tabela | **Não conceitual** — Canal = contexto; Tabela = grade de preços. Mas 1:1 mono-canal cria sensação de duplicata. |
| Tipo × Canal | **Sobreposição parcial hoje** — Tipo quase só escolhe Canal. Justifica-se pelo roadmap de política. |
| Linha × Tabela | **Não** — Linha agrupa produtos; Tabela cotiza Linha×Canal. |
| Tipo × Tabela | **Não direto** — Tipo não grava preço. |

### 7) Melhor alternativa?

Arquitetura atual é **adequada ao PDV multi-contexto** (consignação/evento/atacado automático).  
Alternativa mais simples (Cliente → Tabela) alinha Omie/Tiny/SAP B1, mas **enfraquece** troca de contexto sem trocar cliente.

**Recomendação:** congelar modelo atual + clarificar papéis + evoluir Tipo; não implementar colapso agora.

---

## 3. Auditoria do Produto (desacoplamento)

Produto deve conhecer: Linha, Preço de Segurança, Unidade Base, Estoque, Fiscal.

| Campo | Status |
|---|---|
| `linha_comercial_id` | Correto (entrada do Resolver) |
| `preco_venda` | Correto (segurança / fallback) |
| Unidade base / estoque / fiscal | Fora do escopo de preço oficial — OK |
| `participa_atacado` | Aceitável (elegibilidade, não preço) |
| `tabela_preco_id` | **Ainda existe no cadastro** mas **ignorado** no Resolver — resíduo |
| Canal / Cliente / Tabela no runtime | **Não** no produto — OK |

---

## 4. Arquitetura atual

```text
                    ┌──────────────────────┐
                    │   CLIENTE            │
                    │  tipo_comercial_id   │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │  TIPO COMERCIAL      │
                    │  canal_padrao        │
                    │  canais_permitidos   │
                    │  (crédito… UI only)  │
                    └──────────┬───────────┘
                               ▼
         canal_manual ──► ┌──────────────────────┐ ◄── qty atacado
         (EVENTO/         │  CANAL COMERCIAL     │
          CONSIGNADO)     │  VAREJO/ATACADO/…    │
                          └──────────┬───────────┘
                                     ▼
                          ┌──────────────────────┐
                          │  TABELA DE PREÇOS    │
                          │  1 ativa por canal   │
                          │  regras atacado      │
                          └──────────┬───────────┘
                                     ▼
   PRODUTO ──► LINHA DE PRECIFICAÇÃO ──► célula (Tabela×Linha×Canal)
      │                                         │
      └── preco_venda (fallback) ◄──────────────┘
                                     ▼
                          ComercialPrecoResolver
                                     ▼
                          PDV / Consignação / Venda
```

---

## 5. Arquitetura recomendada (proposta — sem implementar)

```text
CLIENTE
  └── POLÍTICA COMERCIAL  (hoje: Tipo Comercial)
        ├── canais permitidos + canal padrão
        ├── (futuro) crédito, desconto máx., condição pagto
        └── NÃO contém preços

OPERAÇÃO (PDV / Consignação / Pedido)
  └── CANAL OPERACIONAL  (contexto da venda)
        └── escolhe TABELA ATIVA do canal
              └── RESOLVER
                    Produto → Linha → (Canal) → Tabela → Preço
                    → fallback preço de segurança

PRODUTO
  └── Linha + Preço segurança + Unidade + Estoque + Fiscal
      (sem Canal, sem Cliente, sem Tabela oficial)
```

### Diretrizes de evolução (documental)

1. **Renomear conceitualmente** Tipo → Política Comercial (quando houver regras além de canal).
2. **Manter Canal** como eixo operacional (não fundir com Tabela).
3. **Remover ou ocultar** `produto.tabela_preco_id` do cadastro (já ignorado).
4. **Operação:** garantir Tabela ATACADO/CONSIGNADO com preços reais antes de homologar UX.
5. **Corrigir depois** (sprint futura): referência VAREJO em `resolverPrecosVenda` sem reutilizar `tabela_preco_id` do canal atual.
6. **Mobile PDV:** alinhar ao desktop (hoje força VAREJO).
7. **Não** colocar Tabela diretamente no Cliente enquanto existir Canal operacional.

---

## 6. Sobreposição — síntese visual

```text
Tipo Comercial ──(hoje quase)──► Canal ──(1:1)──► Tabela
       ▲                            ▲
   Cliente                      Operação

Linha ── agrupa Produtos (eixo distinto — sem duplicar Canal/Tipo)
```

Risco: usuário pensa “Tipo = Canal = Tabela”.  
Mitigação: cadastro com preços distintos por canal + documentação de papéis (esta auditoria).

---

## 7. Checklist operacional (por que “ATACADO não muda preço”)

Antes de mudar arquitetura, validar:

- [ ] Existe tabela **ativa** com `canal = ATACADO`?
- [ ] `atacado_habilitado` e quantidade mínima coerentes?
- [ ] Linhas da grade ATACADO com preços **≠** VAREJO?
- [ ] Produtos com `linha_comercial_id`?
- [ ] Resposta da API: `preco_origem` e `preco_fallback`?
- [ ] Cliente Tipo ATACADISTA vs. venda sem cliente (só qty)?

---

## 8. Entregáveis desta sprint

| Documento | Path |
|---|---|
| Canal Comercial | `docs/AUDITORIA_CANAL_COMERCIAL.md` |
| Tipo Comercial | `docs/AUDITORIA_TIPO_COMERCIAL.md` |
| Resolver | `docs/AUDITORIA_RESOLVER_COMERCIAL.md` |
| PDV / Precificação | `docs/AUDITORIA_PDV_PRECIFICACAO.md` |
| Benchmark ERPs | `docs/AUDITORIA_BENCHMARK_ERPS.md` |
| Relatório final | `docs/RELATORIO_FINAL_RA_7_6.md` (este) |

---

## 9. Conclusão

| Pergunta de negócio | Conclusão |
|---|---|
| Conceitos distintos? | **Sim**, com sobreposição parcial Tipo↔Canal na prática atual |
| Simplificar agora? | **Não** — congelar e clarificar; evoluir Tipo |
| PDV confiável no Resolver? | **Sim** |
| Próximo passo sugerido | Homologação de **dados** (tabelas por canal) + aprovação deste relatório antes de qualquer refactor |

**Nenhuma alteração estrutural foi realizada.** Aguardando aprovação para eventual sprint de consolidação.
