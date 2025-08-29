// netlify/functions/sheet.js
exports.handler = async (event) => {
  try {
    const u = new URL(event.rawUrl || ('https://dummy' + event.path + (event.rawQuery ? '?' + event.rawQuery : '')));
    const sheetId = u.searchParams.get("sheetId");
    const gid = u.searchParams.get("gid");
    const format = (u.searchParams.get("format") || "csv").toLowerCase();

    if (!sheetId || !gid) return { statusCode: 400, body: "Missing sheetId or gid" };

    const exportCsv = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    const publishCsv = `https://docs.google.com/spreadsheets/d/e/2PACX-1vSSoiSE1ZmtEo4JQOEIHiJWWTjiG_cV1s7rtcjuUYmbafvuDV1k1_53Q6p-L0f8Qg/pub?gid=${encodeURIComponent(gid)}&single=true&output=csv`;
    const gvizCsv = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;

    const urls = [exportCsv, publishCsv, gvizCsv];

    const timeoutMs = 12000;
    const fetchWithTimeout = (url) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      return fetch(url, { redirect: "follow", headers: { "User-Agent": "NetlifyFunction/1.0" }, signal: ctrl.signal })
        .finally(() => clearTimeout(t));
    };

    const racers = urls.map((url, i) =>
      new Promise((res, rej) => setTimeout(() => {
        fetchWithTimeout(url).then(r => r.ok ? r.text().then(res) : rej(new Error(`HTTP ${r.status} @ ${url}`)), rej);
      }, i * 250))
    );

    let body;
    try {
      body = await Promise.any(racers);
    } catch (agg) {
      const errs = agg && agg.errors ? agg.errors.map(e => e.message).join("; ") : String(agg);
      return { statusCode: 502, headers: { "Access-Control-Allow-Origin": "*" }, body: "Upstream failed: " + errs };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "public, s-maxage=600, max-age=60, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*"
      },
      body
    };
  } catch (e) {
    return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: "Function error: " + e.message };
  }
};
