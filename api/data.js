import { readJSON, writeJSON, removeFile, isAuthed, json, unauthorized } from './_lib.js';

// Todos los movimientos se guardan en un único JSON privado:
// { moves: [...], deleted: { id: fecha }, projects: [...], updatedAt }
const PATH = 'data/fcsalud.json';
const empty = () => ({ moves: [], deleted: {}, projects: [], updatedAt: 0 });

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  return json(await readJSON(PATH, empty()));
}

// Aplica cambios: { upsert: [move], delete: [id], projects: [...] } y devuelve el estado completo.
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'json' }, 400); }
  const data = await readJSON(PATH, empty());
  const byId = new Map(data.moves.map(m => [m.id, m]));
  const docsToRemove = [];
  for (const m of Array.isArray(body.upsert) ? body.upsert : []) {
    if (!m || typeof m.id !== 'string') continue;
    const cur = byId.get(m.id);
    if (data.deleted[m.id] && data.deleted[m.id] >= (m.updatedAt || 0)) continue;
    if (!cur || (m.updatedAt || 0) >= (cur.updatedAt || 0)) {
      if (cur?.docId && cur.docId !== m.docId) docsToRemove.push(cur.docId);
      byId.set(m.id, m);
      delete data.deleted[m.id];
    }
  }
  for (const id of Array.isArray(body.delete) ? body.delete : []) {
    const cur = byId.get(id);
    if (cur?.docId) docsToRemove.push(cur.docId);
    byId.delete(id);
    data.deleted[id] = Date.now();
  }
  for (const id of Array.isArray(body.deleteDocs) ? body.deleteDocs : []) docsToRemove.push(id);
  if (Array.isArray(body.projects)) data.projects = [...new Set([...(data.projects || []), ...body.projects.filter(p => typeof p === 'string')])];
  data.moves = [...byId.values()];
  data.updatedAt = Date.now();
  await writeJSON(PATH, data);
  for (const id of new Set(docsToRemove)) if (/^[a-z0-9]+$/i.test(id)) await removeFile(`docs/${id}`).catch(() => {});
  return json(data);
}
