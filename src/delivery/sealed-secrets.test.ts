import { describe, expect, it, vi } from "vitest";
import type { SealedSecretList } from "../api/tenkai.gen";
import { fetchSealedSecrets, secretRows } from "./sealed-secrets";

const LIST: SealedSecretList = {
  environment: "prod",
  secrets: [
    {
      secret: "db",
      key: "password",
      instance: "api",
      age_ms: 3 * 86_400_000,
      rotate_after: "90d",
      set_at: 1,
      set_by: "alice",
      digest: "sha256:aa",
      recipients: ["sha256:bb"],
      sealed: { ciphertext: "CIPHERTEXT", format_version: 1, wraps: [] },
    },
    {
      secret: "api",
      key: "token",
      instance: "web",
      age_ms: 100 * 86_400_000,
      rotate_after: "90d",
      overdue: true,
      set_at: 1,
      set_by: "bob",
      digest: "sha256:cc",
      recipients: [],
    },
    {
      secret: "smtp",
      key: "pass",
      instance: "api",
      set_at: 1,
      set_by: "ci",
      digest: "d",
      recipients: [],
    },
  ],
};

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("fetchSealedSecrets", () => {
  it("keeps names and ages and drops ciphertext, digest, and recipients", async () => {
    const load = await fetchSealedSecrets("prod", "t", answering(200, LIST));
    expect(load.kind).toBe("ok");
    expect(JSON.stringify(load)).not.toMatch(/CIPHERTEXT|sha256|recipients|digest/);
  });

  it("reads a missing route as unavailable and 403 as forbidden", async () => {
    expect(await fetchSealedSecrets("prod", "t", answering(404, { error: "x" }))).toEqual({
      kind: "unavailable",
    });
    expect(await fetchSealedSecrets("prod", "t", answering(403, { error: "x" }))).toEqual({
      kind: "forbidden",
    });
  });
});

describe("secretRows", () => {
  it("puts overdue first and names each state", async () => {
    const load = await fetchSealedSecrets("prod", "t", answering(200, LIST));
    const rows = load.kind === "ok" ? secretRows(load.value) : [];
    expect(
      rows.map((row) => [row.name, row.instance, row.age, row.rotateAfter, row.state]),
    ).toEqual([
      ["api/token", "web", "100d", "90d", "overdue"],
      ["db/password", "api", "3d", "90d", "within age"],
      ["smtp/pass", "api", "n/a", "none", "no rotation"],
    ]);
  });
});
