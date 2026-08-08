# Dependências Oficiais — PLATFORM-02.1

**Data:** 2026-07-17  
**Escopo:** varredura de acoplamento entre motores + inventário de legado  
**Ação nesta sprint:** auditar e documentar — **não remover código**.

---

## 1. Grafo permitido (CORE)

```
UC-01 ──────────────► MCC
                         │
                         ├─► Motor Estoque   (quantidade base)
                         │
Motor Comercial ─────────┘   (via comercialOperacional / bridge)
                         │
Venda (snapshot) ───────► FiscalOperacionalService → Motor Fiscal
```

### Regras

| Regra | Status auditoria |
|-------|------------------|
| Sem ciclos A↔B entre motores | **OK** — nenhum ciclo detectado |
| Motor Estoque não importa MCC/UC/MUC | **OK** |
| Conversão só no MCC | **OK** nos caminhos oficiais (PDV/COM/FIS/MCC-03) |
| Comunicação por facade/orchestrator/evento/API | **OK** com débitos listados abaixo |

---

## 2. Dependências motor → motor (encontradas)

| De | Para | Via | Avaliação |
|----|------|-----|-----------|
| MCC `ComercialOperacionalService` | Motor Estoque | `require('.../motor-estoque')` | **Permitido** (adapter COM-01) |
| Motor Comercial | MCC | `comercialOperacional` / bridge | **Permitido** |
| MCC operacionais | UC repository (path profundo) | `ProdutoUnidadeComercialRepository` | **Débito** — preferir facade UC |
| Central Entradas | MIIP utils | path utilitário | **Débito leve** (domínio auxiliar) |
| App `compras.js` / `VendaPagamentoService` | MCC + Motor Estoque | app layer | **Permitido** (orquestração de aplicação) |

---

## 3. Requires proibidos (política)

| Proibido | Evidência |
|----------|-----------|
| Motor Estoque → MCC / UC / MUC / Conversor | Ausente (gate em `test:mcc04`) |
| Motor Fiscal → `Converter` / × fator para emitir | Ausente (FIS-01 / `test:fis01`) |
| Ciclo MCC ↔ Estoque | Ausente (só MCC→Estoque no adapter comercial) |

---

## 4. Inventário de legado

| Artefato | Local | Status | Nota |
|----------|-------|--------|------|
| `motorConversaoUnidades` | `backend/lib/motorConversaoUnidades.js` | **ATIVO** | Ainda usado em Compras (preço/qty) e Produtos |
| Uso em `compras.js` (helpers preço/qty) | rotas compras | **EM MIGRAÇÃO** | Estoque já via MCC-03; helpers comerciais residuais |
| Uso em `produtos.js` (custo) | rotas produtos | **ATIVO** | Cadastro |
| UI namespace `motorConversaoUnidades` | `frontend/erp/js/produtos.js` | **ATIVO** | Evento jQuery — não é motor |
| MUC `ConversorUnidades` | `backend/motores/muc/` | **ATIVO** | Legado fiscal/UC MUC |
| Rotas MUC montadas | produtos / muc routes | **ATIVO** | Coexiste com UC-01 |
| Testes `test:conversao-unidades` / `test:muc` | tests/ | **ATIVO** | Cobertura do legado |
| `fator_conversao` em `vendas_itens` | persistência | **ATIVO** | Campo de auditoria MCC — não é motor |
| Fallback `q * fator` em `FiscalOperacionalService.obterQuantidadeBase` | fiscal adapter | **EM MIGRAÇÃO** | Só se snapshot fiscal incompleto |
| Adaptadores temporários MCC `integracao/*` | MCC | **ATIVO** | Oficiais — não remover |

### Destino recomendado (sprints futuras — fora de escopo)

| Artefato | Destino |
|----------|---------|
| `ConversorUnidades` / APIs MUC de conversão | **REMOVER** após cutover total UC-01 |
| `motorConversaoUnidades` em Compras | **REMOVER** após migrar helpers de preço |
| Paths profundos UC repo no MCC | Refatorar para facade UC (**EM MIGRAÇÃO**) |

---

## 5. Conclusão da auditoria

- Arquitetura CORE **sem ciclos**.  
- Caminhos oficiais (Compras estoque, PDV, Comercial, Fiscal) **não** dependem do legado para conversão de estoque/emissão.  
- Legado permanece **inventariado e classificado**; remoção em sprint dedicada.
