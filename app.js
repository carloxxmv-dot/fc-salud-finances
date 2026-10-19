/* FCSALUD · Control diario (PWA)
   Registro de cobros por TPV y efectivo, y de gastos, separados por
   Fisioterapia y Podología. Los datos se guardan en el propio dispositivo
   (IndexedDB) y los justificantes se conservan junto a cada gasto. */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const TYPES = {
  tpv: { label: 'TPV', long: 'Cobro con tarjeta', cls: 'tpv' },
  cash: { label: 'Efectivo', long: 'Cobro en caja', cls: 'cash' },
  expense: { label: 'Gasto', long: 'Gasto', cls: 'expense' }
};
const AREAS = { 'Fisioterapia': 'physio', 'Podología': 'podo' };
const ICONS = {
  tpv: '<svg viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/></svg>',
  cash: '<svg viewBox="0 0 24 24"><path d="M17 7.5A6 6 0 1 0 17 16.5M5 10.5h8M5 13.5h8"/></svg>',
  expense: '<svg viewBox="0 0 24 24"><path d="M7 3.5h10v17l-2.5-1.5-2.5 1.5-2.5-1.5L7 20.5z"/><path d="M10 8.5h4M10 12h4"/></svg>',
  clip: '<svg class="clip" viewBox="0 0 24 24"><path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5V8h4"/></svg>',
  empty: '<svg viewBox="0 0 24 24"><path d="M4 7h16v12H4z"/><path d="M4 7l2-3h12l2 3M9 12h6"/></svg>'
};

