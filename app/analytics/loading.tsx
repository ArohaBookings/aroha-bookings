export default function AnalyticsLoading() {
  return (
    <div className="p-6">
      <div className="space-y-4">
        <div className="h-6 w-40 rounded bg-zinc-100 animate-pulse" />
        <div className="h-4 w-72 rounded bg-zinc-100 animate-pulse" />
        <div className="grid gap-4 lg:grid-cols-3">
          {["a", "b", "c", "d", "e", "f"].map((key) => (
            <div key={key} className="h-28 rounded-xl bg-zinc-100 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
