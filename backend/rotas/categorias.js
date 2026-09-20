const express = require('express');
const router = express.Router();
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');
const CategoriaLinhaComercialService = require('../modules/comercial/categoria-linha/CategoriaLinhaComercialService');

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function normalizarValoresBody(valores) {
  if (!Array.isArray(valores)) return [];
  return valores
    .filter((v) => v && v.preco != null && v.preco !== '')
    .map((v) => ({
      canal_venda_id: Number(v.canal_venda_id),
      preco: Number(v.preco),
      forma_comercializacao: v.forma_comercializacao
        ? String(v.forma_comercializacao).toUpperCase()
        : null,
      unidade_comercial: v.unidade_comercial
        ? String(v.unidade_comercial).toUpperCase()
        : null
    }));
}

// LISTAR
router.get('/', (req, res) => {
  const { tipo } = req.query;

  let sql = 'SELECT * FROM categorias WHERE 1=1';
  const params = [];

  if (tipo) {
    sql += ' AND tipo = ?';
    params.push(tipo);
  }

  sql += ' ORDER BY id ASC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ erro: 'Erro ao listar categorias' });
    res.json(rows);
  });
});

// Comercial da categoria (RCM-05.6)
router.get('/:id/comercial', async (req, res) => {
  try {
    const data = await CategoriaLinhaComercialService.obterComercialCategoria(req.params.id);
    if (!data) return res.status(404).json({ erro: 'Categoria não encontrada' });
    res.json(data);
  } catch (error) {
    res.status(error.statusCode || 500).json({ erro: error.message || 'Erro ao obter comercial' });
  }
});

router.put('/:id/comercial', async (req, res) => {
  try {
    const valores = normalizarValoresBody(req.body?.valores || []);
    const data = await CategoriaLinhaComercialService.salvarValoresComerciais(
      req.params.id,
      valores
    );
    res.json(data);
  } catch (error) {
    res.status(error.statusCode || 500).json({ erro: error.message || 'Erro ao salvar comercial' });
  }
});

router.post('/:id/desativar', async (req, res) => {
  try {
    const catAntes = await dbGet('SELECT * FROM categorias WHERE id = ?', [req.params.id]);
    if (!catAntes) return res.status(404).json({ erro: 'Categoria não encontrada' });

    const produtosAfetados = await dbGet(
      'SELECT COUNT(*) AS total FROM produtos WHERE categoria_id = ?',
      [req.params.id]
    );
    const linha = await CategoriaLinhaComercialService.desativarPorCategoria(req.params.id);
    const cat = await dbGet('SELECT * FROM categorias WHERE id = ?', [req.params.id]);
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.nome || req.user?.username || null,
      modulo: 'categorias',
      acao: 'desativar_categoria',
      referencia_tipo: 'categoria',
      referencia_id: req.params.id,
      detalhes: {
        linha_comercial_id: linha?.id || null,
        produtos_desabilitados: Number(produtosAfetados?.total || 0),
        cascade_produtos: true,
        cascade_subcategorias: true
      },
      ip_requisicao: req.ip || null
    }).catch(() => {});
    res.json({
      message: 'Categoria desativada. Produtos e subcategorias da categoria também foram desabilitados.',
      ...cat,
      linha,
      produtos_desabilitados: Number(produtosAfetados?.total || 0)
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ erro: error.message || 'Erro ao desativar' });
  }
});

router.post('/:id/ativar', async (req, res) => {
  try {
    const catAntes = await dbGet('SELECT * FROM categorias WHERE id = ?', [req.params.id]);
    if (!catAntes) return res.status(404).json({ erro: 'Categoria não encontrada' });

    const produtosAfetados = await dbGet(
      'SELECT COUNT(*) AS total FROM produtos WHERE categoria_id = ?',
      [req.params.id]
    );
    const linha = await CategoriaLinhaComercialService.ativarPorCategoria(req.params.id);
    const cat = await dbGet('SELECT * FROM categorias WHERE id = ?', [req.params.id]);
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.nome || req.user?.username || null,
      modulo: 'categorias',
      acao: 'ativar_categoria',
      referencia_tipo: 'categoria',
      referencia_id: req.params.id,
      detalhes: {
        linha_comercial_id: linha?.id || null,
        produtos_habilitados: Number(produtosAfetados?.total || 0),
        cascade_produtos: true,
        cascade_subcategorias: true
      },
      ip_requisicao: req.ip || null
    }).catch(() => {});
    res.json({
      message: 'Categoria habilitada. Produtos e subcategorias da categoria também foram reabilitados.',
      ...cat,
      linha,
      produtos_habilitados: Number(produtosAfetados?.total || 0)
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ erro: error.message || 'Erro ao ativar' });
  }
});

