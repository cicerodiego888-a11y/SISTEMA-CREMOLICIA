# RCM-8.13 — Atualização Pós-Entrega e Comprovante Atualizado

| Campo | Valor |
|-------|--------|
| Sprint | RCM-8.13 |
| Escopo | Alteração pós-entrega + complementação + novo comprovante completo |
| Base | RCM-8.7 + RCM-8.11 + RCM-8.12 |
| Migration | Não criada (reutiliza Ledger append-only) |
| Git | Sem commit nesta sprint |

## Modelo

```
CONSIGNAÇÃO
  ↓
COMPROVANTE 001 — ORIGINAL
  ↓
COMPROVANTE 002 — ATUALIZAÇÃO / COMPLEMENTAÇÃO
  ↓
COMPROVANTE 003 — ATUALIZAÇÃO / ALTERAÇÃO
  ↓
SITUAÇÃO ATUAL CONSOLIDADA
```

Cada comprovante é uma **fotografia** da consignação naquele momento.
Comprovantes anteriores **nunca** são sobrescritos.

## Regra do comprovante

O novo comprovante **não** mostra somente o delta.

Deve conter:

1. Lista **completa** atual da consignação
2. Bloco **ATUALIZAÇÃO DA CONSIGNAÇÃO** (tipo + detalhamento)
3. Total atual (quantidade / valor)

Exemplo oficial (complementação +30 Picolé):

```
CONSIGNAÇÃO Nº CONS-2026-000014

COMPROVANTE DE ENTREGA Nº 002

PICOLE LINHA CREMOSA ........ 180
SORVETE IOGURT 90G .......... 20
SORVETE-200 ML ............... 4

ATUALIZAÇÃO DA CONSIGNAÇÃO

ENTREGA COMPLEMENTAR

PICOLE LINHA CREMOSA
Quantidade anterior: 150
Complemento: +30
Quantidade atual: 180

SORVETE IOGURT 90G
Quantidade atual: 20

SORVETE-200 ML
Quantidade atual: 4

TOTAL ATUAL DA CONSIGNAÇÃO: 204
```

## Operações

| Operação | Efeito | Delta estoque | Preço |
|----------|--------|---------------|-------|
| Entrega Complementar | soma quantidade / novo item | baixa do delta (+) | Resolver CONSIGNADO + snapshot RCM-6.1 |
| Alteração Pós-Entrega | redefine quantidade já entregue | baixa (+) ou entrada (−) | **não** recalcula (snapshot existente) |

Ambas:

- permanecem no mesmo `consignacaoId`
- permanecem no mesmo ciclo de Prestação (`PREST-001`) se aberto
- geram novo evento no Ledger (append-only)
- geram novo comprovante `001` / `002` / `003`…

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/consignacoes/:id/entrega-complementar` | RCM-8.7 (agora retorna `comprovante`) |
| POST | `/consignacoes/:id/alteracao-pos-entrega` | RCM-8.13 alteração |
| GET | `/consignacoes/:id/entregas` | Histórico cronológico + comprovantes |
| GET | `/consignacoes/:id/entregas/:correlationId/comprovante` | Reimpressão (somente leitura) |

## UI

Na consignação `ENTREGUE`:

- **Ent. Complementar** — “Adicionar produtos à consignação”
- **Alterar Entrega** — “Alterar produtos de uma entrega já realizada”

Confirmações oficiais preservam o comprovante anterior e emitem um novo.

## Arquivos principais

| Área | Arquivo |
|------|---------|
| Helpers | `atualizacaoEntregaHelpers.js`, `entregaComplementarHelpers.js` |
| UC | `RegistrarAlteracaoPosEntregaUseCase.js`, `RegistrarEntregaComplementarUseCase.js` |
| API | `ConsignacaoController`, `comercial.routes.js`, DTO |
| UI | `pages/AlterarEntrega`, `EntregaComplementar`, `DetalhesConsignacao` |
| Teste | `tests/motor-comercial/rcm813-atualizacao-comprovante-entrega.test.js` |

## Testes

```bash
node tests/motor-comercial/rcm813-atualizacao-comprovante-entrega.test.js
node tests/motor-comercial/rcm87-entrega-complementar.test.js
node tests/motor-comercial/rcm811-prestacao-consolidada-cliente.test.js
node tests/motor-comercial/rcm812-venda-complementar-prestacao.test.js
```

## Aceite

Para `CONS-2026-000014` após +30 Picolé:

- Comprovante **001** permanece com Picolé = 150
- Comprovante **002** mostra lista completa (180 / 20 / 4) + bloco complementar +30
- Situação atual = 204
- Prestação aberta do cliente permanece a mesma
