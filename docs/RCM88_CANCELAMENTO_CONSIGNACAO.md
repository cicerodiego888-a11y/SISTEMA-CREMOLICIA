# RCM-8.8 — Cancelamento voluntário da consignação em preparação

| Campo | Valor |
|-------|--------|
| Sprint | RCM-8.8 |
| Escopo | Cancelamento voluntário de consignação ainda em preparação |
| Objetivo | Encerrar preparação sem excluir e sem efeitos operacionais |
| Fora de escopo | Entrega Complementar RCM-8.7, Prestação RCM-8.6, Resolver, Motor Fiscal |

## Princípio

```
CANCELAR ≠ EXCLUIR
CANCELAR ≠ ENTREGAR
CANCELAR ≠ ESTORNAR
CANCELAR = encerrar voluntariamente uma preparação que ainda não foi entregue
```

Não há `DELETE` físico. A consignação permanece no histórico com status `CANCELADA`.

## Estados elegíveis

Status oficiais no modelo:

`RASCUNHO | ENTREGUE | ACERTADA | QUITADA | ENCERRADA | CANCELADA`

**Não existe `VALIDADA`** no persistido. A preparação operacional é `RASCUNHO`.

| Status | Cancelamento voluntário |
|--------|-------------------------|
| RASCUNHO | Sim |
| ENTREGUE / ACERTADA / QUITADA / ENCERRADA | Não |
| CANCELADA | Idempotente (já cancelada) |

## Transição

```
RASCUNHO
   ↓  Cancelar preparação + confirmação + motivo
CANCELADA
```

Campos reutilizados (sem migration):

- `status = CANCELADA`
- `data_encerramento`
- `usuario_encerramento_id`
- `observacao` com prefixo `[CANCELAMENTO] CODIGO — Label. obs?`
- `documento.situacao = CANCELADO`

## Tela de Entrega em andamento

Na estação **Entrega** (`/consignacoes/:id/entrega`):

- **Voltar** — sai da tela; a consignação permanece em `RASCUNHO`
- **Cancelar preparação** — executa o cancelamento RCM-8.8 (confirmação + motivo → `CANCELADA`)

Não confundir “sair da entrega” com “cancelar a consignação”.


1. Ação **Cancelar preparação** (somente RASCUNHO)
2. Confirmação: *"Cancelar esta consignação?"* + complemento sobre entrega
3. Botões: **Voltar** / **Confirmar cancelamento**
4. Motivo controlado:
   - CLIENTE_DESISTIU
   - ERRO_PREPARACAO
   - PRODUTO_INDISPONIVEL
   - PEDIDO_DUPLICADO
   - OUTRO (+ descrição)

Mensagem de sucesso: *"Consignação cancelada com sucesso."*

## Endpoint

```
POST /consignacoes/:id/cancelar
```

Body:

```json
{
  "motivo": "CLIENTE_DESISTIU",
  "observacao": "Cliente desistiu do pedido"
}
```

Compatibilidade: `DELETE /consignacoes/:id` continua delegando ao mesmo UseCase.

## UseCase

`CancelarConsignacaoRascunhoUseCase` (aprimorado):

1. Localiza consignação
2. Autoriza `COMERCIAL_CONSIGNACAO` (quando `usuarioBridge` presente)
3. Valida elegibilidade / entrega prévia no ledger
4. `UPDATE` condicional (`atualizarSeStatus` com `status = RASCUNHO`)
5. Persiste auditoria + evento `ConsignacaoCancelada`
6. **Zero** outbox de estoque, ledger, crédito, fiscal, prestação

## Zero efeito operacional

Cancelar preparação **não** gera:

- baixa/entrada de estoque
- Ledger financeiro
- consumo de crédito / limite
- prestação de contas
- venda / NF-e / NFC-e
- entrega comercial
- alteração de preços/snapshots

## Fila × Histórico

Após cancelamento:

- sai da fila **Em preparação** (`RASCUNHO`)
- permanece no **Histórico de Consignações** como `CANCELADA`
- visualização/reimpressão somente leitura, com destaque **CONSIGNAÇÃO CANCELADA**

## Bloqueios

- Sem reabrir para `RASCUNHO` / `ENTREGUE` por edição normal
- Sem Entrega Complementar (RCM-8.7) em `CANCELADA`
- Sem abrir Prestação de Contas a partir de `CANCELADA`
- Mensagem: *"Esta consignação foi cancelada. Para realizar uma nova entrega, crie uma nova consignação."*
- Sem botão **Reabrir** nesta sprint

## Permissões

Reutiliza `COMERCIAL_CONSIGNACAO`. Sem nova matriz.

## Idempotência / concorrência

- Segunda chamada em consignação já `CANCELADA` → sucesso controlado (`idempotente: true`), sem segundo evento
- `atualizarSeStatus` evita duas transições efetivas sob corrida

## Compatibilidade

- **RCM-8.7:** `CANCELADA` permanece terminal; `+ Adicionar produto` indisponível
- **RCM-8.6:** lifecycle da Prestação intacto; cancelada não abre prestação

## Testes

Arquivo: `tests/motor-comercial/rcm88-cancelamento-consignacao.test.js`

Cobertura mínima: elegibilidade, motivo/auditoria, fila/histórico, zero efeitos, bloqueios terminais, idempotência, permissão, reimpressão somente leitura.

Executar:

```bash
node tests/motor-comercial/rcm88-cancelamento-consignacao.test.js
node tests/motor-comercial/consignacao-usecases-fase1.test.js
node tests/motor-comercial/rcm87-entrega-complementar.test.js
```
