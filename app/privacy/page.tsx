export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-12">
      <div className="mx-auto w-full max-w-3xl space-y-6 text-zinc-800">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Privacy Policy</h1>
        <p className="text-sm text-zinc-600">Last updated: January 2025</p>
        <section className="space-y-3 text-sm leading-relaxed text-zinc-700">
          <p>
            This Privacy Policy explains how Aroha Bookings collects, uses, and safeguards your data.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Data we process</h2>
          <p>
            We process account information, scheduling details, and communications data that you provide.
            You remain responsible for obtaining any required customer consent.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">How we use data</h2>
          <p>
            Data is used to provide the Service, improve reliability, and deliver requested features.
            We do not sell personal data.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Security</h2>
          <p>
            We apply reasonable technical and organizational measures to protect data. No system is completely secure.
          </p>
          <h2 className="text-base font-semibold text-zinc-900">Contact</h2>
          <p>
            For privacy questions, contact support at support@arohabookings.com.
          </p>
        </section>
      </div>
    </main>
  );
}
