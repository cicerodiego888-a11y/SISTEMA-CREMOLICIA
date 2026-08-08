# Modelo — Unidades de Comercialização (UC-01.1)

## Princípio

```
Produto
  └─ Unidade Base (SSOT)                    ← produtos.unidade + saldos
  └─ Unidades de Comercialização [N]        ← produto_unidades_comercializacao
        ├─ Tipo / Prioridade / Padrão
        ├─ Canais (compra, ERP, PDV, NF…)
        ├─ conversao_por_lote (flag UC-02)
        └─ Futuro: Compra → Venda → Conversão → Estoque Base
```

## Entidade `produto_unidades_comercializacao`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | INTEGER PK | |
| produto_id | INTEGER FK | |
| descricao | TEXT | Ex.: Caixa 5 Litros |
| tipo | TEXT | PADRAO \| AGRUPAMENTO \| FRACIONAMENTO \| CONVERSAO_FISICA |
| unidade_comercial | TEXT | CX, UN, L… |
| quantidade | REAL > 0 | Qtd em unidade base |
| unidade_base | TEXT | Espelho SSOT |
| prioridade | INTEGER ≥ 1 | Única no produto |
| unidade_padrao | 0/1 | No máximo uma |
| conversao_por_lote | 0/1 | Prep. UC-02 |
| canais_comercializacao | TEXT JSON | Ver canais |
| permite_compra / permite_venda / permite_pdv | 0/1 | Compat UC-01 (derivados dos canais) |
| ordem | INTEGER | |
| ativo | 0/1 | |

## Canais (`canais_comercializacao`)

```json
{
  "compra": 1,
  "venda_erp": 1,
  "venda_atacado": 1,
  "venda_varejo": 0,
  "pdv": 0,
  "nfce": 0,
  "nfe": 1,
  "comercial": 1,
  "orcamento": 0
}
```

## Tipos

| Tipo | Ícone | Uso |
|------|-------|-----|
| PADRAO | ⭐ | Unidade base (qtd=1; comercial = base) |
| AGRUPAMENTO | 📦 | Caixa → N bases |
| FRACIONAMENTO | ✂️ | Pote/Bobina → fração da base |
| CONVERSAO_FISICA | ⚖️ | Intenção L↔Kg (fator na compra) |

## Auditorias
- Sem duas prioridades iguais no produto
- Sem quantidade ≤ 0
- Comercial ≠ Base se Tipo ≠ PADRAO
- Ao definir padrão, a anterior é desmarcada

## Proibido
Estoques paralelos · Fator L=X Kg no cadastro do produto

## MUC legado
`produto_unidades` permanece para operação atual. UC-01.1 é o modelo oficial de cadastro.
