# RCM-8.8 — Adequação do Motor MUC à Arquitetura Comercial

| Campo | Valor |
|---|---|
| Sprint | RCM-8.8 |
| Data | 2026-08-07 |
| Natureza | Adequação · conversão UC → base |

---

## Regra oficial

| Entidade | Responsabilidade |
|---|---|
| **Produto** | Apenas **Unidade Base** (estoque) |
| **Tabela de Preços** | Define a **Unidade Comercial** |
| **MUC** | Converte UC → Base quando necessário |

Não se exige que a Unidade Comercial da Tabela esteja pré-cadastrada no Produto.

---

## Fluxo

```text
Tabela → Unidade Comercial
  ↓
igual à Unidade Base?
  SIM → movimenta estoque
  NÃO → existe conversão MUC?
          SIM → converter → movimentar estoque
          NÃO → "Conversão entre LT e KG não cadastrada."
```

Mensagem **proibida**: `Unidade comercial não cadastrada para o produto.`

---

## Implementação

| Peça | Papel |
|---|---|
| `muc/converters/ConversorUnidades.js` | `resolverFatorConversao` (dimensões MASS/VOL/LEN/CNT) |
| `resolverUnidadeComercialOficial.js` | Ordem: identidade → catálogo opcional produto → MUC SI → erro oficial |
| `ConversaoNaoCadastradaError` | Código `MCC_CONVERSAO_NAO_CADASTRADA` |
| Orchestrators PDV / Comercial / Estoque / Compra | Usam o resolvedor oficial; canal só restringe se houver linha no produto |

Catálogo UC no produto permanece **opcional** para fatores customizados (ex.: CX=12). Deixa de ser gate de “permissão de venda”.

---

## Critérios

- [x] Produto pode ter apenas Unidade Base
- [x] Tabela define qualquer UC válida (com conversão MUC ou identidade)
- [x] MUC converte quando necessário
- [x] Erro reflete ausência de conversão, não ausência de cadastro de unidade

## Teste

```bash
node backend/motores/motor-conversao-comercial/tests/rcm88-muc-arquitetura.test.js
```
