# MCC-02.1 — Versionamento da Conversão Física por Lote

**Código:** MCC-02.1  
**Status:** Infraestrutura entregue  
**Versão motor:** 1.3.0-mcc02.1

---

## Princípio

Nunca substituir uma Conversão Física existente.  
Sempre criar uma **nova versão**. A anterior permanece para auditoria.

```
Produto → Lote → Histórico de Conversões → Conversão Ativa
```

---

## Modelo

| Campo | Papel |
|-------|--------|
| `versao` | Sequencial por lote (1, 2, …) |
| `ativa` | Apenas **uma** ativa por lote |
| `substitui_id` | ID da versão anterior |
| `motivo` | Enum oficial |
| `usuario_id` | Quem criou a versão |
| `created_at` | Timestamp |

**Imutável:** `quantidade_base`, `quantidade_destino`, `fator` de versões existentes.

Único UPDATE permitido: `ativa = 0` ao ativar a nova versão.

**Proibido:** DELETE de versões.

---

## Motivos oficiais

`CONFERENCIA_BALANCA` · `CORRECAO_OPERACIONAL` · `AJUSTE_FABRICANTE` · `ERRO_DIGITACAO` · `OUTRO`

---

## MCC

Sempre resolve a **versão ativa** (`buscarAtivaPorLoteId`).  
Versões inativas → erro `MCC_CONVERSAO_INATIVA`.

---

## APIs

| Método | Rota | Ação |
|--------|------|------|
| GET | `/api/lotes/:loteId/conversao-fisica/ativa` | Conversão ativa |
| GET | `/api/lotes/:loteId/conversao-fisica/historico` | Histórico completo |
| POST | `/api/lotes/:loteId/conversao-fisica/versoes` | Nova versão |
| POST | `/api/lotes/:loteId/conversao-fisica` | Versão inicial (v1) |

Serviço: `consultarConversaoAtiva` · `consultarHistorico` · `criarNovaVersao` · `criarVersaoInicial`

---

## Exemplo

```
Lote 20260717
  v1: 5 L = 3,375 Kg  → INATIVA
  v2: 5 L = 3,362 Kg  → ATIVA (CONFERENCIA_BALANCA)
```

---

## Testes

```bash
npm run test:mcc021
```

---

## Fora de escopo

Compras · Estoque · PDV · Fiscal · Comercial · UI
