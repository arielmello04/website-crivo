import { getServicoLabel } from './validation.js';

const apiKey = process.env.BREVO_API_KEY;
const enabled = process.env.EMAIL_ENABLED !== 'false';
const notifyTo = process.env.EMAIL_NOTIFY;

// parseia "Crivo & Co. <email@gmail.com>" → { name, email }
const fromRaw = process.env.EMAIL_FROM || 'Crivo & Co. <crivoeco@gmail.com>';
const fromMatch = fromRaw.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
const fromName = fromMatch ? fromMatch[1].trim() : 'Crivo & Co.';
const fromEmail = fromMatch ? fromMatch[2].trim() : fromRaw;

if (enabled && !apiKey) {
  console.warn('[email] BREVO_API_KEY não definida — envio desabilitado');
} else if (enabled) {
  console.log(`[email] Brevo API pronta (from: ${fromEmail})`);
} else {
  console.log('[email] Envio desabilitado (EMAIL_ENABLED=false)');
}

async function sendEmail({ to, toName, replyTo, subject, html, text }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to, name: toName || to }],
      ...(replyTo && { replyTo: { email: replyTo } }),
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Brevo API ${res.status}: ${err.message || res.statusText}`);
  }

  return res.json();
}

// escapa HTML pra evitar injeção no template
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

const Q_LABELS = {
  obj:       { vendas: 'Aumentar vendas', leads: 'Gerar leads', marca: 'Fortalecer a marca', lancamento: 'Lançar produto/serviço' },
  videos:    { '1-2': '1–2 vídeos/mês', '3-5': '3–5 vídeos/mês', '5+': 'Mais de 5 vídeos/mês' },
  fotos:     { ate10: 'Até 10 fotos/mês', '11-30': '11–30 fotos/mês', '30+': 'Mais de 30/mês' },
  leads_mes: { ate50: 'Até 50 leads/mês', '51-200': '51–200 leads/mês', '200+': 'Mais de 200/mês' },
  prioridade:{ videos: 'Vídeos', fotos: 'Fotos', leads: 'Leads' },
  site:      { sim: 'Sim', nao: 'Não' },
  presenca:  { '1': '1 — Fraca', '2': '2', '3': '3 — Média', '4': '4', '5': '5 — Forte' },
  redes:     { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube' },
  orcamento: { ate5k: 'Até R$ 5.000', '5k-15k': 'R$ 5.000 a R$ 15.000', '15k+': 'Acima de R$ 15.000' },
  prazo:     { '1-3m': '1–3 meses', '4-6m': '4–6 meses', '6m+': 'Mais de 6 meses' },
  estrategia:{ curto: 'Curto prazo', longo: 'Longo prazo', ambos: 'Combinação de ambos' },
  percepcao: { moderna: 'Moderna', tradicional: 'Tradicional', inovadora: 'Inovadora', acessivel: 'Acessível' },
  tom:       { formal: 'Formal', descontraido: 'Descontraído', tecnico: 'Técnico' },
};

function qLabel(field, val) {
  const map = Q_LABELS[field];
  if (!map) return esc(String(val ?? '—'));
  if (Array.isArray(val)) return val.map((v) => map[v] || v).join(', ');
  return map[val] || val || '—';
}

function buildQuestionarioEmail({ cliente, respostas: r }) {
  const row = (label, val) =>
    val ? `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#8a847b;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;width:160px;vertical-align:top;">${label}</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;">${val}</td></tr>` : '';

  const section = (title) =>
    `<tr><td colspan="2" style="padding:20px 0 6px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.15em;color:#c54a1a;text-transform:uppercase;">${title}</td></tr>`;

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f1ea;color:#1a1614;margin:0;padding:32px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #d4ccbe;">
    <div style="padding:24px 32px;border-bottom:1px solid #d4ccbe;background:#ece6db;">
      <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.15em;color:#c54a1a;text-transform:uppercase;">Crivo & Co. · Diagnóstico estratégico</div>
      <h1 style="margin:8px 0 0;font-family:Georgia,serif;font-weight:300;font-size:28px;letter-spacing:-0.02em;">Questionário respondido</h1>
      <p style="margin:8px 0 0;color:#4a4540;font-size:14px;">Cliente: <strong>${esc(cliente)}</strong></p>
    </div>
    <div style="padding:32px;">
      <table style="width:100%;border-collapse:collapse;">
        ${section('1 · Informações básicas')}
        ${row('Empresa', esc(r.empresa))}
        ${row('Segmento', esc(r.segmento))}
        ${row('Público-alvo', esc(r.publico))}
        ${section('2 · Objetivos')}
        ${row('Objetivos', qLabel('obj', r.obj))}
        ${row('Meta específica', esc(r.meta))}
        ${section('3 · Produção de conteúdo')}
        ${row('Vídeos/mês', qLabel('videos', r.videos))}
        ${row('Fotos/mês', qLabel('fotos', r.fotos))}
        ${row('Leads/mês', qLabel('leads_mes', r.leads_mes))}
        ${row('Prioridade', qLabel('prioridade', r.prioridade))}
        ${section('4 · Presença digital')}
        ${row('Possui site?', qLabel('site', r.site))}
        ${r.site_url ? row('URL do site', esc(r.site_url)) : ''}
        ${row('Redes sociais', qLabel('redes', r.redes))}
        ${row('Presença digital', qLabel('presenca', r.presenca))}
        ${section('5 · Concorrência')}
        ${row('Concorrentes', esc(r.concorrentes))}
        ${row('Diferenciais', esc(r.diferenciais))}
        ${section('6 · Investimento')}
        ${row('Orçamento', qLabel('orcamento', r.orcamento))}
        ${row('Prazo p/ resultados', qLabel('prazo', r.prazo))}
        ${row('Estratégia', qLabel('estrategia', r.estrategia))}
        ${section('7 · Comunicação')}
        ${row('Percepção de marca', qLabel('percepcao', r.percepcao))}
        ${row('Tom de voz', qLabel('tom', r.tom))}
      </table>
    </div>
  </div>
