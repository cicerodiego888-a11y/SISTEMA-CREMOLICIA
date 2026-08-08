# RA-6.3 — Produto conhece apenas a Linha

## Decisão
Cadastro de Produto **não** escolhe Tabela de Preços.

```text
Produto → Linha de Precificação (+ Preço Base)
Tabela → escolhida pelo fluxo da venda (canal / PDV / Motor)
```

## Alteração
- Removido campo “Tabela de Preços” da UI do produto
- Payload oficial envia `tabela_preco_id: null`
- Coluna DB permanece só para compatibilidade interna
- Resolver / PDV / Consignação / Tabelas **não** alterados

Base: Auditoria RA-6.2 (parecer C).
