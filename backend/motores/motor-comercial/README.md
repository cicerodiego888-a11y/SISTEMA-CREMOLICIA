# Motor Comercial

**Módulo:** Domínio comercial da Plataforma CDS  
**Versão:** `O-13-homologacao`  
**API:** `/api/v1/comercial`

## Precificação (cadastros comerciais)

Categoria e **Política Comercial** são conceitos independentes (Sprint A-1).  
O Motor Comercial operacional não cria política a partir de categoria.  
Ver `ADR_A1_POLITICA_COMERCIAL.md` e `docs/A1_POLITICA_COMERCIAL.md`.

## Objetivo

Motor de domínio para operações comerciais:

- Perfil Comercial e limite de crédito
- Consignação (cadastro, entrega, devolução, transferência)
- Prestação de contas (venda, perda, cortesia, pagamento)
- Projeções read-only (dashboard, conta corrente, timeline, insights)
- Camada operacional (pendências, recomendações, playbooks, workflow)

## Padrão arquitetural

```text
HTTP → controllers → usecases → domain/services → repositories/bridges
```

| Camada | Regra |
|--------|-------|
| `controllers/` | Adaptação HTTP; sem regra de negócio |
| `usecases/` | Orquestração de operações |
| `domain/` | Linguagem e erros de domínio |
| `repositories/` | Persistência SQLite |
| `bridges/` | Único ponto para módulos externos |
| `services/projections/` | Leitura derivada do ledger |

## Estrutura

```text
motores/motor-comercial/
├── index.js                 # Bootstrap: inicializar(), encerrar(), obterContainer()
├── controllers/
├── usecases/
│   ├── perfil/
│   └── consignacao/
├── domain/
├── repositories/
├── services/
│   ├── projections/
│   └── workflow/
├── bridges/
├── infrastructure/di/
├── routes/comercial.routes.js
├── migrations/
└── docs/
```

## Bootstrap

Registrado em `backend/server.js`:

```javascript
const motorComercial = require('./motores/motor-comercial');
await motorComercial.inicializar();
```

## Testes

```bash
npm run test:motor-comercial
```

Suites: Perfil (18), Consignação F1–F3 (42), Projections (12), Workflow (3), Bridges (5) — **80 testes**.

## Build frontend

```bash
npm run build:motor-comercial
```

Gera `frontend/modules/motor-comercial/motor-comercial.bundle.js`.

## Documentação

| Documento | Caminho |
|-----------|---------|
| API REST | `docs/API.md` |
| Hardening | `docs/API_HARDENING.md` |
| Bridges | `docs/BRIDGES.md` |
| Certificação Enterprise | `../../../docs/MOTOR_COMERCIAL_ENTERPRISE.md` |
| Checklist Enterprise | `../../../docs/ENTERPRISE_CHECKLIST.md` |
| Workflow Center | `../../../docs/WORKFLOW_CENTER.md` |
| Bridges / Homologação | `../../../docs/BRIDGES_HOMOLOGACAO.md` |

## Regras arquiteturais

- Sem acesso direto a módulos legados (usar `bridges/`).
- Use cases não executam SQL diretamente.
- Projection services são **read-only**.
- Domain não depende de Express ou SQLite.

## Homologação

Integração real com a Plataforma CDS na Sprint **O-13** — bridges consomem `clientes`, `produtos`, `ajusteEstoqueService`, `financeiro` e `usuarios` (sem mocks no fluxo principal).

Diagnóstico: `GET /api/v1/comercial/bridges/diagnostic`

### Reset operacional (limpar dados de teste)

Remove consignações, perfis, ledgers, financeiro/estoque gerados pelo motor e clientes de teste — **sem** apagar produtos, usuários, empresa ou configurações.

```bash
npm run reset:operacional
# ou, sem prompt:
node backend/scripts/reset-operacional.js --yes
```
