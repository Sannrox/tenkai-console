import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { consoleRoot } from "../api/http";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { completeSignIn } from "../auth/oidc";
import { useSession } from "../auth/session";
import { Centered, Title } from "../ui/kit";

/** Provider redirect target. Runs the code exchange exactly once per callback URL. */
export const AuthCallback = ({ settings }: { settings: OidcClientDiscovery }) => {
  const signIn = useSession((state) => state.signIn);
  const href = window.location.href;
  const exchange = useQuery({
    queryKey: ["oidc-callback", href],
    queryFn: () => completeSignIn(settings, consoleRoot, new URL(href)),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (exchange.data) {
      signIn(exchange.data);
    }
  }, [exchange.data, signIn]);

  if (exchange.data) {
    return <Navigate to="/" replace />;
  }
  return (
    <Centered>
      <Title subtitle="Signing in" />
      {exchange.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {exchange.error.message}
        </p>
      ) : (
        <p className="m-0 text-xs text-muted">Finishing sign-in…</p>
      )}
    </Centered>
  );
};
