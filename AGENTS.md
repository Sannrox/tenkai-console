# Repository Guidelines

`tenkai-console` is the web console for the Tenkai delivery control plane. It
is a client of Tenkai's versioned public API only: anything the console does,
`tenkaictl` can do with the same contract and audit record. The design is
Tenkai ADR 0031 (`docs/decisions/0031-web-console.md` in Sannrox/tenkai).
`README.md` covers shipping, sign-in, API types, and development.

## Project Structure & Module Organization

- `src/api/`: HTTP client and `tenkai.gen.ts`, generated from the vendored
  contract `api/tenkai-http-v1.schema.json` (release tag or `main` commit, and SHA-256, pinned in `api/tenkai.pin`).
- `src/auth/`: OIDC sign-in, session renewal, and sign-out.
- `src/screens/`, `src/delivery/`, `src/management/`, `src/plan/`,
  `src/workflows/`, `src/ui/`: screens, management actions, and shared UI.
- `scripts/`: API sync and drift (`api.mjs`), bundle budget, the release zip
  (`package.sh`), changelog draft, workflow lint (`check-workflows.sh`),
  Playwright Chromium install retry (`playwright-install.sh`).
- `scripts/release/`: release entry points the release workflow calls:
  packaging (`package.sh`), signed-tag check (`verify-tag.sh`), CHANGELOG
  notes, SBOM, family manifest, and the only script that changes a GitHub
  Release (`github-release.sh`).
- `tests/release/`: Python `unittest` tests of `scripts/release/` and of the
  release workflow invariants, asserted on the parsed YAML. Vitest unit tests
  live next to the sources in `src/`.
- `perf/`: bundle baseline and browser load measurement.

## Dependencies and Ownership

- Tenkai owns the API, authentication, authorization, approval, and audit. The
  console never re-implements or bypasses them in the browser and uses no
  private endpoints.
- Work that needs a new or changed Tenkai API starts as a Sannrox/tenkai Issue;
  the console consumes it after it lands. Record such predecessors as
  `Sannrox/tenkai#<n>` under the Issue's `## Dependencies`.
- Design decisions are Tenkai ADRs in Tenkai's `docs/decisions/`; this
  repository keeps no decision log of its own.
- Tenkai pins one console release by URL and SHA-256 (`ui/console.pin` in
  Sannrox/tenkai) and serves it behind its `ui` feature.

## Build, Test, and Development Commands

CI (`.github/workflows/ci.yml`) runs, in order:

```sh
pnpm install --frozen-lockfile
pnpm api:check
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm perf:bundle
sh scripts/playwright-install.sh self-test
sh scripts/playwright-install.sh
pnpm perf:load
pnpm e2e
VERSION=ci sh scripts/package.sh
bash scripts/validate-workflow-skills.sh
bash scripts/check-workflows.sh
python3 -m pip install --require-hashes -r tests/requirements.txt
python3 -m unittest discover -s tests -t .
```

`scripts/check-workflows.sh` lints `.github/workflows/` with a pinned workflow
linter and a pinned workflow security auditor, each verified by SHA-256; the
`Lint workflows` job runs the same script.

`TENKAI_URL=http://127.0.0.1:8080 pnpm dev` proxies `/v1` and `/healthz` to a
local `tenkai-server`. `pnpm api:sync <vX.Y.Z>` updates the vendored
contract from that Tenkai release and regenerates the types.

## Testing Guidelines

Run focused tests first (`pnpm vitest run <path>`), then the CI gates above
before handoff. Release scripts and workflows are tested with Python
`unittest` in `tests/release/`, one file per script plus `test_workflows.py`;
run one with `python3 -m unittest tests.release.test_<name>`. Assert workflow
structure on the parsed YAML (triggers, permissions, job graph, step order,
which script a step runs), never step names or wording, and never grep
workflow text. Tests use per-process temp paths and a fake `gh` on `PATH`.
Keep checks that need a running `tenkai-server` out of the default suite.
Never print tokens or persist live server payloads. Pure prose changes need
source read-back and `pnpm format:check`, not the full gates.

## Commit & Pull Request Guidelines

