// netlify/functions/sheet.js
exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl || ('https://dummy' + event.path + (event.rawQuery ? '?' + event.rawQuery : '')));
    const sheetId   = url.searchParams.get("sheetId");
    const gid       = url.searchParams.get("gid");
    const sheetName = url.searchParams.get("sheetName") || "";
    const format    = (url.searchParams.get("format") || "csv").toLowerCase();

    if (!sheetId || !gid) {
      return { statusCode: 400, body: "Missing sheetId or gid" };
    }

    const targets = [];
    if (format === "csv") {
      targets.push(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`);
      // при желании можно добавить publish-to-web CSV:
      // targets.push(`https://docs.google.com/spreadsheets/d/e/2PACX-XXXXXXXX/pub?gid=${encodeURIComponent(gid)}&single=true&output=csv`);
    } else if (format === "gviz") {
      targets.push(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`);
    } else {
      return { statusCode: 400, body: "Unsupported format" };
    }

    let lastStatus = 0, lastBody = "";
    for (const target of targets) {
      const resp = await fetch(target, { redirect: "follow", headers: { "User-Agent": "NetlifyFunction/1.0" }});
      lastStatus = resp.status;
      lastBody   = await resp.text();
      if (resp.ok && lastBody) {
        return {
          statusCode: 200,
          headers: {
            "Content-Type": (format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8"),
            "Cache-Control": "public, max-age=60",
            "Access-Control-Allow-Origin": "*",
            "X-Source-URL": target
          },
          body: lastBody
        };
      }
    }

    return {
      statusCode: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: `Upstream failed. Last status: ${lastStatus}\n\nLast body:\n${lastBody}`
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: "Function error: " + e.message
    };
  }
};
