# RCM-8.12 — Nova venda/consignação incorporada à Prestação ABERTA

| Campo | Valor |
|-------|--------|
| Sprint | RCM-8.12 |
| Base | RCM-8.11 |
| Migration | Nenhuma |
| Preserva | RCM-8.6 … RCM-8.11 |

## Regra definitiva

```
PRESTAÇÃO ABERTA = CICLO ATUAL DO CLIENTE

NOVA CONSIGNAÇÃO ENTREGUE (mesmo cliente)
        ↓
MESMA PRESTAÇÃO (mesmo grupoPrestacaoContasId)

NÃO criar PREST-002 enquanto PREST-001 estiver ABERTA.
```

## Diferença

| Fluxo | O que cria | Onde entra |
|-------|------------|------------|
| RCM-8.7 Entrega Complementar | Item na **mesma** consignação | Mesmo `consignacaoId` + mesmo grupo |
| RCM-8.12 Nova consignação | **Nova** consignação | Novo `consignacaoId` + mesmo grupo se ciclo ABERTA |

## Momento da vinculação

```
CriarConsignacao → RASCUNHO (sem efeito financeiro / sem ponteiro)
        ↓
Entregar
        ↓
resolverCicloPrestacaoParaEntrega()
        ↓
vincularConsignacaoAoGrupoPrestacao (se houver ciclo)
        ↓
ENTREGA no Ledger com grupoPrestacaoContasId
        ↓
status ENTREGUE + prestacaoContasAtiva
```

## Autoridade

`RegistrarEntregaConsignacaoUseCase` usa:

`resolverCicloPrestacaoParaEntrega` (em `prestacaoCicloClienteHelpers.js`)

Ordem: validar → resolver/vincular ciclo → registrar ENTREGA → estoque → crédito → eventos.

`AbrirPrestacaoUseCase`: se já vinculado ou cliente tem ciclo ABERTA → **reutilizar** (`idempotente` / `incorporadaAoCicloCliente`), nunca `criarGrupoPrestacaoContas`.

## Após fechamento

`PREST-001` FECHADA → próxima consignação **não** reabre; nova abertura cria `PREST-002`.

## Testes

```bash
node tests/motor-comercial/rcm812-venda-complementar-prestacao.test.js
node tests/motor-comercial/rcm811-prestacao-consolidada-cliente.test.js
node tests/motor-comercial/rcm87-entrega-complementar.test.js
```