// BUSCAR POR ID
router.get('/:id', async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM categorias WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ erro: 'Categoria não encontrada' });

    let comercial = null;
    try {
      if (String(row.tipo || 'produto') === 'produto') {
        comercial = await CategoriaLinhaComercialService.obterComercialCategoria(row.id);
      }
    } catch (_) {
      comercial = null;
    }

    res.json({
      ...row,
      linha_comercial_id: comercial?.linha?.id || row.linha_comercial_id || null,
      linha: comercial?.linha || null,
      valores: comercial?.valores || [],
      casquinha: comercial?.casquinha || null,
      casquinha_bolas_min: comercial?.casquinha?.bolas_min ?? row.casquinha_bolas_min,
      casquinha_bolas_max: comercial?.casquinha?.bolas_max ?? row.casquinha_bolas_max,
      casquinha_permitir_repetir: comercial?.casquinha?.permitir_repetir != null
        ? (comercial.casquinha.permitir_repetir ? 1 : 0)
        : row.casquinha_permitir_repetir
    });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar categoria' });
  }
});

// CRIAR
router.post('/', async (req, res) => {
  try {
    const { nome, descricao, tipo, codigo, valores, ativo, casquinha } = req.body;

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ erro: 'Nome é obrigatório' });
    }

    if (tipo && !['produto', 'despesa'].includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo inválido' });
    }

    const nomeTrim = String(nome).trim();
    const tipoFinal = tipo || 'produto';
    const result = await dbRun(
      `INSERT INTO categorias (nome, descricao, tipo, codigo, ativo)
       VALUES (?, ?, ?, ?, ?)`,
      [
        nomeTrim,
        descricao || '',
        tipoFinal,
        codigo ? String(codigo).trim().toUpperCase() : null,
        ativo === 0 || ativo === false || ativo === '0' ? 0 : 1
      ]
    );

    const categoriaId = result.lastID;
    // A-1: categoria NÃO cria Política Comercial
    try {
      if (casquinha || req.body.casquinha_bolas_max != null) {
        await CategoriaLinhaComercialService.salvarConfigCasquinha(categoriaId, {
          ...(casquinha || {}),
          casquinha_bolas_min: req.body.casquinha_bolas_min,
          casquinha_bolas_max: req.body.casquinha_bolas_max,
          casquinha_permitir_repetir: req.body.casquinha_permitir_repetir
        });
      }
    } catch (cfgErr) {
      console.warn('[A-1] Falha ao salvar casquinha na categoria:', cfgErr.message);
    }

    if (Array.isArray(valores) && valores.length) {
      console.warn(
        '[A-1] Valores comerciais ignorados no cadastro de categoria. Use Políticas Comerciais.'
      );
    }

    const row = await dbGet('SELECT * FROM categorias WHERE id = ?', [categoriaId]);
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.nome || req.user?.username || null,
      modulo: 'categorias',
      acao: 'criar_categoria',
      referencia_tipo: 'categoria',
      referencia_id: categoriaId,
      detalhes: { nome: nomeTrim, politica_auto_criada: false },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de categoria:', auditErr));

    res.json({ ...row, linha: null });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ erro: 'Categoria já existe' });
    }
    console.error('Erro ao criar categoria:', err);
    res.status(500).json({ erro: 'Erro ao criar categoria' });
  }
});

