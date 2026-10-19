import { checkPassword, setPassword, isAuthed, json, unauthorized, wait } from './_lib.js';

// Cambia la contraseña: { current, next }.
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  let body = {};
  try { body = await request.json(); } catch {}
  const next = String(body.next || '');
  if (next.length < 6) return json({ error: 'short' }, 400);
  if (!(await checkPassword(String(body.current || '')))) { await wait(700); return json({ error: 'password' }, 403); }
  await setPassword(next);
  return json({ ok: true });
}
