// Limiteur de débit en mémoire, sans dépendance externe.
// Suffisant pour une application mono-instance ; pour un déploiement
// multi-instances, remplacer par un store partagé (Redis).

const buckets = new Map();

const prune = (now) => {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

export const createRateLimiter = ({
  windowMs = 5 * 60 * 1000,
  max = 20,
  keyPrefix = "rl",
  keyGenerator = (req) => req.ip || req.socket?.remoteAddress || "unknown",
  message = "Trop de tentatives. Réessayez dans quelques minutes.",
} = {}) => {
  return (req, res, next) => {
    const now = Date.now();
    prune(now);
    const key = `${keyPrefix}:${keyGenerator(req)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, max - bucket.count)),
    );
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message, code: "RATE_LIMITED" });
    }
    return next();
  };
};

export const resetRateLimits = () => buckets.clear();
