---
name: prepare-release
description: Prepare a tenkai-console release by auditing version scope, compatibility, migrations, validation, artifacts, and release notes. Use when a maintainer asks for release readiness, a version bump plan, or a draft GitHub Release.
---

# Prepare Release

Assemble decision-ready release evidence. Do not tag, push, publish, or alter
GitHub state unless the maintainer explicitly authorizes that action.

## Procedure

1. Identify the target version, base tag, target commit, and milestone or merged
   PR range. Read `package.json`, `.github/workflows/release.yml`, and open release-blocking
   Issues. Complete when the exact release contents are bounded.
2. Classify changes as `Added`, `Changed`, `Fixed`, `Security`, or `Migration`.
   Check SemVer fit; before `1.0`, call out all public breaking changes even when
   they fit a minor bump. Complete when every user-visible merged change is
   represented once.
3. Audit release impact:
   - `pnpm-lock.yaml` consistency and dependency changes;
   - the minimum Tenkai public API version the bundle needs;
   - relative-URL behavior at `/ui/` and `/<prefix>/ui/`, and no requests
     outside the origin;
   - authentication, approval, and security-relevant UI behavior;
   - the pin Tenkai must update (URL and SHA-256 behind the `ui` feature).
     Complete when every applicable item is resolved or a named blocker.
4. Use `verify-change` for the full local gates. Confirm current GitHub CI and
   security checks when access is available. Do not run live-provider tests
   without intentional prerequisites. Complete when evidence is current for the
   target commit.
5. Draft concise user-facing release notes. Put upgrade and migration actions
   before internal implementation detail. Credit contributors through GitHub's
   generated notes rather than maintaining a manual ledger.
6. After an authorized tag `vX.Y.Z`, confirm the Release workflow attached
   `tenkai-console-vX.Y.Z.zip` and `SHA256SUMS`, and verify them as the README
   describes (`sha256sum -c SHA256SUMS`, `gh attestation verify`). Do not
   rewrite existing Release notes when only uploading assets.
7. Report go/no-go. A release is `go` only when required checks pass, no known
   blocker remains, the Tenkai pin update is explicit, and the tagged GitHub
   Release has a verified zip and checksum (or a named blocker).

## Output

Return the target, commit range, readiness checklist, validation results,
compatibility/migration notes, release-note draft, and blockers. Separate
verified facts from recommendations.
