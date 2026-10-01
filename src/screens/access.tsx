import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { Card } from "../ui/kit";

/** Who you are signed in as. Grants are decided by the server on every request. */
export const Access = ({ settings }: { settings: OidcClientDiscovery | null }) => {
  const session = useSession((state) => state.session);
  const expires = session?.expiresAt ? new Date(session.expiresAt).toLocaleTimeString() : undefined;
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Access</h1>
      </div>
      <Card>
        <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 px-3.5 py-3 text-xs">
          <dt className="text-muted">signed in as</dt>
          <dd className="m-0">{session?.subject ?? "bearer token"}</dd>
          <dt className="text-muted">method</dt>
          <dd className="m-0">
            {session?.kind === "oidc" && settings
              ? `OIDC via ${new URL(settings.issuer).host}`
              : "bearer token"}
          </dd>
          {expires && (
            <>
              <dt className="text-muted">session</dt>
              <dd className="m-0">renews before {expires}</dd>
            </>
          )}
          <dt className="text-muted">grants</dt>
          <dd className="m-0">decided by the server for each request, from your groups</dd>
        </dl>
      </Card>
    </>
  );
};
