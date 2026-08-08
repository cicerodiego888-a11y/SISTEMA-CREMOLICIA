# RCM-04.4 — Resumo Inteligente da Entrega + Motor de Comprovantes Comercial

**Status:** CONCLUÍDO  
**Prioridade:** P1  
**Data:** 2026-07-30  
**Dependência:** RCM-04.B  
**Arquitetura:** SSOT — um único Snapshot no backend

---

## Objetivo

Após concluir a entrega de consignação, Desktop e Mobile abrem o **mesmo** Comprovante Comercial Oficial gerado pelo **Motor de Comprovantes**. Nenhuma regra de negócio no frontend.

---

## Fluxo completo

```
Central Comercial → Preparar Entrega → Entrega
  → Motor de Comprovantes (snapshot)
  → Resumo Inteligente
  → Compartilhar (WhatsApp / Copiar / PDF / Imprimir)
  → Finalizar Atendimento
```

---

## Novo Motor de Comprovantes

Pasta: `backend/motores/comprovantes`

| Arquivo | Papel |
|---------|--------|
| `index.js` | Facade |
| `domain/enums.js` | Tipos (ENTREGA, PRESTACAO, VENDA…) + status crédito |
| `services/ComprovanteEntregaBuilder.js` | Monta snapshot (cards, indicadores, ações) |
| `services/TextoCompartilhavelBuilder.js` | Texto oficial único |
| `services/QrCodeBuilder.js` | QR + hash |
| `services/PdfComprovanteBuilder.js` | HTML + PDF base64 do snapshot |
| `services/ComprovanteAuditoria.js` | Auditoria de ações |
| `tests/rcm044.test.js` | Testes |

Arquitetura preparada para: Prestação, Venda, Pedido, Orçamento, Compra, Devolução.

---

## Arquivos criados

- Todo o motor acima
- `frontend/modules/motor-comercial/pages/ComprovanteEntrega/index.js` (+ styles)
- `frontend/apps/mobile/js/pages/comercial-comprovante.js`
- `RCM_04_4_MOTOR_COMPROVANTES_COMERCIAL.md`

## Arquivos alterados

- `ConsignacaoController.js` — `obterComprovante`, `registrarAcaoComprovante`
- `comercial.routes.js` — rotas do comprovante
- `MotorComercialApi.js` — client Desktop
- `EntregaConsignacao/index.js` — pós-entrega navega para comprovante
- `routes/index.js` + `bootstrap/index.js` — rota `/consignacoes/:id/comprovante`
- Mobile `comercial.js` / `app.js` — rota `#/comercial/:id/comprovante`
- `CHANGELOG.md`

---

## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| `GET` | `/api/comercial/consignacoes/:id/comprovante` | Snapshot oficial (+ auditoria visualização) |
| `POST` | `/api/comercial/consignacoes/:id/comprovante/acoes` | Auditoria: copiar, whatsapp, pdf, impressão, email, link |

### Payload

`id`, `numeroComprovante`, `tipo`, `versao`, `cabecalho`, `cards`, `indicadores`, `acoes`, `textoCompartilhavel`, `pdf`, `qrCode`, `assinatura: null`, `snapshot`

---

## Desktop

- Após entrega → `/consignacoes/:id/comprovante`
- Renderiza cards do snapshot
- Ações: WhatsApp, Copiar Resumo, PDF, Imprimir (+ email/link estrutura)
- Pós-ações: Nova Entrega, Voltar, Reimprimir, Compartilhar Novamente
- Copiar usa **somente** `textoCompartilhavel`

## Mobile

- Após entrega → `#/comercial/:id/comprovante`
- Mesmo endpoint / mesmo texto / mesmo PDF
- Offline: último snapshot em `sessionStorage`
- Após compartilhar: “Deseja finalizar este atendimento?”

---

## Regras respeitadas

- Inteligência só no backend
- Frontend não calcula saldo, indicadores, texto, PDF, QR, histórico
- Um snapshot alimenta Desktop, Mobile, PDF, WhatsApp, Copiar, Impressão

---

## Testes executados

```
node backend/motores/comprovantes/tests/rcm044.test.js
npm run build:motor-comercial
```

| Caso | Resultado |
|------|-----------|
| Status VERDE/AMARELO/VERMELHO | OK |
| Texto compartilhável | OK |
| QR + hash | OK |
| PDF/HTML do snapshot | OK |
| Texto estável | OK |
| Enums preparados | OK |

---

## Pendências RCM-04.5 (Assinatura Digital)

- Preencher `assinatura` (hoje `null`)
- Captura de assinatura Desktop/Mobile
- Validação de QR / hash em portal público
- Email e link compartilhável (estrutura já no card)
- Anexar PDF nativo no WhatsApp (depende do Web Share + arquivo)
- Comprovante de Prestação / Venda no mesmo motor
