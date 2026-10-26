import { Hono } from 'hono';

import { insertBriefing, listBriefings, getBriefing, getCatalogo } from './db.js';
import { briefingSchema } from './validation.js';
import { notifyNewBriefing, notifyQuestionario } from './mailer.js';
import { createToken, validateToken } from './tokens.js';
import { checarLimite, limparExpirados } from './ratelimit.js';

const app = new Hono();

const MIN = 60 * 1000;
const LIMITES = {
  briefing:    { janelaMs: 15 * MIN, max: 5 },
  token:       { janelaMs: 60 * MIN, max: 30 },
  questionario:{ janelaMs: 15 * MIN, max: 5 },
  // conta toda tentativa, certa ou errada: segura chute de senha
  catalogo:    { janelaMs: 15 * MIN, max: 10 },
};

// ============ MIDDLEWARES ============

function origensPermitidas(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Site e API são servidos pelo mesmo Worker, então o caso normal é same-origin.
// Isso precisa ser aceito explicitamente: o navegador manda o header Origin em
// POST mesmo na própria origem, e sem esta regra todo envio do site cairia no
// 403 de CORS. Além da própria origem, aceita as listadas em ALLOWED_ORIGINS
// (útil para manter o domínio antigo funcionando durante a transição) e
// requests sem Origin (curl, server-to-server), como no backend Express.
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const propria = new URL(c.req.url).origin;
  const permitidas = [propria, ...origensPermitidas(c.env)];

  if (origin && !permitidas.includes(origin)) {
    return c.json({ ok: false, error: 'Origem não permitida (CORS)' }, 403);
  }

  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cabecalhosCors(origin) });
  }

  await next();

  for (const [k, v] of Object.entries(cabecalhosCors(origin))) c.res.headers.set(k, v);
});

function cabecalhosCors(origin) {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-admin-token',
    'Vary': 'Origin',
  };
}

function ipDoCliente(c) {
  return c.req.header('CF-Connecting-IP') || 'desconhecido';
}

// Corpo limitado a 10kb, igual ao express.json({ limit: '10kb' }) original.
async function lerJson(c) {
  const tamanho = Number(c.req.header('Content-Length') || 0);
  if (tamanho > 10 * 1024) return { erro: 'Corpo grande demais' };
  try {
    return { body: await c.req.json() };
  } catch {
    return { erro: 'JSON inválido' };
  }
}

async function limitar(c, nome) {
  const { janelaMs, max } = LIMITES[nome];
  const r = await checarLimite(c.env.DB, {
    chave: `${nome}:${ipDoCliente(c)}`,
    janelaMs,
    max,
  });
  if (!r.permitido) {
    return c.json({ ok: false, error: 'Muitas tentativas. Tenta de novo em alguns minutos.' }, 429);
  }
  return null;
}

// ============ ROTAS ============

app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// === POST /api/briefings — formulário da landing ===
app.post('/api/briefings', async (c) => {
  const bloqueio = await limitar(c, 'briefing');
  if (bloqueio) return bloqueio;

  const { body, erro } = await lerJson(c);
  if (erro) return c.json({ ok: false, error: erro }, 400);

  const parsed = briefingSchema.safeParse(body);

  if (!parsed.success) {
    // honeypot preenchido: finge sucesso pro bot, sem persistir nem enviar email
    const isHoneypot = parsed.error.issues.some((i) => i.path[0] === 'website');
    if (isHoneypot) {
      console.warn('[honeypot] disparado, IP:', ipDoCliente(c));
      return c.json({ ok: true, message: 'Briefing recebido.' }, 200);
    }

    return c.json({
      ok: false,
      error: 'Dados inválidos',
      issues: parsed.error.issues.map((i) => ({ field: i.path[0], message: i.message })),
    }, 400);
  }

  const data = parsed.data;

  try {
    const briefing = await insertBriefing(c.env.DB, {
      nome: data.nome,
      empresa: data.empresa,
      email: data.email,
      telefone: data.telefone,
      servico: data.servico,
      mensagem: data.mensagem,
      ip: ipDoCliente(c),
      user_agent: c.req.header('User-Agent')?.slice(0, 500) || null,
    });

    console.log(`[briefing] #${briefing.id} salvo: ${briefing.empresa} (${briefing.email})`);

    // email não bloqueia a resposta. No Worker isso exige waitUntil: sem ele o
    // isolate é encerrado junto com a resposta e o envio morre pela metade.
    c.executionCtx.waitUntil(
      notifyNewBriefing(c.env, briefing).catch((err) => console.error('[email] erro no envio:', err)),
    );

    return c.json({
      ok: true,
      message: 'Briefing recebido. A gente entra em contato em até 48h úteis.',
      id: briefing.id,
    }, 201);
  } catch (err) {
    console.error('[briefing] erro:', err);
    return c.json({
      ok: false,
      error: 'Erro ao processar o briefing. Tenta de novo em alguns instantes.',
    }, 500);
  }
});

