'use strict';

const MotorEstoque = require('../../motores/motor-estoque');

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function erro(mensagem, codigo, statusCode = 400) {
  const err = new Error(mensagem);
  err.code = codigo;
  err.statusCode = statusCode;
  return err;
}

async function consultarEstoqueInsumo(db, produtoId) {
  const id = Number(produtoId);
  if (!Number.isInteger(id) || id <= 0) {
    throw erro('O produto informado é inválido.', 'PRODUTO_INVALIDO');
  }

  const produto = await get(db, `
    SELECT id, unidade
    FROM produtos
    WHERE id = ? AND UPPER(TRIM(COALESCE(natureza_cadastro, ''))) = 'INSUMO'
  `, [id]);
  if (!produto) throw erro('Insumo não encontrado.', 'INSUMO_NAO_ENCONTRADO', 404);

  const [fabrica, loja] = await Promise.all([
    MotorEstoque.consultarSaldoLocal(db, id, MotorEstoque.LOCAL_FABRICA),
    MotorEstoque.consultarSaldoLocal(db, id, MotorEstoque.LOCAL_LOJA)
  ]);
  const mapearSaldo = (saldo) => {
    const saldoFiscal = Number(saldo.saldoFiscal || 0);
    const saldoNaoFiscal = Number(saldo.saldoNaoFiscal || 0);
    return {
      saldo_fiscal: saldoFiscal,
      saldo_nao_fiscal: saldoNaoFiscal,
      total: Math.round((saldoFiscal + saldoNaoFiscal) * 1000) / 1000
    };
  };

  return {
    produto_id: Number(produto.id),
    unidade: produto.unidade || '',
    fabrica: mapearSaldo(fabrica),
    loja: mapearSaldo(loja)
  };
}

module.exports = { consultarEstoqueInsumo };
