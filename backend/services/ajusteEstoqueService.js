const MotorEstoque = require('../motores/motor-estoque');
const ajustesEmAndamento = new WeakMap();

function produtoTemMovimentacoes(db, produtoId, callback) {
  db.get(`
    SELECT
      (SELECT COUNT(*) FROM compras_itens WHERE produto_id = ?) AS compras,
      (SELECT COUNT(*) FROM vendas_itens WHERE produto_id = ?) AS vendas,
      (SELECT COUNT(*) FROM compras_devolucoes WHERE produto_id = ?) AS devolucoes,
      (SELECT COUNT(*) FROM produtos_ajustes_estoque WHERE produto_id = ?) AS ajustes,
      (SELECT COUNT(*) FROM produtos_lotes
        WHERE produto_id = ? AND COALESCE(origem, '') != 'ESTOQUE_INICIAL') AS lotes_mov,
      (SELECT COUNT(*) FROM estoque_movimentacoes WHERE produto_id = ?) AS motor_mov
  `, [produtoId, produtoId, produtoId, produtoId, produtoId, produtoId], (err, row) => {
    if (err) return callback(err);

    const tem = (
      Number(row?.compras || 0) > 0
      || Number(row?.vendas || 0) > 0
      || Number(row?.devolucoes || 0) > 0
      || Number(row?.ajustes || 0) > 0
      || Number(row?.lotes_mov || 0) > 0
      || Number(row?.motor_mov || 0) > 0
    );

    callback(null, tem);
  });
}

