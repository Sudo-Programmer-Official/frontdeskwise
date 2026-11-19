type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

/**
 * A small process-local guard for the first production release. An edge/WAF
 * limit should be added when the API scales horizontally; this guard still
 * protects expensive endpoints between those layers.
 */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new Error("Rate-limit maxRequests must be a positive integer");
    if (!Number.isInteger(windowMs) || windowMs < 1_000) throw new Error("Rate-limit windowMs must be at least one second");
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + this.windowMs }
      : current;

    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (this.buckets.size > 50_000) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }

    return {
      allowed: bucket.count <= this.maxRequests,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - bucket.count),
      resetAt: bucket.resetAt,
    };
  }
}
