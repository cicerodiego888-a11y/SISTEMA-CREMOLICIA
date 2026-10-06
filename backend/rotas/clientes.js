const express = require('express');
const router = express.Router();
const db = require('../database');
const { verificarToken: autenticarToken } = require('../middleware/auth');
const { gravarAuditoria } = require('../services/auditoria');
const { validarInscricaoEstadual } = require('../services/fiscal/inscricaoEstadual');

function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase();
}

const SELECT_CLIENTE = `
  SELECT
    c.*,
    tc.codigo AS tipo_comercial_codigo,
    tc.descricao AS tipo_comercial_descricao,
    tc.canal_padrao AS tipo_comercial_canal
  FROM clientes c
  LEFT JOIN tipos_comerciais tc ON tc.id = c.tipo_comercial_id
`;

/** CPF/CNPJ persistido só com dígitos; vazio vira NULL (cpf_cnpj é UNIQUE e aceita vários NULL). */
function normalizarCpfCnpj(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos || null;
}

const SQL_CPF_CNPJ_DUPLICADO = `
  SELECT id, nome, cpf_cnpj FROM clientes
  WHERE REPLACE(REPLACE(REPLACE(cpf_cnpj, ".", ""), "-", ""), "/", "") = ?`;

function mensagemCpfCnpjDuplicado(nome) {
  return `Já existe um cliente cadastrado com este CPF/CNPJ: ${nome}`;
}

function enriquecerEndereco(row) {
  if (!row) return row;
  row.cep = row.cep || '';
  row.rua = row.rua || '';
  row.numero = row.numero || '';
  row.bairro = row.bairro || '';
  row.cidade = row.cidade || '';
  row.uf = row.uf || '';
  return row;
}

function obterTipoComercialIdPadrao(cb) {
  db.get(
    `SELECT id FROM tipos_comerciais WHERE UPPER(codigo) = 'CONSUMIDOR_FINAL' LIMIT 1`,
    [],
    (err, row) => {
      if (err) return cb(err);
      cb(null, row?.id || null);
    }
  );
}

function resolverTipoComercialId(body, cb) {
  const raw = body.tipo_comercial_id ?? body.tipoComercialId ?? null;
  if (raw != null && raw !== '') {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
      return cb(Object.assign(new Error('Tipo Comercial inválido'), { statusCode: 400 }));
    }
    return db.get(
      `SELECT id FROM tipos_comerciais WHERE id = ? AND ativo = 1`,
      [id],
      (err, row) => {
        if (err) return cb(err);
        if (!row) {
          return cb(Object.assign(new Error('Tipo Comercial não encontrado ou inativo'), { statusCode: 400 }));
        }
        cb(null, row.id);
      }
    );
  }
  obterTipoComercialIdPadrao(cb);
}

