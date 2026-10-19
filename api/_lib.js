// Utilidades compartidas por las funciones de /api (los archivos con "_" no son rutas).
import crypto from 'node:crypto';

const COOKIE = 'fcs_session';
const SESSION_DAYS = 180;
const secret = () => process.env.SESSION_SECRET || process.env.BLOB_READ_WRITE_TOKEN || 'dev-secret';

/* ---------- Almacenamiento: Vercel Blob privado (o carpeta local en pruebas) ---------- */
let blobMod = null;
const blob = async () => blobMod || (blobMod = await import('@vercel/blob'));
const localDir = process.env.FC_LOCAL_STORE;

export async function readJSON(path, fallback) {
  const buf = await readFile(path);
  if (!buf) return fallback;
  try { return JSON.parse(buf.toString('utf8')); } catch { return fallback; }
}
export async function writeJSON(path, value) {
  await writeFile(path, Buffer.from(JSON.stringify(value)), 'application/json');
}
export async function readFile(path) {
  if (localDir) {
    const fs = await import('node:fs/promises');
    try { return await fs.readFile(`${localDir}/${encodeURIComponent(path)}`); } catch { return null; }
  }
  const { get } = await blob();
  const r = await get(path, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return Buffer.from(await new Response(r.stream).arrayBuffer());
}
export async function readFileMeta(path) {
  if (localDir) {
    const buf = await readFile(path); if (!buf) return null;
    const meta = await readJSON(`${path}.meta`, {});
    return { body: buf, contentType: meta.contentType || 'application/octet-stream' };
  }
  const { get } = await blob();
  const r = await get(path, { access: 'private' });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return { body: r.stream, contentType: r.blob.contentType || 'application/octet-stream' };
}
export async function writeFile(path, body, contentType) {
  if (localDir) {
    const fs = await import('node:fs/promises');
    await fs.mkdir(localDir, { recursive: true });
    await fs.writeFile(`${localDir}/${encodeURIComponent(path)}`, body);
    if (!path.endsWith('.meta')) await fs.writeFile(`${localDir}/${encodeURIComponent(path + '.meta')}`, JSON.stringify({ contentType }));
    return;
  }
  const { put } = await blob();
  await put(path, body, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
}
export async function removeFile(path) {
  if (localDir) {
    const fs = await import('node:fs/promises');
    await fs.rm(`${localDir}/${encodeURIComponent(path)}`, { force: true });
    await fs.rm(`${localDir}/${encodeURIComponent(path + '.meta')}`, { force: true });
    return;
  }
  const { del } = await blob();
  await del(path);
}

/* ---------- Contraseña ---------- */
// La contraseña inicial viene de APP_PASSWORD; si se cambia desde la app se guarda su hash en el almacén.
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
export async function checkPassword(pw) {
  const saved = await readJSON('config/auth.json', null);
  if (saved?.salt && saved?.hash) return safeEqual(hash(pw, saved.salt), saved.hash);
  const env = process.env.APP_PASSWORD;
  return !!env && safeEqual(pw, env);
}
export async function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  await writeJSON('config/auth.json', { salt, hash: hash(pw, salt), changedAt: Date.now() });
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- Sesión (cookie firmada) ---------- */
const sign = v => crypto.createHmac('sha256', secret()).update(v).digest('base64url');
export function sessionCookie() {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const v = `${exp}.${sign(String(exp))}`;
  return `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export function isAuthed(request) {
  const c = (request.headers.get('cookie') || '').split(/;\s*/).find(x => x.startsWith(COOKIE + '='));
  if (!c) return false;
  const [exp, sig] = c.slice(COOKIE.length + 1).split('.');
  return !!exp && !!sig && safeEqual(sig, sign(exp)) && +exp > Date.now();
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
export const unauthorized = () => json({ error: 'auth' }, 401);
export const wait = ms => new Promise(r => setTimeout(r, ms));
