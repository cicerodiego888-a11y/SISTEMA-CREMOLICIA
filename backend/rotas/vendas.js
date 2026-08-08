const express = require('express');
const router = express.Router();
const db = require('../database');
const { validarCaixaAberto, validarCaixaAbertoCancelamentoVenda, validarCaixaAbertoDevolucaoVenda } = require('../middleware/validarCaixaAberto');
const { exigirSenhaAdmin } = require('../middleware/exigirSenhaAdmin');
const {
  FILTRO_VENDA_VALIDA,
  isModoFiscalRelatorio,
  getExprValorVenda,
  getExprValorItem,
  getExprValorItemFiscal,
  getExprValorItemNaoFiscal,
  getExprQuantidadeItem,
  getExprQuantidadeItemFiscal,
  getExprQuantidadeItemNaoFiscal,
  getFiltroItensFiscal
} = require('../services/reportFiscalHelpers');
const VendaFinanceiroService = require('../services/vendas/VendaFinanceiroService');
const VendaPagamentoService = require('../services/vendas/VendaPagamentoService');
const VendaDevolucaoService = require('../services/vendas/VendaDevolucaoService');
const VendaCancelamentoService = require('../services/vendas/VendaCancelamentoService');

const { agoraLocalBrasil } = VendaFinanceiroService;
const {
  preCalcularDistribuicao,
  criarVenda,
  consultarPagamentoNaoFiscal,
  registrarPagamentoNaoFiscal
} = VendaPagamentoService;
const { devolverParcial } = VendaDevolucaoService;
const { cancelarVendaPut, cancelarVendaPost } = VendaCancelamentoService;
const comprovanteVendaService = require('../services/comprovanteVendaService');

// Listar vendas com busca
router.get('/', (req, res) => {
  const busca = String(req.query.busca || '').trim();
  const todas = req.query.todas === '1';
  const somenteFiscal = String(req.query.modo || '').toLowerCase() === 'fiscal';

  let where = '';
  const params = [];

  if (busca) {
    where = `
      WHERE (
        v.id LIKE ?
        OR v.codigo LIKE ?
        OR c.nome LIKE ?
        OR v.forma_pagamento LIKE ?
        OR v.status LIKE ?
      )
    `;

    const termo = `%${busca}%`;
    params.push(termo, termo, termo, termo, termo);
  }

  if (!todas) {
    const dataHoje = agoraLocalBrasil().slice(0, 10);
    where += (where ? ' AND ' : ' WHERE ');
    where += ` v.data_venda = ? `;
    params.push(dataHoje);
  }

  if (somenteFiscal) {
    where += (where ? ' AND ' : ' WHERE ');
    where += ` n.id IS NOT NULL `;
  }

  db.all(`
    SELECT
      v.id,
      v.codigo,
      v.data_venda,
      v.created_at,
      v.cliente_id,
      v.total,
      v.valor_fiscal,
      v.valor_nao_fiscal,
      v.desconto,
      v.forma_pagamento,
      v.status,
      n.id AS nfce_id,
      n.numero AS nfce_numero,
      n.status AS nfce_status,
      n.chave_acesso AS nfce_chave,
      c.nome AS cliente_nome,
      (
        SELECT COUNT(*)
        FROM vendas_itens vi
        WHERE vi.venda_id = v.id
      ) AS total_itens
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN nfce_notas n ON n.id = (
      SELECT n2.id
      FROM nfce_notas n2
      WHERE n2.venda_id = v.id
      ORDER BY n2.id DESC
      LIMIT 1
    )
    ${where}
    ORDER BY v.data_venda DESC, v.id DESC
  `, params, (err, rows) => {
    if (err) {
      console.error('Erro ao listar vendas:', err);
      return res.status(500).json({ error: err.message });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json(rows || []);
  });
});

// Buscar venda por ID
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get(`
    SELECT
      v.*,
      c.nome AS cliente_nome,
      c.cpf_cnpj AS cliente_cpf,
      n.id AS nfce_id,
      n.numero AS nfce_numero,
      n.status AS nfce_status,
      n.chave_acesso AS nfce_chave
    FROM vendas v
    LEFT JOIN clientes c ON v.cliente_id = c.id
    LEFT JOIN nfce_notas n ON n.id = (
      SELECT n2.id
      FROM nfce_notas n2
      WHERE n2.venda_id = v.id
      ORDER BY n2.id DESC
      LIMIT 1
    )
    WHERE v.id = ?
  `, [id], (err, venda) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    db.all(`
      SELECT vi.*, p.nome as produto_nome, p.codigo as produto_codigo, p.unidade
      FROM vendas_itens vi
      JOIN produtos p ON vi.produto_id = p.id
      WHERE vi.venda_id = ?
    `, [id], async (err, itens) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      try {
        const svc = require('../modules/comercial/casquinha/CasquinhaSaboresService');
        const comSabores = [];
        for (const it of itens || []) {
          let sabores = [];
          if (Number(it.quantidade_bolas || 0) > 0 || String(it.forma_comercializacao || '').toUpperCase() === 'CASQUINHA') {
            sabores = await svc.listarSaboresDoItem(it.id);
          }
          comSabores.push({ ...it, sabores });
        }
        res.json({ ...venda, itens: comSabores });
      } catch (_) {
        res.json({ ...venda, itens });
      }
    });
  });
});

