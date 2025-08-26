// netlify/functions/sheet.js
const crypto = require("crypto");

exports.handler = async (event) => {
  try {
    // Разбираем параметры как раньше
    const rawUrl =
      event.rawUrl ||
      ("https://dummy" + (event.path || "") + (event.rawQuery ? "?" + event.rawQuery : ""));
    const url       = new URL(rawUrl);
    const sheetId   = url.searchParams.get("sheetId");
    const gid       = url.searchParams.get("gid");
    const sheetName = url.searchParams.get("sheetName") || "";
    const format    = (url.searchParams.get("format") || "csv").toLowerCase();

    if (!sheetId || !gid) {
      return resp(400, "Missing sheetId or gid");
    }

    // Формируем целевые URL (как у тебя)
    const targets = [];
    if (format === "csv") {
      targets.push(
        `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}` +
        `/export?format=csv&gid=${encodeURIComponent(gid)}`
      );
      // Можно оставить и publish-to-web вариант вторым бэкапом:
      // targets.push(`https://docs.google.com/spreadsheets/d/e/2PACX-XXXX/pub?gid=${encodeURIComponent(gid)}&single=true&output=csv`);
    } else if (format === "gviz") {
      targets.push(
        `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}` +
        `/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`
      );
    } else {
      return resp(400, "Unsupported format");
    }

    // Пробрасываем условные заголовки от клиента (для 304)
    const condHeaders = {};
    const inm = event.headers["if-none-match"];
    const ims = event.headers["if-modified-since"];
    if (inm) condHeaders["If-None-Match"] = inm;
    if (ims) condHeaders["If-Modified-Since"] = ims;

    let lastStatus = 0, lastBody = "";
    for (const target of targets) {
      const upstream = await fetch(target, {
        redirect: "follow",
        headers: {
          ...condHeaders,
          "User-Agent": "NetlifyFunction/1.1 (csv-proxy)",
        },
      });

      lastStatus = upstream.status;

      // Если Google ответил 304 — просто пробрасываем дальше 304
      if (upstream.status === 304) {
        return {
          statusCode: 304,
          headers: cacheHeaders({
            etag: inm || upstream.headers.get("etag") || undefined,
            contentType: ctype(format),
            source: target,
          }),
          body: "",
        };
      }

      lastBody = await safeText(upstream);

      if (upstream.ok && lastBody) {
        // Берём ETag Google, либо считаем свой (sha1 от тела)
        const etag = upstream.headers.get("etag") || makeETag(lastBody);
        return {
          statusCode: 200,
          headers: cacheHeaders({
            etag,
            contentType: ctype(format),
            source: target,
          }),
          body: lastBody,
        };
      }
    }

    return resp(
      502,
      `Upstream failed. Last status: ${lastStatus}\n\nLast body:\n${lastBody}`
    );
  } catch (e) {
    return resp(500, "Function error: " + (e && e.message ? e.message : String(e)));
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
