import "./shims";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";
import { PROVIDERS } from "../server/connectors/types.js";
import { SyncService } from "../server/services/syncService.js";
import {
  detectBankKey,
  filterSyncableConnections,
  isConnectionReplacedBySidecar,
  markSidecarPriority,
} from "../server/services/sidecarPriority.js";

const USER = "TestSidecarPriority";

describe("Sidecar priority", () => {
  let db: any;
  let repository: any;

  beforeEach(() => {
    db = new Database(":memory:");
    initializePortfolioSchema(db);
    repository = new PortfolioRepository(db);
  });

  const createEb = (label: string, aspspName: string) =>
    repository.createConnector(USER, {
      provider: PROVIDERS.ENABLE_BANKING,
      label,
      status: "active",
      aspspName,
      sessionId: "session",
    });

  const createSidecar = (provider: string, label: string) =>
    repository.createConnector(USER, {
      provider,
      label,
      status: "active",
      aspspName: label,
    });

  it("détecte les banques à sidecar, y compris via les alias", () => {
    expect(detectBankKey({ aspspName: "BNP Paribas" })).toBe("bnp");
    expect(detectBankKey({ label: "Hello bank!" })).toBe("bnp");
    expect(detectBankKey({ aspspName: "Fortuneo" })).toBe("fortuneo");
    expect(detectBankKey({ aspspName: "Boursorama Banque" })).toBe("bourso");
    expect(detectBankKey({ probe: "Banque Test" })).toBeNull();
    expect(detectBankKey({ provider: PROVIDERS.BNP_SIDECAR })).toBe("bnp");
  });

  it("filtre les connexions Enable Banking remplacées", () => {
    const bnpEb = createEb("BNP Paribas", "BNP Paribas");
    const fortuneoEb = createEb("Fortuneo", "Fortuneo");
    const otherEb = createEb("Banque Test", "Banque Test");
    const bnpSidecar = createSidecar(PROVIDERS.BNP_SIDECAR, "BNP Paribas");
    const fortuneoSidecar = createSidecar(
      PROVIDERS.FORTUNEO_SIDECAR,
      "Fortuneo",
    );
    const boursoSidecar = createSidecar(
      PROVIDERS.BOURSO_SIDECAR,
      "BoursoBank",
    );

    const connections = repository.listConnectors(USER);
    const syncable = filterSyncableConnections(connections);
    expect(syncable.map((entry: any) => entry.id).sort()).toEqual(
      [otherEb.id, bnpSidecar.id, fortuneoSidecar.id, boursoSidecar.id].sort(),
    );
    expect(
      isConnectionReplacedBySidecar(bnpEb, connections),
    ).toBe(true);
    expect(
      isConnectionReplacedBySidecar(fortuneoEb, connections),
    ).toBe(true);
    expect(
      isConnectionReplacedBySidecar(otherEb, connections),
    ).toBe(false);
  });

  it("marque et archive les comptes Enable Banking de la même banque", () => {
    const eb = createEb("BNP Paribas", "BNP Paribas");
    const account = repository.upsertSyncedAccount(USER, {
      provider: PROVIDERS.ENABLE_BANKING,
      externalId: "eb-bnp-1",
      connectionId: eb.id,
      name: "Compte BNP EB",
      type: "CHECKING",
      currency: "EUR",
      balance: 100,
    });
    const sidecar = createSidecar(PROVIDERS.BNP_SIDECAR, "BNP Paribas");

    const result = markSidecarPriority({
      repository,
      userId: USER,
      bankKey: "bnp",
      sidecarConnectionId: sidecar.id,
    });

    expect(result).toEqual({ linked: [eb.id], archivedAccounts: 1 });
    expect(
      repository.getConnector(eb.id, USER).metadata.sidecarLinked,
    ).toBe(true);
    expect(repository.getAccount(account.id, USER).isArchived).toBe(true);
  });

  it("syncAll signale les sidecars BNP/Fortuneo sans exécuter Enable Banking", async () => {
    createEb("BNP Paribas", "BNP Paribas");
    createEb("Fortuneo", "Fortuneo");
    createSidecar(PROVIDERS.BNP_SIDECAR, "BNP Paribas");
    createSidecar(PROVIDERS.FORTUNEO_SIDECAR, "Fortuneo");

    const connector = {
      getSession: vi.fn(async () => {
        throw new Error("Enable Banking ne doit pas être appelé");
      }),
      deleteSession: vi.fn(async () => undefined),
      startAuth: vi.fn(),
    };
    const service = new SyncService({ repository, connector });
    const results = await service.syncAll(USER, { force: true });

    expect(connector.getSession).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.status === "CREDENTIALS_REQUIRED")).toBe(
      true,
    );
    expect(results.every((entry) => entry.code === "SIDECAR_CREDENTIALS_REQUIRED")).toBe(
      true,
    );
  });

  it("refuse la synchronisation Enable Banking d'une banque remplacée", async () => {
    const eb = createEb("BNP Paribas", "BNP Paribas");
    createSidecar(PROVIDERS.BNP_SIDECAR, "BNP Paribas");
    const connector = {
      getSession: vi.fn(),
      deleteSession: vi.fn(),
      startAuth: vi.fn(),
    };
    const service = new SyncService({ repository, connector });

    await expect(service.syncConnection(eb.id, USER)).rejects.toMatchObject({
      status: 409,
      code: "SIDECAR_PRIORITY",
    });
    expect(connector.getSession).not.toHaveBeenCalled();
  });

  it("refuse de démarrer une connexion Enable Banking pour une banque à sidecar", async () => {
    const connector = {
      startAuth: vi.fn(async () => ({
        institution: {
          name: "BNP Paribas",
          country: "FR",
          psuType: "personal",
        },
        authorizationId: "auth-1",
        url: "http://localhost/authorize",
      })),
      getSession: vi.fn(),
      deleteSession: vi.fn(),
    };
    const service = new SyncService({ repository, connector });

    await expect(
      service.beginConnection({
        userId: USER,
        institutionId: "BNP Paribas::FR::personal",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "SIDECAR_PRIORITY",
    });
    expect(repository.listConnectors(USER)).toHaveLength(0);
  });

  it("réactive Enable Banking lorsque le sidecar est retiré", async () => {
    const eb = createEb("BNP Paribas", "BNP Paribas");
    const sidecar = createSidecar(PROVIDERS.BNP_SIDECAR, "BNP Paribas (Sidecar)");
    markSidecarPriority({
      repository,
      userId: USER,
      bankKey: "bnp",
      sidecarConnectionId: sidecar.id,
    });
    const connector = {
      getSession: vi.fn(),
      deleteSession: vi.fn(),
      startAuth: vi.fn(),
    };
    const service = new SyncService({ repository, connector });

    await service.disconnect(sidecar.id, USER, { archiveAccounts: false });

    const updated = repository.getConnector(eb.id, USER);
    expect(updated.metadata.sidecarLinked).toBeUndefined();
    expect(updated.metadata.sidecarProvider).toBeUndefined();
    expect(repository.getConnector(sidecar.id, USER)).toBeNull();
  });
});