/* ---------- Utilidades ---------- */
const euroFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const euro = n => euroFmt.format(n || 0);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); };
const monthOf = s => s.slice(0, 7);
const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return cap(new Date(y, mo - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const dayLabel = s => cap(parseISO(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
function parseAmount(v) {
  if (v == null) return NaN;
  let s = String(v).replace(/\s|€/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = parseFloat(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const fmtInput = n => (n ? String(n).replace('.', ',') : '');
const amountOf = m => (m.type === 'expense' ? m.total : m.amount) || 0;

/* ---------- Ajustes (localStorage) ---------- */
const settings = (() => {
  const def = { projects: ['Clínica FC Salud'], project: 'Clínica FC Salud', area: 'Fisioterapia' };
  let s = def;
  try { s = { ...def, ...JSON.parse(localStorage.getItem('fcsalud:settings') || '{}') }; } catch (e) {}
  return s;
})();
function saveSettings() { try { localStorage.setItem('fcsalud:settings', JSON.stringify(settings)); } catch (e) {} }

/* ---------- Base de datos (IndexedDB) ---------- */
const db = {
  _db: null,
  open() {
    return new Promise((ok, no) => {
      const r = indexedDB.open('fcsalud', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('moves')) d.createObjectStore('moves', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
      };
      r.onsuccess = () => { this._db = r.result; ok(); };
      r.onerror = () => no(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((ok, no) => {
      const t = this._db.transaction(store, mode), st = t.objectStore(store);
      const res = fn(st);
      t.oncomplete = () => ok(res && 'result' in res ? res.result : undefined);
      t.onerror = () => no(t.error);
    });
  },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  get(store, id) { return this.tx(store, 'readonly', s => s.get(id)); },
  put(store, v) { return this.tx(store, 'readwrite', s => s.put(v)); },
  del(store, id) { return this.tx(store, 'readwrite', s => s.delete(id)); },
  clear(store) { return this.tx(store, 'readwrite', s => s.clear()); }
};
// Si IndexedDB no está disponible (modo privado antiguo), se trabaja en memoria.
const memory = { moves: new Map(), docs: new Map() };
let useMemory = false;
const store = {
  all: s => useMemory ? Promise.resolve([...memory[s].values()]) : db.all(s),
  get: (s, id) => useMemory ? Promise.resolve(memory[s].get(id)) : db.get(s, id),
  put: (s, v) => useMemory ? (memory[s].set(v.id, v), Promise.resolve()) : db.put(s, v),
  del: (s, id) => useMemory ? (memory[s].delete(id), Promise.resolve()) : db.del(s, id),
  clear: s => useMemory ? (memory[s].clear(), Promise.resolve()) : db.clear(s)
};

/* ---------- Estado ---------- */
let moves = [];
const state = { view: 'hoy', day: todayISO(), month: monthOf(todayISO()), filter: 'all', query: '' };
const projectMoves = () => moves.filter(m => (m.project || 'Clínica FC Salud') === settings.project);

function totals(list) {
  const t = { tpv: 0, cash: 0, expense: 0, physio: 0, podo: 0, tpv_physio: 0, tpv_podo: 0, cash_physio: 0, cash_podo: 0 };
  for (const m of list) {
    const a = amountOf(m);
    t[m.type] += a;
    if (m.type !== 'expense') { const area = AREAS[m.service] || 'physio'; t[area] += a; t[`${m.type}_${area}`] += a; }
  }
  t.income = t.tpv + t.cash;
  t.balance = t.income - t.expense;
  return t;
}

/* ---------- Renderizado ---------- */
function itemHTML(m, showDate) {
  const t = TYPES[m.type], area = AREAS[m.service] || 'physio';
  const title = m.type === 'expense' ? (m.party || 'Gasto') : (m.note || t.long);
  const meta = `<span class="badge b-${t.cls}">${t.label}</span><span class="badge b-${area}">${esc(m.service)}</span>${m.docId ? ICONS.clip : ''}${showDate ? `<small class="muted" style="margin:0">${parseISO(m.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</small>` : ''}`;
  return `<button class="item" data-id="${m.id}">
    <span class="item-ic i-${t.cls}">${ICONS[m.type]}</span>
    <span class="item-main"><strong>${esc(title)}</strong><span class="item-meta">${meta}</span></span>
    <span class="item-amt ${m.type === 'expense' ? 'neg' : ''}">${m.type === 'expense' ? '−' : ''}${euro(amountOf(m))}</span>
  </button>`;
}
const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);

function renderHoy() {
  const d = state.day, today = todayISO();
  $('#dayEyebrow').textContent = d === today ? 'HOY' : d === addDays(today, -1) ? 'AYER' : parseISO(d).getFullYear();
  $('#dayTitle').textContent = dayLabel(d);
  $('#dayInput').value = d;
  $('#dayNext').disabled = d >= today;
  const list = projectMoves().filter(m => m.date === d).sort(byNewest), t = totals(list);
  $('#dayBalance').textContent = euro(t.balance);
  $('#dayIncome').textContent = euro(t.income);
  $('#dayExpense').textContent = euro(t.expense);
  $('#qTpv').textContent = euro(t.tpv);
  $('#qCash').textContent = euro(t.cash);
  $('#qExpense').textContent = euro(t.expense);
  $('#dayCount').textContent = list.length;
  $('#dayList').innerHTML = list.length ? list.map(m => itemHTML(m)).join('') :
    `<div class="empty">${ICONS.empty}<strong>Sin movimientos ${d === today ? 'hoy' : 'este día'}</strong><p>Pulsa TPV, Efectivo o Gasto para registrar el primero.</p></div>`;
}

function renderHist() {
  $('#histMonth').textContent = monthLabel(state.month);
  const q = state.query.trim().toLowerCase(), f = state.filter;
  const list = projectMoves().filter(m => monthOf(m.date) === state.month)
    .filter(m => f === 'all' || m.type === f || m.service === f)
    .filter(m => !q || [m.party, m.note, m.service, TYPES[m.type].label, m.file?.name].join(' ').toLowerCase().includes(q))
    .sort(byNewest);
  const t = totals(list);
  $('#histSum').innerHTML = list.length ? `<span>${list.length} movimiento${list.length > 1 ? 's' : ''}</span><span>Ingresos <b>${euro(t.income)}</b> · Gastos <b>${euro(t.expense)}</b></span>` : '';
  if (!list.length) {
    $('#histList').innerHTML = `<div class="list"><div class="empty">${ICONS.empty}<strong>Nada por aquí</strong><p>${q || f !== 'all' ? 'Prueba con otro filtro o búsqueda.' : 'No hay movimientos registrados en este mes.'}</p></div></div>`;
    return;
  }
  const days = [...new Set(list.map(m => m.date))];
  $('#histList').innerHTML = days.map(day => {
    const xs = list.filter(m => m.date === day), dt = totals(xs);
    return `<div class="day-head"><strong>${dayLabel(day)}</strong><span>${dt.balance >= 0 ? '+' : ''}${euro(dt.balance)}</span></div><div class="day-group">${xs.map(m => itemHTML(m)).join('')}</div>`;
  }).join('');
}

function renderResumen() {
  $('#sumMonth').textContent = monthLabel(state.month);
  const list = projectMoves().filter(m => monthOf(m.date) === state.month), t = totals(list);
  $('#mBalance').textContent = euro(t.balance);
  $('#mIncome').textContent = euro(t.income);
  $('#mExpense').textContent = euro(t.expense);
  $('#mTpvPodo').textContent = euro(t.tpv_podo);
  $('#mTpvPhysio').textContent = euro(t.tpv_physio);
  $('#mCashPodo').textContent = euro(t.cash_podo);
  $('#mCashPhysio').textContent = euro(t.cash_physio);
  $('#mTotal').textContent = euro(t.income);
  renderPathStats();
  renderPurgeNote(list);
  const pp = t.income ? Math.round(t.physio / t.income * 100) : 0;
  const [bp, bo] = $$('#areaBar i');
  bp.style.width = t.income ? pp + '%' : '0';
  bo.style.width = t.income ? (100 - pp) + '%' : '0';
  $('#areaLegend').innerHTML = `<span><i class="dot" style="background:var(--physio)"></i>Fisioterapia <b>${t.income ? pp : 0}%</b></span><span><i class="dot" style="background:var(--podo)"></i>Podología <b>${t.income ? 100 - pp : 0}%</b></span>`;

  const [y, mo] = state.month.split('-').map(Number), nDays = new Date(y, mo, 0).getDate();
  const perDay = Array.from({ length: nDays }, (_, i) => {
    const ds = `${state.month}-${pad(i + 1)}`, dt = totals(list.filter(m => m.date === ds));
    return { ds, inc: dt.income, exp: dt.expense };
  });
  const max = Math.max(...perDay.map(d => Math.max(d.inc, d.exp)), 0);
  const today = todayISO();
  $('#dayChart').innerHTML = max ? perDay.map(d => `<div class="col${d.ds === today ? ' today' : ''}" title="${dayLabel(d.ds)}: ${euro(d.inc)} / ${euro(d.exp)}"><i class="ci" style="height:${d.inc / max * 100}%"></i><i class="co" style="height:${d.exp / max * 100}%"></i></div>`).join('')
    : '<div class="chart-empty">Sin datos este mes</div>';
}

/* ---------- Patologías ---------- */
// La nota de cada cobro es la patología atendida. Si hay varias separadas por comas,
// el importe se reparte a partes iguales entre ellas.
const pathKey = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const splitPaths = note => String(note || '').split(/[,;+]/).map(x => x.trim()).filter(Boolean);
function pathologyStats(list) {
  const map = new Map();
  let none = { count: 0, amount: 0 };
  for (const m of list) {
    if (m.type === 'expense') continue;
    const parts = splitPaths(m.note), a = amountOf(m);
    if (!parts.length) { none.count++; none.amount += a; continue; }
    for (const p of parts) {
      const k = pathKey(p);
      const e = map.get(k) || { count: 0, amount: 0, names: {} };
      e.count++; e.amount += a / parts.length; e.names[p] = (e.names[p] || 0) + 1;
      map.set(k, e);
    }
  }
  const rows = [...map.values()].map(e => {
    const name = Object.entries(e.names).sort((x, y) => y[1] - x[1])[0][0];
    return { name: cap(name), count: e.count, amount: e.amount };
  });
  return { rows, none };
}
const pathView = { period: 'month', sort: 'count' };
function renderPathStats() {
  const year = state.month.slice(0, 4);
  const list = projectMoves().filter(m => pathView.period === 'month' ? monthOf(m.date) === state.month : m.date.startsWith(year));
  const { rows, none } = pathologyStats(list);
  rows.sort((a, b) => pathView.sort === 'count' ? b.count - a.count || b.amount - a.amount : b.amount - a.amount || b.count - a.count);
  $$('#pathPeriod button').forEach(b => { b.classList.toggle('on', b.dataset.p === pathView.period); if (b.dataset.p === 'year') b.textContent = year; });
  $$('#pathSort button').forEach(b => b.classList.toggle('on', b.dataset.s === pathView.sort));
  if (!rows.length) {
    $('#pathStats').innerHTML = `<p class="path-empty">Escribe la patología al registrar un cobro y aquí verás cuáles atiendes más y cuánto te aportan.</p>`;
    return;
  }
  const top = rows.slice(0, 12), max = Math.max(...top.map(r => pathView.sort === 'count' ? r.count : r.amount));
  const sesiones = n => `${n} sesi${n === 1 ? 'ón' : 'ones'}`;
  $('#pathStats').innerHTML = top.map((r, i) => {
    const v = pathView.sort === 'count' ? r.count : r.amount;
    return `<div class="path-row"><span class="path-rank">${i + 1}</span><span class="path-name">${esc(r.name)}</span>
      <span class="path-val">${pathView.sort === 'count' ? `<b>${sesiones(r.count)}</b><small>${euro(r.amount)}</small>` : `<b>${euro(r.amount)}</b><small>${sesiones(r.count)}</small>`}</span>
      <span class="path-bar"><i style="width:${max ? v / max * 100 : 0}%"></i></span></div>`;
  }).join('') + (rows.length > 12 ? `<p class="path-empty">y ${rows.length - 12} más</p>` : '') +
    (none.count ? `<div class="path-row muted-row"><span class="path-rank">·</span><span class="path-name">Sin patología indicada</span><span class="path-val">${sesiones(none.count)}<br><small>${euro(none.amount)}</small></span></div>` : '');
}
$('#pathPeriod').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { pathView.period = b.dataset.p; renderPathStats(); } });
$('#pathSort').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { pathView.sort = b.dataset.s; renderPathStats(); } });

function renderProjects() {
  $('#projectName').textContent = settings.project;
  const counts = {};
  moves.forEach(m => { const p = m.project || 'Clínica FC Salud'; counts[p] = (counts[p] || 0) + 1; });
  const html = settings.projects.map(p => `<button class="project-item ${p === settings.project ? 'on' : ''}" data-project="${esc(p)}"><span class="pi-dot"></span>${esc(p)}<small>${counts[p] || 0} mov.</small></button>`).join('');
  $('#projectList').innerHTML = html;
  $('#projectList2').innerHTML = html;
  $$('#defaultArea button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.area));
}

function render() {
  renderProjects();
  if (state.view === 'hoy') renderHoy();
  if (state.view === 'historial') renderHist();
  if (state.view === 'resumen') renderResumen();
}

/* ---------- Navegación ---------- */
function go(view) {
  state.view = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  window.scrollTo({ top: 0 });
  render();
}
$$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.view)));
$('#dayPrev').onclick = () => { state.day = addDays(state.day, -1); renderHoy(); };
$('#dayNext').onclick = () => { if (state.day < todayISO()) { state.day = addDays(state.day, 1); renderHoy(); } };
$('#dayInput').onchange = e => { if (e.target.value) { state.day = e.target.value; state.month = monthOf(state.day); renderHoy(); } };
$$('[data-month]').forEach(b => b.addEventListener('click', () => { state.month = addMonths(state.month, +b.dataset.month); render(); }));
$('#search').addEventListener('input', e => { state.query = e.target.value; renderHist(); });
$('#histChips').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  state.filter = c.dataset.f;
  $$('#histChips .chip').forEach(x => x.classList.toggle('on', x === c));
  renderHist();
});
// Deslizar horizontalmente sobre la tarjeta principal cambia de día.
(() => {
  let x0 = null;
  const hero = $('#view-hoy .hero');
  hero.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) < 60) return;
    if (dx > 0) $('#dayPrev').click(); else $('#dayNext').click();
  });
})();

