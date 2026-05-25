import nodemailer from 'nodemailer';
import { getServicoLabel } from './validation.js';

const enabled = process.env.EMAIL_ENABLED !== 'false';

let transporter = null;

if (enabled) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // verifica a conexão na inicialização — falha cedo se SMTP estiver errado
  transporter.verify()
    .then(() => console.log('[email] SMTP conectado'))
    .catch((err) => console.error('[email] Falha SMTP:', err.message));
} else {
  console.log('[email] Envio desabilitado (EMAIL_ENABLED=false)');
}

const from = process.env.EMAIL_FROM || 'Crivo & Co. <noreply@crivoco.com.br>';
const notifyTo = process.env.EMAIL_NOTIFY;

// escapa HTML pra evitar injeção no template
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// === email de notificação interna (vai pra você) ===
function buildInternalEmail(b) {
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f1ea;color:#1a1614;margin:0;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #d4ccbe;">
    <div style="padding:24px 32px;border-bottom:1px solid #d4ccbe;background:#ece6db;">
      <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.15em;color:#c54a1a;text-transform:uppercase;">Crivo & Co. · Novo briefing</div>
      <h1 style="margin:8px 0 0;font-family:Georgia,serif;font-weight:300;font-size:28px;letter-spacing:-0.02em;">Novo lead chegou pelo site</h1>
    </div>
    <div style="padding:32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#8a847b;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;width:120px;">Nome</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;">${esc(b.nome)}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#8a847b;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Empresa</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;">${esc(b.empresa)}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#8a847b;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Email</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;"><a href="mailto:${esc(b.email)}" style="color:#c54a1a;">${esc(b.email)}</a></td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#8a847b;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Telefone</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;">${esc(b.telefone)}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#8a847b;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Serviço</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;">${esc(getServicoLabel(b.servico))}</td></tr>
      </table>
      <div style="margin-top:24px;">
        <div style="color:#8a847b;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Mensagem</div>
        <div style="background:#f5f1ea;padding:16px;border-left:3px solid #c54a1a;font-size:15px;line-height:1.5;white-space:pre-wrap;">${esc(b.mensagem)}</div>
      </div>
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-family:'Courier New',monospace;font-size:11px;color:#8a847b;">
        ID #${b.id} · ${esc(b.created_at)}<br>
        IP: ${esc(b.ip || '—')}
      </div>
    </div>
  </div>
</body></html>`;

  const text = `Novo briefing — Crivo & Co.\n\n` +
    `Nome: ${b.nome}\nEmpresa: ${b.empresa}\nEmail: ${b.email}\n` +
    `Telefone: ${b.telefone}\nServiço: ${getServicoLabel(b.servico)}\n\n` +
    `Mensagem:\n${b.mensagem}\n\n---\nID #${b.id} — ${b.created_at}`;

  return { html, text };
}

// === auto-resposta pro cliente ===
function buildClientEmail(b) {
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f1ea;color:#1a1614;margin:0;padding:32px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #d4ccbe;">
    <div style="padding:32px;border-bottom:1px solid #d4ccbe;">
      <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.15em;color:#c54a1a;text-transform:uppercase;">Crivo & Co.</div>
      <h1 style="margin:12px 0 0;font-family:Georgia,serif;font-weight:300;font-size:32px;letter-spacing:-0.02em;line-height:1.1;">Recebemos seu briefing.</h1>
    </div>
    <div style="padding:32px;font-size:16px;line-height:1.6;color:#4a4540;">
      <p style="margin:0 0 16px;">Oi, ${esc(b.nome.split(' ')[0])}.</p>
      <p style="margin:0 0 16px;">Seu briefing chegou aqui no estúdio e já está na nossa fila pra leitura. Vamos analisar com calma — sem proposta enlatada — e voltar pra você em até <strong style="color:#1a1614;">48h úteis</strong>.</p>
      <p style="margin:0 0 24px;">Enquanto isso, qualquer dúvida ou complemento, é só responder esse email.</p>
      <div style="padding-top:24px;border-top:1px solid #eee;">
        <p style="margin:0;font-family:Georgia,serif;font-style:italic;color:#c54a1a;font-size:18px;">Passou no crivo, comunica.</p>
        <p style="margin:8px 0 0;font-size:13px;color:#8a847b;">— Equipe Crivo & Co.</p>
      </div>
    </div>
  </div>
</body></html>`;

  const text = `Oi, ${b.nome.split(' ')[0]}.\n\n` +
    `Seu briefing chegou aqui no estúdio. Vamos analisar com calma e voltar pra você em até 48h úteis.\n\n` +
    `Qualquer coisa, é só responder esse email.\n\n— Equipe Crivo & Co.`;

  return { html, text };
}

// === API pública ===
export async function notifyNewBriefing(briefing) {
  if (!enabled || !transporter) {
    console.log(`[email] (desabilitado) seria enviado: briefing #${briefing.id}`);
    return { ok: true, skipped: true };
  }

  const results = await Promise.allSettled([
    // 1. notificação interna
    transporter.sendMail({
      from,
      to: notifyTo,
      replyTo: briefing.email,
      subject: `[Crivo] Novo briefing — ${briefing.empresa}`,
      ...buildInternalEmail(briefing),
    }),
    // 2. auto-resposta pro cliente
    transporter.sendMail({
      from,
      to: briefing.email,
      subject: 'Recebemos seu briefing — Crivo & Co.',
      ...buildClientEmail(briefing),
    }),
  ]);

  results.forEach((r, i) => {
    const label = i === 0 ? 'interno' : 'cliente';
    if (r.status === 'rejected') {
      console.error(`[email] Falha no envio (${label}):`, r.reason?.message);
    } else {
      console.log(`[email] Enviado (${label}): ${r.value.messageId}`);
    }
  });

  const anyFailed = results.some((r) => r.status === 'rejected');
  return { ok: !anyFailed, results };
}
