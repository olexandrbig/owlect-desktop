/** Release version helpers for the Mac update notice. Pure, so `node --test` can load it. */

/** "v1.2.3" (a GitHub tag) -> "1.2.3". */
export function releaseVersion(tag: string | undefined): string {
  return (tag ?? "").replace(/^v/, "");
}

/** True when `a` is a strictly newer dotted numeric version than `b`. Anything malformed is never newer. */
export function isNewer(a: string, b: string): boolean {
  if (!/^\d+(\.\d+)*$/.test(a) || !/^\d+(\.\d+)*$/.test(b)) return false;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}
