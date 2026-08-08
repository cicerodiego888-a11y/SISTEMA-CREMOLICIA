# AUDITORIA RA-7.6 — Tipo Comercial

| Campo | Valor |
|---|---|
| Sprint | RA-7.6 |
| Data | 2026-08-06 |
| Escopo | Auditoria arquitetural (somente leitura) |
| Restrição | Sem alteração de código, banco ou funcionalidade |

---

## Veredito

**Tipo Comercial** é a classificação comercial do **Cliente**.  
Hoje suas regras **próprias e ativas** são: Canal Padrão + Canais Permitidos (N:N).  
Não armazena preço. Indireamente muda preço porque resolve Canal → Tabela ativa → Resolver.

Abas de Crédito / Condições / Descontos / Regras (RCM-7.3) estão **preparadas na UI**, sem persistência nem efeito.

---

## 1. Finalidade

```text
CLIENTE
  → Tipo Comercial
      → Canal Padrão (+ Canais Permitidos)
          → Tabela ativa do Canal
              → ComercialPrecoResolver
                  → Preço
```

Fonte oficial: `docs/RCM71_TIPO_COMERCIAL_CLIENTE.md`, `docs/RCM73_TIPO_COMERCIAL_ENTERPRISE.md`.

O Cliente **não** conhece Tabela nem Linha — só `tipo_comercial_id`.

---

## 2. Regras próprias hoje?

| Capacidade | Status |
|---|---|
| Canal Padrão | **Ativo** |
| Canais Permitidos (N:N) | **Ativo** (RCM-7.2) |
| Bloquear canal manual fora da lista (PDV) | **Ativo** |
| Preço / tabela própria no Tipo | **Não** |
| Crédito / desconto / condição pagamento | **Layout only** (RCM-7.3) |
| Consignação: Tipo escolhe canal? | **Não** — operação força `CONSIGNADO` |

Conclusão: hoje o Tipo **principalmente aponta para Canal(is)**.  
Ainda assim não é redundante puro: é o ponto de extensão enterprise (política) sem poluir o Cliente com tabela/canal.

---

## 3. Entidade e seeds

Tabela `tipos_comerciais` (`018_tipos_comerciais.js`):

| Campo | Papel |
|---|---|
| `codigo` | Único (ex.: `ATACADISTA`) |
| `descricao` | Label |
| `canal_padrao` | Código TEXT → `canais_venda.codigo` |
| `ativo` / `observacoes` | Cadastro |

N:N `tipo_comercial_canais` (`019_tipos_comerciais_canais.js`).

Seeds: `CONSUMIDOR_FINAL`→VAREJO, `ATACADISTA`/`REVENDEDOR`/`DISTRIBUIDOR`→ATACADO, `CONSIGNADO`→CONSIGNADO, `EVENTO`→EVENTO, `DELIVERY`→DELIVERY, etc.

---

## 4. Funcionalidades que dependem do Tipo

| Funcionalidade | Dependência |
|---|---|
| CRUD Cliente | `tipo_comercial_id` obrigatório |
| PDV com cliente | `cliente_id` → Tipo → Canal (antes das regras de qty) |
| PDV canal manual | Valida se canal ∈ permitidos do Tipo |
| API `POST /tipos-comerciais/resolver-canal` | Resolução explícita |
| API `validar-canal` | Consignação (aviso opt-in) / Motor API |
| Consignação UI | Exibe Tipo no resumo; **não** usa para preço |
| Mobile PDV | **Não** aplica Tipo (força VAREJO) |

Código-chave:

- `TiposComerciaisService.resolverCanalOperacao`
- `CanalVendaResolver.resolver` (prioridade 2)
- `frontend/erp/js/clientes.js`
- `frontend/pdv/js/pdv.js`
- `frontend/erp/js/tipos-comerciais.js`

---

## 5. Cliente precisa conhecer Tipo Comercial?

### Opções avaliadas

| Modelo | Vantagem | Desvantagem |
|---|---|---|
| **Cliente → Tipo** (atual) | Cliente simples; política centralizada; evolui crédito/desconto sem mudar Cliente | Indireção (Tipo → Canal → Tabela); conceito novo a treinar |
| Cliente → Canal | Menos camadas | Cliente vira “operacional”; sem espaço limpo para política futura; 1 canal fixo |
| Cliente → Política Comercial | Nome mais claro que “Tipo” | Renomear/refatorar; hoje Tipo já cumpre esse papel |
| Cliente → Lista/Tabela de Preços | Direto como SAP B1 / Protheus | Produto desacoplado quebraria (tabela no cliente); perde canal operacional (EVENTO, qty atacado) |

**Recomendação da auditoria (sem implementar):**  
manter **Cliente → Tipo Comercial** como fachada de política.  
Se no futuro o Tipo só continuar sendo “apelido de Canal”, considerar renomear para **Política Comercial** e enriquecer regras — não colar tabela no Cliente.

---

## 6. Resposta objetiva (critérios #2 e #3)

**Responsabilidade exclusiva do Tipo Comercial:**  
classificar o **Cliente** e definir **quais contextos (canais) ele pode operar** e qual é o **padrão** — sem ser grade de preço.

**O Cliente precisa conhecer Tipo?**  
**Sim, no modelo atual e no roadmap RCM-7.3** — desde que o Tipo evolua para política.  
Se a empresa decidir que nunca haverá regra além de canal, bastaria Canal no Cliente (mais simples, menos enterprise).
