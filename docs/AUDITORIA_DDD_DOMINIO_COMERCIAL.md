# AUDITORIA DDD — Domínio Comercial do CDS

| Campo | Valor |
|---|---|
| Sprint | Auditoria DDD Domínio Comercial |
| Data | 2026-08-06 |
| Natureza | Modelagem de domínio puro |
| Restrições desta sprint | Sem código · Sem banco · Sem legado · Sem compatibilidade · Sem implementação |

---

## 0. Método

Esta auditoria **ignora** a implementação atual (tabelas, resolvers, migrations, telas).

Pergunta-guia:

> Quando uma venda acontece no negócio Cremolicia / CDS, **quais fatos de negócio** realmente entram na decisão do preço unitário?

Linguagem ubíqua proposta ao final. Conflitos de nomenclatura atuais (ex.: “Política Comercial” usada para coisas diferentes) são tratados como **dívida de linguagem**, não como verdade de domínio.

---

## 1. O que o negócio realmente vende

O CDS serve uma operação de **produção + comercialização de sorvetes e derivados**, com pelo menos estes modos de negócio:

| Modo | Fato de negócio |
|---|---|
| Varejo no balcão / PDV | Cliente ocasional ou cadastrado; preço “de loja” |
| Atacado por volume | Mesmo cliente/produto; preço muda quando a **quantidade** (ou regra de volume) atinge limiar |
| Consignação | Entrega a revendedor; preço e condições da **operação consignada** |
| Evento | Venda em contexto especial (festa, feira) |
| Delivery / outros | Contexto logístico/comercial distinto |

Produtos (cremosos, fruta, cobertura, etc.) **aparecem em vários modos**. O domínio não é “produto pertence a um canal”; é “produto é cotado **dentro de um contexto de venda**”.

---

## 2. Pergunta principal — o que participa da decisão do preço?

### 2.1 Fatores que **sempre** participam (domínio núcleo)

| Fator | Por quê |
|---|---|
| **Oferta comercial** (o que se vende) | Sem item cotável não há preço. Pode ser Produto, Kit, Casquinha montada, etc. |
| **Grupo de precificação do item** | Famílias com mesmo preço comercial (ex.: “Cremosos”, “Fruta c/ leite”) evitam repetir preço produto a produto |
| **Contexto da operação** | Varejo ≠ Atacado ≠ Consignado ≠ Evento — o negócio **pratica** preços diferentes por modo |
| **Quantidade / regra de volume** | Atacado não é “outro cliente”; é frequentemente **mesmo PDV**, outro limiar |
| **Unidade de cotação** | KG, unidade, litro — o preço é “R$ por unidade comercial”, não número solto |
| **Lista de preços vigente** | Onde o negócio **declara** o valor para (grupo × contexto × unidade) |
| **Preço mínimo / de segurança** | Limite inferior do produto; proteção de margem |

### 2.2 Fatores que **frequentemente** participam

| Fator | Por quê |
|---|---|
| **Cliente** (via sua política/segmento) | Atacadista, consignado, franquia — muda contexto padrão e permissões |
| **Política do cliente** | Crédito, desconto máximo, canais permitidos, condição de pagamento (futuro natural) |
| **Promoção / campanha** | Sobreposição temporal ao preço de lista (desconto, leve 3 pague 2…) |

### 2.3 Fatores que **podem** participar (conforme escala)

| Fator | Avaliação para o CDS |
|---|---|
| **Empresa / Filial** | Relevante se houver multi-loja com políticas distintas |
| **Região** | Relevante em distribuição ampla; opcional em operação local concentrada |
| **Vendedor / equipe** | Mais comissão/aprovação do que preço base |
| **Contrato negociado** | Preço especial por cliente/produto (B2B maduro) |

### 2.4 O que **não** decide preço (embora pareça)

