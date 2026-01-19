export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-12">
      <div className="mx-auto w-full max-w-3xl space-y-6 text-zinc-800">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Terms &amp; Conditions</h1>
        <p className="text-sm text-zinc-600">Last updated: January 2025</p>

        <section className="space-y-3 text-sm leading-relaxed text-zinc-700">
          <p>
            These Terms &amp; Conditions govern your access to and use of Aroha Bookings (the “Service”).
            By creating an account or using the Service, you agree to these terms.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Service description</h2>
          <p>
            Aroha Bookings provides scheduling, communication, and operational tools for service businesses.
            Some features include AI-assisted drafts and suggestions. AI is assistive only and never a source
            of truth for business decisions.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Accounts &amp; subscriptions</h2>
          <p>
            You are responsible for maintaining account security and ensuring your team members follow these terms.
            Subscription fees are billed according to your selected plan. Taxes may apply.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Acceptable use</h2>
          <p>
            You may not misuse the Service, attempt to access systems without authorization, or use the Service
            for unlawful or abusive activity. We may suspend accounts that violate these terms.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Data &amp; privacy</h2>
          <p>
            You own your data. We process data to provide the Service and improve reliability. You must ensure
            you have consent to upload and process customer data. See our Privacy Policy for details.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">AI limitations</h2>
          <p>
            AI outputs are drafts and suggestions. You are responsible for reviewing, approving, and verifying
            accuracy before sending or taking action. We do not guarantee AI outputs are error-free.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Disclaimers</h2>
          <p>
            The Service is provided “as is” and “as available.” We disclaim all warranties to the maximum extent
            permitted by law.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, Aroha Bookings is not liable for indirect, incidental, or
            consequential damages. Our total liability is limited to fees paid in the prior 12 months.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Termination</h2>
          <p>
            You may cancel at any time. We may suspend or terminate access if you breach these terms.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Governing law</h2>
          <p>
            These terms are governed by the laws of New Zealand. Any disputes will be resolved in New Zealand courts.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Contact</h2>
          <p>
            For questions, contact support at support@arohabookings.com.
          </p>
        </section>
      </div>
    </main>
  );
}