// Buscar detalhes completos da venda para emissão de NFC-e
router.get('/:id/detalhes', (req, res) => {
  const vendaId = req.params.id;

  db.get(`
    SELECT v.*, c.nome as cliente_nome
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE v.id = ?
  `, [vendaId], (err, venda) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    db.all(`
      SELECT vi.*, p.nome as produto_nome
      FROM vendas_itens vi
      JOIN produtos p ON p.id = vi.produto_id
      WHERE vi.venda_id = ?
    `, [vendaId], (errItens, itens) => {
      if (errItens) return res.status(500).json({ error: errItens.message });

      res.json({
        venda,
        itens
      });
    });
  });
});

/** COMPROVANTE DE VENDA (comercial) — sem dados fiscais internos / MIDP */
router.get('/:id/comprovante', (req, res) => {
  const vendaId = req.params.id;
  const asHtml = String(req.query.format || '').toLowerCase() === 'html';

  comprovanteVendaService.gerarComprovanteVenda(vendaId, (err, result) => {
    if (err) {
      const status = err.status || 500;
      return res.status(status).json({ error: err.message });
    }
    if (asHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(result.html);
    }
    return res.json({
      sucesso: true,
      venda_id: Number(vendaId),
      html: result.html,
      dados: {
        cupom: result.dados.cupom,
        total: result.dados.total,
        itens: result.dados.itens.map((it) => ({
          produto_nome: it.produto_nome,
          quantidade: it.quantidade,
          unidade: it.unidade,
          preco_unitario: it.preco_unitario,
          subtotal: it.subtotal
        })),
        pagamentos: comprovanteVendaService.consolidarPagamentos(result.dados.pagamentos)
      }
    });
  });
});

router.post('/pre-calcular-distribuicao', validarCaixaAberto, preCalcularDistribuicao);

router.post('/', validarCaixaAberto, criarVenda);

router.get('/:id/pagamento-nao-fiscal', consultarPagamentoNaoFiscal);

router.post('/:id/pagamento-nao-fiscal', validarCaixaAberto, registrarPagamentoNaoFiscal);

router.post('/:id/devolver', validarCaixaAbertoDevolucaoVenda, exigirSenhaAdmin, (req, res) => {
  const vendaId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim();
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

  devolverParcial(vendaId, motivo, itens, req, res);
});

router.put('/:id/cancelar', validarCaixaAbertoCancelamentoVenda, (req, res) => {
  const { id } = req.params;
  const motivo = req.body.motivo || req.body.justificativa || '';
  cancelarVendaPut(id, motivo, req, res);
});

router.post('/cancelar/:id', validarCaixaAbertoCancelamentoVenda, (req, res) => {
  const vendaId = req.params.id;
  const { motivo } = req.body;
  cancelarVendaPost(vendaId, motivo, req, res);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);

  db.get(`
    SELECT *
    FROM vendas
    WHERE id = ?
  `, [id], (err, venda) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    if (venda.nfce_id) {
      return res.status(400).json({
        error: 'Venda fiscal não pode ser excluída. Cancele a NFC-e primeiro.'
      });
    }

    db.run(`
      DELETE FROM vendas_itens WHERE venda_id = ?
    `, [id], (errItens) => {
      if (errItens) {
        return res.status(500).json({ error: errItens.message });
      }

      db.run(`
        DELETE FROM vendas WHERE id = ?
      `, [id], (errVenda) => {
        if (errVenda) {
          return res.status(500).json({ error: errVenda.message });
        }

        res.json({
          success: true,
          message: 'Venda excluída com sucesso'
        });
      });
    });
  });
});