| Conceito | Papel real |
|---|---|
| Categoria de produto (taxonomia) | Organização de catálogo — **não** é preço |
| Estoque | Disponibilidade — não forma preço |
| Fiscal (NCM, CFOP…) | Tributação — depois ou ao lado do preço comercial |
| Forma de pagamento (no ato) | Pode gerar desconto financeiro; não é a lista base |

---

## 3. Separação DDD

### 3.1 Entidades (identidade própria ao longo do tempo)

| Entidade | Identidade | Responsabilidade de domínio |
|---|---|---|
| **Produto** (ou Item Comercializável) | Sim | O que se vende; unidade base; preço de segurança; vínculos fiscais/estoque |
| **Cliente** | Sim | Quem compra; aponta para uma **Política de Cliente** |
| **Política de Cliente** | Sim | Segmento/regras do comprador (canais permitidos, crédito, descontos…) |
| **Contexto Operacional** (Canal de Operação) | Sim | Modo em que a venda acontece (Varejo, Atacado, Consignado, Evento…) |
| **Grupo de Precificação** | Sim | Agrupa itens que compartilham a mesma cotação comercial |
| **Lista de Preços** | Sim | Declara valores vigentes para um escopo (ex.: um contexto) |
| **Promoção** (se existir) | Sim | Regra temporal que altera preço ou condições |
| **Documento de Venda / Consignação** | Sim | Operação; congela snapshot comercial |

### 3.2 Objetos de Valor (definidos pelo conteúdo)

| Value Object | Conteúdo |
|---|---|
| **Dinheiro / Preço** | Valor + moeda |
| **Quantidade** | Número + unidade |
| **Unidade Comercial** | KG, UN, L… (como se cota naquela operação) |
| **Código Comercial** | Código estável de cadastro |
| **Vigência** | Início/fim de lista ou promoção |
| **Regra de Volume** | Quantidade mínima, tipo de contagem (total venda / por grupo…) |
| **Snapshot de Precificação** | Preço + lista + contexto + unidade + origem — imutável no item do documento |
| **Permissão de Contexto** | Conjunto de contextos que a política do cliente autoriza |

### 3.3 Agregados (fronteiras de consistência)

| Agregado | Raiz | Invariantes |
|---|---|---|
| **Catálogo de Produto** | Produto | Unidade base; preço de segurança ≥ 0; produto não “conhece” lista vigente |
| **Política de Cliente** | Política | Sempre tem contexto padrão; permitidos ⊇ padrão |
| **Cliente** | Cliente | Sempre referencia uma política ativa |
| **Lista de Preços** | Lista | Escopo claro (ex.: um Contexto); células únicas por (Grupo × Unidade); vigência |
| **Grupo de Precificação** | Grupo | Itens associados sem ambiguidade na resolução |
| **Operação de Venda** | Documento | Itens com snapshot; total consistente; contexto da operação definido |
| **Promoção** | Promoção | Janela e regras sem contradizer mínimo de segurança (política da empresa) |

### 3.4 Serviços de Domínio

| Serviço | Responsabilidade |
|---|---|
| **Serviço de Precificação** | Dado (Oferta, Contexto, Quantidade, Unidade, Cliente?) → Preço cotado + origem |
| **Serviço de Resolução de Contexto** | Dado (política do cliente, intenção manual, volume do carrinho) → Contexto da operação |
| **Serviço de Elegibilidade** | Item participa de volume/atacado? Cliente pode operar neste contexto? |
| **Serviço de Aplicação de Promoção** | Ajusta preço/condição após preço de lista |

O **Serviço de Precificação** é o coração. Listas, grupos e contextos são **insumos**; o serviço é a decisão.

---

## 4. Avaliação crítica dos quatro conceitos atuais

> Critério: conceito independente de negócio **ou** etapa intermediária / mecanismo?

### 4.1 Tipo Comercial

