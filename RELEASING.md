# Releasing tenkai-console

Family versioning, tagging, and release policy:
[tenkai ADR 0040](https://github.com/Sannrox/tenkai/blob/main/docs/decisions/0040-family-versioning-and-release-policy.md).

This page is tenkai-console-local: how a maintainer prepares and tags **this**
repository. The zip is what Tenkai pins in `ui/console.pin` and serves at `/ui/`.

## Who cuts a tag

Agents never push `v*` tags. After the version-bump pull request merges, the
maintainer creates an annotated, signed `vX.Y.Z` tag with the registered
release-signing key. The tag must equal `v` plus the `package.json` version.
The workflow refuses unsigned or lightweight tags.

## Prepare

1. Choose the target version. Do not invent one in a feature pull request.
   Write it to `package.json`.
2. Draft the next CHANGELOG section from merged work with
   `scripts/changelog-draft.sh`. Pull requests never edit `CHANGELOG.md`; the
   release step publishes that section as the GitHub Release body.
3. Land the version-bump pull request.

## Tag

Create an annotated, signed tag on the merged release commit:

```text
vX.Y.Z
```

Pre-releases are `vX.Y.Z-rc.N` or `vX.Y.Z-beta.N`. Hotfixes are tagged on
`release/vX.Y`, never on `main` ahead of a minor. A tag is never moved,
deleted, or reused.

## After the tag

The `v*` workflow verifies the tag, builds, tests, writes an SBOM, attests
provenance, drafts then publishes a GitHub Release from the matching
CHANGELOG section, and attaches a family release manifest (component,
version, git SHA, zip digest, attestation URLs, gate flags). tenkai-console
does not publish a container image, so there is no `latest` tag.

Pull requests and `workflow_dispatch` dry-run the same packaging path and
never mint attestations or a GitHub Release.

Allowed tag-signing keys live in `security/release-tag-fingerprints` with the
public key in `security/release-tag-key.asc`.
