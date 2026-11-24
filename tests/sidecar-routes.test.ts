import "./shims";
import { describe, expect, it } from "vitest";
import { apiJson, apiWithoutSession, postJson } from "./helpers";

describe("Sidecar BNP/Fortuneo routes", () => {
  it("protège les statuts sidecar par une session", async () => {
    const bnp = await apiWithoutSession("/portfolio/sidecar/bnp/status");
    expect(bnp.status).toBe(401);
    const fortuneo = await apiWithoutSession(
      "/portfolio/sidecar/fortuneo/status",
    );
    expect(fortuneo.status).toBe(401);
  });

  it("expose un statut BNP sans identifiant ni code secret", async () => {
    const { status, body } = await apiJson<Record<string, unknown>>(
      "/portfolio/sidecar/bnp/status",
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      passwordRequired: true,
      mfa: "file-broker",
    });
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("customerId");
    expect(JSON.stringify(body)).not.toContain("bnpPassword");
  });

  it("expose un statut Fortuneo sans mot de passe", async () => {
    const { status, body } = await apiJson<Record<string, unknown>>(
      "/portfolio/sidecar/fortuneo/status",
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      passwordRequired: true,
      otpSupported: true,
      otp: "file-broker",
    });
    expect(body).not.toHaveProperty("password");
    expect(JSON.stringify(body)).not.toContain("fortuneoPassword");
  });

  it("refuse une synchronisation BNP sans numéro client", async () => {
    const res = await postJson("/portfolio/sidecar/bnp/connect", {
      user_id: `BnpRoute_${Date.now()}`,
      password: "123456",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("CUSTOMER_ID_REQUIRED");
  });

  it("refuse un code secret BNP invalide avant de lancer un job", async () => {
    const res = await postJson("/portfolio/sidecar/bnp/connect", {
      user_id: `BnpRoute_${Date.now()}`,
      customerId: "12345678",
      password: "abc",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("INVALID_PASSWORD");
  });

  it("refuse une synchronisation Fortuneo sans mot de passe", async () => {
    const res = await postJson("/portfolio/sidecar/fortuneo/sync", {
      user_id: `FortuneoRoute_${Date.now()}`,
      login: "identifiant",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("PASSWORD_REQUIRED");
  });

  it("renvoie 404 pour un job BNP inconnu", async () => {
    const { status, body } = await apiJson<{ code?: string }>(
      "/portfolio/sidecar/bnp/jobs/job-inconnu",
    );
    expect(status).toBe(404);
    expect(body.code).toBe("JOB_NOT_FOUND");
  });

  it("renvoie 404 pour un job Fortuneo inconnu", async () => {
    const { status, body } = await apiJson<{ code?: string }>(
      "/portfolio/sidecar/fortuneo/jobs/job-inconnu",
    );
    expect(status).toBe(404);
    expect(body.code).toBe("JOB_NOT_FOUND");
  });
});