function registrarAjusteEstoque(db, dados, callback) {
  db.run(`
    INSERT INTO produtos_ajustes_estoque (
      produto_id, usuario_id, usuario_nome, motivo,
      ajuste_fiscal, ajuste_nao_fiscal,
      saldo_fiscal_antes, saldo_fiscal_depois,
      saldo_nao_fiscal_antes, saldo_nao_fiscal_depois,
      estoque_total_antes, estoque_total_depois
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    dados.produto_id,
    dados.usuario_id || null,
    dados.usuario_nome || null,
    dados.motivo,
    dados.ajuste_fiscal,
    dados.ajuste_nao_fiscal,
    dados.saldo_fiscal_antes,
    dados.saldo_fiscal_depois,
    dados.saldo_nao_fiscal_antes,
    dados.saldo_nao_fiscal_depois,
    dados.estoque_total_antes,
    dados.estoque_total_depois
  ], callback);
}

/**
 * MCC-04 / EST-MCC-01 — Ajuste de estoque.
 * Deltas devem estar em unidade base (conversão via EstoqueAdjustmentOrchestrator / MCC).
 * Persistência de saldo + auditoria oficial via MotorEstoque.
 */
function aplicarAjusteEstoqueProdutoInterno(db, opcoes, callback) {
  const {
    produtoId,
    ajusteFiscal,
    ajusteNaoFiscal,
    motivo,
    local,
    usuarioId,
    usuarioNome,
    lote,
    dataFabricacao,
    dataValidade,
    lotesService,
    loteId
  } = opcoes;

  const ajusteF = Number(ajusteFiscal || 0);
  const ajusteNF = Number(ajusteNaoFiscal || 0);

  if (!Number.isFinite(ajusteF) || !Number.isFinite(ajusteNF)) {
    return callback(new Error('Informe quantidades válidas para o ajuste fiscal e não fiscal.'));
  }
  if (ajusteF === 0 && ajusteNF === 0) {
    return callback(new Error('Informe ao menos um ajuste fiscal ou não fiscal diferente de zero.'));
  }

  if (!motivo || !String(motivo).trim()) {
    return callback(new Error('Motivo do ajuste é obrigatório.'));
  }

  db.get(
    `SELECT
       p.saldo_fiscal,
       p.saldo_nao_fiscal,
       p.controlar_validade,
       COALESCE(p.ativo, 1) AS ativo,
       p.categoria_id,
       COALESCE(c.ativo, 1) AS categoria_ativa
     FROM produtos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     WHERE p.id = ?`,
    [produtoId],
    (getErr, produto) => {
    if (getErr) return callback(getErr);
    if (!produto) return callback(new Error('Produto não encontrado.'));
    if (Number(produto.ativo) === 0) {
      return callback(new Error('Produto desabilitado: não é possível gerar ou ajustar estoque.'));
    }
    if (produto.categoria_id != null && Number(produto.categoria_ativa) === 0) {
      return callback(new Error('Categoria desabilitada: não é possível gerar ou ajustar estoque deste produto.'));
    }

    const saldoFiscalAntes = Number(produto.saldo_fiscal || 0);
    const saldoNaoFiscalAntes = Number(produto.saldo_nao_fiscal || 0);
    const estoqueTotalAntes = saldoFiscalAntes + saldoNaoFiscalAntes;

    const saldoFiscalDepois = Number((saldoFiscalAntes + ajusteF).toFixed(3));
    const saldoNaoFiscalDepois = Number((saldoNaoFiscalAntes + ajusteNF).toFixed(3));

    if (saldoFiscalDepois < 0) {
      return callback(new Error('Ajuste fiscal resultaria em saldo fiscal negativo.'));
    }
    if (saldoNaoFiscalDepois < 0) {
      return callback(new Error('Ajuste não fiscal resultaria em saldo não fiscal negativo.'));
    }

    const controlaValidade = produto.controlar_validade === 1;
    const ajusteTotalPositivo = Math.max(0, ajusteF) + Math.max(0, ajusteNF);
    const ajusteTotalNegativo = Math.abs(Math.min(0, ajusteF)) + Math.abs(Math.min(0, ajusteNF));

    const finalizarComMotorEstoque = (lotePersistidoId = null) => {
      MotorEstoque.ajustar(db, {
        produtoId,
        deltaFiscal: ajusteF,
        deltaNaoFiscal: ajusteNF,
        local,
        motivo: String(motivo).trim(),
        origem: MotorEstoque.OrigemEstoque.AJUSTE_MANUAL,
        loteId: lotePersistidoId || loteId || null,
        usuarioId,
        referenciaTipo: 'ajuste_estoque',
        referenciaId: opcoes.referenciaId ?? null
      }).then((resultado) => {
        if (resultado.repetida) {
          return callback(null, {
            saldo_fiscal: resultado.saldo_fiscal,
            saldo_nao_fiscal: resultado.saldo_nao_fiscal,
            estoque_atual: resultado.estoque_atual,
            local: resultado.local,
            saldo_local: resultado.saldo_local,
            motor: resultado.motor,
            movimentacao: resultado.movimentacao || null,
            repetida: true
          });
        }
        registrarAjusteEstoque(db, {
          produto_id: produtoId,
          usuario_id: usuarioId,
          usuario_nome: usuarioNome,
          motivo: String(motivo).trim(),
          ajuste_fiscal: ajusteF,
          ajuste_nao_fiscal: ajusteNF,
          saldo_fiscal_antes: saldoFiscalAntes,
          saldo_fiscal_depois: resultado.saldo_fiscal,
          saldo_nao_fiscal_antes: saldoNaoFiscalAntes,
          saldo_nao_fiscal_depois: resultado.saldo_nao_fiscal,
          estoque_total_antes: estoqueTotalAntes,
          estoque_total_depois: resultado.estoque_atual
        }, (histErr) => {
          if (histErr) return callback(histErr);
          callback(null, {
            saldo_fiscal: resultado.saldo_fiscal,
            saldo_nao_fiscal: resultado.saldo_nao_fiscal,
            estoque_atual: resultado.estoque_atual,
            local: resultado.local,
            saldo_local: resultado.saldo_local,
            motor: resultado.motor,
            movimentacao: resultado.movimentacao || null
          });
        });
      }).catch((err) => callback(err));
    };

    if (!controlaValidade || !lotesService) {
      return finalizarComMotorEstoque();
    }

    if (ajusteTotalPositivo > 0) {
      if (!dataValidade) {
        return callback(new Error('Para produtos com controle de validade, informe a data de validade no ajuste positivo.'));
      }

      const hoje = new Date().toISOString().split('T')[0];
      return lotesService.criarLote({
        produto_id: produtoId,
        lote: lote || undefined,
        quantidade_inicial: ajusteTotalPositivo,
        data_fabricacao: dataFabricacao || null,
        data_validade: dataValidade,
        data_entrada: hoje,
        origem: 'AJUSTE_ESTOQUE',
        compra_id: null
      }, (loteErr, loteCriado) => {
        if (loteErr) return callback(loteErr);
        finalizarComMotorEstoque(loteCriado?.id || null);
      });
    }

    if (ajusteTotalNegativo > 0) {
      return lotesService.consumirLotesFEFO(produtoId, ajusteTotalNegativo, (consumoErr) => {
        if (consumoErr) return callback(consumoErr);
        finalizarComMotorEstoque();
      });
    }

    finalizarComMotorEstoque();
  });
}

function aplicarAjusteEstoqueProduto(db, opcoes, callback) {
  const referenciaId = opcoes && opcoes.referenciaId;
  if (referenciaId == null || referenciaId === '') {
    return aplicarAjusteEstoqueProdutoInterno(db, opcoes, callback);
  }

  let operacoes = ajustesEmAndamento.get(db);
  if (!operacoes) {
    operacoes = new Map();
    ajustesEmAndamento.set(db, operacoes);
  }
  const produtoId = Number(opcoes.produtoId);
  const chave = String(referenciaId);
  const assinatura = JSON.stringify([
    produtoId,
    String(opcoes.local || 'LOJA').trim().toUpperCase(),
    Number(opcoes.ajusteFiscal || 0),
    Number(opcoes.ajusteNaoFiscal || 0),
    String(opcoes.motivo || '').trim()
  ]);
  const emAndamento = operacoes.get(chave);
  if (emAndamento) {
    if (emAndamento.assinatura !== assinatura) {
      const err = new Error('A chave de ajuste já está em uso em outra operação.');
      err.status = 409;
      return callback(err);
    }
    return emAndamento.promessa.then(
      (resultado) => callback(null, { ...resultado, repetida: true }),
      callback
    );
  }

  const operacao = new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM estoque_movimentacoes
      WHERE referencia_tipo = 'ajuste_estoque' AND referencia_id = ?
      LIMIT 1
    `, [referenciaId], (getErr, movimento) => {
      if (getErr) return reject(getErr);
      if (!movimento) {
        return aplicarAjusteEstoqueProdutoInterno(db, opcoes, (err, resultado) => {
          if (err) reject(err);
          else resolve(resultado);
        });
      }

      const local = String(opcoes.local || 'LOJA').trim().toUpperCase();
      const mesmaOperacao = Number(movimento.produto_id) === produtoId
        && String(movimento.local || '') === local
        && Math.round(Number(movimento.quantidade_fiscal) * 1000) / 1000
          === Math.round(Number(opcoes.ajusteFiscal || 0) * 1000) / 1000
        && Math.round(Number(movimento.quantidade_nao_fiscal) * 1000) / 1000
          === Math.round(Number(opcoes.ajusteNaoFiscal || 0) * 1000) / 1000
        && String(movimento.motivo || '') === String(opcoes.motivo || '').trim();
      if (!mesmaOperacao) {
        const err = new Error('A chave de ajuste já foi utilizada em outra operação.');
        err.status = 409;
        return reject(err);
      }

      Promise.all([
        MotorEstoque.consultarSaldo(db, produtoId),
        MotorEstoque.consultarSaldoLocal(db, produtoId, local)
      ]).then(([saldo, saldoLocal]) => resolve({
        saldo_fiscal: saldo.saldoFiscal,
        saldo_nao_fiscal: saldo.saldoNaoFiscal,
        estoque_atual: saldo.estoqueAtual,
        local,
        saldo_local: saldoLocal,
        motor: MotorEstoque.MOTOR_ESTOQUE_NOME,
        movimentacao: MotorEstoque.MovimentacaoEstoque.criar(movimento).toJSON(),
        repetida: true
      }), reject);
    });
  });

  const registro = { promessa: operacao, assinatura };
  operacoes.set(chave, registro);
  operacao.then(
    () => { if (operacoes.get(chave) === registro) operacoes.delete(chave); },
    () => { if (operacoes.get(chave) === registro) operacoes.delete(chave); }
  );
  operacao.then(
    (resultado) => callback(null, resultado),
    callback
  );
}

function definirSaldosIniciaisProduto(saldoFiscal, saldoNaoFiscal) {
  const fiscal = Number(saldoFiscal || 0);
  const naoFiscal = Number(saldoNaoFiscal || 0);
  if (fiscal < 0 || naoFiscal < 0) {
    throw new Error('Saldos iniciais não podem ser negativos.');
  }
  const estoqueAtual = Number((fiscal + naoFiscal).toFixed(3));
  return {
    saldo_fiscal: fiscal,
    saldo_nao_fiscal: naoFiscal,
    estoque_atual: estoqueAtual
  };
}

module.exports = {
  produtoTemMovimentacoes,
  registrarAjusteEstoque,
  aplicarAjusteEstoqueProduto,
  definirSaldosIniciaisProduto
};