| Pergunta | Resposta |
|---|---|
| Problema que resolve? | Classificar **clientes** com comportamento comercial diferente (atacadista vs consumidor final vs consignado). |
| Dono da informação? | Área comercial / cadastro de clientes. |
| Poderia ser substituído? | **Sim** — por **Política de Cliente** (nome mais fiel) ou, no extremo simples, por vínculo direto Cliente→Lista. |
| Identidade própria? | **Sim**, se carregar regras (permitidos, crédito, desconto). **Fraca**, se só guardar “canal padrão”. |
| Sobreviveria do zero? | **Como ideia, sim** (segmento/política do cliente). **Como nome “Tipo Comercial”, duvidoso** — genérico demais. |

**Parecer DDD:** entidade **legítima** se for política do comprador.  
Se for só ponte para canal, é **mecanismo intermediário** disfarçado de entidade.

---

### 4.2 Canal Comercial

| Pergunta | Resposta |
|---|---|
| Problema que resolve? | Distinguir **modos reais de operação** da venda (balcão, volume, consignação, evento). |
| Dono da informação? | Operação / desenho do PDV e fluxos (não o cadastro de produto). |
| Poderia ser substituído? | Em parte por “tipo de documento” (Pedido Varejo vs Pedido Atacado). Em PDV único com troca dinâmica de modo, o **Contexto Operacional** continua necessário. |
| Identidade própria? | **Sim** — Varejo e Consignado não são o mesmo fato de negócio. |
| Sobreviveria do zero? | **Sim**, sob o nome **Contexto Operacional** (ou Modo de Venda). |

**Parecer DDD:** entidade (ou VO tipado estável) **indispensável** no CDS com PDV multi-modo.  
Não é “só nome de tabela”: é o *quando/como* da venda.

---

### 4.3 Linha de Precificação

| Pergunta | Resposta |
|---|---|
| Problema que resolve? | Evitar cadastrar preço **produto a produto** quando famílias inteiras compartilham cotação (cremosos, exóticos…). |
| Dono da informação? | Pricing / comercial de produto. |
| Poderia ser substituído? | Por preço direto no produto; ou por família/SKU group. Em catálogo grande e homogêneo por linha, o agrupamento **vence**. |
| Identidade própria? | **Sim** — “Linha Cremosos” existe mesmo sem uma tabela específica. |
| Sobreviveria do zero? | **Sim**, como **Grupo de Precificação** (ou Oferta Agrupada). |

**Atenção de linguagem:** chamar isso de “Política Comercial” (ADR A-1) **colide** com a política do **cliente**.  
Em DDD limpo: **Grupo de Precificação** (lado produto) ≠ **Política de Cliente** (lado comprador).

**Parecer DDD:** entidade **indispensável** para o negócio de famílias de sorvete.  
Não é etapa técnica; é fato comercial.

---

### 4.4 Tabela de Preços

| Pergunta | Resposta |
|---|---|
| Problema que resolve? | Declarar **valores vigentes** de forma auditável e alterável sem recodificar o motor. |
| Dono da informação? | Pricing / comercial. |
| Poderia ser substituída? | Por regra algorítmica pura (custo × markup) — possível, mas perde controle comercial explícito. Ou por preço no produto — simples demais para multi-contexto. |
| Identidade própria? | **Sim** — “Lista Atacado 2026” é um artefato de negócio com vigência. |
| Sobreviveria do zero? | **Sim**, como **Lista de Preços**. |

**Parecer DDD:** entidade **indispensável**.  
É a *superfície de declaração* do preço — não o motor.

Relação com Canal: no domínio ideal, uma Lista **tem escopo** (um Contexto, uma vigência, opcionalmente filial).  
Canal e Lista **não são o mesmo conceito**; frequentemente há **1 lista ativa por contexto** — isso é convenção operacional, não identidade única.

---

## 5. Independentes vs. intermediários — matriz

