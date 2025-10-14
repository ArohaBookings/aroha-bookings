// app/page.tsx
export default function HomePage() {
  return (
    <main className="bg-white text-black min-h-screen">
      {/* NAV */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-zinc-200">
        <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="font-semibold tracking-tight">Aroha Bookings</a>
          <div className="flex items-center gap-4">
            <a href="#how-it-works" className="text-sm text-zinc-700 hover:text-black">How it works</a>
            <a href="#features" className="text-sm text-zinc-700 hover:text-black">Features</a>
            <a href="#pricing" className="text-sm text-zinc-700 hover:text-black">Pricing</a>
            <a
              href="https://arohacalls.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm bg-black text-white px-4 py-2 rounded-md hover:bg-zinc-800"
            >
              Plans & checkout
            </a>
          </div>
        </nav>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-sm uppercase tracking-wide text-zinc-500">AI receptionist for NZ businesses</p>
        <h1 className="mt-2 text-5xl sm:text-6xl font-bold tracking-tight">
          Simplify your bookings with <span className="text-[#00bfa6]">Aroha Bookings</span> 💁‍♀️
        </h1>
        <p className="mt-4 text-lg text-zinc-600 max-w-2xl mx-auto">
          We answer calls, create bookings in your <strong>built-in Aroha calendar</strong>, and keep your day organised —
          so salons, barbers, clinics and tradies never miss a job. Open 24/7. No phone tag. No missed revenue.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <a
            href="https://arohacalls.com"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-black text-white px-6 py-3 rounded-md font-medium hover:bg-zinc-800"
          >
            Get started on arohacalls.com →
          </a>
          <a
            href="#how-it-works"
            className="border border-black px-6 py-3 rounded-md font-medium hover:bg-zinc-50"
          >
            Learn more
          </a>
        </div>
        <div className="mt-10 text-xs text-zinc-500">
          Checkout handled on arohacalls.com • Cancel anytime
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="border-t border-zinc-200 bg-zinc-50">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-3xl font-semibold text-center">How it works</h2>
          <div className="mt-10 grid sm:grid-cols-3 gap-8 text-left">
            <div>
              <h3 className="text-lg font-semibold mb-1">📞 We answer every call</h3>
              <p className="text-zinc-600">
                Clients speak to your AI receptionist that sounds natural, captures details,
                and books appointments on the spot.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">📅 Your Aroha calendar</h3>
              <p className="text-zinc-600">
                Bookings land in your built-in Aroha calendar instantly with double-booking checks and staff availability.
                <span className="block mt-1 text-xs text-zinc-500">Google & Outlook sync — coming soon.</span>
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">📈 You get the insights</h3>
              <p className="text-zinc-600">
                See top services, repeat clients, revenue estimates and utilisation—all in your dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-semibold text-center">Everything you need to run on autopilot</h2>
        <div className="mt-12 grid md:grid-cols-2 gap-10">
          <Feature
            title="AI receptionist that never misses a call"
            points={[
              "Greets clients, answers FAQs, books and reschedules",
              "Understands accents and context—great for NZ callers",
              "Fallback to your team for edge cases",
            ]}
          />
          <Feature
            title="Built-in calendar"
            points={[
              "Fast day/week view with staff filters",
              "Opening hours & service durations enforced",
              "Double-booking prevention",
            ]}
          />
          <Feature
            title="Customisable per business"
            points={[
              "Branding, services, durations, pricing",
              "Staff permissions and roles",
              "Public booking link per organisation",
            ]}
          />
          <Feature
            title="Insights that matter"
            points={[
              "Top services & revenue estimates",
              "Repeat/first-time client mix",
              "Staff utilisation week by week",
            ]}
          />
        </div>
      </section>

      {/* NZ MADE STRIP */}
      <section className="bg-gradient-to-b from-white to-zinc-50 border-y border-zinc-200">
        <div className="max-w-6xl mx-auto px-6 py-14 text-center">
          <h3 className="text-2xl font-semibold">Made for Aotearoa 🇳🇿</h3>
          <p className="mt-2 text-zinc-600 max-w-2xl mx-auto">
            Built in New Zealand, tuned for Kiwi timezones and small businesses.
            Local support, fair pricing, and no mucking about.
          </p>
        </div>
      </section>

      {/* SOCIAL PROOF / QUOTES */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-semibold text-center">What owners are saying</h2>
        <div className="mt-10 grid md:grid-cols-3 gap-6">
          <Quote text="We stopped losing bookings after hours. The AI just handles it." author="Salon Owner, Auckland" />
          <Quote text="Clients said it felt natural—bookings doubled on weekends." author="Barber, Wellington" />
          <Quote text="Setup took minutes. Now I don't worry about missed calls." author="Clinic Manager, Christchurch" />
        </div>
      </section>

      {/* PRICING (overview only) */}
      <section id="pricing" className="bg-zinc-50 border-t border-zinc-200">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-semibold text-center">Simple pricing (overview)</h2>
          <p className="mt-2 text-center text-zinc-600">
            Full plan details and purchase live on <a className="underline" href="https://arohacalls.com" target="_blank" rel="noopener noreferrer">arohacalls.com</a>.
          </p>

          <div className="mt-10 grid md:grid-cols-3 gap-6">
            <Plan name="Lite" price="NZ$99" per="/mo" items={["AI answers & books", "Aroha calendar", "1 staff login"]} />
            <Plan
              name="Starter"
              price="NZ$199"
              per="/mo"
              highlight
              items={["Everything in Lite", "Staff schedules & services", "Basic analytics"]}
            />
            <Plan name="Pro" price="NZ$349" per="/mo" items={["Everything in Starter", "Advanced insights", "Priority support"]} />
          </div>

          <div className="mt-8 text-center">
            <a
              href="https://arohacalls.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-black text-white px-6 py-3 rounded-md font-medium hover:bg-zinc-800"
            >
              See plans & checkout on arohacalls.com
            </a>
            <p className="mt-2 text-xs text-zinc-500">Billing handled via your main store.</p>
          </div>
        </div>
      </section>

      {/* MORE INFO / CONTACT */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="rounded-xl border border-zinc-200 p-6 md:p-8 bg-white">
          <h2 className="text-2xl font-semibold">Want more info?</h2>
          <p className="mt-2 text-zinc-600">
            Flick us a message and we’ll send setup details, examples, and a quick demo video.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {/* simple mailto capture to avoid backend work for now */}
            <a
              href="mailto:support@arohacalls.com?subject=Aroha%20Bookings%20info%20request&body=Kia%20ora%2C%20I%27d%20like%20more%20info%20about%20Aroha%20Bookings.%20My%20business%20name%3A%20_____%0APhone%3A%20_____%0ABest%20time%20to%20call%3A%20_____"
              className="inline-flex items-center justify-center h-11 px-5 rounded-md bg-black text-white hover:bg-zinc-800"
            >
              Email support@arohacalls.com
            </a>
            <a
              href="https://arohacalls.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-11 px-5 rounded-md border border-zinc-300 hover:bg-zinc-50"
            >
              Learn more on arohacalls.com
            </a>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-black text-white text-center py-20">
        <h2 className="text-3xl font-bold">Ready to automate your bookings?</h2>
        <p className="mt-2 text-zinc-300">Checkout is on our main site. You’ll get a secure invite link after purchase.</p>
        <a
          href="https://arohacalls.com"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block bg-white text-black px-8 py-3 rounded-md font-semibold hover:bg-zinc-100"
        >
          Go to arohacalls.com
        </a>
      </section>

      {/* FOOTER */}
      <footer className="text-center py-8 text-zinc-500 text-sm">
        © {new Date().getFullYear()} Aroha Bookings • Made in New Zealand •{" "}
        <a className="underline" href="mailto:support@arohacalls.com">support@arohacalls.com</a>
      </footer>
    </main>
  );
}

/* ----------------- tiny components (keeps page tidy) ----------------- */

function Feature({ title, points }: { title: string; points: string[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-5 bg-white">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 list-disc list-inside text-zinc-700">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

function Quote({ text, author }: { text: string; author: string }) {
  return (
    <blockquote className="rounded-xl border border-zinc-200 p-5 bg-white">
      <p className="text-zinc-800">“{text}”</p>
      <footer className="mt-3 text-sm text-zinc-500">— {author}</footer>
    </blockquote>
  );
}

function Plan({
  name,
  price,
  per,
  items,
  highlight,
}: {
  name: string;
  price: string;
  per: string;
  items: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border p-5 bg-white " +
        (highlight ? "border-black shadow-[0_0_0_2px_rgba(0,0,0,0.2)]" : "border-zinc-200")
      }
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-xl font-semibold">{name}</h3>
      </div>
      <div className="mt-2">
        <span className="text-3xl font-bold">{price}</span>
        <span className="text-zinc-500">{per}</span>
      </div>
      <ul className="mt-4 text-zinc-700 space-y-2 list-disc list-inside">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
      <a
        href="https://arohacalls.com"
        target="_blank"
        rel="noopener noreferrer"
        className={
          "mt-6 inline-flex items-center justify-center w-full h-10 rounded-md font-medium " +
          (highlight ? "bg-black text-white hover:bg-zinc-800" : "border border-zinc-300 hover:bg-zinc-50")
        }
      >
        Choose {name} on arohacalls.com
      </a>
    </div>
  );
}
