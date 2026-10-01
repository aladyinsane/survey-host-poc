// In-memory fixed-window limiter. Per process, so the infra runs a single replica for the POC.
// Production would use the platform gateway/WAF or a shared store.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

// Behind one trusted proxy (the platform ingress), the proxy appends the real client address
// last. Earlier entries are client-supplied and spoofable.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  const parts = xff.split(",");
  return parts[parts.length - 1].trim() || "unknown";
}