| Conceito atual | Independente? | Classificação DDD ideal |
|---|---|---|
| Tipo Comercial | Parcial | → **Política de Cliente** (entidade) |
| Canal Comercial | Sim | → **Contexto Operacional** (entidade / catálogo tipado) |
| Linha de Precificação | Sim | → **Grupo de Precificação** (entidade) |
| Tabela de Preços | Sim | → **Lista de Preços** (agregado) |
| Produto.tabela | Não | Mecanismo legado — produto não deve “possuir” lista vigente |
| Resolver / cache | Não | Mecanismo técnico do **Serviço de Precificação** |

---

## 6. Benchmark conceitual (DDD × ERP) — sem telas

### 6.1 Padrões clássicos de precificação em ERP

| Conceito de mercado | Papel |
|---|---|
| **Price List / Lista de Preços** | Declaração de valores |
| **Customer Group / Perfil** | Segmenta compradores → lista ou condições |
| **Special Price / Contrato** | Exceção por cliente/item |
| **UoM / Unidade** | Preço por unidade de medida |
| **Volume pricing** | Escala por quantidade |
| **Promotion** | Sobreposição temporal |
| **Sales Area / Org / Channel** (SAP) | Dimensão organizacional da venda |

### 6.2 Alinhamento com DDD

| Ideia DDD | No domínio comercial |
|---|---|
| Ubiquitous Language | Separar **política do cliente** de **grupo do produto** de **contexto da operação** |
| Aggregate | Lista de Preços como raiz das células; Documento congela snapshot |
| Domain Service | Precificação não “cabe” numa entidade só — é serviço |
| Anti-Corruption | Fiscal/estoque não ditam preço comercial |
| Bounded Context | **Comercial / Precificação** ≠ Fiscal ≠ Estoque ≠ Financeiro (recebível) |

### 6.3 Onde o CDS se diferencia do ERP “lista no cliente”

ERPs leves: `Cliente → Lista → Item`.  

CDS com PDV multi-modo precisa de **Contexto Operacional** no meio, porque:

- o mesmo cliente pode comprar varejo e depois atingir atacado **na mesma sessão**;
- consignação **não** é “escolher outra lista no cadastro do cliente” — é **outro tipo de operação**.

Isso é domínio real, não overengineering — **desde que** Contexto não seja confundido com Lista.

---

## 7. Modelo ideal — se o CDS nascesse hoje

### 7.1 Linguagem ubíqua proposta

```text
Cliente
  └── Política de Cliente          (segmento + regras + contextos permitidos)

Operação de Venda
  └── Contexto Operacional         (Varejo | Atacado | Consignado | Evento | …)
        └── Lista de Preços vigente (escopo = contexto [+ filial])

Produto / Kit / Montagem
  └── Grupo de Precificação        (família de cotação)

Serviço de Precificação
  entradas: Oferta, Grupo, Contexto, Qtd, Unidade, PolíticaCliente?
  saída:    PreçoCotado + Snapshot
```

### 7.2 Diagrama de domínio (ideal)

```text
┌─────────────┐         ┌─────────────────────┐
│   Cliente   │────────►│ Política de Cliente │
└─────────────┘         │ - contexto padrão   │
                        │ - contextos OK      │
                        │ - crédito/desc.     │
                        └──────────┬──────────┘
                                   │ influencia
                                   ▼
┌─────────────┐         ┌─────────────────────┐
│  Operação   │────────►│ Contexto Operacional│
│  (Venda)    │         └──────────┬──────────┘
└──────┬──────┘                    │ escopo
       │                           ▼
       │                ┌─────────────────────┐
       │                │  Lista de Preços    │
       │                │  (agregado)         │
       │                └──────────┬──────────┘
       │                           │ células
       │                           ▼
┌──────┴──────┐         ┌─────────────────────┐
│   Oferta    │────────►│ Grupo Precificação  │──── Preço (VO)
│  (Produto)  │         └─────────────────────┘     × Unidade
└─────────────┘
       │
       └── Preço de Segurança (VO)

              ┌──────────────────────────┐
              │ Serviço de Precificação  │
              │ + Resolução de Contexto  │
              │ + Promoção (opcional)    │
              └──────────────────────────┘
```

