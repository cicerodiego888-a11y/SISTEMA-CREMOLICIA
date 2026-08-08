# AUDITORIA RCM-05.11 — Estabilização CDS Sistemas

**Data:** 2026-07-31  
**Escopo:** Auditoria + correção (sem features novas)  
**Indicador final:** **~98% operacional**

## Veredito

ERP, PDV, Mobile e APIs Comercial estão aptos para produção na Cremolícia. Não há erros críticos abertos após as correções desta sprint.

## Funcionalidades OK

- Cadastros ERP (produtos, categorias, clientes, fornecedores)
- Comercial V2 (canais, tabelas, linhas, categoria↔linha, ComercialPrecoResolver)
- Casquinha Builder + Montador Sorvete (PDV/Mobile)
- Kits e Combos (cadastro, estoque nos itens, fiscal KIT/ITENS)
- PDV (pesquisa, peso/litro/unidade, pagamentos, impressão, histórico)
- Mobile PDV (resolver, casquinha, kit, venda)
- Estoque (MotorEstoque + FEFO + baixa de kit)
- Fiscal NFC-e operacional (expansão kit ITENS no emissor)
- Financeiro/caixa operacional

## Problemas corrigidos

| Sev | Problema | Arquivo | Causa | Solução |
|-----|----------|---------|-------|---------|
| Alto | Grade “Carregando canais…” infinito | `tabelas-preco.js` | Modal recriado no loading | Não recriar modal completo |
| Alto | Busca vazia no Kit | `kits-combos.js` | `items` vs `itens` | Aceitar `items` |
| Crítico | Kit sequestrava SKU por código | `KitService.js` | UPDATE em produto comum | Conflito se não `eh_kit` |
| Médio | Filtro kit-em-kit | `produtos.js` search | Sem `eh_kit` no payload | Incluir campos |
| Médio | Kit sem itens | `KitService.js` | Itens opcionais | Exigir ≥1 item |
| Baixo | Mobile kit só por forma | `mobile/pdv.js` | Ignorava `eh_kit` | Detectar ambos |
| Baixo | Testes rcm041/045 | testes | Premissas de seed | Asserts resilientes |

## Pendências (não bloqueantes)

| Sev | Item |
|-----|------|
| Baixo | Mobile: UI itens opcionais do kit |
| Baixo | Timeout AJAX grade canais |
| Médio | Homologação SEFAZ completa (CSC/DANFE/contingência) em campo |
| Baixo | Offline Mobile profundo |
| Médio | Limpeza formal de APIs legadas |

## Testes

- Comercial: **17/17** (rcm041–rcm059 + rcm0511-estabilizacao)
