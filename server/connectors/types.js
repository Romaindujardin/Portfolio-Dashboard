// Erreurs typées et constantes partagées par les connecteurs.

export class ConnectorError extends Error {
  constructor(message, { status = 502, code = "CONNECTOR_ERROR", details = null, retryable = false } = {}) {
    super(message);
    this.name = "ConnectorError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export class ConnectorConfigError extends ConnectorError {
  constructor(message, details = null) {
    super(message, { status: 400, code: "CONNECTOR_NOT_CONFIGURED", details });
    this.name = "ConnectorConfigError";
  }
}

export class ConnectorAuthError extends ConnectorError {
  constructor(message, details = null) {
    super(message, {
      status: 401,
      code: "REAUTH_REQUIRED",
      details,
      retryable: false,
    });
    this.name = "ConnectorAuthError";
  }
}

export const PROVIDERS = {
  ENABLE_BANKING: "enable-banking",
  MANUAL: "manual",
  CSV: "csv",
  BOURSO: "bourso",
  BOURSO_SIDECAR: "bourso-sidecar",
};

export const ACCOUNT_TYPES = [
  "CHECKING",
  "SAVINGS",
  "PEA",
  "SECURITIES",
  "CRYPTO",
  "REAL_ESTATE",
  "LOAN",
  "EMPLOYEE_SAVINGS",
  "OTHER",
];

export const INVESTMENT_TYPES = new Set([
  "PEA",
  "SECURITIES",
  "CRYPTO",
  "EMPLOYEE_SAVINGS",
]);
