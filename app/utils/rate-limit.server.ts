const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Basic in-memory fixed-window rate limiter, good enough for a single
 * app-server process. A multi-instance production deployment would need a
 * shared store (e.g. Redis) instead -- this is a deliberate MVP tradeoff.
 */
export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

/**
 * Best-effort client IP from the standard forwarding header. Unlike a
 * client-supplied visitorId, this isn't something a request body can just
 * declare a fresh value for on every call -- callers should rate limit on
 * this in addition to, not instead of, any self-reported identifier.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return "unknown";
}
