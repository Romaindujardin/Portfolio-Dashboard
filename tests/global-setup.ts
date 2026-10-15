// Démarre un serveur API isolé pour toute la durée de la suite de tests :
// - port libre dédié
// - base SQLite temporaire (DATABASE_PATH)
// - répertoire de travail isolé (.test-tmp → dossier data/ des miroirs JSON)
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(REPO_ROOT, ".test-tmp");

let serverProcess: ChildProcess | null = null;

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (!address || typeof address === "string") {
        reject(new Error("Impossible d'obtenir un port libre"));
        return;
      }
      const port = address.port;
      srv.close(() => resolve(port));
    });
  });

const waitForServer = async (baseUrl: string, timeoutMs = 30000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/test`);
      if (res.ok) return;
    } catch {
      // pas encore prêt
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Le serveur de test n'a pas démarré (${baseUrl})`);
};

export async function setup() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = path.join(TMP_DIR, "portfolio-test.db");
  const logFd = fs.openSync(path.join(TMP_DIR, "server.log"), "a");

  serverProcess = spawn(process.execPath, [path.join(REPO_ROOT, "server.js")], {
    cwd: TMP_DIR, // isole le dossier data/ (miroirs JSON disque)
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: dbPath,
      NODE_ENV: "test",
    },
    stdio: ["ignore", logFd, logFd],
  });

  serverProcess.on("error", (err) => {
    console.error("Erreur de démarrage du serveur de test:", err);
  });

  // Sécurité : tuer le serveur si le processus de test se termine brutalement.
  process.on("exit", () => {
    if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGKILL");
  });

  await waitForServer(baseUrl);

  fs.writeFileSync(
    path.join(TMP_DIR, "test-server.json"),
    JSON.stringify({ port, baseUrl, dbPath, tmpDir: TMP_DIR }, null, 2),
  );
}

export async function teardown() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGKILL");
        resolve();
      }, 3000);
      serverProcess!.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  if (process.env.KEEP_TEST_TMP !== "1") {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}
