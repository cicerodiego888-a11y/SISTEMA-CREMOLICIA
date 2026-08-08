# AUDITORIA RCF-09.1 — Certificação do Comprovante Remontado

Data: 2026-07-31  
Prioridade: CRÍTICA (Pré GO-LIVE)  
Status: **CERTIFICADO**

---

## 1. Veredito

O `ComprovanteRemontadoService` representa fielmente a **venda original** e a **NFC-e autorizada**, sem alterar qualquer dado fiscal autorizado.

| Critério | Resultado |
|----------|-----------|
| XML nunca modificado após autorização | ✅ |
| Comprovante = venda completa | ✅ |
| Cabeçalho fiscal = NFC-e autorizada | ✅ |
| Produtos/pagamentos = persistidos | ✅ |
| Reimpressão idêntica | ✅ |
| Testes automatizados | ✅ `rcf09_1-certificacao-comprovante.test.js` |

---

## 2. Integridade do XML

Validado em `extrairMetadadosNfceAutorizada` / `certificarComprovanteRemontado` / `gerarComprovanteRemontado`:

| Campo | Fonte | Garantia |
|-------|-------|----------|
| Hash SHA-256 | `xml_enviado` | Calculado antes/depois; aborta se divergir |
| Assinatura | `<Signature>` / `<ds:Signature>` | Detectada (`assinaturaPresente`) — somente leitura |
| Chave | `chave_acesso` / `chNFe` / `Id="NFe…"` | Espelhada no comprovante |
| Número / Série | nota + XML (`nNF`, `serie`) | Espelhados |
| QR Code | `qr_code_url` | Exibido; URL nunca reescrita no XML |
| Protocolo | nota / `nProt` | Espelhado |

O XML **não é reescrito**: snapshot string + comparação de hash após a montagem.

---

## 3. Integridade do Comprovante

| Bloco | Fonte |
|-------|-------|
| Cabeçalho fiscal | XML / nota autorizada |
| Produtos | `vendas_itens` (+ kits / casquinha / UC) |
| Pagamentos | `venda_recebimentos` / `venda_pagamentos` |
| Total | `vendas.total` |
| Desconto / Acréscimo / Troco | `vendas.*` |

**Regra crítica:** quantidade de itens no comprovante = quantidade em `vendas_itens`, **nunca** quantidade de `<det>` do XML (venda mista).

---

## 4. Casos certificados (automatizados)

| Caso | Status |
|------|--------|
| Venda 100% Fiscal | ✅ |
| Venda 100% Não Fiscal | ✅ |
| Venda Mista (itens ≠ dets XML) | ✅ |
| Desconto | ✅ |
| Acréscimo | ✅ |
| Troco | ✅ |
| PIX + Dinheiro | ✅ |
| Cartão + Dinheiro | ✅ |
| Cancelamento (histórico + XML autorizado) | ✅ |
| Reimpressão idêntica | ✅ |
| Kits | ✅ |
| Casquinha (+ sabores) | ✅ |
| Venda por Peso | ✅ |
| Múltiplas unidades comerciais | ✅ |
| Sem vazamento F×NF / MIDP | ✅ |

---

## 5. Funções de certificação

- `hashXmlSha256(xml)`
- `conteudoCanonicoComprovante(html)` — compara reimpressões ignorando bytes do QR data-URL
- `certificarComprovanteRemontado({ venda, itens, pagamentos, nota, xmlAutorizado })`

---

## 6. Teste

```bash
node backend/services/fiscal/tests/rcf09_1-certificacao-comprovante.test.js
```

Saída esperada: `RCF-09.1 OK — certificação ComprovanteRemontadoService aprovada`

---

## 7. Critérios de aceitação

- [x] XML nunca é modificado após autorização
- [x] Comprovante sempre representa a venda completa
- [x] Cabeçalho fiscal corresponde à NFC-e autorizada
- [x] Produtos e pagamentos coincidem com a venda persistida
- [x] Reimpressão gera exatamente o mesmo comprovante (canônico)
- [x] Testes automatizados aprovados
- [x] Certificação final do ComprovanteRemontadoService concluída

---

## 8. Observação GO-LIVE

Certificação de **serviço** concluída. Homologação operacional SEFAZ (venda real pós-restart) permanece no checklist RCF-07.2 / GO-LIVE do operador.
