// GO-Together: expose only a harmless D1 health check until owner auth is implemented.
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      if (request.method !== "GET") {
        return json(405, { error: "method_not_allowed" });
      }
      try {
        const check = await env.DB.prepare("SELECT 1 AS healthy").first();
        if (check?.healthy !== 1) throw new Error("D1 health check failed");
        return json(200, {
          ok: true,
          app: "GO-Together Personal Brain",
          storage: "Cloudflare D1",
          binding: "DB",
          memory_api_enabled: false
        });
      } catch {
        return json(503, { ok: false, error: "database_unavailable" });
      }
    }

    // No public memory CRUD or search: authentication and schema are not ready.
    if (pathname.startsWith("/api/")) {
      return json(503, { error: "memory_api_not_enabled" });
    }

    return env.ASSETS.fetch(request);
  }
};
