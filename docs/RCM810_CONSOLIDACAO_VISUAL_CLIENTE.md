# RCM-8.10 — Consolidação visual de consignações por cliente

| Campo | Valor |
|-------|-------|
| Sprint | RCM-8.10 |
| Escopo | Central de Trabalho — agrupamento visual |
| Objetivo | 1 cliente = 1 card; N consignações independentes dentro do card |
| Preserva | RCM-8.6, RCM-8.7, RCM-8.8, RCM-8.9 |

## Regra

- `clienteId` → chave do **card visual**
- `consignacaoId` → identidade de **cada operação/ação**
- Agrupamento **não** funde dados no banco, Ledger ou status

## Mapper (`centralTrabalhoMappers.js`)

`buildFilaOperacional` produz:

```js
{
  id: 'cli-{clienteId}',
  clienteId,
  clienteNome,
  agrupado: true,
  valor,              // soma visual das ops exibidas
  itens,              // soma visual
  quantidadeConsignacoes,
  estados: ['E2', 'E4', ...],
  consignacaoId,      // compat: 1ª op ordenada (ação principal legada)
  consignacoes: [
    { consignacaoId, estado, acaoTipo, acaoLabel, podeEntregaComplementar, ... }
  ]
}
```

## View (`CentralTrabalhoView.js`)

- `_renderCardClienteAgrupado` — um EntityCard por cliente
- `_renderOperacaoNoCard` — bloco por consignação com botões
- Cada `onAcao` recebe o item da **operação** (com `consignacaoId`)

## Navegação (`Dashboard/index.js`)

Inalterada no RCM-8.9:

- `/consignacoes/{consignacaoId}/entrega`
- `/consignacoes/{consignacaoId}/prestacao`
- `/consignacoes/{consignacaoId}/entrega-complementar`

## Fora de escopo

Banco, Entrega Complementar (regras), Prestação, Motor Fiscal, Resolver.
