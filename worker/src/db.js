// Camada de dados sobre o D1. As queries são as mesmas do backend Node —
// muda só a API: better-sqlite3 é síncrono, o D1 é assíncrono.

export async function insertBriefing(db, data) {
  return db
    .prepare(
      `INSERT INTO briefings (nome, empresa, email, telefone, servico, mensagem, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(
      data.nome,
      data.empresa,
      data.email,
      data.telefone,
      data.servico,
      data.mensagem,
      data.ip ?? null,
      data.user_agent ?? null,
    )
    .first();
}

export async function listBriefings(db, { limit = 20, offset = 0 } = {}) {
  const [itens, total] = await Promise.all([
    db.prepare(`SELECT * FROM briefings ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(limit, offset)
      .all(),
    db.prepare(`SELECT COUNT(*) AS total FROM briefings`).first(),
  ]);

  return { items: itens.results ?? [], total: total?.total ?? 0 };
}

export async function getBriefing(db, id) {
  return db.prepare(`SELECT * FROM briefings WHERE id = ?`).bind(id).first();
}
