export function isSuperAdmin(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMINS || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
