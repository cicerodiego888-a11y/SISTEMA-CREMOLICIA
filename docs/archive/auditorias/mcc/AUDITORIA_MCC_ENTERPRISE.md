# AUDITORIA MCC ENTERPRISE — MCC-HOM-01

**Data:** 2026-07-17  
**Motor:** `backend/motores/motor-conversao-comercial/`  
**Versão:** 1.3.0-mcc02.1  
**Tipo:** Homologação arquitetural (sem novas features)

---

## Resumo executivo

| # | Auditoria | Resultado |
|---|-----------|-----------|
| 1 | Conversões fora do MCC | **RESSALVA** — legados pré-MCC ainda existem (migração pendente) |
| 2 | Dependências do MCC | **APROVADO** — zero dependência de Compras/Estoque/PDV/Fiscal/Comercial/MIIP |
| 3 | Responsabilidades | **APROVADO** — apenas conversão / fator / lote / auditoria / precisão |
| 4 | Tipos de conversão | **APROVADO** |
| 5 | Stress 100k | **APROVADO** |
| 6 | Thread-safety | **APROVADO** (Node + worker_threads) |
| 7 | Versionamento | **APROVADO** |
| 8 | Escalabilidade | **APROVADO** |
| 9 | Preparação futura | **APROVADO** |
| 10 | Documentação | **APROVADO** |

**Veredito do motor:** APROVADO como CORE.  
**Gate de plataforma:** módulos operacionais ainda usam conversão legada; a partir desta homologação, **toda nova integração deve consumir o MCC**.

---

## Auditoria 1 — Conversões fora do MCC

### Achados (legado pré-integração)

| Local | Artefato | Classificação |
|-------|----------|---------------|
| `backend/lib/motorConversaoUnidades` | Conversão fracionada / custo | LEGADO — usado por Compras/Produtos |
| `backend/motores/muc/converters/ConversorUnidades.js` | `paraBase` / `deBase` fiscal-comercial | LEGADO MUC |
| `backend/rotas/compras.js` | consome `motorConversaoUnidades` | LEGADO operacional |
| `backend/rotas/produtos.js` | `resolverCustoUnitarioProdutoCadastro` | LEGADO operacional |
| Vendas / `fator_conversao` em itens | persistência de fator MUC | LEGADO |

### Dentro do perímetro MCC / UC-01 / MCI

Nenhuma regra de conversão UC↔base↔física foi implementada em Compras/Estoque/PDV/Fiscal/Motor Comercial **como consumidor do novo modelo**. O `CompraConversaoOrchestrator` é a ponte oficial (ainda sem ligação HTTP operacional de estoque).

### Conclusão A1

- **ZERO cálculos duplicados no novo domínio MCC** ✔  
- **Legados ainda ativos no fluxo atual** ⚠ (esperado até sprints de integração)  
- **Gate:** proibir novas implementações fora do MCC; migrar MUC/`motorConversaoUnidades` nas sprints operacionais.

---

## Auditoria 2 — Dependências do MCC

Varredura de `require` no núcleo MCC (exceto `tests/` e `routes/`):

- Dependências: apenas módulos internos do próprio motor + Node stdlib.
- `routes/` usa `database` (bootstrap/API) — borda de infraestrutura, não regra de negócio de Compras/PDV.
- **Não** há `require` de: compras, estoque, pdv, fiscal, motor-comercial, miip, financeiro.

**Resultado:** dependência circular **não existe**. MCC é leaf CORE.

---

## Auditoria 3 — Responsabilidades

### Permitido (confirmado)

- Resolver conversões (`Converter`)
- Resolver fator (`CalcularConversaoFisica`, lote)
- Precisão (estrutura preparada)
- Lote / versão ativa
- Auditoria em memória

### Proibido (confirmado — ausente nas exports/APIs)

- Mover estoque  
- Emitir NF  
- Salvar compra  
- Gerar financeiro  
- Atualizar crédito  

---

## Auditoria 4 — Conversões

Cobertura validada em testes unitários + HOM:

| Tipo | Status |
|------|--------|
| PADRAO | OK |
| AGRUPAMENTO | OK |
| FRACIONAMENTO | OK |
| CONVERSAO_FISICA | OK (lote) |
| CONVERSAO_COMPOSTA | OK |
| Versionamento lote | OK |

---

## Auditoria 5 — Stress

Medições locais (`npm run test:mcc-hom`):

| Cenário | Resultado típico |
|---------|-----------------|
| 100.000 conv mesmo lote + cache | ~60ms · ~0.0006 ms/conv · cache 1 chave |
| 100.000 multi-lote | ~90ms |
| Sem cache vs com cache (20k) | cache reduz tempo (ex.: 41ms → 14ms) |
| Δ heap stress | baixo (< 2 MB no cenário cache) |

**Aprovado.**

---

## Auditoria 6 — Thread-safety

- `worker_threads` (4 workers × 5.000 conv): resultados idênticos (40 L).
- Cache por instância/`operacaoId` isolado sob concorrência async.
- Modelo Node: Map sync é seguro no event loop; workers usam instâncias isoladas do módulo.

**Aprovado** para runtime Node (ERP/Electron).

---

## Auditoria 7 — Versionamento

- `atualizar()` → `ConversaoFisicaImutavelError`
- `excluir()` → bloqueado
- Correção → nova versão + anterior `ativa=0`
- MCC resolve só ativa

**Aprovado.**

---

## Auditoria 8 — Escalabilidade

Simulação: **100 produtos × 10.000 lotes × 50.000 conversões**  
Tempo típico ~130ms · heap transitório aceitável.

**Aprovado** para volume enterprise inicial.

---

## Auditoria 9 — Preparação futura

Contratos prontos para consumo por:

Compras (orchestrator) · Estoque · PDV · Fiscal · Motor Comercial · Financeiro · MIIP · E-commerce  

Sem necessidade de mudança estrutural no MCC — apenas wiring.

---

## Auditoria 10 — Documentação

| Documento | Status |
|-----------|--------|
| `MCC_01_ARQUITETURA.md` | OK |
| `MCC_02_CONVERSAO_FISICA_LOTE.md` | OK |
| `MCC_02_1_VERSIONAMENTO.md` | OK |
| `MCI_01_ENTRADA_MERCADORIAS.md` | OK |
| `DIAGRAMA_MCC.md` | OK |
| ADRs (MCC / física / versionamento / orchestrator) | OK |
| Enums / erros / APIs | OK |

---

## Riscos residuais

1. **Legado MUC / motorConversaoUnidades** ainda calcula no operacional.  
2. Precisão comercial (`casasDecimais`) preparada, não aplicada.  
3. Persistência de auditoria de conversão ainda em memória (exceto versionamento de lote no DB).
