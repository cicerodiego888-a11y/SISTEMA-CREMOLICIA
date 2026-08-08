# UX-PROD-01 — Consolidação Enterprise do Cadastro de Produtos (Quick Wins)

**Código:** UX-PROD-01  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Data:** 2026-07-17  

---

## Objetivo

Executar Quick Wins da auditoria do Cadastro de Produtos: clareza, organização visual e remoção de jargão técnico — **sem** alterar arquitetura, MCC, motores ou regras de negócio.

---

## O que foi implementado

1. **Unidade Base (Estoque)** — label + tooltip SSOT  
2. **Conversão Física** — bloco próprio, fora do Fiscal; texto sem “fator”  
3. **UC** — tipo `CONVERSAO_FISICA` exibido como **Medida Física**  
4. **Estoque Inicial** — bloco “Conversão Física Inicial” (UI preparada, inputs desabilitados)  
5. **Mensagens** explicativas para física / implantação  
6. **Campos mortos** — removidos fantasmas `data_validade`/`lote` do payload; UI MUC retirada do modal  
7. **Fluxo visual** — Identificação → Unidade Base → Comercial → Conversão Física → UC → Estoque → Fiscal  
8. **Fiscal** — collapse fechado por padrão; só campos fiscais  

---

## O que NÃO foi alterado

- MCC / Motor Estoque / Comercial / Fiscal / MFE  
- APIs existentes  
- F7 Compra  
- Criação de lote físico inicial (apenas UI preparada)  
- Bloqueio pós-movimentação (já existia; documentação reforçada)

---

## Arquivos

- `frontend/erp/js/produtos.js`  
- `backend/motores/unidades-comercializacao/constants.js` (label operador)  
- `UX_PROD_01.md` · `AUDITORIA_UX_PROD01.md`  
- `CHANGELOG.md` · `GOVERNANCE.md` · `ARQUITETURA_CORE_CDS.md` · `ROADMAP_REORGANIZACAO_CADASTRO.md`

---

## Critérios de aceite

- [x] Unidade Base clara  
- [x] Conversão Física separada  
- [x] Sem “fator” na UI do operador  
- [x] UC compreensível  
- [x] Fluxo reorganizado  
- [x] Campos mortos limpos  
- [x] Sem mudança de regra de negócio  

---

## ADR

**(x) NÃO**
