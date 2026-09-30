---
name: assess-change-impact
description: Assess a proposed or implemented tenkai-console change across API-contract, trust, packaging, embedding, and UI boundaries. Use when scoping an Issue, planning tests, reviewing a diff, or identifying compatibility, documentation, and security obligations.
---

# Assess Change Impact

Build an evidence-backed impact map before implementation or review.

## Procedure

1. Read the linked Issue or request, `README.md`, Tenkai ADR 0031 (web
   console), and the relevant code. For a diff, inspect every changed file and
   its direct callers. Complete when the claimed outcome and actual change
   surface are both known.
2. Trace applicable boundaries:
   - the console is a client of Tenkai's versioned public API only: no private
     endpoints, and nothing the console does that `tenkaictl` cannot do with
     the same contract and audit record;
   - server responses validated at runtime with ArkType versus types trusted
     without validation;
   - relative URLs and API discovery two levels above the entry module, so one
     bundle works at `/ui/` and `/<prefix>/ui/`;
   - same-origin, air-gapped operation: no requests, fonts, or assets from
     other origins;
   - authentication, authorization, and approval flows owned by Tenkai, never
     re-implemented or bypassed in the browser;
   - the release contract Tenkai pins: `tenkai-console-vX.Y.Z.zip`,
     `SHA256SUMS`, and the artifact attestation.
     Complete when each applicable boundary has an owner and expected invariant.
3. Identify compatibility obligations: older and newer `tenkai-server` API
   versions, error semantics, and the pinned release a Tenkai build embeds.
   Complete when partial-failure and version-skew paths are accounted for.
4. Map evidence to risk: unit tests for pure logic and schemas; component tests
   for UI behavior; a built bundle served under a prefix for path handling;
   `pnpm package` for release artifacts. Complete when every material risk has
   a proposed check or an explicit residual uncertainty.
5. Determine durable artifacts that must change: README, a Tenkai ADR, or a
   repository Skill. Complete when no artifact is proposed merely to record
   temporary planning.

## Output

Return a compact matrix with columns:

| Surface | Evidence found | Required change/check | Risk if missed |
| ------- | -------------- | --------------------- | -------------- |

Then list scope boundaries, blocking questions, and the smallest safe PR split.
Do not approve an architecture, perform a full security audit, or claim API
parity without inspecting the Tenkai implementation.
