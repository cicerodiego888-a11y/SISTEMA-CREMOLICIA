/**
 * RA-2 — Linha de Precificação
 * Produto → Linha → Tabela → Canal → Preço
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const root = path.join(__dirname, '../../..');
const db = require(path.join(root, 'database'));
const { bootstrapComercialV2Schema } = require(path.join(root, 'modules/comercial'));
const ComercialPrecoResolver = require(path.join(root, 'modules/comercial/preco/ComercialPrecoResolver'));
const LinhasComerciaisService = require(path.join(root, 'modules/comercial/linhas-comerciais/LinhasComerciaisService'));
const TabelasPrecoService = require(path.join(root, 'modules/comercial/tabelas-preco/TabelasPrecoService'));
const CanaisVendaService = require(path.join(root, 'modules/comercial/canais/CanaisVendaService'));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function ready() {
  return new Promise((resolve, reject) => {
    db.whenReady((err) => (err ? reject(err) : resolve()));
  });
}

describe('RA-2 — Linha de Precificação', () => {
  let canalVarejo;
  let linha;
  let tabela;
  let produtoId;
  const suffix = Date.now().toString(36);

  before(async () => {
    await ready();
    await bootstrapComercialV2Schema(db);
    ComercialPrecoResolver.setLogsHabilitados(false);
    ComercialPrecoResolver.invalidateCache();

    const canais = await CanaisVendaService.listar({ ativos: '1' });
    canalVarejo = canais.find((c) => String(c.codigo).toUpperCase() === 'VAREJO');
    assert.ok(canalVarejo, 'canal VAREJO');

    linha = await LinhasComerciaisService.criar({
      codigo: 'RA2_' + suffix,
      descricao: 'Linha RA2 ' + suffix,
      ativo: true
    });
    assert.ok(linha.id);

    tabela = await TabelasPrecoService.criar({
      codigo: 'T_RA2_' + suffix,
      nome: 'Tabela RA2 ' + suffix,
      ativo: true,
      linhas_ids: [linha.id],
      valores: [{
        linha_comercial_id: linha.id,
        canal_venda_id: canalVarejo.id,
        preco: 7.77,
        forma_comercializacao: 'UNIDADE',
        unidade_comercial: 'UN'
      }]
    });

    const prod = await run(
      `INSERT INTO produtos (nome, codigo, preco_venda, linha_comercial_id, ativo)
       VALUES (?, ?, 1.11, ?, 1)`,
      ['Prod RA2 ' + suffix, 'PRA2_' + suffix, linha.id]
    );
    produtoId = prod.lastID;
  });

  it('resolve Produto → Linha → Tabela → Canal', async () => {
    const produto = {
      id: produtoId,
      nome: 'Prod RA2',
      preco_venda: 1.11,
      linha_comercial_id: linha.id
    };
    const r = await ComercialPrecoResolver.resolver({
      produto,
      canal: 'VAREJO',
      tabela_preco_id: tabela.id
    });
    assert.equal(r.origem, ComercialPrecoResolver.ORIGEM_TABELA_LINHA);
    assert.equal(Number(r.preco_venda), 7.77);
    assert.equal(r.fallback, false);
    assert.equal(Number(r.linha_comercial_id), Number(linha.id));
    assert.equal(Number(r.tabela_preco_id), Number(tabela.id));
  });

  it('fallback para preço base sem match Linha×Tabela', async () => {
    const linhaVazia = await LinhasComerciaisService.criar({
      codigo: 'RA2_EMPTY_' + suffix,
      descricao: 'Linha vazia ' + suffix,
      ativo: true
    });
    const tabelaVazia = await TabelasPrecoService.criar({
      codigo: 'T_RA2_EMPTY_' + suffix,
      nome: 'Tabela vazia ' + suffix,
      ativo: true,
      linhas_ids: [linhaVazia.id],
      valores: [{
        linha_comercial_id: linhaVazia.id,
        canal_venda_id: canalVarejo.id,
        preco: 0.01,
        forma_comercializacao: 'UNIDADE',
        unidade_comercial: 'UN'
      }]
    });
    // Produto sem linha + tabela de outra linha → não casa oficialmente; usa preço base
    // (após remover o único valor, força fallback)
    await run('DELETE FROM tabela_preco_valores WHERE tabela_preco_id = ?', [tabelaVazia.id]);

    const r = await ComercialPrecoResolver.resolver({
      produto: {
        nome: 'Prod sem linha',
        preco_venda: 2.22
      },
      canal: 'VAREJO',
      tabela_preco_id: tabelaVazia.id
    });
    assert.equal(r.origem, ComercialPrecoResolver.ORIGEM_LEGADO);
    assert.equal(Number(r.preco_venda), 2.22);
  });
});
