import { describe, expect, it } from "vitest";
import { isReleaseSpec, parsePublish, promoteBody } from "./catalog";

const manifest = '[product]\nname = "hello"\nversion = "0.3.0"\n\n[deploy]\ninstall = "true"\n';
const signature = JSON.stringify({
  schema: "tenkai.release-signature.v1",
  key_id: "sha256:17",
  statement: {
    manifest_digest: "053c",
    artifact_digest: "af55",
    provenance: {
      source_uri: "https://example.test/src",
      revision: "dogfood",
      builder: "tenkaictl-dev-sign-release",
      built_at_unix_ms: 1,
      materials: {},
    },
  },
  signature: "3XwY",
});
const roots =
  'version = 1\n\n[[signers]]\nkey_id = "sha256:17"\nidentity = "release@example.test"\npublic_key = "hfc3"\n';

describe("catalog requests", () => {
  it("sends the manifest bytes as pasted and names the release", () => {
    const publish = parsePublish(manifest, signature, roots);
    expect(publish).toMatchObject({
      release: "hello@0.3.0",
      body: {
        version: 1,
        operation: "publish",
        manifest,
        signature: { key_id: "sha256:17" },
        trust_roots: { signers: [{ identity: "release@example.test" }] },
      },
    });
    expect(publish).not.toHaveProperty("body.allow_unsigned_development");
  });

  it("refuses malformed evidence before sending", () => {
    expect(parsePublish("[product", signature, roots)).toMatch(/^The manifest must be/);
    expect(parsePublish('[product]\nname = "hello"\n', signature, roots)).toMatch(/^Manifest:/);
    expect(parsePublish(manifest, "{", roots)).toMatch(/^The signature must be/);
    expect(parsePublish(manifest, JSON.stringify({ schema: "x" }), roots)).toMatch(/^Signature:/);
    expect(parsePublish(manifest, signature, "version = 1\n")).toMatch(/^Trust roots:/);
  });

  it("uses tenkaictl's release spec", () => {
    expect(promoteBody("hello@0.3.0")).toStrictEqual({
      version: 1,
      operation: "promote",
      spec: "hello@0.3.0",
    });
    expect(isReleaseSpec("hello@0.3.0")).toBe(true);
    expect(isReleaseSpec("hello")).toBe(false);
    expect(isReleaseSpec("hello@")).toBe(false);
  });
});
