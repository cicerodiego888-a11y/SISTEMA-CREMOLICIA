# A-1 — Politica Comercial (desacoplamento)

Ver tambem: `ADR_A1_POLITICA_COMERCIAL.md` (raiz).

## Cinco conceitos independentes

1. **Categoria** — classificacao do produto  
2. **Politica Comercial** — estrategia comercial (`linhas_comerciais` interno)  
3. **Canal** — onde ocorre a venda  
4. **Tabela de Preco** — superficie de configuracao  
5. **Pricing Engine** — motor unico de decisao (evolucao)

Categoria **nao** e Politica Comercial.

## Regras

- Cadastro de Politica: Configuracoes → Comercial → Politicas Comerciais  
- Produto: multiplas politicas (N:N)  
- Sem politicas no produto = todas habilitadas (compatibilidade)  
- Categoria pode sugerir; nunca obriga
