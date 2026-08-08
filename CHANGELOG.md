# CHANGELOG — Motor Comercial / CDS

## [RA-1.1] — 2026-08-05 — Tabela de Preço × Produto (sem depender de Política)

### Objetivo
Inverter a arquitetura de preço: Produto → Tabela → Canal → Preço. Política Comercial permanece apenas como compatibilidade.

### Entregas
- Migration `014_tabela_preco_produto_itens` (ADD)
- `TabelaPrecoProdutoRepository` / `TabelaPrecoProdutoService`
- `ComercialPrecoResolver` prioriza Tabela×Produto×Canal
- UX Nova Tabela: adicionar produtos (não políticas)
- Cadastro de produto: seleciona apenas Tabela de Preço
- Sync compat → `tabela_preco_valores` (canal)

### Não removido
`linhas_comerciais`, APIs legadas, regras fiscais/financeiras, Ledger/Outbox.

## [A-1] — 2026-08-05 — Desacoplamento Categoria × Política Comercial

### Objetivo
Eliminar criação automática Categoria → Linha/Política Comercial. Políticas passam a cadastro independente; produto suporta múltiplas políticas (N:N).

### Entregas
- Migration `013_politica_comercial_desacoplamento` (`produto_politicas_comerciais`)
- `ProdutoPoliticasComerciaisService` + espelhamento desativado em `CategoriaLinhaComercialService`
- `ComercialPrecoResolver` resolve por Política (sem create-on-miss via categoria)
- UX: Política Comercial; multi-select no produto; compat “sem política = todas”
- `ADR_A1_POLITICA_COMERCIAL.md` + testes `rcm056` atualizados

### Não alterado
Motor Fiscal/Não Fiscal, Ledger, Outbox, PDV core, Motor Comercial operacional, regras fiscais.

## [RCM-05.21] — 2026-07-31 — Auditoria: Tabela Comercial por Cliente

### Objetivo
Auditar arquitetura antes de implementar tabela de preços preferencial por cliente (Consignado/Atacado/Varejo).

### Conclusão
Arquitetura **aprovada**: preferência no cliente como 1º critério do Resolver; Motor/Linha/Canal intactos.

### Entregas
- `AUDITORIA_RCM_05_21.md`
- `rcm0521-tabela-cliente.test.js` (+ alias `rcm053-tabela-cliente.test.js`)

## [RCF-10.1] — 2026-07-31 — Layout oficial cupom comercial

### Objetivo
Padronizar o comprovante do cliente como cupom de supermercado (não DANFE).

### Entregas
- Layout RCF-10.1 em `ComprovanteComercialPosFiscalService`
- Cabeçalho pela configuração fiscal; data pela autorização NFC-e
- Negrito em títulos; alinhamento pontilhado; tipografia Consolas/Courier
- Sem DANFE / tributos / labels F×NF

### Testes / Docs
- `rcf10_1-layout-cupom.test.js`
- `AUDITORIA_RCF_10_1.md`

## [RCF-10] — 2026-07-31 — Comprovante comercial transparente pós-NFC-e

### Objetivo
Cliente recebe um único comprovante da venda completa; F×NF permanece interno; XML/DANFE 100% fiscais.

### Entregas
- `ComprovanteComercialPosFiscalService.js`
- Rota `GET /fiscal/comprovante-comercial/venda/:id` (+ alias remontado)
- PDV/reimpressão usam o serviço comercial (não DANFE ao cliente)
- Logs `[RCF-10]` de auditoria
- Sem ICMS/PIS/COFINS/rótulos F×NF no comprovante

### Testes / Docs
- `rcf10-comprovante-comercial.test.js`
- `rcf10-regressao.test.js`
- `AUDITORIA_RCF_10.md`

## [RCF-09.1] — 2026-07-31 — Certificação do comprovante remontado

### Objetivo
Certificar pré GO-LIVE que o comprovante remontado espelha a venda completa e a NFC-e autorizada, com XML imutável.

### Entregas
- Hash SHA-256 + detecção de assinatura no XML (somente leitura)
- Troco / kits / casquinha / peso / UCs no bloco de itens
- `certificarComprovanteRemontado` + comparação canônica de reimpressão
- Suite `rcf09_1-certificacao-comprovante.test.js`
- `AUDITORIA_RCF_09_1.md`

## [RCF-09] — 2026-07-31 — Comprovante comercial remontado pós NFC-e

### Objetivo
Após autorização SEFAZ, imprimir comprovante da **venda completa** com cabeçalho/QR/chave da NFC-e, sem alterar o XML fiscal.

### Entregas
- `ComprovanteRemontadoService.js`
- Rota `GET /fiscal/comprovante-remontado/venda/:id`
- PDV imprime remontado após autorização
- Reimpressão histórica usa remontado quando há NFC-e
- Removido split Fiscal/Não Fiscal do comprovante ao cliente

### Testes / Docs
- `rcf09-comprovante-remontado.test.js`
- `AUDITORIA_RCF_09.md`

## [RCF-08] — 2026-07-31 — Validação XML pelo valor fiscal (F×NF)

### Problema
`validarConsistenciaVendaXml` comparava `vNF` com `venda.total` (geral), quebrando vendas mistas; DANFE podia exibir total/itens não fiscais.

### Correção
- Validação por `valor_fiscal` + soma itens fiscais
- DANFE só itens/pagamentos/total fiscal
- Comprovante comercial: Fiscal / Não Fiscal / Total
- Logs `[RCF-08]`

### Testes / Docs
- `backend/services/fiscal/tests/rcf08-fiscal-nao-fiscal.test.js`
- `AUDITORIA_RCF_08.md`

## [RCF-07.2] — 2026-07-31 — Homologação final GO-LIVE (fluxo fiscal)

### Entregas
- Validador pós-venda: `rcf07_2-homologacao-venda.js`
- Listagem NFC-e: `rcf07_2-listar-notas.js`
- Scripts npm: `test:rcf07`, `test:rcf072`
- `AUDITORIA_RCF_07_2.md` (checklist GO-LIVE)
- Evidência: venda 34 sem itens (regressão); venda 19/#2008 íntegra no validador

### Pendência operacional
Emitir 1 NFC-e nova no PDV e validar com `node .../rcf07_2-homologacao-venda.js <vendaId>`.

## [RCF-07.1] — 2026-07-31 — Verificação final + suíte de regressão

### Objetivo
Validar a correção RCF-07 e impedir regressão de referência de arrays no fluxo fiscal.

### Entregas
- Auditoria de `.length = 0` / referências compartilhadas
- Testes: array-reference, persistência, integração, MIDP
- Runner `rcf07_1-suite.test.js` (+ amostragem comercial)
- Logs `[RCF-07.1]`
- `AUDITORIA_RCF_07_1.md`

## [RCF-07] — 2026-07-31 — Regressão MIDP zerava itens da venda

### Causa
`aplicarDecisaoMidpNosItens` devolvia a mesma referência do array; o clear `length = 0` + re-push apagava todos os itens antes do INSERT (caminho sem `itensAjuste`).

### Correção
- Sempre retornar cópia nova dos itens
- Guard se MIDP zerar itens
- Callback `function` no INSERT para `this.lastID` (kits/casquinha)
- Logs `[RCF-07]`

### Docs / Testes
- `AUDITORIA_RCF_07.md`
- `backend/services/fiscal/tests/rcf07-regressao-midp-itens.test.js`

## [RCF-06] — 2026-07-31 — Carregamento da venda para emissão fiscal

