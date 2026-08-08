# Mercadão da Economia - Sistema de Gestão

Sistema completo de gestão para supermercados e mercados.

## Manifesto da Plataforma CDS
O posicionamento institucional e filosófico da plataforma está formalizado em [CDS_PLATFORM_MANIFESTO.md](CDS_PLATFORM_MANIFESTO.md).

## Funcionalidades

### 📦 Produtos
- Cadastro, edição e exclusão de produtos
- Controle de estoque
- Alertas de estoque baixo
- Histórico de preços

### 👥 Clientes
- Cadastro completo de clientes
- Controle de crédito
- Histórico de compras

### 🛒 Compras
- Registro de compras por nota fiscal
- Controle de fornecedores
- Atualização automática de estoque
- Histórico de compras

### 💰 Vendas
- PDV (Ponto de Venda) completo
- Múltiplas formas de pagamento
- Descontos
- Impressão de cupom fiscal
- Controle de crédito para clientes
- Cancelamento de vendas

### 📊 Financeiro
- Controle de receitas e despesas
- Relatórios por período
- Saldo atualizado
- Categorização de movimentações

### ⚙️ Configurações
- Personalização do sistema
- Backup de dados
- Informações da empresa
- Políticas Comerciais (cadastro independente da Categoria — ver `ADR_A1_POLITICA_COMERCIAL.md`)

## Tecnologias Utilizadas

### Backend
- Node.js
- Express.js
- SQLite3
- REST API

### Frontend
- HTML5
- CSS3
- JavaScript (ES6+)
- Bootstrap 5
- jQuery
- Chart.js

## Pré-requisitos

- Node.js (versão 14 ou superior)
- NPM (Node Package Manager)

## Instalação

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/mercadao-da-economia.git
cd mercadao-da-economia

```
├── backend/
│   ├── banco/
│   │   └── mercadao.db
│   ├── rotas/
│   │   ├── produtos.js
│   │   ├── clientes.js
│   │   ├── compras.js
│   │   ├── vendas.js
│   │   ├── financeiro.js
│   │   └── configuracoes.js
│   ├── database.js
│   └── server.js
├── frontend/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js
│   │   ├── produtos.js
│   │   ├── clientes.js
│   │   ├── compras.js
│   │   ├── vendas.js
│   │   ├── financeiro.js
│   │   └── configuracoes.js
│   └── index.html
├── backups/
├── package.json
└── README.md
```
