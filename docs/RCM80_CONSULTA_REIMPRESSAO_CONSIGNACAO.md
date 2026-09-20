# RCM-8.0 — Consultar e reimprimir consignação entregue

| Campo | Valor |
|---|---|
| Sprint | RCM-8.0 (consulta operacional) |
| Natureza | Somente leitura · visualização · reimpressão |
| Banco | Sem novos status, tabelas ou campos de precificação |

Documento distinto de `docs/RCM80_ARQUITETURA_OFICIAL.md` (precificação oficial).

---

## Fluxo

```text
Cliente
  → Histórico  (mesmo botão da ficha)
    → Consignações
      → Visualizar  → detalhe do snapshot gravado
      → Reimprimir  → COMPROVANTE DE CONSIGNAÇÃO
```

Nenhuma dessas ações cria consignação, baixa estoque, altera Ledger, Conta Corrente, preço ou status.

---

## APIs reutilizadas

Não foi criado endpoint de escrita nem segunda fonte de dados.

| Uso | Endpoint existente |
|---|---|
| Lista do cliente | `GET /api/comercial/consignacoes?clienteId=` |
| Detalhe + itens | `GET /api/comercial/consignacoes/:id?clienteId=` |
| Itens paginados | `GET /api/comercial/consignacoes/:id/itens?clienteId=` |
| Comprovante legado (opcional) | `GET /api/comercial/consignacoes/:id/comprovante?clienteId=` |

A reimpressão da ficha **não** chama `POST /termo-entrega` nem `POST /comprovante/acoes`, para não gravar movimento de auditoria no Ledger comercial.

A listagem ganhou apenas um `COUNT` somente leitura de itens (`quantidade_itens`).

---

## Origem dos dados

Tudo vem do registro da operação e dos itens persistidos (RCM-6.1):

- cliente, documento, datas, status, totais do header
- produto, quantidade, `preco_unitario`, `unidade_comercial`
- `tabela_preco_id`, `canal_venda`, `linha_comercial_id`, `preco_origem`, `preco_fallback`

**Não** consulta Resolver, Tabela de Preços atual, unidade atual do produto ou linha atual.

Totais da tela/impressão = valores gravados ou `quantidade × preco_unitario` do item.

---

## Status (mapeamento, sem enum nova)

| Persistido | Label na consulta |
|---|---|
| `RASCUNHO` | Em preparação |
| `ENTREGUE` | Entregue |
| `ACERTADA` / pagamento parcial com saldo | Parcial |
| `QUITADA` / `ENCERRADA` / prestação `FECHADA` | Fechada |
| `CANCELADA` | Cancelada |

Cancelada permanece consultável e reimprimível. Nenhuma ação de alteração é oferecida.

---

## Impressão

Documento gerado no cliente a partir do mesmo payload de `GET /consignacoes/:id`:

```text
COMPROVANTE DE CONSIGNAÇÃO
CONSIGNAÇÃO Nº XXXXX
Cliente / CPF-CNPJ / Data
PRODUTO  QTD  UN  PREÇO  TOTAL
TOTAL: R$ …
Canal: CONSIGNADO
Documento referente à entrega de consignação.
```

Uma consignação de meses atrás reimprime o snapshot original.

---

## Segurança

Quando o fluxo tem cliente selecionado, o backend exige:

`consignacao.cliente_id === clienteId` (query).

Mismatch responde **404** (não vaza existência de operação de outro cliente).

A ficha sempre envia `clienteId` e ainda filtra a lista localmente.

---

## Snapshot RCM-6.1

O detalhe exibe, de forma discreta e só com o que já está no item:

- Linha de Precificação
- Tabela de Preços
- Canal
- Unidade Comercial
- Origem do Preço
- “Preço de Segurança” se `preco_fallback = 1`

---

## Interface

Na ficha do cliente os cinco botões permanecem:

Preparar Entrega · Fechar Atendimento · Conta Corrente · Histórico · Dados do Cliente

**Histórico** rola para `#sec-historico` e mostra a seção **Consignações** (lista + Visualizar / Reimprimir) acima das movimentações.

---

## Testes

```bash
node tests/motor-comercial/rcm80-consignacao-consulta-reimpressao.test.js
npx jest --config frontend/modules/motor-comercial/jest.config.js frontend/modules/motor-comercial/tests/pages/historicoConsignacoesMappers.test.js
```

Regressão do Motor Comercial (consignação / entrega / snapshot / precificação):

```bash
npm run test:motor-comercial-consignacao-fase1
npm run test:motor-comercial-consignacao-fase2
npm run test:motor-comercial-consignacao-fase3
node backend/motores/motor-comercial/tests/rcm61-congelamento-precificacao.test.js
node backend/modules/comercial/tests/rcm721-canal-operacao-consignacao.test.js
```

---

## Fora de escopo

Resolver, Tipo Comercial, Tabela de Preços, Linha, MUC, Estoque, Fiscal, Ledger, Conta Corrente, Dashboard e qualquer alteração da arquitetura de consignação.
