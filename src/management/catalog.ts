import { type } from "arktype";
import { parse as parseToml } from "smol-toml";
import type { PromoteRequest, PublishRequest, RecallRequest } from "../api/tenkai.gen";
import { TrustRoots, parseRoots } from "../plan/requests";

/**
 * Software catalog request bodies (tenkai.management-lifecycle.v1): publish,
 * promote, and recall. The browser never signs: the release signature and
 * trust roots come from the publisher's signing step (`tenkaictl dev
 * sign-release` in development) and are only checked for shape here; the
 * server verifies digests, signatures, and trust.
 */

const Manifest = type({ product: { name: "string", version: "string" } });

const Signature = type({
  schema: "string",
  key_id: "string",
  signature: "string",
  statement: {
    manifest_digest: "string",
    artifact_digest: "string",
    provenance: {
      source_uri: "string",
      revision: "string",
      builder: "string",
      built_at_unix_ms: "number",
      "materials?": "Record<string, string>",
    },
  },
});

/** A release spec as `tenkaictl` writes it: `product@version`. */
export const isReleaseSpec = (spec: string): boolean => /^[^@\s]+@[^@\s]+$/.test(spec);

/** Parse pasted publish evidence; the release spec names what the confirmation shows. */
export const parsePublish = (
  manifestText: string,
  signatureText: string,
  trustRootsText: string,
): { release: string; body: PublishRequest } | string => {
  let manifest: unknown;
  let signature: unknown;
  let roots: unknown;
  try {
    manifest = parseToml(manifestText);
  } catch {
    return "The manifest must be the release's tenkai.toml.";
  }
  try {
    signature = JSON.parse(signatureText);
  } catch {
    return "The signature must be the release signature JSON.";
  }
  try {
    roots = parseRoots(trustRootsText);
  } catch {
    return "Trust roots must be the release trust-roots TOML (or JSON).";
  }
  const product = Manifest(manifest);
  if (product instanceof type.errors) {
    return `Manifest: ${product.summary}`;
  }
  const envelope = Signature(signature);
  if (envelope instanceof type.errors) {
    return `Signature: ${envelope.summary}`;
  }
  const trust = TrustRoots(roots);
  if (trust instanceof type.errors) {
    return `Trust roots: ${trust.summary}`;
  }
  return {
    release: `${product.product.name}@${product.product.version}`,
    body: {
      version: 1,
      operation: "publish",
      // Sent as pasted: the signature covers these exact bytes' digest.
      manifest: manifestText,
      signature: envelope,
      trust_roots: trust,
    },
  };
};

export const promoteBody = (release: string): PromoteRequest => ({
  version: 1,
  operation: "promote",
  spec: release,
});

export const recallBody: RecallRequest = { version: 1, operation: "recall" };
