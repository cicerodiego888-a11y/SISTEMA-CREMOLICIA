# AUDITORIA RA-7.6 — Benchmark ERPs

| Campo | Valor |
|---|---|
| Sprint | RA-7.6 |
| Data | 2026-08-06 |
| Escopo | Comparação conceitual (não implementação) |
| Fontes | Documentação pública SAP B1, TOTVS Protheus, Sankhya, Omie, Bling/Tiny |

---

## Veredito

Grandes ERPs **raramente** usam o termo “Canal Comercial” como CDS.  
O padrão dominante é: **Lista/Tabela de Preços + vínculo no Cliente (ou Grupo/Perfil de Cliente)**.  
“Tipo Comercial” do CDS se aproxima de **Grupo de Clientes / Perfil / Política**, não de uma lista de preços.

---

## 1. Matriz comparativa

| Conceito | SAP B1 | Protheus | Sankhya | Omie | Bling / Tiny | **CDS atual** |
|---|---|---|---|---|---|---|
| Lista / Tabela de Preços | **Sim** (Price List) | **Sim** (Tabela de Preço) | **Sim** | **Sim** | **Sim** (Listas) | **Sim** (`tabelas_preco`) |
| Grupo / Categoria de Cliente | **Sim** (Customer Group → lista default) | Parcial (aba Vendas / tabela no cliente) | **Perfil** do parceiro | Tags / filtros | Vínculo cliente↔lista | **Tipo Comercial** |
| Canal Comercial (como CDS) | Não como entidade de preço | Não padrão | Não padrão (usa região/tipo negociação) | Não | Não | **Sim** (`canais_venda`) |
| Tipo Comercial (nome CDS) | Não | Não | Tipo de Negociação (outro papel) | Não | Não | **Sim** |
| Política Comercial | Special Prices / grupos | Contratos / condições | Formação de preço multi-critério | Regras simples | Desconto em lista | **Tipo** (só canal hoje; resto preparado) |
| Preço no Produto | Base + listas | Preço base + tabela | Sim + tabelas | Sim + tabelas | Sim + listas | Linha + segurança; **não** tabela oficial |
| Contexto operacional (PDV/Evento/Consignado) | Documentos / usos | TES / tipos | Tipo negociação / empresa | Pedido | Pedido | **Canal** + motores |

---

## 2. Por ERP (resumo)

### SAP Business One
- **Price Lists** ligadas a **Customer Groups**.
- Cliente herda lista do grupo; documento de venda usa a lista do parceiro.
- Preços especiais por parceiro.
- **Não** modela “Canal Varejo/Atacado” como chave de célula — atacado costuma ser outra lista ou desconto.

### TOTVS Protheus
- **Tabela de Preços** (COMA010 / OMS).
- Cliente informa tabela padrão na aba Vendas.
- Impostos separados (TES) — tabela não calcula tributo.
- Contratos podem **sobrescrever** tabela.

### Sankhya
- Tabelas de preço com critérios: **perfil**, parceiro, empresa, região, tipo de negociação.
- Mais próximo de uma **política multi-eixo** do que do Canal único do CDS.

### Omie / Bling / Tiny
- Listas de preço + vínculo a clientes / filtros.
- Modelo leve: **Cliente → Lista**.
- Pouca ênfase em “canal operacional” separado.

---

## 3. Diferenças em relação ao CDS

| Ponto | ERPs típicos | CDS |
|---|---|---|
| Cliente aponta para… | Lista de preços (direto ou via grupo) | **Tipo Comercial** → Canal → Tabela |
| Contexto PDV atacado | Outra lista / desconto qty | **Canal ATACADO** + regras na tabela |
| Consignação / Evento | Outro tipo de documento | **Canal forçado** + snapshot |
| Agrupamento de produtos no preço | Item na lista | **Linha de Precificação** (agrupa produtos) |
| Camadas | 2–3 (Grupo → Lista → Item) | 4 (Tipo → Canal → Tabela → Linha) |

O CDS é **mais indireto** que Omie/Tiny/B1, e **mais operacional** (canal de execução) do que Protheus puro “tabela no cliente”.

---

## 4. O que o mercado valida no CDS

| Decisão CDS | Alinhamento |
|---|---|
| Tabela de Preços como SSOT de valor | Alinhado |
| Cliente sem conhecer produto/linha | Alinhado |
| Agrupar produtos (Linha) | Diferencial útil (sorveteria / família) |
| Canal como eixo | Útil para PDV/consignação; **incomum** como entidade nomeada |
| Tipo Comercial | Alinhado a Grupo/Perfil **se** evoluir além de “alias de canal” |

---

## 5. Implicação para simplificação

Se o objetivo for **parecer mercado BR leve** (Omie/Tiny):  
`Cliente → Tabela` (ou Grupo → Tabela).

Se o objetivo for **PDV multi-contexto** (varejo/atacado/evento/consignado) sem trocar cliente:  
manter **Canal operacional** + **Tipo/Política no Cliente** é justificável — desde que Tipo não seja só sinônimo de Canal.
