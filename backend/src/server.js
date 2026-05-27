import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';

import { insertBriefing, listBriefings, getBriefing } from './db.js';
import { briefingSchema } from './validation.js';
import { notifyNewBriefing, notifyQuestionario } from './mailer.js';
import { createToken, validateToken } from './tokens.js';

const app = express();
const port = Number(process.env.PORT || 3000);

// ============ MIDDLEWARES ============
app.set('trust proxy', 1); // necessário pra rate limit funcionar atrás de proxy (Railway, etc)
app.use(express.json({ limit: '10kb' }));

// CORS — só aceita requests das origens declaradas
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // permite requests sem origin (ex: curl, mobile apps, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin not allowed: ${origin}`));
  },
}));

const briefingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas tentativas. Tenta de novo em alguns minutos.' },
});

const tokenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas tentativas.' },
});

const questionarioLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas tentativas.' },
});

// ============ ROTAS ============

// health check pra plataforma de deploy (Railway, Render)
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// === POST /api/briefings — recebe o formulário da landing ===
app.post('/api/briefings', briefingLimiter, async (req, res) => {
  // 1. valida + normaliza com Zod
  const parsed = briefingSchema.safeParse(req.body);

  if (!parsed.success) {
    // honeypot disparou ou validação falhou — resposta genérica pra não dar dica pro bot
    const isHoneypot = parsed.error.issues.some((i) => i.path[0] === 'website');
    if (isHoneypot) {
      console.warn('[honeypot] disparado, IP:', req.ip);
      // finge sucesso pra bot, mas não persiste nem envia email
      return res.status(200).json({ ok: true, message: 'Briefing recebido.' });
    }

    return res.status(400).json({
      ok: false,
      error: 'Dados inválidos',
      issues: parsed.error.issues.map((i) => ({ field: i.path[0], message: i.message })),
    });
  }

  const data = parsed.data;

  try {
    // 2. salva no banco
    const briefing = insertBriefing({
      nome: data.nome,
      empresa: data.empresa,
      email: data.email,
      telefone: data.telefone,
      servico: data.servico,
      mensagem: data.mensagem,
      ip: req.ip,
      user_agent: req.get('user-agent')?.slice(0, 500) || null,
    });

    console.log(`[briefing] #${briefing.id} salvo: ${briefing.empresa} (${briefing.email})`);

    // 3. dispara emails em background — não bloqueia a resposta pro cliente
    notifyNewBriefing(briefing).catch((err) => {
      console.error('[email] erro no envio:', err);
    });

    // 4. responde rápido pro front
    return res.status(201).json({
      ok: true,
      message: 'Briefing recebido. A gente entra em contato em até 48h úteis.',
      id: briefing.id,
    });
  } catch (err) {
    console.error('[briefing] erro:', err);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao processar o briefing. Tenta de novo em alguns instantes.',
    });
  }
});

// === GET /api/briefings — listagem protegida ===
app.get('/api/briefings', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.get('x-admin-token') !== adminToken) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const result = listBriefings({ limit, offset });

  res.json({ ok: true, ...result, limit, offset });
});

// === GET /api/briefings/:id — detalhe protegido ===
app.get('/api/briefings/:id', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.get('x-admin-token') !== adminToken) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }

  const briefing = getBriefing(Number(req.params.id));
  if (!briefing) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true, briefing });
});

// === POST /api/tokens/create — gera link de questionário para um cliente (admin) ===
app.post('/api/tokens/create', tokenLimiter, (req, res) => {
  const { adminKey, cliente } = req.body || {};
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || adminKey !== adminSecret) {
    return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
  }
  if (!cliente?.trim()) {
    return res.status(400).json({ ok: false, error: 'Nome do cliente é obrigatório.' });
  }

  const token = createToken(cliente.trim());
  const baseUrl = (process.env.FRONTEND_URL || 'http://localhost').replace(/\/$/, '');
  const link = `${baseUrl}/questionario?c=${token}`;

  console.log(`[token] criado para: ${cliente.trim()}`);
  res.json({ ok: true, link, cliente: cliente.trim() });
});

// === GET /api/tokens/validate — valida token antes de exibir o formulário ===
app.get('/api/tokens/validate', (req, res) => {
  const { token } = req.query;
  const result = validateToken(token);
  if (!result) return res.status(401).json({ ok: false, error: 'Link inválido ou expirado.' });
  res.json({ ok: true, cliente: result.cliente });
});

// === POST /api/questionario — recebe o diagnóstico respondido pelo cliente ===
app.post('/api/questionario', questionarioLimiter, async (req, res) => {
  const { token, ...respostas } = req.body || {};
  const tokenData = validateToken(token);

  if (!tokenData) {
    return res.status(401).json({ ok: false, error: 'Link inválido ou expirado.' });
  }

  console.log(`[questionario] respondido por: ${tokenData.cliente}`);

  notifyQuestionario({ cliente: tokenData.cliente, respostas }).catch((err) => {
    console.error('[email] erro questionário:', err);
  });

  return res.json({ ok: true });
});

// 404 padrão
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Rota não encontrada' });
});

// erro CORS / outros
app.use((err, req, res, next) => {
  if (err.message?.startsWith('Origin not allowed')) {
    return res.status(403).json({ ok: false, error: 'Origem não permitida (CORS)' });
  }
  console.error('[server] erro não tratado:', err);
  res.status(500).json({ ok: false, error: 'Erro interno' });
});

// ============ START ============
app.listen(port, () => {
  console.log(`[server] Crivo backend rodando em http://localhost:${port}`);
  console.log(`[server] CORS permitido: ${allowedOrigins.join(', ') || '(nenhum — atenção)'}`);

  if (!process.env.TOKEN_SECRET) {
    console.warn('[AVISO] TOKEN_SECRET não definido — tokens estão sendo assinados com valor padrão inseguro. Configure no Railway.');
  }
  if (!process.env.ADMIN_TOKEN) {
    console.warn('[AVISO] ADMIN_TOKEN não definido — GET /api/briefings retornará 401 para todos.');
  }
  if (!process.env.ADMIN_SECRET) {
    console.warn('[AVISO] ADMIN_SECRET não definido — geração de links de questionário está desabilitada.');
  }
});