Short imperative Conventional Commit subjects. `CHANGELOG.md` is
release-owned: pull requests do not edit it; release notes go in the Pull
Request body, which becomes the squash commit. Pull Requests call out Tenkai
API compatibility, packaging, and security impact. Never put hostnames, FQDNs,
home directories, absolute worktree paths, LAN or employer network names, or
other private environment inventory on public Issues, Pull Requests, comments,
or commit messages. Published postplan mock and gallery links are the one
allowed exception (see UI proof).

### Verified commits on GitHub

Lane branches are published with GitHub-verified commits and landed by the
shared lane script, from the lane worktree:

```sh
bash "${AGENT_KIT_HOME:-$HOME/.agents/agent-kit}/skills/deliver-ready-issue/scripts/issue-lane.sh" push <issue>
bash "${AGENT_KIT_HOME:-$HOME/.agents/agent-kit}/skills/deliver-ready-issue/scripts/issue-lane.sh" land <issue> --pr <pr>
```

`push` publishes the local `HEAD` tree to the claim branch as a Verified commit
and resets the worktree to it. `land` squash-merges that reviewed head once the
checks pass and confirms the merge and the closed Issue. Never pass
`--no-gpg-sign`; if signing fails, stop and fix it. Avoid rebase merges: they
drop signatures.

## Parallel delivery lanes

A delivery lane is one Issue, one claim branch `<type>/<issue>`, one worktree
`.worktrees/issue-<issue>` (ignored by Git), one Pull Request, and one owner.
One Issue is never split across lanes, and one lane never carries a second
Issue. The primary checkout belongs to the maintainer: agents never switch,
reset, stash, or clean it.

Claims live on GitHub: an open Pull Request referencing the Issue, a branch
`*/<issue>` or `*/<issue>-*`, or an assignment younger than six hours. Claim
before implementing with
`bash "${AGENT_KIT_HOME:-$HOME/.agents/agent-kit}/skills/deliver-ready-issue/scripts/issue-lane.sh" claim <issue>`;
`issue-lane.sh claim` refuses when the three-lane limit is reached
(`issue-lane.sh capacity` prints the count). An older assignment without branch
or Pull Request is a hint: ask the maintainer before claiming.

Collision surfaces: the API client, generated types, and vendored contract
(`src/api/`, `api/`); build and base-URL configuration (`vite.config.ts`);
packaging and the release workflow (`scripts/package.sh`, `scripts/release/`,
`scripts/check-workflows.sh`, `tests/release/`, `tests/requirements.txt`,
`.github/workflows/`);
`package.json` and `pnpm-lock.yaml`. Lanes that would both change one of these
run in sequence. Landing is one lane at a time; after each merge the remaining
lanes recheck `mergeable` against the new `main`.

## Shared agent skills

