# RCM-8.2 — Reestruturação do Cadastro de Produtos

| Campo | Valor |
|---|---|
| Sprint | RCM-8.2 |
| Data | 2026-08-06 |
| Base | RCM-8.0 / RCM-8.1 |
| Natureza | Adequação do cadastro ao Motor Oficial |

---

## Regra oficial refletida no cadastro

```text
Linha preenchida  → Resolver usa a Linha
Linha vazia       → Resolver usa o Produto
```

O cadastro **não** contém Tabela, Canal nem Tipo Comercial.

---

## Card COMERCIAL

- Grupo Comercial (Categoria)
- Linha de Precificação (**opcional**) + ajuda UX
- Preço de Segurança (única regra de preço no cadastro)
- Unidade Base

Pesquisa da Linha: código, nome (e grupo quando disponível).

---

## Linhas de Precificação

- Novo / Editar / Ativar / Inativar
- Excluir bloqueado se houver produto vinculado (oferece inativar)

---

## API

- `linha_comercial_id` opcional; se informado → deve estar **ativa**
- `tabela_preco_id` forçado a `null` no create/update
- GET produto retorna `linha_comercial_codigo` / `linha_comercial_descricao`
- Consulta: Linha ou “Produto com precificação própria”

---

## Teste

```bash
node backend/modules/comercial/tests/rcm82-cadastro-produto.test.js
```

---

## Critérios

| Critério | Status |
|---|---|
| Linha opcional | ✔ |
| Sem/com Linha | ✔ |
| Sem Tabela/Canal/Tipo | ✔ |
| UX clara | ✔ |
| Integração Motor Oficial | ✔ |

---

## RCM-8.6.2

Limpeza visual: removidos card Margem/Atacado legado, Lucro Estimado e faixas de preço atacado.
Ver `docs/RCM862_LIMPEZA_CADASTRO_PRODUTO.md`.
