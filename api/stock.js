import { readJSONVersioned, writeJSONIf, writeJSON, removeFile, Conflict, isAuthed, json, unauthorized, wait } from './_lib.js';

// Stock de productos, en un archivo aparte de los movimientos:
//   data/stock.json  { products: [...], deleted: { id: fecha }, updatedAt, lastBackup }
// Mismo método que /api/data: cada producto gana por updatedAt, los borrados quedan
// anotados y cada escritura comprueba la versión (ETag) para no pisar a otro móvil.
// Las fotos van en docs/{photoId}, como los justificantes, con /api/doc.
const PATH = 'data/stock.json';
const empty = () => ({ products: [], deleted: {}, updatedAt: 0, lastBackup: 0 });
const TOMBSTONE_DAYS = 400;
const BACKUP_DAYS = 7;

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const { value } = await readJSONVersioned(PATH, empty());
  const known = request.headers.get('x-stock-version');
  if (known && value.updatedAt && known === String(value.updatedAt)) return json({ unchanged: true, updatedAt: value.updatedAt });
  return json(publicData({ ...empty(), ...value }));
}

// Aplica cambios: { upsert: [producto], delete: [id] } y devuelve el estado completo.
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'json' }, 400); }
  for (let attempt = 0; ; attempt++) {
    try {
      const { data, photosToRemove } = await applyChanges(body, attempt >= 4);
      for (const id of new Set(photosToRemove)) if (/^[a-z0-9]+$/i.test(id)) await removeFile(`docs/${id}`).catch(() => {});
      return json(data);
    } catch (e) {
      if (!(e instanceof Conflict) || attempt >= 4) throw e;
      console.error('conflicto al guardar el stock, reintento', attempt + 1, e.message);
      await wait(80 + Math.random() * 200 * (attempt + 1));
    }
  }
}

async function applyChanges(body, force) {
  const file = await readJSONVersioned(PATH, null);
  const s = { ...empty(), ...(file.value || {}) };
  const byId = new Map(s.products.map(p => [p.id, p]));
  const photosToRemove = [];
  for (const p of Array.isArray(body.upsert) ? body.upsert : []) {
    if (!p || typeof p.id !== 'string') continue;
    if (s.deleted[p.id] && s.deleted[p.id] >= (p.updatedAt || 0)) continue;
    const cur = byId.get(p.id);
    if (cur && (p.updatedAt || 0) < (cur.updatedAt || 0)) continue;
    if (cur?.photoId && cur.photoId !== p.photoId) photosToRemove.push(cur.photoId);
    byId.set(p.id, p);
    delete s.deleted[p.id];
  }
  for (const id of Array.isArray(body.delete) ? body.delete : []) {
    if (typeof id !== 'string') continue;
    const cur = byId.get(id);
    if (cur?.photoId) photosToRemove.push(cur.photoId);
    byId.delete(id);
    s.deleted[id] = Date.now();
  }
  const cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
  for (const [id, at] of Object.entries(s.deleted)) if (at < cutoff) delete s.deleted[id];
  s.products = [...byId.values()];
  s.updatedAt = Date.now();
  // Copia de seguridad semanal del stock (sin fotos).
  if ((s.lastBackup || 0) < Date.now() - BACKUP_DAYS * 864e5) {
    await writeJSON(`backups/stock-${new Date().toISOString().slice(0, 10)}.json`, { ...publicData(s), backupAt: new Date().toISOString() });
    s.lastBackup = Date.now();
  }
  await writeJSONIf(PATH, s, file.etag, force);
  return { data: publicData(s), photosToRemove };
}

const publicData = s => ({ products: s.products, deleted: s.deleted, updatedAt: s.updatedAt });
