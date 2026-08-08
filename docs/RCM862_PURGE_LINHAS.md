# Purge Linhas de Precificação

| Campo | Valor |
|---|---|
| Data | 2026-08-07 |
| Script | `backend/scripts/purge-linhas-precificacao.js` |
| Banco | `C:\ProgramData\MercantilFiscal\dados\mercadao.db` |

## Resultado

| Item | Qtde |
|---|---|
| Linhas apagadas | 13 |
| Produtos desvinculados | 7 |
| Políticas comerciais removidas | 7 |
| Células Tabela×Linha removidas | 32 |
| Vínculos `tabela_preco_linhas` | 32 |
| Valores legados `linha_comercial_valores` | 43 |

Lista em Configurações → Comercial → Linhas de Precificação deve exibir **Nenhuma linha cadastrada.**

## Reexecutar

```bash
node backend/scripts/purge-linhas-precificacao.js
```
