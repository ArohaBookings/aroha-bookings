import { createHmac } from "crypto";

const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const orgId = process.env.ORG_ID;
const voiceSecret = process.env.VOICE_SECRET || "";
const sessionCookie = process.env.SESSION_COOKIE || "";
const durationMin = Number(process.env.DURATION_MIN || 30);
const customerName = process.env.CUSTOMER_NAME || "Smoke Test";
const customerPhone = process.env.CUSTOMER_PHONE || "+6421000000";
const customerEmail = process.env.CUSTOMER_EMAIL || "";
const staffId = process.env.STAFF_ID || "";
const serviceId = process.env.SERVICE_ID || "";
const doDisconnect = process.env.DO_DISCONNECT === "1";

if (!orgId) {
  console.error("Missing ORG_ID env var.");
  process.exit(1);
}

function headers(extra = {}) {
  const h = { "Content-Type": "application/json", ...extra };
  if (sessionCookie) h.Cookie = sessionCookie;
  return h;
}

function sign(body) {
  if (!voiceSecret) return "";
  return createHmac("sha256", voiceSecret).update(body).digest("hex");
}

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
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
  const now = new Date();
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  const availBody = JSON.stringify({
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    durationMin,
    ...(staffId ? { staffId } : {}),
    ...(serviceId ? { serviceId } : {}),
  });
  const availSig = sign(availBody);
  const avail = await request(`/api/integrations/voice/${orgId}/availability`, {
    method: "POST",
    headers: headers({ "x-aroha-signature": availSig }),
    body: availBody,
  });
  console.log("availability", avail.res.status, avail.json?.ok, avail.json?.slots?.length ?? "n/a");

  const firstSlot = Array.isArray(avail.json?.slots) ? avail.json.slots[0] : null;
  if (firstSlot) {
    const createBody = JSON.stringify({
      startISO: firstSlot.startISO,
      durationMin,
      customerName,
      customerPhone,
      customerEmail: customerEmail || undefined,
      ...(staffId ? { staffId } : {}),
      ...(serviceId ? { serviceId } : {}),
      notes: "Smoke test booking",
    });
    const createSig = sign(createBody);
    const booking = await request(`/api/integrations/voice/${orgId}/create-booking`, {
      method: "POST",
      headers: headers({ "x-aroha-signature": createSig, "Idempotency-Key": `smoke-${Date.now()}` }),
      body: createBody,
    });
    console.log("create booking", booking.res.status, booking.json?.ok, booking.json?.bookingId || "");
  }

  const sync = await request(`/api/admin/test-sync?orgId=${encodeURIComponent(orgId)}`, {
    headers: headers(),
  });
  console.log("google sync", sync.res.status, sync.json?.ok, sync.json?.google?.connected);

  const callsList = await request(`/api/org/calls?from=${now.toISOString().slice(0, 10)}&to=${now.toISOString().slice(0, 10)}`, {
    headers: headers(),
  });
  console.log("calls list", callsList.res.status, callsList.json?.ok, callsList.json?.items?.length ?? "n/a");

  const firstCall = Array.isArray(callsList.json?.items) ? callsList.json.items[0] : null;
  if (firstCall?.id) {
    for (let i = 0; i < 3; i += 1) {
      const detail = await request(`/api/org/calls/${encodeURIComponent(firstCall.id)}`, { headers: headers() });
      console.log("call detail", i + 1, detail.res.status, detail.json?.ok);
    }
  }

  if (doDisconnect) {
    const gdisc = await request("/api/integrations/google/disconnect", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ orgId }),
    });
    console.log("disconnect google", gdisc.res.status, gdisc.json?.ok);

    const gmdisc = await request("/api/integrations/gmail/disconnect", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ orgId }),
    });
    console.log("disconnect gmail", gmdisc.res.status, gmdisc.json?.ok);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

