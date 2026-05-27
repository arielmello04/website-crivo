import { createHmac } from 'node:crypto';

const SECRET = process.env.TOKEN_SECRET || 'crivo-token-secret-change-in-prod';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export function createToken(cliente) {
  const ts = Date.now();
  const payload = JSON.stringify({ c: cliente, t: ts });
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(payload + '.' + sig).toString('base64url');
}

export function validateToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const dotIdx = decoded.lastIndexOf('.');
    if (dotIdx === -1) return null;

    const payload = decoded.slice(0, dotIdx);
    const sig = decoded.slice(dotIdx + 1);

    const expectedSig = createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
    if (sig !== expectedSig) return null;

    const { c: cliente, t: ts } = JSON.parse(payload);
    if (!cliente || !ts) return null;
    if (Date.now() - ts > TTL_MS) return null;

    return { cliente, ts };
  } catch {
    return null;
  }
}
