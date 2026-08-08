# Relatório — Migração Linhas Comerciais (RCM-05.5)

## Como consultar

Após a migration `007_linhas_comerciais`:

1. ERP: **Configurações → Comercial → Linhas Comerciais → Relatório de migração**
2. API: `GET /api/linhas-comerciais/migracao/relatorio`
3. Tabela: `linhas_comerciais_migracao_log`

## Classificação automática

| Heurística | Linha |
|---|---|
| Forma/nome CASQUINHA | CASQUINHA |
| Nome com PICOL / PIC + ESP/ESPECIAL/PREMIUM | PIC_ESP |
| Nome com PICOL / PIC (demais) | PIC_COM |
| Nome com SORVET | SORVETE |

Produtos sem match permanecem com `linha_comercial_id` NULL e entram no relatório de não classificados (até 500 itens no JSON do log).

## Ação operacional

Associar manualmente no cadastro do produto a Linha Comercial correta para itens não classificados.
