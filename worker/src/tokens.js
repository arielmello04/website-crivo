// Port do backend Node para Web Crypto (Workers não tem node:crypto por padrão).
// O formato do token é mantido byte a byte igual ao original, para que os links
// de questionário já enviados a clientes continuem válidos após a migração:
//   payload = JSON.stringify({ c: cliente, t: ts })
//   sig     = HMAC-SHA256(payload, SECRET) em hex, cortado em 32 chars
//   token   = base64url(payload + '.' + sig)

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

const enc = new TextEncoder();
const dec = new TextDecoder();

async function assinar(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 32);
}

// base64url de uma string UTF-8. O Node fazia Buffer.from(s).toString('base64url');
// aqui precisamos passar pelos bytes na mão, senão nomes com acento corrompem.
function b64urlEncode(str) {
  const bytes = enc.encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

// comparação em tempo constante: evita vazar a assinatura por timing
function comparaSeguro(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createToken(cliente, secret) {
  const payload = JSON.stringify({ c: cliente, t: Date.now() });
  const sig = await assinar(payload, secret);
  return b64urlEncode(payload + '.' + sig);
}

export async function validateToken(token, secret) {
  try {
    if (!token) return null;
    const decoded = b64urlDecode(token);
    const dotIdx = decoded.lastIndexOf('.');
    if (dotIdx === -1) return null;

    const payload = decoded.slice(0, dotIdx);
    const sig = decoded.slice(dotIdx + 1);

    const esperada = await assinar(payload, secret);
    if (!comparaSeguro(sig, esperada)) return null;

    const { c: cliente, t: ts } = JSON.parse(payload);
    if (!cliente || !ts) return null;
    if (Date.now() - ts > TTL_MS) return null;

    return { cliente, ts };
  } catch {
    return null;
  }
}
