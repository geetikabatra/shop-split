import Redis from "ioredis";

const WINDOW_MS = 60_000;
const WINDOW_SECONDS = Math.ceil(WINDOW_MS / 1000);
const MAX_REQUESTS_PER_WINDOW = 30;

const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true }) : null;

if (redis) {
  redis.on("error", (error) => {
    console.error("Redis rate limiter connection error:", error);
  });
}

interface Bucket {
  count: number;
  windowStart: number;
}

const inMemoryBuckets = new Map<string, Bucket>();

function isRateLimitedInMemory(key: string): boolean {
  const now = Date.now();
  const bucket = inMemoryBuckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    inMemoryBuckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

/**
 * Fixed-window rate limiter. Shared across every app instance via Redis
 * when REDIS_URL is set; falls back to a single-process in-memory map
 * otherwise (fine for local dev, not for a real multi-instance production
 * deployment). Also fails open to the in-memory path if Redis is
 * reachable-but-erroring, rather than blocking all traffic over an infra
 * blip -- the in-memory fallback is strictly weaker, not absent.
 */
export async function isRateLimited(key: string): Promise<boolean> {
  if (!redis) {
    return isRateLimitedInMemory(key);
  }

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }
    return count > MAX_REQUESTS_PER_WINDOW;
  } catch (error) {
    console.error("Redis rate limiter error, falling back to in-memory for this call:", error);
    return isRateLimitedInMemory(key);
  }
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
