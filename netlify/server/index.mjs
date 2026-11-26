// Probelauf: Läuft "Netlify Server" für dieses Konto, und kommen WebSocket-Verbindungen durch?
//   /api/ping      -> Lebenszeichen (JSON)
//   /api/ws        -> WebSocket: jede Nachricht geht an alle verbundenen Clients (wie später die Spielerpositionen)
//   /api/selftest  -> der Server verbindet sich zweimal mit sich selbst über die öffentliche Adresse und prüft,
//                     ob eine Nachricht von Verbindung A bei Verbindung B ankommt
import { upgradeWebSocket } from "@netlify/server";

const started = Date.now();
const socks = new Set();
let wsTotal = 0;

export default async (req, context) => {
  const url = new URL(req.url);

  if (url.pathname === "/api/ws") {
    if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("Hier wird eine WebSocket-Verbindung erwartet.", { status: 426 });
    }
    const { socket, response } = upgradeWebSocket(req, { idleTimeout: 30 });
    wsTotal++;
    socks.add(socket);
    socket.onmessage = (e) => {
      const msg = String(e.data).slice(0, 200);
      for (const s of socks) { try { s.send(msg); } catch {} }
    };
    socket.onclose = () => socks.delete(socket);
    return response;
  }

  if (url.pathname === "/api/selftest") {
    // nur gegen die eigene Netlify-Adresse, nie gegen eine fremde
    if (!/\.netlify\.app$/.test(url.hostname)) return Response.json({ ok: false, why: "host" }, { status: 400 });
    const t0 = Date.now();
    const result = await new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => fin({ ok: false, why: "timeout" }), 9000);
      try {
        const a = new WebSocket(`wss://${url.host}/api/ws`);
        const b = new WebSocket(`wss://${url.host}/api/ws`);
        let open = 0;
        const go = () => { if (++open === 2) a.send("hallo von A"); };
        a.onopen = go; b.onopen = go;
        b.onmessage = (e) => { fin({ ok: true, echo: String(e.data), ms: Date.now() - t0 }); try { a.close(); b.close(); } catch {} };
        a.onerror = b.onerror = (e) => fin({ ok: false, why: "ws-error " + ((e && e.message) || "") });
      } catch (e) { fin({ ok: false, why: String(e) }); }
    });
    return Response.json({ test: "websocket", ...result, wsTotal, node: process.version, region: context?.server?.region ?? null });
  }

  return Response.json({
    ok: true, server: "netlify-server", node: process.version, upMs: Date.now() - started,
    wsOpen: socks.size, wsTotal, region: context?.server?.region ?? null, deploy: context?.deploy?.context ?? null,
  });
};

export const config = { path: "/api/*" };
