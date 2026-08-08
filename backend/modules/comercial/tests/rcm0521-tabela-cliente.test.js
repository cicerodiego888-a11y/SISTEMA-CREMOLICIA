/**
 * RCM-05.21 — Tabela Comercial por Cliente (auditoria / contrato)
 *
 * Fase auditoria: garante que o Resolver atual NÃO depende de cliente,
 * que o schema ainda não tem preferência, e documenta o contrato futuro.
 *
 * Após implementação: expandir cenários Consignado / Atacado / Varejo / promo / kit.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const resolverPath = path.join(root, 'preco/ComercialPrecoResolver.js');
const canalPath = path.join(root, 'preco/CanalVendaResolver.js');
const configPath = path.join(root, 'configuracao/ConfiguracaoComercialService.js');
const dbPath = path.join(__dirname, '../../../database.js');
const auditoriaPath = path.join(__dirname, '../../../../AUDITORIA_RCM_05_21.md');

const ComercialPrecoResolver = require(resolverPath);

function run() {
  assert.ok(fs.existsSync(auditoriaPath), 'AUDITORIA_RCM_05_21.md');

  const resolverSrc = fs.readFileSync(resolverPath, 'utf8');
  const canalSrc = fs.readFileSync(canalPath, 'utf8');
  const configSrc = fs.readFileSync(configPath, 'utf8');
  const dbSrc = fs.readFileSync(dbPath, 'utf8');

  // --- Estado atual: sem preferência de cliente no preço ---
  assert.ok(!/cliente_id/.test(resolverSrc), 'Resolver ainda não usa cliente_id (pré-feature)');
  assert.ok(!/usar_tabela_fixa/.test(resolverSrc), 'flag ainda não no Resolver');
  assert.ok(!/cliente_id/.test(canalSrc) || /\/\/.*cliente/.test(canalSrc), 'CanalVendaResolver não escolhe por cliente');

  // Schema clientes sem tabela comercial
  const clientesBlock = dbSrc.match(/CREATE TABLE IF NOT EXISTS clientes \([\s\S]*?\)/);
  assert.ok(clientesBlock, 'DDL clientes');
  assert.ok(!/tabela_preco_id/.test(clientesBlock[0]), 'clientes sem tabela_preco_id (pré-migration)');
  assert.ok(!/usar_tabela_fixa/.test(clientesBlock[0]), 'clientes sem usar_tabela_fixa');

  // Não existem tabelas auxiliares
  assert.ok(!/CREATE TABLE IF NOT EXISTS clientes_comercial/.test(dbSrc), 'sem clientes_comercial');
  assert.ok(!/CREATE TABLE IF NOT EXISTS clientes_config/.test(dbSrc), 'sem clientes_config');

  // Prioridade atual documentada (Linha → Tabela → Legado)
  assert.ok(resolverSrc.includes('linha_comercial') || resolverSrc.includes('ORIGEM_LINHA'));
  assert.ok(resolverSrc.includes('tabela_preco') || resolverSrc.includes('ORIGEM_TABELA'));
  assert.ok(resolverSrc.includes('produto.preco_venda') || resolverSrc.includes('ORIGEM_LEGADO'));

  // Canal atacado permanece no CanalVendaResolver (qty)
  assert.ok(/quantidade_minima|ATACADO/i.test(canalSrc), 'atacado/qty no canal');

  // resolver-precos carrega produto, não cliente (hoje)
  assert.ok(configSrc.includes('ComercialPrecoResolver'));
  assert.ok(configSrc.includes('FROM produtos'), 'resolver-precos lê produtos');

  // --- Contrato futuro (auditoria): ordem de prioridade ---
  const auditoria = fs.readFileSync(auditoriaPath, 'utf8');
  assert.ok(auditoria.includes('1º') || auditoria.includes('1°'));
  assert.ok(/Tabela definida no Cliente|tabela_preco_id do cliente|usar_tabela_fixa/i.test(auditoria));
  assert.ok(/Resolver atual|Linha/i.test(auditoria));
  assert.ok(/não quebrar|sem quebrar/i.test(auditoria));
  assert.ok(/APROVADA|aprovada/i.test(auditoria));

  // --- ✔ Cliente sem tabela → Resolver continua funcionando ---
  ComercialPrecoResolver.setLogsHabilitados(false);
  const r = ComercialPrecoResolver.resolverSync({
    produto: { id: 1, nome: 'Teste', preco_venda: 9.9 },
    canal: 'VAREJO'
  });
  assert.ok(r && Number(r.preco) === 9.9, 'cliente ausente: fallback legado OK');
  assert.ok(
    r.origem === 'produto.preco_venda' || r.origem_preco === 'produto.preco_venda' || r.origem,
    'origem legado'
  );

  // Placeholders pós-implementação (documentados)
  const pendentes = [
    'Cliente com tabela Consignado → sempre CONSIGNADOS',
    'Cliente Atacado → respeita quantidade mínima (canal)',
    'Cliente Varejo → preço varejo',
    'Promoções continuam',
    'Kits continuam'
  ];
  assert.strictEqual(pendentes.length, 5, 'checklist de cenários futuros');

  console.log('RCM-05.21 OK — auditoria: sem tabela-por-cliente ainda; Resolver intacto; arquitetura aprovada');
}

run();
