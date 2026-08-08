# ADR — Unidades de Comercialização (UC-01 / UC-01.1)

## Status
Accepted (Congelado) — CORE da Plataforma CDS

## Data
2026-07-17 (UC-01) · Refinado UC-01.1

## Código
UC-01 / UC-01.1

## Contexto
A plataforma precisa de múltiplas formas de compra/venda por produto sem estoques paralelos. UC-01 criou a entidade e o cadastro. UC-01.1 completa o modelo com canais, prioridade, unidade padrão e preparação para conversão por lote.

## Decisão
> **1 Produto → 1 Unidade Base de Estoque (SSOT) → N Unidades de Comercialização**

Cada Unidade Comercial possui:
- Tipo de Conversão (`PADRAO` | `AGRUPAMENTO` | `FRACIONAMENTO` | `CONVERSAO_FISICA`)
- Canal de Comercialização (compra, venda ERP/atacado/varejo, PDV, NFC-e, NF-e, comercial, orçamento)
- Prioridade (única por produto)
- Unidade Padrão (no máximo uma)
- Flag `conversao_por_lote` (prep. UC-02 — sem fator no cadastro)

Regras:
1. Nunca dois estoques para o mesmo produto.
2. Unidade Base = `produtos.unidade`.
3. Fator físico L↔Kg **não** fica no cadastro; entra na Compra (UC-02).
4. MUC legado (`produto_unidades`) permanece operacional e não é alterado.
5. Módulos operacionais ainda não consomem UC-01.1 (sprints futuras).

## Consequências
### Positivas
- Modelo CORE completo para crescimento da plataforma
- Canais permitem filtrar unidades por módulo no futuro
- Auditorias evitam inconsistências de cadastro

### Débitos
- Coexistência MUC + UC até unificação
- Consumo operacional ainda pendente

## Referências
- `MODELO_UNIDADES_COMERCIALIZACAO.md`
- `UC_01_ARQUITETURA.md`
- `UC_01_1_REFINAMENTO.md`
- `backend/motores/unidades-comercializacao/`
- `openapi-uc01.yaml`