// ATUALIZAR
router.put('/:id', async (req, res) => {
  try {
    const { nome, descricao, tipo, codigo, valores, ativo, casquinha } = req.body;

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ erro: 'Nome é obrigatório' });
    }

    if (tipo && !['produto', 'despesa'].includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo inválido' });
    }

    const nomeTrim = String(nome).trim();
    const tipoFinal = tipo || 'produto';
    const ativoFlag = ativo === undefined ? undefined : (ativo === 0 || ativo === false || ativo === '0' ? 0 : 1);

    if (ativoFlag !== undefined) {
      await dbRun(
        `UPDATE categorias SET nome = ?, descricao = ?, tipo = ?, codigo = COALESCE(?, codigo), ativo = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [
          nomeTrim,
          descricao || '',
          tipoFinal,
          codigo ? String(codigo).trim().toUpperCase() : null,
          ativoFlag,
          req.params.id
        ]
      );
    } else {
      await dbRun(
        `UPDATE categorias SET nome = ?, descricao = ?, tipo = ?, codigo = COALESCE(?, codigo),
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [
          nomeTrim,
          descricao || '',
          tipoFinal,
          codigo ? String(codigo).trim().toUpperCase() : null,
          req.params.id
        ]
      );
    }

    // A-1: não sincroniza / não cria Política a partir da categoria
    if (Object.prototype.hasOwnProperty.call(req.body, 'valores') && Array.isArray(valores) && valores.length) {
      console.warn(
        '[A-1] Valores comerciais ignorados na atualização de categoria. Use Políticas Comerciais.'
      );
    }

    if (
      casquinha ||
      req.body.casquinha_bolas_min != null ||
      req.body.casquinha_bolas_max != null ||
      req.body.casquinha_permitir_repetir != null
    ) {
      await CategoriaLinhaComercialService.salvarConfigCasquinha(req.params.id, {
        ...(casquinha || {}),
        casquinha_bolas_min: req.body.casquinha_bolas_min,
        casquinha_bolas_max: req.body.casquinha_bolas_max,
        casquinha_permitir_repetir: req.body.casquinha_permitir_repetir
      });
    }

    const row = await dbGet('SELECT * FROM categorias WHERE id = ?', [req.params.id]);
    const linha = await CategoriaLinhaComercialService.sincronizarCategoria(req.params.id).catch(() => null);
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.nome || req.user?.username || null,
      modulo: 'categorias',
      acao: 'atualizar_categoria',
      referencia_tipo: 'categoria',
      referencia_id: req.params.id,
      detalhes: {
        depois: { nome: nomeTrim, tipo: tipoFinal, politica_auto_criada: false }
      },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de categoria:', auditErr));

    res.json({ ...row, linha });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ erro: 'Já existe outra categoria com esse nome' });
    }
    console.error('Erro ao atualizar categoria:', err);
    res.status(err.statusCode || 500).json({ erro: err.message || 'Erro ao atualizar categoria' });
  }
});

// EXCLUIR → desativa (não remove fisicamente a Linha Comercial)
router.delete('/:id', async (req, res) => {
  const categoriaId = req.params.id;

  try {
    const rowProdutos = await dbGet(
      'SELECT COUNT(*) AS total FROM produtos WHERE categoria_id = ?',
      [categoriaId]
    );
    if ((rowProdutos?.total || 0) > 0) {
      return res.status(400).json({ erro: 'Não é possível excluir: categoria vinculada a produtos' });
    }

    const rowSub = await dbGet(
      'SELECT COUNT(*) AS total FROM subcategorias WHERE categoria_id = ?',
      [categoriaId]
    );
    if ((rowSub?.total || 0) > 0) {
      return res.status(400).json({ erro: 'Não é possível excluir: categoria vinculada a subcategorias' });
    }

    const rowFin = await dbGet(
      `SELECT COUNT(*) AS total FROM financeiro
       WHERE categoria = (SELECT nome FROM categorias WHERE id = ?)`,
      [categoriaId]
    );
    if ((rowFin?.total || 0) > 0) {
      return res.status(400).json({ erro: 'Não é possível excluir: categoria já utilizada no financeiro' });
    }

    // Soft-delete: desativa categoria; Política Comercial permanece independente
    await CategoriaLinhaComercialService.desativarPorCategoria(categoriaId);

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.nome || req.user?.username || null,
      modulo: 'categorias',
      acao: 'desativar_categoria',
      referencia_tipo: 'categoria',
      referencia_id: categoriaId,
      detalhes: { modo: 'delete_soft', politica_preservada: true },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de exclusão de categoria:', auditErr));

    res.json({ message: 'Categoria desativada (Política Comercial não é alterada)' });
  } catch (err) {
    console.error('Erro ao excluir/desativar categoria:', err);
    res.status(500).json({ erro: 'Erro ao excluir categoria' });
  }
});

module.exports = router;
