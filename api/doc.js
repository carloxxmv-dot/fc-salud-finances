import { readFileMeta, writeFile, removeFile, isAuthed, json, unauthorized } from './_lib.js';

// Justificantes (fotos y PDF) en el almacén privado: /api/doc?id=...
const MAX = 4 * 1024 * 1024;
const docId = request => {
  const id = new URL(request.url).searchParams.get('id') || '';
  return /^[a-z0-9]{6,40}$/i.test(id) ? id : null;
};

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const id = docId(request); if (!id) return json({ error: 'id' }, 400);
  const f = await readFileMeta(`docs/${id}`);
  if (!f) return json({ error: 'not_found' }, 404);
  return new Response(f.body, { headers: { 'content-type': f.contentType, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
}

export async function PUT(request) {
  if (!isAuthed(request)) return unauthorized();
  const id = docId(request); if (!id) return json({ error: 'id' }, 400);
  const body = Buffer.from(await request.arrayBuffer());
  if (!body.length) return json({ error: 'empty' }, 400);
  if (body.length > MAX) return json({ error: 'too_large' }, 413);
  const type = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  if (!/^(image\/[\w.+-]+|application\/pdf)$/.test(type)) return json({ error: 'type' }, 415);
  await writeFile(`docs/${id}`, body, type);
  return json({ ok: true });
}

export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  const id = docId(request); if (!id) return json({ error: 'id' }, 400);
  await removeFile(`docs/${id}`).catch(() => {});
  return json({ ok: true });
}