</body></html>`;

  const text = `Diagnóstico estratégico — ${cliente}\n\n` +
    `Empresa: ${r.empresa || '—'}\nSegmento: ${r.segmento || '—'}\nPúblico: ${r.publico || '—'}\n\n` +
    `Objetivos: ${qLabel('obj', r.obj)}\nMeta: ${r.meta || '—'}\n\n` +
    `Vídeos/mês: ${qLabel('videos', r.videos)} | Fotos: ${qLabel('fotos', r.fotos)} | Leads: ${qLabel('leads_mes', r.leads_mes)}\n` +
    `Prioridade: ${qLabel('prioridade', r.prioridade)}\n\n` +
    `Site: ${qLabel('site', r.site)}${r.site_url ? ' — ' + r.site_url : ''}\nRedes: ${qLabel('redes', r.redes)}\nPresença: ${qLabel('presenca', r.presenca)}\n\n` +
    `Concorrentes: ${r.concorrentes || '—'}\nDiferenciais: ${r.diferenciais || '—'}\n\n` +
    `Orçamento: ${qLabel('orcamento', r.orcamento)} | Prazo: ${qLabel('prazo', r.prazo)} | Estratégia: ${qLabel('estrategia', r.estrategia)}\n\n` +
    `Percepção: ${qLabel('percepcao', r.percepcao)} | Tom: ${qLabel('tom', r.tom)}`;

  return { html, text };
}

export async function notifyQuestionario({ cliente, respostas }) {
  if (!enabled || !apiKey) {
    console.log(`[email] (desabilitado) seria enviado: questionario de ${cliente}`);
    return { ok: true, skipped: true };
  }

  const { html, text } = buildQuestionarioEmail({ cliente, respostas });

  try {
    await sendEmail({
      to: notifyTo,
      subject: `[Crivo] Diagnóstico — ${cliente}`,
      html,
      text,
    });
    console.log(`[email] questionario de ${cliente} enviado`);
    return { ok: true };
  } catch (err) {
    console.error(`[email] falha no questionario de ${cliente}:`, err.message);
    return { ok: false, error: err.message };
  }
}

export async function notifyNewBriefing(briefing) {
  if (!enabled || !apiKey) {
    console.log(`[email] (desabilitado) seria enviado: briefing #${briefing.id}`);
    return { ok: true, skipped: true };
  }

  const { html: htmlInterno, text: textInterno } = buildInternalEmail(briefing);
  const { html: htmlCliente, text: textCliente } = buildClientEmail(briefing);

  const results = await Promise.allSettled([
    sendEmail({
      to: notifyTo,
      replyTo: briefing.email,
      subject: `[Crivo] Novo briefing — ${briefing.empresa}`,
      html: htmlInterno,
      text: textInterno,
    }),
    sendEmail({
      to: briefing.email,
      toName: briefing.nome,
      subject: 'Recebemos seu briefing — Crivo & Co.',
      html: htmlCliente,
      text: textCliente,
    }),
  ]);

  results.forEach((r, i) => {
    const label = i === 0 ? 'interno' : 'cliente';
    if (r.status === 'rejected') {
      console.error(`[email] Falha no envio (${label}):`, r.reason?.message);
    } else {
      console.log(`[email] Enviado (${label}): ${r.value.messageId || 'ok'}`);
    }
  });

  const anyFailed = results.some((r) => r.status === 'rejected');
  return { ok: !anyFailed, results };
}