### 7.3 O que **não** existiria no modelo do zero

- “Tipo Comercial” como nome — viraria **Política de Cliente**
- Produto apontando para Lista vigente
- Duas “políticas comerciais” com nomes iguais (produto vs cliente)
- Canal e Lista fundidos na mesma entidade
- Categoria de produto como motor de preço

### 7.4 O que **existiria com força**

1. **Grupo de Precificação** (famílias)
2. **Contexto Operacional** (modos de venda)
3. **Lista de Preços** (declaração)
4. **Política de Cliente** (regras do comprador)
5. **Serviço de Precificação** (decisão)
6. **Snapshot** no documento (verdade da operação)

---

## 8. Respostas objetivas finais

### 1. Quais entidades são indispensáveis?

- **Produto / Oferta comercializável**
- **Cliente** (quando a venda é identificada)
- **Política de Cliente** (segmento/regras do comprador)
- **Contexto Operacional** (modo da venda)
- **Grupo de Precificação** (família de cotação)
- **Lista de Preços** (declaração de valores)
- **Documento de Venda/Consignação** (com snapshot)
- **Serviço de Precificação** (não é entidade, mas é indispensável no domínio)

Opcionais conforme escala: Promoção, Filial, Região, Contrato especial.

### 2. Quais são apenas mecanismos técnicos?

- Resolver / cache / logs / rotas HTTP
- “Tabela = Canal” como *obrigação* 1:1 (convenção de implementação, não lei de negócio)
- FK de produto para lista vigente
- Espelhamentos categoria→linha
- Qualquer camada que só **traduz** política→canal→tabela sem regra própria

### 3. Quais poderiam ser fundidas?

| Fusão | Avaliação |
|---|---|
| Tipo Comercial ∪ Política de Cliente | **Fundir por renomeação** — são o mesmo conceito de domínio |
| Canal ∪ Lista de Preços | **Não fundir** — contexto ≠ declaração de preço |
| Linha ∪ Produto | **Não** se houver famílias; **sim** em catálogo minúsculo |
| Linha ∪ “Política Comercial” (nome ADR) | **Renomear**, não fundir com política do cliente |
| Tipo ∪ Canal | **Não** — comprador ≠ modo da operação |

### 4. Modelo ideal se o CDS fosse criado hoje?

```text
Política de Cliente  →  define permissões e preferências do comprador
Contexto Operacional →  define o modo da operação em curso
Grupo de Precificação → define como o produto entra na cotação
Lista de Preços      →  declara o valor (Grupo × Contexto × Unidade)
Serviço de Precificação → decide o preço na operação
Documento            →  congela o snapshot
```

**Regra de ouro:**  
três eixos estáveis — **quem compra**, **como vende**, **o que cotiza** — e uma **lista** que materializa o encontro dos três.

Nada além disso é obrigatório no nascimento do domínio.  
Tudo o mais (promoção, filial, contrato) é evolução consciente.

---

## 9. Conclusão

No domínio comercial do CDS, o preço **não** nasce do produto sozinho nem do cliente sozinho.

Nasce do encontro:

> **Oferta (via Grupo) × Contexto da Operação × Lista vigente × Unidade [× Volume] [× Política do Cliente] [× Promoção]**

- **Tipo Comercial** e **Canal Comercial** atuais apontam para conceitos reais, mas com nomes e papéis embaraçados.  
- **Linha** e **Tabela** são conceitos reais e devem sobreviver — com nomes limpos.  
- O modelo ideal **não** elimina camadas por estética: elimina **sinônimos** e **ponteiros sem regra**.

**Nenhuma alteração foi implementada.** Este documento é apenas modelagem de domínio.
