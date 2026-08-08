# RCM-8.9 — Conversões Canônicas e do Produto (MUC)

| Campo | Valor |
|---|---|
| Sprint | RCM-8.9 |
| Data | 2026-08-07 |
| Natureza | Conversões permanentes · estoque |

---

## Regra

| Escopo | Onde vive |
|---|---|
| Unidade Base | Produto |
| Unidade Comercial | Tabela de Preços |
| Conversões universais | MUC (canônicas) |
| Conversões específicas | Produto (`produto_conversoes`) |
| Preço | **Independente** da conversão |

---

## Fluxo

```text
Tabela → UC
  ↓
Existe conversão no Produto? → SIM → converter → estoque
  ↓ NÃO
Conversão canônica MUC? → SIM → converter → estoque
  ↓ NÃO
Erro: "Conversão entre X e Y não cadastrada."
```

---

## Canônicas (nunca cadastrar)

- L ↔ ML  
- KG ↔ G  
- M ↔ CM  
- M² ↔ CM²  
- M³ ↔ CM³  

## Do produto (exemplos)

- Sorvete: LT → KG = 0,58  
- Queijo: PEÇA → KG = 2,45  
- Tijolo: UN → M² = 0,042  

---

## API

```
GET    /api/produtos/:id/conversoes
POST   /api/produtos/:id/conversoes
PUT    /api/produtos/:id/conversoes/:conversaoId
DELETE /api/produtos/:id/conversoes/:conversaoId
POST   /api/produtos/:id/conversoes/simular
```

Payload: `{ origem, destino, fator, tipo: "FIXA" }`  
Simular: `{ quantidade, origem, destino }`

## UI

Cadastro de Produto → card **Conversões** (domínio 3a)  
+ **Testar Conversão**

## Teste

```bash
node backend/motores/motor-conversao-comercial/tests/rcm89-conversoes-produto.test.js
```
