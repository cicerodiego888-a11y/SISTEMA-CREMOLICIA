# RCM-8.7 — Consolidação do Domínio Comercial

| Campo | Valor |
|---|---|
| Sprint | RCM-8.7 |
| Data | 2026-08-07 |
| Natureza | UX / terminologia / alinhamento à arquitetura oficial |
| Escopo | Sem novas funcionalidades de precificação — só clareza |

---

## Princípio

O usuário não precisa conhecer o Motor Comercial.

Ele entende:

> Meu Produto pertence ou não a uma **Linha de Precificação**.  
> O restante é responsabilidade da **Central de Precificação**.

---

## Cadastro de Produto (Card Comercial)

Campos oficiais:

- Grupo Comercial
- Linha de Precificação (opcional) + painel inteligente
- Forma de Comercialização
- Unidade Base
- Preço de Segurança (Fallback)
- Participa do Atacado

Botão **Analisar Produto** → simulação via Motor Oficial (sem PDV).

---

## Linha inteligente

Ao selecionar Linha: produtos vinculados, operações com/sem preço (tempo real).

Sem Linha: **Produto com Precificação Própria**.

---

## Telas

| Tela | Mudança |
|---|---|
| Linhas de Precificação | Grade rica (produtos, tabelas, operações, última alteração, status) |
| Central de Precificação | Pesquisa de produto mostra Linha ou Precificação Própria |
| Diagnóstico | Consistência geral + Analisar |

---

## Terminologia oficial

- Linha de Precificação
- Grupo Comercial
- Central de Precificação
- Preço de Segurança
- Motor Oficial de Precificação

---

## Teste

```bash
node backend/modules/comercial/tests/rcm87-dominio-comercial.test.js
```

## Operação

1. Reiniciar backend (`npm start`)
2. Ctrl+F5 no ERP
3. Abrir Cadastro de Produto → Card Comercial
4. Selecionar Linha e validar painel
5. Abrir Linhas de Precificação / Diagnóstico
