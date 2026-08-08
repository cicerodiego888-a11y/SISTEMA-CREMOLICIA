# CHECKLIST MCC — Homologação Enterprise

**Código:** MCC-HOM-01  
**Uso:** Gate de aceite CORE · revalidação em releases

---

## Arquitetura

- [x] MCC é motor CORE isolado
- [x] Interface oficial `Converter()` / `CalcularConversaoFisica()`
- [x] Sem dependência de Compras / Estoque / PDV / Fiscal / Comercial / MIIP
- [x] Sem dependência circular
- [x] Orchestrator de compra existe (MCI-01) sem movimentar estoque
- [x] Documentação ADR + diagramas + arquitetura geral atualizada

## Responsabilidades

- [x] Resolve conversões matemáticas (PADRAO / AGRUPAMENTO / FRACIONAMENTO)
- [x] Resolve conversão física por lote
- [x] Resolve conversão composta
- [x] Resolve versão ativa do lote
- [x] Gera auditoria em memória
- [x] **Não** move estoque
- [x] **Não** emite NF
- [x] **Não** salva compra operacional
- [x] **Não** gera financeiro / crédito

## Versionamento (MCC-02.1)

- [x] Campos versao / ativa / substitui_id / motivo / usuario_id
- [x] Uma versão ativa por lote
- [x] Correção cria nova versão
- [x] UPDATE de fator/quantidades bloqueado
- [x] DELETE bloqueado
- [x] MCC usa somente ativa

## Cache & Performance

- [x] Cache por operação (produto + lote + contexto + UC + qtd)
- [x] Stress 100k aprovado
- [x] Cache acelera / não corrompe resultado
- [x] Escalabilidade 50k (100 produtos / 10k lotes) aprovada

## Concorrência

- [x] Workers paralelos produzem resultado consistente
- [x] Caches de instâncias isolados

## APIs

- [x] Consultar conversão ativa
- [x] Consultar histórico
- [x] Criar nova versão
- [x] Criar versão inicial

## Testes

- [x] `test:mcc`
- [x] `test:mcc02`
- [x] `test:mcc021`
- [x] `test:mci01`
- [x] `test:mcc-hom`

## Gate de plataforma (obrigatório)

- [x] Legados inventariados (`motorConversaoUnidades`, MUC)
- [ ] Migrar Compras → MCC *(próxima sprint operacional)*
- [ ] Migrar Estoque → MCC
- [ ] Migrar PDV → MCC
- [ ] Migrar Fiscal → MCC
- [ ] Migrar Motor Comercial → MCC
- [x] Política: **proibir novas conversões fora do MCC**

---

## Assinatura de homologação

| Item | Valor |
|------|--------|
| Veredito | **APROVADO COMO CORE** |
| Data | 2026-07-17 |
| Evidência | `AUDITORIA_MCC.md` · `docs/archive/auditorias/mcc/AUDITORIA_MCC_ENTERPRISE.md` · `MCC_HOMOLOGACAO_FINAL.md` · `npm run test:mcc:all` |
