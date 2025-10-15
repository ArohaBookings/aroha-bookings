// app/b/[slug]/page.tsx
import React from "react";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type PageProps = { params: { slug: string } };

// Money helper (NZD)
function moneyNZ(cents: number | null | undefined): string {
  const n = Number.isFinite(cents) ? Number(cents) : 0;
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(n / 100);
}

export default async function BookingPage({ params }: PageProps) {
  const org = await prisma.organization.findUnique({
    where: { slug: params.slug },
    select: { id: true, name: true, slug: true, timezone: true, address: true },
  });

  if (!org) {
    return (
      <main className="min-h-[70vh] flex items-center justify-center bg-zinc-50">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Salon not found</h1>
          <p className="text-sm text-zinc-600 mt-2">
            The booking link is invalid or this salon no longer accepts online bookings.
          </p>
        </div>
      </main>
    );
  }

  const services = await prisma.service.findMany({
    where: { orgId: org.id },
    select: { id: true, name: true, durationMin: true, priceCents: true },
    orderBy: { name: "asc" },
  });

  return (
    <main className="min-h-screen bg-white">
      {/* HEADER */}
      <header className="border-b border-zinc-200 bg-white/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">{org.name}</h1>
            {org.address ? (
              <p className="text-sm text-zinc-600 mt-1">{org.address}</p>
            ) : (
              <p className="text-sm text-zinc-500 mt-1">{org.timezone} • Online booking</p>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-2 text-sm text-zinc-600">
            <span>Powered by</span>
            <span className="font-semibold text-zinc-800">Aroha Bookings</span>
          </div>
        </div>
      </header>

      {/* BOOKING SECTION */}
      <section className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid md:grid-cols-3 gap-10">
          {/* LEFT: Steps */}
          <div className="md:col-span-2">
            <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm">
              <form id="booking-form" className="p-8 space-y-6">
                <input type="hidden" name="orgSlug" value={org.slug} />

                {/* STEP 1: Service */}
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 mb-3">1. Choose a Service</h2>
                  <select
                    name="serviceId"
                    className="border rounded-lg p-3 w-full focus:ring-2 focus:ring-zinc-300 focus:outline-none"
                    required
                  >
                    <option value="">Select a service</option>
                    {Array.isArray(services) && services.length > 0 ? (
                      services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} • {moneyNZ(s.priceCents)} • {s.durationMin}m
                        </option>
                      ))
                    ) : (
                      <option disabled>No services available</option>
                    )}
                  </select>
                </div>

                {/* STEP 2: Date */}
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 mb-3">2. Pick a Date</h2>
                  <input
                    type="date"
                    name="date"
                    className="border rounded-lg p-3 w-full focus:ring-2 focus:ring-zinc-300 focus:outline-none"
                    required
                  />
                </div>

                {/* STEP 3: Time */}
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 mb-3">3. Available Times</h2>
                  <div id="slots" className="grid grid-cols-3 sm:grid-cols-4 gap-3 text-sm" />
                  <p id="slot-hint" className="text-xs text-zinc-500 mt-2">
                    Choose a service and date to view available times.
                  </p>
                </div>

                {/* STEP 4: Details */}
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 mb-3">4. Your Details</h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <input
                      name="customerName"
                      placeholder="Your name"
                      className="border rounded-lg p-3 focus:ring-2 focus:ring-zinc-300 focus:outline-none"
                      required
                    />
                    <input
                      name="customerPhone"
                      placeholder="+64 21 000 0000"
                      className="border rounded-lg p-3 focus:ring-2 focus:ring-zinc-300 focus:outline-none"
                      required
                    />
                  </div>
                  <input
                    name="customerEmail"
                    type="email"
                    placeholder="Email (optional)"
                    className="mt-3 border rounded-lg p-3 w-full focus:ring-2 focus:ring-zinc-300 focus:outline-none"
                  />
                </div>

                {/* SUBMIT */}
                <div className="pt-2">
                  <button className="w-full bg-black text-white py-3 rounded-lg text-base font-medium hover:bg-zinc-800 transition">
                    Confirm Booking
                  </button>
                  <p id="msg" className="text-sm text-center mt-3" />
                </div>
              </form>
            </div>
          </div>

          {/* RIGHT: Highlights / Popular */}
          <div className="space-y-6">
            <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-6">
              <h3 className="text-sm font-medium text-zinc-700 uppercase tracking-wide">
                Why clients love {org.name}
              </h3>
              <ul className="mt-3 text-sm text-zinc-600 space-y-2">
                <li>✓ Instant confirmation</li>
                <li>✓ SMS/email reminders</li>
                <li>✓ Easy rescheduling or cancellation</li>
                <li>✓ Secure online booking powered by Aroha</li>
              </ul>
            </div>

            <div className="bg-white border border-zinc-200 rounded-2xl p-6">
              <h4 className="text-sm font-medium text-zinc-700 mb-2">Popular Services</h4>
              {Array.isArray(services) && services.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {services.slice(0, 6).map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between border-b border-zinc-100 py-1"
                    >
                      <span className="truncate">{s.name}</span>
                      <span className="text-zinc-500">{moneyNZ(s.priceCents)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-zinc-500 text-sm">No services listed yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Inline client script (tiny; calls your public APIs) */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
          (function(){
            const form = document.getElementById('booking-form');
            const slotsDiv = document.getElementById('slots');
            const slotHint = document.getElementById('slot-hint');
            const msg = document.getElementById('msg');

            async function fetchSlots() {
              slotsDiv.innerHTML = '';
              msg.textContent = '';
              const fd = new FormData(form);
              const orgSlug = fd.get('orgSlug');
              const serviceId = fd.get('serviceId');
              const date = fd.get('date');
              if (!orgSlug || !serviceId || !date) return;

              slotHint.textContent = 'Loading…';
              const start = new Date(date + 'T00:00:00');
              const end   = new Date(date + 'T23:59:59');

              const r = await fetch('/api/public/v1/availability', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                  orgSlug, serviceId,
                  dateFrom: start.toISOString(),
                  dateTo: end.toISOString()
                })
              });

              const j = await r.json();
              if (!r.ok) {
                slotHint.textContent = j.error || 'Failed to load availability';
                return;
              }

              slotHint.textContent = j.slots.length ? 'Select a time:' : 'No available times on this date.';
              j.slots.forEach(s => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'border rounded-lg px-4 py-2 text-sm hover:bg-zinc-100 transition';
                const d = new Date(s.startsAt);
                b.textContent = d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });
                b.onclick = () => {
                  form.dataset.startISO = s.startsAt;
                  [...slotsDiv.children].forEach(el => el.classList.remove('bg-black','text-white'));
                  b.classList.add('bg-black','text-white');
                };
                slotsDiv.appendChild(b);
              });
            }

            form.serviceId && form.serviceId.addEventListener('change', fetchSlots);
            form.date && form.date.addEventListener('change', fetchSlots);

            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              msg.textContent = '';
              const fd = new FormData(form);
              const startISO = form.dataset.startISO;
              if (!startISO) { msg.textContent = 'Please select a time.'; return; }

              const payload = {
                orgSlug: fd.get('orgSlug'),
                serviceId: fd.get('serviceId'),
                startISO,
                customer: {
                  name: fd.get('customerName'),
                  phone: fd.get('customerPhone'),
                  email: fd.get('customerEmail') || null
                }
              };

              const r = await fetch('/api/public/v1/book', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
              });
              const j = await r.json();
              if (!r.ok || !j.ok) {
                msg.textContent = j.error || 'Could not complete booking.';
                return;
              }

              msg.textContent = '✅ Booking confirmed! You’ll receive a confirmation shortly.';
              form.reset();
              form.dataset.startISO = '';
              slotsDiv.innerHTML = '';
              slotHint.textContent = 'Select a service and date to see available times.';
            });
          })();
        `,
        }}
      />
    </main>
  );
}
