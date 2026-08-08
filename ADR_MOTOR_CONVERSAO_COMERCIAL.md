# ADR — Motor de Conversão Comercial (MCC)

**Status:** Aceito (atualizado MCC-02.1)  
**Data:** 2026-07-17  
**Código:** MCC-01 / MCC-02 / MCC-02.1 / MCI-01  
**Decisores:** Plataforma CDS

---

## Contexto

A Plataforma CDS adota **1 Produto → 1 Unidade Base de Estoque (SSOT) → N Unidades de Comercialização** (UC-01).

Produtos com conversão física (ex.: L ↔ Kg) têm densidade variável por lote — o fator não pode viver no cadastro do produto. Correções pós-conferência exigem histórico imutável.

---

## Decisão

Criar o **Motor de Conversão Comercial (MCC)** como componente **CORE** transversal.

1. O MCC é o **único** responsável por converter Unidades de Comercialização ↔ Unidade Base ↔ Conversão Física.
2. Nenhum módulo operacional deve implementar regras próprias de conversão.
3. A interface oficial é `Converter()` + `CalcularConversaoFisica()` + APIs de versão.
4. Enums oficiais: `TipoConversao`, `ContextoConversao`, `OrigemConversaoFisica`, `MotivoVersaoConversao`.
5. **MCC-02:** Conversão física pertence ao **lote**. Produto só declara flags (sem fator).
6. **MCC-02.1:** conversões são **versionadas**; MCC usa **somente a versão ativa**; UPDATE/DELETE de histórico proibidos.
7. **MCI-01:** a Entrada de Mercadorias (via `CompraConversaoOrchestrator`) é a **única origem autorizada** a criar a versão inicial.
8. PDV/Estoque/Fiscal/UI operacional **não** são alterados nestas sprints de infraestrutura.

### Princípio

> Um Produto → Uma Unidade Base (SSOT) → N Unidades de Comercialização → Lote → Histórico de Conversões → Conversão Ativa → MCC.

### Arquitetura proibida

> Produto → Fator Litro/Kg.  
> UPDATE de fator em versão existente.  
> Criar ConversaoFisicaLote fora da Entrada.

---

## Referências

- `MCC_01_ARQUITETURA.md` · `MCC_02_CONVERSAO_FISICA_LOTE.md` · `MCC_02_1_VERSIONAMENTO.md`
- `MCI_01_ENTRADA_MERCADORIAS.md` · `ADR_VERSIONAMENTO_CONVERSAO_LOTE.md` · `ADR_ORCHESTRATOR_COMPRA.md`
- `backend/motores/motor-conversao-comercial/`
