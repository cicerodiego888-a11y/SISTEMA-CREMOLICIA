# Mensageria Operacional — Motor Comercial (UX-1)

## Objetivo

Padronizar toda a comunicação entre o Motor Comercial e o operador.

Cada mensagem deve informar:

1. o que aconteceu;
2. se a operação foi concluída / salva;
3. o que o operador deve fazer a seguir.

## Catálogo oficial (SSOT)

Pasta: `frontend/modules/motor-comercial/messages/`

| Arquivo | Uso |
|---------|-----|
| `SuccessMessages.js` | Operação concluída com sucesso |
| `ErrorMessages.js` | Operação **não** ocorreu / não foi salva |
| `WarningMessages.js` | Bloqueio preventivo / validação |
| `InfoMessages.js` | Orientação sem impacto financeiro |
| `RecoveryMessages.js` | Parte do fluxo ok + parte falhou |
| `EmptyMessages.js` | Empty states |
| `LoadingMessages.js` | Textos de loading (nunca "Aguarde...") |
| `ConfirmMessages.js` | Diálogos de confirmação (nunca `alert`/`confirm`/`prompt`) |
| `index.js` | Helpers: `notifySuccess`, `notifyError`, `notifyWarning`, `notifyInfo`, `notifyRecovery`, `loadingText`, `emptyState`, `confirmCopy`, `operationalMessage` |

## Padrões

### ✔ Sucesso

Informar o resultado final.

Exemplos:

- Consignação criada com sucesso.
- Entrega registrada com sucesso.
- Pagamento registrado.

### ❌ Erro

Usar quando **nada** foi salvo (ou a ação pedida falhou por completo).

Estrutura:

1. O que não foi possível fazer
2. O que verificar / próximo passo

Exemplo:

> Não foi possível criar a consignação.  
> Verifique os dados e tente novamente.

### ⚠ Recuperação

Usar quando **parte** do fluxo deu certo.

Estrutura:

1. O que foi salvo
2. O que falhou
3. Como continuar (sem ambiguidade)

Exemplo:

> A consignação foi criada,  
> mas não foi possível abrir a tela de Entrega.  
>  
> Você pode continuar pela Central de Consignações.

### Empty State

Sempre: título curto + próximo passo.

Exemplo:

> Sem consignações.  
> Clique em "Nova Consignação" para iniciar.

### Loading

Textos específicos da ação (`Criando consignação...`, `Registrando pagamento...`).

Proibido: `Aguarde...`

### Confirmações

Sempre via `confirmDialog` / Modal do Motor Comercial.

Proibido: `alert()`, `confirm()`, `prompt()` nativos.

## Fluxo de mensagens

```
Ação do operador
    → API / Use Case (sem alteração nesta sprint)
    → Resultado
        ├─ sucesso total     → notifySuccess / SuccessMessages
        ├─ falha total       → notifyError / ErrorMessages
        ├─ sucesso parcial   → notifyRecovery / RecoveryMessages
        └─ validação prévia  → notifyWarning / WarningMessages
```

Recovery Framework (`resume*`) usa `operationalMessage()` do catálogo UX-1  
(`frontend/modules/motor-comercial/messages`), não mensagens genéricas opacas.

## Boas práticas

1. **Nunca** hardcodar toast novo fora do catálogo.
2. Preferir chave do catálogo (`notifySuccess('ENTREGA_REGISTRADA')`).
3. Em erro, preferir `notifyError('ENTREGA_REGISTRAR', error)` para mapear contexto.
4. Em empty state, usar `emptyState('CONSIGNACOES')`.
5. Em loading, usar `loadingText('REGISTRANDO_ENTREGA')`.
6. Em confirmação, usar `ConfirmMessages.*` ou `confirmCopy(key)`.
7. Não expor stack, HTTP bruto ou TypeError ao operador.

## Auditoria UX-1

Verificar periodicamente:

- [ ] Nenhuma mensagem genérica opaca ("Erro inesperado", "Falha ao executar", etc.)
- [ ] Nenhum `alert()` / `confirm()` / `prompt()` nativo no Motor Comercial
- [ ] Empty states com próximo passo
- [ ] Recovery messages com o que foi salvo + próximo passo
- [ ] Loadings sem "Aguarde..."

## Escopo

Sprint exclusivamente de UX.

Não altera: Ledger, Outbox, Resilience, Projection Services, Banco, APIs, Use Cases, Domínio.
