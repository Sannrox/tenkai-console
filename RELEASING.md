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

Create an annotated, signed tag on the merged release commit on `main`:

```text
vX.Y.Z
```

A tag is never moved, deleted, or reused. The tagged commit must be on
`main`; the workflow refuses any other commit, so there are no hotfix tags on
release branches.

## Release candidates

Cut `vX.Y.Z-rc.N` (or `vX.Y.Z-beta.N`) before the final tag:

1. Land a version-bump pull request that sets the `package.json` version to
   `X.Y.Z-rc.N` and adds a `## [X.Y.Z-rc.N]` section to `CHANGELOG.md`. The
   final `vX.Y.Z` needs its own section; it never reuses the rc notes.
2. Tag `vX.Y.Z-rc.N` on that commit.
3. The release publishes as a GitHub pre-release and is never marked latest.

A failed release candidate costs only an rc number. A final tag on a commit
whose `package.json` version is still `X.Y.Z-rc.N` is refused.

## Start, retry, and dry-run

A `v*` tag push runs `.github/workflows/release-dispatch.yml`. It only runs
`gh workflow run release.yml --ref main -f tag=<tag>`, so the release always
runs **main's** `release.yml`, never the copy at the tagged commit.

`release.yml` refuses a tagged run that does not start from `main`. It then:

- checks out the tag and fetches the annotated tag object
- verifies the signed tag with main's `scripts/verify-release-tag.sh` and
  main's allowed keys against the tagged commit's `package.json`
- requires the tagged commit to be on `main`
- runs the CI gate, builds, packages, and writes the manifest `git_sha` from
  that commit
- writes an SBOM and attests provenance
- drafts the GitHub Release from the matching CHANGELOG section with
  `gh release create <tag> --verify-tag`, attaches the zip, `SHA256SUMS`,
  SBOM, and family release manifest (component, version, git SHA, zip digest,
  attestation URLs, gate flags), then publishes it

tenkai-console does not publish a container image, so there is no `latest`
tag.

To retry a failed release, fix the workflow on `main` and run it again for the
same tag:

```sh
gh workflow run release.yml --ref main -f tag=vX.Y.Z
```

A retry picks up fixes to `release.yml` and to the tag verifier and keys.
Everything else (the release and packaging scripts, `CHANGELOG.md`, and the
sources) comes from the tagged commit, so a bug there needs a new rc or patch
version.

A re-run resumes the draft release and replaces its assets. Every job that
attests, uploads, or publishes refuses a release that is already published, so
neither a new run nor "Re-run failed jobs" on an old one can change it; cut a
new version instead. One run per tag executes at a time.

Pull requests and `workflow_dispatch` without a tag dry-run the same packaging
path on that ref and never mint attestations or touch a GitHub Release.

## Provenance

Attestations record the workflow that built the artifacts, which is main's
`release.yml` at `refs/heads/main`, not the tag. The source is pinned by the
signed tag and by the manifest `git_sha`, which is the tagged commit.

Allowed tag-signing keys live in `security/release-tag-fingerprints` with the
public key in `security/release-tag-key.asc`. A tagged run uses the copies on
`main`.
