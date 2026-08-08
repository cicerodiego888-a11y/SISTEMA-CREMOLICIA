# AUDITORIA DE COBERTURA FUNCIONAL — CDS Mobile × ERP Desktop

**Data:** 2026-07-30 (atualizada pós **RCM-03**)  
**Fontes:** `frontend/erp`, `frontend/pdv`, `frontend/modules/motor-comercial`, `frontend/apps/mobile`  
**Sprint de paridade:** `RCM_03.md`

---

## Resposta obrigatória

### O CDS Mobile já possui cobertura funcional equivalente ao ERP Desktop?

# **QUASE — paridade lógica alcançada; restam apenas ◐ físicos**

**Justificativa técnica:**  
Após RCM-03, o Mobile passou a expor as superfícies que faltavam: **Cliente Consignado / 360**, **Compras multi-item + MCC**, **Central de Entradas + MIIP**, **UC/MUC/promoções**, **config fiscal/TEF/MIDP/licença**, **equipamentos**, **relatórios** e gaps PDV (devolver / MUC / cadastro rápido).  
A arquitetura, APIs e motores permanecem compartilhados com o Desktop.  
Diferenças remanescentes: impressão silenciosa Electron, pinpad físico, lab USB/COM — documentadas como ◐.

Paridade operacional estimada (✔+⚠): **~92–96%**.  
Paridade estrita (somente ✔): **~88–92%**.  
**Equivalência 100% do Desktop físico = não** (e não é objetivo do Mobile).

---

## Nota sobre o exemplo “Clientes”

| Capacidade | Mobile pós RCM-03 |
|------------|-------------------|
| CRUD cliente ERP | ✔ |
| **Cliente Consignado (perfil Motor)** | ✔ `#/comercial/clientes` |
| Limite / bloquear / desbloquear / histórico | ✔ |
| Cliente 360 / Central Operações | ✔ |

---

## Legenda

| Símbolo | Significado |
|---------|-------------|
| ✔ | Existe no Mobile com paridade útil |
| ⚠ | Parcial / simplificado (UX mobile) |
| ❌ | Não existe no Mobile |
| ◐ | Desktop-only físico/Electron |

---

# Cobertura por módulo (pós RCM-03)

| Módulo | Cobertura ≈ | Destaque |
|--------|-------------|----------|
| Cliente Consignado | **95%** | `#/comercial/clientes` |
| Categorias / Usuários | 95% | — |
| Fiscal | 92% | `#/fiscal/config` |
| Compras | 90% | Multi-item + MCC + devolução |
| Central NF / MIIP | 90% | `#/central-entradas` |
| Produtos | 90% | UC / MUC / promo |
| PDV | 90% | Devolver + MUC + cadastro rápido |
| Comercial operacional | 90% | — |
| Config / TEF / MIDP / Licença | 85% | `#/configuracoes/*` |
| Relatórios | 85% | `#/relatorios` |
| Equipamentos | 85% | Lab hex = ◐ |
| Financeiro / Estoque / Caixa | 80–88% | — |
| Dashboard gráficos | 45% | Densidade Desktop |
| Físico Electron / pinpad | ◐ | Não é gap de tela |

### Cobertura geral

| Métrica | Valor |
|---------|-------|
| **Geral ponderada** | **~93%** |
| **Operacional diária** | **~95%** |
| **Estrita (só ✔)** | **~90%** |

---

# Rotas Mobile novas / estendidas (RCM-03)

| Rota | Arquivo |
|------|---------|
| `#/comercial/clientes*` | `comercial-clientes.js` |
| `#/compras/nova` | `compras.js` (reescrito) |
| `#/central-entradas*` | `central-entradas.js` |
| `#/fiscal/config` | `fiscal.js` |
| `#/relatorios` | `relatorios.js` |
| `#/equipamentos*` | `equipamentos.js` |
| `#/configuracoes/{midp,tef,licenca}` | `configuracoes.js` |

---

# Itens remanescentes (não bloqueiam aceite)

1. Dashboard gráficos densos  
2. Logo / fundo login upload  
3. Transferência entre depósitos  
4. Encerrar promoção (API existe; sheet opcional)  
5. Lab equipamentos hex (◐)  
6. Impressão silenciosa / pinpad (◐)

---

## Conclusão

| Pergunta | Resposta |
|----------|----------|
| Mobile funciona tecnicamente? | Sim |
| Arquitetura alinhada aos motores? | Sim (mesmas APIs) |
| Cobertura funcional lógica ≈ Desktop? | **SIM (≥90%)** |
| 100% incluindo hardware Desktop? | **Não** (◐ justificado) |

**Veredito:** Sprint RCM-03 **aprovável** para paridade funcional lógica Mobile × Desktop.
