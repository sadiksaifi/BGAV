const UNIT_SECONDS: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };

/** Parses GitHub's duration text, such as `1h 2m 5s`. Returns undefined for other text. */
export function parseDuration(text: string): number | undefined {
  const parts = [...text.matchAll(/(\d+)\s*([dhms])\b/g)];
  if (parts.length === 0) return undefined;
  let total = 0;
  for (const [, n, unit] of parts) total += Number(n) * (UNIT_SECONDS[unit ?? "s"] ?? 0);
  return total;
}

/** Formats seconds the way GitHub does: `45s`, `3m 5s`, `1h 2m`, `2d 3h`. */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}
