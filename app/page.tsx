// app/page.tsx
import { Badge, Card } from "@/components/ui";
export default function HomePage() {
  return (
    <main className="bg-white text-black min-h-screen">
      {/* NAV */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-zinc-200">
        <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="font-semibold tracking-tight">
            Aroha Bookings
          </a>
          <div className="flex items-center gap-4">
            <a href="#how-it-works" className="text-sm text-zinc-700 hover:text-black">
              How it works
            </a>
            <a href="#features" className="text-sm text-zinc-700 hover:text-black">
              Features
            </a>
            <a href="#pricing" className="text-sm text-zinc-700 hover:text-black">
              Pricing
            </a>
            <a
              href="/login"
              className="text-sm font-medium text-zinc-700 hover:text-black"
            >
              Log in
            </a>
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
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-16">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              AI receptionist · Calendar · Online bookings
            </p>
            <h1 className="mt-3 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
              Never miss a booking again with{" "}
              <span className="text-[#00bfa6]">Aroha Bookings</span> 💁‍♀️
            </h1>
            <p className="mt-4 text-lg text-zinc-600">
              Aroha Calls answers your phone, and Aroha Bookings handles your{" "}
              <strong>calendar, clients and online bookings</strong> — built for salons, barbers,
              clinics and tradies across Aotearoa.
            </p>
            <ul className="mt-4 text-sm text-zinc-700 space-y-1">
              <li>• 24/7 AI receptionist that actually books into your calendar</li>
              <li>• Simple calendar your whole team can use in seconds</li>
              <li>• Email AI to tidy your inbox and follow up leads</li>
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="/login"
                className="bg-emerald-600 text-white px-6 py-3 rounded-md font-medium hover:bg-emerald-700"
              >
                Log in
              </a>
              <a
                href="https://arohacalls.com"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-emerald-600 px-6 py-3 rounded-md font-medium text-emerald-700 hover:bg-emerald-50"
              >
                Request access
              </a>
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
                See how it works
              </a>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              No long contracts · Built in New Zealand · Cancel anytime
            </p>
          </div>

          {/* "Interactive" preview card (no JS, but visually shows flow) */}
          <div className="relative">
            <Card className="p-4 sm:p-5">
              <p className="text-xs font-medium text-zinc-500 mb-2">
                Live flow example (how it actually works)
              </p>
              <ol className="space-y-3 text-sm text-zinc-800">
                <TimelineStep
                  step="1"
                  label="Client calls your number"
                  text="Your existing business number forwards to Aroha Calls in the background."
                />
                <TimelineStep
                  step="2"
                  label="AI receptionist answers"
                  text="Greets them with your brand, answers questions and offers available times."
                />
                <TimelineStep
                  step="3"
                  label="Booking is created"
                  text="Aroha Bookings checks staff availability and drops it into your calendar."
                />
                <TimelineStep
                  step="4"
                  label="You get notified"
                  text="You see it instantly on your Aroha calendar, with client details to follow up."
                />
              </ol>

              <div className="mt-5 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3 text-xs">
                <p className="font-medium text-zinc-700 mb-1">
                  Coming soon:
                  <span className="ml-1 text-[#00bfa6]">Google & Outlook sync</span>
                </p>
                <p className="text-zinc-500">
                  Keep Aroha Bookings as your source of truth and mirror to your existing calendars.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-6xl mx-auto px-6 pb-16">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Features</p>
            <h2 className="mt-2 text-3xl font-semibold">Everything your front desk should do — instantly.</h2>
          </div>
          <a
            href="https://arohacalls.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
          >
            Book a demo →
          </a>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "Calls inbox",
              body: "Every call summarized, searchable, and deduplicated in real time.",
            },
            {
              title: "Client Memory",
              body: "Preferences, tone, and history saved per customer so the AI never forgets.",
            },
            {
              title: "Email AI",
              body: "Drafts follow-ups, rescues missed calls, and keeps your inbox clean.",
            },
            {
              title: "Messages hub (coming soon)",
              body: "A unified place for SMS, WhatsApp, and social messages.",
            },
            {
              title: "Zapier automation",
              body: "Forward call events into any CRM or workflow in seconds.",
            },
            {
              title: "Calendar control",
              body: "Bookings land in your calendar with business rules enforced.",
            },
          ].map((feature) => (
            <Card key={feature.title} className="p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{feature.title}</p>
              <p className="mt-3 text-sm text-zinc-700">{feature.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* PROOF COUNTERS */}
      <section className="bg-zinc-50 border-y border-zinc-200">
        <div className="max-w-6xl mx-auto px-6 py-14 grid gap-6 md:grid-cols-3">
          {[
            { label: "Avg call handled", value: "< 20s" },
            { label: "Bookings captured", value: "94%" },
            { label: "Time saved weekly", value: "8+ hrs" },
          ].map((stat) => (
            <Card key={stat.label} className="p-5 text-center">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{stat.label}</p>
              <p className="mt-3 text-3xl font-semibold text-zinc-900">{stat.value}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* QUESTIONS (Accordion) */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Why it works</p>
            <h2 className="mt-2 text-3xl font-semibold">Clear answers before you sign in.</h2>
            <p className="mt-3 text-sm text-zinc-600">
              Everything is deterministic, audited, and synced to your calendar.
            </p>
          </div>
          <div className="space-y-3">
            {[
              {
                title: "How do calls become bookings?",
                body: "The AI checks availability, confirms the slot, and writes the booking straight into your calendar.",
              },
              {
                title: "Can I control business hours?",
                body: "Yes. Set business hours and buffers, and the AI will respect them automatically.",
              },
              {
                title: "What if the AI is unsure?",
                body: "It escalates to a draft or follows your rules, so nothing goes live without confidence.",
              },
            ].map((item) => (
              <details key={item.title} className="rounded-xl border border-zinc-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-semibold text-zinc-900">{item.title}</summary>
                <p className="mt-2 text-sm text-zinc-600">{item.body}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* INTERACTIVE DEMOS */}
      <section className="bg-zinc-50 border-y border-zinc-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Interactive demos</p>
              <h2 className="mt-2 text-3xl font-semibold">See the product before you sign in</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Quick, visual explanations of how Aroha handles booking, availability, and calls.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Badge variant="success">Google Calendar synced</Badge>
              <Badge variant="neutral">No double bookings</Badge>
              <Badge variant="neutral">Clients self-manage</Badge>
            </div>
          </div>

          <div className="mt-10 grid lg:grid-cols-3 gap-6">
            <DemoCard
              title="See how booking works"
              subtitle="Client picks a time → AI books → calendar updates."
              badge="Booking flow"
              content={
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                    <span>Service: Cut + Finish</span>
                    <span className="font-semibold">30 min</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {["10:00", "10:30", "11:00"].map((t, i) => (
                      <div
                        key={t}
                        className={`rounded-lg border px-3 py-2 text-center text-xs ${
                          i === 1 ? "border-black bg-black text-white" : "border-zinc-200 text-zinc-600"
                        }`}
                      >
                        {t}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    Booking confirmed → calendar updated
                  </div>
                </div>
              }
            />

            <DemoCard
              title="See why a slot is unavailable"
              subtitle="Clear reasons with human-readable explanations."
              badge="Availability logic"
              content={
                <div className="space-y-3">
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                    Tue 1:30pm · Electrician
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Busy on-site nearby → travel buffer applies
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
                    Suggested: Tue 3:00pm (recommended)
                  </div>
                </div>
              }
            />

            <DemoCard
              title="See how calls turn into bookings"
              subtitle="Calls → AI summary → booking timeline."
              badge="Calls → Calendar"
              content={
                <div className="space-y-3">
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                    Call with Jess · 2m 12s
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                    AI note: “Requested Friday 10am, prefers Maya.”
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    Appointment created → synced to Google
                  </div>
                </div>
              }
            />
          </div>
        </div>
      </section>

      {/* ANIMATED BOOKING PREVIEW */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Animated booking preview</p>
              <h2 className="mt-2 text-2xl font-semibold text-zinc-900">A booking, in motion</h2>
              <p className="mt-2 text-sm text-zinc-600">
                A lightweight preview of how Aroha confirms bookings and updates your calendar.
              </p>
            </div>
            <span className="text-xs text-zinc-500">Demo data · No sign-in required</span>
          </div>

          <div className="mt-6 grid md:grid-cols-[1.2fr_0.8fr] gap-6 items-center">
            <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-200 to-emerald-400 animate-pulse" />
              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                  Client: Priya · Service: Colour refresh
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                  AI checks availability → 4 slots found
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  Fri 11:30am selected · Staff: Maya
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                  Google Calendar updated in 2s
                </div>
              </div>
            </div>
            <div className="grid gap-3">
              {[
                "Hair & Beauty: highlight regulars, tone‑matched confirmations",
                "Trades: travel buffers + onsite scheduling explained",
                "Medical: calm confirmation language + policy reminders",
                "Legal: formal booking summaries with documentation prompts",
                "Auto: drop‑off windows and pickup reminders",
              ].map((line) => (
                <div key={line} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 2 PRODUCTS EXPLAINED */}
      <section className="border-t border-zinc-200 bg-zinc-50">
        <div className="max-w-6xl mx-auto px-6 py-14">
          <h2 className="text-3xl font-semibold text-center">
            Two tools, one simple system
          </h2>
          <p className="mt-2 text-sm text-zinc-600 text-center max-w-2xl mx-auto">
            Aroha Calls picks up the phone. Aroha Bookings organises the rest.
          </p>

          <div className="mt-10 grid md:grid-cols-2 gap-6">
            <ProductCard
              badge="Aroha Calls"
              title="AI receptionist that never sleeps"
              points={[
                "Answers every call in your tone and style",
                "Books, reschedules and cancels appointments",
                "Handles FAQs, directions, opening hours and more",
              ]}
              footer="Sold and configured via arohacalls.com"
            />
            <ProductCard
              badge="Aroha Bookings"
              title="Calendar & booking system that just makes sense"
              points={[
                "Fast, clean calendar view for day and staff",
                "Flexible services, durations and buffers",
                "Public booking link you can drop on social or your website",
              ]}
              footer="This dashboard is what you log in to every day."
            />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS – STEP STRIP */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-semibold text-center">How it works for your day</h2>
        <p className="mt-2 text-center text-zinc-600 max-w-2xl mx-auto">
          Whether you&apos;re a salon, barber, clinic or tradie, the flow stays the same.
        </p>

        <div className="mt-10 grid lg:grid-cols-4 gap-4">
          <StepCard
            label="Morning"
            title="Open your Aroha calendar"
            points={[
              "See today’s bookings at a glance",
              "Check staff load and gaps",
              "Add any manual bookings you’ve promised",
            ]}
          />
          <StepCard
            label="During the day"
            title="AI handles the phone"
            points={[
              "Calls are answered instantly",
              "AI fills in client details for you",
              "You only step in for edge cases",
            ]}
          />
          <StepCard
            label="After hours"
            title="Still taking bookings"
            points={[
              "Clients book while you’re closed",
              "No voicemail, no phone tag",
              "Fewer ‘sorry, we missed you’ messages",
            ]}
          />
          <StepCard
            label="End of week"
            title="Check your stats"
            points={[
              "Top services and busy hours",
              "New vs repeat clients",
              "Rough revenue estimates (by service & bookings)",
            ]}
          />
        </div>
      </section>

      {/* FEATURES – GROUPED */}
      <section id="features" className="bg-zinc-50 border-y border-zinc-200">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-semibold text-center">
            Everything you need to run on autopilot
          </h2>
          <p className="mt-2 text-center text-zinc-600 max-w-2xl mx-auto">
            Built so a busy owner can actually use it — not just the “computer person”.
          </p>

          <div className="mt-12 grid md:grid-cols-2 gap-8">
            <Feature
              title="Calendar built for real-life bookings"
              points={[
                "Day and week view with fast staff filters",
                "Opening hours and gaps enforced so AI can’t overbook",
                "Colour-coded services and staff for instant clarity",
              ]}
            />
            <Feature
              title="Client & service management"
              points={[
                "Store client details, notes and visit history",
                "Create services with duration, price and colour",
                "Mark no-shows / cancellations and keep things tidy",
              ]}
            />
            <Feature
              title="Online bookings & links"
              points={[
                "Share a branded booking link for your organisation",
                "Let regulars rebook without calling",
                "Perfect for Instagram bio, website and SMS",
              ]}
            />
            <Feature
              title="Email AI for your inbox"
              points={[
                "Optional Email AI to draft replies to leads and enquiries",
                "Per-org rules, templates and escalation tags",
                "Keep humans in the loop for higher-risk emails",
              ]}
            />
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR – BUSINESS TYPES */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-semibold text-center">Built for busy NZ operators</h2>
        <p className="mt-2 text-center text-zinc-600 max-w-2xl mx-auto">
          If your phone rings while you&apos;re with clients or on the tools, this is for you.
        </p>

        <div className="mt-10 grid md:grid-cols-4 gap-4">
          <BusinessType
            title="Salons"
            lines={["Colour & cut services", "Regulars who rebook", "No more ringing in the basin area"]}
          />
          <BusinessType
            title="Barbers"
            lines={["Walk-ins + bookings", "Busy weekends", "Cut down on ‘Yo, when can you fit me in?’"]}
          />
          <BusinessType
            title="Clinics"
            lines={["Consults with fixed durations", "Follow-up visits", "Cleaner intake info from callers"]}
          />
          <BusinessType
            title="Tradies"
            lines={["Quotes, jobs and callouts", "Site work during the day", "Stop losing work while you’re driving"]}
          />
        </div>
      </section>

      {/* SOCIAL PROOF / QUOTES */}
      <section className="bg-zinc-50 border-y border-zinc-200">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-semibold text-center">What owners are saying</h2>
          <div className="mt-10 grid md:grid-cols-3 gap-6">
            <Quote
              text="We stopped losing bookings after hours. The AI just handles it."
              author="Salon Owner, Auckland"
            />
            <Quote
              text="Clients said it felt natural — bookings doubled on weekends."
              author="Barber, Wellington"
            />
            <Quote
              text="I used to dread the missed calls list. Now I just open the calendar."
              author="Clinic Manager, Christchurch"
            />
          </div>
        </div>
      </section>

      {/* PRICING (overview only) */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-semibold text-center">Simple pricing (overview)</h2>
        <p className="mt-2 text-center text-zinc-600">
          Full plan details and purchase live on{" "}
          <a
            className="underline"
            href="https://arohacalls.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            arohacalls.com
          </a>
          .
        </p>

        <div className="mt-10 grid md:grid-cols-3 gap-6">
          <Plan
            name="Lite"
            price="NZ$99"
            per="/mo"
            items={["AI answers & books", "Core Aroha calendar", "1 staff login"]}
          />
          <Plan
            name="Starter"
            price="NZ$199"
            per="/mo"
            highlight
            items={[
              "Everything in Lite",
              "Staff schedules & services",
              "Basic analytics for owners",
            ]}
          />
          <Plan
            name="Pro"
            price="NZ$349"
            per="/mo"
            items={[
              "Everything in Starter",
              "Advanced insights & reporting",
              "Priority support & setup help",
            ]}
          />
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
      </section>

      {/* FAQ – INTERACTIVE (details/summary) */}
      <section className="bg-zinc-50 border-y border-zinc-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-semibold text-center">Questions owners usually ask</h2>
          <div className="mt-8 grid md:grid-cols-2 gap-4">
            <Faq
              q="Do I have to move my whole business onto Aroha on day one?"
              a="No. Start by letting Aroha Calls + Aroha Bookings handle new bookings. You can keep your old system in the background while you get comfortable."
            />
            <Faq
              q="Does the AI replace my staff?"
              a="No. It takes the boring phone and booking admin off their plate. You still run the business — it just stops the constant interruptions."
            />
            <Faq
              q="What happens if the AI is unsure?"
              a="You control the rules. For edge cases or certain keywords (like ‘complaint’ or ‘refund’), it can escalate to a human or simply draft a reply for you to approve."
            />
            <Faq
              q="Can I stop at any time?"
              a="Yes. Billing is month-to-month via arohacalls.com. No long contracts, no nonsense."
            />
          </div>
        </div>
      </section>

      {/* MORE INFO / CONTACT */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="rounded-xl border border-zinc-200 p-6 md:p-8 bg-white">
          <h2 className="text-2xl font-semibold">Want a closer look?</h2>
          <p className="mt-2 text-zinc-600">
            Flick us a message and we’ll send setup details, examples, and a quick demo video of a
            real booking flow.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
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
        <p className="mt-2 text-zinc-300">
          Aroha Calls + Aroha Bookings give you one simple system to run the day.
        </p>
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
        <a className="underline" href="mailto:support@arohacalls.com">
          support@arohacalls.com
        </a>
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

function DemoCard({
  title,
  subtitle,
  badge,
  content,
}: {
  title: string;
  subtitle: string;
  badge: string;
  content: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
          {badge}
        </span>
      </div>
      <h3 className="mt-3 text-lg font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>
      <div className="mt-4">{content}</div>
    </div>
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
          (highlight
            ? "bg-black text-white hover:bg-zinc-800"
            : "border border-zinc-300 hover:bg-zinc-50")
        }
      >
        Choose {name} on arohacalls.com
      </a>
    </div>
  );
}

function TimelineStep({
  step,
  label,
  text,
}: {
  step: string;
  label: string;
  text: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-xs font-semibold">
        {step}
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-zinc-600 mt-0.5">{text}</p>
      </div>
    </li>
  );
}

function ProductCard({
  badge,
  title,
  points,
  footer,
}: {
  badge: string;
  title: string;
  points: string[];
  footer?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-0.5 text-[11px] text-zinc-700 mb-3">
        {badge}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <ul className="mt-3 text-sm text-zinc-700 space-y-1.5 list-disc list-inside">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      {footer && <p className="mt-4 text-xs text-zinc-500">{footer}</p>}
    </div>
  );
}

function StepCard({
  label,
  title,
  points,
}: {
  label: string;
  title: string;
  points: string[];
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
        {label}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 text-xs text-zinc-700 space-y-1.5 list-disc list-inside">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

function BusinessType({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 text-xs text-zinc-700 space-y-1">
        {lines.map((l, i) => (
          <li key={i}>• {l}</li>
        ))}
      </ul>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="rounded-lg border border-zinc-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium text-zinc-800">
        {q}
      </summary>
      <p className="mt-2 text-sm text-zinc-600">{a}</p>
    </details>
  );
}
