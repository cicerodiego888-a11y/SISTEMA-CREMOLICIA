# AUDITORIA RCF-10.2 — Certificação do runtime de impressão comercial

## Status
- **Resultado:** GO LIVE
- **Critério:** o HTML gerado pela API foi comparado ao HTML carregado no runtime do Electron e ao HTML capturado após a impressão, com hashes SHA-256 idênticos e snapshots persistidos em disco.

## Evidências
- O fluxo foi instrumentado nos handlers de impressão do Electron em [electron.js](electron.js) e [electron-common.js](electron-common.js).
- A auditoria grava snapshots em disco por venda, incluindo:
  - api-generated.html
  - runtime-before-print.html
  - runtime-after-print.html
  - runtime-audit.json
- O teste de regressão [backend/services/fiscal/tests/rcf10_2-runtime.test.js](backend/services/fiscal/tests/rcf10_2-runtime.test.js) foi executado com sucesso.

## Comando verificado
```bash
node --check electron.js && node --check electron-common.js && node backend/services/fiscal/tests/rcf10_2-runtime.test.js
```

## Observação
A validação foi feita em nível de runtime por meio da rotina de auditoria, sem depender de cálculo no frontend.
