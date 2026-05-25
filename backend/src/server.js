import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';

import { insertBriefing, listBriefings, getBriefing } from './db.js';
import { briefingSchema } from './validation.js';
import { notifyNewBriefing } from './mailer.js';

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

// Rate limit pro POST do briefing: 5 envios por IP a cada 15 minutos.
// Protege contra spam/bot. Outras rotas não são limitadas.
const briefingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas tentativas. Tenta de novo em alguns minutos.' },
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

// === GET /api/briefings — listagem (você pode proteger com auth depois) ===
// Útil pra você consultar os leads via curl/painel.
app.get('/api/briefings', (req, res) => {
  // proteção simples por token via header — opcional, ativa só se ADMIN_TOKEN estiver setado
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) {
    if (req.get('x-admin-token') !== adminToken) {
      return res.status(401).json({ ok: false, error: 'Não autorizado' });
    }
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const result = listBriefings({ limit, offset });

  res.json({ ok: true, ...result, limit, offset });
});

// === GET /api/briefings/:id — detalhe ===
app.get('/api/briefings/:id', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && req.get('x-admin-token') !== adminToken) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }

  const briefing = getBriefing(Number(req.params.id));
  if (!briefing) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true, briefing });
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
});
