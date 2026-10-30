import "./shims";
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import {
  setUserPassword,
  verifyUserPassword,
  changeUserPassword,
  hasUserPassword,
  hashPassword,
  generateSalt,
  compareTimingSafe,
} from "../server/services/authService.js";
import { apiJson, postJson } from "./helpers";

describe("authService — sécurité des mots de passe", () => {
  it("génère des sels uniques et des hashs scrypt reproductibles avec le même sel", () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    expect(salt1).not.toBe(salt2);

    const hashA = hashPassword("secret123", salt1);
    const hashB = hashPassword("secret123", salt1);
    const hashC = hashPassword("secret123", salt2);

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
    expect(compareTimingSafe(hashA, hashB)).toBe(true);
    expect(compareTimingSafe(hashA, hashC)).toBe(false);
  });

  it("gère le cycle de vie complet en base SQLite (setup, verify, change-password)", () => {
    const db = new Database(":memory:");
    initializePortfolioSchema(db);

    const user = "RomainTest";
    expect(hasUserPassword(db, user)).toBe(false);

    // Tentative de vérification sur utilisateur sans mot de passe -> faux (timing equalized)
    expect(verifyUserPassword(db, user, "anypassword")).toBe(false);

    // Rejet des mots de passe trop courts
    expect(() => setUserPassword(db, user, "123")).toThrow();

    // Définition du mot de passe initial
    const setupResult = setUserPassword(db, user, "monSuperMotDePasse123!");
    expect(setupResult.success).toBe(true);
    expect(hasUserPassword(db, user)).toBe(true);

    // Interdiction d'écraser via setup (doit utiliser changeUserPassword)
    expect(() => setUserPassword(db, user, "nouveauMdp")).toThrow();

    // Vérification réussie et échouée
    expect(verifyUserPassword(db, user, "monSuperMotDePasse123!")).toBe(true);
    expect(verifyUserPassword(db, user, "mauvaisMdp")).toBe(false);

    // Changement de mot de passe avec mauvais mot de passe actuel -> échec
    expect(() =>
      changeUserPassword(db, user, "mauvaisActuel", "nouveauSecret456!"),
    ).toThrow(/incorrect/i);

    // Changement de mot de passe réussi
    const changeResult = changeUserPassword(
      db,
      user,
      "monSuperMotDePasse123!",
      "nouveauSecret456!",
    );
    expect(changeResult.success).toBe(true);

    // L'ancien ne marche plus, le nouveau marche
    expect(verifyUserPassword(db, user, "monSuperMotDePasse123!")).toBe(false);
    expect(verifyUserPassword(db, user, "nouveauSecret456!")).toBe(true);
  });
});

describe("API HTTP /api/portfolio/auth", () => {
  const testUser = `AuthUser_${Date.now()}`;

  it("gère /auth/status, /auth/setup, /auth/verify et /auth/change-password", async () => {
    // 1. Status avant setup
    const statusBefore = await apiJson<{ username: string; hasPassword: boolean }>(
      `/portfolio/auth/status?username=${testUser}`,
    );
    expect(statusBefore.status).toBe(200);
    expect(statusBefore.body.hasPassword).toBe(false);

    // 2. Setup mot de passe
    const setupRes = await postJson("/portfolio/auth/setup", {
      username: testUser,
      password: "InitialPassword123!",
    });
    expect(setupRes.status).toBe(201);

    // 3. Status après setup
    const statusAfter = await apiJson<{ username: string; hasPassword: boolean }>(
      `/portfolio/auth/status?username=${testUser}`,
    );
    expect(statusAfter.status).toBe(200);
    expect(statusAfter.body.hasPassword).toBe(true);

    // 4. Verify avec mot de passe incorrect (401)
    const verifyWrong = await postJson("/portfolio/auth/verify", {
      username: testUser,
      password: "WrongPassword",
    });
    expect(verifyWrong.status).toBe(401);

    // 5. Verify avec bon mot de passe (200)
    const verifyOk = await postJson("/portfolio/auth/verify", {
      username: testUser,
      password: "InitialPassword123!",
    });
    expect(verifyOk.status).toBe(200);

    // 6. Change-password avec mauvais mot de passe actuel (401)
    const changeWrong = await postJson("/portfolio/auth/change-password", {
      username: testUser,
      currentPassword: "FauxPassword",
      newPassword: "BrandNewPassword789!",
    });
    expect(changeWrong.status).toBe(401);

    // 7. Change-password réussi (200)
    const changeOk = await postJson("/portfolio/auth/change-password", {
      username: testUser,
      currentPassword: "InitialPassword123!",
      newPassword: "BrandNewPassword789!",
    });
    expect(changeOk.status).toBe(200);

    // 8. Nouveau mot de passe vérifié
    const verifyNew = await postJson("/portfolio/auth/verify", {
      username: testUser,
      password: "BrandNewPassword789!",
    });
    expect(verifyNew.status).toBe(200);
  });

  it("garantit un cloisonnement strict : le mot de passe d'un utilisateur ne déverrouille jamais un autre utilisateur", async () => {
    const userA = `UserA_${Date.now()}`;
    const userB = `UserB_${Date.now()}`;

    // Créer userA avec mot de passe A
    await postJson("/portfolio/auth/setup", {
      username: userA,
      password: "PasswordUserA123!",
    });

    // Créer userB avec mot de passe B
    await postJson("/portfolio/auth/setup", {
      username: userB,
      password: "PasswordUserB456!",
    });

    // Tenter de déverrouiller userB avec le mot de passe de userA -> doit être rejeté (401)
    const crossVerify = await postJson("/portfolio/auth/verify", {
      username: userB,
      password: "PasswordUserA123!",
    });
    expect(crossVerify.status).toBe(401);

    // Déverrouiller userB avec le bon mot de passe -> 200
    const correctVerify = await postJson("/portfolio/auth/verify", {
      username: userB,
      password: "PasswordUserB456!",
    });
    expect(correctVerify.status).toBe(200);
    const body = await correctVerify.json();
    expect(body.success).toBe(true);
    expect(body.username).toBe(userB);
  });
});
