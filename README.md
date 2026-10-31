# tenkai-console

Web console for the [Tenkai](https://github.com/Sannrox/tenkai) delivery
control plane. It is a client of Tenkai's versioned public API only: anything
the console does, `tenkaictl` can do with the same contract and audit record.
The design is recorded in Tenkai
[ADR 0031](https://github.com/Sannrox/tenkai/blob/main/docs/decisions/0031-web-console.md).

## How it ships

Each signed annotated tag `vX.Y.Z` (equal to the `package.json` version)
publishes `tenkai-console-vX.Y.Z.zip`, `SHA256SUMS`, an SBOM, provenance
attestations, a family release manifest, and a GitHub Release whose notes
come from CHANGELOG. Tenkai pins one release in `ui/console.pin` by tag and
SHA-256 and serves it at `/ui/` on the API's origin behind a `ui` feature.
This repository does not publish a container image. See [RELEASING.md](RELEASING.md).

The build uses only relative URLs and finds the API two levels above its own
entry module, so the same zip works at `/ui/` and at `/<prefix>/ui/` behind a
reverse proxy. The bundle loads no assets from outside its origin. With a
pasted token it talks only to its own origin and works air-gapped; OIDC
sign-in additionally needs the identity provider (see below).

Verify a release before pinning it:

```sh
tag=vX.Y.Z
gh release download "$tag" -R Sannrox/tenkai-console
sha256sum -c SHA256SUMS
gh attestation verify "tenkai-console-$tag.zip" -R Sannrox/tenkai-console
```

## Sign-in

The console signs in with OIDC (Authorization Code with PKCE, public client)
using the settings `tenkai-server` serves at `GET /v1/auth/oidc`, configured by
`TENKAI_OIDC_CONFIG` (see Tenkai's `docs/auth-request-context.md`). Register
these with the identity provider for client `tenkai-console`:

- redirect URI: `<public console URL>/auth/callback`, for example
  `https://tenkai.example.com/ui/auth/callback`;
- post-logout redirect URI: the console URL itself;
- web origin (CORS): the console's origin, for example
  `https://tenkai.example.com`, because the browser calls the provider's
  discovery and token endpoints directly. A Content-Security-Policy in front of
  the console must allow the issuer in `connect-src`;
- access tokens as signed JWTs (RS256 or ES256) whose `aud` includes the
  audience in Tenkai's OIDC config, carrying the groups claim Tenkai maps to
  grants.

Tokens stay in memory. While the tab is open, the console renews the session
with the refresh token shortly before the access token expires, when the
provider issues one; otherwise the session ends at expiry. A reload signs in
again. Only the PKCE verifier and
`state` survive the redirect, in `sessionStorage`. Servers without OIDC accept
a pasted bearer token instead, also held in memory.

## API types

`api/tenkai-http-v1.schema.json` is Tenkai's published HTTP contract, vendored
at the commit in `api/TENKAI_REF`. `src/api/tenkai.gen.ts` is generated from it.

```sh
pnpm api:sync <tenkai-commit-sha>   # update the vendored schema and regenerate
pnpm api:check                      # CI: fail when generated types are stale
pnpm api:drift                      # scheduled: fail when the schema is behind tenkai main
```

At startup the console requires `/healthz` to list the contract it was built
for and shows "server too old" otherwise.

## Develop

```sh
pnpm install
TENKAI_URL=http://127.0.0.1:8080 pnpm dev   # proxies /v1 and /healthz to tenkai-server
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
VERSION=v0.0.0-dev pnpm package             # release/ zip + SHA256SUMS
pnpm perf:bundle                             # CI: initial JS ≤ 200 KB gzipped, ≤ 10% over perf/bundle-baseline.json
pnpm perf:load                               # CI: fleet-scale table budgets (needs `pnpm exec playwright install chromium`)
```

Stack: TypeScript (strict), React, Vite, ArkType for runtime validation of
server responses, Oxlint (type-aware) and Oxfmt, Vitest, pnpm.

## License

Apache-2.0.
