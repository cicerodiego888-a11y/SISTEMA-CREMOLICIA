# MIDP — Configuração Simplificada (3.8D.3.2)

**Data:** 2026-07-30  

## Objetivo

Remover a seleção de política na interface. O MIDP possui apenas estado **ligado/desligado**.

## Interface

**MIDP — Distribuição Inteligente de Pagamentos**

- Desativado  
- Ativado  

Não existe mais escolha entre `LEGADO` e `PRESERVAR_DINHEIRO`.

## Comportamento

| Estado | Runtime |
|--------|---------|
| Desativado | Fluxo legado (`LegacyDistributionPolicy`) — sem alteração na emissão |
| Ativado | Sempre `PreservarDinheiroPolicy` (algoritmo homologado) |

## Persistência

| Campo | Papel |
|-------|--------|
| `midp_ativado` | Único controle operacional |
| `midp_politica` | Compatibilidade com configs antigas; na gravação, `LEGADO` → `PRESERVAR_DINHEIRO` |

## Arquivos

- `frontend/erp/js/configuracoes.js` — UI
- `backend/rotas/configuracoes_avancadas.js` — controller
- `backend/services/configuracaoService.js` — validação / migração
- `backend/motores/midp/policies/MidpPolicyFactory.js` — seleção por `midp_ativado`
- `backend/motores/midp/MidpService.js` — repasse ao factory

## Não alterado

Algoritmo MIDP · Motor Fiscal × Não Fiscal · DistribuidorPagamento · XML NFC-e · Financeiro · Estoque
