import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const dbPath = process.env.DATABASE_PATH || './data/crivo.db';

// garante que o diretório do banco existe
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// migração: cria a tabela se não existir
db.exec(`
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
`);

console.log(`[db] Conectado em ${dbPath}`);

// statements pré-compilados (mais rápidos)
const insertBriefingStmt = db.prepare(`
  INSERT INTO briefings (nome, empresa, email, telefone, servico, mensagem, ip, user_agent)
  VALUES (@nome, @empresa, @email, @telefone, @servico, @mensagem, @ip, @user_agent)
`);

const listBriefingsStmt = db.prepare(`
  SELECT * FROM briefings ORDER BY created_at DESC LIMIT ? OFFSET ?
`);

const countBriefingsStmt = db.prepare(`SELECT COUNT(*) as total FROM briefings`);

const getBriefingStmt = db.prepare(`SELECT * FROM briefings WHERE id = ?`);

export function insertBriefing(data) {
  const info = insertBriefingStmt.run(data);
  return getBriefingStmt.get(info.lastInsertRowid);
}

export function listBriefings({ limit = 20, offset = 0 } = {}) {
  return {
    items: listBriefingsStmt.all(limit, offset),
    total: countBriefingsStmt.get().total,
  };
}

export function getBriefing(id) {
  return getBriefingStmt.get(id);
}

export default db;
