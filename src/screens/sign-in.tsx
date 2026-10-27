import { type FormEvent, useState } from "react";
import { ApiError, consoleRoot, request } from "../api/http";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { beginSignIn, providerLabel } from "../auth/oidc";
import { useSession } from "../auth/session";
import { Button, Centered } from "../ui/kit";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const TOKEN_LABEL = "Platform token";

/** Shown under the button: access follows the signed-in team. */
export const TEAM_NOTE = "What you can see and change depends on your team.";

/**
 * Sign-in heading (#30, pick A): the organisation is the title, Tenkai the
 * subtitle; with no organisation sign-in configured, Tenkai is the title.
 */
export const signInHeading = (
  settings: OidcClientDiscovery | null,
): { title: string; subtitle: string } =>
  settings
    ? { title: providerLabel(settings), subtitle: "Tenkai delivery console" }
    : { title: "Tenkai", subtitle: "Delivery console" };

/** Decision 5F: one button to the organisation's sign-in. */
export const signInButtonLabel = (settings: OidcClientDiscovery): string =>
  `Sign in with ${providerLabel(settings)} SSO`;

/** 401 vs 403 on a pasted platform token. Other statuses stay the server text. */
export const tokenRefusal = (status: number): string | undefined => {
  if (status === 401) {
    return "Token not recognized.";
  }
  if (status === 403) {
    return "This token is recognized and has no access.";
  }
  return undefined;
};

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

  const heading = signInHeading(settings);
  return (
    <Centered>
      <h1 className="m-0 text-[15px] font-semibold">{heading.title}</h1>
      <p className="mt-0 mb-4 text-xs text-muted">{heading.subtitle}</p>
      {ended === "expired" && (
        <p className="mb-3 text-xs text-warning">Session expired. Sign in again.</p>
      )}
      {settings && (
        <Button
          variant="primary"
          className="w-full py-2"
          disabled={busy}
          onClick={() => void signInWithProvider()}
        >
          {signInButtonLabel(settings)}
        </Button>
      )}
      {settings && <p className="mt-2 mb-0 text-xs text-muted">{TEAM_NOTE}</p>}
      {error && (
        <p role="alert" className="mt-3 mb-0 text-xs text-danger">
          {error}
        </p>
      )}
      {useToken ? (
        <TokenForm />
      ) : (
        <div className="mt-3 border-t border-line pt-2 text-xs">
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

/** Platform token held in memory for this tab; checked against a read before use. */
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
        cause instanceof ApiError ? (tokenRefusal(cause.status) ?? message(cause)) : message(cause),
      );
    }
  };

  return (
    <form className="mt-4 border-t border-line pt-3" onSubmit={(event) => void submit(event)}>
      <p className="mt-0 mb-2 text-xs text-muted">{TOKEN_LABEL}</p>
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="off"
          aria-label={TOKEN_LABEL}
          placeholder="Paste token"
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