// === GET /api/briefings — listagem protegida ===
app.get('/api/briefings', async (c) => {
  const adminToken = c.env.ADMIN_TOKEN;
  if (!adminToken || c.req.header('x-admin-token') !== adminToken) {
    return c.json({ ok: false, error: 'Não autorizado' }, 401);
  }

  const limit = Math.min(Number(c.req.query('limit')) || 20, 100);
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0);
  const result = await listBriefings(c.env.DB, { limit, offset });

  return c.json({ ok: true, ...result, limit, offset });
});

// === GET /api/briefings/:id — detalhe protegido ===
app.get('/api/briefings/:id', async (c) => {
  const adminToken = c.env.ADMIN_TOKEN;
  if (!adminToken || c.req.header('x-admin-token') !== adminToken) {
    return c.json({ ok: false, error: 'Não autorizado' }, 401);
  }

  const briefing = await getBriefing(c.env.DB, Number(c.req.param('id')));
  if (!briefing) return c.json({ ok: false, error: 'Não encontrado' }, 404);
  return c.json({ ok: true, briefing });
});

// === POST /api/tokens/create — gera link de questionário (admin) ===
app.post('/api/tokens/create', async (c) => {
  const bloqueio = await limitar(c, 'token');
  if (bloqueio) return bloqueio;

  const { body, erro } = await lerJson(c);
  if (erro) return c.json({ ok: false, error: erro }, 400);

  const { adminKey, cliente } = body || {};
  const adminSecret = c.env.ADMIN_SECRET;

  if (!adminSecret || adminKey !== adminSecret) {
    return c.json({ ok: false, error: 'Senha incorreta.' }, 401);
  }
  if (!cliente?.trim()) {
    return c.json({ ok: false, error: 'Nome do cliente é obrigatório.' }, 400);
  }

  const token = await createToken(cliente.trim(), c.env.TOKEN_SECRET);
  // O site vive no mesmo Worker, então a origem do próprio request já é a base
  // certa do link — em produção e em `wrangler dev`, sem configurar nada.
  // FRONTEND_URL continua existindo só como override manual.
  const baseUrl = (c.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/$/, '');
  const link = `${baseUrl}/questionario?c=${token}`;

  console.log(`[token] criado para: ${cliente.trim()}`);

  // faxina oportunista das janelas de rate limit já vencidas
  c.executionCtx.waitUntil(limparExpirados(c.env.DB, 60 * MIN).catch(() => {}));

  return c.json({ ok: true, link, cliente: cliente.trim() });
});

// === GET /api/tokens/validate — valida antes de exibir o formulário ===
app.get('/api/tokens/validate', async (c) => {
  const result = await validateToken(c.req.query('token'), c.env.TOKEN_SECRET);
  if (!result) return c.json({ ok: false, error: 'Link inválido ou expirado.' }, 401);
  return c.json({ ok: true, cliente: result.cliente });
});

// === POST /api/questionario — recebe o diagnóstico respondido ===
app.post('/api/questionario', async (c) => {
  const bloqueio = await limitar(c, 'questionario');
  if (bloqueio) return bloqueio;

  const { body, erro } = await lerJson(c);
  if (erro) return c.json({ ok: false, error: erro }, 400);

  const { token, ...respostas } = body || {};
  const tokenData = await validateToken(token, c.env.TOKEN_SECRET);

  if (!tokenData) {
    return c.json({ ok: false, error: 'Link inválido ou expirado.' }, 401);
  }

  console.log(`[questionario] respondido por: ${tokenData.cliente}`);

  c.executionCtx.waitUntil(
    notifyQuestionario(c.env, { cliente: tokenData.cliente, respostas })
      .catch((err) => console.error('[email] erro questionário:', err)),
  );

  return c.json({ ok: true });
});

// === POST /api/catalogo — catálogo interno de serviços e preços (admin) ===
// POST, e não GET, para a senha ir no corpo e não ficar em log de URL.
app.post('/api/catalogo', async (c) => {
  const bloqueio = await limitar(c, 'catalogo');
  if (bloqueio) return bloqueio;

  const { body, erro } = await lerJson(c);
  if (erro) return c.json({ ok: false, error: erro }, 400);

  const adminSecret = c.env.ADMIN_SECRET;
  if (!adminSecret || body?.adminKey !== adminSecret) {
    return c.json({ ok: false, error: 'Senha incorreta.' }, 401);
  }

  const catalogo = await getCatalogo(c.env.DB);
  if (!catalogo) return c.json({ ok: false, error: 'Catálogo ainda não carregado.' }, 404);

  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, catalogo });
});

// 404. Chamada de API responde JSON, como antes. Já um caminho de página que
// não casou com nenhum asset recebe o 404.html — senão o visitante que errasse
// a URL veria um JSON cru na tela.
app.notFound(async (c) => {
  const caminho = new URL(c.req.url).pathname;
  if (caminho.startsWith('/api/') || caminho === '/health') {
    return c.json({ ok: false, error: 'Rota não encontrada' }, 404);
  }

  const pagina = await c.env.ASSETS.fetch(new URL('/404.html', c.req.url));
  return new Response(pagina.body, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

app.onError((err, c) => {
  console.error('[worker] erro não tratado:', err);
  return c.json({ ok: false, error: 'Erro interno' }, 500);
});

export default app;