The workflow Skills (`advance-issue-frontier`, `assess-change-impact`,
`capture-project-decision`, `deliver-ready-issue`, `prepare-release`,
`refactor-docs`, `shape-work-item`, `technical-documentation`, `verify-change`)
are canonical in [Sannrox/agent-kit](https://github.com/Sannrox/agent-kit).
The opt-in `ci-audit` skill reports what each CI job costs and catches and
gates every new job.
The opt-in `ui-e2e` skill proves console UI work with mocks, a states gallery,
browser tests, screenshots, and read-only live journeys.
There is no pin: this repository always uses the latest `main`.
`.agents/skills/<name>/` holds only a generated stub that points to the shared
skill; read the installed skill under `~/.agents/agent-kit/` (or
`$AGENT_KIT_HOME`). Run `bash scripts/validate-workflow-skills.sh` to clone or
update it.

- Repository-specific facts the shared Skills need come from this file. Edit
  this file, not the stubs.
- Never edit the stubs or the vendored `scripts/validate-workflow-skills.sh`
  here; change them upstream in agent-kit, then run
  `bash scripts/validate-workflow-skills.sh --render` here when it reports
  drift.
- Repository-only Skills (`.agents/skills/tenkai/`) live next to the stubs as
  full folders and stay local.

## Agent skill profile

Facts the shared agent-kit skills read that the sections above do not already
state.

Feature: a new observable operator outcome in the console.

### Issue conventions

- Issues use `## Problem`, `## Observable outcome`, `## Non-goals`,
  `## Acceptance evidence`, and `## Dependencies`; dependencies are read from
  `## Dependencies`. An explicit statement that a prerequisite is complete
  counts as delivered; `None` means no dependency.
- The frontier uses the `status:ready` and `status:blocked` labels; do not
  invent other status labels.
- Documentation Skills default to report-only unless asked to apply fixes.

### Compatibility and failure obligations

Older and newer `tenkai-server` API versions (the console requires `/healthz`
to list the contract it was built for), error semantics, version skew, and the
pinned release a Tenkai build embeds. A management action whose response is
lost reads as unknown, never as success, and is never retried silently.

### Additional impact boundaries

- server responses validated at runtime versus types trusted without
  validation;
- relative URLs and API discovery two levels above the entry module, so one
  bundle works at `/ui/` and `/<prefix>/ui/`;
- same-origin, air-gapped operation: no requests, fonts, or assets from other
  origins (OIDC sign-in additionally reaches the identity provider);
- tokens held in memory only; only the PKCE verifier and `state` survive the
  redirect;
- the release contract Tenkai pins: `tenkai-console-vX.Y.Z.zip`, `SHA256SUMS`,
  provenance and SBOM attestations, and the family release manifest.

### Verification matrix

Rows beyond `## Testing Guidelines`:

| Surface                               | Required evidence                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| TypeScript / React source             | focused tests, `pnpm typecheck`, `pnpm lint`                                                            |
| Tenkai API client or response schemas | schema tests against recorded responses; `pnpm api:check`; compare with Tenkai's versioned public API   |
| routing, base URL, or asset paths     | `pnpm build`, then serve `dist/` under `/ui/` and `/<prefix>/ui/`                                       |
| bundle size                           | `pnpm perf:bundle`                                                                                      |
| fleet-scale table load                | `pnpm perf:load` after `pnpm build`                                                                     |
| packaging or release workflow         | `VERSION=v0.0.0-dev pnpm package`, inspect zip and `SHA256SUMS`; `tests/release/`; `check-workflows.sh` |
| dependencies                          | `pnpm install --frozen-lockfile`, pinned versions, no new outbound origins                              |
| any diff                              | no `dist/`, `release/`, or `*.tsbuildinfo` staged                                                       |

### UI proof

- Browser tests: `pnpm build && pnpm e2e` runs `e2e/` in Playwright.
  `e2e/mock-backend.ts` serves `dist/` and a mocked API on port 0 and holds
  the shared design-rule assertions; `perf/` uses the same mock backend.
- Live target: a running `tenkai-server`, read-only. No create, save, publish,
  approve, or delete without explicit authorization for that write. Never
  record its address in the repository.
- Design constraints:
  - dark mode on a true black `#000` background, white primary text;
  - information-dense;
  - no decorative card or pill chrome;
  - no light-grey subtitle lines above sections;
  - minimal copy, no em dashes;
  - no continuously repainting animations (pulse, shimmer, spinners, blur).
- Artifacts: screenshots, traces, and videos go to a per-process directory
  outside the repository (system temp, process id plus a unique suffix).
  Never commit them.
- Mocks and states galleries: publish with postplan and link them from the
  Issue and Pull Request. Re-upload the same file to keep the link stable.
- Visual Pull Requests carry inspected before/after captures of the running
  product (base branch vs the change) in the Pull Request body as a postplan
  URL. Re-upload the same file to keep the link stable. A comment counts only
  when the body links to it. Do not commit the captures or paste GitHub image
  attachments. Playwright output and CI artifact links do not substitute.

### Release audit

- `package.json` version, `pnpm-lock.yaml` consistency, dependency changes, and
  `.github/workflows/release.yml` (run from main for a tag by
  `.github/workflows/release-dispatch.yml`);
- the minimum Tenkai API contract the bundle needs;
- relative-URL behavior at `/ui/` and `/<prefix>/ui/`, and no requests outside
  the origin;
- authentication, approval, and security-relevant UI behavior;
- the `ui/console.pin` update Tenkai needs (URL and SHA-256);
- `CHANGELOG.md` drafted from `scripts/changelog-draft.sh`, upgrade actions
  first; contributors credited through GitHub's generated notes;
- after an authorized signed `vX.Y.Z` tag equal to `package.json`, the Release
  workflow attached `tenkai-console-vX.Y.Z.zip`, `SHA256SUMS`, SBOM, family
  manifest, and CHANGELOG notes, verified as `README.md` describes. Do not
  rewrite existing Release notes when only uploading assets.
