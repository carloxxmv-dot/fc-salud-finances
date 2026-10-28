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
// Lectura y escritura con control de versión (ETag): si otro dispositivo ha escrito
// el archivo entre medias, la escritura falla con Conflict y se vuelve a intentar.
export class Conflict extends Error {}
export async function readJSONVersioned(path, fallback) {
  if (localDir) {
    const buf = await readFile(path);
    if (!buf) return { value: fallback, etag: null };
    try { return { value: JSON.parse(buf.toString('utf8')), etag: localEtag(buf) }; } catch { throw new Error(`JSON dañado en ${path}`); }
  }
  const { get, head, BlobNotFoundError } = await blob();
  // El ETag se pide a la API (head) antes de leer: es el formato que espera ifMatch.
  // Si el archivo cambia entre medias, el ETag es el antiguo y la escritura se repite.
  let etag = null;
  try { etag = (await head(path)).etag || null; } catch (e) { if (!(e instanceof BlobNotFoundError)) console.error('head', path, e?.message); }
  const r = await get(path, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return { value: fallback, etag: null };
  etag = etag || r.blob.etag || null;
  const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
  try { return { value: JSON.parse(buf.toString('utf8')), etag }; } catch { throw new Error(`JSON dañado en ${path}`); }
}
// etag null = el archivo no debe existir todavía. force = escribir sin comprobar
// (último recurso para no perder nunca un guardado).
export async function writeJSONIf(path, value, etag, force = false) {
  const body = Buffer.from(JSON.stringify(value));
  if (force) return writeFile(path, body, 'application/json');
  if (localDir) {
    // En pruebas locales, comprobar y escribir de una vez (Blob lo hace en el servidor).
    const prev = localLocks.get(path) || Promise.resolve();
    const run = prev.then(async () => {
      const cur = await readFile(path);
      if (etag ? !cur || localEtag(cur) !== etag : !!cur) throw new Conflict(path);
      await writeFile(path, body, 'application/json');
    });
    localLocks.set(path, run.catch(() => {}));
    return run;
  }
  const { put, BlobPreconditionFailedError } = await blob();
  try {
    await put(path, body, { access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : { allowOverwrite: false }) });
  } catch (e) {
    // ETag distinto, o el archivo ya existe cuando se esperaba crearlo.
    if (e instanceof BlobPreconditionFailedError || /already exists|precondition/i.test(e?.message || '')) throw new Conflict(path);
    console.error('put condicional', path, e?.name, e?.message);
    if (etag) throw new Conflict(path);   // se reintenta y, al final, se guarda sin comprobar
    throw e;
  }
}
const localLocks = new Map();
const localEtag = buf => crypto.createHash('sha1').update(buf).digest('hex');

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
    const file = `${localDir}/${encodeURIComponent(path)}`, tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, body); await fs.rename(tmp, file);
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