/* ---------- Hojas inferiores, con soporte del botón Atrás ---------- */
const stack = [];
function openLayer(el, onClose, { push = true } = {}) {
  stack.push({ el, onClose });
  if (push) history.pushState({ layer: stack.length }, '');
}
function closeTop(fromPop) {
  const top = stack.pop(); if (!top) return;
  top.onClose();
  if (!fromPop && history.state && history.state.layer) { ignorePop = true; history.back(); }
}
let ignorePop = false;
window.addEventListener('popstate', () => { if (ignorePop) { ignorePop = false; return; } closeTop(true); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) closeTop(); });

function showSheet(id, opts) {
  const w = $('#' + id);
  w.classList.add('open'); w.setAttribute('aria-hidden', 'false');
  openLayer(w, () => { w.classList.remove('open'); w.setAttribute('aria-hidden', 'true'); w.querySelector('.sheet').style.transform = ''; }, opts);
}
// Cambiar de una hoja a otra sin tocar el historial.
function swapSheet(fromId, toId) {
  const top = stack[stack.length - 1];
  if (top && top.el.id === fromId) { stack.pop(); top.onClose(); }
  showSheet(toId, { push: false });
}
$$('.sheet-wrap').forEach(w => {
  w.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeTop(); });
  // Arrastrar hacia abajo para cerrar.
  const sheet = w.querySelector('.sheet');
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', e => {
    if (sheet.scrollTop > 0 || e.target.closest('input,textarea,select')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 == null) return;
    sheet.style.transition = '';
    if (dy > 110) closeTop(); else sheet.style.transform = '';
    y0 = null;
  });
});

