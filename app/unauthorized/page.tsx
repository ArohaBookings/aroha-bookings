export default function UnauthorizedPage() {
  return (
    <div className="p-8 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Access Denied</h1>
      <p className="text-zinc-600 text-sm">
        This account isn’t linked to any purchase.
        Please sign in with the same email you used when buying Aroha Calls.
      </p>
      <a
        href="/api/auth/signin"
        className="inline-block mt-4 text-indigo-600 underline"
      >
        Sign in with correct email
      </a>
    </div>
  );
}
