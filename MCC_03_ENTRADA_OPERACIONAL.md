# MCC-03 — Integração Operacional do MCC na Entrada de Mercadorias

**Código:** MCC-03  
**Prioridade:** P0  
**Status:** IMPLEMENTADO  
**Versão motor:** 1.4.0-mcc03

---

## Objetivo

Conectar oficialmente o Motor de Conversão Comercial (MCC) ao fluxo operacional da Entrada de Mercadorias.

Após esta sprint, **toda** entrada de produtos com Unidades de Comercialização utiliza o MCC.  
Nenhuma conversão de quantidade ocorre fora do MCC.

---

## Arquitetura oficial

```
Compra
  ↓
Entrada de Mercadorias
  ↓
EntradaMercadoriasOperacionalService
  ↓
CompraConversaoOrchestrator   ← única ponte autorizada
  ↓
Motor de Conversão Comercial
  ↓
ConversaoFisicaLote (quando existir)
  ↓
Quantidade Base
  ↓
Estoque (unidade base SSOT)
```

**Regra:** nenhuma rota chama `Converter` / `CalcularConversaoFisica` diretamente.  
Toda integração passa pelo Orchestrator (via serviço operacional).

---

## Camada

```
backend/motores/motor-conversao-comercial/integracao/compra/
├── CompraConversaoOrchestrator.js      (MCI-01)
├── ModoEntradaConversao.js
└── EntradaMercadoriasOperacionalService.js   (MCC-03)
```

Integração HTTP: `backend/rotas/compras.js` → `entradaMcc.processarItemOperacional(...)`.

---

## Modos de entrada

### Modo 1 — Peso por embalagem

| Campo | Exemplo |
|-------|---------|
| Quantidade | 20 |
| Unidade | Caixa 5L (CX) |
| Peso da caixa | 3,375 Kg |

→ Estoque base `100 L` · Fator `0,675` no lote

### Modo 2 — Peso total

| Campo | Exemplo |
|-------|---------|
| Volume total | 100 Litros |
| Peso total | 67,500 Kg |

→ Fator `0,675` · Estoque base `100 L`

**Nunca** solicitar ao operador: `1 Litro = XXX Kg`.

---

## Fluxos

### Produto sem Conversão Física

```
Quantidade → Unidade Comercial → Orchestrator → MCC → Estoque Base
```

### Produto com Conversão Física

```
Produto → utiliza_conversao_fisica
  → obrigatório: peso da embalagem OU peso total
  → MCC calcula fator
  → cria ConversaoFisicaLote (v1 ativa)
  → baixa / entrada em Unidade Base
```

---

## Estoque

- Persistir **sempre** quantidade na unidade base
- **Nunca** criar estoque por Unidade Comercial
- Um Produto → Uma Unidade Base (SSOT)

---

## Lotes

- `ConversaoFisicaLote` criado automaticamente quando o produto utiliza Conversão Física
- Lote físico (`produtos_lotes`) também quando `controlar_validade` ou física
- Produtos comuns continuam sem lote físico

**Origem única:** a Entrada de Mercadorias é o único módulo autorizado a criar Conversões Físicas por Lote.

---

## Auditoria

Registrado por item:

- Produto · Compra · Fornecedor · Lote
- Quantidade informada · Peso informado · Fator calculado
- Quantidade convertida · Timestamp · Motor

Ação: `MCC_ENTRADA_CONVERSAO` (módulo `compras`).

---

## Legado removido da Entrada

Conversão de quantidade **não** usa mais:

- `motorConversaoUnidades.resolverQuantidadesEstoqueCompraItem`
- `obterTotalConvertidoItemCompra`
- cálculos próprios de embalagem × por embalagem no backend de compras

Compatibilidade: produtos antigos fracionados sem UC são mapeados para UC sintética `EMB` e passam pelo MCC.

---

## Fora de escopo

PDV · Comercial · Fiscal (regras) · Financeiro · MUC Conversor

---

## Testes

```bash
npm run test:mcc03
npm run test:mcc:all
```

Cenários: produto comum, caixa (UC), sorvete, dois lotes/fatores, sem peso, peso total, peso por embalagem, estoque base, gate anti-legado.