/* ---------- Avisos ---------- */
let toastTimer;
function toast(text, action) {
  $('#toastText').textContent = text;
  const b = $('#toastAction');
  b.hidden = !action;
  b.onclick = action ? () => { action(); $('#toast').classList.remove('show'); } : null;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), action ? 5000 : 2400);
}

/* ---------- Alta y edición de movimientos ---------- */
const form = { id: null, type: 'tpv', service: settings.area, doc: null, docId: null, removeDoc: false };
let docPreviewUrl = null;

function setType(type) {
  form.type = type;
  $$('#typeSeg button').forEach(b => b.classList.toggle('on', b.dataset.type === type));
  const sheet = $('#addSheet .sheet');
  sheet.classList.toggle('mode-expense', type === 'expense');
  sheet.classList.toggle('mode-income', type !== 'expense');
  $('#amountLabel').textContent = type === 'expense' ? 'Gasto total' : type === 'tpv' ? 'Cobrado con tarjeta' : 'Cobrado en efectivo';
  renderPresets();
  updateSaveLabel();
}
function setArea(area) {
  form.service = area;
  $$('#areaSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === area));
}
function renderPresets() {
  // Importes más usados para este tipo, para registrar con un toque.
  const freq = {};
  projectMoves().filter(m => m.type === form.type).forEach(m => { const a = amountOf(m); if (a) freq[a] = (freq[a] || 0) + 1; });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => +x[0]);
  const list = top.length ? top : (form.type === 'expense' ? [] : [30, 40, 50, 60]);
  $('#presets').innerHTML = list.map(a => `<button type="button" data-a="${a}">${euro(a)}</button>`).join('');
  // Patologías más frecuentes, para escribirlas con un toque.
  if (form.type !== 'expense') {
    const { rows } = pathologyStats(projectMoves());
    rows.sort((a, b) => b.count - a.count);
    $('#pathList').innerHTML = rows.slice(0, 40).map(r => `<option value="${esc(r.name)}">`).join('');
    renderPathChips(rows.slice(0, 8).map(r => r.name));
  }
  // Proveedores ya usados.
  const parties = [...new Set(projectMoves().filter(m => m.type === 'expense' && m.party).map(m => m.party))].slice(0, 30);
  $('#partyList').innerHTML = parties.map(p => `<option value="${esc(p)}">`).join('');
}
let pathChipNames = [];
function renderPathChips(names) {
  if (names) pathChipNames = names;
  const cur = splitPaths($('#noteInput').value).map(pathKey);
  $('#pathChips').innerHTML = pathChipNames.map(n => `<button type="button" class="${cur.includes(pathKey(n)) ? 'on' : ''}" data-p="${esc(n)}">${esc(n)}</button>`).join('');
}
$('#pathChips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const parts = splitPaths($('#noteInput').value), k = pathKey(b.dataset.p);
  const i = parts.findIndex(x => pathKey(x) === k);
  if (i >= 0) parts.splice(i, 1); else parts.push(b.dataset.p);
  $('#noteInput').value = parts.join(', ');
  renderPathChips(); vibrate(5);
});
$('#noteInput').addEventListener('input', () => renderPathChips());
$('#noteInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveMove(); } });
function updateSaveLabel() {
  const inp = $('#amountInput');
  inp.style.width = Math.max(3, (inp.value || inp.placeholder).length + 0.6) + 'ch';
  const a = parseAmount($('#amountInput').value);
  const verb = form.id ? 'Guardar cambios' : form.type === 'expense' ? 'Guardar gasto' : 'Guardar cobro';
  $('#saveBtn').textContent = a > 0 ? `${verb} · ${euro(a)}` : verb;
}
function showDoc(doc) {
  if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
  docPreviewUrl = null;
  $('#docActions').hidden = !!doc;
  $('#docAttached').hidden = !doc;
  if (!doc) return;
  docPreviewUrl = URL.createObjectURL(doc.blob);
  $('#docName').textContent = doc.name;
  const th = $('#docThumb');
  if ((doc.type || '').startsWith('image/')) { th.style.backgroundImage = `url("${docPreviewUrl}")`; th.innerHTML = ''; }
  else { th.style.backgroundImage = ''; th.innerHTML = ICONS.doc; }
}
function openAdd(type = 'tpv', move = null, swapFrom = null) {
  $('#formError').textContent = '';
  form.id = move ? move.id : null;
  form.doc = null; form.docId = move?.docId || null; form.removeDoc = false;
  $('#addTitle').textContent = move ? 'Editar movimiento' : 'Nuevo movimiento';
  setType(move ? move.type : type);
  setArea(move ? move.service : settings.area);
  $('#amountInput').value = move ? fmtInput(amountOf(move)) : '';
  $('#noteInput').value = move?.note || '';
  renderPathChips();
  $('#partyInput').value = move?.party || '';
  $('#dateInput').value = move ? move.date : state.day;
  $('#docHint').textContent = 'Toca para verlo';
  showDoc(null);
  if (form.docId) store.get('docs', form.docId).then(d => d && showDoc(d));
  updateSaveLabel();
  if (swapFrom) swapSheet(swapFrom, 'addSheet'); else showSheet('addSheet');
  // En ingresos se enfoca el importe directamente.
  if (form.type !== 'expense' && !move) setTimeout(() => $('#amountInput').focus({ preventScroll: true }), 320);
}
$$('[data-add]').forEach(b => b.addEventListener('click', () => { vibrate(8); openAdd(b.dataset.add); }));
$('#fab').onclick = () => { vibrate(8); openAdd(settings.lastType || 'tpv'); };
$('#typeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setType(b.dataset.type); vibrate(5); } });
$('#areaSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setArea(b.dataset.v); vibrate(5); } });
$('#presets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('#amountInput').value = fmtInput(+b.dataset.a); updateSaveLabel(); vibrate(5); } });
$('#amountInput').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9.,]/g, ''); updateSaveLabel(); $('#formError').textContent = ''; });
$('#amountInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveMove(); } });
$('#docRemove').onclick = () => { form.doc = null; form.removeDoc = true; showDoc(null); };
$('#docThumb').onclick = () => {
  if (form.doc) openViewer(form.doc);
  else if (form.docId) store.get('docs', form.docId).then(d => d && openViewer(d));
};

async function saveMove() {
  const amount = parseAmount($('#amountInput').value);
  const party = $('#partyInput').value.trim();
  if (form.type === 'expense' && !party) { $('#formError').textContent = 'Indica el proveedor o servicio'; $('#partyInput').focus(); return; }
  if (!(amount > 0)) { $('#formError').textContent = 'Escribe un importe mayor que 0'; $('#amountInput').focus(); return; }
  const prev = form.id ? moves.find(m => m.id === form.id) : null;
  const m = {
    id: form.id || uid(),
    project: prev?.project || settings.project,
    date: $('#dateInput').value || state.day,
    type: form.type,
    service: form.service,
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  if (form.type === 'expense') { m.party = party; m.total = amount; } else { m.amount = amount; m.note = splitPaths($('#noteInput').value).join(', '); }
  if (form.type === 'expense') {
    if (form.doc) {
      const docId = form.docId && !form.removeDoc ? form.docId : uid();
      await store.put('docs', { id: docId, blob: form.doc.blob, name: form.doc.name, type: form.doc.type, uploadedAt: Date.now() });
      m.docId = docId; m.docAt = Date.now(); m.file = { name: form.doc.name, type: form.doc.type };
    } else if (form.docId && !form.removeDoc) { m.docId = form.docId; m.docAt = prev?.docAt; m.file = prev?.file; }
  }
  if (prev?.docId && (form.removeDoc || form.type !== 'expense') && prev.docId !== m.docId) await store.del('docs', prev.docId);
  await store.put('moves', m);
  const i = moves.findIndex(x => x.id === m.id);
  if (i >= 0) moves[i] = m; else moves.push(m);
  if (!prev) { state.day = m.date; settings.lastType = m.type; settings.area = m.service; saveSettings(); }
  closeTop();
  vibrate([10, 40, 10]);
  render();
  toast(prev ? '✓ Cambios guardados' : m.type === 'expense' ? `✓ Gasto de ${euro(amount)} guardado` : `✓ ${TYPES[m.type].label} de ${euro(amount)} guardado`);
}
$('#saveBtn').onclick = saveMove;

/* ---------- Detalle ---------- */
let detailId = null;
function openDetail(id) {
  const m = moves.find(x => x.id === id); if (!m) return;
  detailId = id;
  const t = TYPES[m.type], area = AREAS[m.service];
  $('#detBadges').innerHTML = `<span class="badge b-${t.cls}">${t.label}</span><span class="badge b-${area}">${esc(m.service)}</span>`;
  $('#detAmount').textContent = (m.type === 'expense' ? '−' : '') + euro(amountOf(m));
  $('#detAmount').style.color = m.type === 'expense' ? 'var(--exp-ink)' : '';
  $('#detDesc').textContent = m.type === 'expense' ? m.party : (m.note || t.long);
  $('#detDate').textContent = dayLabel(m.date) + (settings.projects.length > 1 ? ' · ' + (m.project || 'Clínica FC Salud') : '');
  $('#detDoc').innerHTML = m.docPurged && !m.docId ? `<p class="muted">El justificante (${esc(m.file?.name || 'archivo')}) se borró automáticamente a los 4 meses de subirlo.</p>` : m.docId ? `<button class="det-doc" id="detDocBtn"><span class="doc-thumb">${ICONS.doc}</span><div><strong>${esc(m.file?.name || 'Justificante')}</strong><small>Ver o descargar justificante</small></div></button>` : '';
  if (m.docId) {
    store.get('docs', m.docId).then(d => {
      if (!d) return;
      const th = $('#detDocBtn .doc-thumb');
      if (th && (d.type || '').startsWith('image/')) { const u = URL.createObjectURL(d.blob); th.style.backgroundImage = `url("${u}")`; th.innerHTML = ''; }
      $('#detDocBtn').onclick = () => openViewer(d);
    });
  }
  showSheet('detailSheet');
}
document.addEventListener('click', e => {
  const it = e.target.closest('.item[data-id]');
  if (it) openDetail(it.dataset.id);
});
$('#detEdit').onclick = () => { const m = moves.find(x => x.id === detailId); if (m) openAdd(m.type, m, 'detailSheet'); };
$('#detDelete').onclick = async () => {
  const m = moves.find(x => x.id === detailId); if (!m) return;
  const doc = m.docId ? await store.get('docs', m.docId) : null;
  await store.del('moves', m.id);
  if (doc) await store.del('docs', doc.id);
  moves = moves.filter(x => x.id !== m.id);
  closeTop(); render(); vibrate(15);
  toast('Movimiento eliminado', async () => {
    await store.put('moves', m); if (doc) await store.put('docs', doc);
    moves.push(m); render();
  });
};

/* ---------- Visor de justificantes ---------- */
let viewerUrl = null;
function openViewer(doc) {
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(doc.blob);
  $('#viewerTitle').textContent = doc.name;
  const a = $('#viewerDownload'); a.href = viewerUrl; a.download = doc.name;
  $('#viewerBody').innerHTML = (doc.type || '').startsWith('image/') ? `<img src="${viewerUrl}" alt="${esc(doc.name)}">` : `<iframe src="${viewerUrl}" title="${esc(doc.name)}"></iframe>`;
  $('#viewer').hidden = false;
  openLayer($('#viewer'), () => { $('#viewer').hidden = true; $('#viewerBody').innerHTML = ''; });
}
$('#viewerClose').onclick = () => closeTop();

/* ---------- Lectura automática (OCR en el dispositivo) ---------- */
function loadScript(src, id) {
  return new Promise((ok, no) => {
    if (document.getElementById(id)) return ok();
    const s = document.createElement('script'); s.id = id; s.src = src; s.onload = ok; s.onerror = no;
    document.head.appendChild(s);
  });
}
async function pdfToImage(file) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1), vp = page.getViewport({ scale: 2 });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c;
}
// Reduce las fotos grandes del móvil para que la lectura sea rápida.
async function shrinkImage(file, max = 1800) {
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c;
}
function findAmount(text, labels) {
  for (const label of labels) {
    const re = new RegExp(label + '[^\\n\\d]{0,25}([0-9][0-9.\\s]*[,\\.][0-9]{2}|[0-9]+)', 'i'), m = text.match(re);
    if (m) { const n = parseAmount(m[1]); if (n > 0) return n; }
  }
  return null;
}
function parseExpense(text) {
  const clean = text.replace(/\r/g, ''), lines = clean.split('\n').map(x => x.trim()).filter(x => x.length > 2);
  let total = findAmount(clean, ['total\\s*(?:factura|a\\s*pagar|eur)?', 'importe\\s*total', 'a\\s*pagar', 'total']);
  if (total == null) {
    // Sin etiqueta clara: el mayor importe con decimales del documento.
    const nums = [...clean.matchAll(/([0-9]{1,3}(?:[.\s][0-9]{3})*[,\.][0-9]{2})\s*€?/g)].map(m => parseAmount(m[1])).filter(n => n > 0 && n < 100000);
    if (nums.length) total = Math.max(...nums);
  }
  const nif = clean.toUpperCase().match(/([ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Z])/);
  let party = '';
  if (nif) {
    const idx = lines.findIndex(l => l.toUpperCase().includes(nif[1]));
    const cand = lines.slice(Math.max(0, idx - 3), idx).filter(l => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(l) && !/factura|fecha|direcci[oó]n|tel[eé]fono|nif|cif/i.test(l));
    if (cand.length) party = cand[cand.length - 1];
  }
  if (!party) party = lines.find(l => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{4}/.test(l) && !/factura|fecha|total|base|iva|ticket|n[ºo]\.?\s/i.test(l)) || '';
  party = party.replace(/[|_*~•]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 70);
  return { party, total };
}
let ocrWorker = null, ocrCancelled = false;
async function readDocument(file) {
  ocrCancelled = false;
  $('#ocr').hidden = false;
  $('#ocrMsg').textContent = 'Preparando documento…';
  $('#ocrBar').style.width = '6%';
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', 'tesseract');
    const source = file.type === 'application/pdf' ? await pdfToImage(file) : await shrinkImage(file);
    if (ocrCancelled) return null;
    $('#ocrMsg').textContent = 'Buscando proveedor e importe…';
    ocrWorker = await Tesseract.createWorker('spa', 1, {
      logger: m => {
        if (m.status === 'loading language traineddata') $('#ocrBar').style.width = Math.max(10, Math.round(m.progress * 25)) + '%';
        if (m.status === 'recognizing text') $('#ocrBar').style.width = Math.round(25 + m.progress * 75) + '%';
      }
    });
    const res = await ocrWorker.recognize(source);
    return ocrCancelled ? null : parseExpense(res.data.text);
  } finally {
    if (ocrWorker) { ocrWorker.terminate().catch(() => {}); ocrWorker = null; }
    $('#ocr').hidden = true;
  }
}
$('#ocrCancel').onclick = () => { ocrCancelled = true; if (ocrWorker) ocrWorker.terminate().catch(() => {}); $('#ocr').hidden = true; };

