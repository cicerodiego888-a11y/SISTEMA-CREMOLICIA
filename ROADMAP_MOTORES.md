# Roadmap de Motores — Plataforma CDS

**Sprint referência:** PLATFORM-02.1  
**Data:** 2026-07-17

Novos motores **consomem** o CORE; não reimplementam conversão, estoque base, crédito/consignação ou emissão.

---

## Homologados (CORE)

| Motor / Trilha | Código | Consome |
|----------------|--------|---------|
| UC-01 | UC-01 / UC-01.1 | Cadastro produtos |
| MCC | MCC-01…04 + HOM | UC |
| Motor Estoque | MCC-04 | quantidade base (MCC) |
| Compras (entrada) | MCC-03 / MCI-01 | MCC → Estoque |
| PDV | PDV-01 | MCC → Estoque |
| PDV (Forma de Venda) | **PDV-UC-02** | UC-01 only (cutover; sem MUC na UI) |
| Ajuste de Estoque | **EST-MCC-01** | MCC → Estoque |
| Motor Comercial | COM-01 | MCC → Estoque |
| Motor Fiscal | FIS-01 | Snapshot venda / MCC |

---

## Em desenvolvimento

| Motor | Dependências CORE | Nota |
|-------|-------------------|------|
| **Motor Financeiro Enterprise (MFE)** | Eventos de PDV/Compras/Comercial; ledger | **MFE-00** visão oficial · `MFE_VISAO_ENTERPRISE.md` · `ROADMAP_MFE.md` |

---

## Planejados (domínio)

| Motor / Canal | Deve consumir | Não deve |
|---------------|---------------|----------|
| Produção | MCC + Motor Estoque | Converter localmente |
| WMS | Motor Estoque (+ MCC se UC) | Saldo paralelo |
| E-commerce | MCC + Estoque + Fiscal (quando emitir) | Fator próprio |
| CRM | Clientes (SSOT) + Comercial (crédito) | Ledger paralelo |
| Portal do Contador | Motor Fiscal (leitura/documentos) | Recalcular UC |
| App de Vendas | Comercial + MCC + Estoque | Conversão embutida |

---

## Princípio de expansão

```
Novo módulo
  → consulta SSOT_OFICIAL.md
  → consome facade/orchestrator CORE
  → se precisar de contrato novo → ADR
```
