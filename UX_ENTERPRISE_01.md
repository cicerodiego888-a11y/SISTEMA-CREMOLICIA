# UX-ENTERPRISE-01 — Auditoria do Fluxo Mental do Operador

**Código:** UX-ENTERPRISE-01  
**Data:** 2026-07-18  
**Tipo:** Auditoria Enterprise (SEM IMPLEMENTAÇÃO)  
**Premissa:** Ignorar arquitetura interna. Avaliar só a experiência do operador final.

**Fontes de evidência:**  
`frontend/erp/js/produtos.js` · `frontend/erp/js/compras.js` · `frontend/pdv/js/pdv.js` · `frontend/pdv/pages/pdv.html`  
Estado pós **UX-MASTER-01**.

---

## Missão

> Eu conseguiria cadastrar um produto e operar o ciclo completo sem pedir ajuda?

Resposta curta: **produto comum, quase.** **Produto pesado / com nota / Fiscal×Não Fiscal — não sem treinamento.**

---

# Fluxo auditado (obrigatório)

```
Novo Produto
  → Cadastrar Produto
  → Salvar
  → Cadastrar Compra
  → Informar Peso (quando existir)
  → Atualizar Estoque
  → Realizar Venda
  → Cancelar Venda
  → Ajustar Estoque
  → Emitir NFC-e
  → Consultar Produto novamente
```

---

# Auditoria por etapa

## Etapa A — Novo Produto / Cadastro / Salvar

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Entende o que fazer? | **Quase.** Nome, preço e unidade são óbvios. Banner “Implantação” e Fiscal/Não Fiscal ainda pedem contexto. |
| 2 | Campo com dúvida? | Quantidade Inicial Fiscal vs Não Fiscal · “Pesado na entrada” · “Produto vendido por peso” (parecem irmãos) · “Formas de Venda” só após salvar |
| 3 | Campo nunca preenchido? | Origem, alíquotas, CEST, margem (se auto), código (se auto), peso aproximado (referência visual) |
| 4 | Informação repetida? | Fase Implantação (badge + banner estoque) · Preço Atacado sempre no card |
| 5 | Termo técnico? | Residual: “Implantação/Operação”; no editor de Formas de Venda: “Unidade Comercial”, “UC-02”, “Medida física”. **MCC/SSOT/CORE ausentes no modal principal.** |
| 6 | Sistema decide sozinho? | Já: código, UC padrão, margem, default UN. Ainda poderia: Fiscal=Não Fiscal unificado no happy path; atacado off; PDV inferido |
| 7 | Excesso? | Ainda 8 blocos numerados no scroll; Atacado e PDV no caminho comum |
| 8 | Cansativa? | Scroll longo no 1º cadastro; segundo passo mental após save (formas de venda) |
| 9 | Poderia desaparecer? | Card PDV no produto comum · Atacado · bloco peso se nunca marca · numeração “1· 2· 3·” |
| 10 | Simplicidade? | ★★★★☆ |

**Esforço mental:** Médio (comum) / Médio-Alto (pesado).

---

## Etapa B — Cadastrar Compra

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Entende? | **Parcial.** Dados da nota são familiares. Painel de conversão **não**. |
| 2 | Dúvida? | Tipo Entrada · Central Inteligente · Unidade comercial · Quantidade (UC) · Modo de peso · Fiscal/Não Fiscal · F7 |
| 3 | Nunca preenchido? | Série/Modelo/Chave em nota avulsa pequena · Volume total (muitos casos) |
| 4 | Repetido? | Dois “motores” (MCC vs Conversão de Unidades) · Preço compra + margem + venda sugerida vs cadastro |
| 5 | Técnico? | **Motor de Conversão Comercial (MCC)** · **Quantidade (UC)** · **Conversão Física** · **unidade base** · **Motor Indústria** · **Motor de Conversão de Unidades** |
| 6 | Automático? | Fator físico (já calcula) · Custo unitário · Poderia ocultar segundo motor e jargão |
| 7 | Excesso? | **Sim — o pior ponto do fluxo** |
| 8 | Cansativa? | **Sim** — escolher produto + UC + peso + fiscal split + margem |
| 9 | Desaparecer? | Título MCC · label UC · painel legado paralelo · hint Motor Indústria |
| 10 | Simplicidade? | ★★☆☆☆ |

**Esforço mental:** Alto.

---

## Etapa C — Informar Peso (na compra)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Entende? | Se o produto foi marcado “pesado na entrada”, o sistema **exige** peso — mas o título “MCC” assusta. |
| 2 | Dúvida? | Peso por embalagem vs peso total · o que é “UC” · fator calculado em 6 casas |
| 3 | Nunca? | Volume total em vários cenários |
| 4 | Repetido? | Mensagens “informe o peso” + help + preview |
| 5 | Técnico? | Conversão Física · MCC · UC · fator |
| 6 | Automático? | Fator sim; UI poderia só perguntar: “Quanto pesou a balança?” |
| 7 | Excesso? | Sim |
| 8 | Cansativa? | Sim se operador não foi treinado no cadastro |
| 9 | Desaparecer? | Jargão; preview de fator com 6 decimais para leigo |
| 10 | Simplicidade? | ★★☆☆☆ |

**Esforço mental:** Alto.

---

## Etapa D — Atualizar Estoque (pós-compra)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Entende? | **Sim** se a compra conclui — estoque sobe sozinho. Operador não “atualiza” manualmente. |
| 2 | Dúvida? | Só se for olhar lista e não achar o saldo (Fiscal vs Total) |
| 3–9 | — | Etapa transparente quando compra OK |
| 10 | Simplicidade? | ★★★★☆ |

**Esforço mental:** Baixo (automático).

