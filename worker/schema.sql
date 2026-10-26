-- Schema do D1. A tabela briefings é idêntica à do SQLite original —
-- D1 é SQLite, então o schema migra sem tradução.

CREATE TABLE IF NOT EXISTS briefings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  empresa     TEXT NOT NULL,
  email       TEXT NOT NULL,
  telefone    TEXT NOT NULL,
  servico     TEXT NOT NULL,
  mensagem    TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  status      TEXT NOT NULL DEFAULT 'novo',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_briefings_created_at ON briefings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefings_status     ON briefings(status);
CREATE INDEX IF NOT EXISTS idx_briefings_email      ON briefings(email);

-- O express-rate-limit guardava contadores em memória, o que não existe no
-- Worker (cada request pode cair em um isolate diferente). Persistimos aqui.
CREATE TABLE IF NOT EXISTS rate_limits (
  chave     TEXT PRIMARY KEY,
  contagem  INTEGER NOT NULL,
  janela_em INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_janela ON rate_limits(janela_em);

-- Catálogo interno de serviços e preços. Fica no banco, e não no código,
-- porque o repositório é público: um único documento JSON, lido só pela rota
-- protegida /api/catalogo. O conteúdo é carregado com `wrangler d1 execute`.
CREATE TABLE IF NOT EXISTS catalogo (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  dados         TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Painel interno: clientes, projetos, contratos, eventos, lançamentos e
-- processos. Uma tabela só, com o registro em JSON: o volume é pequeno, os
-- campos mudam com o uso, e a validação de cada tipo vive em src/admin.js.
CREATE TABLE IF NOT EXISTS registros (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo          TEXT NOT NULL,
  dados         TEXT NOT NULL,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_registros_tipo ON registros(tipo);
