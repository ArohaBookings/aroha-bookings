const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const orgId = process.env.ORG_ID;
const sessionCookie = process.env.SESSION_COOKIE || "";

if (!orgId) {
  console.error("Missing ORG_ID env var.");
  process.exit(1);
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (sessionCookie) headers.Cookie = sessionCookie;
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

async function run() {
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const to = new Date();
  const qs = `from=${formatDate(from)}&to=${formatDate(to)}`;

  const diag = await request(`/api/admin/diagnostics?orgId=${encodeURIComponent(orgId)}`);
  console.log("diagnostics", diag.res.status, diag.json?.traceId || "", diag.json?.ok);

  const sync = await request("/api/org/calls/sync", { method: "POST" });
  console.log("calls sync", sync.res.status, sync.json?.traceId || "", sync.json?.ok, sync.json?.error || "");

  const list = await request(`/api/org/calls?${qs}`);
  console.log("calls list", list.res.status, list.json?.ok, list.json?.items?.length ?? "n/a");

  const stats = await request(`/api/org/calls/stats?${qs}`);
  console.log("calls stats", stats.res.status, stats.json?.ok, stats.json?.data ? "data" : "no-data");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