async function attachFile(file) {
  if (!file) return;
  form.doc = { blob: file, name: file.name || 'foto.jpg', type: file.type };
  form.removeDoc = false;
  showDoc(form.doc);
  $('#docHint').textContent = 'Leyendo…';
  try {
    const r = await readDocument(file);
    if (!r) { $('#docHint').textContent = 'Rellena los datos a mano'; return; }
    if (r.party && !$('#partyInput').value.trim()) $('#partyInput').value = r.party;
    if (r.total) $('#amountInput').value = fmtInput(r.total);
    updateSaveLabel();
    $('#docHint').textContent = r.total || r.party ? 'Datos leídos: revísalos' : 'No se leyó el importe: escríbelo';
    vibrate([8, 30, 8]);
  } catch (e) {
    $('#docHint').textContent = 'No se pudo leer: rellénalo a mano';
    toast(navigator.onLine ? 'No se pudo leer el documento' : 'Sin conexión: la lectura automática necesita internet la primera vez');
  }
}
$('#camInput').onchange = e => { attachFile(e.target.files[0]); e.target.value = ''; };
$('#fileInput').onchange = e => { attachFile(e.target.files[0]); e.target.value = ''; };

/* ---------- PDF mensual para la asesoría ---------- */
async function imageDataURL(src) {
  const b = await (await fetch(src)).blob();
  return new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
}
const pdfSafe = v => String(v ?? '').replace(/[–—−]/g, '-').replace(/ | /g, ' ');
async function buildMonthlyPdf() {
  const rows = projectMoves().filter(m => monthOf(m.date) === state.month).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  if (!rows.length) { toast('No hay movimientos en ' + monthLabel(state.month)); return null; }
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js', 'jspdf-at');
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a4' }), t = totals(rows);
  const expenses = rows.filter(m => m.type === 'expense');
  const withDoc = expenses.filter(m => m.docId);
  const label = monthLabel(state.month);
  doc.setFillColor(165, 178, 169); doc.rect(0, 0, 210, 32, 'F');
  try { doc.addImage(await imageDataURL('icons/icon-192.png'), 'PNG', 13, 6, 20, 20); } catch (e) {}
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('FCSALUD', 38, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(pdfSafe(settings.project + ' - Informe mensual para la asesoría'), 38, 22);
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(pdfSafe(label), 196, 18, { align: 'right' });
  doc.setTextColor(36, 49, 42); doc.setFontSize(14); doc.text('Resumen mensual', 14, 44);
  // Cuadros: cobros por forma de pago y área, y después totales.
  const box = (x, y, w, title, value, fill, bold) => {
    doc.setFillColor(...fill); doc.roundedRect(x, y, w, 16, 2, 2, 'F');
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...(bold ? [255, 255, 255] : [104, 120, 111])); doc.text(pdfSafe(title), x + 4, y + 5.5);
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...(bold ? [255, 255, 255] : [36, 49, 42])); doc.text(pdfSafe(euro(value)), x + 4, y + 12.5);
  };
  [['TPV Podología', t.tpv_podo, [223, 242, 238]], ['TPV Fisioterapia', t.tpv_physio, [223, 242, 238]], ['Efectivo Podología', t.cash_podo, [251, 240, 217]], ['Efectivo Fisioterapia', t.cash_physio, [251, 240, 217]]]
    .forEach((m, i) => box(14 + i * 46, 49, 43, m[0], m[1], m[2]));
  [['Total cobrado', t.income, [82, 103, 89], true], ['Gastos', t.expense, [250, 231, 229]], ['Balance', t.balance, [228, 235, 230]]]
    .forEach((m, i) => box(14 + i * 61.33, 69, 58.33, m[0], m[1], m[2], m[3]));
  doc.setTextColor(36, 49, 42); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Gastos del mes', 14, 100);
  let end;
  if (expenses.length) {
    doc.autoTable({
      startY: 104, head: [['Fecha', 'Área', 'Proveedor o servicio', 'Factura', 'Importe']],
      body: expenses.map(m => [parseISO(m.date).toLocaleDateString('es-ES'), m.service, pdfSafe(m.party), m.docId ? 'Adjunta' : m.docPurged ? 'Borrada' : '-', pdfSafe(euro(m.total))]),
      foot: [[{ content: 'Total gastos', colSpan: 4 }, pdfSafe(euro(t.expense))]],
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.6, textColor: [36, 49, 42], lineColor: [224, 230, 226] },
      headStyles: { fillColor: [82, 103, 89], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [250, 231, 229], textColor: [161, 66, 60], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 247, 245] },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 28 }, 2: { cellWidth: 84 }, 3: { cellWidth: 20 }, 4: { cellWidth: 26, halign: 'right' } }
    });
    end = doc.lastAutoTable.finalY + 9;
  } else {
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(104, 120, 111); doc.text('No hay gastos registrados este mes.', 14, 110); end = 120;
  }
  if (end > 275) { doc.addPage(); end = 20; }
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(104, 120, 111);
  doc.text(pdfSafe((withDoc.length ? `Se adjuntan a continuación ${withDoc.length} factura${withDoc.length > 1 ? 's' : ''}. ` : '') + 'Informe generado por FCSALUD; los importes deben revisarse con la asesoría.'), 14, end, { maxWidth: 182 });
  const report = doc.output('arraybuffer'), name = `FCSALUD_${state.month}.pdf`;
  if (!withDoc.length) return { blob: new Blob([report], { type: 'application/pdf' }), name };
  return { blob: await appendInvoices(report, withDoc), name };
}

