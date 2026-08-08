# RCM-03 — Paridade funcional CDS Mobile × ERP Desktop

**Sprint:** RCM-03  
**Data:** 2026-07-30  
**Objetivo:** Eliminar gaps de cobertura funcional Mobile vs Desktop (sem novas regras de negócio; reutilizar APIs oficiais).

---

## Entregas desta sprint

| Pri | Área | Status Mobile | Rotas / arquivos |
|-----|------|---------------|------------------|
| P1 | Cliente Consignado / Cliente 360 | ✔ | `#/comercial/clientes*` → `comercial-clientes.js` |
| P2 | Compras multi-item + MCC + conferência + devolução | ✔ | `#/compras/nova` → `compras.js` |
| P3 | Central de Entradas | ✔ | `#/central-entradas*` → `central-entradas.js` |
| P4 | MIIP | ✔ (embutido na Central) | `miip/identificar-lote`, feedback, revisão |
| P5 | Produtos UC / MUC / promoções | ✔ | detalhe produto + sheets |
| P6 | Fiscal config (CSC, série, cert, ambiente) | ✔ | `#/fiscal/config` |
| P7 | PDV (devolver, cadastro rápido, MUC barras) | ✔ | `pdv.js` |
| P8 | Relatórios | ✔ | `#/relatorios` |
| P9 | Config MIDP / TEF / Licença | ✔ | `#/configuracoes/{midp,tef,licenca}` |
| P10 | Equipamentos | ✔ | `#/equipamentos*` |

---

## Limitações físicas (não são gap de implementação)

| Recurso | Tratamento Mobile |
|---------|-------------------|
| Impressão silenciosa Electron | Share / abrir HTML (DANFE, cupom) |
| Pinpad TEF físico | Config + pagamento via API; aviso ◐ |
| Lab hex USB/COM | Diagnóstico API; lab denso no Desktop |
| Foto produto servidor | Sem API Desktop equivalente |

---

## Critério de aceite — reauditoria

Executar nova comparação Desktop × Mobile após deploy.

Esperado: cobertura operacional **≥ 90%**; gaps remanescentes apenas ◐ (hardware/Electron).

Ver `AUDITORIA_COBERTURA_MOBILE.md` (atualizada pós RCM-03).
