import { type FormEvent, useState } from "react";
import { ApiError, consoleRoot, request } from "../api/http";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { beginSignIn, providerLabel } from "../auth/oidc";
import { useSession } from "../auth/session";
import { Button, Centered, Title } from "../ui/kit";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Decision 5F: one button to the organisation's sign-in, token as fallback. */
export const SignIn = ({ settings }: { settings: OidcClientDiscovery | null }) => {
  const ended = useSession((state) => state.ended);
  const [useToken, setUseToken] = useState(settings === null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const signInWithProvider = async () => {
    if (!settings) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      window.location.assign(await beginSignIn(settings, consoleRoot));
    } catch (cause) {
      setError(`Could not reach the sign-in page: ${message(cause)}`);
      setBusy(false);
    }
  };

  return (
    <Centered>
      <Title subtitle={`Delivery for ${window.location.host}`} />
      {ended === "expired" && (
        <p className="mb-3 text-xs text-warning">Session expired. Sign in again.</p>
      )}
      {settings && (
        <>
          <Button
            variant="primary"
            className="w-full py-2"
            disabled={busy}
            onClick={() => void signInWithProvider()}
          >
            Sign in with {providerLabel(settings)}
          </Button>
          <p className="mt-3.5 mb-0 text-xs text-muted">
            You'll sign in on {providerLabel(settings)}'s login page and return here. What you can
            see and change depends on your team.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 mb-0 text-xs text-danger">
          {error}
        </p>
      )}
      {useToken ? (
        <TokenForm />
      ) : (
        <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
          No access yet? Ask the platform team. ·{" "}
          <button
            type="button"
            className="cursor-pointer text-muted underline"
            onClick={() => setUseToken(true)}
          >
            Use a token instead
          </button>
        </div>
      )}
    </Centered>
  );
};

/** Bearer token held in memory for this tab; checked against a read before use. */
const TokenForm = () => {
  const signIn = useSession((state) => state.signIn);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await request("v1/fleet/status", { token });
      signIn({
        kind: "token",
        accessToken: token,
        subject: undefined,
        expiresAt: undefined,
        refreshToken: undefined,
        idToken: undefined,
      });
    } catch (cause) {
      setError(
        cause instanceof ApiError && (cause.status === 401 || cause.status === 403)
          ? "This token is not accepted by the server."
          : message(cause),
      );
    }
  };

  return (
    <form className="mt-4 border-t border-line pt-3" onSubmit={(event) => void submit(event)}>
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="off"
          aria-label="Bearer token"
          placeholder="Paste bearer token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted"
        />
        <Button type="submit" disabled={!token}>
          Sign in
        </Button>
      </div>
      <p className="mt-2 mb-0 text-[11px] text-muted">Kept in memory for this tab only.</p>
      {error && (
        <p role="alert" className="mt-2 mb-0 text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
};
