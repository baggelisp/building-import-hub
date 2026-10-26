// Origin allow-list for the Edge Function. Entries are exact origins, or patterns where `*` stands
// for letters, digits and hyphens inside one hostname label. That is enough for Firebase preview
// channels (`https://<site>--pr-12-a1b2c3.web.app`) while a pattern can never stretch across a
// dot: `https://site--*.web.app` does not match `https://site--x.evil.example/.web.app`.

export function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function toRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
    .join("[a-z0-9-]+");
  return new RegExp(`^${escaped}$`);
}

export function isAllowedOrigin(origin: string | null, allowList: string[]): boolean {
  if (!origin) return false;
  return allowList.some((entry) =>
    entry.includes("*") ? toRegExp(entry).test(origin) : entry === origin,
  );
}