---

## Etapa E — Realizar Venda (PDV)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Entende? | **Sim.** Busca · quantidade · finalizar. |
| 2 | Dúvida? | Modal “Como deseja vender?” (Peso/Unidade) · “Unidade comercial” se várias formas · Fiscal F / NF |
| 3 | Nunca? | Desconto atacado (lojas sem atacado) |
| 4 | Repetido? | Pouco |
| 5 | Técnico? | Leve: “Unidade comercial” · “Estoque fiscal” |
| 6 | Automático? | Unidade padrão se só 1 forma |
| 7 | Excesso? | Não no caminho comum |
| 8 | Cansativa? | Não |
| 9 | Desaparecer? | Modal UC se só existe 1 |
| 10 | Simplicidade? | ★★★★☆ |

**Esforço mental:** Baixo–Médio.

---

## Etapa F — Cancelar Venda

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Entende? | **Sim.** Botão Cancelar Venda / ESC + confirmação. |
| 2–7 | — | Limpo |
| 8 | Cansativa? | Não |
| 9 | Desaparecer? | Não |
| 10 | Simplicidade? | ★★★★★ |

**Esforço mental:** Baixo.

---

## Etapa G — Ajustar Estoque

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Entende? | Intenção sim (“ajustar”). Copy **não**. |
| 2 | Dúvida? | Unidade do ajuste · Fiscal vs Não Fiscal · Preview MCC · quantidade base |
| 3 | Nunca? | Ajuste Não Fiscal em loja 100% fiscal |
| 4 | Repetido? | Saldos atuais + preview |
| 5 | Técnico? | **MCC** · **Conversão Física** · **Unidade Base** · “Preview (MCC)” · erro “Falha no preview MCC” |
| 6 | Automático? | Conversão (já); labels poderiam ser humanas |
| 7 | Excesso? | Sim no copy |
| 8 | Cansativa? | Médio |
| 9 | Desaparecer? | Toda a palavra MCC na UI |
| 10 | Simplicidade? | ★★☆☆☆ |

**Esforço mental:** Médio–Alto.

---

## Etapa H — Emitir NFC-e

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Entende? | **Quase.** Não há botão “Emitir NFC-e”: é **Finalizar Venda** com modo fiscal (F12). |
| 2 | Dúvida? | Precisa lembrar de ligar modo fiscal · CPF opcional |
| 3 | Nunca? | CPF (consumidor não identificado) |
| 4 | Repetido? | Não |
| 5 | Técnico? | NFC-e · SEFAZ (aceitáveis) |
| 6 | Automático? | Emissão após finalizar — OK |
| 7 | Excesso? | Não |
| 8 | Cansativa? | Só se SEFAZ falhar |
| 9 | Desaparecer? | Nada crítico |
| 10 | Simplicidade? | ★★★★☆ |

**Esforço mental:** Baixo (após F12 ligado).

---

## Etapa I — Consultar Produto novamente

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Entende? | **Sim.** Modal Detalhes. |
| 2 | Dúvida? | “Conversão de Unidades: Sim (venda fracionada)” |
| 3 | — | View só leitura |
| 4 | Repetido? | Estoque Fiscal / Não Fiscal / Total |
| 5 | Técnico? | “Conversão de Unidades / venda fracionada” |
| 6 | — | — |
| 7 | Excesso? | Não mostra Formas de Venda / peso — pode faltar contexto |
| 8 | Cansativa? | Não |
| 9 | Desaparecer? | Jargão “conversão de unidades” → “Vendido por peso: Sim/Não” |
| 10 | Simplicidade? | ★★★★☆ |

**Esforço mental:** Baixo.

---

# Avaliação Enterprise

Se instalar hoje em cliente novo, o operador:

**( ) aprende sozinho**  
**(x) precisa de treinamento**  
**( ) precisa ligar para o suporte** (só se produto pesado + compra MCC + ajuste)

**Por quê:** o cadastro comum e o PDV estão próximos do “sozinho”. A **Compra com peso** e o **Ajuste** ainda falam linguagem de fábrica de software. Fiscal × Não Fiscal exige explicação em qualquer ERP, mas aqui soma jargão MCC/UC.

---

# Comparação com ERP comum brasileiro

**Está: Mais complexo** (no ciclo completo com peso/entrada).

Justificativa: ERPs de bairro pedem Nome · Unidade · Preço · Estoque · Barras. A CDS, após UX-MASTER-01, chega perto disso no cadastro. Porém a **entrada de mercadoria** expõe “Motor”, “MCC” e “Quantidade (UC)” — acima da média do ERP de mercearia. PDV/NFC-e estão no padrão ou melhores.

---

# Pergunta final

Amanhã, mercadinho de bairro — primeira impressão:

**( ) Muito simples**  
**( ) Boa**  
**(x) Aceitável**  
**( ) Complexa**

**Explicar:** Cadastro novo parece aceitável/bom. Abrir Compra com produto pesado vira **complexa**. A média da jornada fecha em **Aceitável** — não vende sozinho como “ERP do dono que odeia tela cheia”, mas também não é o monstro pré-UX-MASTER-01 no cadastro.

---

# Veredito Final

### 🟠 Precisa Refinar

Cadastro: caminho certo (🟡 Muito Bom isolado).  
Jornada ponta a ponta: Compra + Ajuste ainda derrubam o selo Enterprise Ready para o público CDS (mercadinho → distribuidora).

**Próximo foco UX (recomendado, sem implementar agora):**  
UX-ENTERPRISE-02 / UX-MASTER-02 — limpar copy da **Compra** e do **Ajuste** (mesmo padrão do cadastro: zero MCC/UC/Motor na cara do operador).
