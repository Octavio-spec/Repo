/* ===== Общие утилиты: подключать в index.html и details.html ДО вашего кода ===== */
window.AppCfg = {
  SHEET_ID: '1uLMv39-f9U2qKzAanPEHXPRjNezLlZJC',
  GIDS: { lathe: '1008569495', milling: '361418967' },
  PUBLISH_BASE: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSSoiSE1ZmtEo4JQOEIHiJWWTjiG_cV1s7rtcjuUYmbafvuDV1k1_53Q6p-L0f8Qg/pub',
  USE_PROXY: false,        // оставим выкл
  ALLOW_GOOGLE: false,     // ⟵ полностью отключаем Google
  CACHE_MINUTES: 10
};

  const racers = [
    _fetchWithTimeout(jsonMin, ms).then(t => ({ kind: 'json', text: t })),
    _sleep(80).then(() => _fetchWithTimeout(json, ms)).then(t => ({ kind: 'json', text: t })),
    _sleep(160).then(() => _fetchWithTimeout(csvLocal, ms)).then(t => ({ kind: 'csv', text: t })),
  ];

function pickTimeoutMs() {
  const et = (navigator.connection && navigator.connection.effectiveType) || '';
  if (et.includes('2g')) return 30000;   // 30s на очень медленных
  if (et.includes('3g')) return 15000;   // 15s
  return 8000;                            // 8s по умолчанию
}

let _ctrls = [];
function _fetchWithTimeout(url, ms, cache = 'default') {
  const ctrl = new AbortController();
  _ctrls.push(ctrl);
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { cache, signal: ctrl.signal }).then(r => {
    clearTimeout(t);
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
    return r.text();
  });
}
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Гонка источников CSV (с приоритетом локального зеркала) */
async function fetchSheetCSVRace(tabKey, sheetId, gid) {
  const ms = pickTimeoutMs();
  const mirror = new URL(`/data/${tabKey}.csv`, location.origin).href;
  const published = `${AppCfg.PUBLISH_BASE}?gid=${encodeURIComponent(gid)}&single=true&output=csv`
  const direct = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  const proxy = `/api/sheet?format=csv&sheetId=${encodeURIComponent(sheetId)}&gid=${encodeURIComponent(gid)}`; // опц.

  // 1) Пытаемся взять из локального кэша (короткоживущий, чтобы ускорить повторные открытия)
  const cacheKey = `csv:${tabKey}`;
  const freshMs = Math.max(1, (AppCfg.CACHE_MINUTES || 0)) * 60 * 1000;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && cached.t && (Date.now() - cached.t) < freshMs && cached.text) {
      return cached.text;
    }
  } catch { }

  // 2) Гонка источников (прокси отключаем, если USE_PROXY=false)
  const racers = [
    _fetchWithTimeout(mirror, ms),
    _sleep(120).then(() => _fetchWithTimeout(published, ms)),
    _sleep(300).then(() => _fetchWithTimeout(direct, ms)),
    ...(AppCfg.USE_PROXY ? [_sleep(1000).then(() => _fetchWithTimeout(proxy, ms))] : []),
  ];
  try {
    const text = await Promise.any(racers);
    try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), text })); } catch { }
    return text;
  } catch (agg) {
    const errs = (agg && agg.errors) ? agg.errors : [agg];
    try { return await _fetchWithTimeout(mirror, ms, 'reload'); } catch (e) { }
    throw new Error('All sources failed: ' + errs.map(e => e?.message || String(e)).join('; '));
  } finally {
    try { _ctrls.forEach(c => { try { c.abort() } catch { } }); } finally { _ctrls = []; }
  }
}

/** Простой CSV-парсер */
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], n = text[i + 1];
    if (q) { if (ch === '"' && n === `"`) { cur += '"'; i++; } else if (ch === '"') { q = false; } else cur += ch; }
    else {
      if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length && !(r.length === 1 && r[0] === ''));
}

/** Мелкие вспомогалки */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function safeCell(m, r, c) { return (m[r] && m[r][c] !== undefined) ? m[r][c] : ''; }
function hasValue(v) { const s = String(v ?? '').replace(/\u00A0/g, ' ').trim(); return !!s && !/^[-–—]+$/.test(s) && !/^(нет|n\/?a|na)$/i.test(s); }
function sanitizeId(s) { return String(s || '').toLowerCase().trim().replace(/\s+/g, ' '); }

window.Utils = { fetchSheetCSVRace, parseCSV, esc, safeCell, hasValue, sanitizeId };

// ===== Новая стратегия данных: JSON -> CSV (локальное зеркало) -> (опц.) Google =====
async function fetchDataRace(tabKey, sheetId, gid) {
  const ms = pickTimeoutMs();
  const jsonMin = new URL(`/data/${tabKey}.min.json`, location.origin).href;
  const json = new URL(`/data/${tabKey}.json`, location.origin).href;
  const csvLocal = new URL(`/data/${tabKey}.csv`, location.origin).href;

  // короткий кэш
  const ck = `data:${tabKey}`;
  const freshMs = Math.max(1, (AppCfg.CACHE_MINUTES || 0)) * 60 * 1000;
  try {
    const cached = JSON.parse(localStorage.getItem(ck) || 'null');
    if (cached && (Date.now() - cached.t) < freshMs) return cached;
  } catch { }

  const racers = [
    _fetchWithTimeout(jsonMin, ms).then(t => ({ kind: 'json', text: t })),
    _sleep(80).then(() => _fetchWithTimeout(json, ms)).then(t => ({ kind: 'json', text: t })),
    _sleep(160).then(() => _fetchWithTimeout(csvLocal, ms)).then(t => ({ kind: 'csv', text: t })),
  ];

  if (AppCfg.ALLOW_GOOGLE) {
    const published = `${AppCfg.PUBLISH_BASE}?gid=${encodeURIComponent(gid)}&single=true&output=csv`;
    const direct = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    racers.push(_sleep(350).then(() => _fetchWithTimeout(published, ms)).then(t => ({ kind: 'csv', text: t })));
    racers.push(_sleep(600).then(() => _fetchWithTimeout(direct, ms)).then(t => ({ kind: 'csv', text: t })));
  }

  const res = await Promise.any(racers);
  try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), ...res })); } catch { }
  return res;
}
window.Utils.fetchDataRace = fetchDataRace;
