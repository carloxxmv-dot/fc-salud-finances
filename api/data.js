import { readJSON, readJSONVersioned, writeJSONIf, writeJSON, removeFile, Conflict, isAuthed, json, unauthorized, wait } from './_lib.js';

// Los movimientos se guardan repartidos por año para que cada archivo siga siendo pequeño:
//   data/meta.json        { years: ['2025', ...], deleted: { id: fecha }, projects: [...], updatedAt, lastBackup, backups: [...] }
//   data/moves/2026.json  { moves: [...] }
// Cada escritura usa el ETag del archivo leído: si otro móvil ha guardado entre medias,
// se vuelve a leer y se aplican de nuevo los cambios, así no se pierde ninguno.
// La API sigue devolviendo { moves, deleted, projects, updatedAt } como antes.
const META = 'data/meta.json';
const LEGACY = 'data/fcsalud.json';
const yearPath = y => `data/moves/${y}.json`;
const yearOf = m => /^\d{4}/.test(m?.date || '') ? m.date.slice(0, 4) : 'sin-fecha';
const emptyMeta = () => ({ years: [], deleted: {}, projects: [], updatedAt: 0, lastBackup: 0, backups: [] });

const TOMBSTONE_DAYS = 400;   // tras este tiempo se olvidan los borrados
const BACKUP_DAYS = 7;        // copia de seguridad semanal
const BACKUPS_KEPT = 8;       // se guardan las 8 últimas (unos dos meses)

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const meta = await loadMeta();
  // Si el móvil ya tiene esta versión, no hace falta descargar los movimientos.
  const known = request.headers.get('x-data-version');
  if (known && meta.value.updatedAt && known === String(meta.value.updatedAt)) return json({ unchanged: true, updatedAt: meta.value.updatedAt });
  const years = await loadYears(meta.value.years);
  return json(publicData(meta.value, years));
}

// Aplica cambios: { upsert: [move], delete: [id], deleteDocs: [id], projects: [...] } y devuelve el estado completo.
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'json' }, 400); }
  for (let attempt = 0; ; attempt++) {
    try {
      const { data, docsToRemove } = await applyChanges(body);
      for (const id of new Set(docsToRemove)) if (/^[a-z0-9]+$/i.test(id)) await removeFile(`docs/${id}`).catch(() => {});
      return json(data);
    } catch (e) {
      if (!(e instanceof Conflict) || attempt >= 6) throw e;
      await wait(80 + Math.random() * 200 * (attempt + 1));
    }
  }
}

