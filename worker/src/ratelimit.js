// Rate limit persistido no D1.
//
// O express-rate-limit original guardava os contadores na memória do processo.
// No Worker isso não funciona: cada request pode cair num isolate diferente,
// e isolates são descartados a qualquer momento. Sem persistir, o limite
// simplesmente não existiria — pior que não ter, porque pareceria protegido.

export async function checarLimite(db, { chave, janelaMs, max }) {
  const agora = Date.now();
  const inicio = agora - janelaMs;

  const linha = await db
    .prepare(`SELECT contagem, janela_em FROM rate_limits WHERE chave = ?`)
    .bind(chave)
    .first();

  // primeira vez, ou a janela anterior já expirou: começa de novo
  if (!linha || linha.janela_em <= inicio) {
    await db
      .prepare(
        `INSERT INTO rate_limits (chave, contagem, janela_em) VALUES (?, 1, ?)
         ON CONFLICT(chave) DO UPDATE SET contagem = 1, janela_em = excluded.janela_em`,
      )
      .bind(chave, agora)
      .run();
    return { permitido: true, restante: max - 1 };
  }

  if (linha.contagem >= max) {
    const esperaMs = linha.janela_em + janelaMs - agora;
    return { permitido: false, esperaSegundos: Math.max(1, Math.ceil(esperaMs / 1000)) };
  }

  await db
    .prepare(`UPDATE rate_limits SET contagem = contagem + 1 WHERE chave = ?`)
    .bind(chave)
    .run();

  return { permitido: true, restante: max - linha.contagem - 1 };
}

// Limpa janelas velhas para a tabela não crescer sem limite.
// Roda oportunisticamente, fora do caminho da resposta.
export async function limparExpirados(db, maiorJanelaMs) {
  await db
    .prepare(`DELETE FROM rate_limits WHERE janela_em <= ?`)
    .bind(Date.now() - maiorJanelaMs)
    .run();
}
