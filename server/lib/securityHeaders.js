// En-têtes de sécurité HTTP communs à Express et au reverse proxy.
//
// La CSP est d'abord servie en `Report-Only` : elle ne bloque rien, mais les
// violations sont collectées sur /api/csp-report. Une fois les rapports
// analysés, CSP_MODE=enforce active le blocage.
//
// Le frontend utilise un script inline minimal pour appliquer le thème avant
// le premier rendu, d'où `'unsafe-inline'` pour les scripts. Les appels réseau
// sortants (cours, RPC blockchain, taux) sont autorisés en HTTPS.

export const CSP_REPORT_PATH = "/api/csp-report";

export const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'"],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "connect-src": ["'self'", "https:"],
  "report-uri": [CSP_REPORT_PATH],
  "report-to": ["csp-endpoint"],
};

export const buildContentSecurityPolicy = (directives = CSP_DIRECTIVES) =>
  Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");

export const resolveCspMode = (env = process.env) =>
  String(env.CSP_MODE || "").toLowerCase() === "enforce"
    ? "enforce"
    : "report-only";

export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

/**
 * Middleware Express. `env` est injectable pour les tests.
 */
export const createSecurityHeaders = ({ env = process.env } = {}) => {
  const isProduction = env.NODE_ENV === "production";
  const cspMode = resolveCspMode(env);
  const cspHeader =
    cspMode === "enforce"
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only";
  const csp = buildContentSecurityPolicy();

  return (req, res, next) => {
    res.setHeader(cspHeader, csp);
    res.setHeader("Reporting-Endpoints", `csp-endpoint="${CSP_REPORT_PATH}"`);
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Origin-Agent-Cluster", "?1");
    if (isProduction) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    next();
  };
};

export default createSecurityHeaders;
