"use client"; // this page is interactive, so keep it client-side

// NOTE: Do NOT export revalidate/dynamic flags from client components.
// They belong only in a server layout or parent page.


 
import React, { useEffect, useMemo, useRef, useState } from "react";


/* ──────────────────────────────────────────────────────────────
   Types
   ────────────────────────────────────────────────────────────*/
type ClientStatus = "active" | "inactive" | "vip" | "new";

type Appointment = {
  id: string;
  service: string;
  staff: string;
  startsAt: string; // ISO
  endsAt: string;   // ISO
};

type Client = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  tags: string[];
  status: ClientStatus;
  preferredStaff?: string;
  lastVisit?: string; // ISO
  totalSpendCents: number;
  notes?: string;
  allowMarketing: boolean;
  allowReminders: boolean;
  upcoming: Appointment[];
  history: Appointment[];
};

type SortKey = "name" | "lastVisit" | "spend";

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────*/
const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 10)}`;

const nzd = (cents: number) =>
  new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(
    cents / 100
  );

const fullName = (c: Client) => `${c.firstName} ${c.lastName}`.trim();

const toLocal = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

const dayDate = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

/* ──────────────────────────────────────────────────────────────
   Page
   ────────────────────────────────────────────────────────────*/
export default function ClientsPage() {
  // data (wire to server later)
  const [clients, setClients] = useState<Client[]>([]);

  // table state
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ClientStatus | "all">("all");
  const [tag, setTag] = useState<string | "all">("all");
  const [staffFilter, setStaffFilter] = useState<string | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // drawer
  const [openId, setOpenId] = useState<string | null>(null);
  const openClient = useMemo(
    () => clients.find((c) => c.id === openId) || null,
    [openId, clients]
  );

  // derived: all unique tags + staff names
  const allTags = useMemo(() => {
    const t = new Set<string>();
    clients.forEach((c) => c.tags.forEach((x) => t.add(x)));
    return Array.from(t).sort((a, b) => a.localeCompare(b));
  }, [clients]);

  const allStaff = useMemo(() => {
    const s = new Set<string>();
    clients.forEach((c) => c.preferredStaff && s.add(c.preferredStaff));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [clients]);

  // filtered + sorted
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = clients.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (tag !== "all" && !c.tags.includes(tag)) return false;
      if (staffFilter !== "all" && c.preferredStaff !== staffFilter) return false;
      if (!q) return true;
      const f = `${c.firstName} ${c.lastName} ${c.email ?? ""} ${c.phone ?? ""}`.toLowerCase();
      return f.includes(q);
    });

    out.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = fullName(a).localeCompare(fullName(b));
      } else if (sortKey === "lastVisit") {
        const ta = a.lastVisit ? new Date(a.lastVisit).getTime() : 0;
        const tb = b.lastVisit ? new Date(b.lastVisit).getTime() : 0;
        cmp = ta - tb;
      } else if (sortKey === "spend") {
        cmp = a.totalSpendCents - b.totalSpendCents;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return out;
  }, [clients, query, status, tag, staffFilter, sortKey, sortDir]);

  // pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    // reset page when filters change
    setPage(1);
    setSelected(new Set());
  }, [query, status, tag, staffFilter]);

  // bulk helpers
  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(paged.map((c) => c.id)));
    else setSelected(new Set());
  };
  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };

  // CSV export
  const exportCSV = () => {
    const header = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "tags",
      "status",
      "preferredStaff",
      "lastVisit",
      "totalSpendCents",
      "notes",
      "allowMarketing",
      "allowReminders",
    ];
    const rows = clients.map((c) => [
      c.firstName,
      c.lastName,
      c.email ?? "",
      c.phone ?? "",
      c.tags.join("|"),
      c.status,
      c.preferredStaff ?? "",
      c.lastVisit ?? "",
      String(c.totalSpendCents),
      (c.notes ?? "").replaceAll("\n", " "),
      String(c.allowMarketing),
      String(c.allowReminders),
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadFile("clients.csv", csv, "text/csv;charset=utf-8");
  };

  // CSV import (simple)
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importCSV = (file: File) => {
    file.text().then((txt) => {
      const lines = txt.split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) return;
      const [hdr, ...data] = lines;
      const cols = hdr.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const idx = (k: string) => cols.indexOf(k);

      const incoming: Client[] = data.map((ln) => {
        const cells = parseCSVRow(ln);
        const get = (k: string) => cells[idx(k)] ?? "";
        const tags = (get("tags") || "").split("|").filter(Boolean);
        const status = (get("status") || "active") as ClientStatus;
        return {
          id: uid("cli"),
          firstName: get("firstName"),
          lastName: get("lastName"),
          email: get("email") || undefined,
          phone: get("phone") || undefined,
          tags,
          status,
          preferredStaff: get("preferredStaff") || undefined,
          lastVisit: get("lastVisit") || undefined,
          totalSpendCents: Number(get("totalSpendCents") || 0),
          notes: get("notes") || undefined,
          allowMarketing: get("allowMarketing") === "true",
          allowReminders: get("allowReminders") === "true",
          upcoming: [],
          history: [],
        };
      });

      setClients((prev) => [...incoming, ...prev]);
    });
  };

  return (
    <div className="p-6 space-y-6 text-black">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm">
            Manage contacts, notes, preferences, and bookings. (Database wiring comes next.)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-black px-3 py-2 text-sm hover:bg-black hover:text-white transition"
            onClick={exportCSV}
          >
            Export CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) importCSV(f);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <button
            className="rounded-md border border-black px-3 py-2 text-sm hover:bg-black hover:text-white transition"
            onClick={() => fileRef.current?.click()}
          >
            Import CSV
          </button>
          <NewClientButton onCreate={(c) => setClients((prev) => [c, ...prev])} />
        </div>
      </header>

      {/* Filters */}
      <section className="rounded-xl bg-white border border-black p-4">
        <div className="grid gap-3 sm:grid-cols-5">
          <input
            className="h-10 rounded-md border border-black px-3"
            placeholder="Search name, email, phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {/* status */}
          <select
            className="h-10 rounded-md border border-black px-3"
            value={status}
            onChange={(e) => setStatus(e.target.value as ClientStatus | "all")}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="vip">VIP</option>
            <option value="new">New</option>
            <option value="inactive">Inactive</option>
          </select>

          {/* tag */}
          <select
            className="h-10 rounded-md border border-black px-3"
            value={tag}
            onChange={(e) => setTag(e.target.value as string | "all")}
          >
            <option value="all">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {/* staff */}
          <select
            className="h-10 rounded-md border border-black px-3"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value as string | "all")}
          >
            <option value="all">Any staff</option>
            {allStaff.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* sort */}
          <div className="flex gap-2">
            <select
              className="h-10 flex-1 rounded-md border border-black px-3"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="name">Sort: Name</option>
              <option value="lastVisit">Sort: Last Visit</option>
              <option value="spend">Sort: Total Spend</option>
            </select>
            <button
              className="h-10 rounded-md border border-black px-3"
              title="Toggle sort direction"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {sortDir === "asc" ? "⬆︎" : "⬇︎"}
            </button>
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="rounded-xl bg-white border border-black overflow-hidden">
        <div className="border-b border-black px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={selected.size === paged.length && paged.length > 0}
              onChange={(e) => toggleAll(e.target.checked)}
            />
            <span className="text-sm">{selected.size} selected</span>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-black px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={selected.size === 0}
              onClick={() => {
                // archive (UI only)
                const ids = new Set(selected);
                setClients((prev) =>
                  prev.map((c) =>
                    ids.has(c.id) ? { ...c, status: "inactive" } : c
                  )
                );
                setSelected(new Set());
              }}
            >
              Archive
            </button>
            <button
              className="rounded-md border border-black px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={selected.size === 0}
              onClick={() => {
                const ids = new Set(selected);
                setClients((prev) => prev.filter((c) => !ids.has(c.id)));
                setSelected(new Set());
              }}
            >
              Delete
            </button>
          </div>
        </div>

        <table className="min-w-full text-sm">
          <thead className="bg-white">
            <tr className="border-b border-black">
              <th className="text-left px-4 py-2 w-10">Sel</th>
              <th className="text-left px-4 py-2">Client</th>
              <th className="text-left px-4 py-2">Contact</th>
              <th className="text-left px-4 py-2">Tags</th>
              <th className="text-left px-4 py-2">Preferred staff</th>
              <th className="text-left px-4 py-2">Last visit</th>
              <th className="text-right px-4 py-2">Total spend</th>
              <th className="text-right px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {paged.map((c) => (
              <tr key={c.id} className="border-b border-black/70 hover:bg-black/5">
                <td className="px-4 py-2 align-top">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={(e) => toggleOne(c.id, e.target.checked)}
                  />
                </td>
                <td className="px-4 py-2 align-top">
                  <div className="font-medium">{fullName(c)}</div>
                  <div className="text-xs">
                    <StatusBadge status={c.status} />
                  </div>
                </td>
                <td className="px-4 py-2 align-top">
                  <div>{c.email || "—"}</div>
                  <div>{c.phone || "—"}</div>
                </td>
                <td className="px-4 py-2 align-top">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-block rounded-full border border-black px-2 py-0.5 text-xs"
                      >
                        {t}
                      </span>
                    ))}
                    {c.tags.length === 0 && <span className="text-xs">—</span>}
                  </div>
                </td>
                <td className="px-4 py-2 align-top">{c.preferredStaff || "—"}</td>
                <td className="px-4 py-2 align-top">{dayDate(c.lastVisit)}</td>
                <td className="px-4 py-2 align-top text-right">
                  {nzd(c.totalSpendCents)}
                </td>
                <td className="px-4 py-2 align-top text-right">
                  <button
                    className="rounded-md border border-black px-2 py-1 text-xs hover:bg-black hover:text-white"
                    onClick={() => setOpenId(c.id)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}

            {paged.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center" colSpan={8}>
                  {clients.length === 0
                    ? "No clients yet — click “+ New client” or import a CSV to get started."
                    : "No clients match your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-black">
          <div className="text-sm">
            Page {page} / {totalPages} &middot; {filtered.length} total
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-black px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <button
              className="rounded-md border border-black px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {/* Drawer */}
      {openClient && (
        <ClientDrawer
          client={openClient}
          onClose={() => setOpenId(null)}
          onSave={(patch) => {
            setClients((prev) =>
              prev.map((c) => (c.id === openClient.id ? { ...c, ...patch } : c))
            );
          }}
          onAddAppointment={(apt) => {
            setClients((prev) =>
              prev.map((c) =>
                c.id === openClient.id
                  ? { ...c, upcoming: [apt, ...c.upcoming] }
                  : c
              )
            );
          }}
          onDelete={() => {
            setClients((prev) => prev.filter((c) => c.id !== openClient.id));
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   New Client (inline modal-less button)
   ────────────────────────────────────────────────────────────*/
function NewClientButton({ onCreate }: { onCreate: (c: Client) => void }) {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const clear = () => {
    setFirst("");
    setLast("");
    setEmail("");
    setPhone("");
  };

  return (
    <>
      <button
        className="rounded-md border border-black px-3 py-2 text-sm hover:bg-black hover:text-white transition"
        onClick={() => setOpen(true)}
      >
        + New client
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="w-full max-w-lg rounded-xl bg-white border border-black p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">New client</h3>
              <button className="text-sm underline" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <div className="grid gap-3 mt-4 sm:grid-cols-2">
              <input
                className="h-10 rounded-md border border-black px-3"
                placeholder="First name"
                value={first}
                onChange={(e) => setFirst(e.target.value)}
              />
              <input
                className="h-10 rounded-md border border-black px-3"
                placeholder="Last name"
                value={last}
                onChange={(e) => setLast(e.target.value)}
              />
              <input
                className="h-10 rounded-md border border-black px-3 sm:col-span-2"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="h-10 rounded-md border border-black px-3 sm:col-span-2"
                placeholder="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-black px-3 py-2 text-sm"
                onClick={() => {
                  clear();
                  setOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md border border-black px-3 py-2 text-sm hover:bg-black hover:text-white"
                onClick={() => {
                  if (!first.trim()) return;
                  const c: Client = {
                    id: uid("cli"),
                    firstName: first.trim(),
                    lastName: last.trim(),
                    email: email.trim() || undefined,
                    phone: phone.trim() || undefined,
                    tags: [],
                    status: "active",
                    preferredStaff: undefined,
                    lastVisit: undefined,
                    totalSpendCents: 0,
                    notes: "",
                    allowMarketing: true,
                    allowReminders: true,
                    upcoming: [],
                    history: [],
                  };
                  onCreate(c);
                  clear();
                  setOpen(false);
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────
   Drawer (client details)
   ────────────────────────────────────────────────────────────*/
function ClientDrawer({
  client,
  onClose,
  onSave,
  onAddAppointment,
  onDelete,
}: {
  client: Client;
  onClose: () => void;
  onSave: (patch: Partial<Client>) => void;
  onAddAppointment: (apt: Appointment) => void;
  onDelete: () => void;
}) {
  // local edit state
  const [firstName, setFirst] = useState(client.firstName);
  const [lastName, setLast] = useState(client.lastName);
  const [email, setEmail] = useState(client.email ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [tags, setTags] = useState<string[]>(client.tags);
  const [status, setStatus] = useState<ClientStatus>(client.status);
  const [preferredStaff, setPreferredStaff] = useState(client.preferredStaff ?? "");
  const [notes, setNotes] = useState(client.notes ?? "");
  const [allowMarketing, setAllowMarketing] = useState<boolean>(client.allowMarketing);
  const [allowReminders, setAllowReminders] = useState<boolean>(client.allowReminders);

  // add tag quickly
  const [tagInput, setTagInput] = useState("");

  // add appointment quickly
  const [svc, setSvc] = useState("Service");
  const [staff, setStaff] = useState("Staff");
  const [when, setWhen] = useState<string>(() => {
    const t = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    t.setMinutes(0, 0, 0);
    return new Date(t).toISOString().slice(0, 16);
  });
  const [durationMin, setDuration] = useState(45);

  const save = () => {
    onSave({
      firstName,
      lastName,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      tags,
      status,
      preferredStaff: preferredStaff.trim() || undefined,
      notes,
      allowMarketing,
      allowReminders,
    });
    onClose();
  };

  const addQuickBooking = () => {
    const start = new Date(when);
    const end = new Date(start.getTime() + durationMin * 60000);
    onAddAppointment({
      id: uid("apt"),
      service: svc,
      staff,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full max-w-xl bg-white border-l border-black p-6 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold">{fullName(client)}</h3>
          <button className="text-sm underline" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid gap-4 mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="h-10 rounded-md border border-black px-3"
              value={firstName}
              onChange={(e) => setFirst(e.target.value)}
              placeholder="First name"
            />
            <input
              className="h-10 rounded-md border border-black px-3"
              value={lastName}
              onChange={(e) => setLast(e.target.value)}
              placeholder="Last name"
            />
            <input
              className="h-10 rounded-md border border-black px-3 sm:col-span-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
            />
            <input
              className="h-10 rounded-md border border-black px-3 sm:col-span-2"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Status</label>
              <select
                className="h-10 rounded-md border border-black px-3"
                value={status}
                onChange={(e) => setStatus(e.target.value as ClientStatus)}
              >
                <option value="active">Active</option>
                <option value="vip">VIP</option>
                <option value="new">New</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Preferred staff</label>
              <input
                className="h-10 rounded-md border border-black px-3"
                value={preferredStaff}
                onChange={(e) => setPreferredStaff(e.target.value)}
                placeholder="e.g., Ruby"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Tags</label>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-2 rounded-full border border-black px-3 py-1 text-sm">
                  {t}
                  <button
                    className="text-xs underline"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                  >
                    remove
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className="h-10 rounded-md border border-black px-3 flex-1"
                placeholder="Add tag (press Enter)"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const t = tagInput.trim();
                    if (t && !tags.includes(t)) setTags([...tags, t]);
                    setTagInput("");
                  }
                }}
              />
              <button
                className="rounded-md border border-black px-3"
                onClick={() => {
                  const t = tagInput.trim();
                  if (t && !tags.includes(t)) setTags([...tags, t]);
                  setTagInput("");
                }}
              >
                Add
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              className="min-h-[100px] rounded-md border border-black px-3 py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Allergies, preferences, patch tests, etc."
            />
          </div>

          <div className="flex items-center gap-6">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowMarketing}
                onChange={(e) => setAllowMarketing(e.target.checked)}
              />
              <span>Marketing consent</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowReminders}
                onChange={(e) => setAllowReminders(e.target.checked)}
              />
              <span>Appointment reminders</span>
            </label>
          </div>

          {/* Quick bookings */}
          <div className="rounded-lg border border-black p-3">
            <div className="font-semibold mb-2">Quick booking</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="h-10 rounded-md border border-black px-3"
                value={svc}
                onChange={(e) => setSvc(e.target.value)}
                placeholder="Service"
              />
              <input
                className="h-10 rounded-md border border-black px-3"
                value={staff}
                onChange={(e) => setStaff(e.target.value)}
                placeholder="Staff"
              />
              <input
                type="datetime-local"
                className="h-10 rounded-md border border-black px-3"
                value={new Date(when).toISOString().slice(0, 16)}
                onChange={(e) => setWhen(new Date(e.target.value).toISOString())}
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="h-10 w-28 rounded-md border border-black px-3"
                  value={durationMin}
                  onChange={(e) => setDuration(Number(e.target.value || 0))}
                />
                <span>min</span>
              </div>
            </div>
            <div className="mt-3">
              <button
                className="rounded-md border border-black px-3 py-2 text-sm hover:bg-black hover:text-white"
                onClick={addQuickBooking}
              >
                Add to upcoming
              </button>
            </div>
          </div>

          {/* Upcoming & history */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="font-semibold mb-2">Upcoming</div>
              <div className="space-y-2">
                {client.upcoming.map((a) => (
                  <div key={a.id} className="rounded-md border border-black p-2">
                    <div className="font-medium">{a.service}</div>
                    <div className="text-sm">
                      {a.staff} &middot; {toLocal(a.startsAt)} – {toLocal(a.endsAt)}
                    </div>
                  </div>
                ))}
                {client.upcoming.length === 0 && (
                  <div className="text-sm">No upcoming bookings.</div>
                )}
              </div>
            </div>
            <div>
              <div className="font-semibold mb-2">History</div>
              <div className="space-y-2">
                {client.history.map((a) => (
                  <div key={a.id} className="rounded-md border border-black p-2">
                    <div className="font-medium">{a.service}</div>
                    <div className="text-sm">
                      {a.staff} &middot; {toLocal(a.startsAt)}
                    </div>
                  </div>
                ))}
                {client.history.length === 0 && (
                  <div className="text-sm">No past bookings.</div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-2 flex items-center justify-between">
            <button
              className="rounded-md border border-black px-3 py-2 text-sm hover:bg-black hover:text-white"
              onClick={save}
            >
              Save changes
            </button>
            <button
              className="rounded-md border border-black px-3 py-2 text-sm hover:bg-black hover:text-white"
              onClick={onDelete}
            >
              Delete client
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Small bits
   ────────────────────────────────────────────────────────────*/
function StatusBadge({ status }: { status: ClientStatus }) {
  const text =
    status === "vip"
      ? "VIP"
      : status === "new"
      ? "New"
      : status === "inactive"
      ? "Inactive"
      : "Active";
  return (
    <span className="inline-block rounded-full border border-black px-2 py-0.5 text-[11px]">
      {text}
    </span>
  );
}

function csvEscape(s: string) {
  const need = /[",\n]/.test(s);
  return need ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCSVRow(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQ) {
      if (ch === '"' && row[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQ = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

function downloadFile(filename: string, data: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
