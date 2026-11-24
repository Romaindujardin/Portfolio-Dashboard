// Exécution contrôlée des CLI sidecars locaux (BNP, Fortuneo).
// Aucun secret ne doit être transmis par argv ou hérité de l'environnement du
// serveur : seules les variables strictement nécessaires sont transmises.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const SIDECAR_ENV_ALLOWLIST = new Set([
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "PYTHONIOENCODING",
  "PYTHONUTF8",
  "TZ",
]);

export const buildSidecarEnv = ({
  extraEnv = {},
  home = null,
  allowPrefixes = [],
} = {}) => {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (
      SIDECAR_ENV_ALLOWLIST.has(key) ||
      key.startsWith("LC_") ||
      allowPrefixes.some((prefix) => key.startsWith(prefix))
    ) {
      env[key] = value;
    }
  }
  Object.assign(env, extraEnv);
  env.HOME = home || process.env.HOME || os.tmpdir();
  return env;
};

export const findOnPath = (name) => {
  const pathValue = process.env.PATH || "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

export const resolveExecutable = (candidates, label, envHint = null) => {
  const unique = [...new Set(candidates.filter(Boolean))];
  for (const candidate of unique) {
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      throw new Error(
        `${label} non exécutable: ${candidate}. Vérifiez les permissions (chmod +x).`,
      );
    }
    return candidate;
  }
  throw new Error(
    `${label} introuvable.` +
      (envHint ? ` Définissez ${envHint} ou installez le sidecar.` : ""),
  );
};

export const redactSecrets = (text, secrets = []) => {
  let output = String(text ?? "");
  // Redacte les secrets les plus longs d'abord : sinon un code secret court
  // inclus dans un numéro client plus long laisserait apparaître un suffixe.
  const values = [...new Set(secrets.map((secret) => String(secret ?? "")))]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const value of values) {
    output = output.split(value).join("***");
  }
  return output;
};

const sidecarError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

/**
 * Lance un CLI sidecar avec timeout, limite de sortie et redaction.
 * Résout même lorsque le processus sort en erreur : l'appelant inspecte
 * `code` et `stderr` pour extraire l'erreur JSON du CLI.
 */
export const runSidecarProcess = ({
  command,
  args,
  env,
  cwd = process.cwd(),
  input = null,
  timeoutMs = 120_000,
  maxOutputBytes = 10 * 1024 * 1024,
  redact = [],
  redactStdout = false,
  onSpawn = null,
}) =>
  new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      if (typeof onSpawn === "function") onSpawn(child);
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimitReached = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, Math.max(1, Number(timeoutMs) || 120_000));
    timer.unref?.();

    const append = (current, chunk, stream) => {
      const bytes = Buffer.byteLength(chunk);
      if (stream === "stdout") stdoutBytes += bytes;
      else stderrBytes += bytes;
      if (stdoutBytes > maxOutputBytes || stderrBytes > maxOutputBytes) {
        outputLimitReached = true;
        child.kill("SIGKILL");
        return current;
      }
      return current + chunk;
    };

    child.stdout.on("data", (data) => {
      stdout = append(stdout, data.toString("utf8"), "stdout");
    });
    child.stderr.on("data", (data) => {
      stderr = append(stderr, data.toString("utf8"), "stderr");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        sidecarError(
          redactSecrets(
            `Impossible de lancer le sidecar: ${error.message}`,
            redact,
          ),
          "SIDECAR_SPAWN_ERROR",
        ),
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          sidecarError(
            `Le sidecar n'a pas répondu en ${timeoutMs} ms.`,
            "SIDECAR_TIMEOUT",
          ),
        );
        return;
      }
      if (outputLimitReached) {
        reject(
          sidecarError(
            `Le sidecar a dépassé la limite de ${maxOutputBytes} octets.`,
            "SIDECAR_OUTPUT_LIMIT",
          ),
        );
        return;
      }
      resolve({
        code: code == null ? -1 : code,
        signal: signal || null,
        // Le JSON d'export ne doit pas être redacté : un numéro client ou un
        // code secret composé de chiffres pourrait correspondre à un montant,
        // un IBAN ou une date et corrompre les données. Les erreurs sont
        // toujours redactées, et les secrets ne transitent que par stdin.
        stdout: redactStdout ? redactSecrets(stdout, redact) : stdout,
        stderr: redactSecrets(stderr, redact),
      });
    });

    child.stdin.on("error", () => {
      // Le CLI peut fermer stdin avant la fin de l'écriture (erreur précoce).
    });
    if (input == null) child.stdin.end();
    else child.stdin.end(String(input));
  });

export const createPrivateTempDir = (prefix) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(directory, 0o700);
  return directory;
};

export const removePrivateDir = (directory) => {
  if (!directory) return;
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    console.warn(`⚠️ Impossible de nettoyer le répertoire temporaire ${directory}:`, error);
  }
};
