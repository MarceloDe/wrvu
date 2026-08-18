// Local stand-in for the app's OWN API routes during the redaction e2e.
//
// The redaction path under test is entirely client-side; this server exists so
// the real component can boot and so the outbound /api/claude request body can
// be captured byte-for-byte the moment it leaves the browser. It records every
// request it receives — that recording is the evidence.

import http from "node:http";

export async function startHarnessServer({ bundle, html }) {
  const state = { store: new Map(), claudeRequests: [], storeWrites: [], requests: [] };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    state.requests.push({ at: new Date().toISOString(), method: req.method, path: url.pathname });
    const json = (payload, status = 200) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
    };

    if (url.pathname === "/" ) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (url.pathname === "/bundle.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end(bundle);
      return;
    }
    if (url.pathname === "/api/store" && req.method === "GET") {
      const key = url.searchParams.get("key");
      return json({ key, value: state.store.has(key) ? state.store.get(key) : null });
    }
    if (url.pathname === "/api/store" && req.method === "POST") {
      const raw = (await readBody(req)).toString("utf8");
      const parsed = JSON.parse(raw || "{}");
      state.store.set(parsed.key, parsed.value);
      state.storeWrites.push({ at: new Date().toISOString(), key: parsed.key, raw });
      return json({ key: parsed.key, ok: true });
    }
    if (url.pathname === "/api/exams" && req.method === "GET") return json({ exams: [] });
    if (url.pathname === "/api/exams" && req.method === "POST") {
      await readBody(req);
      return json({ ok: true });
    }
    if (url.pathname === "/api/extra-duty" && req.method === "GET") return json({ periods: [] });
    if (url.pathname === "/api/extra-duty/rates" && req.method === "GET") {
      return json({ rates: { perDiemRate: 0, ppcMri: 0, ppcCt: 0, ppcXr: 0 } });
    }
    if (url.pathname === "/api/claude" && req.method === "POST") {
      const raw = (await readBody(req)).toString("utf8");
      state.claudeRequests.push({ at: new Date().toISOString(), raw });
      return json({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              valid: true,
              exams: [{ cpt: "70553", procedure: "MRI BRAIN W WO", site: "UM SYLVESTER", exam_date: "2026-08-03", modality: "MRI" }],
            }),
          },
        ],
      });
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    state,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
