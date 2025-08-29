/* ===== Общие утилиты ===== */
// Polyfill: Promise.any для старых мобильных браузеров (iOS 14-, Android WebView 80-)
(function () {
  if (typeof Promise !== 'undefined' && typeof Promise.any !== 'function') {
    function AggregateErrorPolyfill(errors, message) { const e = new Error(message || 'All promises were rejected'); e.name = 'AggregateError'; e.errors = errors; return e; }
    Promise.any = function (iterable) {
      return new Promise(function (resolve, reject) {
        const errors = []; let pending = 0; let hasAny = false;
        for (const p of iterable) { hasAny = true; pending++; Promise.resolve(p).then(resolve, e => { errors.push(e); if (--pending === 0) reject(AggregateErrorPolyfill(errors)); }); }
        if (!hasAny) reject(AggregateErrorPolyfill([], 'No promises were passed'));
      });
    };
  }
})();

window.AppCfg = {
  SHEET_ID: '1uLMv39-f9U2qKzAanPEHXPRjNezLlZJC',
  GIDS: { lathe: '1008569495', milling: '361418967' },
  PUBLISH_BASE: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSSoiSE1ZmtEo4JQOEIHiJWWTjiG_cV1s7rtcjuUYmbafvuDV1k1_53Q6p-L0f8Qg/pub',
  USE_PROXY: false,
  ALLOW_GOOGLE: false,      // ⟵ Google отключён для ускорения
  USE_JSON: false,          // ⟵ временно отключаем JSON-гонку, чтобы не было 404, включишь когда загрузишь *.json
  CACHE_MINUTES: 10
};

function pickTimeoutMs() {
  const et = (navigator.connection && navigator.connection.effectiveType) || '';
  if (et.includes('2g')) return 30000;
  if (et.includes('3g')) return 15000;
  return 8000;
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

/** Гонка источников JSON/CSV (приоритет JSON) */
async function fetchDataRace(tabKey, sheetId, gid) {
  const ms = pickTimeoutMs();
  const urls = {
    jsonMin: new URL(`/data/${tabKey}.min.json`, location.origin).href,
    json: new URL(`/data/${tabKey}.json`, location.origin).href,
    csv: new URL(`/data/${tabKey}.csv`, location.origin).href,
  };

  const ck = `data:${tabKey}`;
  const freshMs = Math.max(1, (AppCfg.CACHE_MINUTES || 0)) * 60 * 1000;
  try {
    const cached = JSON.parse(localStorage.getItem(ck) || 'null');
    if (cached && (Date.now() - cached.t) < freshMs) return cached;
  } catch { }

  const racers = [];
  if (AppCfg.USE_JSON) {
    racers.push(_fetchWithTimeout(urls.jsonMin, ms, 'force-cache').then(t => ({ kind: 'json', text: t })));
    racers.push(_sleep(80).then(() => _fetchWithTimeout(urls.json, ms, 'force-cache')).then(t => ({ kind: 'json', text: t })));
    racers.push(_sleep(160).then(() => _fetchWithTimeout(urls.csv, ms, 'force-cache')).then(t => ({ kind: 'csv', text: t })));
  } else {
    racers.push(_fetchWithTimeout(urls.csv, ms, 'force-cache').then(t => ({ kind: 'csv', text: t })));
  }

  if (AppCfg.ALLOW_GOOGLE) {
    const published = `${AppCfg.PUBLISH_BASE}?gid=${encodeURIComponent(gid)}&single=true&output=csv`;
    const direct = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    racers.push(_sleep(350).then(() => _fetchWithTimeout(published, ms)).then(t => ({ kind: 'csv', text: t })));
    racers.push(_sleep(600).then(() => _fetchWithTimeout(direct, ms)).then(t => ({ kind: 'csv', text: t })));
  }

  const res = await Promise.any(racers);
  const payload = { t: Date.now(), kind: res.kind, text: res.text };
  try { localStorage.setItem(ck, JSON.stringify(payload)); } catch { }
  return payload;
}

/** CSV-парсер (на случай fallback) */
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], n = text[i + 1];
    if (q) { if (ch === '"' && n === '"') { cur += '"'; i++; } else if (ch === '"') { q = false; } else cur += ch; }
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

window.Utils = { fetchDataRace, parseCSV, esc, safeCell, hasValue, sanitizeId };