### Problema
Emissão com `qtd_itens = 0` e DANFE de outra venda (ex.: pediu 34, serviu 19/#2008).

### Correção
- Abort duro se venda sem itens (`assertVendaComItens`)
- `carregarVenda` com LEFT JOIN + contagem em `vendas_itens`
- DANFE sempre amarrado a `venda_id` (impressão via `/danfe/venda/:id`)
- Bloqueio de persistência de venda sem itens
- Logs `[RCF-06]`

### Docs / Testes
- `AUDITORIA_RCF_06.md`
- `backend/services/fiscal/tests/rcf06-carregar-venda.test.js`

## [RCF-02] — 2026-07-31 — Auditoria crítica fluxo NFC-e (venda_id)

### Problema
XML/DANFE coerentes entre si, mas de venda diferente da recém-finalizada.

### Correção
- `salvarNota` deixa de atualizar por `chave_acesso` global (amarrado a `venda_id`)
- DANFE só autorizada; suporte a `notaId`
- PDV imprime com `notaId` da emissão
- Validação Venda×XML + logs `[RCF-02]`
- Numeração NFC-e com `BEGIN IMMEDIATE`

### Docs / Testes
- `AUDITORIA_RCF_02.md`
- `backend/services/fiscal/tests/rcf02-fluxo-nfce.test.js`

## [RCM-05.16] — 2026-07-31 — Seletor inteligente de Linhas Comerciais

### Objetivo
Substituir checkboxes por pesquisa + chips no cadastro de Tabelas de Preço — **somente UX**.

### Comportamento
- Campo de pesquisa (código / nome / descrição) com ranking
- Clique adiciona a Linha como chip e gera a grade automaticamente
- Campo limpa e o cursor permanece na pesquisa
- Remoção pelo ✕ do chip (confirma se houver preço digitado)
- Teclado: Enter, Esc, Backspace

### Testes
- `backend/modules/comercial/tests/rcm0516-seletor-linhas.test.js`

## [RCM-05.15] — 2026-07-31 — Arquitetura Tabelas de Preço × Linha Comercial

### Objetivo
Alinhar Tabelas de Preço à arquitetura oficial do Motor Comercial V2 (pré-homologação Cremolícia).

### Correções
- Vínculo N:N `tabela_preco_linhas` + `tabela_preco_valores.linha_comercial_id`
- Migração `012` com backfill a partir de produtos (sem perda de preços)
- ERP: seleção de Linhas Comerciais; grade Linha × Canal com herança de Forma/Unidade
- Ao salvar, sincroniza `linha_comercial_valores` (SSOT do ComercialPrecoResolver)
- Relatório: `AUDITORIA_RCM_05_15.md`

### Testes
- `backend/modules/comercial/tests/rcm0515-tabela-preco-arquitetura.test.js`

## [RCM-05.14] — 2026-07-31 — Novo fluxo de adição de produtos (PDV Mobile V2)

### Objetivo
Bottom Sheet único para adicionar produtos no CDS Mobile — **somente UX**, sem alterar regras do Motor Comercial / Resolver.

### Comportamento
- Removido o botão **+** da lista de pesquisa
- Toque no produto abre Bottom Sheet (~60–70% da tela)
- Quantidade via **− / +** ou digitação no campo numérico
- Formas: Unidade, Peso, Volume, Casquinha (Montar → Builder → Resumo), Kit
- Após adicionar: sheet fecha, pesquisa **permanece**, foco volta ao campo
- Animação: abrir 180ms · fechar 150ms

### Testes
- `backend/modules/comercial/tests/rcm0514-mobile-bottom-sheet.test.js`

## [RCM-05.13] — 2026-07-31 — UX PDV Mobile (Resumo da Venda Retrátil)

### Objetivo
Liberar área útil no PDV Mobile — **somente UX**, sem alterar regras, APIs ou cálculo.

### Comportamento
- Resumo financeiro inicia **recolhido** (~70–90px)
- Barra fixa: **TOTAL** + **Finalizar** + Expandir
- Expandido: Subtotal, Desconto, Acréscimo, Desc/Acr, Finalizar, Recolher
- Após adicionar produto, o resumo **recolhe automaticamente**
- Animação expandir/recolher **200ms**

### Testes
- `backend/modules/comercial/tests/rcm0513-mobile-resumo-retratil.test.js`

## [RCM-05.12] — 2026-07-31 — Refinamento UX do PDV (Canal + Grade)

### Objetivo
Interface do PDV mais limpa e focada no caixa — **sem alterar regras de negócio**.

### Canal de Venda
- Indicador **compacto** (sem card/borda/sombra)
- Barra de progresso **3px**, destaque só ao atingir o limite
- Seletor discreto `Auto | Evento`
- Cores: Varejo 🟢 · Atacado 🔵 · Evento 🟠

### Grade de Itens
- **Unitário somente leitura** (`R$ x,xx / UN|KG|L`)
- Alteração de preço via link **Alterar** + autorização de supervisor
- **Total** com maior destaque tipográfico

### Testes
- `backend/modules/comercial/tests/rcm0512-pdv-ux.test.js`

## [RCM-05.11] — 2026-07-31 — Auditoria Geral e Estabilização

### Objetivo
Auditoria e correção (sem features novas): eliminar regressões críticas do Comercial V2 / Kits e estabilizar a suíte de testes.

### Problemas corrigidos
- ERP Tabelas de Preço: grade presa em “Carregando canais…” (recriação do modal Bootstrap)
- ERP Kits: busca de produtos lia `itens`/`produtos` — API LIP retorna `items`
- Kits: sincronização por código não pode sequestrar produto comum (`eh_kit` / conflito)
- Kits: criação exige ao menos 1 item
- `/produtos/search`: passa `eh_kit` e `forma_comercializacao` para filtros do ERP
- Mobile: detecta kit também por `eh_kit`
- Testes `rcm041` / `rcm045` alinhados ao estado real do banco (grade multi-canal / config)

### Testes
- Suíte comercial: 16/16 + `rcm0511-estabilizacao.test.js`

## [RCM-05.9] — 2026-07-31 — Motor de Kits e Combos

### Objetivo
Módulo genérico de produtos compostos (kits/combos) reutilizável por qualquer segmento: cadastro, formação de preço, baixa de estoque nos itens, PDV/Mobile, histórico e fiscal configurável.

### Novidades
- Tabelas `kits`, `kit_itens`, `venda_item_kit_itens` + `produtos.eh_kit` / forma `KIT`
- `KitService`, `KitItemService`, `KitVendaService` + API `/api/kits`
- Formação de preço: **Soma dos itens** | **Preço Fixo**
- Estoque: baixa nos componentes (kit sem estoque próprio)
- Fiscal: emitir **Produto Kit** ou **Itens Separados**
- ERP: Comercial → **Kits e Combos**
- PDV/Mobile: seleção do kit com preview de itens (sem montagem)
- Histórico/comprovante com componentes do kit

### Testes
- `backend/modules/comercial/tests/rcm059-kits-combos.test.js`

## [RCM-05.8] — 2026-07-31 — Montador de Casquinha (Builder V2)

### Objetivo
Casquinha como Forma Comercial especializada: o PDV só monta (bolas × sabores); preço/canal/forma vêm do `ComercialPrecoResolver`.

### Novidades
- `CasquinhaBuilderService` — validação de montagem (limite bolas, repetição)
- Sabores: código, descrição, cor, ativo (+ tela ERP **Sabores**)
- Categoria: `casquinha_bolas_min/max` + `casquinha_permitir_repetir`
- PDV: resumo + validação via API antes de adicionar
- Mobile: fluxo casquinha (bolas + sabores)
- Histórico/impressão com bolas e sabores

### Testes
- `backend/modules/comercial/tests/rcm058-casquinha-builder.test.js`

## [RCM-05.7] — 2026-07-31 — Montador de Sorvete (Varejo × Atacado × Evento)

### Objetivo
Operacionalizar no PDV as regras comerciais já existentes: o canal define automaticamente forma, unidade e preço via `ComercialPrecoResolver` — sem escolha manual do operador.

### Fluxos
- **Varejo** → PESO / KG → modal “Venda por Peso”
- **Atacado** → VOLUME / L → modal “Venda por Litros”
- **Evento** → configuração da Categoria/Linha (tipicamente VOLUME)

### Persistência / Auditoria
- `vendas_itens.forma_comercializacao`
- Mantém `unidade_comercial`, `canal_venda` (cabeçalho), quantidade e preços

### UX
- PDV: prioriza forma do Resolver antes de UC-01 / modo Peso×Unidade
- Histórico: Canal + Forma + Qtd com unidade + preço/unidade
- Comprovante: `2,350 KG` / `59,90/KG` ou `5 L` / `30,00/L`
- Mobile: mesmo fluxo (resolver + prompt de quantidade)

### Testes
- `backend/modules/comercial/tests/rcm057-montador-sorvete.test.js`

## [RCM-05.6] — 2026-07-31 — Sincronização Categoria × Linha Comercial

### Objetivo
Eliminar cadastro duplicado: o usuário opera **Categorias**; o Motor Comercial mantém **Linha Comercial** 1:1 automática.

### Fluxo
Categoria → Linha Comercial → Canal → Forma → Unidade → Preço  
(`ComercialPrecoResolver` resolve via categoria quando o produto não tem linha explícita)

### Banco
- `categorias.linha_comercial_id`
- `categorias.codigo`
- `linhas_comerciais.categoria_origem_id` (UNIQUE parcial)
- Migration `008_categoria_linha_comercial` + relatório

### Serviço
- `CategoriaLinhaComercialService` — criar / atualizar / desativar / diagnosticar / corrigir

### ERP
- Aba **Comercial** no cadastro de Categoria (grade Canal × Forma × Unidade × Preço)
- Produto: Linha herdada da Categoria (sem seleção manual)
- Diagnóstico Comercial: consistência + **Corrigir automaticamente**
- Menu Linhas Comerciais permanece para manutenção técnica

### Testes
- `backend/modules/comercial/tests/rcm056-categoria-linha.test.js`

## [RCM-05.5] — 2026-07-31 — Linhas Comerciais (Núcleo de Precificação)

### Objetivo
Consolidar a **Linha Comercial** como núcleo oficial da precificação: vários produtos compartilham regras de preço, forma e unidade por canal.

### Fluxo de resolução (`ComercialPrecoResolver`)
Produto → Linha Comercial → Canal → Forma → Unidade → Preço  
Fallback: Tabela de Preço → `produto.preco_venda`

### Banco
- `linhas_comerciais` (codigo, descricao, ativo)
- `linha_comercial_valores` (canal × preço × forma × unidade)
- `produtos.linha_comercial_id`
- Seeds: PIC_ESP, PIC_COM, SORVETE, CASQUINHA
- Migração automática + log `linhas_comerciais_migracao_log`

### ERP
- Menu Configurações → Comercial → Linhas Comerciais
- Campo Linha Comercial no cadastro de produto

### PDV
- Sem alteração estrutural (consome apenas o resolver)

### Testes
- `backend/modules/comercial/tests/rcm055-linhas-comerciais.test.js`

## [RCM-05.4] — 2026-07-31 — Montador de Casquinha

### Objetivo
Produto composto CASQUINHA: operador monta bolas + sabores antes de adicionar ao cupom. Preço continua exclusivo via `ComercialPrecoResolver`.

### Cadastro
- `bolas_min` / `bolas_max` no produto (parametrizável)
- Catálogo `casquinha_sabores` (seed: Chocolate, Morango, Coco, Flocos, Abacaxi, Goiaba, Creme)

### PDV
- Abre Montador automaticamente para forma CASQUINHA
- Escolha de bolas + sabores (repetição permitida)
- 1 item no cupom; cancelar não adiciona

### Persistência / Cupom
- `vendas_itens.quantidade_bolas`
- `venda_item_sabores` (relacionamento)
- Impressão comercial lista sabores (NFC-e inalterada)

### Testes
- `backend/modules/comercial/tests/rcm054-montador-casquinha.test.js`

## [RCM-05.3] — 2026-07-30 — Gerenciador de Canais de Venda

### Objetivo
Canal dinâmico da venda (VAREJO / ATACADO / EVENTO) com preços exclusivos via `ComercialPrecoResolver` — sem desconto percentual de canal.

### Regras
- Venda inicia em **VAREJO**
- **ATACADO** automático ao atingir quantidade mínima de itens elegíveis (`participa_atacado`)
- **EVENTO** manual por operador autorizado (supervisor)
- Recálculo de preços unitários/subtotal/total ao mudar o canal

### Persistência
- `produtos.participa_atacado` (DEFAULT 1 — compatibilidade)
- `vendas.canal_venda` no cabeçalho da venda

### UX
- PDV: indicador de canal + botões Auto / Evento
- Cadastro produto: Participa do Atacado (Sim/Não)
- Configuração: quantidade mínima (já existente)

### Testes
- `backend/modules/comercial/tests/rcm053-gerenciador-canais.test.js`

## [RCM-05.2] — 2026-07-30 — Auditoria Produto × Tabelas de Preço

### Objetivo
Diagnóstico arquitetural (somente leitura): um produto pode participar de várias Tabelas de Preço?

### Resultado
- **Não** — vínculo oficial é N:1 via `produtos.tabela_preco_id`
- Multi-canal (Varejo/Atacado/Evento) na **mesma** tabela: suportado
- Evolução N:N real: complexidade **Alta**

### Artefatos
- `AUDITORIA_RCM052_PRODUTO_TABELAS.md`
- Canvas: `rcm052-auditoria-produto-tabelas.canvas.tsx`

### Escopo
- Sem alteração de regra, banco, API ou telas

## [RCM-05.1] — 2026-07-30 — Comercialização por Canal (Kg × Litro)

### Objetivo
Mesmo produto, formas distintas por canal (ex.: VAREJO=Kg, ATACADO=Litro), sem duplicar cadastro nem estoque.

### Banco
- `tabela_preco_valores`: `forma_comercializacao`, `unidade_comercial` (nullable; NULL = herda do produto)

### Backend
- Grade/API de Tabelas de Preço grava Forma + Unidade + Preço por canal
- `ComercialPrecoResolver` retorna `preco`, `canal`, `formaComercializacao`, `unidadeComercial`
- Fallback: sem forma na tabela → forma/unidade do produto

### UX
- ERP: grade Canal | Forma | Unidade | Preço
- PDV: modal Peso / Litros conforme forma; preço exibido como `59,90 / Kg` ou `30,00 / Litro`
- Troca VAREJO ↔ ATACADO atualiza preço, forma e unidade automaticamente

### Testes
- `backend/modules/comercial/tests/rcm051-forma-por-canal.test.js`

## [RCM-04.8] — 2026-07-30 — Reorganização do Menu Comercial

### Objetivo
Eliminar duplicidade do menu “Comercial”: configuração sob **Configurações**, operação sob **Operações**.

### Menu
- Removido: Cadastros → Comercial (Canais / Tabelas / Diagnóstico)
- Configurações → Comercial:
  - Configuração Comercial (`venda-no-atacado`)
  - Canais de Venda
  - Tabelas de Preço
  - Diagnóstico Comercial
- Operações → Comercial: inalterado (Painel, Clientes, Entrega, etc.)

### UX
- Breadcrumbs: Configurações › Comercial › …
- Pesquisa de menu (sidebar) com caminho atualizado
- Favoritos/aliases: `configuracao-comercial` → `venda-no-atacado` (rotas preservadas)

### Compatibilidade
- Nenhuma rota/API/endpoint alterada

## [RCM-04.7] — 2026-07-30 — Experiência Comercial (Canal de Venda)

### Objetivo
UX do operador: canal visível, progresso até o atacado, feedback discreto na mudança — **sem alterar regras**.

### API
- `CanalVendaResolver` / `resolver-precos` passam a retornar:
  - `canal`, `nome`, `quantidadeAtual`, `quantidadeNecessaria`, `progresso`, `mostrar_progresso`

### Componente
- `frontend/shared/js/ComercialStatusCard.js` (PDV + Comercial + Mobile futuro)

### PDV
- Card no cabeçalho da venda
- Barra de progresso em tempo real (VAREJO + atacado habilitado)
- Toast discreto: “Venda alterada para ATACADO” / “Venda voltou para VAREJO”

### Comercial
- Mesmo `ComercialStatusCard` em Preparar Entrega

## [RCM-04.6] — 2026-07-30 — Consolidação Comercialização V2

### Objetivo
Única porta de precificação (`ComercialPrecoResolver`); remoção de leituras diretas de preços legados; diagnóstico e auditoria.

### Padronização
- Promoções, LIP frequentes, MUC, etiquetas, lotes e consignação passam pelo resolver
- Logs `[Comercial]` (Produto / Canal / Tabela / Preço / Origem)

### Diagnóstico
- API `GET /api/diagnostico-comercial`
- ERP: Cadastros → Comercial → Diagnóstico Comercial

### UX Produtos
- Com Tabela + preço de canal: oculta preços de venda legados
- Mensagem: “Preço controlado pela Tabela de Preço.”

### Qualidade
- Teste arquitetural anti-acesso direto (`rcm046-arch-preco-legado`)
- Testes funcionais (`rcm046-consolidacao`)
- Relatório: `AUDITORIA_RCM046_PRECOS.md`

## [RCM-04.5] — 2026-07-30 — Configuração Comercial + Venda no Atacado

### Objetivo
Seleção automática de canal (VAREJO/ATACADO) antes da consulta à Tabela de Preço, com configuração básica de Venda no Atacado.

### Banco
- Tabela `configuracao_comercial` + seed (atacado desabilitado, mín. 30, `TOTAL_VENDA`)

### Backend
- `ConfiguracaoComercialRepository` / `Service` / `Controller`
- APIs: `GET/PUT /api/configuracao-comercial`, `POST .../resolver-canal`, `POST .../resolver-precos`
- `CanalVendaResolver` (`TOTAL_VENDA`, `POR_PRODUTO`)
- `ComercialPrecoResolver` usa o canal resolvido (opts.itens ou canal explícito)

### ERP
- Configurações → Comercial → Venda no Atacado

### PDV / Comercial
- PDV: badge **Canal da Venda** + recálculo automático ao atingir a regra
- Comercial (consignação): mesmo `resolver-precos` / `CanalVendaResolver`
- Atacado desabilitado → sempre VAREJO (compatibilidade)

### Fora de escopo
- Valor mínimo, peso, categoria avançada, cliente, promoções, múltiplos canais

## [RCM-04.4-PRECO] — 2026-07-30 — Motor Comercial V2 (Tabela de Preço)

### Objetivo
`ComercialPrecoResolver` passa a consultar Tabela de Preço × canal **VAREJO**, com fallback em `preco_venda`.

### Resolver
- Fluxo: Produto → Tabela → Canal VAREJO → Preço
- Sem tabela / sem valor no canal → `produto.preco_venda` (fallback)
- Logs temporários `[Resolver]` (tabela ou fallback)
- Cache aquecido no bootstrap; invalidação ao salvar valores

### Integração
- APIs de produtos (normalização async), PDV operacional, gateway comercial, MUC, equipamentos
- UX: aviso “✓ Preço controlado pela Tabela de Preço”

### Fora de escopo
- Venda no Atacado / seleção dinâmica de canal (RCM-04.5)

## [RCM-04.3] — 2026-07-30 — Integração Produto × Tabela de Preço

### Objetivo
Card Comercialização V2 + `ComercialPrecoResolver` como ponto único de leitura de preço (ainda legado).

### Cadastro
- Card **Comercialização**: Unidade de Estoque + Forma (Unidade/Peso/Volume/Casquinha/Personalizada) + Tabela de Preço
- Campos dinâmicos por forma + validações (Casquinha / Peso-Volume)
- `tabela_preco_id` opcional (produtos existentes seguem salvando)
- Preços legados mantidos no card **Preços (legado)** — PDV/Comercial inalterados

### Backend
- Migration `002_forma_comercializacao`
- `ComercialPrecoResolver` (retorna `produto.preco_venda`, origem `produto.preco_venda`)
- Leituras centralizadas: `normalizarProdutoResposta`, ProdutoPlatformGateway, MUC, ProdutoMapper, PdvVendaOperacionalService

### Compatibilidade
- Nenhuma mudança de comportamento no PDV, Comercial, NFC-e ou pedidos

## [RCM-04.2] — 2026-07-30 — Cadastro Completo de Tabelas de Preço

### Objetivo
Cadastro funcional de Tabelas de Preço com grade Canal × Preço, sem alterar PDV/Comercial.

### Backend
- Salvar `tabelas_preco` + `tabela_preco_valores` em **transação única**
- Grade automática com todos os canais ativos (novos canais aparecem sem preço)
- Validações: nome obrigatório, nome único, preço ≥ 0, canais sem duplicidade
- Exclusão bloqueada se vinculada a produto (mensagem oficial) — permite **desativar**
- Endpoints: `GET /grade-nova`, `POST /:id/desativar`, busca `?q=`

### ERP
- Modal unificado: Dados Gerais + grade Canal | Preço
- Produto: autocomplete/pesquisa + botão [+] (modal sem sair da tela) + vínculo `tabela_preco_id`

### Compatibilidade
- Nenhuma regra de cálculo de preço do PDV/Comercial alterada

## [RCM-04.1-FUNDACAO] — 2026-07-30 — Fundação Comercial V2 (Canais + Tabelas de Preço)

### Objetivo
Infraestrutura de Comercialização V2 sem alterar regras atuais de preço do PDV/Comercial.

### Banco
- `canais_venda` (seed: VAREJO, ATACADO, EVENTO)
- `tabelas_preco`
- `tabela_preco_valores` (tabela × canal × preço)
- `produtos.tabela_preco_id` (campo opcional; preços legados preservados)

### Backend
- Módulo `backend/modules/comercial` (Repository / Service / Controller)
- APIs: `/api/canais-venda`, `/api/tabelas-preco`, `/api/tabelas-preco/:id/valores`

### ERP
- Menu Cadastros → Comercial → Canais de Venda / Tabelas de Preço
- Card Comercial do produto: seletor Tabela de Preço + atalho [+]

### Compatibilidade
- PDV e Motor Comercial continuam usando `preco_venda` / atacado / promoções
- Nenhuma regra de cálculo de preço foi alterada

## [RCM-04.4] — 2026-07-30 — Motor de Comprovantes + Resumo Inteligente da Entrega

### Adicionado
- Motor `backend/motores/comprovantes` (snapshot único SSOT)
- `GET /api/comercial/consignacoes/:id/comprovante` + auditoria de ações
- Desktop: página Resumo Inteligente pós-entrega
- Mobile: `#/comercial/:id/comprovante` (WhatsApp, copiar, PDF, offline)
- Doc `RCM_04_4_MOTOR_COMPROVANTES_COMERCIAL.md`

### Regras
- Texto/PDF/QR/indicadores somente no backend
- `assinatura: null` (RCM-04.5)

---

## [RCM-04.B] — 2026-07-30 — Paridade Desktop × Mobile e sincronização

### Corrigido
- Listagem com `clienteId`, `clienteNome`, `clienteDocumento`, `clienteFantasia`, `clienteTelefone`
- Busca por código, nome, CPF/CNPJ, telefone e observação
- RASCUNHO sem forçar R$ 0,00 (exibe — / Aguardando Entrega)
- Indicador visual de filtros ativos + Limpar Filtros
- Refresh da lista ao ganhar foco, Atualizar e retornar da edição
- Badges padronizados (RASCUNHO, PREPARAÇÃO, EM ENTREGA, ENTREGUE, PRESTAÇÃO PENDENTE, FINALIZADA, CANCELADA)

### Adicionado
- `GET /api/sistema/diagnostico` (instanceId, databaseHash, processId, startedAt, …)
- ERP: Ajuda → Diagnóstico da Instância + Copiar Diagnóstico
- Logs de operações com origem Desktop/Mobile
- Testes `rcm04b.test.js` + doc `RCM_04_B_PARIDADE_DESKTOP_MOBILE.md`

### Não implementado (RCM-04.C)
- WebSocket / SSE / SignalR / polling inteligente / push

---

## [RCM-04.A] — 2026-07-30 — Auditoria sincronização Mobile × ERP

### Documentação
- `AUDITORIA_RCM_04_A.md` — diagnóstico completo (sem alteração de código)
- Veredito: create Mobile grava no mesmo SQLite; sintoma ligado a listagem/filtros/UX/polling (e risco de DB duplicado)

---

## [RCM-04.1] — 2026-07-30 — Prestação de Contas Mobile + Rateio

### Adicionado (Mobile)
- Tela Prestação de Contas com cards recolhíveis (`#/comercial/prestacao` e `#/comercial/:id/prestacao`)
- Rateio das Perdas (Cliente / Empresa / Compartilhado) via APIs RC4.2
- Resumo Financeiro (venda, recebido, perdas, assume, líquido)
- Fila offline local + sincronização automática
- Grade de retornos movida para `#/comercial/:id/prestacao/grade`
- Doc `RCM_04_1.md`

### Não alterado
- Regras de negócio (permanecem no backend / Motor Comercial)

---

## [RC4.2] — 2026-07-30 — Rateio Inteligente de Perdas (Consignação)

### Adicionado
- Rateio de perdas na Prestação: Cliente / Empresa / Compartilhada (entrada em R$)
- Motivo obrigatório + observação quando Outro
- Resumo Financeiro estendido (cliente/empresa assume + líquido do consignado)
- Persistência `prestacao_rateio_perdas` + auditoria append-only
- Endpoints GET/PUT `.../prestacao/rateio-perda` e indicadores de projeção
- Doc `RC4_2_RATEIO_PERDAS.md`

### Não alterado
- Fluxo operacional da consignação (grade, venda, devolução, pagamento, NFC-e)

---

## [RCM-03] — 2026-07-30 — Paridade funcional CDS Mobile × ERP Desktop

### Adicionado / Completado (Mobile)
- Cliente Consignado / Cliente 360 — `#/comercial/clientes*`
- Compras multi-item + MCC + conferência + devolução
- Central de Entradas NF + MIIP — `#/central-entradas`
- Produtos: UC / MUC / promoções
- Fiscal: `#/fiscal/config` (CSC, série, ambiente, certificado)
- Config: MIDP / TEF / Licença
- Equipamentos + Relatórios
- PDV: devolução, cadastro rápido, consulta MUC

### Docs
- `RCM_03.md`
- `AUDITORIA_COBERTURA_MOBILE.md` reavaliada (~93% ponderada)

### Não alterado
- Regras de negócio / motores Backend · APIs oficiais reutilizadas

---

## [RC3.8D.4.0] — 2026-07-30 — Comprovante comercial de venda

### Adicionado
- `COMPROVANTE DE VENDA` — documento do cliente (qtd comercial, total da compra, formas de pagamento)
- `backend/services/comprovanteVendaService.js` + `GET /api/vendas/:id/comprovante`
- `frontend/shared/js/comprovanteVenda.js` — impressão pós-venda e reimpressão
- PDV imprime comprovante comercial; DANFE/NFC-e permanecem no fluxo fiscal

### Não alterado
- MIDP · Motor Fiscal · XML · DANFE · emissão NFC-e · persistência

---

## [MIDP-RC3.8D.3.5] — 2026-07-30 — Propagar saldos ao Motor Fiscal

### Corrigido
- `VendaPagamentoService`: `distribuicaoItens` agora inclui `saldo_fiscal` / `saldo_nao_fiscal` do `produtoMap`
- Caminhos: venda normal, `pularBaixaEstoque` e preview de distribuição

### Efeito
- `itemComSaldos()` passa a ser true → `possuiMargemFiscal` correto → MIDP PRESERVAR separa itens (ex.: 553 → qF=2 / qNF=1)

### Não alterado
- Motor Fiscal, MIDP/algoritmo, XML, DistribuidorPagamento, schema

---

## [DOCS] — 2026-07-30 — Consolidação de auditorias

### Alterado
- ~37 `AUDITORIA_*.md` na raiz → **6 consolidados** + `AUDITORIA_INDEX.md`
- Originais movidos para `docs/archive/auditorias/{mcc,mfe,ux-cadastro,pdv,midp}/`
- Duplicatas `AUDITORIA_STAB07_1…5` removidas da raiz (já existiam em `comercial/`)

### Índice
`AUDITORIA_MCC` · `AUDITORIA_MFE` · `AUDITORIA_UX_CADASTRO` · `AUDITORIA_PDV` · `AUDITORIA_STAB07` · `AUDITORIA_MIDP`

---

## [MIDP-3.8D.3.2] — 2026-07-30 — Simplificação da configuração MIDP

### Alterado
- UI Config. Avançadas: removida seleção LEGADO / PRESERVAR_DINHEIRO; apenas Ativado / Desativado
- Runtime: `midp_ativado=true` → sempre `PreservarDinheiroPolicy`; `false` → fluxo legado
- Persistência: `midp_politica` migrada de `LEGADO` → `PRESERVAR_DINHEIRO` ao salvar

### Compatibilidade
- Leitura de `midp_politica` mantida para bancos/configs antigos
- Override `midpPolitica` nos testes permanece

### Não alterado
- Algoritmo MIDP, Motor Fiscal, DistribuidorPagamento, XML NFC-e, Financeiro, Estoque

---

## [MIDP-V1-CERT] — 2026-07-29 — Certificação oficial MIDP V1.0

### Adicionado
- Suíte de certificação: cenários 1–15 + performance 1.000 vendas
- `backend/motores/midp/tests/certificacao/*`
- Docs: `CERTIFICACAO_MIDP_V1.md`

### Resultado
- **100% cenários APROVADOS** · performance APROVADA (0 falhas)
- Status: **HOMOLOGADO PARA PRODUÇÃO**

### Não alterado
- Algoritmos MIDP, Motor Fiscal, DistribuidorPagamento, NFC-e, Financeiro, Estoque

---

## [MIDP-RC3-FINAL] — 2026-07-29 — Preservar Dinheiro (versão final oficial)

### Adicionado
- `PreservarDinheiroCalculator.js` — algoritmo por quantidade (fracionável × inteiro)
- Contrato expandido `MidpDecisionResult` (`valorFiscalEfetivo`, `quantidadeFiscal`, `valorFiscalPIX`, `valorFiscalDinheiro`, …)
- Docs: `MIDP_RC3_FINAL.md`
- Ajuste de `quantidade_fiscal` / `valor_fiscal` nos itens após a decisão MIDP

### Alterado
- `PreservarDinheiroPolicy` → `PreservarDinheiroPolicy.RC3.FINAL`
- `MidpService` / `VendaPagamentoService` repassam `itens` (com `produto_fracionado`)
- Dinheiro fiscal só como complemento mínimo da próxima unidade inteira

### Não alterado
- Motor Fiscal / intervalo / margem
- Algoritmo interno do `DistribuidorPagamento` (recebe só totais finais)
- Política `LEGADO` (paridade RC2)

---

## [MIDP-RC3] — 2026-07-29 — Preservar Dinheiro (política oficial)

### Adicionado
- `MidpDecisionResult.js` — `valorFiscalEfetivoProposto` / economia
- Algoritmo oficial em `PreservarDinheiroPolicy` (não delega mais ao LEGADO)
- Docs: `MIDP_RC3_PRESERVAR_DINHEIRO.md`
- Testes: `backend/motores/midp/tests/midp-rc3-preservar-dinheiro.test.js`

### Alterado
- `MidpService` aceita `fiscalOperacional` (intervalo do Motor Fiscal)
- `VendaPagamentoService` repassa `FiscalOperacionalResult` ao MIDP e usa totais da decisão no fluxo
- `MidpResult.VERSAO` → RC3

### Não alterado
- Motor Fiscal / FiscalOperacionalResult / FiscalIntervalResult
- Algoritmo interno do `DistribuidorPagamento`
- Política `LEGADO` (paridade RC2)

---

## [FISCAL-MARGIN-RC3] — 2026-07-29 — Cálculo da Margem Fiscal

### Adicionado
- `FiscalMarginCalculator.js` — máximo / mínimo / margem (`máx − mín`)
- Docs: `RC3_FISCAL_MARGIN.md`
- Testes: `tests/fiscal-margin-rc3.test.js`

### Alterado
- `FiscalIntervalCalculator` orquestra o MarginCalculator (não calcula margem direto)
- `FiscalOperacionalService.montarFromItens` propaga itens para habilitar margem real
- `separarItensDistribuidos` usa `montarFromItens`
- VERSÃO do resultado operacional / intervalo → RC3

### Não alterado
- `valorFiscalEfetivo` (= máximo), MIDP, Financeiro, NFC-e, TEF, DistribuidorPagamento, Orquestrador, VendaPagamentoService

---

## [FISCAL-INTERVAL-RC2] — 2026-07-29 — Calculadora do Intervalo Fiscal

### Adicionado
- `FiscalIntervalCalculator.js` + `FiscalIntervalResult.js` (máximo / mínimo / margem)
- Docs: `RC2_FISCAL_INTERVAL_CALCULATOR.md`
- Testes: `backend/motores/fiscal-nao-fiscal/tests/fiscal-interval-rc2.test.js`

### Alterado
- `FiscalOperacionalService` obtém intervalo via `FiscalIntervalCalculator`
- `FiscalOperacionalResult.VERSAO` → RC2 (efetivo permanece = máximo)

### Não alterado
- Valor Fiscal Efetivo (regra), MIDP, DistribuidorPagamento, Financeiro, NFC-e, TEF

---

## [FISCAL-OPERACIONAL-RC1] — 2026-07-29 — Resultado Fiscal Operacional

### Adicionado
- Motor `backend/motores/fiscal-nao-fiscal/` com `FiscalOperacionalResult`, `FiscalOperacionalService`, `FiscalOperacionalLogger`
- Contrato oficial: máximo / mínimo / efetivo / margem (RC1: efetivo = mínimo = máximo; margem = 0)
- Getters de compatibilidade: `valorFiscal`, `totalFiscal`, `totalNaoFiscal`
- Docs: `RC1_FISCAL_OPERACIONAL.md`
- Testes: `backend/motores/fiscal-nao-fiscal/tests/fiscal-operacional-rc1.test.js`

### Alterado
- `fiscalNaoFiscalService.separarItensDistribuidos` retorna `FiscalOperacionalResult` (destructuring legado intacto)
- Extraído `calcularTotaisDistribuidos` (soma histórica pura)

### Não alterado
- Regras fiscais, MIDP, DistribuidorPagamento, Financeiro, NFC-e, TEF, Motor Comercial, Motor Estoque

---

## [MIDP-RC2] — 2026-07-29 — Políticas de Distribuição

### Adicionado
- `backend/motores/midp/policies/` com `IMidpPolicy`, `LegacyDistributionPolicy`, `PreservarDinheiroPolicy` (placeholder), `MidpPolicyFactory`
- Config Enterprise `midp_politica` (`LEGADO` | `PRESERVAR_DINHEIRO`, default `LEGADO`)
- Testes: `backend/motores/midp/tests/midp-rc2.test.js`

### Alterado
- `MidpService` solicita política apenas via `MidpPolicyFactory` (sem conhecer políticas concretas)
- `MidpResult` / logs: metadados `politica`, `algoritmo`, `origem`, `versao` (compatível com RC1)

### Não alterado
- Algoritmo `DistribuidorPagamento`, Financeiro, TEF, NFC-e, Motor Fiscal × Não Fiscal, `VendaPagamentoService`
- Comportamento funcional da distribuição (= RC1); PRESERVAR_DINHEIRO delega ao LEGADO

---

## [MIDP-RC1] — 2026-07-29 — Formalização do Motor de Distribuição de Pagamentos

### Adicionado
- Motor MIDP em `backend/motores/midp/` (`MidpService`, `MidpEngine`, `MidpResult`, `MidpLogger`)
- Feature flag Enterprise `midp_ativado` (FALSE/TRUE) em Configurações Avançadas
- Testes de paridade OFF/ON: `backend/motores/midp/tests/midp-rc1.test.js`

### Alterado
- `VendaPagamentoService` chama `MidpService.distribuir()` (nunca `DistribuidorPagamento` direto)
- `OrquestradorPagamento` consome apenas `MidpResult`
- `DistribuidorPagamento.js` permanece como algoritmo legado encapsulado pelo MidpEngine

### Não alterado
- Algoritmo de distribuição, prioridade, valor fiscal/não fiscal, NFC-e, Financeiro, TEF

---

## [PDV-UC-02] — 2026-07-18 — Cutover PDV → UC-01 (Forma de Venda)

### Alterado
- PDV resolve Forma de Venda exclusivamente via UC-01 (`ProdutoUnidadeComercialService`)
- Parse oficial `resp.items` + mapper `unidade_padrao` / `prioridade`
- Modal de quantidade usa a **Unidade Comercial** do canal PDV (não a Unidade Base)
- Busca PDV anexa UC-01 (`items`), não mais `Muc.listar` como fonte principal
- Removidas heurísticas `tipo≠PADRAO` / `quantidade≠1` e fallback HTTP MUC no fluxo de adição
- Módulo compartilhado: `frontend/shared/js/pdvFormaVendaUc01.js`
- Testes: `npm run test:pdv-uc02` (12 OK)
- Docs: `PDV_UC_02.md` · `AUDITORIA_PDV_UC02.md`

### Não alterado
- MCC, Motor Estoque, Comercial, Fiscal, MFE
- Banco, schema UC-01, payloads/APIs de conversão

---

## [UX-MASTER-01.1] — 2026-07-18 — Formação do Preço (UX)

### Alterado (somente copy)
- Bloco “Cálculo de custo por quantidade” → **Formação do Preço**
- “Valor Total Pago” → **Valor Total da Compra**
- “Quantidade Total” → **Quantidade Comprada** (com unidade)
- Fórmula técnica removida da UI → **Cada {Unidade} Custou** + valor
- “Margem %” → **Lucro Estimado**
- Docs: `UX_MASTER_01_1_FORMACAO_PRECO.md` · `AUDITORIA_UX_MASTER_01_1.md`

### Não alterado
- Cálculos, payloads, APIs, banco, MCC, Estoque, Comercial, Fiscal, MFE

---

## [UX-MASTER-01] — 2026-07-18 — Cadastro Inteligente de Produtos

### Alterado (somente UX)
- Modal de produtos: caminho feliz com progressive disclosure
- “Unidade Base” → **Unidade do Estoque**
- Card MCC → **Peso do Produto** (linguagem operacional)
- UC → **Formas de Venda** (cards enxutos; toolbar se ≥ 3)
- Margem calculada automaticamente + botão Editar
- Código automático no create + “Editar código”
- UC padrão (PADRAO · Venda · PDV) após primeiro save
- Card **Avançado** removido da tela principal
- Fornecedor em **Mais opções**

### Não alterado
- MCC, UC schema, Motor Estoque, Comercial, Fiscal, MFE
- Banco, APIs, payloads oficiais, regras de negócio

### Docs
- `UX_MASTER_01.md` · `AUDITORIA_UX_MASTER01.md` · `RELATORIO_UX_MASTER01.md`
- `ROADMAP_UX.md` · `CHECKLIST_UX.md`

---

## [MFE-07] — 2026-07-18 — Liquidação Financeira

### Adicionado
- `FinancialSettlement` (domínio de liquidação)
- `FinancialSettlementHandler` (consome Ledger)
- Eventos `PAYMENT_SETTLED` · `PIX_SETTLED` · `TEF_SETTLED` · `CASH_SETTLED` · `CARD_SETTLED` · `CHECK_SETTLED` · `BANK_TRANSFER_SETTLED` · `BOLETO_SETTLED` · `PAYMENT_REVERSED` · `PAYMENT_FAILED` (+ aliases PT)
- Gateway: `publicarLiquidacao`, `publicarDinheiro`, `publicarCartaoCredito`, `publicarCartaoDebito`, `publicarCheque`, `publicarBoleto`, `publicarTransferencia`; `publicarPix`/`publicarTef` passam a liquidar via Settlement
- Flag `FEATURE_MFE_SETTLEMENT` (default OFF)
- Enum `MeioFinanceiro` consolidado (já existente, documentado)
- Governança Regra 3.7
- Docs: `MFE_07_SETTLEMENT.md` · `ADR_FINANCIAL_SETTLEMENT.md` · `DIAGRAMA_SETTLEMENT.md` · `AUDITORIA_MFE07.md`
- Catálogo atualizado: `FINANCIAL_EVENTS_CATALOG.md`
- Testes: `npm run test:mfe07` (19 OK)

### Não alterado
- Caixa, AR, AP, Fiscal, Estoque, Comercial (operacional)
- SDKs PIX/TEF · cutover

---

## [MFE-06] — 2026-07-18 — Contas a Pagar / Compras (Piloto)

### Adicionado
- `FinancialPayableHandler` (consome Ledger)
- `PurchasePayableBridge` + `publicarEventoCompraApMfe`
- Eventos ACCOUNT_PAYABLE_* completos + aliases TITULO_AP_*
- Flag `FEATURE_MFE_AP` (default OFF)
- Ponte dual-path em `compras.js` (`criarFinanceiroCompra`)
- Catálogo oficial `FINANCIAL_EVENTS_CATALOG.md`
- Governança Regra 3.6
- Docs: `MFE_06_CONTAS_PAGAR.md` · `ADR_CONTAS_PAGAR.md` · `DIAGRAMA_MFE06.md` · `AUDITORIA_MFE06.md`
- Testes: `npm run test:mfe06` (14 OK)

### Gateway
- `publicarCompra()` / `publicarContaPagar()` (já existentes) usados pelo bridge

### Não alterado
- Caixa, Contas a Receber, PIX, TEF, PDV, Comercial, Fiscal
- Cutover definitivo / remoção de legado

---

## [MFE-05.2] — 2026-07-18 — FinancialGateway (Facade Oficial)

### Adicionado
- `FinancialGateway` — única porta pública do MFE
- Métodos: `publicar`, `publicarVenda`, `publicarPagamento`, `publicarRecebimento`, `publicarCreditoComercial`, `publicarCaixa`, `publicarPix`, `publicarTef`, `publicarCompra`, `publicarContaReceber`, `publicarContaPagar`
- Resolução automática de `FinancialContext`
- Governança Regra 3.5
- Docs: `MFE_05_2_FINANCIAL_GATEWAY.md` · `ADR_FINANCIAL_GATEWAY.md` · `DIAGRAMA_GATEWAY_FINANCEIRO.md` · `AUDITORIA_MFE05_2.md`
- Testes: `npm run test:mfe052` (14 OK)

### Alterado
- Bridges e Orchestrators passam a publicar via Gateway (não Pipeline direto)

### Não alterado
- Regras financeiras, flags, Caixa/AR/AP/PIX/TEF operacionais, Ledger, Pipeline
- Cutover / remoção de bridges

---

## [MFE-05.1] — 2026-07-18 — Bridge PDV + Comercial → Contas a Receber

### Adicionado
- `PdvArBridge` + `ComercialArBridge`
- Adapters `publicarEventoPdvArMfe` / `publicarEventoComercialArMfe`
- Flags `FEATURE_MFE_PDV_AR` e `FEATURE_MFE_COMERCIAL_AR` (default OFF)
- Consumo de `SALE_COMPLETED` · `SALE_CANCELLED` · `COMMERCIAL_CREDIT_*` · `PAYMENT_RECEIVED` no `FinancialReceivableHandler`
- Wire PDV (`VendaPagamentoService` / cancelamento) e Comercial (`FinanceiroPlatformGateway`)
- Governança Regra 3.4
- Docs: `MFE_05_1_BRIDGE_PDV_AR.md` · `ADR_BRIDGE_PDV_AR.md` · `AUDITORIA_MFE05_1.md`
- Testes: `npm run test:mfe051` (13 OK)

### Compatibilidade
- Flags OFF → legado (INSERT PDV intacto)
- Flags ON → bridge (PDV sem INSERT direto; MFE persiste título)

### Não alterado
- Contas a Pagar, PIX, TEF, Caixa, Fiscal, Estoque
- Cutover definitivo

---

## [MFE-05] — 2026-07-18 — Contas a Receber (Piloto)

### Adicionado
- `FinancialReceivableHandler` (consome Ledger)
- `ReceivableOrchestrator` + `publicarEventoArMfe`
- `FinancialInstallment` (infraestrutura de parcelas)
- Eventos ACCOUNT_RECEIVABLE_* + aliases TITULO_AR_*
- Flag `FEATURE_MFE_AR` (default OFF)
- Ponte dual-path em `rotas/contas_receber.js` (pagamento)
- Docs: `MFE_05_CONTAS_RECEBER.md` · `ADR_CONTAS_RECEBER.md` · `DIAGRAMA_MFE05.md` · `AUDITORIA_MFE05.md`
- Testes: `npm run test:mfe05` (13 OK)

### Não alterado
- Contas a Pagar, PIX, TEF, Caixa, Fiscal, Estoque
- Cutover definitivo / bridge completo PDV→criação de título

---

## [MFE-04] — 2026-07-18 — Caixa Operacional (Piloto)

### Adicionado
- `FinancialCashHandler` (consome Ledger; nunca cria lançamento)
- `CashOrchestrator` + `publicarEventoCaixaMfe`
- Eventos CASH_SUPPLY / WITHDRAWAL / ADJUSTMENT / RECONCILIATION
- Enums `FinancialContext` · `FinancialStatus`
- Flag `FEATURE_MFE_CAIXA` (default OFF)
- Ponte dual-path em `rotas/caixa.js`
- Docs: `MFE_04_CAIXA.md` · `ADR_CAIXA_MFE.md` · `DIAGRAMA_MFE04.md` · `AUDITORIA_MFE04.md`
- Testes: `npm run test:mfe04` (13 OK)

### Não alterado
- AR, AP, PIX, TEF, PDV, Comercial, Fiscal
- Cutover definitivo do Caixa

---

## [MFE-03] — 2026-07-17 — Modelo Financeiro Unificado (SSOT)

### Adicionado
- Domínio: `FinancialOperation`, `FinancialEntry`, `FinancialDocument`, `FinancialAllocation`
- Catálogo oficial EN de eventos + aliases PT
- Enums: `FinancialOperationType`, `MeioFinanceiro`, `FinancialDocumentType`; `OrigemFinanceira` expandida
- `FinancialAuditTrail` (operationId · correlationId · traceId · eventId · idempotencyKey)
- Contratos `IFinancialOperation` / Entry / Document / Allocation
- Docs: `MFE_03_MODELO_FINANCEIRO.md` · `ADR_MODELO_FINANCEIRO.md` · `DIAGRAMA_MFE03.md`
- Testes: `npm run test:mfe03modelo`

### Não alterado
- Caixa, Bancos, AR, AP, PIX, TEF, PDV, Comercial (consumidores)
- Regras operacionais de rateio

---

## [UX-PROD-05] — 2026-07-17 — Cards Enterprise de Unidades de Comercialização

### Alterado (somente UX)
- Grade UC substituída por **cards** (`#gradeCardsUnidadesUc01`)
- Filtros (Todos/Compra/Venda/PDV/Ativos/Inativos) + pesquisa
- Ordenação: Padrão → Prioridade → Nome
- Ações: Editar, Duplicar, Desativar, Excluir
- “Mais detalhes” para dados técnicos
- Cadastro marcado **Enterprise Ready** (congelamento estrutural)
- Docs: `UX_PROD_05.md` · `AUDITORIA_UX_PROD05.md`

### Não alterado
- MCC, motores, APIs, banco, regras de conversão

---

## [UX-PROD-03.1] — 2026-07-17 — Fluxo Oficial de Implantação do Produto

### Alterado (somente UX)
- Banners **Fase 1 — Implantação** / **Fase 2 — Operação** no domínio Estoque
- Infraestrutura: `CAMPOS_IMPLANTACAO_PRODUTO`, `avaliarFaseCadastroProduto`, `prepararBloqueioImplantacaoProduto`
- Bloco **Conversão Física do Estoque Inicial** (peso; sem fator; sem persistência)
- Aviso: alterações pós-implantação via **Ajuste de Estoque**
- Badge de fase no Resumo Inteligente
- Docs: `UX_PROD_03_1.md` · `AUDITORIA_UX_PROD03_1.md`

### Não alterado
- MCC, motores, APIs, banco, regras, F12/F7

---

## [UX-PROD-03] — 2026-07-17 — Cadastro por Domínios + Resumo Inteligente

### Alterado (somente UX)
- Ordem vertical oficial: Identificação → Base → Física → UC → Comercial → PDV → Estoque → Fiscal → Avançado
- Resumo Inteligente no topo (somente leitura)
- Cards/cabeçalhos padronizados por domínio
- Código de barras e fornecedor na Identificação
- Docs: `UX_PROD_03.md` · `AUDITORIA_UX_PROD03.md`

### Não alterado
- MCC, motores, APIs, banco, regras, F12/F7

---

## [UX-PROD-02] — 2026-07-17 — Separação Venda por Peso × Conversão Física

### Alterado (somente UX)
- Card **Venda no PDV** (fracionado) separado do card **Conversão Física (MCC)**
- Glossário rápido no cadastro (Base / UC / Física / Venda por Peso)
- Badges/ícones/tooltips por domínio
- Docs: `UX_PROD_02.md` · `AUDITORIA_UX_PROD02.md`

### Não alterado
- MCC, motores, APIs, flags `produto_fracionado` / `utiliza_conversao_fisica`

---

## [UX-PROD-01] — 2026-07-17 — Cadastro de Produtos (Quick Wins UX)

### Alterado (somente UX)
- Label **Unidade Base (Estoque)** + tooltip SSOT
- Bloco **Conversão Física** separado do Fiscal (sem menção a fator)
- Tipo UC `CONVERSAO_FISICA` → rótulo operador **Medida Física**
- Fluxo visual: Identificação → Base → Comercial → Física → UC → Estoque → Fiscal
- Bloco UI **Conversão Física Inicial** (preparação; sem persistência)
- Removidos fantasmas `data_validade`/`lote` do payload e UI MUC do modal

### Não alterado
- MCC, Motores, APIs, regras de conversão/estoque

### Docs
- `UX_PROD_01.md` · `AUDITORIA_UX_PROD01.md`
- Governança: Cadastro declarativo (preparação documental)

---

## [EST-MCC-01] — 2026-07-17 — Ajuste de Estoque × MCC

### Adicionado
- `EstoqueAdjustmentOrchestrator` + `EstoqueAdjustmentOperacionalService`
- APIs: `GET .../ajuste-estoque/unidades` · `POST .../ajuste-estoque/preview`
- `POST .../ajustar-estoque` com `unidade_origem` (conversão MCC → base)
- UI: combo dinâmico de unidades + preview (informada → base → saldo final)
- Contexto `AJUSTE_ESTOQUE` no MCC
- Testes: `npm run test:est-mcc01` (9 OK)
- Docs: `EST_MCC_01_AJUSTE_ESTOQUE.md` · `AUDITORIA_EST_MCC01.md` · `ROADMAP_MCC.md`

### Não alterado
- Arquitetura MCC / Motor Estoque
- F7 na Entrada de Compra
- Conversão na UI (proibida)

### Decisão
Toda tela que movimenta estoque consulta o MCC para UCs válidas — proibido lista fixa.

---

## [MFE-03] — 2026-07-17 — Ledger Financeiro Operacional

### Adicionado
- `FinancialLedgerService` — criar/consultar/saldo lógico (append-only)
- `LedgerEntry` operacional (tipoLancamento, natureza, eventId, moeda, contaFinanceira, histórico)
- `EventToLedgerMapper` — todo evento do pipeline gera lançamento(s)
- Outbox `LEDGER_ENTRY_CREATED` por lançamento
- Migration/índices MFE-03
- Testes: `npm run test:mfe03` · Docs: `MFE_03_LEDGER_OPERACIONAL.md` · `AUDITORIA_MFE03.md`

### Decisão
Lançamentos financeiros nascem exclusivamente de FinancialEvent via pipeline; UPDATE/DELETE proibidos.

---

## [MFE-02] — 2026-07-17 — Pipeline Oficial de Eventos Financeiros

### Adicionado
- `FinancialEventPipeline` — porta única de entrada
- `FinancialEventDispatcher` com handlers, retries e integração ao Ledger
- Handlers oficiais vazios (catálogo expandido: sangria, suprimento, estorno, ajuste…)
- Dead Letter + Outbox pós-processamento
- Proibição de `LedgerEntry` fora do pipeline
- Testes: `npm run test:mfe02` / `npm run test:mfe`
- Docs: `MFE_02_PIPELINE_EVENTOS.md` · `AUDITORIA_MFE02.md`

### Decisão
Todo lançamento financeiro nasce exclusivamente de um FinancialEvent processado pelo pipeline.

---

## [MFE-01] — 2026-07-17 — Fundação do Motor Financeiro Enterprise

### Adicionado
- Pacote `backend/motores/motor-financeiro/` (Ledger append-only, Event Store, Auditoria, Flags, Contratos)
- Schema: `financial_ledger` · `financial_events` · `financial_outbox` · `financial_dead_letter` · `financial_idempotency` · `financial_audit`
- Bootstrap no `database.js` (CORE)
- Feature flags OFF: `FINANCEIRO_V2` · `FIN_LEDGER` · `FIN_EVENTS`
- Testes: `npm run test:mfe01` (11 OK)
- Docs: `MFE_01_FUNDACAO.md` · `AUDITORIA_MFE01.md`

### Não alterado
- Financeiro legado, PDV, Compras, Comercial — intactos (sem cutover)

### Decisão
MFE existe fisicamente como infraestrutura CORE. Regras operacionais (caixa/AR/AP) em sprints seguintes.

---

## [MFE-00] — 2026-07-17 — Visão Arquitetural do Motor Financeiro Enterprise

### Adicionado (somente arquitetura — sem implementação operacional)
- `MFE_VISAO_ENTERPRISE.md` — SSOT financeiro, responsabilidades, eventos, contratos, flags, migração
- `ADR_MOTOR_FINANCEIRO.md` — decisão oficial MFE no CORE
- `DIAGRAMA_MFE.md` · `ROADMAP_MFE.md`
- Integração em `ARQUITETURA_CORE_CDS.md` · `PLATFORM_CORE.md` · `GOVERNANCE.md` · `SSOT_OFICIAL.md`

### Decisão
MFE é a única autoridade financeira da Plataforma CDS.  
Módulos produzem Eventos Financeiros; ledger append-only; legado permanece até cutover.

---

## [GOVERNANCE 1.0.0] — 2026-07-17 — Regras arquiteturais permanentes

### Adicionado
- `GOVERNANCE.md` — 10 regras obrigatórias (estoque, conversão, financeiro, comercial, fiscal, unidade base, conversão física, contratos, eventos, reuso CORE)
- Exceção somente com ADR aprovado
- Referenciado em `ARQUITETURA_CORE_CDS.md` · `ARQUITETURA_GERAL.md` · `PLATFORM_CORE.md`

---

====================================================
PLATFORM-02
ARQUITETURA CORE OFICIAL
====================================================

Motores homologados

✔ MCC  
✔ Motor Estoque  
✔ Motor Comercial  
✔ Motor Fiscal  
✔ Compras  
✔ PDV  

Integração CORE concluída.

Toda nova funcionalidade deverá consumir estes motores.

====================================================

## [PLATFORM-02.1] — 2026-07-17 — Consolidação Arquitetura CORE

### Documentação
- `ARQUITETURA_CORE_CDS.md` — referência arquitetural principal
- `PLATFORM_CORE.md` · `CORE_SERVICES.md` · `SSOT_OFICIAL.md`
- `DEPENDENCIAS_OFICIAIS.md` · `ROADMAP_MOTORES.md`
- `PLATFORM_02_1_BUILD_REPORT.md`
- `ARQUITETURA_GERAL.md` aponta para o CORE oficial

### Decisão
Plataforma CDS opera sobre Arquitetura CORE consolidada.  
Contratos públicos congelados (alteração exige ADR).  
Legado inventariado — sem remoção de código nesta sprint.

---

## [FIS-01] — 2026-07-17 — Motor Fiscal → MCC (read-only)

### Adicionado
- `FiscalOperacionalService` — snapshot UC / qtd comercial / qtd base da venda (sem recalcular)
- NFC-e XML e DANFE consomem o snapshot MCC/UC
- Testes: `npm run test:fis01`
- Docs: `FIS_01_MCC.md` · `AUDITORIA_FIS01.md`

### Decisão
Motor Fiscal não converte nem movimenta estoque.  
Emite com a Unidade Comercial da operação; conversão permanece exclusiva do MCC na venda.

---

## [COM-01] — 2026-07-17 — Motor Comercial → MCC → MotorEstoque

### Adicionado
- `ComercialConversaoOrchestrator` + `ComercialOperacionalService`
- Entrega: MCC → `MotorEstoque.sair(origem=CONSIGNACAO)` (+ FEFO)
- Devolução: MCC → `MotorEstoque.entrar(origem=DEVOLUCAO)`
- Prestação (venda/cortesia/perda): MCC no ledger + auditoria
- Outbox `ESTOQUE_REGISTRAR_PERDA`
- Testes: `npm run test:com01`
- Docs: `COM_01_MCC.md` · `AUDITORIA_COM01.md`

### Removido do caminho estoque consignação
- `ajusteEstoqueService` como caminho primário no `EstoquePlatformGateway`

### Decisão
Motor Comercial não calcula conversão. MCC resolve quantidades; MotorEstoque movimenta só unidade base.

---

## [PDV-01] — 2026-07-17 — PDV → MCC → MotorEstoque

### Adicionado
- `PdvConversaoOrchestrator` + `PdvVendaOperacionalService` (integração PDV oficial)
- Baixa de venda via `MotorEstoque.sair(origem=PDV)` (quantidade base do MCC)
- Estorno via `MotorEstoque.entrar(origem=DEVOLUCAO)`
- UI PDV: UCs de `/unidades-comercializacao` filtradas por canal `pdv`
- Testes: `npm run test:pdv01`
- Docs: `PDV_01_MIGRACAO_MCC.md` · `AUDITORIA_PDV01.md`

### Removido do caminho PDV
- Conversão local por `fator_conversao` no carrinho (UC)
- `UPDATE produtos` direto na baixa/estorno da venda PDV

### Decisão
PDV conhece apenas Produto · UC · Quantidade.  
MCC converte. MotorEstoque movimenta somente unidade base.

---

## [Fix] — 2026-07-17 — Conta Corrente: extrato e saldo

### Corrigido
- Extrato sem descrição / saldo em `-` (agora usa `motivo` + `saldoProjetado` da projeção)
- Saldo atual R$ 0,00 com consignado em aberto (prioriza `saldoDevedor` SSOT)
- Ruído no extrato (`PERFIL_CRIADO`, `ABERTURA_PRESTACAO`) — conta corrente só com `geraContaCorrente`
- ENTREGA/VENDA multi-item duplicadas — agrupamento por `correlationId` na projeção
- Cliente sem `GET /projections/conta-corrente` (só consignação carregava)

---

## [MCC-04] — 2026-07-17 — Motor de Estoque (somente Unidade Base)

### Adicionado
- Pacote `backend/motores/motor-estoque/` (CORE)
- API: `entrar` · `sair` · `ajustar` · `inventariar` · `reservar` · `consultarSaldo`
- Rejeição oficial de quantidade/unidade comercial e fator (`QuantidadeComercialRejeitadaError`)
- Auditoria `estoque_movimentacoes` + reservas `estoque_reservas`
- Compras (MCC-03) passam a credit estoque via `MotorEstoque.entrar`
- `ajusteEstoqueService` delega saldo/auditoria ao MotorEstoque
- Testes: `npm run test:mcc04`
- Docs: `MCC_04_ESTOQUE.md` · `AUDITORIA_MCC04.md`

### Decisão
Estoque conhece apenas Produto · Unidade Base · Quantidade Base.  
Toda conversão permanece exclusiva do MCC. Sem cache de conversão no estoque.

### Não alterado / fora de escopo
PDV · Comercial · Fiscal · Financeiro · APIs externas · débito inline de vendas (migração futura para `sair`)

---

## [MCC-03] — 2026-07-17 — Integração operacional MCC × Entrada de Mercadorias

### Adicionado
- `EntradaMercadoriasOperacionalService` (ponte Compra → Orchestrator → estoque base)
- `processarItensCompra` consome exclusivamente o Orchestrator/MCC para quantidades
- Criação automática de `produtos_lotes` + `ConversaoFisicaLote` (quando física)
- UI Compras: painel MCC (UC, peso por embalagem / peso total, preview base)
- Auditoria `MCC_ENTRADA_CONVERSAO`
- Testes: `npm run test:mcc03`
- Docs: `MCC_03_ENTRADA_OPERACIONAL.md` · `AUDITORIA_MCC03.md`

### Decisão
Entrada de Mercadorias é o único módulo autorizado a criar Conversão Física por Lote.  
Estoque permanece na unidade base (SSOT). Nenhuma rota chama o MCC diretamente.

### Removido do caminho de Entrada
Uso de `resolverQuantidadesEstoqueCompraItem` / totais convertidos do `motorConversaoUnidades` para quantidade de estoque.

### Não alterado / fora de escopo
PDV · Comercial · Fiscal · Financeiro · MUC Conversor

---

## [MCC-HOM-01] — 2026-07-17 — Homologação Enterprise do MCC (CORE oficial)

### Homologado
- Auditorias 1–10 (arquitetura, deps, responsabilidades, tipos, stress, threads, versionamento, escala, futuro, docs)
- Stress 100k + concorrência (worker_threads) + escalabilidade 50k
- Suite `npm run test:mcc-hom` · `npm run test:mcc:all` ampliada

### Decisão
MCC aprovado como motor **CORE oficial**. Novas conversões obrigatoriamente via MCC. Legados MUC/`motorConversaoUnidades` mapeados para migração.

### Entregáveis
`MCC_HOMOLOGACAO_FINAL.md` · `AUDITORIA_MCC_ENTERPRISE.md` · `CHECKLIST_MCC.md`

### Não implementado (fora de escopo)
Novas features · integração operacional Compras/Estoque/PDV/Fiscal

---

## [MCC-02.1] — 2026-07-17 — Versionamento Conversão Física por Lote

### Adicionado
- Campos `versao`, `ativa`, `substitui_id`, `motivo`, `usuario_id` em `conversoes_fisicas_lotes`
- Enum `MotivoVersaoConversao` + erro `ConversaoFisicaImutavelError`
- APIs: ativa / histórico / nova versão (`/api/lotes/:loteId/conversao-fisica/...`)
- MCC resolve **somente** versão ativa; inativas rejeitadas
- UPDATE de fator/quantidades e DELETE bloqueados
- Testes: `npm run test:mcc021`
- Docs: `MCC_02_1_VERSIONAMENTO.md` · `ADR_VERSIONAMENTO_CONVERSAO_LOTE.md`

### Decisão
Correções geram nova versão. Histórico permanente. Uma ativa por lote.

### Não alterado
Compras, Estoque, PDV, Fiscal, Comercial, UI operacional

---

## [MCI-01] — 2026-07-17 — Integração MCC × Entrada de Mercadorias

### Adicionado
- `CompraConversaoOrchestrator` (única origem autorizada de `ConversaoFisicaLote`)
- Modos `PESO_POR_EMBALAGEM` e `PESO_TOTAL`
- `ConversaoFisicaCalculator` + `CalcularConversaoFisica()` no MCC
- Erros: `PesoInvalidoError`, `VolumeInvalidoError`, `UnidadeNaoPermitidaError`
- Flag `somenteUnidadeBase` / `aplicarFisica: false` no Converter (estoque na base)
- Testes: `npm run test:mci01`
- Docs: `MCI_01_ENTRADA_MERCADORIAS.md` · `ADR_ORCHESTRATOR_COMPRA.md`

### Decisão
Entrada de Mercadorias cria a conversão física do lote; MCC apenas calcula. Sem movimentação de estoque nesta sprint.

### Não alterado / fora de escopo
Rotas/UI de Compras, Estoque, PDV, NFC-e, NF-e, Comercial, Financeiro

---

## [MCC-02] — 2026-07-17 — Conversão Física por Lote (CORE)

### Adicionado
- Entidade `ConversaoFisicaLote` + tabela `conversoes_fisicas_lotes` (Lote 1:1)
- Enum `OrigemConversaoFisica` (MANUAL, FABRICANTE, CALCULADA, IMPORTADA_XML, IMPORTADA_PLANILHA)
- Erro oficial `ConversaoFisicaObrigatoriaError`
- `ConversaoFisicaService` ativo (fator do lote; produto sem fator)
- Conversão composta Caixa → Litro → Kg com lote
- `ResultadoConversao` expandido (loteUtilizado, fatorAplicado, quantidadeOriginal, unidadeDestino…)
- Cache por produto + lote + contexto + UC + quantidade
- Bootstrap schema no `database.js`
- Testes: `npm run test:mcc02` · `npm run test:mcc:all`
- Docs: `MCC_02_CONVERSAO_FISICA_LOTE.md` · `ADR_CONVERSAO_FISICA_LOTE.md`

### Decisão
Conversão física pertence ao lote. Produto nunca armazena fator L/Kg. MCC é o único resolvedor.

### Não alterado / fora de escopo
Compras, Estoque, PDV, Comercial, NFC-e, NF-e, UI, APIs de compra, persistência operacional da entrada

---

## [MCC-01] — 2026-07-17 — Fundação Motor de Conversão Comercial (CORE)

### Adicionado
- Motor CORE `backend/motores/motor-conversao-comercial/`
- Interface oficial `Converter()` + enums `TipoConversao`, `ContextoConversao`, `ResultadoConversao`
- Serviços: Comercial, Agrupamento, Fracionamento, Física (stub), Composta (cadeia)
- Cache interno por operação + auditoria em memória (sem persistência)
- Precisão comercial preparada (não aplicada)
- Testes: `npm run test:mcc`
- Docs: `MCC_01_ARQUITETURA.md` · `ADR_MOTOR_CONVERSAO_COMERCIAL.md` · `DIAGRAMA_MCC.md` · `ARQUITETURA_GERAL.md`

### Decisão
MCC é o único responsável por conversões UC ↔ Unidade Base. Nenhum módulo deve implementar conversão própria.

### Não alterado / fora de escopo
Compras, Estoque, PDV, Comercial, NFC-e, NF-e, conversão física por lote, APIs HTTP, persistência, integração automática

---

## [UC-01.1] — 2026-07-17 — Refinamento Unidades de Comercialização (CORE)

### Adicionado
- Canais de comercialização (`canais_comercializacao` JSON)
- `prioridade` (única por produto), `unidade_padrao`, `conversao_por_lote` (prep. UC-02)
- Tipo `PADRAO` + ícones/tooltips na UI
- Auditorias: prioridade única, qtd > 0, comercial ≠ base (exceto PADRÃO)
- DTO + OpenAPI `backend/motores/unidades-comercializacao/openapi-uc01.yaml`
- Docs: `UC_01_1_REFINAMENTO.md` · ADR/MODELO atualizados

### Compatibilidade
Flags UC-01 `permite_compra/venda/pdv` mantidos (sincronizados a partir dos canais).  
MUC legado, Compra, Estoque, PDV, NF e conversão automática **não alterados**.

---

## [UC-01] — 2026-07-17 — Fundação Unidades de Comercialização

### Adicionado
- Motor `backend/motores/unidades-comercializacao/` (cadastro estrutural)
- Tabela `produto_unidades_comercializacao` (ProdutoUnidadeComercial)
- Flags em `produtos`: `utiliza_conversao_fisica`, `unidade_conversao_fisica` (sem fator)
- API `GET/POST/PUT/DELETE /api/produtos/:id/unidades-comercializacao`
- ERP Desktop: seção **Unidades de Comercialização** + switch Conversão Física
- Docs: `ADR_UNIDADES_COMERCIALIZACAO.md`, `MODELO_UNIDADES_COMERCIALIZACAO.md`, `UC_01_ARQUITETURA.md`

### Princípio
1 Produto → 1 Unidade Base (SSOT) → N Unidades de Comercialização

### Não alterado
MUC legado (`produto_unidades`), Compra, Estoque, PDV, NFC-e, NF-e, conversão automática, APIs de movimentação

---

## [STAB-07.2] — 2026-07-14 — Central Operacional (Resumo Final)

### Alterado (somente FE Prestação)
- Resumo Final em **duas colunas** (Financeiro+Pagamentos | Fiscal+Timeline+Log)
- Rodapé fixo: Voltar · Registrar Pagamento · Emitir NFC-e · Encerrar
- `PrestacaoSnapshot` com `pagamentos`, `timeline`, `logOperacional`
- Soft refresh após pagamento (histórico atualiza sem sair da estação)
- Relatório: `AUDITORIA_STAB07_2.md`

### Não alterado
Ledger, APIs, Venda Oficial, Motor Fiscal, Recovery

---

## [STAB-07.1] — 2026-07-14 — Consolidação Prestação (Fase 1)

### Alterado (somente FE Prestação)
- Removido step **Pagamento** da navegação
- Fluxo: **Registrar Retornos → Resumo Final**
- Bloco Pagamento incorporado no Resumo Final
- Eliminado pagamento automático / auto-preenchimento de saldo em `_goNext`
- `PrestacaoSnapshot` ampliado (financeiro, itens, fiscal, vendaOficial, statusOperacional)
- Relatório: `AUDITORIA_STAB07_1.md`

### Não alterado
Ledger, APIs, Venda Oficial, Motor Fiscal, Recovery

---

## [STAB-06.6.4] — 2026-07-14 — Motor Comercial RC1

### Hardening operacional (CODE FREEZE após aprovação)

#### Docs (pós-RC1)
- Auditorias/relatórios históricos unificados em `docs/archive/auditorias/*/COMPILADO_*.md` — índice em `docs/archive/auditorias/README.md`
- Runtime Prestação: removidos logs temporários `[AUDITORIA]` / `[EMITIR]` / `[LOG OPERACIONAL]`

#### Adicionado
- `prestacaoHardening.js` — `safeText`/`safeMoney`, humanização de erros, tooltips de botões desabilitados, loading padronizado, retry amigável, `AUDITORIA_FINAL_RC1`, `LOG_OPERACIONAL_RC1`
- `ADR-COMERCIAL-001.md` — Motor Comercial RC1 + code freeze
- Testes `stab0664HardeningOperacional.test.js`

#### Alterado (somente UX / logs)
- Prestação: mensagens de sucesso `✓` e erros sem vazamento técnico
- Footer Emitir/Encerrar/Continuar/Voltar com tooltip do motivo de bloqueio
- Resumo Final: alerta com **Tentar novamente** / **Corrigir Cadastro** / **Fechar**
- Campos obrigatórios sem `Produto #` / `Cliente #` / `undefined`

#### Não alterado
- Ledger, Recovery, Venda Oficial, Motor Fiscal, Motor Financeiro, Crédito, APIs, banco, fluxos

---

## [STAB-06.6.3] — 2026-07-14

### Consolidação operacional da Prestação

#### Adicionado
- Timeline oficial Entrega → Prestação → Venda Oficial → NFC-e → Encerramento
- Estados de UI da prestação + labels financeiros/fiscais
- Painel de fechamento operacional e log de encerramento

#### Não alterado
- Ledger, Recovery, APIs, regras de emissão/encerramento

---

## [STAB-06.6.2] — 2026-07-14

### SSOT financeiro na Prestação

#### Adicionado
- `prestacaoFinanceiroSnapshot.js` — `{ valorVenda, valorRecebido, saldoEmAberto, situacaoFinanceira }`
- Hero / resumo / encerramento leem o snapshot (sem Σ paralelo da grade)

#### Não alterado
- Ledger, Motor Financeiro SSOT global, APIs

---

## [STAB-06.6.1] — 2026-07-14

### Integridade de itens da consignação

#### Adicionado
- JOIN/`produtoNome` no DTO de itens; status operativo; observação por item
- UI sem fallback `Produto #id`

#### Não alterado
- Regras de venda/fiscal/financeiro

---

## [STAB-06.3] — 2026-07-14

### Finalização da emissão fiscal na Prestação

#### Adicionado
- `EmitirNfcePrestacaoUseCase` — `criarVendaInterna` (se necessário) → `emitirPorVendaId` (Motor Fiscal oficial)
- `prestacao_faturamento` — vínculo Prestação ↔ venda_id ↔ NFC-e (chave, número, protocolo)
- Rota `POST …/prestacao/emitir-nfce`
- UI: Situação Fiscal, Emitir NFC-e / Encerrar separados, Visualizar/Reimprimir DANFE
- Testes `tests/stab06/emitir-nfce-prestacao.test.js`, `docs/archive/auditorias/comercial/COMPILADO_COMERCIAL.md` (seção STAB-06.3)

#### Alterado
- Encerrar só após faturamento (AUTORIZADA / NAO_APLICAVEL)
- Rejeição SEFAZ: prestaçã permanece aberta; mesma venda no retry

#### Não alterado
- PrestacaoVendaAdapter, criarVendaInterna, Motor Fiscal/XML/emissor, Ledger, Recovery, Crédito, STAB-03/04

---

## [STAB-06] — 2026-07-13

### Unificação da venda da consignação com o núcleo do PDV

#### Adicionado
- `PrestacaoVendaAdapter` — payload oficial para `criarVenda` (origem CONSIGNACAO, `JA_BAIXADO_CONSIGNACAO`)
- `criarVendaInterna` — mesma função `criarVenda` sem HTTP/caixa
- `FinalizarPrestacaoComVendaOficialUseCase` + rotas resumo/finalizar
- Resumo Final da Prestação (Integridade Comercial + Situação Financeira)
- `ADR-VENDAS-001.md`, `docs/archive/auditorias/comercial/COMPILADO_COMERCIAL.md` (seção STAB-06)
- Testes `tests/stab06/prestacao-venda-adapter.test.js`

#### Alterado (ponte mínima)
- `criarVenda`: respeita política de estoque já baixado; financeiro parcial consignação
- Prestação: encerrar/emitir chama venda oficial (não só `fecharPrestacao`)
- Grade `VENDA_PRESTACAO` / pagamento: sem espelho financeiro Outbox (ledger mantido)

#### Não alterado
- Ledger schema, Recovery, Motor Fiscal core, Motor Financeiro SSOT, STAB-03/04, fluxo UX do PDV

---

## [UX-20] — 2026-07-13

### Operação Primeiro — quatro estações Shared UI

#### Prestação
- Grade protagonista (scroll só na grade)
- Locator + Estação com sprint UX-20

#### Conta Corrente
- Extrato operacional mantido; Análise fora do viewport

#### Preparar Entrega
- Migrado de CDSPage → Workspace
- Uma faixa de crédito; sem assistente lateral

#### Entrega
- Migrado de WizardLayout → Workspace
- Confirmação fina; Entregar sempre no footer

#### Docs
- `docs/archive/auditorias/ux/COMPILADO_UX.md` (seção UX-20)
- Ilustrações Antes×Depois em `docs/ux20/`

#### Não alterado
APIs, Ledger, Recovery, Crédito, Outbox, STAB-03/04

---

## [UX-12] — 2026-07-13

### Prestação de Contas V2 — primeira Estação de Trabalho oficial

#### Adicionado
- Rota `/prestacao` — Localizador (Workspace + SmartSearch + EntityCard)
- Atalho na Central: **Prestação de Contas**
- `docs/archive/auditorias/ux/COMPILADO_UX.md` (seção UX-12)

#### Alterado (somente UX)
- Estação `/consignacoes/:id/prestacao` migrada para Workspace (header/body/footer fixos)
- Início operacional em **Registrar Retornos** (grade STAB-04)
- Sidebar de resumo removida do shell
- Sucesso: **Receber Agora** / **Voltar para Central**
- Conferência final enxuta (Total · Recebido · Saldo)

#### Não alterado
- STAB-04 (dirty/flush/grade), Ledger, Recovery, APIs, banco, regras de negócio

---

## [UX-11] — 2026-07-13

### Conta Corrente no Workspace oficial (primeira tela Shared UI)

A Conta Corrente deixa o shell de dashboard (`DashboardLayout` + sidebar + muro de KPIs) e passa a usar o **Shared UI Workspace** como extrato bancário operacional.

#### Alterado (somente UX)

- Shell: `Workspace` + `WorkspaceHeader` + `WorkspaceBody` + `WorkspaceFooter`
- Viewport: cliente · documento · período · saldo · extrato · **Receber**
- Extrato enxuto: Data, Tipo, Descrição, Valor, Saldo
- Scroll apenas no body; header/footer fixos
- KPIs, gráficos, timeline, alertas e pendências movidos para **Análise** (recolhida)
- Exportação unificada no footer (PDF / Excel / CSV / Imprimir)

#### Documentação

- `frontend/shared/ui/CHANGELOG.md` — Conta Corrente como referência oficial Shared UI
- `frontend/modules/motor-comercial/docs/CONTA_CORRENTE_COMERCIAL.md` atualizado

#### Não alterado

- APIs, Ledger, Recovery, Crédito Comercial, banco, eventos, regras de negócio, fluxo financeiro

---

## [UX-10] — 2026-07-13

### Estabilização operacional — Central orientada por estados

A Central de Trabalho Comercial deixa de se comportar como dashboard genérico e passa a operar como **fila operacional** com máquina de estados **E1–E6**.

#### Adicionado

- Classificação oficial por estado (`resolveEstadoOperacionalCliente`)
- Seção **Minha Fila de Trabalho**
- Auditoria automática `auditarCentralEstados` no view-model
- Documento `UX_10_CENTRAL_ORIENTADA_POR_ESTADOS.md`
- Documento `ARQUITETURA_UX_MOTOR_COMERCIAL.md` (máquina de estados da Central)

#### Alterado

- Trabalho Prioritário: **Continuar Atendimento** quando prestação em andamento; **Fechar Atendimento** só quando pronto para fechar
- Consignados Pendentes: renderizados **somente** em E5 (prestação encerrada + saldo > 0)
- Ações Rápidas: apenas atalhos gerais (Nova Entrega, Novo Cliente, Consultar Clientes, Relatórios)
- “Próximas Prestações” → **Atendimentos para Fechar**
- Ordem da fila: E2 → E3 → E4 (prioritário); E5 em bloco exclusivo

#### Removido (da UI da Central)

- Duplicidade Fechar Atendimento em Trabalho Prioritário + Ações Rápidas
- Exibição de Consignados Pendentes durante ciclo aberto (E2–E4)
- Botões mortos nas Ações Rápidas

#### Não alterado

- Regras de negócio, APIs, banco, Recovery, Crédito Comercial, Ledger, Financeiro

---

## [UX-09] — anterior

Recebimento rápido e bloco Consignados Pendentes (pré-máquina de estados).

## [UX-03] — anterior

Central de Trabalho Comercial como home do módulo.