// Añade al informe una página por cada imagen y por cada página de los PDF subidos.
async function appendInvoices(reportBytes, list) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'pdf-lib');
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const out = await PDFDocument.load(reportBytes);
  const font = await out.embedFont(StandardFonts.Helvetica), bold = await out.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 36, HEAD = 46;
  const ansi = s => pdfSafe(s).replace(/[^\x20-\x7E -ÿ€]/g, '');
  const header = (page, i, m, extra) => {
    page.drawRectangle({ x: 0, y: H - HEAD, width: W, height: HEAD, color: rgb(0.894, 0.922, 0.902) });
    page.drawText(ansi(`Factura ${i + 1} de ${list.length}${extra || ''}`), { x: M, y: H - 20, size: 9, font, color: rgb(0.41, 0.47, 0.44) });
    page.drawText(ansi(`${parseISO(m.date).toLocaleDateString('es-ES')} · ${m.party} · ${m.service} · ${euro(m.total)}`).slice(0, 95), { x: M, y: H - 35, size: 12, font: bold, color: rgb(0.14, 0.19, 0.16) });
  };
  const fit = (w, h) => { const k = Math.min((W - 2 * M) / w, (H - HEAD - 2 * M) / h, 1.5); return { width: w * k, height: h * k, x: (W - w * k) / 2, y: (H - HEAD - M) - h * k }; };
  for (let i = 0; i < list.length; i++) {
    const m = list[i], d = await store.get('docs', m.docId);
    if (!d) continue;
    try {
      if (d.type === 'application/pdf' || /\.pdf$/i.test(d.name)) {
        const src = await PDFDocument.load(await d.blob.arrayBuffer(), { ignoreEncryption: true });
        const pages = await out.embedPages(src.getPages());
        pages.forEach((ep, j) => {
          const page = out.addPage([W, H]);
          header(page, i, m, pages.length > 1 ? ` · página ${j + 1} de ${pages.length}` : '');
          page.drawPage(ep, fit(ep.width, ep.height));
        });
      } else {
        const c = await shrinkImage(d.blob, 2000);
        const jpg = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
        const img = await out.embedJpg(await jpg.arrayBuffer());
        const page = out.addPage([W, H]);
        header(page, i, m);
        page.drawImage(img, fit(img.width, img.height));
      }
    } catch (e) {
      const page = out.addPage([W, H]);
      header(page, i, m);
      page.drawText(ansi(`No se pudo adjuntar el archivo «${d.name}». Envíalo por separado.`), { x: M, y: H - HEAD - 40, size: 11, font, color: rgb(0.63, 0.26, 0.24) });
    }
  }
  return new Blob([await out.save()], { type: 'application/pdf' });
}

