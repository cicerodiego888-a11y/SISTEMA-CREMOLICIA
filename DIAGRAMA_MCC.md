# DIAGRAMA — Motor de Conversão Comercial (MCC-01)

## Fluxo oficial

```mermaid
flowchart TD
  A[Produto] --> B[Quantidade]
  B --> C[Unidade Comercial]
  C --> D[Contexto]
  D --> E{Converter MCC}
  E --> F[Quantidade Convertida]
  F --> G[Unidade Base SSOT]
  E --> H[Auditoria em memória]
  E --> I[Precisão preparada]
  E --> J[Cache por operação]
```

## Tipos e serviços

```mermaid
flowchart LR
  MCC[ConversaoComercialService]
  MCC --> PAD[PADRAO]
  MCC --> AGR[ConversaoAgrupamentoService]
  MCC --> FRA[ConversaoFracionamentoService]
  MCC --> FIS[ConversaoFisicaService stub]
  MCC --> COM[ConversaoCompostaService]
  COM --> AGR
  COM --> FRA
  COM --> FIS
```

## Conversão composta (arquitetura)

```
Caixa ──AGRUPAMENTO──► Litro ──CONVERSAO_FISICA──► Kg
                              (ainda não implementada)
```

MCC-01 executa elos comerciais da cadeia; elos físicos retornam status `PENDENTE_ARQUITETURA` / HTTP lógico 501.

## Princípio da plataforma

```
Produto
  └── Unidade Base (SSOT)
  └── Unidades de Comercialização (UC-01)  × N
  └── Motor de Conversão Comercial (MCC)   × 1
```

## Fronteira desta sprint

```mermaid
flowchart TB
  subgraph MCC01[MCC-01 Entregue]
    Svc[Serviços + Converter]
    Tests[Testes]
    Docs[ADR / Arquitetura]
  end

  subgraph Fora[Fora de escopo]
    Compra
    Estoque
    PDV
    Fiscal
    API[APIs HTTP]
    Persist[Persistência auditoria]
  end

  MCC01 -.->|futuro| Fora
```
