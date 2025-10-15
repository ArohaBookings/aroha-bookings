import React from "react";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type PageProps = { params: { slug: string } };

// currency helper
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
      <main className="min-h-[70vh] flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Salon not found</h1>
          <p className="text-sm text-zinc-600 mt-2">
            Please check the link or contact the salon directly.
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
    <main className="min-h-screen bg-zinc-50">
      {/* Brand header */}
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          {org.address ? (
            <p className="text-sm text-zinc-600 mt-1">{org.address}</p>
          ) : (
            <p className="text-sm text-zinc-500 mt-1">{org.timezone} • Online booking</p>
          )}
        </div>
      </header>

      {/* Booking card */}
      <section className="max-w-3xl mx-auto px-6 py-8">
        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
          {/* Steps */}
          <div className="grid md:grid-cols-2">
            {/* Left column: selection */}
            <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-zinc-200">
              <h2 className="text-lg font-semibold mb-4">Book an appointment</h2>

              <form id="booking-form" className="space-y-5">
                <input type="hidden" name="orgSlug" value={org.slug} />

                {/* Service */}
                <div>
                  <label className="block text-sm font-medium mb-1">Service</label>
                  <select name="serviceId" className="border rounded-lg p-2.5 w-full focus:outline-none focus:ring-1 focus:ring-zinc-300" required>
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

                {/* Date */}
                <div>
                  <label className="block text-sm font-medium mb-1">Date</label>
                  <input
                    type="date"
                    name="date"
                    className="border rounded-lg p-2.5 w-full focus:outline-none focus:ring-1 focus:ring-zinc-300"
                    required
                  />
                </div>

                {/* Time slots */}
                <div>
                  <label className="block text-sm font-medium mb-2">Available times</label>
                  <div id="slots" className="grid grid-cols-3 sm:grid-cols-4 gap-2"></div>
                  <p id="slot-hint" className="text-xs text-zinc-500 mt-2">
                    Select a service and date to see available times.
                  </p>
                </div>

                {/* Customer */}
                <div className="grid gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Your name</label>
                    <input
                      name="customerName"
                      placeholder="Jane Doe"
                      className="border rounded-lg p-2.5 w-full focus:outline-none focus:ring-1 focus:ring-zinc-300"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Mobile</label>
                    <input
                      name="customerPhone"
                      placeholder="+64 21 000 0000"
                      className="border rounded-lg p-2.5 w-full focus:outline-none focus:ring-1 focus:ring-zinc-300"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Email (optional)</label>
                    <input
                      name="customerEmail"
                      type="email"
                      placeholder="you@example.com"
                      className="border rounded-lg p-2.5 w-full focus:outline-none focus:ring-1 focus:ring-zinc-300"
                    />
                  </div>
                </div>

                {/* Submit */}
                <button
                  className="w-full md:w-auto bg-black text-white px-5 py-2.5 rounded-lg hover:bg-zinc-800 disabled:opacity-60"
                >
                  Book appointment
                </button>

                <p id="msg" className="text-sm mt-2"></p>
              </form>
            </div>

            {/* Right column: summary / highlights */}
            <div className="p-6 md:p-8 bg-zinc-50">
              <h3 className="text-sm font-medium text-zinc-700">What to expect</h3>
              <ul className="mt-3 space-y-2 text-sm text-zinc-600">
                <li>• Real-time availability</li>
                <li>• Instant confirmation</li>
                <li>• Free SMS/email reminders (if enabled)</li>
              </ul>

              {Array.isArray(services) && services.length > 0 && (
                <>
                  <h4 className="text-sm font-medium text-zinc-700 mt-6">Popular services</h4>
                  <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                    {services.slice(0, 5).map((s) => (
                      <li key={s.id} className="flex items-center justify-between">
                        <span className="truncate">{s.name}</span>
                        <span className="text-zinc-500 ml-3">{moneyNZ(s.priceCents)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Client script */}
      <script
        // keep logic minimal; call public APIs you created
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

              slotHint.textContent = j.slots.length ? 'Select a time.' : 'No times available for this date.';
              j.slots.forEach(s => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'border rounded-lg px-3 py-1.5 text-sm hover:bg-zinc-100';
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

            form.serviceId?.addEventListener('change', fetchSlots);
            form.date?.addEventListener('change', fetchSlots);

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
              msg.textContent = 'Booked! A confirmation has been sent.';
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