/* ---------- Borrado automático de justificantes (4 meses) ---------- */
const KEEP_MONTHS = 4;
const expiryOf = ts => { const d = new Date(ts); d.setMonth(d.getMonth() + KEEP_MONTHS); return d; };
async function purgeOldDocs() {
  const docs = await store.all('docs'), now = Date.now();
  let n = 0;
  for (const d of docs) {
    const m = moves.find(x => x.docId === d.id);
    const uploaded = d.uploadedAt || m?.docAt || m?.createdAt || now;
    if (m && expiryOf(uploaded).getTime() > now) continue;
    await store.del('docs', d.id);
    if (m) { m.docId = null; m.docPurged = true; await store.put('moves', m); n++; }
  }
  return n;
}
function renderPurgeNote(list) {
  const withDoc = list.filter(m => m.type === 'expense' && m.docId);
  const el = $('#purgeNote');
  if (!withDoc.length) { el.hidden = true; return; }
  const first = new Date(Math.min(...withDoc.map(m => expiryOf(m.docAt || m.createdAt).getTime())));
  el.hidden = false;
  el.textContent = `El informe incluye ${withDoc.length} factura${withDoc.length > 1 ? 's' : ''}. Se borrarán del móvil a partir del ${first.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}: descarga el informe antes.`;
}
async function withBusy(btn, fn) {
  const html = btn.innerHTML; btn.disabled = true; btn.textContent = 'Preparando PDF…';
  try { await fn(); } catch (e) { toast('No se pudo generar el PDF. Revisa la conexión.'); } finally { btn.disabled = false; btn.innerHTML = html; }
}
$('#pdfBtn').onclick = () => withBusy($('#pdfBtn'), async () => {
  const r = await buildMonthlyPdf(); if (!r) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = r.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('✓ PDF descargado');
});
if (navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })) {
  $('#shareBtn').hidden = false;
  $('#shareBtn').onclick = () => withBusy($('#shareBtn'), async () => {
    const r = await buildMonthlyPdf(); if (!r) return;
    try { await navigator.share({ files: [new File([r.blob], r.name, { type: 'application/pdf' })], title: 'FCSALUD ' + monthLabel(state.month) }); } catch (e) {}
  });
}

