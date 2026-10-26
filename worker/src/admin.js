// Painel interno (/interno): sessão de admin e CRUD dos registros da empresa.
//
// Login com ADMIN_SECRET devolve um token de sessão assinado com HMAC, que vai
// no header Authorization das demais rotas /api/admin/*. Os registros ficam na
// tabela `registros` como JSON; ESQUEMAS abaixo é a fonte única dos campos,
// usada tanto para validar aqui quanto para o painel montar os formulários.

import { assinar, b64urlEncode, b64urlDecode, comparaSeguro, createToken } from './tokens.js';
import { listBriefings } from './db.js';

const SESSAO_TTL_MS = 12 * 60 * 60 * 1000;

// ============ ESQUEMAS ============
// t: text | longo | enum | num | data | hora | bool | ref | url | lista
// ref aponta para outro tipo (ex.: cliente); lista é checklist [{texto, feito}].

export const ESQUEMAS = {
  cliente: {
    rotulo: 'Cliente', plural: 'Clientes', titulo: 'nome',
    campos: {
      nome:        { t: 'text', rotulo: 'Nome', req: true, max: 120 },
      empresa:     { t: 'text', rotulo: 'Empresa / marca', max: 160 },
      status:      { t: 'enum', rotulo: 'Status', opcoes: [['lead', 'Lead'], ['proposta', 'Proposta enviada'], ['ativo', 'Ativo'], ['pausado', 'Pausado'], ['encerrado', 'Encerrado']], padrao: 'lead' },
      segmento:    { t: 'text', rotulo: 'Segmento', max: 80 },
      email:       { t: 'text', rotulo: 'Email', max: 160 },
      telefone:    { t: 'text', rotulo: 'Telefone / WhatsApp', max: 40 },
      instagram:   { t: 'text', rotulo: 'Instagram', max: 80 },
      cidade:      { t: 'text', rotulo: 'Cidade', max: 80 },
      origem:      { t: 'enum', rotulo: 'Origem', opcoes: [['site', 'Site'], ['indicacao', 'Indicação'], ['instagram', 'Instagram'], ['prospeccao', 'Prospecção'], ['outro', 'Outro']], padrao: 'outro' },
      responsavel: { t: 'text', rotulo: 'Responsável', max: 60 },
      pasta:       { t: 'url', rotulo: 'Pasta no Drive' },
      notas:       { t: 'longo', rotulo: 'Notas', max: 5000 },
    },
  },
  projeto: {
    rotulo: 'Projeto', plural: 'Projetos', titulo: 'titulo',
    campos: {
      titulo:      { t: 'text', rotulo: 'Projeto', req: true, max: 160 },
      clienteId:   { t: 'ref', rotulo: 'Cliente', ref: 'cliente' },
      etapa:       { t: 'enum', rotulo: 'Etapa', opcoes: [['backlog', 'A fazer'], ['producao', 'Em produção'], ['revisao', 'Em revisão'], ['entregue', 'Entregue']], padrao: 'backlog' },
      prioridade:  { t: 'enum', rotulo: 'Prioridade', opcoes: [['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta']], padrao: 'media' },
      responsavel: { t: 'text', rotulo: 'Responsável', max: 60 },
      inicio:      { t: 'data', rotulo: 'Início' },
      prazo:       { t: 'data', rotulo: 'Prazo de entrega' },
      valor:       { t: 'num', rotulo: 'Valor (R$)' },
      descricao:   { t: 'longo', rotulo: 'Descrição', max: 5000 },
      tarefas:     { t: 'lista', rotulo: 'Checklist' },
    },
  },
  contrato: {
    rotulo: 'Contrato', plural: 'Contratos', titulo: 'titulo',
    campos: {
      titulo:       { t: 'text', rotulo: 'Contrato', req: true, max: 160 },
      clienteId:    { t: 'ref', rotulo: 'Cliente', ref: 'cliente' },
      modalidade:   { t: 'enum', rotulo: 'Modalidade', opcoes: [['mensal', 'Recorrente mensal'], ['projeto', 'Projeto fechado']], padrao: 'projeto' },
      status:       { t: 'enum', rotulo: 'Status', opcoes: [['rascunho', 'Rascunho'], ['enviado', 'Enviado'], ['assinado', 'Assinado'], ['encerrado', 'Encerrado'], ['perdido', 'Não fechou']], padrao: 'rascunho' },
      valor:        { t: 'num', rotulo: 'Valor (R$)' },
      inicio:       { t: 'data', rotulo: 'Início' },
      fim:          { t: 'data', rotulo: 'Fim / renovação' },
      documentoUrl: { t: 'url', rotulo: 'Documento (link)' },
      notas:        { t: 'longo', rotulo: 'Notas', max: 5000 },
    },
  },
  evento: {
    rotulo: 'Evento', plural: 'Calendário', titulo: 'titulo',
    campos: {
      titulo:    { t: 'text', rotulo: 'Título', req: true, max: 160 },
      data:      { t: 'data', rotulo: 'Data', req: true },
      hora:      { t: 'hora', rotulo: 'Hora' },
      categoria: { t: 'enum', rotulo: 'Tipo', opcoes: [['captacao', 'Captação'], ['reuniao', 'Reunião'], ['entrega', 'Entrega'], ['postagem', 'Postagem'], ['evento', 'Feira / evento'], ['outro', 'Outro']], padrao: 'reuniao' },
      clienteId: { t: 'ref', rotulo: 'Cliente', ref: 'cliente' },
      local:     { t: 'text', rotulo: 'Local', max: 160 },
      notas:     { t: 'longo', rotulo: 'Notas', max: 3000 },
    },
  },
  lancamento: {
    rotulo: 'Lançamento', plural: 'Financeiro', titulo: 'descricao',
    campos: {
      descricao:  { t: 'text', rotulo: 'Descrição', req: true, max: 160 },
      natureza:   { t: 'enum', rotulo: 'Tipo', opcoes: [['receita', 'Receita'], ['despesa', 'Despesa']], padrao: 'receita' },
      valor:      { t: 'num', rotulo: 'Valor (R$)', req: true },
      vencimento: { t: 'data', rotulo: 'Vencimento', req: true },
      pago:       { t: 'bool', rotulo: 'Pago / recebido' },
      clienteId:  { t: 'ref', rotulo: 'Cliente', ref: 'cliente' },
      categoria:  { t: 'text', rotulo: 'Categoria', max: 60 },
      notas:      { t: 'longo', rotulo: 'Notas', max: 2000 },
    },
  },
  processo: {
    rotulo: 'Processo', plural: 'Processos', titulo: 'titulo',
    campos: {
      titulo:    { t: 'text', rotulo: 'Processo', req: true, max: 160 },
      area:      { t: 'enum', rotulo: 'Área', opcoes: [['comercial', 'Comercial'], ['producao', 'Produção'], ['audiovisual', 'Audiovisual'], ['web', 'Sites'], ['financeiro', 'Financeiro'], ['gestao', 'Gestão']], padrao: 'producao' },
      descricao: { t: 'longo', rotulo: 'Quando usar', max: 3000 },
      passos:    { t: 'lista', rotulo: 'Passos' },
    },
  },
};

