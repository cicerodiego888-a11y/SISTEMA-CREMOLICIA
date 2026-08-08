# Purge Tipos Comerciais

| Campo | Valor |
|---|---|
| Data | 2026-08-07 |
| Script | `backend/scripts/purge-tipos-comerciais.js` |
| Banco | `C:\ProgramData\MercantilFiscal\dados\mercadao.db` |

## Causa do “voltar sozinho”

A migration `018_tipos_comerciais.js` rodava a cada `npm start` com `INSERT OR IGNORE` de 9 tipos.
Após o purge, o próximo boot recriava ATACADISTA, CONSIGNADO, etc. (IDs novos).

**Correção:** seed completo só se a tabela estiver **vazia**; caso contrário, garante apenas `CONSUMIDOR_FINAL`.

## Resultado

Resta apenas **CONSUMIDOR_FINAL** (obrigatório — perfil padrão do Cliente / Varejo).

Reinicie o backend (`npm start`) após o purge para carregar a migration corrigida.

## Reexecutar

```bash
node backend/scripts/purge-tipos-comerciais.js
```