/* ---------- Proyectos ---------- */
function useProject(p) { settings.project = p; saveSettings(); render(); toast('Proyecto: ' + p); }
document.addEventListener('click', e => {
  const b = e.target.closest('[data-project]'); if (!b) return;
  useProject(b.dataset.project);
  if (b.closest('#projectSheet')) closeTop();
});
$('#projectBtn').onclick = () => { $('#projectInput').value = ''; showSheet('projectSheet'); };
$('#newProjectBtn').onclick = $('#projectBtn').onclick;
$('#projectCreate').onclick = () => {
  const name = $('#projectInput').value.trim();
  if (!name) { $('#projectInput').focus(); return; }
  if (!settings.projects.some(p => p.toLowerCase() === name.toLowerCase())) settings.projects.push(name);
  closeTop(); useProject(settings.projects.find(p => p.toLowerCase() === name.toLowerCase()));
};
$('#projectInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#projectCreate').click(); });
$('#defaultArea').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; settings.area = b.dataset.v; saveSettings(); renderProjects(); });

/* ---------- Copias de seguridad ---------- */
const blobToDataURL = b => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
$('#exportBtn').onclick = async () => {
  const docs = await store.all('docs');
  const payload = { app: 'FCSALUD', version: 1, exportedAt: new Date().toISOString(), settings, moves, docs: await Promise.all(docs.map(async d => ({ id: d.id, name: d.name, type: d.type, data: await blobToDataURL(d.blob) }))) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  a.download = `FCSALUD_copia_${todayISO()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('✓ Copia exportada');
};
$('#importInput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (p.app !== 'FCSALUD' || !Array.isArray(p.moves)) throw new Error('formato');
    if (!confirm(`¿Importar ${p.moves.length} movimientos? Se añadirán a los que ya tienes.`)) return;
    for (const d of p.docs || []) await store.put('docs', { id: d.id, name: d.name, type: d.type, blob: await (await fetch(d.data)).blob() });
    for (const m of p.moves) await store.put('moves', m);
    (p.settings?.projects || []).forEach(pr => { if (!settings.projects.includes(pr)) settings.projects.push(pr); });
    saveSettings();
    moves = await store.all('moves'); render(); toast('✓ Copia importada');
  } catch (err) { toast('Ese archivo no es una copia de FCSALUD'); }
};
$('#wipeBtn').onclick = async () => {
  if (!confirm('¿Borrar todos los movimientos y justificantes de este dispositivo? No se puede deshacer.')) return;
  await store.clear('moves'); await store.clear('docs'); moves = []; render(); toast('Datos borrados');
};

/* ---------- Instalación ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; $('#installBtn2').hidden = false; });
const doInstall = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').hidden = true; $('#installBtn2').hidden = true; };
$('#installBtn').onclick = doInstall; $('#installBtn2').onclick = doInstall;
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('#installCard').hidden = true;

/* ---------- Inicio ---------- */
(async () => {
  try { await db.open(); } catch (e) { useMemory = true; }
  try { moves = await store.all('moves'); } catch (e) { moves = []; }
  try { await purgeOldDocs(); } catch (e) {}
  if (!settings.projects.includes(settings.project)) settings.project = settings.projects[0];
  render();
  const nuevo = new URLSearchParams(location.search).get('nuevo');
  if (TYPES[nuevo]) { history.replaceState(null, '', location.pathname); openAdd(nuevo); }
  if (useMemory) toast('Este navegador no permite guardar datos: se perderán al cerrar');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
// Al volver a la app otro día, "Hoy" pasa a ser la fecha actual.
let lastToday = todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayISO() !== lastToday) { if (state.day === lastToday) state.day = todayISO(); lastToday = todayISO(); render(); }
});