router.get('/relatorio/fechamento-caixa', (req, res) => {
  const { data_inicio, data_fim, modo_fiscal } = req.query;

  if (!data_inicio || !data_fim) {
    return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios' });
  }

  const modoFiscal = modo_fiscal || '0';
  const exprValor = getExprValorVenda(modoFiscal);

  db.all(`
    SELECT
      forma_pagamento,
      COUNT(*) as quantidade,
      SUM(${exprValor}) as total
    FROM vendas v
    WHERE ${FILTRO_VENDA_VALIDA}
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
    GROUP BY forma_pagamento
    ORDER BY total DESC
  `, [data_inicio, data_fim], (err, pagamentos) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    db.get(`
      SELECT
        COUNT(*) as quantidade_vendas,
        SUM(${exprValor}) as total_vendido,
        SUM(desconto) as total_descontos,
        AVG(${exprValor}) as ticket_medio
      FROM vendas v
      WHERE ${FILTRO_VENDA_VALIDA}
        AND date(v.data_venda) BETWEEN date(?) AND date(?)
    `, [data_inicio, data_fim], (errResumo, resumo) => {
      if (errResumo) {
        return res.status(500).json({ error: errResumo.message });
      }

      res.json({
        modo_fiscal_ativo: isModoFiscalRelatorio(modoFiscal),
        resumo: resumo || {
          quantidade_vendas: 0,
          total_vendido: 0,
          total_descontos: 0,
          ticket_medio: 0
        },
        pagamentos: pagamentos || []
      });
    });
  });
});

router.get('/relatorio/produtos-mais-vendidos', (req, res) => {
  const { data_inicio, data_fim, modo_fiscal, limite } = req.query;

  if (!data_inicio || !data_fim) {
    return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios' });
  }

  const modoFiscal = modo_fiscal || '0';
  const exprValor = getExprValorItem(modoFiscal);
  const exprQtd = getExprQuantidadeItem(modoFiscal);
  const exprQtdFiscal = getExprQuantidadeItemFiscal();
  const exprQtdNaoFiscal = getExprQuantidadeItemNaoFiscal();
  const exprValorFiscal = getExprValorItem('1');
  const exprValorNaoFiscal = getExprValorItemNaoFiscal();
  const filtroItens = getFiltroItensFiscal(modoFiscal);
  const limit = Math.min(Math.max(parseInt(limite, 10) || 100, 1), 500);

  db.all(`
    SELECT
      p.id,
      p.codigo,
      p.nome,
      p.unidade,
      SUM(${exprQtd}) as quantidade_vendida,
      SUM(${exprQtdFiscal}) as quantidade_fiscal,
      SUM(${exprQtdNaoFiscal}) as quantidade_nao_fiscal,
      SUM(${exprValor}) as total_vendido,
      SUM(${exprValorFiscal}) as total_vendido_fiscal,
      SUM(${exprValorNaoFiscal}) as total_vendido_nao_fiscal,
      CASE
        WHEN SUM(${exprQtd}) > 0 THEN SUM(${exprValor}) / SUM(${exprQtd})
        ELSE AVG(vi.preco_unitario)
      END as preco_medio
    FROM vendas v
    INNER JOIN vendas_itens vi ON v.id = vi.venda_id
    INNER JOIN produtos p ON vi.produto_id = p.id
    WHERE ${FILTRO_VENDA_VALIDA}
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
      ${filtroItens}
    GROUP BY p.id
    HAVING quantidade_vendida > 0
    ORDER BY total_vendido DESC
    LIMIT ?
  `, [data_inicio, data_fim, limit], (err, produtos) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({
      modo_fiscal_ativo: isModoFiscalRelatorio(modoFiscal),
      produtos: produtos || []
    });
  });
});

router.get('/relatorio/periodo', (req, res) => {
  const { data_inicio, data_fim, modo_fiscal } = req.query;
  const modoFiscal = modo_fiscal || '0';
  const exprValor = getExprValorVenda(modoFiscal);

  db.all(`
    SELECT
      DATE(v.data_venda) as data,
      COUNT(*) as total_vendas,
      SUM(${exprValor}) as valor_total,
      AVG(${exprValor}) as valor_medio,
      SUM(CASE WHEN v.cliente_id IS NOT NULL THEN 1 ELSE 0 END) as vendas_com_cliente
    FROM vendas v
    WHERE ${FILTRO_VENDA_VALIDA}
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
    GROUP BY DATE(v.data_venda)
    ORDER BY data DESC
  `, [data_inicio, data_fim], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({
      modo_fiscal_ativo: isModoFiscalRelatorio(modoFiscal),
      dias: rows || []
    });
  });
});

module.exports = router;
