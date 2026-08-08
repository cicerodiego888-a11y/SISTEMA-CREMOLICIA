# ADR A-1 — Desacoplamento Categoria × Política Comercial

**Versão:** A-1  
**Tipo:** Refatoração Arquitetural  
**Status:** Aceito

## Contexto

Historicamente (RCM-05.6), Categoria gerava automaticamente Linha Comercial 1:1.  
Isso acoplava taxonomia de produto à estratégia comercial e impedia evolução independente.

## Decisão

1. **Categoria** = classificação do produto (taxonomia).  
2. **Política Comercial** = estratégia comercial (nome de produto). Internamente permanece `linhas_comerciais` por compatibilidade.  
3. Categoria **não cria** Política Comercial.  
4. Produto ↔ Políticas em N:N (`produto_politicas_comerciais`).  
5. Sem políticas explícitas no produto = **todas habilitadas** (compatibilidade; produto antigo continua vendendo).  
6. Categoria pode **sugerir** política no cadastro; nunca obrigar.

## Conceitos independentes

| Conceito | Papel |
|----------|--------|
| Categoria | Classificação |
| Política Comercial | Estratégia |
| Canal | Onde ocorre a venda |
| Tabela de Preço | Superfície de configuração |
| Pricing Engine | Motor único de decisão (futuro) |

## Não alterar

Motor Fiscal, Não Fiscal, Ledger, Outbox, Resilience, Projection, Pricing Engine core, Motor Comercial operacional, PDV, regras fiscais. Sem migração destrutiva.

## Implementação

- Migration `013_politica_comercial_desacoplamento` (ADD only + backfill N:N do FK legado)
- `CategoriaLinhaComercialService`: espelhamento desativado
- `ProdutoPoliticasComerciaisService`: N:N e resolução
- `ComercialPrecoResolver`: resolve via políticas / legado; sem create-on-miss
- UX: textos “Política Comercial”; produto com multi-select

## Compatibilidade

- Preserva `produtos.linha_comercial_id`, `categorias.linha_comercial_id`, `categoria_origem_id`
- Backfill junction a partir do FK legado
- Sem política explícita → fallback tabela / `preco_venda`