// Listar todos os clientes
router.get('/', (req, res) => {
  db.all(`${SELECT_CLIENTE} ORDER BY c.nome`, (err, rows) => {
    if (err) {
      // Compat: tabela tipos_comerciais ainda não migrada
      if (/no such table/i.test(err.message || '')) {
        return db.all('SELECT * FROM clientes ORDER BY nome', (err2, rows2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(rows2);
        });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Buscar clientes por termo (nome, CPF ou telefone)
router.get('/buscar', autenticarToken, (req, res) => {
  const termo = (req.query.termo || '').trim();
  if (!termo) {
    return res.json([]);
  }

  const termoNormalizado = normalizarTexto(termo);
  const termoNumeros = termo.replace(/\D/g, '');
  const sql = `
    SELECT id, nome, cpf_cnpj, telefone, tipo_comercial_id
    FROM clientes
    ORDER BY nome ASC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Erro ao buscar clientes:', err);
      return res.status(500).json({ error: 'Erro ao buscar clientes' });
    }

    const filtrados = (rows || []).filter(cliente => {
      const nome = normalizarTexto(cliente.nome);
      const cpf = String(cliente.cpf_cnpj || '');
      const telefone = String(cliente.telefone || '');
      const cpfTelefoneMatch = termoNumeros && (cpf.replace(/\D/g, '').includes(termoNumeros) || telefone.replace(/\D/g, '').includes(termoNumeros));
      return nome.includes(termoNormalizado) || cpfTelefoneMatch;
    }).slice(0, 20);

    res.json(filtrados);
  });
});

// Vendas do cliente (histórico de compras)
router.get('/:id/vendas', (req, res) => {
  const { id } = req.params;
  db.all(`
    SELECT v.*, (SELECT COUNT(*) FROM vendas_itens WHERE venda_id = v.id) as total_itens
    FROM vendas v
    WHERE v.cliente_id = ? AND v.status = 'concluida'
    ORDER BY v.data_venda DESC, v.id DESC
  `, [id], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Buscar cliente por ID
router.get('/:id', (req, res) => {
  const { id } = req.params;
  db.get(`${SELECT_CLIENTE} WHERE c.id = ?`, [id], (err, row) => {
    if (err) {
      if (/no such table/i.test(err.message || '')) {
        return db.get('SELECT * FROM clientes WHERE id = ?', [id], (err2, row2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(enriquecerEndereco(row2));
        });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json(enriquecerEndereco(row));
  });
});

// Criar cliente
router.post('/', (req, res) => {
  const { nome } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'O campo nome é obrigatório.' });
  }

  const ie = validarInscricaoEstadual(req.body.inscricao_estadual);
  if (!ie.valido) return res.status(400).json({ error: ie.mensagem });
  req.body.inscricao_estadual = ie.ie;

  const cpfCnpjLimpo = normalizarCpfCnpj(req.body.cpf_cnpj);
  req.body.cpf_cnpj = cpfCnpjLimpo;

  if (cpfCnpjLimpo) {
    db.get(SQL_CPF_CNPJ_DUPLICADO, [cpfCnpjLimpo], (err, clienteExistente) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao verificar CPF/CNPJ: ' + err.message });
      }

      if (clienteExistente) {
        return res.status(409).json({
          success: false,
          message: mensagemCpfCnpjDuplicado(clienteExistente.nome)
        });
      }

      inserirCliente(req, res);
    });
  } else {
    inserirCliente(req, res);
  }
});

function inserirCliente(req, res) {
  const { nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limite_credito, inscricao_estadual } = req.body;

  let limiteCreditoNum = parseFloat(limite_credito);
  if (isNaN(limiteCreditoNum)) limiteCreditoNum = 0;

  resolverTipoComercialId(req.body, (errTipo, tipoId) => {
    if (errTipo) {
      return res.status(errTipo.statusCode || 500).json({ error: errTipo.message });
    }
    if (!tipoId) {
      return res.status(400).json({ error: 'Tipo Comercial é obrigatório.' });
    }

    db.run(`
      INSERT INTO clientes (nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limite_credito, credito_atual,
        tipo_comercial_id, inscricao_estadual)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `, [nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limiteCreditoNum, tipoId, inscricao_estadual],
      function onInsert(err) {
        if (err) {
          if (/no such column/i.test(err.message || '')) {
            return db.run(`
              INSERT INTO clientes (nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limite_credito, credito_atual)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            `, [nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limiteCreditoNum],
              function onInsertLegacy(err2) {
                if (err2) return res.status(500).json({ error: 'Erro ao criar cliente: ' + err2.message });
                res.json({ id: this.lastID, message: 'Cliente criado com sucesso' });
              });
          }
          return res.status(500).json({ error: 'Erro ao criar cliente: ' + err.message });
        }
        gravarAuditoria({
          usuario_id: req.user?.id || null,
          usuario_nome: req.user?.nome || req.user?.username || null,
          modulo: 'clientes',
          acao: 'criar_cliente',
          referencia_tipo: 'cliente',
          referencia_id: this.lastID,
          detalhes: { nome, tipo_comercial_id: tipoId },
          ip_requisicao: req.ip || null
        }).catch((auditErr) => console.error('Erro ao gravar auditoria de cliente:', auditErr));

        res.json({ id: this.lastID, message: 'Cliente criado com sucesso' });
      });
  });
}

const CAMPOS_TEXTO_CLIENTE = ['nome', 'telefone', 'email', 'cep', 'rua', 'numero', 'bairro', 'cidade', 'uf'];

/** Campo presente no corpo (inclusive '', 0 e null); ausente/undefined preserva o valor atual. */
function campoInformado(body, campo) {
  return Object.prototype.hasOwnProperty.call(body, campo) && body[campo] !== undefined;
}

function tipoComercialInformado(body) {
  const raw = body.tipo_comercial_id ?? body.tipoComercialId;
  return raw != null && raw !== '';
}

/** Une o cadastro atual com os campos realmente enviados no PUT. */
function mesclarClienteAtualizado(atual, body) {
  const novo = {};
  for (const campo of CAMPOS_TEXTO_CLIENTE) {
    novo[campo] = campoInformado(body, campo) ? body[campo] : atual[campo];
  }
  novo.cpf_cnpj = campoInformado(body, 'cpf_cnpj') ? normalizarCpfCnpj(body.cpf_cnpj) : atual.cpf_cnpj;
  novo.inscricao_estadual = campoInformado(body, 'inscricao_estadual')
    ? validarInscricaoEstadual(body.inscricao_estadual).ie
    : (atual.inscricao_estadual ?? null);
  if (campoInformado(body, 'limite_credito')) {
    const limite = parseFloat(body.limite_credito);
    novo.limite_credito = Number.isNaN(limite) ? 0 : limite;
  } else {
    novo.limite_credito = atual.limite_credito;
  }
  return novo;
}

/** Tipo Comercial enviado é validado; ausente mantém o atual (ou o padrão, se o cliente ainda não tiver). */
function resolverTipoComercialAtualizacao(atual, body, cb) {
  if (!tipoComercialInformado(body) && atual.tipo_comercial_id != null) {
    return cb(null, atual.tipo_comercial_id);
  }
  resolverTipoComercialId(body, cb);
}

function verificarCpfCnpjDuplicadoNaAtualizacao(id, cpfCnpj, cb) {
  if (!cpfCnpj) return cb(null, null);
  db.get(`${SQL_CPF_CNPJ_DUPLICADO} AND id <> ?`, [cpfCnpj, id], cb);
}

function erroCpfCnpjUnico(err) {
  return /UNIQUE constraint failed: clientes\.cpf_cnpj/i.test((err && err.message) || '');
}

function responderCpfCnpjDuplicado(res, nome) {
  const message = nome ? mensagemCpfCnpjDuplicado(nome) : 'Já existe um cliente cadastrado com este CPF/CNPJ.';
  return res.status(409).json({ success: false, message, error: message });
}

// Atualizar cliente
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  if (campoInformado(body, 'nome') && !String(body.nome ?? '').trim()) {
    return res.status(400).json({ error: 'O campo nome é obrigatório.' });
  }
  if (campoInformado(body, 'inscricao_estadual')) {
    const ie = validarInscricaoEstadual(body.inscricao_estadual);
    if (!ie.valido) return res.status(400).json({ error: ie.mensagem });
  }

  db.get('SELECT * FROM clientes WHERE id = ?', [id], (errAtual, atual) => {
    if (errAtual) {
      return res.status(500).json({ error: 'Erro ao carregar cliente: ' + errAtual.message });
    }
    if (!atual) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    const novo = mesclarClienteAtualizado(atual, body);
    if (!String(novo.nome ?? '').trim()) {
      return res.status(400).json({ error: 'O campo nome é obrigatório.' });
    }

    verificarCpfCnpjDuplicadoNaAtualizacao(id, novo.cpf_cnpj, (errDup, duplicado) => {
      if (errDup) {
        return res.status(500).json({ error: 'Erro ao verificar CPF/CNPJ: ' + errDup.message });
      }
      if (duplicado) return responderCpfCnpjDuplicado(res, duplicado.nome);

      resolverTipoComercialAtualizacao(atual, body, (errTipo, tipoId) => {
        if (errTipo) {
          return res.status(errTipo.statusCode || 500).json({ error: errTipo.message });
        }
        if (!tipoId) {
          return res.status(400).json({ error: 'Tipo Comercial é obrigatório.' });
        }

        const valores = [novo.nome, novo.cpf_cnpj, novo.telefone, novo.email, novo.cep, novo.rua, novo.numero,
          novo.bairro, novo.cidade, novo.uf, novo.limite_credito];
        db.run(`
          UPDATE clientes
          SET nome = ?, cpf_cnpj = ?, telefone = ?, email = ?, cep = ?, rua = ?, numero = ?,
              bairro = ?, cidade = ?, uf = ?, limite_credito = ?, tipo_comercial_id = ?, inscricao_estadual = ?
          WHERE id = ?
        `, [...valores, tipoId, novo.inscricao_estadual, id],
          function onUpdate(err) {
            if (err) {
              if (erroCpfCnpjUnico(err)) return responderCpfCnpjDuplicado(res);
              if (/no such column/i.test(err.message || '')) {
                return db.run(`
                  UPDATE clientes
                  SET nome = ?, cpf_cnpj = ?, telefone = ?, email = ?, cep = ?, rua = ?, numero = ?,
                      bairro = ?, cidade = ?, uf = ?, limite_credito = ?
                  WHERE id = ?
                `, [...valores, id],
                  function onUpdateLegacy(err2) {
                    if (err2) {
                      if (erroCpfCnpjUnico(err2)) return responderCpfCnpjDuplicado(res);
                      return res.status(500).json({ error: 'Erro ao atualizar cliente: ' + err2.message });
                    }
                    res.json({ message: 'Cliente atualizado com sucesso' });
                  });
              }
              return res.status(500).json({ error: 'Erro ao atualizar cliente: ' + err.message });
            }
            gravarAuditoria({
              usuario_id: req.user?.id || null,
              usuario_nome: req.user?.nome || req.user?.username || null,
              modulo: 'clientes',
              acao: 'atualizar_cliente',
              referencia_tipo: 'cliente',
              referencia_id: id,
              detalhes: { depois: { ...novo, tipo_comercial_id: tipoId }, campos_enviados: Object.keys(body) },
              ip_requisicao: req.ip || null
            }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de cliente:', auditErr));

            res.json({ message: 'Cliente atualizado com sucesso' });
          });
      });
    });
  });
});

// Deletar cliente
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  db.get(
    'SELECT COUNT(*) as total FROM vendas WHERE cliente_id = ?',
    [id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (row && row.total > 0) {
        return res.status(400).json({
          error: 'Não é possível excluir o cliente, pois existem vendas vinculadas a este cadastro.'
        });
      }

      db.run('DELETE FROM clientes WHERE id = ?', [id], function onDelete(errDel) {
        if (errDel) {
          return res.status(500).json({ error: errDel.message });
        }

        gravarAuditoria({
          usuario_id: req.user?.id || null,
          usuario_nome: req.user?.nome || req.user?.username || null,
          modulo: 'clientes',
          acao: 'excluir_cliente',
          referencia_tipo: 'cliente',
          referencia_id: id,
          detalhes: {},
          ip_requisicao: req.ip || null
        }).catch((auditErr) => console.error('Erro ao gravar auditoria de exclusão de cliente:', auditErr));

        res.json({ message: 'Cliente deletado com sucesso' });
      });
    }
  );
});

module.exports = router;
