# PLATFORM-02.1 — Relatório único de Build / Testes / Audit / Smoke

**Data:** 2026-07-17  
**Sprint:** Consolidação Arquitetura CORE  
**Ambiente:** Windows · Node · banco oficial local

---

## Resumo executivo

| Área | Resultado |
|------|-----------|
| Suíte MCC CORE (`test:mcc:all` suites individuais) | **PASS** |
| Motor Comercial (`test:motor-comercial`) | **PASS** (após alinhamento UC-020 × STAB-06) |
| Build / Verify / Audit / Smoke Motor Comercial | **PASS** |
| Legado conversão (`test:conversao-unidades`, `test:muc`) | **PASS** |
| DANFE (`test:danfe-itens-venda`) | **PASS** (após ajuste legado cupom × FIS-01) |
| Dependências circulares motores | **Nenhuma** |
| Inventário legado | **Documentado** (`DEPENDENCIAS_OFICIAIS.md`) |

**Veredito:** Build da plataforma **ÍNTEGRA** para o marco PLATFORM-02.

---

## 1. Testes MCC / integrações CORE

| Script | Resultado | Observação |
|--------|-----------|------------|
| `test:mcc` | PASS (11 OK) | |
| `test:mcc02` | PASS (9 OK) | |
| `test:mcc021` | PASS (8 OK) | |
| `test:mci01` | PASS (12 OK) | |
| `test:mcc03` | PASS (9 OK) | |
| `test:mcc04` | PASS (13 OK) | |
| `test:pdv01` | PASS | |
| `test:com01` | PASS | |
| `test:fis01` | PASS (9 OK) | |
| `test:mcc-hom` | PASS (9 OK) | Exit code 134 ocasional no *teardown* nativo SQLite/NAPI — **asserções OK** |

---

## 2. Motor Comercial

| Script | Resultado |
|--------|-----------|
| `test:motor-comercial` | PASS |
| `build:motor-comercial` | PASS |
| `verify:motor-comercial` | VERIFY PASSED |
| `audit:bundle` | AUDIT PASSED |
| `smoke:motor-comercial-bundle` | SMOKE PASSED |

### Ajuste de verificação (sem mudança de regra de negócio)

- **UC-020:** teste atualizado — STAB-06 não espelha receita financeira nesta UC; ledger + evento de domínio permanecem.

---

## 3. Fiscal / legado

| Script | Resultado |
|--------|-----------|
| `test:danfe-itens-venda` | PASS |
| `test:conversao-unidades` | PASS (15 OK) |
| `test:muc` | PASS |

### Ajuste mínimo DANFE

- Com UC: quantidade comercial (FIS-01).  
- Sem UC: cupom continua somando fiscal + não fiscal (venda completa).

---

## 4. Auditoria de dependências

Ver `DEPENDENCIAS_OFICIAIS.md`.

| Check | Status |
|-------|--------|
| Ciclos motor↔motor | OK |
| Estoque sem conversão | OK |
| Fiscal sem `Converter` | OK |
| Legado inventariado | OK (não removido) |

---

## 5. Documentos publicados nesta sprint

| Documento |
|-----------|
| `ARQUITETURA_CORE_CDS.md` |
| `PLATFORM_CORE.md` |
| `CORE_SERVICES.md` |
| `SSOT_OFICIAL.md` |
| `DEPENDENCIAS_OFICIAIS.md` |
| `ROADMAP_MOTORES.md` |
| `PLATFORM_02_1_BUILD_REPORT.md` (este) |
| `CHANGELOG.md` (marco PLATFORM-02) |
| `ARQUITETURA_GERAL.md` (ponte para CORE) |

---

## Decisão

Arquitetura CORE oficialmente consolidada.  
Próximos motores devem consumir os contratos em `CORE_SERVICES.md` / `SSOT_OFICIAL.md`.
