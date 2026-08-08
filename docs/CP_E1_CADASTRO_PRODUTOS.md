# CP-E1 — Consolidação Enterprise do Cadastro de Produtos

## Escopo
Hardening UX + eventos do cadastro de produtos.  
**Sem** alteração de Motor Comercial/Fiscal/Ledger/Outbox, Lista de Preços ou Linha de Precificação.

## Bug corrigido (Custo)
Causa: após reset/fechar modal, listeners ainda recalculavam custo e limpavam `preco_compra`, gerando validação indevida.

Correção:
- Flag `_cpe1SuspenderCalculosProduto` durante open/save/hide
- Cálculo de custo **somente** em alteração manual dos campos ou botão **Recalcular custo**
- Campos incompletos **não** zeram o Último Custo

## Domínios da tela
1. Identificação  
2. Comercial (+ Preço Base)  
3. Unidades / Formas de Venda  
4. Estoque  
5. Compras (Último Custo, apoio Valor Total / Quantidade, Fornecedor)  
6. Fiscal (collapse / lazy)  
7. Equipamentos (reserva visual)  
8. Inteligência (reserva visual)  
9. Histórico (somente leitura)

## Mensagens
Passam a indicar problema + causa + como resolver (ex.: custo unitário).
