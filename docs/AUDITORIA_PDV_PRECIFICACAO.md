# AUDITORIA RA-7.6 — PDV e Precificação

| Campo | Valor |
|---|---|
| Sprint | RA-7.6 |
| Data | 2026-08-06 |
| Escopo | Fluxo PDV Adicionar Produto → Preço Final + Consignação |
| Restrição | Somente leitura |

---

## Veredito

Quando o PDV exibe **ATACADO**, ele **consulta o Resolver de verdade** (não é só badge de UI).  
Se o preço não muda, a causa típica é **dado/configuração** (tabela ATACADO sem células distintas, fallback para `preco_venda`, mesma grade) — não ausência de chamada ao resolver.

---

## 1. ATACADO: consulta tabela ou só UI?

**Consulta tabela / célula do canal ATACADO.**

Evidência:

1. `frontend/pdv/js/pdv.js` → `enriquecerProdutoCanalPdv` / `agendarRecalculoCanalComercialPdv`
2. `POST /configuracao-comercial/resolver-precos`
3. `CanalVendaResolver` devolve `canal: 'ATACADO'`
4. `ComercialPrecoResolver.resolver({ canal: 'ATACADO', ... })`
5. `buscarAtivaPorCanal('ATACADO')` + `tabela_preco_valores`

Badge (`atualizarBadgeCanalVendaPdv`) e `item.tipo_preco = 'atacado'` **espelham** o resultado da API.

### Por que o preço pode não mudar (cenários reais)

| Cenário | Efeito |
|---|---|
| Tabela ATACADO inexistente / inativa | Fallback config / padrão / `preco_venda` |
| Tabela ATACADO ativa sem preços nas linhas | `pularCompat` → preço de segurança |
| Preços ATACADO = VAREJO na grade | Canal muda, valor igual |
| Produto sem linha | Caminho legado / fallback |
| `atacado_habilitado` false na tabela | Não entra automático por qty |
| Cliente Tipo ATACADISTA mas tabela ATACADO vazia | Badge/canal ATACADO + preço base |
| Referência VAREJO com `tabelaOpts` do atacado | Economia/desconto UI pode zerar mesmo com tabelas diferentes |

---

## 2. Fluxo completo — Adicionar Produto → Preço Final

Arquivo: `frontend/pdv/js/pdv.js`

```text
adicionarProdutoPorCodigo(codigo)
  → localiza produto
  → enriquecerProdutoCanalPdv(produto)
       POST resolver-precos { itens, canal? | cliente_id? }
       ← canal + preco_venda + forma + unidade + origem
       aplicarFormaCanalNoProdutoPdv
  → (kit / casquinha / balança se aplicável)
  → adicionarItemNoCarrinho(produto, qtd, precoUnitario…)
       // usa produto.preco_venda já resolvido
       // obterPrecoAtacado() legado só se atacado comercial OFF
       item.canal = canalVendaPdv
  → atualizarCarrinho()
  → agendarRecalculoCanalComercialPdv()
       recalcula canal+preços de TODO o carrinho
       atualiza badge, desconto_atacado, tipo_preco
  → finalização
       persiste canal_venda na venda
```

Funções-chave: `enriquecerProdutoCanalPdv`, `aplicarFormaCanalNoProdutoPdv`, `adicionarItemNoCarrinho`, `agendarRecalculoCanalComercialPdv`, `atualizarBadgeCanalVendaPdv`, `definirCanalManualPdv` / `solicitarCanalEventoPdv`.

---

## 3. Fontes de canal no PDV

| Situação | Comportamento |
|---|---|
| Sem cliente, sem manual | Automático VAREJO/ATACADO por qty |
| Com cliente | Tipo Comercial → canal padrão (prioridade sobre qty) |
| Canal manual (EVENTO) | `canal_manual`; valida permitidos do Tipo |
| Mobile | Força `canal: 'VAREJO'` — lacuna vs desktop |

---

## 4. Produto no PDV — o que conhece

| Campo no produto | Usado na precificação oficial? |
|---|---|
| `linha_comercial_id` | **Sim** |
| `preco_venda` | Fallback / segurança |
| `participa_atacado` | Elegibilidade atacado (Canal), não preço direto |
| `tabela_preco_id` | **Não** (ignorado) |
| Canal / Cliente | **Não** no cadastro — vêm do contexto |

---

## 5. Consignação

| Pergunta | Resposta |
|---|---|
| Como escolhe o canal? | Sempre `CONSIGNADO` via `canal_manual` (`NovaConsignacao/index.js`) |
| Usa Tipo do cliente? | **Não** para preço (não envia `cliente_id` no resolver) |
| Como escolhe a tabela? | Tabela ativa do canal `CONSIGNADO` via Resolver |
| Snapshot? | Sim (RCM-6.1): linha, tabela, canal, unidade, origem, fallback — imutável após insert |
| Inconsistência? | Tipo pode ser “Consumidor Final” enquanto canal operacional é CONSIGNADO — **intencional** (RCM-7.2.1). Tipo é informativo no card. |

---

## 6. Resposta objetiva (critério #5)

O PDV **utiliza corretamente o Resolver Comercial** para obter preço.  
O badge ATACADO **não** é apenas cosmético.  

Se “canal ATACADO e preço igual”, auditar **cadastro da Tabela ATACADO** (células por linha) e origem retornada (`preco_origem` / `preco_fallback`) — não o display isolado.
