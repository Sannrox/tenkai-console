import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { signInMethod, useAuthSession } from "../auth/identity";
import { useSession } from "../auth/session";
import { Card } from "../ui/kit";

/** Shown while the server has not said which grants this session carries. */
export const GRANT_SUMMARY =
  "read, publish, and management, decided by the server for each request from your groups";

/**
 * Who you are signed in as, how, and what the server grants. Grants are
 * decided by the server on every request; this only reports its answer.
 */
export const Access = ({ settings }: { settings: OidcClientDiscovery | null }) => {
  const session = useSession((state) => state.session);
  const me = useAuthSession(session?.accessToken).data;
  const expires = session?.expiresAt ? new Date(session.expiresAt).toLocaleTimeString() : undefined;
  const groups = me?.groups ?? [];
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
          <dd className="m-0">{session ? signInMethod(session, settings) : "bearer token"}</dd>
          {groups.length > 0 && (
            <>
              <dt className="text-muted">groups</dt>
              <dd className="m-0">{groups.join(", ")}</dd>
            </>
          )}
          {expires && (
            <>
              <dt className="text-muted">session</dt>
              <dd className="m-0">renews before {expires}</dd>
            </>
          )}
          <dt className="text-muted">grants</dt>
          <dd className="m-0">{me ? me.capabilities.join(", ") || "none" : GRANT_SUMMARY}</dd>
        </dl>
      </Card>
    </>
  );
};