async function applyChanges(body) {
  const meta = await loadMeta();
  const m = meta.value;
  const years = await loadYears(m.years);
  const dirty = new Set();
  const where = new Map();                     // id -> año donde está ahora
  for (const [y, f] of years) for (const mv of f.value.moves) where.set(mv.id, y);
  const find = id => { const y = where.get(id); return y ? years.get(y).value.moves.find(x => x.id === id) : null; };
  const remove = id => {
    const y = where.get(id); if (!y) return;
    const f = years.get(y).value; f.moves = f.moves.filter(x => x.id !== id);
    where.delete(id); dirty.add(y);
  };
  const docsToRemove = [];

  for (const mv of Array.isArray(body.upsert) ? body.upsert : []) {
    if (!mv || typeof mv.id !== 'string') continue;
    if (m.deleted[mv.id] && m.deleted[mv.id] >= (mv.updatedAt || 0)) continue;
    const cur = find(mv.id);
    if (cur && (mv.updatedAt || 0) < (cur.updatedAt || 0)) continue;
    if (cur?.docId && cur.docId !== mv.docId) docsToRemove.push(cur.docId);
    remove(mv.id);
    const y = yearOf(mv);
    // Un año nuevo puede existir ya si otro móvil lo creó y aún no figura en meta.json.
    if (!years.has(y)) {
      const f = await readJSONVersioned(yearPath(y), { moves: [] });
      if (!Array.isArray(f.value?.moves)) f.value = { moves: [] };
      for (const x of f.value.moves) if (!where.has(x.id)) where.set(x.id, y);
      years.set(y, f);
    }
    years.get(y).value.moves.push(mv);
    where.set(mv.id, y); dirty.add(y);
    delete m.deleted[mv.id];
  }
  for (const id of Array.isArray(body.delete) ? body.delete : []) {
    if (typeof id !== 'string') continue;
    const cur = find(id);
    if (cur?.docId) docsToRemove.push(cur.docId);
    remove(id);
    m.deleted[id] = Date.now();
  }
  for (const id of Array.isArray(body.deleteDocs) ? body.deleteDocs : []) docsToRemove.push(id);
  if (Array.isArray(body.projects)) m.projects = [...new Set([...(m.projects || []), ...body.projects.filter(p => typeof p === 'string')])];

  const cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
  for (const [id, at] of Object.entries(m.deleted)) if (at < cutoff) delete m.deleted[id];

  // Primero los años y al final meta.json, que hace de "versión" de todo el conjunto.
  for (const y of dirty) await writeJSONIf(yearPath(y), years.get(y).value, years.get(y).etag);
  m.years = [...years.keys()].sort();
  m.updatedAt = Date.now();
  const data = publicData(m, years);
  // Copia de seguridad semanal de todos los movimientos (sin las facturas).
  let oldBackups = [];
  if ((m.lastBackup || 0) < Date.now() - BACKUP_DAYS * 864e5) {
    const name = `backups/fcsalud-${new Date().toISOString().slice(0, 10)}.json`;
    await writeJSON(name, { ...data, backupAt: new Date().toISOString() });
    m.lastBackup = Date.now();
    m.backups = [...(m.backups || []).filter(b => b !== name), name];
    oldBackups = m.backups.splice(0, Math.max(0, m.backups.length - BACKUPS_KEPT));
  }
  await writeJSONIf(META, m, meta.etag);
  for (const b of oldBackups) await removeFile(b).catch(() => {});
  return { data, docsToRemove };
}

// Lee meta.json. La primera vez pasa los datos del archivo único antiguo a archivos por año
// (el antiguo se queda como estaba, como copia).
async function loadMeta() {
  const meta = await readJSONVersioned(META, null);
  if (meta.value) return { value: { ...emptyMeta(), ...meta.value }, etag: meta.etag };
  const legacy = await readJSON(LEGACY, null);
  const fresh = emptyMeta();
  if (legacy) {
    const byYear = new Map();
    for (const mv of legacy.moves || []) { const y = yearOf(mv); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(mv); }
    for (const [y, list] of byYear) {
      try { await writeJSONIf(yearPath(y), { moves: list }, null); } catch (e) { if (!(e instanceof Conflict)) throw e; }
    }
    Object.assign(fresh, { years: [...byYear.keys()].sort(), deleted: legacy.deleted || {}, projects: legacy.projects || [], updatedAt: legacy.updatedAt || Date.now() });
  }
  try { await writeJSONIf(META, fresh, null); } catch (e) { if (!(e instanceof Conflict)) throw e; }
  const again = await readJSONVersioned(META, null);
  return { value: { ...emptyMeta(), ...(again.value || fresh) }, etag: again.etag };
}

async function loadYears(list) {
  const years = new Map();
  await Promise.all((list || []).map(async y => {
    const f = await readJSONVersioned(yearPath(y), { moves: [] });
    if (!Array.isArray(f.value?.moves)) f.value = { moves: [] };
    years.set(y, f);
  }));
  return years;
}

// Si un movimiento llegara a estar en dos años (cambio de fecha a medio guardar), gana la versión más reciente.
function publicData(m, years) {
  const byId = new Map();
  for (const f of years.values()) for (const mv of f.value.moves) {
    const cur = byId.get(mv.id);
    if (!cur || (mv.updatedAt || 0) >= (cur.updatedAt || 0)) byId.set(mv.id, mv);
  }
  return { moves: [...byId.values()], deleted: m.deleted, projects: m.projects, updatedAt: m.updatedAt };
}
