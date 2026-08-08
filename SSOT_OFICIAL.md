# SSOT Oficial — Plataforma CDS

**Sprint:** PLATFORM-02.1  
**Status:** OFICIAL  
**Data:** 2026-07-17

Fonte de verdade por domínio. Novos módulos **não** criam SSOT paralelo.

---

## Tabela oficial

| Domínio | SSOT | Artefato / pacote |
|---------|------|-------------------|
| Estoque | Motor Estoque | `backend/motores/motor-estoque/` |
| Conversões | MCC | `backend/motores/motor-conversao-comercial/` |
| Crédito Comercial | Motor Comercial | `backend/motores/motor-comercial/` |
| Consignação | Motor Comercial | `backend/motores/motor-comercial/` |
| Fiscal | Motor Fiscal | `backend/services/fiscal/` (+ snapshot MCC FIS-01) |
| Financeiro | Motor Financeiro Enterprise (MFE) | Arquitetura MFE — `MFE_03_MODELO_FINANCEIRO.md` · `ADR_MODELO_FINANCEIRO.md` · `MFE_VISAO_ENTERPRISE.md` · `ADR_MOTOR_FINANCEIRO.md` |
| Produtos | Cadastro de Produtos | `produtos` / rotas produtos |
| Clientes | Cadastro de Clientes | `clientes` |
| Fornecedores | Cadastro de Fornecedores | `fornecedores` |
| Unidades Comerciais | UC-01 | `backend/motores/unidades-comercializacao/` |

---

## Implicações

| Se precisar de… | Consulte / chame |
|-----------------|------------------|
| Quantidade base a partir de UC | MCC (`Converter` / orchestrator) |
| Movimentar / consultar saldo | Motor Estoque |
| Entregar / prestar consignação | Motor Comercial (+ MCC + Estoque) |
| Emitir NFC-e / NF-e | Motor Fiscal (snapshot da venda) |
| Unidade comercial do produto | UC-01 |
| Fator físico do lote | MCC (`ConversaoFisicaLote` versão ativa) |

---

## Anti-padrões

- Recalcular fator no PDV, Fiscal ou Estoque  
- Manter saldo por “pote / caixa” no estoque  
- Criar segundo conversor “temporário”  
- Usar MUC / `motorConversaoUnidades` em **novo** código (legado inventariado)
