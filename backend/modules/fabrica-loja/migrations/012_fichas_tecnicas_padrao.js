'use strict';

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function bootstrapFichasTecnicasPadrao(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas_padrao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL CHECK (trim(codigo) <> ''),
      nome TEXT NOT NULL CHECK (trim(nome) <> ''),
      ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_codigo
    ON fichas_tecnicas_padrao(lower(trim(codigo)))
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas_padrao_versoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ficha_padrao_id INTEGER NOT NULL REFERENCES fichas_tecnicas_padrao(id) ON DELETE RESTRICT,
      numero_versao INTEGER NOT NULL CHECK (numero_versao > 0),
      estado TEXT NOT NULL DEFAULT 'EM_EDICAO'
        CHECK (estado IN ('EM_EDICAO', 'PUBLICADA')),
      rendimento_quantidade REAL NOT NULL CHECK (rendimento_quantidade > 0),
      rendimento_unidade TEXT NOT NULL CHECK (trim(rendimento_unidade) <> ''),
      observacoes TEXT,
      publicada_em TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE (ficha_padrao_id, numero_versao),
      UNIQUE (id, ficha_padrao_id)
    )
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_versoes_ficha
    ON fichas_tecnicas_padrao_versoes(ficha_padrao_id, numero_versao)
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas_padrao_versao_componentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      versao_id INTEGER NOT NULL REFERENCES fichas_tecnicas_padrao_versoes(id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL,
      produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
      descricao TEXT NOT NULL,
      quantidade REAL NOT NULL CHECK (quantidade > 0),
      unidade TEXT NOT NULL CHECK (trim(unidade) <> ''),
      observacao TEXT,
      UNIQUE (versao_id, produto_id),
      UNIQUE (versao_id, ordem)
    )
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_versao_componentes_ordem
    ON fichas_tecnicas_padrao_versao_componentes(versao_id, ordem)
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas_padrao_versao_etapas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      versao_id INTEGER NOT NULL REFERENCES fichas_tecnicas_padrao_versoes(id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL,
      titulo TEXT NOT NULL CHECK (trim(titulo) <> ''),
      descricao TEXT,
      tempo_minutos REAL CHECK (tempo_minutos IS NULL OR tempo_minutos >= 0),
      observacao TEXT,
      UNIQUE (versao_id, ordem)
    )
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas_padrao_versao_informacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      versao_id INTEGER NOT NULL REFERENCES fichas_tecnicas_padrao_versoes(id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL,
      titulo TEXT NOT NULL CHECK (trim(titulo) <> ''),
      valor TEXT,
      UNIQUE (versao_id, ordem)
    )
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas_padrao_vinculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ficha_padrao_id INTEGER NOT NULL REFERENCES fichas_tecnicas_padrao(id) ON DELETE RESTRICT,
      produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
      versao_id INTEGER NOT NULL,
      politica_atualizacao TEXT NOT NULL DEFAULT 'APROVACAO_INDIVIDUAL'
        CHECK (politica_atualizacao = 'APROVACAO_INDIVIDUAL'),
      ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE (id, ficha_padrao_id),
      FOREIGN KEY (versao_id, ficha_padrao_id)
        REFERENCES fichas_tecnicas_padrao_versoes(id, ficha_padrao_id) ON DELETE RESTRICT
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_vinculos_produto_ficha_ativo
    ON fichas_tecnicas_padrao_vinculos(produto_id, ficha_padrao_id)
    WHERE ativo = 1
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_vinculos_ficha
    ON fichas_tecnicas_padrao_vinculos(ficha_padrao_id, ativo)
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas_padrao_ajustes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vinculo_id INTEGER NOT NULL,
      ficha_padrao_id INTEGER NOT NULL,
      produto_base_id INTEGER REFERENCES produtos(id) ON DELETE RESTRICT,
      produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
      operacao TEXT NOT NULL CHECK (operacao IN ('HERDAR', 'SUBSTITUIR', 'ADICIONAR', 'REMOVER')),
      quantidade REAL,
      unidade TEXT,
      justificativa TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (vinculo_id, ficha_padrao_id)
        REFERENCES fichas_tecnicas_padrao_vinculos(id, ficha_padrao_id) ON DELETE RESTRICT,
      CHECK (
        (operacao IN ('HERDAR', 'REMOVER')
          AND produto_base_id IS NOT NULL
          AND produto_id = produto_base_id
          AND quantidade IS NULL
          AND (unidade IS NULL OR trim(unidade) = ''))
        OR
        (operacao = 'SUBSTITUIR'
          AND produto_base_id IS NOT NULL
          AND produto_id = produto_base_id
          AND quantidade > 0
          AND unidade IS NOT NULL
          AND trim(unidade) <> '')
        OR
        (operacao = 'ADICIONAR'
          AND produto_base_id IS NULL
          AND quantidade > 0
          AND unidade IS NOT NULL
          AND trim(unidade) <> '')
      )
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_ajustes_produto
    ON fichas_tecnicas_padrao_ajustes(vinculo_id, produto_id)
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_ajustes_componente_base
    ON fichas_tecnicas_padrao_ajustes(vinculo_id, produto_base_id)
    WHERE produto_base_id IS NOT NULL
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_ajustes_vinculo
    ON fichas_tecnicas_padrao_ajustes(vinculo_id, id)
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas_padrao_revisoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ficha_padrao_id INTEGER NOT NULL,
      vinculo_id INTEGER NOT NULL,
      versao_anterior_id INTEGER NOT NULL,
      versao_nova_id INTEGER NOT NULL,
      estado TEXT NOT NULL DEFAULT 'PENDENTE'
        CHECK (estado IN ('PENDENTE', 'APROVADO', 'MANTER_ANTERIOR', 'SUPERADA')),
      justificativa TEXT,
      decidido_em TEXT,
      usuario_id INTEGER,
      usuario_nome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE (vinculo_id, versao_nova_id),
      FOREIGN KEY (vinculo_id, ficha_padrao_id)
        REFERENCES fichas_tecnicas_padrao_vinculos(id, ficha_padrao_id) ON DELETE RESTRICT,
      FOREIGN KEY (versao_anterior_id, ficha_padrao_id)
        REFERENCES fichas_tecnicas_padrao_versoes(id, ficha_padrao_id) ON DELETE RESTRICT,
      FOREIGN KEY (versao_nova_id, ficha_padrao_id)
        REFERENCES fichas_tecnicas_padrao_versoes(id, ficha_padrao_id) ON DELETE RESTRICT
    )
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_revisoes_estado
    ON fichas_tecnicas_padrao_revisoes(ficha_padrao_id, versao_nova_id, estado)
  `);

  await run(db, `
    CREATE TRIGGER IF NOT EXISTS trg_fichas_tecnicas_padrao_versoes_publicada_update
    BEFORE UPDATE ON fichas_tecnicas_padrao_versoes
    WHEN OLD.estado = 'PUBLICADA'
    BEGIN
      SELECT RAISE(ABORT, 'Versão publicada é imutável.');
    END
  `);
  await run(db, `
    CREATE TRIGGER IF NOT EXISTS trg_fichas_tecnicas_padrao_versoes_publicada_delete
    BEFORE DELETE ON fichas_tecnicas_padrao_versoes
    WHEN OLD.estado = 'PUBLICADA'
    BEGIN
      SELECT RAISE(ABORT, 'Versão publicada não pode ser excluída.');
    END
  `);

  for (const [tabela, campo] of [
    ['fichas_tecnicas_padrao_versao_componentes', 'versao_id'],
    ['fichas_tecnicas_padrao_versao_etapas', 'versao_id'],
    ['fichas_tecnicas_padrao_versao_informacoes', 'versao_id']
  ]) {
    await run(db, `
      CREATE TRIGGER IF NOT EXISTS trg_${tabela}_publicada_insert
      BEFORE INSERT ON ${tabela}
      WHEN EXISTS (
        SELECT 1 FROM fichas_tecnicas_padrao_versoes
        WHERE id = NEW.${campo} AND estado = 'PUBLICADA'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Conteúdo de versão publicada é imutável.');
      END
    `);
    await run(db, `
      CREATE TRIGGER IF NOT EXISTS trg_${tabela}_publicada_update
      BEFORE UPDATE ON ${tabela}
      WHEN EXISTS (
        SELECT 1 FROM fichas_tecnicas_padrao_versoes
        WHERE id IN (OLD.${campo}, NEW.${campo}) AND estado = 'PUBLICADA'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Conteúdo de versão publicada é imutável.');
      END
    `);
    await run(db, `
      CREATE TRIGGER IF NOT EXISTS trg_${tabela}_publicada_delete
      BEFORE DELETE ON ${tabela}
      WHEN EXISTS (
        SELECT 1 FROM fichas_tecnicas_padrao_versoes
        WHERE id = OLD.${campo} AND estado = 'PUBLICADA'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Conteúdo de versão publicada é imutável.');
      END
    `);
  }

  await run(db, `
    CREATE TRIGGER IF NOT EXISTS trg_fichas_tecnicas_padrao_ajustes_vinculo_ativo_insert
    BEFORE INSERT ON fichas_tecnicas_padrao_ajustes
    WHEN NOT EXISTS (
      SELECT 1 FROM fichas_tecnicas_padrao_vinculos
      WHERE id = NEW.vinculo_id AND ficha_padrao_id = NEW.ficha_padrao_id AND ativo = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'Ajustes exigem vínculo ativo.');
    END
  `);
  await run(db, `
    CREATE TRIGGER IF NOT EXISTS trg_fichas_tecnicas_padrao_ajustes_vinculo_ativo_update
    BEFORE UPDATE ON fichas_tecnicas_padrao_ajustes
    WHEN NOT EXISTS (
      SELECT 1 FROM fichas_tecnicas_padrao_vinculos
      WHERE id = NEW.vinculo_id AND ficha_padrao_id = NEW.ficha_padrao_id AND ativo = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'Ajustes exigem vínculo ativo.');
    END
  `);
  await run(db, `
    CREATE TRIGGER IF NOT EXISTS trg_fichas_tecnicas_padrao_ajustes_vinculo_ativo_delete
    BEFORE DELETE ON fichas_tecnicas_padrao_ajustes
    WHEN NOT EXISTS (
      SELECT 1 FROM fichas_tecnicas_padrao_vinculos
      WHERE id = OLD.vinculo_id AND ficha_padrao_id = OLD.ficha_padrao_id AND ativo = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'Ajustes exigem vínculo ativo.');
    END
  `);
}

module.exports = bootstrapFichasTecnicasPadrao;
