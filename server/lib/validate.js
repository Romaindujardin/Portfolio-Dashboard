// Validation et petites aides HTTP partagées par les routes du patrimoine.
// Reste volontairement sans dépendance pour être testable isolément.

export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export const sanitizeUserId = (value) => {
  const candidate = String(value ?? "").trim();
  if (!candidate) return "Romain";
  return /^[A-Za-z0-9_-]{1,64}$/.test(candidate) ? candidate : null;
};

export const requireUserId = (value) => {
  const userId = sanitizeUserId(value);
  if (!userId) throw new HttpError(400, "user_id invalide");
  return userId;
};

export const asString = (value, { max = 500, fallback = "" } = {}) => {
  if (value == null) return fallback;
  const str = String(value).trim();
  return str.length > max ? str.slice(0, max) : str;
};

export const asOptionalString = (value, max = 500) => {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.length > max ? str.slice(0, max) : str;
};

export const asNumber = (value, { fallback = 0, min = -Infinity, max = Infinity } = {}) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

export const asOptionalNumber = (value, opts = {}) => {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const { min = -Infinity, max = Infinity } = opts;
  return Math.min(max, Math.max(min, num));
};

export const asInteger = (value, { fallback = 0, min = -Infinity, max = Infinity } = {}) => {
  const num = asNumber(value, { fallback, min, max });
  return Math.round(num);
};

export const asOptionalInteger = (value, opts = {}) => {
  const num = asOptionalNumber(value, opts);
  return num == null ? null : Math.round(num);
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const asDate = (value, { fallback = null } = {}) => {
  if (value == null || value === "") return fallback;
  const str = String(value).slice(0, 10);
  if (!DATE_RE.test(str)) return fallback;
  const parsed = new Date(`${str}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : str;
};

export const asTimestamp = (value, { fallback = null } = {}) => {
  if (value == null || value === "") return fallback;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
};

export const oneOf = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

export const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);