export const STATUS_BRIEFING = ['novo', 'contato', 'proposta', 'fechado', 'descartado'];

// ============ VALIDAÇÃO ============

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^\d{2}:\d{2}$/;

function normalizar(tipo, entrada) {
  const esquema = ESQUEMAS[tipo];
  const saida = {};
  if (!entrada || typeof entrada !== 'object') return { erro: 'Dados inválidos' };

  for (const [nome, def] of Object.entries(esquema.campos)) {
    let v = entrada[nome];
    const vazio = v === undefined || v === null || v === '';

    if (vazio) {
      if (def.req) return { erro: `Preencha o campo ${def.rotulo}` };
      if (def.t === 'bool') saida[nome] = false;
      else if (def.t === 'lista') saida[nome] = [];
      else if (def.padrao) saida[nome] = def.padrao;
      continue;
    }

    switch (def.t) {
      case 'text':
      case 'longo':
        v = String(v).trim().slice(0, def.max || 300);
        break;
      case 'enum':
        if (!def.opcoes.some(([k]) => k === v)) return { erro: `${def.rotulo}: opção inválida` };
        break;
      case 'num':
        v = Number(v);
        if (!Number.isFinite(v) || v < 0 || v > 1e8) return { erro: `${def.rotulo}: número inválido` };
        v = Math.round(v * 100) / 100;
        break;
      case 'data':
        if (!RE_DATA.test(v)) return { erro: `${def.rotulo}: data inválida` };
        break;
      case 'hora':
        if (!RE_HORA.test(v)) return { erro: `${def.rotulo}: hora inválida` };
        break;
      case 'bool':
        v = v === true || v === 'true';
        break;
      case 'ref':
        v = Number(v);
        if (!Number.isInteger(v) || v <= 0) return { erro: `${def.rotulo}: referência inválida` };
        break;
      case 'url':
        v = String(v).trim().slice(0, 500);
        if (!/^https?:\/\//i.test(v)) return { erro: `${def.rotulo}: use um link começando com https://` };
        break;
      case 'lista':
        if (!Array.isArray(v)) return { erro: `${def.rotulo}: lista inválida` };
        v = v.slice(0, 80)
          .map((i) => ({ texto: String(i?.texto ?? '').trim().slice(0, 300), feito: i?.feito === true }))
          .filter((i) => i.texto);
        break;
    }
    saida[nome] = v;
  }
  return { dados: saida };
}

// ============ SESSÃO ============
// Segredo derivado, para um token de sessão nunca valer como link de
// questionário (e vice-versa), mesmo os dois usando TOKEN_SECRET.

const segredoSessao = (env) => `${env.TOKEN_SECRET}:sessao-admin`;

async function criarSessao(env) {
  const payload = JSON.stringify({ s: 'admin', exp: Date.now() + SESSAO_TTL_MS });
  const sig = await assinar(payload, segredoSessao(env));
  return b64urlEncode(payload + '.' + sig);
}

async function sessaoValida(env, token) {
  try {
    if (!token || !env.TOKEN_SECRET) return false;
    const decoded = b64urlDecode(token);
    const i = decoded.lastIndexOf('.');
    if (i === -1) return false;
    const payload = decoded.slice(0, i);
    const esperada = await assinar(payload, segredoSessao(env));
    if (!comparaSeguro(decoded.slice(i + 1), esperada)) return false;
    const { s, exp } = JSON.parse(payload);
    return s === 'admin' && Date.now() < exp;
  } catch {
    return false;
  }
}

// ============ ROTAS ============

function linhaParaRegistro(l) {
  return { id: l.id, tipo: l.tipo, ...JSON.parse(l.dados), criado_em: l.criado_em, atualizado_em: l.atualizado_em };
}

export function registrarAdmin(app, { limitar, lerJson }) {
  app.post('/api/admin/login', async (c) => {
    const bloqueio = await limitar(c, 'login');
    if (bloqueio) return bloqueio;

    const { body, erro } = await lerJson(c);
    if (erro) return c.json({ ok: false, error: erro }, 400);

    const adminSecret = c.env.ADMIN_SECRET;
    if (!adminSecret || typeof body?.adminKey !== 'string' || !comparaSeguro(body.adminKey, adminSecret)) {
      return c.json({ ok: false, error: 'Senha incorreta.' }, 401);
    }
    return c.json({ ok: true, token: await criarSessao(c.env), expiraEm: Date.now() + SESSAO_TTL_MS });
  });

  // tudo abaixo de /api/admin exige sessão (o login acima já respondeu antes)
  app.use('/api/admin/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!(await sessaoValida(c.env, token))) {
      return c.json({ ok: false, error: 'Sessão expirada. Entre de novo.' }, 401);
    }
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.get('/api/admin/esquemas', (c) => c.json({ ok: true, esquemas: ESQUEMAS, statusBriefing: STATUS_BRIEFING }));

  // O painel carrega tudo de uma vez: o volume de uma agência pequena cabe
  // folgado numa resposta, e assim cada tela filtra e cruza dados localmente.
  app.get('/api/admin/dados', async (c) => {
    const [regs, briefings] = await Promise.all([
      c.env.DB.prepare(`SELECT * FROM registros ORDER BY id DESC`).all(),
      listBriefings(c.env.DB, { limit: 300, offset: 0 }),
    ]);
    const dados = Object.fromEntries(Object.keys(ESQUEMAS).map((t) => [t, []]));
    for (const l of regs.results ?? []) if (dados[l.tipo]) dados[l.tipo].push(linhaParaRegistro(l));
    return c.json({ ok: true, dados, briefings: briefings.items });
  });

  app.post('/api/admin/registros/:tipo', async (c) => {
    const tipo = c.req.param('tipo');
    if (!ESQUEMAS[tipo]) return c.json({ ok: false, error: 'Tipo desconhecido' }, 404);
    const { body, erro } = await lerJson(c, 64 * 1024);
    if (erro) return c.json({ ok: false, error: erro }, 400);
    const r = normalizar(tipo, body);
    if (r.erro) return c.json({ ok: false, error: r.erro }, 400);

    const linha = await c.env.DB
      .prepare(`INSERT INTO registros (tipo, dados) VALUES (?, ?) RETURNING *`)
      .bind(tipo, JSON.stringify(r.dados))
      .first();
    return c.json({ ok: true, registro: linhaParaRegistro(linha) }, 201);
  });

  app.put('/api/admin/registros/:tipo/:id', async (c) => {
    const tipo = c.req.param('tipo');
    const id = Number(c.req.param('id'));
    if (!ESQUEMAS[tipo] || !Number.isInteger(id)) return c.json({ ok: false, error: 'Registro inválido' }, 404);
    const { body, erro } = await lerJson(c, 64 * 1024);
    if (erro) return c.json({ ok: false, error: erro }, 400);
    const r = normalizar(tipo, body);
    if (r.erro) return c.json({ ok: false, error: r.erro }, 400);

    const linha = await c.env.DB
      .prepare(`UPDATE registros SET dados = ?, atualizado_em = datetime('now') WHERE id = ? AND tipo = ? RETURNING *`)
      .bind(JSON.stringify(r.dados), id, tipo)
      .first();
    if (!linha) return c.json({ ok: false, error: 'Não encontrado' }, 404);
    return c.json({ ok: true, registro: linhaParaRegistro(linha) });
  });

  app.delete('/api/admin/registros/:tipo/:id', async (c) => {
    const tipo = c.req.param('tipo');
    const id = Number(c.req.param('id'));
    const r = await c.env.DB.prepare(`DELETE FROM registros WHERE id = ? AND tipo = ?`).bind(id, tipo).run();
    if (!r.meta?.changes) return c.json({ ok: false, error: 'Não encontrado' }, 404);
    return c.json({ ok: true });
  });

  app.put('/api/admin/briefings/:id/status', async (c) => {
    const { body, erro } = await lerJson(c);
    if (erro) return c.json({ ok: false, error: erro }, 400);
    if (!STATUS_BRIEFING.includes(body?.status)) return c.json({ ok: false, error: 'Status inválido' }, 400);
    const r = await c.env.DB.prepare(`UPDATE briefings SET status = ? WHERE id = ?`)
      .bind(body.status, Number(c.req.param('id'))).run();
    if (!r.meta?.changes) return c.json({ ok: false, error: 'Não encontrado' }, 404);
    return c.json({ ok: true });
  });

  // link de questionário a partir da sessão, sem pedir a senha de novo
  app.post('/api/admin/questionario-link', async (c) => {
    const { body, erro } = await lerJson(c);
    if (erro) return c.json({ ok: false, error: erro }, 400);
    const cliente = String(body?.cliente ?? '').trim().slice(0, 120);
    if (!cliente) return c.json({ ok: false, error: 'Nome do cliente é obrigatório.' }, 400);
    const token = await createToken(cliente, c.env.TOKEN_SECRET);
    const baseUrl = (c.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/$/, '');
    return c.json({ ok: true, cliente, link: `${baseUrl}/questionario?c=${token}` });
  });
}
