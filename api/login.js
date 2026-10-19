import { checkPassword, sessionCookie, clearCookie, isAuthed, json, wait } from './_lib.js';

// Comprueba si la sesión sigue activa.
export function GET(request) {
  return json({ ok: isAuthed(request) }, isAuthed(request) ? 200 : 401);
}

// Inicia sesión con la contraseña de la clínica.
export async function POST(request) {
  let pw = '';
  try { pw = String((await request.json()).password || ''); } catch {}
  if (!pw || !(await checkPassword(pw))) { await wait(700); return json({ error: 'password' }, 401); }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie() });
}

// Cierra la sesión en este dispositivo.
export function DELETE() {
  return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
}
