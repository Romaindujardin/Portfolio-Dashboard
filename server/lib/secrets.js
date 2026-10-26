// Chiffrement au repos des secrets d'intégration (clés Enable Banking,
// éventuelle clé OpenFIGI). AES-256-GCM, clé dérivée d'une variable
// d'environnement ou d'un fichier local généré automatiquement.
//
// Le fichier de clé vit dans data/ (déjà ignoré par git) et n'est lisible que
// par l'utilisateur courant. Aucun secret n'est jamais renvoyé en clair par
// l'API : les routes exposent uniquement un état « configuré » et des valeurs
// masquées.

import crypto from "crypto";
import fs from "fs";
import path from "path";

const KEY_FILE = path.join(process.cwd(), "data", ".portfolio-secret");
const ALGO = "aes-256-gcm";
const PREFIX = "v1";

let cachedKey = null;

const deriveKey = (raw) => crypto.createHash("sha256").update(String(raw)).digest();

const loadKey = () => {
  if (cachedKey) return cachedKey;

  if (process.env.PORTFOLIO_SECRET_KEY) {
    cachedKey = deriveKey(process.env.PORTFOLIO_SECRET_KEY);
    return cachedKey;
  }

  try {
    if (fs.existsSync(KEY_FILE)) {
      const stored = fs.readFileSync(KEY_FILE, "utf8").trim();
      if (stored) {
        cachedKey = deriveKey(stored);
        return cachedKey;
      }
    }
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(KEY_FILE, generated, { mode: 0o600 });
    cachedKey = deriveKey(generated);
    return cachedKey;
  } catch (error) {
    throw new Error(
      `Impossible de charger la clé de chiffrement locale (${error.message}). ` +
        "Définissez PORTFOLIO_SECRET_KEY pour un stockage en mémoire.",
    );
  }
};

export const isEncryptionAvailable = () => {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
};

export const encryptJson = (value) => {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
};

export const decryptJson = (payload) => {
  if (typeof payload !== "string" || !payload.startsWith(`${PREFIX}:`)) {
    throw new Error("Format de secret chiffré invalide");
  }
  const [, ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Secret chiffré incomplet");

  const key = loadKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
};

export const maskSecret = (value, visible = 4) => {
  const str = String(value ?? "");
  if (!str) return "";
  if (str.length <= visible) return "•".repeat(str.length);
  return `${"•".repeat(Math.min(12, str.length - visible))}${str.slice(-visible)}`;
};

export const secretFingerprint = (value) => {
  const str = String(value ?? "");
  if (!str) return null;
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
};
