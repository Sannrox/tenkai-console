import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { canariesPath, chosenBy, designateBody, designateOutcome, fetchCanaries } from "./canaries";

const answering =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("fetchCanaries", () => {
  it("reads the list sorted by environment and keeps selector provenance", async () => {
    const load = await fetchCanaries(
      "t",
      answering(200, [
        {
          environment: "stage",
          selector: { selector: "tier=edge", environments: ["stage"] },
          set_by: "alice",
          set_at: 1,
        },
        { environment: "prod" },
      ]),
    );
    expect(load).toEqual({
      kind: "ok",
      value: [
        { environment: "prod" },
        {
          environment: "stage",
          selector: { selector: "tier=edge", environments: ["stage"] },
          set_by: "alice",
          set_at: 1,
        },
      ],
    });
    expect(canariesPath).toBe("v1/canaries");
  });

  it("never surfaces raw server text", async () => {
    expect(await fetchCanaries("t", answering(404, { error: "no such route" }))).toEqual({
      kind: "unavailable",
    });
    expect(await fetchCanaries("t", answering(403, { error: "secret" }))).toEqual({
      kind: "forbidden",
    });
    expect(await fetchCanaries("t", answering(200, { environment: "prod" }))).toEqual({
      kind: "error",
      message: "Could not load",
    });
  });
});

describe("chosenBy", () => {
  it("names the selector and the set it resolved to, or name", () => {
    expect(chosenBy({ environment: "prod" })).toBe("name");
    expect(
      chosenBy({
        environment: "stage",
        selector: { selector: "tier=edge", environments: ["stage", "lab"] },
      }),
    ).toBe("tier=edge, matched stage, lab");
  });
});

describe("designateBody", () => {
  it("sends the selector and never a name list", () => {
    expect(designateBody("tier=edge", true)).toEqual({
      designated: true,
      selector: "tier=edge",
    });
    expect(designateBody("tier=edge", false)).toEqual({
      designated: false,
      selector: "tier=edge",
    });
  });
});

describe("designateOutcome", () => {
  it("reads a lost or 5xx answer as unknown and hides refusal text", () => {
    expect(designateOutcome(true, undefined)).toEqual({
      tone: "ok",
      text: "Designated and audited.",
    });
    expect(designateOutcome(false, undefined).text).toBe("Undesignated and audited.");
    expect(designateOutcome(true, new TypeError("network")).tone).toBe("unknown");
    expect(designateOutcome(true, new ApiError(502, "HTTP 502")).tone).toBe("unknown");
    expect(designateOutcome(true, new ApiError(403, "secret"))).toEqual({
      tone: "bad",
      text: "Not permitted.",
    });
    expect(designateOutcome(true, new ApiError(405, "method"))).toEqual({
      tone: "bad",
      text: "This server cannot designate canaries.",
    });
    expect(
      designateOutcome(
        true,
        new ApiError(400, "bad selector", { reason: { code: "invalid_selector" } }),
      ),
    ).toEqual({ tone: "bad", text: "The server refused the selector." });
    expect(
      designateOutcome(true, new ApiError(409, "selector tier=none matches no environment")),
    ).toEqual({ tone: "bad", text: "The selector matches none. Nothing was changed." });
    expect(designateOutcome(true, new ApiError(409, "lease held")).text).toBe("Designate refused.");
    expect(designateOutcome(false, new ApiError(409, "lease held")).text).toBe(
      "Undesignate refused.",
    );
  });
});
