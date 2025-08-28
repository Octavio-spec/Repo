// netlify/functions/sheet.js
const crypto = require("crypto");

// netlify/functions/sheet.js
exports.handler = async (event) => {
  try {
    const u = new URL(event.rawUrl || ('https://dummy' + event.path + (event.rawQuery ? '?' + event.rawQuery : '')));
    const sheetId = u.searchParams.get("sheetId");
    const gid = u.searchParams.get("gid");
    const format = (u.searchParams.get("format") || "csv").toLowerCase();
    const sheetName = u.searchParams.get("sheetName") || "";

    if (!sheetId || !gid) return { statusCode: 400, body: "Missing sheetId or gid" };

    const exportCsv = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    const publishCsv = `https://docs.google.com/spreadsheets/d/e/2PACX-PLACE_YOUR_PUBLISHED_ID/pub?gid=${encodeURIComponent(gid)}&single=true&output=csv`;
    const gvizJson = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;

    const urls = (format === "csv") ? [exportCsv, publishCsv, gvizJson] : [gvizJson];

    const timeoutMs = 12000; // 12s на бэке
    const fetchWithTimeout = (url) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      return fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "NetlifyFunction/1.0" },
        signal: ctrl.signal
      }).finally(() => clearTimeout(t));
    };

    const racers = urls.map((url, i) =>
      new Promise((res, rej) => setTimeout(() => fetchWithTimeout(url).then(r => r.ok ? r.text().then(res) : rej(new Error(`HTTP ${r.status}`)), rej), i * 300))
    );

    let body;
    try {
      body = await Promise.any(racers);
    } catch (e) {
      return {
        statusCode: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "Upstream failed: " + (e.errors ? e.errors.map(x => x.message).join("; ") : e.message)
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": (format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8"),
        // CDN-кэш на краю (10 минут) + браузерный (1 мин) + stale-while-revalidate
        "Cache-Control": "public, s-maxage=600, max-age=60, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*"
      },
      body
    };
  } catch (e) {
    return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: "Function error: " + e.message };
  }
};

/* ===== helpers ===== */

function ctype(format) {
  return format === "csv"
    ? "text/csv; charset=utf-8"
    : "text/plain; charset=utf-8";
}

function cacheHeaders({ etag, contentType, source }) {
  const base = {
    "Content-Type": contentType || "text/plain; charset=utf-8",
    // Браузер и CDN Netlify кэшируют 5 минут, можно менять по вкусу
    "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
    "Access-Control-Allow-Origin": "*",
    "Vary": "Origin",
  };
  if (etag) base["ETag"] = etag;
  if (source) base["X-Source-URL"] = source;
  return base;
}

function makeETag(text) {
  const hash = crypto.createHash("sha1").update(text).digest("hex");
  return `"W/${hash}"`; // слабый ETag — норм для CSV
}

async function safeText(res) {
  try { return await res.text(); } catch { return ""; }
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
    body,
  };
}
