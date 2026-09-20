# RCM-8.11 — Prestação consolidada por cliente / ciclo

| Campo | Valor |
|-------|--------|
| Sprint | RCM-8.11 |
| Escopo | Várias consignações independentes no mesmo ciclo de Prestação |
| Migration | Nenhuma |
| Preserva | RCM-8.6, RCM-8.7, RCM-8.8, RCM-8.9, RCM-8.10 |

## Conceito

```
CLIENTE
   │
   ▼
PRESTAÇÃO ABERTA / GRUPO (grupoPrestacaoContasId)
   │
   ├── CONS-000014
   │     ├── Entrega
   │     └── Complementares (RCM-8.7)
   │
   ├── CONS-000019
   │     └── Entrega
   │
   └── CONS-000020
         └── Entrega
```

- **Consignações** = operações independentes (`consignacaoId`, itens, preço, Ledger por consignação)
- **Prestação** = ciclo financeiro do cliente (`grupoPrestacaoContasId`)
- **Não** fundir consignações; **não** UPDATE no Ledger histórico

## Fluxos

### Abertura

1. Consignação ENTREGUE
2. Se cliente já tem grupo `ABERTA` → reutilizar e vincular ponteiro
3. Senão → criar `ABERTURA_PRESTACAO` + novo grupo

### Entrega de nova consignação

1. Validar entrega
2. `buscarGrupoPrestacaoAbertaDoCliente(clienteId)`
3. Se houver grupo → `grupoPrestacaoContasId` nas ENTREGAs + `prestacaoContasAtiva`
4. Estoque / outbox / eventos

### Entrega Complementar (RCM-8.7)

Continua na **mesma** consignação. Se a consignação já tem ciclo aberto, as ENTREGAs complementares recebem o mesmo `grupoPrestacaoContasId`.

### Consultas / grade / resumo

Escopo oficial = `grupoPrestacaoContasId` (sem filtrar só pela consignação da URL).

Itens: união das consignações com `prestacao_id = grupo`, cada linha preserva `consignacaoId`.

### Pagamento / fechamento

Pagamento e totais = ciclo. Fechamento marca `FECHADA` no ponteiro de **todas** as consignações do grupo.

### Dados legados

- Não altera `movimentacoes_comerciais`
- Reconciliação controlada: ENTREGUE sem grupo + cliente com ciclo ABERTO + entrega ≥ abertura → vincula ponteiro
- Ambiguidade / múltiplos grupos abertos → **não** vincula em silêncio

## Helpers

| Função | Papel |
|--------|--------|
| `buscarGrupoPrestacaoAbertaDoCliente` | Localiza ciclo ABERTA do cliente |
| `listarConsignacoesDoGrupoPrestacao` | Membros do ciclo |
| `listarItensDasConsignacoesDoGrupo` | Grade consolidada |
| `vincularConsignacaoAoGrupoPrestacao` | Ponteiro only |
| `reconciliarConsignacaoComGrupoAbertoCliente` | Legado elegível |
| `fecharPonteirosConsignacoesDoGrupo` | Fechamento do ciclo |

## Testes

```bash
node tests/motor-comercial/rcm811-prestacao-consolidada-cliente.test.js
```
