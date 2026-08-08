# RCM-8.7.1 — Experiência Enterprise do Domínio Comercial

| Campo | Valor |
|---|---|
| Sprint | RCM-8.7.1 |
| Data | 2026-08-07 |
| Base | RCM-8.7 |
| Natureza | UX enterprise — impacto, cobertura, simulação, navegação |

---

## Cadastro do Produto

- Impacto da Linha (produtos, operações ✔/✖, última alteração, dependências)
- Botões **Ver Linha** / **Abrir Central de Precificação**
- Painel **Onde este Produto é vendido**
- Card **Resumo Comercial**
- Indicadores 🟢🟡🔴🔵
- **Cobertura**, **Simular Preço**, **Analisar**, **Copiar**, **✨ Sugerir Linha** (placeholder IA)

## Navegação

- Clique na Linha → Dashboard da Linha
- Clique no Grupo → Categorias
- Clique na Operação → Central filtrada
- Central ao lado da Linha com filtro automático

## Linhas

Dashboard ao abrir: produtos, tabelas, operações, fallback, última alteração.

## Teste

```bash
node backend/modules/comercial/tests/rcm871-experiencia-enterprise.test.js
```

## Operação

1. Reiniciar backend + Ctrl+F5
2. Abrir produto → Card Comercial
3. Selecionar Linha e validar painéis/botões
