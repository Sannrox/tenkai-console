---
name: verify-change
description: Verify a tenkai-console TypeScript, API-contract, packaging, documentation, configuration, or workflow change with proportionate deterministic checks. Use after implementation, before review, or when a contributor needs an exact evidence report without overstating unrun tests.
---

# Verify Change

Run the narrowest useful checks first, then expand according to change risk.

## Procedure

1. Inspect `git status`, the diff, and the stated outcome. Preserve unrelated
   worktree changes. Use `assess-change-impact` when risk is unclear. Complete
   when every changed path is classified.
2. Run focused tests for the affected module first (`pnpm vitest run <path>`).
   Add checks based on the surface:

   | Surface | Required evidence |
   | --- | --- |
   | TypeScript / React source | focused Vitest, `pnpm typecheck`, `pnpm lint` |
   | Tenkai API client or ArkType schemas | schema tests against recorded responses; compare with Tenkai's versioned public API |
   | routing, base URL, or asset paths | `pnpm build`, then serve `dist/` under `/ui/` and `/<prefix>/ui/` |
   | packaging or release workflow | `VERSION=v0.0.0-dev pnpm package`, inspect the zip and `SHA256SUMS` |
   | dependencies | `pnpm install --frozen-lockfile`, pinned versions, no new outbound origins |
   | docs/Skills | syntax, links, and commands where practical |

3. Before ship-level handoff, run the normal repository gates (the same steps
   as CI) unless the user explicitly requested a narrower check:

   ```bash
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   VERSION=ci sh scripts/package.sh
   ```

   Complete when every applicable local gate has a result.
4. Keep checks that need a running `tenkai-server` out of the default suite
   unless one is intentionally available (`TENKAI_URL=... pnpm dev`). Never
   print secrets or persist live server payloads. Complete when skipped checks
   name both the reason and residual risk.
5. Review failures against the changed scope. Report pre-existing failures with
   evidence; do not relabel a failure as pre-existing without comparison.

## Output

Report:

- commands run and pass/fail result;
- focused behavior covered;
- checks skipped with reasons;
- failures and whether they block the stated outcome; and
- remaining uncertainty.

Never use “all tests pass” unless all stated tests actually ran and passed.
