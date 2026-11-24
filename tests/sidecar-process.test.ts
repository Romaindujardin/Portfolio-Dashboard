import { describe, expect, it } from "vitest";
import { runSidecarProcess } from "../server/services/sidecarProcess.js";

const runNode = (script: string, options = {}) =>
  runSidecarProcess({
    command: process.execPath,
    args: ["-e", script],
    env: { PATH: process.env.PATH },
    timeoutMs: 10_000,
    ...options,
  });

describe("runSidecarProcess", () => {
  it("ne redacte pas le JSON d'export sur stdout", async () => {
    const result = await runNode(
      `process.stdout.write(JSON.stringify({ amount: 123456.78, iban: "FR7612345678901234567890123" }));`,
      { redact: ["123456", "12345678"] },
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      amount: 123456.78,
      iban: "FR7612345678901234567890123",
    });
  });

  it("redacte toujours les secrets présents sur stderr", async () => {
    const result = await runNode(
      `process.stderr.write("échec pour 123456 et 12345678"); process.exit(2);`,
      { redact: ["123456", "12345678"] },
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toBe("échec pour *** et ***");
    expect(result.stderr).not.toContain("123456");
  });
});
