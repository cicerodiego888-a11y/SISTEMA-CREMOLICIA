/**
 * RCM-9.2 — Estabilização CDS Mobile (cliente dos motores oficiais)
 *
 * Não cria Motor Mobile. Valida integração + contagem comercial oficial.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));
const ROOT = path.resolve(__dirname, '../../../..');
const {
  contribuicaoContagemAtacado,
  CANAL_VAREJO,
  CANAL_ATACADO
} = require('../preco/CanalVendaResolver');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function contagem(itens) {
  return (itens || []).reduce((acc, i) => acc + contribuicaoContagemAtacado(i), 0);
}

function main() {
  console.log('\nRCM-9.2 — Estabilização CDS Mobile\n');

  const terminal = ler('frontend/apps/mobile/js/terminal.js');
  const pdv = ler('frontend/apps/mobile/js/pages/pdv.js');
  const client = ler('frontend/shared/api/client.js');
  const app = ler('frontend/apps/mobile/js/app.js');
  const index = ler('frontend/apps/mobile/index.html');
  const perms = ler('frontend/apps/mobile/js/permissions.js');
  const offline = ler('frontend/apps/mobile/js/offline-queue.js');

  // —— TERMINAL ——
  assert.ok(terminal.includes('getTerminalUiState'), 'estado operacional terminal');
  assert.ok(terminal.includes('SEM_CAIXA'), 'estado sem caixa');
  assert.ok(terminal.includes('INATIVO'), 'estado inativo');
  assert.ok(terminal.includes('CAIXA_ABERTO'), 'estado caixa aberto');
  assert.ok(terminal.includes('cds_mobile_terminal_caixa_id'), 'persiste caixa_id');
  assert.ok(terminal.includes('syncTerminalFromServer'), 'sync após reload');
  assert.ok(
    /Vincule o terminal no ERP em Gerenciar Caixas/.test(terminal),
    'mensagem vínculo caixa'
  );
  assert.ok(terminal.includes('terminais/auto'), 'reusa API auto');
  console.log('OK 1 — Terminal estados / persistência / mensagem vínculo');

  // —— CAIXA / PDV gates ——
  assert.ok(pdv.includes('terminalStatusBannerHtml'), 'banner status PDV');
  assert.ok(pdv.includes('syncTerminalFromServer'), 'PDV sync terminal');
  assert.ok(
    /Este terminal ainda não está vinculado a um caixa/.test(pdv),
    'PDV mensagem sem caixa'
  );
  assert.ok(pdv.includes("post('vendas'"), 'POST /vendas oficial');
  assert.ok(pdv.includes('pre-calcular-distribuicao'), 'pré-cálculo oficial');
  console.log('OK 2 — Caixa gates + pipeline venda oficial');

  // —— PRECIFICAÇÃO (sem Motor Mobile / sem fallback silencioso) ——
  assert.ok(pdv.includes('resolverPrecosOficial'), 'helper resolver');
  assert.ok(pdv.includes('recalcularCarrinhoViaResolver'), 'recalc carrinho');
  assert.ok(pdv.includes('configuracao-comercial/resolver-precos'), 'endpoint oficial');
  assert.ok(!/canal:\s*['"]VAREJO['"]/.test(pdv), 'não força canal VAREJO');
  assert.ok(!/fallback preço da busca/.test(pdv), 'sem fallback silencioso busca');
  assert.ok(!/fallback cadastro/.test(pdv), 'sem fallback silencioso MUC');
  assert.ok(
    /Não foi possível obter o preço oficial do Resolver/.test(pdv),
    'erro Resolver explícito'
  );
  assert.ok(!/Motor Mobile|motorMobile|calcularAtacadoLocal/.test(pdv), 'sem Motor Mobile');
  console.log('OK 3 — Precificação só via Resolver (sem canal forçado)');

  // —— ATACADO contagem certificada (Motor Oficial) ——
  assert.strictEqual(
    contagem([{ forma_comercializacao: 'UNIDADE', quantidade: 30, participa_atacado: 1 }]),
    30,
    '30 UN = 30 itens'
  );
  assert.strictEqual(
    contagem([
      { forma_comercializacao: 'UNIDADE', quantidade: 29, participa_atacado: 1 },
      { forma_comercializacao: 'PESO', quantidade: 0.25, participa_atacado: 1 }
    ]),
    30,
    '29 UN + 1 PESO = 30 itens comerciais'
  );
  assert.strictEqual(
    contagem([
      { forma_comercializacao: 'UNIDADE', quantidade: 28, participa_atacado: 1 },
      { forma_comercializacao: 'PESO', quantidade: 0.25, participa_atacado: 1 },
      { forma_comercializacao: 'PESO', quantidade: 0.5, participa_atacado: 1 }
    ]),
    30,
    '28 UN + 2 PESO = 30 itens'
  );
  assert.strictEqual(
    contagem([{ forma_comercializacao: 'UNIDADE', quantidade: 29, participa_atacado: 1 }]),
    29,
    '29 UN = 29 itens (varejo abaixo do limiar típico 30)'
  );
  assert.ok(CANAL_VAREJO === 'VAREJO' && CANAL_ATACADO === 'ATACADO', 'canais oficiais');
  console.log('OK 4 — Contagem Atacado oficial (29+pote=30)');

  // —— CARRINHO / PAGAMENTO / SESSÃO / REDE ——
  assert.ok(pdv.includes('Produto adicionado'), 'feedback add');
  assert.ok(pdv.includes('Produto removido'), 'feedback remove');
  assert.ok(pdv.includes('Quantidade alterada'), 'feedback qty');
  assert.ok(pdv.includes('pdv-limpar'), 'limpar carrinho');
  assert.ok(/carrinho foi preservado/i.test(pdv), 'preserva carrinho em falha');
  assert.ok(pdv.includes("data-pay=\"dinheiro\""), 'pagamento dinheiro');
  assert.ok(pdv.includes("data-pay=\"pix\""), 'pagamento PIX');
  assert.ok(pdv.includes("data-pay=\"cartao\""), 'pagamento cartão');
  assert.ok(
    client.includes('Sua sessão expirou. Entre novamente para continuar.'),
    'mensagem sessão'
  );
  assert.ok(
    client.includes('Não foi possível conectar ao servidor.'),
    'mensagem rede'
  );
  assert.ok(
    client.includes('Servidor CDS não encontrado') || client.includes('Tempo esgotado'),
    'timeout/servidor'
  );
  console.log('OK 5 — UX feedback + sessão + rede + pagamentos');

  // —— NAV ——
  assert.ok(index.includes('data-route="pdv"'), 'nav vender');
  assert.ok(index.includes('data-route="pdv/caixa"'), 'nav caixa');
  assert.ok(index.includes('data-route="pdv/vendas"'), 'nav vendas');
  assert.ok(index.includes('data-route="clientes"'), 'nav clientes');
  assert.ok(perms.includes("'pdv/caixa'"), 'perms nav caixa');
  assert.ok(app.includes('resolveBottomNav'), 'highlight nav aninhada');
  console.log('OK 6 — Navegação priorizada');

  // —— OFFLINE: fila não na venda PDV ——
  assert.ok(!pdv.includes('enqueueOffline'), 'PDV não enfileira venda offline');
  assert.ok(offline.includes('cds-mobile-offline-queue-v1'), 'fila existe (prestação)');
  console.log('OK 7 — Sem venda offline no PDV');

  // —— DESKTOP intacto (contrato) ——
  const desktop = ler('frontend/pdv/js/pdv.js');
  assert.ok(desktop.includes('agendarRecalculoCanalComercialPdv'), 'desktop recalc preservado');
  assert.ok(desktop.includes('resolver-precos'), 'desktop resolver preservado');
  console.log('OK 8 — Desktop PDV preservado');

  console.log('\nRCM-9.2 PASSOU\n');
}

main();
process.exit(0);
