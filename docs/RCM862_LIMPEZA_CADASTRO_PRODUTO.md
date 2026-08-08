# RCM-8.6.2 — Limpeza final do Cadastro de Produtos

| Campo | Valor |
|---|---|
| Sprint | RCM-8.6.2 |
| Data | 2026-08-07 |
| Base | RCM-8.0 · RCM-8.2 · RCM-8.6 |
| Natureza | Remoção de UI legada de precificação |

---

## Removido da interface

- Card **2b · Margem e Atacado (legado)**
- Campo **Lucro Estimado** / formação de preço por margem
- Faixas **Preço Atacado (legado)** (`produto_atacado`)
- Helpers de edição de faixas no ERP
- Mobile: `% Lucro real`, checkbox **Venda em atacado**, seção de faixas no detalhe

## Mantido (arquitetura oficial)

- **Preço de Segurança** (fallback do Resolver)
- **Linha de Precificação** (opcional)
- **Participa do Atacado** (elegibilidade de canal — não é preço)
- Forma de Comercialização, Unidades Comerciais (UC), Estoque, Custos, Fiscal

## Persistência

- `lucro_percentual` continua sendo derivado de compra × Preço de Segurança no save (coluna DB), sem UI
- `venda_atacado` enviado como `0` no cadastro (faixas fora do fluxo oficial)
- `tabela_preco_id` permanece `null` no fluxo oficial

## Operação

1. Recarregar ERP/Mobile (Ctrl+F5)
2. Abrir Cadastro de Produtos → confirmar ausência do card Margem/Atacado
3. Validar Preço de Segurança e Linha na seção Comercial
